import { describe, it, expect } from "vitest";
import {
  CliProvider,
  AdapterAuthType,
  AgentCapability,
  RunPurpose,
  RunRole,
  RunDispatchSource,
  type AdapterConfig,
  type Run,
  type Project,
  type AdapterProviderMetadata,
  type AdapterProvidersResponse,
  type ProjectDefaultAdapterInput,
  type ProjectDefaultAdapterResponse,
} from "@personahub/shared/types";
import {
  type AdapterConfigCreateInput,
  type AdapterConfigUpdateInput,
  type RunCreateInput,
} from "@personahub/shared/errors";

// T011: shared contract compile/serialization tests for F005 design §3.
// These assert exact enum values (protects against silent renames breaking
// persisted DB values) and that the documented object shapes actually
// compile against real TypeScript object literals, not just "the import
// resolves".

describe("F005 shared adapter/routing contract", () => {
  describe("CliProvider enum", () => {
    it("has exact values from design §3", () => {
      expect(CliProvider.Codex).toBe("codex");
      expect(CliProvider.ClaudeCode).toBe("claude-code");
      expect(CliProvider.OpenCode).toBe("opencode");
    });
  });

  describe("AdapterAuthType enum", () => {
    it("has exact values from design §3", () => {
      expect(AdapterAuthType.OAuth).toBe("oauth");
      expect(AdapterAuthType.ApiKey).toBe("api_key");
    });
  });

  describe("AgentCapability enum", () => {
    it("has exactly Implementation and Validator — no Consult capability", () => {
      expect(AgentCapability.Implementation).toBe("implementation");
      expect(AgentCapability.Validator).toBe("validator");
      // consult is a routing purpose/role, not an adapter capability (design §3, §14 decision table)
      expect((AgentCapability as Record<string, unknown>).Consult).toBeUndefined();
      expect(Object.values(AgentCapability)).toHaveLength(2);
    });
  });

  describe("RunPurpose enum", () => {
    it("has exact values from design §3", () => {
      expect(RunPurpose.WorkflowBound).toBe("workflow_bound");
      expect(RunPurpose.AdHocConsult).toBe("ad_hoc_consult");
    });
  });

  describe("RunRole enum — extended from F004 with Consult", () => {
    it("preserves F004 values and adds a persisted, non-null Consult value", () => {
      expect(RunRole.Implementation).toBe("implementation");
      expect(RunRole.Validator).toBe("validator");
      expect(RunRole.Consult).toBe("consult");
    });
  });

  describe("RunDispatchSource enum — extended from F004 with UserDefault", () => {
    it("preserves F004 values and adds UserDefault", () => {
      expect(RunDispatchSource.UserExplicit).toBe("user_explicit");
      expect(RunDispatchSource.System).toBe("system");
      expect(RunDispatchSource.UserDefault).toBe("user_default");
    });
  });

  describe("Public AdapterConfig shape", () => {
    it("compiles with the new F005 fields and never carries api_key", () => {
      const adapter: AdapterConfig = {
        id: "adp_1",
        project_id: "proj_1",
        name: "Claude",
        role: "implementation",
        cli_provider: "claude-code",
        command: "claude",
        args: [],
        capability_tags: [AgentCapability.Implementation, AgentCapability.Validator],
        default_model: null,
        status: "available" as AdapterConfig["status"],
        last_checked_at: null,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
        auth_type: AdapterAuthType.OAuth,
        model_provider: null,
        has_api_key: false,
        auth_status_message: null,
        is_default: true,
      };
      expect(adapter.auth_type).toBe(AdapterAuthType.OAuth);
      expect(adapter.has_api_key).toBe(false);
      expect(adapter.is_default).toBe(true);
      expect("api_key" in adapter).toBe(false);
    });
  });

  describe("AdapterConfigCreateInput — write-only secret, required auth/capability fields", () => {
    it("compiles with cli_provider/auth_type/capability_tags as real enum members, api_key as write-only", () => {
      const input: AdapterConfigCreateInput = {
        cli_provider: CliProvider.OpenCode,
        auth_type: AdapterAuthType.ApiKey,
        name: "OpenCode",
        command: "opencode",
        model_provider: "openai",
        api_key: "sk-test-not-real",
        capability_tags: [AgentCapability.Implementation],
      };
      expect(input.auth_type).toBe("api_key");
      expect(input.api_key).toBe("sk-test-not-real");
    });

    it("supports make_default", () => {
      const input: AdapterConfigCreateInput = {
        cli_provider: CliProvider.Codex,
        auth_type: AdapterAuthType.OAuth,
        name: "Codex",
        command: "codex",
        capability_tags: [AgentCapability.Implementation, AgentCapability.Validator],
        make_default: true,
      };
      expect(input.make_default).toBe(true);
    });
  });

  describe("AdapterConfigUpdateInput — api_key tri-state (omitted/null/replace)", () => {
    it("allows omitting api_key (preserve)", () => {
      const input: AdapterConfigUpdateInput = { name: "Renamed" };
      expect(input.api_key).toBeUndefined();
    });

    it("allows null api_key (clear)", () => {
      const input: AdapterConfigUpdateInput = { api_key: null };
      expect(input.api_key).toBeNull();
    });

    it("allows a replacement api_key string", () => {
      const input: AdapterConfigUpdateInput = { api_key: "new-key" };
      expect(input.api_key).toBe("new-key");
    });
  });

  describe("Run — purpose and context_source_run_id", () => {
    it("compiles with the new F005 routing fields", () => {
      const run: Run = {
        id: "run_1",
        issue_id: "iss_1",
        thread_id: "thr_1",
        workspace_id: "ws_1",
        adapter_config_id: "adp_1",
        status: "completed" as Run["status"],
        failure_reason: null,
        instructions: "do it",
        started_at: null,
        completed_at: null,
        exit_code: null,
        error_message: null,
        role: RunRole.Consult,
        workflow_step: null,
        validation_round: null,
        dispatch_source: RunDispatchSource.UserExplicit,
        adapter_identity: null,
        has_final_message: false,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
        purpose: RunPurpose.AdHocConsult,
        context_source_run_id: null,
      };
      expect(run.role).toBe("consult");
      expect(run.purpose).toBe("ad_hoc_consult");
    });
  });

  describe("RunCreateInput — adapter_id optional, purpose auto/ad_hoc_consult, never workflow_bound", () => {
    it("compiles with adapter_id omitted (server resolves Project default)", () => {
      const input: RunCreateInput = { instructions: "do it" };
      expect(input.adapter_id).toBeUndefined();
    });

    it("compiles with an explicit adapter_id and purpose=auto", () => {
      const input: RunCreateInput = { instructions: "do it", adapter_id: "adp_1", purpose: "auto" };
      expect(input.purpose).toBe("auto");
    });

    it("compiles with explicit ad_hoc_consult purpose", () => {
      const input: RunCreateInput = { instructions: "look into X", purpose: "ad_hoc_consult" };
      expect(input.purpose).toBe("ad_hoc_consult");
    });
  });

  describe("Project — default_adapter_config_id", () => {
    it("compiles with the new field, nullable", () => {
      const project: Project = {
        id: "proj_1",
        name: "Test",
        description: null,
        default_workspace_id: null,
        default_coordinator_agent_id: null,
        default_adapter_config_id: null,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
      };
      expect(project.default_adapter_config_id).toBeNull();
    });
  });

  describe("Provider metadata response (§9.4)", () => {
    it("compiles a full three-provider listing without leaking secrets/paths", () => {
      const metadata: AdapterProviderMetadata[] = [
        { cli_provider: CliProvider.Codex, supported_auth_types: [AdapterAuthType.OAuth], default_command: "codex", capability_description: "Implementation + validator", model_provider_allowlist: [] },
        { cli_provider: CliProvider.ClaudeCode, supported_auth_types: [AdapterAuthType.OAuth], default_command: "claude", capability_description: "Implementation + validator, pre-execution approval via PreToolUse hook", model_provider_allowlist: [] },
        { cli_provider: CliProvider.OpenCode, supported_auth_types: [AdapterAuthType.OAuth, AdapterAuthType.ApiKey], default_command: "opencode", capability_description: "Implementation + validator, no pre-execution approval", model_provider_allowlist: ["openai", "anthropic"] },
      ];
      const response: AdapterProvidersResponse = { providers: metadata };
      expect(response.providers).toHaveLength(3);
      for (const p of response.providers) {
        // "api_key" itself is a legitimate AdapterAuthType tag (means "this
        // provider supports API-key auth"), not a leaked secret — only check
        // for actual secret-shaped values or real machine paths.
        expect(JSON.stringify(p)).not.toMatch(/sk-[A-Za-z0-9]|C:\\\\Users/);
      }
    });
  });

  describe("Default adapter endpoint (§9.2)", () => {
    it("compiles set-default input/response", () => {
      const input: ProjectDefaultAdapterInput = { adapter_id: "adp_1" };
      const response: ProjectDefaultAdapterResponse = {
        adapter: { id: "adp_1", is_default: true } as unknown as AdapterConfig,
      };
      expect(input.adapter_id).toBe("adp_1");
      expect(response.adapter?.is_default).toBe(true);
    });

    it("allows clearing default with adapter_id:null when Project has no adapters", () => {
      const input: ProjectDefaultAdapterInput = { adapter_id: null };
      const response: ProjectDefaultAdapterResponse = { adapter: null };
      expect(input.adapter_id).toBeNull();
      expect(response.adapter).toBeNull();
    });
  });
});
