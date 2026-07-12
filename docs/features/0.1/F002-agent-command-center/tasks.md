---
feature_ids: [F002]
related_features: [F001]
topics: [agent-adapter, codex-cli, run-events, workspace-lock, escalation, api, ui, v0.1.1]
doc_kind: tasks
created: 2026-07-12
updated: 2026-07-12
---

# F002：Agent Command Center - 任务

> Status: draft | Owner: TBD | Spec: `spec.md` | Design: `design.md`

## 规则

- 任务应当能追踪到 `spec.md` 中的需求 ID。
- 先用 `FakeAgentAdapter` 建立可测 runtime，再接真实 Codex CLI。
- 标记需求完成前，应先添加或更新对应测试。
- 不实现 handoff、validation、artifact、多 adapter 或完整 sandbox/isolation。
- 如果 Codex CLI probe 结果改变 design 假设，先更新 `design.md` 再继续实现。

## Phase 1：Codex CLI 能力 Probe

- [ ] T001（`FR-001`, `FR-011`, `NFR-006`）：编写并执行 Codex CLI capability probe，验证启动方式、one-shot invocation、session resume、structured output、approval hook、cancel 方式。
- [ ] T002（`FR-001`, `FR-011`, `NFR-006`）：把 probe 结果回填到 `design.md` 的待确认设计问题。
- [ ] T003（`FR-011`, `FR-012`）：根据 probe 结果明确 escalation 是前置拦截还是事后检测路径；无论哪条路径，Run 终态都落为 `failed`，Issue 进入 `Blocked`。

## Phase 2：存储与 Repository

- [ ] T004（`DR-001`）：新增或扩展 Agent / adapter config migration，包含 `args` 字段和删除/停用标记。
- [ ] T005（`DR-002`, `DR-003`）：新增 Run migration，支持 `queued/running/completed/failed/interrupted/cancelled`，不新增 `escalation` Run status。
- [ ] T006（`DR-004`, `NFR-003`）：补充 Workspace lock 所需字段或确认复用 `lock_state` / `locked_by_run_id` 足够。
- [ ] T007（`DR-005`, `TR-001` - `TR-013`）：扩展 ThreadEvent repository，支持 run event payload 和 F001 `event_sequence` cursor 查询。
- [ ] T008（`DR-001` - `DR-007`）：实现 adapter config、Run、Workspace lock 相关 repository 方法。

## Phase 3：Runtime 基础服务

- [ ] T009（`FR-001`, `IR-001`）：实现 adapter config validation/update/delete service，按 executable + argv 处理 `command` / `args`。
- [ ] T010（`FR-002`）：实现 AgentAdapterRegistry，并注册 Codex CLI adapter 和 FakeAgentAdapter。
- [ ] T011（`FR-004`, `DR-002`, `DR-003`）：实现 RunService 状态流转规则，所有状态更新使用 CAS（`UPDATE ... WHERE status = <expected>`），非法转换必须被拒绝而不是静默覆盖。
- [ ] T063（`DR-002`, `DR-003`）：实现 `failure_reason` 枚举赋值逻辑，覆盖 `adapter_exit_nonzero`/`spawn_failed`/`execution_timeout`/`credential_isolation_blocked`/`pre_execution_approval_rejected`/`post_hoc_escalation`/`server_restarted`/`output_parse_failed`。
- [ ] T064（`NFR-007`）：实现 Run 执行超时（默认 30 分钟，可配置），超时后按 cancel 兜底逻辑转为终态，`failure_reason = execution_timeout`。
- [ ] T012（`FR-007`, `DR-004`, `NFR-002`）：实现 WorkspaceLockService 的 acquire/release。
- [ ] T013（`FR-008`, `TR-008`, `NFR-003`）：实现 backend startup stale Run recovery 和 stale lock cleanup。
- [ ] T014（`TR-001` - `TR-013`, `NFR-004`）：实现 ThreadEventService 的“先写 SQLite 再广播”流程。

## Phase 4：Adapter 与 Runner

