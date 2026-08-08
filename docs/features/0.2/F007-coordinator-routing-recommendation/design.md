---
feature_ids: [F007]
related_features: [F005, F006]
topics: [coordinator, routing-recommendation, explainability]
doc_kind: design
created: 2026-08-01
updated: 2026-08-08
---

# F007：Coordinator Agent & Routing Recommendation - 设计

> Status: ready-for-development | Owner: TBD | Spec: `spec.md`

## 1. 技术概要

新增一个**纯函数式**的 `RoutingRecommendationService`：读 Project / workspace / adapter 注册表，按显式规则集算出推荐，返回带解释的结构，不写任何库。确认走独立的 `IntakeService.confirm()`，复用既有的 `IssueService.create()`，不新建执行路径——但**不直接调用通用的 `RunDispatchService.dispatch()` 或 `ManualRoutingService.dispatch()`**：两条 topology 分别走本 feature 新增的自由函数 `createSequentialRun(deps, ...)`（第 6 节）与 F006 的自由函数 `createGraph(deps, ...)`（准确签名与调用惯例见 F006 `design.md` 第 8 节，本节不重复声明）。两者都不接收 `tx` 参数、不自持事务——better-sqlite3 没有可传递的事务句柄，原子性来自 `confirm()` 自己把整段调用包进 `db.transaction(() => {...})()`。无条件 dispatch 会把图节点变成普通 implementation Run 并误触发 F004 验证循环；直接复用 F006 的 `enqueueSequential(...)` 同样错误——它只是 `createGraph(...)` 的别名，会把普通单 Run 请求悄悄建成三节点图（2026-08-08 检视修正，见第 6 节）。

**推荐阶段零写入。** 上一轮为了做幂等，让推荐签发时就往 `intake_confirmations` 写一行——这与 FR-003 / NFR-001 / AC-002 / T012 全部冲突（它们要求推荐无副作用、纯内存计算），而且带来两个新问题：

- `recommendation_id` 定义为 premise 的哈希，而 **premise 不含目标文本**。同一 Project/workspace/adapter 状态下问两个不同的目标，算出的主键完全相同——第二次插不进去，用户会拿到第一次的推荐。
- 行在签发时就存在了，confirm 根本撞不了主键，"撞主键即认领"是空的。

改为**服务端签发自包含 token，确认时才落行**：

```ts
// 推荐响应里返回，不落库
interface ConfirmationToken {
  payload: {
    nonce: string;             // 每次签发全新，与内容无关，是确认的唯一身份
    issued_at: string;
    project_id: string; workspace_id: string;
    premise: RecommendationPremise;    // 第 5 节
    recommended: RoutingRecommendation;
  };
  signature: string;           // HMAC-SHA256(规范化序列化(payload), 服务端密钥)
}
// recommendation_id = 规范化序列化(payload) 的摘要，仅用于等值比对与日志，不作身份、不作校验
```

### token 必须签名（第三轮检视修正）

零写入意味着 token 的**唯一副本在客户端手里**。上一轮我写"单机本地应用不需要 HMAC——这里防的是过期，不是伪造"，这句话的错在于把问题看成安全问题：真正的问题是**服务端失去了自己契约的执行能力**。没有签名，confirm 就无法分辨"这是我签发的推荐"和"这是客户端随手编的 JSON"，于是：

- `issued_at` 可被改写，30 分钟过期形同虚设；
- 声明为只读的 `issue_draft`（title/goal/priority）可被替换，服务端返回的 `editable[]` 变成一句没有约束力的建议；
- `premise` / `recommended` 可被改写，`diff[]` 审计记的是客户端说了算的账。

对客户端提供的内容取哈希毫无帮助——服务端没有可信的期望值去比对。因此：

- **服务端持有一个 HMAC 密钥**，签发时算 `signature`，确认时先验签再做任何事。密钥的运维契约见下方"密钥生命周期"，**不留二选一**。
- 验签失败 → 400 `CONFIRMATION_TOKEN_INVALID`，不做部分处理。
- 验签通过后仍要独立校验：路由上的 `:projectId` 与 payload 的 `project_id` 一致、workspace 归属该 Project、`issued_at` 未超 30 分钟。
- 测试必须覆盖篡改 `issued_at`、篡改 `issue_draft`、篡改 `project_id`、篡改 `premise`、伪造/缺失 `signature` 五种。

#### 密钥生命周期（唯一方案）

现有应用配置只有数据库路径，没有可复用的 secret store。**不为此新增文件与权限管理**，密钥存进 SQLite：

