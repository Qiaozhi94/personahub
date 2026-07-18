import type { Run, ThreadEvent, RunFileChange, IssueWithThread } from "@personahub/shared/types";
import {
  ThreadEventType,
  type TraceCompleteness,
  type RunFileChange as RFC,
  FileChangeType,
} from "@personahub/shared/types";
import type { IssueRepository } from "../repositories/issue.js";
import type { RunRepository } from "../repositories/run.js";
import type { ThreadEventRepository } from "../repositories/thread-event.js";
import type { FileChangeRepository } from "../repositories/file-change.js";
import type { RunTraceRepository } from "../repositories/run-trace.js";
import type { EvidenceService } from "./evidence.js";
import { buildTraceCompleteness, aggregateIssueCompleteness } from "./trace-completeness.js";
import { TRACE_LIMITS } from "../runtime/trace/constants.js";
import { AppError } from "../api/errors.js";
import { ErrorCode } from "@personahub/shared/errors";

const EXPORT_EVENT_TYPES: ThreadEventType[] = [
  ThreadEventType.CommandStarted,
  ThreadEventType.CommandCompleted,
  ThreadEventType.TestCompleted,
  ThreadEventType.FileChangeSummary,
  ThreadEventType.FileChangeScanFailed,
  ThreadEventType.HandoffCreated,
  ThreadEventType.ValidationRequested,
  ThreadEventType.ValidationFinding,
  ThreadEventType.ValidationPassed,
  ThreadEventType.ValidationFailed,
  ThreadEventType.ValidationBlocked,
  ThreadEventType.RunQueued,
  ThreadEventType.RunStarted,
  ThreadEventType.RunCompleted,
  ThreadEventType.RunFailed,
  ThreadEventType.RunCancelled,
  ThreadEventType.RunInterrupted,
  ThreadEventType.EscalationTriggered,
  ThreadEventType.IssueBlocked,
];

interface ExportData {
  issueTitle: string;
  issueGoal: string;
  issueId: string;
  issueStatus: string;
  runs: Array<{
    run: Run;
    events: ThreadEvent[];
    fileChanges: RunFileChange[];
    fileScanFailed: boolean;
    completeness: TraceCompleteness | null;
  }>;
  issueCompleteness: TraceCompleteness;
  allEvents: ThreadEvent[];
  truncated: boolean;
}

export class TraceExportService {
  constructor(
    private issueRepo: IssueRepository,
    private runRepo: RunRepository,
    private threadEventRepo: ThreadEventRepository,
    private fileChangeRepo: FileChangeRepository,
    private runTraceRepo: RunTraceRepository,
    private evidenceService: EvidenceService,
  ) {}

  exportIssueTraceMarkdown(issueId: string): { content: string; filename: string } {
    const data = this.gatherExportData(issueId);
    const markdown = this.renderMarkdown(data);
    const filename = this.sanitizeFilename(data.issueTitle) + "-development-trace.md";
    return { content: markdown, filename };
  }

  private gatherExportData(issueId: string): ExportData {
    const issue = this.issueRepo.getById(issueId);
    if (!issue) {
      throw new AppError(ErrorCode.ISSUE_NOT_FOUND, "Issue not found.");
    }
    const threadId = issue.primary_thread_id;
    if (!threadId) {
      throw new AppError(ErrorCode.THREAD_NOT_FOUND, "Issue has no primary thread.");
    }

    const allEvents = this.threadEventRepo.listByThreadAndTypes(threadId, EXPORT_EVENT_TYPES, undefined, 100000);

    const runs = this.runRepo.listByIssue(issueId);
    let totalChanges = 0;
    let truncated = false;

    const runData = runs.map((run) => {
      if (!run.started_at) {
        return { run, events: [], fileChanges: [], fileScanFailed: false, completeness: null };
      }

      const runEvents = allEvents.filter((e) => e.payload_json.run_id === run.id);
      const traceState = this.runTraceRepo.get(run.id);

      const allRefs = runEvents.flatMap((e) => e.evidence_refs);
      const evidence = this.evidenceService.resolve([...new Set(allRefs)], { issueId, threadId, runId: run.id });
      const evidenceFailures = evidence.filter((e) => e.status !== "resolved").length;

      const fileCount = this.fileChangeRepo.countByRun(run.id);
      const completeness = buildTraceCompleteness(run, runEvents, fileCount, traceState, evidenceFailures);

      const fileScanFailed = runEvents.some((e) => e.type === ThreadEventType.FileChangeScanFailed);

      let fileChanges: RunFileChange[] = [];
      if (!fileScanFailed) {
        const remaining = TRACE_LIMITS.exportChanges - totalChanges;
        if (remaining > 0) {
          fileChanges = this.fileChangeRepo.listByRun(run.id, undefined, remaining + 1);
          if (fileChanges.length > remaining) {
            truncated = true;
            fileChanges = fileChanges.slice(0, remaining);
          }
          totalChanges += fileChanges.length;
        } else {
          truncated = true;
        }
      }

      return { run, events: runEvents, fileChanges, fileScanFailed, completeness };
    });

    const issueCompleteness = aggregateIssueCompleteness(
      runData.map((rd) => ({ run: rd.run, completeness: rd.completeness })),
    );

    return {
      issueTitle: issue.title,
      issueGoal: issue.goal ?? "",
      issueId: issue.id,
      issueStatus: issue.status,
      runs: runData,
      issueCompleteness,
      allEvents,
      truncated,
    };
  }

