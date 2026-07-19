import type {
  ThreadEvent,
  ValidationFindingSeverity,
} from "@personahub/shared/types";
import {
  ThreadEventType,
  ActorType,
  RunRole,
} from "@personahub/shared/types";
import type { ThreadEventService } from "./thread-event.js";
import type { EvidenceService } from "./evidence.js";
import type { IssueRepository } from "../repositories/issue.js";
import type { RunRepository } from "../repositories/run.js";
import { AppError } from "../api/errors.js";
import { ErrorCode } from "@personahub/shared/errors";

export interface ValidationRequestedInput {
  issueId: string;
  threadId: string;
  workspaceId: string;
  validationRound: number;
  target: string;
  policyId: string;
  validatorRunId?: string;
  implementationRunId?: string;
  requestedByRunId?: string;
  evidenceRefs?: string[];
}

export interface ValidationFindingInput {
  issueId: string;
  threadId: string;
  workspaceId: string;
  validationRound: number;
  severity: ValidationFindingSeverity;
  message: string;
  suggestion?: string;
  filePath?: string;
  line?: number;
  findingIndex?: number;
  validatorRunId?: string;
  implementationRunId?: string;
  evidenceRefs?: string[];
}

export interface ValidationResultInput {
  issueId: string;
  threadId: string;
  workspaceId: string;
  validationRound: number;
  summary: string;
  validatorRunId?: string;
  implementationRunId?: string;
  findingCount?: number;
  reasonCode?: string;
  evidenceRefs?: string[];
}

export interface IssueDoneInput {
  issueId: string;
  threadId: string;
  workspaceId: string;
  validationRound: number;
  previousStatus: string;
  evidenceSummaryId: string;
  validationEventId: string;
  evidenceRefs?: string[];
}

export interface IssueUnblockedInput {
  issueId: string;
  threadId: string;
  workspaceId: string;
  previousStatus: string;
  operatorNote: string;
  previousBlockReason: string;
}

export class ValidationTraceService {
  constructor(
    private threadEventService: ThreadEventService,
    private evidenceService: EvidenceService,
    private issueRepo: IssueRepository,
    private runRepo: RunRepository,
  ) {}

  writeRequested(input: ValidationRequestedInput): ThreadEvent {
    this.validateScope(
      input.issueId, input.threadId, input.workspaceId, input.validationRound,
      input.validatorRunId, input.implementationRunId, input.evidenceRefs,
    );
    return this.threadEventService.write(
      input.threadId,
      ThreadEventType.ValidationRequested,
      ActorType.System,
      null,
      {
        issue_id: input.issueId,
        thread_id: input.threadId,
        workspace_id: input.workspaceId,
        validation_round: input.validationRound,
        target: input.target,
        policy_id: input.policyId,
        validator_run_id: input.validatorRunId ?? null,
        implementation_run_id: input.implementationRunId ?? null,
        requested_by_run_id: input.requestedByRunId ?? null,
      },
      input.evidenceRefs ?? [],
    );
  }

  writeFinding(input: ValidationFindingInput): ThreadEvent {
    this.validateScope(
      input.issueId, input.threadId, input.workspaceId, input.validationRound,
      input.validatorRunId, input.implementationRunId, input.evidenceRefs,
    );
    return this.threadEventService.write(
      input.threadId,
      ThreadEventType.ValidationFinding,
      ActorType.System,
      null,
      {
        issue_id: input.issueId,
        thread_id: input.threadId,
        workspace_id: input.workspaceId,
        validation_round: input.validationRound,
        severity: input.severity,
        message: input.message,
        finding_index: input.findingIndex ?? null,
        suggestion: input.suggestion ?? null,
        file_path: input.filePath ?? null,
        line: input.line ?? null,
        validator_run_id: input.validatorRunId ?? null,
        implementation_run_id: input.implementationRunId ?? null,
      },
      input.evidenceRefs ?? [],
    );
  }

  writePassed(input: ValidationResultInput): ThreadEvent {
    return this.writeResult(ThreadEventType.ValidationPassed, input, { result: "passed" });
  }

  writeFailed(input: ValidationResultInput & { findingCount: number }): ThreadEvent {
    return this.writeResult(ThreadEventType.ValidationFailed, input, { result: "failed", finding_count: input.findingCount });
  }

  writeBlocked(input: ValidationResultInput & { reasonCode: string }): ThreadEvent {
    return this.writeResult(ThreadEventType.ValidationBlocked, input, { result: "blocked", reason_code: input.reasonCode });
  }

