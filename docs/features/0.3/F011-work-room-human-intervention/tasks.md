---
kind: feature
id: F011
version: "0.3"
related_features: [F006, F007, F008, F009, F010, F012]
topics: [room, human-lead, intervention, graph]
doc_kind: tasks
created: 2026-08-09
updated: 2026-08-09
---

# F011：Work Room & Human Intervention - 任务

> Owner: TBD | Spec: `spec.md` | Design: `design.md`

## 0. 来源与执行规则

- 行为与验收真相源：`spec.md`。
- 技术方案与边界：`design.md`。
- 每项任务只描述一个可验证动作，并引用合法的 US/需求/AC ID。
- 完成且验证后立即把 `[ ]` 改为 `[x]`，不得最后统一补勾。
- `[P]` 只用于修改不同文件、没有显式前置依赖且不会争用同一状态的任务。
- 实现中若任务顺序或契约失效，先修订三件套，再继续编码。

统一任务格式：

```markdown
- [ ] T001 [P] (`US-001`, `FR-001`, `AC-001`): <一个可验证动作> - verify: `path/to/test.ts`
```

## 1. 前置条件

不适用：`design.md` 第 10 节待确认设计问题已全部关闭。本 Feature 实施前需确认 F008 T041b 共享 queued classifier 与 F010 统一 projection 已落地（见 §4 依赖）；这两项不属本 Feature 任务，但其未落地时不得开始 Phase 2。实现任务从 T001 连续编号。

## 2. 实现任务

### Phase 1：模型与创建

- [ ] T001 (`FR-001`): 新增 Room/member/control DTO、状态与事件类型。 - verify: `shared/src/room/types.ts`
- [ ] T002 (`FR-001`, `NFR-002`): schema v13 migration 建 work_rooms/room_members/control command 幂等表与 `idx_threads_one_room_thread`；覆盖 v12->v13、已应用版本不可变和双向 Thread/Room 不变量测试。 - verify: `server/tests/integration/migration-v13.test.ts`
- [ ] T003 (`FR-002`, `NFR-001`): 实现 DB-only createRoom；同一事务预生成 room/thread id，写 `threads.room_id` 与 canonical `work_rooms.thread_id`，复核 Thread/Room/Graph 双向归属；不一致返回 `ROOM_THREAD_LINK_INVALID`。 - verify: `server/tests/integration/room-create-atomicity.test.ts`
- [ ] T004 (`FR-002`): 接入 F007 confirm，覆盖每个故障点原子回滚、提交前零副作用与 replay。 - verify: `server/tests/integration/room-confirm-atomicity.test.ts`
- [ ] T005 (`FR-002`): 手动创建入口只接受可执行图方案，拒绝套壳任意运行中 Runs。 - verify: `server/tests/integration/room-manual-create.test.ts`

### Phase 2：Pause、约束与恢复

- [ ] T010 (`FR-004`): RoomControlService CAS/idempotency 与 pause/resume 状态机。 - verify: `server/tests/integration/room-pause-resume.test.ts`
- [ ] T011 (`FR-004`): 显式依赖并复用 F008 T041b 从 `startNextQueuedRun()` 提取的共享纯 classifier，不得在 F011 重写资格判断；只为绑定本 Room 的 GraphNode 增加 Room gate，普通 implementation/validator/consult 必须跳过。barrier 测试 pause 与 claim 两种完成顺序，并加一条普通 queued Run 不被 pause 误拦截的回归。 - verify: `server/tests/integration/room-pause-barrier.test.ts`
- [ ] T012 (`FR-005`): constraint append/revoke、effective sequence 与 RoomContextAssembler。 - verify: `server/tests/integration/room-constraint-sequence.test.ts`
- [ ] T013 (`FR-005`): dispatch 记录实际 applied constraints；queued Attempt 不改 instructions。 - verify: `server/tests/integration/room-constraint-dispatch.test.ts`
- [ ] T014 (`FR-008`): Graph blocker/terminal -> Room 投影与 restart 恢复；paused 意图不可被覆盖。 - verify: `server/tests/integration/room-projection-restart.test.ts`

### Phase 3：成员与换人

- [ ] T020 (`FR-006`, `FR-007`): 成员 snapshot repository 与 add/remove guard。 - verify: `server/tests/integration/room-member-snapshot.test.ts`
- [ ] T021 (`FR-006`): 实现 pending/ready/queued reassign；queued 走完整 cancel/finalize 后建新 Attempt。 - verify: `server/tests/integration/room-reassign.test.ts`
- [ ] T022 (`FR-006`): running reassign 返回明确 409；cancel->retry->reassign 集成测试。 - verify: `server/tests/integration/room-reassign-running.test.ts`
- [ ] T023 (`FR-006`, `FR-007`): availability/capability/probe/delete 竞态与 before/after identity trace。 - verify: `server/tests/integration/room-reassign-availability.test.ts`

### Phase 4：API/UI/Projection

- [ ] T030 (`FR-002`, `FR-004`, `FR-006`, `FR-008`): 实现 Room routes、zod、scope-safe errors 与 control revision conflict。 - verify: `server/tests/integration/room-routes.test.ts`
- [ ] T031 (`FR-003`): Room 聚合 projection（Graph/members/artifacts/timeline）。 - verify: `server/tests/integration/room-projection.test.ts`
- [ ] T032 (`UX-001`): Room 页面/Inspector/control bar 与全部状态、错误、影响说明。 - verify: `web/src/room/room-page.test.tsx`

## 3. 验证与验收任务

- [ ] T033 (`AC-001`, `AC-002`, `AC-003`, `AC-004`, `AC-005`, `AC-006`): 自动化 + restart + SSE replay；回归 F001-F010。 - verify: `npm test`
- [ ] T034 (`AC-002`, `AC-003`, `AC-004`, `AC-006`): 真实 CLI 完成 pause->constraint->cancel/reassign->resume->archive。 - verify: 真实 CLI 环境手动验证
- [ ] T035 (`AC-001`, `AC-002`, `AC-003`, `AC-004`, `AC-005`, `AC-006`): lint/format/typecheck/test/build，回写 spec/BACKLOG/全局文档。 - verify: `npm run lint && npm run format:check && npm run typecheck && npm test && npm run build`

## 4. 依赖与并行关系

- F008 T041b 的共享 queued classifier 与 F010 projection 完成后实施；`T001` -> `T010` -> `T020` -> `T030`：主链按序推进。
- 若 F008 尚未落地，F011 不得自行复制 `startNextQueuedRun()` 判定（见 `T011`）。
- `T012` 与 `T020` 在 `T010` 完成后可并行，原因是修改不同文件且无共享状态。
- UI（`T032`）依赖 `T030`/`T031` 的 routes/projection。
- `T030` -> `T033` -> `T034` -> `T035`：验收链按序推进。
- F012 在 F011 member/reassign contract 冻结后开始。

## 5. 明确后移

- 可复用 Squad -> `F012`：本 Feature 只冻结成员选择与 reassign 契约，不实现 Squad 持久化。
- 控制图完成后 primary Thread 普通 implementation/validation Run -> 未来阶段 Room：v0.3 的 Room 只控制 `orchestrator_subagent` Graph 阶段。
- 跨 Issue Room、多人权限、语音/视频 -> 后续版本：不在本切片范围。
