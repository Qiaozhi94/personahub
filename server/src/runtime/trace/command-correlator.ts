import type { Run, ThreadEvent } from "@personahub/shared/types";
import {
  ThreadEventType,
  ActorType,
  TraceSource,
  EvidenceConfidence,
  CommandOutcome,
  CommandTraceCapability,
  type RunTraceSignal,
} from "@personahub/shared/types";
import type { ThreadEventService } from "../../services/thread-event.js";
import { redactCommand, redactSummary } from "./redaction.js";
import { classifyVerificationCommand } from "./verification-classifier.js";
import { TRACE_LIMITS } from "./constants.js";
import { normalizeWorkspacePath } from "./path-utils.js";

interface RunContext {
  run: Run;
  workspacePath: string;
  traceCapability: CommandTraceCapability;
}

interface PendingState {
  commandStartedEventId: string | null;
  outputEventIds: string[];
  completedEventId: string | null;
}

export class CommandCorrelator {
  private commandEventsByItemId = new Map<string, PendingState>();

  constructor(private threadEventService: ThreadEventService) {}

  handleSignal(signal: RunTraceSignal, ctx: RunContext): ThreadEvent[] {
    if (ctx.traceCapability === CommandTraceCapability.Unsupported) {
      return [];
    }

    if (signal.type === "command_started") {
      return this.handleStarted(signal, ctx);
    }
    return this.handleCompleted(signal, ctx);
  }

  private handleStarted(signal: RunTraceSignal & { type: "command_started" }, ctx: RunContext): ThreadEvent[] {
    if (this.commandEventsByItemId.has(signal.adapterItemId)) {
      return [];
    }

    const { text: command, truncated: commandTruncated } = redactCommand(signal.command);
    const cwd = signal.cwd ? this.relativizeCwd(signal.cwd, ctx.workspacePath) : null;

    const event = this.threadEventService.writeAndBroadcast(
      ctx.run.thread_id,
      ThreadEventType.CommandStarted,
      ActorType.System,
      null,
      {
        issue_id: ctx.run.issue_id,
        thread_id: ctx.run.thread_id,
        run_id: ctx.run.id,
        workspace_id: ctx.run.workspace_id,
        adapter_item_id: signal.adapterItemId,
        command,
        command_truncated: commandTruncated,
        cwd,
        source: signal.source,
        confidence: EvidenceConfidence.Confirmed,
      },
    );

    this.commandEventsByItemId.set(signal.adapterItemId, {
      commandStartedEventId: event.id,
      outputEventIds: [],
      completedEventId: null,
    });

    return [event];
  }

  private handleCompleted(signal: RunTraceSignal & { type: "command_completed" }, ctx: RunContext): ThreadEvent[] {
    const pending = this.commandEventsByItemId.get(signal.adapterItemId);

    if (pending?.completedEventId) {
      return [];
    }

    const events: ThreadEvent[] = [];

    let startedEventId = pending?.commandStartedEventId ?? null;
    if (!startedEventId && signal.command) {
      const syntheticStarted = this.createSyntheticStarted(signal, ctx);
      if (syntheticStarted) {
        events.push(syntheticStarted);
        startedEventId = syntheticStarted.id;
        this.commandEventsByItemId.set(signal.adapterItemId, {
          commandStartedEventId: startedEventId,
          outputEventIds: [],
          completedEventId: null,
        });
      }
    }

    const { text: command, truncated: commandTruncated } = signal.command
      ? redactCommand(signal.command)
      : { text: "", truncated: false };

    const outcome = this.normalizeOutcome(signal);
    const { text: summary, truncated: summaryTruncated } = signal.outputSummary
      ? redactSummary(signal.outputSummary)
      : { text: null, truncated: false };

    const evidenceRefs = this.buildCompletedRefs(startedEventId, pending?.outputEventIds ?? []);

    const completedEvent = this.threadEventService.writeAndBroadcast(
      ctx.run.thread_id,
      ThreadEventType.CommandCompleted,
      ActorType.System,
      null,
      {
        issue_id: ctx.run.issue_id,
        thread_id: ctx.run.thread_id,
        run_id: ctx.run.id,
        workspace_id: ctx.run.workspace_id,
        adapter_item_id: signal.adapterItemId,
        command_event_id: startedEventId,
        command,
        command_truncated: commandTruncated,
        outcome,
        exit_code: signal.exitCode,
        duration_ms: signal.durationMs,
        summary,
        summary_truncated: summaryTruncated,
        output_truncated: signal.outputTruncated,
        source: signal.source,
        confidence: outcome === CommandOutcome.Unknown ? EvidenceConfidence.Partial : EvidenceConfidence.Confirmed,
      },
      evidenceRefs,
    );
    events.push(completedEvent);

    if (pending) {
      pending.completedEventId = completedEvent.id;
    } else {
      this.commandEventsByItemId.set(signal.adapterItemId, {
        commandStartedEventId: startedEventId,
        outputEventIds: [],
        completedEventId: completedEvent.id,
      });
    }

    const testEvent = this.maybeWriteTestEvent(signal, outcome, completedEvent, ctx);
    if (testEvent) {
      events.push(testEvent);
    }

    return events;
  }

