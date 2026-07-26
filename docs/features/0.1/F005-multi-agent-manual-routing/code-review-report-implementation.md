---
feature_ids: [F005]
doc_kind: code-review
review_date: 2026-07-23
review_scope: implementation
---

# Code Review Report

**Reviewed**: F005 从 `1de12b3^` 到 `a6a73e4` 的需求、设计、实现与测试（154 个文件，约 12,895 行新增 / 1,205 行删除）
**Language(s)**: TypeScript, React, SQL
**Review Date**: 2026-07-23
**Severity Legend**: 🔴 Critical | 🟠 High | 🟡 Medium | 🟢 Low | 🔵 Info

---

## Executive Summary

F005 的整体分层、secret-safe DTO、validator 唯一约束、workspace FIFO、provider adapter 抽象和测试体量都较扎实；在先构建 shared package 后，全量 typecheck、server 1277 项测试、web 151 项测试与生产构建均已通过。当前实现仍不建议直接从 `review` 进入 `done`：人工检视确认 4 个高优先级需求缺口，其中 adapter capability 编辑实际上不会持久化，validator Run 没有固化规格要求的 `context_source_run_id`，OpenCode OAuth 会在与真实 dispatch 不同的环境中被标记为可用，且 adapter availability 生命周期没有按设计在鉴权失败时收敛。另有手动 validator 丢弃用户当前指令、Windows 保存配置时仍走 `shell=true`、默认 typecheck 命令不可复现等问题。

## Verification

| Check | Result |
| --- | --- |
| `npm run typecheck`（直接执行） | **失败**：web 解析到 stale `shared/dist`，`Issue.validation_dispatch_due_at` 缺失 |
| `npm run build:shared && npm run typecheck` | 通过 |
| `npm -w @personahub/server run test` | 通过：102 files / 1277 tests；9 files / 14 个 real-CLI tests 按 env gate skipped；耗时 258.32s |
| `npm -w @personahub/web run test` | 通过：20 files / 151 tests；测试 stderr 仍有若干 React Query “data cannot be undefined” warning |
| `npm run build` | 通过：shared/server/web production build 成功 |
| Real CLI tests | 本轮未启用 `REAL_CODEX` / `REAL_CLAUDE` / `REAL_OPENCODE`，采用仓库已有 Phase 13 记录作为历史证据，不把默认 skip 记为本轮实测 |

首次全量 server run 在高并发负载下出现 `adapter-routes.test.ts` 单例超过 5s 默认 timeout；该文件定向复跑 20/20 通过，第二次完整套件 1277/1277 通过，因此本报告将其记录为一次未复现的时序/负载波动，而不是稳定功能失败。

## Findings

### Correctness

#### 🟠 编辑 adapter capability 时只更新旧 role，未更新 capability_tags — `server/src/services/adapter-config.ts:229`; `server/src/services/adapter-config.ts:270`; `server/src/repositories/agent-config.ts:68`; `server/src/repositories/agent-config.ts:193`

**Severity**: High

**Problem**: Web 编辑表单会发送 `capability_tags`，但 service 的 repository update DTO 不包含该字段，service 收到后只重新计算 deprecated 的 `role`。因此响应和后续查询仍返回旧的 `capability_tags`；路由分类及自动 validator 选择均以 `capability_tags` 为唯一真相源，用户在 UI 勾选/取消 Implementation、Validator 后，实际路由能力完全不变。这直接违反 F005 的 capability 单一真相源和 Adapter Settings 编辑要求。现有 API 测试只覆盖创建时的 capability，没有覆盖 PATCH 后重新读取。

**Current Code**:

```ts
if (input.capability_tags !== undefined) {
  updates.role = deriveRole(input.capability_tags);
}

this.agentConfigRepo.update(id, updates);
```

**Suggested Fix**:

```ts
// AdapterConfigUpdateInput / repository update DTO
capability_tags?: AgentCapability[];

// service
if (input.capability_tags !== undefined) {
  updates.capability_tags = input.capability_tags;
  updates.role = deriveRole(input.capability_tags);
}

// repository
if (input.capability_tags !== undefined) {
  sets.push("capability_tags = ?");
  values.push(JSON.stringify(input.capability_tags));
}
```

同时增加 route integration test：创建 implementation-only adapter，PATCH 为 validator-only，再 GET 并实际走一次 `classifyRunRequest()` / `ValidatorSelector`，确认旧 capability 不再生效。

