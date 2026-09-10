import { describe, expect, it } from "vitest";
import { TaskDraftStore, taskComposerKey } from "@/app/task-draft-store";

// T004 (UX-002/UX-004): draft identity and cleanup semantics. Every cleanup
// path below is the contract from design.md §5 — including the mutations that
// would break it (resetting the generation high-water, comparing revision
// without generation, clearing on any success response).

function storeWithDraft(
  key: string,
  text = "初始草稿",
): { store: TaskDraftStore; generation: number; revision: number } {
  const store = new TaskDraftStore();
  store.edit(key, { text });
  const record = store.record(key)!;
  return { store, generation: record.generation, revision: record.revision };
}

describe("TaskDraftStore keys", () => {
  it("names composer keys by task id without thread identity", () => {
    expect(taskComposerKey("iss_1")).toBe("task:iss_1:composer");
  });
});

describe("draft lifecycle across tasks / projects / surfaces", () => {
  it("keeps each task's draft while editing other keys, then restores it", () => {
    const store = new TaskDraftStore();
    store.edit("task:iss_1:composer", { text: "任务一的草稿" });
    store.edit("task:iss_2:composer", { text: "任务二的草稿" });

    expect(store.text("task:iss_1:composer")).toBe("任务一的草稿");
    expect(store.text("task:iss_2:composer")).toBe("任务二的草稿");

    // Editing task 2 does not disturb task 1's record (page-level round trip).
    store.edit("task:iss_2:composer", { text: "任务二的草稿（补充）" });
    expect(store.text("task:iss_1:composer")).toBe("任务一的草稿");
    expect(store.text("task:iss_2:composer")).toBe("任务二的草稿（补充）");
  });

  it("assigns independent generations per key", () => {
    const store = new TaskDraftStore();
    store.edit("task:iss_1:composer", { text: "a" });
    store.edit("task:iss_2:composer", { text: "b" });
    const first = store.record("task:iss_1:composer")!;
    const second = store.record("task:iss_2:composer")!;
    expect(first.generation).toBe(1);
    expect(second.generation).toBe(1);
  });
});

describe("generation / revision contract", () => {
  it("starts a new record one above the key's high-water and revision at 1", () => {
    const store = new TaskDraftStore();
    store.edit("task:iss_1:composer", { text: "v1" });
    expect(store.record("task:iss_1:composer")).toMatchObject({ generation: 1, revision: 1 });
    store.edit("task:iss_1:composer", { text: "v2" });
    expect(store.record("task:iss_1:composer")).toMatchObject({ generation: 1, revision: 2 });
  });

  it("advances the revision only when something actually changes", () => {
    const { store, revision } = storeWithDraft("task:iss_1:composer");
    store.edit("task:iss_1:composer", { text: "初始草稿" });
    expect(store.record("task:iss_1:composer")!.revision).toBe(revision);
    store.edit("task:iss_1:composer", { text: "改动后的草稿" });
    expect(store.record("task:iss_1:composer")!.revision).toBe(revision + 1);
  });
});

