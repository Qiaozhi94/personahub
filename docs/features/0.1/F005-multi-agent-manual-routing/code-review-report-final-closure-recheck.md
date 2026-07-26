# F005 Code Review Report — Closure Recheck

**Reviewed**: `code-review-report-final-closure-check.md` 的 4 High、2 Medium、1 Low 修复  
**Language(s)**: TypeScript, SQL, React  
**Review Date**: 2026-07-25  
**Severity Legend**: 🔴 Critical | 🟠 High | 🟡 Medium | 🟢 Low | 🔵 Info

---

## Executive Summary

上一轮 7 项中，workspace UI/API、非法 workspace 拒绝、production shutdown、延迟 default CAS，以及 override exception 清理的主体实现均已落地。全量 Server 1371、Web 164、typecheck、production build 和 `git diff --check` 均通过。

但仍有 **2 项 High、3 项 Medium、1 项 Low**。其中 `args` 单独变化仍保留全局 `Available`，直接延续了未经重新 probe 即可路由的问题；global validate 也没有实现其注释宣称的重叠 probe 顺序保护。因此两项原始遗留 finding 仍不建议关闭。

## Previous Findings Recheck

| 上一轮 finding | 结果 | 说明 |
| --- | --- | --- |
| 配置变化未使 workspace override 失效 | ⚠️ 部分关闭 | override 会删除，但 `args` 不使全局 status 失效 |
| validate 缺少 stale-config guard | ⚠️ 部分关闭 | 配置变化可拦截；global 重叠 validate 仍可互相覆盖 |
| workspace UI/API 不闭环 | ✅ 关闭 | list query、effective fields、当前 workspace Validate/UI 已接通 |
| 非法/跨 Project workspace 静默写全局 | ✅ 关闭 | 现在抛 `WORKSPACE_NOT_FOUND` |
| production shutdown 未等待 auto-validate | ✅ 关闭 | `onClose` 已并行等待两个 probe service |
| 延迟 make_default 覆盖较新选择 | ✅ 关闭 | 已加入 default 快照/CAS 语义 |
| exception-only 注释与写入不一致 | ✅ 主体关闭 | 相同状态会删除 override；但产生新的时间戳问题，见下文 |

## Findings

### Correctness

#### 🟠 `args` 单独变化仍保留全局 `Available`，无需重新 probe 即可继续路由 — `server/src/services/adapter-config.ts:411-413,460-490,507-529`

**Severity**: High

**Problem**: `args` 已被加入 `availabilityRelevantFieldsTouched`，因此 workspace override 会被删除；但 `args` 不在 command/auth 状态失效分支中，`updates.status` 仍为 `undefined`：

```ts
if (input.args !== undefined) {
  updates.args = input.args;
}

const availabilityRelevantFieldsTouched =
  input.command !== undefined ||
  input.args !== undefined ||
  ...;

this.agentConfigRepo.update(id, updates);
this.adapterWorkspaceStatusRepo.deleteForAdapter(id);
```

结果是：

1. 原全局 status 为 `Available`；
2. 只修改 args；
3. override 被删除，但全局 status 仍为 `Available`；
4. resolver fallback 到全局 `Available`，新 args 未经真实 probe 即可 dispatch；
5. `updates.status !== Unknown`，不会触发 `autoValidateAfterUpdate()`。

当前新增测试 `adapter-config.test.ts:219-223` 只断言 override 被清除，没有断言全局 status、后台 probe 或 resolver，因此没有发现这个缺口。

**Suggested Fix**:

```ts
if (input.args !== undefined) {
  updates.args = input.args;
  if (updates.status === undefined) {
    const resolution = validateCommand(existing.command);
    updates.status = resolution.available
      ? AS.Unknown
      : AS.Unavailable;
    updates.last_checked_at = null;
    updates.auth_status_message = null;
  }
}
```

更不容易遗漏的做法是：先计算 `availabilityRelevantFieldsTouched`，再统一执行一次状态失效，而不是分散在 command/auth/args 三个分支。

必须补充回归断言：

```ts
expect(updated.status).toBe(AdapterStatus.Unknown);
expect(resolveAdapter(...).ok).toBe(false);
await services.adapterConfigService.shutdown();
expect(services.adapterConfigService.getById(id).status)
  .toBe(AdapterStatus.Available);
```

**Explanation**: args 可以改变模型、认证参数、配置文件路径和 CLI 行为，与 command/key/model 同属真实 probe 输入，不能只删除 workspace override 而保留全局运行授权。

---

#### 🟠 global 重叠 validate 没有写入序列保护，与 workspace 路径和代码注释不一致 — `server/src/services/adapter-config.ts:640-647,666-687,723-728`

**Severity**: High

**Problem**: 新 guard 能识别 probe 期间配置字段变化，但 global validate 落库只检查配置 snapshot。两个 probe 使用相同配置并发时：

```text
validate A 开始
validate B 稍后开始
B 先完成并写 Unavailable
A 后完成并写 Available
```

