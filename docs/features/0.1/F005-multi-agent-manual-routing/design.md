---
kind: feature
id: F005
version: "0.1"
related_features: [F002, F003, F004]
topics: [multi-adapter, claude-code, opencode, manual-routing, auth, handoff, validator-race]
doc_kind: design
created: 2026-07-16
updated: 2026-08-09
---

# F005：Manual Multi-Agent Routing（手动多 Agent 路由）- 设计

> Owner: TBD | Spec: `spec.md`

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
- Claude Code接入`PreToolUse` hook（经`--settings`注册，已本机实测确认，见§6.3）作为前置可观测性/拒绝通道；OpenCode明确没有等价保证，仍以F002 credential isolation为安全主线。
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

// 只描述"能承担哪个 workflow 角色"。consult 不是 capability——
// 三个已接入 CLI 天然都能对话，把它做成可禁用只会凭空造出一个失败模式
// （用户取消勾选 -> mismatch 时无法降级 -> 报错），对用户没有价值。
// consult 是 routing 的 purpose/role，见 RunPurpose / RunRole。
export enum AgentCapability {
  Implementation = "implementation",
  Validator = "validator",
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
- **旧 Project 必须回填 default，否则是回归**：升级前的 Project 已有 Codex adapter，迁移后该列为 `NULL`；而 F005 把 `adapter_id` 改为 optional 后，省略 adapter 的 dispatch 会直接返回 `DEFAULT_ADAPTER_UNAVAILABLE`，等于打断既有 F002 使用路径。回填策略**不采用"按 created_at 取第一条 available"**——那正是 §7.1 明令禁止的"列表第一项"启发式，会把一个任意选择固化成用户以为自己设过的默认值。采用收紧版：

  ```text
  Project 恰好有 1 个 available adapter -> 回填为该 adapter
  Project 有 0 个或 ≥2 个 available adapter -> 保持 NULL
  ```

  留 `NULL` 的 Project 由 UI 在首次省略 adapter 的 dispatch 时强制用户显式选择一次 default（`DEFAULT_ADAPTER_UNAVAILABLE` 的前端处理，见 §10.2）。单 adapter 场景（升级用户的绝大多数）零感知，多 adapter 场景不替用户瞎猜。
- `api_key`明文存储。DB/runtime文件继续由本地文件权限保护，备份泄漏风险在UI帮助文本中明确；日志、error details、events禁止包含该列。
- **`agent_configs.role` 正式标记为 deprecated internal field**。该列是 `NOT NULL DEFAULT 'implementation'`，而 F005 的新 create/update contract 只接收 `capability_tags`、不再接收 role。若不定义写入规则，validator-only adapter 会静静地持久化成 `role='implementation'`，形成新的双真相源。规则：
  - 不在任何 public DTO、API response 或 UI 中出现；
  - 写入规则确定性派生自 `capability_tags`，仅为满足 NOT NULL 约束：含 `validator` 写 `'validator'`，否则写 `'implementation'`（含仅 implementation、以及既不含 validator 也不含 implementation 的边界情形）；
  - 该派生值**绝不参与 routing 或 validator 选择**，`capability_tags` 是唯一真相源；
  - repository/service/migration 测试必须断言 capability 更新后 role 派生值稳定且不影响任何选择逻辑。

