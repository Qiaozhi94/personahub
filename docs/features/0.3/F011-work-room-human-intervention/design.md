---
feature_ids: [F011]
related_features: [F006, F007, F008, F009, F010, F012]
topics: [room, human-lead, intervention, graph]
doc_kind: design
created: 2026-08-09
updated: 2026-08-09
---

# F011：Work Room & Human Intervention - 设计

> Status: draft | Owner: TBD | Spec: `spec.md`

## 1. 技术概要

F011 固定使用 schema v13（F008=v10、F009=v11、F010=v12）。新增 DB-only `createRoom(tx, ...)`、`RoomControlService`、`RoomProjectionService`、`RoomContextAssembler`。Room 绑定一个 GraphRun 和专属 Thread；Graph/Run 继续执行，Room 只提供该 Graph 阶段的 policy gate、成员/约束历史与聚合 UI。若 migration 落地前实施顺序改变，整体重新编号；已应用版本永不修改或追加。

## 2. Migration

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

`work_rooms.thread_id` 是 Room→Thread 的 canonical relation；遗留的 `threads.room_id` 是 Thread→Room 的必填反向导航字段，不再保持 NULL。创建 Room Thread 时必须把预生成的 room id 写入 `threads.room_id`，随后插入 `work_rooms.thread_id`，两者与 Graph 在同一外层事务提交；`idx_threads_one_room_thread` 保证一个 Room 至多一个专属 Thread。Repository/Projection 每次读取都断言 `work_rooms.thread_id = thread.id` 且 `thread.room_id = work_rooms.id`，不一致视为 `ROOM_THREAD_LINK_INVALID`，不得静默选择一侧。现有 `ThreadRepository.create()` 需增加受限的 `room_id` 入参路径，普通 primary Thread 继续写 NULL。Graph 反查只使用 `work_rooms.graph_run_id`，不在 `graph_runs` 再存第二个 room 指针。每个非终态 Graph 至多一个 Room 由 unique graph_run_id 保证。

## 3. 创建原子性

F007 confirm 的 graph 分支在同一外层 transaction 内：创建 Issue/primary Thread → 生成 room/room-thread ids → 插 room Thread → `createGraph(...)` → `createRoom(...)` → confirmation claim/events。所有 event 先缓冲，commit 后 broadcast/drain。推荐阶段仍零写入；sequential 不自动建 Room。

手动创建复用同一 DB-only primitives，要求 Issue 尚无非终态 graph；不允许把 Room 套在任意已有运行中的 Run 集合上。

## 4. Control revision 与 gate

所有命令带 `expected_control_revision` 和 `idempotency_key`；`room_control_commands(room_id,idempotency_key,response_json)` 可与 F007 confirmation 同型实现幂等。更新用 CAS。

F011 不假设当前代码已经存在 `queuedRunEligibility()`。共享 classifier 的提取由前置 F008 `tasks.md` T041b 拥有：它从 `RunDispatchService.startNextQueuedRun()` 抽出无副作用的 queued Run 资格判定，drain 与 health 共用。F011 必须等待该任务落地后复用其实际导出，不得复制一份判断；然后在 classifier/dispatch policy 上增加 Room gate，并且仅当 `run.role=GraphNode`、`run.node_run_id` 所属 Graph 绑定该 Room 时检查 Room 状态。paused 返回 `waiting_for_room_resume`，cancelling/archived 返回终态拒绝；普通 implementation/validator/consult Run 明确跳过该 gate。pause 提交后不 kill running；resume 提交后对 Graph workspace 幂等 `drainWorkspace()`。

constraint 事件 payload 保存 `{constraint_id,text,effective_after_event_sequence,status}`；不得改 `runs.instructions`。Run 真正 dispatch 前，`RoomContextAssembler` 读取 effective active constraints，作为独立 context section 注入并记录 `room.constraints_applied` refs。撤销同样追加事件，只影响未来 dispatch。

## 5. Reassign 协议

1. 事务内读取 Room/Graph/NodeRun/active Attempt 与 control revision。
2. running Attempt → 409 `ROOM_RUNNING_NODE_REASSIGN_REQUIRES_CANCEL`。
3. queued Attempt → 先走既有 cancelQueued/finalize 语义，不能只改 assigned id；pending/ready 无 Attempt可直接改。
4. `resolveEligibleAdapter()` 复核 Project/workspace/capability；更新 NodeRun assigned id 和成员快照，创建新 queued Attempt（若 join 已满足）。
5. 写 executor_reassigned 事件；commit 后 drain。

成员移除若仍被未终态节点引用，必须同时提交 replacement mapping；否则 409。历史 Run.adapter_identity 永不修改。

## 6. API 与 UI

| Route                                         | 行为                                       |
| --------------------------------------------- | ------------------------------------------ |
| `GET /api/issues/:issueId/rooms`              | Room summaries                             |
| `POST /api/issues/:issueId/rooms`             | 手动创建                                   |
| `GET /api/rooms/:id`                          | 聚合 Room/Graph/members/artifacts/timeline |
| `POST /api/rooms/:id/pause                    | resume`                                    | control command |
| `POST /api/rooms/:id/constraints`             | 追加/撤销约束                              |
| `POST /api/rooms/:id/nodes/:nodeKey/reassign` | 换执行者                                   |
| `POST /api/rooms/:id/archive`                 | 仅合法终态/取消后                          |

页面中部 Room timeline，右侧 Inspector 为 members/contracts/artifacts。控制条始终说明“暂停后续派工，不会停止当前进程”；running 节点换人提供 cancel 入口但不自动执行两步破坏动作。

## 7. 事件、恢复与测试

事件 payload 必含 room_id/control_revision/idempotency_key/actor(local_user)；成员和 executor 事件含 before/after identity snapshot 与 reason。启动恢复：从 Graph 真相重算 Room blocked/completed 投影；paused 保留；running Attempt interrupted 仍走 F006 恢复。

测试：双 pause/resume、pause 与 queued claim barrier、reassign 与 adapter probe/delete、confirm 故障、restart、SSE replay、UI exhaustive control errors、真实 CLI 全旅程。

## 8. 待确认设计问题

全部关闭：Room=control/projection boundary；pause/reassign/create 语义按第 3–5 节。F012 只能复用成员选择，不得改变这些控制协议。
