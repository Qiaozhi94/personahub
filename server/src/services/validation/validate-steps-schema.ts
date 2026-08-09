import { ErrorCode } from "@personahub/shared/errors";
import { AdapterRole } from "@personahub/shared/types";
import { AppError } from "../../api/errors.js";

const SUPPORTED_SCHEMA_VERSION = 1;
const VALID_ROLES = new Set<string>([AdapterRole.Implementation, AdapterRole.Validator]);

// F008 T023c: STRICT write-gate for activation, distinct from the loose
// parseWorkflowSteps() runtime path (which ignores schema_version, accepts any
// role string, and silently filters malformed entries). This rejects anything
// that would let a broken template become the default for new issues.
export function validateStepsSchema(stepsJson: string | null): void {
  if (stepsJson === null || stepsJson === "") {
    throw new AppError(
      ErrorCode.TEMPLATE_STEPS_INVALID,
      "steps_json is null or empty; a template cannot be activated without valid steps.",
      "steps_json",
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(stepsJson);
  } catch (e) {
    throw new AppError(
      ErrorCode.TEMPLATE_STEPS_INVALID,
      `Failed to parse steps_json: ${(e as Error).message}`,
      "steps_json",
    );
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new AppError(
      ErrorCode.TEMPLATE_STEPS_INVALID,
      "steps_json must be an object with schema_version and steps.",
      "steps_json",
    );
  }
  const obj = parsed as { schema_version?: unknown; steps?: unknown };
  if (obj.schema_version !== SUPPORTED_SCHEMA_VERSION) {
    throw new AppError(
      ErrorCode.TEMPLATE_STEPS_INVALID,
      `Unsupported or missing schema_version: expected ${SUPPORTED_SCHEMA_VERSION}, got ${JSON.stringify(obj.schema_version)}.`,
      "schema_version",
    );
  }
  if (!Array.isArray(obj.steps)) {
    throw new AppError(ErrorCode.TEMPLATE_STEPS_INVALID, "steps_json.steps must be an array.", "steps");
  }
  if (obj.steps.length === 0) {
    throw new AppError(ErrorCode.TEMPLATE_STEPS_INVALID, "steps_json.steps must not be empty.", "steps");
  }
  const seenIds = new Set<string>();
  for (const entry of obj.steps) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new AppError(ErrorCode.TEMPLATE_STEPS_INVALID, "Each step must be an object.", "steps");
    }
    const step = entry as Record<string, unknown>;
    for (const key of Object.keys(step)) {
      if (key !== "id" && key !== "role") {
        throw new AppError(
          ErrorCode.TEMPLATE_STEPS_INVALID,
          `Unexpected field '${key}' in step; only 'id' and 'role' are allowed.`,
          "steps",
        );
      }
    }
    const id = step.id;
    if (typeof id !== "string" || id.length === 0) {
      throw new AppError(ErrorCode.TEMPLATE_STEPS_INVALID, "Each step must have a non-empty string 'id'.", "steps");
    }
    const role = step.role;
    if (typeof role !== "string") {
      throw new AppError(ErrorCode.TEMPLATE_STEPS_INVALID, `Step '${id}' must have a string 'role'.`, "steps");
    }
    if (!VALID_ROLES.has(role)) {
      throw new AppError(
        ErrorCode.TEMPLATE_STEPS_INVALID,
        `Unknown role '${role}' in step '${id}'; allowed roles: ${[...VALID_ROLES].join(", ")}.`,
        "steps",
      );
    }
    if (seenIds.has(id)) {
      throw new AppError(ErrorCode.TEMPLATE_STEPS_INVALID, `Duplicate step id '${id}'.`, "steps");
    }
    seenIds.add(id);
  }
}
