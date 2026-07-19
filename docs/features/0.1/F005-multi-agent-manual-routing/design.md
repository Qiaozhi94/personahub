---
feature_ids: [F005]
related_features: [F002, F003, F004]
topics: [multi-adapter, claude-code, opencode, manual-routing, auth, handoff, validator-race]
doc_kind: design
created: 2026-07-16
updated: 2026-07-19
---

# F005：Manual Multi-Agent Routing（手动多 Agent 路由）- 设计

> Status: ready-for-development | Owner: TBD | Spec: `spec.md`

## 1. 技术概要

F005 把 F002 的单 provider registry扩展为 Codex、Claude Code、OpenCode三个真实 adapter，并把 Thread composer已有的 adapter选择正式提升为可审计的手动路由。每个 Run仍是 one-shot invocation，跨 agent上下文来自 F003 handoff/evidence，不依赖 CLI长会话。

```text
Thread command
  -> resolve explicit adapter or project default
  -> infer expected role from Issue status
  -> selected adapter capability matches expected role?
       yes -> workflow_bound (implementation | validator)
       no  -> ad_hoc_consult
  -> assemble issue + latest handoff + evidence + findings
  -> create Run with immutable routing metadata
  -> existing queue / workspace lock / AgentRunner
  -> adapter-specific protocol normalizer
  -> existing run.*, F003 trace, F004 validation hook
```

核心选择：

- OAuth由各 CLI自身管理；PersonaHub只引导用户在外部终端登录并验证登录态，不实现OAuth callback/token exchange，也不复制CLI token。
- OpenCode API key明文保存在本地SQLite；Repository内部可读，任何HTTP response、ThreadEvent、log均不得返回原值。
- `workflow_bound`不能由客户端强制声明；服务端根据Issue状态和adapter capability推导。客户端只能显式请求更安全的`ad_hoc_consult`。
- F004 已有的两条validator唯一索引（active + per-round，见§4.1）继续作为手动/自动互斥底线；F005增加10秒持久化grace window，让用户有机会手动选择跨provider validator。
- Claude Code接入协议级approval request作为前置可观测性/拒绝通道；OpenCode明确没有等价保证，仍以F002 credential isolation为安全主线。
- 不引入并行执行；咨询Run、implementation、validator都使用同一workspace FIFO锁。

## 2. 当前基线与影响面

### 2.1 复用与修改

| 基线 | 复用 | 修改 |
| --- | --- | --- |
| F002 AdapterConfig/Registry/AgentRunner | validate/start/queue/lock/escalation | provider/auth/config能力扩展 |
| F002 `POST /issues/:id/runs` | one-shot dispatch | adapter可选、purpose推导、routing metadata |
| F003 `RunTraceSignal`/handoff/evidence | 跨agent context、trace | 新adapter normalizer/capability |
| F004 Run role/state machine/parser | 手动validator完全复用 | 增加grace scheduler和manual winner |
| F004 validator unique index（active + per-round） | race正确性 | 不新建索引；claim按冲突类型分流 |
| 既有三栏UI | adapter settings/composer/Thread/Inspector | provider/auth/default/purpose展示 |

### 2.2 不得跨越的边界

- Adapter只负责CLI协议、鉴权材料注入、输出/trace规范化；不判断Issue状态或validation outcome。
- `ManualRoutingService`只分类和创建Run；validator结果仍由F004 `ValidationWorkflowService`处理。
- Route不读取或打码secret；public DTO由service显式构造，禁止直接序列化repository internal row。
- OAuth登录不从web server拉起交互式终端，避免不可控GUI/TTY和token截获。
- 新adapter不得通过继承完整用户环境绕过credential isolation。

### 2.3 文件影响面

- **shared**：provider/auth/purpose/capability/routing types与API contract。
- **server/db**：schema v6（v5 已被 F004 占用），adapter auth、Project default、Run purpose、validation dispatch due time。
- **server/repositories/services**：secret-safe adapter config、default adapter、routing classifier、context、grace scheduler。
- **server/runtime**：Claude/OpenCode adapter、protocol normalizers、auth material、provider registry、共享 executable resolver（含 Codex 启动方式收敛）。
- **server/api**：adapter auth fields、default adapter endpoint、Run request/response。
- **web**：多provider表单、masked auth状态、default选择、composer agent selector、consult badge。
- **tests/docs**：真实CLI probe、cross-adapter security、race/recovery和架构回写。

## 3. 共享类型与公开 Contract

新增/扩展 `shared/src/types/adapter.ts`、`run.ts`（若F003拆分后已有相应文件则就地扩展）：

```ts
export enum CliProvider {
  Codex = "codex",
  ClaudeCode = "claude-code",
  OpenCode = "opencode",
}

export enum AdapterAuthType {
  OAuth = "oauth",
  ApiKey = "api_key",
}

export enum AgentCapability {
  Implementation = "implementation",
  Validator = "validator",
  Consult = "consult",
}

export enum RunPurpose {
  WorkflowBound = "workflow_bound",
  AdHocConsult = "ad_hoc_consult",
}

// 扩展 F004 已有枚举，新增 Consult；持久化值保持 NOT NULL。
export enum RunRole {
  Implementation = "implementation",
  Validator = "validator",
  Consult = "consult",
}

// 扩展 F004 已有枚举，只新增 UserDefault。
export enum RunDispatchSource {
  UserExplicit = "user_explicit",
  UserDefault = "user_default",
  System = "system",
}
```

