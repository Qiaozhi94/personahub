---
feature_ids: [F005]
doc_kind: code-review
review_date: 2026-07-24
review_scope: final-release-recheck
based_on:
  - code-review-report-final-comprehensive.md
---

# Code Review Report

**Reviewed**: F005 当前完整未提交实现、`code-review-report-final-comprehensive.md` 的 14 项 finding 修复、相关需求/设计/任务文档、共享契约、Server/Web 自动化测试与生产构建
**Language(s)**: TypeScript, React, SQL, Markdown
**Review Date**: 2026-07-24
**Severity Legend**: 🔴 Critical | 🟠 High | 🟡 Medium | 🟢 Low | 🔵 Info

---

## Executive Summary

本轮逐项核对上一份完整报告的 14 项 finding，并重新审查全部修复 diff。结果是 **10 项完整关闭、3 项部分修复、1 项仍明确开放**。validator orphan Run、空 capability、编辑清空、204、exact-secret redaction、POSIX resolver、UNC、后台 probe 生命周期、validator warning 和文档矛盾均已正确修复。

当前仍不建议把 F005 标为 `done`：AC-001 仍未实现；workspace-aware availability 的单一全局状态模型仍无法表达真实可用性；HTTP 边界校验和 credential env 隔离都只覆盖了上一报告举例的一部分。标准 Server 全套本轮还因同步真实 CLI 探测出现 1 个超时失败，虽定向复跑通过，但不能记为全绿。

## Verification

| Check | Result |
| --- | --- |
| `npm run typecheck` | 通过 |
| Server 标准全套 | **未全绿**：103 files / 1315 tests 通过，1 file / 1 test 超时失败，9 files / 16 tests skipped |
| Server 失败文件定向复跑 | 通过：`adapter-routes.test.ts` 24/24 |
| 本轮修改相关 Server 定向测试 | 通过：10 files / 195 tests，2 个 POSIX-only tests 在 Windows skipped |
| Web 全套 | 通过：21 files / 162 tests |
| `npm run build` | 通过；shared/server/web production build 成功 |
| 真实浏览器冒烟 | 未完成；当前执行环境无法稳定保留本地监听服务，临时 DB/日志已清理 |
| Real CLI env-gated tests | 本轮未启用 |

Server 全套失败项是 `adapter-routes.test.ts:73` 的 Codex adapter create，5 秒超时；同文件单独执行时该用例约 1.75 秒并全部通过。全套并行负载下，create 内同步执行真实 `codex --version` 耗时超过测试上限，正好暴露本报告第一项 finding 的阻塞问题。

## Prior Finding Closure Matrix

| 上一报告 finding | 状态 | 本轮结论 |
| --- | --- | --- |
| AC-001：`--version` 被当成 available | ❌ 未关闭 | 代码与 `spec.md` 均明确保留 |
| workspace probe 写全局 status | ⚠️ 部分修复 | 成功写 Unknown 避免误放行，但该 workspace 自己也无法路由；失败仍全局禁用 |
| context 失败留下孤儿 validator Run | ✅ 关闭 | 预生成 Run ID，先构建 context 再 insert；有超大 context 回归测试 |
| 显式空 capability 被改写 | ✅ 关闭 | 仅 omitted 默认 implementation，`[]` 被保留 |
| HTTP 无运行时 schema | ⚠️ 部分修复 | purpose/args/capability 已校验，其余字段仍依赖 cast |
| 编辑无法清空 args/model | ✅ 关闭 | edit 发送 `[]` / `null`，共享契约同步 |
| 204 被前端当成 JSON 错误 | ✅ 关闭 | apiFetch 支持 204/empty body，并有真实 Response 测试 |
| 子进程继承其他 Provider key | ⚠️ 部分修复 | 10 个 allowlist key 已过滤，其他常见云/API credential 仍继承 |
| auth message regex 漏 key | ✅ 关闭 | exact-value redaction + regex defense-in-depth |
| POSIX 不搜索无扩展命令 | ✅ 关闭 | 按平台搜索并检查 X_OK；POSIX 测试已添加 |
| UNC HOME 变量无效 | ✅ 关闭 | 使用 HOMESHARE/HOMEPATH，并覆盖 malformed UNC |
| re-probe unmanaged | ✅ 关闭 | pending set、日志、有界 shutdown 和测试已实现 |
| unavailable validator 隐藏 warning | ✅ 关闭 | UI 区分未配置与已配置但不可用 |
| 文档真相源矛盾 | ✅ 关闭 | 历史结论标为 superseded，AC-001 当前状态一致 |

## Findings

### Correctness / Performance

