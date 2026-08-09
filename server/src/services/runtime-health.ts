import type Database from "better-sqlite3";
import type { RuntimeHealthSnapshot, HealthDiagnostic, Run } from "@personahub/shared/types";
import { IssueStatus, RunStatus, AdapterStatus as AS } from "@personahub/shared/types";
import type { WorkspaceRepository } from "../repositories/workspace.js";
import type { AgentConfigRepository } from "../repositories/agent-config.js";
import type { AdapterWorkspaceStatusRepository } from "../repositories/adapter-workspace-status.js";
import type { RunRepository } from "../repositories/run.js";
import type { IssueRepository } from "../repositories/issue.js";
import { effectiveAdapterStatus } from "./adapter-availability.js";
import { classifyQueuedRun } from "./queue-classifier.js";
import { DEFAULT_EXECUTION_TIMEOUT_MS } from "../runtime/types.js";
import type { AdapterConfigService } from "./adapter-config.js";
import type { RunDispatchService } from "./run-dispatch.js";
import { AppError } from "../api/errors.js";
import { ErrorCode } from "@personahub/shared/errors";
import { CURRENT_SCHEMA_VERSION } from "../db/migrations.js";

export const LOCK_DIAGNOSTIC_GRACE_MS = 60_000;
export const VALIDATION_DISPATCH_GRACE_MS = 5_000;

function isTerminalRunStatus(status: RunStatus): boolean {
  return (
    status === RunStatus.Completed ||
    status === RunStatus.Failed ||
    status === RunStatus.Interrupted ||
    status === RunStatus.Cancelled
  );
}

interface WorkspaceHealthInternal {
  snapshot: RuntimeHealthSnapshot["workspaces"][number];
  queuedRuns: Run[];
}

export class RuntimeHealthService {
  constructor(
    private db: Database.Database,
    private workspaceRepo: WorkspaceRepository,
    private agentConfigRepo: AgentConfigRepository,
    private adapterWorkspaceStatusRepo: AdapterWorkspaceStatusRepository,
    private runRepo: RunRepository,
    private issueRepo: IssueRepository,
    private adapterConfigService: AdapterConfigService,
    private runDispatchService: RunDispatchService,
    private expectedSchemaVersion: number = CURRENT_SCHEMA_VERSION,
  ) {}

  collect(projectId: string, workspaceId?: string, nowMs?: number): RuntimeHealthSnapshot {
    if (workspaceId !== undefined) {
      const workspace = this.workspaceRepo.getById(workspaceId);
      if (!workspace || workspace.project_id !== projectId) {
        throw new AppError(ErrorCode.WORKSPACE_NOT_FOUND, "Workspace not found for this Project.");
      }
    }

    const now = nowMs ?? Date.now();

    const schema = this.collectSchema();
    const background = this.collectBackground();
    const workspaceInternals = this.collectWorkspaces(projectId, workspaceId, now);

    const diagnostics: HealthDiagnostic[] = [];

    if (schema.status !== "current") {
      diagnostics.push({
        code: "schema_version_mismatch",
        workspace_id: null,
        detail: `Database schema version is ${schema.actual_version}, expected ${schema.expected_version} (${schema.status}).`,
        suggested_action:
          schema.status === "behind"
            ? "Run database migrations to bring the schema up to the expected version."
            : "The database was opened by a newer server version; upgrade or revert the server to match.",
      });
    }

    for (const wsi of workspaceInternals) {
      diagnostics.push(...this.collectWorkspaceDiagnostics(wsi));
    }

    diagnostics.push(...this.collectValidationDispatchDiagnostics(projectId, workspaceId, now));

    return {
      schema,
      background,
      workspaces: workspaceInternals.map((wsi) => wsi.snapshot),
      diagnostics,
    };
  }

  private collectSchema(): RuntimeHealthSnapshot["schema"] {
    const row = this.db.prepare("SELECT MAX(version) as v FROM schema_version").get() as
      { v: number | null } | undefined;
    const actualVersion = row?.v ?? 0;
    const expectedVersion = this.expectedSchemaVersion;
    const status: "current" | "behind" | "ahead" =
      actualVersion === expectedVersion ? "current" : actualVersion < expectedVersion ? "behind" : "ahead";
    return { actual_version: actualVersion, expected_version: expectedVersion, status };
  }