Public `AdapterConfig` 增加：

```ts
auth_type: AdapterAuthType
model_provider: string | null
has_api_key: boolean
auth_status_message: string | null
is_default: boolean // service projection, DB不在agent_configs重复存
capability_tags: AgentCapability[]
```

Public type永远没有`api_key`。Create/Update input可以包含write-only secret：

```ts
interface AdapterConfigCreateInput {
  cli_provider: CliProvider
  auth_type: AdapterAuthType
  name: string
  command: string
  args?: string[]
  default_model?: string
  model_provider?: string
  api_key?: string
  capability_tags: AgentCapability[]
  make_default?: boolean
}

interface AdapterConfigUpdateInput {
  // omitted api_key preserves; null clears; non-empty replaces
  api_key?: string | null
  // other editable fields...
}
```

`Run` 增加/扩展：

```ts
purpose: RunPurpose
role: RunRole // consult Run 持久化为 "consult"，不使用 null
dispatch_source: RunDispatchSource
context_source_run_id: string | null
```

客户端请求：

```ts
interface RunCreateInput {
  instructions: string
  adapter_id?: string       // omitted => Project default
  purpose?: "auto" | "ad_hoc_consult" // default auto；不能请求workflow_bound
}
```

## 4. 数据模型 / Migration

### 4.1 Schema v6

> 版本号说明：F004 已实际落地到 `server/src/db/schema-v5.ts` 并在 `migrations.ts` 注册到 5，因此 F005 的迁移是 **v6**（`schema-v6.ts`），不是设计初稿写的 v5。

```sql
ALTER TABLE agent_configs ADD COLUMN auth_type TEXT NOT NULL DEFAULT 'oauth';
ALTER TABLE agent_configs ADD COLUMN model_provider TEXT;
ALTER TABLE agent_configs ADD COLUMN api_key TEXT;
ALTER TABLE agent_configs ADD COLUMN auth_status_message TEXT;

ALTER TABLE projects ADD COLUMN default_adapter_config_id TEXT;

ALTER TABLE runs ADD COLUMN purpose TEXT NOT NULL DEFAULT 'workflow_bound';
ALTER TABLE runs ADD COLUMN context_source_run_id TEXT;

ALTER TABLE issues ADD COLUMN validation_dispatch_due_at TEXT;

CREATE INDEX IF NOT EXISTS idx_issues_validation_due
  ON issues(status, validation_dispatch_due_at)
  WHERE status = 'Validating' AND validation_dispatch_due_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_runs_issue_purpose_created
  ON runs(issue_id, purpose, created_at DESC);
```

说明：

- F004已提供`role/workflow_step/validation_round/dispatch_source`和两条validator唯一索引，v6不重复创建：
  - `idx_runs_one_active_validator`（v4）：`WHERE role='validator' AND status IN ('queued','running')`，只约束**在跑的**validator；
  - `idx_runs_validator_per_round`（v5）：`UNIQUE(issue_id, validation_round) WHERE role='validator' AND validation_round IS NOT NULL`，**跨终态**约束每轮至多一条validator Run。
  两条语义不同，§8.2 的 claim 冲突处理必须分别对待。
- F005 通过 shared enum 新增 `role='consult'`，继续使用 F004 的 `role TEXT NOT NULL`；无需重建 `runs` 表，也不得把 consult 伪存成 implementation。现有 partial unique index只匹配`role='validator'`，语义不变。
- 旧adapter解释为oauth，因为Codex既有登录态由CLI管理；旧Run为workflow_bound。
- `default_adapter_config_id`因SQLite ALTER限制不加列级FK，由service验证同Project，删除adapter前检查并清/拒绝。新建首个available adapter若Project尚无default，自动设为default；后续只能显式修改。
- `api_key`明文存储。DB/runtime文件继续由本地文件权限保护，备份泄漏风险在UI帮助文本中明确；日志、error details、events禁止包含该列。
- capability继续存`capability_tags` JSON；v6 migration把空数组按原`agent_configs.role`补为 `[implementation,consult]` 或 `[validator,consult]`。注意现状：`services/adapter-config.ts` 创建adapter时硬编码写入`capability_tags: []`，因此**现有全部adapter该字段都是空数组**；migration backfill只修历史数据，create路径必须在T026同步改为按provider/用户选择写入真实capability，否则新建adapter会立刻退化为无能力。迁移完成后`capability_tags`是能力判断唯一真相源，旧`agent_configs.role`只保留为兼容/主要展示角色，不再用于routing或自动ValidatorSelector。Repository解析非法JSON时将adapter标 unavailable，不猜能力。
- `validation_dispatch_due_at`仅在Validating grace window存在；validator成功创建后同transaction清空。

