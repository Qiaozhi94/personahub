import type Database from "better-sqlite3";
import type { Issue, IssueWithThread, Thread, ThreadSummary } from "@personahub/shared/types";
import {
  IssueType, IssueStatus, IssuePriority, ThreadType,
  ThreadEventType, ActorType,
} from "@personahub/shared/types";
import { ErrorCode } from "@personahub/shared/errors";
import type { IssueRepository } from "../repositories/issue.js";
import type { ThreadRepository } from "../repositories/thread.js";
import type { ThreadEventRepository } from "../repositories/thread-event.js";
import type { ProjectRepository } from "../repositories/project.js";
import type { WorkflowTemplateRepository } from "../repositories/workflow-template.js";
import type { ValidationPolicyRepository } from "../repositories/validation-policy.js";
import type { SpaceRepository } from "../repositories/space.js";
import { AppError } from "../api/errors.js";

const VALID_PRIORITIES = new Set<string>([IssuePriority.Low, IssuePriority.Normal, IssuePriority.High]);

function processLabels(labels: unknown): string[] {
  if (!Array.isArray(labels)) return [];
  const result: string[] = [];
  const seen = new Set<string>();
  for (const label of labels) {
    if (typeof label !== "string") continue;
    const trimmed = label.trim();
    if (!trimmed) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

function buildThreadSummary(thread: Thread): ThreadSummary {
  return {
    id: thread.id,
    issue_id: thread.issue_id,
    thread_type: thread.thread_type,
    title: thread.title,
  };
}

export interface IssueCreateResult {
  issue: IssueWithThread;
  primary_thread: Thread;
}

export interface IssueCreateServiceInput {
  title: string;
  goal: string;
  priority?: string;
  labels?: unknown;
  /**
   * 游离任务（project_id 为空）时必填，且不从当前选中 Space 隐式推断
   * （design §3）；project 路径下可省略，space 取项目归属，传入不一致即拒绝。
   */
  space_id?: string;
}

export class IssueService {
  constructor(
    private issueRepo: IssueRepository,
    private threadRepo: ThreadRepository,
    private threadEventRepo: ThreadEventRepository,
    private projectRepo: ProjectRepository,
    private workflowTemplateRepo: WorkflowTemplateRepository,
    private validationPolicyRepo: ValidationPolicyRepository,
    private spaceRepo: SpaceRepository,
    private db: Database.Database,
  ) {}

  /**
   * 创建 Issue。project 路径沿用 v0.2 旅程（兼容投影写入三个 legacy 列，
   * 见 design §7「分阶段兼容」）；project 为空 = 游离任务，三个 legacy 列为空、
   * 不进入 v0.2 执行链路，直到 F012 接管派工。
   */
  create(projectId: string | null, input: IssueCreateServiceInput): IssueCreateResult {
    const trimmedTitle = input.title?.trim();
    if (!trimmedTitle) {
      throw new AppError(ErrorCode.ISSUE_TITLE_REQUIRED, "Issue title is required.", "title");
    }

    const trimmedGoal = input.goal?.trim();
    if (!trimmedGoal) {
      throw new AppError(ErrorCode.ISSUE_GOAL_REQUIRED, "Issue goal is required.", "goal");
    }

    const priority = input.priority ?? IssuePriority.Normal;
    if (!VALID_PRIORITIES.has(priority)) {
      throw new AppError(ErrorCode.ISSUE_PRIORITY_INVALID, `Issue priority must be one of: low, normal, high.`, "priority");
    }

    const labels = processLabels(input.labels);

    const result = this.db.transaction(() => {
      let spaceId: string;
      let legacyProjection: {
        project_id: string | null;
        workspace_id: string | null;
        workflow_template_id: string | null;
        validation_policy_id: string | null;
      } = { project_id: null, workspace_id: null, workflow_template_id: null, validation_policy_id: null };

      if (projectId !== null) {
        const project = this.projectRepo.getById(projectId);
        if (!project) {
          throw new AppError(ErrorCode.PROJECT_NOT_FOUND, "Project not found.");
        }
        // 归档项目 fail-closed（design §3），不靠前端隐藏按钮。
        if (project.state === "archived") {
          throw new AppError(ErrorCode.PROJECT_ARCHIVED, "Project is archived; this action is not allowed.");
        }
        if (input.space_id !== undefined && input.space_id !== project.space_id) {
          throw new AppError(ErrorCode.ISSUE_SPACE_MISMATCH, "Issue space does not match the project's space.");
        }
        spaceId = project.space_id;

        if (!project.default_workspace_id) {
          throw new AppError(
            ErrorCode.PROJECT_WORKSPACE_REQUIRED,
            "Project must have a default workspace before creating issues.",
          );
        }
        const workspaceId = project.default_workspace_id;

        const workflowTemplate = this.workflowTemplateRepo.getDefault();
        if (!workflowTemplate) {
          throw new AppError(ErrorCode.INTERNAL_ERROR, "Default coding workflow template not found. Database may be corrupted.");
        }

        const validationPolicy = this.validationPolicyRepo.getDefault();
        if (!validationPolicy) {
          throw new AppError(ErrorCode.INTERNAL_ERROR, "Default coding validation policy not found. Database may be corrupted.");
        }

        legacyProjection = {
          project_id: projectId,
          // 兼容投影只读 primary 引用行的 legacy_workspace_id；该行缺失时回退
          // default_workspace_id（同一事务内绑定时两者由 ProjectService 一致维护）。
          workspace_id: this.getPrimaryLegacyWorkspaceId(projectId) ?? workspaceId,
          workflow_template_id: workflowTemplate.id,
          validation_policy_id: validationPolicy.id,
        };
      } else {
        const requestedSpaceId = input.space_id?.trim();
        if (!requestedSpaceId) {
          throw new AppError(
            ErrorCode.ISSUE_SPACE_REQUIRED,
            "space_id is required for issues without a project.",
            "space_id",
          );
        }
        const space = this.spaceRepo.getById(requestedSpaceId);
        if (!space) {
          throw new AppError(ErrorCode.SPACE_NOT_FOUND, "Space not found.", "space_id");
        }
        if (space.state !== "active") {
          throw new AppError(ErrorCode.SPACE_NOT_ACTIVE, "Cannot create issues in an archived space.", "space_id");
        }
        spaceId = space.id;
      }

      const newIssue = this.issueRepo.create({
        space_id: spaceId,
        project_id: legacyProjection.project_id,
        workspace_id: legacyProjection.workspace_id,
        issue_type: IssueType.Coding,
        workflow_template_id: legacyProjection.workflow_template_id,
        validation_policy_id: legacyProjection.validation_policy_id,
        title: trimmedTitle,
        goal: trimmedGoal,
        status: IssueStatus.Inbox,
        priority: priority as IssuePriority,
        labels,
      });

      const newThread = this.threadRepo.create({
        issue_id: newIssue.id,
        thread_type: ThreadType.Primary,
        title: trimmedTitle,
      });

      const now = new Date().toISOString();
      this.issueRepo.updatePrimaryThread(newIssue.id, newThread.id, now);

      this.threadEventRepo.create({
        thread_id: newThread.id,
        type: ThreadEventType.IssueCreated,
        actor_type: ActorType.User,
        actor_id: null,
        payload: {
          issue_id: newIssue.id,
          space_id: spaceId,
          project_id: legacyProjection.project_id,
          workspace_id: legacyProjection.workspace_id,
          issue_type: IssueType.Coding,
          status: IssueStatus.Inbox,
          workflow_template_id: legacyProjection.workflow_template_id,
          validation_policy_id: legacyProjection.validation_policy_id,
          primary_thread_id: newThread.id,
        },
        evidence_refs: [],
      });

      const updatedIssue = this.issueRepo.getById(newIssue.id)!;
      return { issue: updatedIssue, thread: newThread };
    })();

    return {
      issue: {
        ...result.issue,
        primary_thread: buildThreadSummary(result.thread),
      },
      primary_thread: result.thread,
    };
  }

  /** project_repository_refs 的 primary 行（T007 兼容投影只读 primary 那条）。 */
  private getPrimaryLegacyWorkspaceId(projectId: string): string | null {
    const row = this.db
      .prepare(
        "SELECT legacy_workspace_id FROM project_repository_refs WHERE project_id = ? AND role = 'primary'",
      )
      .get(projectId) as { legacy_workspace_id: string | null } | undefined;
    return row?.legacy_workspace_id ?? null;
  }

  list(projectId: string): Issue[] {
    const project = this.projectRepo.getById(projectId);
    if (!project) {
      throw new AppError(ErrorCode.PROJECT_NOT_FOUND, "Project not found.");
    }
    return this.issueRepo.list(projectId);
  }

  /** Space 作用域列表（GET /api/issues，design §4）。 */
  listBySpace(spaceId: string): Issue[] {
    return this.issueRepo.listBySpace(spaceId);
  }

  get(issueId: string): IssueWithThread {
    const issue = this.issueRepo.getById(issueId);
    if (!issue) {
      throw new AppError(ErrorCode.ISSUE_NOT_FOUND, "Issue not found.");
    }

    let primaryThread: ThreadSummary | null = null;
    if (issue.primary_thread_id) {
      const thread = this.threadRepo.getById(issue.primary_thread_id);
      if (thread) {
        primaryThread = buildThreadSummary(thread);
      }
    }

    return {
      ...issue,
      primary_thread: primaryThread,
    };
  }
}
