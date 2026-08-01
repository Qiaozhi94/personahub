import type Database from "better-sqlite3";
import type { Run, Workspace, ThreadEvent } from "@personahub/shared/types";
import {
  ThreadEventType,
  ActorType,
  CommandTraceCapability,
  BaselineStatus,
  FileChangeType,
  type RunTraceState,
} from "@personahub/shared/types";
import type { RunRepository } from "../repositories/run.js";
import type { RunTraceRepository } from "../repositories/run-trace.js";
import type { FileChangeRepository, FileChangeRecord } from "../repositories/file-change.js";
import type { ThreadEventRepository } from "../repositories/thread-event.js";
import type { IssueRepository } from "../repositories/issue.js";
import type { WorkspaceRepository } from "../repositories/workspace.js";
import type { ThreadEventService } from "./thread-event.js";
import type { EvidenceService } from "./evidence.js";
import { captureSnapshot, diffSnapshots, snapshotToJson, snapshotFromJson } from "../runtime/trace/workspace-scanner.js";
import { buildHandoff } from "./handoff-builder.js";
import { buildTraceCompleteness } from "./trace-completeness.js";
import { FINALIZATION_RETRY_MAX, SCAN_REASON_CODES, TRACE_LIMITS } from "../runtime/trace/constants.js";

export interface PrepareRunInput {
  run: Run;
  workspace: Workspace;
  traceCapability: CommandTraceCapability;
}

export interface FinalizeResult {
  finalized: boolean;
  fileEventId: string | null;
  handoffEventId: string | null;
}

export class DevelopmentTraceService {
  constructor(
    private runRepo: RunRepository,
    private runTraceRepo: RunTraceRepository,
    private fileChangeRepo: FileChangeRepository,
    private threadEventRepo: ThreadEventRepository,
    private issueRepo: IssueRepository,
    private workspaceRepo: WorkspaceRepository,
    private threadEventService: ThreadEventService,
    private evidenceService: EvidenceService,
    private db: Database.Database,
  ) {}

  prepareRun(input: PrepareRunInput): void {
    const { run, workspace, traceCapability } = input;
    const now = new Date().toISOString();

    this.runTraceRepo.createPending(run.id, traceCapability, now);

    try {
      const result = captureSnapshot(workspace.local_path);
      if (!result.snapshot.scanComplete && !result.snapshot.scanTruncated) {
        this.runTraceRepo.saveBaselineFailure(run.id, result.snapshot.stopReason ?? SCAN_REASON_CODES.unknown, now);
        return;
      }
      const baselineJson = snapshotToJson(result.snapshot);
      this.runTraceRepo.saveBaseline(run.id, result.snapshot.scannerType, baselineJson, now);
    } catch {
      this.runTraceRepo.saveBaselineFailure(run.id, SCAN_REASON_CODES.unknown, now);
    }
  }

  finalizeRun(runId: string): FinalizeResult {
    const run = this.runRepo.getById(runId);
    if (!run) return { finalized: false, fileEventId: null, handoffEventId: null };

    if (!run.started_at) {
      return { finalized: false, fileEventId: null, handoffEventId: null };
    }

    const state = this.runTraceRepo.get(runId);
    if (state?.finalized_at) {
      return { finalized: true, fileEventId: null, handoffEventId: null };
    }

    return this.executeFinalization(run, state);
  }

  finalizeRunWithoutWorkspace(runId: string, reasonCode: string): FinalizeResult {
    const run = this.runRepo.getById(runId);
    if (!run) return { finalized: false, fileEventId: null, handoffEventId: null };
    if (!run.started_at) return { finalized: false, fileEventId: null, handoffEventId: null };

    const state = this.runTraceRepo.get(runId);
    if (state?.finalized_at) {
      return { finalized: true, fileEventId: null, handoffEventId: null };
    }

    return this.executeDbOnlyFinalization(run, state, reasonCode);
  }

