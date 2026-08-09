import type Database from "better-sqlite3";
import { ErrorCode } from "@personahub/shared/errors";
import type {
  WorkflowTemplate,
  WorkflowTemplateVersionSummary,
  WorkflowTemplateDetail,
  CreateWorkflowTemplateVersionInput,
} from "@personahub/shared/types";
import type { WorkflowTemplateRepository } from "../repositories/workflow-template.js";
import type { AdminAuditEventRepository } from "../repositories/admin-audit-event.js";
import { parseWorkflowSteps, hasValidationStep, type WorkflowStep } from "./validation/validator-selector.js";
import { validateStepsSchema } from "./validation/validate-steps-schema.js";
import { AppError } from "../api/errors.js";
import { isSqliteUniqueConstraint } from "../db/sqlite-errors.js";
import { generateWorkflowTemplateId, generateAdminAuditEventId } from "../id.js";

interface ActiveAssessment {
  valid: boolean;
  hasValidator: boolean;
}

// F008 T030c: currentlyActive (re-read inside the activation txn) and
// inheritanceSource (:sourceId) are SEPARATE. All destructive judgments and
// audit "before" values key off currentlyActive, never the source.
function assessActiveValidation(template: WorkflowTemplate | null): ActiveAssessment {
  if (!template) return { valid: false, hasValidator: false };
  try {
    const steps = parseWorkflowSteps(template.steps_json);
    return { valid: true, hasValidator: hasValidationStep(steps) };
  } catch {
    return { valid: false, hasValidator: false };
  }
}

interface GateResult {
  targetHasValidator: boolean;
  beforeValidationEnabled: boolean | null;
}

export class WorkflowTemplateAdminService {
  constructor(
    private workflowTemplateRepo: WorkflowTemplateRepository,
    private auditRepo: AdminAuditEventRepository,
    private db: Database.Database,
  ) {}

  // F008 T010/T011: summary list; validation_enabled via the same
  // parseWorkflowSteps+hasValidationStep the runtime uses (AC-001).
  list(issueType: string): WorkflowTemplateVersionSummary[] {
    return this.workflowTemplateRepo.listByIssueType(issueType).map((t) => ({
      id: t.id,
      name: t.name,
      issue_type: t.issue_type,
      status: t.status,
      version: t.version,
      validation_enabled: this.computeValidationEnabled(t.steps_json),
      created_at: t.created_at,
      updated_at: t.updated_at,
    }));
  }

  // F008 T011/T012: detail returns steps + validation_enabled; an invalid
  // steps_json yields null + parse_error, the request must NOT fail (T012).
  detail(id: string): WorkflowTemplateDetail {
    const t = this.workflowTemplateRepo.getById(id);
    if (!t) {
      throw new AppError(ErrorCode.TEMPLATE_NOT_FOUND, "Workflow template not found.");
    }
    let steps: WorkflowStep[] = [];
    let validationEnabled: boolean | null = null;
    let parseError: string | null = null;
    try {
      steps = parseWorkflowSteps(t.steps_json);
      validationEnabled = hasValidationStep(steps);
    } catch (e) {
      parseError = (e as Error).message;
    }
    return {
      id: t.id,
      name: t.name,
      issue_type: t.issue_type,
      collaboration_topology: t.collaboration_topology,
      agent_team_template_id: t.agent_team_template_id,
      validation_policy_id: t.validation_policy_id,
      steps_json: t.steps_json,
      handoff_policy_json: t.handoff_policy_json,
      evidence_requirements_json: t.evidence_requirements_json,
      status: t.status,
      version: t.version,
      steps,
      validation_enabled: validationEnabled,
      parse_error: parseError,
      created_at: t.created_at,
      updated_at: t.updated_at,
    };
  }

  // F008 T020: only name/steps_json accepted; non-editable fields rejected at
  // the route boundary. version = max+1 computed and INSERTed in the same txn;
  // a concurrent max+1 collision maps to 409, not 500 (T020b).
  createVersion(sourceId: string, input: CreateWorkflowTemplateVersionInput): WorkflowTemplateDetail {
    const source = this.workflowTemplateRepo.getById(sourceId);
    if (!source) {
      throw new AppError(ErrorCode.TEMPLATE_NOT_FOUND, "Workflow template not found.");
    }
    const newName = input.name ?? source.name;
    const newStepsJson = input.steps_json !== undefined ? input.steps_json : source.steps_json;

    let newId: string;
    try {
      newId = this.db.transaction(() => {
        const version = this.workflowTemplateRepo.getMaxVersion(source.issue_type) + 1;
        const id = generateWorkflowTemplateId();

        if (input.activate) {
          // F008 T030b: gate keys off currentlyActive re-read in-txn (T030d),
          // never the inheritance source (T030c).
          const gate = this.runActivationGate(source.issue_type, newStepsJson, input.acknowledge_validation_disabled);
          this.workflowTemplateRepo.insertVersion(
            source,
            { name: newName, steps_json: newStepsJson },
            true,
            id,
            version,
          );
          this.writeAudit({
            action: "template.version_created",
            target_id: id,
            target_version: version,
            details: {
              activate: true,
              acknowledge_validation_disabled: input.acknowledge_validation_disabled === true,
              validation_enabled_before: gate.beforeValidationEnabled,
              validation_enabled_after: gate.targetHasValidator,
              source_id: sourceId,
            },
          });
        } else {
          this.workflowTemplateRepo.insertVersion(
            source,
            { name: newName, steps_json: newStepsJson },
            false,
            id,
            version,
          );
          this.writeAudit({
            action: "template.version_created",
            target_id: id,
            target_version: version,
            details: { activate: false, source_id: sourceId },
          });
        }
        return id;
      })();
    } catch (error) {
      if (isSqliteUniqueConstraint(error, "workflow_templates.version")) {
        throw new AppError(
          ErrorCode.TEMPLATE_VERSION_CONFLICT,
          "Another version was created concurrently with the same version number. Retry the request.",
        );
      }
      throw error;
    }
    return this.detail(newId);
  }

