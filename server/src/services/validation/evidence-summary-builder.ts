import type { ValidationPolicySnapshot, ValidationResultEnvelope, TraceCompleteness } from "@personahub/shared/types";
import type { HandoffPayload } from "../handoff-builder.js";
import { isSameOriginValidation } from "./same-origin.js";
import type {
  EvidenceSummaryBuildInput,
  EvidenceSummaryBuildResult,
  SummaryCommand,
  SummaryFileChange,
  SummaryRunIdentity,
  SummaryVerificationEvent,
} from "./evidence-summary-contract.js";

export type {
  EvidenceSummaryBuildInput,
  EvidenceSummaryBuildResult,
  SummaryCommand,
  SummaryFileChange,
  SummaryRunIdentity,
  SummaryVerificationEvent,
} from "./evidence-summary-contract.js";

export const SUMMARY_MAX_BYTES = 256 * 1024;
export const SUMMARY_REFS_MAX = 500;
export class EvidenceSummaryBuilderError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "EvidenceSummaryBuilderError";
  }
}

function utf8Bytes(s: string): number {
  return Buffer.byteLength(s, "utf8");
}

function escapeMd(s: string): string {
  return s.replace(/`/g, "\\`");
}

function toForwardSlash(p: string): string {
  return p.split("\\").join("/");
}

function isAbsoluteLike(p: string): boolean {
  if (p.startsWith("/")) return true;
  if (p.length >= 3) {
    const c = p.charCodeAt(0);
    const isLetter = (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
    if (isLetter && p[1] === ":" && (p[2] === "\\" || p[2] === "/")) return true;
  }
  return false;
}

function dedupePreserveOrder(refs: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const ref of refs) {
    if (!seen.has(ref)) {
      seen.add(ref);
      result.push(ref);
    }
  }
  return result;
}

export function aggregateEvidenceRefs(input: EvidenceSummaryBuildInput): string[] {
  const refs: string[] = [];
  refs.push(`event:${input.passEventId}`);
  refs.push(...input.result.evidence_refs);
  if (input.handoff) {
    refs.push(`file-change-set:${input.implementationRun.id}`);
  }
  for (const v of input.verifications) {
    refs.push(`event:${v.id}`);
  }
  for (const cmd of input.commands) {
    refs.push(`event:${cmd.id}`);
  }
  const deduped = dedupePreserveOrder(refs);
  return deduped.slice(0, SUMMARY_REFS_MAX);
}

function buildGoal(goal: string | null): string {
  return `## Goal\n\n${goal ? escapeMd(goal) : "*No goal specified.*"}`;
}

function buildFinalResult(result: ValidationResultEnvelope): string {
  return `## Final Result\n\n- **Outcome:** ${result.outcome}\n- **Summary:** ${escapeMd(result.summary)}`;
}

function buildImplementationSummary(handoff: HandoffPayload | null): string {
  if (!handoff) {
    return `## Implementation Summary\n\n*No implementation handoff available.*`;
  }
  const parts: string[] = [`## Implementation Summary`];
  parts.push(escapeMd(handoff.summary));
  if (handoff.completed_work.length > 0) {
    parts.push(`**Completed Work:**`);
    for (const w of handoff.completed_work) {
      parts.push(`- ${escapeMd(w)}`);
    }
  }
  return parts.join("\n");
}

function buildKeyDecisions(decisions: string[]): string {
  if (decisions.length === 0) {
    return `## Key Decisions\n\n*No key decisions recorded.*`;
  }
  const parts: string[] = [`## Key Decisions`];
  for (const d of decisions) {
    parts.push(`- ${escapeMd(d)}`);
  }
  return parts.join("\n");
}

function buildValidation(result: ValidationResultEnvelope, sameOrigin: boolean): string {
  const parts: string[] = [`## Validation`];
  parts.push(`- **Outcome:** ${result.outcome}`);
  parts.push(`- **Finding Count:** ${result.findings.length}`);
  parts.push(`- **Same-Origin Validation:** ${sameOrigin}`);
  return parts.join("\n");
}

function buildRunIdentities(
  implementation: SummaryRunIdentity,
  validator: SummaryRunIdentity,
  sameOrigin: boolean,
): string {
  const formatIdentity = (label: string, run: SummaryRunIdentity) => {
    const id = run.identity;
    return `### ${label}\n\n- **Run ID:** ${run.id}\n- **Adapter Config ID:** ${id.adapter_config_id}\n- **Name:** ${escapeMd(id.name)}\n- **CLI Provider:** ${id.cli_provider}\n- **Default Model:** ${id.default_model ?? "N/A"}`;
  };
  return `## Run Identities\n\n${formatIdentity("Implementation", implementation)}\n\n${formatIdentity("Validator", validator)}\n\n**Same-Origin:** ${sameOrigin}`;
}

function buildPolicySection(snapshot: ValidationPolicySnapshot, hash: string): string {
  const req = snapshot.evidence_requirements;
  return `## Validation Policy\n\n- **Policy ID:** ${snapshot.policy_id}\n- **Version:** ${snapshot.version}\n- **Max Validation Rounds:** ${snapshot.max_validation_rounds}\n- **Snapshot Hash:** ${hash}\n- **Require Handoff:** ${req.require_handoff}\n- **Require File Trace:** ${req.require_file_trace}\n- **Require Verification:** ${req.require_verification}\n- **Accepted Verification Kinds:** ${req.accepted_verification_kinds.join(", ")}`;
}

function buildKeyCommands(commands: SummaryCommand[]): string {
  if (commands.length === 0) {
    return `## Key Commands\n\n*No commands recorded.*`;
  }
  const parts: string[] = [`## Key Commands`];
  for (const cmd of commands) {
    parts.push(
      `- **Command:** \`${escapeMd(cmd.command)}\` | **Outcome:** ${cmd.outcome}${cmd.output_summary ? ` | **Summary:** ${escapeMd(cmd.output_summary)}` : ""}`,
    );
  }
  return parts.join("\n");
}

function buildVerificationEvidence(verifications: SummaryVerificationEvent[]): string {
  if (verifications.length === 0) {
    return `## Verification Evidence\n\n*No verification events recorded.*`;
  }
  const parts: string[] = [`## Verification Evidence`];
  for (const v of verifications) {
    parts.push(
      `- **Kind:** ${v.kind} | **Result:** ${v.result}${v.command ? ` | **Command:** \`${escapeMd(v.command)}\`` : ""}`,
    );
  }
  return parts.join("\n");
}

function buildChangedFiles(fileChanges: SummaryFileChange[], implementationRunId: string, truncated: boolean): string {
  const safe = fileChanges.filter((fc) => !isAbsoluteLike(fc.path) && !fc.path.includes(".."));
  const ref = `file-change-set:${implementationRunId}`;
  if (safe.length === 0) {
    return `## Changed Files\n\n*No file changes recorded.*\n\n**File Change Set Ref:** ${ref}`;
  }
  const parts: string[] = [`## Changed Files`];
  parts.push(`**File Change Set Ref:** ${ref}`);
  if (truncated) {
    parts.push(`*${safe.length} files changed (list truncated for summary size).*`);
    return parts.join("\n");
  }
  for (const fc of safe) {
    parts.push(`- [${fc.change_type}] ${toForwardSlash(fc.path)}`);
  }
  return parts.join("\n");
}

function buildHandoffSection(handoff: HandoffPayload | null): string {
  if (!handoff) {
    return `## Implementation Handoff\n\n*No handoff available.*`;
  }
  const parts: string[] = [`## Implementation Handoff`];
  parts.push(escapeMd(handoff.summary));
  if (handoff.known_risks.length > 0) {
    parts.push(`**Known Risks:**`);
    for (const r of handoff.known_risks) {
      parts.push(`- ${escapeMd(r)}`);
    }
  }
  if (handoff.missing_evidence.length > 0) {
    parts.push(`**Missing Evidence:**`);
    for (const e of handoff.missing_evidence) {
      parts.push(`- ${escapeMd(e)}`);
    }
  }
  return parts.join("\n");
}

function buildFindings(result: ValidationResultEnvelope): string {
  if (result.findings.length === 0) {
    return `## Findings\n\n*No findings recorded.*`;
  }
  const parts: string[] = [`## Findings`];
  for (const f of result.findings) {
    const loc = f.file_path ? ` (${toForwardSlash(f.file_path)}${f.line !== null ? `:${f.line}` : ""})` : "";
    parts.push(
      `- **[${f.severity}]**${loc}: ${escapeMd(f.message)}${f.suggestion ? ` -> ${escapeMd(f.suggestion)}` : ""}`,
    );
  }
  return parts.join("\n");
}

function buildLessonsCandidate(lessons: string[]): string {
  if (lessons.length === 0) {
    return `## Lessons Candidate\n\n*No lessons candidate recorded.*`;
  }
  const parts: string[] = [`## Lessons Candidate`];
  for (const l of lessons) {
    parts.push(`- ${escapeMd(l)}`);
  }
  return parts.join("\n");
}

function buildTraceCompleteness(completeness: TraceCompleteness): string {
  const parts: string[] = [`## Trace Completeness`];
  parts.push(`- **Commands:** ${completeness.commands}`);
  parts.push(`- **Verification:** ${completeness.verification}`);
  parts.push(`- **File Changes:** ${completeness.file_changes}`);
  parts.push(`- **Refs:** ${completeness.refs}`);
  if (completeness.reasons.length > 0) {
    parts.push(`**Warnings:**`);
    for (const r of completeness.reasons) {
      parts.push(`- ${escapeMd(r)}`);
    }
  }
  return parts.join("\n");
}

interface Section {
  key: string;
  content: string;
  essential: boolean;
}

export function buildEvidenceSummary(input: EvidenceSummaryBuildInput): EvidenceSummaryBuildResult {
  const sameOrigin = isSameOriginValidation(input.implementationRun.identity, input.validatorRun.identity);
  const evidenceRefs = aggregateEvidenceRefs(input);

  const filesFull = buildChangedFiles(input.fileChanges, input.implementationRun.id, false);
  const filesTrunc = buildChangedFiles(input.fileChanges, input.implementationRun.id, true);

  const allSections: Section[] = [
    { key: "title", content: `# ${escapeMd(input.issue.title)} - Evidence Summary`, essential: true },
    { key: "goal", content: buildGoal(input.issue.goal), essential: true },
    { key: "result", content: buildFinalResult(input.result), essential: true },
    { key: "impl_summary", content: buildImplementationSummary(input.handoff), essential: false },
    { key: "key_decisions", content: buildKeyDecisions(input.result.key_decisions), essential: true },
    { key: "validation", content: buildValidation(input.result, sameOrigin), essential: true },
    {
      key: "identities",
      content: buildRunIdentities(input.implementationRun, input.validatorRun, sameOrigin),
      essential: true,
    },
    { key: "policy", content: buildPolicySection(input.policySnapshot, input.policySnapshotHash), essential: true },
    { key: "commands", content: buildKeyCommands(input.commands), essential: false },
    { key: "verifications", content: buildVerificationEvidence(input.verifications), essential: false },
    { key: "files", content: filesFull, essential: false },
    { key: "handoff", content: buildHandoffSection(input.handoff), essential: false },
    { key: "findings", content: buildFindings(input.result), essential: false },
    { key: "lessons", content: buildLessonsCandidate(input.result.lessons_candidate), essential: true },
    { key: "trace", content: buildTraceCompleteness(input.traceCompleteness), essential: true },
  ];

  const joinSections = (sections: Section[]): string => sections.map((s) => s.content).join("\n\n");

  const tryBuild = (transform: (sections: Section[]) => Section[]): string => {
    const result = transform(allSections);
    return joinSections(result);
  };

  let markdown = joinSections(allSections);
  let truncated = false;

  if (utf8Bytes(markdown) > SUMMARY_MAX_BYTES) {
    markdown = tryBuild((s) => s.map((sec) => (sec.key === "files" ? { ...sec, content: filesTrunc } : sec)));
    truncated = true;
  }

  const removalOrder = ["commands", "verifications", "findings", "handoff", "impl_summary"];
  for (const key of removalOrder) {
    if (utf8Bytes(markdown) <= SUMMARY_MAX_BYTES) break;
    markdown = tryBuild((s) => s.filter((sec) => sec.key !== key));
  }

  if (utf8Bytes(markdown) > SUMMARY_MAX_BYTES) {
    const essential = allSections.filter((s) => s.essential);
    const essentialMd = joinSections(essential);
    if (utf8Bytes(essentialMd) > SUMMARY_MAX_BYTES) {
      throw new EvidenceSummaryBuilderError(
        "summary_exceeds_limit",
        `Evidence summary exceeds ${SUMMARY_MAX_BYTES} bytes even with essential sections only`,
      );
    }
    markdown = essentialMd;
    truncated = true;
  }

  return {
    markdown,
    evidenceRefs,
    sameOriginValidation: sameOrigin,
    truncated,
  };
}