  private collectBackground(): RuntimeHealthSnapshot["background"] {
    return {
      pending_probe_count: this.adapterConfigService.healthSnapshot().pendingProbeCount,
      pending_reprobe_count: this.runDispatchService.healthSnapshot().pendingReprobeCount,
    };
  }

  private collectWorkspaces(
    projectId: string,
    workspaceId: string | undefined,
    now: number,
  ): WorkspaceHealthInternal[] {
    const allWorkspaces = this.workspaceRepo.listAll().filter((w) => w.project_id === projectId);
    const targetWorkspaces = workspaceId ? allWorkspaces.filter((w) => w.id === workspaceId) : allWorkspaces;

    const projectAdapters = this.agentConfigRepo.listByProject(projectId);

    const lockedWorkspaces = this.workspaceRepo.listLockedWorkspaces();
    const lockedByWorkspaceId = new Map(lockedWorkspaces.map((w) => [w.id, w]));

    const runningRuns = this.runRepo.listRunning();
    const runningByWorkspaceId = new Map<string, Run>();
    for (const r of runningRuns) {
      if (!runningByWorkspaceId.has(r.workspace_id)) {
        runningByWorkspaceId.set(r.workspace_id, r);
      }
    }

    return targetWorkspaces.map((ws) => {
      const overrides = this.adapterWorkspaceStatusRepo.listForWorkspace(ws.id);
      const overrideByAdapterId = new Map(overrides.map((o) => [o.adapter_config_id, o]));
      const adapters = projectAdapters.map((record) => {
        const override = overrideByAdapterId.get(record.id) ?? null;
        return {
          id: record.id,
          name: record.name,
          effective_status: effectiveAdapterStatus(record, override),
          last_checked_at: override?.last_checked_at ?? record.last_checked_at,
        };
      });

      const lockedWs = lockedByWorkspaceId.get(ws.id);
      const lockedByRunId = lockedWs?.locked_by_run_id ?? null;
      const lockedAt = lockedWs?.locked_at ?? null;
      let heldMs: number | null = null;
      if (lockedAt) {
        const lockedTime = Date.parse(lockedAt);
        if (!Number.isNaN(lockedTime) && lockedTime <= now) {
          heldMs = now - lockedTime;
        }
      }

      const queuedRuns = this.runRepo.listQueuedByWorkspace(ws.id);
      const runningRun = runningByWorkspaceId.get(ws.id);

      const snapshot: RuntimeHealthSnapshot["workspaces"][number] = {
        workspace_id: ws.id,
        adapters,
        lock: { locked_by_run_id: lockedByRunId, locked_at: lockedAt, held_ms: heldMs },
        queue: { queued_count: queuedRuns.length, running_run_id: runningRun?.id ?? null },
      };

      return { snapshot, queuedRuns };
    });
  }

