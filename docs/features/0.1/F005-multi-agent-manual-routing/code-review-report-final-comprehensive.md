---
feature_ids: [F005]
doc_kind: code-review
review_date: 2026-07-23
review_scope: final-comprehensive
supersedes:
  - code-review-report-implementation.md
  - code-review-report-recheck.md
  - code-review-report-recheck-2.md
---

# Code Review Report

**Reviewed**: F005 完整需求、设计、任务记录、当前未提交实现、共享契约、Schema/Repository、HTTP API、路由与验证状态机、三 Provider runtime、凭据隔离、Web UI、自动化测试及前三轮检视修复
**Language(s)**: TypeScript, React, SQL, Markdown
**Review Date**: 2026-07-23
**Severity Legend**: 🔴 Critical | 🟠 High | 🟡 Medium | 🟢 Low | 🔵 Info

---

## Executive Summary

本轮按“最终总检视”重新从需求到运行时完整走查，不再只复查上一轮 finding。F005 的主干能力已经成形，类型检查、Server/Web 全量测试和生产构建均通过，manual routing、consult 降级、validator grace、跨 Provider adapter、secret-safe public DTO 等核心路径有较好的测试覆盖。

但当前仍不建议把 F005 标为 `done`。除上一轮尚未关闭的 5 项外，本轮新增确认了 9 项问题，其中 2 项属于发布前应解决的 High：

1. validator context 构建失败时，事务会提交一个没有事件、没有 instructions 的孤儿 queued validator Run；
2. credential-isolated 子进程仍继承操作员环境中其他模型 Provider 的 API key，不符合“只有最小 CLI auth material”的设计边界。

综合结果为 **4 High、7 Medium、3 Low**。建议先关闭全部 High，并至少关闭 HTTP 运行时校验、空 capability 创建语义、删除 204、编辑清空语义和非 Windows resolver 这 5 个 Medium，再进行最终真实浏览器/真实 CLI 验收。

## Verification

| Check | Result |
| --- | --- |
| `npm run typecheck` | 通过；shared/server/web 均通过 |
| Server 全套 | 通过：104 files / 1294 tests；9 files / 14 个 real-CLI tests 按 env gate skipped |
| Web 全套 | 通过：20 files / 155 tests |
| `npm run build` | 通过；shared/server/web production build 成功 |
| `git diff --check` | 通过 |

本轮未启用 `REAL_CODEX`、`REAL_CLAUDE`、`REAL_OPENCODE`。Web 测试仍输出既有 React Query “data cannot be undefined” warning；Server 的 git-scanner 仍输出 Vitest 4 参数弃用 warning，均未导致失败。

## Findings

### Correctness / State Consistency

#### 🟠 AC-001 仍未关闭：命令存在被当成鉴权可用，鉴权配置变化又保留旧可用状态 — `server/src/services/adapter-config.ts:45`, `:181`, `:204`, `:260`, `:320`

**Severity**: High

**Problem**: create 和 command update 仍将 `validateCommand()` 的 `--version` 成功直接映射为 `AdapterStatus.Available`。这只能证明 executable 可运行，不能证明 Claude/OpenCode 已登录或 API key 有效。新建的未登录 adapter 可自动成为 Project default。反方向上，仅修改 `auth_type`、`api_key`、`model_provider` 或 `default_model` 时，旧的 `Available` 仍可能保留。

**Current Code**:

```ts
const validation = validateCommand(trimmedCommand);
const status: AdapterStatus =
  validation.available ? AS.Available : AS.Unavailable;

if (status === AS.Available && defaultAdapterConfigId === null) {
  this.projectRepo.setDefaultAdapter(projectId, record.id);
}
```

**Suggested Fix**:

```ts
const commandCheck = validateCommand(trimmedCommand);
const status = commandCheck.available
  ? AdapterStatus.Unknown
  : AdapterStatus.Unavailable;

if (commandOrAuthFieldsTouched) {
  updates.status = commandCheckFailed
    ? AdapterStatus.Unavailable
    : AdapterStatus.Unknown;
  updates.last_checked_at = null;
  updates.auth_status_message = null;
}
```

只有 Provider-specific `adapter.validate()` 成功后才写 `Available`；Unknown 不自动成为 default，也不参与 routing。补充 create、command update、key replacement、OAuth switch 的回归测试。

