---
feature_ids: [F007]
related_features: [F005, F006]
topics: [coordinator, routing-recommendation, explainability]
doc_kind: design
created: 2026-08-01
updated: 2026-08-02
---

# F007：Coordinator Agent & Routing Recommendation - 设计

> Status: ready-for-development | Owner: TBD | Spec: `spec.md`

## 1. 技术概要

新增一个**纯函数式**的 `RoutingRecommendationService`：读 Project / workspace / adapter 注册表，按显式规则集算出推荐，返回带解释的结构，不写任何库。确认走独立的 `IntakeService.confirm()`，复用既有 `IssueService.create()` 与 `RunDispatchService.dispatch()`，不新建执行路径。

**推荐阶段零写入。** 上一轮为了做幂等，让推荐签发时就往 `intake_confirmations` 写一行——这与 FR-003 / NFR-001 / AC-002 / T012 全部冲突（它们要求推荐无副作用、纯内存计算），而且带来两个新问题：

- `recommendation_id` 定义为 premise 的哈希，而 **premise 不含目标文本**。同一 Project/workspace/adapter 状态下问两个不同的目标，算出的主键完全相同——第二次插不进去，用户会拿到第一次的推荐。
- 行在签发时就存在了，confirm 根本撞不了主键，"撞主键即认领"是空的。

改为**服务端签发自包含 token，确认时才落行**：

```ts
// 推荐响应里返回，不落库
interface ConfirmationToken {
  nonce: string;             // 每次签发全新，与内容无关
  issued_at: string;
  project_id: string; workspace_id: string;
  premise: RecommendationPremise;    // 第 5 节
  recommended: RoutingRecommendation;
}
// recommendation_id = 规范化序列化(token) 的摘要，仅用于等值比对与日志，不作身份
```

token 由客户端原样回传，服务端凭 `nonce` 唯一性认领：

```sql
CREATE TABLE intake_confirmations (
  nonce TEXT PRIMARY KEY,               -- 签发时生成，确认时才插入
  status TEXT NOT NULL,                 -- confirming | confirmed | failed
  project_id TEXT NOT NULL REFERENCES projects(id),
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  recommendation_id TEXT NOT NULL,      -- 内容摘要，用于诊断/等值比对，非身份
  chosen_json TEXT NOT NULL,            -- 用户最终选择（不重复存全部推荐候选）
  issue_id TEXT REFERENCES issues(id),
  target_kind TEXT,                     -- graph | run，与确认的 topology 一致
  target_id TEXT,                       -- graph_run_id 或 run_id
  issued_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  confirmed_at TEXT
);
```

- **认领**：`INSERT ... nonce` 成功即领到；撞主键说明已被处理，读回该行——`confirmed` 返回既有 `issue_id`/`target_id`，`confirming` 返回 409 `CONFIRMATION_IN_PROGRESS`，`failed` 允许重试。这比"事后 UPDATE 抢占"少一个状态。
- **签发有效期 30 分钟**（`issued_at` 起算），过期 → `RECOMMENDATION_STALE`。因为推荐阶段不落行，**没有垃圾行可积累**——只有真正确认过的才进表，无需清理任务。
- `chosen_json` 只存用户最终选择，不存被排除的候选与完整目标文本，避免把大段内容长期留存。
- 两个不同目标各自拿到不同 `nonce`，互不干扰；同一 token 重复提交才是幂等对象。

**schema 版本号按落地顺序取**：实施顺序为 F006 → F007，故 F007 用 `schema-v9.ts`。若顺序改变则按实际落地先后顺延——**绝不追加进任何已应用的版本**（F005 的 `availability_revision` 教训）。

## 2. 影响面

