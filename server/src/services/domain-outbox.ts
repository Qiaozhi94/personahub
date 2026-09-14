// F012 T006: persistent DomainOutbox — the public contract (FR-009, 不变量 13)
// per design §4.5. F012 is its only owner: F011's `acceptance.completed` is a
// registered consumer, never a second outbox.
//
// Atomicity: enqueue() demands the caller's transaction — it refuses to run
// outside an open better-sqlite3 transaction (OUTBOX_TX_REQUIRED), so an
// event can never outlive its domain write or vice versa. Delivery: workers
// claim batches under a lease, run registered consumers, and record per-
// (event, consumer) acks; an event is `delivered` when every consumer
// registered for its topic has acked. Re-delivery is at-least-once — consumer
// side idempotency is mandatory and ack rows make repeat deliveries cheap.
// Failure: attempts increment per claim; when the retry budget is exhausted
// the event turns `poison` with its stable error code, detail and payload
// preserved — never auto-skipped (design §7.1).

import type Database from "better-sqlite3";
import { ErrorCode } from "@personahub/shared/errors";
import type { OutboxEvent, OutboxStatus } from "@personahub/shared/types";
import { AppError } from "../api/errors.js";
import { isUniqueViolation } from "../db/sqlite-errors.js";
import { generateOutboxEventId } from "../id.js";

export interface NewOutboxEvent {
  topic: string;
  payload: unknown;
  /** Same domain fact re-enqueued under one key is absorbed at the index. */
  dedupeKey: string;
}

export type OutboxConsumerHandler = (event: OutboxEvent) => void | Promise<void>;

interface OutboxRow {
  id: string;
  topic: string;
  payload_json: string;
  dedupe_key: string;
  status: OutboxStatus;
  attempts: number;
  available_at: string;
  claimed_by: string | null;
  claim_expires_at: string | null;
  last_error_code: string | null;
  last_error_detail: string | null;
  created_at: string;
  delivered_at: string | null;
}

function toEvent(row: OutboxRow): OutboxEvent {
  return {
    id: row.id,
    topic: row.topic,
    payload_json: row.payload_json,
    dedupe_key: row.dedupe_key,
    status: row.status,
    attempts: row.attempts,
    available_at: row.available_at,
    claimed_by: row.claimed_by,
    claim_expires_at: row.claim_expires_at,
    last_error_code: row.last_error_code,
    last_error_detail: row.last_error_detail,
    created_at: row.created_at,
    delivered_at: row.delivered_at,
  };
}

export interface DomainOutboxOptions {
  /** available_at = now + min(base * 2^(attempts-1), cap). */
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Claims before poison. */
  maxAttempts?: number;
  now?: () => Date;
}

export class DomainOutbox {
  private consumers = new Map<string, Map<string, OutboxConsumerHandler>>();

  constructor(
    private db: Database.Database,
    private options: DomainOutboxOptions = {},
  ) {}

  private get baseDelayMs(): number {
    return this.options.baseDelayMs ?? 1_000;
  }

  private get maxDelayMs(): number {
    return this.options.maxDelayMs ?? 60_000;
  }

