// F012 T006: DomainOutbox unit tests — the invariants that later integration
// work (T022) builds on: atomic enqueue, dedupe-key absorption, lease claim,
// per-consumer idempotent acks, exponential backoff and poison preservation.

import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../../src/db/migrations.js";
import { DomainOutbox } from "../../src/services/domain-outbox.js";
import { AppError } from "../../src/api/errors.js";
import { ErrorCode } from "@personahub/shared/errors";
import type { OutboxEvent } from "@personahub/shared/types";

function setup(now: () => Date = () => new Date("2026-09-14T12:00:00Z")) {
  const db = new Database(":memory:");
  applyMigrations(db);
  const outbox = new DomainOutbox(db, { now, baseDelayMs: 100, maxDelayMs: 5_000, maxAttempts: 3 });
  return { db, outbox };
}

describe("DomainOutbox enqueue atomicity (FR-009)", () => {
  it("refuses to enqueue outside an open transaction", () => {
    const { db, outbox } = setup();
    try {
      outbox.enqueue(db, { topic: "dispatch.test", payload: {}, dedupeKey: "k1" });
      expect.unreachable();
    } catch (error) {
      expect((error as AppError).code).toBe(ErrorCode.OUTBOX_TX_REQUIRED);
    }
    db.close();
  });

  it("enqueues inside the caller's transaction and rolls back with it", () => {
    const { db, outbox } = setup();
    db.transaction(() => {
      outbox.enqueue(db, { topic: "dispatch.test", payload: { id: 1 }, dedupeKey: "dispatch:d1:dispatched" });
      throw new Error("domain failure");
    });
    const count = (db.prepare("SELECT COUNT(*) AS c FROM domain_outbox").get() as { c: number }).c;
    expect(count).toBe(0); // event died with the domain transaction

    db.transaction(() => {
      outbox.enqueue(db, { topic: "dispatch.test", payload: { id: 2 }, dedupeKey: "dispatch:d2:dispatched" });
    })();
    expect((db.prepare("SELECT COUNT(*) AS c FROM domain_outbox").get() as { c: number }).c).toBe(1);
    db.close();
  });

  it("absorbs a duplicate domain fact via the dedupe key and returns the winner's id", () => {
    const { db, outbox } = setup();
    let firstId = "";
    db.transaction(() => {
      firstId = outbox.enqueue(db, { topic: "dispatch.test", payload: { a: 1 }, dedupeKey: "dispatch:d1:dispatched" });
    })();
    let secondId = "";
    db.transaction(() => {
      secondId = outbox.enqueue(db, { topic: "dispatch.test", payload: { a: 2 }, dedupeKey: "dispatch:d1:dispatched" });
    })();
    expect(secondId).toBe(firstId);
    expect((db.prepare("SELECT COUNT(*) AS c FROM domain_outbox").get() as { c: number }).c).toBe(1);
    db.close();
  });
});

