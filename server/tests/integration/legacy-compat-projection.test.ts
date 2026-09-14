import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestServices, createTempDir, cleanupTempDir, disposeTestServices, type TestServices } from "../helpers.js";

// F013 AC-001 (design §8 legacy-compat-projection)：F013 放宽列但不切断 legacy 写——
// 升级后经 IssueService 创建带 Project 的任务仍写入三个 legacy 列且可进 v0.2 链；
// F013 之后新建 Project 绑 primary 仓库时自动 upsert legacy workspace 行；
// 游离任务三列为空且不进入该链路。

describe("F013 AC-001: legacy compat projection", () => {
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

  it("project-bound issue creation keeps writing the three legacy columns", () => {
    const project = services.projectService.create("Compat");
    services.workspaceService.bind(project.id, tempDir);

    const { issue } = services.issueService.create(project.id, { title: "T", goal: "G" });
    expect(issue.project_id).toBe(project.id);
    expect(issue.workspace_id).not.toBeNull();
    expect(issue.workflow_template_id).toBe("wft_coding_default");
    expect(issue.validation_policy_id).toBe("vpl_coding_default");
  });

  it("binding a primary repository on a NEW project upserts a legacy workspace row", () => {
    const project = services.projectService.create("Fresh");
    const repository = services.repositoryRegistry.create({ source: tempDir });
    // 绑定前提：本机授权已建立（机器路径携带 raw_path，workspace upsert 由此取值）。
    services.repositoryRegistry.authorizePath({
      repository_id: repository.id,
      raw_path: tempDir,
      access: "read_write",
    });
    services.repositoryRegistry.setProjectRepositories(project.id, () => {}, {
      primary: { repository_id: repository.id, access: "read_write" },
    });

    // (project_id, local_path_normalized) upsert 出一行 workspaces 并回填 default。
    const workspaces = services.db
      .prepare("SELECT id, project_id, local_path_normalized FROM workspaces WHERE project_id = ?")
      .all(project.id) as Array<{ id: string; project_id: string; local_path_normalized: string }>;
    expect(workspaces).toHaveLength(1);

    const refetched = services.projectService.getById(project.id)!;
    expect(refetched.default_workspace_id).toBe(workspaces[0].id);

    // primary 引用行携带 legacy_workspace_id，兼容投影由此可写。
    const ref = services.repositoryRegistry.getProjectRef(project.id, repository.id);
    expect(ref?.role).toBe("primary");
    expect(ref?.legacy_workspace_id).toBe(workspaces[0].id);
  });

  it("a NEW reference role always has NULL legacy_workspace_id", () => {
    const project = services.projectService.create("Fresh");
    const primaryRepo = services.repositoryRegistry.create({ source: tempDir });
    services.repositoryRegistry.setProjectRepositories(project.id, () => {}, {
      primary: { repository_id: primaryRepo.id, access: "read_write" },
    });

    const otherDir = createTempDir();
    try {
      const refRepo = services.repositoryRegistry.create({ source: otherDir });
      // 同一路径在同一项目内只能有一行引用（PK 冲突保护）；换新路径。
      const refDir = createTempDir();
      try {
        const secondRepo = services.repositoryRegistry.create({ source: refDir });
        services.repositoryRegistry.setProjectRepositories(project.id, () => {}, {
          references: [{ repository_id: secondRepo.id }],
        });
        const ref = services.repositoryRegistry.getProjectRef(project.id, secondRepo.id);
        expect(ref?.role).toBe("reference");
        expect(ref?.access).toBe("read_only");
        expect(ref?.legacy_workspace_id).toBeNull();
      } finally {
        cleanupTempDir(refDir);
      }
      void refRepo;
    } finally {
      cleanupTempDir(otherDir);
    }
  });

  it("rebinding the primary re-points the projection at the new workspace row", () => {
    const project = services.projectService.create("Rebind");
    const first = services.repositoryRegistry.create({ source: tempDir });
    services.repositoryRegistry.authorizePath({ repository_id: first.id, raw_path: tempDir, access: "read_write" });
    services.repositoryRegistry.setProjectRepositories(project.id, () => {}, {
      primary: { repository_id: first.id, access: "read_write" },
    });
    const firstWs = services.projectService.getById(project.id)!.default_workspace_id;

    const secondDir = createTempDir();
    try {
      const second = services.repositoryRegistry.create({ source: secondDir });
      services.repositoryRegistry.authorizePath({ repository_id: second.id, raw_path: secondDir, access: "read_write" });
      services.repositoryRegistry.setProjectRepositories(project.id, () => {}, {
        primary: { repository_id: second.id, access: "read_write" },
      });
      const rebound = services.projectService.getById(project.id)!;
      expect(rebound.default_workspace_id).not.toBeNull();
      expect(rebound.default_workspace_id).not.toBe(firstWs);
    } finally {
      cleanupTempDir(secondDir);
    }
  });

  it("free-floating issues stay out of the v0.2 chain via the narrowing guard", async () => {
    const { requireLegacyWorkspaceId } = await import("../../src/services/legacy-issue-fields.js");
    const spaceId = services.spaceService.getSelected()!.id;
    const { issue } = services.issueService.create(null, { title: "游离", goal: "G", space_id: spaceId });

    expect(() => requireLegacyWorkspaceId(issue)).toThrow(/free-floating/);
  });

  it("rejected: reference role with read_write is blocked by the database CHECK", () => {
    const project = services.projectService.create("CheckTest");
    const repo = services.repositoryRegistry.create({ source: tempDir });
    services.repositoryRegistry.setProjectRepositories(project.id, () => {}, {
      primary: { repository_id: repo.id, access: "read_write" },
    });

    // 直接写库绕过应用层：CHECK (role = 'reference' → access = read_only) 必须挡下。
    expect(() =>
      services.db
        .prepare(
          "INSERT INTO project_repository_refs (project_id, repository_id, role, access, scope_json, legacy_workspace_id, created_at, updated_at) VALUES (?, ?, 'reference', 'read_write', NULL, NULL, ?, ?)",
        )
        .run(project.id, repo.id, new Date().toISOString(), new Date().toISOString()),
    ).toThrow(/CHECK|read_only/i);
  });
});
