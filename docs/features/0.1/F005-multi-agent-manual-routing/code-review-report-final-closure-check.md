# F005 Code Review Report — 遗留问题最终闭环确认

**Reviewed**: AC-001 初始可用性语义、schema v7 workspace-aware availability、validate/resolver/selector/dispatch/UI/迁移及相关测试  
**Language(s)**: TypeScript, SQL, React  
**Review Date**: 2026-07-25  
**Severity Legend**: 🔴 Critical | 🟠 High | 🟡 Medium | 🟢 Low | 🔵 Info

---

## Executive Summary

两个原始遗留问题的主体方案已经落地：create/update 不再仅凭命令存在直接写 `Available`；workspace override 也已接入显式/default resolver、自动/手动 validator 和失败 re-probe。全量自动化、typecheck 和生产构建均通过。

但最终闭环仍有 **4 项 High、2 项 Medium、1 项 Low**。最关键的是：影响执行的配置变化没有完整使 workspace override 失效，旧的 `Available` override 可以继续放行新 command/key/model；同时普通 validate 没有并发版本保护，旧 probe 可以在配置更新后把新配置重新提升为 `Available`。因此目前不建议将两项 finding 关闭，也不建议维持 `spec.md` 中 AC-001“已完全满足”的结论。

## Findings

### Correctness

#### 🟠 配置变化没有完整使旧可用性结论失效 — `server/src/services/adapter-config.ts:328-441`

**Severity**: High

**Problem**: 当前 update 对全局状态做了部分失效处理，但没有清除已有的 workspace override：

- command/auth/key/provider/model 变化时，全局 status 会变成 `Unknown` 或 `Unavailable`；
- `(adapter, workspace)` 旧 override 仍保留；
- `effectiveAdapterStatus()` 优先采用 override，因此旧的 workspace `Available` 会覆盖新的全局 `Unknown`，允许新配置在未经验证的情况下继续 dispatch；
- `args` 变化只写入 `updates.args`，连全局 status 都不会失效，但 args 本身可以改变 CLI 启动、模型或认证行为。

**Current Code**:

```ts
if (input.args !== undefined) {
  updates.args = input.args;
}

this.agentConfigRepo.update(id, updates);
// No adapterWorkspaceStatusRepo.deleteForAdapter(id)
```

删除 override 目前只出现在删除 adapter 的路径：

```ts
this.adapterWorkspaceStatusRepo.deleteForAdapter(id);
this.agentConfigRepo.delete(id);
```

**Suggested Fix**:

```ts
const availabilityRelevantFieldsTouched =
  input.command !== undefined ||
  input.args !== undefined ||
  input.auth_type !== undefined ||
  input.api_key !== undefined ||
  input.model_provider !== undefined ||
  input.default_model !== undefined;

this.db.transaction(() => {
  this.agentConfigRepo.update(id, updates);
  if (availabilityRelevantFieldsTouched) {
    this.adapterWorkspaceStatusRepo.deleteForAdapter(id);
  }
})();
```

若采用更稳健的 revision 方案，则给 adapter 增加 `availability_revision`，配置变化时递增；workspace 状态保存 probe 使用的 revision，读取时 revision 不一致即视为 `Unknown`。

必须新增回归测试：

1. workspace override 为 `Available`；
2. 修改 command/key/provider/model/args 任一字段；
3. `resolveAdapter()` 和 validator selector 必须立即拒绝，直到该 workspace 重新验证成功。

**Explanation**: workspace override 是旧配置的验证结果，不是 adapter ID 的永久授权。配置改变后继续消费旧 override，会重新引入问题一所要消除的“未经真实 probe 即可用”。

---

#### 🟠 普通 validate 缺少 stale-result guard，旧 probe 可覆盖新配置 — `server/src/services/adapter-config.ts:538-578`

**Severity**: High

**Problem**: `validate()` 在 probe 前读取 `existing`，await 后无条件写入结果。若 probe 进行期间用户修改 command/key/provider/model，旧 probe 仍会把基于旧配置的成功结果写为全局或 workspace `Available`。

