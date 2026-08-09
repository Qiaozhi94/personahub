---
kind: feature
id: F012
version: "0.3"
related_features: [F005, F007, F011]
topics: [squad, agent-group, roster, reuse]
doc_kind: tasks
created: 2026-08-09
updated: 2026-08-09
---

# F012：Reusable Agent Squads - 任务

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

不适用：`design.md` 第 10 节待确认设计问题已全部关闭。本 Feature 在 F011 member/reassign contract 冻结后实施（见 §4 依赖）；F011 契约未冻结时不得开始实现。实现任务从 T001 连续编号。

## 2. 实现任务

### Phase 1：Persistence 与管理

- [ ] T001 (`FR-001`, `FR-002`): 新增 Squad DTO、事件、zod 与 name normalization。 - verify: `shared/src/squad/types.ts`
- [ ] T002 (`FR-001`, `FR-002`): schema v14 migration 建 squads/members/index/FK，覆盖 v13->v14 升级与约束；已应用 migration 不得追加。 - verify: `server/tests/integration/migration-v14.test.ts`
- [ ] T003 (`FR-001`, `FR-003`): Repository/Service create/list/detail/CAS edit/archive。 - verify: `server/tests/integration/squad-crud-cas.test.ts`
- [ ] T004 (`FR-002`, `NFR-002`): 成员去重、32 上限、Project scope、identity secret-safe snapshot。 - verify: `server/tests/integration/squad-members.test.ts`
- [ ] T005 (`FR-006`): adapter delete active guard、archived SET NULL 与历史显示测试。 - verify: `server/tests/integration/squad-adapter-delete-guard.test.ts`

### Phase 2：Roster mapping

- [ ] T010 (`FR-004`, `FR-005`): 实现 mapSquadToGraphRoster，复用 resolveEligibleAdapter。 - verify: `server/tests/unit/squad-roster-mapping.test.ts`
- [ ] T011 (`FR-004`): 覆盖单 adapter 多节点、稳定 position、多候选、零候选。 - verify: `server/tests/unit/squad-roster-mapping.test.ts`
- [ ] T012 (`FR-005`): override 校验与逐节点 candidates/excluded，不静默替换。 - verify: `server/tests/integration/squad-failure-candidates.test.ts`
- [ ] T013 (`NFR-001`): preview 只读性；confirm 时 revision/status/member/availability 全部复核。 - verify: `server/tests/integration/squad-preview-confirm.test.ts`

### Phase 3：F007/F011 集成

- [ ] T020 (`US-003`): intake response/token/chosen roster 加 squad metadata 与 stale 测试。 - verify: `server/tests/integration/intake-squad.test.ts`
- [ ] T021 (`US-002`, `FR-003`): DB-only applySquadToRoom 写 member/source snapshot，不传播未来修改。 - verify: `server/tests/integration/squad-apply-room.test.ts`
- [ ] T022 (`US-002`): Room reapply 走 control revision 与 reassign guard，覆盖 running 拒绝。 - verify: `server/tests/integration/squad-room-reapply.test.ts`
- [ ] T023 (`TR-001`): admin audit + room applied events，secret-safe payload 和事务故障。 - verify: `server/tests/integration/squad-events.test.ts`

### Phase 4：UI

- [ ] T030 (`UX-001`): Settings Squad list/editor/archive、availability/capability 投影。 - verify: `web/src/squad/settings.test.tsx`
- [ ] T031 (`UX-001`): intake/Room Squad selector、逐节点 mapping、override/blocked/stale 状态。 - verify: `web/src/squad/selector.test.tsx`

## 3. 验证与验收任务

- [ ] T032 (`AC-001`, `AC-002`, `AC-003`, `AC-004`, `AC-005`, `AC-006`): API/UI/E2E、并发与历史 snapshot 全部通过。 - verify: `npm test`
- [ ] T033 (`AC-003`, `AC-006`): 真实 CLI 用 Squad 创建 Room，失效一个成员后完成替换再执行。 - verify: 真实 CLI 环境手动验证
- [ ] T034 (`AC-001`, `AC-002`, `AC-003`, `AC-004`, `AC-005`, `AC-006`): F001-F011 回归 + lint/format/typecheck/test/build；回写文档与 BACKLOG。 - verify: `npm run lint && npm run format:check && npm run typecheck && npm test && npm run build`

## 4. 依赖与并行关系

- F011 member/reassign contract 冻结后实施；`T001` -> `T010` -> `T020` -> `T030`：主链按序推进。
- `T020` 与 `T021` 在 `T010`-`T013` 后可并行，原因是修改不同文件且无共享状态。
- UI（`T030`/`T031`）依赖 `T020`/`T021` 的 API 与 mapping 契约。
- `T030` -> `T032` -> `T033` -> `T034`：验收链按序推进。

## 5. 明确后移

- 组织/权限、跨 Project Squad -> 后续版本：不在本切片范围。
- 自动学习/评估最佳 Squad -> 后续版本：按 PRD 排期。
- Agent Team Template 与 Workflow Template 的强绑定 -> 后续版本：不在本切片范围。
