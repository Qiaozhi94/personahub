---
feature_ids: [F005]
doc_kind: code-review
review_date: 2026-07-24
review_scope: final-release-recheck-3
based_on:
  - code-review-report-final-recheck-2.md
---

# Code Review Report

**Reviewed**: F005 当前完整未提交实现、`code-review-report-final-recheck-2.md` 的 3 项 finding 修复、相关需求/设计/任务文档、共享契约、Server/Web 自动化测试与生产构建
**Language(s)**: TypeScript, React, SQL, Markdown
**Review Date**: 2026-07-24
**Severity Legend**: 🔴 Critical | 🟠 High | 🟡 Medium | 🟢 Low | 🔵 Info

---

## Executive Summary

上一轮 3 项 finding 中，credential isolation 已从 denylist 正确改为 allowlist，任意未命名 secret 默认不再继承；但 allowlist 又原样放行可能携带账号密码的 proxy URL，因此安全项仍有一个较小但真实的例外。其余 **2 项 High 没有代码变化**：create/update 仍把命令文件存在当成已鉴权 `Available`，workspace-aware availability 仍没有 workspace 级持久化与路由模型。

自动化验证全绿：Server 105 files / 1332 tests、Web 21 files / 162 tests、typecheck、production build、`git diff --check` 均通过。由于两项 High 直接违反 AC-001 和目标 workspace 路由正确性，F005 仍应保持 `review`。

## Verification

| Check | Result |
| --- | --- |
| `npm run typecheck` | 通过 |
| Server 标准全套 | 通过：105 files / 1332 tests；9 files / 16 tests 按 real-CLI/env/POSIX gate skipped |
| Allowlist/adapter 定向测试 | 通过：5 files / 67 tests |
| Web 标准全套 | 通过：21 files / 162 tests |
| `npm run build` | 通过；shared/server/web production build 成功 |
| `git diff --check` | 通过 |
| Real CLI env-gated tests | 本轮未启用；文档记录的历史真实 CLI 结果未在本轮重跑 |
| 真实浏览器冒烟 | 本轮未重试；上一轮已确认当前执行环境无法让后台本地服务持续监听 |

Server 仍输出一处 Vitest 4 timeout-options 迁移 warning；Web 仍输出既有 React Query “data cannot be undefined” warning，均不影响测试通过结论。

## Prior Finding Closure Matrix

| 上一报告 finding | 状态 | 本轮结论 |
| --- | --- | --- |
| resolvable command 被当成已鉴权 Available | ❌ 未关闭 | `adapter-config.ts` 和对应测试语义均未变化 |
| workspace-aware availability | ❌ 未关闭 | 仍使用唯一 adapter 全局 status，resolver 仍无 workspaceId |
| credential env denylist | ⚠️ 主体关闭 | 已改 allowlist；任意 secret canary 被过滤，但 credential-bearing proxy URL 仍原样透传 |

## Findings

### Correctness

#### 🟠 命令文件存在仍被当成已鉴权 Available，auth/model 更新仍保留陈旧状态 — `server/src/services/adapter-config.ts:56-64`, `:181-205`, `:260-269`, `:320-345`; `server/tests/unit/adapter-config-command-resolution.test.ts:32-39`

**Severity**: High

**Problem**: `validateCommand()` 在 `resolveExecutable()` 找到文件后仍返回 `available: true`，create/update 随即写入 `AdapterStatus.Available`。该事实只证明命令路径可解析，不能证明 Claude/OpenCode 已登录、API key 有效或 provider/model 可调用。create 还会自动把这个未经真实 probe 的 adapter 设为 Project default。

仅修改 `auth_type`、`api_key`、`model_provider`、`default_model` 时也不会使旧 `Available` 失效。上一轮指出的 command-resolution 测试仍明确断言 “resolvable command = Available”，所以此项没有发生实质修复。

**Current Code**:

