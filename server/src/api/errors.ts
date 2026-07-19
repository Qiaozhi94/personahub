import { ErrorCode } from "@personahub/shared/errors";
import type { ApiError as ApiErrorInterface } from "@personahub/shared/errors";

export class AppError extends Error implements ApiErrorInterface {
  constructor(
    public code: ErrorCode,
    public message: string,
    public field?: string,
    public details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AppError";
  }
}

const ERROR_STATUS_MAP: Record<ErrorCode, number> = {
  [ErrorCode.PROJECT_NAME_REQUIRED]: 400,
  [ErrorCode.PROJECT_NOT_FOUND]: 404,
  [ErrorCode.WORKSPACE_PATH_REQUIRED]: 400,
  [ErrorCode.WORKSPACE_PATH_NOT_FOUND]: 400,
  [ErrorCode.WORKSPACE_PATH_NOT_READABLE]: 400,
  [ErrorCode.WORKSPACE_NOT_FOUND]: 404,
  [ErrorCode.ISSUE_TITLE_REQUIRED]: 400,
  [ErrorCode.ISSUE_GOAL_REQUIRED]: 400,
  [ErrorCode.ISSUE_PRIORITY_INVALID]: 400,
  [ErrorCode.ISSUE_NOT_FOUND]: 404,
  [ErrorCode.PROJECT_WORKSPACE_REQUIRED]: 409,
  [ErrorCode.THREAD_NOT_FOUND]: 404,
  [ErrorCode.ADAPTER_PROVIDER_UNSUPPORTED]: 400,
  [ErrorCode.ADAPTER_COMMAND_REQUIRED]: 400,
  [ErrorCode.ADAPTER_COMMAND_UNAVAILABLE]: 400,
  [ErrorCode.ADAPTER_NOT_FOUND]: 404,
  [ErrorCode.ADAPTER_IN_USE]: 409,
  [ErrorCode.ADAPTER_REQUIRED]: 409,
  [ErrorCode.ADAPTER_UNAVAILABLE]: 409,
  [ErrorCode.ADAPTER_ROLE_INVALID]: 400,
  [ErrorCode.RUN_NOT_FOUND]: 404,
  [ErrorCode.RUN_INSTRUCTIONS_REQUIRED]: 400,
  [ErrorCode.ISSUE_BLOCKED]: 409,
  [ErrorCode.WORKSPACE_LOCKED]: 409,
  [ErrorCode.INVALID_QUERY]: 400,
  [ErrorCode.EVIDENCE_REF_INVALID]: 400,
  [ErrorCode.EVIDENCE_SCOPE_MISMATCH]: 409,
  [ErrorCode.INVALID_ISSUE_TRANSITION]: 409,
  [ErrorCode.VALIDATOR_UNAVAILABLE]: 409,
  [ErrorCode.VALIDATOR_RUN_CONFLICT]: 409,
  [ErrorCode.VALIDATION_RESULT_INVALID]: 422,
  [ErrorCode.EVIDENCE_REQUIREMENTS_NOT_MET]: 409,
  [ErrorCode.EVIDENCE_SUMMARY_NOT_FOUND]: 404,
  [ErrorCode.OPERATOR_NOTE_REQUIRED]: 400,
  [ErrorCode.INTERNAL_ERROR]: 500,
};

export function getErrorStatus(code: ErrorCode): number {
  return ERROR_STATUS_MAP[code] ?? 500;
}

export function buildErrorResponse(error: AppError): { error: ApiErrorInterface } {
  return {
    error: {
      code: error.code,
      message: error.message,
      field: error.field,
      details: error.details ?? {},
    },
  };
}
