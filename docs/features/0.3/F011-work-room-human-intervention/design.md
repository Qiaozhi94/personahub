---
kind: feature
id: F011
version: "0.3"
related_features: [F006, F007, F008, F009, F010, F012]
topics: [room, human-lead, intervention, graph]
doc_kind: design
created: 2026-08-09
updated: 2026-08-09
---

# F011：Work Room & Human Intervention - 设计

> Owner: TBD | Spec: `spec.md` | Tasks: `tasks.md`

## 0. 输入与约束

- **行为契约**：`spec.md`。
- **PRD / Architecture / System Design**：`docs/personahub-prd.md` 第 5、15 节；`docs/personahub-architecture.md` Graph/Run/Thread；`docs/personahub-system-design.md` Room 草案。
- **ADR / 上游 Contract**：F006 Graph、F007 intake、F008 共享 queued classifier（T041b）、F009/F010 artifact projection。
- **实现约束**：F008 = schema v10、F009 = v11、F010 = v12、F011 固定 schema v13；F012 = v14；已应用 migration 永不修改或追加。F011 不假设当前代码已存在 `queuedRunEligibility()`，必须复用 F008 T041b 的导出。

## 1. 技术概要与影响面

F011 固定使用 schema v13（F008=v10、F009=v11、F010=v12）。新增 DB-only `createRoom(tx, ...)`、`RoomControlService`、`RoomProjectionService`、`RoomContextAssembler`。Room 绑定一个 GraphRun 和专属 Thread；Graph/Run 继续执行，Room 只提供该 Graph 阶段的 policy gate、成员/约束历史与聚合 UI。若 migration 落地前实施顺序改变，整体重新编号；已应用版本永不修改或追加。

- 前端：Room 页面、Inspector、control bar。
- 后端 / API：schema v13、Room control/projection service、routes。
- 存储 / Migration：work_rooms/room_members/control command 幂等表。
- Runtime / Agent Adapter：Room gate 接入共享 queued classifier；constraint 注入 context assembler。
- Event / Evidence：room.* ThreadEvent + control command payload。
- 文档 / 配置：无新外部配置。

## 2. 架构与模块边界

- `createRoom(tx, ...)`：DB-only primitive，预生成 room/thread id，写 `threads.room_id` 与 canonical `work_rooms.thread_id`，复核 Thread/Room/Graph 双向归属。
- `RoomControlService`：CAS/idempotency 与 pause/resume/constraint/reassign 状态机；所有命令带 `expected_control_revision` 和 `idempotency_key`。
- `RoomProjectionService`：聚合 Room/Graph/members/artifacts/timeline，复用 Graph/NodeRun/Run 真相源，不复制可变执行状态。
- `RoomContextAssembler`：读取 effective active constraints，作为独立 context section 注入未启动 Attempt，记录 `room.constraints_applied` refs；不改 `runs.instructions`。
- 共享 classifier：复用 F008 T041b 从 `RunDispatchService.startNextQueuedRun()` 抽出的无副作用资格判定，F011 不得复制一份判断。
- 唯一真相源：`work_rooms.thread_id` 是 Room->Thread canonical relation；遗留 `threads.room_id` 是必填反向导航字段。Repository/Projection 每次读取都断言 `work_rooms.thread_id = thread.id` 且 `thread.room_id = work_rooms.id`，不一致视为 `ROOM_THREAD_LINK_INVALID`。

## 3. 数据模型与 Migration

```sql
CREATE TABLE work_rooms (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  issue_id TEXT NOT NULL REFERENCES issues(id),
  thread_id TEXT NOT NULL UNIQUE REFERENCES threads(id),
  graph_run_id TEXT UNIQUE REFERENCES graph_runs(id),
  phase TEXT NOT NULL,
  goal TEXT NOT NULL,
  topology TEXT NOT NULL,
  creation_reason_json TEXT NOT NULL,
  input_contract_json TEXT NOT NULL,
  output_contract_json TEXT NOT NULL,
  evidence_requirements_json TEXT NOT NULL,
  termination_condition_json TEXT NOT NULL,
  status TEXT NOT NULL,
  control_revision INTEGER NOT NULL DEFAULT 1,
  paused_at TEXT,
  archived_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE room_members (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES work_rooms(id),
  adapter_config_id TEXT REFERENCES agent_configs(id) ON DELETE SET NULL,
  adapter_identity_json TEXT NOT NULL,
  source_squad_id TEXT,
  joined_at TEXT NOT NULL,
  left_at TEXT,
  change_reason TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_threads_one_room_thread
  ON threads(room_id) WHERE room_id IS NOT NULL;
```