**Explanation**: `role` 已被设计标记为 deprecated，必须与 `capability_tags` 同事务派生写入，不能反过来让旧字段成为唯一被更新的字段。

---

#### 🟠 validator Run 未绑定 context_source_run_id，运行时还会追加“无 prior handoff”的矛盾上下文 — `server/src/services/validation/workflow-service.ts:196`; `server/src/repositories/run.ts:98`; `server/src/services/run-context-builder.ts:53`

**Severity**: High

**Problem**: `claimValidatorSlot()` 已从 frozen `validation.dispatch_pending` 取出正确的 `implementationRunId`，但创建 validator Run 时没有写入 `context_source_run_id`。Repository 因此落库为 `NULL`；随后统一 `RunContextBuilder` 对 validator 明确不重新推导 source，返回 `null` 并追加“This is the first Run… no prior handoff available”。虽然 `instructions` 中另有 `assembleValidatorContext()` 生成的验证材料，最终 prompt 会同时包含正确验证材料和错误的“无 prior work”陈述，Run DTO / Inspector 也无法证明 AC-004 要求的严格绑定。

**Current Code**:

```ts
const validatorRun = this.runRepo.create({
  issue_id: issueId,
  thread_id: issue.primary_thread_id!,
  workspace_id: issue.workspace_id,
  adapter_config_id: selected.id,
  instructions: "",
  status: RunStatus.Queued,
  role: RunRole.Validator,
  dispatch_source: dispatchSource,
  validation_round: round,
  adapter_identity: validatorIdentity,
});
```

**Suggested Fix**:

```ts
const validatorRun = this.runRepo.create({
  issue_id: issueId,
  thread_id: issue.primary_thread_id!,
  workspace_id: issue.workspace_id,
  adapter_config_id: selected.id,
  instructions: "",
  status: RunStatus.Queued,
  role: RunRole.Validator,
  dispatch_source: dispatchSource,
  validation_round: round,
  adapter_identity: validatorIdentity,
  purpose: RunPurpose.WorkflowBound,
  context_source_run_id: implementationRunId,
});
```

并在 manual/auto validator integration tests 中断言持久化后的 `run.context_source_run_id === implementationRunId`，以及实际交给 adapter 的统一 context 不再声称缺少 prior handoff。

**Explanation**: 这是设计 §6.5 和 AC-004 的显式 invariant；把已冻结的 ID 一并写入 Run，能使运行时、API、Inspector 与审计证据保持一致。

---

#### 🟠 adapter availability 不是鉴权可用性的可靠状态，也不会在运行期鉴权失败后收敛 — `server/src/services/adapter-config.ts:42`; `server/src/services/adapter-config.ts:173`; `server/src/services/run-dispatch.ts:250`; `server/src/runtime/agent-runner.ts:269`

**Severity**: High

**Problem**: 创建 adapter 时使用统一的 `command --version` 快速检查，并把成功结果直接持久化为 `available`；这与设计 §5.2“`--version` 成功不得被误判为已登录”冲突，未登录的 Claude/OpenCode 会立刻进入 selector，甚至成为 Project default。另一方面，真实 Run 遭遇 auth failure 后只会把 Run 标记为 `spawn_failed` / `adapter_exit_nonzero`，没有任何路径将该 adapter 更新为 `unavailable` 并保存清洗后的原因。这样过期 OAuth/API key 会持续显示可用，用户可反复派发必败 Run；设计 §5.2 明确要求 dispatch/Run auth failure 是 availability 的主要收敛路径。

**Current Code**:

```ts
const validation = validateCommand(trimmedCommand);
const status: AdapterStatus =
  validation.available ? AS.Available : AS.Unavailable;
```

```ts
if (result.exitCode === 0 && !result.failureReason) {
  this.deps.runService.transitionToCompleted(...);
} else if (result.failureReason === FR.SpawnFailed) {
  this.deps.runService.transitionToFailed(...);
}
```

**Suggested Fix**:

```ts
// 保存配置只确认命令形态；未做 provider auth probe 前不得声称 Available。
const status = resolvedCommand ? AdapterStatus.Unknown : AdapterStatus.Unavailable;

// adapter exit contract 增加可判别的 AuthFailed（错误文本先 redaction）。
if (result.failureReason === FailureReason.AuthFailed) {
  agentConfigRepo.update(run.adapter_config_id, {
    status: AdapterStatus.Unavailable,
    last_checked_at: new Date().toISOString(),
    auth_status_message: redactSummary(result.errorMessage ?? "Authentication failed").text,
    updated_at: new Date().toISOString(),
  });
}
```