**Explanation**: executable 存在、字段组合合法、真实鉴权可用是三个不同层次。`available` 若不只代表最后一个层次，default resolver 和运行时路由就会提前放行不可用配置。

**处理结果（2026-07-24 追加）**：本条描述的语义问题（命令可解析即被判定为 `Available`，不代表已鉴权）至今**未修复，是有意保留，不是遗漏**。已就此与用户明确讨论并达成一致：把 create/update 的默认状态改成 `Unknown` 会牵连"首个 available adapter 自动设为 Project default"这条既有逻辑，以及大量既有测试对"创建后立即可用"这一行为语义的假设，属于比本轮 code-review 驱动修复更大范围的产品/架构改动，需要单独排期决策，不在本轮范围内一并处理。当前状态与决策依据详见 `spec.md` 第 8 节 AC-001 条目与 `CLAUDE.md` F005 状态段。

**二次追加（2026-07-24）**：本条已实施完成——create()/update() 不再直接把可解析命令判定为 `Available`，统一先落 `Unknown`，随后异步触发真实 provider `validate()` 收敛（成功才置 `Available` 并按需应用 default-adapter 分配；失败或探测异常则保持 Unknown/Unavailable，绝不静默提升）。详见 `spec.md` 第 8 节 AC-001 条目最新状态。

---

#### 🟠 workspace-aware probe 写入 Project-global status，跨 workspace 会互相污染 — `server/src/services/adapter-config.ts:430`, `:440`, `:443`; `server/src/services/adapter-resolver.ts:22`; `server/src/services/run-dispatch.ts:150`

**Severity**: High

**Problem**: probe 能根据目标 workspace 的 `push_credentials_enabled` 得到不同结论，但结果仍写入 Project-scoped `agent_configs.status`。resolver 又只接收 `projectId`，不知道 Issue 的 workspace。非隔离 workspace 验证成功后可错误放行隔离 workspace；隔离 workspace 失败后也会全局禁用本来可在非隔离 workspace 使用的 adapter。

**Current Code**:

```ts
const result = await adapter.validate(publicConfig, existing.api_key, {
  pushCredentialsEnabled,
});
this.agentConfigRepo.update(id, {
  status: result.available ? AS.Available : AS.Unavailable,
});
```

**Suggested Fix**:

将 availability 持久化为 `(adapter_config_id, workspace_id)`，并让 resolver 接收目标 `workspaceId`；或者在 F005 明确采用安全收紧策略：Windows OpenCode OAuth 不产生全局 `Available`，隔离 workspace 只支持 API key。不能继续混用 workspace 级探测和 adapter 全局状态。

**Explanation**: 可用性依赖 workspace policy 时，存储和查询维度也必须包含 workspace，否则状态必然不具备可传递性。

**处理结果（2026-07-24 追加）**：本条已**部分修复**——`AdapterConfigService.validate()`/`RunDispatchService.reprobeAdapterOnFailure()` 现在会避免把单一 workspace 的许可（`push_credentials_enabled=true`）错误提升为全局 `Available`（改用 `AdapterStatus.Unknown` 诚实表达"仅在该 workspace 下确认可行，非全局确认"），修复了"跨 workspace 错误放行"这个更危险的方向。但反方向——"该 workspace 自己验证成功后应可路由""某 workspace 失败不该连累其它 workspace"——**仍未解决**，需要按本条 Suggested Fix 把 availability 从 adapter 级别扩展到 `(adapter, workspace)` 级别的持久化/查询模型。这是新增数据模型 + resolver/ValidatorSelector 多处签名变更，规模上是功能新增而非 bug 修复，经与用户确认后有意留待后续单独排期，未在本轮处理。详见 `spec.md` 第 8 节 AC-001 条目。

**二次追加（2026-07-24）**：本条已实施完成——新增 schema v7 `adapter_workspace_status` 表作为「例外覆盖」：`agent_configs.status` 保持 Project 级保守基线，`effectiveAdapterStatus()`（`adapter-availability.ts`）合并全局状态与该表按 `(adapter_config_id, workspace_id)` 存的覆盖记录；`AdapterResolver`、`ValidationWorkflowService.claimValidatorSlot()`、`RunDispatchService.reprobeAdapterOnFailure()`、`AdapterConfigService.validate(id, workspaceId)` 均已切换为按合并结果判断，workspace 范围内的探测/失败只写该 workspace 的覆盖行，不再连累同 Project 其它 workspace。详见 `spec.md` 第 8 节 AC-001 条目最新状态。

