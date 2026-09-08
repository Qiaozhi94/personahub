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

先以真实 CLI probe 建立 adapter capability evidence，再新增 Dispatch persistence/service、会话 projection、eligibility evaluator、context assembler 和单机 runtime projection；调整 Run 创建为 Dispatch 提交后的副作用。

## 2. 架构与模块边界

SessionService 管 Room / Thread 归属；DispatchService 是派工唯一写入口；EligibilityEvaluator 只读 F013 发布的项目授权、Skill effective requirements 以及运行时 / 验证独立性；ContextAssembler 通过 F010 `recordConsumption` 写入确定 revision；RunService 只执行已提交 Dispatch。

## 3. 数据模型与 Migration

新增 dispatches 与 dispatch capability / context snapshot；Room 与 Thread 建一对一约束，允许无 task 的独立会话。现有 agent_configs 先迁移为 adapter 接入记录兼容视图；不得丢历史 ID。具体 schema 版本从实施时现值顺延。

## 4. 接口、Contract 与 Event

API：确认 / 撤销 Dispatch，列 eligibility，pause / resume gate，取消 Attempt，转换独立会话。重复确认以 `(task_id, room_id, client_request_id)` 返回同一 draft。事件 commit 点固定为：确认事务写 drafted，撤销 CAS 写 cancelled，deadline claim 写 starting，启动事务写 dispatched / context_filtered；其余事件记录 requirement_overridden、paused、resumed、attempt_cancelled。广播统一消费 commit 后 outbox。

## 5. Runtime、Workflow 与并发

deadline worker 以 CAS 将到期 draft 变为 starting 并取得带 owner / expiry 的租约；撤销与该 CAS 只有一个能成功。starting 不再接受撤销，worker 完成 context assembly 后，在同一数据库事务内写 context snapshot、Artifact consumption、首个 Attempt / queued Run、dispatched 和 outbox，commit 后才 spawn。重启扫描过期 starting lease，由新 owner 复用同一 Dispatch 和幂等键续做；不得新建第二个 Attempt。pause revision 与 claim 在同一数据库临界区判断。resume key 使用组合 + task + room + context scope，换组合或范围冷启动。

## 6. UI 与可观测性

任务输入框打开选择器：模型、思考深度、上下文范围、三档候选与理由。starting 横幅常驻到截止或撤销。会话面复用 F011 shell；运行时只提供一台机器的概览与 adapter facts，不提供任务停止按钮。

## 7. 失败、恢复、安全与兼容

重启扫描到期 draft、过期 starting lease、queued Run 和 pause intent；无法判定的旧记录保持 legacy 标记。starting 的组装若确定性失败则写 start_failed 与诊断，不伪造 Run；瞬时失败留给租约恢复。配置删除不改历史快照。结构性能力不足不可被 override；软能力偏离可 override 但留痕。

## 8. 测试策略与验收映射

AC-001 eligibility fixtures；AC-002 覆盖 confirm / cancel / deadline commit 点、cancel-claim 竞态、starting 租约恢复、事务故障注入与 spawn 顺序；AC-003 session/context probe；AC-004 concurrency barrier/restart；AC-005 browser journey 与 migration fixtures；AC-006 对每个 adapter 的 supported / unsupported / unverified fixture 做变异，并证明缺证据不能进入依赖该能力的独立验证。

## 9. 已确认决策与残余风险

Room 不拥有执行状态，Thread 不露出；Dispatch 与 Run 分离。每项能力只允许 supported / unsupported / unverified；unsupported 与 unverified 都不能承担依赖该能力的独立验证，普通执行若不依赖该能力则可保留为带后果说明的候选。原生记忆无法关闭的 adapter 不能承担独立验证。深度能力必须从 adapter 探测，不硬编码三档都可用。

## 10. 待确认设计问题

无。
