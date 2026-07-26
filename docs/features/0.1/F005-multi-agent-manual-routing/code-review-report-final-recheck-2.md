---
feature_ids: [F005]
doc_kind: code-review
review_date: 2026-07-24
review_scope: final-release-recheck-2
based_on:
  - code-review-report-final-recheck.md
---

# Code Review Report

**Reviewed**: F005 当前完整未提交实现、`code-review-report-final-recheck.md` 的 5 项 finding 修复、相关需求/设计/任务文档、共享契约、Server/Web 自动化测试与生产构建
**Language(s)**: TypeScript, React, SQL, Markdown
**Review Date**: 2026-07-24
**Severity Legend**: 🔴 Critical | 🟠 High | 🟡 Medium | 🟢 Low | 🔵 Info

---

## Executive Summary

上一轮 5 项 finding 中，HTTP 请求体运行时校验和 availability re-probe 生命周期已完整关闭；同步 `spawnSync("--version")` 造成的事件循环阻塞也已关闭。当前仍有 **2 项 High、1 项 Medium**：create/update 仍把“命令文件存在”误当成“adapter 已登录且可用”，workspace-aware availability 仍没有与 workspace 对齐的持久化/路由模型，credential isolation 仍依赖无法穷举的 denylist。

自动化验证现已全绿：Server 105 files / 1330 tests、Web 21 files / 162 tests、typecheck、production build 和 `git diff --check` 均通过。由于前两项直接影响 AC-001 和真实路由正确性，F005 仍应保持 `review`，不建议进入 `done`。

## Verification

| Check | Result |
| --- | --- |
| `npm run typecheck` | 通过 |
| Server 标准全套 | 通过：105 files / 1330 tests；9 files / 16 tests 按 real-CLI/env/POSIX gate skipped |
| Web 标准全套 | 通过：21 files / 162 tests |
| `npm run build` | 通过；shared/server/web production build 成功 |
| `git diff --check` | 通过 |
| Real CLI env-gated tests | 本轮未启用 |
| 真实浏览器冒烟 | 未完成：当前执行环境无法让后台本地服务在命令结束后持续监听；临时 DB/日志目录已完整删除 |

补充说明：Web 测试首次在沙箱映射路径下错误报告找不到实际存在且已跟踪的 `web/src/test/setup.ts`；在真实工作区路径重跑后 162/162 通过，判定为执行环境路径映射问题，不是仓库缺陷。Web 测试仍输出既有 React Query “data cannot be undefined” warning；Server 测试输出一处 Vitest 4 timeout-options 迁移 warning，均不影响本轮通过结论。

## Prior Finding Closure Matrix

| 上一报告 finding | 状态 | 本轮结论 |
| --- | --- | --- |
| AC-001 + 同步 CLI 探测 | ⚠️ 部分关闭 | `spawnSync` 阻塞已关闭；“命令可解析即 Available”及 auth/model 修改保留旧 Available 仍未关闭 |
| workspace-aware availability | ❌ 未关闭 | 持久化和 resolver 仍只读取 adapter 全局 status |
| HTTP 运行时校验不完整 | ✅ 关闭 | adapters/runs 的全部请求体字段已由 Zod schema 校验并统一映射 `REQUEST_BODY_INVALID` |
| credential env 隔离不完整 | ⚠️ 部分关闭 | 已补 AWS/Azure/GCP/HF/npm 等常见变量，但仍复制除 denylist 外的全部 parent env |
| 缺失 Run warning / teardown 未等待 | ✅ 关闭 | 改用 nullable repository lookup；测试 teardown 依次 await runner/dispatch shutdown |

## Findings

### Correctness

#### 🟠 命令文件存在仍被当成已鉴权 Available，auth/model 更新也会保留陈旧状态 — `server/src/services/adapter-config.ts:56-64`, `:181-205`, `:260-269`, `:320-345`; `server/tests/unit/adapter-config-command-resolution.test.ts:32-39`

**Severity**: High

