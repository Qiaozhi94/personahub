import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestServices, createTempDir, disposeTestServices, type TestServices } from "../helpers.js";

describe("WorkspaceLockService", () => {
  let services: TestServices;
  let workspaceId: string;

  beforeEach(() => {
    services = createTestServices();
    const project = services.projectService.create("Test", "desc");
    const tempDir = createTempDir();
    const workspace = services.workspaceService.bind(project.id, tempDir);
    workspaceId = workspace.id;
  });
  afterEach(() => disposeTestServices(services));

  it("acquires lock on idle workspace", () => {
    const acquired = services.workspaceLockService.acquire(workspaceId, "run_test1");
    expect(acquired).toBe(true);
    expect(services.workspaceLockService.isLocked(workspaceId)).toBe(true);
  });

  it("fails to acquire lock on already-locked workspace", () => {
    services.workspaceLockService.acquire(workspaceId, "run_test1");
    const acquired = services.workspaceLockService.acquire(workspaceId, "run_test2");
    expect(acquired).toBe(false);
  });

  it("releases lock and workspace becomes idle", () => {
    services.workspaceLockService.acquire(workspaceId, "run_test1");
    services.workspaceLockService.release(workspaceId);
    expect(services.workspaceLockService.isLocked(workspaceId)).toBe(false);
  });

  it("releases lock by run id", () => {
    services.workspaceLockService.acquire(workspaceId, "run_test1");
    services.workspaceLockService.releaseByRunId("run_test1");
    expect(services.workspaceLockService.isLocked(workspaceId)).toBe(false);
  });

  it("isLocked returns false for non-existent workspace", () => {
    expect(services.workspaceLockService.isLocked("wsp_nonexistent")).toBe(false);
  });
});