`RunDispatchService.reprobeAdapterOnFailure()` 已经通过 `updated_at` 和 override `updated_at` 快照防止这一问题，但更常用的显式/自动 validate 路径没有同等保护。

**Current Code**:

```ts
const existing = this.agentConfigRepo.getById(id);
const result = await adapter.validate(publicConfig, existing.api_key, options);

this.agentConfigRepo.update(id, {
  status,
  last_checked_at: now,
  auth_status_message: sanitizedMessage,
  updated_at: now,
});
```

**Suggested Fix**:

优先使用单调 revision：

```ts
const snapshotRevision = existing.availability_revision;
const result = await adapter.validate(...);

const current = this.agentConfigRepo.getById(id);
if (!current || current.availability_revision !== snapshotRevision) {
  return this.getById(id); // discard stale result
}
```

workspace upsert 同样必须携带并校验该 revision。若暂时使用 `updated_at`，至少应与 re-probe 一样在落库前做快照比较，但毫秒时间戳仍不如 revision 可靠。

新增两个 deferred-probe 测试：

- global validate 开始后修改配置，旧结果不得写入；
- workspace validate 开始后修改配置，旧 override 不得写入。

**Explanation**: 新增的 create/update 后台 auto-validate 使这种竞争不再是罕见的手工操作；每次编辑都会自动发起 probe，因此快速连续编辑、手动 Validate 与后台 probe 重叠都可能触发。

---

#### 🟠 workspace-aware 状态尚未形成产品/API 闭环 — `web/src/components/adapter/AdapterSettings.tsx:158-246`; `web/src/hooks/use-adapters.ts:45-52`; `web/src/lib/api-client.ts:122-125`

**Severity**: High

**Problem**: 后端支持 scoped validate 和 scoped routing，但当前 UI：

- Validate 只提交 adapter ID，不提交 `workspace_id`；
- adapter list 只返回 Project 全局 status，不返回 workspace 状态；
- UI 不能选择 workspace，也不能展示 workspace 状态矩阵；
- workspace-scoped OpenCode OAuth 成功无法通过当前 UI 触发或持续展示；
- `ProjectRepository.setDefaultAdapter()` 仍只接受全局 `agent_configs.status='available'`，一个仅在某 workspace 验证成功的 adapter 无法被设置为 Project default。

**Current Code**:

```ts
onClick={() => validateAdapter.mutate(adapter.id)}
```

```ts
mutationFn: (adapterId: string) => apiClient.adapters.validate(adapterId)
```

```ts
validate: (adapterId: string) =>
  apiFetch(`/adapters/${adapterId}/validate`, { method: "POST" })
```

与此同时，`spec.md:393-399` 将 AC-001 标记为“已完全满足”，又在同一条目中承认 UI 不支持 workspace。两者不一致。

**Suggested Fix**:

1. UI Validate 接收当前/所选 `workspaceId`：

```ts
validate: (adapterId: string, workspaceId: string) =>
  apiFetch(`/adapters/${adapterId}/validate`, {
    method: "POST",
    body: JSON.stringify({ workspace_id: workspaceId }),
  })
```

2. 新增按 Project/workspace 返回有效状态的查询，例如：

```http
GET /api/projects/:project_id/adapters?workspace_id=:workspace_id
```

响应中的 status、last_checked_at、auth message 应为该 workspace 的有效结果。

3. Adapter Settings 选择 workspace，并明确展示“Project baseline”和“当前 workspace”状态。
4. 明确 default 产品语义：
   - 若 Project default 允许只在部分 workspace 可用，set-default 不应只检查全局 status，dispatch 时按目标 workspace 决定；
   - 若 default 必须全 Project 可用，则 UI 应明确说明 scoped-only adapter 不能成为 default。
5. 在 UI 完成前，将 AC-001 恢复为未勾选或改写验收范围，不能写“已完全满足”。

**Explanation**: 当前实现可称为“后端 scoped routing 能力已落地”，但不能称为用户可操作、可观察的完整 workspace-aware availability。