describe("DomainOutbox delivery, acks, retry and poison", () => {
  function deliverySetup() {
    let clock = Date.parse("2026-09-14T12:00:00Z");
    const { db, outbox } = setup(() => new Date(clock));
    const advance = (ms: number): void => {
      clock += ms;
    };
    const handled: string[] = [];
    outbox.registerConsumer("dispatch.test", "consumer-a", (event) => {
      handled.push(`a:${event.dedupe_key}`);
    });
    outbox.registerConsumer("dispatch.test", "consumer-b", (event) => {
      handled.push(`b:${event.dedupe_key}`);
    });
    return { db, outbox, handled, advance };
  }

  it("delivers once per consumer, marks delivered only when all acked", async () => {
    const { db, outbox, handled } = deliverySetup();
    db.transaction(() => {
      outbox.enqueue(db, { topic: "dispatch.test", payload: {}, dedupeKey: "dispatch:d1:dispatched" });
    })();
    await outbox.tick("worker-1", 60_000);
    expect(handled.sort()).toEqual(["a:dispatch:d1:dispatched", "b:dispatch:d1:dispatched"]);
    const row = db.prepare("SELECT status, delivered_at FROM domain_outbox").get() as {
      status: string;
      delivered_at: string | null;
    };
    expect(row.status).toBe("delivered");
    expect(row.delivered_at).not.toBeNull();
    db.close();
  });

  it("re-delivers to the failed consumer only; the acked consumer is skipped", async () => {
    const { db, outbox, handled, advance } = deliverySetup();
    let failB = true;
    outbox.registerConsumer("dispatch.test", "consumer-b", (event) => {
      if (failB) throw new AppError(ErrorCode.INTERNAL_ERROR, "consumer-b unavailable");
      handled.push(`b:${event.dedupe_key}`);
    });
    db.transaction(() => {
      outbox.enqueue(db, { topic: "dispatch.test", payload: {}, dedupeKey: "dispatch:d1:dispatched" });
    })();

    await outbox.tick("worker-1", 60_000); // a acks, b throws
    expect(handled).toEqual(["a:dispatch:d1:dispatched"]);
    const afterFirst = db.prepare("SELECT status, attempts FROM domain_outbox").get() as {
      status: string;
      attempts: number;
    };
    expect(afterFirst.status).toBe("pending"); // backoff, not delivered, not poison

    failB = false;
    advance(200); // past the 100ms backoff window
    await outbox.tick("worker-1", 60_000); // now the claim may run again
    const row = db.prepare("SELECT status FROM domain_outbox").get() as { status: string };
    expect(row.status).toBe("delivered");
    db.close();
  });

  it("exponential backoff keeps the event unavailable until its delay passes", async () => {
    let clock = Date.parse("2026-09-14T12:00:00Z");
    const { db, outbox } = setup(() => new Date(clock));
    outbox.registerConsumer("dispatch.test", "consumer-a", () => {
      throw new AppError(ErrorCode.INTERNAL_ERROR, "boom");
    });
    db.transaction(() => {
      outbox.enqueue(db, { topic: "dispatch.test", payload: {}, dedupeKey: "dispatch:d1:dispatched" });
    })();

    await outbox.tick("worker-1", 60_000);
    const row = db.prepare("SELECT status, attempts, available_at FROM domain_outbox").get() as {
      status: string;
      attempts: number;
      available_at: string;
    };
    expect(row.status).toBe("pending");
    expect(row.attempts).toBe(1);
    // base 100ms → available_at = failure time + 100ms
    expect(Date.parse(row.available_at)).toBe(clock + 100);

    // before the delay, a claim returns nothing
    clock += 50;
    const none = outbox.claimBatch("worker-1", 10, 60_000);
    expect(none).toEqual([]);
    db.close();
  });

  it("exhausted budget turns the event poison with stable error preserved, never skipped silently", async () => {
    const { db, outbox } = setup();
    outbox.registerConsumer("dispatch.test", "consumer-a", () => {
      throw new AppError(ErrorCode.INTERNAL_ERROR, "permanent failure");
    });
    db.transaction(() => {
      outbox.enqueue(db, { topic: "dispatch.test", payload: { dispatch_id: "dsp_1" }, dedupeKey: "dispatch:dsp_1:dispatched" });
    })();

    for (let i = 0; i < 5; i += 1) {
      await outbox.tick("worker-1", 60_000);
      // backoff would normally gate the retries — force availability for the test
      db.prepare("UPDATE domain_outbox SET available_at = '2026-09-14T00:00:00Z'").run();
    }
    const row = db.prepare("SELECT status, attempts, last_error_code, last_error_detail, payload_json FROM domain_outbox").get() as {
      status: string;
      attempts: number;
      last_error_code: string | null;
      last_error_detail: string | null;
      payload_json: string;
    };
    expect(row.status).toBe("poison");
    expect(row.attempts).toBe(3);
    expect(row.last_error_code).toBe(ErrorCode.INTERNAL_ERROR);
    expect(row.last_error_detail).toContain("permanent failure");
    expect(JSON.parse(row.payload_json)).toEqual({ dispatch_id: "dsp_1" }); // payload preserved for recovery
    db.close();
  });

  it("reclaims an expired in-flight lease (crashed worker) without losing the event", async () => {
    let clock = Date.parse("2026-09-14T12:00:00Z");
    const { db, outbox } = setup(() => new Date(clock));
    const handled: string[] = [];
    outbox.registerConsumer("dispatch.test", "consumer-a", (event: OutboxEvent) => {
      handled.push(event.dedupe_key);
    });
    db.transaction(() => {
      outbox.enqueue(db, { topic: "dispatch.test", payload: {}, dedupeKey: "dispatch:d1:dispatched" });
    })();

    // worker-1 claims, then "crashes" (never acks); lease was 1s
    outbox.claimBatch("worker-1", 10, 1_000);
    clock += 2_000;
    await outbox.tick("worker-2", 60_000);
    expect(handled).toEqual(["dispatch:d1:dispatched"]);
    const row = db.prepare("SELECT status, attempts FROM domain_outbox").get() as { status: string; attempts: number };
    expect(row.status).toBe("delivered");
    db.close();
  });
});
