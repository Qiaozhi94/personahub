import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { RunPurpose } from "@personahub/shared/types";
import { ErrorCode } from "@personahub/shared/errors";
import type { RunDispatchService } from "../../services/run-dispatch.js";
import type { RunService } from "../../services/run.js";
import { AppError, parseRequestBody } from "../errors.js";

export interface RunRoutesOptions {
  runDispatchService: RunDispatchService;
  runService: RunService;
}

/**
 * `purpose` gets its own field-specific ErrorCode (design §7.4/design.md's
 * RUN_PURPOSE_INVALID row) rather than the generic REQUEST_BODY_INVALID a
 * plain zod enum would produce: the client can only ever request "auto"
 * (default) or "ad_hoc_consult" explicitly — any other value (including an
 * attempt to force "workflow_bound") is rejected, not silently coerced to
 * auto.
 */
function parsePurpose(raw: unknown): RunPurpose | undefined {
  if (raw === undefined) return undefined;
  if (raw === "auto") return undefined;
  if (raw === "ad_hoc_consult") return RunPurpose.AdHocConsult;
  throw new AppError(ErrorCode.RUN_PURPOSE_INVALID, `Invalid purpose: ${JSON.stringify(raw)}. Must be "auto" or "ad_hoc_consult".`, "purpose");
}

const createRunSchema = z.object({
  instructions: z.string().optional(),
  adapter_id: z.string().optional(),
  purpose: z.unknown().optional(),
});

export const runRoutes: FastifyPluginAsync<RunRoutesOptions> = async (app, opts) => {
  const { runDispatchService, runService } = opts;

  app.post("/api/issues/:issue_id/runs", async (request, reply) => {
    const { issue_id } = request.params as { issue_id: string };
    const body = parseRequestBody(createRunSchema, request.body ?? {});
    // design §7.4: the client can only ever request ad_hoc_consult
    // explicitly; role/dispatch_source/workflow_bound are always
    // server-derived (ManualRoutingService), never accepted here.
    const run = await runDispatchService.dispatch(
      issue_id,
      body.adapter_id,
      body.instructions ?? "",
      parsePurpose(body.purpose),
    );
    reply.code(201);
    return { run };
  });

  app.get("/api/runs/:run_id", async (request) => {
    const { run_id } = request.params as { run_id: string };
    const run = runService.get(run_id);
    return { run };
  });

  app.get("/api/issues/:issue_id/runs", async (request) => {
    const { issue_id } = request.params as { issue_id: string };
    const runs = runService.listByIssue(issue_id);
    return { runs };
  });

  app.post("/api/runs/:run_id/cancel", async (request) => {
    const { run_id } = request.params as { run_id: string };
    const run = await runDispatchService.cancel(run_id);
    return { run };
  });
};
