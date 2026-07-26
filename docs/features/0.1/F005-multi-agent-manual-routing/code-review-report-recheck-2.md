---
feature_ids: [F005]
doc_kind: code-review
review_date: 2026-07-23
review_scope: full-post-fix-recheck-2
related_reviews:
  - code-review-report-implementation.md
  - code-review-report-recheck.md
---

# Code Review Report

**Reviewed**: F005 最新未提交实现、需求/设计/任务文档，以及前两轮 code-review finding 的修复结果
**Language(s)**: TypeScript, React, SQL, Markdown
**Review Date**: 2026-07-23
**Severity Legend**: 🔴 Critical | 🟠 High | 🟡 Medium | 🟢 Low | 🔵 Info

---

## Executive Summary

前两轮的大多数实现问题已经关闭：capability 持久化、validator context/source、manual validator 指令、`shell=false`、pretypecheck、composer availability guard、consult 收敛、旧 probe 竞态保护和错误消息清洗均已有代码与回归测试。完整自动化验证也全部通过。当前仍不建议进入 `done`：AC-001 明确保持未勾选，create/update 仍会把“命令存在”误当成“鉴权可用”；新增的 workspace-aware probe 又把 workspace 级结论写入 Project 级单一状态，可能让 OpenCode OAuth 在隔离 workspace 被错误放行或在非隔离 workspace 被错误禁用。

## Verification

| Check | Result |
| --- | --- |
| `npm run typecheck` | 通过；shared/server/web 均通过 |
| 修复相关 Server 定向测试 | 通过：3 files / 19 tests |
| F005 Composer 定向测试 | 通过：1 file / 12 tests |
| Server 全套 | 通过：104 files / 1294 tests；9 files / 14 个 real-CLI tests 按 env gate skipped |
| Web 全套 | 通过：20 files / 155 tests |
| `npm run build` | 通过：shared/server/web production build 成功 |
| `git diff --check` | 通过 |

`npm test` 的聚合命令因本轮工具 300 秒上限在 Server 完成后超时，随后单独执行 Web 全套并通过，因此 Server/Web 两侧均有完整最终结果。Web 测试仍输出既有 React Query “data cannot be undefined” warning；Server 的 git-scanner 仍有 Vitest 4 deprecation warning，均未导致失败。本轮未启用 `REAL_CODEX` / `REAL_CLAUDE` / `REAL_OPENCODE`。

## Findings

### Correctness

#### 🟠 AC-001 仍未关闭：create/command update 把 `--version` 成功写成 available，鉴权字段变化又保留旧状态 — `server/src/services/adapter-config.ts:45`; `server/src/services/adapter-config.ts:181`; `server/src/services/adapter-config.ts:200`; `server/src/services/adapter-config.ts:260`; `server/src/services/adapter-config.ts:320`

**Severity**: High

**Problem**: `validateCommand()` 只证明 executable 可解析且 `--version` 能退出 0，却被 create 和 command update 直接映射成 `AdapterStatus.Available`。新建的未登录 Claude/OpenCode OAuth adapter 因而可以自动成为 Project default，并被 resolver 选中。反方向上，仅更新 `auth_type`、`api_key`、`model_provider` 或 `default_model` 时不会把旧的 available 状态降为 Unknown；无效的新 key 可以继续沿用旧 key 的可用结论。`spec.md:393` 已正确承认 AC-001 未满足，因此“已经修改完成”与当前实现/验收状态仍不一致。

**Current Code**:

```ts
const validation = validateCommand(trimmedCommand);
const status: AdapterStatus =
  validation.available ? AS.Available : AS.Unavailable;

if (
  status === AS.Available &&
  (defaultAdapterConfigId === null || input.make_default === true)
) {
  this.projectRepo.setDefaultAdapter(projectId, record.id);
}
```

```ts
if (authRelatedFieldsTouched && !isExplicitKeyClearOnly) {
  validateAuthState(/* shape only */);
  // status remains the result of an older credential probe
}
```

**Suggested Fix**:

```ts
const commandCheck = validateCommand(trimmedCommand);
const status = commandCheck.available
  ? AdapterStatus.Unknown
  : AdapterStatus.Unavailable;

// Any executable/auth/model mutation invalidates the previous probe.
if (commandOrAuthFieldsTouched) {
  updates.status = commandCheckFailed
    ? AdapterStatus.Unavailable
    : AdapterStatus.Unknown;
  updates.last_checked_at = null;
  updates.auth_status_message = null;
}
```

