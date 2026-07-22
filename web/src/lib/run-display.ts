import { RunPurpose, RunRole, type Run } from "@personahub/shared";

/**
 * design §10.3/T095: a stale queued Run cancelled because the Issue moved
 * on before it could start carries the user's original instructions — it
 * must never read as "this ran". `issue_state_changed_before_start` is a
 * plain string reason (server/src/services/run-dispatch.ts), not a typed
 * FailureReason enum member, so this is a string->string lookup, not an
 * exhaustive switch.
 */
const CANCELLATION_REASON_TEXT: Record<string, string> = {
  issue_state_changed_before_start:
    "This instruction was cancelled because the Issue entered validation before it could start — please resend it once validation finishes.",
  issue_blocked_before_start:
    "This instruction was cancelled because the Issue became Blocked before it could start — please resend it once unblocked.",
};

export function describeCancellationReason(reason: unknown): string | null {
  if (typeof reason !== "string") return null;
  return CANCELLATION_REASON_TEXT[reason] ?? null;
}

export function runPurposeLabel(run: Pick<Run, "purpose" | "role">): string {
  if (run.purpose === RunPurpose.AdHocConsult || run.role === RunRole.Consult) {
    return "Consult · does not change workflow";
  }
  return run.role === RunRole.Validator ? "Validator workflow" : "Implementation workflow";
}

export function isConsultRun(run: Pick<Run, "purpose" | "role">): boolean {
  return run.purpose === RunPurpose.AdHocConsult || run.role === RunRole.Consult;
}
