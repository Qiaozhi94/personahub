---
feature_ids: [F011]
related_features: [F006, F007, F008, F009, F010, F012]
topics: [room, human-lead, intervention, graph]
doc_kind: tasks
created: 2026-08-09
updated: 2026-08-09
---

# F011：Work Room & Human Intervention - 任务

> Status: draft | Owner: TBD | Spec: `spec.md` | Design: `design.md`

## Phase 1：模型与创建

- [ ] T001（FR-001）：新增 Room/member/control DTO、状态与事件类型。
- [ ] T002（FR-001/NFR-002）：schema v13 migration 建 work_rooms/room_members/control command 幂等表与 `idx_threads_one_room_thread`；覆盖 v12→v13、已应用版本不可变和双向 Thread/Room 不变量测试。
- [ ] T003（FR-002/NFR-001）：实现 DB-only createRoom；同一事务预生成 room/thread id，写 `threads.room_id` 与 canonical `work_rooms.thread_id`，复核 Thread/Room/Graph 双向归属；不一致返回 `ROOM_THREAD_LINK_INVALID`。
- [ ] T004（FR-002）：接入 F007 confirm，覆盖每个故障点原子回滚、提交前零副作用与 replay。
- [ ] T005（FR-002）：手动创建入口只接受可执行图方案，拒绝套壳任意运行中 Runs。

## Phase 2：Pause、约束与恢复

- [ ] T010（FR-004）：RoomControlService CAS/idempotency 与 pause/resume 状态机。
- [ ] T011（FR-004）：显式依赖并复用 F008 T041b 从 `startNextQueuedRun()` 提取的共享纯 classifier，不得在 F011 重写资格判断；只为绑定本 Room 的 GraphNode 增加 Room gate，普通 implementation/validator/consult 必须跳过。barrier 测试 pause 与 claim 两种完成顺序，并加一条普通 queued Run 不被 pause 误拦截的回归。
- [ ] T012（FR-005）：constraint append/revoke、effective sequence 与 RoomContextAssembler。
- [ ] T013（FR-005）：dispatch 记录实际 applied constraints；queued Attempt 不改 instructions。
- [ ] T014（FR-008）：Graph blocker/terminal → Room 投影与 restart 恢复；paused 意图不可被覆盖。

## Phase 3：成员与换人

- [ ] T020（FR-006/007）：成员 snapshot repository 与 add/remove guard。
- [ ] T021（FR-006）：实现 pending/ready/queued reassign；queued 走完整 cancel/finalize 后建新 Attempt。
- [ ] T022（FR-006）：running reassign 返回明确 409；cancel→retry→reassign 集成测试。
- [ ] T023（FR-006/007）：availability/capability/probe/delete 竞态与 before/after identity trace。

## Phase 4：API/UI/验收

- [ ] T030：实现 Room routes、zod、scope-safe errors 与 control revision conflict。
- [ ] T031：Room 聚合 projection（Graph/members/artifacts/timeline）。
- [ ] T032：Room 页面/Inspector/control bar 与全部状态、错误、影响说明。
- [ ] T033（AC-001~006）：自动化 + restart + SSE replay；回归 F001-F010。
- [ ] T034：真实 CLI 完成 pause→constraint→cancel/reassign→resume→archive。
- [ ] T035：lint/format/typecheck/test/build，回写 spec/BACKLOG/全局文档。

## 依赖关系

- F008 T041b 的共享 queued classifier 与 F010 projection 完成后实施；Phase 1 → 2 → 3 → 4。若 F008 尚未落地，F011 不得自行复制 `startNextQueuedRun()` 判定。
- F012 在 F011 member/reassign contract 冻结后开始。
