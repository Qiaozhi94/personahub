import type Database from "better-sqlite3";
import type { Thread, ThreadType } from "@personahub/shared/types";
import { generateThreadId } from "../id.js";

export interface ThreadCreateInput {
  issue_id: string;
  thread_type: ThreadType;
  title: string;
}

interface ThreadRow {
  id: string;
  issue_id: string;
  room_id: string | null;
  thread_type: string;
  title: string;
  created_at: string;
  updated_at: string;
}

function mapRow(row: ThreadRow): Thread {
  return {
    id: row.id,
    issue_id: row.issue_id,
    room_id: row.room_id,
    thread_type: row.thread_type as ThreadType,
    title: row.title,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export class ThreadRepository {
  constructor(private db: Database.Database) {}

  create(input: ThreadCreateInput): Thread {
    const id = generateThreadId();
    const now = new Date().toISOString();
    this.db.prepare(
      `INSERT INTO threads (id, issue_id, room_id, thread_type, title, created_at, updated_at)
       VALUES (?, ?, NULL, ?, ?, ?, ?)`
    ).run(id, input.issue_id, input.thread_type, input.title, now, now);

    const row = this.db.prepare("SELECT * FROM threads WHERE id = ?").get(id) as ThreadRow;
    return mapRow(row);
  }

  getById(id: string): Thread | null {
    const row = this.db.prepare("SELECT * FROM threads WHERE id = ?").get(id) as ThreadRow | undefined;
    return row ? mapRow(row) : null;
  }
}
