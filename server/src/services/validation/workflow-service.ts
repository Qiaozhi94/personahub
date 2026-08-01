import type Database from "better-sqlite3";
import type { Run, ThreadEvent, ValidationPolicySnapshot } from "@personahub/shared/types";
import {
  IssueStatus,
  RunRole,
  RunStatus,
  ThreadEventType,
  ActorType,
  ValidationBlockReason,
} from "@personahub/shared/types";
import type { IssueRepository } from "../../repositories/issue.js";
import type { RunRepository } from "../../repositories/run.js";
import type { AgentConfigRepository } from "../../repositories/agent-config.js";
import type { WorkflowTemplateRepository } from "../../repositories/workflow-template.js";
import type { ValidationPolicyRepository } from "../../repositories/validation-policy.js";
import type { ThreadEventRepository } from "../../repositories/thread-event.js";
import type { FileChangeRepository } from "../../repositories/file-change.js";
import type { EvidenceSummaryRepository } from "../../repositories/evidence-summary.js";
import type { AdapterWorkspaceStatusRepository } from "../../repositories/adapter-workspace-status.js";
import type { ValidationTraceService } from "../validation-trace.js";
import type { ThreadEventService } from "../thread-event.js";
import { buildPolicySnapshot, hashPolicySnapshot } from "./policy-gate.js";
import { ValidationIssueBlocker } from "./issue-blocker.js";
import { ValidationResultProcessor } from "./result-processor.js";
import {
  ValidatorSlotClaimer,
  type ClaimValidatorSlotResult,
  type ValidatorClaimAdapter,
} from "./validator-slot-claimer.js";

export type { ClaimValidatorSlotResult, ValidatorClaimAdapter } from "./validator-slot-claimer.js";

export class ValidationWorkflowService {
  private readonly blocker: ValidationIssueBlocker;
  private readonly resultProcessor: ValidationResultProcessor;
  private readonly slotClaimer: ValidatorSlotClaimer;

  constructor(
    private db: Database.Database,
    private issueRepo: IssueRepository,
    private runRepo: RunRepository,
    private threadEventService: ThreadEventService,
    private threadEventRepo: ThreadEventRepository,
    private validationTraceService: ValidationTraceService,
    private agentConfigRepo: AgentConfigRepository,
    private workflowTemplateRepo: WorkflowTemplateRepository,
    private validationPolicyRepo: ValidationPolicyRepository,
    private evidenceSummaryRepo: EvidenceSummaryRepository,
    private fileChangeRepo: FileChangeRepository,
    private adapterWorkspaceStatusRepo: AdapterWorkspaceStatusRepository,
    /**
     * design §8.1: must be injectable, not a hardcoded module constant —
     * F004's existing automatic-validation tests inject 0 to keep the
     * original "immediate creation" semantics (grace<=0 means Phase B fires
     * synchronously right after Phase A, in the same requestValidation()
     * call); production uses the real 10s default.
     */
    private manualValidatorGraceMs: number = 10_000,
  ) {
    this.blocker = new ValidationIssueBlocker(db, issueRepo, threadEventService);
    this.slotClaimer = new ValidatorSlotClaimer(
      db,
      issueRepo,
      runRepo,
      threadEventService,
      threadEventRepo,
      agentConfigRepo,
      workflowTemplateRepo,
      fileChangeRepo,
      adapterWorkspaceStatusRepo,
      this.blocker,
    );
    this.resultProcessor = new ValidationResultProcessor(
      db,
      issueRepo,
      runRepo,
      threadEventService,
      threadEventRepo,
      validationTraceService,
      evidenceSummaryRepo,
      fileChangeRepo,
      this.blocker,
    );
  }