  private executeFinalization(run: Run, state: RunTraceState | null): FinalizeResult {
    const finalSnapshot = this.captureFinalSnapshot(run, state);
    const fileChanges = finalSnapshot.changes;
    const fileScanStatus = finalSnapshot.status;

    const events = this.collectRunEvents(run);
    const issue = this.issueRepo.getById(run.issue_id);
    const issueGoal = issue?.goal ?? "";
    const evidenceFailures = 0;

    const completeness = buildTraceCompleteness(
      run, events, state, evidenceFailures,
    );

    const handoffPayload = buildHandoff({
      run, issueGoal, events, fileChanges, fileScanStatus,
      completeness, recoveredAfterRestart: false,
    }) as unknown as Record<string, unknown>;

    return this.commitFinalization(run, state, fileChanges, fileScanStatus, completeness, handoffPayload, false);
  }

  private executeDbOnlyFinalization(
    run: Run,
    state: RunTraceState | null,
    reasonCode: string,
  ): FinalizeResult {
    const events = this.collectRunEvents(run);
    const issue = this.issueRepo.getById(run.issue_id);
    const issueGoal = issue?.goal ?? "";

    const completeness = buildTraceCompleteness(
      run, events, state, 0,
    );

    const handoffPayload = buildHandoff({
      run, issueGoal, events, fileChanges: [], fileScanStatus: "failed",
      completeness, recoveredAfterRestart: true,
    }) as unknown as Record<string, unknown>;

    const fileEventPayload = {
      issue_id: run.issue_id, thread_id: run.thread_id, run_id: run.id, workspace_id: run.workspace_id,
      phase: "final", reason_code: reasonCode,
      message: "Workspace ownership lost; file scan skipped.",
      recovered_after_restart: true,
    };

    return this.commitFinalization(
      run, state, [], "failed", completeness, handoffPayload, true, fileEventPayload,
    );
  }

  private captureFinalSnapshot(run: Run, state: RunTraceState | null) {
    if (!state || state.baseline_status !== BaselineStatus.Captured) {
      return { changes: [] as FileChangeRecord[], status: "failed" as const };
    }

    const baselineJson = state.baseline_json;
    if (!baselineJson) {
      return { changes: [] as FileChangeRecord[], status: "failed" as const };
    }

    const baseline = snapshotFromJson(baselineJson);
    if (!baseline) {
      return { changes: [] as FileChangeRecord[], status: "failed" as const };
    }

    const workspace = this.workspaceRepo.getById(run.workspace_id);
    if (!workspace) {
      return { changes: [] as FileChangeRecord[], status: "failed" as const };
    }

    try {
      const finalResult = captureSnapshot(workspace.local_path);
      const diff = diffSnapshots(baseline, finalResult.snapshot);
      const changes: FileChangeRecord[] = diff.changes.map((d) => ({
        path: d.path,
        previous_path: d.previous_path,
        change_type: d.change_type,
        before_fingerprint: d.before_fingerprint,
        after_fingerprint: d.after_fingerprint,
      }));
      return { changes, status: diff.truncated ? "truncated" as const : "complete" as const };
    } catch {
      return { changes: [] as FileChangeRecord[], status: "failed" as const };
    }
  }

  private collectRunEvents(run: Run): ThreadEvent[] {
    const allEvents = this.threadEventRepo.listByThread(run.thread_id);
    return allEvents.filter((e) => e.payload_json.run_id === run.id);
  }

  private commitFinalization(
    run: Run,
    state: RunTraceState | null,
    fileChanges: FileChangeRecord[],
    fileScanStatus: string,
    completeness: import("@personahub/shared/types").TraceCompleteness,
    handoffPayload: Record<string, unknown>,
    dbOnly: boolean,
    fileEventPayload?: Record<string, unknown>,
  ): FinalizeResult {
    let attempt = 0;
    while (attempt < FINALIZATION_RETRY_MAX) {
      try {
        return this.tryCommit(run, state, fileChanges, fileScanStatus, completeness, handoffPayload, dbOnly, fileEventPayload);
      } catch {
        attempt++;
        if (attempt >= FINALIZATION_RETRY_MAX) {
          break;
        }
      }
    }
    return { finalized: false, fileEventId: null, handoffEventId: null };
  }

