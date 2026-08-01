import type Database from "better-sqlite3";
import type {
  AdapterConfig,
  AdapterIdentitySnapshot,
  Run,
  ThreadEvent,
  ValidationPolicySnapshot,
} from "@personahub/shared/types";
import {
  ActorType,
  AdapterStatus,
  AgentCapability,
  IssueStatus,
  RunDispatchSource,
  RunRole,
  RunStatus,
  ThreadEventType,
  ValidationBlockReason,
} from "@personahub/shared/types";
import type { AgentConfigRepository } from "../../repositories/agent-config.js";
import { hasCapability } from "../../repositories/agent-config.js";
import { toPublicAdapter } from "../../repositories/agent-config-dto.js";
import type { AdapterWorkspaceStatusRepository } from "../../repositories/adapter-workspace-status.js";
import type { FileChangeRepository } from "../../repositories/file-change.js";
import type { IssueRepository } from "../../repositories/issue.js";
import type { RunRepository } from "../../repositories/run.js";
import type { ThreadEventRepository } from "../../repositories/thread-event.js";
import type { WorkflowTemplateRepository } from "../../repositories/workflow-template.js";
import { generateRunId } from "../../id.js";
import { effectiveAdapterStatus, listAvailableByCapabilityForWorkspace } from "../adapter-availability.js";
import type { ThreadEventService } from "../thread-event.js";
import { assembleValidatorContext } from "./context-assembler.js";
import { ValidationIssueBlocker } from "./issue-blocker.js";
import { selectValidator } from "./validator-selector.js";

export type ValidatorClaimAdapter =
  { mode: "auto" } | { mode: "explicit"; adapterConfigId: string; userInstructions?: string | null };

export type ClaimValidatorSlotResult =
  | { ok: true; run: Run }
  | { ok: false; reason: "not_validating" }
  | { ok: false; reason: "active_conflict"; conflictingRun: Run }
  | { ok: false; reason: "per_round_conflict"; conflictingRun: Run }
  | { ok: false; reason: "adapter_invalid"; message: string }
  | { ok: false; reason: "blocked" };

export class ValidatorSlotClaimer {
  constructor(
    private db: Database.Database,
    private issueRepo: IssueRepository,
    private runRepo: RunRepository,
    private threadEventService: ThreadEventService,
    private threadEventRepo: ThreadEventRepository,
    private agentConfigRepo: AgentConfigRepository,
    private workflowTemplateRepo: WorkflowTemplateRepository,
    private fileChangeRepo: FileChangeRepository,
    private adapterWorkspaceStatusRepo: AdapterWorkspaceStatusRepository,
    private blocker: ValidationIssueBlocker,
  ) {}

