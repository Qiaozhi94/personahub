import { describe, it, expect } from "vitest";
import { ErrorCode } from "@personahub/shared/errors";
import { getErrorStatus, AppError, buildErrorResponse } from "../../src/api/errors.js";

describe("Error Status Mapping", () => {
  describe("existing error codes preserve their HTTP status", () => {
    it("PROJECT_NAME_REQUIRED -> 400", () => {
      expect(getErrorStatus(ErrorCode.PROJECT_NAME_REQUIRED)).toBe(400);
    });

    it("PROJECT_NOT_FOUND -> 404", () => {
      expect(getErrorStatus(ErrorCode.PROJECT_NOT_FOUND)).toBe(404);
    });

    it("ISSUE_NOT_FOUND -> 404", () => {
      expect(getErrorStatus(ErrorCode.ISSUE_NOT_FOUND)).toBe(404);
    });

    it("WORKSPACE_LOCKED -> 409", () => {
      expect(getErrorStatus(ErrorCode.WORKSPACE_LOCKED)).toBe(409);
    });

    it("EVIDENCE_SCOPE_MISMATCH -> 409", () => {
      expect(getErrorStatus(ErrorCode.EVIDENCE_SCOPE_MISMATCH)).toBe(409);
    });

    it("INTERNAL_ERROR -> 500", () => {
      expect(getErrorStatus(ErrorCode.INTERNAL_ERROR)).toBe(500);
    });
  });

  describe("F004 validation error codes", () => {
    it("INVALID_ISSUE_TRANSITION -> 409", () => {
      expect(getErrorStatus(ErrorCode.INVALID_ISSUE_TRANSITION)).toBe(409);
    });

    it("VALIDATOR_UNAVAILABLE -> 409", () => {
      expect(getErrorStatus(ErrorCode.VALIDATOR_UNAVAILABLE)).toBe(409);
    });

    it("VALIDATOR_RUN_CONFLICT -> 409", () => {
      expect(getErrorStatus(ErrorCode.VALIDATOR_RUN_CONFLICT)).toBe(409);
    });

    it("VALIDATION_RESULT_INVALID -> 422", () => {
      expect(getErrorStatus(ErrorCode.VALIDATION_RESULT_INVALID)).toBe(422);
    });

    it("EVIDENCE_REQUIREMENTS_NOT_MET -> 409", () => {
      expect(getErrorStatus(ErrorCode.EVIDENCE_REQUIREMENTS_NOT_MET)).toBe(409);
    });

    it("EVIDENCE_SUMMARY_NOT_FOUND -> 404", () => {
      expect(getErrorStatus(ErrorCode.EVIDENCE_SUMMARY_NOT_FOUND)).toBe(404);
    });

    it("OPERATOR_NOTE_REQUIRED -> 400", () => {
      expect(getErrorStatus(ErrorCode.OPERATOR_NOTE_REQUIRED)).toBe(400);
    });
  });

  describe("AppError with F004 codes", () => {
    it("creates AppError with VALIDATOR_UNAVAILABLE", () => {
      const error = new AppError(
        ErrorCode.VALIDATOR_UNAVAILABLE,
        "No validator configured for project",
      );
      expect(error.code).toBe(ErrorCode.VALIDATOR_UNAVAILABLE);
      expect(error.message).toBe("No validator configured for project");
      expect(getErrorStatus(error.code)).toBe(409);
    });

    it("creates AppError with OPERATOR_NOTE_REQUIRED", () => {
      const error = new AppError(
        ErrorCode.OPERATOR_NOTE_REQUIRED,
        "Operator note is required to unblock",
        "operator_note",
      );
      expect(error.code).toBe(ErrorCode.OPERATOR_NOTE_REQUIRED);
      expect(error.field).toBe("operator_note");
      expect(getErrorStatus(error.code)).toBe(400);
    });

    it("creates AppError with VALIDATION_RESULT_INVALID and details", () => {
      const error = new AppError(
        ErrorCode.VALIDATION_RESULT_INVALID,
        "Result envelope failed schema validation",
        undefined,
        { parse_error: "unknown field: foo" },
      );
      expect(error.code).toBe(ErrorCode.VALIDATION_RESULT_INVALID);
      expect(error.details).toEqual({ parse_error: "unknown field: foo" });
      expect(getErrorStatus(error.code)).toBe(422);
    });

    it("buildErrorResponse includes code, message, field, details", () => {
      const error = new AppError(
        ErrorCode.INVALID_ISSUE_TRANSITION,
        "Issue is not in Validating state",
        undefined,
        { current_status: "Done" },
      );
      const response = buildErrorResponse(error);
      expect(response.error.code).toBe(ErrorCode.INVALID_ISSUE_TRANSITION);
      expect(response.error.message).toBe("Issue is not in Validating state");
      expect(response.error.details).toEqual({ current_status: "Done" });
    });
  });

  describe("all F004 error codes exist in ErrorCode enum", () => {
    it("INVALID_ISSUE_TRANSITION exists", () => {
      expect(ErrorCode.INVALID_ISSUE_TRANSITION).toBe("INVALID_ISSUE_TRANSITION");
    });

    it("VALIDATOR_UNAVAILABLE exists", () => {
      expect(ErrorCode.VALIDATOR_UNAVAILABLE).toBe("VALIDATOR_UNAVAILABLE");
    });

    it("VALIDATOR_RUN_CONFLICT exists", () => {
      expect(ErrorCode.VALIDATOR_RUN_CONFLICT).toBe("VALIDATOR_RUN_CONFLICT");
    });

    it("VALIDATION_RESULT_INVALID exists", () => {
      expect(ErrorCode.VALIDATION_RESULT_INVALID).toBe("VALIDATION_RESULT_INVALID");
    });

    it("EVIDENCE_REQUIREMENTS_NOT_MET exists", () => {
      expect(ErrorCode.EVIDENCE_REQUIREMENTS_NOT_MET).toBe("EVIDENCE_REQUIREMENTS_NOT_MET");
    });

    it("EVIDENCE_SUMMARY_NOT_FOUND exists", () => {
      expect(ErrorCode.EVIDENCE_SUMMARY_NOT_FOUND).toBe("EVIDENCE_SUMMARY_NOT_FOUND");
    });

    it("OPERATOR_NOTE_REQUIRED exists", () => {
      expect(ErrorCode.OPERATOR_NOTE_REQUIRED).toBe("OPERATOR_NOTE_REQUIRED");
    });

    it("ADAPTER_ROLE_INVALID exists", () => {
      expect(ErrorCode.ADAPTER_ROLE_INVALID).toBe("ADAPTER_ROLE_INVALID");
    });

    it("ADAPTER_ROLE_INVALID maps to 400", () => {
      expect(getErrorStatus(ErrorCode.ADAPTER_ROLE_INVALID)).toBe(400);
    });
  });
});
