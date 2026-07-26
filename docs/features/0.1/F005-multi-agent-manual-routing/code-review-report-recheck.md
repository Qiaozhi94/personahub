---
feature_ids: [F005]
doc_kind: code-review
review_date: 2026-07-23
review_scope: post-fix-recheck
supersedes: null
related_review: code-review-report-implementation.md
---

# Code Review Report

**Reviewed**: F005 对 `code-review-report-implementation.md` 9 项 finding 的修复 diff、相关需求文档与新增回归测试
**Language(s)**: TypeScript, React, SQL, Markdown
**Review Date**: 2026-07-23
**Severity Legend**: 🔴 Critical | 🟠 High | 🟡 Medium | 🟢 Low | 🔵 Info

---

## Executive Summary

上一轮 9 项 finding 中，capability 持久化、validator context source、manual validator 指令、Windows `shell=false`、pretypecheck、composer availability guard 和 checklist 漏勾均已落实，相关定向测试通过。仍有 1 个高优先级产品/验收缺口和 3 个中优先级 availability 安全/一致性问题：AC-001 被勾选为完成，但创建/更新仍会把仅通过 `--version` 的未登录 adapter 标为 available，且 Windows 上 OpenCode OAuth 现在被实现明确判定为永远 unavailable；运行期收敛又排除了 consult，并存在异步旧 probe 覆盖新配置的竞态。当前建议继续保持 `review`，关闭下列问题后再进入 `done`。

## Verification

| Check | Result |
| --- | --- |
| `npm run typecheck` | 通过；新增 `pretypecheck` 会先构建 shared |
| 修复相关 Server 定向测试 | 通过：5 files / 66 tests |
| 修复相关 Web 定向测试 | 通过：2 files / 18 tests |
| `npm test` | 通过：server/web 全套；real-CLI tests 按 env gate skipped；Web 155 tests |
| `npm run build` | 通过：shared/server/web production build 成功 |
| `git diff --check` | 通过 |

本轮未设置 `REAL_CODEX` / `REAL_CLAUDE` / `REAL_OPENCODE`，因此不把仓库内历史 Phase 13 记录算作本轮真实 CLI 复验。Web 测试仍输出既有 React Query “data cannot be undefined” warning，未导致失败，也不属于本次修复新增回归。

## Findings

### Correctness

#### 🟠 AC-001 被标记完成，但实现仍同时存在“未鉴权却 available”和“OpenCode OAuth 永不 available” — `server/src/services/adapter-config.ts:178`; `server/src/services/adapter-config.ts:201`; `server/src/runtime/adapters/opencode-protocol.ts:39`; `docs/features/0.1/F005-multi-agent-manual-routing/spec.md:393`

**Severity**: High

**Problem**: AC-001 的原文要求 Claude OAuth、OpenCode OAuth/API key 均可完成配置并显示可用。当前 create（以及修改 command 的 update）仍仅运行 `<command> --version`，成功即写 `status=available`，并可能自动成为 Project default；没有登录的 Claude/OpenCode 因而可以被 selector 选择。与此同时，新加的 Windows guard 对所有 OpenCode OAuth config 无条件返回 unavailable，即便对应 workspace 已显式开启 `push_credentials_enabled`、实际 dispatch 会继承完整环境。文档在同一条 `[x] AC-001` 内又承认初始 available 不等价于登录态，形成“验收已完成”与证据相互否定的状态。

**Current Code**:

```ts
const validation = validateCommand(trimmedCommand);
const status: AdapterStatus =
  validation.available ? AS.Available : AS.Unavailable;

if (
  status === AS.Available &&
  (defaultAdapterConfigId === null || input.make_default === true)
) {
  // may become the Project default before any auth probe
}
```

```ts
if (
  process.platform === "win32" &&
  config.auth_type === AdapterAuthType.OAuth
) {
  return { available: false, errorMessage: "..." };
}
```

**Suggested Fix**:

```ts
// 保存配置时只确认 executable 可解析；未做真实 auth probe 前保持 Unknown。
const commandCheck = validateCommandShape(trimmedCommand);
const status = commandCheck.available
  ? AdapterStatus.Unknown
  : AdapterStatus.Unavailable;

// 只有 provider-specific validate() 成功后才允许设为 default/参与 routing。
```

OpenCode OAuth 需要做明确的产品选择：

1. 若 F005 仍承诺 Windows OAuth，则 availability 必须是 workspace-aware，validate/start 共享同一 credential env，并区分 `push_credentials_enabled=true/false`；或找到安全的最小 auth-dir 注入方案。
2. 若当前版本决定 Windows 只支持 API key，则同步修改 FR-002、AC-001、SC-004 和 UI provider metadata，不应继续把 OAuth 列为已验收能力。

在上述语义确定并有真实测试前，将 AC-001 保持 `[ ]` 或标记为 partial。