只有 provider-specific `adapter.validate()` 成功后才写 `Available`；Unknown 不得自动成为 default，也不得参与 routing。增加 create、command update、API-key replacement、OAuth switch 四类测试，断言 `--version` 成功不会提前放行。

**Explanation**: “binary 存在”“配置字段合法”“实际鉴权可运行”是三个不同状态。只有最后一个满足 resolver 对 `available` 的语义，否则用户第一次发送指令时才发现默认 adapter 根本不能运行。

**处理结果（2026-07-24 追加）**：本条描述的 create/update 时序问题**有意保留，不是遗漏**。已就此与用户明确讨论：把默认状态改成 `Unknown` 会牵连"首个 available adapter 自动设为 Project default"逻辑和大量既有测试对"创建后立即可用"的行为假设，属于比本轮 review 驱动修复更大范围的产品/架构改动，需要单独排期决策。当前状态详见 `spec.md` 第 8 节 AC-001 条目。

**二次追加（2026-07-24）**：本条已实施完成——create()/update() 不再直接把可解析命令判定为 `Available`，统一先落 `Unknown`，随后异步触发真实 provider `validate()` 收敛（成功才置 `Available` 并按需应用 default-adapter 分配；失败或探测异常则保持 Unknown/Unavailable，绝不静默提升）。详见 `spec.md` 第 8 节 AC-001 条目最新状态。

---

#### 🟠 workspace-aware probe 的结果写入全局 adapter status，跨 workspace 路由会错误放行或错误禁用 — `server/src/services/adapter-config.ts:420`; `server/src/services/adapter-config.ts:439`; `server/src/services/adapter-config.ts:445`; `server/src/services/adapter-resolver.ts:22`; `server/src/services/run-dispatch.ts:159`

**Severity**: High

**Problem**: 新增 API 能根据某个 workspace 的 `push_credentials_enabled` 探测 OpenCode OAuth，但探测结果仍写入 Project-scoped `agent_configs.status`。resolver 只接收 `projectId`，不知道目标 Issue/workspace。于是：

1. 在 `push_credentials_enabled=true` 的 workspace 验证成功后，全局状态变成 available；同 Project 的隔离 workspace 随后也能选择这个 adapter，但 Windows OpenCode OAuth 在该环境必然失败。
2. 隔离 workspace 的失败 Run 会把全局状态降为 unavailable；原本可在非隔离 workspace 使用的同一 adapter 也被禁用。
3. Web 的 Adapter Settings Validate 按钮不传 workspace，后端新增能力从当前产品 UI 不可达。

现有测试只断言 options 被传给 adapter，没有覆盖“两个 workspace、相反 credential policy、同一个全局状态”的路由结果。

**Current Code**:

```ts
const result = await adapter.validate(publicConfig, existing.api_key, {
  pushCredentialsEnabled,
});

this.agentConfigRepo.update(id, {
  status: result.available ? AS.Available : AS.Unavailable,
});
```

```ts
export function resolveAdapter(deps, projectId, explicitAdapterId?) {
  // no issue/workspace input
  if (adapter.status !== AdapterStatus.Available) {
    return { ok: false, errorCode: ErrorCode.ADAPTER_UNAVAILABLE };
  }
}
```

**Suggested Fix**:

```ts
// Option A: availability truly varies by workspace.
resolveAdapter(deps, {
  projectId,
  workspaceId,
  explicitAdapterId,
});
// Persist probe status under (adapter_config_id, workspace_id), and make
// selector/default checks read the target workspace's status.
```

若 F005 不准备引入 per-workspace availability，采用更小且安全的 Option B：Windows OpenCode OAuth 始终不写全局 available，产品明确限定为 API key；同步 FR-002/AC-001/provider metadata。不能保留“workspace-aware probe + global status”的混合模型。

**Explanation**: 可用性只有在其持久化维度与真实决定因素一致时才可靠。当前决定因素是 workspace policy，存储维度却只有 adapter，必然产生跨 workspace 污染。