**Problem**: 本轮正确移除了请求路径里的同步子进程，但 `validateCommand()` 在 `resolveExecutable()` 找到文件后仍返回 `available: true`，create/update 随即写入 `AdapterStatus.Available`。这只能证明命令文件存在，不能证明 Claude/OpenCode 已登录、API key 有效或 model/provider 可调用。create 还会把该 adapter 自动设为 Project default。

此外，仅修改 `auth_type`、`api_key`、`model_provider`、`default_model` 时，代码完成字段校验后没有使旧 probe 失效，之前的 `Available` 会继续保留。新增的 command-resolution 测试甚至明确断言“resolvable command = Available”，把 AC-001 的错误语义固化成了回归预期。

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
}
```

只有异步 `AdapterConfigService.validate()` 的真实 provider/auth probe 成功后才能写 `Available`。同步更新对应测试：command 可解析应断言 `Unknown`；command 不存在才断言 `Unavailable`；auth/model/key 任一变化应使旧 `Available` 失效。

**Explanation**: 移除 `spawnSync` 解决了性能问题，但没有解决 AC-001 的可用性语义。可执行文件存在、CLI 能启动、账号已登录是三层不同事实，路由只应信任最后一层。

**处理结果（2026-07-24 追加）**：**有意保留，不是遗漏**。已就此与用户明确讨论：把默认状态改成 `Unknown` 会牵连"首个 available adapter 自动设为 Project default"逻辑和大量既有测试对"创建后立即可用"的行为假设，属于比本轮 review 驱动修复更大范围的产品/架构改动，需要单独排期决策。当前状态详见 `spec.md` 第 8 节 AC-001 条目。

**二次追加（2026-07-24）**：本条已实施完成——create()/update() 不再直接把可解析命令判定为 `Available`，统一先落 `Unknown`，随后异步触发真实 provider `validate()` 收敛（成功才置 `Available` 并按需应用 default-adapter 分配；失败或探测异常则保持 Unknown/Unavailable，绝不静默提升）。详见 `spec.md` 第 8 节 AC-001 条目最新状态。

---

#### 🟠 workspace-aware availability 仍无法表达或消费 workspace 级可用性 — `server/src/services/adapter-config.ts:430-467`; `server/src/services/adapter-resolver.ts:22-48`; `server/src/services/run-dispatch.ts:189-222`

**Severity**: High

**Problem**: `validate(id, workspaceId)` 虽然按目标 workspace 构造 probe 环境，但结果仍写入唯一的 adapter 全局 status：

1. `push_credentials_enabled=true` workspace probe 成功写 `Unknown`，该 workspace 自己随后也无法路由，因为 resolver 只接受全局 `Available`；
2. 任一 workspace probe 失败写全局 `Unavailable`，会禁用同 Project 中其他本来可用的 workspace；
3. failed-Run re-probe 同样把 workspace-specific failure 写成全局 `Unavailable`；
4. resolver 没有 `workspaceId` 参数，ValidatorSelector 也只能读取全局状态。

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

显式/default resolver、ValidatorSelector、validate API 和 failure convergence 必须按目标 Issue workspace 读写同一维度的状态。如果 F005 不准备引入该模型，应明确收紧产品能力，例如 Windows OpenCode OAuth 在 Project 层始终不可用并只支持 API key，而不是保留无法被路由消费的 workspace 参数。

**Explanation**: probe 的环境维度与状态存储/查询维度不一致时，不可能同时避免错误放行和错误禁用；`Unknown` 只隐藏了冲突，没有完成目标 workspace 的可执行路由。

**处理结果（2026-07-24 追加）**：**有意未处理**——按本条 Suggested Fix 引入 `(adapter, workspace)` 持久化/查询模型需要新增数据表 + resolver/ValidatorSelector 多处签名变更，规模上是功能新增而非 bug 修复，经与用户确认后留待后续单独排期。当前状态详见 `spec.md` 第 8 节 AC-001 条目。

**二次追加（2026-07-24）**：本条已实施完成——新增 schema v7 `adapter_workspace_status` 表作为「例外覆盖」：`agent_configs.status` 保持 Project 级保守基线，`effectiveAdapterStatus()`（`adapter-availability.ts`）合并全局状态与该表按 `(adapter_config_id, workspace_id)` 存的覆盖记录；`AdapterResolver`、`ValidationWorkflowService.claimValidatorSlot()`、`RunDispatchService.reprobeAdapterOnFailure()`、`AdapterConfigService.validate(id, workspaceId)` 均已切换为按合并结果判断，workspace 范围内的探测/失败只写该 workspace 的覆盖行，不再连累同 Project 其它 workspace。详见 `spec.md` 第 8 节 AC-001 条目最新状态。

---

### Security

#### 🟡 credential isolation 仍是不可穷举的 denylist，任意其他 secret 会进入 agent 子进程 — `server/src/runtime/workspace-context.ts:6-25`, `:73-105`

**Severity**: Medium

**Problem**: 本轮新增了 AWS/Azure/GCP/HF/npm 等常见变量，关闭了上一报告列出的具体示例，但实现仍从 `process.env` 复制所有不在 denylist 的变量。`SENTRY_AUTH_TOKEN`、`DATABASE_URL`、`SLACK_TOKEN`、自定义 `*_TOKEN`/`*_SECRET`、企业内部凭据等仍会进入具备任意 shell 执行能力的 agent 子进程。

代码注释也已承认 denylist “cannot enumerate every possible credential variable”。因此当前实现仍不符合 design §2/§5.3/§11 的“only minimal CLI auth material”边界。

**Current Code**:

```ts
const env: Record<string, string> = {};
for (const [key, value] of Object.entries(process.env)) {
  if (MODEL_PROVIDER_API_KEY_DENYLIST.has(key.toUpperCase())) continue;
  env[key] = value;
}
```

**Suggested Fix**:

```ts
const SAFE_PARENT_ENV = new Set([
  "PATH", "PATHEXT", "SYSTEMROOT", "WINDIR", "COMSPEC",
  "TEMP", "TMP", "LANG", "LC_ALL", "TERM",
]);