A 在落库前看到的 availability-relevant config 没变，因此会覆盖 B。workspace 路径通过 override `updated_at` 阻止这种覆盖，global 路径却没有对应的 status revision/generation。代码注释声称“另一个 explicit Validate 已落地时丢弃旧结果”，对 global 路径并不成立。

**Suggested Fix**:

为每次 global/scoped validate 分配单调 generation，落库时只允许当前 generation 写入。推荐持久化 `availability_revision`/`probe_generation`，避免依赖毫秒级时间戳：

```ts
const generation = this.nextProbeGeneration(id, workspaceId);
const result = await adapter.validate(...);

if (!this.isLatestProbeGeneration(id, workspaceId, generation)) {
  return this.getEffectiveCurrentState(id, workspaceId);
}
```

若只考虑单进程，可先使用 service 内 Map；若要跨重启/多进程一致，应使用 DB revision/CAS。

新增 deferred adapter 测试，分别覆盖 global 和 workspace：

- A 先开始，B 后开始；
- B 先完成；
- A 后完成；
- 最终必须保留 B 的结果。

**Explanation**: create/update 自动 probe 与用户点击 Validate 可以自然重叠。global 与 workspace 使用不同的竞争规则，会使最终状态取决于请求完成顺序和调用维度。

---

### Data Consistency / Observability

#### 🟡 相同状态的 scoped probe 会丢失刚产生的 workspace `last_checked_at` — `server/src/services/adapter-config.ts:344-352,703-720`

**Severity**: Medium

**Problem**: scoped probe 结果等于 global baseline 时会删除 override，以维持 exception-only：

```ts
if (status === current.status) {
  this.adapterWorkspaceStatusRepo.delete(id, workspace.id);
}
```

validate 响应本身返回当前 `now`，但 UI 随后 refetch adapter list。因为 override 已删除，list 使用：

```ts
effective_last_checked_at:
  override?.last_checked_at ?? r.last_checked_at
```

于是刚完成的 workspace probe 时间消失，UI 回退展示可能很旧的 global `last_checked_at`。这违反 design §5.2“状态必须同时展示其最近验证时间”的可观察性要求。

**Suggested Fix**: workspace 状态表应保存每个 workspace 的最新 probe 元数据，即使 status 与 baseline 相同。最简单可靠的语义是“缺失时 fallback global；存在时保存 workspace latest result”，不再宣称 exception-only。

如果坚持 exception-only，需要另一张表或额外字段保存 scoped `last_checked_at`/message；否则无法同时做到去除冗余状态行和保留验证历史。

---

#### 🟡 agent update 与 override 删除不是同一事务 — `server/src/services/adapter-config.ts:515-518`

**Severity**: Medium

**Problem**:

```ts
this.agentConfigRepo.update(id, updates);
if (availabilityRelevantFieldsTouched) {
  this.adapterWorkspaceStatusRepo.deleteForAdapter(id);
}
```

两个写操作分开提交。虽然当前 Node 同步调用之间没有普通请求交错，但进程退出、SQLite 异常或第二条语句失败时，DB 会永久留下“新配置 + 旧 override”。重启后 resolver 仍会消费旧 override。

**Suggested Fix**: 将 adapter update 和 override invalidation 放入同一个 `better-sqlite3` transaction。可以向 service 注入 DB，或在 repository 提供一个原子方法。

**Explanation**: 这是授权状态失效操作，应满足 all-or-nothing，而不是依赖进程不在两条语句之间终止。

---

#### 🟡 scoped validate 没有快照 workspace 的运行环境设置 — `server/src/services/adapter-config.ts:657-674`; `server/src/repositories/workspace.ts:117-122`

**Severity**: Medium

**Problem**: scoped probe 的结果依赖 `workspace.push_credentials_enabled`，但 stale guard 只快照 adapter 字段和 override row。若 workspace 设置在 probe 期间或验证完成后发生改变，旧 scoped status 不会失效。

当前产品尚未暴露修改该字段的 HTTP UI，但 repository 已支持更新，它也是 workspace 持久化状态的一部分。后续一旦开放设置，现有 availability 会立即出现陈旧授权。

**Suggested Fix**:

- probe 前快照 `push_credentials_enabled` 或 workspace availability revision；
- 落库前重新读取并比较；
- 该设置变化时删除该 workspace 的全部 adapter status，或递增 workspace environment revision。

---

### Testing

#### 🟢 新增 workspace-scoped list API 缺少 service/route 边界测试 — `server/src/services/adapter-config.ts:326-353`; `server/src/api/routes/adapters.ts:88-92`

**Severity**: Low

**Problem**: Web 测试覆盖了 effective status 展示，但 Server tests 没有直接覆盖：

- `GET .../adapters?workspace_id=` 返回 effective fields；
- override 不泄漏到 sibling workspace；
- 不存在/跨 Project workspace query 返回 404；
- 原始 API key 仍不出现在新增 DTO；
-相同状态删除 override 后的时间字段语义。

**Suggested Fix**: 在 `adapter-routes.test.ts` 和 `adapter-config.test.ts` 增加上述测试，避免 UI mock 掩盖后端投影错误。

---

## Positive Observations