**处理结果（2026-07-24 追加）**：本条已**部分修复**——采纳了介于 Option A/B 之间的收紧方案：`AdapterConfigService.validate()`/`RunDispatchService.reprobeAdapterOnFailure()` 现在会避免把单一 workspace 的许可错误提升为全局 `Available`（改用 `Unknown` 诚实表达"仅在该 workspace 下确认可行"），修复了"跨 workspace 错误放行"这个更危险的方向；但完整的 `(adapter, workspace)` 持久化/路由模型（本条 Suggested Fix 的 Option A）**仍未实现**——反方向（该 workspace 自己应可路由、某 workspace 失败不该连累其它 workspace）留待后续单独排期。当前状态详见 `spec.md` 第 8 节 AC-001 条目。

**二次追加（2026-07-24）**：本条 Suggested Fix 的 Option A（完整 `(adapter, workspace)` 持久化/路由模型）已实施完成——新增 schema v7 `adapter_workspace_status` 表作为「例外覆盖」，`effectiveAdapterStatus()`（`adapter-availability.ts`）合并全局状态与该表的覆盖记录；`AdapterResolver`、`ValidationWorkflowService.claimValidatorSlot()`、`RunDispatchService.reprobeAdapterOnFailure()`、`AdapterConfigService.validate(id, workspaceId)` 均已切换为按合并结果判断。反方向（workspace 自己验证成功后可路由、某 workspace 失败不连累其它 workspace）现已解决。详见 `spec.md` 第 8 节 AC-001 条目最新状态。

---

### Security

#### 🟡 auth status sanitizer 不认识多数受支持 provider 的 key 格式，仍可能回显真实 API key — `server/src/runtime/trace/redaction.ts:12`; `server/src/runtime/trace/redaction.ts:74`; `server/src/runtime/provider-metadata.ts:37`; `server/src/services/adapter-config.ts:451`

**Severity**: Medium

**Problem**: 新增 sanitizer 是正确方向，但它只识别 `gh*`、通用 `sk-`、Slack 和 AWS 等固定格式。F005 允许 OpenCode 保存 Anthropic、Google、DeepSeek、OpenRouter、Groq、Mistral、xAI、Together、Perplexity 等 key；这些 key 的格式并未全部被 redaction regex 覆盖。例如 `AIza...`、`xai-...`，以及带额外连字符的某些 `sk-*` 变体，若 CLI error 原样包含 key，就会写入 `auth_status_message` 并通过 public DTO 返回。现有 canary 只测试了一个 `sk-` 样式。

**Current Code**:

```ts
const TOKEN_PATTERNS: RegExp[] = [
  /(gh[pousr]_)[A-Za-z0-9]{36,}/g,
  /(sk-)[A-Za-z0-9]{20,}/g,
  /(xox[bpoa]-)[A-Za-z0-9\-]+/g,
  /(AKIA)[A-Z0-9]{16}/g,
];

export function sanitizeAuthStatusMessage(message: string | null) {
  return message ? redactSummary(message).text : null;
}
```

**Suggested Fix**:

```ts
export function sanitizeAuthStatusMessage(
  message: string | null,
  exactSecrets: readonly string[] = [],
): string | null {
  if (!message) return null;
  const exactRedacted = exactSecrets
    .filter(Boolean)
    .reduce((text, secret) => text.replaceAll(secret, "[REDACTED]"), message);
  return redactSummary(exactRedacted).text;
}

auth_status_message: sanitizeAuthStatusMessage(
  result.errorMessage,
  existing.api_key ? [existing.api_key] : [],
);
```

保留通用 pattern 作为 defense-in-depth，但服务已持有本次 probe 使用的确切 secret，应先做 exact-value redaction。为 allowlist 中每类非 `sk-` 样式补充测试。

**Explanation**: 正则无法可靠预知所有第三方 key 格式；对已知的确切 secret 做值级替换，才能建立稳定的“不从 HTTP/UI 回显”边界。

---

### Reliability / Observability

#### 🟡 availability 收敛仍是不可等待且完全静默的 best-effort 任务 — `server/src/services/run-dispatch.ts:108`; `server/src/services/run-dispatch.ts:114`; `server/src/services/run-dispatch.ts:150`

**Severity**: Medium

