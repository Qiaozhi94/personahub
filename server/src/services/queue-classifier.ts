import { IssueStatus, RunRole } from "@personahub/shared/types";
import type { Issue, Run } from "@personahub/shared/types";

/**
 * T041b: Pure classification of a Queued Run's drain eligibility, extracted
 * from RunDispatchService.startNextQueuedRun() so drain and health share a
 * single source of truth (design §5 "派生判断必须与实际恢复规则同源").
 *
 * ONLY classifies Runs already in Queued status. The caller is responsible
 * for filtering by status before calling this function.
 *
 * The three return variants serve different consumers:
 * - `eligible_but_not_running`: the drain would start this Run if the lock
 *   were free. Health aggregates this into the public `queue_starved`
 *   diagnostic ONLY when the workspace lock is free; it is NEVER emitted
 *   as a public diagnostic code itself.
 * - `waiting_for_recovery`: F006 deliberately keeps blocked graph nodes
 *   queued. Emitted as-is as a public diagnostic (lock-independent).
 * - `invalid_queued_run`: the Run would be cancelled by drain. Emitted
 *   as-is as a public diagnostic (lock-independent).
 */
export type QueuedRunClassification = "eligible_but_not_running" | "waiting_for_recovery" | "invalid_queued_run";

export function classifyQueuedRun(run: Run, issue: Issue | null): QueuedRunClassification {
  if (!issue) return "invalid_queued_run";

  if (issue.status === IssueStatus.Blocked) {
    if (run.role === RunRole.GraphNode) return "waiting_for_recovery";
    return "invalid_queued_run";
  }

  if (issue.status === IssueStatus.Done) return "invalid_queued_run";

  if (
    run.role === RunRole.Implementation &&
    issue.status !== IssueStatus.Inbox &&
    issue.status !== IssueStatus.Ready &&
    issue.status !== IssueStatus.Running
  ) {
    return "invalid_queued_run";
  }

  if (run.role === RunRole.Validator) {
    if (issue.status !== IssueStatus.Validating) return "invalid_queued_run";
    const expectedRound = issue.validation_round_count + 1;
    if (run.validation_round !== expectedRound) return "invalid_queued_run";
  }

  return "eligible_but_not_running";
}
