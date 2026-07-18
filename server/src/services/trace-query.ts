import type { Run, ThreadEvent, IssueWithThread } from "@personahub/shared/types";
import {
  ThreadEventType,
  type IssueTraceResponse,
  type RunEvidenceResponse,
  type RunTraceSummary,
  type EvidenceResolution,
  type TraceCompleteness,
  type RunFileChange,
} from "@personahub/shared/types";
import type { RunRepository } from "../repositories/run.js";
import type { ThreadEventRepository } from "../repositories/thread-event.js";
import type { FileChangeRepository } from "../repositories/file-change.js";
import type { IssueRepository } from "../repositories/issue.js";
import type { ThreadRepository } from "../repositories/thread.js";
import type { RunTraceRepository } from "../repositories/run-trace.js";
import type { EvidenceService } from "./evidence.js";
import { buildTraceCompleteness, aggregateIssueCompleteness } from "./trace-completeness.js";
import { TRACE_LIMITS } from "../runtime/trace/constants.js";
import { AppError } from "../api/errors.js";
import { ErrorCode } from "@personahub/shared/errors";

const TRACE_EVENT_TYPES: ThreadEventType[] = [
  ThreadEventType.CommandStarted,
  ThreadEventType.CommandCompleted,
  ThreadEventType.TestCompleted,
  ThreadEventType.FileChangeSummary,
  ThreadEventType.FileChangeScanFailed,
  ThreadEventType.HandoffCreated,
  ThreadEventType.ValidationRequested,
  ThreadEventType.ValidationFinding,
  ThreadEventType.ValidationPassed,
  ThreadEventType.ValidationFailed,
  ThreadEventType.ValidationBlocked,
  ThreadEventType.RunQueued,
  ThreadEventType.RunStarted,
  ThreadEventType.RunCompleted,
  ThreadEventType.RunFailed,
  ThreadEventType.RunCancelled,
  ThreadEventType.RunInterrupted,
  ThreadEventType.EscalationTriggered,
  ThreadEventType.IssueBlocked,
];

export class TraceQueryService {
  constructor(
    private runRepo: RunRepository,
    private threadEventRepo: ThreadEventRepository,
    private fileChangeRepo: FileChangeRepository,
    private issueRepo: IssueRepository,
    private threadRepo: ThreadRepository,
    private runTraceRepo: RunTraceRepository,
    private evidenceService: EvidenceService,
  ) {}

  getIssueTrace(issueId: string, afterEventId?: string, limit = 100): IssueTraceResponse {
    const issue = this.issueRepo.getById(issueId);
    if (!issue) {
      throw new AppError(ErrorCode.ISSUE_NOT_FOUND, "Issue not found.");
    }

    const threadId = issue.primary_thread_id;
    if (!threadId) {
      throw new AppError(ErrorCode.THREAD_NOT_FOUND, "Issue has no primary thread.");
    }

    this.validateEventCursor(afterEventId, threadId);

    const clampedLimit = Math.min(Math.max(1, limit), 200);
    const allEvents = this.threadEventRepo.listByThreadAndTypes(threadId, TRACE_EVENT_TYPES, afterEventId, clampedLimit + 1);
    const hasMore = allEvents.length > clampedLimit;
    const events = hasMore ? allEvents.slice(0, clampedLimit) : allEvents;

    const allThreadEvents = this.threadEventRepo.listByThreadAndTypes(threadId, TRACE_EVENT_TYPES, undefined, 100000);

    const runs = this.runRepo.listByIssue(issueId);
    const runSummaries: RunTraceSummary[] = runs.map((run) => {
      const traceApplicable = run.started_at !== null;
      if (!traceApplicable) {
        return { run, trace_applicable: false, completeness: null };
      }
      const completeness = this.computeRunCompleteness(run, threadId, issueId, allThreadEvents);
      return { run, trace_applicable: true, completeness };
    });

    const issueCompleteness = aggregateIssueCompleteness(
      runSummaries.map((rs) => ({ run: rs.run, completeness: rs.completeness })),
    );

    const allRefs = this.collectEvidenceRefs(events);
    const evidence = this.evidenceService.resolve(allRefs, { issueId, threadId });

    const issueWithThread: IssueWithThread = {
      ...issue,
      primary_thread: issue.primary_thread_id
        ? { id: issue.primary_thread_id, issue_id: issue.id, thread_type: "primary" as never, title: issue.title }
        : null,
    };

    return {
      issue: issueWithThread,
      runs: runSummaries,
      events,
      evidence,
      issue_completeness: issueCompleteness,
      next_after_event_id: hasMore && events.length > 0 ? events[events.length - 1].id : null,
    };
  }

