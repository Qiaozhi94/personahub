import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTestServices, createTempDir, cleanupTempDir, disposeTestServices, type TestServices } from "../helpers.js";

describe("Issue Creation Failure-Path Rollback (T029)", () => {
  let services: TestServices;
  let tempDir: string;
  let projectId: string;

  beforeEach(() => {
    services = createTestServices();
    tempDir = createTempDir();
    const project = services.projectService.create("Test Project");
    services.workspaceService.bind(project.id, tempDir);
    projectId = project.id;
  });

  afterEach(() => {
    disposeTestServices(services);
    cleanupTempDir(tempDir);
  });

  it("rolls back Issue when ThreadEvent creation fails", () => {
    vi.spyOn(services.threadEventRepo, "create").mockImplementation(() => {
      throw new Error("Simulated event creation failure");
    });

    expect(() =>
      services.issueService.create(projectId, { title: "Will Rollback", goal: "G" }),
    ).toThrow("Simulated event creation failure");

    const issues = services.db.prepare("SELECT * FROM issues").all();
    expect(issues).toHaveLength(0);

    const threads = services.db.prepare("SELECT * FROM threads").all();
    expect(threads).toHaveLength(0);

    const events = services.db.prepare("SELECT * FROM thread_events").all();
    expect(events).toHaveLength(0);
  });

  it("rolls back Issue when Thread creation fails", () => {
    vi.spyOn(services.threadRepo, "create").mockImplementation(() => {
      throw new Error("Simulated thread creation failure");
    });

    expect(() =>
      services.issueService.create(projectId, { title: "Will Rollback", goal: "G" }),
    ).toThrow("Simulated thread creation failure");

    const issues = services.db.prepare("SELECT * FROM issues").all();
    expect(issues).toHaveLength(0);

    const threads = services.db.prepare("SELECT * FROM threads").all();
    expect(threads).toHaveLength(0);
  });

  it("rolls back when updatePrimaryThread fails after Issue and Thread are created", () => {
    vi.spyOn(services.issueRepo, "updatePrimaryThread").mockImplementation(() => {
      throw new Error("Simulated update failure");
    });

    expect(() =>
      services.issueService.create(projectId, { title: "Will Rollback", goal: "G" }),
    ).toThrow("Simulated update failure");

    const issues = services.db.prepare("SELECT * FROM issues").all();
    expect(issues).toHaveLength(0);

    const threads = services.db.prepare("SELECT * FROM threads").all();
    expect(threads).toHaveLength(0);
  });

  it("successful issue creation leaves exactly 1 issue, 1 thread, 1 event", () => {
    services.issueService.create(projectId, { title: "Success", goal: "G" });

    expect(services.db.prepare("SELECT COUNT(*) as c FROM issues").get()).toMatchObject({ c: 1 });
    expect(services.db.prepare("SELECT COUNT(*) as c FROM threads").get()).toMatchObject({ c: 1 });
    expect(services.db.prepare("SELECT COUNT(*) as c FROM thread_events").get()).toMatchObject({ c: 1 });
  });
});
