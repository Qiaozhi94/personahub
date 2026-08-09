import type { ZodType } from "zod";
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

/**
 * design docs/decisions/0005 §route handler contract ("只做参数校验（zod）"):
 * TypeScript `as` casts on `request.body` have zero runtime effect — a
 * wrong-typed field (a number where a string is expected, an object,
 * `null` where not accepted) sailed straight through into the service
 * layer and typically surfaced as an uncaught TypeError -> 500, not a
 * client-correctable 400. Every F005 route body must be parsed through a
 * zod schema before it reaches a service call.
 */
export function parseRequestBody<T>(schema: ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    const issue = result.error.issues[0];
    const field = issue?.path.length ? issue.path.join(".") : undefined;
    throw new AppError(ErrorCode.REQUEST_BODY_INVALID, issue?.message ?? "Invalid request body.", field);
  }
  return result.data;
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
  [ErrorCode.ADAPTER_AUTH_INVALID]: 400,
  [ErrorCode.ADAPTER_API_KEY_REQUIRED]: 400,
  [ErrorCode.ADAPTER_MODEL_PROVIDER_UNSUPPORTED]: 400,
  [ErrorCode.DEFAULT_ADAPTER_UNAVAILABLE]: 409,
  [ErrorCode.RUN_PURPOSE_INVALID]: 400,
  [ErrorCode.RUN_NOT_ALLOWED_FOR_ISSUE_STATUS]: 409,
  [ErrorCode.REQUEST_BODY_INVALID]: 400,
  // F006: graph execution errors
  [ErrorCode.GRAPH_RUN_NOT_FOUND]: 404,
  [ErrorCode.NODE_RUN_NOT_FOUND]: 404,
  [ErrorCode.NODE_RUN_ATTEMPT_IN_PROGRESS]: 409,
  [ErrorCode.NODE_RUN_NOT_RETRYABLE]: 409,
  [ErrorCode.GRAPH_RUN_CANCELLING]: 409,
  [ErrorCode.GRAPH_RUN_TERMINAL]: 409,
  [ErrorCode.NO_CAPABLE_ADAPTER]: 409,
  [ErrorCode.ADAPTER_CAPABILITY_MISSING]: 409,
  [ErrorCode.GRAPH_DEFINITION_UNAVAILABLE]: 409,
  [ErrorCode.DEFINITION_VERSION_UNAVAILABLE]: 409,
  [ErrorCode.GRAPH_PLAN_INCOMPLETE]: 409,
  [ErrorCode.GRAPH_TARGET_SET_EMPTY]: 409,
  [ErrorCode.RECOVERY_ACTION_NOT_APPLICABLE]: 409,
  // F007: intake / routing recommendation errors
  [ErrorCode.NO_AVAILABLE_ADAPTER]: 409,
  [ErrorCode.NO_AVAILABLE_CAPABLE_ADAPTER]: 409,
  [ErrorCode.CONFIRMATION_TOKEN_INVALID]: 400,
  [ErrorCode.RECOMMENDATION_STALE]: 409,
  [ErrorCode.TOPOLOGY_NOT_EXECUTABLE]: 409,
  [ErrorCode.GRAPH_PLAN_UNKNOWN_NODE]: 400,
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
