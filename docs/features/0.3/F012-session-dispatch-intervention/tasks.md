---
topics: [session, dispatch, runtime, implementation]
doc_kind: tasks
created: 2026-08-09
updated: 2026-09-14
---

# F012：Session, Dispatch & Intervention - 任务

## 0. 来源与执行规则

行为以 `spec.md`、实现边界以 `design.md` 为准；旧字段迁移必须先写 fixture 再改 schema。

## 1. 前置条件

F009 新壳层与相关兼容入口已可替换；F010 ref / `recordConsumption` contract 冻结；F013 发布 effective requirements 与路径授权 contract。adapter probe 由本 Feature 的具名 Phase 0 任务负责，不作为无 owner 的外部前置事实。

## 2. 实现任务

### Phase 0：Adapter capability readiness

- [x] T000 (`FR-003`, `FR-008`, `NFR-003`): 对 Codex / Claude Code / OpenCode 的模型枚举、深度（原生档位原文与三档映射）、session resume / 冷启动和原生 memory 关闭效果运行真实 CLI probe；将 CLI 版本、时间、命令、脱敏结果与 supported / unsupported / unverified 裁决写入 `adapter-capability-evidence.md` 和机器可读 fixture，并用缺字段 / 过期版本变异证明 eligibility 保守失败。 — verify: `npm test`

Phase 0 probe 是进入 schema / eligibility 实现的门槛。客观无法执行的 probe 必须标 unverified、记录缺失项和重跑命令；不得把缺失 probe 当作 supported，也不得因此静默跳过独立性要求。

### Phase 1：模型、迁移与 eligibility

- [x] T001 (`FR-001`, `FR-002`): 定义 Session / Dispatch / Attempt / execution identity / context snapshot / eligibility / outbox 类型。 — verify: `npm run typecheck`
- [x] T002 (`FR-002`, `NFR-001`): 新增 `runtime_machines` 单机根、`agent_configs.runtime_id`，并按 ADR 0012 落地表实现 `base_url` 的全部八个触点（migration、`AdapterConfig` 类型、repository 四处、DTO、契约形状校验、updater / route 透传、API Key 分支 UI；快照不加该列）。 — verify: `npm test --workspace server`
- [x] T003 (`FR-001`, `NFR-001`): 新增 `rooms` 表与 `threads.room_id` 一对一索引，为全部历史 thread 回填 room 且不改任何历史 ID；补历史 fixture。 — verify: `npm test --workspace server`
- [x] T004 (`FR-002`, `FR-004`): 新增 `dispatches`（幂等键 `(room_id, client_request_id)`）、`attempts`、context / capability 两张快照表及索引。 — verify: `npm test --workspace server`
- [x] T005 (`FR-006`, `FR-008`): 新增 `adapter_capability_evidence` 与三层 `dispatch_gates` 表，并把 `agent_configs` 的 AI 成员语义迁移为 adapter 接入事实（`name` 改执行组合可读名、`role` 只读保留、`capability_tags` 停用）。 — verify: `npm test --workspace server`
- [x] T006 (`FR-009`, `NFR-001`): 实现持久 DomainOutbox 公共基础设施（同一事务 enqueue、worker 投递、consumer ack、指数退避重试、poison 保留与诊断），并证明 Dispatch 广播与 F011 `acceptance.completed` 复用同一 contract。 — verify: `npm test --workspace server`
- [ ] T007 (`FR-002`, `FR-003`, `FR-008`): 实现单机 runtime projection（adapter / 锁 / 队列 / 后台任务 / 额度事实）与三档 eligibility evaluator，将 F013 versioned effective requirements 固定到 Dispatch snapshot；本任务覆盖同源可选降级、结构性缺失不可选，以及 Skill 升级 / 禁用后的历史不漂移。 — verify: `npm test --workspace server`

### Phase 2：派工与介入