  /**
   * design §8.1 Phase A: freezes round/implementation_run_id/policy snapshot
   * and moves Issue Running -> Validating, but does **not** select a
   * validator or create a Run — `validation.requested` stays validator-bound
   * (design's explicit constraint) and cannot be written until a real
   * validator Run exists. Writes `validation.dispatch_pending` instead.
   *
   * When `manualValidatorGraceMs <= 0` (F004's existing tests inject 0),
   * Phase B fires synchronously right after Phase A commits, reproducing
   * F004's original "immediate creation" event sequence exactly — this is
   * why the return type stays `Run | null` instead of void.
   */
  requestValidation(issueId: string, implementationRunId: string): Run | null {
    const pendingEvents: ThreadEvent[] = [];
    const phaseA = this.db.transaction((): { dueNow: boolean } | null => {
      const issue = this.issueRepo.getById(issueId);
      if (!issue || issue.status !== IssueStatus.Running) return null;
      const implRun = this.runRepo.getById(implementationRunId);
      if (!implRun || implRun.status !== RunStatus.Completed || implRun.role !== RunRole.Implementation) return null;
      if (!implRun.adapter_identity) {
        this.blocker.blockIssueInTx(
          issue,
          ValidationBlockReason.RecoveryInconsistent,
          "Implementation run missing adapter identity",
          pendingEvents,
        );
        return null;
      }
      const wf = this.workflowTemplateRepo.getById(issue.workflow_template_id);
      if (!wf) {
        this.blocker.blockIssueInTx(
          issue,
          ValidationBlockReason.WorkflowConfigurationInvalid,
          "Workflow template not found",
          pendingEvents,
        );
        return null;
      }
      const policy = this.validationPolicyRepo.getById(issue.validation_policy_id);
      if (!policy) {
        this.blocker.blockIssueInTx(
          issue,
          ValidationBlockReason.WorkflowConfigurationInvalid,
          "Validation policy not found",
          pendingEvents,
        );
        return null;
      }
      let policySnapshot: ValidationPolicySnapshot;
      try {
        policySnapshot = buildPolicySnapshot(
          policy.id,
          policy.version,
          policy.max_validation_rounds,
          policy.evidence_requirements_json,
        );
      } catch {
        this.blocker.blockIssueInTx(
          issue,
          ValidationBlockReason.WorkflowConfigurationInvalid,
          "Failed to build policy snapshot",
          pendingEvents,
        );
        return null;
      }
      const snapshotHash = hashPolicySnapshot(policySnapshot);
      const round = issue.validation_round_count + 1;
      const dueAt = new Date(Date.now() + Math.max(0, this.manualValidatorGraceMs)).toISOString();
      const casResult = this.issueRepo.compareAndSetStatus(issueId, IssueStatus.Running, IssueStatus.Validating, {
        blocked_reason_code: null,
        blocked_reason_message: null,
        validation_dispatch_due_at: dueAt,
      });
      if (!casResult.success) return null; // lost a race to another Phase A — nothing new to do
      pendingEvents.push(
        this.threadEventService.write(
          issue.primary_thread_id!,
          ThreadEventType.ValidationDispatchPending,
          ActorType.System,
          null,
          {
            issue_id: issueId,
            thread_id: issue.primary_thread_id!,
            workspace_id: issue.workspace_id,
            validation_round: round,
            implementation_run_id: implementationRunId,
            policy_id: policy.id,
            policy_version: policy.version,
            policy_snapshot: policySnapshot,
            policy_snapshot_hash: snapshotHash,
            dispatch_due_at: dueAt,
          },
        ),
      );
      return { dueNow: this.manualValidatorGraceMs <= 0 };
    })();
    for (const event of pendingEvents) this.threadEventService.broadcast(event);
    if (!phaseA) return null;
    if (!phaseA.dueNow) return null;
    const claimed = this.claimValidatorSlot(issueId, { mode: "auto" });
    return claimed.ok ? claimed.run : null;
  }

  /**
   * design §8.2 Phase B: the single winner-claim transaction shared by the
   * scheduler (auto), the immediate grace=0 cascade above, and a manual
   * explicit-adapter pick — reads the round/implementation_run_id/policy
   * snapshot frozen by Phase A's `validation.dispatch_pending` event and
   * never re-derives them (a consult Run's newer handoff during the grace
   * window must not change what's being validated, same constraint as
   * RunContextBuilder — design §6.5).
   *
   * Pre-checks (active, then per-round) are the actual correctness
   * mechanism here, not just "better error messages": every caller runs
   * inside this same single-threaded, synchronous `db.transaction()`, so
   * there is no JS-level interleaving between the pre-check and the insert
   * for two "concurrent" claims to race through. `idx_runs_one_active_
   * validator`/`idx_runs_validator_per_round` remain as schema-level
   * defense-in-depth if that ever stops being true.
   */
  claimValidatorSlot(issueId: string, adapter: ValidatorClaimAdapter): ClaimValidatorSlotResult {
    return this.slotClaimer.claimValidatorSlot(issueId, adapter);
  }

  processValidatorResult(validatorRunId: string): void {
    this.resultProcessor.process(validatorRunId);
  }

  blockValidation(issueId: string, validatorRunId: string, reason: ValidationBlockReason): void {
    this.blocker.blockValidation(issueId, validatorRunId, reason);
  }
}
