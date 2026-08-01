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

没有新表。推荐是内存计算，`recommendation_id` 只是一个随推荐一起返回的前提快照哈希，用于确认时复核，不落库。

## 2. 影响面

- **后端 service**：新增 `RoutingRecommendationService`（纯计算）、`IntakeService`（确认落地）。
- **存储**：无 schema 变更。
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

- 一致 → 按用户确认的值创建 Issue 与首个 Run。
- 不一致 → 返回 `RECOMMENDATION_STALE` 并附上变化项，要求重新推荐。**不静默按新状态执行**（FR-004）。

只快照"推荐中实际引用到的 adapter"，不快照全表——否则一个无关 adapter 的后台 probe 收敛就会让推荐失效。这与 F005 收敛 workspace 环境快照时只比较 `push_credentials_enabled` 是同一教训：快照范围过宽会被无关写误伤。

## 6. 确认路径

```text
confirm(recommendation_id, 用户最终选择)
  ├─ 复核前提快照 → 不一致则 RECOMMENDATION_STALE
  ├─ IssueService.create(projectId, {title, goal, priority})   // 既有方法，不改签名
  ├─ 写 ThreadEvent: coordinator.recommendation_applied
  │    payload: { rules[], recommended, chosen, diff[] }        // TR-001
  └─ 按确认的 topology 分流：
       sequential            → RunDispatchService.dispatch(issueId, adapterId, instructions)
       orchestrator_subagent → GraphRuntimeService.start(issueId)   // F006
```

**这条分流是必须的**：F006 的图节点 Run 使用 `RunRole.GraphNode` 并由 `GraphRuntimeService` 创建；若确认路径无条件走 `RunDispatchService.dispatch()`，推荐出来的 `orchestrator_subagent` 会退化成一个普通的 implementation Run——推荐与实际执行不一致，且该 Run 完成时会触发 F004 的验证循环（见 F006 `design.md` 第 7 节）。

**adapter 一律走 `resolveAdapter()`**（由 `dispatch` 内部经 `ManualRoutingService` 调用），传入用户确认后的显式 id。推荐服务本身只产出候选，绝不写入 `default_adapter_config_id`，也不构造"取第一个可用"的回退——`adapter-resolver.ts` 的文件头注释明确"永不回退到列表里第一个可用 adapter，无法解析的默认值是硬错误"，推荐不得成为绕过它的后门（FR-005）。

`diff[]` 记录推荐值与用户最终选择的差异；用户全盘接受时为空数组。这是 TR-001 要求的可追溯性，也是后续判断规则准不准的唯一数据来源。

## 7. topology 推荐与 F006 的衔接

推荐 `orchestrator_subagent` 时，`value` 携带 F006 的 `definition_id` + `version`（`wgd_coding_dual_review` v1）。若该 definition 所需的执行者数量超过当前可用 adapter 数，规则降级为 `sequential` 并在 `excluded` 中注明原因——**降级必须显式出现在解释里**，不能悄悄换一个 topology（FR-006）。

F006 与 F007 的边界：F006 负责图能不能跑、怎么恢复；F007 只负责"这次要不要用图"。F007 **不读写** `graph_runs` / `node_runs`，只调用 `GraphRuntimeService.start(issueId)` 这一个入口。

**实施顺序上的约束**：F007 可以先于 F006 完成开发，但 `orchestrator_subagent` 这条确认分支要等 `GraphRuntimeService.start()` 存在才能接通。在 F006 落地前，该分支应返回明确的"该 topology 尚不可执行"阻塞，而**不是**悄悄回退到 `sequential` ——静默回退会让 US1 验收场景 2 表面通过而实际没跑图。

## 8. 边界与失败处理

| 场景 | 行为 |
|---|---|
| 目标文本为空/纯空白 | 400，复用既有 `ISSUE_GOAL_REQUIRED` 语义 |
| 目标文本超长 | 截断用于规则匹配，完整文本存入 `goal`；不报错 |
| Project 未绑定 workspace | 推荐阶段即返回阻塞，不等到确认才失败（既有 `PROJECT_WORKSPACE_REQUIRED`） |
| 无 Available adapter | 阻塞原因 `no_available_adapter` + 建议动作"在 Adapter Settings 中验证适配器" |
| 可用 adapter 数不足以支撑推荐的 topology | 降级为 `sequential` 并在 `excluded` 说明 |
| 确认时前提已变 | `RECOMMENDATION_STALE` + 变化项 |

## 9. 开放项（不阻塞开发）

- 关键词规则的词表需要真实使用后调整；`diff[]` 数据是调整依据。
- Agent Team Template 持久化等待真实的复用需求。
- Coordinator 成为可配置 agent 的时机见 ADR 0007 触发条件。

> 全部 Q1-Q4 已关闭，可按 `tasks.md` 展开实现。
