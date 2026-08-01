import type {
  ValidationPolicySnapshot,
  AdapterIdentitySnapshot,
  ValidationResultEnvelope,
  TraceCompleteness,
} from "@personahub/shared/types";
import type { HandoffPayload } from "../handoff-builder.js";

export interface SummaryRunIdentity {
  id: string;
  identity: AdapterIdentitySnapshot;
}

export interface SummaryVerificationEvent {
  id: string;
  kind: string;
  result: string;
  command: string | null;
}

export interface SummaryCommand {
  id: string;
  command: string;
  outcome: string;
  output_summary: string | null;
}

export interface SummaryFileChange {
  path: string;
  change_type: string;
}

export interface EvidenceSummaryBuildInput {
  issue: { id: string; title: string; goal: string | null; thread_id: string };
  implementationRun: SummaryRunIdentity;
  validatorRun: SummaryRunIdentity;
  policySnapshot: ValidationPolicySnapshot;
  policySnapshotHash: string;
  result: ValidationResultEnvelope;
  handoff: HandoffPayload | null;
  verifications: SummaryVerificationEvent[];
  fileChanges: SummaryFileChange[];
  commands: SummaryCommand[];
  passEventId: string;
  traceCompleteness: TraceCompleteness;
}

export interface EvidenceSummaryBuildResult {
  markdown: string;
  evidenceRefs: string[];
  sameOriginValidation: boolean;
  truncated: boolean;
}
