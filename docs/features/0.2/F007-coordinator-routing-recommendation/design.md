---
feature_ids: [F007]
related_features: [F005, F006]
topics: [coordinator, routing-recommendation, explainability]
doc_kind: design
created: 2026-08-01
updated: 2026-08-01
---

# F007：Coordinator Agent & Routing Recommendation - 设计

> Status: ready-for-development | Owner: TBD | Spec: `spec.md`

## 1. 技术概要

新增一个**纯函数式**的 `RoutingRecommendationService`：读 Project / workspace / adapter 注册表，按显式规则集算出推荐，返回带解释的结构，不写任何库。确认走独立的 `IntakeService.confirm()`，复用既有 `IssueService.create()` 与 `RunDispatchService.dispatch()`，不新建执行路径。

推荐本身仍是纯内存计算。但**确认需要一张小表**：`recommendation_id` 必须可被服务端独立重建与认领，否则既做不到幂等，也没法在确认时验证用户改选的值（第 5、6 节）。初稿"无新表"的说法据此修正。

```sql
CREATE TABLE intake_confirmations (
  recommendation_id TEXT PRIMARY KEY,   -- 前提集合的规范化哈希
  project_id TEXT NOT NULL REFERENCES projects(id),
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  premise_json TEXT NOT NULL,           -- 签发时的前提集合，确认时读回比对
  recommended_json TEXT NOT NULL,       -- 签发时的推荐值
  issue_id TEXT,                        -- 认领后回填；非空即已确认
  graph_run_id TEXT,
  created_at TEXT NOT NULL,
  confirmed_at TEXT
);
```

`recommendation_id` 作主键即认领的唯一键：重复确认撞主键 → 返回既有 `issue_id`。

**schema 版本号按落地顺序取**：实施顺序为 F006 → F007，故 F007 用 `schema-v9.ts`。若顺序改变则按实际落地先后顺延——**绝不追加进任何已应用的版本**（F005 的 `availability_revision` 教训）。

## 2. 影响面

- **后端 service**：新增 `RoutingRecommendationService`（纯计算）、`IntakeService`（确认落地）。
- **存储**：新增 `intake_confirmations` 一张表（`schema-v9.ts`）。初稿声称"无 schema 变更"，因幂等与前提复建的需要修正。
- **API**：`POST /api/projects/:id/intake/recommend`、`POST /api/projects/:id/intake/confirm`。
- **前端**：新增 Intake 入口与推荐结果面板；现有 `CreateIssueDialog` 保留为手工路径。
- **不影响**：`IssueService.create()` 签名、`resolveAdapter()`、F004 validation、F006 图运行时。

## 3. 规则集与解释模型

每条推荐统一形状：

```ts
interface Recommendation<T> {
  value: T;
  rule: string;                                    // 命中的规则名
  candidates: T[];                                 // 全部候选
  excluded: { id: string; reason: string }[];      // 被排除项与原因
}
```

| 维度 | 规则 | v0.2 候选集 |
|---|---|---|
| `issue_type` | `single_active_issue_type` | `{coding}`，大小 1 |
| `workflow_template` | `active_template_for_issue_type` | `{wft_coding_default}`，大小 1 |
| `collaboration_topology` | `multi_perspective_keyword` 命中 → `orchestrator_subagent`，否则 `sequential` | 2 |
| `agent_roster` | `capability_match_and_effective_availability` | 按 workspace 实际可用 adapter |

`issue_type` 与 `workflow_template` 候选集当前为 1，规则仍显式实现并返回 `candidates`——这样 v0.3 增加类型时规则形状不变，只是候选集变大。

**关键词规则必须诚实标注**：`multi_perspective_keyword` 是关键词匹配，不是语义判断。UI 与事件文案统一用"命中规则 X"，不得写成"系统理解到你需要…"。

`agent_roster` 的可用性一律经 `effectiveAdapterStatus()`（schema v7 的 workspace 级覆盖）判定，与 `resolveAdapter()` 同源；Project 级 Available 但当前 workspace 被覆盖为 Unavailable 的 adapter 必须出现在 `excluded` 并注明是 workspace 级原因——这正是 US2 的独立测试要断言的行为。

### Issue 字段的确定性规则（初稿缺失，已补）

spec 承诺产出"Issue 字段 + workflow + topology + roster"四部分，但初稿的规则表只定义了 `issue_type`，title/goal/priority 全无规则。不同实现都能声称满足 AC-001 却产出不同的 Issue。补一个 `IssueDraft` 契约：