- [x] T010 (`FR-004`, `NFR-001`): 实现确认即建 draft、draft 撤销、立即开始、deadline CAS / starting lease，以及 context + consumption + Attempt / Run + dispatched 单事务提交；逐点故障注入并断言 commit 前零 spawn。 — verify: `npm test --workspace server`
- [x] T011 (`FR-005`, `FR-011`, `NFR-002`): 实现 context assembler、过滤事件、resume key 与五条强制冷启动，调用 F013 `verifyAuthorization()` 复核三层路径交集，并通过 F010 公共 API 幂等记录 Artifact consumption（同事务校验 Dispatch 与 `run_id` 归属一致）；本任务是该集成的最终 owner。 — verify: `npm test --workspace server`
- [x] T012 (`FR-006`, `NFR-001`): 实现任务 / 图 / 运行时三层 pause 与 claim barrier、cancel / reassign、restart recovery，并把「旧进程已死」推断提成具名函数 `isRunOwnerDead()`。 — verify: `npm test --workspace server`
- [ ] T013 [P] (`FR-001`, `FR-007`): 实现独立会话、会话消息与转任务。 — verify: `npm test`
- [x] T014 (`FR-010`): 在确认与超时启动两条路径实现验收锁断言，拒绝在 finalizing / completed 上创建或确认 Dispatch 并返回替代路径。 — verify: `npm test --workspace server`
- [ ] T015 (`FR-003`, `FR-004`, `FR-006`, `FR-008`, `NFR-004`): 接入选择器、撤销倒计时与立即开始横幅、`/sessions/:sessionId` 路由、会话面、运行时面与全局闸门，密钥与 session 标识默认遮罩。 — verify: `npm test --workspace web`

## 3. 验证与验收任务

- [ ] T020 (`AC-001`, `AC-003`, `AC-006`): 复跑 adapter evidence fixture、真实 CLI resume / 冷启动与原生 memory 隔离验证，并核对 unsupported / unverified eligibility 后果与遮罩。 — verify: `npm test`
- [ ] T021 (`AC-002`, `AC-004`): 完成 cancel / claim、三层 pause / claim 并发，过期 starting lease、kill/restart 与恢复集成测试。 — verify: `npm test --workspace server`
- [ ] T022 (`AC-007`): 完成 outbox 原子 enqueue、worker 崩溃重投、consumer ack 幂等与 poison 诊断的集成与重启测试。 — verify: `npm test --workspace server`
- [ ] T023 (`AC-008`): 完成验收锁与路径授权复核的集成测试，覆盖两条启动路径与任务级范围只能收紧。 — verify: `npm test --workspace server`
- [ ] T024 (`AC-005`): 完成 Playwright 派工、撤销、独立会话、会话消息、介入和运行时旅程。 — verify: `npm run test:e2e`
- [ ] T025 (`AC-001`, `AC-004`, `AC-005`): 逐行核对 `migration-matrix.md` 中 owner 为 F012 的 18 行（P004、P006、P007、P010、A006-A015、A025-A028）的 `delete_when`，确认旧写入口不可达后更新矩阵的 `implementation_status` 与证据。 — verify: `npm run test:docs`
- [ ] T026 (`AC-001`, `AC-002`, `AC-003`, `AC-004`, `AC-005`, `AC-006`, `AC-007`, `AC-008`): 运行发布质量门。 — verify: `npm run verify:release`

## 4. 依赖与并行关系

F013 contract 与本 Feature Phase 0 probe 完成后，T001→T002→T005→T006→T007→T010/T011/T012/T014→T015；T003 与 T004 可在 T001 后与 T002 并行（互不同表），但 T002 与 T005 必须串行——两者都迁移 `agent_configs`，并行会争抢同一个顺延 schema 版本号。T013 可在 T003 后并行。T000 的证据缺口只能产生 unverified，不允许以口头假设解锁 T007。T025 必须在 T015 之后、T026 之前。F011 在 Dispatch / Session / consumption integration 与 outbox contract 验收后接入，不形成反向依赖。

## 5. 明确后移

多机 daemon 移交 v0.7；自动续派与智能推荐移交 v0.6；用量聚合与 `run_usage` 表移交 v0.4。
