import type Database from "better-sqlite3";
import type { Run, ThreadEvent, RunPurpose, AdapterIdentitySnapshot } from "@personahub/shared/types";
import { IssueStatus as IS, RunStatus as RS, RunRole, ThreadEventType, ActorType } from "@personahub/shared/types";
import { ErrorCode } from "@personahub/shared/errors";
import type { RunRepository } from "../repositories/run.js";
import type { IssueRepository } from "../repositories/issue.js";
import type { WorkspaceRepository } from "../repositories/workspace.js";
import type { AgentConfigRepository } from "../repositories/agent-config.js";
import type { ProjectRepository } from "../repositories/project.js";
import type { AdapterWorkspaceStatusRepository } from "../repositories/adapter-workspace-status.js";
import type { ThreadEventRepository } from "../repositories/thread-event.js";
import type { ThreadEventService } from "./thread-event.js";
import { AppError } from "../api/errors.js";
import { resolveAdapter } from "./adapter-resolver.js";
import { classifyRunRequest } from "./run-routing-classifier.js";
import { collectPriorFindings } from "./validation/context-assembler.js";
import { buildRepairContext } from "./validation/context-builder.js";
import type { ValidationWorkflowService } from "./validation/workflow-service.js";

export interface ManualRoutingDispatchInput {
  issueId: string;
  instructions: string;
  adapterId?: string;
  purpose?: RunPurpose;
}

function mapResolveError(errorCode: ErrorCode): never {
  const message = errorCode === ErrorCode.DEFAULT_ADAPTER_UNAVAILABLE
    ? "No Project default adapter is set or available; select an adapter explicitly."
    : errorCode === ErrorCode.ADAPTER_UNAVAILABLE
      ? "Adapter is not available."
      : "Adapter config not found for this project.";
  throw new AppError(errorCode, message);
}

/**
 * design §7: the single entry point for creating a manually- or
 * default-routed Run. Composes the Phase 7 pure pieces (AdapterResolver,
 * classifyRunRequest, RunContextBuilder's context_source_run_id discovery)
 * inside one create transaction — routes/clients can only ever supply
 * `instructions`/an optional `adapter_id`/an optional `ad_hoc_consult`
 * request; `role`, `dispatch_source`, and `workflow_bound` are always
 * server-derived, never accepted as input (design §7.4).
 *
 * Scope note: a manual dispatch that classifies to role=Validator (Issue
 * Validating + a validator-capable adapter) is delegated to
 * ValidationWorkflowService.claimValidatorSlot() in "explicit" mode (design
 * §8.2/Phase 9) rather than created through the generic path below —
 * safely creating a validator Run needs the frozen
 * round/implementation_run_id/policy-snapshot that only Phase A's
 * `validation.dispatch_pending` event carries, plus the same
 * active/per-round uniqueness pre-checks the scheduler's auto-claim uses.
 */
export class ManualRoutingService {
  constructor(
    private runRepo: RunRepository,
    private issueRepo: IssueRepository,
    private workspaceRepo: WorkspaceRepository,
    private agentConfigRepo: AgentConfigRepository,
    private projectRepo: ProjectRepository,
    private threadEventRepo: ThreadEventRepository,
    private threadEventService: ThreadEventService,
    private db: Database.Database,
    private validationWorkflowService: ValidationWorkflowService,
    private adapterWorkspaceStatusRepo: AdapterWorkspaceStatusRepository,
  ) {}