| 字段 | 规则 | 说明 |
|---|---|---|
| `title` | `derive_title_from_first_line` | 取目标文本首个非空行，折叠连续空白，超过 120 字符按字符截断并加省略号 |
| `goal` | `preserve_goal_verbatim` | **原文保留**，仅去除首尾空白；不做任何改写 |
| `priority` | `default_priority` | 固定取既有默认值，v0.2 不推断优先级 |
| `labels` | — | v0.2 不产出 |

- 每个字段同样以 `Recommendation<T>` 形状返回（`candidates` 为单元素），与其余四个维度一致。
- 目标文本上限 **8000 字符**：超出部分不进入关键词匹配，但 `goal` 仍存全文；这是"截断用于匹配、完整存库"的具体数值。
- 边界样例必须逐个有 Given/When/Then：单行短文本、多行文本、纯空白、超长文本、首行为空后续有内容。

## 4. `coordinator_agent_id` 两个既有列的处置（Q3 已关闭）

`projects.default_coordinator_agent_id`（`schema-v1.ts:7`）与 `issues.coordinator_agent_id`（`schema-v1.ts:69`）从 v1 就存在，全仓库无任何读取逻辑，`ProjectRepository.create()` 插入时写死 NULL。

**v0.2 保持两列为 NULL，不写入。** 理由：这两列的类型语义是"指向某个 agent config"，而 v0.2 的 Coordinator 是进程内的规则引擎，没有对应的 agent config 行。为满足列的存在而造一条假的 agent config，会让 Adapter Settings 列表出现一个不能执行、不能验证、状态永远 Unknown 的条目。

这不是遗漏，是明确取舍：等 ADR 0007 的触发条件出现、Coordinator 真的成为一个可配置 agent 时再写入这两列。届时它们仍然可用，无需迁移。

## 5. 推荐失效的判定（Q4 已关闭）

推荐与确认之间存在时间窗，期间用户可能改了 adapter 配置、解绑 workspace、或后台 probe 把某个 adapter 收敛为 Unavailable。

确认接口按**前提快照**复核，而不是重算推荐后比较结果：

```ts
interface RecommendationPremise {
  project_id: string;
  workspace_id: string;
  adapter_effective_status: Record<string, AdapterStatus>;  // 仅推荐中被引用的 adapter
  workflow_template_id: string;
  workflow_template_version: number;
}
```

`recommendation_id` = 该快照的哈希。确认时重新采集同一组前提并比对哈希：

- 一致 → 按用户确认的值创建 Issue 与首个执行单元。
- 不一致 → 返回 `RECOMMENDATION_STALE` 并附上变化项，要求重新推荐。**不静默按新状态执行**（FR-004）。

只快照"推荐中实际引用到的 adapter"，不快照全表——否则一个无关 adapter 的后台 probe 收敛就会让推荐失效。这与 F005 收敛 workspace 环境快照时只比较 `push_credentials_enabled` 是同一教训：快照范围过宽会被无关写误伤。

### 快照必须覆盖用户改选的 adapter（初稿漏洞，已修正）

初稿只快照"推荐**引用到**的 adapter"，但 spec 允许用户在确认前逐项调整。用户换掉推荐的 adapter 时，新选的那个不在快照里——它的可用性完全不受 stale 检查保护，可以在确认瞬间已经不可用而系统照跑不误。这个洞恰好开在"用户手动干预"这条最需要校验的路径上。

因此确认时校验**两组**前提：

1. 原始快照的每一项仍然一致（防止推荐依据变了）。
2. 用户提交的**每一个替换值**按当前状态重新校验（adapter 的 `effectiveAdapterStatus()`、topology 的能力覆盖、模板版本仍 active）。任一不通过即 `RECOMMENDATION_STALE`，附具体是哪一项。

### 确认载荷的规范化

`recommendation_id` 是服务端签发的，服务端必须能凭它独立重建被保护的前提集合，不能依赖客户端回传。因此推荐签发时把前提集合与推荐值一并落在认领记录里（第 6 节的持久化认领顺带承担这件事），确认时读回比对。

哈希只需**规范化序列化**（键排序 + 稳定编码）后取摘要；单机本地应用**不需要 HMAC**——这里防的是过期，不是伪造。但规范化与服务端校验两件事一件都不能省。

