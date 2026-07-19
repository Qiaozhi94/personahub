import {
  AdapterRole,
  type AdapterConfig,
  type WorkflowTemplate,
} from "@personahub/shared/types";
import { ValidationBlockReason } from "@personahub/shared/types";

export class ValidatorSelectorError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ValidatorSelectorError";
  }
}

export interface WorkflowStep {
  id: string;
  role: string;
}

interface StepsJson {
  schema_version?: number;
  steps?: WorkflowStep[];
}

export function parseWorkflowSteps(stepsJson: string | null): WorkflowStep[] {
  if (!stepsJson) {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(stepsJson);
  } catch {
    throw new ValidatorSelectorError(
      "invalid_steps_json",
      "Failed to parse workflow steps_json",
    );
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new ValidatorSelectorError(
      "invalid_steps_json",
      "steps_json must be an object",
    );
  }
  const obj = parsed as StepsJson;
  if (!Array.isArray(obj.steps)) {
    throw new ValidatorSelectorError(
      "invalid_steps_json",
      "steps_json.steps must be an array",
    );
  }
  return obj.steps.filter(
    (s) => typeof s === "object" && s !== null && typeof s.id === "string" && typeof s.role === "string",
  );
}

export function hasValidationStep(steps: WorkflowStep[]): boolean {
  return steps.some((s) => s.role === AdapterRole.Validator);
}

export interface ValidatorSelectorResult {
  selected: AdapterConfig | null;
  reason: ValidationBlockReason | null;
  message: string;
}

export interface ValidatorSelectorInput {
  workflowTemplate: WorkflowTemplate;
  availableValidators: AdapterConfig[];
}

function sortDeterministic(configs: AdapterConfig[]): AdapterConfig[] {
  return [...configs].sort((a, b) => {
    const timeCmp = a.created_at.localeCompare(b.created_at);
    if (timeCmp !== 0) return timeCmp;
    return a.id.localeCompare(b.id);
  });
}

function filterEligible(configs: AdapterConfig[]): AdapterConfig[] {
  return configs.filter(
    (c) => c.role === AdapterRole.Validator && c.status === "available",
  );
}

export function selectValidator(input: ValidatorSelectorInput): ValidatorSelectorResult {
  const steps = parseWorkflowSteps(input.workflowTemplate.steps_json);

  if (!hasValidationStep(steps)) {
    return {
      selected: null,
      reason: ValidationBlockReason.WorkflowConfigurationInvalid,
      message: "Workflow template does not contain a validation step with role=validator",
    };
  }

  const eligible = filterEligible(input.availableValidators);

  if (eligible.length === 0) {
    return {
      selected: null,
      reason: ValidationBlockReason.ValidatorUnavailable,
      message: "No available validator adapter config found for this project",
    };
  }

  const sorted = sortDeterministic(eligible);

  return {
    selected: sorted[0],
    reason: null,
    message: `Selected validator: ${sorted[0].name} (${sorted[0].id})`,
  };
}

export function assertValidatorAvailable(result: ValidatorSelectorResult): AdapterConfig {
  if (result.selected === null) {
    throw new ValidatorSelectorError(
      result.reason ?? ValidationBlockReason.ValidatorUnavailable,
      result.message,
    );
  }
  return result.selected;
}