```ts
const { resolved, errorMessage: resolveError } = resolveExecutable(command);
if (!resolved) {
  return { available: false, errorMessage: resolveError ?? `Command not found: ${command}` };
}
return { available: true, errorMessage: null };

const status: AdapterStatus = validation.available ? AS.Available : AS.Unavailable;
```

**Suggested Fix**:

```ts
const resolution = resolveExecutable(trimmedCommand);
const status = resolution.resolved
  ? AdapterStatus.Unknown
  : AdapterStatus.Unavailable;

if (commandOrAuthFieldsTouched) {
  updates.status = resolution.resolved
    ? AdapterStatus.Unknown
    : AdapterStatus.Unavailable;
  updates.last_checked_at = null;
  updates.auth_status_message = null;
}
```

只有 `AdapterConfigService.validate()` 的异步真实 provider/auth probe 成功后才写 `Available`。同步修改测试：命令可解析应得到 `Unknown`，命令不存在才是 `Unavailable`，auth/model/key 任一变化应使旧状态失效。

**Explanation**: 可执行文件存在、CLI 可启动、账号可用是三个不同层级。当前代码继续把第一层提升成第三层，直接违反 design §5.2 和 AC-001。

**处理结果（2026-07-24 追加）**：**有意保留，不是遗漏**。已就此与用户明确讨论：把默认状态改成 `Unknown` 会牵连"首个 available adapter 自动设为 Project default"逻辑和大量既有测试对"创建后立即可用"的行为假设，属于比本轮 review 驱动修复更大范围的产品/架构改动，需要单独排期决策。当前状态详见 `spec.md` 第 8 节 AC-001 条目。

**二次追加（2026-07-24）**：本条已实施完成——create()/update() 不再直接把可解析命令判定为 `Available`，统一先落 `Unknown`，随后异步触发真实 provider `validate()` 收敛（成功才置 `Available` 并按需应用 default-adapter 分配；失败或探测异常则保持 Unknown/Unavailable，绝不静默提升）。详见 `spec.md` 第 8 节 AC-001 条目最新状态。

---

#### 🟠 workspace-aware availability 仍无法表达或消费 workspace 级可用性 — `server/src/services/adapter-config.ts:430-467`; `server/src/services/adapter-resolver.ts:22-48`; `server/src/services/run-dispatch.ts:189-222`

**Severity**: High

**Problem**: `validate(id, workspaceId)` 会按 workspace 构造 probe 环境，但结果仍写入唯一的 adapter 全局 status：

1. 非隔离 workspace 成功只写 `Unknown`，该 workspace 自己仍无法通过只接受 `Available` 的 resolver；
2. 任一 workspace 失败会写全局 `Unavailable`，禁用其他本来可用的 workspace；
3. failed-Run re-probe 同样将 workspace-specific failure 写成全局状态；
4. resolver 与 ValidatorSelector 都没有目标 workspace 状态输入。

本轮相关文件没有模型、migration、repository 或 resolver 变更，因此该项未关闭。

**Current Code**:

```ts
const status: AdapterStatus = result.available
  ? (pushCredentialsEnabled ? AS.Unknown : AS.Available)
  : AS.Unavailable;

if (adapter.status !== AdapterStatus.Available) {
  return { ok: false, errorCode: ErrorCode.ADAPTER_UNAVAILABLE };
}
```

**Suggested Fix**:

```sql
CREATE TABLE adapter_workspace_status (
  adapter_config_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  status TEXT NOT NULL,
  last_checked_at TEXT,
  auth_status_message TEXT,
  PRIMARY KEY (adapter_config_id, workspace_id)
);
```

```ts
resolveAdapter(deps, {
  projectId,
  workspaceId,
  explicitAdapterId,
});
```

显式/default resolver、ValidatorSelector、validate API 和 failure convergence 必须按目标 Issue workspace 读写同一状态维度。若 F005 不引入该模型，则应收紧产品能力，不暴露无法被路由消费的 workspace-aware validate。

**Explanation**: probe 维度与状态存储/查询维度不一致时，不可能同时避免错误放行和错误禁用。