## 6. 确认路径

```text
confirm(recommendation_id, 用户最终选择)
  └─ 单事务：
      ├─ 认领 recommendation_id（唯一键；已被认领则返回既有结果，不重复创建）
      ├─ 复核前提快照（含用户改选项）→ 不一致则 RECOMMENDATION_STALE
      ├─ IssueService.create(projectId, {title, goal, priority})   // 既有方法，不改签名
      ├─ 写 ThreadEvent: coordinator.recommendation_applied
      │    payload: { rules[], recommended, chosen, diff[] }        // TR-001
      └─ 按确认的 topology 建首个执行单元（仍在同一事务内）：
           sequential            → 建 queued Run
           orchestrator_subagent → GraphRuntimeService.start(issueId, plan)   // F006，其内部也是单事务
  提交后才实际派工，由既有 drain 驱动。
```

**分流是必须的**：F006 的图节点 Run 使用 `RunRole.GraphNode` 并由 `GraphRuntimeService` 创建；若确认路径无条件走 `RunDispatchService.dispatch()`，推荐出来的 `orchestrator_subagent` 会退化成一个普通的 implementation Run——推荐与实际执行不一致，且该 Run 完成时会触发 F004 的验证循环（见 F006 `design.md` 第 7 节）。

### 幂等与失败原子性

初稿把 `IssueService.create()` 先提交、再写事件、再派工，有两个用户可见的坏结果：双击或 HTTP 重试会建出两个 Issue；中途任一步失败会留下一个永远不会执行的孤儿 Issue + Thread。

采用**最轻的够用方案**：给 `recommendation_id` 一个持久化认领记录（唯一键），确认在单事务内先认领再建实体，实际派工放到提交之后。

- 重复提交同一 `recommendation_id` → 返回首次的结果（Issue id / GraphRun id），不重复建。
- 事务内任一步失败 → 整体回滚，不留孤儿 Issue；客户端可安全重试。
- **不引入通用 command / saga 表**。单机单用户应用不需要那套机制，这与 ADR 0007"候选集为 1 就别上 LLM"是同一种克制。

**adapter 一律走 `resolveAdapter()`**，传入用户确认后的显式 id：`sequential` 经 `dispatch` → `ManualRoutingService`，`orchestrator_subagent` 经 `GraphRuntimeService.start()` 对 `nodeAssignments` 逐项复核（第 7 节）。推荐服务本身只产出候选，绝不写入 `default_adapter_config_id`，也不构造"取第一个可用"的回退——`adapter-resolver.ts` 的文件头注释明确"永不回退到列表里第一个可用 adapter，无法解析的默认值是硬错误"，推荐不得成为绕过它的后门（FR-005）。

`diff[]` 记录推荐值与用户最终选择的差异；用户全盘接受时为空数组。这是 TR-001 要求的可追溯性，也是后续判断规则准不准的唯一数据来源。

## 7. topology 推荐与 F006 的衔接

推荐 `orchestrator_subagent` 时，`value` 携带 F006 的 `definition_id` + `version`（`wgd_coding_dual_review` v1）。

### 降级判据：按能力覆盖，不按 adapter 数量（初稿错误，已修正）

初稿写"若该 definition 所需的**执行者数量**超过当前可用 adapter 数，规则降级为 `sequential`"。这条规则是错的，它把"两个可独立调度的节点"误当成了"需要两个 provider"：

- F006 明确 **Node ≠ Agent**，三个节点统一声明 `Implementation` 能力（`F006/design.md` 第 5 节）。
- F006 的物理执行本来就是**串行**的——三个 Attempt 依次经 workspace FIFO 队列，同一个 adapter 完全可以跑完全部三个节点。

而**单 adapter 恰恰是个人用户的默认安装形态**。按初稿实现，v0.2 的旗舰能力在大多数机器上默认永不启用，理由还是一条虚构的技术约束。

正确判据：**逐节点检查能力覆盖**——definition 里每个节点的 `required_capabilities` 都存在至少一个 workspace 级 Available 的 adapter 即可，允许同一个 adapter 覆盖多个节点。

- 只有当某个节点的能力**无任何** adapter 覆盖时才降级，且 `excluded` 里注明是哪个节点的哪项能力缺执行者。
- 降级必须显式出现在解释里，不能悄悄换 topology（FR-006）。
- 若将来某个 definition 真的需要"视角多样性"（同一能力必须由不同 provider 执行），那是 definition 上的**一等约束**，由 F006 显式声明并自带验收测试，**不能从节点数量反推**。v1 不声明该约束。

