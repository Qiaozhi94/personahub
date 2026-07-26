import type Database from "better-sqlite3";
import type { Issue, Run, ThreadEvent, AdapterIdentitySnapshot, ValidationPolicySnapshot, ValidationResultEnvelope, ValidationFinding, AdapterConfig } from "@personahub/shared/types";
import { IssueStatus, RunRole, RunDispatchSource, RunStatus, ThreadEventType, ActorType, ValidationBlockReason, ValidationOutcome, TraceCompletenessStatus, AgentCapability, AdapterStatus } from "@personahub/shared/types";
import type { IssueRepository } from "../../repositories/issue.js";
import type { RunRepository } from "../../repositories/run.js";
import { generateRunId } from "../../id.js";
import type { AgentConfigRepository } from "../../repositories/agent-config.js";
import { hasCapability } from "../../repositories/agent-config.js";
import { toPublicAdapter } from "../../repositories/agent-config-dto.js";
import type { WorkflowTemplateRepository } from "../../repositories/workflow-template.js";
import type { ValidationPolicyRepository } from "../../repositories/validation-policy.js";
import type { ThreadEventRepository } from "../../repositories/thread-event.js";
import type { FileChangeRepository } from "../../repositories/file-change.js";
import type { EvidenceSummaryRepository } from "../../repositories/evidence-summary.js";
import type { AdapterWorkspaceStatusRepository } from "../../repositories/adapter-workspace-status.js";
import { listAvailableByCapabilityForWorkspace, effectiveAdapterStatus } from "../adapter-availability.js";
import type { ValidationTraceService } from "../validation-trace.js";
import type { ThreadEventService } from "../thread-event.js";
import { selectValidator } from "./validator-selector.js";
import { buildPolicySnapshot, hashPolicySnapshot, checkEvidenceRequirements } from "./policy-gate.js";
import { parseValidationResult } from "./result-parser.js";
import { buildEvidenceSummary, type EvidenceSummaryBuildInput, type SummaryVerificationEvent } from "./evidence-summary-builder.js";
import { assembleValidatorContext } from "./context-assembler.js";
import { findRequestedEvent, resultEventExistsForValidatorRun, getFinalMessage, collectImplementationEvidence } from "./workflow-queries.js";
import { AppError } from "../../api/errors.js";
import { ErrorCode } from "@personahub/shared/errors";

export type ValidatorClaimAdapter =
  | { mode: "auto" }
  | { mode: "explicit"; adapterConfigId: string; userInstructions?: string | null };

export type ClaimValidatorSlotResult =
  | { ok: true; run: Run }
  | { ok: false; reason: "not_validating" }
  | { ok: false; reason: "active_conflict"; conflictingRun: Run }
  | { ok: false; reason: "per_round_conflict"; conflictingRun: Run }
  | { ok: false; reason: "adapter_invalid"; message: string }
  | { ok: false; reason: "blocked" };