### 4.2 Secret-safe repository model

Repository使用内部类型`AdapterConfigRecord extends AdapterConfigPublicBase { api_key: string | null }`。Service通过`toPublicAdapter(record, project.default_adapter_config_id)`显式构造DTO。禁止`{...record, api_key: undefined}`这类容易回归的打码方式。

Update secret语义：

- omitted：保留；
- `null`：清空并令API-key adapter unavailable；
- trim后空string：400；
- 新值：替换，response只返回`has_api_key=true`。

API key不得进入ThreadEvent payload、validation context、handoff、diagnostic message、snapshot或测试fixture。

## 5. Adapter配置与鉴权

### 5.1 Provider/auth组合

| Provider | OAuth | API key | 默认command | 备注 |
| --- | --- | --- | --- | --- |
| codex | 支持 | 不在F005配置 | `codex` | 沿用现有app-server |
| claude-code | 支持 | 不在F005配置 | `claude` | CLI-owned login |
| opencode | 支持 | 支持 | `opencode` | API key需model_provider/model |

非法组合在service层返回`ADAPTER_AUTH_INVALID`。OpenCode API key模式要求`model_provider`、`default_model`、`api_key`均非空。OAuth模式禁止同时提交api_key；从api_key切到oauth时transaction清空旧key，避免悬挂secret。

### 5.2 OAuth流程

UI展示provider-specific登录指令和“Validate login”操作：

1. 用户在自己终端运行CLI官方登录命令。
2. PersonaHub不读取/保存token，只保存`auth_type=oauth`。
3. `POST /api/adapters/:id/validate`调用adapter `validate()`，执行短超时、非交互、只读的version/auth probe。
4. probe成功更新available/last_checked_at；失败更新unavailable和经过清洗的`auth_status_message`。

具体auth probe命令必须在Phase 1对本机版本确认。若CLI没有稳定的非交互auth status命令，使用最小无workspace写入的prompt probe；失败不得被`--version`成功误判为已登录。

### 5.3 OpenCode API key material

新增`runtime/auth-material.ts`：

```ts
interface AdapterAuthMaterial {
  env: Record<string, string>
  cleanup(): Promise<void>
}
```

API key模式根据集中allowlist把`model_provider`映射到CLI实际支持的环境变量/临时config协议；初始至少覆盖本地probe验证通过的provider。未知provider返回`ADAPTER_MODEL_PROVIDER_UNSUPPORTED`，不允许用户直接指定任意env name。

Material只在spawn前从repository读取并合入已经过credential isolation的child env；不写workspace，不进入`AgentRunInput.context`。若真实OpenCode版本要求配置文件，写入PersonaHub runtime临时目录、限制当前用户访问、Run terminal/shutdown/recovery时清理；设计优先使用进程env，具体映射由probe固化。

### 5.4 CLI-owned auth目录与git credential隔离

F002当前把HOME/USERPROFILE改到workspace，并只对白名单`CODEX_HOME`恢复Codex登录。F005将其重构为provider-specific auth directory injection：

- Codex只暴露`CODEX_HOME`；
- Claude Code只暴露probe确认的Claude配置目录变量/路径；
- OpenCode OAuth只暴露probe确认的OpenCode auth目录；
- 不恢复完整HOME、不继承SSH agent、GH/GitHub token或git credential helper；
- API-key模式无需暴露用户home auth目录。

如果某CLI无法在不恢复完整HOME的情况下使用OAuth，OAuth路径标为unavailable并提示使用已验证替代（OpenCode可用API key）；不能为了可用性撤掉credential isolation。

## 6. Adapter Runtime设计

### 6.1 Registry

`AgentAdapterRegistry`启动时注册三个singleton adapter，仍按`cli_provider`查实现。新增：

- duplicate provider register在开发/测试直接throw；
- `getForConfig`校验provider/auth capability；
- `listProviders()`给设置UI元数据使用（也可由shared常量生成，不暴露runtime secret）。

Config ID选择和provider实现选择分离：Run固定`adapter_config_id`，Registry根据该config的provider解析实现，不能接受客户端直接提供provider绕过Project scope。

F005 同时修改 F004 的自动validator候选查询：必须改为`status=available AND capability_tags contains 'validator'`，不再调用`listAvailableByProjectAndRole()`。

注意 `listAvailableByProjectAndRole()` 在基线上有**两个**调用点，必须一并切换，否则 recovery 路径会继续以旧 `agent_configs.role` 作真相源，形成双真相源：

- `server/src/services/validation/workflow-service.ts`（validation request 主路径）
- `server/src/services/validation/recovery-service.ts`（重启 recovery 路径）

手动routing和自动selection复用同一个`hasCapability(config, capability)`纯函数及JSON校验；`agent_configs.role`仅用于旧数据迁移和UI主要角色标签。切换完成后 `listAvailableByProjectAndRole()` 应无剩余调用点，可直接删除以防回归。

**统一进程启动：可执行文件解析与 `shell=false`**