### 执行计划必须传给图（初稿错误，已修正）

初稿的确认路径对图分支只调 `GraphRuntimeService.start(issueId)`，而 F006 T022 会在图内部按 `AdapterResolver` **重新解析**每个节点的执行者。后果是 spec US3 的独立测试要求"首个 Run 使用用户确认的 adapter id"对 `orchestrator_subagent` 直接不成立：推荐面板展示的 roster 与实际执行无关，`diff[]` 审计因此记的是假账，且确认与启动之间 adapter 可用性一变就会换人。

改为传入**已确认的执行计划**：

```ts
GraphRuntimeService.start(issueId, {
  definitionId, definitionVersion,
  nodeAssignments: Record<NodeKey, AdapterConfigId>,   // 用户确认的逐节点执行者
  premiseHash,
})
```

- 每个 assignment 在 `start()` 的**同一事务内**经 `resolveAdapter()` 复核；任一不再可用 → 整体拒绝并返回 `RECOMMENDATION_STALE`，不部分启动、不自行替换。
- 该 API 形状是 F006 与 F007 之间的跨 feature 契约，F006 `tasks.md` T021/T022 需按此实现。
- F007 仍**不读写** `graph_runs` / `node_runs`，边界不变：F006 负责图能不能跑、怎么恢复；F007 只负责"这次要不要用图、由谁跑"。

**实施顺序上的约束**：F007 可以先于 F006 完成开发，但 `orchestrator_subagent` 这条确认分支要等带执行计划入参的 `GraphRuntimeService.start()` 存在才能接通。在 F006 落地前，该分支返回明确的"该 topology 尚不可执行"阻塞，而**不是**悄悄回退到 `sequential`——静默回退会让 US1 验收场景 2 表面通过而实际没跑图。

## 8. 边界与失败处理

| 场景 | 行为 |
|---|---|
| 目标文本为空/纯空白 | 400，复用既有 `ISSUE_GOAL_REQUIRED` 语义 |
| 目标文本超长 | 截断用于规则匹配，完整文本存入 `goal`；不报错 |
| Project 未绑定 workspace | 推荐阶段即返回阻塞，不等到确认才失败（既有 `PROJECT_WORKSPACE_REQUIRED`） |
| 无 Available adapter | 阻塞原因 `no_available_adapter` + 建议动作"在 Adapter Settings 中验证适配器" |
| 某节点的 required capability 无任何 adapter 覆盖 | 降级为 `sequential`，`excluded` 注明是哪个节点缺哪项能力。**仅有一个可用 adapter 不构成降级理由**（第 7 节） |
| 用户改选的 adapter 在确认时已不可用 | `RECOMMENDATION_STALE` + 指明该项（第 5 节） |
| 同一 `recommendation_id` 重复确认 | 返回首次结果，不重复创建 Issue（第 6 节） |
| 确认时前提已变 | `RECOMMENDATION_STALE` + 变化项 |

## 9. API 契约的补齐时点

`docs/features/README.md` 要求 design 覆盖 API/contract。本文档目前给出了路由名、错误码（`RECOMMENDATION_STALE`、`no_available_adapter`、`project_workspace_required`）与第 8 节的边界表，但**尚无完整的 recommend/confirm 请求响应 DTO**。

按约定处理：**在 F007 进入实施（Phase 1 开工）前补齐本节**，与 F006 第 8 节同等粒度——请求/响应 DTO、HTTP 状态码与错误码矩阵、幂等语义、前端 loading / stale / blocked / retry 各态。现在不补是因为 F006 的 `GraphRuntimeService.start(issueId, plan)` 形状会直接决定 confirm 的响应内容，先落 F006 可以少返工一轮。

这是一次**有意的排序**，不是遗漏；F007 的状态维持 `ready-for-development`，但上述补齐是 Phase 1 的准入条件（见 `tasks.md` T009）。

## 10. 开放项（不阻塞开发）

- 关键词规则的词表需要真实使用后调整；`diff[]` 数据是调整依据。
- Agent Team Template 持久化等待真实的复用需求。
- Coordinator 成为可配置 agent 的时机见 ADR 0007 触发条件。

> 全部 Q1-Q4 已关闭，可按 `tasks.md` 展开实现。