```sql
-- 随 schema-v9 一并创建
CREATE TABLE app_secrets (
  name TEXT PRIMARY KEY,       -- 'intake_token_hmac'
  value TEXT NOT NULL,         -- 32 字节随机数的 base64
  created_at TEXT NOT NULL
);
```

- **首次启动**：表中无该行 → 生成 32 字节 CSPRNG 随机数并 `INSERT`，与其它启动步骤同在一个事务。
- **后续启动**：读回同一行，**跨重启保持不变**——因此 30 分钟内已签发的 token 在重启后依然有效，用户不会因为一次重启而丢掉待确认的推荐。
- **值损坏/为空**：视为致命配置错误，启动失败并给出明确信息，**不静默重新生成**——静默重生成会让所有在途 token 变成"签名无效"，用户看到的是一个无法解释的报错。
- **不做轮换**。轮换需要多密钥并存与灰度，对一个 30 分钟有效期的本地 token 不成比例；真需要时手工删除该行并重启即可，代价是在途 token 失效。
- 密钥与数据库同生命周期：数据库文件本身已经承载全部本地凭据相关状态（F005 的 adapter api_key 也在库里），不额外引入一个需要单独备份的文件。
- 测试：跨重启验签通过、损坏值导致启动失败、首次启动自动生成且只生成一次。

token 由客户端原样回传，服务端验签后凭 `nonce` 唯一性认领：

```sql
CREATE TABLE intake_confirmations (
  nonce TEXT PRIMARY KEY,               -- 签发时生成，确认成功时才插入
  project_id TEXT NOT NULL REFERENCES projects(id),
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  recommendation_id TEXT NOT NULL,      -- 内容摘要，用于诊断/等值比对，非身份、非校验依据
  chosen_json TEXT NOT NULL,            -- 用户最终选择（不重复存全部推荐候选）
  issue_id TEXT NOT NULL REFERENCES issues(id),
  target_kind TEXT NOT NULL CHECK (target_kind IN ('graph', 'run')),
  target_id TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  confirmed_at TEXT NOT NULL
);
```

**没有 `status` 列。** 上一轮设计了 `confirming | confirmed | failed` 三态，但三者都不成立：整个确认是**一个同步的 SQLite 事务**，`confirming` 从插入到改写全在未提交状态，别的请求根本观察不到，`CONFIRMATION_IN_PROGRESS` 因此不可达；失败则整体回滚，行根本不存在，`failed` 没有任何写入点。持久化状态应当对应别的请求或恢复流程**真能观察到并推进**的状态，否则就是自欺。

因此本表只记录**已成功确认**这一个事实，全部列 NOT NULL：

- **认领**：事务**最后一步** `INSERT ... nonce`（全部结果字段此时才齐备）。撞主键说明该 token 已被成功确认过 → 本事务回滚，另起读操作取胜者已提交的行，返回既有 `issue_id` / `target_id`（200，幂等，不是错误）。
- **并发双击**：SQLite 的写事务本身串行化，后到者要么撞主键、要么在前者回滚后正常执行，两种结果都正确。
- **失败**：整体回滚，无残留行，客户端可用同一 token 安全重试（只要未过期）。
- **没有 `CONFIRMATION_IN_PROGRESS`**：该状态在单事务模型下不可观察，已从错误码矩阵中移除。
- **幂等查询排在过期判断之前**：已成功确认的 token 在 31 分钟后重放，应当返回 200 与既有结果，而不是 `RECOMMENDATION_STALE`。过期判断的意义是"别拿陈旧前提去创建新东西"，对一个早已完成的确认没有意义。因此顺序固定为"验签 → 按 `nonce` 查已确认事实 → 未命中才判过期"，两条规则不再同时命中。
- **签发有效期 30 分钟**（`issued_at` 起算），过期 → `RECOMMENDATION_STALE`。因为推荐阶段不落行，**没有垃圾行可积累**——只有真正确认过的才进表，无需清理任务。
- `chosen_json` 只存用户最终选择，不存被排除的候选与完整目标文本，避免把大段内容长期留存。
- 两个不同目标各自拿到不同 `nonce`，互不干扰；同一 token 重复提交才是幂等对象。

**schema 版本号按落地顺序取**：实施顺序为 F006 → F007，故 F007 用 `schema-v9.ts`。若顺序改变则按实际落地先后顺延——**绝不追加进任何已应用的版本**（F005 的 `availability_revision` 教训）。

## 2. 影响面