  // F008 T023/T030: activate is one of two invariant-preserving commands
  // (no generic setStatus). Implements the four-row gate matrix (T030b).
  activate(id: string, acknowledge?: boolean): WorkflowTemplateDetail {
    const target = this.workflowTemplateRepo.getById(id);
    if (!target) {
      throw new AppError(ErrorCode.TEMPLATE_NOT_FOUND, "Workflow template not found.");
    }
    this.db.transaction(() => {
      const gate = this.runActivationGate(target.issue_type, target.steps_json, acknowledge);
      this.workflowTemplateRepo.activate(id, target.issue_type);
      this.writeAudit({
        action: "template.activated",
        target_id: id,
        target_version: target.version,
        details: {
          acknowledge_validation_disabled: acknowledge === true,
          validation_enabled_before: gate.beforeValidationEnabled,
          validation_enabled_after: gate.targetHasValidator,
        },
      });
    })();
    return this.detail(id);
  }

  // F008 T023: deactivate rejects the last active template (FR-005), otherwise
  // IssueService.create() would fail with a misleading INTERNAL_ERROR.
  deactivate(id: string): WorkflowTemplateDetail {
    const target = this.workflowTemplateRepo.getById(id);
    if (!target) {
      throw new AppError(ErrorCode.TEMPLATE_NOT_FOUND, "Workflow template not found.");
    }
    this.db.transaction(() => {
      const current = this.workflowTemplateRepo.getById(id);
      if (!current || current.status !== "active") return;
      const activeCount = this.workflowTemplateRepo.countActiveByIssueType(current.issue_type);
      if (activeCount <= 1) {
        throw new AppError(
          ErrorCode.LAST_ACTIVE_TEMPLATE,
          "Cannot deactivate the last active workflow template; IssueService.create() would have no default template to assign.",
        );
      }
      this.workflowTemplateRepo.deactivate(id);
      this.writeAudit({
        action: "template.deactivated",
        target_id: id,
        target_version: current.version,
        details: {},
      });
    })();
    return this.detail(id);
  }

  // F008 T030b gate matrix:
  //  - target invalid/NULL -> reject TEMPLATE_STEPS_INVALID (unconditional, row 1)
  //  - currentlyActive valid AND target disables validation -> require acknowledge (row 2)
  //  - currentlyActive invalid AND target valid -> require acknowledge, before=unknown, allow (row 3 / escape hatch T023e)
  //  - target valid + keeps validator -> no acknowledge
  private runActivationGate(
    issueType: string,
    targetStepsJson: string | null,
    acknowledge: boolean | undefined,
  ): GateResult {
    validateStepsSchema(targetStepsJson);
    const targetHasValidator = hasValidationStep(parseWorkflowSteps(targetStepsJson));
    const currentlyActive = this.workflowTemplateRepo.getActiveByIssueType(issueType);
    const before = assessActiveValidation(currentlyActive);
    const acknowledgeRequired = !before.valid ? true : !targetHasValidator;
    if (acknowledgeRequired && !acknowledge) {
      throw new AppError(
        ErrorCode.VALIDATION_DISABLE_NOT_ACKNOWLEDGED,
        "Activating this template disables validation for all newly created issues. Pass acknowledge_validation_disabled: true to confirm.",
        undefined,
        {
          validation_enabled_before: before.valid ? before.hasValidator : null,
          validation_enabled_after: targetHasValidator,
        },
      );
    }
    return {
      targetHasValidator,
      beforeValidationEnabled: before.valid ? before.hasValidator : null,
    };
  }

  private computeValidationEnabled(stepsJson: string | null): boolean | null {
    try {
      return hasValidationStep(parseWorkflowSteps(stepsJson));
    } catch {
      return null;
    }
  }

  private writeAudit(input: {
    action: string;
    target_id: string;
    target_version: number;
    details: Record<string, unknown>;
  }): void {
    this.auditRepo.insert({
      id: generateAdminAuditEventId(),
      action: input.action,
      target_type: "workflow_template",
      target_id: input.target_id,
      target_version: input.target_version,
      actor_type: "local_user",
      actor_id: null,
      details_json: JSON.stringify(input.details),
      created_at: new Date().toISOString(),
    });
  }
}