  private tryCommit(
    run: Run,
    state: RunTraceState | null,
    fileChanges: FileChangeRecord[],
    fileScanStatus: string,
    completeness: import("@personahub/shared/types").TraceCompleteness,
    handoffPayload: Record<string, unknown>,
    dbOnly: boolean,
    fileEventPayload?: Record<string, unknown>,
  ): FinalizeResult {
    const now = new Date().toISOString();
    const pendingBroadcasts: ThreadEvent[] = [];

    const result = this.db.transaction(() => {
      const current = this.runTraceRepo.get(run.id);
      if (current?.finalized_at) {
        return { finalized: true, fileEventId: null, handoffEventId: null };
      }

      let fileEventId: string | null = null;

      if (fileScanStatus === "failed") {
        const payload = fileEventPayload ?? {
          issue_id: run.issue_id, thread_id: run.thread_id, run_id: run.id, workspace_id: run.workspace_id,
          phase: state?.baseline_status === BaselineStatus.Failed ? "baseline" : "final",
          reason_code: state?.baseline_error_code ?? SCAN_REASON_CODES.unknown,
          message: "File scan failed.",
          recovered_after_restart: false,
        };
        const fileEvent = this.threadEventService.write(
          run.thread_id, ThreadEventType.FileChangeScanFailed,
          ActorType.System, null, payload,
        );
        pendingBroadcasts.push(fileEvent);
        fileEventId = fileEvent.id;
      } else {
        const fileSummary = {
          issue_id: run.issue_id, thread_id: run.thread_id, run_id: run.id, workspace_id: run.workspace_id,
          scanner: state?.scanner_type ?? "filesystem",
          added_count: fileChanges.filter((c) => c.change_type === FileChangeType.Added).length,
          modified_count: fileChanges.filter((c) => c.change_type === FileChangeType.Modified).length,
          deleted_count: fileChanges.filter((c) => c.change_type === FileChangeType.Deleted).length,
          renamed_count: fileChanges.filter((c) => c.change_type === FileChangeType.Renamed).length,
          total_count: fileChanges.length,
          preview: fileChanges.slice(0, TRACE_LIMITS.eventPreview).map((c) => ({ path: c.path, change_type: c.change_type })),
          preview_truncated: fileChanges.length > TRACE_LIMITS.eventPreview,
          scan_truncated: fileScanStatus === "truncated",
          recovered_after_restart: false,
        };
        const fileEvent = this.threadEventService.write(
          run.thread_id, ThreadEventType.FileChangeSummary,
          ActorType.System, null, fileSummary,
          [`file-change-set:${run.id}`],
        );
        pendingBroadcasts.push(fileEvent);
        fileEventId = fileEvent.id;

        if (!dbOnly) {
          this.fileChangeRepo.replaceForRun(run.id, fileChanges, now);
        }
      }

      const handoffRefs = this.collectHandoffRefs(run, fileEventId);
      const handoffEvent = this.threadEventService.write(
        run.thread_id, ThreadEventType.HandoffCreated,
        ActorType.System, null, handoffPayload, handoffRefs,
      );
      pendingBroadcasts.push(handoffEvent);

      this.runTraceRepo.markFinalized(run.id, now);

      return { finalized: true, fileEventId, handoffEventId: handoffEvent.id };
    })();

    for (const event of pendingBroadcasts) {
      this.threadEventService.broadcast(event);
    }

    return result;
  }

  private collectHandoffRefs(run: Run, fileEventId: string | null): string[] {
    const events = this.collectRunEvents(run);
    const refs: string[] = [];
    for (const e of events) {
      if (e.type === ThreadEventType.CommandCompleted || e.type === ThreadEventType.TestCompleted) {
        refs.push(`event:${e.id}`);
      }
    }
    if (fileEventId) {
      refs.push(`event:${fileEventId}`);
    }
    return [...new Set(refs)];
  }
}