export class ValidationWorkflowService {
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
  ) {}

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
        this.blockIssueInTx(issue, ValidationBlockReason.RecoveryInconsistent, "Implementation run missing adapter identity", pendingEvents);
        return null;
      }
      const wf = this.workflowTemplateRepo.getById(issue.workflow_template_id);
      if (!wf) { this.blockIssueInTx(issue, ValidationBlockReason.WorkflowConfigurationInvalid, "Workflow template not found", pendingEvents); return null; }
      const policy = this.validationPolicyRepo.getById(issue.validation_policy_id);
      if (!policy) { this.blockIssueInTx(issue, ValidationBlockReason.WorkflowConfigurationInvalid, "Validation policy not found", pendingEvents); return null; }
      let policySnapshot: ValidationPolicySnapshot;
      try { policySnapshot = buildPolicySnapshot(policy.id, policy.version, policy.max_validation_rounds, policy.evidence_requirements_json); }
      catch { this.blockIssueInTx(issue, ValidationBlockReason.WorkflowConfigurationInvalid, "Failed to build policy snapshot", pendingEvents); return null; }
      const snapshotHash = hashPolicySnapshot(policySnapshot);
      const round = issue.validation_round_count + 1;
      const dueAt = new Date(Date.now() + Math.max(0, this.manualValidatorGraceMs)).toISOString();
      const casResult = this.issueRepo.compareAndSetStatus(issueId, IssueStatus.Running, IssueStatus.Validating, {
        blocked_reason_code: null, blocked_reason_message: null, validation_dispatch_due_at: dueAt,
      });
      if (!casResult.success) return null; // lost a race to another Phase A — nothing new to do
      pendingEvents.push(this.threadEventService.write(issue.primary_thread_id!, ThreadEventType.ValidationDispatchPending, ActorType.System, null, {
        issue_id: issueId, thread_id: issue.primary_thread_id!, workspace_id: issue.workspace_id,
        validation_round: round, implementation_run_id: implementationRunId,
        policy_id: policy.id, policy_version: policy.version,
        policy_snapshot: policySnapshot, policy_snapshot_hash: snapshotHash,
        dispatch_due_at: dueAt,
      }));
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
    const pendingEvents: ThreadEvent[] = [];
    const result = this.db.transaction((): ClaimValidatorSlotResult => {
      const issue = this.issueRepo.getById(issueId);
      if (!issue || issue.status !== IssueStatus.Validating) {
        return { ok: false, reason: "not_validating" };
      }

      const active = this.runRepo.getActiveValidator(issueId);
      if (active) return { ok: false, reason: "active_conflict", conflictingRun: active };

      const pendingEvent = this.threadEventRepo.getLatestByTypeAndPayload(
        issue.primary_thread_id!, ThreadEventType.ValidationDispatchPending, "issue_id", issueId,
      );
      if (!pendingEvent) {
        this.blockIssueInTx(issue, ValidationBlockReason.RecoveryInconsistent, "No validation.dispatch_pending event found for Validating issue", pendingEvents);
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
      if (!implRun || implRun.status !== RunStatus.Completed || implRun.role !== RunRole.Implementation || !implRun.adapter_identity) {
        this.blockIssueInTx(issue, ValidationBlockReason.RecoveryInconsistent, `Cannot claim validator slot: implementation run ${implementationRunId} is missing or invalid`, pendingEvents);
        return { ok: false, reason: "blocked" };
      }

      let selected: AdapterConfig;
      let dispatchSource: RunDispatchSource;
      const userInstructions = adapter.mode === "explicit" ? adapter.userInstructions : null;
      if (adapter.mode === "auto") {
        const wf = this.workflowTemplateRepo.getById(issue.workflow_template_id);
        if (!wf) { this.blockIssueInTx(issue, ValidationBlockReason.WorkflowConfigurationInvalid, "Workflow template not found", pendingEvents); return { ok: false, reason: "blocked" }; }
        // Workspace-aware: candidates are every Project adapter (not
        // pre-filtered by global status) so one with a workspace-specific
        // Available override still qualifies even if globally Unknown/
        // Unavailable; listAvailableByCapabilityForWorkspace() then applies
        // this Issue's own workspace overrides before the status filter.
        const allCandidates = this.agentConfigRepo.listByProject(issue.project_id);
        const overrides = this.adapterWorkspaceStatusRepo.listForWorkspace(issue.workspace_id);
        const availableValidators = listAvailableByCapabilityForWorkspace(allCandidates, overrides, AgentCapability.Validator).map((r) => toPublicAdapter(r, null));
        const selectorResult = selectValidator({ workflowTemplate: wf, availableValidators });
        if (!selectorResult.selected) {
          this.blockIssueInTx(issue, selectorResult.reason ?? ValidationBlockReason.ValidatorUnavailable, selectorResult.message, pendingEvents);
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
        adapter_config_id: selected.id, name: selected.name,
        cli_provider: selected.cli_provider, default_model: selected.default_model,
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
            policySnapshot, policySnapshotHash, validationRound: round,
            userInstructions,
          },
        );
        contextMarkdown = ctx.markdown;
      } catch {
        this.blockIssueInTx(issue, ValidationBlockReason.WorkflowConfigurationInvalid, "Failed to build validator context", pendingEvents);
        return { ok: false, reason: "blocked" };
      }
      const validatorRun = this.runRepo.create({
        id: validatorRunId,
        issue_id: issueId, thread_id: issue.primary_thread_id!, workspace_id: issue.workspace_id,
        adapter_config_id: selected.id, instructions: contextMarkdown, status: RunStatus.Queued,
        role: RunRole.Validator, dispatch_source: dispatchSource, validation_round: round, adapter_identity: validatorIdentity,
        context_source_run_id: implementationRunId,
      });

      // winner: clear the grace due date in the same transaction (design §8.2 step 6).
      this.issueRepo.compareAndSetStatus(issueId, IssueStatus.Validating, IssueStatus.Validating, { validation_dispatch_due_at: null });

      pendingEvents.push(this.threadEventService.write(issue.primary_thread_id!, ThreadEventType.ValidationRequested, ActorType.System, null, {
        issue_id: issueId, thread_id: issue.primary_thread_id!, workspace_id: issue.workspace_id,
        validation_round: round, target: "implementation_result", policy_id: policyId, policy_version: policyVersion,
        policy_snapshot: policySnapshot, policy_snapshot_hash: policySnapshotHash,
        validator_run_id: validatorRun.id, implementation_run_id: implementationRunId, requested_by_run_id: implementationRunId,
        validator_adapter_config_id: selected.id,
      }));
      pendingEvents.push(this.threadEventService.write(issue.primary_thread_id!, ThreadEventType.RunQueued, ActorType.System, null, {
        run_id: validatorRun.id, issue_id: issueId, thread_id: issue.primary_thread_id!,
        workspace_id: issue.workspace_id, status: RunStatus.Queued, role: RunRole.Validator, validation_round: round,
      }));
      return { ok: true, run: validatorRun };
    })();
    for (const event of pendingEvents) this.threadEventService.broadcast(event);
    return result;
  }

  processValidatorResult(validatorRunId: string): void {
    const validatorRun = this.runRepo.getById(validatorRunId);
    if (!validatorRun || validatorRun.role !== RunRole.Validator) return;
    if (validatorRun.status === RunStatus.Failed || validatorRun.status === RunStatus.Cancelled || validatorRun.status === RunStatus.Interrupted) {
      this.blockIssue(validatorRun.issue_id, ValidationBlockReason.ValidatorRunFailed, `Validator run terminated with status: ${validatorRun.status}`);
      return;
    }
    if (validatorRun.status !== RunStatus.Completed) return;
    const issue = this.issueRepo.getById(validatorRun.issue_id);
    if (!issue || issue.status !== IssueStatus.Validating) return;
    const finalMessage = getFinalMessage(this.db, validatorRunId);
    if (!finalMessage) { this.blockIssue(validatorRun.issue_id, ValidationBlockReason.ResultUnparsable, "Validator run has no final message"); return; }
    let parsedResult: ValidationResultEnvelope;
    try { parsedResult = parseValidationResult(finalMessage); }
    catch { this.blockIssue(validatorRun.issue_id, ValidationBlockReason.ResultUnparsable, "Failed to parse validator final message"); return; }
    if (parsedResult.outcome === ValidationOutcome.Passed) {
      try { this.processPassed(validatorRun, parsedResult, issue); }
      catch (error) {
        if (!this.handleEvidenceScopeError(error, issue.id)) throw error;
      }
    } else if (parsedResult.outcome === ValidationOutcome.Failed) {
      try { this.processFailed(validatorRun, parsedResult, issue); }
      catch (error) {
        if (!this.handleEvidenceScopeError(error, issue.id)) throw error;
      }
    } else if (parsedResult.outcome === ValidationOutcome.Blocked) {
      try { this.processBlocked(validatorRun, parsedResult, issue); }
      catch (error) {
        if (!this.handleEvidenceScopeError(error, issue.id)) throw error;
      }
    }
  }

  private handleEvidenceScopeError(error: unknown, issueId: string): boolean {
    if (error instanceof AppError &&
        (error.code === ErrorCode.EVIDENCE_SCOPE_MISMATCH ||
         error.code === ErrorCode.EVIDENCE_REF_INVALID)) {
      this.blockIssue(
        issueId,
        error.code === ErrorCode.EVIDENCE_SCOPE_MISMATCH
          ? ValidationBlockReason.EvidenceScopeMismatch
          : ValidationBlockReason.EvidenceMissing,
        error.message,
      );
      return true;
    }
    return false;
  }

  private processPassed(validatorRun: Run, result: ValidationResultEnvelope, issue: Issue): void {
    const pendingEvents: ThreadEvent[] = [];
    const requestedEvent = findRequestedEvent(this.threadEventRepo, validatorRun.thread_id, validatorRun.id);
    if (!requestedEvent) return;
    const requestedPayload = requestedEvent.payload_json;
    const implementationRunId = requestedPayload.implementation_run_id as string;
    const policySnapshot = requestedPayload.policy_snapshot as ValidationPolicySnapshot;
    const policySnapshotHash = requestedPayload.policy_snapshot_hash as string;
    const implRun = this.runRepo.getById(implementationRunId);
    if (!implRun || !implRun.adapter_identity) { this.blockIssue(issue.id, ValidationBlockReason.RecoveryInconsistent, "Implementation run not found or missing identity"); return; }
    if (!validatorRun.adapter_identity) { this.blockIssue(issue.id, ValidationBlockReason.RecoveryInconsistent, "Validator run missing adapter identity"); return; }
    const implIdentity = implRun.adapter_identity;
    const valIdentity = validatorRun.adapter_identity;
    const ev = collectImplementationEvidence(this.threadEventRepo, this.fileChangeRepo, validatorRun.thread_id, implementationRunId);
    const hasFileChanges = ev.fileChanges.length > 0;
    const gateResult = checkEvidenceRequirements(policySnapshot, {
      handoffResolved: ev.handoffEvent !== null, fileChangeSetRefPresent: hasFileChanges,
      fileTraceStatus: hasFileChanges ? "complete" as const : "unavailable" as const,
      confirmedVerifications: ev.verifications.filter((v) => v.result === "passed").map((v) => ({ kind: v.kind, result: v.result })),
    });
    if (!gateResult.passed) { this.blockIssue(issue.id, gateResult.blockReason ?? ValidationBlockReason.EvidenceMissing, "Policy gate failed: " + gateResult.missingEvidence.join(", ")); return; }
    const evSummary: EvidenceSummaryBuildInput = {
      issue: { id: issue.id, title: issue.title, goal: issue.goal, thread_id: issue.primary_thread_id! },
      implementationRun: { id: implementationRunId, identity: implIdentity },
      validatorRun: { id: validatorRun.id, identity: valIdentity },
      policySnapshot, policySnapshotHash, result, handoff: ev.handoff,
      verifications: ev.verifications,
      fileChanges: ev.fileChanges,
      commands: ev.commands, passEventId: "",
      traceCompleteness: {
        commands: ev.commandsTruncated ? TraceCompletenessStatus.Partial : TraceCompletenessStatus.Complete,
        verification: ev.verifications.length > 0 ? (ev.verificationsTruncated ? TraceCompletenessStatus.Partial : TraceCompletenessStatus.Complete) : TraceCompletenessStatus.Unavailable,
        file_changes: hasFileChanges ? TraceCompletenessStatus.Complete : TraceCompletenessStatus.Unavailable,
        refs: TraceCompletenessStatus.Complete, reasons: [],
      },
    };
    const summaryBuildResult = buildEvidenceSummary(evSummary);
    const sameOriginValidation = summaryBuildResult.sameOriginValidation;
    const evidenceSummaryOrNull = this.db.transaction(() => {
      const freshIssue = this.issueRepo.getById(issue.id);
      if (!freshIssue || freshIssue.status !== IssueStatus.Validating) return null;
      const freshValidatorRun = this.runRepo.getById(validatorRun.id);
      if (!freshValidatorRun || freshValidatorRun.status !== RunStatus.Completed) return null;
      if (freshValidatorRun.validation_round !== freshIssue.validation_round_count + 1) return null;
      if (resultEventExistsForValidatorRun(this.threadEventRepo, validatorRun.thread_id, validatorRun.id)) return null;
      const passEvent = this.validationTraceService.writePassed({
        issueId: issue.id,
        threadId: validatorRun.thread_id,
        workspaceId: issue.workspace_id,
        validationRound: validatorRun.validation_round!,
        summary: result.summary,
        findingCount: 0,
        policyId: policySnapshot.policy_id,
        policyVersion: policySnapshot.version,
        sameOriginValidation,
        validatorRunId: validatorRun.id,
        implementationRunId,
        evidenceRefs: result.evidence_refs,
      });
      pendingEvents.push(passEvent);
      const finalSummary = buildEvidenceSummary({ ...evSummary, passEventId: passEvent.id });
      const summaryRecord = this.evidenceSummaryRepo.createIfAbsent({
        issue_id: issue.id, thread_id: validatorRun.thread_id,
        validator_run_id: validatorRun.id, implementation_run_id: implementationRunId,
        validation_result: ValidationOutcome.Passed, evidence_refs: finalSummary.evidenceRefs,
        summary_markdown: finalSummary.markdown, same_origin_validation: finalSummary.sameOriginValidation,
        implementation_identity: implIdentity, validator_identity: valIdentity,
        policy_id: policySnapshot.policy_id, policy_version: policySnapshot.version,
        policy_snapshot: policySnapshot, policy_snapshot_hash: policySnapshotHash,
      });
      const casResult = this.issueRepo.compareAndSetStatus(issue.id, IssueStatus.Validating, IssueStatus.Done);
      if (!casResult.success) return null;
      pendingEvents.push(this.validationTraceService.writeIssueDone({
        issueId: issue.id,
        threadId: validatorRun.thread_id,
        workspaceId: issue.workspace_id,
        validationRound: validatorRun.validation_round!,
        previousStatus: IssueStatus.Validating,
        evidenceSummaryId: summaryRecord.id,
        validationEventId: passEvent.id,
        evidenceRefs: finalSummary.evidenceRefs,
      }));
      return summaryRecord;
    })();
    if (!evidenceSummaryOrNull) return;
    for (const event of pendingEvents) this.threadEventService.broadcast(event);
  }

  private processFailed(validatorRun: Run, result: ValidationResultEnvelope, issue: Issue): void {
    const pendingEvents: ThreadEvent[] = [];
    const requestedEvent = findRequestedEvent(this.threadEventRepo, validatorRun.thread_id, validatorRun.id);
    if (!requestedEvent) return;
    const requestedPayload = requestedEvent.payload_json;
    const implementationRunId = requestedPayload.implementation_run_id as string;
    const policySnapshot = requestedPayload.policy_snapshot as ValidationPolicySnapshot;
    const maxRounds = policySnapshot.max_validation_rounds;
    const nextCount = issue.validation_round_count + 1;
    const roundLimitBlocked = nextCount >= maxRounds;
    const success = this.db.transaction(() => {
      const freshIssue = this.issueRepo.getById(issue.id);
      if (!freshIssue || freshIssue.status !== IssueStatus.Validating) return false;
      const freshValidatorRun = this.runRepo.getById(validatorRun.id);
      if (!freshValidatorRun || freshValidatorRun.status !== RunStatus.Completed) return false;
      if (freshValidatorRun.validation_round !== freshIssue.validation_round_count + 1) return false;
      if (resultEventExistsForValidatorRun(this.threadEventRepo, validatorRun.thread_id, validatorRun.id)) return false;
      this.pushFindingEvents(pendingEvents, validatorRun, issue, implementationRunId, result.findings);
      const nextStatus = roundLimitBlocked ? IssueStatus.Blocked : IssueStatus.Running;
      pendingEvents.push(this.validationTraceService.writeFailed({
        issueId: issue.id,
        threadId: validatorRun.thread_id,
        workspaceId: issue.workspace_id,
        validationRound: validatorRun.validation_round!,
        summary: result.summary,
        findingCount: result.findings.length,
        nextStatus,
        validatorRunId: validatorRun.id,
        implementationRunId,
        evidenceRefs: result.evidence_refs,
      }));
      if (roundLimitBlocked) {
        const casResult = this.issueRepo.compareAndSetStatus(issue.id, IssueStatus.Validating, IssueStatus.Blocked, {
          validation_round_count: nextCount,
          blocked_reason_code: ValidationBlockReason.RoundLimitReached,
          blocked_reason_message: `Validation round limit reached (${nextCount}/${maxRounds})`,
        });
        if (!casResult.success) return false;
        pendingEvents.push(this.validationTraceService.writeBlocked({
          issueId: issue.id,
          threadId: validatorRun.thread_id,
          workspaceId: issue.workspace_id,
          validationRound: validatorRun.validation_round!,
          summary: result.summary,
          reasonCode: ValidationBlockReason.RoundLimitReached,
          findingCount: result.findings.length,
          missingEvidence: result.missing_evidence,
          validatorRunId: validatorRun.id,
          implementationRunId,
          evidenceRefs: result.evidence_refs,
        }));
      } else {
        const casResult = this.issueRepo.compareAndSetStatus(issue.id, IssueStatus.Validating, IssueStatus.Running, {
          validation_round_count: nextCount,
        });
        if (!casResult.success) return false;
      }
      return true;
    })();
    if (!success) return;
    for (const event of pendingEvents) this.threadEventService.broadcast(event);
  }

  private blockIssue(issueId: string, reason: ValidationBlockReason, message: string): void {
    const pendingEvents: ThreadEvent[] = [];
    this.db.transaction(() => {
      const issue = this.issueRepo.getById(issueId);
      if (!issue) return;
      if (issue.status !== IssueStatus.Running && issue.status !== IssueStatus.Validating) return;
      this.blockIssueInTx(issue, reason, message, pendingEvents);
    })();
    for (const event of pendingEvents) this.threadEventService.broadcast(event);
  }

  private blockIssueInTx(issue: Issue, reason: ValidationBlockReason, message: string, pendingEvents: ThreadEvent[]): void {
    const casResult = this.issueRepo.compareAndSetStatus(issue.id, issue.status, IssueStatus.Blocked, { blocked_reason_code: reason, blocked_reason_message: message });
    if (!casResult.success) return;
    pendingEvents.push(this.threadEventService.write(issue.primary_thread_id!, ThreadEventType.ValidationBlocked, ActorType.System, null, {
      issue_id: issue.id, thread_id: issue.primary_thread_id!, workspace_id: issue.workspace_id,
      validation_round: issue.validation_round_count + 1, summary: message, reason_code: reason,
    }));
  }

  blockValidation(issueId: string, validatorRunId: string, reason: ValidationBlockReason): void {
    this.blockIssue(issueId, reason, `Validator run ${validatorRunId} blocked: ${reason}`);
  }

  private pushFindingEvents(pendingEvents: ThreadEvent[], validatorRun: Run, issue: Issue, implementationRunId: string, findings: ValidationFinding[]): void {
    for (let i = 0; i < findings.length; i++) {
      const finding = findings[i];
      pendingEvents.push(this.validationTraceService.writeFinding({
        issueId: issue.id,
        threadId: validatorRun.thread_id,
        workspaceId: issue.workspace_id,
        validationRound: validatorRun.validation_round!,
        severity: finding.severity,
        message: finding.message,
        suggestion: finding.suggestion ?? undefined,
        filePath: finding.file_path ?? undefined,
        line: finding.line ?? undefined,
        findingIndex: i,
        validatorRunId: validatorRun.id,
        implementationRunId: implementationRunId,
        evidenceRefs: finding.evidence_refs,
      }));
    }
  }

  private processBlocked(validatorRun: Run, result: ValidationResultEnvelope, issue: Issue): void {
    const pendingEvents: ThreadEvent[] = [];
    const requestedEvent = findRequestedEvent(this.threadEventRepo, validatorRun.thread_id, validatorRun.id);
    if (!requestedEvent) return;
    const implementationRunId = requestedEvent.payload_json.implementation_run_id as string;
    const reason = ValidationBlockReason.EvidenceMissing;
    const message = result.summary;
    const success = this.db.transaction(() => {
      const freshIssue = this.issueRepo.getById(issue.id);
      if (!freshIssue || freshIssue.status !== IssueStatus.Validating) return false;
      const freshValidatorRun = this.runRepo.getById(validatorRun.id);
      if (!freshValidatorRun || freshValidatorRun.status !== RunStatus.Completed) return false;
      if (freshValidatorRun.validation_round !== freshIssue.validation_round_count + 1) return false;
      if (resultEventExistsForValidatorRun(this.threadEventRepo, validatorRun.thread_id, validatorRun.id)) return false;
      this.pushFindingEvents(pendingEvents, validatorRun, issue, implementationRunId, result.findings);
      const casResult = this.issueRepo.compareAndSetStatus(issue.id, IssueStatus.Validating, IssueStatus.Blocked, {
        blocked_reason_code: reason, blocked_reason_message: message,
      });
      if (!casResult.success) return false;
      pendingEvents.push(this.validationTraceService.writeBlocked({
        issueId: issue.id,
        threadId: validatorRun.thread_id,
        workspaceId: issue.workspace_id,
        validationRound: validatorRun.validation_round!,
        summary: message,
        reasonCode: reason,
        findingCount: result.findings.length,
        missingEvidence: result.missing_evidence,
        validatorRunId: validatorRun.id,
        implementationRunId,
        evidenceRefs: result.evidence_refs,
      }));
      return true;
    })();
    if (!success) return;
    for (const event of pendingEvents) this.threadEventService.broadcast(event);
  }
}