#### 🟠 AC-001 仍未实现，且同步 CLI 探测会阻塞整个 Server 请求循环 — `server/src/services/adapter-config.ts:45-65`, `:185-208`, `:264-272`; `docs/features/0.1/F005-multi-agent-manual-routing/spec.md:393`

**Severity**: High

**Problem**: create 和 command update 仍同步执行 `spawnSync(..., ["--version"])`，并把退出 0 直接写成 `Available`。这仍然不能证明 Claude/OpenCode 已登录或 API key 有效，未登录 adapter 仍可自动成为 Project default。由于 `spawnSync` 位于 Fastify 请求路径，命令最多 10 秒不返回时会阻塞同一 Node 进程内的所有 API、SSE 和 queue orchestration。本轮 Server 全套已实际出现 create route 超过 5 秒的超时。

鉴权字段变化仍没有统一失效旧 probe：仅更新 `auth_type`、`api_key`、`model_provider`、`default_model` 时，旧 `Available` 仍可能保留。

**Current Code**:

```ts
const result = spawnSync(
  resolved.executable,
  [...resolved.prefixArgs, "--version"],
  { timeout: 10_000, encoding: "utf-8", shell: false },
);

const validation = validateCommand(trimmedCommand);
const status = validation.available
  ? AdapterStatus.Available
  : AdapterStatus.Unavailable;
```

**Suggested Fix**:

```ts
const executable = resolveExecutable(trimmedCommand);
const status = executable.resolved
  ? AdapterStatus.Unknown
  : AdapterStatus.Unavailable;

if (commandOrAuthFieldsTouched) {
  updates.status = executable.resolved
    ? AdapterStatus.Unknown
    : AdapterStatus.Unavailable;
  updates.last_checked_at = null;
  updates.auth_status_message = null;
}
```

create/update 只做同步、无子进程的 command 解析与字段校验；真实 Provider probe 只由显式 async validate 执行。只有 `adapter.validate()` 成功后才能写 `Available`。增加 create/update 四类状态测试，并让 route tests 不依赖本机真实 CLI 响应时间。

**Explanation**: 这同时修复 availability 语义和事件循环阻塞。把测试 timeout 调大只能隐藏阻塞，不能解决产品请求被同步子进程卡住的问题。

**处理结果（2026-07-24 追加）**：本条捆绑的两个问题**已拆开、分别处理**——阻塞事件循环的 `spawnSync(["--version"])` 已彻底移除，create/update 现在只做同步、无子进程的 `resolveExecutable()` 解析，不再有 5 秒级请求阻塞（已用真实并发全套验证，超时不再复现）。但 **availability 语义本身（命令可解析即写 `Available`，鉴权字段变化不使旧状态失效）有意未按 Suggested Fix 改成 `Unknown`**：这会牵连"首个 available adapter 自动设为 Project default"逻辑和大量既有测试对"创建后立即可用"的假设，是比"去掉阻塞子进程"更大范围的产品/架构改动，经与用户确认后留待后续单独排期。当前状态详见 `spec.md` 第 8 节 AC-001 条目。

**二次追加（2026-07-24）**：本条已实施完成——create()/update() 不再直接把可解析命令判定为 `Available`，统一先落 `Unknown`，随后异步触发真实 provider `validate()` 收敛（成功才置 `Available` 并按需应用 default-adapter 分配；失败或探测异常则保持 Unknown/Unavailable，绝不静默提升）。详见 `spec.md` 第 8 节 AC-001 条目最新状态。

---

#### 🟠 workspace-aware availability 仍没有可用的持久化/路由模型 — `server/src/services/adapter-config.ts:434-460`; `server/src/services/adapter-resolver.ts:22`; `server/src/services/run-dispatch.ts:189-218`

**Severity**: High

**Problem**: 新代码避免把 `push_credentials_enabled=true` workspace 的成功结果写成全局 `Available`，改写为 `Unknown`。这能避免其他隔离 workspace 被错误放行，但产生两个仍未解决的方向：

1. 成功 probe 的那个非隔离 workspace 自己也无法路由，因为 resolver 只接受全局 `Available`；
2. 任一 workspace probe 失败仍写全局 `Unavailable`，会禁用同 Project 中本来可以使用该 adapter 的其他 workspace；
3. Run failure re-probe 同样会把 workspace-specific 失败写成全局 `Unavailable`。

因此当前所谓 workspace-aware 后端能力无法表达“在 workspace A 可用、workspace B 不可用”，并且成功结果不能转化为可执行路由状态。

**Current Code**:

```ts
const status = result.available
  ? (pushCredentialsEnabled ? AdapterStatus.Unknown : AdapterStatus.Available)
  : AdapterStatus.Unavailable;

// Resolver later:
if (adapter.status !== AdapterStatus.Available) {
  return { ok: false, errorCode: ErrorCode.ADAPTER_UNAVAILABLE };
}
```

