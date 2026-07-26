import type {
  ValidationPolicySnapshot,
  AdapterIdentitySnapshot,
  TraceCompleteness,
} from "@personahub/shared/types";
import type { HandoffPayload } from "../handoff-builder.js";

export const CONTEXT_MAX_BYTES = 128 * 1024;

export class ContextBuilderError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ContextBuilderError";
  }
}

export interface ContextRunIdentity {
  id: string;
  identity: AdapterIdentitySnapshot;
}

export interface ContextVerificationEvent {
  id: string;
  kind: string;
  result: string;
  command: string | null;
  evidence_ref: string;
}

export interface ContextFileChange {
  path: string;
  change_type: string;
}

export interface ContextPriorFinding {
  validation_round: number;
  severity: string;
  message: string;
  suggestion: string | null;
  file_path: string | null;
  line: number | null;
}

export interface ValidatorContextInput {
  issue: { title: string; goal: string | null };
  policySnapshot: ValidationPolicySnapshot;
  policySnapshotHash: string;
  implementationRun: ContextRunIdentity;
  validatorRun: ContextRunIdentity;
  handoff: HandoffPayload | null;
  verifications: ContextVerificationEvent[];
  fileChanges: ContextFileChange[];
  fileChangeSetRef: string;
  priorFindings: ContextPriorFinding[];
  traceCompleteness: TraceCompleteness;
  validationRound: number;
  /** Manual dispatch: the composer text the user sent alongside picking a validator (design gap fix — was silently dropped). */
  userInstructions?: string | null;
}

export interface ValidatorContextResult {
  markdown: string;
  truncated: boolean;
  truncatedSections: string[];
}

function utf8Bytes(s: string): number {
  return Buffer.byteLength(s, "utf8");
}

function toForwardSlash(p: string): string {
  return p.split("\\").join("/");
}

const JSON_SCHEMA_CONTRACT = `## System Contract

You are a validator. Your final message MUST be a single JSON object with this schema — and
**nothing else**: no preamble, no closing remarks, no explanation before or after it. The
parser is strict: if your final message contains so much as one sentence of commentary
outside the JSON (even something as short as "Here is my validation result:"), the entire
validation is rejected as unparsable and the Issue is blocked through no fault of the
implementation being validated. Either output the raw JSON object with nothing else around
it, or wrap it in a single \`\`\`json ... \`\`\` fenced code block with nothing before the opening
fence or after the closing fence — do not mix the two, and do not add a second fence anywhere.
\`\`\`json
{
  "schema_version": 1,
  "outcome": "passed" | "failed" | "blocked",
  "summary": "string (max 8 KiB)",
  "findings": [{ "severity": "info|warning|error|blocking", "message": "string", "suggestion": "string|null", "evidence_refs": ["string"], "file_path": "string|null", "line": "number|null" }],
  "evidence_refs": ["string"],
  "missing_evidence": ["string"],
  "key_decisions": ["string"],
  "lessons_candidate": ["string"]
}
\`\`\`
- passed: findings=[] and missing_evidence=[]
- failed: at least one finding
- blocked: explain reason in missing_evidence or findings
- file_path must be workspace-relative

**evidence_refs / findings[].evidence_refs format — read carefully:**
Every string in these arrays MUST be one of the exact ref values already shown
below in "Verification Evidence" (\`**Ref:** event:<id>\` or
\`**Ref:** file-change-set:<id>\`) or "Changed Files" (\`**File Change Set Ref:**
file-change-set:<id>\`) — copy that literal \`event:...\` or \`file-change-set:...\`
string verbatim. Do NOT invent your own citation format (e.g. \`file:path#L12\`,
a bare file path, or a line-number reference) — those will be rejected as
invalid and the whole validation blocked. If you have nothing from those
sections to cite, use an empty array \`[]\`, never a made-up reference.`;

function sectionIssue(title: string, goal: string | null): string {
  let s = `## Issue\n\n**Title:** ${title}\n`;
  if (goal) {
    s += `**Goal:** ${goal}\n`;
  }
  return s;
}

function sectionPolicy(snapshot: ValidationPolicySnapshot, hash: string): string {
  const req = snapshot.evidence_requirements;
  return `## Validation Policy

- **Policy ID:** ${snapshot.policy_id}
- **Version:** ${snapshot.version}
- **Max Validation Rounds:** ${snapshot.max_validation_rounds}
- **Snapshot Hash:** ${hash}
- **Require Handoff:** ${req.require_handoff}
- **Require File Trace:** ${req.require_file_trace}
- **Require Verification:** ${req.require_verification}
- **Accepted Verification Kinds:** ${req.accepted_verification_kinds.join(", ")}`;
}

function sectionRunIdentity(label: string, run: ContextRunIdentity): string {
  const id = run.identity;
  return `## ${label}

- **Run ID:** ${run.id}
- **Adapter Config ID:** ${id.adapter_config_id}
- **Name:** ${id.name}
- **CLI Provider:** ${id.cli_provider}
- **Default Model:** ${id.default_model ?? "N/A"}`;
}

