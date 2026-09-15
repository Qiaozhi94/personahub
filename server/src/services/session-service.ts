// F012 T013: SessionService — the ONLY write path for Rooms, session
// messages and the convert-to-task transaction (design §2/§4.1). Thread
// never leaks: the Room's internal 1:1 thread is addressed by room_id only.
// Messages are thread events on the shared stream (task face renders the
// same history); the Idempotency-Key dedupes replays per room.
// convert-to-task runs in ONE transaction: create Issue, bind room + the
// internal thread, backfill the room's prior dispatches, write
// session.converted (FR-007 / §4.1).

import type Database from "better-sqlite3";
import { ActorType, RoomState, ThreadEventType, type Room, type ThreadEvent } from "@personahub/shared/types";
import { ErrorCode } from "@personahub/shared/errors";
import { AppError } from "../api/errors.js";
import { generateIssueId, generateRoomId } from "../id.js";
import type { ThreadEventService } from "./thread-event.js";

export interface CreateRoomInput {
  space_id: string;
  issue_id?: string | null;
  title: string;
}

export interface RoomWithMessages {
  room: Room;
  messages: ThreadEvent[];
  nextCursor: number | null;
}

export class SessionService {
  constructor(
    private db: Database.Database,
    private threadEventService: ThreadEventService,
  ) {}

  /** The Room's internal thread — created lazily for rooms whose thread row
   *  predates F012 backfill (historical rooms always have one). */
  private threadIdFor(roomId: string, issueId: string | null): string {
    const existing = this.db.prepare("SELECT id FROM threads WHERE room_id = ? LIMIT 1").get(roomId) as
      | { id: string }
      | undefined;
    if (existing) return existing.id;
    const id = `thr_${roomId}`;
    this.db
      .prepare(
        "INSERT INTO threads (id, issue_id, room_id, thread_type, title, created_at, updated_at) VALUES (?, ?, ?, 'room', ?, ?, ?)",
      )
      .run(id, issueId, roomId, "Session", new Date().toISOString(), new Date().toISOString());
    return id;
  }

