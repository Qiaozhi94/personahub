import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  ActorType, RunDispatchSource, RunPurpose, RunRole, RunStatus, ThreadEventType, type Run,
} from "@personahub/shared";
import { ThreadEvent } from "@/components/thread/ThreadEvent";
import { createRun } from "@/test/ui-flow-helpers";

function queuedEvent(runId: string) {
  return {
    id: "evt_1", event_sequence: 1, thread_id: "thr_1", type: ThreadEventType.RunQueued,
    actor_type: ActorType.System, actor_id: null,
    payload_json: { run_id: runId, issue_id: "iss_1", thread_id: "thr_1" },
    evidence_refs: [], created_at: "2026-07-19T00:00:00.000Z",
  };
}

function cancelledEvent(runId: string, reason: string) {
  return {
    id: "evt_2", event_sequence: 2, thread_id: "thr_1", type: ThreadEventType.RunCancelled,
    actor_type: ActorType.System, actor_id: null,
    payload_json: { run_id: runId, previous_status: "queued", status: "cancelled", reason },
    evidence_refs: [], created_at: "2026-07-19T00:00:01.000Z",
  };
}

describe("T095/T096: Thread Run card rendering", () => {
  it("shows a workflow badge + provider/model + dispatch_source for an implementation Run", () => {
    const run: Run = createRun({
      id: "run_1", role: RunRole.Implementation, purpose: RunPurpose.WorkflowBound,
      dispatch_source: RunDispatchSource.UserExplicit,
      adapter_identity: { adapter_config_id: "agt_1", name: "Codex", cli_provider: "codex", default_model: "gpt-5" },
    });
    render(<ThreadEvent event={queuedEvent("run_1")} runs={[run]} />);
    expect(screen.getByText("Implementation workflow")).toBeInTheDocument();
    expect(screen.getByText(/codex.*gpt-5/)).toBeInTheDocument();
    expect(screen.getByText(new RegExp(RunDispatchSource.UserExplicit))).toBeInTheDocument();
  });

  it("shows a neutral consult badge and 'does not change workflow' text for a consult Run", () => {
    const run: Run = createRun({
      id: "run_2", role: RunRole.Consult, purpose: RunPurpose.AdHocConsult,
      adapter_identity: { adapter_config_id: "agt_1", name: "Codex", cli_provider: "codex", default_model: "gpt-5" },
    });
    render(<ThreadEvent event={queuedEvent("run_2")} runs={[run]} />);
    expect(screen.getByText("Consult · does not change workflow")).toBeInTheDocument();
  });

  it("shows a context-handoff link when context_source_run_id is set", () => {
    const run: Run = createRun({ id: "run_3", context_source_run_id: "run_previous_implementation" });
    render(<ThreadEvent event={queuedEvent("run_3")} runs={[run]} />);
    expect(screen.getByText(/continues from run/i)).toBeInTheDocument();
  });

  it("does not show a context-handoff link when context_source_run_id is null", () => {
    const run: Run = createRun({ id: "run_4", context_source_run_id: null });
    render(<ThreadEvent event={queuedEvent("run_4")} runs={[run]} />);
    expect(screen.queryByText(/continues from run/i)).not.toBeInTheDocument();
  });

  it("falls back safely to 'unknown provider' when adapter_identity is missing, without crashing", () => {
    const run: Run = createRun({ id: "run_5", adapter_identity: null });
    render(<ThreadEvent event={queuedEvent("run_5")} runs={[run]} />);
    expect(screen.getByText("unknown provider")).toBeInTheDocument();
  });

  it("renders nothing extra when the queued run isn't found in the runs list (safe fallback)", () => {
    render(<ThreadEvent event={queuedEvent("run_missing")} runs={[]} />);
    expect(screen.queryByText(/workflow/)).not.toBeInTheDocument();
  });

  it("shows an honest resend message for run.cancelled(reason=issue_state_changed_before_start)", () => {
    render(<ThreadEvent event={cancelledEvent("run_1", "issue_state_changed_before_start")} />);
    expect(screen.getByText(/cancelled because the Issue entered validation/i)).toBeInTheDocument();
    expect(screen.getByText(/resend/i)).toBeInTheDocument();
  });

  it("falls back to the raw reason badge for an unrecognized cancellation reason", () => {
    render(<ThreadEvent event={cancelledEvent("run_1", "user_cancelled")} />);
    expect(screen.getByText("user_cancelled")).toBeInTheDocument();
  });

  it("does not crash when the Run's status is RunStatus.Completed with no adapter_identity fallback needed", () => {
    const run: Run = createRun({ id: "run_6", status: RunStatus.Completed });
    render(<ThreadEvent event={queuedEvent("run_6")} runs={[run]} />);
    expect(screen.getByText("Implementation workflow")).toBeInTheDocument();
  });
});