- [ ] T015（`FR-003`, `FR-005`, `FR-006`）：实现 FakeAgentAdapter，用于 deterministic runtime tests。
- [ ] T016（`FR-001`, `FR-003`）：实现 CodexCliAdapter 的 validate 和 start。
- [ ] T017（`FR-005`, `DR-007`, `TR-003`, `TR-004`）：实现 stdout/stderr chunk -> `run.output` event 转换，stdout + stderr 合计超过 1 MiB 后写 `run.output_truncated`。
- [ ] T018（`FR-006`, `TR-002`, `TR-005`, `TR-006`）：实现 adapter exit -> Run terminal state 和 terminal events。
- [ ] T019（`FR-009`, `TR-007`）：实现 Run cancel，包括 queued cancel、Blocked Issue queued Run cancel 和 running process cancel；使用状态 CAS，避免终态 Run 被误改为 `cancelled` 或重复释放锁。
- [ ] T020（`FR-011`, `FR-012`, `TR-006`, `TR-009`, `TR-010`, `NFR-006`）：实现危险 git operation escalation 路径，并区分前置拦截 / 事后检测；事件顺序固定为 `escalation.triggered -> run.failed -> issue.blocked`。
- [ ] T060（`FR-013`, `DR-008`）：按已选定的方案 (c) 实现 `WorkspaceContext` 的 git 凭据隔离——`Workspace.push_credentials_enabled` 为 `false` 时，Run 的子进程环境按黑名单剔除 `SSH_AUTH_SOCK` 等凭据相关变量、不指向用户真实 `HOME`/`~/.ssh`；`git push` 失败时写 `escalation.triggered`（`blocked_by = credential_isolation`）。若 T062 的 Windows 验证发现方案 (c) 不可靠，改为方案 (a) `GIT_SSH_COMMAND` 覆盖或 (b) 专用 credential helper。

## Phase 5：Command Dispatch 与 Queue

- [ ] T021（`FR-003`, `IR-002`）：实现 Thread command dispatch service，server 从 `Issue.primary_thread_id` 解析 thread，并校验 Issue / primary Thread / Workspace / adapter。
- [ ] T022（`FR-003`, `FR-004`）：dispatch 时创建持久化 Run，并初始化为 `queued`。
- [ ] T023（`FR-007`, `NFR-002`）：实现同 workspace Run queue，确保持锁后才启动 adapter；启动 queued Run 前必须重新检查 Issue 是否 Blocked。
- [ ] T024（`FR-004`, `FR-007`, `FR-012`, `TR-007`）：Run 完成、失败、中断、取消后释放 workspace lock，并启动同 workspace 下一个 eligible queued Run；Blocked Issue 的 queued Run 置为 `cancelled`。
- [ ] T025（`FR-012`）：escalation 触发时将 Issue 置为 `Blocked` 并记录 blocker。

## Phase 6：后端 API / SSE

- [ ] T026（`IR-001`）：新增 adapter config create/read/update/delete/validate API。
- [ ] T027（`IR-002`）：新增从 Issue primary Thread 创建 Run 的 API；request body 不要求 `thread_id`。
- [ ] T028（`IR-003`）：新增 Run read/list API。
- [ ] T029（`IR-004`）：新增 Run cancel API。
- [ ] T030（`IR-005`, `TR-013`）：新增 Thread run events read API，支持基于 `event_sequence` 的 `after_event_id` cursor。
- [ ] T031（`IR-006`, `TR-012`, `TR-013`）：新增或扩展 SSE 订阅，支持断线后补读。
- [ ] T032（`IR-007`）：新增 runtime error 的结构化错误映射。

## Phase 7：前端 UI

- [ ] T033（`UX-001`, `AC-001`）：新增 Codex CLI adapter 配置 UI，支持创建/更新/删除，并展示 available/unavailable 状态。
- [ ] T034（`UX-002`, `AC-002`）：在 Issue primary Thread 中接入 agent 指令提交。
- [ ] T035（`UX-003`, `UX-005`, `AC-003`, `AC-008`）：在 Inspector 展示 Run status、timestamps、exit code、logs。
- [ ] T036（`UX-004`, `AC-004`）：在 Thread 中展示 run events，并处理大量 `run.output` 的折叠/合并。
- [ ] T037（`UX-006`, `AC-007`）：为 queued/running Run 增加 cancel action。
- [ ] T038（`UX-007`, `AC-009`）：展示 escalation blocker 和能力边界说明。
- [ ] T039（`TR-013`, `AC-010`）：刷新或重新打开 Issue 后补读历史 run events。