for (const [key, value] of Object.entries(process.env)) {
  if (value !== undefined && SAFE_PARENT_ENV.has(key.toUpperCase())) {
    env[key] = value;
  }
}
```

在最小系统环境之上，再显式注入 workspace HOME、Git 禁交互配置和当前 adapter 唯一需要的 auth material。为任意未预先登记的 canary（例如 `PERSONAHUB_TEST_SECRET`）增加“不继承”测试，验证安全属性而不是某一份变量名单。

**Explanation**: 对可执行任意命令的子进程，denylist 永远只能降低已知泄漏，不能建立安全边界；allowlist 才能兑现“只暴露最小材料”的设计承诺。

## Positive Observations

- `spawnSync("--version")` 已彻底从 adapter create/update 请求路径移除；全套中的 adapter route 不再超时。
- adapters/runs 全部请求体字段已用 Zod 做运行时校验，错误统一为 400 `REQUEST_BODY_INVALID`，原先的 TypeError→500 路径已关闭。
- re-probe 对不存在 Run 静默 no-op，测试 teardown 会等待 runner 和 dispatch service 的后台生命周期，未再观察到上一轮的 warning 噪音。
- 常见 cloud/model-provider key 的大小写不敏感过滤和回归测试覆盖完整，虽仍需升级为 allowlist，但本轮修复本身正确。
- Server 1330、Web 162、类型检查和 production build 全绿；前一轮唯一的标准套件超时已消失。

## Summary

| Severity | Count |
|----------|-------|
| 🔴 Critical | 0 |
| 🟠 High | 2 |
| 🟡 Medium | 1 |
| 🟢 Low | 0 |
| 🔵 Info | 0 |

**Bottom Line**: 本轮关闭了 2 项 finding 并消除了同步 CLI 阻塞，但 AC-001 与 workspace availability 仍是发布阻断项；credential isolation 需从 denylist 改为 allowlist 后，F005 才适合进入 `done`。