- **后端 service**：新增 `RoutingRecommendationService`（纯计算）、`IntakeService`（确认落地）。
- **存储**：新增 `intake_confirmations` 与 `app_secrets` 两张表（`schema-v9.ts`）。前者**仅在确认成功时写入一行**（推荐阶段严格零写入，FR-003 / NFR-001 / AC-002 因此仍然成立），后者存 token 签名密钥、与数据库同生命周期。初稿"无 schema 变更"的说法因确认幂等与签名密钥的需要修正。
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

**`agent_roster` 不使用上面的通用 `Recommendation<T>` 形状（2026-08-08 检视修正）**。表格把它并列写在这里是为了说明规则名与候选来源，但它的候选与排除原因必须**按节点**区分——`T = Record<string, string>` 时通用形状的 `candidates: T[]` 会变成"整套 roster 组合数组"，而不是"每个节点各自的候选"，也无法表达"同一 adapter 对节点 A 是候选、对节点 B 因缺能力被排除"这种逐节点差异。实际返回类型是第 9 节定义的 `AgentRosterRecommendation`（`value` + `rule` + 按 `node_key` 拆分的 `by_node[node_key].{candidates, excluded}`）。

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

确认时重新采集同一组前提，与 token 中**验签通过的** `premise` 逐项比对：

- 一致 → 按用户确认的值创建 Issue 与首个执行单元。
- 不一致 → 返回 `RECOMMENDATION_STALE` 并附上变化项，要求重新推荐。**不静默按新状态执行**（FR-004）。

比对的可信来源是**签名保护的 payload**，不是任何哈希值。`recommendation_id` 全文只有一个定义——规范化序列化 `payload` 后的摘要，**只用于日志与等值比对，既不是身份也不是校验依据**；身份一律是 `nonce`。

只快照"推荐中实际引用到的 adapter"，不快照全表——否则一个无关 adapter 的后台 probe 收敛就会让推荐失效。这与 F005 收敛 workspace 环境快照时只比较 `push_credentials_enabled` 是同一教训：快照范围过宽会被无关写误伤。

### 快照必须覆盖用户改选的 adapter（初稿漏洞，已修正）

初稿只快照"推荐**引用到**的 adapter"，但 spec 允许用户在确认前逐项调整。用户换掉推荐的 adapter 时，新选的那个不在快照里——它的可用性完全不受 stale 检查保护，可以在确认瞬间已经不可用而系统照跑不误。这个洞恰好开在"用户手动干预"这条最需要校验的路径上。

因此确认时校验**两组**前提：

1. 原始快照的每一项仍然一致（防止推荐依据变了）。
2. 用户提交的**每一个替换值**按当前状态重新校验（adapter 的 `effectiveAdapterStatus()`、topology 的能力覆盖、模板版本仍 active）。任一不通过即 `RECOMMENDATION_STALE`，附具体是哪一项。

### 规范化序列化

签名与摘要都基于同一套**规范化序列化**：对象键升序、无多余空白、数值与时间用固定格式、数组保持产出顺序。签名与验签必须走同一个函数，否则会出现"同一份内容算出两个签名"的假失败。

零写入模型下服务端不保存任何签发记录——**前提集合的可信性完全来自 HMAC 签名**（见第 1 节），不来自数据库读回。

## 6. 确认路径

```text
confirm(token, 用户最终选择)
  ├─ 事务外：① 验签 + 结构校验 + projectId 与 payload 一致
  │           ② **按 nonce 查已确认事实** —— 命中则直接返回 200 既有结果（不再判过期）
  │           ③ 未命中才判 issued_at 是否超 30 分钟
  └─ IntakeService 持有的单一外层事务：
      ├─ 复核前提快照 + 用户每一处改选 → 不一致则 RECOMMENDATION_STALE
      ├─ IssueService.create(projectId, {title, goal, priority})   // 既有方法，不改签名；
      │    它内部自己也调用 db.transaction()，但 better-sqlite3 对"已在事务中再次调用
      │    db.transaction()"会自动退化为 SAVEPOINT，因此嵌套在 IntakeService 的外层事务
      │    里语义仍然正确：外层回滚会连带回滚这个 SAVEPOINT。
      ├─ 写 ThreadEvent: coordinator.recommendation_applied
      │    payload: { rules[], recommended, chosen, diff[] }        // TR-001
      ├─ 按确认的 topology 建首个执行单元（只写库，不拉进程；均在本事务回调内调用，
      │    不接收 "tx" 参数、不自持事务——原子性来自整段调用被包在这个
      │    db.transaction(() => {...})() 里）：
      │    sequential            → createSequentialRun(deps, issueId, threadId, workspaceId,
      │                             projectId, adapterConfigId)   // 本 feature 新增自由函数，见下；
      │                             instructions 不作为参数传入，函数内部从刚创建的 Issue.goal 派生
      │    orchestrator_subagent → createGraph(deps, issueId, threadId, workspaceId, projectId, plan, preflight)
      │                             // F006 的自由函数，签名与调用惯例见 F006 design.md 第 8.2 节
      └─ INSERT intake_confirmations(...) —— **完整最终行，作为事务最后一步**
  ── commit ──
  提交之后，由 IntakeService 把两条分支各自返回的 pendingEvents 合并 broadcast，
  再对涉及的 workspace（两条分支目前都只有唯一一个，即确认时使用的默认 workspace）
  调一次 drain。
```

