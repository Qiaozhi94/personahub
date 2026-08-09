---
kind: feature
id: F012
version: "0.3"
status: draft
gate_version: 1
related_features: [F005, F007, F011]
topics: [squad, agent-group, roster, reuse, v0.3]
doc_kind: spec
created: 2026-08-09
updated: 2026-08-09
---

# F012：Reusable Agent Squads

> Owner: TBD | Target: v0.3

## 0. 来源与意图

- **PRD 来源**：`docs/personahub-prd.md` 第 5 节 Squad、第 15 节 v0.3。
- **架构来源**：`docs/personahub-architecture.md` Adapter/Agent 章节。
- **系统设计 / Research / Contract 来源**：`docs/personahub-system-design.md` Squad 草案；F005 capability_tags、F007 intake roster、F011 Room member snapshot。
- **上游决策**：v0.3 评审决策 Q5（Squad 不绑定 capability role，仅保存成员与说明），见 `docs/features/0.3/README.md` 第 6 节。
- **功能类型**：data-model / backend / ui。
- **规格模式**：full。
- **变更类型**：ADDED。
- **一句话意图**：保存 Project 内经常一起使用的 adapter 集合，在 intake/Room 中复用，同时每次执行仍按节点能力重新校验。

## 1. 问题、目标与非目标

### 问题

反复使用的 adapter 组合每次创建 Room 或确认推荐时都要手动重建，缺乏保存与复用机制；同时若把分组当成永远可执行的部署单元，会在 adapter 失效时静默替换或失败。

### 目标

把反复使用的 adapter 组合保存为静态分组，在 intake/Room 中复用，同时每次执行仍按节点能力重新校验。Feature 完成后，用户能创建 Squad 并在 Room/推荐确认时选用；adapter 失效后历史 Room 仍可解释，新 Room 明确阻塞或要求用户替换。

### 非目标

- 本 feature 不引入组织/权限、跨 Project Squad 共享。
- 本 feature 不固定 capability role 真相源（capability_tags 仍是 F005 真相源）。
- 本 feature 不自动评估/学习最佳 Squad，不与 Workflow Template 强绑定。

## 2. 用户场景

每个用户场景都应该能独立交付价值，并能独立验证。按优先级排序，确保只完成 P1 时也能形成一个有意义的最小切片。

### US-001：管理 Squad（Priority: P1）

作为 `Human Lead`，我希望 `创建命名 Squad，选择至少一个 adapter，查看成员 availability/capabilities`，以便 `保存常用的 adapter 组合`。

**为什么是这个优先级**：Squad 持久化是复用的前提，无它后续场景无法成立。

**独立测试**：创建/编辑/归档 Squad，断言 revision conflict 行为正确。

**验收场景**：

1. Given `一个 Project`，when `用户创建 Squad 并选择 adapter`，then `Squad 保存有序成员与 identity snapshot`。
2. Given `同名 active Squad 已存在`，when `再次创建`，then `拒绝并提示冲突`。

### US-002：用于 Room（Priority: P1）

作为 `Human Lead`，我希望 `创建/调整 Room 时选 Squad，系统把成员映射为逐节点 roster，用户确认覆盖项后执行`，以便 `快速组建协作现场`。

**为什么是这个优先级**：Room 复用是 Squad 的核心使用入口，与 US-001 同属最小价值切片。

**独立测试**：选 Squad 创建 Room，断言实际 NodeRun 执行者与确认映射一致。

**验收场景**：

1. Given `一个 Squad 与可执行图方案`，when `用户选 Squad 创建 Room`，then `成员映射为逐节点 roster，用户确认覆盖项后执行`。
2. Given `Squad 被编辑`，when `查看历史 Room`，then `历史 Room snapshot 不变`。

### US-003：用于 intake（Priority: P2）

作为 `Human Lead`，我希望 `推荐结果展示可覆盖候选 Squad，选择只改变 chosen roster`，以便 `不绕过 token 其余只读 premise`。

**为什么是这个优先级**：intake 复用依赖 Squad 持久化与 Room 映射先稳定。

**独立测试**：推荐时展示候选 Squad，选择后断言只改 chosen roster，token premise 不被绕过。

**验收场景**：

1. Given `F007 推荐结果`，when `展示并选择候选 Squad`，then `只改变 chosen roster，token 其余只读 premise 不被绕过`。

### US-004：处理失效（Priority: P1）

作为 `Human Lead`，我希望 `成员不可用/能力不足/被删除时新执行明确阻塞并给出替换候选，历史 Room 仍显示身份快照`，以便 `不静默替换失效成员`。

**为什么是这个优先级**：失效处理是 Squad 不被误当成部署单元的关键保障。

**独立测试**：使一个 adapter 失效，断言新 Room 阻塞并给出候选，历史 Room 仍显示快照。

**验收场景**：

1. Given `Squad 成员 adapter 失效`，when `用它创建新 Room`，then `明确阻塞并给出替换候选，不静默替换`。
2. Given `历史 Room 引用已失效 adapter`，when `查看历史 Room`，then `仍显示 identity snapshot`。

## 3. 范围与边界

### 范围内

- Project 内创建、重命名、归档 Squad；成员引用 adapter config，可附显示名称和用途说明。
- Room 创建/调整成员和 Coordinator 确认界面可选择 Squad，也可在本次请求中覆盖成员。
- 使用 Squad 时保存成员快照；adapter 后续改名、失效或删除不篡改历史 Room。
- 执行前仍按 workspace availability 与 capability tags 逐节点校验；失效成员给出候选和阻塞原因。

### 范围外

- 组织/权限、跨 Project Squad。
- 自动学习最佳 Squad。
- Agent Team Template 与 Workflow Template 的强绑定。
- 固定 capability role 真相源。