---

#### 🟠 非法/跨 Project workspace_id 会静默改写全局基线 — `server/src/services/adapter-config.ts:547-575`; `server/src/api/routes/adapters.ts:120-124`

**Severity**: High

**Problem**: 当请求显式提交一个不存在或属于其他 Project 的 `workspace_id` 时，代码将 `scopedToWorkspace` 设为 false，然后按“未提供 workspace”处理，执行保守 probe 并写入 Project 全局 status。

也就是说，一个本意为 workspace-scoped 的请求因 ID 拼写错误或跨 Project ID，不会返回 404/409，反而可能改变所有 workspace 的 fallback 状态。

**Current Code**:

```ts
const workspace = workspaceId ? this.workspaceRepo.getById(workspaceId) : null;
const scopedToWorkspace = workspace?.project_id === existing.project_id;
const pushCredentialsEnabled = scopedToWorkspace
  ? workspace!.push_credentials_enabled
  : false;

// scopedToWorkspace=false falls through to global update
this.agentConfigRepo.update(id, { status, ... });
```

**Suggested Fix**:

```ts
let workspace: Workspace | null = null;
if (workspaceId !== undefined) {
  workspace = this.workspaceRepo.getById(workspaceId);
  if (!workspace) {
    throw new AppError(ErrorCode.WORKSPACE_NOT_FOUND, "Workspace not found.");
  }
  if (workspace.project_id !== existing.project_id) {
    throw new AppError(
      ErrorCode.ADAPTER_NOT_FOUND,
      "Adapter config is not available for this workspace's project.",
    );
  }
}
```

只有真正省略 `workspace_id` 时才允许执行 global baseline probe。

新增 route/service 测试，覆盖不存在和跨 Project workspace ID，并断言全局 status 未变化。

**Explanation**: “参数省略”与“参数非法”是不同语义，不能共享 fallback。当前行为会把局部操作意外扩大为全局状态变更。

---

### Concurrency / Lifecycle

#### 🟡 服务器 shutdown 没有等待 AdapterConfigService 的后台 probe — `server/src/index.ts:211-215`

**Severity**: Medium

**Problem**: `AdapterConfigService` 新增了 tracked auto-validate 和 `shutdown()`，测试清理也会等待它，但生产服务器的 `onClose` 只等待 `agentRunner` 和 `runDispatchService`。

**Current Code**:

```ts
app.addHook("onClose", async () => {
  validationDispatchScheduler.stop();
  await agentRunner.shutdown();
  await runDispatchService.shutdown();
});
```

**Suggested Fix**:

```ts
app.addHook("onClose", async () => {
  validationDispatchScheduler.stop();
  await agentRunner.shutdown();
  await Promise.all([
    runDispatchService.shutdown(),
    adapterConfigService.shutdown(),
  ]);
});
```

**Explanation**: 进程关闭时可能遗失 create/update 后的验证结果，或让 probe 在应用生命周期结束后继续访问资源。这也与代码中“called from the same onClose hook”的注释不符。

---

#### 🟡 延迟完成的 make_default probe 可以覆盖用户较新的默认选择 — `server/src/services/adapter-config.ts:182-195`

**Severity**: Medium

**Problem**: create 使用 `make_default=true` 时，default 实际要等后台 probe 完成才写。如果等待期间用户明确将另一个 adapter 设置为 default，旧 create 请求的 probe 完成后仍会无条件覆盖较新的选择。

**Current Code**:

```ts
if (tryMakeDefault || project.default_adapter_config_id === null) {
  this.projectRepo.setDefaultAdapter(projectId, adapterId);
}
```

**Suggested Fix**:

- create 时记录 default 的快照；
- probe 完成后仅在 default 仍等于该快照时 CAS 更新；
- 或取消后台延迟应用 `make_default`，要求 validate 成功后由前端发起显式 set-default；
- 至少保证用户后发生的显式选择优先。

```ts
if (project.default_adapter_config_id === defaultAtCreate) {
  this.projectRepo.compareAndSetDefaultAdapter(
    projectId,
    defaultAtCreate,
    adapterId,
  );
}
```