### `sequential` 不得复用 F006 的 `enqueueSequential()`（2026-08-08 检视修正）

上一轮把 `sequential` 分支写成 `GraphRuntimeService.enqueueSequential(...)`，这是错的：`server/src/services/graph-runtime.ts:222-231` 显示 `enqueueSequential()` 只是 `createGraph()` 的实例方法别名，签名要求完整的 `GraphExecutionPlan`（`nodeAssignments` 覆盖 definition 全部节点）与 `GraphPreflight`。而 F007 的 `ChosenPlan` 的 `sequential` 分支只有 `{ adapter_config_id }`（第 9 节），根本凑不出这些参数；若实现者临时伪造一份图计划，会把用户选择的"单 Run 顺序执行"静默建成 F006 的三节点 `orchestrator_subagent` 图——两者是完全不同的执行形状，且图节点 Run 用的是 `RunRole.GraphNode`，不会触发普通 implementation Run 该有的 F004 验证循环。

**新增自由函数 `createSequentialRun`**，与 F006 的 `createGraph(deps, ...)` 同构（不自持事务、只写库、不拉进程）。**签名只有一份**——上一轮流程图与正式签名不一致（流程图多传了 `instructions`、少传了 `projectId`），且"instructions 复用既有派生方式"的说法不准确（仓库里不存在这样一个公共函数：`ManualRoutingService.dispatch()` 是把 `instructions` 当**输入**做 trim + 非空校验，不是从 Issue 派生）：

```ts
interface SequentialRunDeps {
  runRepo: RunRepository;
  issueRepo: IssueRepository;
  agentConfigRepo: AgentConfigRepository;
  threadEventService: ThreadEventService;
  adapterDeps: AdapterResolverDeps;
}

function createSequentialRun(
  deps: SequentialRunDeps,
  issueId: string,
  threadId: string,
  workspaceId: string,
  projectId: string,
  adapterConfigId: string,
): { runId: string; pendingEvents: ThreadEvent[] }
```

行为：

1. `issueRepo.getById(issueId)`；不存在或 `issue.project_id !== projectId || issue.workspace_id !== workspaceId` → 内部契约错误（与 `createGraph` 对 Issue 归属的校验同构，`graph-runtime.ts:73-76`）。**`instructions` 唯一来源是 `issue.goal.trim()`**——不接受调用方另行传入，避免 token 中签名保护的 goal 与真实执行指令发生分叉；`goal` 为空同样视为内部契约错误（`IssueService.create()` 已保证非空，这里是防御性检查）。
2. 经共享的 `resolveEligibleAdapter()`（F006 `design.md` 第 8.3 节）复核 `adapterConfigId` 具备 `Implementation` 能力；不通过 → `ADAPTER_CAPABILITY_MISSING`，整体拒绝（与图分支同一纪律）。`deps.agentConfigRepo.getById(adapterConfigId)` 取出 adapter 实体用于下一步的身份快照。
3. `runRepo.create({ issue_id, thread_id, workspace_id, adapter_config_id, instructions, status: Queued, role: Implementation, purpose: WorkflowBound, dispatch_source: RunDispatchSource.UserExplicit, adapter_identity: { adapter_config_id, name, cli_provider, default_model }, context_source_run_id: null })`——`dispatch_source`/`adapter_identity` 显式写入而非依赖仓库默认值，`context_source_run_id` 为 `null` 是因为这是新 Issue 的第一个 Run，没有"之前完成的 implementation Run"可继承 handoff（与 `ManualRoutingService.dispatch()` 对首个 Run 的处理一致，`context_source_run_id` 逻辑上取 `null`）。**这与既有普通 implementation Run 使用相同的 provenance 字段**，历史执行者身份不会因 adapter 配置事后改名/换 provider 而丢失。**`Run.adapter_identity` 是执行者历史身份的唯一真相源**（第二次最终复检修正）——`coordinator.recommendation_applied` 事件的 `recommended`/`chosen` 只存 adapter id（见下方"幂等与失败原子性"一节），不独立保存 `{name, cli_provider, default_model}` 快照；该事件的职责是记录命中规则、推荐值、用户最终选择与差异，不是身份快照，v0.2 不为此新增事件字段。
4. `issueRepo.compareAndSetStatus(issueId, Inbox, Running)`——这是 `IssueService.create()` 在同一事务里刚建出来的 Issue，理应仍是 `Inbox`；CAS 失败视为内部错误（防御性检查，正常路径不会触发）。
5. 写 `ThreadEventType.RunQueued` 事件，payload 与 `ManualRoutingService.dispatch()` 对齐：`run_id`/`issue_id`/`thread_id`/`workspace_id`/`status`/`purpose`/`role`/`dispatch_source`/`adapter_config_id`/`cli_provider`/`context_source_run_id`/`drives_issue_state: true`，加入 `pendingEvents`，**不在函数内 broadcast**。
6. 返回 `{ runId, pendingEvents }`。

