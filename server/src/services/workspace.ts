import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import type Database from "better-sqlite3";
import type { Workspace } from "@personahub/shared/types";
import { WorkspaceLockState } from "@personahub/shared/types";
import { ErrorCode } from "@personahub/shared/errors";
import type { WorkspaceRepository } from "../repositories/workspace.js";
import type { ProjectRepository } from "../repositories/project.js";
import { AppError } from "../api/errors.js";

function detectGitBranch(dirPath: string): string | null {
  try {
    const branch = execFileSync("git", ["-C", dirPath, "rev-parse", "--abbrev-ref", "HEAD"], {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    return branch || null;
  } catch {
    return null;
  }
}

function normalizePath(rawPath: string): { local_path: string; local_path_normalized: string } {
  const resolved = path.resolve(rawPath);
  const localPathNormalized = process.platform === "win32"
    ? resolved.toLowerCase()
    : resolved;
  return { local_path: resolved, local_path_normalized: localPathNormalized };
}

export class WorkspaceService {
  constructor(
    private workspaceRepo: WorkspaceRepository,
    private projectRepo: ProjectRepository,
    private db: Database.Database,
  ) {}

  bind(projectId: string, localPathInput: string): Workspace {
    const project = this.projectRepo.getById(projectId);
    if (!project) {
      throw new AppError(ErrorCode.PROJECT_NOT_FOUND, "Project not found.");
    }

    const rawPath = localPathInput?.trim();
    if (!rawPath) {
      throw new AppError(ErrorCode.WORKSPACE_PATH_REQUIRED, "Workspace path is required.", "local_path");
    }

    if (!fs.existsSync(rawPath)) {
      throw new AppError(ErrorCode.WORKSPACE_PATH_NOT_FOUND, "Workspace path does not exist.", "local_path");
    }

    try {
      fs.accessSync(rawPath, fs.constants.R_OK);
    } catch {
      throw new AppError(ErrorCode.WORKSPACE_PATH_NOT_READABLE, "Workspace path is not readable.", "local_path");
    }

    const { local_path, local_path_normalized } = normalizePath(rawPath);
    const gitBranch = detectGitBranch(local_path);

    const workspace = this.db.transaction(() => {
      const existing = this.workspaceRepo.getByProjectAndPath(projectId, local_path_normalized);
      let ws: Workspace;

      if (existing) {
        const now = new Date().toISOString();
        this.workspaceRepo.update(existing.id, { git_branch: gitBranch, updated_at: now });
        ws = this.workspaceRepo.getById(existing.id)!;
      } else {
        ws = this.workspaceRepo.create({
          project_id: projectId,
          local_path,
          local_path_normalized,
          git_branch: gitBranch,
          lock_state: WorkspaceLockState.Idle,
        });
      }

      this.projectRepo.updateDefaultWorkspace(projectId, ws.id, new Date().toISOString());
      return ws;
    })();

    return workspace;
  }

  get(projectId: string): Workspace | null {
    const project = this.projectRepo.getById(projectId);
    if (!project || !project.default_workspace_id) {
      return null;
    }
    return this.workspaceRepo.getById(project.default_workspace_id);
  }

  getById(workspaceId: string): Workspace {
    const ws = this.workspaceRepo.getById(workspaceId);
    if (!ws) {
      throw new AppError(ErrorCode.WORKSPACE_NOT_FOUND, "Workspace not found.");
    }
    return ws;
  }
}
