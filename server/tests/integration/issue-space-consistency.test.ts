import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestServices, createTempDir, cleanupTempDir, disposeTestServices, type TestServices } from "../helpers.js";
import { AppError } from "../../src/api/errors.js";
import { ErrorCode } from "@personahub/shared/errors";

// F013 AC-001 (design §8): issues.space_id / projects.space_id 一致性由数据库
// trigger 强制（INSERT 与 UPDATE 两条路径），游离任务创建契约在服务层强制。

describe("F013 AC-001: issue ↔ space consistency", () => {
  let services: TestServices;
  let tempDir: string;

  beforeEach(() => {
    services = createTestServices();
    tempDir = createTempDir();
  });

  afterEach(() => {
    disposeTestServices(services);
    cleanupTempDir(tempDir);
  });

  function defaultSpaceId(): string {
    return (services.db.prepare("SELECT id FROM spaces WHERE is_default = 1").get() as { id: string }).id;
  }

  function seedProjectWithWorkspace(): { projectId: string; workspaceId: string } {
    const project = services.projectService.create("Alpha");
    const workspace = services.workspaceService.bind(project.id, tempDir);
    return { projectId: project.id, workspaceId: workspace.id };
  }

  it("rejects INSERT with space_id differing from the project's space (ISSUE_SPACE_MISMATCH)", () => {
    const { projectId, workspaceId } = seedProjectWithWorkspace();
    const otherSpace = services.spaceService.create("Other");
    const now = new Date().toISOString();

    expect(() =>
      services.db
        .prepare(
          "INSERT INTO issues (id, space_id, project_id, workspace_id, issue_type, workflow_template_id, validation_policy_id, title, status, priority, labels, validation_round_count, created_at, updated_at) VALUES (?, ?, ?, ?, 'coding', 'wft_coding_default', 'vpl_coding_default', 'x', 'Inbox', 'normal', '[]', 0, ?, ?)",
        )
        .run("iss_bad", otherSpace.id, projectId, workspaceId, now, now),
    ).toThrow(/ISSUE_SPACE_MISMATCH/);
  });

  it("rejects UPDATE that rebinds an issue into another space (ISSUE_SPACE_MISMATCH)", () => {
    const { projectId } = seedProjectWithWorkspace();
    const result = services.issueService.create(projectId, { title: "T", goal: "G" });
    const otherSpace = services.spaceService.create("Other");

    expect(() =>
      services.db
        .prepare("UPDATE issues SET space_id = ? WHERE id = ?")
        .run(otherSpace.id, result.issue.id),
    ).toThrow(/ISSUE_SPACE_MISMATCH/);
  });

  it("requires space_id for free-floating issues instead of guessing the selected space", () => {
    try {
      services.issueService.create(null, { title: "T", goal: "G" });
      expect.unreachable("space_id missing must throw");
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe(ErrorCode.ISSUE_SPACE_REQUIRED);
    }
  });

  it("creates free-floating issues with explicit space_id and empty legacy columns", () => {
    const spaceId = defaultSpaceId();
    const result = services.issueService.create(null, { title: "游离", goal: "无项目任务", space_id: spaceId });

    expect(result.issue.space_id).toBe(spaceId);
    expect(result.issue.project_id).toBeNull();
    expect(result.issue.workspace_id).toBeNull();
    expect(result.issue.workflow_template_id).toBeNull();
    expect(result.issue.validation_policy_id).toBeNull();
    // 游离任务仍有 primary thread（会话面可用）。
    expect(result.issue.primary_thread_id).not.toBeNull();
  });

  it("rejects free-floating issues targeting an archived space", () => {
    const space = services.spaceService.create("Archive me");
    services.spaceService.select(defaultSpaceId());
    services.spaceService.archive(space.id);

    try {
      services.issueService.create(null, { title: "T", goal: "G", space_id: space.id });
      expect.unreachable();
    } catch (error) {
      expect((error as AppError).code).toBe(ErrorCode.SPACE_NOT_ACTIVE);
    }
  });

  it("project-bound issues inherit the project's space and keep the compat projection", () => {
    const { projectId } = seedProjectWithWorkspace();
    const result = services.issueService.create(projectId, { title: "T", goal: "G" });

    const project = services.projectService.getById(projectId)!;
    expect(result.issue.space_id).toBe(project.space_id);
    // 兼容投影：v0.2 执行链三列在 F012 接管前继续写入。
    expect(result.issue.project_id).toBe(projectId);
    expect(result.issue.workspace_id).not.toBeNull();
    expect(result.issue.workflow_template_id).toBe("wft_coding_default");
    expect(result.issue.validation_policy_id).toBe("vpl_coding_default");
  });

  it("rejects a mismatched explicit space_id on the project path", async () => {
    const { projectId } = seedProjectWithWorkspace();
    const otherSpace = services.spaceService.create("Other");

    try {
      services.issueService.create(projectId, { title: "T", goal: "G", space_id: otherSpace.id });
      expect.unreachable();
    } catch (error) {
      expect((error as AppError).code).toBe(ErrorCode.ISSUE_SPACE_MISMATCH);
    }
  });
});