`createSequentialRun` 不复用 `ManualRoutingService.dispatch()`——后者自持 `db.transaction()` 并在内部直接 `broadcast()`，与 `confirm()` 的单外层事务、commit 后统一 broadcast/drain 的要求冲突（这正是 `ManualRoutingService` 现有设计对 F007 不适用的原因）。

**认领在最后一步而非第一步。** 表里全部列 NOT NULL 且只记录已成功确认的事实，`issue_id` / `target_kind` / `target_id` 要等实体建完才有值——放在开头 INSERT 根本插不进去。并发双击的收敛靠 `nonce` 唯一键：后到者在 INSERT 处撞键 → 整个事务回滚 → 随后**另起一次读**取胜者已提交的行，返回 200 与既有 `issue_id`/`target_id`。这条顺序是可实现性要求，不是风格选择。

**事务归属**：上一轮 F007 要求"单外层事务"，F006 又写"`start()` 自持事务、返回后 drain"，嵌套时内层只能提交 savepoint——外层若回滚，已经拉起的子进程无法撤销。现按 F006 `design.md` 第 8.2 节的拆分：`createGraph(deps, ...)`（F006 自由函数）与本 feature 的 `createSequentialRun(deps, ...)`（自由函数）**只写库**，均不接收 `tx` 参数，派工统一由最外层提交后触发。drain 失败不损坏状态，queued Run 仍在库里等下次 drain 或重启恢复。

**分流是必须的**：F006 的图节点 Run 使用 `RunRole.GraphNode` 并由 `GraphRuntimeService` 创建；若确认路径无条件走 `RunDispatchService.dispatch()`，推荐出来的 `orchestrator_subagent` 会退化成一个普通的 implementation Run——推荐与实际执行不一致，且该 Run 完成时会触发 F004 的验证循环（见 F006 `design.md` 第 7 节）。

### 幂等与失败原子性

初稿把 `IssueService.create()` 先提交、再写事件、再派工，有两个用户可见的坏结果：双击或 HTTP 重试会建出两个 Issue；中途任一步失败会留下一个永远不会执行的孤儿 Issue + Thread。

- 重复提交同一 token → 事务外按 `nonce` 读到已确认的最终行即返回 200 既有结果；若并发到达则在事务最后一步撞主键、回滚后再读一次。**不按 `status` 判断**（表里没有该列）。
- 事务内任一步失败 → 整体回滚（认领行一并回滚），不留孤儿 Issue；客户端可安全重试。
- **不引入通用 command / saga 表**。单机单用户应用不需要那套机制，这与 ADR 0007"候选集为 1 就别上 LLM"是同一种克制。

**adapter 一律走共享的 `resolveEligibleAdapter()`**（F006 `design.md` 第 8.3 节：组合 `resolveAdapter()` + `hasCapability()`），传入用户确认后的显式 id：`sequential` 经 `createSequentialRun`，`orchestrator_subagent` 经 `createGraph` 对 `nodeAssignments` 逐项复核。**不能只用 `resolveAdapter()`**——它没有 capability 参数（`adapter-resolver.ts:32-64`），只证明 adapter 可用、不证明它能干这个节点。推荐服务本身只产出候选，绝不写入 `default_adapter_config_id`，也不构造"取第一个可用"的回退——`adapter-resolver.ts` 的文件头注释明确"永不回退到列表里第一个可用 adapter，无法解析的默认值是硬错误"，推荐不得成为绕过它的后门（FR-005）。

