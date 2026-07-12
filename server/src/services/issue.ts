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

export class IssueService {
  constructor(
    private issueRepo: IssueRepository,
    private threadRepo: ThreadRepository,
    private threadEventRepo: ThreadEventRepository,
    private projectRepo: ProjectRepository,
    private workflowTemplateRepo: WorkflowTemplateRepository,
    private validationPolicyRepo: ValidationPolicyRepository,
    private db: Database.Database,
  ) {}

  create(projectId: string, input: {
    title: string;
    goal: string;
    priority?: string;
    labels?: unknown;
  }): IssueCreateResult {
    const project = this.projectRepo.getById(projectId);
    if (!project) {
      throw new AppError(ErrorCode.PROJECT_NOT_FOUND, "Project not found.");
    }

    if (!project.default_workspace_id) {
      throw new AppError(ErrorCode.PROJECT_WORKSPACE_REQUIRED, "Project must have a default workspace before creating issues.");
    }

    const workspaceId = project.default_workspace_id;

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

    const workflowTemplate = this.workflowTemplateRepo.getDefault();
    if (!workflowTemplate) {
      throw new AppError(ErrorCode.INTERNAL_ERROR, "Default coding workflow template not found. Database may be corrupted.");
    }

    const validationPolicy = this.validationPolicyRepo.getDefault();
    if (!validationPolicy) {
      throw new AppError(ErrorCode.INTERNAL_ERROR, "Default coding validation policy not found. Database may be corrupted.");
    }

    const { issue, thread } = this.db.transaction(() => {
      const newIssue = this.issueRepo.create({
        project_id: projectId,
        workspace_id: workspaceId,
        issue_type: IssueType.Coding,
        workflow_template_id: workflowTemplate.id,
        validation_policy_id: validationPolicy.id,
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
          project_id: projectId,
          workspace_id: workspaceId,
          issue_type: IssueType.Coding,
          status: IssueStatus.Inbox,
          workflow_template_id: workflowTemplate.id,
          validation_policy_id: validationPolicy.id,
          primary_thread_id: newThread.id,
        },
        evidence_refs: [],
      });

      const updatedIssue = this.issueRepo.getById(newIssue.id)!;
      return { issue: updatedIssue, thread: newThread };
    })();

    return {
      issue: {
        ...issue,
        primary_thread: buildThreadSummary(thread),
      },
      primary_thread: thread,
    };
  }

  list(projectId: string): Issue[] {
    return this.issueRepo.list(projectId);
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
