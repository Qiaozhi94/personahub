import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import { createTestServices, disposeTestServices, type TestServices } from "../helpers.js";
import { registerRoutes } from "../../src/api/index.js";
import { AppError, getErrorStatus, buildErrorResponse } from "../../src/api/errors.js";
import { ErrorCode } from "@personahub/shared/errors";
import { AdapterAuthType, AgentCapability, AdapterStatus, CliProvider } from "@personahub/shared/types";
import type { AgentAdapter, AdapterValidationResult } from "../../src/runtime/types.js";

/**
 * T073/T074/T075/T076/T080: HTTP-level tests for the adapter CRUD, default
 * adapter, and provider metadata routes. Registers a scripted fake adapter
 * under each real cli_provider key so validate() exercises the actual
 * registry lookup (design's "no hardcoded --version check") without
 * spawning a real CLI.
 */
function scriptedAdapter(provider: string, result: AdapterValidationResult = { available: true, errorMessage: null }): AgentAdapter {
  return {
    provider,
    capabilities: { provider, supportsApprovalHook: false, supportsStructuredTrace: false, supportsFinalMessage: false, executionTimeoutMs: 60_000 },
    validate: async () => result,
    start: () => { throw new Error("not used in this test"); },
  };
}

function buildApp(services: TestServices) {
  const app = Fastify();
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof AppError) {
      const status = getErrorStatus(error.code);
      reply.code(status);
      return buildErrorResponse(error);
    }
    reply.code(500);
    return { error: { code: ErrorCode.INTERNAL_ERROR, message: error.message ?? "An internal error occurred.", details: {} } };
  });
  registerRoutes(app, {
    projectService: services.projectService,
    workspaceService: services.workspaceService,
    issueService: services.issueService,
    threadService: services.threadService,
    adapterConfigService: services.adapterConfigService,
    runService: services.runService,
    runDispatchService: services.runDispatchService,
    threadEventService: services.threadEventService,
    eventBus: services.eventBus,
    traceQueryService: services.traceQueryService,
    traceExportService: services.traceExportService,
    validationQueryService: services.validationQueryService,
    validationRecoveryActionService: services.validationRecoveryActionService,
    validationWorkflowService: services.validationWorkflowService,
    evidenceSummaryRepo: services.evidenceSummaryRepo,
    issueRepo: services.issueRepo,
    runRepo: services.runRepo,
  });
  return app;
}

