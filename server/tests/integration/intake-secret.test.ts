import { describe, it, expect } from "vitest";
import { randomBytes } from "node:crypto";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyMigrations } from "../../src/db/migrations.js";
import { AppSecretRepository } from "../../src/repositories/app-secret.js";
import {
  ConfirmationTokenService,
  loadOrCreateHmacSecret,
  HMAC_SECRET_NAME,
  HMAC_SECRET_BYTES,
  canonicalJson,
} from "../../src/services/confirmation-token.js";

const basePayload = {
  nonce: "n1",
  issued_at: "2026-01-01T00:00:00Z",
  project_id: "p1",
  workspace_id: "w1",
  premise: {
    project_id: "p1",
    workspace_id: "w1",
    adapters: {},
    workflow_template_id: "t",
    workflow_template_version: 1,
    graph_definition_id: null,
    graph_definition_version: null,
  },
  recommended: {
    issue_type: { value: "coding", rule: "r", candidates: ["coding"], excluded: [] },
    issue_draft: {
      title: { value: "t", rule: "r", candidates: ["t"], excluded: [] },
      goal: { value: "g", rule: "r", candidates: ["g"], excluded: [] },
      priority: { value: "normal", rule: "r", candidates: ["normal"], excluded: [] },
    },
    workflow_template: {
      value: { id: "t", version: 1 },
      rule: "r",
      candidates: [{ id: "t", version: 1 }],
      excluded: [],
    },
    collaboration_topology: {
      value: { value: "sequential" },
      rule: "r",
      candidates: [{ value: "sequential" }],
      excluded: [],
    },
    agent_roster: {
      value: { sequential: "a" },
      rule: "r",
      by_node: { sequential: { candidates: ["a"], excluded: [] } },
    },
  },
};

function openFileDb(path: string): Database.Database {
  const db = new Database(path);
  db.pragma("foreign_keys = ON");
  applyMigrations(db);
  return db;
}

describe("T019b HMAC secret lifecycle", () => {
  it("first boot generates a 32-byte secret exactly once", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const repo = new AppSecretRepository(db);
    const first = loadOrCreateHmacSecret(repo);
    const second = loadOrCreateHmacSecret(repo);
    expect(first).toBe(second);
    expect(Buffer.from(first, "base64")).toHaveLength(HMAC_SECRET_BYTES);
    const rows = db.prepare("SELECT COUNT(*) c FROM app_secrets WHERE name = ?").get(HMAC_SECRET_NAME) as { c: number };
    expect(rows.c).toBe(1);
    db.close();
  });

  it("secret is stable across restart and signatures survive", () => {
    const dir = mkdtempSync(join(tmpdir(), "ph-secret-"));
    const path = join(dir, "test.db");
    try {
      const db1 = openFileDb(path);
      const key1 = loadOrCreateHmacSecret(new AppSecretRepository(db1));
      const svc1 = new ConfirmationTokenService(key1);
      const token = svc1.sign(basePayload);
      db1.close();

      const db2 = openFileDb(path);
      const key2 = loadOrCreateHmacSecret(new AppSecretRepository(db2));
      const svc2 = new ConfirmationTokenService(key2);
      expect(key2).toBe(key1);
      expect(svc2.verify(token)).toBe(true);
      db2.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("corrupt value is a fatal startup error, not silently regenerated", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const repo = new AppSecretRepository(db);
    db.prepare("INSERT INTO app_secrets (name, value, created_at) VALUES (?, ?, ?)").run(
      HMAC_SECRET_NAME,
      "not-base64!!",
      "2026-01-01T00:00:00Z",
    );
    expect(() => loadOrCreateHmacSecret(repo)).toThrow();
    db.close();
  });

  function seedSecret(db: Database.Database, value: string): AppSecretRepository {
    const repo = new AppSecretRepository(db);
    db.prepare("INSERT INTO app_secrets (name, value, created_at) VALUES (?, ?, ?)").run(
      HMAC_SECRET_NAME,
      value,
      "2026-01-01T00:00:00Z",
    );
    return repo;
  }

  it("secret with trailing non-base64 junk is a fatal startup error", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const good = randomBytes(32).toString("base64");
    const repo = seedSecret(db, `${good}!!!!`);
    expect(() => loadOrCreateHmacSecret(repo)).toThrow();
    db.close();
  });

  it("secret with wrong padding is a fatal startup error", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const good = randomBytes(32).toString("base64");
    const repo = seedSecret(db, `${good.replace(/=+$/, "")}==`);
    expect(() => loadOrCreateHmacSecret(repo)).toThrow();
    db.close();
  });

  it("non-canonical (unpadded) secret is a fatal startup error", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const good = randomBytes(32).toString("base64");
    const repo = seedSecret(db, good.slice(0, -1));
    expect(() => loadOrCreateHmacSecret(repo)).toThrow();
    db.close();
  });

  it("a canonical 32-byte secret is accepted", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const good = randomBytes(32).toString("base64");
    const repo = seedSecret(db, good);
    expect(loadOrCreateHmacSecret(repo)).toBe(good);
    db.close();
  });

  it("empty value is a fatal startup error", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const repo = new AppSecretRepository(db);
    db.prepare("INSERT INTO app_secrets (name, value, created_at) VALUES (?, ?, ?)").run(
      HMAC_SECRET_NAME,
      "",
      "2026-01-01T00:00:00Z",
    );
    expect(() => loadOrCreateHmacSecret(repo)).toThrow();
    db.close();
  });

  it("tampered token fails verification", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const secret = loadOrCreateHmacSecret(new AppSecretRepository(db));
    const svc = new ConfirmationTokenService(secret);
    const token = svc.sign(basePayload);
    const tampered = { ...token, payload: { ...token.payload, issued_at: "2000-01-01T00:00:00Z" } };
    expect(svc.verify(tampered)).toBe(false);
    db.close();
  });

  it("canonicalJson sorts object keys and is stable", () => {
    const a = canonicalJson({ b: 1, a: 2, c: [3, { y: 1, x: 2 }] });
    const b = canonicalJson({ a: 2, c: [3, { x: 2, y: 1 }], b: 1 });
    expect(a).toBe(b);
    expect(a).toBe('{"a":2,"b":1,"c":[3,{"x":2,"y":1}]}');
  });
});