  writeIssueDone(input: IssueDoneInput): ThreadEvent {
    this.validateScope(
      input.issueId, input.threadId, input.workspaceId, input.validationRound,
      undefined, undefined, input.evidenceRefs,
    );
    return this.threadEventService.write(
      input.threadId,
      ThreadEventType.IssueDone,
      ActorType.System,
      null,
      {
        issue_id: input.issueId,
        thread_id: input.threadId,
        workspace_id: input.workspaceId,
        validation_round: input.validationRound,
        previous_status: input.previousStatus,
        evidence_summary_id: input.evidenceSummaryId,
        validation_event_id: input.validationEventId,
      },
      input.evidenceRefs ?? [],
    );
  }

  writeIssueUnblocked(input: IssueUnblockedInput): ThreadEvent {
    this.validateScope(
      input.issueId, input.threadId, input.workspaceId, 0,
      undefined, undefined, undefined,
    );
    return this.threadEventService.write(
      input.threadId,
      ThreadEventType.IssueUnblocked,
      ActorType.System,
      null,
      {
        issue_id: input.issueId,
        thread_id: input.threadId,
        workspace_id: input.workspaceId,
        previous_status: input.previousStatus,
        status: "Ready",
        operator_note: input.operatorNote,
        previous_block_reason: input.previousBlockReason,
      },
    );
  }

  broadcast(event: ThreadEvent): void {
    this.threadEventService.broadcast(event);
  }

  broadcastAll(events: ThreadEvent[]): void {
    for (const event of events) {
      this.threadEventService.broadcast(event);
    }
  }

  private writeResult(
    type: ThreadEventType,
    input: ValidationResultInput,
    extra: Record<string, unknown>,
  ): ThreadEvent {
    this.validateScope(
      input.issueId, input.threadId, input.workspaceId, input.validationRound,
      input.validatorRunId, input.implementationRunId, input.evidenceRefs,
    );
    return this.threadEventService.write(
      input.threadId,
      type,
      ActorType.System,
      null,
      {
        issue_id: input.issueId,
        thread_id: input.threadId,
        workspace_id: input.workspaceId,
        validation_round: input.validationRound,
        summary: input.summary,
        validator_run_id: input.validatorRunId ?? null,
        implementation_run_id: input.implementationRunId ?? null,
        ...extra,
      },
      input.evidenceRefs ?? [],
    );
  }

  private validateScope(
    issueId: string,
    threadId: string,
    workspaceId: string,
    validationRound: number,
    validatorRunId: string | undefined,
    implementationRunId: string | undefined,
    evidenceRefs: string[] | undefined,
  ): void {
    const issue = this.issueRepo.getById(issueId);
    if (!issue) {
      throw new Error(`Issue not found: ${issueId}`);
    }
    if (issue.primary_thread_id !== threadId) {
      throw new Error(`Thread ${threadId} does not belong to issue ${issueId}`);
    }

    if (validatorRunId) {
      const run = this.runRepo.getById(validatorRunId);
      if (!run || run.issue_id !== issueId) {
        throw new Error(`Validator run ${validatorRunId} does not belong to issue ${issueId}`);
      }
      if (run.thread_id !== threadId) {
        throw new Error(`Validator run ${validatorRunId} does not belong to thread ${threadId}`);
      }
      if (run.role !== RunRole.Validator) {
        throw new Error(`Run ${validatorRunId} is not a validator run`);
      }
      if (run.validation_round !== validationRound) {
        throw new Error(`Validator run ${validatorRunId} validation_round mismatch`);
      }
      if (run.workspace_id !== workspaceId) {
        throw new AppError(ErrorCode.EVIDENCE_SCOPE_MISMATCH, "Validator run workspace mismatch.");
      }
    }

    if (implementationRunId) {
      const run = this.runRepo.getById(implementationRunId);
      if (!run || run.issue_id !== issueId) {
        throw new Error(`Implementation run ${implementationRunId} does not belong to issue ${issueId}`);
      }
      if (run.thread_id !== threadId) {
        throw new Error(`Implementation run ${implementationRunId} does not belong to thread ${threadId}`);
      }
      if (run.workspace_id !== workspaceId) {
        throw new AppError(ErrorCode.EVIDENCE_SCOPE_MISMATCH, "Implementation run workspace mismatch.");
      }
    }

    if (evidenceRefs && evidenceRefs.length > 0) {
      this.evidenceService.validateWriteScope(evidenceRefs, {
        issueId,
        threadId,
        runId: implementationRunId,
      });
    }
  }
}
