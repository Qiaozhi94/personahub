import { describe, it, expect } from "vitest";
import {
  selectValidator,
  parseWorkflowSteps,
  hasValidationStep,
  assertValidatorAvailable,
  ValidatorSelectorError,
  type ValidatorSelectorInput,
} from "../../src/services/validation/validator-selector.js";
import {
  AdapterRole,
  ValidationBlockReason,
  type AdapterConfig,
  type WorkflowTemplate,
  type IssueType,
} from "@personahub/shared/types";

function defaultWorkflow(overrides: Partial<WorkflowTemplate> = {}): WorkflowTemplate {
  return {
    id: "wft_coding_default",
    name: "Coding Workflow",
    issue_type: "coding" as IssueType,
    collaboration_topology: "sequential",
    agent_team_template_id: null,
    validation_policy_id: "vpl_coding_default",
    steps_json: JSON.stringify({
      schema_version: 1,
      steps: [
        { id: "implementation", role: "implementation" },
        { id: "validation", role: "validator" },
      ],
    }),
    handoff_policy_json: null,
    evidence_requirements_json: null,
    status: "active",
    version: 1,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeConfig(overrides: Partial<AdapterConfig> = {}): AdapterConfig {
  return {
    id: "agc_1",
    project_id: "prj_1",
    name: "Codex Reviewer",
    role: AdapterRole.Validator,
    cli_provider: "codex",
    command: "codex",
    args: [],
    capability_tags: [],
    default_model: "gpt-5",
    status: "available",
    last_checked_at: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function defaultInput(overrides: Partial<ValidatorSelectorInput> = {}): ValidatorSelectorInput {
  return {
    workflowTemplate: defaultWorkflow(),
    availableValidators: [makeConfig()],
    ...overrides,
  };
}

describe("F004 T028: Validator Selector", () => {
  describe("parseWorkflowSteps", () => {
    it("parses valid steps_json", () => {
      const steps = parseWorkflowSteps(defaultWorkflow().steps_json);
      expect(steps).toHaveLength(2);
      expect(steps[0].id).toBe("implementation");
      expect(steps[1].role).toBe("validator");
    });

    it("returns empty array for null steps_json", () => {
      expect(parseWorkflowSteps(null)).toEqual([]);
    });

    it("throws for invalid JSON", () => {
      expect(() => parseWorkflowSteps("not json")).toThrow(ValidatorSelectorError);
    });

    it("throws for non-object JSON", () => {
      expect(() => parseWorkflowSteps("[1,2,3]")).toThrow(ValidatorSelectorError);
    });

    it("throws when steps is not an array", () => {
      expect(() => parseWorkflowSteps(JSON.stringify({ steps: "not array" }))).toThrow(ValidatorSelectorError);
    });
  });

  describe("hasValidationStep", () => {
    it("returns true when validator step exists", () => {
      expect(hasValidationStep([
        { id: "implementation", role: "implementation" },
        { id: "validation", role: "validator" },
      ])).toBe(true);
    });

    it("returns false when no validator step", () => {
      expect(hasValidationStep([
        { id: "implementation", role: "implementation" },
      ])).toBe(false);
    });

    it("returns false for empty steps", () => {
      expect(hasValidationStep([])).toBe(false);
    });
  });

  describe("workflow missing validation step", () => {
    it("returns WorkflowConfigurationInvalid when no validation step", () => {
      const wf = defaultWorkflow({
        steps_json: JSON.stringify({
          schema_version: 1,
          steps: [{ id: "implementation", role: "implementation" }],
        }),
      });
      const result = selectValidator(defaultInput({ workflowTemplate: wf }));
      expect(result.selected).toBeNull();
      expect(result.reason).toBe(ValidationBlockReason.WorkflowConfigurationInvalid);
    });

    it("returns WorkflowConfigurationInvalid when steps_json is null", () => {
      const wf = defaultWorkflow({ steps_json: null });
      const result = selectValidator(defaultInput({ workflowTemplate: wf }));
      expect(result.selected).toBeNull();
      expect(result.reason).toBe(ValidationBlockReason.WorkflowConfigurationInvalid);
    });
  });

  describe("no available config", () => {
    it("returns ValidatorUnavailable when no validators", () => {
      const result = selectValidator(defaultInput({ availableValidators: [] }));
      expect(result.selected).toBeNull();
      expect(result.reason).toBe(ValidationBlockReason.ValidatorUnavailable);
    });

    it("returns ValidatorUnavailable when all validators are unavailable status", () => {
      const configs = [makeConfig({ status: "disabled" })];
      const result = selectValidator(defaultInput({ availableValidators: configs }));
      expect(result.selected).toBeNull();
      expect(result.reason).toBe(ValidationBlockReason.ValidatorUnavailable);
    });
  });

  describe("role/status filtering", () => {
    it("filters out implementation role configs", () => {
      const configs = [
        makeConfig({ id: "agc_impl", role: AdapterRole.Implementation }),
        makeConfig({ id: "agc_val", role: AdapterRole.Validator }),
      ];
      const result = selectValidator(defaultInput({ availableValidators: configs }));
      expect(result.selected).not.toBeNull();
      expect(result.selected?.id).toBe("agc_val");
    });

    it("filters out non-available status configs", () => {
      const configs = [
        makeConfig({ id: "agc_1", status: "disabled" }),
        makeConfig({ id: "agc_2", status: "available" }),
      ];
      const result = selectValidator(defaultInput({ availableValidators: configs }));
      expect(result.selected?.id).toBe("agc_2");
    });

    it("does not fallback to implementation config", () => {
      const configs = [makeConfig({ id: "agc_impl", role: AdapterRole.Implementation })];
      const result = selectValidator(defaultInput({ availableValidators: configs }));
      expect(result.selected).toBeNull();
      expect(result.reason).toBe(ValidationBlockReason.ValidatorUnavailable);
    });

    it("does not fallback to unavailable validator", () => {
      const configs = [makeConfig({ id: "agc_val", status: "disabled" })];
      const result = selectValidator(defaultInput({ availableValidators: configs }));
      expect(result.selected).toBeNull();
      expect(result.reason).toBe(ValidationBlockReason.ValidatorUnavailable);
    });
  });

  describe("deterministic selection", () => {
    it("selects first by created_at ASC", () => {
      const configs = [
        makeConfig({ id: "agc_b", created_at: "2026-02-01T00:00:00Z" }),
        makeConfig({ id: "agc_a", created_at: "2026-01-01T00:00:00Z" }),
      ];
      const result = selectValidator(defaultInput({ availableValidators: configs }));
      expect(result.selected?.id).toBe("agc_a");
    });

    it("breaks ties by id ASC", () => {
      const configs = [
        makeConfig({ id: "agc_z", created_at: "2026-01-01T00:00:00Z" }),
        makeConfig({ id: "agc_a", created_at: "2026-01-01T00:00:00Z" }),
      ];
      const result = selectValidator(defaultInput({ availableValidators: configs }));
      expect(result.selected?.id).toBe("agc_a");
    });

    it("produces same result for same input", () => {
      const configs = [
        makeConfig({ id: "agc_b", created_at: "2026-02-01T00:00:00Z" }),
        makeConfig({ id: "agc_a", created_at: "2026-01-01T00:00:00Z" }),
      ];
      const input = defaultInput({ availableValidators: configs });
      const r1 = selectValidator(input);
      const r2 = selectValidator(input);
      expect(r1.selected?.id).toBe(r2.selected?.id);
    });

    it("selects from multiple available validators deterministically", () => {
      const configs = [
        makeConfig({ id: "agc_3", created_at: "2026-03-01T00:00:00Z", name: "Reviewer 3" }),
        makeConfig({ id: "agc_1", created_at: "2026-01-01T00:00:00Z", name: "Reviewer 1" }),
        makeConfig({ id: "agc_2", created_at: "2026-02-01T00:00:00Z", name: "Reviewer 2" }),
      ];
      const result = selectValidator(defaultInput({ availableValidators: configs }));
      expect(result.selected?.id).toBe("agc_1");
      expect(result.selected?.name).toBe("Reviewer 1");
    });
  });

  describe("assertValidatorAvailable", () => {
    it("returns config when validator is available", () => {
      const result = selectValidator(defaultInput());
      const config = assertValidatorAvailable(result);
      expect(config).not.toBeNull();
      expect(config.id).toBe("agc_1");
    });

    it("throws when no validator available", () => {
      const result = selectValidator(defaultInput({ availableValidators: [] }));
      expect(() => assertValidatorAvailable(result)).toThrow(ValidatorSelectorError);
    });

    it("throws with correct block reason", () => {
      const result = selectValidator(defaultInput({ availableValidators: [] }));
      try {
        assertValidatorAvailable(result);
        expect.fail("Should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(ValidatorSelectorError);
        const err = e as ValidatorSelectorError;
        expect(err.code).toBe(ValidationBlockReason.ValidatorUnavailable);
      }
    });
  });
});