  private collectWorkspaceDiagnostics(wsi: WorkspaceHealthInternal): HealthDiagnostic[] {
    const diagnostics: HealthDiagnostic[] = [];
    const { snapshot: ws, queuedRuns } = wsi;
    const { lock, workspace_id } = ws;
    const lockFree = lock.locked_by_run_id === null;
    if (lock.locked_by_run_id) {
      const holderRun = this.runRepo.getById(lock.locked_by_run_id);
      if (!holderRun || isTerminalRunStatus(holderRun.status)) {
        diagnostics.push({
          code: "stale_lock_confirmed",
          workspace_id,
          run_id: lock.locked_by_run_id,
          detail: `Workspace lock held by run ${lock.locked_by_run_id} (holder ${holderRun ? `terminal: ${holderRun.status}` : "missing"}). locked_at=${lock.locked_at ?? "null"}, held_ms=${lock.held_ms ?? "null"}.`,
          suggested_action: "Restart the server to auto-release, or manually release the lock.",
        });
      } else {
        const threshold = DEFAULT_EXECUTION_TIMEOUT_MS + LOCK_DIAGNOSTIC_GRACE_MS;
        if (lock.held_ms !== null) {
          if (lock.held_ms > threshold) {
            diagnostics.push({
              code: "stale_lock_suspected",
              workspace_id,
              run_id: lock.locked_by_run_id,
              detail: `Workspace lock held by running run ${lock.locked_by_run_id} for ${lock.held_ms}ms (threshold ${threshold}ms). locked_at=${lock.locked_at}.`,
              suggested_action: "Check the run's adapter process; it may be hung past its execution timeout.",
            });
          }
        } else {
          diagnostics.push({
            code: "lock_timestamp_invalid",
            workspace_id,
            run_id: lock.locked_by_run_id,
            detail: `Workspace lock held by running run ${lock.locked_by_run_id} but locked_at is missing, illegal, or in the future (locked_at=${lock.locked_at ?? "null"}).`,
            suggested_action: "Investigate the run and lock record manually; the holder is still running.",
          });
        }
      }
    }

    const hasAvailableAdapter = ws.adapters.some((a) => a.effective_status === AS.Available);
    if (!hasAvailableAdapter) {
      diagnostics.push({
        code: "no_available_adapter",
        workspace_id,
        detail: `Workspace has no adapter with effective status Available.`,
        suggested_action: "Validate or configure an adapter for this workspace.",
      });
    }

    let hasEligibleNotRunning = false;
    for (const run of queuedRuns) {
      const issue = this.issueRepo.getById(run.issue_id);
      const classification = classifyQueuedRun(run, issue);
      if (classification === "waiting_for_recovery") {
        diagnostics.push({
          code: "waiting_for_recovery",
          workspace_id,
          run_id: run.id,
          detail: `Queued run ${run.id} (role ${run.role}) is waiting for issue-level recovery.`,
          suggested_action: "Resolve the blocking condition on the issue; the run will proceed once unblocked.",
        });
      } else if (classification === "invalid_queued_run") {
        diagnostics.push({
          code: "invalid_queued_run",
          workspace_id,
          run_id: run.id,
          detail: `Queued run ${run.id} (role ${run.role}) is no longer eligible for execution.`,
          suggested_action: "Cancel the stale queued run or investigate the issue state transition.",
        });
      } else if (classification === "eligible_but_not_running") {
        hasEligibleNotRunning = true;
      }
    }
    if (hasEligibleNotRunning && lockFree) {
      diagnostics.push({
        code: "queue_starved",
        workspace_id,
        detail: `At least one eligible queued run is not executing and the workspace lock is free.`,
        suggested_action: "Trigger a queue drain for this workspace or check the dispatch service.",
      });
    }

    return diagnostics;
  }

  private collectValidationDispatchDiagnostics(
    projectId: string,
    workspaceId: string | undefined,
    now: number,
  ): HealthDiagnostic[] {
    const allValidating = this.issueRepo.listByStatus(IssueStatus.Validating);
    const scoped = allValidating.filter(
      (i) =>
        i.project_id === projectId &&
        i.validation_dispatch_due_at !== null &&
        (workspaceId === undefined || i.workspace_id === workspaceId),
    );

    const diagnostics: HealthDiagnostic[] = [];
    for (const issue of scoped) {
      const dueAt = issue.validation_dispatch_due_at!;
      const dueTime = Date.parse(dueAt);

      if (dueTime > now - VALIDATION_DISPATCH_GRACE_MS) {
        const remainingMs = dueTime - now;
        diagnostics.push({
          code: "waiting_for_validation_due",
          workspace_id: issue.workspace_id,
          issue_id: issue.id,
          detail: `Issue ${issue.id} is waiting for validation dispatch. remaining_ms=${remainingMs} (due_at=${dueAt}).`,
          suggested_action: "No action needed; the validation dispatch scheduler will claim this issue when due.",
        });
      } else {
        const overdueMs = now - dueTime;
        diagnostics.push({
          code: "validation_dispatch_overdue",
          workspace_id: issue.workspace_id,
          issue_id: issue.id,
          detail: `Issue ${issue.id} validation dispatch is overdue. overdue_ms=${overdueMs} (due_at=${dueAt}).`,
          suggested_action: "Check the validation dispatch scheduler; it may have stopped or missed this issue.",
        });
      }
    }
    return diagnostics;
  }
}
