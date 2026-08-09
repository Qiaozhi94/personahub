import { describe, it, expect } from "vitest";
import { ErrorCode } from "@personahub/shared/errors";
import { AppError } from "../../src/api/errors.js";
import { validateStepsSchema } from "../../src/services/validation/validate-steps-schema.js";
import {
  parseWorkflowSteps,
  hasValidationStep,
  ValidatorSelectorError,
} from "../../src/services/validation/validator-selector.js";

function withValidatorSteps(): string {
  return JSON.stringify({
    schema_version: 1,
    steps: [
      { id: "implementation", role: "implementation" },
      { id: "validation", role: "validator" },
    ],
  });
}

function noValidatorSteps(): string {
  return JSON.stringify({
    schema_version: 1,
    steps: [{ id: "implementation", role: "implementation" }],
  });
}

// F008 T023c: the strict write-gate rejects everything the loose runtime parser
// silently tolerates. Each rejection is asserted, AND the loose parser is
// re-checked on the same input to prove the two stay deliberately divergent.
describe("F008 T023c: validateStepsSchema (strict write-gate)", () => {
  it("accepts valid steps with a validator step", () => {
    expect(() => validateStepsSchema(withValidatorSteps())).not.toThrow();
  });

  it("accepts valid steps without a validator step (gate, not this validator, decides acknowledge)", () => {
    expect(() => validateStepsSchema(noValidatorSteps())).not.toThrow();
  });

  it("rejects null steps_json", () => {
    expect(() => validateStepsSchema(null)).toThrow(AppError);
    try {
      validateStepsSchema(null);
    } catch (e) {
      expect((e as AppError).code).toBe(ErrorCode.TEMPLATE_STEPS_INVALID);
    }
  });

  it("rejects empty string steps_json", () => {
    expect(() => validateStepsSchema("")).toThrow(AppError);
  });

  it("rejects malformed JSON", () => {
    expect(() => validateStepsSchema("not json")).toThrow(AppError);
    try {
      validateStepsSchema("not json");
    } catch (e) {
      expect((e as AppError).code).toBe(ErrorCode.TEMPLATE_STEPS_INVALID);
    }
  });

  it("rejects non-object JSON", () => {
    expect(() => validateStepsSchema("[1,2,3]")).toThrow(AppError);
  });

  it("rejects unsupported schema_version", () => {
    const json = JSON.stringify({ schema_version: 2, steps: [{ id: "x", role: "implementation" }] });
    expect(() => validateStepsSchema(json)).toThrow(AppError);
    try {
      validateStepsSchema(json);
    } catch (e) {
      expect((e as AppError).code).toBe(ErrorCode.TEMPLATE_STEPS_INVALID);
    }
  });

  it("rejects missing schema_version", () => {
    const json = JSON.stringify({ steps: [{ id: "x", role: "implementation" }] });
    expect(() => validateStepsSchema(json)).toThrow(AppError);
  });

  it("rejects unknown role", () => {
    const json = JSON.stringify({ schema_version: 1, steps: [{ id: "x", role: "reviewer" }] });
    expect(() => validateStepsSchema(json)).toThrow(AppError);
  });

  it("rejects empty steps array", () => {
    const json = JSON.stringify({ schema_version: 1, steps: [] });
    expect(() => validateStepsSchema(json)).toThrow(AppError);
  });

  it("rejects non-array steps", () => {
    const json = JSON.stringify({ schema_version: 1, steps: "not array" });
    expect(() => validateStepsSchema(json)).toThrow(AppError);
  });

  it("rejects duplicate step id", () => {
    const json = JSON.stringify({
      schema_version: 1,
      steps: [
        { id: "dup", role: "implementation" },
        { id: "dup", role: "validator" },
      ],
    });
    expect(() => validateStepsSchema(json)).toThrow(AppError);
  });

  it("rejects step missing id", () => {
    const json = JSON.stringify({ schema_version: 1, steps: [{ role: "implementation" }] });
    expect(() => validateStepsSchema(json)).toThrow(AppError);
  });

  it("rejects step missing role", () => {
    const json = JSON.stringify({ schema_version: 1, steps: [{ id: "x" }] });
    expect(() => validateStepsSchema(json)).toThrow(AppError);
  });

  it("rejects unexpected field in step", () => {
    const json = JSON.stringify({
      schema_version: 1,
      steps: [{ id: "x", role: "implementation", extra: "boom" }],
    });
    expect(() => validateStepsSchema(json)).toThrow(AppError);
  });

  it("rejects non-object step entry", () => {
    const json = JSON.stringify({ schema_version: 1, steps: ["not object"] });
    expect(() => validateStepsSchema(json)).toThrow(AppError);
  });

  describe("loose parseWorkflowSteps stays untouched (runtime path)", () => {
    // The runtime parser must keep its tolerant behavior; strictness lives
    // only in the write-gate. These inputs are all REJECTED by
    // validateStepsSchema above but tolerated/filtered by parseWorkflowSteps.

    it("ignores schema_version (accepts version 2)", () => {
      const steps = parseWorkflowSteps(
        JSON.stringify({ schema_version: 2, steps: [{ id: "x", role: "implementation" }] }),
      );
      expect(steps).toHaveLength(1);
    });

    it("accepts any role string", () => {
      const steps = parseWorkflowSteps(JSON.stringify({ schema_version: 1, steps: [{ id: "x", role: "reviewer" }] }));
      expect(steps[0].role).toBe("reviewer");
    });

    it("silently filters malformed entries instead of throwing", () => {
      const steps = parseWorkflowSteps(
        JSON.stringify({
          schema_version: 1,
          steps: [
            { id: "good", role: "implementation" },
            { id: 123, role: "implementation" },
            { role: "implementation" },
            "not object",
            { id: "also", role: "validator", extra: "field" },
          ],
        }),
      );
      expect(steps.map((s) => s.id)).toEqual(["good", "also"]);
      expect(hasValidationStep(steps)).toBe(true);
    });

    it("returns [] for null (does not throw)", () => {
      expect(parseWorkflowSteps(null)).toEqual([]);
    });

    it("still throws ValidatorSelectorError for unparseable JSON (runtime error path unchanged)", () => {
      expect(() => parseWorkflowSteps("not json")).toThrow(ValidatorSelectorError);
    });
  });
});