**Suggested Fix**:

```ts
resolveAdapter(deps, {
  projectId,
  workspaceId,
  explicitAdapterId,
});

// Persist/read:
adapter_workspace_status(
  adapter_config_id,
  workspace_id,
  status,
  last_checked_at,
  auth_status_message
)
```

default/explicit resolver、ValidatorSelector 和 failure convergence 都必须按目标 Issue workspace 读取状态。如果 F005 不引入该表，则应采用明确的产品收紧：Windows OpenCode OAuth 在 Project 层始终不可用，只支持 API key，而不是暴露一个无法被 resolver 消费的 workspace 参数。

**Explanation**: `Unknown` 只是避免了错误放行，没有完成“目标 workspace 验证成功后可运行”的需求。决定可用性的维度和持久化/查询维度必须一致。

**处理结果（2026-07-24 追加）**：**有意未处理**——按本条 Suggested Fix 把 availability 扩展到 `(adapter, workspace)` 持久化/查询模型需要新增数据表 + resolver/ValidatorSelector 多处签名变更，规模上是功能新增而非 bug 修复，经与用户确认后留待后续单独排期。当前状态详见 `spec.md` 第 8 节 AC-001 条目。

**二次追加（2026-07-24）**：本条已实施完成——新增 schema v7 `adapter_workspace_status` 表作为「例外覆盖」：`agent_configs.status` 保持 Project 级保守基线，`effectiveAdapterStatus()`（`adapter-availability.ts`）合并全局状态与该表按 `(adapter_config_id, workspace_id)` 存的覆盖记录；`AdapterResolver`、`ValidationWorkflowService.claimValidatorSlot()`、`RunDispatchService.reprobeAdapterOnFailure()`、`AdapterConfigService.validate(id, workspaceId)` 均已切换为按合并结果判断，workspace 范围内的探测/失败只写该 workspace 的覆盖行，不再连累同 Project 其它 workspace。详见 `spec.md` 第 8 节 AC-001 条目最新状态。

---

### API Correctness

#### 🟡 HTTP 运行时校验只覆盖部分字段，错误类型仍可能返回 500 — `server/src/api/routes/adapters.ts:47-68`, `:83`, `:90-108`, `:122`; `server/src/api/routes/runs.ts:26-38`

**Severity**: Medium

**Problem**: 本轮新增的 `parseOptionalStringArray()`、`parseOptionalCapabilityTags()` 和 `parsePurpose()` 正确关闭了已举例的数组/purpose 问题，但路由仍把其余网络输入直接 cast 成 TypeScript 类型。例如：

- `name: 123`、`command: {}`、`default_model: 1`、`api_key: []` 会在 service 调用 `.trim()` 时抛 TypeError，映射成 500；
- Run 的 `instructions: 123` 会在 `ManualRoutingService` 的 `.trim()` 抛 TypeError；
- `adapter_id`、`workspace_id`、`make_default` 和 default-adapter body 没有运行时类型校验；
- 实现与 design §9.1“provider/auth/model/capability 用 Zod/显式 schema 校验”仍不一致。

**Current Code**:

```ts
const body = (request.body ?? {}) as {
  name?: string;
  command?: string;
  default_model?: string;
  api_key?: string;
  make_default?: boolean;
};

const trimmedName = input.name?.trim();
```

**Suggested Fix**:

```ts
const adapterCreateSchema = z.object({
  name: z.string().trim().min(1),
  cli_provider: z.nativeEnum(CliProvider),
  command: z.string().trim().min(1),
  args: z.array(z.string()).optional(),
  default_model: z.string().nullable().optional(),
  auth_type: z.nativeEnum(AdapterAuthType).optional(),
  model_provider: z.string().nullable().optional(),
  api_key: z.string().optional(),
  capability_tags: z.array(z.nativeEnum(AgentCapability)).optional(),
  make_default: z.boolean().optional(),
}).strict();
```

为 create/update/default/validate/run create 定义完整 schema，并把 Zod error 统一映射为 `REQUEST_BODY_INVALID`。补充数字、对象、null 和未知字段的 route tests。

**Explanation**: TypeScript cast 对 HTTP JSON 没有任何运行时作用。部分手写 parser 容易再次遗漏字段，完整 schema 才能保证所有错误输入稳定返回 400。

---

### Security

#### 🟡 credential isolation 只过滤 10 个 allowlist key，仍继承其他常见云凭据 — `server/src/runtime/workspace-context.ts:8-16`, `:63-82`

**Severity**: Medium