创建后需要显式调用 provider 自己的 `validate()` 才能转为 available；若产品希望创建时自动验证，也必须 await registry adapter 的真实 auth probe，而不是复用 `--version`。补充 unauthenticated create、OAuth expiry、invalid API key dispatch 三条回归测试。

**Explanation**: `available` 被 resolver/selector 当作派发前置条件，必须表达最近一次真实鉴权结论；否则 UI 和 default routing 会建立在虚假状态上。

**处理结果（2026-07-24 追加）**：本条已**部分修复**——"运行期鉴权失败后收敛"这一半已实现（`RunDispatchService.reprobeAdapterOnFailure()`：workflow-bound/consult Run 失败后用真实 provider `validate()` 复核，确认不可用才降级，并有 CAS 防止旧 probe 覆盖新配置）。但"create/update 时只做命令形态探测就写 `Available`，不代表已鉴权"这一半**有意保留未修**：改成 `Unknown` 会牵连"首个 available adapter 自动设为 Project default"逻辑和大量既有测试的行为假设，属于比本轮 review 修复更大范围的产品/架构改动，经与用户确认后留待后续单独排期。当前状态详见 `spec.md` 第 8 节 AC-001 条目。

**二次追加（2026-07-24）**：剩余的 create/update 半边也已实施完成——不再直接把可解析命令判定为 `Available`，统一先落 `Unknown`，随后异步触发真实 provider `validate()` 收敛（成功才置 `Available` 并按需应用 default-adapter 分配；失败或探测异常则保持 Unknown/Unavailable）。同时 `reprobeAdapterOnFailure()` 也已升级为按 `(adapter, workspace)` 覆盖表写入，不再连累同 Project 其它 workspace（见下一条 Suggested Fix 的二次追加）。详见 `spec.md` 第 8 节 AC-001 条目最新状态。

---

#### 🟠 OpenCode OAuth validate 与实际隔离 dispatch 使用不同环境，会把不可运行配置标为 available — `server/src/runtime/adapters/opencode-protocol.ts:53`; `server/src/runtime/workspace-context.ts:89`; `server/src/runtime/workspace-context.ts:97`; `server/src/runtime/adapters/opencode-adapter.ts:129`

**Severity**: High

**Problem**: OpenCode OAuth 的 `validate()` 继承完整 `process.env` 和真实用户 HOME，因此可读取真实凭据并返回 available；实际 Run 在 `push_credentials_enabled=false` 时重定向 HOME/USERPROFILE，且 OpenCode 分支刻意不暴露任何 auth 目录，任务记录也确认该模式只能快速失败、无法认证。结果是同一配置在 Agents 列表和 selector 中显示可用，但默认安全配置下每次 dispatch 都必败。设计 §5.4 已给出明确降级规则：如果 CLI 无法在不恢复完整 HOME 的情况下使用 OAuth，应标 unavailable 并提示 API key，不能用非隔离 probe 代替实际可用性。

**Current Code**:

```ts
// validate
env: { ...process.env, ...authEnv },
```

```ts
case CliProvider.OpenCode:
  // no auth directory is exposed
  break;
```

**Suggested Fix**:

```ts
// validate 必须使用与真实 dispatch 等价的 credential-isolated env；
// 若当前 Windows/OpenCode 版本无法安全访问 OAuth 凭据，则明确失败。
if (
  process.platform === "win32" &&
  config.auth_type === AdapterAuthType.OAuth
) {
  return {
    available: false,
    errorMessage:
      "OpenCode OAuth cannot run with PersonaHub credential isolation on this platform; use API-key auth.",
  };
}
```

更理想的长期修复是找到并 probe 固化一个安全的 OpenCode auth-directory 注入方式，再让 validate 和 start 共享同一套 env builder。无论采用哪种方案，验证环境必须与 dispatch 安全边界一致。

**Explanation**: “能在操作员完整 HOME 下探测成功”不等于“能在 PersonaHub 的实际安全沙箱中运行”；当前实现违反 AC-001/SC-004 的可用性语义。

---

