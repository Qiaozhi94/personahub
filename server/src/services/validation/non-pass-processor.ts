import type Database from "better-sqlite3";
import type {
  Issue,
  Run,
  ThreadEvent,
  ValidationFinding,
  ValidationPolicySnapshot,
  ValidationResultEnvelope,
} from "@personahub/shared/types";
import { IssueStatus, RunStatus, ValidationBlockReason } from "@personahub/shared/types";
import type { IssueRepository } from "../../repositories/issue.js";
import type { RunRepository } from "../../repositories/run.js";
import type { ThreadEventRepository } from "../../repositories/thread-event.js";
import type { ThreadEventService } from "../thread-event.js";
import type { ValidationTraceService } from "../validation-trace.js";
import { findRequestedEvent, resultEventExistsForValidatorRun } from "./workflow-queries.js";

export class ValidationNonPassProcessor {
  constructor(
    private db: Database.Database,
    private issueRepo: IssueRepository,
    private runRepo: RunRepository,
    private threadEventService: ThreadEventService,
    private threadEventRepo: ThreadEventRepository,
    private validationTraceService: ValidationTraceService,
  ) {}

  processFailed(validatorRun: Run, result: ValidationResultEnvelope, issue: Issue): void {
    const pendingEvents: ThreadEvent[] = [];
    const requestedEvent = findRequestedEvent(this.threadEventRepo, validatorRun.thread_id, validatorRun.id);
    if (!requestedEvent) return;
    const implementationRunId = requestedEvent.payload_json.implementation_run_id as string;
    const policySnapshot = requestedEvent.payload_json.policy_snapshot as ValidationPolicySnapshot;
    const nextCount = issue.validation_round_count + 1;
    const roundLimitBlocked = nextCount >= policySnapshot.max_validation_rounds;

    const completed = this.db.transaction(() => {
      const freshIssue = this.issueRepo.getById(issue.id);
      const freshRun = this.runRepo.getById(validatorRun.id);
      if (!freshIssue || freshIssue.status !== IssueStatus.Validating) return false;
      if (!freshRun || freshRun.status !== RunStatus.Completed) return false;
      if (freshRun.validation_round !== freshIssue.validation_round_count + 1) return false;
      if (resultEventExistsForValidatorRun(this.threadEventRepo, validatorRun.thread_id, validatorRun.id)) return false;

      this.pushFindingEvents(pendingEvents, validatorRun, issue, implementationRunId, result.findings);
      const nextStatus = roundLimitBlocked ? IssueStatus.Blocked : IssueStatus.Running;
      pendingEvents.push(
        this.validationTraceService.writeFailed({
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
        }),
      );

      const casResult = this.issueRepo.compareAndSetStatus(
        issue.id,
        IssueStatus.Validating,
        nextStatus,
        roundLimitBlocked
          ? {
              validation_round_count: nextCount,
              blocked_reason_code: ValidationBlockReason.RoundLimitReached,
              blocked_reason_message: `Validation round limit reached (${nextCount}/${policySnapshot.max_validation_rounds})`,
            }
          : { validation_round_count: nextCount },
      );
      if (!casResult.success) return false;
      if (roundLimitBlocked) {
        pendingEvents.push(
          this.validationTraceService.writeBlocked({
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
          }),
        );
      }
      return true;
    })();
    if (completed) for (const event of pendingEvents) this.threadEventService.broadcast(event);
  }

  processBlocked(validatorRun: Run, result: ValidationResultEnvelope, issue: Issue): void {
    const pendingEvents: ThreadEvent[] = [];
    const requestedEvent = findRequestedEvent(this.threadEventRepo, validatorRun.thread_id, validatorRun.id);
    if (!requestedEvent) return;
    const implementationRunId = requestedEvent.payload_json.implementation_run_id as string;
    const completed = this.db.transaction(() => {
      const freshIssue = this.issueRepo.getById(issue.id);
      const freshRun = this.runRepo.getById(validatorRun.id);
      if (!freshIssue || freshIssue.status !== IssueStatus.Validating) return false;
      if (!freshRun || freshRun.status !== RunStatus.Completed) return false;
      if (freshRun.validation_round !== freshIssue.validation_round_count + 1) return false;
      if (resultEventExistsForValidatorRun(this.threadEventRepo, validatorRun.thread_id, validatorRun.id)) return false;
      this.pushFindingEvents(pendingEvents, validatorRun, issue, implementationRunId, result.findings);
      const cas = this.issueRepo.compareAndSetStatus(issue.id, IssueStatus.Validating, IssueStatus.Blocked, {
        blocked_reason_code: ValidationBlockReason.EvidenceMissing,
        blocked_reason_message: result.summary,
      });
      if (!cas.success) return false;
      pendingEvents.push(
        this.validationTraceService.writeBlocked({
          issueId: issue.id,
          threadId: validatorRun.thread_id,
          workspaceId: issue.workspace_id,
          validationRound: validatorRun.validation_round!,
          summary: result.summary,
          reasonCode: ValidationBlockReason.EvidenceMissing,
          findingCount: result.findings.length,
          missingEvidence: result.missing_evidence,
          validatorRunId: validatorRun.id,
          implementationRunId,
          evidenceRefs: result.evidence_refs,
        }),
      );
      return true;
    })();
    if (completed) for (const event of pendingEvents) this.threadEventService.broadcast(event);
  }

  private pushFindingEvents(
    pendingEvents: ThreadEvent[],
    validatorRun: Run,
    issue: Issue,
    implementationRunId: string,
    findings: ValidationFinding[],
  ): void {
    findings.forEach((finding, findingIndex) => {
      pendingEvents.push(
        this.validationTraceService.writeFinding({
          issueId: issue.id,
          threadId: validatorRun.thread_id,
          workspaceId: issue.workspace_id,
          validationRound: validatorRun.validation_round!,
          severity: finding.severity,
          message: finding.message,
          suggestion: finding.suggestion ?? undefined,
          filePath: finding.file_path ?? undefined,
          line: finding.line ?? undefined,
          findingIndex,
          validatorRunId: validatorRun.id,
          implementationRunId,
          evidenceRefs: finding.evidence_refs,
        }),
      );
    });
  }
}