  不新增 `primary_capability` 字段——UI 的主要角色标签可直接从 `capability_tags` 计算，没必要再引入一列。
- capability继续存`capability_tags` JSON；v6 migration把空数组按原`agent_configs.role`补为 `[implementation]` 或 `[validator]`。注意现状：`services/adapter-config.ts` 创建adapter时硬编码写入`capability_tags: []`，因此**现有全部adapter该字段都是空数组**；migration backfill只修历史数据，create路径必须在T026同步改为按provider/用户选择写入真实capability，否则新建adapter会立刻退化为无能力。迁移完成后`capability_tags`是能力判断唯一真相源，旧`agent_configs.role`只保留为兼容/主要展示角色，不再用于routing或自动ValidatorSelector。Repository解析非法JSON时将adapter标 unavailable，不猜能力。
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

**availability 是"最近一次验证结果"，不是实时状态**。P0 采用 validate-on-demand，不做周期性后台 probe，因此列表里的 available 可能已经过期（OAuth 在上次验证后失效）。UI 与文案必须如实表达这一点，不得声称实时：

- 列表展示状态时**必须同时展示 `last_checked_at`**，让用户知道这是何时的结论；
- **dispatch 或 Run 期间遭遇 auth failure，必须把该 adapter 更新为 unavailable** 并保存清洗后的原因——这是过期状态的主要收敛路径，比后台轮询更省资源也更准确；
- 周期性 probe 标为后续增强，需要时再明确 scheduler、频率和资源边界，P0 不做。

spec US1 场景 4「查看 Agents 列表时显示失效」据此理解为：列表反映最近一次验证 + 任何一次失败 dispatch 的收敛结果，而非打开页面即实时探测。

### 5.3 OpenCode API key material

新增`runtime/auth-material.ts`：

```ts
interface AdapterAuthMaterial {
  env: Record<string, string>
  cleanup(): Promise<void>
}
```

API key模式根据集中allowlist把`model_provider`映射到CLI实际支持的环境变量/临时config协议；初始至少覆盖本地probe验证通过的provider。未知provider返回`ADAPTER_MODEL_PROVIDER_UNSUPPORTED`，不允许用户直接指定任意env name。

已用本机 OpenCode 1.18.3 零成本实测（仅本地 `opencode models` listing，未发生真实计费 API 调用）确认标准 `<PROVIDER>_API_KEY` 环境变量约定真实有效，`AdapterAuthMaterial.env` 的设计（进程 env 注入，不落 workspace/config 文件）无需改动。初始 allowlist：

| `model_provider` | 环境变量 |
| --- | --- |
| `openai` | `OPENAI_API_KEY` |
| `anthropic` | `ANTHROPIC_API_KEY` |
| `deepseek` | `DEEPSEEK_API_KEY` |
| `google` | `GEMINI_API_KEY`（或 `GOOGLE_API_KEY`） |
| `openrouter` | `OPENROUTER_API_KEY` |
| `groq` | `GROQ_API_KEY` |
| `mistral` | `MISTRAL_API_KEY` |
| `xai` | `XAI_API_KEY` |
| `togetherai` | `TOGETHER_API_KEY` |
| `perplexity` | `PERPLEXITY_API_KEY` |

**重要澄清**：OpenCode 本身**不内置固定的 provider 枚举**——`opencode models` 在真实（污染的）操作员环境下会混入个人 `opencode.jsonc` 里的自定义 provider 别名（如 `heiyucode-openai`），不能作为基准；已用隔离 `HOME` 下全新配置验证，干净安装只有内置免费的 `opencode/*` 模型，上表列的 provider id 是**PersonaHub 自定义的 allowlist**，通过设置对应环境变量并观察 provider 是否出现在 `opencode models` 列表来确认，不是 OpenCode 文档化的固定契约。详见 `server/tests/helpers/opencode-protocol-fixtures.md` T007。

Material只在spawn前从repository读取并合入已经过credential isolation的child env；不写workspace，不进入`AgentRunInput.context`。若真实OpenCode版本要求配置文件，写入PersonaHub runtime临时目录、限制当前用户访问、Run terminal/shutdown/recovery时清理；设计优先使用进程env，具体映射由probe固化。

### 5.4 CLI-owned auth目录与git credential隔离

F002当前把HOME/USERPROFILE改到workspace，并只对白名单`CODEX_HOME`恢复Codex登录。F005将其重构为provider-specific auth directory injection：

- Codex只暴露`CODEX_HOME`；
- Claude Code只暴露probe确认的Claude配置目录变量/路径；
- OpenCode OAuth **在 Windows 上不暴露任何 auth 目录**（Phase 1 "暴露 XDG_DATA_HOME/XDG_CONFIG_HOME" 的原始前置规则已被 Phase 13 真实环境测试推翻——见下方矩阵与 superseded 说明；当前是 workspace-aware fail closed，仅在目标 workspace `push_credentials_enabled=true` 时才可用）；
- 不恢复完整HOME、不继承SSH agent、GH/GitHub token或git credential helper（隔离模式下也不继承其他 model provider 的 API key，见 §11）；
- API-key模式无需暴露用户home auth目录。

如果某CLI无法在不恢复完整HOME的情况下使用OAuth，OAuth路径标为unavailable并提示使用已验证替代（OpenCode可用API key）；不能为了可用性撤掉credential isolation。

**已用本机三个 CLI 实测确认，Codex/Claude Code 不需要恢复完整 HOME；OpenCode 在 Windows 上的结论已被 Phase 13 真实环境测试推翻，见下方 superseded 说明**：

| Provider | 隔离机制 | 备注 |
| --- | --- | --- |
| Codex | `CODEX_HOME`（F002 已实现） | 沿用既有白名单 |
| Claude Code | `CLAUDE_CONFIG_DIR` 指向真实 `~/.claude` 目录 | 已验证：`HOME`/`USERPROFILE` 完全隔离、仅设置此变量指向真实 `.claude` 文件夹，`claude auth status` 仍正确返回真实登录态。**已知良性副作用**：stderr 会打印一条关于顶层 `.claude.json`（不在 `CLAUDE_CONFIG_DIR` 指向的文件夹内，而在其父目录）"not found" 的警告并提示 backup 恢复命令——这是 2.1.215 内部路径解析的一个不一致（部分状态存在 `<home>/.claude.json`，部分在 `<home>/.claude/` 内），登录探测本身不受影响。adapter 必须容忍/静默这条 stderr 警告，不得当作探测失败。 |
| OpenCode（**superseded，见下**） | ~~`XDG_DATA_HOME` + `XDG_CONFIG_HOME` 均指向真实位置~~ | Phase 1（2026-07-19）在非 Windows 语境下验证过这两个变量可行；**Phase 13 真实环境测试（2026-07-23）发现在 Windows 上设置它们会让 OpenCode CLI 1.18.3 无限 hang**，已从实现中移除（`workspace-context.ts` 的 OpenCode 分支现在不注入任何 auth 目录变量）。当前 Windows 实现：credential isolation 下（`push_credentials_enabled=false`）OpenCode OAuth 直接 fail closed（`opencode-protocol.ts` 的 Windows+OAuth guard），提示改用 `auth_type=api_key`（`buildOpenCodeApiKeyAuthMaterial`，不依赖 HOME 目录）。**workspace-aware availability（2026-07-23 产品决策，2026-07-24 完整落地）**：当目标 workspace 的 `push_credentials_enabled=true` 时，`buildChildEnv()` 透传完整 `process.env`（不做 HOME 隔离），OpenCode OAuth 实际可用；`AdapterConfigService.validate(id, workspaceId?)` 和失败 Run 触发的 re-probe（`RunDispatchService.reprobeAdapterOnFailure`）都会据此传入正确的 `pushCredentialsEnabled`。探测/失败结果不再写入 Project 级全局 `agent_configs.status`，而是写入 schema v7 `adapter_workspace_status` 表——一张只存"与全局基线不同"的 `(adapter_config_id, workspace_id)` 例外覆盖表；`effectiveAdapterStatus()`（`adapter-availability.ts`）是唯一的合并读取入口，`AdapterResolver`/`ValidationWorkflowService.claimValidatorSlot()` 均已切换为通过它判断。效果：该 workspace 自己探测成功后即可在该 workspace 内路由（无需再退让成 `Unknown`），某 workspace 的失败也不会连带禁用同 Project 的其他 workspace。**UI 闭环（2026-07-25 补齐）**：`AdapterConfigService.list(projectId, workspaceId?)` 与 `GET /api/projects/:project_id/adapters?workspace_id=` 已支持按 workspace 返回 `effective_status` 等投影字段；`AdapterSettings` 组件通过既有 `useWorkspace(projectId)` 取得 Project 当前绑定的（单一）workspace 并贯穿 list/Validate 调用，状态徽标展示 workspace-effective 值。这不是"用户在 Adapter Settings 内自由选择任意 workspace"的多 workspace 选择器——PersonaHub 当前是单 Project 单 workspace 产品模型（design F001），UI 只需要、也只提供了针对"当前这一个已绑定 workspace"的展示与操作。`setDefault`/Project default 语义仍只认全局 `status`，与 workspace override 无关，为有意保留。 |

Codex/Claude Code 的共同点：SSH agent、git credential helper、GH token 均由 `HOME`/`USERPROFILE`（保持隔离）控制，与上述 provider 专属变量无关，因此这套注入不会连带放宽 git 凭据隔离。详见 `server/tests/helpers/{claude,opencode}-protocol-fixtures.md` T009（Phase 1 记录，OpenCode 部分已被 Phase 13 推翻，见上）。

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

Node 的 `spawn` 在 `shell:false` 下无法直接执行 `.cmd`，F002 当时选择开 shell 绕过。

**shim 的转发形态不止一种**，resolver 不能简化为"解析出真实 exe 路径"。本机实测两种都存在：

```bat
:: opencode.cmd —— 单层转发到真实 exe
"%dp0%\node_modules\opencode-ai\bin\opencode.exe" %*

:: codex.cmd —— 转发到 node.exe + 入口 js + 用户参数
"%_prog%" "%dp0%\node_modules\@openai\codex\bin\codex.js" %*
```

若 resolver 只返回一个路径，Codex 在 `shell=false` 下无法保持原行为。因此解析结果必须能表达"可执行文件 + 前置参数"：

```ts
interface ResolvedExecutable {
  executable: string;      // 真实可执行文件绝对路径
  prefixArgs: string[];    // 置于用户 args 之前，如 [".../codex.js"]
  source: "direct" | "verified_shim";
}
```

共享的 executable resolver 位于 adapter 启动路径之前、对三个 provider 一视同仁：

- **只支持经 fixture 固化的已知 npm shim 形态**，不做通用 batch 解释——通用解析会扩大命令注入面和误解析风险；
- 解析出的目标可执行文件与入口文件必须存在,否则视为解析失败；
- 参数边界通过 `prefixArgs` 数组传递，**不得**用字符串拼接重建命令行；
- 未知/复杂 batch 文件、解析失败：把该 adapter 标为 unavailable 并给出明确原因，**既不执行、也不回退 `shell=true`**——否则安全降级会在用户无感知的情况下发生；
- 非 shim 的普通可执行文件走 `source="direct"`，`prefixArgs` 为空，不做多余处理；
- Codex 一并切换，`shell: process.platform === "win32"` 从基线移除（`runtime/adapters/codex-cli-adapter.ts`、`codex-protocol.ts`），F002 既有启动/probe 测试作为回归门槛。

对应任务见 `tasks.md` T009a，它阻塞 Claude（T037）和 OpenCode（T044）的 argv 断言。

### 6.2 Protocol probe与normalizer

实现前必须记录实际CLI版本和redacted fixtures：

- Claude Code：one-shot print、stream JSON、final assistant message、tool/command start/end、control request/response、cancel、nonzero/auth failure。
- OpenCode：one-shot run、JSON/structured output（若有）、final message、tool/command事件、cancel、nonzero/auth failure、OAuth/API-key两种环境。

每个adapter用独立normalizer把raw协议转成已有`RunOutputChunk`、F003 `RunTraceSignal`、`RunExitResult.finalMessage`。Raw JSON不落库。未知消息忽略并降低trace completeness，不导致整个Run失败。

### 6.3 ClaudeCodeAdapter

已用本机真实 Claude Code CLI 2.1.215 完成实测（`server/tests/helpers/claude-protocol-fixtures.md` T001-T004），确认调用形态：`claude -p --output-format stream-json --verbose`，`--verbose` 在此组合下是**硬性必需**参数（缺失即 argv 级报错，无 JSON 输出）；prompt 经 **stdin** 传递（避免 argv 传参时约 3 秒的 stdin 等待和噪音告警），`cwd=workspace`、`shell=false`（启动方式统一见§6.1"统一进程启动"；Claude 本身是真 exe，无需 shim 解析）。instructions/API key 均不进 argv。

事件流是 NDJSON，`type: "result"` 是唯一的终态行，其 `.result` 字段即最终消息，映射为 `RunExitResult.finalMessage`；`is_error`/`api_error_status`/`terminal_reason` 区分"运行完成但报告错误"（认证失败、模型不存在等，进程退出码非零但仍有完整 JSON）与"进程级失败"（未知 flag、缺 `--verbose`，纯文本 stderr、零 JSON 行）两类失败，normalizer 必须分别处理。工具调用名在 Windows 上是 `PowerShell`，不是 `Bash`。

**权限（已修正，见 T003）**：Claude 在 `-p --output-format stream-json` 下**没有** `control_request`/`control_response` 这种可被调用方拦截的流内消息（工具被拒时只在事后的 `tool_result`/`permission_denials` 里体现）。真实的前置拦截通道是 **`PreToolUse` hook**：

- spawn 时通过 `--settings`（支持内联 JSON 字符串，无需管理临时文件）注册：
  ```json
  { "hooks": { "PreToolUse": [ { "matcher": "PowerShell", "hooks": [ { "type": "command", "command": "node \"<hook-script>\"" } ] } ] } }
  ```
- `<hook-script>` 是 PersonaHub 自带的独立短生命周期脚本，Claude Code 在每次匹配的工具调用前同步 spawn 它、把 `{tool_name, tool_input, ...}` 经 stdin 喂给它，并等待其 stdout 返回 `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"..."}}` 来决定是否放行；
- hook script 按 `push_credentials_enabled` 检查 `tool_input.command` 是否匹配 git push / force push，是则 `deny` 并触发 `PreExecutionApprovalRejected`；
- 不使用`bypassPermissions`/危险自动批准flag；
- 其他请求按F002现有P0策略允许并记录structured trace；
- hook 机制本身依赖 `--settings` 能否正确注册（已验证可行）；即使未来版本行为有变，child env credential isolation仍生效作为兜底；capability UI区分"pre-execution approval available/unavailable"。
- **不参考**multica `claude.go` 的 `handleControlRequest`——该函数针对 SDK 以 JS 库形式嵌入调用的场景（`canUseTool` 回调），对子进程 spawn 独立 `claude` 二进制的 adapter 不适用。

取消使用`SIGINT`：已验证子进程收到 `SIGINT` 后立即以 `code:null, signal:"SIGINT"` 退出，且**不会**再产出 `result` 事件——adapter 的 onExit-once 逻辑必须把这个组合本身当作终态"已取消"，不能等待一个不会到来的 `result` 行；超时后强制终止（SIGKILL 兜底）；必须保证onExit只触发一次。

### 6.4 OpenCodeAdapter

使用probe确认的one-shot命令和结构化输出模式，同样`cwd=workspace`、`shell=false`；OpenCode 本机为 `.cmd` shim，必须经§6.1的 executable resolver 解析后启动。OpenCode无消息级approval保证：

- 不对UI宣称pre-execution interception；
- 依赖credential-isolated env阻止push，结合stderr/structured command结果触发`CredentialIsolationBlocked`；
- 不启用会扩大filesystem/network权限的dangerous flag，除非probe证明非交互运行必需且其含义仅是关闭CLI自身prompt；若必须使用，UI capability note明确其边界，F002主防线仍必须通过测试。

若当前版本不能给出confirmed command/test trace，adapter仍可用于consult/implementation，但`supportsStructuredTrace=false`；F004 policy不会因此伪造pass。

真实探测确认`supportsStructuredTrace=true`（T006：`tool_use`携带`metadata.exit`/`time.start`/`time.end`，比Codex/Claude更完整）——上一段的降级只在CLI版本不再提供该shape时才触发。

**`-m <provider>/<model>` 必须显式传入，且与 auth_type 无关**（`opencode-protocol-fixtures.md` T005）：省略`-m`时OpenCode会静默 fallback 到内置免费模型（`opencode/*-free`），成功退出、看似能跑，但完全没有验证配置的provider凭证——这不仅是`validate()`的问题，`start()`同样必须始终显式传入`-m`，否则一个凭证失效的adapter会悄悄用免费模型跑完全程，产生虚假的"运行成功"。因此：

- **`AdapterConfigService.validateAuthState()` 需要修正**：`model_provider`与`default_model`目前只在`auth_type=api_key`时required（§4.1原逻辑，仅为了确定env var映射）；OpenCode的这条约束与auth_type无关，OAuth模式的OpenCode adapter同样必须提供两者，否则无法构造安全的`-m`值。修正为：`cli_provider=opencode`时`model_provider`/`default_model`一律required；`model_provider`的取值范围按auth_type区分——`api_key`模式仍必须命中T007 allowlist（因为要映射到确定的env var name），`oauth`模式不做allowlist限制（OpenCode支持的OAuth provider不是这份allowlist，允许任意非空字符串，真实有效性交给`validate()`的实际探测调用判定）。
- `validate()`本身即是design §5.2"用最小无workspace写入的prompt probe"分支的实例：由于`opencode auth list`不是可靠的机器可读信号（T005：isolated/real HOME下exit code相同），必须真实运行`opencode run --format json -m <provider>/<model> "<minimal probe>"`并检查`type:"error"`/非零exit，才能确认配置的provider真正可用；这会产生一次真实的、极小的模型调用（成本可忽略），design §5.2的validate-on-demand（非周期性）模型正是为了让这类必须真实探测的provider把成本控制在用户主动点击"Validate login"或一次dispatch失败收敛时，而不是后台轮询。

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
3. 不包含expected role => ad_hoc_consult + role=consult。这条降级**无条件成立**，不检查任何 consult capability——consult 不是 adapter 能力（§3），所以不存在"该 adapter 不能 consult"的情形，也就不会出现"既不能承接 workflow 又不能降级"的死角。
4. Validating时只有validator capability可命中；implementation-only adapter不会误推进validation。
5. `capability_tags`可包含多项；当前Issue状态决定本次唯一role，不由adapter自行选择。
6. `capability_tags` 为空（例如 JSON 非法被判 unavailable 之外的边界）时，任何状态下都只能 consult，不会误命中 workflow 角色。

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

### 8.1 10秒grace window与两阶段dispatch

**为什么必须两阶段**：F004 的 `validation.requested` 是**validator-bound**事件——payload 携带 `validator_run_id` / `validator_adapter_config_id`，`findRequestedEvent(repo, threadId, validatorRunId)` 按 `validator_run_id` 反查，workflow-service 有三个调用点，recovery-service 还会补建该事件，validation query 和 SSE replay 也依赖它。grace window 开始的那一刻 validator Run 尚不存在，因此**不可能**写出符合现有 contract 的 `validation.requested`；若先写空 ID，F004 的查询、recovery、result submission 和 Evidence Summary 会同时失去关联依据。

因此 F005 把原本的一次 request 拆成两个事务，**不改动 `validation.requested` 的既有语义**：

```text
Phase A — pending dispatch（implementation 完成时）
  -> Issue = Validating
  -> 冻结 round / implementation_run_id / policy snapshot + hash
  -> 持久化 validation_dispatch_due_at = now + MANUAL_VALIDATOR_GRACE_MS
  -> 写 validation.dispatch_pending（新事件，不含 validator 身份）

Phase B — winner claim（手动选择 或 scheduler 到期）
  -> claimValidatorSlot() 创建真实 validator Run
  -> 清 validation_dispatch_due_at
  -> 写 validation.requested（沿用 F004 payload，携带真实 validator 身份）
  -> 写 run.queued
```

**方案选择**：新增 `validation.dispatch_pending` 事件，而不是把 `validation.requested` 重新定义为 pending 事件。后者波及最广——要改一个已有多方消费者（三个 `findRequestedEvent` 调用点、recovery 补建逻辑、validation query、SSE replay）的既有契约，收益却与前者相同。实现时**不得**选择重定义方案。

Phase A 冻结的 round / implementation_run_id / policy snapshot + hash 必须持久化，Phase B 直接读取，不重新推导——否则 grace 期间若有 consult Run 产生新 handoff，被验证对象会漂移（§6.5 已有的同一约束）。

`validation.dispatch_pending` payload 只含 Phase A 已知的信息：

```json
{
  "issue_id": "...", "thread_id": "...", "workspace_id": "...",
  "validation_round": 3,
  "implementation_run_id": "...",
  "policy_id": "...", "policy_version": 2,
  "policy_snapshot": { }, "policy_snapshot_hash": "sha256:...",
  "dispatch_due_at": "2026-07-19T13:05:10.000Z"
}
```

计时不是前端定时器真相：`ValidationDispatchScheduler`每秒查询due Issue，server startup也reconcile。10秒是集中常量`MANUAL_VALIDATOR_GRACE_MS`，P0不做用户配置。

`MANUAL_VALIDATOR_GRACE_MS` 必须**可注入**（构造参数或依赖注入，默认 10s），不能写死读取模块常量。理由：这条 grace 改变了 F004 既有自动闭环的时序——implementation 完成后不再立即产生 validator Run。F004 现有的自动验证集成测试如果只能等真实 10 秒，要么整体变慢，要么退化成时间敏感的脆测试。测试注入 0ms 即可保持 F004 原有的"立即创建"语义，回归成本为零。

**两种 default 必须分开,不得合并**：

| | 用途 | 解析方式 |
| --- | --- | --- |
| Project default adapter | composer 省略 `adapter_id` 时的普通/手动 Run | `AdapterResolver`，§7.1 |
| 自动 validator | grace 到期或用户点"立即开始自动验证" | **始终** `ValidatorSelector`：`status=available AND capability_tags contains 'validator'` |

Project default 完全可能是一个只有 implementation capability 的 adapter。若实现者把两者合并，Project 明明有可用 validator，也会因为通用 default 不具备 validator capability 而错误 Blocked。自动路径永远走 `ValidatorSelector`，与 F004 既有行为一致。

因此 UI 文案用 **"Start automatic validator now"**，不用"Use default now"——后者会暗示使用 Project default。`POST /api/issues/:id/validation`沿用F004接口，F005语义为"立即结束 grace 并按 `ValidatorSelector` 创建自动 validator"：清due并进入 Phase B。

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

创建/编辑dialog：provider -> auth type -> provider-specific字段逐级显示；capability用 Implementation / Validator 两个复选框（**没有 Consult 复选框**，见§3：consult 不是可配置能力，任何 adapter 都能承接咨询）。API key输入永不回填，已配置显示“Configured ••••”；替换/clear是显式动作。

列表展示provider、model、capabilities、OAuth logged in/API key configured、availability和default badge。不可用原因使用清洗后的message。OAuth区域给出可复制登录命令和“Validate login”，不声称PersonaHub完成登录。

### 10.2 Composer selector

selector始终可见，不因只有一个adapter而隐藏：

- 第一项为Project default并标名称/provider；
- available adapters可选；unavailable保留但disabled并说明原因；
- 显示capability和当前推导结果（"Implementation workflow"/"Validator workflow"/"Consult（不改变 Issue 状态）"，后者是未命中期望角色时的降级结果，不是 adapter 的一种配置）；
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
| Claude `PreToolUse` hook 拦截 git push | 前置拒绝 + escalation + Blocked |
| Claude `--settings`/hook 注入失败或不可用 | credential isolation仍挡push，capability如实降级 |
| OpenCode git push | credential isolation主防线；不承诺前置拦截 |
| adapter raw protocol malformed | trace partial；Run可继续，validator缺可靠finalMessage则Blocked |
| concurrent manual/auto validator | DB unique决定winner；无重复Run |
| 本轮validator已终态后再次claim | per-round索引拦截；manual收409+终态run摘要，scheduler幂等结束；不bump round |
| consult在Validating期间完成 | Issue保持Validating；scheduler/validator照常 |
| consult触发危险操作 | Issue Blocked，取消其余queued workflow Run |
| server grace期间重启 | 按due_at恢复剩余等待/立即dispatch |

`buildChildEnv`安全回归必须对三个provider分别验证：无SSH agent、无git helper、无GH token，只有最小CLI auth material；API key不得出现在process argv。**2026-07-23 final-comprehensive-report 发现并修复**：隔离模式此前只过滤 Git/SSH/token 类变量，未过滤 `OPENCODE_MODEL_PROVIDER_ENV` 里的 10 个模型 provider API key（`OPENAI_API_KEY`/`ANTHROPIC_API_KEY`/...）——任何 provider 的隔离 Run 都能读到操作员环境里设置的其他 provider key。先补了大小写不敏感的 denylist（含常见云厂商凭据），随后 **2026-07-24 final-recheck-2-report 指出 denylist 永远无法穷举所有可能的密钥变量名（如企业自定义 `*_TOKEN`），已重构为 allowlist**：`workspace-context.ts` 的隔离分支现在只放行 `SAFE_PARENT_ENV_NAMES` 里明确列出的非密钥基础设施变量（PATH/Windows 系统必需变量/temp/locale/终端格式/代理配置/Node 运行时配置），其余一律不复制，不管名字是否出现在任何名单里。已用本机真实已登录 CLI 实测验证未破坏功能：隔离环境下 Codex、Claude Code 真实 dispatch 均成功完成（`real-multi-provider-consult.test.ts`，`REAL_CODEX=1 REAL_CLAUDE=1`），OpenCode 保持既有的快速失败行为（~4s，非 hang，`real-opencode-dispatch-check.test.ts`，`REAL_OPENCODE=1`）。`credential-isolation.test.ts` 同时补了任意未命名 secret（如 `SENTRY_AUTH_TOKEN`/`DATABASE_URL`）不泄漏的回归，以及 PATH/HTTPS_PROXY 等基础设施变量仍正常透传的回归。**2026-07-24 final-recheck-3-report 发现并修复**：allowlist 只按变量名分类，未检查值本身——标准代理 URL 可以携带 userinfo 凭据（`http://user:password@host:8080`），此时 `HTTP_PROXY`/`HTTPS_PROXY`/`ALL_PROXY` 会原样透传账号密码。已加 `isSafeProxyValue()`：用 `new URL()` 解析后检查 `username`/`password`，含凭据或无法解析一律 fail closed（不猜测“大概率安全”）；`NO_PROXY`（主机名列表，非凭据承载 URL）不受影响，继续原样透传。`credential-isolation.test.ts` 补了三种 proxy 变量的凭据 URL 拒绝回归、无凭据 URL 正常透传回归、畸形值 fail closed 回归、`NO_PROXY` 不受影响回归。

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
| consult 不做成 adapter capability | 三个CLI天然都能对话；可禁用只会造出"无法降级"的死角，用户得不到任何好处 | 保留Consult复选框；配置项不产生任何行为差异，是假配置 |
| 两阶段dispatch + 新增dispatch_pending事件 | `validation.requested`是validator-bound且有多方消费者，grace开始时validator尚不存在 | 重定义requested为pending；波及三个findRequestedEvent调用点、recovery补建、query与SSE replay |
| 两种default严格分离 | Project default可能只有implementation能力，合并会导致有validator却Blocked | 自动验证复用Project default；引入"default必须具备validator能力"的强约束，削弱其通用用途 |
| 旧Project default只在唯一available时回填 | 避免把任意选择固化成用户以为设过的默认值 | 按created_at取第一条；正是§7.1禁止的启发式 |
| `agent_configs.role`标deprecated并由capability派生 | 满足NOT NULL又不产生第二个真相源 | 新增primary_capability列；可从capability_tags算出，无需加列 |
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
- **已关闭：manual/auto validator时序**——两阶段dispatch（`validation.dispatch_pending` -> `validation.requested`）+ 10秒持久化grace + F004 unique index winner；"Start automatic validator now"复用validation endpoint，自动验证走`ValidatorSelector`而非Project default。
- **已关闭：OpenCode escalation**——credential isolation是主防线，不宣称协议级前置拦截。
- **已关闭：default行为**——Project显式持久化default，不随机fallback。

上述真实CLI验证均写入`tasks.md` Phase 1；验证失败有已拍板的capability downgrade或unavailable路径，不阻塞开始开发。

## 16. 实现后回写

- `docs/personahub-system-design.md`：更新Agent auth/public-secret边界、Project default、Run purpose/source/context source、Issue validation due。
- `docs/personahub-architecture.md`：将三个adapter实际capabilities、provider-specific auth env、manual routing/grace scheduler写回。
- `docs/decisions/0002-first-agent-adapter.md`保持“Codex是第一个adapter”的历史决策，不改写为唯一adapter。
- 完成验收后更新`BACKLOG.md`、三件套Status和`CLAUDE.md`。
