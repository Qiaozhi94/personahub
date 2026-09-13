// F013 T019: 配置类审计事件的统一写入口（design.md §4 Event / Trace contract）。
// 配置类事件不写 thread_events（thread_id 非空且配置界面没有会话上下文），
// 改写 admin_audit_events；不得为配置事件编造 thread id。
// actor_id 恒为 null：无 auth，账本回答"何时/什么/哪个版本"，不回答"谁"。

import type { AdminAuditEventRepository } from "../repositories/admin-audit-event.js";
import { generateAdminAuditEventId } from "../id.js";

export class AuditService {
  constructor(private repo: AdminAuditEventRepository) {}

  record(
    action: string,
    targetType: string,
    targetId: string,
    details: Record<string, unknown>,
    targetVersion: number | null = null,
  ): void {
    this.repo.insert({
      id: generateAdminAuditEventId(),
      action,
      target_type: targetType,
      target_id: targetId,
      target_version: targetVersion,
      actor_type: "user",
      actor_id: null,
      details_json: JSON.stringify(details),
      created_at: new Date().toISOString(),
    });
  }

  listByTarget(targetId: string) {
    return this.repo.listByTarget(targetId);
  }
}