**Explanation**: `available` 是 resolver/selector/default 的硬门槛，不能混用“binary 存在”和“实际可鉴权运行”两种含义；安全地 fail closed 是正确方向，但它不等于原 OAuth 验收标准已经满足。

**处理结果（2026-07-24 追加）**：本条列出的两个方向中，"OpenCode OAuth 永不 available"已按方案①（workspace-aware）修复——`validate(id, workspaceId)` 现在按目标 workspace 的 `push_credentials_enabled` 判断，非隔离 workspace 下可探测为可用（用真实 Codex/Claude/OpenCode CLI 验证过）。但"未鉴权却 available"（create/update 时命令可解析就写 `Available`）**有意保留未修**：牵连"首个 available adapter 自动设为 Project default"逻辑和大量既有测试的行为假设，属于更大范围的产品/架构改动，经与用户确认后留待后续单独排期。当前状态详见 `spec.md` 第 8 节 AC-001 条目。

**二次追加（2026-07-24）**：剩余的"未鉴权却 available"半边也已实施完成——create()/update() 不再直接把可解析命令判定为 `Available`，统一先落 `Unknown`，随后异步触发真实 provider `validate()` 收敛。同时 `validate(id, workspaceId)` 的 workspace-aware 修复也已从"降级为 Unknown"升级为完整的 `(adapter, workspace)` 例外覆盖表（schema v7 `adapter_workspace_status`），workspace 自己验证成功后即可在该 workspace 内路由，不再需要退让成 Unknown。详见 `spec.md` 第 8 节 AC-001 条目最新状态。

---

#### 🟡 availability 收敛排除了 consult Run，过期凭据仍会在核心手动路由路径中持续显示可用 — `server/src/services/run-dispatch.ts:132`; `server/src/services/run-dispatch.ts:144`

**Severity**: Medium

**Problem**: 新增的 re-probe 只接受 Implementation/Validator role，明确跳过 Consult。F005 的核心场景包含在 Running/Validating 阶段手动选择不匹配 capability 后自动降级为 consult，以及显式 Ask (consult)。如果 OAuth/API key 在这类 Run 中失效，Run 会失败，但 adapter 状态永远不收敛，用户仍可反复选择它。Adapter availability 是 provider/config 属性，与某次 Run 是否驱动 workflow 无关；design §5.2 的要求也是“dispatch 或 Run 期间”失败后收敛，没有排除 consult。

**Current Code**:

```ts
if (
  run.role !== RunRole.Implementation &&
  run.role !== RunRole.Validator
) {
  return;
}
```

**Suggested Fix**:

```ts
if (
  run.role !== RunRole.Implementation &&
  run.role !== RunRole.Validator &&
  run.role !== RunRole.Consult
) {
  return;
}
```

或者直接移除 role filter，只按 provider failure reason 决定是否 re-probe。新增显式 consult 与 capability-mismatch-degraded consult 两条集成测试，断言 probe 确认 auth 失败后 adapter 变为 unavailable。

**Explanation**: workflow role 只决定 Issue 状态机影响，不应改变同一 adapter credential 是否有效的事实。

---

#### 🟡 fire-and-forget re-probe 可用旧结果覆盖用户刚更新并验证通过的新配置 — `server/src/services/run-dispatch.ts:107`; `server/src/services/run-dispatch.ts:147`; `server/src/services/run-dispatch.ts:152`; `server/src/services/run-dispatch.ts:155`

**Severity**: Medium

**Problem**: 失败终态触发的 probe 被 fire-and-forget 启动；它读取旧 record/API key 后执行异步 provider validate，返回时无条件 UPDATE。同一期间用户可以替换 API key、修改 command/model 或显式 Validate 成功。若旧 probe 较晚返回 unavailable，会把较新的有效配置重新降级，并写入旧错误消息。OpenCode validate 最长可运行 30 秒，竞态窗口并不小。进程在 probe 完成前退出时，该 best-effort Promise 也不会被 shutdown 等待，收敛可能永久丢失。

**Current Code**:

```ts
const record = this.agentConfigRepo.getById(run.adapter_config_id);
const result = await adapter.validate(publicConfig, record.api_key);

this.agentConfigRepo.update(run.adapter_config_id, {
  status: AS.Unavailable,
  auth_status_message: result.errorMessage,
  updated_at: now,
});
```

**Suggested Fix**:

```ts
const probedUpdatedAt = record.updated_at;
const result = await adapter.validate(publicConfig, record.api_key);
if (result.available) return;

// Repository CAS: only apply if config/status has not changed since probe began.
agentConfigRepo.markUnavailableIfUnchanged({
  id: record.id,
  expectedUpdatedAt: probedUpdatedAt,
  authStatusMessage: sanitizeAuthStatusMessage(result.errorMessage),
  checkedAt: new Date().toISOString(),
});
```