三个 adapter 必须统一以 `shell=false` 启动子进程。这不是风格偏好，而是本设计其余安全论证的前提：`shell=true` 时命令串要经 `cmd.exe` 解释，"instructions 绝不进 argv"（§6.3）和"API key 绝不进 argv"（§5.3）就失去了确定性保证，而三个 provider 若在这一点上不一致，安全边界也无法统一表述。

基线现状与之冲突，需在实现时一并收敛。F002 的 Codex 路径当前是 `shell: process.platform === "win32"`（`runtime/adapters/codex-cli-adapter.ts`、`codex-protocol.ts`），原因是本机实测三个 CLI 的安装形态并不一致：

| CLI | 路径形态 | `shell=false` 可直接启动 |
| --- | --- | --- |
| Claude Code | `claude.exe`，真 exe | 是 |
| OpenCode | `opencode.cmd`，批处理 shim | 否 |
| Codex | `codex.cmd`，批处理 shim | 否 |

Node 的 `spawn` 在 `shell:false` 下无法直接执行 `.cmd`，F002 当时选择开 shell 绕过。正确解法是在启动前做一次可执行文件解析：`.cmd`/`.bat` shim 通常只是一层转发（实测 `opencode.cmd` 转发到 `node_modules/opencode-ai/bin/opencode.exe`），解析出真实 exe 路径后即可全部走 `shell=false`。

因此设计上新增一个共享的 executable resolver，位于 adapter 启动路径之前、对三个 provider 一视同仁：

- 输入用户配置的 command，经 PATH 查找后若命中 shim，则解析其转发目标；
- 解析失败**不得静默回退到 `shell=true`**，而是把该 adapter 标为 unavailable 并给出明确原因——否则安全降级会在用户无感知的情况下发生；
- 非 shim 的普通可执行文件直通，不做多余处理；
- Codex 一并切换，`shell: process.platform === "win32"` 从基线移除，F002 既有启动/probe 测试作为回归门槛。

对应任务见 `tasks.md` T009a，它阻塞 Claude（T037）和 OpenCode（T044）的 argv 断言。

### 6.2 Protocol probe与normalizer

实现前必须记录实际CLI版本和redacted fixtures：

- Claude Code：one-shot print、stream JSON、final assistant message、tool/command start/end、control request/response、cancel、nonzero/auth failure。
- OpenCode：one-shot run、JSON/structured output（若有）、final message、tool/command事件、cancel、nonzero/auth failure、OAuth/API-key两种环境。

每个adapter用独立normalizer把raw协议转成已有`RunOutputChunk`、F003 `RunTraceSignal`、`RunExitResult.finalMessage`。Raw JSON不落库。未知消息忽略并降低trace completeness，不导致整个Run失败。

### 6.3 ClaudeCodeAdapter

预期使用Claude CLI的非交互print + stream-json模式，prompt经stdin或明确argv传递，`cwd=workspace`、`shell=false`（启动方式统一见§6.1"统一进程启动"；Claude 本身是真 exe，无需 shim 解析）。最终argv以probe为准，禁止把instructions/API key拼进命令行。

权限：

- 不使用`bypassPermissions`/危险自动批准flag；
- 接收到真实`control_request`时，git push/force push按F002策略拒绝并触发`PreExecutionApprovalRejected`；
- 其他请求按F002现有P0策略允许并记录structured trace；
- 即使协议hook缺失，child env credential isolation仍生效；capability UI区分“pre-execution approval available/unavailable”。

取消使用CLI协议/进程signal的最温和路径，超时后强制终止；必须保证onExit只触发一次。

### 6.4 OpenCodeAdapter

使用probe确认的one-shot命令和结构化输出模式，同样`cwd=workspace`、`shell=false`；OpenCode 本机为 `.cmd` shim，必须经§6.1的 executable resolver 解析后启动。OpenCode无消息级approval保证：

- 不对UI宣称pre-execution interception；
- 依赖credential-isolated env阻止push，结合stderr/structured command结果触发`CredentialIsolationBlocked`；
- 不启用会扩大filesystem/network权限的dangerous flag，除非probe证明非交互运行必需且其含义仅是关闭CLI自身prompt；若必须使用，UI capability note明确其边界，F002主防线仍必须通过测试。

若当前版本不能给出confirmed command/test trace，adapter仍可用于consult/implementation，但`supportsStructuredTrace=false`；F004 policy不会因此伪造pass。

### 6.5 Context assembly

新增`RunContextBuilder`统一替换F002在`startAdapter()`里手拼的五行文本：

1. Issue title/goal/current status和当前指令；
2. 当前workflow role/purpose及“consult不改变Issue状态”说明；
3. 根据Run purpose选择context source：validator严格使用其`implementation_run_id`对应的handoff；其余Run使用创建时间早于当前Run的最新eligible `handoff.created`；
4. 只解析所选source Run scope内的handoff evidence refs、file changes/verification；
5. F004 latest failed round findings（workflow implementation时）；
6. trace completeness/missing refs警告。

