import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestServices, disposeTestServices, type TestServices } from "../helpers.js";
import { AppError } from "../../src/api/errors.js";
import { ErrorCode } from "@personahub/shared/errors";

// F013 AC-001 (design §8): 首次设置旅程——清洁库创建 Space 后立即可创建游离任务；
// 选中态存在服务端（重启后不变）；默认 Space 永不可归档；按 ID 深链跨 Space 不 404。

describe("F013 AC-001: first-run Space journey", () => {
  let services: TestServices;

  beforeEach(() => {
    services = createTestServices();
  });

  afterEach(() => {
    disposeTestServices(services);
  });

  it("first created space is both default and selected; later ones are neither", () => {
    const first = services.spaceService.list()[0];
    // 迁移已建默认 Space：它是首个，也必须是 default + selected。
    expect(first.is_default).toBe(true);
    expect(first.is_selected).toBe(true);

    const second = services.spaceService.create("Second");
    expect(second.is_default).toBe(false);
    expect(second.is_selected).toBe(false);
  });

  it("free-floating issues land in the selected space right after first run", () => {
    const selected = services.spaceService.getSelected()!;
    const result = services.issueService.create(null, {
      title: "首次任务",
      goal: "清洁库即可用",
      space_id: selected.id,
    });
    expect(result.issue.space_id).toBe(selected.id);
  });

  it("selection is server state: it survives a full service restart", () => {
    const target = services.spaceService.create("Workspace B");
    services.spaceService.select(target.id);

    // 模拟重启：同一 DB 上重建整套服务。
    const db = services.db;
    const restarted = createTestServices(db);
    try {
      expect(restarted.spaceService.getSelected()?.id).toBe(target.id);
    } finally {
      disposeTestServices(restarted);
    }
  });

  it("blocks archiving the default space (SPACE_ARCHIVE_BLOCKED)", () => {
    const defaultSpace = services.spaceService.list().find((s) => s.is_default)!;
    try {
      services.spaceService.archive(defaultSpace.id);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe(ErrorCode.SPACE_ARCHIVE_BLOCKED);
    }
  });

  it("blocks archiving the currently selected space, allows after switching", () => {
    const target = services.spaceService.create("Later");
    services.spaceService.select(target.id);
    try {
      services.spaceService.archive(target.id);
      expect.unreachable();
    } catch (error) {
      expect((error as AppError).code).toBe(ErrorCode.SPACE_ARCHIVE_BLOCKED);
    }

    services.spaceService.select(services.spaceService.list().find((s) => s.is_default)!.id);
    const archived = services.spaceService.archive(target.id);
    expect(archived.state).toBe("archived");
  });

  it("deep-link by project id works across spaces (no 404) and the response carries space_id", () => {
    const other = services.spaceService.create("Other space");
    const projectInOther = services.projectService.create("Cross space", undefined, other.id);
    // 切走当前焦点后，按 ID 深链仍然可读（跨 Feature 不变量 8）。
    services.spaceService.select(services.spaceService.list().find((s) => s.is_default)!.id);

    const fetched = services.projectService.get(projectInOther.id);
    expect(fetched.id).toBe(projectInOther.id);
    expect(fetched.space_id).toBe(other.id);
  });

  it("default project list is scoped to the selected space; deep-link still resolves", () => {
    const other = services.spaceService.create("Other space");
    services.projectService.create("In default");
    const inOther = services.projectService.create("In other", undefined, other.id);
    services.spaceService.select(other.id);

    const listed = services.projectService.list();
    expect(listed.map((p) => p.id)).toEqual([inOther.id]);
  });

  it("restores an archived space without auto-selecting it", () => {
    const target = services.spaceService.create("Temp");
    services.spaceService.select(services.spaceService.list().find((s) => s.is_default)!.id);
    services.spaceService.archive(target.id);

    const restored = services.spaceService.restore(target.id);
    expect(restored.state).toBe("active");
    expect(restored.is_selected).toBe(false);
  });
});
