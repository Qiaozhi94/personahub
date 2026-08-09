import type { AdapterResolverDeps } from "./adapter-resolver.js";
import type { RunRepository } from "../repositories/run.js";
import type { IssueRepository } from "../repositories/issue.js";
import type { AgentConfigRepository } from "../repositories/agent-config.js";
import type { ThreadEventService } from "./thread-event.js";
import type { ThreadEvent } from "@personahub/shared/types";
import {
  RunStatus,
  RunRole,
  RunPurpose,
  RunDispatchSource,
  ThreadEventType,
  ActorType,
  IssueStatus,
} from "@personahub/shared/types";
import { AgentCapability } from "@personahub/shared/types";
import { ErrorCode } from "@personahub/shared/errors";
import { AppError } from "../api/errors.js";
import { resolveEligibleAdapter } from "./adapter-eligibility.js";

export interface SequentialRunDeps {
  runRepo: RunRepository;
  issueRepo: IssueRepository;
  agentConfigRepo: AgentConfigRepository;
  threadEventService: ThreadEventService;
  adapterDeps: AdapterResolverDeps;
}

export interface SequentialRunResult {
  runId: string;
  pendingEvents: ThreadEvent[];
}

/**
 * F007 design §6: the free function that creates the first execution unit for
 * the `sequential` topology. Write-only, no self-held transaction, no process
 * launch, no broadcast. `instructions` is derived ONLY from `issue.goal.trim()`
 * so it can never diverge from the signature-protected goal in the token.
 */
export function createSequentialRun(
  deps: SequentialRunDeps,
  issueId: string,
  threadId: string,
  workspaceId: string,
  projectId: string,
  adapterConfigId: string,
): SequentialRunResult {
  const issue = deps.issueRepo.getById(issueId);
  if (!issue || issue.project_id !== projectId || issue.workspace_id !== workspaceId) {
    throw new AppError(ErrorCode.REQUEST_BODY_INVALID, "Issue does not belong to the specified project/workspace.");
  }
  const instructions = issue.goal?.trim() ?? "";
  if (!instructions) {
    throw new AppError(ErrorCode.INTERNAL_ERROR, "Issue goal is empty; cannot derive run instructions.");
  }

  const eligibility = resolveEligibleAdapter(deps.adapterDeps, projectId, workspaceId, {
    explicitAdapterId: adapterConfigId,
    requiredCapabilities: [AgentCapability.Implementation],
  });
  if (!eligibility.ok) {
    throw new AppError(eligibility.errorCode, `Adapter '${adapterConfigId}' is not eligible for implementation.`);
  }
  const adapter = deps.agentConfigRepo.getById(adapterConfigId);
  if (!adapter) {
    throw new AppError(ErrorCode.ADAPTER_NOT_FOUND, "Adapter config not found.");
  }

  const run = deps.runRepo.create({
    issue_id: issueId,
    thread_id: threadId,
    workspace_id: workspaceId,
    adapter_config_id: adapterConfigId,
    instructions,
    status: RunStatus.Queued,
    role: RunRole.Implementation,
    purpose: RunPurpose.WorkflowBound,
    dispatch_source: RunDispatchSource.UserExplicit,
    adapter_identity: {
      adapter_config_id: adapter.id,
      name: adapter.name,
      cli_provider: adapter.cli_provider,
      default_model: adapter.default_model,
    },
    context_source_run_id: null,
  });

  const moved = deps.issueRepo.compareAndSetStatus(issueId, IssueStatus.Inbox, IssueStatus.Running);
  if (!moved.success) {
    throw new AppError(ErrorCode.INVALID_ISSUE_TRANSITION, "Issue is not in Inbox state, cannot start run.");
  }

  const event = deps.threadEventService.write(threadId, ThreadEventType.RunQueued, ActorType.System, null, {
    run_id: run.id,
    issue_id: issueId,
    thread_id: threadId,
    workspace_id: workspaceId,
    status: RunStatus.Queued,
    purpose: RunPurpose.WorkflowBound,
    role: RunRole.Implementation,
    dispatch_source: RunDispatchSource.UserExplicit,
    adapter_config_id: adapterConfigId,
    cli_provider: adapter.cli_provider,
    context_source_run_id: null,
    drives_issue_state: true,
  });

  return { runId: run.id, pendingEvents: [event] };
}
