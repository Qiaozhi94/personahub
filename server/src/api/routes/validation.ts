import type { FastifyPluginAsync } from "fastify";
import type { ValidationQueryService } from "../../services/validation/query.js";
import type { ValidationRecoveryActionService } from "../../services/validation/recovery-action.js";
import type { ValidationWorkflowService } from "../../services/validation/workflow-service.js";
import type { EvidenceSummaryRepository } from "../../repositories/evidence-summary.js";
import type { IssueRepository } from "../../repositories/issue.js";
import type { RunRepository } from "../../repositories/run.js";
import { IssueStatus, RunRole } from "@personahub/shared/types";
import { AppError } from "../errors.js";
import { ErrorCode } from "@personahub/shared/errors";

export interface ValidationRoutesOptions {
  validationQueryService: ValidationQueryService;
  validationRecoveryActionService: ValidationRecoveryActionService;
  validationWorkflowService: ValidationWorkflowService;
  evidenceSummaryRepo: EvidenceSummaryRepository;
  issueRepo: IssueRepository;
  runRepo: RunRepository;
}

export const validationRoutes: FastifyPluginAsync<ValidationRoutesOptions> = async (app, opts) => {
  const {
    validationQueryService,
    validationRecoveryActionService,
    validationWorkflowService,
    evidenceSummaryRepo,
    issueRepo,
    runRepo,
  } = opts;

  app.get("/api/issues/:issue_id/validation", async (request) => {
    const { issue_id } = request.params as { issue_id: string };
    const status = validationQueryService.getValidationStatus(issue_id);
    return status;
  });

  app.get("/api/issues/:issue_id/evidence-summary", async (request) => {
    const { issue_id } = request.params as { issue_id: string };
    const issue = issueRepo.getById(issue_id);
    if (!issue || issue.status !== IssueStatus.Done) {
      throw new AppError(ErrorCode.EVIDENCE_SUMMARY_NOT_FOUND, "Evidence summary not found.");
    }
    const summary = evidenceSummaryRepo.getByIssueId(issue_id);
    if (!summary) {
      throw new AppError(ErrorCode.EVIDENCE_SUMMARY_NOT_FOUND, "Evidence summary not found.");
    }
    return { evidence_summary: summary };
  });

  app.post("/api/issues/:issue_id/unblock", async (request) => {
    const { issue_id } = request.params as { issue_id: string };
    const body = (request.body ?? {}) as { operator_note?: string };
    if (!body.operator_note || typeof body.operator_note !== "string") {
      throw new AppError(ErrorCode.OPERATOR_NOTE_REQUIRED, "Operator note is required.");
    }
    const issue = validationRecoveryActionService.unblock(issue_id, body.operator_note);
    return { issue };
  });

  app.post("/api/issues/:issue_id/validation", async (request) => {
    const { issue_id } = request.params as { issue_id: string };
    const issue = issueRepo.getById(issue_id);
    if (!issue) {
      throw new AppError(ErrorCode.ISSUE_NOT_FOUND, "Issue not found.");
    }
    if (issue.status !== IssueStatus.Validating) {
      throw new AppError(
        ErrorCode.INVALID_ISSUE_TRANSITION,
        `Cannot trigger validation for issue in status ${issue.status}.`,
      );
    }
    const activeValidator = runRepo.getActiveValidator(issue_id);
    if (activeValidator) {
      return { run: activeValidator };
    }
    const implRun = runRepo.getLatestCompletedByRole(issue_id, RunRole.Implementation);
    if (!implRun) {
      throw new AppError(
        ErrorCode.INVALID_ISSUE_TRANSITION,
        "No completed implementation run found for validation.",
      );
    }
    const validatorRun = validationWorkflowService.requestValidation(issue_id, implRun.id);
    if (!validatorRun) {
      const refreshedIssue = issueRepo.getById(issue_id);
      if (refreshedIssue?.status === IssueStatus.Blocked) {
        throw new AppError(
          ErrorCode.VALIDATOR_UNAVAILABLE,
          refreshedIssue.blocked_reason_message ?? "Validator unavailable.",
        );
      }
      throw new AppError(
        ErrorCode.VALIDATOR_UNAVAILABLE,
        "Could not create validator run.",
      );
    }
    return { run: validatorRun };
  });
};