`diff[]` 记录推荐值与用户最终选择的差异；用户全盘接受时为空数组。这是 TR-001 要求的可追溯性，也是后续判断规则准不准的唯一数据来源。

## 7. topology 推荐与 F006 的衔接

推荐 `orchestrator_subagent` 时，`value` 携带 F006 的 `definition_id` + `version`（`wgd_coding_dual_review` v1）。

### 降级判据：按能力覆盖，不按 adapter 数量（初稿错误，已修正）

初稿写"若该 definition 所需的**执行者数量**超过当前可用 adapter 数，规则降级为 `sequential`"。这条规则是错的，它把"两个可独立调度的节点"误当成了"需要两个 provider"：

- F006 明确 **Node ≠ Agent**，三个节点统一声明 `Implementation` 能力（`F006/design.md` 第 5 节）。
- F006 的物理执行本来就是**串行**的——三个 Attempt 依次经 workspace FIFO 队列，同一个 adapter 完全可以跑完全部三个节点。

而**单 adapter 恰恰是个人用户的默认安装形态**。按初稿实现，v0.2 的旗舰能力在大多数机器上默认永不启用，理由还是一条虚构的技术约束。

正确判据：**逐节点检查能力覆盖**——definition 里每个节点的 `required_capabilities` 都存在至少一个 workspace 级 Available 的 adapter 即可，允许同一个 adapter 覆盖多个节点。

- 降级若发生，必须显式出现在解释里，不能悄悄换 topology（FR-006）。**但 v0.2 实际不存在可触发的降级**，见下一小节。
- 若将来某个 definition 真的需要"视角多样性"（同一能力必须由不同 provider 执行），那是 definition 上的**一等约束**，由 F006 显式声明并自带验收测试，**不能从节点数量反推**。v1 不声明该约束。

### v0.2 不存在基于能力的降级（第三轮检视修正）

上一轮写"某节点的能力无任何 adapter 覆盖时降级为 `sequential`"。这条规则在 v0.2 是**空转的**：`wgd_coding_dual_review` 三个节点统一声明 `Implementation`（F006 `design.md` 第 5 节），而 `sequential` 的执行同样经 `resolveEligibleAdapter()` 且同样需要 `Implementation` 能力。也就是说，**触发降级的条件恰好也让降级后的方案不可执行**——recommend 返回一个看似有效的 `sequential` 方案，confirm 立刻以 `ADAPTER_CAPABILITY_MISSING` 拒绝。

回退只有在**放松了那个没被满足的前提**时才成立。因此：

- 没有任何 Available adapter 具备 `Implementation` → **直接返回阻塞** `NO_AVAILABLE_CAPABLE_ADAPTER`，附明确的建议动作，不假装还有 `sequential` 可走。
- 降级规则本身保留在实现里，但**在 v0.2 的能力词汇表下永不触发**；等出现"图需要而顺序执行不需要"的额外能力要求时才会有真实的降级路径。文档与测试都如实这么写，不制造一条测不出来的分支。

### 执行计划必须传给图（初稿错误，已修正）

初稿的确认路径对图分支只调 `GraphRuntimeService.start(issueId)`，而图内部会重新解析每个节点的执行者。后果是 spec US3 的独立测试要求"首个 Run 使用用户确认的 adapter id"对 `orchestrator_subagent` 直接不成立：推荐面板展示的 roster 与实际执行无关，`diff[]` 审计因此记的是假账。上一轮只改了本文档、没同步 F006，等于契约仍未成立。

**契约现由 F006 `design.md` 第 8 节定义并拥有**，本节只引用：

- `GraphExecutionPlan`（8.1）：`nodeAssignments` 必须覆盖 definition 全部节点，**含启动时还不执行的 synthesis**；缺项 → `GRAPH_PLAN_INCOMPLETE`。
- 执行者落库（8.4）：`node_runs.assigned_adapter_config_id`。fan-in 之前重启也不会丢失用户确认的 synthesis 执行者——只放在内存计划里必然丢。
- 复核（8.3）：逐项经 `resolveEligibleAdapter()`，任一不通过则**整体拒绝**，不部分启动、不自行替换。
- F007 仍**不读写** `graph_runs` / `node_runs`，边界不变：F006 负责图能不能跑、怎么恢复；F007 只负责"这次要不要用图、由谁跑"。

