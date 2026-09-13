import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { createTestServices, createTempDir, cleanupTempDir, disposeTestServices, type TestServices } from "../helpers.js";
import { initGitRepo } from "../helpers.js";

// F013 AC-002 (design §8 git-identity)：identity（提交身份）实时从执行机器的
// git config 读取并带 read_at；repositories 表无 git_identity 列——身份属于
// 执行机器而非仓库，两台机器取值不同互不影响（design §3）。

describe("F013 AC-002: git identity probing", () => {
  let services: TestServices;
  let tempDir: string;
  let repoDir: string;

  beforeEach(() => {
    services = createTestServices();
    tempDir = createTempDir();
    repoDir = path.join(tempDir, "repo");
    fs.mkdirSync(repoDir, { recursive: true });
    initGitRepo(repoDir);
  });

  afterEach(() => {
    disposeTestServices(services);
    cleanupTempDir(tempDir);
  });

  function authorize(): string {
    const repository = services.repositoryRegistry.create({ source: repoDir });
    services.repositoryRegistry.authorizePath({
      repository_id: repository.id,
      raw_path: repoDir,
      access: "read_write",
    });
    return repository.id;
  }

  it("reads identity live from git config with read_at", async () => {
    const repositoryId = authorize();

    const identity = services.repositoryRegistry.probeGitIdentity(repositoryId);
    expect(identity.user_name).toBe("Test");
    expect(identity.user_email).toBe("test@test.com");
    expect(identity.read_at).toBeTruthy();

    // 改机器侧配置后再读：返回值跟着变（实时探测，不是授权时快照）。
    execSync('git config user.name "Someone Else"', { cwd: repoDir });
    const second = services.repositoryRegistry.probeGitIdentity(repositoryId);
    expect(second.user_name).toBe("Someone Else");
    expect(second.read_at >= identity.read_at).toBe(true);
  });

  it("repositories schema has no git_identity column", () => {
    const columns = (services.db.prepare("PRAGMA table_info(repositories)").all() as Array<{ name: string }>).map(
      (c) => c.name,
    );
    expect(columns).not.toContain("git_identity");
    expect(columns).toEqual(
      expect.arrayContaining(["id", "kind", "display_name", "git_remote_url", "created_at", "updated_at"]),
    );
  });

  it("probes the git remote at resolve time without persisting identity", () => {
    execSync("git remote add origin https://example.com/acme/rocket.git", { cwd: repoDir });

    const resolved = services.repositoryRegistry.resolve(repoDir);
    expect(resolved.kind).toBe("local_dir");
    expect(resolved.git_remote_url).toBe("https://example.com/acme/rocket.git");
    expect(resolved.display_name).toBe("repo");
    expect(resolved.authorizable).toBe(true);
  });
});