- **后端 service**：新增 `RoutingRecommendationService`（纯计算）、`IntakeService`（确认落地）。
- **存储**：新增 `intake_confirmations` 一张表（`schema-v9.ts`），**仅在确认时写入一行**；推荐阶段严格零写入，FR-003 / NFR-001 / AC-002 因此仍然成立。初稿"无 schema 变更"的说法因确认幂等的需要修正。
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
  // 仅推荐中被引用的 adapter；能力与可用性都要进快照
  adapters: Record<string, { effective_status: AdapterStatus; capability_tags: AgentCapability[]; updated_at: string }>;
  workflow_template_id: string;
  workflow_template_version: number;
  graph_definition_id: string | null;
  graph_definition_version: number | null;
}
```

**必须快照 `capability_tags`，不能只快照可用性。** `capability_tags` 的修改**不进** `availabilityRelevantFieldsTouched` 判定（`adapter-config-updater.ts:113-119` 的列表只有 command/args/auth_type/api_key/model_provider/default_model），因此一个 adapter 可以在可用性完全不变的情况下丢掉 `implementation` 能力——只比可用性的话哈希依旧匹配，推荐照跑，而能力覆盖规则和逐节点执行者恰恰都建立在能力之上。同时带上 `updated_at` 作稳定 revision，避免将来新增能力相关字段时再漏一次。

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
confirm(token, 用户最终选择)
  └─ IntakeService 持有的单一外层事务：
      ├─ INSERT intake_confirmations(nonce, status='confirming') —— 认领
      ├─ 校验 token 未过期；复核前提快照 + 用户每一处改选 → 不一致则 RECOMMENDATION_STALE
      ├─ IssueService.create(projectId, {title, goal, priority})   // 既有方法，不改签名
      ├─ 写 ThreadEvent: coordinator.recommendation_applied
      │    payload: { rules[], recommended, chosen, diff[] }        // TR-001
      ├─ 按确认的 topology 建首个执行单元（只写库，不拉进程）：
      │    sequential            → GraphRuntimeService.enqueueSequential(tx, ...)
      │    orchestrator_subagent → GraphRuntimeService.createGraph(tx, issueId, plan)
      └─ UPDATE status='confirmed' + 回填 target_kind/target_id
  ── commit ──
  提交之后，由 IntakeService 统一对受影响 workspace 调一次 drain。
```

**事务归属**：上一轮 F007 要求"单外层事务"，F006 又写"`start()` 自持事务、返回后 drain"，嵌套时内层只能提交 savepoint——外层若回滚，已经拉起的子进程无法撤销。现按 F006 `design.md` 第 8.2 节的拆分：`createGraph(tx, ...)` / `enqueueSequential(tx, ...)` **只写库**，派工统一由最外层提交后触发。drain 失败不损坏状态，queued Run 仍在库里等下次 drain 或重启恢复。

**分流是必须的**：F006 的图节点 Run 使用 `RunRole.GraphNode` 并由 `GraphRuntimeService` 创建；若确认路径无条件走 `RunDispatchService.dispatch()`，推荐出来的 `orchestrator_subagent` 会退化成一个普通的 implementation Run——推荐与实际执行不一致，且该 Run 完成时会触发 F004 的验证循环（见 F006 `design.md` 第 7 节）。

### 幂等与失败原子性

初稿把 `IssueService.create()` 先提交、再写事件、再派工，有两个用户可见的坏结果：双击或 HTTP 重试会建出两个 Issue；中途任一步失败会留下一个永远不会执行的孤儿 Issue + Thread。

- 重复提交同一 token → 撞 `nonce` 主键，按 `status` 返回既有结果 / 409 / 允许重试，不重复建。
- 事务内任一步失败 → 整体回滚（认领行一并回滚），不留孤儿 Issue；客户端可安全重试。
- **不引入通用 command / saga 表**。单机单用户应用不需要那套机制，这与 ADR 0007"候选集为 1 就别上 LLM"是同一种克制。

**adapter 一律走共享的 `resolveEligibleAdapter()`**（F006 `design.md` 第 8.3 节：组合 `resolveAdapter()` + `hasCapability()`），传入用户确认后的显式 id：`sequential` 经 `enqueueSequential`，`orchestrator_subagent` 经 `createGraph` 对 `nodeAssignments` 逐项复核。**不能只用 `resolveAdapter()`**——它没有 capability 参数（`adapter-resolver.ts:32-64`），只证明 adapter 可用、不证明它能干这个节点。推荐服务本身只产出候选，绝不写入 `default_adapter_config_id`，也不构造"取第一个可用"的回退——`adapter-resolver.ts` 的文件头注释明确"永不回退到列表里第一个可用 adapter，无法解析的默认值是硬错误"，推荐不得成为绕过它的后门（FR-005）。

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

初稿的确认路径对图分支只调 `GraphRuntimeService.start(issueId)`，而图内部会重新解析每个节点的执行者。后果是 spec US3 的独立测试要求"首个 Run 使用用户确认的 adapter id"对 `orchestrator_subagent` 直接不成立：推荐面板展示的 roster 与实际执行无关，`diff[]` 审计因此记的是假账。上一轮只改了本文档、没同步 F006，等于契约仍未成立。

**契约现由 F006 `design.md` 第 8 节定义并拥有**，本节只引用：

- `GraphExecutionPlan`（8.1）：`nodeAssignments` 必须覆盖 definition 全部节点，**含启动时还不执行的 synthesis**；缺项 → `GRAPH_PLAN_INCOMPLETE`。
- 执行者落库（8.4）：`node_runs.assigned_adapter_config_id`。fan-in 之前重启也不会丢失用户确认的 synthesis 执行者——只放在内存计划里必然丢。
- 复核（8.3）：逐项经 `resolveEligibleAdapter()`，任一不通过则**整体拒绝**，不部分启动、不自行替换。
- F007 仍**不读写** `graph_runs` / `node_runs`，边界不变：F006 负责图能不能跑、怎么恢复；F007 只负责"这次要不要用图、由谁跑"。