#### 🟡 手动 validator 会静默丢弃 composer 中的当前指令 — `server/src/services/manual-routing-service.ts:72`; `server/src/services/manual-routing-service.ts:87`; `server/src/services/manual-routing-service.ts:203`; `server/src/services/validation/workflow-service.ts:198`

**Severity**: Medium

**Problem**: composer 强制用户输入非空 instructions 才能发送；当 Issue 为 Validating 且 adapter 有 validator capability 时，`ManualRoutingService` 只把 adapter ID 传给 `claimValidatorSlot()`，用户输入不会进入 Run、ThreadEvent 或 validator prompt。用户看到的是“发送当前指令给所选 agent”，实际文本被静默丢弃，违反 spec 对 manual routing“处理当前指令”的描述，也使审计无法解释用户为何发起该 validator。

**Current Code**:

```ts
if (classification.role === RunRole.Validator) {
  return this.dispatchValidator(issue.id, adapter.id);
}
```

**Suggested Fix**:

```ts
if (classification.role === RunRole.Validator) {
  return this.dispatchValidator(issue.id, adapter.id, trimmedInstructions);
}
```

将用户指令作为有明确边界和长度限制的 `## User validation request` 段落加入严格 validator contract，并写入审计 payload；如果产品意图是“只选择 validator、不可自定义指令”，则应改 UI 为无需输入文本的显式 Pick validator 动作，而不是收下后丢弃。

**Explanation**: 两种产品语义都可以成立，但当前 UI/API contract 与实际执行不一致，属于可观察的正确性问题。

---

#### 🟢 无可解析 adapter/default 时发送按钮仍可用，只能依赖 API 报错 — `web/src/components/thread/ThreadView.tsx:75`; `web/src/components/thread/ThreadView.tsx:78`; `web/src/components/thread/ThreadView.tsx:186`

**Severity**: Low

**Problem**: `getDisabledMessage()` 在 adapter 数量为 0 时提示用户配置 adapter，但 `canSend` 只检查 terminal 状态和 instructions，因此按钮仍可点击；存在 adapters 但没有 available default、且用户未显式选择时也一样。请求最终会返回 `DEFAULT_ADAPTER_UNAVAILABLE`，但 UI 已知该前置条件却没有禁用提交。

**Current Code**:

```ts
const canSend = !isTerminal && instructions.trim().length > 0;
```

**Suggested Fix**:

```ts
const defaultAdapter = adapters.find(
  (adapter) => adapter.is_default && adapter.status === AdapterStatus.Available,
);
const selectedAdapter = selectedAdapterId
  ? adapters.find(
      (adapter) =>
        adapter.id === selectedAdapterId &&
        adapter.status === AdapterStatus.Available,
    )
  : defaultAdapter;

const canSend =
  !isTerminal &&
  instructions.trim().length > 0 &&
  selectedAdapter !== undefined;
```

**Explanation**: 后端 guard 必须保留；前端同步禁用能满足“无 adapter / 无 default”边界的明确反馈要求。

---

### Security

#### 🟡 保存 adapter 配置的 Windows 快速检查仍使用 shell=true — `server/src/services/adapter-config.ts:42`

**Severity**: Medium

**Problem**: F005 为统一安全边界引入 `resolveExecutable()`，并明确要求所有分支不回退 `shell=true`；但 create/update 的 `validateCommand()` 仍在 Windows 上把 API 提供的 command 交给 `cmd.exe`。这不仅与 T009a 的验收表述不一致，也让“保存配置”阶段提前执行 shell 语法和元字符，而不是只解析/探测预期 executable。即使 PersonaHub 当前是 local-first，配置保存与 Run 执行仍应保持相同的命令边界。

**Current Code**:

```ts
const result = spawnSync(command, ["--version"], {
  timeout: 10_000,
  encoding: "utf-8",
  shell: process.platform === "win32",
});
```

**Suggested Fix**:

```ts
const { resolved, errorMessage } = resolveExecutable(command);
if (!resolved) {
  return { available: false, errorMessage };
}

const result = spawnSync(
  resolved.executable,
  [...resolved.prefixArgs, "--version"],
  {
    timeout: 10_000,
    encoding: "utf-8",
    shell: false,
  },
);
```

更建议把这份重复 probe 删除，保存时只做 resolver 检查，真正 availability 一律由 registry adapter 的 provider-specific `validate()` 决定。

