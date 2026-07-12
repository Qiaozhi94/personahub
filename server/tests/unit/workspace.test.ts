import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestServices, createTempDir, cleanupTempDir, disposeTestServices, type TestServices } from "../helpers.js";
import { AppError } from "../../src/api/errors.js";
import { ErrorCode } from "@personahub/shared/errors";
import { WorkspaceLockState } from "@personahub/shared/types";
import { mkdirSync, writeFileSync, chmodSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";

describe("WorkspaceService", () => {
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

  describe("bind - validation", () => {
    it("rejects empty path", () => {
      const project = services.projectService.create("Test");
      expect(() => services.workspaceService.bind(project.id, "")).toThrowError(
        expect.objectContaining({ code: ErrorCode.WORKSPACE_PATH_REQUIRED }),
      );
    });

    it("rejects whitespace-only path", () => {
      const project = services.projectService.create("Test");
      expect(() => services.workspaceService.bind(project.id, "   ")).toThrowError(
        expect.objectContaining({ code: ErrorCode.WORKSPACE_PATH_REQUIRED }),
      );
    });

    it("rejects non-existent path", () => {
      const project = services.projectService.create("Test");
      const fakePath = join(tempDir, "does-not-exist");
      expect(() => services.workspaceService.bind(project.id, fakePath)).toThrowError(
        expect.objectContaining({ code: ErrorCode.WORKSPACE_PATH_NOT_FOUND }),
      );
    });

    it("rejects unknown project", () => {
      expect(() => services.workspaceService.bind("prj_unknown", tempDir)).toThrowError(
        expect.objectContaining({ code: ErrorCode.PROJECT_NOT_FOUND }),
      );
    });
  });

  describe("bind - success", () => {
    it("creates workspace and sets as default", () => {
      const project = services.projectService.create("Test");
      const ws = services.workspaceService.bind(project.id, tempDir);

      expect(ws.id).toMatch(/^wsp_/);
      expect(ws.project_id).toBe(project.id);
      expect(ws.local_path).toBe(tempDir);
      expect(ws.lock_state).toBe(WorkspaceLockState.Idle);
      expect(ws.locked_by_run_id).toBeNull();

      const updated = services.projectService.get(project.id);
      expect(updated.default_workspace_id).toBe(ws.id);
      expect(updated.default_workspace).not.toBeNull();
      expect(updated.default_workspace!.local_path).toBe(tempDir);
    });

    it("detects git branch for git repository", () => {
      const project = services.projectService.create("Test");
      const gitDir = join(tempDir, "gitrepo");
      mkdirSync(gitDir);
      execSync("git init -b main", { cwd: gitDir, stdio: "pipe" });
      execSync('git -c user.email=test@test.com -c user.name=Test commit --allow-empty -m init', { cwd: gitDir, stdio: "pipe" });

      const ws = services.workspaceService.bind(project.id, gitDir);
      expect(ws.git_branch).not.toBeNull();
    });

    it("sets git_branch to null for non-git directory", () => {
      const project = services.projectService.create("Test");
      const nonGitDir = join(tempDir, "notgit");
      mkdirSync(nonGitDir);

      const ws = services.workspaceService.bind(project.id, nonGitDir);
      expect(ws.git_branch).toBeNull();
    });
  });

  describe("bind - path normalization and reuse", () => {
    it("reuses existing workspace for same path", () => {
      const project = services.projectService.create("Test");
      const ws1 = services.workspaceService.bind(project.id, tempDir);
      const ws2 = services.workspaceService.bind(project.id, tempDir);

      expect(ws2.id).toBe(ws1.id);
    });

    it("reuses workspace for same path with different casing (Windows)", () => {
      const project = services.projectService.create("Test");
      const ws1 = services.workspaceService.bind(project.id, tempDir);

      const casedPath = process.platform === "win32"
        ? tempDir.toUpperCase()
        : tempDir;
      const ws2 = services.workspaceService.bind(project.id, casedPath);

      expect(ws2.id).toBe(ws1.id);

      const count = services.db.prepare("SELECT COUNT(*) as c FROM workspaces WHERE project_id = ?").get(project.id) as { c: number };
      expect(count.c).toBe(1);
    });

    it("creates new workspace for different path", () => {
      const project = services.projectService.create("Test");
      const dir1 = join(tempDir, "dir1");
      const dir2 = join(tempDir, "dir2");
      mkdirSync(dir1);
      mkdirSync(dir2);

      const ws1 = services.workspaceService.bind(project.id, dir1);
      const ws2 = services.workspaceService.bind(project.id, dir2);

      expect(ws2.id).not.toBe(ws1.id);
      expect(ws2.local_path).toBe(dir2);

      const updated = services.projectService.get(project.id);
      expect(updated.default_workspace_id).toBe(ws2.id);
    });

    it("preserves old workspace when replacing default", () => {
      const project = services.projectService.create("Test");
      const dir1 = join(tempDir, "dir1");
      const dir2 = join(tempDir, "dir2");
      mkdirSync(dir1);
      mkdirSync(dir2);

      const ws1 = services.workspaceService.bind(project.id, dir1);
      services.workspaceService.bind(project.id, dir2);

      const oldWs = services.workspaceService.getById(ws1.id);
      expect(oldWs.id).toBe(ws1.id);
      expect(oldWs.local_path).toBe(dir1);
    });
  });

  describe("get", () => {
    it("returns null when project has no workspace", () => {
      const project = services.projectService.create("Test");
      const ws = services.workspaceService.get(project.id);
      expect(ws).toBeNull();
    });

    it("returns workspace when bound", () => {
      const project = services.projectService.create("Test");
      services.workspaceService.bind(project.id, tempDir);
      const ws = services.workspaceService.get(project.id);
      expect(ws).not.toBeNull();
      expect(ws!.local_path).toBe(tempDir);
    });
  });

  describe("getById", () => {
    it("throws WORKSPACE_NOT_FOUND for unknown id", () => {
      expect(() => services.workspaceService.getById("wsp_unknown")).toThrowError(
        expect.objectContaining({ code: ErrorCode.WORKSPACE_NOT_FOUND }),
      );
    });

    it("returns workspace by id", () => {
      const project = services.projectService.create("Test");
      const bound = services.workspaceService.bind(project.id, tempDir);
      const ws = services.workspaceService.getById(bound.id);
      expect(ws.id).toBe(bound.id);
    });
  });
});
