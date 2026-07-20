import type { FastifyPluginAsync } from "fastify";
import type { AdapterConfigService } from "../../services/adapter-config.js";

export interface AdapterRoutesOptions {
  adapterConfigService: AdapterConfigService;
}

export const adapterRoutes: FastifyPluginAsync<AdapterRoutesOptions> = async (app, opts) => {
  const { adapterConfigService } = opts;

  app.post("/api/projects/:project_id/adapters", async (request, reply) => {
    const { project_id } = request.params as { project_id: string };
    const body = (request.body ?? {}) as {
      name?: string;
      cli_provider?: string;
      command?: string;
      args?: string[];
      default_model?: string;
    };
    // F005 Phase 10 (T073-T078) reworks this route for auth_type/model_provider/
    // api_key/capability_tags; until then it only creates OAuth Codex/Claude
    // adapters with the default (implementation) capability, matching F002.
    const adapter = adapterConfigService.create(project_id, {
      name: body.name ?? "",
      cli_provider: body.cli_provider ?? "codex",
      command: body.command ?? "",
      args: body.args,
      default_model: body.default_model,
    });
    reply.code(201);
    return { adapter };
  });

  app.get("/api/projects/:project_id/adapters", async (request) => {
    const { project_id } = request.params as { project_id: string };
    const adapters = adapterConfigService.list(project_id);
    return { adapters };
  });

  app.patch("/api/adapters/:adapter_id", async (request) => {
    const { adapter_id } = request.params as { adapter_id: string };
    const body = (request.body ?? {}) as {
      name?: string;
      command?: string;
      args?: string[];
      default_model?: string;
    };
    const adapter = adapterConfigService.update(adapter_id, {
      name: body.name,
      command: body.command,
      args: body.args,
      default_model: body.default_model,
    });
    return { adapter };
  });

  app.delete("/api/adapters/:adapter_id", async (request, reply) => {
    const { adapter_id } = request.params as { adapter_id: string };
    adapterConfigService.delete(adapter_id);
    reply.code(204);
    return;
  });

  app.post("/api/adapters/:adapter_id/validate", async (request) => {
    const { adapter_id } = request.params as { adapter_id: string };
    const adapter = await adapterConfigService.validate(adapter_id);
    return { adapter };
  });
};