  claimValidatorSlot(issueId: string, adapter: ValidatorClaimAdapter): ClaimValidatorSlotResult {
    const pendingEvents: ThreadEvent[] = [];
    const result = this.db.transaction((): ClaimValidatorSlotResult => {
      const issue = this.issueRepo.getById(issueId);
      if (!issue || issue.status !== IssueStatus.Validating) {
        return { ok: false, reason: "not_validating" };
      }

      const active = this.runRepo.getActiveValidator(issueId);
      if (active) return { ok: false, reason: "active_conflict", conflictingRun: active };

      const pendingEvent = this.threadEventRepo.getLatestByTypeAndPayload(
        issue.primary_thread_id!,
        ThreadEventType.ValidationDispatchPending,
        "issue_id",
        issueId,
      );
      if (!pendingEvent) {
        this.blocker.blockIssueInTx(
          issue,
          ValidationBlockReason.RecoveryInconsistent,
          "No validation.dispatch_pending event found for Validating issue",
          pendingEvents,
        );
        return { ok: false, reason: "blocked" };
      }
      const round = pendingEvent.payload_json.validation_round as number;
      const implementationRunId = pendingEvent.payload_json.implementation_run_id as string;
      const policySnapshot = pendingEvent.payload_json.policy_snapshot as ValidationPolicySnapshot;
      const policySnapshotHash = pendingEvent.payload_json.policy_snapshot_hash as string;
      const policyId = pendingEvent.payload_json.policy_id as string;
      const policyVersion = pendingEvent.payload_json.policy_version as number;

      const existingForRound = this.runRepo.getValidatorRunByRound(issueId, round);
      if (existingForRound) return { ok: false, reason: "per_round_conflict", conflictingRun: existingForRound };

      const implRun = this.runRepo.getById(implementationRunId);
      if (
        !implRun ||
        implRun.status !== RunStatus.Completed ||
        implRun.role !== RunRole.Implementation ||
        !implRun.adapter_identity
      ) {
        this.blocker.blockIssueInTx(
          issue,
          ValidationBlockReason.RecoveryInconsistent,
          `Cannot claim validator slot: implementation run ${implementationRunId} is missing or invalid`,
          pendingEvents,
        );
        return { ok: false, reason: "blocked" };
      }

      let selected: AdapterConfig;
      let dispatchSource: RunDispatchSource;
      const userInstructions = adapter.mode === "explicit" ? adapter.userInstructions : null;
      if (adapter.mode === "auto") {
        const wf = this.workflowTemplateRepo.getById(issue.workflow_template_id);
        if (!wf) {
          this.blocker.blockIssueInTx(
            issue,
            ValidationBlockReason.WorkflowConfigurationInvalid,
            "Workflow template not found",
            pendingEvents,
          );
          return { ok: false, reason: "blocked" };
        }
        // Workspace-aware: candidates are every Project adapter (not
        // pre-filtered by global status) so one with a workspace-specific
        // Available override still qualifies even if globally Unknown/
        // Unavailable; listAvailableByCapabilityForWorkspace() then applies
        // this Issue's own workspace overrides before the status filter.
        const allCandidates = this.agentConfigRepo.listByProject(issue.project_id);
        const overrides = this.adapterWorkspaceStatusRepo.listForWorkspace(issue.workspace_id);
        const availableValidators = listAvailableByCapabilityForWorkspace(
          allCandidates,
          overrides,
          AgentCapability.Validator,
        ).map((r) => toPublicAdapter(r, null));
        const selectorResult = selectValidator({ workflowTemplate: wf, availableValidators });
        if (!selectorResult.selected) {
          this.blocker.blockIssueInTx(
            issue,
            selectorResult.reason ?? ValidationBlockReason.ValidatorUnavailable,
            selectorResult.message,
            pendingEvents,
          );
          return { ok: false, reason: "blocked" };
        }
        selected = selectorResult.selected;
        dispatchSource = RunDispatchSource.System;
      } else {
        const record = this.agentConfigRepo.getById(adapter.adapterConfigId);
        if (!record || record.project_id !== issue.project_id) {
          return { ok: false, reason: "adapter_invalid", message: "Adapter config not found for this project." };
        }
        const override = this.adapterWorkspaceStatusRepo.get(record.id, issue.workspace_id);
        if (effectiveAdapterStatus(record, override) !== AdapterStatus.Available) {
          return { ok: false, reason: "adapter_invalid", message: "Adapter is not available." };
        }
        if (!hasCapability(record, AgentCapability.Validator)) {
          return { ok: false, reason: "adapter_invalid", message: "Adapter does not have validator capability." };
        }
        selected = toPublicAdapter(record, null);
        dispatchSource = RunDispatchSource.UserExplicit;
      }

      const validatorIdentity: AdapterIdentitySnapshot = {
        adapter_config_id: selected.id,
        name: selected.name,
        cli_provider: selected.cli_provider,
        default_model: selected.default_model,
      };
      // Pre-generate the id so the context (which must cite the validator
      // Run's own id) can be fully built BEFORE any row is persisted — a
      // context-build failure must leave no trace (no orphan queued Run
      // occupying the per-round slot with empty instructions and no
      // events), not a half-written Run that a later catch can't undo
      // (better-sqlite3 commits a db.transaction() callback that returns
      // normally, even if it returns a "failure" value).
      const validatorRunId = generateRunId();
      let contextMarkdown: string;
      try {
        const ctx = assembleValidatorContext(
          { threadEventRepo: this.threadEventRepo, fileChangeRepo: this.fileChangeRepo },
          {
            issue: { title: issue.title, goal: issue.goal },
            threadId: issue.primary_thread_id!,
            implementationRunId,
            implementationRun: { id: implementationRunId, identity: implRun.adapter_identity! },
            validatorRun: { id: validatorRunId, identity: validatorIdentity },
            policySnapshot,
            policySnapshotHash,
            validationRound: round,
            userInstructions,
          },
        );
        contextMarkdown = ctx.markdown;
      } catch {
        this.blocker.blockIssueInTx(
          issue,
          ValidationBlockReason.WorkflowConfigurationInvalid,
          "Failed to build validator context",
          pendingEvents,
        );
        return { ok: false, reason: "blocked" };
      }
      const validatorRun = this.runRepo.create({
        id: validatorRunId,
        issue_id: issueId,
        thread_id: issue.primary_thread_id!,
        workspace_id: issue.workspace_id,
        adapter_config_id: selected.id,
        instructions: contextMarkdown,
        status: RunStatus.Queued,
        role: RunRole.Validator,
        dispatch_source: dispatchSource,
        validation_round: round,
        adapter_identity: validatorIdentity,
        context_source_run_id: implementationRunId,
      });

      // winner: clear the grace due date in the same transaction (design §8.2 step 6).
      this.issueRepo.compareAndSetStatus(issueId, IssueStatus.Validating, IssueStatus.Validating, {
        validation_dispatch_due_at: null,
      });

      pendingEvents.push(
        this.threadEventService.write(
          issue.primary_thread_id!,
          ThreadEventType.ValidationRequested,
          ActorType.System,
          null,
          {
            issue_id: issueId,
            thread_id: issue.primary_thread_id!,
            workspace_id: issue.workspace_id,
            validation_round: round,
            target: "implementation_result",
            policy_id: policyId,
            policy_version: policyVersion,
            policy_snapshot: policySnapshot,
            policy_snapshot_hash: policySnapshotHash,
            validator_run_id: validatorRun.id,
            implementation_run_id: implementationRunId,
            requested_by_run_id: implementationRunId,
            validator_adapter_config_id: selected.id,
          },
        ),
      );
      pendingEvents.push(
        this.threadEventService.write(issue.primary_thread_id!, ThreadEventType.RunQueued, ActorType.System, null, {
          run_id: validatorRun.id,
          issue_id: issueId,
          thread_id: issue.primary_thread_id!,
          workspace_id: issue.workspace_id,
          status: RunStatus.Queued,
          role: RunRole.Validator,
          validation_round: round,
        }),
      );
      return { ok: true, run: validatorRun };
    })();
    for (const event of pendingEvents) this.threadEventService.broadcast(event);
    return result;
  }
}