`context_source_run_id`指向最终选定的handoff源Run。Workflow validator必须令它等于`implementation_run_id`；该`implementation_run_id`即F004本轮`validation.requested` payload中固化的值（见F004 §5.3），在此直接读取、不重新推导。即使Validating grace期间有consult Run产生更新handoff，也不得改变被验证对象。普通implementation/consult第一轮无handoff时为null并正常运行。上下文上限/secret/path规则沿用F004；不复制完整Thread聊天或raw output。

## 7. 手动路由与Run分类

### 7.1 Default adapter

`AdapterResolver.resolve(issue, adapterId?)`：

- 显式ID：必须属于Issue Project且available，source=`user_explicit`；
- omitted：读取Project.default_adapter_config_id，必须available，source=`user_default`；
- default缺失/不可用：`DEFAULT_ADAPTER_UNAVAILABLE`，不随机fallback到列表第一项。

UI始终显示当前default；下拉选择“Project default — <name>”或具体adapter。设置页提供“Set default”，删除default前必须先换default，除非Project已无其他adapter且用户确认清空。

### 7.2 Expected role与purpose推导

```text
Inbox / Ready / Running -> expected implementation
Validating              -> expected validator
Done / Blocked          -> no Run allowed
```

规则：

1. 请求`purpose=ad_hoc_consult`时始终consult（仅非终态）。
2. `purpose=auto`/omitted时，selected adapter capability包含expected role => workflow_bound +该role。
3. 不包含expected role => ad_hoc_consult + role=consult。
4. Validating时只有validator capability可命中；implementation-only adapter不会误推进validation。
5. `capability_tags`可包含多项；当前Issue状态决定本次唯一role，不由adapter自行选择。

这细化了spec `FR-007`：Running阶段期望implementation；“Running时@ validator”是consult，“Validating时@ validator”才是workflow-bound。否则F004 fail后的用户修复Run无法回到自动验证闭环。

### 7.3 状态影响

- Ready/Inbox的workflow implementation沿用F002进入Running。
- Running的workflow implementation保持Running，完成后触发F004 validation。
- workflow validator只允许Validating并复用F004。
- consult创建/queued/running/completed都不修改Issue status、round count或workflow step。
- consult发生escalation仍按安全优先原则把Issue Blocked；“不驱动状态机”不等于绕过安全状态。
- Done/Blocked拒绝所有新Run。Blocked必须先走对应operator recovery。

### 7.4 Create transaction与events

Run创建事务中重新读取Issue/adapter/default，推导purpose/role，并按F004 §3的`role -> workflow_step`派生表固化`workflow_step`（workflow-bound implementation写`"implementation"`，consult写`null`），写Run和`run.queued`。Payload增加：

```json
{
  "purpose": "ad_hoc_consult",
  "role": "consult",
  "dispatch_source": "user_explicit",
  "adapter_config_id": "...",
  "cli_provider": "opencode",
  "context_source_run_id": "...",
  "drives_issue_state": false
}
```

Consult terminal复用`run.completed/failed/...`，每个run event都带purpose/role；不新增重复的`consult.completed`事件。Thread UI据字段展示“Consult · does not change workflow”。

### 7.5 Queue drain eligibility扩展

F004的出队重验规则在F005扩展为：

```text
implementation -> Inbox / Ready / Running
validator      -> Validating，且validation round匹配
consult        -> Inbox / Ready / Running / Validating
```

Done/Blocked下所有queued Run、以及状态已推进后不再匹配的implementation/validator Run，都以`issue_state_changed_before_start`取消并继续drain。Consult可在Validating运行，但其handoff不会成为validator的context source。不同Issue的eligible Run仍按workspace FIFO，不为validator建立跨Issue优先队列。

被这样取消的stale Run携带的是用户原始指令，属于静默丢弃的风险点：Thread/composer必须以明确文案展示`issue_state_changed_before_start`（例如“该指令因 Issue 进入验证阶段被取消，请在验证结束后重发”），不得让用户误以为指令已执行（对应§10.3 Thread Run card和T095 consult/routing card测试）。

## 8. 手动/自动Validator互斥

### 8.1 10秒grace window

F005修改F004 request流程：implementation完成后仍在同一事务进入Validating并写`validation.requested`，但不立即创建自动Run；设置`validation_dispatch_due_at = now + 10s`。UI立即显示“Choose a validator within 10s / Use default now”。

计时不是前端定时器真相：`ValidationDispatchScheduler`每秒查询due Issue，server startup也reconcile。10秒是集中常量`MANUAL_VALIDATOR_GRACE_MS`，P0不做用户配置。

`MANUAL_VALIDATOR_GRACE_MS` 必须**可注入**（构造参数或依赖注入，默认 10s），不能写死读取模块常量。理由：这条 grace 改变了 F004 既有自动闭环的时序——implementation 完成后不再立即产生 validator Run。F004 现有的自动验证集成测试如果只能等真实 10 秒，要么整体变慢，要么退化成时间敏感的脆测试。测试注入 0ms 即可保持 F004 原有的"立即创建"语义，回归成本为零。