---

#### 🟠 validator context 失败会提交孤儿 queued Run，阻断同轮恢复 — `server/src/services/validation/workflow-service.ts:132`, `:197`, `:203`, `:217`, `:225`

**Severity**: High

**Problem**: `claimValidatorSlot()` 在 transaction 内先插入 queued validator Run，再构建最多 128 KiB 的 context。`buildValidatorContext()` 仍可能在截断后抛出 `ContextBuilderError`。catch 分支把 Issue 设为 Blocked 后直接返回，没有抛异常，因此 SQLite transaction 正常提交：

- validator Run 已存在，status 仍为 `queued`；
- instructions 仍为空；
- 没有对应 `validation.requested` / `run.queued` 事件；
- `idx_runs_validator_per_round` 已被占用。

后续 unblock/recovery 可能把这个无上下文 Run 当作本轮既有 validator，或者被唯一索引持续阻断。

**Current Code**:

```ts
const validatorRun = this.runRepo.create({ status: RunStatus.Queued, instructions: "" });
try {
  const ctx = assembleValidatorContext(/* ... */);
  this.runRepo.updateInstructions(validatorRun.id, ctx.markdown);
} catch {
  this.blockIssueInTx(issue, /* ... */);
  return { ok: false, reason: "blocked" };
}
```

**Suggested Fix**:

在任何持久化写入前完成 context 构建。若 context 必须引用 validator Run ID，可先在内存生成 ID，并允许 repository 使用预生成 ID；或者让 context 异常抛出以回滚整个 claim transaction，再在独立 transaction 中 Block Issue。增加“超大 context 构建失败”测试，断言数据库中不存在 validator Run 和 per-round 占位记录。

**Explanation**: catch-and-return 会把异常转换成事务成功。事务中的部分写入只有在显式回滚或抛出异常时才会撤销。

---

#### 🟡 创建时显式空 `capability_tags` 被改写成 implementation — `server/src/services/adapter-config.ts:173`

**Severity**: Medium

**Problem**: 设计明确规定空 capability 是有效边界，任何 Issue 状态下只能作为 consult。但 create 使用“缺失或长度为 0 都默认 implementation”的判断。UI 允许取消两个 capability 复选框并提交 `[]`，结果保存后却悄悄获得 implementation 能力；update 同样的 `[]` 则会正确保存为空，create/update 语义不一致。

**Current Code**:

```ts
const capabilityTags = input.capability_tags && input.capability_tags.length > 0
  ? input.capability_tags
  : [AgentCapability.Implementation];
```

**Suggested Fix**:

```ts
const capabilityTags = input.capability_tags === undefined
  ? [AgentCapability.Implementation]
  : input.capability_tags;
```

同时增加 create-empty、update-empty 和 empty-capability routing 测试。

**Explanation**: “字段省略”可以采用兼容默认值，“用户明确提交空数组”必须保留其业务含义。

---

#### 🟡 F005 HTTP 路由没有运行时 schema 校验，非法 purpose/数组被静默接受或持久化 — `server/src/api/routes/runs.ts:14`; `server/src/api/routes/adapters.ts:17`, `:60`; `docs/decisions/0005-code-directory-structure.md:51`

**Severity**: Medium

**Problem**: 路由只用 TypeScript cast，网络输入没有 Zod/显式 schema：

- `purpose: "workflow_bound"` 或任意未知字符串被当成 omitted/auto，而设计要求 `RUN_PURPOSE_INVALID` 400；
- `args: "abc"` 可被写成 JSON 字符串，读取后被强转为 `string[]`，运行时 spread 会把它拆成单字符 argv；
- `capability_tags: "validator"` 等非数组值可能被错误派生、持久化，之后又被 repository 降级成空能力；
- 非枚举 capability 值没有被拒绝。

**Current Code**:

```ts
const body = (request.body ?? {}) as {
  args?: string[];
  capability_tags?: AgentCapability[];
};

body.purpose === "ad_hoc_consult"
  ? RunPurpose.AdHocConsult
  : undefined;
```

**Suggested Fix**:

为 F005 create/update/run/default/validate 请求增加 Zod schema，数组逐项校验，枚举使用 `z.nativeEnum()`；显式允许 `purpose` 仅为 `auto` / `ad_hoc_consult`，其他值抛 `RUN_PURPOSE_INVALID`。增加 malformed JSON-shape 的 route tests。

