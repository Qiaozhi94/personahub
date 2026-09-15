import type { FastifyPluginAsync } from "fastify";
import type { RunService } from "../../services/run.js";

export interface RunRoutesOptions {
  runService: RunService;
}

export const runRoutes: FastifyPluginAsync<RunRoutesOptions> = async (app, opts) => {
  const { runService } = opts;

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
};
