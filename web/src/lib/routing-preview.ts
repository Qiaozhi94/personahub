import { AgentCapability, IssueStatus, RunPurpose, RunRole } from "@personahub/shared";

/**
 * design §10.2/§7.2: mirrors the server's pure `classifyRunRequest()`
 * (server/src/services/run-routing-classifier.ts) so the composer can show
 * an honest preview of what the server will actually derive — this is
 * preview-only; the real Run's displayed metadata always comes from what
 * the server returns (design's "实际Run card始终以后端返回metadata为准"),
 * never from this function's output.
 */
export type RunRoutingPreview =
  | { allowed: false }
  | { allowed: true; purpose: RunPurpose; role: RunRole; label: string };

function expectedRoleForStatus(status: IssueStatus): RunRole.Implementation | RunRole.Validator | null {
  switch (status) {
    case IssueStatus.Inbox:
    case IssueStatus.Ready:
    case IssueStatus.Running:
      return RunRole.Implementation;
    case IssueStatus.Validating:
      return RunRole.Validator;
    default:
      return null;
  }
}

const EXPECTED_ROLE_TO_CAPABILITY: Record<"implementation" | "validator", AgentCapability> = {
  implementation: AgentCapability.Implementation,
  validator: AgentCapability.Validator,
};

const CONSULT_LABEL = "Consult (does not change Issue status)";

export function previewRunRouting(
  issueStatus: IssueStatus,
  adapterCapabilityTags: AgentCapability[],
  explicitConsult: boolean,
): RunRoutingPreview {
  if (issueStatus === IssueStatus.Done || issueStatus === IssueStatus.Blocked) {
    return { allowed: false };
  }

  if (explicitConsult) {
    return { allowed: true, purpose: RunPurpose.AdHocConsult, role: RunRole.Consult, label: CONSULT_LABEL };
  }

  const expectedRole = expectedRoleForStatus(issueStatus);
  if (expectedRole && adapterCapabilityTags.includes(EXPECTED_ROLE_TO_CAPABILITY[expectedRole])) {
    const label = expectedRole === RunRole.Implementation ? "Implementation workflow" : "Validator workflow";
    return { allowed: true, purpose: RunPurpose.WorkflowBound, role: expectedRole, label };
  }

  return { allowed: true, purpose: RunPurpose.AdHocConsult, role: RunRole.Consult, label: CONSULT_LABEL };
}