`POST /api/issues/:id/validation`沿用F004接口，F005语义为“Use default now”：清due并尝试创建默认validator。

### 8.2 Winner transaction

手动validator创建和scheduler自动创建都调用同一个`claimValidatorSlot()` transaction：

1. 确认Issue仍Validating；
2. 确认round与requested event一致；
3. 前置检查：先查 active validator（`getActiveValidator`），再查本轮 validator（`getValidatorRunByRound`）——这两条检查在基线 `workflow-service.ts` 中已经成对存在，拆出 `claimValidatorSlot()` 时必须**两条都搬**，只搬 active 那条会引入回归；
4. 尝试插入`role=validator,status=queued`；
5. 两条DB唯一索引共同决定winner（见§4.1）；
6. winner清`validation_dispatch_due_at`并写run.queued；
7. loser按冲突类型分流，见下表。

**冲突分流**（前置检查和索引冲突走同一套语义，前置检查只是提前拿到更好的错误信息）：

| 冲突类型 | 判定 | 自动loser（scheduler） | 手动loser（用户请求） |
| --- | --- | --- | --- |
| active 冲突：本轮已有 `queued`/`running` validator | 命中 `idx_runs_one_active_validator` | 幂等结束，不写event | `VALIDATOR_RUN_CONFLICT` 409 + active run 摘要 |
| per-round 冲突：本轮已有 validator 但已终态（completed/failed/cancelled） | 命中 `idx_runs_validator_per_round`，且 active 为空 | 幂等结束，不写event | `VALIDATOR_RUN_CONFLICT` 409 + 该终态 run 摘要及"本轮已验证过"说明 |

per-round 冲突是 active 索引挡不住的真实场景：本轮 validator 已被 `issue_state_changed_before_start` 取消或已失败时，active 为空但 per-round 索引仍然拦截插入。**此时一律拒绝，不允许同轮重试、不 bump round**——这维持 F004 既有的"每轮至多一条 validator"语义，重新验证必须走 F004 正常的 fail→Running→下一轮路径产生新 round。设计上不得出现"active 为空即可插入"的假设，loser 分支必须先区分是哪一条索引冲突，不能无条件读 active validator（那样在 per-round 冲突时会拿到 null 并落入未定义状态）。

应用层前置检查只改善错误信息，不承担正确性。Consult Run不命中任一唯一索引，允许在Validating期间排队/执行，但仍受workspace锁。

### 8.3 Crash/restart

- due timestamp持久化，重启后已过期立即dispatch；未过期继续等待剩余时间。
- Issue Validating且due为空、active validator为空：F004 recovery先检查terminal result；都无则判`recovery_inconsistent`并Blocked，不盲目再创建。
- 手动request提交成功但HTTP响应丢失，重试看到同一active validator时可按request identity返回；P0不新增Idempotency-Key，普通双击race由unique constraint转明确冲突。

## 9. API / Contract设计

### 9.1 Adapter CRUD

沿用既有路径，create/patch支持第3节字段。API规则：

- provider/auth/model/capability用Zod/显式schema校验；
- response只含`has_api_key`和masked状态，不含secret；
- `validate`执行provider adapter真实auth probe，不再由service统一`--version`；
- list同时返回不可用adapter及原因，供selector禁用。

### 9.2 Default adapter

```http
PUT /api/projects/:project_id/default-adapter
{ "adapter_id": "..." }
```

adapter必须同Project且available。成功返回public adapter。允许`adapter_id:null`只在Project没有adapter时清空；正常用户不能把有可用adapter的Project留在隐式随机状态。

### 9.3 Run creation

`POST /api/issues/:issue_id/runs`使用新input。Response仍`{run}`，Run包含purpose/role/source/context source。服务端忽略/拒绝未知的`role`、`workflow_step`、`dispatch_source`字段，防止客户端伪造系统Run。

### 9.4 Provider metadata

```http
GET /api/adapter-providers
```

返回三个provider的supported auth types、默认command、capability说明和API-key model provider allowlist，不返回本机secret/path。UI用它驱动表单，避免硬编码两份规则。

### 9.5 新错误码

| ErrorCode | HTTP | 场景 |
| --- | --- | --- |
| `ADAPTER_AUTH_INVALID` | 400 | provider/auth组合或字段非法 |
| `ADAPTER_API_KEY_REQUIRED` | 400 | OpenCode API-key缺secret |
| `ADAPTER_MODEL_PROVIDER_UNSUPPORTED` | 400 | 未验证provider映射 |
| `DEFAULT_ADAPTER_UNAVAILABLE` | 409 | 未配置/失效/default跨Project |
| `RUN_PURPOSE_INVALID` | 400 | 客户端尝试强制workflow-bound/未知值 |
| `RUN_NOT_ALLOWED_FOR_ISSUE_STATUS` | 409 | Done/Blocked派发 |
| `VALIDATOR_RUN_CONFLICT` | 409 | 手动validator输掉唯一slot（active冲突），或本轮已有终态validator（per-round冲突）；response需区分两者以给出正确文案 |

## 10. UI设计