**Explanation**: 后台任务不应覆盖它启动之后发生的明确用户操作。

---

### Maintainability

#### 🟢 “例外覆盖表”文档与实际写入规则不完全一致 — `server/src/db/schema-v7.ts:2-9`; `server/src/services/adapter-config.ts:556-563`

**Severity**: Low

**Problem**: schema/repository 注释称表“只存与全局基线不同的 exception”，但 scoped validate 无论结果是否与基线相同都会 upsert。功能上仍能得到正确 effective status，但文档描述、表容量预期和清理语义不一致。

**Suggested Fix**: 二选一：

- 若坚持 exception-only：结果等于 baseline 时删除该 pair 的 override；
- 若允许保存所有 scoped probe：将注释改为“workspace-specific latest result，缺失时 fallback global”。

建议增加 `delete(adapterId, workspaceId)` repository 方法，以支持真正的 exception-only 规则。

---

## Positive Observations

- create/update 已正确把“可执行文件存在”降为 `Unknown`，真实 provider probe 才能提升为 `Available`。
- `effectiveAdapterStatus()` 形成了统一读取入口，显式/default resolver 与 validator selector 均已接入。
- failed Run 的 re-probe 已按 workspace 写入，并具有 config/override 双快照竞争保护。
- workspace A 的失败不会再连带禁用 workspace B，相关集成测试覆盖有效。
- schema v7 migration、repository CRUD、显式路由、自动/手动 validator 和错误脱敏均有对应测试。
- API DTO 继续避免回显 API key，credential isolation 和 proxy URL credential 修复保持有效。

## Verification

| Check | Result |
| --- | --- |
| Relevant targeted Server tests | 12 files / 193 tests passed |
| Full Server tests | 107 files passed, 9 skipped / 1361 tests passed, 17 skipped |
| Full Web tests | 21 files / 162 tests passed |
| Server + Web typecheck | Passed |
| Production build | Passed |
| `git diff --check` | Failed: `tasks.md:34` trailing whitespace |

补充说明：首次并行执行 `npm test` 时因 240 秒工具上限中止；拆分后 Server 在 256.37 秒内完整通过，Web 在 27.09 秒内完整通过，不属于测试失败。

## Summary

| Severity | Count |
| --- | ---: |
| 🔴 Critical | 0 |
| 🟠 High | 4 |
| 🟡 Medium | 2 |
| 🟢 Low | 1 |
| 🔵 Info | 0 |

**Bottom Line**: 主体架构方向正确且全量自动化通过，但状态失效、validate 并发写保护和 workspace UI/API 闭环仍未完成；修复 4 项 High 前，不建议关闭两个遗留 finding，也不建议将 AC-001 标为“已完全满足”。

---

## 处理结果（2026-07-25 追加）

本报告列出的全部 7 项 finding（4 High + 2 Medium + 1 Low）均已逐条核实并修复：