### 边界场景

- 当 adapter 在 Squad 引用期间被删除时会发生什么？active Squad 成员阻止删除；归档 Squad 的 FK 可 SET NULL，但 snapshot 保留。
- 如果 Squad 映射有歧义或缺口，系统应如何处理？返回逐节点 candidates/excluded，必须用户确认，不静默选择未确认替代者。
- 在 Squad 编辑后，哪些事情绝不能发生？不传播到已被 Room 使用的历史 snapshot。

## 4. 需求

使用稳定 ID，方便 design、tasks、code review 和 tests 引用。

### 功能需求

- **FR-001**：Squad 属于 Project，包含 name、description、status、revision 和有序成员；同 Project active name 唯一。
- **FR-002**：成员引用 adapter config 并保存 identity snapshot；不能存 role，capability_tags 仍是真相源。
- **FR-003**：编辑采用 revision CAS；已被 Room 使用的历史 snapshot 不随 Squad 改动。
- **FR-004**：应用 Squad 时按 graph node required capabilities 调用 `resolveEligibleAdapter()`；一个 adapter 可覆盖多个节点。
- **FR-005**：映射有歧义或缺口时返回逐节点 candidates/excluded，必须用户确认，不静默选择未确认替代者。
- **FR-006**：active Squad 成员阻止 adapter 删除；归档 Squad 的 FK 可 SET NULL，但 snapshot 保留。
- **FR-007**：归档 Squad 不出现在新选择器中，历史 Room/intake 仍可导航只读摘要。

### 事件 / Trace 需求

- **TR-001**：`squad.created/revised/archived/applied` 记录 revision、成员 ids/snapshots hash、target Room/intake 与 override diff。

### UX 需求

- **UX-001**：Settings 提供列表/编辑/availability；intake/Room 提供选择、逐节点映射和阻塞说明。

### 非功能需求

- **NFR-001**：可靠性 / 恢复：应用时的校验与 Room/Issue 创建同事务复核；推荐列表读取无副作用。
- **NFR-002**：兼容性：最多 32 个成员；请求去重；跨 Project adapter 一律 404/拒绝。

## 5. 生命周期与不变量

```text
active --edit (revision CAS)--> active
active --archive--> archived（终态，不可编辑/应用）
```

不变量：

- archived Squad 不可编辑/应用，不出现在新选择器中（FR-007）。
- 同 Project active name 唯一（FR-001）。
- 成员只引用 adapter config + identity snapshot，不存 role；capability_tags 仍是真相源（FR-002）。
- 已被 Room 使用的历史 snapshot 不随 Squad 改动（FR-003）。
- active Squad 成员阻止 adapter 删除；归档后 FK SET NULL 但 snapshot 保留（FR-006）。

## 6. 成功与验收

### 成功标准

- **SC-001**：用户能创建/复用 Squad，并在 Room/推荐确认时选用；执行前重新校验成员。
- **SC-002**：adapter 失效后历史 Room 仍可解释，新 Room 明确阻塞或要求用户替换。
- **SC-003**：Squad 是成员池而非 role/template；能力在使用时通过 capability_tags 判断。

### 验收清单

验收清单每项引用第 4 节真实存在的需求 ID。本 Feature 处于 `draft`，`tests:` 路径暂缺，进入 `review` 前回填。

- [ ] **AC-001** (`FR-003`): 创建/编辑/归档与 revision conflict 行为正确。
- [ ] **AC-002** (`FR-004`): Squad 映射逐节点能力，一个 adapter 可覆盖多个节点。
- [ ] **AC-003** (`FR-005`): 失效/缺能力成员不被静默使用，响应包含 candidates/excluded。
- [ ] **AC-004** (`FR-003`, `FR-007`): Squad 更新/归档/adapter 改名不改变历史 Room snapshot。
- [ ] **AC-005** (`FR-006`, `FR-007`): active 引用删除守卫与 archived SET NULL 均保留可解释历史。
- [ ] **AC-006** (`FR-004`, `FR-005`): 选择 Squad 创建 Room 后，实际 NodeRun 执行者与确认映射一致。

## 7. 测试、依赖与决策

### 测试策略

- 单元测试：name/member/CAS、mapping、capability/availability。
- 集成测试：intake/Room 事务、删除/probe 竞态、history snapshot。
- UI / E2E：管理、选择、override、失效修复。
- 真实环境 / 手动验证：真实 CLI 用 Squad 创建 Room，失效一个成员后完成替换再执行。

### 依赖

- 上游 Feature / Contract：F005 capability_tags、F007 intake roster、F011 Room member snapshot/reassign contract。
- 下游消费者：无；Squad 是终端复用单元。
- 外部 / 环境依赖：无特殊环境依赖。

### 决策与风险

| 决策 / 风险 | 结论或缓解 | 理由 | 后续 |
|---|---|---|---|
| Squad 只存成员，不存 role | capability_tags 是 F005 真相源 | 能力在使用时判断 | 不固定 role |
| current Squad 可变，Room 存 snapshot | 复用易用且历史稳定 | 历史 Room 不漂移 | 不传播编辑 |
| preview 只读、confirm 复核 | 与 F007 零副作用/防 stale 契约一致 | 防 stale | 无 |
| F011 契约未冻结则 F012 阻塞（风险） | 在 F011 member/reassign contract 冻结后实施 | 避免契约漂移 | 无 |

## 8. 待确认问题

- [x] Q-001: Squad 是否绑定 capability role？ - 决策：Squad 是成员池而非 role/template；capability_tags 仍是真相源，能力在使用时判断。
- [x] Q-002: 历史 Room 成员如何保证稳定？ - 决策：F011 Room snapshot 是历史真相源；Squad 编辑不传播到历史 Room。