**实施顺序上的约束**：F007 可先于 F006 完成开发，但 `orchestrator_subagent` 分支要等 `createGraph(deps, ...)` 存在才能接通。在此之前该分支返回 409 `TOPOLOGY_NOT_EXECUTABLE`，而**不是**悄悄回退到 `sequential`——静默回退会让 US1 验收场景 2 表面通过而实际没跑图。

## 8. 边界与失败处理

| 场景 | 行为 |
|---|---|
| 目标文本为空/纯空白 | 400，复用既有 `ISSUE_GOAL_REQUIRED` 语义 |
| 目标文本超长 | 截断用于规则匹配，完整文本存入 `goal`；不报错 |
| Project 未绑定 workspace | 推荐阶段即返回阻塞，不等到确认才失败（既有 `PROJECT_WORKSPACE_REQUIRED`） |
| 无 Available adapter | 阻塞原因 `no_available_adapter` + 建议动作"在 Adapter Settings 中验证适配器" |
| 某节点的 required capability 无任何 adapter 覆盖 | v0.2 下必然等价于"无 `Implementation` 能力" → 阻塞 `NO_AVAILABLE_CAPABLE_ADAPTER`，**不降级**（降级后的 `sequential` 需要同一项能力，同样跑不了）。**仅有一个可用 adapter 不构成降级理由**（第 7 节） |
| 用户改选的 adapter 在确认时已不可用 | `RECOMMENDATION_STALE` + 指明该项（第 5 节） |
| 同一 token（`nonce`）重复确认 | 返回首次结果，不重复创建 Issue（第 6 节）。`recommendation_id` 只是内容摘要，不作身份判定依据 |
| 确认时前提已变 | `RECOMMENDATION_STALE` + 变化项 |

## 9. API 契约

上一轮把本节挂成"Phase 1 准入"，等于用一条待办把 `ready-for-development` 重新定义成"还不许开工"，与 `BACKLOG.md` 的状态定义和 `docs/features/README.md` 的硬约束冲突。既然 F006 第 8 节已经把跨 feature 契约定死，这里一并补完。

### `POST /api/projects/:projectId/intake/recommend`

```ts
// 请求
interface RecommendRequest { goal: string }   // 无 workspace_id，见下

// 200
interface RecommendResponse {
  token: ConfirmationToken;                  // 原样回传，勿解析
  recommendation_id: string;                 // 内容摘要，仅供显示/日志
  issue_type: Recommendation<IssueType>;      // v0.2 候选集恒为 {coding}，规则形状不因候选集大小为 1 而省略（第 3 节）
  issue_draft: { title: Recommendation<string>; goal: Recommendation<string>; priority: Recommendation<string> };
  workflow_template: Recommendation<{ id: string; version: number }>;
  collaboration_topology: Recommendation<{ value: "sequential" | "orchestrator_subagent";
                                          definition_id?: string; definition_version?: number }>;
  agent_roster: AgentRosterRecommendation;    // 专用 DTO，见下（不是 Recommendation<Record<string,string>>）
  editable: ("collaboration_topology" | "agent_roster")[];  // v0.2 仅此二者可改，见下
}

// 第 1 节 token payload 的 `recommended: RoutingRecommendation` 必须携带上面同一组五个
// 维度（issue_type / issue_draft / workflow_template / collaboration_topology /
// agent_roster）——token 是签名保护的唯一副本，缺了 issue_type 就等于这一维度完全没有
// 防篡改保护，也就无法在 confirm 时把它写进 coordinator.recommendation_applied 事件。

// roster 的候选与排除原因必须按节点区分——通用 Recommendation<T> 在 T =
// Record<string,string> 时，candidates: T[] 的语义会变成"整套 roster 组合"而不是
// "每个节点各自的候选"，且无法表达"同一 adapter 在节点 A 是候选、在节点 B 被排除"
// （2026-08-08 检视发现，见第 3 节）。
interface AgentRosterRecommendation {
  value: Record<string, string>;             // node_key（sequential 分支固定键 "sequential"） → adapter_config_id
  rule: string;                               // capability_match_and_effective_availability
  by_node: Record<string, {
    candidates: string[];                     // 该节点当前 workspace 下具备所需能力且 Available 的 adapter id
    excluded: { id: string; reason: string }[];
  }>;
  // value 与 by_node 的键集合必须严格一致：sequential 分支为 { "sequential" }，
  // 图分支为 definition 的全部 node_key（含 synthesis）。
}

// 409 —— 无可执行方案
interface RecommendBlocked {
  error: { code: "NO_AVAILABLE_ADAPTER" | "NO_AVAILABLE_CAPABLE_ADAPTER" | "PROJECT_WORKSPACE_REQUIRED";
           message: string; suggested_action: string };
}
```

