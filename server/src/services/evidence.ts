import type { EvidenceResolution, ThreadEvent } from "@personahub/shared/types";
import { ErrorCode } from "@personahub/shared/errors";
import { AppError } from "../api/errors.js";
import type { ThreadEventRepository } from "../repositories/thread-event.js";
import type { FileChangeRepository } from "../repositories/file-change.js";
import type { RunRepository } from "../repositories/run.js";
import type { RunTraceRepository } from "../repositories/run-trace.js";
import { parseEvidenceRef } from "../evidence-ref.js";

// ADR 0014 P4: ref 词汇（构造 + 解析）现由 `server/src/evidence-ref.ts` 唯一拥有。
// 这里保留再导出，使既有 `services/evidence.js` 导入路径不变。
export { buildEvidenceRef, parseEvidenceRef } from "../evidence-ref.js";
export type { EvidenceRefKind, ParsedRef, ParsedRefKind } from "../evidence-ref.js";

export interface EvidenceScope {
  issueId: string;
  threadId?: string;
  runId?: string;
}


const TRUSTED_INTERNAL_ALLOWLIST = new Set<string>([
  "command.started",
  "command.completed",
  "test.completed",
  "file.change_summary",
  "file.change_scan_failed",
  "handoff.created",
  "run.completed",
  "run.failed",
  "run.cancelled",
  "run.interrupted",
  "graph.node_result",
]);

function dedupeRefs(refs: string[]): string[] {
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

export class EvidenceService {
  constructor(
    private threadEventRepo: ThreadEventRepository,
    private fileChangeRepo: FileChangeRepository,
    private runRepo: RunRepository,
    private runTraceRepo: RunTraceRepository,
  ) {}

  resolve(refs: string[], scope: EvidenceScope): EvidenceResolution[] {
    const deduped = dedupeRefs(refs);
    return deduped.map((ref) => this.resolveOne(ref, scope));
  }

  private resolveOne(ref: string, scope: EvidenceScope): EvidenceResolution {
    const parsed = parseEvidenceRef(ref);

    if (parsed.kind === "event") {
      return this.resolveEventRef(ref, parsed.id, scope);
    }
    if (parsed.kind === "file_change_set") {
      return this.resolveFileChangeSetRef(ref, parsed.id, scope);
    }
    return {
      ref,
      kind: "file_change_set",
      status: "missing",
      reason: "invalid_ref_grammar",
    };
  }

  private resolveEventRef(
    ref: string,
    eventId: string,
    scope: EvidenceScope,
  ): EvidenceResolution {
    const event = this.threadEventRepo.getById(eventId);
    if (!event) {
      return { ref, kind: "event", status: "missing" };
    }

    if (scope.threadId && event.thread_id !== scope.threadId) {
      return {
        ref,
        kind: "event",
        status: "missing",
        reason: "scope_mismatch_thread",
      };
    }

    const eventRunId = event.payload_json.run_id as string | undefined;
    if (scope.runId) {
      if (!eventRunId || eventRunId !== scope.runId) {
        return {
          ref,
          kind: "event",
          status: "missing",
          reason: "scope_mismatch_run",
        };
      }
    }

    return {
      ref,
      kind: "event",
      status: "resolved",
      target: {
        id: event.id,
        type: event.type,
        thread_id: event.thread_id,
        run_id: eventRunId,
      },
      run_id: eventRunId,
    };
  }

  private resolveFileChangeSetRef(
    ref: string,
    runId: string,
    scope: EvidenceScope,
  ): EvidenceResolution {
    if (scope.runId && runId !== scope.runId) {
      return {
        ref,
        kind: "file_change_set",
        status: "missing",
        reason: "scope_mismatch_run",
      };
    }

    const run = this.runRepo.getById(runId);
    if (!run) {
      return { ref, kind: "file_change_set", status: "missing", run_id: runId };
    }
    if (run.issue_id !== scope.issueId) {
      return {
        ref,
        kind: "file_change_set",
        status: "missing",
        run_id: runId,
        reason: "scope_mismatch_issue",
      };
    }
    if (scope.threadId && run.thread_id !== scope.threadId) {
      return {
        ref,
        kind: "file_change_set",
        status: "missing",
        run_id: runId,
        reason: "scope_mismatch_thread",
      };
    }

    const traceState = this.runTraceRepo.get(runId);
    if (!traceState || !traceState.finalized_at) {
      return { ref, kind: "file_change_set", status: "missing", run_id: runId, reason: "not_finalized" };
    }

    return {
      ref,
      kind: "file_change_set",
      status: "resolved",
      run_id: runId,
    };
  }

  validateWriteScope(refs: string[], scope: EvidenceScope): void {
    for (const ref of refs) {
      const parsed = parseEvidenceRef(ref);
      if (parsed.kind === "unknown") {
        throw new AppError(
          ErrorCode.EVIDENCE_REF_INVALID,
          `Invalid evidence ref grammar: ${ref}`,
        );
      }
      if (parsed.kind === "event") {
        const event = this.threadEventRepo.getById(parsed.id);
        if (!event) {
          throw new AppError(
            ErrorCode.EVIDENCE_REF_INVALID,
            `Evidence ref target not found: ${ref}`,
          );
        }
        if (event.thread_id !== scope.threadId) {
          throw new AppError(
            ErrorCode.EVIDENCE_SCOPE_MISMATCH,
            `Evidence ref crosses thread boundary: ${ref}`,
          );
        }
        const eventRunId = event.payload_json.run_id as string | undefined;
        if (scope.runId && (!eventRunId || eventRunId !== scope.runId)) {
          throw new AppError(
            ErrorCode.EVIDENCE_SCOPE_MISMATCH,
            `Evidence ref crosses run boundary: ${ref}`,
          );
        }
      }
      if (parsed.kind === "file_change_set") {
        if (scope.runId && parsed.id !== scope.runId) {
          throw new AppError(
            ErrorCode.EVIDENCE_SCOPE_MISMATCH,
            `File change set ref crosses run boundary: ${ref}`,
          );
        }
        const run = this.runRepo.getById(parsed.id);
        if (!run || run.issue_id !== scope.issueId) {
          throw new AppError(
            ErrorCode.EVIDENCE_SCOPE_MISMATCH,
            `File change set ref crosses issue boundary: ${ref}`,
          );
        }
      }
    }
  }

  resolveTrustedPayload(
    ref: string,
    scope: EvidenceScope,
  ): ThreadEvent | null {
    const parsed = parseEvidenceRef(ref);
    if (parsed.kind !== "event") {
      return null;
    }
    const event = this.threadEventRepo.getById(parsed.id);
    if (!event) {
      return null;
    }
    if (scope.threadId && event.thread_id !== scope.threadId) {
      return null;
    }
    if (!TRUSTED_INTERNAL_ALLOWLIST.has(event.type)) {
      return null;
    }
    const eventRunId = event.payload_json.run_id as string | undefined;
    if (scope.runId && (!eventRunId || eventRunId !== scope.runId)) {
      return null;
    }
    return event;
  }
}
