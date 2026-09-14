// F013: 游离任务（无 Project）的三个 legacy 列为空，且不得进入 v0.2 执行链路
// （design §7「分阶段兼容」）。v0.2 链路的读取方在消费 issue.workspace_id /
// issue.project_id 时必须经由这两个窄化助手：类型系统保证每个入口都被显式
// 处理，运行时把"游离任务误入执行链"变成可读的失败而不是未定义行为。

import type { Issue } from "@personahub/shared/types";
import { ErrorCode } from "@personahub/shared/errors";
import { AppError } from "../api/errors.js";

export function requireLegacyWorkspaceId(issue: Issue): string {
  if (!issue.workspace_id) {
    throw new AppError(
      ErrorCode.INTERNAL_ERROR,
      `Issue ${issue.id} has no legacy workspace binding; free-floating issues cannot enter the v0.2 execution chain.`,
    );
  }
  return issue.workspace_id;
}

export function requireLegacyProjectId(issue: Issue): string {
  if (!issue.project_id) {
    throw new AppError(
      ErrorCode.INTERNAL_ERROR,
      `Issue ${issue.id} has no project binding; free-floating issues cannot enter the v0.2 execution chain.`,
    );
  }
  return issue.project_id;
}

export function requireLegacyWorkflowTemplateId(issue: Issue): string {
  if (!issue.workflow_template_id) {
    throw new AppError(
      ErrorCode.INTERNAL_ERROR,
      `Issue ${issue.id} has no legacy workflow template binding; free-floating issues cannot enter the v0.2 execution chain.`,
    );
  }
  return issue.workflow_template_id;
}

export function requireLegacyValidationPolicyId(issue: Issue): string {
  if (!issue.validation_policy_id) {
    throw new AppError(
      ErrorCode.INTERNAL_ERROR,
      `Issue ${issue.id} has no legacy validation policy binding; free-floating issues cannot enter the v0.2 execution chain.`,
    );
  }
  return issue.validation_policy_id;
}