  getRunEvidence(
    runId: string,
    afterEventId?: string,
    afterFileChangeId?: string,
    eventLimit = 100,
    fileLimit = 100,
  ): RunEvidenceResponse {
    const run = this.runRepo.getById(runId);
    if (!run) {
      throw new AppError(ErrorCode.RUN_NOT_FOUND, "Run not found.");
    }

    const clampedEventLimit = Math.min(Math.max(1, eventLimit), 200);
    const clampedFileLimit = Math.min(Math.max(1, fileLimit), 200);

    this.validateEventCursor(afterEventId, run.thread_id);
    this.validateFileCursor(afterFileChangeId, runId);

    const allEvents = this.threadEventRepo.listByThreadAndTypes(
      run.thread_id, TRACE_EVENT_TYPES, afterEventId, clampedEventLimit + 1,
    );
    const hasMoreEvents = allEvents.length > clampedEventLimit;
    const events = hasMoreEvents ? allEvents.slice(0, clampedEventLimit) : allEvents;
    const runEvents = this.filterEventsByRun(events, runId);

    const allFileChanges = this.fileChangeRepo.listByRun(runId, afterFileChangeId, clampedFileLimit + 1);
    const hasMoreFiles = allFileChanges.length > clampedFileLimit;
    const fileChanges: RunFileChange[] = hasMoreFiles ? allFileChanges.slice(0, clampedFileLimit) : allFileChanges;

    const completeness = this.computeRunCompleteness(run, run.thread_id, run.issue_id, undefined);

    const allRefs = this.collectEvidenceRefs(runEvents);
    const evidence = this.evidenceService.resolve(allRefs, { issueId: run.issue_id, threadId: run.thread_id, runId: run.id });

    return {
      run,
      events: runEvents,
      file_changes: fileChanges,
      evidence,
      completeness,
      next_after_event_id: hasMoreEvents && events.length > 0 ? events[events.length - 1].id : null,
      next_after_file_change_id: hasMoreFiles && fileChanges.length > 0 ? fileChanges[fileChanges.length - 1].id : null,
    };
  }

  private computeRunCompleteness(
    run: Run,
    threadId: string,
    issueId: string,
    preloadedEvents?: ThreadEvent[],
  ): TraceCompleteness {
    const traceState = this.runTraceRepo.get(run.id);
    const fileCount = this.fileChangeRepo.countByRun(run.id);

    const runEvents = preloadedEvents
      ? preloadedEvents.filter((e) => e.payload_json.run_id === run.id)
      : this.threadEventRepo
          .listByThreadAndTypes(threadId, TRACE_EVENT_TYPES, undefined, 100000)
          .filter((e) => e.payload_json.run_id === run.id);

    const allRefs = this.collectEvidenceRefs(runEvents);
    const evidence = this.evidenceService.resolve(allRefs, { issueId, threadId, runId: run.id });
    const evidenceFailures = evidence.filter((e) => e.status !== "resolved").length;

    return buildTraceCompleteness(run, runEvents, fileCount, traceState, evidenceFailures);
  }

  private validateEventCursor(afterEventId: string | undefined, threadId: string): void {
    if (!afterEventId) return;
    const event = this.threadEventRepo.getById(afterEventId);
    if (!event || event.thread_id !== threadId) {
      throw new AppError(ErrorCode.INVALID_QUERY, "Event cursor does not belong to this thread.");
    }
  }

  private validateFileCursor(afterFileChangeId: string | undefined, runId: string): void {
    if (!afterFileChangeId) return;
    const fileChanges = this.fileChangeRepo.listByRun(runId, undefined, 100000);
    if (!fileChanges.some((fc) => fc.id === afterFileChangeId)) {
      throw new AppError(ErrorCode.INVALID_QUERY, "File change cursor does not belong to this run.");
    }
  }

  private filterEventsByRun(events: ThreadEvent[], runId: string): ThreadEvent[] {
    return events.filter((e) => e.payload_json.run_id === runId);
  }

  private collectEvidenceRefs(events: ThreadEvent[]): string[] {
    const refs: string[] = [];
    for (const event of events) {
      refs.push(...event.evidence_refs);
    }
    return [...new Set(refs)];
  }
}
