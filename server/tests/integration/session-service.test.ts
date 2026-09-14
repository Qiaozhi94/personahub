// F012 T013 (AC-005): session surface — room creation, message idempotency,
// room ending, and the single-transaction convert-to-task that reprioritizes
// the room's dispatch facts (§4.1).

import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../../src/db/migrations.js";
import { SessionService } from "../../src/services/session-service.js";
import { ThreadEventType } from "@personahub/shared/types";

function setup() {
  const db = new Database(":memory:");
  applyMigrations(db);
  const spaceId = (db.prepare("SELECT id FROM spaces WHERE is_default = 1").get() as { id: string }).id;
  const sessionService = new SessionService(db, {
    write: (threadId: string, type: ThreadEventType, actor: unknown, actorId: unknown, payload: Record<string, unknown>) => {
      const seq =
        ((db.prepare("SELECT COALESCE(MAX(event_sequence), 0) AS s FROM thread_events WHERE thread_id = ?").get(threadId) as { s: number }).s ?? 0) + 1;
      const id = `evt_${seq}_${Math.random().toString(36).slice(2, 8)}`;
      db.prepare(
        "INSERT INTO thread_events (id, event_sequence, thread_id, type, actor_type, actor_id, payload_json, evidence_refs, created_at) VALUES (?, ?, ?, ?, ?, NULL, ?, '[]', ?)",
      ).run(id, seq, threadId, type, "user", JSON.stringify(payload), new Date().toISOString());
      return db.prepare("SELECT * FROM thread_events WHERE id = ?").get(id) as never;
    },
    broadcast: () => {},
  } as never);
  return { db, sessionService, spaceId };
}

describe("SessionService (T013)", () => {
  it("creates an independent room with its internal thread; the thread never carries an exposed id", () => {
    const { db, sessionService, spaceId } = setup();
    const room = sessionService.createRoom({ space_id: spaceId, title: "Free chat" });
    expect(room.state).toBe("active");
    expect(room.issue_id).toBeNull();
    const thread = db.prepare("SELECT * FROM threads WHERE room_id = ?").get(room.id) as { id: string; issue_id: null };
    expect(thread.issue_id).toBeNull();
    db.close();
  });

  it("appendMessage stores body on the room event stream; Idempotency-Key dedupes replays", () => {
    const { sessionService } = setup();
    const room = sessionService.createRoom({ space_id: (sessionService as never as { db: Database }).db.prepare("SELECT id FROM spaces WHERE is_default = 1").get()!.id, title: "Chat" });
    sessionService.appendMessage(room.id, "hello", "idem-1");
    const replay = sessionService.appendMessage(room.id, "hello", "idem-1");
    const { messages } = sessionService.getRoomMessages(room.id);
    expect(messages).toHaveLength(1);
    expect(messages[0].type).toBe(ThreadEventType.SessionMessage);
    expect(replay.id).toBe(messages[0].id);
    sessionService.appendMessage(room.id, "second", "idem-2");
    expect(sessionService.getRoomMessages(room.id).messages).toHaveLength(2);
  });

  it("ended rooms reject messages with ROOM_ENDED", () => {
    const { db, sessionService, spaceId } = setup();
    const room = sessionService.createRoom({ space_id: spaceId, title: "Ending" });
    sessionService.endRoom(room.id);
    try {
      sessionService.appendMessage(room.id, "too late", null);
      expect.unreachable();
    } catch (error) {
      expect((error as { code: string }).code).toBe("ROOM_ENDED");
    }
    db.close();
  });

  it("convert-to-task binds room + thread + prior dispatches in one transaction", () => {
    const { db, sessionService, spaceId } = setup();
    const room = sessionService.createRoom({ space_id: spaceId, title: "Will convert" });
    db.prepare(
      "INSERT INTO projects (id, name, space_id, created_at, updated_at) VALUES ('prj_x', 'P', ?, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
    ).run(spaceId);
    db.prepare(
      "INSERT INTO agent_configs (id, project_id, name, role, cli_provider, command, args, capability_tags, created_at, updated_at) VALUES ('adp_x', 'prj_x', 'codex', 'implementation', 'codex', 'codex', '[]', '[]', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
    ).run();
    db.prepare(
      `INSERT INTO dispatches (id, room_id, issue_id, client_request_id, state, purpose, runtime_id, adapter_config_id, access_ref, model, depth_raw, depth_normalized, identity_snapshot_json, context_scope, skill_revision_refs_json, effective_requirements_json, effective_requirements_hash, handoff_refs_json, grace_deadline_at, created_at)
       VALUES ('dsp_conv', ?, NULL, 'crq_1', 'draft', 'execute', 'local', 'adp_x', NULL, 'm', 'high', 'high', '{}', 'all', '[]', '[]', 'sha256:x', '[]', '2026-01-01T00:00:10Z', '2026-01-01T00:00:00Z')`,
    ).run(room.id);

    const { issueId } = sessionService.convertToTask(room.id, { goal: "Now a real task" });
    const roomRow = sessionService.getRoom(room.id);
    expect(roomRow.issue_id).toBe(issueId);
    const thread = db.prepare("SELECT issue_id FROM threads WHERE room_id = ?").get(room.id) as { issue_id: string };
    expect(thread.issue_id).toBe(issueId);
    const dispatch = db.prepare("SELECT issue_id FROM dispatches WHERE id = 'dsp_conv'").get() as { issue_id: string };
    expect(dispatch.issue_id).toBe(issueId);
    const events = sessionService.getRoomMessages(room.id).messages.map((m) => m.type);
    expect(events).toContain(ThreadEventType.SessionConverted);

    try {
      sessionService.convertToTask(room.id, { goal: "again" });
      expect.unreachable();
    } catch (error) {
      expect((error as { code: string }).code).toBe("ROOM_ALREADY_TASK_BOUND");
    }
    db.close();
  });
});
