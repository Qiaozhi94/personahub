import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import type { TraceQueryService } from "../../services/trace-query.js";
import type { TraceExportService } from "../../services/trace-export.js";
import { AppError } from "../errors.js";
import { ErrorCode } from "@personahub/shared/errors";

export interface TraceRoutesOptions {
  traceQueryService: TraceQueryService;
  traceExportService: TraceExportService;
}

function parseBoundedInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  if (!/^\d+$/.test(raw)) {
    throw new AppError(ErrorCode.INVALID_QUERY, "Invalid limit parameter.");
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1 || value > 200) {
    throw new AppError(ErrorCode.INVALID_QUERY, "limit must be between 1 and 200.");
  }
  return value;
}

export const traceRoutes: FastifyPluginAsync<TraceRoutesOptions> = async (
  app: FastifyInstance,
  opts: TraceRoutesOptions,
): Promise<void> => {
  const { traceQueryService, traceExportService } = opts;

  app.get("/api/issues/:issue_id/trace", async (request, reply) => {
    const { issue_id: issueId } = request.params as { issue_id: string };
    const query = request.query as {
      after_event_id?: string;
      limit?: string;
    };

    const limit = parseBoundedInt(query.limit, 100);

    const result = traceQueryService.getIssueTrace(issueId, query.after_event_id, limit);
    return reply.send(result);
  });

  app.get("/api/runs/:run_id/evidence", async (request, reply) => {
    const { run_id: runId } = request.params as { run_id: string };
    const query = request.query as {
      after_event_id?: string;
      after_file_change_id?: string;
      event_limit?: string;
      file_limit?: string;
    };

    const eventLimit = parseBoundedInt(query.event_limit, 100);
    const fileLimit = parseBoundedInt(query.file_limit, 100);

    const result = traceQueryService.getRunEvidence(
      runId,
      query.after_event_id,
      query.after_file_change_id,
      eventLimit,
      fileLimit,
    );
    return reply.send(result);
  });

  app.get("/api/issues/:issue_id/trace/export", async (request, reply) => {
    const { issue_id: issueId } = request.params as { issue_id: string };

    const { content, filename } = traceExportService.exportIssueTraceMarkdown(issueId);

    // RFC 6266: provide an ASCII fallback in `filename` plus a percent-encoded
    // UTF-8 `filename*` so non-ASCII issue titles (e.g. Chinese) are not mangled.
    const asciiFallback = filename.replace(/[^\x20-\x7e]/g, "_");
    const encoded = encodeURIComponent(filename);
    reply
      .header("Content-Type", "text/markdown; charset=utf-8")
      .header(
        "Content-Disposition",
        `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`,
      )
      .header("Cache-Control", "no-store");

    return reply.send(content);
  });
};
