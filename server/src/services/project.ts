import type { Project, ProjectWithWorkspace, WorkspaceSummary } from "@personahub/shared/types";
import { ErrorCode } from "@personahub/shared/errors";
import type { ProjectRepository } from "../repositories/project.js";
import type { WorkspaceRepository } from "../repositories/workspace.js";
import { AppError } from "../api/errors.js";

export class ProjectService {
  constructor(
    private projectRepo: ProjectRepository,
    private workspaceRepo: WorkspaceRepository,
  ) {}

  create(name: string, description?: string): Project {
    const trimmedName = name?.trim();
    if (!trimmedName) {
      throw new AppError(ErrorCode.PROJECT_NAME_REQUIRED, "Project name is required.", "name");
    }

    return this.projectRepo.create(trimmedName, description ?? null);
  }

  list(): Project[] {
    return this.projectRepo.list();
  }

  get(id: string): ProjectWithWorkspace {
    const project = this.projectRepo.getById(id);
    if (!project) {
      throw new AppError(ErrorCode.PROJECT_NOT_FOUND, "Project not found.");
    }

    let defaultWorkspace: WorkspaceSummary | null = null;
    if (project.default_workspace_id) {
      const ws = this.workspaceRepo.getById(project.default_workspace_id);
      if (ws) {
        defaultWorkspace = {
          id: ws.id,
          local_path: ws.local_path,
          git_branch: ws.git_branch,
          lock_state: ws.lock_state,
        };
      }
    }

    return {
      ...project,
      default_workspace: defaultWorkspace,
    };
  }
}
