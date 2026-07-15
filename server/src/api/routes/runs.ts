import type { FastifyPluginAsync } from "fastify";
import type { RunDispatchService } from "../../services/run-dispatch.js";
import type { RunService } from "../../services/run.js";

export interface RunRoutesOptions {
  runDispatchService: RunDispatchService;
  runService: RunService;
}

export const runRoutes: FastifyPluginAsync<RunRoutesOptions> = async (app, opts) => {
  const { runDispatchService, runService } = opts;

  app.post("/api/issues/:issue_id/runs", async (request, reply) => {
    const { issue_id } = request.params as { issue_id: string };
    const body = (request.body ?? {}) as {
      instructions?: string;
      adapter_id?: string;
    };
    const run = await runDispatchService.dispatch(
      issue_id,
      body.adapter_id ?? "",
      body.instructions ?? "",
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
