import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestServices, disposeTestServices, createTempDir, type TestServices } from "../helpers.js";
import { RunStatus, AdapterStatus, FileChangeType } from "@personahub/shared/types";
import type { FileChangeRecord } from "../../src/repositories/file-change.js";

function setupRun(services: TestServices, tempDir: string) {
  const project = services.projectService.create("Test", "desc");
  services.workspaceService.bind(project.id, tempDir);
  const { issue } = services.issueService.create(project.id, { title: "Test", goal: "Goal" });
  const adapter = services.agentConfigRepo.create({
    project_id: project.id,
    name: "Fake",
    role: "implementation",
    cli_provider: "fake",
    command: "fake",
    args: [],
    capability_tags: [],
    default_model: null,
    status: AdapterStatus.Available,
  });
  return services.runRepo.create({
    issue_id: issue.id,
    thread_id: issue.primary_thread_id!,
    workspace_id: issue.workspace_id,
    adapter_config_id: adapter.id,
    instructions: "test",
    status: RunStatus.Queued,
  });
}

function makeChanges(): FileChangeRecord[] {
  return [
    { path: "server/src/z.ts", previous_path: null, change_type: FileChangeType.Modified, before_fingerprint: "a", after_fingerprint: "b" },
    { path: "server/src/a.ts", previous_path: null, change_type: FileChangeType.Added, before_fingerprint: null, after_fingerprint: "c" },
    { path: "README.md", previous_path: null, change_type: FileChangeType.Deleted, before_fingerprint: "d", after_fingerprint: null },
  ];
}

describe("FileChangeRepository (T012)", () => {
  let services: TestServices;
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
    services = createTestServices();
  });
  afterEach(() => {
    disposeTestServices(services);
  });

  it("replaceForRun inserts changes sorted by path", () => {
    const run = setupRun(services, tempDir);
    const now = new Date().toISOString();
    services.fileChangeRepo.replaceForRun(run.id, makeChanges(), now);

    const changes = services.fileChangeRepo.listByRun(run.id);
    expect(changes).toHaveLength(3);
    expect(changes[0].path).toBe("README.md");
    expect(changes[1].path).toBe("server/src/a.ts");
    expect(changes[2].path).toBe("server/src/z.ts");
  });

  it("same Run/path is unique - replace overwrites previous", () => {
    const run = setupRun(services, tempDir);
    const now = new Date().toISOString();
    services.fileChangeRepo.replaceForRun(run.id, makeChanges(), now);
    services.fileChangeRepo.replaceForRun(run.id, [
      { path: "only.ts", previous_path: null, change_type: FileChangeType.Added, before_fingerprint: null, after_fingerprint: "x" },
    ], now);

    const changes = services.fileChangeRepo.listByRun(run.id);
    expect(changes).toHaveLength(1);
    expect(changes[0].path).toBe("only.ts");
  });

  it("listByRun with cursor paginates correctly", () => {
    const run = setupRun(services, tempDir);
    const now = new Date().toISOString();
    services.fileChangeRepo.replaceForRun(run.id, makeChanges(), now);

    const firstPage = services.fileChangeRepo.listByRun(run.id, undefined, 2);
    expect(firstPage).toHaveLength(2);

    const secondPage = services.fileChangeRepo.listByRun(run.id, firstPage[1].id, 2);
    expect(secondPage).toHaveLength(1);
  });

  it("cursor from different run returns empty", () => {
    const run1 = setupRun(services, tempDir);
    const now = new Date().toISOString();
    services.fileChangeRepo.replaceForRun(run1.id, makeChanges(), now);

    const project2 = services.projectService.create("Test2", "desc");
    services.workspaceService.bind(project2.id, createTempDir());
    const { issue: issue2 } = services.issueService.create(project2.id, { title: "T2", goal: "G2" });
    const adapter2 = services.agentConfigRepo.create({
      project_id: project2.id, name: "F2", role: "implementation", cli_provider: "fake",
      command: "fake", args: [], capability_tags: [], default_model: null, status: AdapterStatus.Available,
    });
    const run2 = services.runRepo.create({
      issue_id: issue2.id, thread_id: issue2.primary_thread_id!, workspace_id: issue2.workspace_id,
      adapter_config_id: adapter2.id, instructions: "t", status: RunStatus.Queued,
    });
    services.fileChangeRepo.replaceForRun(run2.id, [
      { path: "other.ts", previous_path: null, change_type: FileChangeType.Added, before_fingerprint: null, after_fingerprint: "y" },
    ], now);

    const result = services.fileChangeRepo.listByRun(run2.id, "nonexistent_cursor", 10);
    expect(result).toHaveLength(0);
  });

  it("countByRun returns correct count", () => {
    const run = setupRun(services, tempDir);
    const now = new Date().toISOString();
    services.fileChangeRepo.replaceForRun(run.id, makeChanges(), now);
    expect(services.fileChangeRepo.countByRun(run.id)).toBe(3);
  });

  it("existsForRun returns true/false correctly", () => {
    const run = setupRun(services, tempDir);
    expect(services.fileChangeRepo.existsForRun(run.id)).toBe(false);

    const now = new Date().toISOString();
    services.fileChangeRepo.replaceForRun(run.id, makeChanges(), now);
    expect(services.fileChangeRepo.existsForRun(run.id)).toBe(true);
  });
});
