import type Database from "better-sqlite3";
import type { Project, ProjectWithWorkspace, WorkspaceSummary } from "@personahub/shared/types";
import { ErrorCode } from "@personahub/shared/errors";
import type { ProjectRepository, ProjectReferenceCategory } from "../repositories/project.js";
import type { WorkspaceRepository } from "../repositories/workspace.js";
import type { SpaceRepository } from "../repositories/space.js";
import { AppError } from "../api/errors.js";
import { AuditService } from "./audit.js";

export class ProjectService {
  constructor(
    private projectRepo: ProjectRepository,
    private workspaceRepo: WorkspaceRepository,
    private spaceRepo: SpaceRepository,
    private audit: AuditService,
    private db: Database.Database,
  ) {}

  create(name: string, description?: string, spaceId?: string): Project {
    const trimmedName = name?.trim();
    if (!trimmedName) {
      throw new AppError(ErrorCode.PROJECT_NAME_REQUIRED, "Project name is required.", "name");
    }
    // 缺省归入当前选中的 Space；显式 space_id 必须存在且 active。
    const fallbackSpaceId = spaceId ?? this.spaceRepo.getSelected()?.id;
    if (!fallbackSpaceId) {
      throw new AppError(ErrorCode.SPACE_NOT_FOUND, "No Space exists yet; create a Space first.");
    }
    if (spaceId) {
      const space = this.spaceRepo.getById(spaceId);
      if (!space) {
        throw new AppError(ErrorCode.SPACE_NOT_FOUND, "Space not found.");
      }
      if (space.state !== "active") {
        throw new AppError(ErrorCode.SPACE_NOT_ACTIVE, "Cannot create a project in an archived space.");
      }
    }
    const targetSpaceId: string = fallbackSpaceId;

    return this.db.transaction(() => {
      const project = this.projectRepo.create(trimmedName, description ?? null, targetSpaceId);
      this.audit.record("project.created", "project", project.id, {
        name: project.name,
        space_id: project.space_id,
      });
      return project;
    })();
  }

  /**
   * 默认只返回 state='active' 且属于当前选中 Space 的项目；
   * ?include_archived=1 与显式 space_id 可覆盖（design §3 / §4）。
   */
  list(options: { space_id?: string; include_archived?: boolean } = {}): Project[] {
    return this.projectRepo.list({
      spaceId: options.space_id,
      includeArchived: options.include_archived,
    });
  }

  /** 按 ID 深链不做 Space 过滤：切换 Space 后已发布的 /projects/:projectId 深链不得 404。 */
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

  getById(id: string): Project | null {
    return this.projectRepo.getById(id);
  }

  /** 归档项目上的写入动作统一 fail-closed，不靠前端隐藏按钮（design §3）。 */
  assertNotArchived(project: Project): void {
    if (project.state === "archived") {
      throw new AppError(ErrorCode.PROJECT_ARCHIVED, "Project is archived; this action is not allowed.");
    }
  }

  archive(id: string): Project {
    return this.db.transaction(() => {
      const project = this.get(id);
      if (project.state === "archived") {
        return project;
      }
      const now = new Date().toISOString();
      this.projectRepo.archive(id, now);
      this.audit.record("project.archived", "project", id, { name: project.name });
      return this.projectRepo.getById(id) as Project;
    })();
  }

  restore(id: string): Project {
    return this.db.transaction(() => {
      const project = this.get(id);
      if (project.state === "active") {
        return project;
      }
      this.projectRepo.restore(id, new Date().toISOString());
      this.audit.record("project.restored", "project", id, { name: project.name });
      return this.projectRepo.getById(id) as Project;
    })();
  }

  /**
   * 删除受引用保护：六类引用逐一检查（按 schema 实际枚举），任一非空即
   * PROJECT_HAS_REFERENCES 并列出阻塞类别；六类全空才删除。不提供级联删除。
   */
  remove(id: string): void {
    this.db.transaction(() => {
      const project = this.projectRepo.getById(id);
      if (!project) {
        throw new AppError(ErrorCode.PROJECT_NOT_FOUND, "Project not found.");
      }
      const blocking: ProjectReferenceCategory[] = this.projectRepo.listBlockingReferenceCategories(id);
      if (blocking.length > 0) {
        throw new AppError(ErrorCode.PROJECT_HAS_REFERENCES, "Project still has references and cannot be deleted.", undefined, {
          categories: blocking,
        });
      }
      this.projectRepo.delete(id);
      this.audit.record("project.deleted", "project", id, { name: project.name });
    })();
  }
}