**Explanation**: TypeScript cast 不会验证 HTTP 数据。当前测试均发送类型正确的对象，因此无法发现边界输入造成的静默语义变化。

---

#### 🟡 Adapter 编辑页无法清空 args、default model 和 model provider — `web/src/components/adapter/AdapterSettings.tsx:317`; `shared/src/errors/index.ts:167`

**Severity**: Medium

**Problem**: 编辑时空值被转换为 `undefined`，而 server 将 undefined 解释为“保留原值”。因此用户在 UI 中删空 args、可选 default model 或 model provider 后提交，旧值仍保留。共享 `AdapterConfigUpdateInput` 也没有给 `default_model` / `model_provider` 声明 `null` 清空语义，虽然后端部分路径已经能处理 null。

**Current Code**:

```ts
args: args.length > 0 ? args : undefined,
default_model: authFields.defaultModel.trim() || undefined,
model_provider: authFields.modelProvider.trim() || undefined,
```

**Suggested Fix**:

编辑时 args 发送 `[]`；共享契约改为 `default_model?: string | null`、`model_provider?: string | null`，清空时发送 `null`。Server 应基于更新后的 effective state 重新执行 auth/model matrix 校验。增加“填写后再清空并重新打开 dialog”的 UI 测试。

**Explanation**: patch API 需要区分 omitted、clear、replace 三态，否则表单看似成功，实际配置没有变化。

---

#### 🟡 删除成功的 204 响应会被 Web 当成 JSON 解析错误 — `server/src/api/routes/adapters.ts:85`; `web/src/lib/api-client.ts:41`, `:115`

**Severity**: Medium

**Problem**: Server 正确返回 204 No Content，但 `apiFetch()` 对所有成功响应无条件调用 `res.json()`。空响应体会抛 `SyntaxError`。结果是 adapter 已在 Server 删除，UI 却进入 mutation error 分支、显示失败并且不 invalidate 列表，留下误导性的陈旧行。

**Current Code**:

```ts
if (!res.ok) { /* ... */ }
return res.json() as Promise<T>;
```

**Suggested Fix**:

```ts
if (res.status === 204) return undefined as T;
const text = await res.text();
return text ? JSON.parse(text) as T : undefined as T;
```

增加 api-client fetch 层测试，使用真实 `Response(null, { status: 204 })`，不要只 mock `apiClient.adapters.delete()`。

**Explanation**: 当前 Adapter Settings 测试 mock 掉了 HTTP client，因此只验证 mutation UI，没有覆盖真实 Fetch 响应解析。

---

### Security

#### 🟠 credential-isolated Run 仍继承其他 Provider API key — `server/src/runtime/workspace-context.ts:36`, `:48`; `server/src/runtime/provider-metadata.ts:37`; `server/src/runtime/adapters/opencode-adapter.ts:130`

**Severity**: High

**Problem**: `buildChildEnv()` 在隔离模式只移除 Git/SSH token、HOME 和 Provider auth-directory 变量，却保留 `OPENAI_API_KEY`、`ANTHROPIC_API_KEY`、`GEMINI_API_KEY` 等模型密钥。随后 OpenCode API-key 模式只覆盖当前 Provider 的一个 key，其他 key 仍在 child env；Codex/Claude Run 同样能继承这些无关 key。Agent 可以执行 shell/读取环境变量，因此一个 Run 可读取和外传操作员环境中的其他 Provider secret。

这与 design §2“新 adapter 不得通过继承完整用户环境绕过 credential isolation”、§5.3“合入已经过 credential isolation 的 child env”和 §11“只有最小 CLI auth material”不一致。

**Current Code**:

```ts
for (const [key, value] of Object.entries(process.env)) {
  if (key === "GH_TOKEN" || key === "GITHUB_TOKEN" /* ... */) continue;
  env[key] = value;
}

const childEnv = {
  ...buildChildEnv(/* isolated */),
  ...authEnv,
};
```

**Suggested Fix**:

集中维护 secret-env denylist，至少移除 `Object.values(OPENCODE_MODEL_PROVIDER_ENV)`、Codex/Claude/API SDK 常见 key，以及云平台 credential 变量；再只注入当前 adapter 明确需要的 auth material。Windows 下 env key 比较应大小写不敏感。增加三个 Provider 的 child-env tests：放入多个 canary key，断言只有当前显式授权的一个可见。