1. **配置变化未使旧 override 失效**：`update()` 新增 `availabilityRelevantFieldsTouched` 判定（覆盖 command/args/auth_type/api_key/model_provider/default_model），命中时调用 `adapterWorkspaceStatusRepo.deleteForAdapter(id)` 清空该 adapter 的全部 workspace override；`args` 单独变化此前完全不触发任何失效，现已一并覆盖。回归测试：`server/tests/unit/adapter-config.test.ts` "invalidates workspace overrides on availability-relevant changes"。
2. **validate() 缺少并发写保护**：新增 stale-result guard，快照后与探测完成后的当前状态比对——但没有直接采用 `updated_at` 时间戳比对（会与"不相关字段编辑也会失效"的场景发生假阳性，已在实测中复现并改正，见下），而是精确快照 command/args/auth_type/model_provider/default_model/api_key 这组"探测结果实际依赖"的字段（`availabilityRelevantSnapshot()`），workspace-scoped 分支另外快照 override 行自身的 `updated_at`。回归测试：`adapter-config-validate-registry.test.ts` "stale-result race guard" 分组（4 个用例，含"不应误判"的反例）。
3. **workspace-aware 状态无 UI/API 闭环**：已补齐——`AdapterConfigService.list(projectId, workspaceId?)` 新增可选 workspace 范围查询，`GET /api/projects/:project_id/adapters?workspace_id=` 路由级支持；返回的 `AdapterConfig` DTO 新增 `effective_status`/`effective_last_checked_at`/`effective_auth_status_message`/`has_workspace_override` 投影字段（`status` 本身保持 Project 全局基线语义不变，向后兼容）。前端：`AdapterSettings` 通过既有 `useWorkspace(projectId)`（PersonaHub 当前是单 Project 单 workspace 模型，无需新增多 workspace 选择器）取得当前 workspace，list/Validate 调用均已改为携带该 workspace id；状态徽标展示 workspace-effective 值，`has_workspace_override` 时额外展示"workspace override"标记与 tooltip 对比 Project 基线。`spec.md` AC-001 措辞同步更新，不再是"未完全满足"或与自身矛盾的表述。**产品语义仍保持原样、未处理的一点**：`setDefault`/`ProjectRepository.setDefaultAdapter()` 仍只认 Project 全局 `status`——一个仅在某 workspace 通过 override 可用的 adapter 依旧不能被设为 Project default（UI 上"Set as default"按钮也据此保持只看全局 status），这是本报告 Suggested Fix 里明确列出的两种可能语义之一（"default 必须全 Project 可用"），有意保留，非遗漏。
4. **非法/跨 Project workspace_id 静默降级为全局写**：`validate()` 与新增的 `list()` workspace 分支均改为遇到不存在或跨 Project 的 `workspace_id` 直接抛 `WORKSPACE_NOT_FOUND`，不再静默退化为保守全局探测/写入。回归测试覆盖 nonexistent 和 cross-project 两种输入。
5. **server shutdown 未等待 AdapterConfigService 后台 probe**：`index.ts` 的 `onClose` hook 已加入 `adapterConfigService.shutdown()`（与 `runDispatchService.shutdown()` 一并 `Promise.all`）。
6. **延迟 make_default probe 可覆盖更新的显式选择**：`autoValidateAfterCreate()` 新增 `defaultAtCreate` 快照（create() 时 Project 当前默认值），探测完成后仅当 Project 默认值仍等于该快照才应用——不再对 `tryMakeDefault=true` 无条件覆盖。回归测试：`project-default-adapter.test.ts` "Deferred make_default probe does not clobber a newer explicit choice"。
7. **"例外覆盖表"文档与实际写入规则不一致**：scoped `validate()` 现在会比较新探测结果与（重新读取的）当前全局基线——相等则调用新增的 `AdapterWorkspaceStatusRepository.delete()` 清除该行而非 upsert 冗余 override，保持"表只存例外"的既定语义与文档描述一致。

**实测中额外发现并修正一处**：为 finding #2 编写"快照 `updated_at` 变化即判定 stale"的初版实现后，在全量回归中触发了一个真实假阳性——`capability_tags`-only 的 `update()` 会与仍在后台运行的 `create()` 自动探测竞争，被误判为"配置已变"而丢弃合法的收敛结果（`adapter-config-role.test.ts` 一个既有测试因此失败）。根因是 `updated_at` 对任何字段编辑（含探测逻辑完全不关心的 `name`/`capability_tags`）都会变化，用它做脏检查过于粗粒度。改为精确快照探测实际依赖的字段后问题消失，且新增了显式的"不相关字段编辑不应触发丢弃"反例测试防止回归。

**验证**：server 全量测试 1371 通过（另 17 个 real-CLI/POSIX-only 按 env/平台 gate 跳过）、web 全量测试 164 通过、typecheck、生产构建均通过；真实已登录 Codex/Claude/OpenCode CLI 追加验收（含 OpenCode 在真实 workspace-scoped `validate()` 路径下的 Available 收敛与 override 表落盘）。AC-001 现已完全满足，两个遗留 finding 均可关闭。
