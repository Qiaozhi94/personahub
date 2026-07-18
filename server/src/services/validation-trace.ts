import type {
  ThreadEvent,
  ValidationFindingSeverity,
} from "@personahub/shared/types";
import {
  ThreadEventType,
  ActorType,
} from "@personahub/shared/types";
import type { ThreadEventService } from "./thread-event.js";
import type { EvidenceService } from "./evidence.js";
import type { IssueRepository } from "../repositories/issue.js";
import type { RunRepository } from "../repositories/run.js";

export interface ValidationRequestedInput {
  issueId: string;
  threadId: string;
  runId?: string;
  workspaceId: string;
  validationRound: number;
  target: string;
  policyId: string;
  requestedByRunId?: string;
  evidenceRefs?: string[];
}

export interface ValidationFindingInput {
  issueId: string;
  threadId: string;
  runId?: string;
  workspaceId: string;
  validationRound: number;
  severity: ValidationFindingSeverity;
  message: string;
  suggestion?: string;
  filePath?: string;
  line?: number;
  evidenceRefs?: string[];
}

export interface ValidationResultInput {
  issueId: string;
  threadId: string;
  runId?: string;
  workspaceId: string;
  validationRound: number;
  summary: string;
  validatorRunId?: string;
  findingCount?: number;
  reasonCode?: string;
  evidenceRefs?: string[];
}

export class ValidationTraceService {
  constructor(
    private threadEventService: ThreadEventService,
    private evidenceService: EvidenceService,
    private issueRepo: IssueRepository,
    private runRepo: RunRepository,
  ) {}

  writeRequested(input: ValidationRequestedInput): ThreadEvent {
    this.validateScope(input.issueId, input.threadId, input.runId, input.evidenceRefs);
    return this.threadEventService.writeAndBroadcast(
      input.threadId,
      ThreadEventType.ValidationRequested,
      ActorType.System,
      null,
      {
        issue_id: input.issueId,
        thread_id: input.threadId,
        run_id: input.runId ?? null,
        workspace_id: input.workspaceId,
        validation_round: input.validationRound,
        target: input.target,
        policy_id: input.policyId,
        requested_by_run_id: input.requestedByRunId ?? null,
      },
      input.evidenceRefs ?? [],
    );
  }

  writeFinding(input: ValidationFindingInput): ThreadEvent {
    this.validateScope(input.issueId, input.threadId, input.runId, input.evidenceRefs);
    return this.threadEventService.writeAndBroadcast(
      input.threadId,
      ThreadEventType.ValidationFinding,
      ActorType.System,
      null,
      {
        issue_id: input.issueId,
        thread_id: input.threadId,
        run_id: input.runId ?? null,
        workspace_id: input.workspaceId,
        validation_round: input.validationRound,
        severity: input.severity,
        message: input.message,
        suggestion: input.suggestion ?? null,
        file_path: input.filePath ?? null,
        line: input.line ?? null,
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

  private writeResult(
    type: ThreadEventType,
    input: ValidationResultInput,
    extra: Record<string, unknown>,
  ): ThreadEvent {
    this.validateScope(input.issueId, input.threadId, input.runId, input.evidenceRefs);
    return this.threadEventService.writeAndBroadcast(
      input.threadId,
      type,
      ActorType.System,
      null,
      {
        issue_id: input.issueId,
        thread_id: input.threadId,
        run_id: input.runId ?? null,
        workspace_id: input.workspaceId,
        validation_round: input.validationRound,
        summary: input.summary,
        validator_run_id: input.validatorRunId ?? null,
        ...extra,
      },
      input.evidenceRefs ?? [],
    );
  }

  private validateScope(
    issueId: string,
    threadId: string,
    runId: string | undefined,
    evidenceRefs: string[] | undefined,
  ): void {
    const issue = this.issueRepo.getById(issueId);
    if (!issue) {
      throw new Error(`Issue not found: ${issueId}`);
    }
    if (issue.primary_thread_id !== threadId) {
      throw new Error(`Thread ${threadId} does not belong to issue ${issueId}`);
    }
    if (runId) {
      const run = this.runRepo.getById(runId);
      if (!run || run.issue_id !== issueId) {
        throw new Error(`Run ${runId} does not belong to issue ${issueId}`);
      }
    }
    if (evidenceRefs && evidenceRefs.length > 0) {
      this.evidenceService.validateWriteScope(evidenceRefs, {
        issueId,
        threadId,
        runId,
      });
    }
  }
}
