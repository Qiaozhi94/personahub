import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestServices, createTempDir, cleanupTempDir, disposeTestServices, type TestServices } from "../helpers.js";
import { mkdirSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";

describe("Workspace Binding Integration", () => {
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

  it("full flow: create project, bind git workspace, verify relationship", () => {
    const project = services.projectService.create("My Project");
    const gitDir = join(tempDir, "gitrepo");
    mkdirSync(gitDir);
    execSync("git init -b main", { cwd: gitDir, stdio: "pipe" });
    execSync('git -c user.email=test@test.com -c user.name=Test commit --allow-empty -m init', { cwd: gitDir, stdio: "pipe" });

    const ws = services.workspaceService.bind(project.id, gitDir);

    expect(ws.project_id).toBe(project.id);
    expect(ws.local_path).toBe(gitDir);
    expect(ws.git_branch).not.toBeNull();
    expect(ws.lock_state).toBe("idle");

    const fetched = services.projectService.get(project.id);
    expect(fetched.default_workspace_id).toBe(ws.id);
    expect(fetched.default_workspace!.local_path).toBe(gitDir);
    expect(fetched.default_workspace!.git_branch).not.toBeNull();
  });

  it("non-git directory: binding succeeds with null git_branch", () => {
    const project = services.projectService.create("Test");
    const nonGitDir = join(tempDir, "plain");
    mkdirSync(nonGitDir);

    const ws = services.workspaceService.bind(project.id, nonGitDir);
    expect(ws.git_branch).toBeNull();
  });

  it("equivalent path reuse: binding same path twice reuses workspace", () => {
    const project = services.projectService.create("Test");
    const dir = join(tempDir, "workspace");
    mkdirSync(dir);

    const ws1 = services.workspaceService.bind(project.id, dir);
    const ws2 = services.workspaceService.bind(project.id, dir);

    expect(ws2.id).toBe(ws1.id);

    const allWorkspaces = services.db.prepare("SELECT COUNT(*) as count FROM workspaces WHERE project_id = ?").get(project.id) as { count: number };
    expect(allWorkspaces.count).toBe(1);
  });

  it("replace default workspace: old workspace preserved, project points to new", () => {
    const project = services.projectService.create("Test");
    const dir1 = join(tempDir, "dir1");
    const dir2 = join(tempDir, "dir2");
    mkdirSync(dir1);
    mkdirSync(dir2);

    const ws1 = services.workspaceService.bind(project.id, dir1);
    const ws2 = services.workspaceService.bind(project.id, dir2);

    expect(ws2.id).not.toBe(ws1.id);

    const fetched = services.projectService.get(project.id);
    expect(fetched.default_workspace_id).toBe(ws2.id);

    const oldWs = services.workspaceService.getById(ws1.id);
    expect(oldWs.local_path).toBe(dir1);
  });

  it("historical workspace accessible by id after replacement", () => {
    const project = services.projectService.create("Test");
    const dir1 = join(tempDir, "old");
    const dir2 = join(tempDir, "new");
    mkdirSync(dir1);
    mkdirSync(dir2);

    const ws1 = services.workspaceService.bind(project.id, dir1);
    services.workspaceService.bind(project.id, dir2);

    const historical = services.workspaceService.getById(ws1.id);
    expect(historical.id).toBe(ws1.id);
    expect(historical.local_path).toBe(dir1);
  });

  it("issue created before replacement references old workspace", () => {
    const project = services.projectService.create("Test");
    const dir1 = join(tempDir, "dir1");
    const dir2 = join(tempDir, "dir2");
    mkdirSync(dir1);
    mkdirSync(dir2);

    const ws1 = services.workspaceService.bind(project.id, dir1);
    const issue = services.issueService.create(project.id, {
      title: "Test Issue",
      goal: "Test goal",
    });

    services.workspaceService.bind(project.id, dir2);

    const fetched = services.issueService.get(issue.issue.id);
    expect(fetched.workspace_id).toBe(ws1.id);
  });
});
