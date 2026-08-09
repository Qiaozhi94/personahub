import type { HealthDiagnostic, HealthDiagnosticCode } from "@personahub/shared";

export type DiagnosticRender = {
  icon: "lock" | "clock" | "alert" | "queue" | "adapter" | "schema";
  variant: "destructive" | "warning" | "info";
  title: string;
  suggestedAction: string;
};

export function assertNever(x: never): never {
  throw new Error("unhandled diagnostic code: " + (x as unknown));
}

export function renderDiagnosticCode(code: HealthDiagnosticCode): DiagnosticRender {
  switch (code) {
    case "stale_lock_confirmed":
      return {
        icon: "lock",
        variant: "destructive",
        title: "Stale lock confirmed",
        suggestedAction:
          "The holder run is missing or terminal. Restart the server to auto-release, or manually release the lock.",
      };
    case "stale_lock_suspected":
      return {
        icon: "lock",
        variant: "warning",
        title: "Stale lock suspected",
        suggestedAction:
          "The holder run is still running but has held the workspace longer than expected. Check the adapter process for that run.",
      };
    case "lock_timestamp_invalid":
      return {
        icon: "lock",
        variant: "warning",
        title: "Lock timestamp invalid",
        suggestedAction:
          "The lock timestamp is missing or invalid while the holder run is still running. Do not release manually — review the run and lock record together to preserve workspace mutual exclusion.",
      };
    case "queue_starved":
      return {
        icon: "queue",
        variant: "destructive",
        title: "Queue starved",
        suggestedAction:
          "An eligible queued run exists but the workspace lock is free and nothing is running. Check the dispatcher and adapter availability.",
      };
    case "waiting_for_recovery":
      return {
        icon: "clock",
        variant: "info",
        title: "Waiting for recovery",
        suggestedAction:
          "A queued run is waiting for its node-level recovery window. Unblock or retry the blocked node when ready.",
      };
    case "invalid_queued_run":
      return {
        icon: "alert",
        variant: "destructive",
        title: "Invalid queued run",
        suggestedAction:
          "A queued run is neither eligible nor waiting for a valid reason. Inspect the run and its issue state.",
      };
    case "waiting_for_validation_due":
      return {
        icon: "clock",
        variant: "info",
        title: "Waiting for validation due time",
        suggestedAction:
          "An issue is in Validating status and waiting for its validation dispatch due time. This is normal if the due time has not arrived.",
      };
    case "validation_dispatch_overdue":
      return {
        icon: "clock",
        variant: "destructive",
        title: "Validation dispatch overdue",
        suggestedAction:
          "A validating issue passed its due time but has not been claimed. Check that the validation dispatch scheduler is running.",
      };
    case "no_available_adapter":
      return {
        icon: "adapter",
        variant: "destructive",
        title: "No available adapter",
        suggestedAction:
          "This workspace has no adapter currently marked available. Add or validate an adapter before dispatching runs.",
      };
    case "schema_version_mismatch":
      return {
        icon: "schema",
        variant: "warning",
        title: "Schema version mismatch",
        suggestedAction:
          "The database schema version does not match the expected version. Run migrations or verify the deployment version.",
      };
    default:
      return assertNever(code);
  }
}

export function diagnosticKey(diagnostic: HealthDiagnostic): string {
  // Keys must be stable across refetches: detail embeds live numbers
  // (held_ms / remaining_ms / overdue_ms) and must never be part of the key.
  // run_id/issue_id are the stable logical identity of per-run/per-issue
  // diagnostics; singletons (one per workspace, or global) share the
  // workspace-scoped key and are inherently unique.
  const recordId = diagnostic.run_id ?? diagnostic.issue_id ?? "single";
  return `${diagnostic.code}:${diagnostic.workspace_id ?? "global"}:${recordId}`;
}