**Explanation**: 隔离环境的安全边界应是 allow/minimal auth material，而不是只屏蔽 Git 凭据。多 Provider 功能增加后，交叉密钥泄漏成为直接可利用的边界问题。

---

#### 🟡 auth status sanitizer 无法覆盖多数受支持 Provider key 格式 — `server/src/runtime/trace/redaction.ts:12`, `:74`; `server/src/services/adapter-config.ts:451`; `server/src/services/run-dispatch.ts:177`

**Severity**: Medium

**Problem**: sanitizer 仅识别 GitHub、通用 `sk-`、Slack、AWS 等固定 pattern。F005 支持 Google、DeepSeek、OpenRouter、Groq、Mistral、xAI、Together、Perplexity 等密钥；CLI error 若回显实际 key，未知格式会写入 `auth_status_message` 并返回 UI。现有 canary 只覆盖 `sk-` 风格。

**Current Code**:

```ts
const TOKEN_PATTERNS = [
  /(gh[pousr]_)[A-Za-z0-9]{36,}/g,
  /(sk-)[A-Za-z0-9]{20,}/g,
  /(xox[bpoa]-)[A-Za-z0-9\-]+/g,
  /(AKIA)[A-Z0-9]{16}/g,
];
```

**Suggested Fix**:

服务层已持有本次 probe 的确切 `api_key`，应先对 exact value 做 `replaceAll(secret, "[REDACTED]")`，再使用通用 regex 做 defense-in-depth。为 allowlist 中的非 `sk-` key 增加测试。

**Explanation**: 第三方 key 格式会变化，正则不可能稳定枚举；对已知确切 secret 做值级清洗才是可靠边界。

---

### Portability / Runtime

#### 🟡 executable resolver 在 Linux/macOS 不搜索无扩展名命令 — `server/src/runtime/executable-resolver.ts:26`, `:28`, `:49`

**Severity**: Medium

**Problem**: bare command 没有扩展名时只尝试 `.exe/.cmd/.bat/.com` 或 `PATHEXT`。Linux/macOS 的 `codex`、`claude`、`opencode` 通常是 PATH 中的无扩展可执行文件，因此默认配置会全部报 `Command not found`。现有 13 个 resolver tests 都基于 Windows shim/扩展名，没有 POSIX fixture。

**Current Code**:

```ts
const DEFAULT_EXTENSIONS = [".exe", ".cmd", ".bat", ".com"];
const extCandidates = hasExt ? [""] : getPathExtensions();
```

**Suggested Fix**:

Windows 继续使用 PATHEXT；POSIX 使用 `[""]`，并通过 `stat().isFile()` 与 `access(X_OK)` 确认真正可执行。增加 extensionless temporary executable 的 POSIX 条件测试。

**Explanation**: F005 的默认 command 都是 bare name，resolver 是三个 Provider 的共同入口；该问题会让非 Windows 环境完全无法启动 adapter。

---

#### 🟢 Windows UNC workspace 会生成无效的 HOMEDRIVE/HOMEPATH — `server/src/runtime/workspace-context.ts:65`, `:81`

**Severity**: Low

**Problem**: `local_path.slice(0, 2)` 假设路径是 `C:\...`。UNC 路径 `\\server\share\repo` 会得到 `HOMEDRIVE="\\", HOMEPATH="server\share\repo"`，不代表有效 Windows home，可能重新触发已记录的 OpenCode home identity 不一致或让 Node/CLI 解析到错误目录。

**Current Code**:

```ts
env["HOMEDRIVE"] = workspace.local_path.slice(0, 2);
env["HOMEPATH"] = workspace.local_path.slice(2);
```

**Suggested Fix**:

使用 `path.win32.parse()` 并单独处理 UNC root；若 CLI 不支持 UNC home，应在 workspace bind/dispatch 时明确拒绝并给出可操作错误。补充 drive-letter 与 UNC 两类测试。

**Explanation**: 当前修复只覆盖盘符路径，注释中的“Windows 三个 home 身份始终一致”尚未对所有合法 Windows 路径成立。

---

### Reliability / Observability

#### 🟡 availability 收敛任务不可等待、不可观测，shutdown 时可丢失 — `server/src/services/run-dispatch.ts:108`, `:114`, `:150`

**Severity**: Medium

**Problem**: 旧 probe 覆盖新配置的竞态已修复，但 terminal hook 仍用 `void promise.catch(() => {})` 启动 re-probe。最长 30 秒 probe 未完成时进程退出，状态收敛会丢失；registry/provider/DB 异常也被完全吞掉。现有测试依赖固定等待时间，没有 shutdown drain 和异常可观测性。

