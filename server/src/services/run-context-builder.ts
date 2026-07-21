import { RunRole, RunPurpose, type Run, type Issue } from "@personahub/shared/types";
import type { RunRepository } from "../repositories/run.js";
import type { ThreadEventRepository } from "../repositories/thread-event.js";
import type { FileChangeRepository } from "../repositories/file-change.js";
import { collectImplementationEvidence } from "./validation/workflow-queries.js";
import { collectPriorFindings } from "./validation/context-assembler.js";
import { CONTEXT_MAX_BYTES, type ContextPriorFinding } from "./validation/context-builder.js";

/**
 * design §6.5: replaces F002's hand-rolled 5-line context string with a
 * unified builder used by every Run (implementation/consult/validator),
 * with a source-selection policy that differs by role:
 *
 * - validator: strictly the Run's own `context_source_run_id` (already
 *   fixed at creation time to `implementation_run_id` by
 *   ValidationWorkflowService — read directly here, never re-derived, so a
 *   newer handoff produced by a consult Run during the Validating grace
 *   window can never leak into what's being validated).
 * - implementation/consult: the latest *completed implementation* Run
 *   created before this one (`RunRepository.getLatestCompletedByRole` with
 *   `beforeRunId`) — a consult Run's own handoff is deliberately never
 *   eligible as a context source (design §7.5).
 *
 * Reuses collectImplementationEvidence()/collectPriorFindings() (already
 * scoped by run_id via typed ThreadEventRepository queries, e.g.
 * ThreadEventType.HandoffCreated only) rather than resolving arbitrary
 * evidence ref strings — the source Run's evidence is queried by its own id
 * and event type, so an untyped/untrusted event like `run.output` can never
 * surface here regardless of what refs a payload might otherwise contain.
 */

export const RUN_CONTEXT_MAX_BYTES = CONTEXT_MAX_BYTES;

export interface RunContextBuilderDeps {
  runRepo: RunRepository;
  threadEventRepo: ThreadEventRepository;
  fileChangeRepo: FileChangeRepository;
}

export interface BuildRunContextResult {
  context: string;
  contextSourceRunId: string | null;
}

function utf8Bytes(s: string): number {
  return Buffer.byteLength(s, "utf8");
}

function toForwardSlash(p: string): string {
  return p.split("\\").join("/");
}

function resolveContextSourceRunId(runRepo: RunRepository, run: Run, issue: Issue): string | null {
  if (run.context_source_run_id) return run.context_source_run_id;
  if (run.role === RunRole.Validator) return null;
  const prior = runRepo.getLatestCompletedByRole(issue.id, RunRole.Implementation, run.id);
  return prior?.id ?? null;
}

function sectionIssue(issue: Issue): string {
  const parts = [`## Issue`, ``, `**Title:** ${issue.title}`];
  if (issue.goal) parts.push(`**Goal:** ${issue.goal}`);
  parts.push(`**Status:** ${issue.status}`);
  return parts.join("\n");
}

function sectionRole(run: Run): string {
  const parts = [`## Role`, ``, `**Purpose:** ${run.purpose}`, `**Role:** ${run.role}`];
  if (run.purpose === RunPurpose.AdHocConsult) {
    parts.push(`*Consult — does not change Issue status, round count, or workflow step.*`);
  }
  return parts.join("\n");
}

function sectionHandoff(handoff: ReturnType<typeof collectImplementationEvidence>["handoff"], sourceRunId: string | null): string {
  if (!sourceRunId) {
    return `## Prior Work\n\n*This is the first Run for this Issue — no prior handoff available.*`;
  }
  if (!handoff) {
    return `## Prior Work\n\n*Source Run ${sourceRunId} has no recorded handoff.*`;
  }
  const parts = [`## Prior Work (from Run ${sourceRunId})`, ``, `**Summary:** ${handoff.summary}`];
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

function sectionFileChanges(fileChanges: { path: string; change_type: string }[], mode: "full" | "count"): string {
  const safe = fileChanges.filter((fc) => !fc.path.includes("..") && !/^[a-zA-Z]:[\\/]/.test(fc.path) && !fc.path.startsWith("/"));
  if (safe.length === 0) return `## Changed Files\n\n*No file changes recorded for the prior source Run.*`;
  if (mode === "count") return `## Changed Files\n\n*${safe.length} file(s) changed (list omitted for size).*`;
  const parts = [`## Changed Files`];
  for (const fc of safe) {
    parts.push(`- [${fc.change_type}] ${toForwardSlash(fc.path)}`);
  }
  return parts.join("\n");
}

function sectionPriorFindings(findings: ContextPriorFinding[]): string {
  if (findings.length === 0) return "";
  const latestRound = Math.max(...findings.map((f) => f.validation_round));
  const latest = findings.filter((f) => f.validation_round === latestRound);
  const parts = [`## Latest Validation Findings (Round ${latestRound})`];
  for (const f of latest) {
    const loc = f.file_path ? ` (${toForwardSlash(f.file_path)}${f.line !== null ? `:${f.line}` : ""})` : "";
    parts.push(`- **${f.severity}**${loc}: ${f.message}${f.suggestion ? ` -> ${f.suggestion}` : ""}`);
  }
  return parts.join("\n");
}

export function buildRunContext(deps: RunContextBuilderDeps, run: Run, issue: Issue): BuildRunContextResult {
  const sourceRunId = resolveContextSourceRunId(deps.runRepo, run, issue);

  const mustNotTruncate: string[] = [sectionIssue(issue), sectionRole(run)];

  let handoff: ReturnType<typeof collectImplementationEvidence>["handoff"] = null;
  let fileChanges: { path: string; change_type: string }[] = [];
  if (sourceRunId) {
    const evidence = collectImplementationEvidence(deps.threadEventRepo, deps.fileChangeRepo, run.thread_id, sourceRunId);
    handoff = evidence.handoff;
    fileChanges = evidence.fileChanges;
  }
  mustNotTruncate.push(sectionHandoff(handoff, sourceRunId));

  const includeLatestFindings = run.role === RunRole.Implementation && run.purpose === RunPurpose.WorkflowBound;
  const priorFindingsSection = includeLatestFindings
    ? sectionPriorFindings(collectPriorFindings(deps.threadEventRepo, run.thread_id))
    : "";
  if (priorFindingsSection) mustNotTruncate.push(priorFindingsSection);

  const buildFull = () => [...mustNotTruncate, sectionFileChanges(fileChanges, "full")].join("\n\n");
  const buildWithFilesCounted = () => [...mustNotTruncate, sectionFileChanges(fileChanges, "count")].join("\n\n");

  const candidates = [buildFull(), buildWithFilesCounted()];
  for (const candidate of candidates) {
    if (utf8Bytes(candidate) <= RUN_CONTEXT_MAX_BYTES) {
      return { context: candidate, contextSourceRunId: sourceRunId };
    }
  }

  // Must-not-truncate sections alone exceed the limit — return them as-is
  // rather than throw; a Run's generic situational context degrading is not
  // worth blocking dispatch over (unlike the validator's own required
  // context, which does throw — see ContextBuilderError).
  return { context: mustNotTruncate.join("\n\n"), contextSourceRunId: sourceRunId };
}