  private createSyntheticStarted(
    signal: RunTraceSignal & { type: "command_completed" },
    ctx: RunContext,
  ): ThreadEvent | null {
    if (!signal.command) return null;

    const { text: command, truncated: commandTruncated } = redactCommand(signal.command);
    return this.threadEventService.writeAndBroadcast(
      ctx.run.thread_id,
      ThreadEventType.CommandStarted,
      ActorType.System,
      null,
      {
        issue_id: ctx.run.issue_id,
        thread_id: ctx.run.thread_id,
        run_id: ctx.run.id,
        workspace_id: ctx.run.workspace_id,
        adapter_item_id: signal.adapterItemId,
        command,
        command_truncated: commandTruncated,
        cwd: signal.cwd ? this.relativizeCwd(signal.cwd, ctx.workspacePath) : null,
        source: signal.source,
        confidence: EvidenceConfidence.Partial,
      },
    );
  }

  private maybeWriteTestEvent(
    signal: RunTraceSignal & { type: "command_completed" },
    outcome: CommandOutcome,
    completedEvent: ThreadEvent,
    ctx: RunContext,
  ): ThreadEvent | null {
    if (signal.source !== TraceSource.AdapterStructured) return null;
    if (outcome !== CommandOutcome.Succeeded && outcome !== CommandOutcome.Failed) return null;
    if (signal.exitCode === null) return null;

    const kind = classifyVerificationCommand(signal.command ?? "");
    if (!kind) return null;

    const result = signal.exitCode === 0 ? "passed" : "failed";
    const summary = signal.outputSummary
      ? redactSummary(signal.outputSummary).text
      : null;

    return this.threadEventService.writeAndBroadcast(
      ctx.run.thread_id,
      ThreadEventType.TestCompleted,
      ActorType.System,
      null,
      {
        issue_id: ctx.run.issue_id,
        thread_id: ctx.run.thread_id,
        run_id: ctx.run.id,
        workspace_id: ctx.run.workspace_id,
        command_event_id: completedEvent.id,
        test_kind: kind,
        result,
        exit_code: signal.exitCode,
        summary,
        confidence: EvidenceConfidence.Confirmed,
      },
      [`event:${completedEvent.id}`],
    );
  }

  private normalizeOutcome(signal: RunTraceSignal & { type: "command_completed" }): CommandOutcome {
    if (signal.outcome === CommandOutcome.Blocked) return CommandOutcome.Blocked;
    if (signal.outcome === CommandOutcome.Cancelled) return CommandOutcome.Cancelled;
    if (signal.exitCode === 0) return CommandOutcome.Succeeded;
    if (signal.exitCode !== null && signal.exitCode !== 0) return CommandOutcome.Failed;
    return CommandOutcome.Unknown;
  }

  private buildCompletedRefs(startedEventId: string | null, outputEventIds: string[]): string[] {
    const refs: string[] = [];
    if (startedEventId) refs.push(`event:${startedEventId}`);
    const limitedOutput = outputEventIds.slice(0, TRACE_LIMITS.outputRefMax);
    for (const id of limitedOutput) {
      refs.push(`event:${id}`);
    }
    return refs;
  }

  private relativizeCwd(cwd: string, workspacePath: string): string | null {
    return normalizeWorkspacePath(workspacePath, cwd);
  }

  trackOutputEvent(itemId: string | undefined, eventId: string): void {
    if (!itemId) return;
    const pending = this.commandEventsByItemId.get(itemId);
    if (pending) {
      pending.outputEventIds.push(eventId);
    }
  }

  reset(): void {
    this.commandEventsByItemId.clear();
  }
}