`work_rooms.thread_id` 是 Room->Thread 的 canonical relation；遗留的 `threads.room_id` 是 Thread->Room 的必填反向导航字段，不再保持 NULL。创建 Room Thread 时必须把预生成的 room id 写入 `threads.room_id`，随后插入 `work_rooms.thread_id`，两者与 Graph 在同一外层事务提交；`idx_threads_one_room_thread` 保证一个 Room 至多一个专属 Thread。现有 `ThreadRepository.create()` 需增加受限的 `room_id` 入参路径，普通 primary Thread 继续写 NULL。Graph 反查只使用 `work_rooms.graph_run_id`，不在 `graph_runs` 再存第二个 room 指针。每个非终态 Graph 至多一个 Room 由 unique graph_run_id 保证。

## 4. 接口、Contract 与 Event

### API / CLI / Adapter Contract

| Route                                         | 行为                                       |
| --------------------------------------------- | ------------------------------------------ |
| `GET /api/issues/:issueId/rooms`              | Room summaries                             |
| `POST /api/issues/:issueId/rooms`             | 手动创建                                   |
| `GET /api/rooms/:id`                          | 聚合 Room/Graph/members/artifacts/timeline |
| `POST /api/rooms/:id/pause` / `resume`        | control command                            |
| `POST /api/rooms/:id/constraints`             | 追加/撤销约束                              |
| `POST /api/rooms/:id/nodes/:nodeKey/reassign` | 换执行者                                   |
| `POST /api/rooms/:id/archive`                 | 仅合法终态/取消后                          |

所有命令带 `expected_control_revision` 和 `idempotency_key`；`room_control_commands(room_id,idempotency_key,response_json)` 可与 F007 confirmation 同型实现幂等。更新用 CAS。

### Event / Trace Contract

事件 payload 必含 `room_id`/`control_revision`/`idempotency_key`/`actor(local_user)`；成员和 executor 事件含 before/after identity snapshot 与 reason。constraint 事件 payload 保存 `{constraint_id,text,effective_after_event_sequence,status}`；不得改 `runs.instructions`。`artifact.consumed` 等沿用 F010。

## 5. Runtime、Workflow 与并发

F007 confirm 的 graph 分支在同一外层 transaction 内：创建 Issue/primary Thread -> 生成 room/room-thread ids -> 插 room Thread -> `createGraph(...)` -> `createRoom(...)` -> confirmation claim/events。所有 event 先缓冲，commit 后 broadcast/drain。推荐阶段仍零写入；sequential 不自动建 Room。手动创建复用同一 DB-only primitives，要求 Issue 尚无非终态 graph；不允许把 Room 套在任意已有运行中的 Run 集合上。

F011 在 classifier/dispatch policy 上增加 Room gate，并且仅当 `run.role=GraphNode`、`run.node_run_id` 所属 Graph 绑定该 Room 时检查 Room 状态。paused 返回 `waiting_for_room_resume`，cancelling/archived 返回终态拒绝；普通 implementation/validator/consult Run 明确跳过该 gate。pause 提交后不 kill running；resume 提交后对 Graph workspace 幂等 `drainWorkspace()`。

Reassign 协议：

1. 事务内读取 Room/Graph/NodeRun/active Attempt 与 control revision。
2. running Attempt -> 409 `ROOM_RUNNING_NODE_REASSIGN_REQUIRES_CANCEL`。
3. queued Attempt -> 先走既有 cancelQueued/finalize 语义，不能只改 assigned id；pending/ready 无 Attempt 可直接改。
4. `resolveEligibleAdapter()` 复核 Project/workspace/capability；更新 NodeRun assigned id 和成员快照，创建新 queued Attempt（若 join 已满足）。
5. 写 executor_reassigned 事件；commit 后 drain。