function sectionHandoff(handoff: HandoffPayload | null): string {
  if (!handoff) {
    return `## Implementation Handoff

*No handoff available for this implementation run.*`;
  }
  const parts: string[] = [`## Implementation Handoff`];
  parts.push(`**Summary:** ${handoff.summary}`);
  if (handoff.completed_work.length > 0) {
    parts.push(`**Completed Work:**\n${handoff.completed_work.map((w) => `- ${w}`).join("\n")}`);
  }
  if (handoff.known_risks.length > 0) {
    parts.push(`**Known Risks:**\n${handoff.known_risks.map((r) => `- ${r}`).join("\n")}`);
  }
  if (handoff.missing_evidence.length > 0) {
    parts.push(`**Missing Evidence:**\n${handoff.missing_evidence.map((e) => `- ${e}`).join("\n")}`);
  }
  parts.push(`**Evidence Ref Count:** ${handoff.evidence_ref_count}${handoff.evidence_refs_truncated ? " (truncated)" : ""}`);
  return parts.join("\n\n");
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

function sectionVerifications(verifications: ContextVerificationEvent[], mode: "full" | "count_only"): string {
  if (verifications.length === 0) {
    return `## Verification Evidence\n\n*No verification events found.*`;
  }
  if (mode === "count_only") {
    const passed = verifications.filter((v) => v.result === "passed").length;
    const failed = verifications.filter((v) => v.result === "failed").length;
    return `## Verification Evidence\n\n*${verifications.length} verification(s): ${passed} passed, ${failed} failed. Details truncated for context size.*`;
  }
  const parts: string[] = [`## Verification Evidence`];
  for (const v of verifications) {
    parts.push(`- **Kind:** ${v.kind} | **Result:** ${v.result} | **Ref:** ${v.evidence_ref}${v.command ? ` | **Command:** ${v.command}` : ""}`);
  }
  return parts.join("\n");
}

function sectionFileChanges(
  fileChanges: ContextFileChange[],
  fileChangeSetRef: string,
  mode: "full" | "count",
): string {
  const safe = fileChanges.filter((fc) => !isAbsoluteLike(fc.path) && !fc.path.includes(".."));
  if (safe.length === 0) {
    return `## Changed Files\n\n*No file changes recorded.*\n\n**File Change Set Ref:** ${fileChangeSetRef}`;
  }
  if (mode === "count") {
    return `## Changed Files\n\n*${safe.length} files changed (list truncated for context size).*\n\n**File Change Set Ref:** ${fileChangeSetRef}`;
  }
  const parts: string[] = [`## Changed Files`];
  parts.push(`**File Change Set Ref:** ${fileChangeSetRef}`);
  for (const fc of safe) {
    parts.push(`- [${fc.change_type}] ${toForwardSlash(fc.path)}`);
  }
  return parts.join("\n");
}

function sectionPriorFindings(
  findings: ContextPriorFinding[],
  mode: "all" | "latest_only",
): string {
  if (findings.length === 0) {
    return `## Prior Validation Findings\n\n*No prior findings.*`;
  }
  const filtered = mode === "latest_only"
    ? findings.filter((f) => f.validation_round === Math.max(...findings.map((x) => x.validation_round)))
    : findings;
  const parts: string[] = [`## Prior Validation Findings`];
  if (mode === "latest_only" && findings.length > filtered.length) {
    parts.push(`*(Showing latest round only; ${findings.length - filtered.length} older findings omitted for size.)*`);
  }
  for (const f of filtered) {
    const loc = f.file_path ? ` (${toForwardSlash(f.file_path)}${f.line !== null ? `:${f.line}` : ""})` : "";
    parts.push(`- [Round ${f.validation_round}] **${f.severity}**${loc}: ${f.message}${f.suggestion ? ` -> ${f.suggestion}` : ""}`);
  }
  return parts.join("\n");
}

const USER_REQUEST_MAX_CHARS = 4_000;

function sectionUserRequest(userInstructions: string | null | undefined): string | null {
  const trimmed = userInstructions?.trim();
  if (!trimmed) return null;
  const truncated = trimmed.length > USER_REQUEST_MAX_CHARS;
  const body = truncated ? `${trimmed.slice(0, USER_REQUEST_MAX_CHARS)}\n\n*(truncated at ${USER_REQUEST_MAX_CHARS} characters)*` : trimmed;
  return `## User Validation Request\n\n*The user manually picked this validator and included the following instructions alongside it — treat as additional context, not a replacement for the Validation Policy above.*\n\n${body}`;
}

function sectionTraceCompleteness(completeness: TraceCompleteness): string {
  const parts: string[] = [`## Trace Completeness`];
  parts.push(`- **Commands:** ${completeness.commands}`);
  parts.push(`- **Verification:** ${completeness.verification}`);
  parts.push(`- **File Changes:** ${completeness.file_changes}`);
  parts.push(`- **Refs:** ${completeness.refs}`);
  if (completeness.reasons.length > 0) {
    parts.push(`**Warnings:**`);
    for (const r of completeness.reasons) {
      parts.push(`- ${r}`);
    }
  }
  return parts.join("\n");
}

export function buildValidatorContext(input: ValidatorContextInput): ValidatorContextResult {
  const userRequest = sectionUserRequest(input.userInstructions);
  const mustNotTruncate: string[] = [
    JSON_SCHEMA_CONTRACT,
    sectionIssue(input.issue.title, input.issue.goal),
    sectionPolicy(input.policySnapshot, input.policySnapshotHash),
    sectionRunIdentity("Implementation Run", input.implementationRun),
    sectionRunIdentity("Validator Run", input.validatorRun),
    sectionHandoff(input.handoff),
    `## Validation Round\n\n**Current Round:** ${input.validationRound}`,
    sectionTraceCompleteness(input.traceCompleteness),
    ...(userRequest ? [userRequest] : []),
  ];

  const truncatableSections = {
    verificationsFull: sectionVerifications(input.verifications, "full"),
    verificationsCount: sectionVerifications(input.verifications, "count_only"),
    filesFull: sectionFileChanges(input.fileChanges, input.fileChangeSetRef, "full"),
    filesCount: sectionFileChanges(input.fileChanges, input.fileChangeSetRef, "count"),
    findingsAll: sectionPriorFindings(input.priorFindings, "all"),
    findingsLatest: sectionPriorFindings(input.priorFindings, "latest_only"),
    findingsNone: `## Prior Validation Findings\n\n*Omitted for context size.*`,
  };

  const buildFull = () => [
    ...mustNotTruncate,
    truncatableSections.verificationsFull,
    truncatableSections.filesFull,
    truncatableSections.findingsAll,
  ].join("\n\n");

  const buildWithFilesCounted = () => [
    ...mustNotTruncate,
    truncatableSections.verificationsFull,
    truncatableSections.filesCount,
    truncatableSections.findingsAll,
  ].join("\n\n");

  const buildWithFilesAndVerifTrunc = () => [
    ...mustNotTruncate,
    truncatableSections.verificationsCount,
    truncatableSections.filesCount,
    truncatableSections.findingsAll,
  ].join("\n\n");

  const buildWithFindingsLatest = () => [
    ...mustNotTruncate,
    truncatableSections.verificationsCount,
    truncatableSections.filesCount,
    truncatableSections.findingsLatest,
  ].join("\n\n");

  const buildWithFindingsNone = () => [
    ...mustNotTruncate,
    truncatableSections.verificationsCount,
    truncatableSections.filesCount,
    truncatableSections.findingsNone,
  ].join("\n\n");

  const candidates: Array<{ markdown: string; truncatedSections: string[] }> = [
    { markdown: buildFull(), truncatedSections: [] },
    { markdown: buildWithFilesCounted(), truncatedSections: ["file_list"] },
    { markdown: buildWithFilesAndVerifTrunc(), truncatedSections: ["file_list", "verification_summaries"] },
    { markdown: buildWithFindingsLatest(), truncatedSections: ["file_list", "verification_summaries", "older_findings"] },
    { markdown: buildWithFindingsNone(), truncatedSections: ["file_list", "verification_summaries", "all_findings"] },
  ];

  for (const candidate of candidates) {
    if (utf8Bytes(candidate.markdown) <= CONTEXT_MAX_BYTES) {
      return {
        markdown: candidate.markdown,
        truncated: candidate.truncatedSections.length > 0,
        truncatedSections: candidate.truncatedSections,
      };
    }
  }

  const mustNotBytes = utf8Bytes(mustNotTruncate.join("\n\n"));
  throw new ContextBuilderError(
    "context_exceeds_limit",
    `Validator context exceeds ${CONTEXT_MAX_BYTES} bytes even after full truncation (must-not-truncate sections: ${mustNotBytes} bytes)`,
  );
}

export interface RepairContextInput {
  baseInstructions: string;
  latestFailedFindings: ContextPriorFinding[];
  validationRound: number;
}

export function buildRepairContext(input: RepairContextInput): string {
  const parts: string[] = [input.baseInstructions];

  if (input.latestFailedFindings.length > 0) {
    parts.push("");
    parts.push(`## Prior Validation Findings (Round ${input.validationRound})`);
    for (const f of input.latestFailedFindings) {
      const loc = f.file_path ? ` (${toForwardSlash(f.file_path)}${f.line !== null ? `:${f.line}` : ""})` : "";
      const sugg = f.suggestion ? ` -> Suggestion: ${f.suggestion}` : "";
      parts.push(`- [${f.severity}]${loc}: ${f.message}${sugg}`);
    }
  }

  return parts.join("\n");
}
