import type Database from "better-sqlite3";
import type { ThreadEvent, ThreadEventType, ActorType } from "@personahub/shared/types";
import { generateEventId } from "../id.js";

export interface ThreadEventCreateInput {
  thread_id: string;
  type: ThreadEventType;
  actor_type: ActorType;
  actor_id: string | null;
  payload: Record<string, unknown>;
  evidence_refs: string[];
}

interface ThreadEventRow {
  id: string;
  event_sequence: number;
  thread_id: string;
  type: string;
  actor_type: string;
  actor_id: string | null;
  payload_json: string;
  evidence_refs: string;
  created_at: string;
}

function mapRow(row: ThreadEventRow): ThreadEvent {
  return {
    id: row.id,
    event_sequence: row.event_sequence,
    thread_id: row.thread_id,
    type: row.type as ThreadEventType,
    actor_type: row.actor_type as ActorType,
    actor_id: row.actor_id,
    payload_json: JSON.parse(row.payload_json) as Record<string, unknown>,
    evidence_refs: JSON.parse(row.evidence_refs ?? "[]") as string[],
    created_at: row.created_at,
  };
}

export class ThreadEventRepository {
  constructor(private db: Database.Database) {}

  create(input: ThreadEventCreateInput): ThreadEvent {
    const id = generateEventId();
    const seq = this.getNextSequence();
    const now = new Date().toISOString();
    this.db.prepare(
      `INSERT INTO thread_events (id, event_sequence, thread_id, type, actor_type, actor_id, payload_json, evidence_refs, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id, seq, input.thread_id, input.type,
      input.actor_type, input.actor_id,
      JSON.stringify(input.payload), JSON.stringify(input.evidence_refs), now
    );

    const row = this.db.prepare("SELECT * FROM thread_events WHERE id = ?").get(id) as ThreadEventRow;
    return mapRow(row);
  }

  listByThread(threadId: string, afterEventId?: string): ThreadEvent[] {
    if (afterEventId) {
      const afterRow = this.db.prepare(
        "SELECT event_sequence FROM thread_events WHERE id = ? AND thread_id = ?"
      ).get(afterEventId, threadId) as { event_sequence: number } | undefined;

      if (!afterRow) {
        return [];
      }

      const rows = this.db.prepare(
        "SELECT * FROM thread_events WHERE thread_id = ? AND event_sequence > ? ORDER BY event_sequence ASC"
      ).all(threadId, afterRow.event_sequence) as ThreadEventRow[];
      return rows.map(mapRow);
    }

    const rows = this.db.prepare(
      "SELECT * FROM thread_events WHERE thread_id = ? ORDER BY event_sequence ASC"
    ).all(threadId) as ThreadEventRow[];
    return rows.map(mapRow);
  }

  getById(eventId: string): ThreadEvent | null {
    const row = this.db.prepare("SELECT * FROM thread_events WHERE id = ?").get(eventId) as ThreadEventRow | undefined;
    return row ? mapRow(row) : null;
  }

  listByThreadAndTypes(
    threadId: string,
    types: ThreadEventType[],
    afterEventId?: string,
    limit = 100,
  ): ThreadEvent[] {
    if (types.length === 0) {
      return [];
    }
    const placeholders = types.map(() => "?").join(", ");

    if (afterEventId) {
      const afterRow = this.db.prepare(
        "SELECT event_sequence FROM thread_events WHERE id = ? AND thread_id = ?"
      ).get(afterEventId, threadId) as { event_sequence: number } | undefined;

      if (!afterRow) {
        return [];
      }

      const rows = this.db.prepare(
        `SELECT * FROM thread_events WHERE thread_id = ? AND event_sequence > ? AND type IN (${placeholders}) ORDER BY event_sequence ASC LIMIT ?`
      ).all(threadId, afterRow.event_sequence, ...types, limit) as ThreadEventRow[];
      return rows.map(mapRow);
    }

    const rows = this.db.prepare(
      `SELECT * FROM thread_events WHERE thread_id = ? AND type IN (${placeholders}) ORDER BY event_sequence ASC LIMIT ?`
    ).all(threadId, ...types, limit) as ThreadEventRow[];
    return rows.map(mapRow);
  }

  getLatestByTypeAndPayload(
    threadId: string,
    type: ThreadEventType,
    payloadKey: string,
    payloadValue: string,
  ): ThreadEvent | null {
    const row = this.db.prepare(
      `SELECT * FROM thread_events
       WHERE thread_id = ? AND type = ?
         AND json_extract(payload_json, '$.' || ?) = ?
       ORDER BY event_sequence DESC LIMIT 1`
    ).get(threadId, type, payloadKey, payloadValue) as ThreadEventRow | undefined;
    return row ? mapRow(row) : null;
  }

  existsByTypeAndPayload(
    threadId: string,
    type: ThreadEventType,
    payloadKey: string,
    payloadValue: string,
  ): boolean {
    const row = this.db.prepare(
      `SELECT 1 FROM thread_events
       WHERE thread_id = ? AND type = ?
         AND json_extract(payload_json, '$.' || ?) = ?
       LIMIT 1`
    ).get(threadId, type, payloadKey, payloadValue);
    return row !== undefined;
  }

  listByThreadTypeAndPayload(
    threadId: string,
    types: ThreadEventType[],
    payloadKey: string,
    payloadValue: string,
    limit = 200,
  ): ThreadEvent[] {
    if (types.length === 0) return [];
    const placeholders = types.map(() => "?").join(", ");
    const rows = this.db.prepare(
      `SELECT * FROM thread_events
       WHERE thread_id = ? AND type IN (${placeholders})
         AND json_extract(payload_json, '$.' || ?) = ?
       ORDER BY event_sequence DESC LIMIT ?`
    ).all(threadId, ...types, payloadKey, payloadValue, limit) as ThreadEventRow[];
    return rows.map(mapRow);
  }

  getLatestByThreadAndTypes(
    threadId: string,
    types: ThreadEventType[],
  ): ThreadEvent | null {
    if (types.length === 0) return null;
    const placeholders = types.map(() => "?").join(", ");
    const row = this.db.prepare(
      `SELECT * FROM thread_events
       WHERE thread_id = ? AND type IN (${placeholders})
       ORDER BY event_sequence DESC LIMIT 1`
    ).get(threadId, ...types) as ThreadEventRow | undefined;
    return row ? mapRow(row) : null;
  }

  listLatestByThreadAndTypes(
    threadId: string,
    types: ThreadEventType[],
    limit: number,
  ): ThreadEvent[] {
    if (types.length === 0) return [];
    const placeholders = types.map(() => "?").join(", ");
    const rows = this.db.prepare(
      `SELECT * FROM thread_events
       WHERE thread_id = ? AND type IN (${placeholders})
       ORDER BY event_sequence DESC LIMIT ?`
    ).all(threadId, ...types, limit) as ThreadEventRow[];
    return rows.map(mapRow);
  }

  getNextSequence(): number {
    const row = this.db.prepare(
      "SELECT COALESCE(MAX(event_sequence), 0) + 1 as next_seq FROM thread_events"
    ).get() as { next_seq: number };
    return row.next_seq;
  }
}
