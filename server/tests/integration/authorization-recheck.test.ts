import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { symlink } from "node:fs/promises";
import { createTestServices, createTempDir, cleanupTempDir, disposeTestServices, type TestServices } from "../helpers.js";

// F013 AC-002 (design §8 authorization-recheck)：verifyAuthorization 每次当场
// 重做 realpath + identity 比对 + 三层 scope 交集——授权后被换靶的 symlink、
// 删除后同名重建的目录都必须被拒；成功复核更新 last_verified_at。

describe("F013 AC-002: authorization recheck", () => {
  let services: TestServices;
  let tempDir: string;
  let repoRoot: string;
  let realDir: string;

  beforeEach(() => {
    services = createTestServices();
    tempDir = createTempDir();
    realDir = path.join(tempDir, "real-repo");
    fs.mkdirSync(realDir, { recursive: true });
    fs.writeFileSync(path.join(realDir, "file.txt"), "content");
    repoRoot = path.join(tempDir, "link-repo");
    symlinkSyncOrSkip(realDir, repoRoot);
  });

  afterEach(() => {
    disposeTestServices(services);
    cleanupTempDir(tempDir);
  });

  function symlinkSyncOrSkip(target: string, linkPath: string): void {
    // WSL/容器环境一般支持目录 symlink；不支持的平台直接跳过该用例。
    fs.symlinkSync(target, linkPath, "dir");
  }

  function authorizeAndBind(): { repositoryId: string; projectId: string } {
    const project = services.projectService.create("Auth project");
    const repository = services.repositoryRegistry.create({ source: repoRoot });
    services.repositoryRegistry.authorizePath({
      repository_id: repository.id,
      raw_path: repoRoot,
      access: "read_write",
    });
    services.repositoryRegistry.setProjectRepositories(project.id, () => {}, {
      primary: { repository_id: repository.id, access: "read_write" },
    });
    return { repositoryId: repository.id, projectId: project.id };
  }

  it("authorizes and verifies a symlinked path, returning the real path", () => {
    const { repositoryId, projectId } = authorizeAndBind();
    const result = services.repositoryRegistry.verifyAuthorization({ repository_id: repositoryId, project_id: projectId });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.real_path).toBe(fs.realpathSync(realDir));
      expect(result.access).toBe("read_write");
      expect(result.verified_at).toBeTruthy();
    }
  });

  it("rejects with REPO_IDENTITY_CHANGED when the symlink is re-targeted after authorization", () => {
    const { repositoryId, projectId } = authorizeAndBind();

    // 换靶：link 指向另一个目录（路径字符串不变，目标变了）。
    const other = path.join(tempDir, "other-repo");
    fs.mkdirSync(other, { recursive: true });
    fs.rmSync(repoRoot);
    fs.symlinkSync(other, repoRoot, "dir");

    const result = services.repositoryRegistry.verifyAuthorization({ repository_id: repositoryId, project_id: projectId });
    expect(result).toEqual({ ok: false, reason: "REPO_IDENTITY_CHANGED" });
  });

  it("rejects with REPO_IDENTITY_CHANGED when the directory is deleted and recreated", () => {
    const { repositoryId, projectId } = authorizeAndBind();

    // 同名重建：link 指向一个全新目录（新 inode），路径字符串不变。
    const rebuilt = path.join(tempDir, "rebuilt-repo");
    fs.mkdirSync(rebuilt, { recursive: true });
    fs.writeFileSync(path.join(rebuilt, "new"), "");
    fs.rmSync(repoRoot);
    fs.symlinkSync(rebuilt, repoRoot, "dir");

    const result = services.repositoryRegistry.verifyAuthorization({ repository_id: repositoryId, project_id: projectId });
    expect(result).toEqual({ ok: false, reason: "REPO_IDENTITY_CHANGED" });
  });

  it("rejects with REPO_PATH_UNRESOLVED when the path disappears", () => {
    const { repositoryId, projectId } = authorizeAndBind();
    fs.rmSync(repoRoot, { recursive: true, force: true });
    fs.rmSync(realDir, { recursive: true, force: true });

    const result = services.repositoryRegistry.verifyAuthorization({ repository_id: repositoryId, project_id: projectId });
    expect(result).toEqual({ ok: false, reason: "REPO_PATH_UNRESOLVED" });
  });

  it("rejects with REPO_NOT_AUTHORIZED when no project reference exists", () => {
    const project = services.projectService.create("No ref");
    const repository = services.repositoryRegistry.create({ source: repoRoot });
    services.repositoryRegistry.authorizePath({ repository_id: repository.id, raw_path: repoRoot, access: "read_write" });

    const result = services.repositoryRegistry.verifyAuthorization({ repository_id: repository.id, project_id: project.id });
    expect(result).toEqual({ ok: false, reason: "REPO_NOT_AUTHORIZED" });
  });

  it("intersects machine ∩ project ∩ task scopes and empties write when a layer denies", () => {
    const { repositoryId, projectId } = authorizeAndBind();
    // 项目级收紧到 src；任务级再收紧到 src/lib。
    services.repositoryRegistry.setProjectRepositories(services.projectService.getById(projectId)!.id, () => {}, {
      primary: { repository_id: repositoryId, access: "read_write", scope: { read: ["src"], write: ["src"] } },
    });

    const narrowed = services.repositoryRegistry.verifyAuthorization({
      repository_id: repositoryId,
      project_id: projectId,
      task_scope: { read: ["src/lib"], write: ["src/lib"] },
    });
    expect(narrowed.ok).toBe(true);
    if (narrowed.ok) {
      expect(narrowed.effective_scope).toEqual({ read: ["src/lib"], write: ["src/lib"] });
    }

    const denied = services.repositoryRegistry.verifyAuthorization({
      repository_id: repositoryId,
      project_id: projectId,
      task_scope: { read: ["src/lib"], write: [] },
    });
    expect(denied.ok).toBe(true);
    if (denied.ok) {
      expect(denied.effective_scope.write).toEqual([]); // 某层 write 为空 → 结果 write 为空
      expect(denied.effective_scope.read).toEqual(["src/lib"]);
    }
  });

  it("updates last_verified_at on a successful recheck", () => {
    const { repositoryId, projectId } = authorizeAndBind();
    const before = services.repositoryRegistry.getMachinePath(repositoryId, "local")?.last_verified_at;
    services.repositoryRegistry.verifyAuthorization({ repository_id: repositoryId, project_id: projectId });
    const after = services.repositoryRegistry.getMachinePath(repositoryId, "local")?.last_verified_at;
    expect(after).not.toBeNull();
    expect(after).not.toBe(before);
  });
});
