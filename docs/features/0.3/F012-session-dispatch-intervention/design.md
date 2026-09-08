---
topics: [session, dispatch, runtime, intervention]
doc_kind: design
created: 2026-08-09
updated: 2026-09-08
---

# F012：Session, Dispatch & Intervention - 设计

## 0. 输入与约束

输入为 `spec.md`、ADR 0009/0011/0012/0015、F005/F006/F010 契约和 F009 兼容 adapter 清单。旧 AgentConfig 与 Thread API 必须提供显式迁移层。

## 1. 技术概要与影响面

新增 Dispatch persistence/service、会话 projection、eligibility evaluator、context assembler 和单机 runtime projection；调整 Run 创建为 Dispatch 提交后的副作用。

## 2. 架构与模块边界

SessionService 管 Room / Thread 归属；DispatchService 是派工唯一写入口；EligibilityEvaluator 只读运行时、项目授权、Skill 要求和验证独立性；RunService 只执行已提交 Dispatch。

## 3. 数据模型与 Migration

新增 dispatches 与 dispatch capability / context snapshot；Room 与 Thread 建一对一约束，允许无 task 的独立会话。现有 agent_configs 先迁移为 adapter 接入记录兼容视图；不得丢历史 ID。具体 schema 版本从实施时现值顺延。

## 4. 接口、Contract 与 Event

API：创建 / 撤销 / 提交 Dispatch，列 eligibility，pause / resume gate，取消 Attempt，转换独立会话。事件记录 drafted、cancelled、dispatched、context_filtered、requirement_overridden、paused、resumed、attempt_cancelled。

## 5. Runtime、Workflow 与并发

starting dispatch 由 deadline worker 幂等提交。pause revision 与 claim 在同一数据库临界区判断；commit 后才 spawn。resume key 使用组合 + task + room + context scope。换组合或范围冷启动。

## 6. UI 与可观测性

任务输入框打开选择器：模型、思考深度、上下文范围、三档候选与理由。starting 横幅常驻到截止或撤销。会话面复用 F011 shell；运行时只提供一台机器的概览与 adapter facts，不提供任务停止按钮。

## 7. 失败、恢复、安全与兼容

重启扫描 starting deadline、queued dispatch 和 pause intent；无法判定的旧记录保持 legacy 标记。配置删除不改历史快照。结构性能力不足不可被 override；软能力偏离可 override 但留痕。

## 8. 测试策略与验收映射

AC-001 eligibility fixtures；AC-002 deadline / idempotency；AC-003 session/context probe；AC-004 concurrency barrier/restart；AC-005 browser journey 与 migration fixtures。

## 9. 已确认决策与残余风险

Room 不拥有执行状态，Thread 不露出；Dispatch 与 Run 分离。残余风险为各 CLI 的深度 / usage / session 能力不齐，必须以探测结果降级并在 UI 写后果。

## 10. 待确认设计问题

无。