同时跟踪 background probe Promise，并在 server shutdown 时 await（带短 timeout）；或将 convergence 变成可恢复的持久化任务。增加 deferred fake adapter 测试：probe 开始后更新 key/command 并显式 Validate 成功，再释放旧 probe，断言新状态不被覆盖。

**Explanation**: availability 是共享可变状态；异步 probe 必须有版本/CAS 保护，不能让旧鉴权快照覆盖新配置。

---

### Security

#### 🟡 provider errorMessage 未经过 redaction 就持久化并返回 HTTP/UI — `server/src/services/run-dispatch.ts:159`; `server/src/services/adapter-config.ts:432`; `server/src/repositories/agent-config-dto.ts:32`

**Severity**: Medium

**Problem**: 显式 Validate 和新 re-probe 都把 adapter/provider 返回的 `errorMessage` 原样写入 `auth_status_message`，public DTO 随后直接返回该字段。OpenCode 的 message 来自外部 CLI JSON error；未来 CLI 版本或自定义 provider 可能在错误中包含 token、credential URL、账号标识或本地 auth 路径。F005 的 design/任务要求保存“经过清洗”的原因，现有 trace 层已经有 `redactSummary()`，但 auth status 路径未使用。Canary surface 测试只证明当前 fake/fixture 不回显 key，不能建立任意 provider error 的边界。

**Current Code**:

```ts
this.agentConfigRepo.update(run.adapter_config_id, {
  status: AS.Unavailable,
  auth_status_message: result.errorMessage,
  updated_at: now,
});
```

**Suggested Fix**:

```ts
import { redactSummary } from "../runtime/trace/redaction.js";

function sanitizeAuthStatusMessage(message: string | null): string | null {
  if (!message) return null;
  return redactSummary(message).text;
}

auth_status_message: sanitizeAuthStatusMessage(result.errorMessage),
```

在 `AdapterConfigService.validate()` 与 re-probe 共用同一个 sanitizer，并补充包含 `sk-...`、Bearer token、credential URL、用户目录的 scripted adapter 错误测试。

**Explanation**: public DTO 的安全性取决于写入前保证该字段无 secret；仅靠 provider 当前恰好不回显并不是稳定边界。

---

### Maintainability / Documentation

#### 🟢 OpenCode OAuth 的设计真相源仍保留已经被真实环境推翻的 XDG 结论 — `docs/features/0.1/F005-multi-agent-manual-routing/design.md:307`; `docs/features/0.1/F005-multi-agent-manual-routing/design.md:319`; `docs/features/0.1/F005-multi-agent-manual-routing/tasks.md:78`

**Severity**: Low

**Problem**: 实现、CLAUDE.md 和 Phase 13 说明已经确认 Windows 下设置 `XDG_DATA_HOME`/`XDG_CONFIG_HOME` 会 hang，因此删除了该注入并 fail closed；但 design §5.4 仍要求 OpenCode OAuth 暴露这两个目录，tasks T009 仍声称“三者全部可隔离”。这会让后续维护者按正式 design 恢复已经证明有害的行为。

**Current Code**:

```md
| OpenCode | XDG_DATA_HOME + XDG_CONFIG_HOME 均指向真实位置 | 已验证... |
```

**Suggested Fix**:

把旧 probe 结论标记为 superseded，记录真实版本、Windows HOME 三变量发现、XDG hang 和当前 API-key-only 安全降级；同步 spec/architecture/provider metadata 的 OAuth 支持矩阵。

**Explanation**: 历史实验记录可以保留，但正式设计表必须指向当前实现与已验证结论，避免安全回归。

---

## Positive Observations

- capability update 现在在同一 service/repository 路径同时持久化 `capability_tags` 与派生 `role`，新增测试也验证了实际 routing 查询，而非只断言旧字段。
- manual/auto validator 均在创建时写入 frozen `implementationRunId` 作为 `context_source_run_id`，关闭了审计 metadata 与实际 prompt 不一致的问题。
- manual validator 用户指令经过 4,000 字符上限后进入明确的独立段落，没有替换 validation policy/JSON contract。
- `validateCommand()` 已复用 executable resolver 并统一 `shell=false`；root `pretypecheck` 也使 clean-state 检查可复现。
- Composer 对无 default、unavailable default 和 stale explicit selection 均有前端 guard，同时保留后端 resolver 作为最终边界。
- 新增测试聚焦上一轮具体回归点，定向复检的 Server 66 项、Web 18 项和 root typecheck 均通过。

## Summary

| Severity | Count |
|----------|-------|
| 🔴 Critical | 0 |
| 🟠 High | 1 |
| 🟡 Medium | 3 |
| 🟢 Low | 1 |
| 🔵 Info | 0 |

**Bottom Line**: 大部分上一轮 finding 已正确关闭，但 AC-001 仍未满足且被过早勾选；修正 availability 初始语义、consult 收敛、异步 CAS/redaction 与设计文档后，才适合进入 `done`。