describe("submit resolution", () => {
  it("clears only when key, generation and revision all match", () => {
    const key = "task:iss_1:composer";
    const { store } = storeWithDraft(key, "要提交的指令");
    store.edit(key, { text: "要提交的指令（修订）" });
    const ticket = store.beginSubmit(key)!;
    expect(store.resolveSubmit(ticket, "success")).toBe(true);
    expect(store.record(key)).toBeNull();
  });

  it("keeps the record on failure", () => {
    const key = "task:iss_1:composer";
    const { store } = storeWithDraft(key);
    const ticket = store.beginSubmit(key)!;
    expect(store.resolveSubmit(ticket, "failure")).toBe(false);
    expect(store.text(key)).toBe("初始草稿");
  });

  it("ignores a late success captured before further edits", () => {
    const key = "task:iss_1:composer";
    const { store } = storeWithDraft(key);
    const staleTicket = store.beginSubmit(key)!;
    store.edit(key, { text: "提交期间继续输入的新草稿" });
    expect(store.resolveSubmit(staleTicket, "success")).toBe(false);
    expect(store.text(key)).toBe("提交期间继续输入的新草稿");
  });

  it("compares generation and never revision alone", () => {
    const key = "task:iss_1:composer";
    const { store, generation, revision } = storeWithDraft(key);
    // Same revision number, different generation — must not clear.
    store.resolveSubmit({ key, generation, revision }, "success");
    store.discard(key);
    store.edit(key, { text: "重新输入的草稿" });
    const regenerated = store.record(key)!;
    expect(regenerated.generation).toBe(generation + 1);
    expect(regenerated.revision).toBe(1);
    expect(store.resolveSubmit({ key, generation, revision }, "success")).toBe(false);
    expect(store.text(key)).toBe("重新输入的草稿");
  });
});

describe("submit N → discard while pending → retype → old success", () => {
  it("makes the old request's response a no-op in both outcomes", () => {
    const key = "task:iss_1:composer";
    const store = new TaskDraftStore();
    store.edit(key, { text: "第 N 版指令" });
    const pending = store.beginSubmit(key)!;

    // Explicit discard stays allowed while the submit is pending.
    store.discard(key);
    expect(store.record(key)).toBeNull();

    // Retyping must start a strictly larger generation — the high-water was
    // not rolled back by the discard.
    store.edit(key, { text: "丢弃后重新输入" });
    const regenerated = store.record(key)!;
    expect(regenerated.generation).toBeGreaterThan(pending.generation);

    expect(store.resolveSubmit(pending, "success")).toBe(false);
    expect(store.text(key)).toBe("丢弃后重新输入");
    expect(store.resolveSubmit(pending, "failure")).toBe(false);
    expect(store.text(key)).toBe("丢弃后重新输入");
  });

  it("never resets the generation high-water on any clear path", () => {
    const key = "task:iss_1:composer";
    const { store, generation } = storeWithDraft(key);

    store.objectMissing(key);
    expect(store.record(key)).toBeNull();
    store.edit(key, { text: "对象消失后重写" });
    expect(store.record(key)!.generation).toBe(generation + 1);

    const ticket = store.beginSubmit(key)!;
    store.resolveSubmit(ticket, "success");
    store.edit(key, { text: "成功清除后重写" });
    expect(store.record(key)!.generation).toBe(generation + 2);
  });
});

describe("object missing", () => {
  it("clears the record and keeps other tasks' drafts", () => {
    const store = new TaskDraftStore();
    store.edit("task:iss_1:composer", { text: "a" });
    store.edit("task:iss_2:composer", { text: "b" });
    store.objectMissing("task:iss_1:composer");
    expect(store.record("task:iss_1:composer")).toBeNull();
    expect(store.text("task:iss_2:composer")).toBe("b");
  });
});

describe("pending-draft reporting", () => {
  it("reports pending only for non-empty text", () => {
    const store = new TaskDraftStore();
    expect(store.hasPendingDraft()).toBe(false);
    store.edit("task:iss_1:composer", { text: "未提交" });
    store.edit("task:iss_2:composer", { text: "   " });
    expect(store.hasPendingDraft()).toBe(true);
    store.resolveSubmit(store.beginSubmit("task:iss_1:composer")!, "success");
    expect(store.hasPendingDraft()).toBe(false);
  });

  it("notifies subscribers so the shell can manage the beforeunload hint", () => {
    const store = new TaskDraftStore();
    let versions = 0;
    const unsubscribe = store.subscribe(() => {
      versions += 1;
    });
    store.edit("task:iss_1:composer", { text: "x" });
    store.discard("task:iss_1:composer");
    expect(versions).toBeGreaterThanOrEqual(2);
    unsubscribe();
  });
});
