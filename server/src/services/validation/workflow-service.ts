import type Database from "better-sqlite3";
import type { Issue, Run, ThreadEvent, AdapterIdentitySnapshot, ValidationPolicySnapshot, ValidationResultEnvelope, ValidationFinding } from "@personahub/shared/types";
import { IssueStatus, RunRole, RunDispatchSource, RunStatus, ThreadEventType, ActorType, ValidationBlockReason, ValidationOutcome, TraceCompletenessStatus } from "@personahub/shared/types";
import type { IssueRepository } from "../../repositories/issue.js";
import type { RunRepository } from "../../repositories/run.js";
import type { AgentConfigRepository } from "../../repositories/agent-config.js";
import type { WorkflowTemplateRepository } from "../../repositories/workflow-template.js";
import type { ValidationPolicyRepository } from "../../repositories/validation-policy.js";
import type { ThreadEventRepository } from "../../repositories/thread-event.js";
import type { FileChangeRepository } from "../../repositories/file-change.js";
import type { EvidenceSummaryRepository } from "../../repositories/evidence-summary.js";
import type { ValidationTraceService } from "../validation-trace.js";
import type { ThreadEventService } from "../thread-event.js";
import { selectValidator } from "./validator-selector.js";
import { buildPolicySnapshot, hashPolicySnapshot, checkEvidenceRequirements } from "./policy-gate.js";
import { parseValidationResult } from "./result-parser.js";
import { buildEvidenceSummary, type EvidenceSummaryBuildInput, type SummaryVerificationEvent } from "./evidence-summary-builder.js";
import { assembleValidatorContext } from "./context-assembler.js";
import { findRequestedEvent, resultEventExistsForValidatorRun, getFinalMessage, collectImplementationEvidence } from "./workflow-queries.js";

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
  ) {}

  requestValidation(issueId: string, implementationRunId: string): Run | null {
    const pendingEvents: ThreadEvent[] = [];
    const result = this.db.transaction(() => {
      const issue = this.issueRepo.getById(issueId);
      if (!issue) return null;
      if (issue.status === IssueStatus.Validating) {
        const active = this.runRepo.getActiveValidator(issueId);
        if (active) return active;
        // No active validator - proceed to create one (manual retry path)
      } else if (issue.status !== IssueStatus.Running) {
        return null;
      }
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
      const availableValidators = this.agentConfigRepo.listAvailableByProjectAndRole(issue.project_id, RunRole.Validator);
      const selectorResult = selectValidator({ workflowTemplate: wf, availableValidators });
      if (!selectorResult.selected) {
        this.blockIssueInTx(issue, selectorResult.reason ?? ValidationBlockReason.ValidatorUnavailable, selectorResult.message, pendingEvents);
        return null;
      }
      const round = issue.validation_round_count + 1;
      if (issue.status === IssueStatus.Running) {
        const casResult = this.issueRepo.compareAndSetStatus(issueId, IssueStatus.Running, IssueStatus.Validating, { blocked_reason_code: null, blocked_reason_message: null });
        if (!casResult.success) {
          const freshIssue = this.issueRepo.getById(issueId);
          if (freshIssue?.status === IssueStatus.Validating) {
            const active = this.runRepo.getActiveValidator(issueId);
            if (active && active.validation_round === round) return active;
            this.blockIssueInTx(freshIssue, ValidationBlockReason.RecoveryInconsistent, "Concurrent validation request with mismatched round", pendingEvents);
            return null;
          }
          return null;
        }
      }
      const validatorIdentity: AdapterIdentitySnapshot = {
        adapter_config_id: selectorResult.selected.id, name: selectorResult.selected.name,
        cli_provider: selectorResult.selected.cli_provider, default_model: selectorResult.selected.default_model,
      };
      const validatorRun = this.runRepo.create({
        issue_id: issueId, thread_id: issue.primary_thread_id!, workspace_id: issue.workspace_id,
        adapter_config_id: selectorResult.selected.id, instructions: "", status: RunStatus.Queued,
        role: RunRole.Validator, dispatch_source: RunDispatchSource.System, validation_round: round, adapter_identity: validatorIdentity,
      });
      try {
        const ctx = assembleValidatorContext(
          { threadEventRepo: this.threadEventRepo, fileChangeRepo: this.fileChangeRepo },
          {
            issue: { title: issue.title, goal: issue.goal },
            threadId: issue.primary_thread_id!,
            implementationRunId,
            implementationRun: { id: implementationRunId, identity: implRun.adapter_identity! },
            validatorRun: { id: validatorRun.id, identity: validatorIdentity },
            policySnapshot, policySnapshotHash: snapshotHash, validationRound: round,
          },
        );
        this.runRepo.updateInstructions(validatorRun.id, ctx.markdown);
      } catch {
        const freshIssue = this.issueRepo.getById(issueId);
        if (freshIssue) this.blockIssueInTx(freshIssue, ValidationBlockReason.WorkflowConfigurationInvalid, "Failed to build validator context", pendingEvents);
        return null;
      }
      pendingEvents.push(this.threadEventService.write(issue.primary_thread_id!, ThreadEventType.ValidationRequested, ActorType.System, null, {
        issue_id: issueId, thread_id: issue.primary_thread_id!, workspace_id: issue.workspace_id,
        validation_round: round, target: "implementation_result", policy_id: policy.id, policy_version: policy.version,
        policy_snapshot: policySnapshot, policy_snapshot_hash: snapshotHash,
        validator_run_id: validatorRun.id, implementation_run_id: implementationRunId, requested_by_run_id: implementationRunId,
      }));
      pendingEvents.push(this.threadEventService.write(issue.primary_thread_id!, ThreadEventType.RunQueued, ActorType.System, null, {
        run_id: validatorRun.id, issue_id: issueId, thread_id: issue.primary_thread_id!,
        workspace_id: issue.workspace_id, status: RunStatus.Queued, role: RunRole.Validator, validation_round: round,
      }));
      return validatorRun;
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
    if (parsedResult.outcome === ValidationOutcome.Passed) void this.processPassed(validatorRun, parsedResult, issue);
    else if (parsedResult.outcome === ValidationOutcome.Failed) void this.processFailed(validatorRun, parsedResult, issue);
    else if (parsedResult.outcome === ValidationOutcome.Blocked) void this.processBlocked(validatorRun, parsedResult, issue);
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
        commands: TraceCompletenessStatus.Complete,
        verification: ev.verifications.length > 0 ? TraceCompletenessStatus.Complete : TraceCompletenessStatus.Unavailable,
        file_changes: hasFileChanges ? TraceCompletenessStatus.Complete : TraceCompletenessStatus.Unavailable,
        refs: TraceCompletenessStatus.Complete, reasons: [],
      },
    };
    const summaryBuildResult = buildEvidenceSummary(evSummary);
    const evidenceSummaryOrNull = this.db.transaction(() => {
      const freshIssue = this.issueRepo.getById(issue.id);
      if (!freshIssue || freshIssue.status !== IssueStatus.Validating) return null;
      const freshValidatorRun = this.runRepo.getById(validatorRun.id);
      if (!freshValidatorRun || freshValidatorRun.status !== RunStatus.Completed) return null;
      if (freshValidatorRun.validation_round !== freshIssue.validation_round_count + 1) return null;
      if (resultEventExistsForValidatorRun(this.threadEventRepo, validatorRun.thread_id, validatorRun.id)) return null;
      const passEvent = this.threadEventService.write(validatorRun.thread_id, ThreadEventType.ValidationPassed, ActorType.System, null, {
        issue_id: issue.id, thread_id: validatorRun.thread_id, workspace_id: issue.workspace_id,
        validation_round: validatorRun.validation_round, summary: result.summary,
        validator_run_id: validatorRun.id, implementation_run_id: implementationRunId, result: "passed", finding_count: 0,
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
      pendingEvents.push(this.threadEventService.write(validatorRun.thread_id, ThreadEventType.IssueDone, ActorType.System, null, {
        issue_id: issue.id, thread_id: validatorRun.thread_id, workspace_id: issue.workspace_id,
        validation_round: validatorRun.validation_round, previous_status: IssueStatus.Validating,
        evidence_summary_id: summaryRecord.id, validation_event_id: passEvent.id,
      }, finalSummary.evidenceRefs));
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
      pendingEvents.push(this.threadEventService.write(
        validatorRun.thread_id, ThreadEventType.ValidationFailed, ActorType.System, null,
        {
          issue_id: issue.id, thread_id: validatorRun.thread_id, workspace_id: issue.workspace_id,
          validation_round: validatorRun.validation_round, summary: result.summary,
          finding_count: result.findings.length, next_status: nextStatus,
          validator_run_id: validatorRun.id, implementation_run_id: implementationRunId,
        },
      ));
      if (roundLimitBlocked) {
        const casResult = this.issueRepo.compareAndSetStatus(issue.id, IssueStatus.Validating, IssueStatus.Blocked, {
          validation_round_count: nextCount,
          blocked_reason_code: ValidationBlockReason.RoundLimitReached,
          blocked_reason_message: `Validation round limit reached (${nextCount}/${maxRounds})`,
        });
        if (!casResult.success) return false;
        pendingEvents.push(this.threadEventService.write(
          validatorRun.thread_id, ThreadEventType.ValidationBlocked, ActorType.System, null,
          {
            issue_id: issue.id, thread_id: validatorRun.thread_id, workspace_id: issue.workspace_id,
            validation_round: validatorRun.validation_round, summary: result.summary,
            reason_code: ValidationBlockReason.RoundLimitReached,
            validator_run_id: validatorRun.id, implementation_run_id: implementationRunId,
          },
        ));
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
      pendingEvents.push(this.threadEventService.write(
        validatorRun.thread_id, ThreadEventType.ValidationFinding, ActorType.System, null,
        {
          issue_id: issue.id, thread_id: validatorRun.thread_id, workspace_id: issue.workspace_id,
          validation_round: validatorRun.validation_round,
          severity: finding.severity, message: finding.message, finding_index: i,
          suggestion: finding.suggestion, file_path: finding.file_path, line: finding.line,
          validator_run_id: validatorRun.id, implementation_run_id: implementationRunId,
        },
        finding.evidence_refs,
      ));
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
      pendingEvents.push(this.threadEventService.write(
        validatorRun.thread_id, ThreadEventType.ValidationBlocked, ActorType.System, null,
        {
          issue_id: issue.id, thread_id: validatorRun.thread_id, workspace_id: issue.workspace_id,
          validation_round: validatorRun.validation_round, summary: message, reason_code: reason,
          finding_count: result.findings.length, missing_evidence: result.missing_evidence,
          validator_run_id: validatorRun.id, implementation_run_id: implementationRunId,
        },
      ));
      return true;
    })();
    if (!success) return;
    for (const event of pendingEvents) this.threadEventService.broadcast(event);
  }
}
