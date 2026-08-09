---
feature_ids: [F012]
related_features: [F005, F007, F011]
topics: [squad, agent-group, roster, reuse]
doc_kind: tasks
created: 2026-08-09
updated: 2026-08-09
---

# F012：Reusable Agent Squads - 任务

> Status: draft | Owner: TBD | Spec: `spec.md` | Design: `design.md`

## Phase 1：Persistence 与管理

- [ ] T001（FR-001/002）：新增 Squad DTO、事件、zod 与 name normalization。
- [ ] T002（FR-001/002）：schema v14 migration 建 squads/members/index/FK，覆盖 v13→v14 升级与约束；已应用 migration 不得追加。
- [ ] T003（FR-001/003）：Repository/Service create/list/detail/CAS edit/archive。
- [ ] T004（FR-002/NFR-002）：成员去重、32 上限、Project scope、identity secret-safe snapshot。
- [ ] T005（FR-006）：adapter delete active guard、archived SET NULL 与历史显示测试。

## Phase 2：Roster mapping

- [ ] T010（FR-004/005）：实现 mapSquadToGraphRoster，复用 resolveEligibleAdapter。
- [ ] T011（FR-004）：覆盖单 adapter 多节点、稳定 position、多候选、零候选。
- [ ] T012（FR-005）：override 校验与逐节点 candidates/excluded，不静默替换。
- [ ] T013（NFR-001）：preview 只读性；confirm 时 revision/status/member/availability 全部复核。

## Phase 3：F007/F011 集成

- [ ] T020（US3）：intake response/token/chosen roster 加 squad metadata 与 stale 测试。
- [ ] T021（US2/FR-003）：DB-only applySquadToRoom 写 member/source snapshot，不传播未来修改。
- [ ] T022（US2）：Room reapply 走 control revision 与 reassign guard，覆盖 running 拒绝。
- [ ] T023（TR-001）：admin audit + room applied events，secret-safe payload 和事务故障。

## Phase 4：UI 与验收

- [ ] T030：Settings Squad list/editor/archive、availability/capability 投影。
- [ ] T031：intake/Room Squad selector、逐节点 mapping、override/blocked/stale 状态。
- [ ] T032（AC-001~006）：API/UI/E2E、并发与历史 snapshot 全部通过。
- [ ] T033：真实 CLI 用 Squad 创建 Room，失效一个成员后完成替换再执行。
- [ ] T034：F001-F011 回归 + lint/format/typecheck/test/build；回写文档与 BACKLOG。

## 依赖关系

- F011 member/reassign contract 冻结后实施；Phase 1 → 2 → 3 → 4。
- T020 与 T021 在 T010-T013 后可并行。
