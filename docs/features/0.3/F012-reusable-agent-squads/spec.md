---
feature_ids: [F012]
related_features: [F005, F007, F011]
topics: [squad, agent-group, roster, reuse, v0.3]
doc_kind: spec
created: 2026-08-09
updated: 2026-08-09
---

# F012：Reusable Agent Squads

> Status: draft | Owner: TBD | Target: v0.3

## 0. 意图与范围

**一句话意图**：保存 Project 内经常一起使用的 adapter 集合，在 intake/Room 中复用，同时每次执行仍按节点能力重新校验。

范围：创建、编辑、归档 Squad；有序成员与身份快照；intake/Room 选择与一次性覆盖；运行前 eligibility；历史来源追溯。

不做：组织权限、跨 Project 共享、固定 role 真相源、自动评估/学习最佳 Squad、与 Workflow Template 强绑定。

## 1. 用户场景

- **US1（P1）管理 Squad**：用户创建命名 Squad，选择至少一个 adapter，查看成员 availability/capabilities。
- **US2（P1）用于 Room**：创建/调整 Room 时选 Squad；系统把成员映射为逐节点 roster，用户确认覆盖项后执行。
- **US3（P2）用于 intake**：推荐结果展示可覆盖候选 Squad；选择只改变 chosen roster，token 其余只读 premise 不被绕过。
- **US4（P1）处理失效**：成员不可用/能力不足/被删除时，新执行明确阻塞并给出替换候选；历史 Room 仍显示身份快照。

## 2. 需求

- **FR-001**：Squad 属于 Project，包含 name、description、status、revision 和有序成员；同 Project active name 唯一。
- **FR-002**：成员引用 adapter config 并保存 identity snapshot；不能存 role，capability_tags 仍是真相源。
- **FR-003**：编辑采用 revision CAS；已被 Room 使用的历史 snapshot 不随 Squad 改动。
- **FR-004**：应用 Squad 时按 graph node required capabilities 调用 `resolveEligibleAdapter()`；一个 adapter 可覆盖多个节点。
- **FR-005**：映射有歧义或缺口时返回逐节点 candidates/excluded，必须用户确认，不静默选择未确认替代者。
- **FR-006**：active Squad 成员阻止 adapter 删除；归档 Squad 的 FK 可 SET NULL，但 snapshot 保留。
- **FR-007**：归档 Squad 不出现在新选择器中，历史 Room/intake 仍可导航只读摘要。

### Trace / UX / 非功能

- **TR-001**：`squad.created/revised/archived/applied` 记录 revision、成员 ids/snapshots hash、target Room/intake 与 override diff。
- **UX-001**：Settings 提供列表/编辑/availability；intake/Room 提供选择、逐节点映射和阻塞说明。
- **NFR-001**：应用时的校验与 Room/Issue 创建同事务复核；推荐列表读取无副作用。
- **NFR-002**：最多 32 个成员；请求去重；跨 Project adapter 一律 404/拒绝。

## 3. 验收

- [ ] **AC-001**：创建/编辑/归档与 revision conflict 行为正确。
- [ ] **AC-002**：Squad 映射逐节点能力，一个 adapter 可覆盖多个节点。
- [ ] **AC-003**：失效/缺能力成员不被静默使用，响应包含 candidates/excluded。
- [ ] **AC-004**：Squad 更新/归档/adapter 改名不改变历史 Room snapshot。
- [ ] **AC-005**：active 引用删除守卫与 archived SET NULL 均保留可解释历史。
- [ ] **AC-006**：选择 Squad 创建 Room 后，实际 NodeRun 执行者与确认映射一致。

## 4. 测试与决策

- 单元：name/member/CAS、mapping、capability/availability。
- 集成：intake/Room 事务、删除/probe 竞态、history snapshot。
- UI/E2E：管理、选择、override、失效修复。

**已关闭**：Squad 是成员池而非 role/template；能力在使用时判断；F011 Room snapshot 是历史真相源。
