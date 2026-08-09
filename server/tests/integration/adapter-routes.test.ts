import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Fastify from "fastify";
import { createTestServices, createTempDir, disposeTestServices, type TestServices } from "../helpers.js";
import { registerRoutes } from "../../src/api/index.js";
import { AppError, getErrorStatus, buildErrorResponse } from "../../src/api/errors.js";
import { ErrorCode } from "@personahub/shared/errors";
import { AdapterAuthType, AgentCapability, AdapterStatus, CliProvider } from "@personahub/shared/types";
import type { AgentAdapter, AdapterValidationResult } from "../../src/runtime/types.js";

// These HTTP tests create adapters with command "codex" and rely on a scripted
// adapter's validate() for availability. create()'s initial status still calls
// validateCommand() -> resolveExecutable(), which checks PATH for a real `codex`
// binary that does not exist on CI. Mock the resolver to deterministically
// resolve known provider commands but leave genuinely-unknown ones unresolved,
// so both "available/unknown" and "unavailable" paths are machine-independent
// (same convention as codex-cli-adapter.test.ts / claude-code-adapter.test.ts).
vi.mock("../../src/runtime/executable-resolver.js", () => ({
  resolveExecutable: vi.fn((command: string) => {
    const known = new Set(["codex", "claude", "opencode"]);
    if (known.has(command)) {
      return { resolved: { executable: command, prefixArgs: [], source: "direct" as const }, errorMessage: null };
    }
    return { resolved: null, errorMessage: `Command not found: ${command}` };
  }),
}));

/**
 * T073/T074/T075/T076/T080: HTTP-level tests for the adapter CRUD, default
 * adapter, and provider metadata routes. Registers a scripted fake adapter
 * under each real cli_provider key so validate() exercises the actual
 * registry lookup (design's "no hardcoded --version check") without
 * spawning a real CLI.
 */