  createRoom(input: CreateRoomInput): Room {
    if (!input.title?.trim()) {
      throw new AppError(ErrorCode.REQUEST_BODY_INVALID, "Room title is required.", "title");
    }
    const space = this.db.prepare("SELECT id FROM spaces WHERE id = ?").get(input.space_id);
    if (!space) throw new AppError(ErrorCode.SPACE_NOT_FOUND, "Space not found.");
    if (input.issue_id) {
      const issue = this.db
        .prepare("SELECT id, space_id FROM issues WHERE id = ?")
        .get(input.issue_id) as { id: string; space_id: string } | undefined;
      if (!issue) throw new AppError(ErrorCode.ISSUE_NOT_FOUND, "Issue not found.");
      if (issue.space_id !== input.space_id) {
        throw new AppError(ErrorCode.ISSUE_SPACE_MISMATCH, "Issue belongs to a different Space.");
      }
    }
    const id = generateRoomId();
    const now = new Date().toISOString();
    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          "INSERT INTO rooms (id, space_id, issue_id, title, state, created_at, ended_at) VALUES (?, ?, ?, ?, 'active', ?, NULL)",
        )
        .run(id, input.space_id, input.issue_id ?? null, input.title.trim(), now);
      this.threadIdFor(id, input.issue_id ?? null);
    });
    tx();
    return this.getRoom(id);
  }

  /** Idempotent session surface for a task: the issue's primary thread gets a
   *  Room (the §3.1 backfill rule applied lazily to threads created after the
   *  v15 migration). Task creation itself stays write-free — the Room only
   *  comes into existence when the session surface is opened. */
  ensureRoomForIssue(issueId: string): Room {
    const issue = this.db
      .prepare("SELECT id, space_id, title, primary_thread_id FROM issues WHERE id = ?")
      .get(issueId) as { id: string; space_id: string; title: string; primary_thread_id: string | null } | undefined;
    if (!issue) throw new AppError(ErrorCode.ISSUE_NOT_FOUND, "Issue not found.");

    const existing = this.db
      .prepare("SELECT * FROM rooms WHERE issue_id = ? ORDER BY created_at ASC LIMIT 1")
      .get(issueId) as Room | undefined;
    if (existing) return existing;

    const id = generateRoomId();
    const now = new Date().toISOString();
    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          "INSERT INTO rooms (id, space_id, issue_id, title, state, created_at, ended_at) VALUES (?, ?, ?, ?, 'active', ?, NULL)",
        )
        .run(id, issue.space_id, issue.id, issue.title?.trim() || "Task", now);
      if (issue.primary_thread_id) {
        this.db.prepare("UPDATE threads SET room_id = ? WHERE id = ? AND room_id IS NULL").run(id, issue.primary_thread_id);
      }
    });
    tx();
    return this.getRoom(id);
  }

  getRoom(roomId: string): Room {
    const room = this.db.prepare("SELECT * FROM rooms WHERE id = ?").get(roomId) as Room | undefined;
    if (!room) throw new AppError(ErrorCode.ROOM_NOT_FOUND, `Room not found: ${roomId}`);
    return room;
  }

  listRooms(issueId?: string | null): Room[] {
    if (issueId) {
      return this.db.prepare("SELECT * FROM rooms WHERE issue_id = ? ORDER BY created_at ASC").all(issueId) as Room[];
    }
    return this.db.prepare("SELECT * FROM rooms ORDER BY created_at DESC").all() as Room[];
  }

  private eventCount(threadId: string): number {
    return (this.db.prepare("SELECT COUNT(*) AS c FROM thread_events WHERE thread_id = ?").get(threadId) as { c: number }).c;
  }

  getRoomMessages(roomId: string, beforeSequence?: number, limit = 50): RoomWithMessages {
    const room = this.getRoom(roomId);
    const threadId = this.threadIdFor(roomId, room.issue_id);
    const cap = Math.min(Math.max(limit, 1), 200);
    const rows = beforeSequence
      ? (this.db
          .prepare(
            "SELECT * FROM thread_events WHERE thread_id = ? AND event_sequence < ? ORDER BY event_sequence DESC LIMIT ?",
          )
          .all(threadId, beforeSequence, cap) as ThreadEvent[])
      : (this.db
          .prepare(
            "SELECT * FROM thread_events WHERE thread_id = ? ORDER BY event_sequence DESC LIMIT ?",
          )
          .all(threadId, cap) as ThreadEvent[]);
    const oldest = rows.length > 0 ? rows[rows.length - 1].event_sequence : null;
    // Normalize the raw rows' payload_json string into an object so clients
    // can read message bodies without each consumer re-parsing.
    const messages: ThreadEvent[] = rows.reverse().map((row) => {
      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(String(row.payload_json)) as Record<string, unknown>;
      } catch {
        payload = {};
      }
      return { ...row, payload_json: payload };
    });
    return { room, messages, nextCursor: oldest !== null && oldest > 1 ? oldest : null };
  }

  appendMessage(roomId: string, body: string, idempotencyKey: string | null): ThreadEvent {
    const room = this.getRoom(roomId);
    if (room.state === RoomState.Ended) throw new AppError(ErrorCode.ROOM_ENDED, "Room has ended.");
    if (!body?.trim()) throw new AppError(ErrorCode.INVALID_QUERY, "Message body is required.", "body");
    const threadId = this.threadIdFor(roomId, room.issue_id);

    if (idempotencyKey) {
      const recent = this.db
        .prepare(
          "SELECT * FROM thread_events WHERE thread_id = ? AND type = ? ORDER BY event_sequence DESC LIMIT 20",
        )
        .all(threadId, ThreadEventType.SessionMessage) as Array<{ id: string; payload_json: string }>;
      const replay = recent.find((event) => {
        const payload = JSON.parse(event.payload_json) as Record<string, unknown>;
        return payload?.client_request_id === idempotencyKey;
      });
      if (replay) return this.db.prepare("SELECT * FROM thread_events WHERE id = ?").get(replay.id) as ThreadEvent;
    }

    const event = this.threadEventService.write(threadId, ThreadEventType.SessionMessage, ActorType.User, null, {
      body: body.trim(),
      client_request_id: idempotencyKey,
    });
    this.threadEventService.broadcast(event);
    void this.eventCount(threadId);
    return event;
  }

  endRoom(roomId: string): Room {
    this.getRoom(roomId);
    this.db
      .prepare("UPDATE rooms SET state = 'ended', ended_at = ? WHERE id = ? AND state = 'active'")
      .run(new Date().toISOString(), roomId);
    return this.getRoom(roomId);
  }

  /** §4.1: ONE transaction — create the Issue, bind room + internal thread,
   *  reprioritize the room's dispatches, write session.converted. */
  convertToTask(roomId: string, input: { project_id?: string | null; goal: string }): { issueId: string; room: Room } {
    const room = this.getRoom(roomId);
    if (room.issue_id) {
      throw new AppError(ErrorCode.ROOM_ALREADY_TASK_BOUND, "Room is already bound to a task.");
    }
    if (!input.goal?.trim()) throw new AppError(ErrorCode.ISSUE_GOAL_REQUIRED, "Goal is required for conversion.", "goal");
    if (input.project_id) {
      const project = this.db
        .prepare("SELECT id, space_id, state FROM projects WHERE id = ?")
        .get(input.project_id) as { id: string; space_id: string; state: string } | undefined;
      if (!project) throw new AppError(ErrorCode.PROJECT_NOT_FOUND, "Project not found.");
      if (project.space_id !== room.space_id) {
        throw new AppError(ErrorCode.ISSUE_SPACE_MISMATCH, "Project belongs to a different Space.");
      }
    }

    const issueId = generateIssueId();
    const now = new Date().toISOString();
    let convertedEvent: ThreadEvent | null = null;
    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO issues (id, project_id, workspace_id, space_id, issue_type, workflow_template_id, validation_policy_id, title, goal, status, priority, validation_round_count, created_at, updated_at)
           VALUES (?, ?, NULL, ?, 'coding', NULL, NULL, ?, ?, 'Inbox', 'normal', 0, ?, ?)`,
        )
        .run(issueId, input.project_id ?? null, room.space_id, input.goal.trim().slice(0, 80), input.goal.trim(), now, now);
      this.db.prepare("UPDATE rooms SET issue_id = ? WHERE id = ?").run(issueId, roomId);
      this.db.prepare("UPDATE threads SET issue_id = ? WHERE room_id = ? AND issue_id IS NULL").run(issueId, roomId);
      // Prior dispatch facts follow the room to the new issue (§4.1).
      this.db.prepare("UPDATE dispatches SET issue_id = ? WHERE room_id = ? AND issue_id IS NULL").run(issueId, roomId);
      convertedEvent = this.threadEventService.write(
        this.threadIdFor(roomId, issueId),
        ThreadEventType.SessionConverted,
        ActorType.System,
        null,
        { room_id: roomId, issue_id: issueId },
      );
    });
    tx();
    if (convertedEvent) this.threadEventService.broadcast(convertedEvent);
    return { issueId, room: this.getRoom(roomId) };
  }
}
