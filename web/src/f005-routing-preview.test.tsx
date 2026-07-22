import { describe, it, expect } from "vitest";
import { AgentCapability, IssueStatus, RunPurpose, RunRole } from "@personahub/shared";
import { previewRunRouting } from "@/lib/routing-preview";
import { describeCancellationReason, runPurposeLabel, isConsultRun } from "@/lib/run-display";

describe("T091/T092: previewRunRouting — mirrors server classifyRunRequest for preview only", () => {
  it("Running + Implementation-capable adapter -> Implementation workflow", () => {
    const result = previewRunRouting(IssueStatus.Running, [AgentCapability.Implementation], false);
    expect(result).toEqual({ allowed: true, purpose: RunPurpose.WorkflowBound, role: RunRole.Implementation, label: "Implementation workflow" });
  });

  it("Validating + Validator-capable adapter -> Validator workflow", () => {
    const result = previewRunRouting(IssueStatus.Validating, [AgentCapability.Validator], false);
    expect(result).toEqual({ allowed: true, purpose: RunPurpose.WorkflowBound, role: RunRole.Validator, label: "Validator workflow" });
  });

  it("Validating + Implementation-only adapter (capability mismatch) -> degrades to Consult", () => {
    const result = previewRunRouting(IssueStatus.Validating, [AgentCapability.Implementation], false);
    expect(result).toEqual({ allowed: true, purpose: RunPurpose.AdHocConsult, role: RunRole.Consult, label: "Consult (does not change Issue status)" });
  });

  it("explicit consult toggle always wins regardless of capability", () => {
    const result = previewRunRouting(IssueStatus.Running, [AgentCapability.Implementation, AgentCapability.Validator], true);
    expect(result).toEqual({ allowed: true, purpose: RunPurpose.AdHocConsult, role: RunRole.Consult, label: "Consult (does not change Issue status)" });
  });

  it("Done is disallowed (terminal)", () => {
    expect(previewRunRouting(IssueStatus.Done, [AgentCapability.Implementation], false)).toEqual({ allowed: false });
  });

  it("Blocked is disallowed (terminal)", () => {
    expect(previewRunRouting(IssueStatus.Blocked, [AgentCapability.Implementation], false)).toEqual({ allowed: false });
  });

  it("empty capability_tags degrades to Consult rather than throwing", () => {
    const result = previewRunRouting(IssueStatus.Running, [], false);
    expect(result).toEqual({ allowed: true, purpose: RunPurpose.AdHocConsult, role: RunRole.Consult, label: "Consult (does not change Issue status)" });
  });
});

describe("T095/T096: run-display helpers", () => {
  it("describeCancellationReason maps issue_state_changed_before_start to an honest resend message", () => {
    const text = describeCancellationReason("issue_state_changed_before_start");
    expect(text).toMatch(/cancelled/i);
    expect(text).toMatch(/resend/i);
  });

  it("describeCancellationReason returns null for unknown/other reasons (falls back to raw display)", () => {
    expect(describeCancellationReason("user_cancelled")).toBeNull();
    expect(describeCancellationReason(undefined)).toBeNull();
    expect(describeCancellationReason(42)).toBeNull();
  });

  it("runPurposeLabel labels a consult Run distinctly from workflow-bound Runs", () => {
    expect(runPurposeLabel({ purpose: RunPurpose.AdHocConsult, role: RunRole.Consult })).toBe("Consult · does not change workflow");
    expect(runPurposeLabel({ purpose: RunPurpose.WorkflowBound, role: RunRole.Implementation })).toBe("Implementation workflow");
    expect(runPurposeLabel({ purpose: RunPurpose.WorkflowBound, role: RunRole.Validator })).toBe("Validator workflow");
  });

  it("isConsultRun", () => {
    expect(isConsultRun({ purpose: RunPurpose.AdHocConsult, role: RunRole.Consult })).toBe(true);
    expect(isConsultRun({ purpose: RunPurpose.WorkflowBound, role: RunRole.Implementation })).toBe(false);
  });
});