  private get maxAttempts(): number {
    return this.options.maxAttempts ?? 5;
  }

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }

  /** Consumers self-register per topic; each has a stable name for its acks. */
  registerConsumer(topic: string, consumer: string, handler: OutboxConsumerHandler): void {
    let byName = this.consumers.get(topic);
    if (!byName) {
      byName = new Map();
      this.consumers.set(topic, byName);
    }
    byName.set(consumer, handler);
  }

  /** MUST be called inside the caller's domain transaction. */
  enqueue(tx: Database.Database, event: NewOutboxEvent): string {
    if (!tx.inTransaction) {
      throw new AppError(ErrorCode.OUTBOX_TX_REQUIRED, "Outbox enqueue requires the caller's open transaction.");
    }
    const id = generateOutboxEventId();
    try {
      this.db
        .prepare(
          "INSERT INTO domain_outbox (id, topic, payload_json, dedupe_key, status, attempts, available_at, created_at) VALUES (?, ?, ?, ?, 'pending', 0, ?, ?)",
        )
        .run(id, event.topic, JSON.stringify(event.payload ?? null), event.dedupeKey, this.now().toISOString(), this.now().toISOString());
      return id;
    } catch (error) {
      if (isUniqueViolation(error, "domain_outbox.")) {
        // Same domain fact already enqueued: the existing event is the answer.
        const existing = this.db
          .prepare("SELECT id FROM domain_outbox WHERE topic = ? AND dedupe_key = ?")
          .get(event.topic, event.dedupeKey) as { id: string } | undefined;
        if (existing) return existing.id;
      }
      throw error;
    }
  }

  /** Claim up to `n` deliverable events under a lease. Expired in-flight
   *  leases are re-claimable here — the previous owner crashed mid-delivery. */
  claimBatch(worker: string, n: number, leaseMs: number): OutboxEvent[] {
    const topics = [...this.consumers.keys()];
    if (topics.length === 0) return [];
    const now = this.now();
    const nowIso = now.toISOString();
    const leaseEnd = new Date(now.getTime() + leaseMs).toISOString();
    const claim = this.db.transaction(() => {
      const rows = this.db
        .prepare(
          `SELECT * FROM domain_outbox
           WHERE status = 'pending' AND available_at <= ?
             OR status = 'in_flight' AND claim_expires_at IS NOT NULL AND claim_expires_at <= ?
           ORDER BY available_at ASC LIMIT ?`,
        )
        .all(nowIso, nowIso, n) as OutboxRow[];
      const claimable = rows.filter((row) => topics.includes(row.topic));
      const update = this.db.prepare(
        "UPDATE domain_outbox SET status = 'in_flight', claimed_by = ?, claim_expires_at = ?, attempts = attempts + 1 WHERE id = ?",
      );
      for (const row of claimable) update.run(worker, leaseEnd, row.id);
      return claimable.map(toEvent);
    });
    return claim();
  }

  /** Idempotent per (event, consumer). Marks the event delivered once every
   *  consumer registered for its topic has acked. */
  ack(eventId: string, consumer: string): void {
    const row = this.db.prepare("SELECT * FROM domain_outbox WHERE id = ?").get(eventId) as OutboxRow | undefined;
    if (!row) throw new AppError(ErrorCode.OUTBOX_EVENT_NOT_FOUND, `Outbox event not found: ${eventId}`);
    this.db
      .prepare("INSERT OR IGNORE INTO domain_outbox_acks (event_id, consumer, acked_at) VALUES (?, ?, ?)")
      .run(eventId, consumer, this.now().toISOString());

    const registered = this.consumers.get(row.topic);
    if (!registered || registered.size === 0) return;
    const ackedRows = this.db
      .prepare("SELECT consumer FROM domain_outbox_acks WHERE event_id = ?")
      .all(eventId) as Array<{ consumer: string }>;
    const acked = new Set(ackedRows.map((r) => r.consumer));
    const allAcked = [...registered.keys()].every((name) => acked.has(name));
    if (allAcked) {
      this.db
        .prepare("UPDATE domain_outbox SET status = 'delivered', delivered_at = ?, claimed_by = NULL, claim_expires_at = NULL WHERE id = ?")
        .run(this.now().toISOString(), eventId);
    }
  }

  /** Release a claimed event for retry with exponential backoff, or turn it
   *  poison once the budget is spent. Error code + detail are preserved. */
  fail(eventId: string, code: string, detail: string): void {
    const row = this.db.prepare("SELECT * FROM domain_outbox WHERE id = ?").get(eventId) as OutboxRow | undefined;
    if (!row) throw new AppError(ErrorCode.OUTBOX_EVENT_NOT_FOUND, `Outbox event not found: ${eventId}`);

    if (row.attempts >= this.maxAttempts) {
      this.db
        .prepare(
          "UPDATE domain_outbox SET status = 'poison', last_error_code = ?, last_error_detail = ?, claimed_by = NULL, claim_expires_at = NULL WHERE id = ?",
        )
        .run(code, detail, eventId);
      return;
    }
    const delay = Math.min(this.baseDelayMs * 2 ** (row.attempts - 1), this.maxDelayMs);
    const availableAt = new Date(this.now().getTime() + delay).toISOString();
    this.db
      .prepare(
        "UPDATE domain_outbox SET status = 'pending', available_at = ?, last_error_code = ?, last_error_detail = ?, claimed_by = NULL, claim_expires_at = NULL WHERE id = ?",
      )
      .run(availableAt, code, detail, eventId);
  }

  /** One worker tick: claim → deliver → ack/fail. Returns delivered count. */
  async tick(worker: string, leaseMs: number, batchSize = 10): Promise<number> {
    const events = this.claimBatch(worker, batchSize, leaseMs);
    let delivered = 0;
    for (const event of events) {
      const consumers = this.consumers.get(event.topic) ?? new Map();
      try {
        for (const [name, handler] of consumers) {
          const already = this.db
            .prepare("SELECT 1 FROM domain_outbox_acks WHERE event_id = ? AND consumer = ?")
            .get(event.id, name);
          if (already) continue; // redelivery: this consumer already handled it
          await handler(event);
          this.ack(event.id, name);
        }
        delivered += 1;
      } catch (error) {
        const code = error instanceof AppError ? error.code : ErrorCode.INTERNAL_ERROR;
        this.fail(event.id, code, String(error instanceof Error ? error.message : error).slice(0, 2000));
      }
    }
    return delivered;
  }

  healthSnapshot(): { pending: number; poison: number } {
    const row = this.db
      .prepare(
        "SELECT SUM(CASE WHEN status IN ('pending','in_flight') THEN 1 ELSE 0 END) AS pending, SUM(CASE WHEN status = 'poison' THEN 1 ELSE 0 END) AS poison FROM domain_outbox",
      )
      .get() as { pending: number | null; poison: number | null };
    return { pending: row.pending ?? 0, poison: row.poison ?? 0 };
  }
}