成员移除若仍被未终态节点引用，必须同时提交 replacement mapping；否则 409。历史 Run.adapter_identity 永不修改。

## 6. UI 与可观测性

页面中部 Room timeline，右侧 Inspector 为 members/contracts/artifacts。控制条始终说明“暂停后续派工，不会停止当前进程”；running 节点换人提供 cancel 入口但不自动执行两步破坏动作。每个控制动作有 pending/success/error 与影响范围说明。

## 7. 失败、恢复、安全与兼容

- 校验与失败映射：running reassign 返回 409 `ROOM_RUNNING_NODE_REASSIGN_REQUIRES_CANCEL`；成员移除仍被未终态节点引用且无 replacement 返回 409；Thread/Room 双向归属不一致视为 `ROOM_THREAD_LINK_INVALID`，不得静默选择一侧。
- 重启与恢复：从 Graph 真相重算 Room blocked/completed 投影；paused 保留；running Attempt interrupted 仍走 F006 恢复。
- 权限 / escalation / 凭据边界：Room 不拦截图完成后 primary Thread 的普通 Run；控制动作保留 raw AgentOps signal。
- Windows / POSIX / 版本兼容：无新平台相关行为；control revision CAS 与 idempotency key 跨重启一致。

## 8. 测试策略与验收映射

| 验收项 | 测试层级 | 计划文件 / 场景 | 关键断言 |
|---|---|---|---|
| `AC-001` | integration | `server/tests/integration/room-confirm-atomicity.test.ts`（计划） | confirm 原子创建，任一失败无孤儿/无幽灵事件 |
| `AC-002` | integration | `server/tests/integration/room-pause-barrier.test.ts`（计划） | queued GraphNode 不启动、running 继续、普通 Run 不误拦截；resume 仅一个 drain |
| `AC-003` | integration | `server/tests/integration/room-constraint-sequence.test.ts`（计划） | 约束只影响生效点后 Attempt，事件可解释 |
| `AC-004` | integration | `server/tests/integration/room-reassign.test.ts`（计划） | 未开始可换人；running 返回 409 + cancel->retry |
| `AC-005` | integration | `server/tests/integration/room-reassign-availability.test.ts`（计划） | adapter 翻转时复核并阻塞，不静默替换 |
| `AC-006` | integration + manual | `server/tests/integration/room-archive-replay.test.ts`、真实 CLI restart | 归档/重启后 Room、成员快照、人工操作、artifact 链完整回放 |

覆盖双 pause/resume、pause 与 queued claim barrier、reassign 与 adapter probe/delete、confirm 故障、restart、SSE replay、UI exhaustive control errors、真实 CLI 全旅程。

## 9. 已确认决策与残余风险

| 决策 / 风险 | 结论或缓解 | 理由 | 替代方案 / 后续 |
|---|---|---|---|
| Room 定位 | control/projection boundary | 不新建第二套执行状态机 | Room 自有调度器（未采用） |
| pause 语义 | future-dispatch pause | 不 kill running | 冻结 OS 进程（未采用） |
| running 换人 | cancel + new Attempt | 热换需新进程协议 | 运行中热换（未采用） |
| 控制粒度 | 只调整未开始节点 | v0.3 风险可控 | 未来另开阶段 Room |
| F008 T041b 未落地则 F011 阻塞（风险） | 显式依赖并复用 classifier | 避免资格判断漂移 | F011 不得复制 `startNextQueuedRun()` |
| Thread/Room 双向归属（风险） | 每次读取断言一致，不一致 `ROOM_THREAD_LINK_INVALID` | 防止两侧漂移 | 无 |

## 10. 待确认设计问题

- [x] DQ-001: Room 的定位？ - 决策：Room=control/projection boundary，不拥有独立执行生命周期。
- [x] DQ-002: pause/reassign/create 语义？ - 决策：按第 3-5 节；pause 是 future-dispatch，reassign 需 cancel+new Attempt，create 在 confirm 后原子进行。
- [x] DQ-003: F012 能否改变 Room 控制协议？ - 决策：F012 只能复用成员选择，不得改变这些控制协议。