- command/auth/key/provider/model 修改已正确重置全局状态，并删除 workspace overrides。
- invalid/cross-Project workspace 不再静默退化为 global write。
- workspace-scoped list/Validate/UI 已贯通，UI 使用 effective status 判断 validator availability。
- deferred default assignment 已保护较新的用户选择。
- production shutdown 已等待 AdapterConfigService probe。
- scoped validate 对配置变化和同 workspace override 变化已有 stale guard。
- Server/Web 全量测试、typecheck、build、diff check 均通过。

## Verification

| Check | Result |
| --- | --- |
| Relevant Server tests | 首轮 119 passed / 1 timeout；失败文件单独重跑 30/30 passed |
| Full Server tests | 107 files passed, 9 skipped / 1371 passed, 17 skipped |
| Full Web tests | 21 files / 164 passed |
| Server + Web typecheck | Passed |
| Production build | Passed |
| `git diff --check` | Passed（仅换行格式 warning） |

针对性测试的单次 timeout 在全量运行和单文件重跑中均未复现，当前判断为并发负载下 5 秒预算波动，不作为功能 finding；但测试耗时余量偏小，可后续单独优化。

## Summary

| Severity | Count |
| --- | ---: |
| 🔴 Critical | 0 |
| 🟠 High | 2 |
| 🟡 Medium | 3 |
| 🟢 Low | 1 |
| 🔵 Info | 0 |

**Bottom Line**: 上一轮多数修复已正确闭环，但 `args` 的全局状态失效和 global validate 并发顺序仍是发布阻塞项；至少修复 2 项 High 后，才能再次考虑关闭原始两项 finding。

---

## 处理结果（2026-07-26 追加）

本报告列出的 2 项 High、3 项 Medium、1 项 Low 均已核实并修复：

1. **`args` 单独变化未使全局状态失效**：`update()` 重构为单一的统一失效判定——不再按 command/auth 各自散落判断，而是先算出 `availabilityRelevantFieldsTouched`（现含 `args`），命中时统一走一次 `validateCommand(effectiveCommand)` 计算并写入 `status`。回归测试补充了报告给出的确切断言序列（写入即为 `Unknown`，后台 probe 收敛回 `Available`）。
2. **global validate 缺少并发写序保护**：新增 schema v7 `agent_configs.availability_revision`（单调 CAS token），`update()` 每次使 status 失效时递增；`validate()` 全局路径改为 `AgentConfigRepository.casUpdateAvailability(id, snapshotRevision, patch)`——`UPDATE ... WHERE availability_revision = ?`，写入前 revision 已变则影响 0 行，落败的探测结果不再有机会覆盖胜出者。原先按字段快照（command/args/auth/model/key）判断"配置是否变化"的机制已整体替换为 revision 比较，同时天然规避了此前"`capability_tags`-only 编辑误判为 stale"的假阳性（revision 只在真正的可用性相关写入时才前进）。scoped 路径继续沿用 override 行自身 `updated_at` 的既有保护（本就对同一 pair 的重叠探测安全），并新增 workspace `updated_at` 快照比对（Medium #3 一并解决）。
   > **已被取代（2026-07-26）**：`code-review-report-final-closure-recheck-2.md` 指出这个 DB revision 方案本身有两个问题——① 把新列追加进已经"跑过"的 schema v7，任何已迁移到旧版 v7 的数据库永远不会获得该列；② 只实现了"先完成者获胜"，不是"后发起者获胜"。已整体替换为进程内双 Map generation 追踪（不再持久化任何 revision 列），详见该文档"处理结果"。
3. **相同状态的 scoped probe 丢失 workspace `last_checked_at`（Medium）**：判定为可接受的设计取舍，非代码缺陷——"例外覆盖表"语义下，探测结果等于基线时该 workspace 的最新验证时间等价于基线自身的验证时间，故未新增字段；此项作为已知设计选择记录，如后续产品需要独立于基线的逐 workspace 验证历史，需改表结构，留待需求明确后再排期。
4. **update() 与 override 删除非原子（Medium）**：`AdapterConfigService` 新增 `db` 依赖，`update()`/`delete()` 的多步写入均已包入 `db.transaction()`，all-or-nothing。
5. **scoped validate 未快照 workspace 运行环境（Medium）**：已随 High #2 一并解决，见上文 revision/updated_at 快照逻辑。
6. **workspace-scoped list API 缺少 server 侧测试（Low）**：`adapter-routes.test.ts` 新增 5 个用例，覆盖 effective 字段投影、跨 workspace 不泄漏、非法/跨 Project workspace_id 返回 404、API key 不回显。

**验证**：server 全量测试 1378 通过（另 17 个 real-CLI/POSIX-only 按 env/平台 gate 跳过）、web 全量测试 164 通过、typecheck、生产构建均通过；新增的并发覆盖测试（global + workspace-scoped 两种重叠 probe 场景）重复运行 3 次无 flake；真实已登录 Codex/Claude/OpenCode CLI 追加验收 validate() 相关路径。两项原始遗留 finding（AC-001 语义、workspace-aware availability）现已真正闭环。