**Problem**: 旧 probe 覆盖新配置的问题已通过 `updated_at` snapshot check 修复，consult 也已纳入；但 `finalizeAndDrain()` 仍用 `void promise.catch(() => {})` 启动后台任务。进程在最长 30 秒 probe 完成前退出时，design §5.2 所称“必须把 adapter 更新为 unavailable”的收敛会丢失；registry/provider/DB 异常也被完全吞掉，没有日志或测试可判断收敛是否执行。当前测试依赖固定 `wait(400)`，没有验证 shutdown 或异常路径。

**Current Code**:

```ts
void this.reprobeAdapterOnFailure(runId).catch(() => {});
```

**Suggested Fix**:

```ts
private readonly pendingAvailabilityProbes = new Set<Promise<void>>();

private trackAvailabilityProbe(probe: Promise<void>): void {
  this.pendingAvailabilityProbes.add(probe);
  void probe
    .catch((error) => this.logger.warn({ runId, error }, "adapter re-probe failed"))
    .finally(() => this.pendingAvailabilityProbes.delete(probe));
}

async shutdown(): Promise<void> {
  await Promise.race([
    Promise.allSettled([...this.pendingAvailabilityProbes]),
    timeout(5_000),
  ]);
}
```

测试使用 deferred promise/显式 completion signal，避免任意 sleep；增加 provider throw 与 shutdown drain 用例。

**Explanation**: 队列 drain 不应被 probe 阻塞，但“不阻塞当前请求”不等于“不管理后台任务”。跟踪任务可以同时保留响应速度、可观测性和关闭时的数据一致性。

---

### Maintainability / Documentation

#### 🟢 真相源仍互相矛盾：正式设计保留旧 OpenCode auth-dir 要求，tasks 又声明全部 AC 已满足 — `docs/features/0.1/F005-multi-agent-manual-routing/design.md:303`; `docs/features/0.1/F005-multi-agent-manual-routing/design.md:307`; `docs/features/0.1/F005-multi-agent-manual-routing/tasks.md:433`; `docs/features/0.1/F005-multi-agent-manual-routing/spec.md:393`

**Severity**: Low

**Problem**: design §5.4 的前置规则仍写“OpenCode OAuth 只暴露 probe 确认的 auth 目录”，而同节表格又说明 Windows 实现完全不注入 auth 目录。`tasks.md:433` 仍结论“全部 7 条验收标准满足”，但 `spec.md:393` 已正确把 AC-001 保持未勾选。T110 又要求三件套状态说明一致。后续维护者无法判断哪一句是当前真相。

**Current Code**:

```md
- OpenCode OAuth只暴露probe确认的OpenCode auth目录；
```

```md
- 结论：全部7条验收标准满足。
```

**Suggested Fix**:

把设计前置规则改成按平台/隔离模式的当前矩阵，或直接引用同节唯一矩阵；把 Phase 13 的“当时结论”明确标成 superseded，并改为“AC-002～AC-007 满足，AC-001 未满足”。同步 CLAUDE.md 中旧测试数字或明确其为 Phase 13 历史快照。

**Explanation**: 历史验收记录可以保留，但必须显式标注已被哪次复检推翻，不能与当前 acceptance checklist 同时充当真相源。

---

## Positive Observations

- 上轮的 capability update、validator frozen context source、manual validator instruction、Windows `shell=false`、pretypecheck 和前端 unavailable guard 均已正确实现并有针对性测试。
- Run failure re-probe 已不再排除 consult，并在 provider probe 确认 unavailable 后才降级，没有直接从任意 stderr 猜测 auth failure。
- `updated_at` snapshot check 覆盖了同一 Node 进程内最主要的异步旧结果覆盖场景；测试用 slow adapter 复现了真实竞态窗口。
- OpenCode Windows OAuth guard 现在能区分隔离/非隔离 dispatch 环境，说明真实环境发现已进入 runtime contract，而不只停留在文档。
- 本轮完整验证质量良好：Server 1294、Web 155、类型检查和生产构建全部通过；real-CLI 跳过情况也有明确 env gate。

## Summary

| Severity | Count |
|----------|-------|
| 🔴 Critical | 0 |
| 🟠 High | 2 |
| 🟡 Medium | 2 |
| 🟢 Low | 1 |
| 🔵 Info | 0 |

**Bottom Line**: 自动化回归稳定，但 AC-001 和 availability 的持久化维度仍是发布阻断项；先统一“何时算 available”以及“available 属于 adapter 还是 adapter+workspace”，再进入 `done`。