| 情形 | 状态码 | 错误码 |
|---|---|---|
| `goal` 空 / 纯空白 | 400 | `ISSUE_GOAL_REQUIRED` |
| Project 未绑定 workspace | 409 | `PROJECT_WORKSPACE_REQUIRED` |
| 无任何 Available adapter | 409 | `NO_AVAILABLE_ADAPTER` |
| 有 Available adapter 但无一具备 `Implementation` | 409 | `NO_AVAILABLE_CAPABLE_ADAPTER`（**不降级为 `sequential`**，见第 7 节） |

### v0.2 只对 Project 默认 workspace 推荐（第五轮检视修正）

上一版让 `RecommendRequest` 接受可选 `workspace_id`，premise、adapter 有效状态、执行计划、目标文件集全部绑定这个目标 workspace。但确认路径复用的 `IssueService.create(projectId, input)` **签名里根本没有 workspace**，实现是 `const workspaceId = project.default_workspace_id`（`issue.ts:72`）。于是：

```text
推荐 / 验签 / 能力校验：workspace B
IssueService.create()：workspace A（Project 默认）
createGraph(issueId)：从 Issue 读到 workspace A
```

用 workspace B 的 adapter 状态与凭据判断去执行 workspace A 的代码——既违背推荐契约，也可能动错目录、用错凭据范围。

**v0.2 取方案 A：只支持默认 workspace。** 服务端把 `project.default_workspace_id` 写进 token，客户端**不能**指定其它 workspace。理由是既有前端本来就是单 workspace 模型（`useWorkspace(projectId)`），支持多 workspace 需要给 `IssueService.create()` 加显式 workspace 参数并改签名，属于超出 F007 意图的改动。

Project 未绑定默认 workspace → 推荐阶段即返回 `PROJECT_WORKSPACE_REQUIRED`（与既有 `create()` 的行为同源）。等真要支持多 workspace 时，再引入 `createInTransaction(tx, projectId, workspaceId, input)` 并加一条"Issue / GraphRun / Run / adapter 有效状态 / 目标文件集全部绑定同一 workspace"的端到端测试。

### `POST /api/projects/:projectId/intake/confirm`

```ts
interface ConfirmRequest {
  token: ConfirmationToken;      // 含 signature，服务端先验签
  chosen: ChosenPlan;
}

// 判别联合——topology 与 roster 形状绑死，内部不一致的组合过不了 HTTP 边界
type ChosenPlan =
  | { topology: "sequential"; adapter_config_id: string }
  | { topology: "orchestrator_subagent"; definition_id: string; definition_version: number;
      node_assignments: Record<string, string> };   // 键必须**恰好**等于 definition 的节点集
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
| 同 token 已确认 | 200 | 返回既有 `issue_id` / `target_id`（幂等，非错误） |
| 选中 adapter 缺该节点能力 | 409 | `ADAPTER_CAPABILITY_MISSING` |
| `orchestrator_subagent` 但 F006 未落地 | 409 | `TOPOLOGY_NOT_EXECUTABLE`（**禁止静默回退 `sequential`**） |
| `node_assignments` 未覆盖 definition 全部节点 | 400 | `GRAPH_PLAN_INCOMPLETE` |
| `node_assignments` 含 definition 之外的键 | 400 | `GRAPH_PLAN_UNKNOWN_NODE` |
| token 验签失败 / 缺 `signature` | 400 | `CONFIRMATION_TOKEN_INVALID` |
| 路由 `:projectId` 与 payload 的 `project_id` 不符 | 400 | `CONFIRMATION_TOKEN_INVALID` |

`chosen` 用判别联合而非平铺字段，是为了让"切成 sequential 却仍带着节点键"和"切成图却只有一个 `sequential` 键"这类内部不一致的组合**在边界就被 zod 拒掉**，而不是留到服务层再各写一遍互斥校验。`sequential` 分支的 `adapter_config_id` 同样经 `resolveEligibleAdapter()` 校验 `Implementation` 能力。`diff[]` 由归一化后的 `ChosenPlan` 与 token 中的 `recommended` 比对得出。

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
