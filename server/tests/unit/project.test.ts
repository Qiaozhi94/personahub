import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestServices, disposeTestServices, type TestServices } from "../helpers.js";
import { AppError } from "../../src/api/errors.js";
import { ErrorCode } from "@personahub/shared/errors";
import { IssueStatus, IssueType } from "@personahub/shared/types";

describe("ProjectService", () => {
  let services: TestServices;

  beforeEach(() => {
    services = createTestServices();
  });

  afterEach(() => {
    disposeTestServices(services);
  });

  describe("create", () => {
    it("creates a project with valid name", () => {
      const project = services.projectService.create("My Project", "desc");
      expect(project.id).toMatch(/^prj_/);
      expect(project.name).toBe("My Project");
      expect(project.description).toBe("desc");
      expect(project.default_workspace_id).toBeNull();
      expect(project.default_coordinator_agent_id).toBeNull();
      expect(project.created_at).toBeTruthy();
      expect(project.updated_at).toBeTruthy();
    });

    it("creates a project without description", () => {
      const project = services.projectService.create("No Desc");
      expect(project.name).toBe("No Desc");
      expect(project.description).toBeNull();
    });

    it("trims whitespace from name", () => {
      const project = services.projectService.create("  Spaced  ");
      expect(project.name).toBe("Spaced");
    });

    it("rejects empty name", () => {
      expect(() => services.projectService.create("")).toThrow(AppError);
      expect(() => services.projectService.create("")).toThrowError(
        expect.objectContaining({ code: ErrorCode.PROJECT_NAME_REQUIRED }),
      );
    });

    it("rejects whitespace-only name", () => {
      expect(() => services.projectService.create("   ")).toThrowError(
        expect.objectContaining({ code: ErrorCode.PROJECT_NAME_REQUIRED }),
      );
    });

    it("rejects null/undefined name", () => {
      expect(() => services.projectService.create(null as unknown as string)).toThrowError(
        expect.objectContaining({ code: ErrorCode.PROJECT_NAME_REQUIRED }),
      );
    });
  });

  describe("list", () => {
    it("returns empty list when no projects", () => {
      const projects = services.projectService.list();
      expect(projects).toHaveLength(0);
    });

    it("returns created projects", () => {
      services.projectService.create("Project A");
      services.projectService.create("Project B");
      const projects = services.projectService.list();
      expect(projects).toHaveLength(2);
    });

    it("returns both created projects", () => {
      const a = services.projectService.create("A");
      const b = services.projectService.create("B");
      const projects = services.projectService.list();
      expect(projects).toHaveLength(2);
      expect(projects.map((p) => p.id)).toContain(a.id);
      expect(projects.map((p) => p.id)).toContain(b.id);
    });
  });

  describe("get", () => {
    it("returns project with null default_workspace when unbound", () => {
      const created = services.projectService.create("Test");
      const project = services.projectService.get(created.id);
      expect(project.id).toBe(created.id);
      expect(project.default_workspace).toBeNull();
    });

    it("throws PROJECT_NOT_FOUND for unknown id", () => {
      expect(() => services.projectService.get("prj_nonexistent")).toThrowError(
        expect.objectContaining({ code: ErrorCode.PROJECT_NOT_FOUND }),
      );
    });
  });
});
