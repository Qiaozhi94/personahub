// TaskDraftStore (design.md §5): the ApplicationShell owns this store, above
// the route outlet, so switching task / project / surface (or, later, the four
// task views) never unmounts it away. In-memory only — a browser refresh never
// restores a draft, nothing is written to localStorage / sessionStorage / the
// server, and the shell registers a native beforeunload prompt while any
// non-empty draft exists.
//
// Identity model: `generation` is the shell-lifetime generation of one key's
// draft. Creating a new draft record for a key assigns a value greater than
// that key's high-water mark; clearing the record never resets the high-water.
// `revision` increases monotonically inside one generation only and can never
// be compared across generations. A submit captures key + generation +
// revision; only a success response matching all three may clear the record.

export const TASK_COMPOSER_KEY_PREFIX = "task:";

export function taskComposerKey(taskId: string): string {
  return `task:${taskId}:composer`;
}

export interface DraftRecord {
  text: string;
  adapterId: string | null;
  explicitConsult: boolean;
  generation: number;
  revision: number;
}

export interface SubmitTicket {
  key: string;
  generation: number;
  revision: number;
}

export interface DraftEdit {
  text: string;
  adapterId?: string | null;
  explicitConsult?: boolean;
}

type Listener = () => void;

interface StoreSnapshot {
  version: number;
  records: ReadonlyMap<string, DraftRecord>;
}

export class TaskDraftStore {
  private records = new Map<string, DraftRecord>();
  private generationHighWater = new Map<string, number>();
  private listeners = new Set<Listener>();
  private snapshot: StoreSnapshot = { version: 0, records: this.records };

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): StoreSnapshot => this.snapshot;

  /** Draft text for a key, or "" when none exists (controlled-input friendly). */
  text(key: string): string {
    return this.records.get(key)?.text ?? "";
  }

  record(key: string): DraftRecord | null {
    return this.records.get(key) ?? null;
  }

  /** Editing a key with no record starts a new generation above the high-water. */
  edit(key: string, edit: DraftEdit): void {
    const existing = this.records.get(key);
    if (!existing) {
      const generation = (this.generationHighWater.get(key) ?? 0) + 1;
      this.generationHighWater.set(key, generation);
      this.replace(key, {
        text: edit.text,
        adapterId: edit.adapterId ?? null,
        explicitConsult: edit.explicitConsult ?? false,
        generation,
        revision: 1,
      });
      return;
    }

    const changed =
      edit.text !== existing.text ||
      (edit.adapterId !== undefined && edit.adapterId !== existing.adapterId) ||
      (edit.explicitConsult !== undefined && edit.explicitConsult !== existing.explicitConsult);
    if (!changed) return;

    this.replace(key, {
      ...existing,
      text: edit.text,
      adapterId: edit.adapterId !== undefined ? edit.adapterId : existing.adapterId,
      explicitConsult: edit.explicitConsult !== undefined ? edit.explicitConsult : existing.explicitConsult,
      revision: existing.revision + 1,
    });
  }

  /** Captures the identity a success must match to clear the record. */
  beginSubmit(key: string): SubmitTicket | null {
    const record = this.records.get(key);
    if (!record) return null;
    return { key, generation: record.generation, revision: record.revision };
  }

  /** Success clears only the exact (key, generation, revision) submitted;
   *  failures keep the record and the user's selection. */
  resolveSubmit(ticket: SubmitTicket, outcome: "success" | "failure"): boolean {
    if (outcome === "failure") return false;
    const record = this.records.get(ticket.key);
    if (!record) return false;
    if (
      record.generation !== ticket.generation ||
      record.revision !== ticket.revision
    ) {
      // A late response for a superseded draft: no-op by contract.
      return false;
    }
    this.remove(ticket.key);
    return true;
  }

  /** Explicit discard stays allowed while a submit is pending; it removes the
   *  record and the refresh prompt but neither cancels the request nor rolls
   *  back the generation high-water. Retyping starts a larger generation, so
   *  the old request's eventual response can only be a no-op. */
  discard(key: string): void {
    this.remove(key);
  }

  /** Object not-found / deleted: clear the record, keep the high-water. */
  objectMissing(key: string): void {
    this.remove(key);
  }

  /** True while any draft holds non-empty text — drives the beforeunload hint. */
  hasPendingDraft(): boolean {
    for (const record of this.records.values()) {
      if (record.text.trim() !== "") return true;
    }
    return false;
  }

  private remove(key: string): void {
    if (!this.records.delete(key)) return;
    this.snapshot = { version: this.snapshot.version + 1, records: new Map(this.records) };
    this.emit();
  }

  private replace(key: string, record: DraftRecord): void {
    this.records.set(key, record);
    this.snapshot = { version: this.snapshot.version + 1, records: new Map(this.records) };
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}
