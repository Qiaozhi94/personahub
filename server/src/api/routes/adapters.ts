import type { FastifyPluginAsync } from "fastify";
import type { AdapterConfigService } from "../../services/adapter-config.js";
import { AdapterAuthType, AgentCapability } from "@personahub/shared/types";
import { getProviderMetadata } from "../../runtime/provider-metadata.js";

export interface AdapterRoutesOptions {
  adapterConfigService: AdapterConfigService;
}

export const adapterRoutes: FastifyPluginAsync<AdapterRoutesOptions> = async (app, opts) => {
  const { adapterConfigService } = opts;

  app.get("/api/adapter-providers", async () => {
    return { providers: getProviderMetadata() };
  });

  app.post("/api/projects/:project_id/adapters", async (request, reply) => {
    const { project_id } = request.params as { project_id: string };
    const body = (request.body ?? {}) as {
      name?: string;
      cli_provider?: string;
      command?: string;
      args?: string[];
      default_model?: string;
      auth_type?: AdapterAuthType;
      model_provider?: string;
      api_key?: string;
      capability_tags?: AgentCapability[];
      make_default?: boolean;
    };
    const adapter = adapterConfigService.create(project_id, {
      name: body.name ?? "",
      cli_provider: body.cli_provider ?? "codex",
      command: body.command ?? "",
      args: body.args,
      default_model: body.default_model,
      auth_type: body.auth_type,
      model_provider: body.model_provider,
      api_key: body.api_key,
      capability_tags: body.capability_tags,
      make_default: body.make_default,
    });
    reply.code(201);
    return { adapter };
  });

  app.get("/api/projects/:project_id/adapters", async (request) => {
    const { project_id } = request.params as { project_id: string };
    const adapters = adapterConfigService.list(project_id);
    return { adapters };
  });

  app.put("/api/projects/:project_id/default-adapter", async (request) => {
    const { project_id } = request.params as { project_id: string };
    const body = (request.body ?? {}) as { adapter_id?: string | null };
    const adapter = adapterConfigService.setDefault(project_id, body.adapter_id ?? null);
    return { adapter };
  });

  app.patch("/api/adapters/:adapter_id", async (request) => {
    const { adapter_id } = request.params as { adapter_id: string };
    const body = (request.body ?? {}) as {
      name?: string;
      command?: string;
      args?: string[];
      default_model?: string;
      auth_type?: AdapterAuthType;
      model_provider?: string | null;
      api_key?: string | null;
      capability_tags?: AgentCapability[];
    };
    const adapter = adapterConfigService.update(adapter_id, {
      name: body.name,
      command: body.command,
      args: body.args,
      default_model: body.default_model,
      auth_type: body.auth_type,
      model_provider: body.model_provider,
      api_key: body.api_key,
      capability_tags: body.capability_tags,
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