  private renderMarkdown(data: ExportData): string {
    const lines: string[] = [];
    const title = this.escapeMarkdown(data.issueTitle || "Untitled Issue");

    lines.push(`# ${title} - Development Trace`);
    lines.push("");
    lines.push("## Issue");
    lines.push("");
    lines.push(`- **ID**: ${data.issueId}`);
    lines.push(`- **Title**: ${title}`);
    lines.push(`- **Goal**: ${this.escapeMarkdown(data.issueGoal || "Not specified")}`);
    lines.push(`- **Status**: ${data.issueStatus}`);
    lines.push("");

    lines.push("## Trace Completeness");
    lines.push("");
    const ic = data.issueCompleteness;
    lines.push(`- Commands: ${ic.commands}`);
    lines.push(`- Verification: ${ic.verification}`);
    lines.push(`- File Changes: ${ic.file_changes}`);
    lines.push(`- Refs: ${ic.refs}`);
    if (ic.reasons.length > 0) {
      lines.push(`- Reasons: ${ic.reasons.map((r) => this.escapeMarkdown(r)).join(", ")}`);
    }
    lines.push("");

    for (const rd of data.runs) {
      if (!rd.completeness) continue;
      lines.push(`## Run ${rd.run.id} - ${rd.run.status}`);
      lines.push("");

      lines.push("### Commands");
      lines.push("");
      const commands = rd.events.filter(
        (e) => e.type === ThreadEventType.CommandStarted || e.type === ThreadEventType.CommandCompleted,
      );
      if (commands.length === 0) {
        lines.push("Not recorded.");
        lines.push("");
      } else {
        for (const cmd of commands) {
          const commandText = (cmd.payload_json.command as string) ?? "";
          const fenceLen = this.calcFenceLen(commandText);
          const fence = "`".repeat(fenceLen);
          // Inside a fenced code block the content is literal; escaping it would
          // corrupt Windows paths (C:\x -> C:\\x) and angle brackets. calcFenceLen
          // already guards against fence-breaking backtick runs in the command.
          lines.push(fence);
          lines.push(commandText);
          lines.push(fence);
          if (cmd.type === ThreadEventType.CommandCompleted) {
            const outcome = cmd.payload_json.outcome as string;
            const exitCode = cmd.payload_json.exit_code as number | null;
            lines.push(`- Outcome: ${outcome}`);
            lines.push(`- Exit Code: ${exitCode ?? "unknown"}`);
          }
          lines.push("");
        }
      }

      lines.push("### Verification");
      lines.push("");
      const tests = rd.events.filter((e) => e.type === ThreadEventType.TestCompleted);
      if (tests.length === 0) {
        lines.push("Not recorded.");
        lines.push("");
      } else {
        for (const test of tests) {
          const kind = test.payload_json.test_kind as string;
          const result = test.payload_json.result as string;
          lines.push(`- ${kind}: ${result}`);
        }
        lines.push("");
      }

      lines.push("### File Changes");
      lines.push("");
      if (rd.fileScanFailed) {
        const fileEvent = rd.events.find((e) => e.type === ThreadEventType.FileChangeScanFailed);
        const reason = (fileEvent?.payload_json.reason_code as string) ?? "unknown";
        lines.push(`Scan failed: ${this.escapeMarkdown(reason)}`);
        lines.push("");
      } else {
        lines.push(`Total changes: ${rd.fileChanges.length}`);
        if (rd.fileChanges.length > 0) {
          for (const fc of rd.fileChanges.slice(0, TRACE_LIMITS.eventPreview)) {
            lines.push(`- ${this.escapeMarkdown(fc.path)} (${fc.change_type})`);
          }
          if (rd.fileChanges.length > TRACE_LIMITS.eventPreview) {
            lines.push(`... and ${rd.fileChanges.length - TRACE_LIMITS.eventPreview} more (see Run evidence API for full list)`);
          }
        }
        lines.push("");
      }

      lines.push("### Handoff");
      lines.push("");
      const handoff = rd.events.find((e) => e.type === ThreadEventType.HandoffCreated);
      if (!handoff) {
        lines.push("Not recorded.");
        lines.push("");
      } else {
        const summary = handoff.payload_json.summary as string;
        const nextAction = handoff.payload_json.next_expected_action as string;
        lines.push(`- Summary: ${this.escapeMarkdown(summary)}`);
        lines.push(`- Next Action: ${this.escapeMarkdown(nextAction)}`);
        const risks = handoff.payload_json.known_risks as string[];
        if (risks && risks.length > 0) {
          lines.push("- Risks:");
          for (const risk of risks) {
            lines.push(`  - ${this.escapeMarkdown(risk)}`);
          }
        }
        lines.push("");
      }
    }

    lines.push("## Validation Trace");
    lines.push("");
    const validationEvents = data.allEvents.filter((e) => e.type.startsWith("validation."));
    if (validationEvents.length === 0) {
      lines.push("No validation events recorded.");
      lines.push("");
    } else {
      for (const vEvent of validationEvents) {
        const vType = vEvent.type.replace("validation.", "");
        const round = vEvent.payload_json.validation_round as number;
        lines.push(`- **${vType}** (round ${round})`);
        if (vEvent.type === ThreadEventType.ValidationFinding) {
          const severity = vEvent.payload_json.severity as string;
          const message = vEvent.payload_json.message as string;
          lines.push(`  - Severity: ${severity}`);
          lines.push(`  - Message: ${this.escapeMarkdown(message)}`);
        } else if (vEvent.payload_json.summary) {
          lines.push(`  - Summary: ${this.escapeMarkdown(vEvent.payload_json.summary as string)}`);
        }
      }
      lines.push("");
    }

    lines.push("## Missing / Truncated Evidence");
    lines.push("");
    if (data.truncated) {
      lines.push(`- File changes truncated at export limit (${TRACE_LIMITS.exportChanges})`);
    }
    const missing = data.runs.flatMap((rd) => {
      const refs = rd.events.flatMap((e) => e.evidence_refs);
      const resolved = this.evidenceService.resolve([...new Set(refs)], {
        issueId: data.issueId,
        runId: rd.run.id,
      });
      return resolved.filter((e) => e.status !== "resolved");
    });
    if (missing.length === 0 && !data.truncated) {
      lines.push("No missing or truncated evidence.");
    } else {
      for (const m of missing) {
        lines.push(`- ${this.escapeMarkdown(m.ref)}: ${m.status}${m.reason ? ` (${m.reason})` : ""}`);
      }
    }
    lines.push("");

    return lines.join("\n");
  }

  private escapeMarkdown(text: string): string {
    return text
      .replace(/\\/g, "\\\\")
      .replace(/`/g, "\\`")
      .replace(/\*/g, "\\*")
      .replace(/_/g, "\\_")
      .replace(/\[/g, "\\[")
      .replace(/\]/g, "\\]")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  private sanitizeFilename(name: string): string {
    return name
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .substring(0, 100) || "issue";
  }

  private calcFenceLen(text: string): number {
    let maxLen = 3;
    const matches = text.match(/`+/g);
    if (matches) {
      for (const m of matches) {
        if (m.length >= maxLen) {
          maxLen = m.length + 1;
        }
      }
    }
    return maxLen;
  }
}
