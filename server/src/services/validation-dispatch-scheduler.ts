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
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), this.tickMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  tick(): void {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const now = new Date().toISOString();
      const dueIssues = this.issueRepo.listValidatingWithDueBefore(now);
      for (const issue of dueIssues) {
        this.validationWorkflowService.claimValidatorSlot(issue.id, { mode: "auto" });
      }
    } finally {
      this.ticking = false;
    }
  }
}