**实施顺序上的约束**：F007 可先于 F006 完成开发，但 `orchestrator_subagent` 分支要等 `createGraph(tx, ...)` 存在才能接通。在此之前该分支返回 409 `TOPOLOGY_NOT_EXECUTABLE`，而**不是**悄悄回退到 `sequential`——静默回退会让 US1 验收场景 2 表面通过而实际没跑图。

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

## 9. API 契约

上一轮把本节挂成"Phase 1 准入"，等于用一条待办把 `ready-for-development` 重新定义成"还不许开工"，与 `BACKLOG.md` 的状态定义和 `docs/features/README.md` 的硬约束冲突。既然 F006 第 8 节已经把跨 feature 契约定死，这里一并补完。

### `POST /api/projects/:projectId/intake/recommend`

```ts
// 请求
interface RecommendRequest { goal: string; workspace_id?: string }

// 200
interface RecommendResponse {
  token: ConfirmationToken;                  // 原样回传，勿解析
  recommendation_id: string;                 // 内容摘要，仅供显示/日志
  issue_draft: { title: Recommendation<string>; goal: Recommendation<string>; priority: Recommendation<string> };
  workflow_template: Recommendation<{ id: string; version: number }>;
  collaboration_topology: Recommendation<{ value: "sequential" | "orchestrator_subagent";
                                          definition_id?: string; definition_version?: number }>;
  agent_roster: Recommendation<Record<string, string>>;   // node_key（或 "sequential"） → adapter_config_id
  editable: ("collaboration_topology" | "agent_roster")[];  // v0.2 仅此二者可改，见下
}

// 409 —— 无可执行方案
interface RecommendBlocked {
  error: { code: "NO_AVAILABLE_ADAPTER" | "PROJECT_WORKSPACE_REQUIRED";
           message: string; suggested_action: string };
}
```

| 情形 | 状态码 | 错误码 |
|---|---|---|
| `goal` 空 / 纯空白 | 400 | `ISSUE_GOAL_REQUIRED` |
| Project 未绑定 workspace | 409 | `PROJECT_WORKSPACE_REQUIRED` |
| 无任何 Available adapter | 409 | `NO_AVAILABLE_ADAPTER` |
| `workspace_id` 非法/跨 Project | 404 | `WORKSPACE_NOT_FOUND` |

### `POST /api/projects/:projectId/intake/confirm`

```ts
interface ConfirmRequest {
  token: ConfirmationToken;
  chosen: { collaboration_topology: string; agent_roster: Record<string, string> };
}
// 201
interface ConfirmResponse {
  issue_id: string;
  target_kind: "graph" | "run";
  target_id: string;
  diff: { field: string; recommended: unknown; chosen: unknown }[];
}
```

| 情形 | 状态码 | 错误码 |
|---|---|---|
| 前提已变 / token 过期（>30 分钟） | 409 | `RECOMMENDATION_STALE`（附 `changed[]`） |
| 同 token 正在处理中 | 409 | `CONFIRMATION_IN_PROGRESS` |
| 同 token 已确认 | 200 | 返回既有 `issue_id` / `target_id`（幂等，非错误） |
| 选中 adapter 缺该节点能力 | 409 | `ADAPTER_CAPABILITY_MISSING` |
| `orchestrator_subagent` 但 F006 未落地 | 409 | `TOPOLOGY_NOT_EXECUTABLE`（**禁止静默回退 `sequential`**） |
| roster 未覆盖 definition 全部节点 | 400 | `GRAPH_PLAN_INCOMPLETE` |

### 可调整维度限定为两项

spec 说"逐项调整"，但 `IssueService.create()` 的签名不变、模板由 `getDefault()` 选定，**workflow template 在 v0.2 结构上就传不进去**；Issue 字段则由确定性规则派生，允许改会让 `diff[]` 失去"规则准不准"的评估意义。因此 v0.2 明确：

- **可改**：`collaboration_topology`、`agent_roster`（逐节点执行者）。
- **只读**：`issue_draft` 三个字段、`workflow_template`。UI 照常展示规则与候选集，但控件禁用并注明"v0.2 不可调整"。
- `editable[]` 由服务端返回，前端不得自行假定。

### 前端状态

`idle` / `loading` / `recommended` / `blocked`（展示 `suggested_action`）/ `confirming` / `stale`（引导重新推荐）/ `confirmed`。

## 10. 开放项（不阻塞开发）

- 关键词规则的词表需要真实使用后调整；`diff[]` 数据是调整依据。
- Agent Team Template 持久化等待真实的复用需求。
- Coordinator 成为可配置 agent 的时机见 ADR 0007 触发条件。

> 全部 Q1-Q4 已关闭，可按 `tasks.md` 展开实现。
