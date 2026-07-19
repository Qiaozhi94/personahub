import { describe, it, expect } from "vitest";
import type Database from "better-sqlite3";
import { createTestDb } from "../helpers.js";
import { AgentConfigRepository } from "../../src/repositories/agent-config.js";
import { AdapterStatus, AdapterAuthType, AgentCapability } from "@personahub/shared/types";

function insertProject(db: Database.Database, id: string): void {
  const now = new Date().toISOString();
  db.prepare("INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)").run(id, id, now, now);
}

// T017: AgentConfigRepository's internal record (AgentConfigRecord) carries
// the raw api_key value — this is the ONLY layer allowed to see it. The
// public DTO builder (T019/T020, toPublicAdapter) is what strips it before
// anything crosses the service boundary. This file only exercises the
// repository directly, never through a route or the public AdapterConfig type.

const HIGHLY_IDENTIFIABLE_SECRET = "sk-T017-CANARY-3f9a7c21b8e04d5f9c11";

function baseCreateInput(projectId: string, overrides: Record<string, unknown> = {}) {
  return {
    project_id: projectId,
    name: "OpenCode",
    role: "implementation",
    cli_provider: "opencode",
    command: "opencode",
    args: [],
    capability_tags: [AgentCapability.Implementation],
    default_model: null,
    status: AdapterStatus.Available,
    auth_type: AdapterAuthType.ApiKey,
    model_provider: "openai",
    api_key: null,
    auth_status_message: null,
    ...overrides,
  };
}

describe("AgentConfigRepository internal record (T017)", () => {
  it("create() persists auth_type/model_provider/api_key/auth_status_message and returns them raw", () => {
    const db = createTestDb();
    insertProject(db, "prj_1");
    const repo = new AgentConfigRepository(db);
    const record = repo.create(baseCreateInput("prj_1", { api_key: HIGHLY_IDENTIFIABLE_SECRET }));

    expect(record.auth_type).toBe(AdapterAuthType.ApiKey);
    expect(record.model_provider).toBe("openai");
    expect(record.api_key).toBe(HIGHLY_IDENTIFIABLE_SECRET);
    expect(record.auth_status_message).toBeNull();
  });

  it("getById() returns the raw api_key on the internal record", () => {
    const db = createTestDb();
    insertProject(db, "prj_2");
    const repo = new AgentConfigRepository(db);
    const created = repo.create(baseCreateInput("prj_2", { api_key: HIGHLY_IDENTIFIABLE_SECRET }));

    const fetched = repo.getById(created.id);

    expect(fetched?.api_key).toBe(HIGHLY_IDENTIFIABLE_SECRET);
  });

  it("update() replaces api_key with a new value", () => {
    const db = createTestDb();
    insertProject(db, "prj_3");
    const repo = new AgentConfigRepository(db);
    const created = repo.create(baseCreateInput("prj_3", { api_key: "old-key" }));

    repo.update(created.id, { api_key: HIGHLY_IDENTIFIABLE_SECRET, updated_at: new Date().toISOString() });

    const fetched = repo.getById(created.id);
    expect(fetched?.api_key).toBe(HIGHLY_IDENTIFIABLE_SECRET);
  });

  it("update() with api_key omitted preserves the existing key", () => {
    const db = createTestDb();
    insertProject(db, "prj_4");
    const repo = new AgentConfigRepository(db);
    const created = repo.create(baseCreateInput("prj_4", { api_key: HIGHLY_IDENTIFIABLE_SECRET }));

    repo.update(created.id, { name: "Renamed", updated_at: new Date().toISOString() });

    const fetched = repo.getById(created.id);
    expect(fetched?.api_key).toBe(HIGHLY_IDENTIFIABLE_SECRET);
    expect(fetched?.name).toBe("Renamed");
  });

  it("update() with api_key: null clears the key", () => {
    const db = createTestDb();
    insertProject(db, "prj_5");
    const repo = new AgentConfigRepository(db);
    const created = repo.create(baseCreateInput("prj_5", { api_key: HIGHLY_IDENTIFIABLE_SECRET }));

    repo.update(created.id, { api_key: null, updated_at: new Date().toISOString() });

    const fetched = repo.getById(created.id);
    expect(fetched?.api_key).toBeNull();
  });

  it("update() replaces auth_type/model_provider/auth_status_message independently", () => {
    const db = createTestDb();
    insertProject(db, "prj_6");
    const repo = new AgentConfigRepository(db);
    const created = repo.create(baseCreateInput("prj_6"));

    repo.update(created.id, {
      auth_type: AdapterAuthType.OAuth,
      model_provider: null,
      auth_status_message: "probe failed: connection refused",
      updated_at: new Date().toISOString(),
    });

    const fetched = repo.getById(created.id);
    expect(fetched?.auth_type).toBe(AdapterAuthType.OAuth);
    expect(fetched?.model_provider).toBeNull();
    expect(fetched?.auth_status_message).toBe("probe failed: connection refused");
  });

  describe("malformed capability_tags JSON — fail closed, never guess", () => {
    it("treats invalid JSON as empty capability_tags and forces status unavailable", () => {
      const db = createTestDb();
      insertProject(db, "prj_7");
      const repo = new AgentConfigRepository(db);
      const created = repo.create(baseCreateInput("prj_7", { status: AdapterStatus.Available }));

      db.prepare("UPDATE agent_configs SET capability_tags = ? WHERE id = ?").run("{not valid json", created.id);

      const fetched = repo.getById(created.id);
      expect(fetched?.capability_tags).toEqual([]);
      expect(fetched?.status).toBe(AdapterStatus.Unavailable);
    });

    it("treats a non-array JSON value (e.g. an object) as empty capability_tags and forces status unavailable", () => {
      const db = createTestDb();
      insertProject(db, "prj_8");
      const repo = new AgentConfigRepository(db);
      const created = repo.create(baseCreateInput("prj_8", { status: AdapterStatus.Available }));

      db.prepare("UPDATE agent_configs SET capability_tags = ? WHERE id = ?").run('{"implementation":true}', created.id);

      const fetched = repo.getById(created.id);
      expect(fetched?.capability_tags).toEqual([]);
      expect(fetched?.status).toBe(AdapterStatus.Unavailable);
    });

    it("leaves a well-formed capability_tags array and the stored status untouched", () => {
      const db = createTestDb();
      insertProject(db, "prj_9");
      const repo = new AgentConfigRepository(db);
      const created = repo.create(baseCreateInput("prj_9", { capability_tags: [AgentCapability.Validator], status: AdapterStatus.Available }));

      const fetched = repo.getById(created.id);
      expect(fetched?.capability_tags).toEqual([AgentCapability.Validator]);
      expect(fetched?.status).toBe(AdapterStatus.Available);
    });
  });

  it("listByProject() and listAvailableByProjectAndRole() also return internal records with raw api_key", () => {
    const db = createTestDb();
    insertProject(db, "prj_10");
    const repo = new AgentConfigRepository(db);
    repo.create(baseCreateInput("prj_10", { api_key: HIGHLY_IDENTIFIABLE_SECRET, status: AdapterStatus.Available }));

    const listed = repo.listByProject("prj_10");
    const listedAvailable = repo.listAvailableByProjectAndRole("prj_10", "implementation");

    expect(listed[0]?.api_key).toBe(HIGHLY_IDENTIFIABLE_SECRET);
    expect(listedAvailable[0]?.api_key).toBe(HIGHLY_IDENTIFIABLE_SECRET);
  });
});