**Explanation**: 使用数组参数和 `shell=false` 才能维持 command/argv 的确定边界，并与三个 runtime adapter 的安全论证一致。

---

### Testing

#### 🟡 根目录 npm run typecheck 在当前仓库状态下不可直接复现通过 — `package.json:17`; `shared/package.json:7`

**Severity**: Medium

**Problem**: 本次按交付说明直接执行 `npm run typecheck` 时，Web TypeScript 解析到 stale `shared/dist`，报 `validation_dispatch_due_at` 不存在；先执行 `npm run build:shared` 后才可继续。根 `test` 已有 `pretest` 自动构建 shared，但 `typecheck` 没有对应前置步骤。`shared/dist` 未纳入 git，因此 clean checkout 更容易遇到同类问题；“typecheck 全绿”的验收命令目前依赖未记录的本地执行顺序。

**Current Code**:

```json
"typecheck": "npm -w @personahub/server run typecheck && npm -w @personahub/web run typecheck"
```

**Suggested Fix**:

```json
"pretypecheck": "npm run build:shared",
"typecheck": "npm -w @personahub/server run typecheck && npm -w @personahub/web run typecheck"
```

或者调整 shared package 的 exports/tsconfig，使 server/web typecheck 始终解析 `shared/src`，不依赖 dist 的先验状态。增加 clean-checkout CI job 按文档中的原始命令顺序执行。

**Explanation**: 验收命令必须在干净环境中自包含可复现，否则现有全绿记录不能证明交付状态本身可构建。

---

### Maintainability / Documentation

#### 🟢 完成状态与需求/任务 checklist 不一致 — `docs/features/0.1/F005-multi-agent-manual-routing/spec.md:391`; `docs/features/0.1/F005-multi-agent-manual-routing/tasks.md:79`; `docs/features/0.1/F005-multi-agent-manual-routing/tasks.md:105`

**Severity**: Low

**Problem**: `CLAUDE.md` 和 tasks Phase 13 文本称 T001-T110、AC-001~AC-007 全部完成，但 spec 中 7 条 AC 仍全部为 `[ ]`，tasks 中 T009a、T011、T012、T013 也仍为 `[ ]`。这使需求真相源无法仅凭 checklist 判断哪些已验收，并掩盖了本报告确认的 AC-001/AC-004 缺口。

**Current Code**:

```md
- [ ] **AC-001** ...
...
- [ ] **AC-007** ...
```

**Suggested Fix**:

在修复并复验本报告的阻断项后，逐条把有证据的 AC/T 标为 `[x]`，未满足项保持 `[ ]` 并链接 finding；不要仅在 Phase 13 的长段落中声明“满足”。

**Explanation**: checklist 是最便于 review/done gate 使用的验收索引，应与状态声明和证据保持一致。

---

## Positive Observations

- Public adapter DTO 采用显式字段投影而非 spread 后删除 secret，`api_key` 不进入 HTTP/ThreadEvent/Inspector；canary 测试覆盖面也较完整。
- `claimValidatorSlot()` 将手动/自动 validator 竞争收敛到同一事务，并同时保留 active 与 per-round 两条数据库唯一约束，整体竞态设计合理。
- `ManualRoutingService` 集中派生 role/purpose/dispatch source，API 不接受客户端伪造 workflow-bound metadata，分层边界清楚。
- 三个 runtime adapter 的正式 Run 启动路径统一使用 `shell=false` 和 executable resolver；Claude PreToolUse 与 OpenCode 能力降级均有一手 probe 记录。
- workspace FIFO、consult 不驱动 workflow、grace recovery、secret surface、跨 provider validator 等关键路径均有针对性测试，而不是只依赖 happy-path 组件测试。
- OpenCode Windows hang 与 Claude validator envelope 问题有清晰的真实环境根因记录，已知限制没有被完全隐藏。

## Summary

| Severity | Count |
|----------|-------|
| 🔴 Critical | 0 |
| 🟠 High | 4 |
| 🟡 Medium | 3 |
| 🟢 Low | 2 |
| 🔵 Info | 0 |

**Bottom Line**: F005 架构基础较好，但当前不符合直接进入 `done` 的条件；至少应先修复 4 个 High finding，并补齐对应 integration tests 后重新执行 clean-state typecheck/test/build 与关键真实 CLI 验收。
