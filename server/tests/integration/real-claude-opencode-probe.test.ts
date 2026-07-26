import { describe, it, expect } from "vitest";
import { createTestServices, createTempDir, disposeTestServices, type TestServices } from "../helpers.js";
import { AdapterStatus, AgentCapability, CliProvider, AdapterAuthType } from "@personahub/shared/types";
import { ClaudeCodeAdapter } from "../../src/runtime/adapters/claude-code-adapter.js";
import { OpenCodeAdapter } from "../../src/runtime/adapters/opencode-adapter.js";

/**
 * T101: real, authenticated Claude Code + OpenCode auth verification on this
 * machine (Claude Pro CLI login; OpenCode CLI own credential store, provider
 * "heiyucode-openai"). Gated by REAL_CLAUDE / REAL_OPENCODE so CI/default
 * runs never depend on a logged-in CLI. Verifies: adapter reports Available
 * via the real validate() probe (not a hardcoded --version check), the
 * result survives a fresh service instance (simulating "after restart"),
 * and the raw api_key never round-trips through the public DTO.
 */
const REAL_CLAUDE = !!process.env.REAL_CLAUDE;
const REAL_OPENCODE = !!process.env.REAL_OPENCODE;

describe.skipIf(!REAL_CLAUDE)("T101: real Claude Code OAuth availability", () => {
  it("validate() reports Available for a real, logged-in Claude CLI, and this holds across a fresh service instance (post-restart)", async () => {
    let services: TestServices = createTestServices();
    services.adapterRegistry.register(new ClaudeCodeAdapter());
    try {
      const project = services.projectService.create("T101-Claude");
      const adapter = services.agentConfigRepo.create({
        project_id: project.id, name: "Claude", role: "implementation",
        cli_provider: CliProvider.ClaudeCode, command: "claude", args: [],
        capability_tags: [AgentCapability.Implementation], default_model: null,
        status: AdapterStatus.Unknown, auth_type: AdapterAuthType.OAuth,
      });

      const validated = await services.adapterConfigService.validate(adapter.id);
      expect(validated.status).toBe(AdapterStatus.Available);
      expect(validated.auth_status_message).toBeNull();
      expect(validated.has_api_key).toBe(false);
      expect((validated as { api_key?: unknown }).api_key).toBeUndefined();
      disposeTestServices(services);

      // Simulate "after restart": a brand-new service instance, re-validating
      // the same real CLI login state from scratch.
      services = createTestServices();
      services.adapterRegistry.register(new ClaudeCodeAdapter());
      const project2 = services.projectService.create("T101-Claude-restart");
      const adapter2 = services.agentConfigRepo.create({
        project_id: project2.id, name: "Claude", role: "implementation",
        cli_provider: CliProvider.ClaudeCode, command: "claude", args: [],
        capability_tags: [AgentCapability.Implementation], default_model: null,
        status: AdapterStatus.Unknown, auth_type: AdapterAuthType.OAuth,
      });
      const validated2 = await services.adapterConfigService.validate(adapter2.id);
      expect(validated2.status).toBe(AdapterStatus.Available);
    } finally {
      disposeTestServices(services);
    }
  }, 60_000);
});

describe.skipIf(!REAL_OPENCODE)("T101: real OpenCode availability (own credential store, no PersonaHub-managed api_key)", () => {
  // Windows + OpenCode OAuth + full credential isolation (no workspaceId
  // passed to validate()) is a documented, accepted limitation (CLAUDE.md
  // F005 status, commit a6a73e4 "OpenCode Windows hang" fix): the OAuth CLI
  // genuinely cannot authenticate once HOME/USERPROFILE are redirected on
  // this CLI version — that fix turned an infinite hang into a fast,
  // correct Unavailable, it did not restore OAuth-under-isolation. The
  // real, supported path for a workspace that has real credentials is the
  // workspace-aware one below: bind a workspace with
  // push_credentials_enabled=true and validate against it explicitly.
  it("validate(id, workspaceId) reports Available using OpenCode's own auth.json when the target workspace allows real credentials", async () => {
    const services: TestServices = createTestServices();
    services.adapterRegistry.register(new OpenCodeAdapter());
    try {
      const project = services.projectService.create("T101-OpenCode");
      const workspace = services.workspaceService.bind(project.id, createTempDir());
      services.workspaceRepo.updatePushCredentialsEnabled(workspace.id, true);
      const adapter = services.agentConfigRepo.create({
        project_id: project.id, name: "OpenCode", role: "implementation",
        cli_provider: CliProvider.OpenCode, command: "opencode", args: [],
        capability_tags: [AgentCapability.Implementation],
        default_model: "gpt-5.4", model_provider: "heiyucode-openai",
        status: AdapterStatus.Unknown, auth_type: AdapterAuthType.OAuth,
      });

      const validated = await services.adapterConfigService.validate(adapter.id, workspace.id);
      expect(validated.status).toBe(AdapterStatus.Available);
      expect(validated.has_api_key).toBe(false);
      expect((validated as { api_key?: unknown }).api_key).toBeUndefined();

      // The Project-global baseline is untouched by a workspace-scoped
      // validate() call — it stays at whatever create() left it (Unknown).
      expect(services.agentConfigRepo.getById(adapter.id)!.status).toBe(AdapterStatus.Unknown);
      const override = services.adapterWorkspaceStatusRepo.get(adapter.id, workspace.id);
      expect(override?.status).toBe(AdapterStatus.Available);
    } finally {
      disposeTestServices(services);
    }
  }, 60_000);

  it("validate(id) without a workspaceId stays Unavailable under the conservative default (documented Windows OAuth-under-isolation limitation)", async () => {
    const services: TestServices = createTestServices();
    services.adapterRegistry.register(new OpenCodeAdapter());
    try {
      const project = services.projectService.create("T101-OpenCode-isolated");
      const adapter = services.agentConfigRepo.create({
        project_id: project.id, name: "OpenCode", role: "implementation",
        cli_provider: CliProvider.OpenCode, command: "opencode", args: [],
        capability_tags: [AgentCapability.Implementation],
        default_model: "gpt-5.4", model_provider: "heiyucode-openai",
        status: AdapterStatus.Unknown, auth_type: AdapterAuthType.OAuth,
      });

      const validated = await services.adapterConfigService.validate(adapter.id);
      expect(validated.status).toBe(AdapterStatus.Unavailable);
    } finally {
      disposeTestServices(services);
    }
  }, 60_000);
});
