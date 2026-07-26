import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { AdapterConfigService } from "../../services/adapter-config.js";
import { AdapterAuthType, AgentCapability } from "@personahub/shared/types";
import { getProviderMetadata } from "../../runtime/provider-metadata.js";
import { parseRequestBody } from "../errors.js";

export interface AdapterRoutesOptions {
  adapterConfigService: AdapterConfigService;
}

/**
 * Route-boundary schemas (docs/decisions/0005: "只做参数校验（zod）") — the
 * service layer trusts these types once past this point. Every field a
 * malformed body could send with the wrong JS type (a number where a
 * string is expected, `args` as a JSON string instead of an array, an
 * unknown capability_tags value) used to be blindly cast via `as`, then
 * either mis-behave downstream (a string spread into single-char argv) or
 * throw an uncaught TypeError -> 500 instead of a client-correctable 400.
 * `name`/`cli_provider`/`command` stay optional here (an omitted/empty
 * value is a *business* rule enforced by the service with its own specific
 * ErrorCode, e.g. ADAPTER_COMMAND_REQUIRED — this layer only rejects wrong
 * *types*, not empty/missing required fields).
 */
const createAdapterSchema = z.object({
  name: z.string().optional(),
  cli_provider: z.string().optional(),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  default_model: z.string().optional(),
  auth_type: z.nativeEnum(AdapterAuthType).optional(),
  model_provider: z.string().optional(),
  api_key: z.string().optional(),
  capability_tags: z.array(z.nativeEnum(AgentCapability)).optional(),
  make_default: z.boolean().optional(),
});

const updateAdapterSchema = z.object({
  name: z.string().optional(),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  /** omitted preserves; null clears; non-empty string replaces (service-enforced). */
  default_model: z.string().nullable().optional(),
  auth_type: z.nativeEnum(AdapterAuthType).optional(),
  model_provider: z.string().nullable().optional(),
  api_key: z.string().nullable().optional(),
  capability_tags: z.array(z.nativeEnum(AgentCapability)).optional(),
});

const setDefaultAdapterSchema = z.object({
  adapter_id: z.string().nullable().optional(),
});

const validateAdapterSchema = z.object({
  workspace_id: z.string().optional(),
});

const listAdaptersQuerySchema = z.object({
  workspace_id: z.string().optional(),
});

export const adapterRoutes: FastifyPluginAsync<AdapterRoutesOptions> = async (app, opts) => {
  const { adapterConfigService } = opts;

  app.get("/api/adapter-providers", async () => {
    return { providers: getProviderMetadata() };
  });

  app.post("/api/projects/:project_id/adapters", async (request, reply) => {
    const { project_id } = request.params as { project_id: string };
    const body = parseRequestBody(createAdapterSchema, request.body ?? {});
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
    const query = parseRequestBody(listAdaptersQuerySchema, request.query ?? {});
    const adapters = adapterConfigService.list(project_id, query.workspace_id);
    return { adapters };
  });

  app.put("/api/projects/:project_id/default-adapter", async (request) => {
    const { project_id } = request.params as { project_id: string };
    const body = parseRequestBody(setDefaultAdapterSchema, request.body ?? {});
    const adapter = adapterConfigService.setDefault(project_id, body.adapter_id ?? null);
    return { adapter };
  });

  app.patch("/api/adapters/:adapter_id", async (request) => {
    const { adapter_id } = request.params as { adapter_id: string };
    const body = parseRequestBody(updateAdapterSchema, request.body ?? {});
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
    const body = parseRequestBody(validateAdapterSchema, request.body ?? {});
    const adapter = await adapterConfigService.validate(adapter_id, body.workspace_id);
    return { adapter };
  });
};
