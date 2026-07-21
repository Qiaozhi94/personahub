import { IssueStatus, RunPurpose, AgentCapability } from "@personahub/shared/types";
import { RunRole } from "@personahub/shared/types";
import { hasCapability } from "../repositories/agent-config.js";

/**
 * design §7.2: pure Issue-status -> expected-role classifier, plus the
 * purpose/role derivation rules. No repo/IO dependencies — deliberately
 * testable without starting any CLI (Phase 7 checkpoint).
 *
 * The client can only ever *request* `ad_hoc_consult` explicitly;
 * `workflow_bound` is never accepted as a client-forced value — any other
 * requested purpose (including an explicit `workflow_bound`, or omitted)
 * falls through to auto-derivation from the issue status + adapter
 * capability. This is the enforcement point for spec's "客户端不能强制
 * workflow_bound或role".
 */
export type RunRoutingResult =
  | { allowed: false }
  | { allowed: true; purpose: RunPurpose; role: RunRole };

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

/** RunRole and AgentCapability share the same "implementation"/"validator" string values by design, but are distinct enums — this is the single explicit mapping between them. */
const EXPECTED_ROLE_TO_CAPABILITY: Record<"implementation" | "validator", AgentCapability> = {
  implementation: AgentCapability.Implementation,
  validator: AgentCapability.Validator,
};

export function classifyRunRequest(
  issueStatus: IssueStatus,
  requestedPurpose: RunPurpose | undefined,
  adapterCapabilityTags: AgentCapability[],
): RunRoutingResult {
  if (issueStatus === IssueStatus.Done || issueStatus === IssueStatus.Blocked) {
    return { allowed: false };
  }

  // Rule 1: an explicit ad_hoc_consult request always succeeds as consult on
  // any non-terminal status — capability_tags are irrelevant here, since
  // consult is a routing purpose, not an adapter capability (§3).
  if (requestedPurpose === RunPurpose.AdHocConsult) {
    return { allowed: true, purpose: RunPurpose.AdHocConsult, role: RunRole.Consult };
  }

  const expectedRole = expectedRoleForStatus(issueStatus);
  // expectedRole is always non-null here (Done/Blocked already returned above,
  // and every other IssueStatus value maps to Implementation or Validator).
  if (expectedRole && hasCapability({ capability_tags: adapterCapabilityTags }, EXPECTED_ROLE_TO_CAPABILITY[expectedRole])) {
    return { allowed: true, purpose: RunPurpose.WorkflowBound, role: expectedRole };
  }

  // Rule 3: unconditional degrade to consult — no consult-capability check
  // exists or is needed. Also covers rule 6 (empty capability_tags).
  return { allowed: true, purpose: RunPurpose.AdHocConsult, role: RunRole.Consult };
}