## Phase 8：自动化测试

- [ ] T040 [P]（`FR-001`）：新增 adapter config validation 单元测试。
- [ ] T041 [P]（`FR-002`）：新增 adapter registry lookup 单元测试。
- [ ] T042 [P]（`FR-004`）：新增 Run status transition 单元测试，覆盖合法转换和非法转换被拒绝（CAS）。
- [ ] T065 [P]（`DR-002`, `DR-003`）：新增 `failure_reason` 枚举赋值单元测试。
- [ ] T066（`NFR-007`）：新增 Run 执行超时集成测试（模拟 adapter 挂起但不退出）。
- [ ] T043 [P]（`FR-007`）：新增 WorkspaceLockService acquire/release 单元测试。
- [ ] T044 [P]（`TR-001` - `TR-011`）：新增 run event payload builder 单元测试，覆盖 `run.queued`、`run.output_truncated`、`issue.blocked` 和 `run.cancelled.reason`。
- [ ] T045（`FR-003`, `FR-005`, `FR-006`）：新增 fake adapter dispatch 集成测试。
- [ ] T046（`TR-001` - `TR-006`）：新增 queued、stdout/stderr、output truncated、completed、failed event persistence 集成测试。
- [ ] T047（`FR-007`, `NFR-002`）：新增同 workspace 两个 Run 串行执行集成测试。
- [ ] T048（`FR-008`, `NFR-003`）：新增 stale running Run recovery 集成测试。
- [ ] T049（`FR-009`）：新增 queued/running Run cancel 集成测试。
- [ ] T050（`TR-012`, `TR-013`, `NFR-004`）：新增 event replay / after_event_id 集成测试。
- [ ] T051（`FR-012`, `TR-007`, `NFR-006`）：新增 Issue Blocked 后 queued Run 不再启动的集成测试。
- [ ] T061（`FR-013`, `DR-008`）：新增 `WorkspaceContext` 凭据隔离单元测试，覆盖 `push_credentials_enabled` 为 `false`/`true` 两种情况下的环境变量构造。
- [ ] T052（`UX-001` - `UX-007`）：新增 UI/E2E 测试，覆盖配置/更新 adapter、提交指令、状态展示、日志展示、取消和 blocker。

## Phase 9：手动验证与文档

- [ ] T053（`SC-001`）：使用真实 Codex CLI 执行一个低风险 Thread 指令。
- [ ] T054（`FR-011`, `NFR-006`）：手动验证 `git push` / force push escalation 能力路径。
- [ ] T062（`FR-013`）：手动验证 Windows 环境下 Run 子进程默认不会意外继承父进程的 SSH agent / git credential cache（Git for Windows credential manager 行为需专门确认）。
- [ ] T055（`FR-008`, `NFR-003`）：手动模拟 backend 在 Run 执行中重启，并确认 Run interrupted、lock released。
- [ ] T056（`AC-001` - `AC-011`）：完整走查 `spec.md` 的验收清单。
- [ ] T057：如果新增字段或事件与 `docs/personahub-system-design.md` 不一致，更新 system design。
- [ ] T058：如果 Codex CLI escalation 能力与架构假设不一致，更新 `docs/personahub-architecture.md` 或风险文档。
- [ ] T059：当 F002 进入 in-progress / review / done 时，更新 `BACKLOG.md` 状态。

## 依赖关系

- T001-T003 阻塞 CodexCliAdapter 的最终实现细节。
- Phase 2 阻塞 Runtime 基础服务。
- T009-T014 阻塞 Adapter / Runner 和 Command Dispatch。
- T021-T025 阻塞 API 和 UI 集成。
- Phase 8 测试可以在对应服务 contract 稳定后并行推进。

## 备注

- F002 应优先让 fake adapter 流程完全可测，再接真实 Codex CLI。
- 如果真实 Codex CLI 不支持前置危险命令拦截，必须在 UI 和 docs 中如实表达事后检测。
- 如果输出日志过大导致 UI 或 DB 压力，先实现 truncation/折叠策略，不要让 Thread 变成不可用的日志洪水。