**Problem**: 已正确过滤 `OPENCODE_MODEL_PROVIDER_ENV` 中的 10 个 API key，并做了大小写不敏感测试；但隔离模式仍复制 `process.env` 的其余所有变量。常见的 `AZURE_OPENAI_API_KEY`、`AWS_ACCESS_KEY_ID`、`AWS_SECRET_ACCESS_KEY`、`AWS_SESSION_TOKEN`、`AZURE_CLIENT_SECRET`、`GOOGLE_APPLICATION_CREDENTIALS`、`HF_TOKEN` 等仍会进入可执行 shell 的 agent 子进程。

这仍未完全达到 design §2/§5.3/§11 的“只有最小 CLI auth material”，也没有完成上一报告建议中的“云平台 credential 变量”部分。

**Current Code**:

```ts
const MODEL_PROVIDER_API_KEY_DENYLIST = new Set(
  Object.values(OPENCODE_MODEL_PROVIDER_ENV)
    .map((name) => name.toUpperCase()),
);

for (const [key, value] of Object.entries(process.env)) {
  // remove selected names only
  env[key] = value;
}
```

**Suggested Fix**:

优先改成明确的 child-env allowlist（PATH、系统运行必需变量、locale/temp 等）再注入当前 Provider auth material。若暂时保留 denylist，至少集中覆盖云厂商 credential family 和常见 token 名，并用多个非 OpenCode allowlist canary 做回归测试。Windows key 比较继续保持大小写不敏感。

**Explanation**: 多 Provider agent 可以执行任意 shell 命令，任何遗留环境 secret 都可以被读取。仅过滤当前功能已列出的 10 个名字不能构成“最小 auth material”边界。

---

### Testing / Observability

#### 🟢 新 re-probe 对缺失 Run 记录 warning，测试清理又未等待该生命周期 — `server/src/services/run-dispatch.ts:127`, `:147-169`, `:189`; `server/tests/helpers.ts:224-226`

**Severity**: Low

**Problem**: `finalizeAndDrain("nonexistent", ...)` 现在无条件启动 re-probe；`reprobeAdapterOnFailure()` 调用会抛 404 的 `runService.get()`，被记录为“availability re-probe failed”。本轮全套中 queue-drain/terminal tests 因其原有的 nonexistent fixture 输出了大量 warning。与此同时 `disposeTestServices()` 只触发未等待的 `agentRunner.shutdown()` 后立即关闭 DB，没有等待新增的 `runDispatchService.shutdown()`；存在 in-flight probe 时可能在 DB 已关闭后继续执行并制造跨测试噪音。

**Current Code**:

```ts
this.trackAvailabilityProbe(runId, this.reprobeAdapterOnFailure(runId));

const run = this.runService.get(runId); // throws when missing

export function disposeTestServices(services): void {
  void services.agentRunner.shutdown();
  services.db.close();
}
```

**Suggested Fix**:

re-probe 使用 nullable repository lookup，对不存在/非失败 Run 静默 no-op；或者只在确认 terminal Run 为目标 failure reason 后注册任务。将 test disposal 改为 async，依次 await `agentRunner.shutdown()`、`runDispatchService.shutdown()` 再关闭 DB。

**Explanation**: 预期 no-op 不应污染 warning 通道；测试 teardown 必须遵守生产中新引入的后台任务生命周期，否则会掩盖真正的 probe 异常并增加 flaky 风险。

---

## Positive Observations

- validator Run 现在预生成 ID、先完整构建 context 再插入，彻底消除了失败事务中的半写入状态；对应超大 context 测试还验证了修复原因后可重试。
- `capability_tags` create/update 的 omitted/empty/persist 语义已经一致，routing 查询测试覆盖完整。
- Web edit clear 采用 `[]` / `null` 三态契约，Server effective-state 校验和 UI 测试同步更新。
- apiFetch 的 204 修复使用真实 `Response` 对象测试，不再被模块 mock 掩盖。
- exact-secret redaction 同时覆盖显式 validate 与 failed-Run re-probe，未知 key 格式也不会回显。
- executable resolver 按 Windows/POSIX 分流并检查普通文件/X_OK，安全性和可移植性均优于旧实现。
- workspace home 变量、availability probe pending set、有界 shutdown、validator warning 和文档 superseded 标记均有针对性回归测试。
- Web 162 项、修改相关 Server 195 项、类型检查和生产构建全部通过。

## Summary

| Severity | Count |
|----------|-------|
| 🔴 Critical | 0 |
| 🟠 High | 2 |
| 🟡 Medium | 2 |
| 🟢 Low | 1 |
| 🔵 Info | 0 |

**Bottom Line**: 本轮修复质量总体良好，但 AC-001 和 workspace availability 模型仍是发布阻断项；在这两项关闭、HTTP schema 补全并让标准 Server 全套稳定全绿前，F005 应继续保持 `review`。