**处理结果（2026-07-24 追加）**：**有意未处理**——引入 `(adapter, workspace)` 持久化/查询模型需要新增数据表 + resolver/ValidatorSelector 多处签名变更，规模上是功能新增而非 bug 修复，经与用户确认后留待后续单独排期。当前状态详见 `spec.md` 第 8 节 AC-001 条目。

**二次追加（2026-07-24）**：本条已实施完成——新增 schema v7 `adapter_workspace_status` 表作为「例外覆盖」：`agent_configs.status` 保持 Project 级保守基线，`effectiveAdapterStatus()`（`adapter-availability.ts`）合并全局状态与该表按 `(adapter_config_id, workspace_id)` 存的覆盖记录；`AdapterResolver`、`ValidationWorkflowService.claimValidatorSlot()`、`RunDispatchService.reprobeAdapterOnFailure()`、`AdapterConfigService.validate(id, workspaceId)` 均已切换为按合并结果判断，workspace 范围内的探测/失败只写该 workspace 的覆盖行，不再连累同 Project 其它 workspace。详见 `spec.md` 第 8 节 AC-001 条目最新状态。

---

### Security

#### 🟡 allowlist 原样继承可携带账号密码的 proxy URL — `server/src/runtime/workspace-context.ts:41-47`, `:91-105`; `server/tests/integration/credential-isolation.test.ts:191-200`

**Severity**: Medium

**Problem**: 改成 allowlist 后，任意普通 secret 已能默认排除，这是正确修复。但 `HTTP_PROXY`、`HTTPS_PROXY`、`ALL_PROXY` 被原样继承，代码注释将它们假设为“hostname/port, not a credential”。实际标准代理 URL 可以是：

```text
http://username:password@proxy.example.internal:8080
```

此时具备 shell 能力的 agent 可直接读取代理用户名和密码。当前测试只覆盖无认证 URL，无法捕获这个例外。`NODE_OPTIONS`/`NODE_EXTRA_CA_CERTS` 属于兼容性配置，本轮未发现直接 secret 回显路径；问题集中在 proxy URL 的 userinfo。

**Current Code**:

```ts
"HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "ALL_PROXY",

if (SAFE_PARENT_ENV_NAMES.has(key.toUpperCase())) {
  env[key] = value;
}
```

**Suggested Fix**:

```ts
function safeProxyValue(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.username || url.password) return null;
    return value;
  } catch {
    return null;
  }
}
```

对 proxy 字段单独校验：无 userinfo 的 URL 才能继承；含凭据时 fail closed，并在 validate/dispatch 返回不含原值的明确配置错误。至少增加 `http://user:secret@host:8080` 不进入 child env 的回归测试。如果产品必须支持鉴权代理，应设计独立、不可被 agent shell 读取的代理转发机制，而不是把凭据放进子进程环境。

**Explanation**: allowlist 的安全属性取决于“被允许变量的值也不含 secret”。仅按变量名分类无法保证这一点。

## Positive Observations

- credential isolation 已真正从 denylist 改为 allowlist；`SENTRY_AUTH_TOKEN`、`DATABASE_URL`、企业自定义 token 等任意 canary 均被默认过滤。
- HOME/provider auth 目录仍由代码显式重建，没有因 allowlist 改造重新暴露用户完整 HOME。
- Claude/OpenCode 的 credential-failure 集成用例仍在 `push_credentials_enabled=false` 下执行，并通过 argv 控制 fake 场景，没有破坏 escalation 覆盖。
- 完整 Server 套件从 1330 增至 1332 项且全部通过；Web、类型检查、构建也保持全绿。

## Summary

| Severity | Count |
|----------|-------|
| 🔴 Critical | 0 |
| 🟠 High | 2 |
| 🟡 Medium | 1 |
| 🟢 Low | 0 |
| 🔵 Info | 0 |

**Bottom Line**: allowlist 主体修复有效，但前两项发布阻断问题完全未变，且 proxy credential 仍需收口；F005 继续保持 `review`。
