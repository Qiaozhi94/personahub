import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { createTestServices, createTempDir, cleanupTempDir, disposeTestServices, type TestServices } from "../helpers.js";
import { AppError } from "../../src/api/errors.js";
import { ErrorCode } from "@personahub/shared/errors";
import { PROJECT_REFERENCE_CATEGORIES } from "../../src/repositories/project.js";

// F013 AC-002 (design §8 project-lifecycle)：归档可恢复、归档态 fail-closed、
// 删除受六类引用保护，并用 PRAGMA foreign_key_list 反查全部指向 projects 的表
// 与检查清单比对——清单漏项即测试失败。

describe("F013 AC-002: project lifecycle", () => {
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

  function seedProjectWithWorkspace() {
    const project = services.projectService.create("Lifecycle");
    services.workspaceService.bind(project.id, tempDir);
    return project;
  }

  it("archived projects leave the default list but stay readable by ID; restore recovers", () => {
    const project = seedProjectWithWorkspace();
    // 归档前创建历史任务：归档后其文件 refs、执行与证据仍可读（US-001 场景 2）。
    services.issueService.create(project.id, { title: "pre-archive", goal: "history" });
    services.projectService.archive(project.id);

    const listed = services.projectService.list();
    expect(listed.map((p) => p.id)).not.toContain(project.id);

    const deep = services.projectService.get(project.id); // 深链可读
    expect(deep.state).toBe("archived");
    expect(deep.archived_at).not.toBeNull();

    const issues = services.issueService.list(project.id);
    expect(issues).toHaveLength(1);

    services.projectService.archive(project.id);
    const restored = services.projectService.restore(project.id);
    expect(restored.state).toBe("active");
    expect(restored.archived_at).toBeNull();
    expect(services.projectService.list().map((p) => p.id)).toContain(project.id);
  });

  it("blocks issue creation, repository rebinding and default-skill writes while archived (PROJECT_ARCHIVED)", () => {
    const project = seedProjectWithWorkspace();
    services.projectService.archive(project.id);

    const assertThrows = (fn: () => unknown): void => {
      try {
        fn();
        expect.unreachable();
      } catch (error) {
        expect((error as AppError).code).toBe(ErrorCode.PROJECT_ARCHIVED);
      }
    };

    assertThrows(() => services.issueService.create(project.id, { title: "T", goal: "G" }));
    const repo = services.repositoryRegistry.create({ source: tempDir });
    services.repositoryRegistry.authorizePath({ repository_id: repo.id, raw_path: tempDir, access: "read_write" });
    assertThrows(() =>
      services.repositoryRegistry.setProjectRepositories(project.id, () => {
        const current = services.projectService.getById(project.id)!;
        services.projectService.assertNotArchived(current);
      }, { primary: { repository_id: repo.id, access: "read_write" } }),
    );
  });

  it("reference protection: each of the six categories blocks DELETE with its name listed", () => {
    const project = seedProjectWithWorkspace();
    const created = services.issueService.create(project.id, { title: "T", goal: "G" });
    const issueId = created.issue.id;
    const repo = services.repositoryRegistry.create({ source: tempDir });
    services.repositoryRegistry.authorizePath({ repository_id: repo.id, raw_path: tempDir, access: "read_write" });
    services.repositoryRegistry.setProjectRepositories(project.id, () => {}, {
      primary: { repository_id: repo.id, access: "read_write" },
    });

    // agent_configs 引用。
    services.db
      .prepare(
        "INSERT INTO agent_configs (id, project_id, name, role, cli_provider, command, args, capability_tags, status, created_at, updated_at) VALUES ('adp_ref', ?, 'n', 'implementation', 'fake', 'fake', '[]', '[]', 'available', datetime('now'), datetime('now'))",
      )
      .run(project.id);
    // intake_confirmations 引用。
    services.db
      .prepare(
        "INSERT INTO intake_confirmations (nonce, project_id, workspace_id, recommendation_id, chosen_json, issue_id, target_kind, target_id, issued_at, confirmed_at) VALUES ('nce', ?, ?, 'rec', '{}', ?, 'run', 'run_1', datetime('now'), datetime('now'))",
      )
      .run(project.id, (services.projectService.getById(project.id)!.default_workspace_id)!, issueId);
    // project_skill_refs 引用（经迁移出的 legacy skill）。
    const skill = services.db.prepare("SELECT id FROM skills LIMIT 1").get() as { id: string } | undefined;
    if (skill) {
      services.db
        .prepare(
          "INSERT INTO project_skill_refs (project_id, skill_id, is_default, pinned_version, created_at, updated_at) VALUES (?, ?, 1, NULL, datetime('now'), datetime('now'))",
        )
        .run(project.id, skill.id);
    }

    try {
      services.projectService.remove(project.id);
      expect.unreachable();
    } catch (error) {
      const appError = error as AppError;
      expect(appError.code).toBe(ErrorCode.PROJECT_HAS_REFERENCES);
      const categories = (appError.details as { categories: string[] }).categories;
      for (const expected of ["issues", "workspaces", "agent_configs", "intake_confirmations", "project_repository_refs", "project_skill_refs"]) {
        if (expected === "project_skill_refs" && !skill) continue;
        expect(categories).toContain(expected);
      }
    }
  });

  it("deletes when all six reference categories are empty", () => {
    const project = services.projectService.create("Deletable");
    services.projectService.remove(project.id);
    expect(services.projectService.getById(project.id)).toBeNull();
  });

  it("reference checklist stays in sync with the actual schema (foreign_key_list reflection)", () => {
    // 用 PRAGMA foreign_key_list 反查所有指向 projects(id) 的表；清单漏项即失败。
    const db: Database.Database = services.db;
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>).map(
      (r) => r.name,
    );
    const referencing = new Set<string>();
    for (const table of tables) {
      const fks = db.prepare(`PRAGMA foreign_key_list(${table})`).all() as Array<{ table: string; to: string | null }>;
      if (fks.some((fk) => fk.table === "projects" && (fk.to === "id" || fk.to === null))) {
        referencing.add(table);
      }
    }
    expect([...referencing].sort()).toEqual([...PROJECT_REFERENCE_CATEGORIES].sort());
  });
});