**Current Code**:

```ts
void this.reprobeAdapterOnFailure(runId).catch(() => {});
```

**Suggested Fix**:

维护 pending probe set，失败写结构化 warning，shutdown 在有界超时内 `Promise.allSettled()`。测试使用 deferred promise/显式 completion signal，覆盖 provider throw、DB failure 和 shutdown。

**Explanation**: 非阻塞任务仍需要生命周期管理；否则“失败后必须收敛 unavailable”只能算 best effort。

---

### UX / Documentation

#### 🟢 “No validator configured” 忽略 availability，会隐藏实际不可用状态 — `web/src/components/adapter/AdapterSettings.tsx:114`

**Severity**: Low

**Problem**: 只要存在一个带 validator capability 的 adapter，提示就消失，即使它是 Unknown/Unavailable。自动验证选择器实际要求 `status=available AND capability=validator`，UI 提示与真实可执行条件不一致。

**Current Code**:

```tsx
!adapters.some((a) =>
  a.capability_tags.includes(AgentCapability.Validator)
)
```

**Suggested Fix**:

提示判断改为至少存在一个 `AdapterStatus.Available` 且含 validator capability 的 adapter；若只有不可用 validator，显示“validator 已配置但当前不可用”及原因。

**Explanation**: 用户最需要提示的正是“看似配了 validator，但 auto-validation 仍会 Blocked”的情况。

---

#### 🟢 需求、设计、tasks 和项目状态说明仍互相矛盾 — `docs/features/0.1/F005-multi-agent-manual-routing/design.md:303`, `:319`; `tasks.md:426`, `:433`; `spec.md:393`; `CLAUDE.md`

**Severity**: Low

**Problem**: `spec.md` 正确保持 AC-001 未勾选，但 tasks 仍称 AC-001/全部 7 条满足；design 的 OpenCode auth-dir 前置规则和后面的 superseded 矩阵同时存在；CLAUDE.md 仍保留旧测试数字及“全部 Phase 已完成”的结论。当前真相源不唯一。

**Current Code**:

```md
- 结论：全部7条验收标准满足。
```

```md
- [ ] AC-001 ... 未完全满足
```

**Suggested Fix**:

把历史结论标为 superseded，并统一为当前 acceptance 状态。design §5.4 只保留一份按平台/隔离模式的矩阵；测试数量改为当前值或明确为历史快照。关闭本报告 High/Medium 后再更新 feature 状态为 `done`。

**Explanation**: 验收记录可以保留历史，但必须清楚区分“当时结论”和“当前结论”，否则下一轮开发会继续依据已失效假设。

---

## Positive Observations

- `ManualRoutingService` 已成为生产 Run 创建的统一入口，workflow-bound / consult 的角色和 purpose 由服务端推导，核心分类矩阵覆盖较完整。
- capability update、validator frozen context source、manual validator instructions、queue drain 状态重验和 per-round uniqueness 均已落地并有针对性测试。
- 三 Provider 统一 `shell=false`，Windows npm shim 采用已验证形态解析，未知 batch 形态 fail closed，没有退回 shell。
- public adapter DTO 使用显式白名单字段构造，`api_key` 不进入 API/Event/Run identity；secret canary 覆盖了主要读取/导出 surface。
- Run failure 后先做 Provider-specific re-probe 再降级 availability，且已有 config `updated_at` snapshot 防止旧异步结果覆盖新配置。
- 本轮全量自动化结果稳定：Server 1294、Web 155、类型检查和生产构建全部通过。

## Summary

| Severity | Count |
|----------|-------|
| 🔴 Critical | 0 |
| 🟠 High | 4 |
| 🟡 Medium | 7 |
| 🟢 Low | 3 |
| 🔵 Info | 0 |

**Bottom Line**: F005 的核心架构和主流程质量已经较好，但当前仍有 4 个发布阻断级问题，且 HTTP 边界、真实 Fetch 204、空 capability、编辑清空和 POSIX 启动等测试盲区会造成可复现的产品错误。建议按本报告顺序整改，并在修复后补跑全量自动化、真实浏览器 Adapter Settings 流程，以及至少一次 Claude/OpenCode/Codex 的目标 workspace 真实 dispatch，再将状态改为 `done`。