### 10.1 Adapter Settings

创建/编辑dialog：provider -> auth type -> provider-specific字段逐级显示；capability用Implementation/Validator/Consult复选框。API key输入永不回填，已配置显示“Configured ••••”；替换/clear是显式动作。

列表展示provider、model、capabilities、OAuth logged in/API key configured、availability和default badge。不可用原因使用清洗后的message。OAuth区域给出可复制登录命令和“Validate login”，不声称PersonaHub完成登录。

### 10.2 Composer selector

selector始终可见，不因只有一个adapter而隐藏：

- 第一项为Project default并标名称/provider；
- available adapters可选；unavailable保留但disabled并说明原因；
- 显示capability和当前推导结果（“Implementation workflow”/“Validator workflow”/“Consult only”）；
- Validating grace期间显示倒计时仅作提示，server due timestamp是真相；提供“Use default validator now”。

发送后card显示实际adapter/provider/source，避免default在之后修改造成历史误解。

### 10.3 Thread/Inspector

Run cards增加purpose badge和provider/model；consult使用中性样式和明确文案“不改变Issue workflow”。Inspector latest run展示routing metadata和context source handoff链接。Validation card在手动winner时展示“Manually selected validator”。

## 11. Event / Trace设计

不新增新的顶层event type。扩展所有`run.*`公共payload：

```json
{
  "adapter_config_id": "...",
  "cli_provider": "claude-code",
  "purpose": "workflow_bound",
  "role": "validator",
  "dispatch_source": "user_explicit",
  "context_source_run_id": "...",
  "drives_issue_state": true
}
```

- OAuth/API key值、auth目录、provider env name不得写event。
- F003 command/test/handoff事件自然携带Run ID，通过Run读取routing metadata，不在每个trace payload重复secret-free config snapshot。
- F004 validation requested/result payload记录实际validator config/provider和manual/system source。
- SSE replay/cursor完全沿用现有contract。

## 12. 失败处理与安全

| 场景 | 行为 |
| --- | --- |
| CLI未安装 | validate unavailable；selector disabled |
| shim无法解析出真实可执行文件 | adapter标unavailable并说明原因；**不回退`shell=true`** |
| OAuth过期/未登录 | auth probe unavailable，不把version成功当可用 |
| API key错误 | validate清洗错误；DB保留key供用户替换，不回显 |
| OAuth+API key同时提供 | 400；不猜优先级 |
| default adapter不可用 | dispatch失败并明确提示，不随机fallback |
| handoff不存在/refs missing | 第一轮正常；missing ref显式进入context completeness |
| Claude control request git push | 前置拒绝 + escalation + Blocked |
| Claude hook不可用 | credential isolation仍挡push，capability如实降级 |
| OpenCode git push | credential isolation主防线；不承诺前置拦截 |
| adapter raw protocol malformed | trace partial；Run可继续，validator缺可靠finalMessage则Blocked |
| concurrent manual/auto validator | DB unique决定winner；无重复Run |
| 本轮validator已终态后再次claim | per-round索引拦截；manual收409+终态run摘要，scheduler幂等结束；不bump round |
| consult在Validating期间完成 | Issue保持Validating；scheduler/validator照常 |
| consult触发危险操作 | Issue Blocked，取消其余queued workflow Run |
| server grace期间重启 | 按due_at恢复剩余等待/立即dispatch |

`buildChildEnv`安全回归必须对三个provider分别验证：无SSH agent、无git helper、无GH token，只有最小CLI auth material；API key不得出现在process argv。

## 13. 测试策略

### 13.1 Protocol probes

- 记录三个CLI版本和redacted fixtures。
- Claude OAuth auth probe、final message、command trace、control request、cancel。
- OpenCode OAuth/API-key probe、final message/trace、cancel和无approval边界。
- Windows executable/path/Unicode/空格行为。

### 13.2 Unit

- provider/auth字段矩阵、write-only secret DTO、masking。
- registry duplicate/provider lookup、capability匹配。
- role/purpose classifier覆盖全部Issue status和multi-capability。
- default resolver和cross-project guard。
- context builder latest handoff/first run/missing refs/findings/limits。
- Claude/OpenCode normalizer与secret redaction。
- grace due计算和winner conflict映射。

### 13.3 Integration

- v5 -> v6 migration、旧config/Run兼容、secret不出API/event。
- 三provider create/update/validate/list/default。
- explicit/default dispatch routing metadata。
- Codex -> Claude -> OpenCode顺序Run自动携带上一handoff。
- Ready/Running implementation命中、Validating validator命中、mismatch consult。
- consult不改状态/round；escalation仍Blocked。
- manual validator pass/fail复用F004 summary/state machine。
- manual/auto并发race两种winner、active冲突与per-round冲突两类HTTP conflict、无重复queued/running validator。
- grace restart recovery。
- 三provider credential isolation/escalation。

### 13.4 UI / E2E

- provider/auth动态表单、API key不回填、OAuth引导。
- default badge/设置/失效错误。
- selector显式显示default、disabled reason、purpose preview。
- consult/workflow cards和manual validator grace交互。
- existing F001-F004 flows回归。

