import type Database from "better-sqlite3";
import type {
  Issue,
  Run,
  ThreadEvent,
  ValidationPolicySnapshot,
  ValidationResultEnvelope,
} from "@personahub/shared/types";
import {
  IssueStatus,
  RunRole,
  RunStatus,
  TraceCompletenessStatus,
  ValidationBlockReason,
  ValidationOutcome,
} from "@personahub/shared/types";
import { ErrorCode } from "@personahub/shared/errors";
import type { EvidenceSummaryRepository } from "../../repositories/evidence-summary.js";
import type { FileChangeRepository } from "../../repositories/file-change.js";
import type { IssueRepository } from "../../repositories/issue.js";
import type { RunRepository } from "../../repositories/run.js";
import type { ThreadEventRepository } from "../../repositories/thread-event.js";
import { AppError } from "../../api/errors.js";
import type { ThreadEventService } from "../thread-event.js";
import type { ValidationTraceService } from "../validation-trace.js";
import { buildEvidenceSummary, type EvidenceSummaryBuildInput } from "./evidence-summary-builder.js";
import { checkEvidenceRequirements } from "./policy-gate.js";
import { parseValidationResult } from "./result-parser.js";
import {
  collectImplementationEvidence,
  findRequestedEvent,
  getFinalMessage,
  resultEventExistsForValidatorRun,
} from "./workflow-queries.js";
import { ValidationIssueBlocker } from "./issue-blocker.js";
import { ValidationNonPassProcessor } from "./non-pass-processor.js";

export class ValidationResultProcessor {
  private readonly nonPassProcessor: ValidationNonPassProcessor;

  constructor(
    private db: Database.Database,
    private issueRepo: IssueRepository,
    private runRepo: RunRepository,
    private threadEventService: ThreadEventService,
    private threadEventRepo: ThreadEventRepository,
    private validationTraceService: ValidationTraceService,
    private evidenceSummaryRepo: EvidenceSummaryRepository,
    private fileChangeRepo: FileChangeRepository,
    private blocker: ValidationIssueBlocker,
  ) {
    this.nonPassProcessor = new ValidationNonPassProcessor(
      db,
      issueRepo,
      runRepo,
      threadEventService,
      threadEventRepo,
      validationTraceService,
    );
  }

  process(validatorRunId: string): void {
    const validatorRun = this.runRepo.getById(validatorRunId);
    if (!validatorRun || validatorRun.role !== RunRole.Validator) return;
    if ([RunStatus.Failed, RunStatus.Cancelled, RunStatus.Interrupted].includes(validatorRun.status)) {
      this.blocker.blockIssue(
        validatorRun.issue_id,
        ValidationBlockReason.ValidatorRunFailed,
        `Validator run terminated with status: ${validatorRun.status}`,
      );
      return;
    }
    if (validatorRun.status !== RunStatus.Completed) return;
    const issue = this.issueRepo.getById(validatorRun.issue_id);
    if (!issue || issue.status !== IssueStatus.Validating) return;
    const finalMessage = getFinalMessage(this.db, validatorRunId);
    if (!finalMessage) {
      this.blocker.blockIssue(issue.id, ValidationBlockReason.ResultUnparsable, "Validator run has no final message");
      return;
    }

    let result: ValidationResultEnvelope;
    try {
      result = parseValidationResult(finalMessage);
    } catch {
      this.blocker.blockIssue(
        issue.id,
        ValidationBlockReason.ResultUnparsable,
        "Failed to parse validator final message",
      );
      return;
    }

    try {
      if (result.outcome === ValidationOutcome.Passed) this.processPassed(validatorRun, result, issue);
      else if (result.outcome === ValidationOutcome.Failed)
        this.nonPassProcessor.processFailed(validatorRun, result, issue);
      else this.nonPassProcessor.processBlocked(validatorRun, result, issue);
    } catch (error) {
      if (!this.handleEvidenceScopeError(error, issue.id)) throw error;
    }
  }

  private handleEvidenceScopeError(error: unknown, issueId: string): boolean {
    if (!(error instanceof AppError)) return false;
    if (error.code !== ErrorCode.EVIDENCE_SCOPE_MISMATCH && error.code !== ErrorCode.EVIDENCE_REF_INVALID) return false;
    this.blocker.blockIssue(
      issueId,
      error.code === ErrorCode.EVIDENCE_SCOPE_MISMATCH
        ? ValidationBlockReason.EvidenceScopeMismatch
        : ValidationBlockReason.EvidenceMissing,
      error.message,
    );
    return true;
  }