describe("Adapter routes (T073-T076, T080)", () => {
  let services: TestServices;
  let projectId: string;

  beforeEach(() => {
    services = createTestServices();
    services.adapterRegistry.register(scriptedAdapter(CliProvider.Codex));
    services.adapterRegistry.register(scriptedAdapter(CliProvider.ClaudeCode));
    services.adapterRegistry.register(scriptedAdapter(CliProvider.OpenCode));
    projectId = services.projectService.create("T073").id;
  });
  afterEach(() => disposeTestServices(services));

  describe("POST /api/projects/:project_id/adapters", () => {
    it("creates a Codex OAuth adapter with default implementation capability and becomes the Project default", async () => {
      const app = buildApp(services);
      const res = await app.inject({
        method: "POST", url: `/api/projects/${projectId}/adapters`,
        payload: { name: "Codex", cli_provider: CliProvider.Codex, command: "codex" },
      });
      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body);
      expect(body.adapter.cli_provider).toBe(CliProvider.Codex);
      expect(body.adapter.auth_type).toBe(AdapterAuthType.OAuth);
      expect(body.adapter.has_api_key).toBe(false);
      expect(body.adapter.is_default).toBe(true);
      expect(body.adapter.api_key).toBeUndefined();
    });

    it("creates a Claude Code adapter with explicit validator capability", async () => {
      const app = buildApp(services);
      const res = await app.inject({
        method: "POST", url: `/api/projects/${projectId}/adapters`,
        payload: { name: "Claude", cli_provider: CliProvider.ClaudeCode, command: "claude", capability_tags: [AgentCapability.Validator] },
      });
      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body);
      expect(body.adapter.capability_tags).toEqual([AgentCapability.Validator]);
    });

    it("creates an OpenCode API-key adapter and never echoes the raw key", async () => {
      const app = buildApp(services);
      const res = await app.inject({
        method: "POST", url: `/api/projects/${projectId}/adapters`,
        payload: {
          name: "OpenCode", cli_provider: CliProvider.OpenCode, command: "opencode",
          auth_type: AdapterAuthType.ApiKey, model_provider: "openai", default_model: "gpt-5",
          api_key: "sk-test-canary-do-not-leak",
        },
      });
      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body);
      expect(body.adapter.has_api_key).toBe(true);
      expect(JSON.stringify(body)).not.toContain("sk-test-canary-do-not-leak");
    });

    it("make_default:true overrides an already-set Project default", async () => {
      const app = buildApp(services);
      const first = await app.inject({
        method: "POST", url: `/api/projects/${projectId}/adapters`,
        payload: { name: "First", cli_provider: CliProvider.Codex, command: "codex" },
      });
      const second = await app.inject({
        method: "POST", url: `/api/projects/${projectId}/adapters`,
        payload: { name: "Second", cli_provider: CliProvider.ClaudeCode, command: "claude", make_default: true },
      });
      const secondBody = JSON.parse(second.body);
      expect(secondBody.adapter.is_default).toBe(true);
      const listRes = await app.inject({ method: "GET", url: `/api/projects/${projectId}/adapters` });
      const listBody = JSON.parse(listRes.body);
      const firstAdapter = listBody.adapters.find((a: { id: string }) => a.id === JSON.parse(first.body).adapter.id);
      expect(firstAdapter.is_default).toBe(false);
    });

    it("rejects an unsupported provider", async () => {
      const app = buildApp(services);
      const res = await app.inject({
        method: "POST", url: `/api/projects/${projectId}/adapters`,
        payload: { name: "Bad", cli_provider: "not-a-real-provider", command: "whatever" },
      });
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error.code).toBe(ErrorCode.ADAPTER_PROVIDER_UNSUPPORTED);
    });

    it("rejects OAuth + api_key combination", async () => {
      const app = buildApp(services);
      const res = await app.inject({
        method: "POST", url: `/api/projects/${projectId}/adapters`,
        payload: { name: "Bad", cli_provider: CliProvider.Codex, command: "codex", auth_type: AdapterAuthType.OAuth, api_key: "sk-should-not-be-allowed" },
      });
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error.code).toBe(ErrorCode.ADAPTER_AUTH_INVALID);
      expect(JSON.stringify(JSON.parse(res.body))).not.toContain("sk-should-not-be-allowed");
    });

    it("rejects API-key auth without model_provider", async () => {
      const app = buildApp(services);
      const res = await app.inject({
        method: "POST", url: `/api/projects/${projectId}/adapters`,
        payload: { name: "Bad", cli_provider: CliProvider.OpenCode, command: "opencode", auth_type: AdapterAuthType.ApiKey, default_model: "gpt-5", api_key: "sk-x" },
      });
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error.code).toBe(ErrorCode.ADAPTER_AUTH_INVALID);
    });

    it("rejects an unverified model_provider for API-key auth", async () => {
      const app = buildApp(services);
      const res = await app.inject({
        method: "POST", url: `/api/projects/${projectId}/adapters`,
        payload: { name: "Bad", cli_provider: CliProvider.OpenCode, command: "opencode", auth_type: AdapterAuthType.ApiKey, model_provider: "not-verified", default_model: "gpt-5", api_key: "sk-x" },
      });
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error.code).toBe(ErrorCode.ADAPTER_MODEL_PROVIDER_UNSUPPORTED);
    });
  });

  describe("GET /api/projects/:project_id/adapters", () => {
    it("lists adapters with masked status and no secrets", async () => {
      const app = buildApp(services);
      await app.inject({
        method: "POST", url: `/api/projects/${projectId}/adapters`,
        payload: { name: "OpenCode", cli_provider: CliProvider.OpenCode, command: "opencode", auth_type: AdapterAuthType.ApiKey, model_provider: "openai", default_model: "gpt-5", api_key: "sk-listed-canary" },
      });
      const res = await app.inject({ method: "GET", url: `/api/projects/${projectId}/adapters` });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.adapters).toHaveLength(1);
      expect(body.adapters[0].has_api_key).toBe(true);
      expect(JSON.stringify(body)).not.toContain("sk-listed-canary");
    });
  });

  describe("PATCH /api/adapters/:adapter_id", () => {
    it("switches auth_type oauth -> api_key with required fields", async () => {
      const app = buildApp(services);
      const created = JSON.parse((await app.inject({
        method: "POST", url: `/api/projects/${projectId}/adapters`,
        payload: { name: "OpenCode", cli_provider: CliProvider.OpenCode, command: "opencode", model_provider: "openai", default_model: "gpt-5" },
      })).body).adapter;

      const res = await app.inject({
        method: "PATCH", url: `/api/adapters/${created.id}`,
        payload: { auth_type: AdapterAuthType.ApiKey, model_provider: "anthropic", default_model: "claude-x", api_key: "sk-switch-canary" },
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.adapter.auth_type).toBe(AdapterAuthType.ApiKey);
      expect(body.adapter.has_api_key).toBe(true);
      expect(JSON.stringify(body)).not.toContain("sk-switch-canary");
    });

    it("clearing api_key while staying in api_key mode marks the adapter Unavailable, not an error", async () => {
      const app = buildApp(services);
      const created = JSON.parse((await app.inject({
        method: "POST", url: `/api/projects/${projectId}/adapters`,
        payload: { name: "OpenCode", cli_provider: CliProvider.OpenCode, command: "opencode", auth_type: AdapterAuthType.ApiKey, model_provider: "openai", default_model: "gpt-5", api_key: "sk-x" },
      })).body).adapter;

      const res = await app.inject({ method: "PATCH", url: `/api/adapters/${created.id}`, payload: { api_key: null } });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.adapter.has_api_key).toBe(false);
      expect(body.adapter.status).toBe(AdapterStatus.Unavailable);
    });

    it("switching to oauth clears a stale api_key even without an explicit api_key:null", async () => {
      const app = buildApp(services);
      const created = JSON.parse((await app.inject({
        method: "POST", url: `/api/projects/${projectId}/adapters`,
        payload: { name: "OpenCode", cli_provider: CliProvider.OpenCode, command: "opencode", auth_type: AdapterAuthType.ApiKey, model_provider: "openai", default_model: "gpt-5", api_key: "sk-x" },
      })).body).adapter;

      const res = await app.inject({ method: "PATCH", url: `/api/adapters/${created.id}`, payload: { auth_type: AdapterAuthType.OAuth } });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).adapter.has_api_key).toBe(false);
    });

    it("rejects an empty name", async () => {
      const app = buildApp(services);
      const created = JSON.parse((await app.inject({
        method: "POST", url: `/api/projects/${projectId}/adapters`,
        payload: { name: "Codex", cli_provider: CliProvider.Codex, command: "codex" },
      })).body).adapter;
      const res = await app.inject({ method: "PATCH", url: `/api/adapters/${created.id}`, payload: { name: "  " } });
      expect(res.statusCode).toBe(400);
    });
  });

  describe("POST /api/adapters/:adapter_id/validate", () => {
    it("uses the registered provider adapter's own validate() result", async () => {
      services.adapterRegistry.register(scriptedAdapter(CliProvider.Codex, { available: false, errorMessage: "not logged in" }));
      const app = buildApp(services);
      const created = JSON.parse((await app.inject({
        method: "POST", url: `/api/projects/${projectId}/adapters`,
        payload: { name: "Codex", cli_provider: CliProvider.Codex, command: "codex" },
      })).body).adapter;

      const res = await app.inject({ method: "POST", url: `/api/adapters/${created.id}/validate` });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.adapter.status).toBe(AdapterStatus.Unavailable);
      expect(body.adapter.auth_status_message).toBe("not logged in");
    });
  });

  describe("PUT /api/projects/:project_id/default-adapter", () => {
    it("sets a different adapter as default", async () => {
      const app = buildApp(services);
      const first = JSON.parse((await app.inject({
        method: "POST", url: `/api/projects/${projectId}/adapters`,
        payload: { name: "First", cli_provider: CliProvider.Codex, command: "codex" },
      })).body).adapter;
      const second = JSON.parse((await app.inject({
        method: "POST", url: `/api/projects/${projectId}/adapters`,
        payload: { name: "Second", cli_provider: CliProvider.ClaudeCode, command: "claude" },
      })).body).adapter;
      expect(first.is_default).toBe(true);

      const res = await app.inject({ method: "PUT", url: `/api/projects/${projectId}/default-adapter`, payload: { adapter_id: second.id } });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).adapter.id).toBe(second.id);
    });

    it("rejects setting an unavailable adapter as default (409)", async () => {
      const app = buildApp(services);
      const unavailable = JSON.parse((await app.inject({
        method: "POST", url: `/api/projects/${projectId}/adapters`,
        payload: { name: "Broken", cli_provider: CliProvider.Codex, command: "this-command-does-not-exist-xyz" },
      })).body).adapter;
      expect(unavailable.status).toBe(AdapterStatus.Unavailable);

      const res = await app.inject({ method: "PUT", url: `/api/projects/${projectId}/default-adapter`, payload: { adapter_id: unavailable.id } });
      expect(res.statusCode).toBe(409);
      expect(JSON.parse(res.body).error.code).toBe(ErrorCode.ADAPTER_UNAVAILABLE);
    });

    it("returns 404 for an adapter belonging to a different project", async () => {
      const app = buildApp(services);
      const otherProjectId = services.projectService.create("Other").id;
      const foreignAdapter = JSON.parse((await app.inject({
        method: "POST", url: `/api/projects/${otherProjectId}/adapters`,
        payload: { name: "Foreign", cli_provider: CliProvider.Codex, command: "codex" },
      })).body).adapter;

      const res = await app.inject({ method: "PUT", url: `/api/projects/${projectId}/default-adapter`, payload: { adapter_id: foreignAdapter.id } });
      expect(res.statusCode).toBe(404);
      expect(JSON.parse(res.body).error.code).toBe(ErrorCode.ADAPTER_NOT_FOUND);
    });

    it("rejects clearing the default while the Project still has adapters (409)", async () => {
      const app = buildApp(services);
      await app.inject({
        method: "POST", url: `/api/projects/${projectId}/adapters`,
        payload: { name: "Only", cli_provider: CliProvider.Codex, command: "codex" },
      });
      const res = await app.inject({ method: "PUT", url: `/api/projects/${projectId}/default-adapter`, payload: { adapter_id: null } });
      expect(res.statusCode).toBe(409);
      expect(JSON.parse(res.body).error.code).toBe(ErrorCode.ADAPTER_REQUIRED);
    });

    it("allows clearing the default when the Project has no adapters", async () => {
      const app = buildApp(services);
      const res = await app.inject({ method: "PUT", url: `/api/projects/${projectId}/default-adapter`, payload: { adapter_id: null } });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).adapter).toBeNull();
    });
  });

  describe("GET /api/adapter-providers", () => {
    it("returns metadata for all three providers with no secrets", async () => {
      const app = buildApp(services);
      const res = await app.inject({ method: "GET", url: "/api/adapter-providers" });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.providers).toHaveLength(3);
      const codex = body.providers.find((p: { cli_provider: string }) => p.cli_provider === CliProvider.Codex);
      expect(codex.supported_auth_types).toEqual([AdapterAuthType.OAuth]);
      const opencode = body.providers.find((p: { cli_provider: string }) => p.cli_provider === CliProvider.OpenCode);
      expect(opencode.supported_auth_types).toEqual(expect.arrayContaining([AdapterAuthType.OAuth, AdapterAuthType.ApiKey]));
      expect(opencode.model_provider_allowlist).toEqual(expect.arrayContaining(["openai", "anthropic"]));
      expect(JSON.stringify(body)).not.toMatch(/API_KEY/); // env var names are an implementation detail, not exposed
    });
  });
});