function scriptedAdapter(
  provider: string,
  result: AdapterValidationResult = { available: true, errorMessage: null },
): AgentAdapter {
  return {
    provider,
    capabilities: {
      provider,
      supportsApprovalHook: false,
      supportsStructuredTrace: false,
      supportsFinalMessage: false,
      executionTimeoutMs: 60_000,
    },
    validate: async () => result,
    start: () => {
      throw new Error("not used in this test");
    },
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
    return {
      error: { code: ErrorCode.INTERNAL_ERROR, message: error.message ?? "An internal error occurred.", details: {} },
    };
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
    graphRunRepo: services.graphRunRepo,
    nodeRunRepo: services.nodeRunRepo,
    workspaceRepo: services.workspaceRepo,
    threadRepo: services.threadRepo,
    threadEventRepo: services.threadEventRepo,
    graphRuntimeService: services.graphRuntimeService,
    agentConfigRepo: services.agentConfigRepo,
    projectRepo: services.projectRepo,
    adapterWorkspaceStatusRepo: services.adapterWorkspaceStatusRepo,
    recommendationService: services.recommendationService,
    intakeService: services.intakeService,
    intakeConfirmationRepo: services.intakeConfirmationRepo,
    db: services.db,
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
        method: "POST",
        url: `/api/projects/${projectId}/adapters`,
        payload: { name: "Codex", cli_provider: CliProvider.Codex, command: "codex" },
      });
      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body);
      expect(body.adapter.cli_provider).toBe(CliProvider.Codex);
      expect(body.adapter.auth_type).toBe(AdapterAuthType.OAuth);
      expect(body.adapter.has_api_key).toBe(false);
      expect(body.adapter.api_key).toBeUndefined();

      // AC-001 fix: `is_default` is only assigned once the background
      // auto-validate probe confirms Available (see AdapterConfigService.
      // autoValidateAfterCreate) — the synchronous POST response reflects
      // the not-yet-converged Unknown state instead.
      await services.adapterConfigService.shutdown();
      const listRes = await app.inject({ method: "GET", url: `/api/projects/${projectId}/adapters` });
      const converged = JSON.parse(listRes.body).adapters.find((a: { id: string }) => a.id === body.adapter.id);
      expect(converged.is_default).toBe(true);
    }, 10_000);

    it("creates a Claude Code adapter with explicit validator capability", async () => {
      const app = buildApp(services);
      const res = await app.inject({
        method: "POST",
        url: `/api/projects/${projectId}/adapters`,
        payload: {
          name: "Claude",
          cli_provider: CliProvider.ClaudeCode,
          command: "claude",
          capability_tags: [AgentCapability.Validator],
        },
      });
      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body);
      expect(body.adapter.capability_tags).toEqual([AgentCapability.Validator]);
    });

    it("creates an OpenCode API-key adapter and never echoes the raw key", async () => {
      const app = buildApp(services);
      const res = await app.inject({
        method: "POST",
        url: `/api/projects/${projectId}/adapters`,
        payload: {
          name: "OpenCode",
          cli_provider: CliProvider.OpenCode,
          command: "opencode",
          auth_type: AdapterAuthType.ApiKey,
          model_provider: "openai",
          default_model: "gpt-5",
          api_key: "sk-test-canary-do-not-leak",
        },
      });
      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body);
      expect(body.adapter.has_api_key).toBe(true);
      expect(JSON.stringify(body)).not.toContain("sk-test-canary-do-not-leak");
    });

    // Final-comprehensive-report regression: malformed JSON shapes for
    // args/capability_tags used to be silently accepted via an `as` cast —
    // a string `args` would later be spread char-by-char into argv, and a
    // non-array/invalid capability_tags would degrade to "no capability"
    // with no error surfaced to the caller.
    it("rejects args sent as a non-array with REQUEST_BODY_INVALID", async () => {
      const app = buildApp(services);
      const res = await app.inject({
        method: "POST",
        url: `/api/projects/${projectId}/adapters`,
        payload: { name: "Bad", cli_provider: CliProvider.Codex, command: "codex", args: "--quiet --json" },
      });
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error.code).toBe(ErrorCode.REQUEST_BODY_INVALID);
    });

    it("rejects capability_tags sent as a non-array with REQUEST_BODY_INVALID", async () => {
      const app = buildApp(services);
      const res = await app.inject({
        method: "POST",
        url: `/api/projects/${projectId}/adapters`,
        payload: { name: "Bad", cli_provider: CliProvider.Codex, command: "codex", capability_tags: "validator" },
      });
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error.code).toBe(ErrorCode.REQUEST_BODY_INVALID);
    });

    it("rejects an unknown capability_tags value with REQUEST_BODY_INVALID", async () => {
      const app = buildApp(services);
      const res = await app.inject({
        method: "POST",
        url: `/api/projects/${projectId}/adapters`,
        payload: {
          name: "Bad",
          cli_provider: CliProvider.Codex,
          command: "codex",
          capability_tags: ["not_a_real_capability"],
        },
      });
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error.code).toBe(ErrorCode.REQUEST_BODY_INVALID);
    });

    // final-recheck-report regression: only args/capability_tags/purpose
    // were validated — every other field (name, command, default_model,
    // api_key, make_default, ...) still went straight through an `as` cast,
    // so a wrong JS type reached the service's `.trim()`/comparisons and
    // threw an uncaught TypeError -> 500 instead of a client-correctable
    // 400. Now a full zod schema covers every field on this route.
    it("rejects a numeric name with REQUEST_BODY_INVALID (400, not a 500 TypeError)", async () => {
      const app = buildApp(services);
      const res = await app.inject({
        method: "POST",
        url: `/api/projects/${projectId}/adapters`,
        payload: { name: 123, cli_provider: CliProvider.Codex, command: "codex" },
      });
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error.code).toBe(ErrorCode.REQUEST_BODY_INVALID);
    });

    it("rejects an object command with REQUEST_BODY_INVALID (400, not a 500 TypeError)", async () => {
      const app = buildApp(services);
      const res = await app.inject({
        method: "POST",
        url: `/api/projects/${projectId}/adapters`,
        payload: { name: "Bad", cli_provider: CliProvider.Codex, command: {} },
      });
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error.code).toBe(ErrorCode.REQUEST_BODY_INVALID);
    });

    it("rejects api_key sent as an array with REQUEST_BODY_INVALID", async () => {
      const app = buildApp(services);
      const res = await app.inject({
        method: "POST",
        url: `/api/projects/${projectId}/adapters`,
        payload: { name: "Bad", cli_provider: CliProvider.Codex, command: "codex", api_key: [] },
      });
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error.code).toBe(ErrorCode.REQUEST_BODY_INVALID);
    });

    it("rejects make_default sent as a string with REQUEST_BODY_INVALID", async () => {
      const app = buildApp(services);
      const res = await app.inject({
        method: "POST",
        url: `/api/projects/${projectId}/adapters`,
        payload: { name: "Bad", cli_provider: CliProvider.Codex, command: "codex", make_default: "yes" },
      });
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error.code).toBe(ErrorCode.REQUEST_BODY_INVALID);
    });

    it("make_default:true overrides an already-set Project default", async () => {
      const app = buildApp(services);
      const first = await app.inject({
        method: "POST",
        url: `/api/projects/${projectId}/adapters`,
        payload: { name: "First", cli_provider: CliProvider.Codex, command: "codex" },
      });
      const second = await app.inject({
        method: "POST",
        url: `/api/projects/${projectId}/adapters`,
        payload: { name: "Second", cli_provider: CliProvider.ClaudeCode, command: "claude", make_default: true },
      });
      const secondBody = JSON.parse(second.body);
      await services.adapterConfigService.shutdown();
      const listRes = await app.inject({ method: "GET", url: `/api/projects/${projectId}/adapters` });
      const listBody = JSON.parse(listRes.body);
      const firstAdapter = listBody.adapters.find((a: { id: string }) => a.id === JSON.parse(first.body).adapter.id);
      const secondAdapter = listBody.adapters.find((a: { id: string }) => a.id === secondBody.adapter.id);
      expect(secondAdapter.is_default).toBe(true);
      expect(firstAdapter.is_default).toBe(false);
    });

    it("rejects an unsupported provider", async () => {
      const app = buildApp(services);
      const res = await app.inject({
        method: "POST",
        url: `/api/projects/${projectId}/adapters`,
        payload: { name: "Bad", cli_provider: "not-a-real-provider", command: "whatever" },
      });
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error.code).toBe(ErrorCode.ADAPTER_PROVIDER_UNSUPPORTED);
    });

    it("rejects OAuth + api_key combination", async () => {
      const app = buildApp(services);
      const res = await app.inject({
        method: "POST",
        url: `/api/projects/${projectId}/adapters`,
        payload: {
          name: "Bad",
          cli_provider: CliProvider.Codex,
          command: "codex",
          auth_type: AdapterAuthType.OAuth,
          api_key: "sk-should-not-be-allowed",
        },
      });
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error.code).toBe(ErrorCode.ADAPTER_AUTH_INVALID);
      expect(JSON.stringify(JSON.parse(res.body))).not.toContain("sk-should-not-be-allowed");
    });

    it("rejects API-key auth without model_provider", async () => {
      const app = buildApp(services);
      const res = await app.inject({
        method: "POST",
        url: `/api/projects/${projectId}/adapters`,
        payload: {
          name: "Bad",
          cli_provider: CliProvider.OpenCode,
          command: "opencode",
          auth_type: AdapterAuthType.ApiKey,
          default_model: "gpt-5",
          api_key: "sk-x",
        },
      });
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error.code).toBe(ErrorCode.ADAPTER_AUTH_INVALID);
    });

    it("rejects an unverified model_provider for API-key auth", async () => {
      const app = buildApp(services);
      const res = await app.inject({
        method: "POST",
        url: `/api/projects/${projectId}/adapters`,
        payload: {
          name: "Bad",
          cli_provider: CliProvider.OpenCode,
          command: "opencode",
          auth_type: AdapterAuthType.ApiKey,
          model_provider: "not-verified",
          default_model: "gpt-5",
          api_key: "sk-x",
        },
      });
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error.code).toBe(ErrorCode.ADAPTER_MODEL_PROVIDER_UNSUPPORTED);
    });
  });

  describe("GET /api/projects/:project_id/adapters", () => {
    it("lists adapters with masked status and no secrets", async () => {
      const app = buildApp(services);
      await app.inject({
        method: "POST",
        url: `/api/projects/${projectId}/adapters`,
        payload: {
          name: "OpenCode",
          cli_provider: CliProvider.OpenCode,
          command: "opencode",
          auth_type: AdapterAuthType.ApiKey,
          model_provider: "openai",
          default_model: "gpt-5",
          api_key: "sk-listed-canary",
        },
      });
      const res = await app.inject({ method: "GET", url: `/api/projects/${projectId}/adapters` });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.adapters).toHaveLength(1);
      expect(body.adapters[0].has_api_key).toBe(true);
      expect(JSON.stringify(body)).not.toContain("sk-listed-canary");
    });

    // closure-recheck-report Low finding: the workspace-scoped list query
    // (F005 workspace-aware availability UI/API closure) had no direct
    // server-side coverage — only exercised incidentally through mocked
    // web tests, which can't catch a backend projection bug.
    it("omitting workspace_id returns the plain global DTO with no effective_* fields at all", async () => {
      const app = buildApp(services);
      await app.inject({
        method: "POST",
        url: `/api/projects/${projectId}/adapters`,
        payload: { name: "Codex", cli_provider: CliProvider.Codex, command: "codex" },
      });
      const res = await app.inject({ method: "GET", url: `/api/projects/${projectId}/adapters` });
      const body = JSON.parse(res.body);
      expect(body.adapters[0].effective_status).toBeUndefined();
      expect(body.adapters[0].has_workspace_override).toBeUndefined();
    });

    it("workspace_id returns effective_status/has_workspace_override reflecting that workspace's override, without touching the global status field", async () => {
      const app = buildApp(services);
      const created = JSON.parse(
        (
          await app.inject({
            method: "POST",
            url: `/api/projects/${projectId}/adapters`,
            payload: {
              name: "OpenCode",
              cli_provider: CliProvider.OpenCode,
              command: "opencode",
              auth_type: AdapterAuthType.ApiKey,
              model_provider: "openai",
              default_model: "gpt-5",
              api_key: "sk-effective-canary",
            },
          })
        ).body,
      ).adapter;
      // AC-001 fix: create() converges Unknown -> Available asynchronously
      // in the background — await it so the GLOBAL status this test
      // compares against is deterministic, not a snapshot of the
      // not-yet-converged value the POST response happened to return.
      await services.adapterConfigService.shutdown();
      const workspace = services.workspaceService.bind(projectId, createTempDir());
      services.adapterWorkspaceStatusRepo.upsert({
        adapter_config_id: created.id,
        workspace_id: workspace.id,
        status: AdapterStatus.Available,
        last_checked_at: "2026-01-01T00:00:00.000Z",
        auth_status_message: null,
      });

      const res = await app.inject({
        method: "GET",
        url: `/api/projects/${projectId}/adapters?workspace_id=${workspace.id}`,
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.adapters[0].status).toBe(AdapterStatus.Available);
      expect(body.adapters[0].effective_status).toBe(AdapterStatus.Available);
      expect(body.adapters[0].has_workspace_override).toBe(true);
      expect(JSON.stringify(body)).not.toContain("sk-effective-canary");
    });

    it("an override in one workspace does not leak into a sibling workspace's effective status", async () => {
      const app = buildApp(services);
      const created = JSON.parse(
        (
          await app.inject({
            method: "POST",
            url: `/api/projects/${projectId}/adapters`,
            payload: { name: "Codex", cli_provider: CliProvider.Codex, command: "codex" },
          })
        ).body,
      ).adapter;
      await services.adapterConfigService.shutdown();
      const workspaceA = services.workspaceService.bind(projectId, createTempDir());
      const workspaceB = services.workspaceService.bind(projectId, createTempDir());
      services.adapterWorkspaceStatusRepo.upsert({
        adapter_config_id: created.id,
        workspace_id: workspaceA.id,
        status: AdapterStatus.Unavailable,
        last_checked_at: null,
        auth_status_message: "isolated",
      });

      const res = await app.inject({
        method: "GET",
        url: `/api/projects/${projectId}/adapters?workspace_id=${workspaceB.id}`,
      });
      const body = JSON.parse(res.body);
      expect(body.adapters[0].has_workspace_override).toBe(false);
      expect(body.adapters[0].effective_status).toBe(AdapterStatus.Available);
    });

    it("a nonexistent workspace_id returns 404 WORKSPACE_NOT_FOUND, not a silent fallback to the global view", async () => {
      const app = buildApp(services);
      const res = await app.inject({
        method: "GET",
        url: `/api/projects/${projectId}/adapters?workspace_id=wsp_does_not_exist`,
      });
      expect(res.statusCode).toBe(404);
      expect(JSON.parse(res.body).error.code).toBe(ErrorCode.WORKSPACE_NOT_FOUND);
    });

    it("a cross-Project workspace_id returns 404 WORKSPACE_NOT_FOUND", async () => {
      const app = buildApp(services);
      const otherProjectId = services.projectService.create("Other").id;
      const otherWorkspace = services.workspaceService.bind(otherProjectId, createTempDir());

      const res = await app.inject({
        method: "GET",
        url: `/api/projects/${projectId}/adapters?workspace_id=${otherWorkspace.id}`,
      });
      expect(res.statusCode).toBe(404);
      expect(JSON.parse(res.body).error.code).toBe(ErrorCode.WORKSPACE_NOT_FOUND);
    });
  });

  describe("PATCH /api/adapters/:adapter_id", () => {
    it("switches auth_type oauth -> api_key with required fields", async () => {
      const app = buildApp(services);
      const created = JSON.parse(
        (
          await app.inject({
            method: "POST",
            url: `/api/projects/${projectId}/adapters`,
            payload: {
              name: "OpenCode",
              cli_provider: CliProvider.OpenCode,
              command: "opencode",
              model_provider: "openai",
              default_model: "gpt-5",
            },
          })
        ).body,
      ).adapter;

      const res = await app.inject({
        method: "PATCH",
        url: `/api/adapters/${created.id}`,
        payload: {
          auth_type: AdapterAuthType.ApiKey,
          model_provider: "anthropic",
          default_model: "claude-x",
          api_key: "sk-switch-canary",
        },
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.adapter.auth_type).toBe(AdapterAuthType.ApiKey);
      expect(body.adapter.has_api_key).toBe(true);
      expect(JSON.stringify(body)).not.toContain("sk-switch-canary");
    });

    it("clearing api_key while staying in api_key mode marks the adapter Unavailable, not an error", async () => {
      const app = buildApp(services);
      const created = JSON.parse(
        (
          await app.inject({
            method: "POST",
            url: `/api/projects/${projectId}/adapters`,
            payload: {
              name: "OpenCode",
              cli_provider: CliProvider.OpenCode,
              command: "opencode",
              auth_type: AdapterAuthType.ApiKey,
              model_provider: "openai",
              default_model: "gpt-5",
              api_key: "sk-x",
            },
          })
        ).body,
      ).adapter;

      const res = await app.inject({ method: "PATCH", url: `/api/adapters/${created.id}`, payload: { api_key: null } });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.adapter.has_api_key).toBe(false);
      expect(body.adapter.status).toBe(AdapterStatus.Unavailable);
    });

    it("rejects capability_tags sent as a non-array on update with REQUEST_BODY_INVALID", async () => {
      const app = buildApp(services);
      const created = JSON.parse(
        (
          await app.inject({
            method: "POST",
            url: `/api/projects/${projectId}/adapters`,
            payload: { name: "Codex", cli_provider: CliProvider.Codex, command: "codex" },
          })
        ).body,
      ).adapter;

      const res = await app.inject({
        method: "PATCH",
        url: `/api/adapters/${created.id}`,
        payload: { capability_tags: "validator" },
      });
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error.code).toBe(ErrorCode.REQUEST_BODY_INVALID);
    });

    it("switching to oauth clears a stale api_key even without an explicit api_key:null", async () => {
      const app = buildApp(services);
      const created = JSON.parse(
        (
          await app.inject({
            method: "POST",
            url: `/api/projects/${projectId}/adapters`,
            payload: {
              name: "OpenCode",
              cli_provider: CliProvider.OpenCode,
              command: "opencode",
              auth_type: AdapterAuthType.ApiKey,
              model_provider: "openai",
              default_model: "gpt-5",
              api_key: "sk-x",
            },
          })
        ).body,
      ).adapter;

      const res = await app.inject({
        method: "PATCH",
        url: `/api/adapters/${created.id}`,
        payload: { auth_type: AdapterAuthType.OAuth },
      });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).adapter.has_api_key).toBe(false);
    });

    it("rejects an empty name", async () => {
      const app = buildApp(services);
      const created = JSON.parse(
        (
          await app.inject({
            method: "POST",
            url: `/api/projects/${projectId}/adapters`,
            payload: { name: "Codex", cli_provider: CliProvider.Codex, command: "codex" },
          })
        ).body,
      ).adapter;
      const res = await app.inject({ method: "PATCH", url: `/api/adapters/${created.id}`, payload: { name: "  " } });
      expect(res.statusCode).toBe(400);
    });
  });

  describe("POST /api/adapters/:adapter_id/validate", () => {
    it("uses the registered provider adapter's own validate() result", async () => {
      services.adapterRegistry.register(
        scriptedAdapter(CliProvider.Codex, { available: false, errorMessage: "not logged in" }),
      );
      const app = buildApp(services);
      const created = JSON.parse(
        (
          await app.inject({
            method: "POST",
            url: `/api/projects/${projectId}/adapters`,
            payload: { name: "Codex", cli_provider: CliProvider.Codex, command: "codex" },
          })
        ).body,
      ).adapter;

      const res = await app.inject({ method: "POST", url: `/api/adapters/${created.id}/validate` });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.adapter.status).toBe(AdapterStatus.Unavailable);
      expect(body.adapter.auth_status_message).toBe("not logged in");
    });

    it("rejects a numeric workspace_id with REQUEST_BODY_INVALID", async () => {
      const app = buildApp(services);
      const created = JSON.parse(
        (
          await app.inject({
            method: "POST",
            url: `/api/projects/${projectId}/adapters`,
            payload: { name: "Codex", cli_provider: CliProvider.Codex, command: "codex" },
          })
        ).body,
      ).adapter;

      const res = await app.inject({
        method: "POST",
        url: `/api/adapters/${created.id}/validate`,
        payload: { workspace_id: 123 },
      });
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error.code).toBe(ErrorCode.REQUEST_BODY_INVALID);
    });
  });

  describe("PUT /api/projects/:project_id/default-adapter", () => {
    it("sets a different adapter as default", async () => {
      const app = buildApp(services);
      const first = JSON.parse(
        (
          await app.inject({
            method: "POST",
            url: `/api/projects/${projectId}/adapters`,
            payload: { name: "First", cli_provider: CliProvider.Codex, command: "codex" },
          })
        ).body,
      ).adapter;
      const second = JSON.parse(
        (
          await app.inject({
            method: "POST",
            url: `/api/projects/${projectId}/adapters`,
            payload: { name: "Second", cli_provider: CliProvider.ClaudeCode, command: "claude" },
          })
        ).body,
      ).adapter;
      await services.adapterConfigService.shutdown();
      const listRes = await app.inject({ method: "GET", url: `/api/projects/${projectId}/adapters` });
      const firstConverged = JSON.parse(listRes.body).adapters.find((a: { id: string }) => a.id === first.id);
      expect(firstConverged.is_default).toBe(true);

      const res = await app.inject({
        method: "PUT",
        url: `/api/projects/${projectId}/default-adapter`,
        payload: { adapter_id: second.id },
      });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).adapter.id).toBe(second.id);
    });

    it("rejects setting an unavailable adapter as default (409)", async () => {
      const app = buildApp(services);
      const unavailable = JSON.parse(
        (
          await app.inject({
            method: "POST",
            url: `/api/projects/${projectId}/adapters`,
            payload: { name: "Broken", cli_provider: CliProvider.Codex, command: "this-command-does-not-exist-xyz" },
          })
        ).body,
      ).adapter;
      expect(unavailable.status).toBe(AdapterStatus.Unavailable);

      const res = await app.inject({
        method: "PUT",
        url: `/api/projects/${projectId}/default-adapter`,
        payload: { adapter_id: unavailable.id },
      });
      expect(res.statusCode).toBe(409);
      expect(JSON.parse(res.body).error.code).toBe(ErrorCode.ADAPTER_UNAVAILABLE);
    });

    it("rejects a numeric adapter_id with REQUEST_BODY_INVALID", async () => {
      const app = buildApp(services);
      const res = await app.inject({
        method: "PUT",
        url: `/api/projects/${projectId}/default-adapter`,
        payload: { adapter_id: 123 },
      });
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error.code).toBe(ErrorCode.REQUEST_BODY_INVALID);
    });

    it("returns 404 for an adapter belonging to a different project", async () => {
      const app = buildApp(services);
      const otherProjectId = services.projectService.create("Other").id;
      const foreignAdapter = JSON.parse(
        (
          await app.inject({
            method: "POST",
            url: `/api/projects/${otherProjectId}/adapters`,
            payload: { name: "Foreign", cli_provider: CliProvider.Codex, command: "codex" },
          })
        ).body,
      ).adapter;

      const res = await app.inject({
        method: "PUT",
        url: `/api/projects/${projectId}/default-adapter`,
        payload: { adapter_id: foreignAdapter.id },
      });
      expect(res.statusCode).toBe(404);
      expect(JSON.parse(res.body).error.code).toBe(ErrorCode.ADAPTER_NOT_FOUND);
    });

    it("rejects clearing the default while the Project still has adapters (409)", async () => {
      const app = buildApp(services);
      await app.inject({
        method: "POST",
        url: `/api/projects/${projectId}/adapters`,
        payload: { name: "Only", cli_provider: CliProvider.Codex, command: "codex" },
      });
      const res = await app.inject({
        method: "PUT",
        url: `/api/projects/${projectId}/default-adapter`,
        payload: { adapter_id: null },
      });
      expect(res.statusCode).toBe(409);
      expect(JSON.parse(res.body).error.code).toBe(ErrorCode.ADAPTER_REQUIRED);
    });

    it("allows clearing the default when the Project has no adapters", async () => {
      const app = buildApp(services);
      const res = await app.inject({
        method: "PUT",
        url: `/api/projects/${projectId}/default-adapter`,
        payload: { adapter_id: null },
      });
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
      expect(opencode.supported_auth_types).toEqual(
        expect.arrayContaining([AdapterAuthType.OAuth, AdapterAuthType.ApiKey]),
      );
      expect(opencode.model_provider_allowlist).toEqual(expect.arrayContaining(["openai", "anthropic"]));
      expect(JSON.stringify(body)).not.toMatch(/API_KEY/); // env var names are an implementation detail, not exposed
    });
  });
});
