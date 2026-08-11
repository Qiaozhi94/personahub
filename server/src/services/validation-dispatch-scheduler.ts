import type { IssueRepository } from "../repositories/issue.js";
import type { ValidationWorkflowService } from "./validation/workflow-service.js";

const DEFAULT_TICK_MS = 1_000;

/**
 * design §8.1/§8.2: polls for Issues whose grace window
 * (validation_dispatch_due_at) has expired and claims the validator slot on
 * their behalf (mode: "auto") — this is the losing side of the manual-vs-
 * scheduler race whenever a human picks an explicit validator first.
 *
 * Tick interval is injectable (production: 1s default; tests drive `tick()`
 * directly against a fake clock instead of waiting on a real timer).
 * Non-reentrant: if claiming a slot is slow, the next timer fire skips
 * rather than overlapping the tick still in progress.
 */
export class ValidationDispatchScheduler {
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;

  constructor(
    private issueRepo: IssueRepository,
    private validationWorkflowService: ValidationWorkflowService,
    private tickMs: number = DEFAULT_TICK_MS,
    /**
     * design §8.2/§5.2: a claimed validator slot produces a Queued validator
     * Run that must still be dispatched (startNextQueuedRun) or it sits
     * `queued` forever. The implementation-completion sync path
     * (finalizeAndDrain) and the manual trigger path both drain after
     * claiming; the scheduler path alone did not. Defaults to a no-op so
     * call sites that only assert claiming behavior keep working, but any
     * production wiring must pass the real drainWorkspace.
     */
    private drainWorkspace: (workspaceId: string) => Promise<void> = async () => {},
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), this.tickMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const now = new Date().toISOString();
      const dueIssues = this.issueRepo.listValidatingWithDueBefore(now);
      const claimedWorkspaces = new Set<string>();
      for (const issue of dueIssues) {
        const claimed = this.validationWorkflowService.claimValidatorSlot(issue.id, { mode: "auto" });
        if (claimed.ok) claimedWorkspaces.add(issue.workspace_id);
      }
      for (const workspaceId of claimedWorkspaces) {
        await this.drainWorkspace(workspaceId);
      }
    } finally {
      this.ticking = false;
    }
  }
}