  dispatch(input: ManualRoutingDispatchInput): Run {
    const issue = this.issueRepo.getById(input.issueId);
    if (!issue) {
      throw new AppError(ErrorCode.ISSUE_NOT_FOUND, "Issue not found.");
    }

    const trimmedInstructions = input.instructions?.trim();
    if (!trimmedInstructions) {
      throw new AppError(ErrorCode.RUN_INSTRUCTIONS_REQUIRED, "Run instructions are required.", "instructions");
    }

    const resolved = resolveAdapter(
      { agentConfigRepo: this.agentConfigRepo, projectRepo: this.projectRepo, adapterWorkspaceStatusRepo: this.adapterWorkspaceStatusRepo },
      issue.project_id,
      issue.workspace_id,
      input.adapterId,
    );
    if (!resolved.ok) {
      mapResolveError(resolved.errorCode);
    }
    const adapter = this.agentConfigRepo.getById(resolved.adapterConfigId)!;

    const classification = classifyRunRequest(issue.status, input.purpose, adapter.capability_tags);
    if (!classification.allowed) {
      throw new AppError(ErrorCode.RUN_NOT_ALLOWED_FOR_ISSUE_STATUS, `Cannot create a Run: issue is ${issue.status}.`);
    }
    if (classification.role === RunRole.Validator) {
      return this.dispatchValidator(issue.id, adapter.id, trimmedInstructions);
    }

    const workspace = this.workspaceRepo.getById(issue.workspace_id);
    if (!workspace) {
      throw new AppError(ErrorCode.WORKSPACE_NOT_FOUND, "Workspace not found for issue.");
    }
    if (!issue.primary_thread_id) {
      throw new AppError(ErrorCode.INTERNAL_ERROR, "Issue has no primary thread.");
    }
    const threadId = issue.primary_thread_id;

    const adapterIdentity: AdapterIdentitySnapshot = {
      adapter_config_id: adapter.id,
      name: adapter.name,
      cli_provider: adapter.cli_provider,
      default_model: adapter.default_model,
    };

    // Repair context: an implementation retry after a failed validation round
    // surfaces the latest round's findings — same behavior F002/F004 already
    // had, unchanged by manual routing.
    const isRepairCandidate =
      classification.role === RunRole.Implementation &&
      (issue.status === IS.Running || issue.status === IS.Ready) &&
      issue.validation_round_count > 0;
    let finalInstructions = trimmedInstructions;
    if (isRepairCandidate) {
      const allFindings = collectPriorFindings(this.threadEventRepo, threadId);
      if (allFindings.length > 0) {
        const latestRound = Math.max(...allFindings.map((f) => f.validation_round));
        const latestFindings = allFindings.filter((f) => f.validation_round === latestRound);
        finalInstructions = buildRepairContext({ baseInstructions: trimmedInstructions, latestFailedFindings: latestFindings, validationRound: latestRound });
      }
    }

    const { run, event } = this.db.transaction(() => {
      const freshIssue = this.issueRepo.getById(input.issueId);
      if (!freshIssue) {
        throw new AppError(ErrorCode.ISSUE_NOT_FOUND, "Issue not found.");
      }
      // Re-classify against the fresh, transaction-scoped Issue status —
      // status may have changed between the pre-checks above and this
      // transaction acquiring its lock.
      const freshClassification = classifyRunRequest(freshIssue.status, input.purpose, adapter.capability_tags);
      if (!freshClassification.allowed || freshClassification.role === RunRole.Validator) {
        throw new AppError(ErrorCode.RUN_NOT_ALLOWED_FOR_ISSUE_STATUS, `Cannot create a Run: issue is ${freshIssue.status}.`);
      }

      // design §6.5: implementation/consult Runs see the latest completed
      // implementation Run's handoff; there is no "before this Run" id yet
      // since it doesn't exist, so the plain (no beforeRunId) query is
      // exactly "the latest one so far".
      const priorImplRun = this.runRepo.getLatestCompletedByRole(freshIssue.id, RunRole.Implementation);
      const contextSourceRunId = priorImplRun?.id ?? null;

      const run = this.runRepo.create({
        issue_id: freshIssue.id,
        thread_id: threadId,
        workspace_id: workspace.id,
        adapter_config_id: adapter.id,
        instructions: finalInstructions,
        status: RS.Queued,
        role: freshClassification.role,
        dispatch_source: resolved.source,
        adapter_identity: adapterIdentity,
        purpose: freshClassification.purpose,
        context_source_run_id: contextSourceRunId,
      });

      // T058: consult never drives Issue state — only a workflow-bound
      // implementation Run starting from Inbox/Ready advances to Running.
      const drivesIssueState = freshClassification.role === RunRole.Implementation;
      if (drivesIssueState && (freshIssue.status === IS.Inbox || freshIssue.status === IS.Ready)) {
        this.issueRepo.updateStatus(freshIssue.id, {
          status: IS.Running,
          updatedAt: new Date().toISOString(),
        });
      }

      const event = this.threadEventService.write(
        run.thread_id,
        ThreadEventType.RunQueued,
        ActorType.System,
        null,
        {
          run_id: run.id,
          issue_id: run.issue_id,
          thread_id: run.thread_id,
          workspace_id: run.workspace_id,
          status: RS.Queued,
          purpose: freshClassification.purpose,
          role: freshClassification.role,
          dispatch_source: resolved.source,
          adapter_config_id: adapter.id,
          cli_provider: adapter.cli_provider,
          context_source_run_id: contextSourceRunId,
          drives_issue_state: drivesIssueState,
        },
      );

      return { run, event };
    })();

    this.threadEventService.broadcast(event);
    return run;
  }

  /**
   * design §8.2: the manual side of the Phase B race — the scheduler's
   * due-expiry auto-claim is the other side. Whichever transaction commits
   * first wins; the loser gets a typed conflict here rather than a raw
   * SQLite constraint error (design's "manual loser gets VALIDATOR_RUN_
   * CONFLICT + a summary of the conflicting run").
   */
  private dispatchValidator(issueId: string, adapterConfigId: string, userInstructions: string): Run {
    const claimed = this.validationWorkflowService.claimValidatorSlot(issueId, { mode: "explicit", adapterConfigId, userInstructions });
    if (claimed.ok) return claimed.run;
    switch (claimed.reason) {
      case "active_conflict":
      case "per_round_conflict":
        throw new AppError(
          ErrorCode.VALIDATOR_RUN_CONFLICT,
          "A validator run already exists for this issue/round.",
          undefined,
          { conflicting_run_id: claimed.conflictingRun.id, conflicting_run_status: claimed.conflictingRun.status },
        );
      case "adapter_invalid":
        throw new AppError(ErrorCode.ADAPTER_UNAVAILABLE, claimed.message);
      case "not_validating":
        throw new AppError(ErrorCode.RUN_NOT_ALLOWED_FOR_ISSUE_STATUS, "Issue is no longer awaiting validation dispatch.");
      case "blocked":
        throw new AppError(ErrorCode.VALIDATOR_UNAVAILABLE, "Could not create validator run.");
    }
  }
}
