import { describe, it, expect } from "vitest";
import { AdapterStatus, AdapterAuthType, AgentCapability } from "@personahub/shared/types";
import type { AgentConfigRecord } from "../../src/repositories/agent-config.js";
import { toPublicAdapter } from "../../src/repositories/agent-config-dto.js";

// T019: toPublicAdapter() is the ONLY place an AgentConfigRecord may be turned
// into the public AdapterConfig shape. It must be an explicit field-by-field
// builder — never `{...record, api_key: undefined}` (design §4.2 forbids this
// exact pattern because a future field addition would silently leak through
// a spread, whereas an explicit builder fails to compile until updated).

const HIGHLY_IDENTIFIABLE_SECRET = "sk-T019-CANARY-9d2f7b4e1a6c08d3f5b2";

function baseRecord(overrides: Partial<AgentConfigRecord> = {}): AgentConfigRecord {
  return {
    id: "adp_1",
    project_id: "prj_1",
    name: "OpenCode",
    role: "implementation",
    cli_provider: "opencode",
    command: "opencode",
    args: [],
    capability_tags: [AgentCapability.Implementation],
    default_model: null,
    status: AdapterStatus.Available,
    last_checked_at: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    auth_type: AdapterAuthType.ApiKey,
    model_provider: "openai",
    api_key: HIGHLY_IDENTIFIABLE_SECRET,
    auth_status_message: null,
    ...overrides,
  };
}

describe("toPublicAdapter() (T019)", () => {
  it("maps all non-secret fields through unchanged", () => {
    const record = baseRecord();
    const dto = toPublicAdapter(record, null);

    expect(dto.id).toBe(record.id);
    expect(dto.project_id).toBe(record.project_id);
    expect(dto.name).toBe(record.name);
    expect(dto.cli_provider).toBe(record.cli_provider);
    expect(dto.command).toBe(record.command);
    expect(dto.capability_tags).toEqual(record.capability_tags);
    expect(dto.auth_type).toBe(record.auth_type);
    expect(dto.model_provider).toBe(record.model_provider);
  });

  describe("has_api_key projection", () => {
    it("is true when api_key is set", () => {
      const dto = toPublicAdapter(baseRecord({ api_key: HIGHLY_IDENTIFIABLE_SECRET }), null);
      expect(dto.has_api_key).toBe(true);
    });

    it("is false when api_key is null", () => {
      const dto = toPublicAdapter(baseRecord({ api_key: null }), null);
      expect(dto.has_api_key).toBe(false);
    });
  });

  describe("is_default projection", () => {
    it("is true when the record id matches the Project's default_adapter_config_id", () => {
      const dto = toPublicAdapter(baseRecord({ id: "adp_x" }), "adp_x");
      expect(dto.is_default).toBe(true);
    });

    it("is false when it does not match", () => {
      const dto = toPublicAdapter(baseRecord({ id: "adp_x" }), "adp_y");
      expect(dto.is_default).toBe(false);
    });

    it("is false when the Project has no default (null)", () => {
      const dto = toPublicAdapter(baseRecord({ id: "adp_x" }), null);
      expect(dto.is_default).toBe(false);
    });
  });

  describe("secret never leaks, at any level or key", () => {
    it("JSON.stringify of the DTO never contains the raw secret", () => {
      const dto = toPublicAdapter(baseRecord({ api_key: HIGHLY_IDENTIFIABLE_SECRET }), null);
      expect(JSON.stringify(dto)).not.toContain(HIGHLY_IDENTIFIABLE_SECRET);
    });

    it("the DTO has no 'api_key' property at all — not even set to undefined", () => {
      const dto = toPublicAdapter(baseRecord({ api_key: HIGHLY_IDENTIFIABLE_SECRET }), null);
      expect("api_key" in dto).toBe(false);
      expect(Object.keys(dto)).not.toContain("api_key");
    });

    it("still has no api_key property even when the record's key is null", () => {
      const dto = toPublicAdapter(baseRecord({ api_key: null }), null);
      expect("api_key" in dto).toBe(false);
    });
  });

  describe("auth_status_message passthrough — not itself a secret, but must not be assumed to contain one", () => {
    it("passes through a cleaned probe failure message", () => {
      const dto = toPublicAdapter(baseRecord({ auth_status_message: "probe failed: connection refused" }), null);
      expect(dto.auth_status_message).toBe("probe failed: connection refused");
    });
  });
});