## 14. 设计决策

| 决策 | 理由 | 替代方案 |
| --- | --- | --- |
| OAuth交给CLI自身 | 避免复制token和实现三个OAuth流程，符合local-first | PersonaHub内置OAuth callback；scope和维护成本大 |
| API key明文DB + public DTO完全移除 | 遵循spec从简并避免UI/log泄漏 | OS keychain；超出本feature |
| Project持久化default adapter | 未选择时必须确定且可解释 | 列表第一项；删除/排序后行为漂移 |
| 服务端推导workflow-bound | 防止客户端错误/恶意驱动状态机 | 客户端直接传role；不可信 |
| 允许显式强制consult，不允许强制workflow | consult是安全降级，workflow需要状态/capability证明 | 完全无purpose字段；难满足IR-002和高级用法 |
| Running期望implementation | 保证F004 fail后的修复Run能继续闭环 | Running所有@均consult；闭环无法推进 |
| 10秒持久化grace | 满足手动validator介入且可跨重启 | F004立即创建；用户几乎无法抢先；纯前端timer不可靠 |
| DB partial unique决定validator winner | 跨async callback/restart正确 | 进程内mutex；无法覆盖DB race |
| per-round冲突一律拒绝，不同轮重试 | 维持F004"每轮至多一条validator"既有语义，重验走正常fail→Running→新round | 允许同轮重插；破坏round与证据的一一对应 |
| grace常量可注入 | F004既有自动闭环测试注入0ms即可保持原时序，不因F005变慢或变脆 | 硬编码模块常量；F004回归测试被迫真等10秒 |
| provider-specific最小auth env | 兼顾CLI登录与git凭据隔离 | 恢复完整HOME；可能读取git凭据 |
| 三adapter统一shell=false + shim解析 | argv安全论证需要确定性，三provider不能各行其是；顺带收掉F002的Windows shell=true | 保留shell=true；instructions/API key的argv保证失效 |
| shim解析失败标unavailable，不回退shell | 安全降级不得在用户无感知时发生 | 静默回退；边界被悄悄放宽 |
| OpenCode不承诺前置approval | 没有可靠协议证据，诚实表达能力 | 根据flag宣称等价approval；误导安全性 |
| 同一workspace继续FIFO | 维持F002证据归因和写安全 | 多agent并行写；超出v0.1 |

### 14.1 Requirement → Design映射

| Requirement | 设计落点 |
| --- | --- |
| `FR-001` Claude Code | 5.1-5.2 OAuth、6.2-6.3 protocol/adapter |
| `FR-002` OpenCode | 5.1-5.4 API key/OAuth/auth material、6.4 adapter |
| `FR-003` Registry | 6.1 provider registry与config解析 |
| `FR-004` 手动选择 | 7.1 default、7.2分类、9.2-9.3 API、10.2 selector |
| `FR-005` 上一轮上下文 | 6.5 context assembly、7.4 routing metadata |
| `FR-006` 手动Validator | 7.2 role推导、8 winner、复用F004状态机 |
| `FR-007` 咨询Run | 7.2-7.4 purpose与状态影响、10.3展示 |
| `FR-008` Escalation | 5.4最小auth env、6.3/6.4 provider能力、12安全收敛 |
| `FR-009` Validator互斥 | 4.1复用partial unique、8 grace/winner/recovery |

## 15. 待确认设计问题

目前没有未关闭的设计问题：

- **已关闭：Claude/OpenCode精确CLI协议**——领域contract、失败fallback和安全边界已确定；实现前probe只固化argv/消息字段/auth目录映射。若拿不到可靠final message/trace，对应capability降级，validator不得伪通过。
- **已关闭：OAuth实现范围**——CLI-owned login + PersonaHub validation，不实现内置OAuth。
- **已关闭：OpenCode secret存储**——本地SQLite明文，HTTP/event/log完全不返回。
- **已关闭：workflow/consult判定**——按Issue expected role和capability推导；Running期望implementation；客户端可强制consult但不能强制workflow。
- **已关闭：manual/auto validator时序**——10秒持久化grace + F004 partial unique winner；“Use default now”复用validation endpoint。
- **已关闭：OpenCode escalation**——credential isolation是主防线，不宣称协议级前置拦截。
- **已关闭：default行为**——Project显式持久化default，不随机fallback。

上述真实CLI验证均写入`tasks.md` Phase 1；验证失败有已拍板的capability downgrade或unavailable路径，不阻塞开始开发。

## 16. 实现后回写

- `docs/personahub-system-design.md`：更新Agent auth/public-secret边界、Project default、Run purpose/source/context source、Issue validation due。
- `docs/personahub-architecture.md`：将三个adapter实际capabilities、provider-specific auth env、manual routing/grace scheduler写回。
- `docs/decisions/0002-first-agent-adapter.md`保持“Codex是第一个adapter”的历史决策，不改写为唯一adapter。
- 完成验收后更新`BACKLOG.md`、三件套Status和`CLAUDE.md`。