  private processPassed(validatorRun: Run, result: ValidationResultEnvelope, issue: Issue): void {
    const pendingEvents: ThreadEvent[] = [];
    const requestedEvent = findRequestedEvent(this.threadEventRepo, validatorRun.thread_id, validatorRun.id);
    if (!requestedEvent) return;
    const payload = requestedEvent.payload_json;
    const implementationRunId = payload.implementation_run_id as string;
    const policySnapshot = payload.policy_snapshot as ValidationPolicySnapshot;
    const policySnapshotHash = payload.policy_snapshot_hash as string;
    const implRun = this.runRepo.getById(implementationRunId);
    if (!implRun?.adapter_identity) {
      this.blocker.blockIssue(
        issue.id,
        ValidationBlockReason.RecoveryInconsistent,
        "Implementation run not found or missing identity",
      );
      return;
    }
    if (!validatorRun.adapter_identity) {
      this.blocker.blockIssue(
        issue.id,
        ValidationBlockReason.RecoveryInconsistent,
        "Validator run missing adapter identity",
      );
      return;
    }
    const implementationIdentity = implRun.adapter_identity;
    const validatorIdentity = validatorRun.adapter_identity;

    const evidence = collectImplementationEvidence(
      this.threadEventRepo,
      this.fileChangeRepo,
      validatorRun.thread_id,
      implementationRunId,
    );
    const hasFileChanges = evidence.fileChanges.length > 0;
    const gateResult = checkEvidenceRequirements(policySnapshot, {
      handoffResolved: evidence.handoffEvent !== null,
      fileChangeSetRefPresent: hasFileChanges,
      fileTraceStatus: hasFileChanges ? "complete" : "unavailable",
      confirmedVerifications: evidence.verifications
        .filter((verification) => verification.result === "passed")
        .map((verification) => ({ kind: verification.kind, result: verification.result })),
    });
    if (!gateResult.passed) {
      this.blocker.blockIssue(
        issue.id,
        gateResult.blockReason ?? ValidationBlockReason.EvidenceMissing,
        `Policy gate failed: ${gateResult.missingEvidence.join(", ")}`,
      );
      return;
    }

    const summaryInput: EvidenceSummaryBuildInput = {
      issue: { id: issue.id, title: issue.title, goal: issue.goal, thread_id: issue.primary_thread_id! },
      implementationRun: { id: implementationRunId, identity: implementationIdentity },
      validatorRun: { id: validatorRun.id, identity: validatorIdentity },
      policySnapshot,
      policySnapshotHash,
      result,
      handoff: evidence.handoff,
      verifications: evidence.verifications,
      fileChanges: evidence.fileChanges,
      commands: evidence.commands,
      passEventId: "",
      traceCompleteness: {
        commands: evidence.commandsTruncated ? TraceCompletenessStatus.Partial : TraceCompletenessStatus.Complete,
        verification:
          evidence.verifications.length > 0
            ? evidence.verificationsTruncated
              ? TraceCompletenessStatus.Partial
              : TraceCompletenessStatus.Complete
            : TraceCompletenessStatus.Unavailable,
        file_changes: hasFileChanges ? TraceCompletenessStatus.Complete : TraceCompletenessStatus.Unavailable,
        refs: TraceCompletenessStatus.Complete,
        reasons: [],
      },
    };
    const sameOriginValidation = buildEvidenceSummary(summaryInput).sameOriginValidation;

    const completed = this.db.transaction(() => {
      const freshIssue = this.issueRepo.getById(issue.id);
      const freshRun = this.runRepo.getById(validatorRun.id);
      if (!freshIssue || freshIssue.status !== IssueStatus.Validating) return false;
      if (!freshRun || freshRun.status !== RunStatus.Completed) return false;
      if (freshRun.validation_round !== freshIssue.validation_round_count + 1) return false;
      if (resultEventExistsForValidatorRun(this.threadEventRepo, validatorRun.thread_id, validatorRun.id)) return false;

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
      const finalSummary = buildEvidenceSummary({ ...summaryInput, passEventId: passEvent.id });
      const summaryRecord = this.evidenceSummaryRepo.createIfAbsent({
        issue_id: issue.id,
        thread_id: validatorRun.thread_id,
        validator_run_id: validatorRun.id,
        implementation_run_id: implementationRunId,
        validation_result: ValidationOutcome.Passed,
        evidence_refs: finalSummary.evidenceRefs,
        summary_markdown: finalSummary.markdown,
        same_origin_validation: finalSummary.sameOriginValidation,
        implementation_identity: implementationIdentity,
        validator_identity: validatorIdentity,
        policy_id: policySnapshot.policy_id,
        policy_version: policySnapshot.version,
        policy_snapshot: policySnapshot,
        policy_snapshot_hash: policySnapshotHash,
      });
      if (!this.issueRepo.compareAndSetStatus(issue.id, IssueStatus.Validating, IssueStatus.Done).success) return false;
      pendingEvents.push(
        this.validationTraceService.writeIssueDone({
          issueId: issue.id,
          threadId: validatorRun.thread_id,
          workspaceId: issue.workspace_id,
          validationRound: validatorRun.validation_round!,
          previousStatus: IssueStatus.Validating,
          evidenceSummaryId: summaryRecord.id,
          validationEventId: passEvent.id,
          evidenceRefs: finalSummary.evidenceRefs,
        }),
      );
      return true;
    })();
    if (completed) for (const event of pendingEvents) this.threadEventService.broadcast(event);
  }
}
