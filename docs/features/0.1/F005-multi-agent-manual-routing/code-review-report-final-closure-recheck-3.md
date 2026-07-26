# F005 Code Review Report — Final Closure Recheck 3

**Reviewed**: `code-review-report-final-closure-recheck-2.md` 的 2 High、1 Medium、1 Low 修复，以及 availability probe 的跨服务并发边界  
**Language(s)**: TypeScript, SQL, React  
**Review Date**: 2026-07-26  
**Severity Legend**: 🔴 Critical | 🟠 High | 🟡 Medium | 🟢 Low | 🔵 Info

---

## Executive Summary

上一轮四项均已按建议落地：schema v7 已恢复为无 revision 列的原始版本；`AdapterConfigService.validate()` 已在调用开始时领取 global/scoped generation，并用双向完成顺序测试验证“后发起者获胜”；workspace guard 已收窄为 `push_credentials_enabled`；design 的 UI 说明也已同步。全量 Server 1382、Web 164、typecheck 和 production build 均通过。

但 availability 写入还有一条未纳入 generation 协调的生产路径：`RunDispatchService.reprobeAdapterOnFailure()` 仍直接探测并写 workspace override。较早启动的 Run failure re-probe 如果先完成，会让稍后发起的用户 Validate 把自己判定为 stale，继续保留旧后台结果。因此本轮仍有 **1 项 High、1 项 Low**，尚不建议关闭 F005。

## Previous Findings Recheck

| 上一轮 finding | 结果 | 说明 |
| --- | --- | --- |
| revision 列修改已执行过的 schema v7 | ✅ 关闭 | revision 列及 repository CAS 已撤销，v7 恢复为原始 workspace override 表，无需 v8 数据迁移 |
| Validate 只实现“先完成者获胜” | ✅ `AdapterConfigService` 内关闭 | global/scoped 均在调用开始领取 generation，A/B 两种完成顺序最终都保留后调用的 B |
| workspace guard 误用整个 `updated_at` | ✅ 关闭 | 仅比较真实 probe 输入 `push_credentials_enabled`，并测试 lock/release 不误伤、credential flip 必须失效 |
| design 仍声称 UI 未闭环 | ✅ 关闭 | 已说明当前单 workspace UI 的 list/Validate/effective status 贯穿方式 |

## Findings

### Correctness / Concurrency

#### 🟠 Run failure re-probe 未加入 generation 协调，仍可压掉较新的显式 Validate — `server/src/services/run-dispatch.ts:204-243`; `server/src/services/adapter-config.ts:674-785`

**Severity**: High

**Problem**: 新增的 `probeGenerations` 是 `AdapterConfigService` 私有状态，只在 `AdapterConfigService.validate()` 开始时领取 generation：

```ts
const myProbeGeneration =
  this.claimProbeGeneration(probeScopeKey);
```

但失败 Run 会在另一个 service 中独立调用同一个 provider probe，并直接写同一张 workspace override 表：

```ts
const result = await adapter.validate(...);

const currentOverride =
  this.adapterWorkspaceStatusRepo.get(...);
if (currentOverride?.updated_at !== snapshotOverrideUpdatedAt) {
  return;
}

this.adapterWorkspaceStatusRepo.upsert({
  status: AS.Unavailable,
  // ...
});
```

以下生产时序仍会丢失用户较新的操作：

```text
A：Run failure re-probe 开始，快照 override = old
B：用户随后点击 workspace Validate，领取 generation = 1
A：先完成并写 Unavailable，override.updated_at 改变
B：后完成，本应作为后发起请求获胜
B：发现 overrideChanged，丢弃自己的 Available 结果
最终仍为 A 的 Unavailable
```

当前两个 guard 不能解决这个方向：

- A 不读取 `AdapterConfigService.probeGenerations`，不知道 B 是较新调用；
- B 的 override `updated_at` guard 只能表达“有人先写过”，无法区分该写入对应更早还是更晚发起的 probe。

现有 `adapter-availability-convergence.test.ts:268-314` 只覆盖“A 较早启动、B 先写、A 后完成”的方向，而且 B 是直接更新 global config row，不是一次真实 scoped Validate。新增 A/B 双向测试则只覆盖两个 `AdapterConfigService.validate()`，没有跨到 `RunDispatchService`。

**Suggested Fix**:

把 generation 从 `AdapterConfigService` 私有 Map 提取为两个 service 共用的单例协调器，例如：

```ts
class AdapterAvailabilityProbeCoordinator {
  claim(scope: AdapterProbeScope): number;
  isCurrent(scope: AdapterProbeScope, generation: number): boolean;
  invalidateAdapter(adapterId: string): void;
  forgetAdapter(adapterId: string): void;
}
```

`AdapterConfigService.validate()` 和 `RunDispatchService.reprobeAdapterOnFailure()` 都必须在真实 probe **开始之前**为相同 `(adapterId, workspaceId)` scope 调用 `claim()`，写入前调用 `isCurrent()`。配置更新继续调用 `invalidateAdapter()`。

如果不想让 Run failure re-probe 取代用户显式 Validate，可为 probe source 定义优先级；最简单的一致规则仍是所有来源共用“最后发起者获胜”。

必须补充真实交叉测试：

1. A = failure re-probe，B = scoped Validate；B 先完成，最终为 B；
2. A = failure re-probe，B = scoped Validate；A 先完成、B 后完成，最终仍为 B；
3. 可选反向：显式 Validate 先开始，随后发生新的 Run failure re-probe，明确产品期望谁获胜。

**Explanation**: generation 只有覆盖所有写同一状态的 probe 来源，才能形成完整的顺序保证。当前实现修复了同 service 内部竞态，但跨 service 仍沿用旧的 first-writer 规则。

---

### Performance / Lifecycle

#### 🟢 删除 adapter 后未清理两个 generation Map 的条目 — `server/src/services/adapter-config.ts:177-192,604-636`

**Severity**: Low

**Problem**: 每个被验证过的 adapter 会在 `configGenerations` 或 `probeGenerations` 留下 global key；每个被验证过的 workspace scope 还会留下一个 scoped key。`delete()` 删除数据库记录和 overrides 后没有清理这些 Map。

对当前个人单机使用规模影响很小，但 server 是长生命周期进程，反复创建/验证/删除 adapter 或 workspace 后，已失效 ID 的条目只增不减。

**Suggested Fix**:

在统一 coordinator 中提供：

```ts
forgetAdapter(adapterId: string): void
```

删除 global generation，并删除该 adapter 的所有 scoped generation。若继续保留平铺字符串 key，可匹配精确 global key 与 `${adapterId}:` 前缀；更清晰的结构是 adapter id 到 scope Map 的嵌套 Map。

清理应在 adapter 数据库事务成功后执行，避免事务失败却提前丢失仍在使用的协调状态。

**Explanation**: 这不影响当前正确性，但把 generation 抽成共享 coordinator 时顺手补齐生命周期，可以避免后续把一个已知的无界结构固化下来。

## Positive Observations

- schema v7 已恢复为不可变的原始 migration 内容，彻底消除了已有 v7 数据库缺列风险。
- global/scoped generation 都在调用开始时领取，并正确隔离不同 workspace scope。
- 新测试覆盖了 A/B 两种完成顺序，以及 scoped winner 等于 global baseline、走 delete 而非 upsert 的分支。
- workspace 快照只比较真实 probe 输入，不再因 workspace lock 或 branch 更新丢弃有效结果。
- availability-relevant update 会统一 bump config generation，使旧配置上的 global/scoped probe 一起失效。
- UI 设计文档已与当前单 workspace 产品模型和实现保持一致。
- 全量测试、typecheck 和 production build 均通过。

## Verification

| Check | Result |
| --- | --- |
| Targeted Server tests | 5 files / 115 passed |
| Full Server tests | 107 files passed, 9 skipped / 1382 passed, 17 skipped |
| Full Web tests | 21 files / 164 passed |
| Server + Web typecheck | Passed |
| Production build | Passed |
| `git diff --check` | Passed for this report |

Server 全量测试仍输出一个既有 Vitest 4 timeout 参数弃用提示；Web tests 仍输出既有 React Query mock 返回 undefined 的 warning。本轮未发现它们对应新的 F005 功能失败。

## Summary

| Severity | Count |
| --- | ---: |
| 🔴 Critical | 0 |
| 🟠 High | 1 |
| 🟡 Medium | 0 |
| 🟢 Low | 1 |
| 🔵 Info | 0 |

**Bottom Line**: 上一轮四项已正确修复，但 probe generation 必须覆盖 Run failure re-probe 这条第二写入路径，才能真正完成 availability 并发闭环。

---

## 处理结果（2026-07-26 追加）

本报告的 1 项 High + 1 项 Low 均已核实并修复：

**Run failure re-probe 未加入 generation 协调（High）**：确认 `adapter_workspace_status` 表恰好只有两个真实写入方——`AdapterConfigService.validate()` 与 `RunDispatchService.reprobeAdapterOnFailure()`——且此前的 `probeGenerations`/`configGenerations` 是 `AdapterConfigService` 的私有状态，后者完全不知情，只沿用自己的 override `updated_at` 快照，天然无法表达"我方是否比另一服务的调用更晚发起"。已按建议把这两个 Map 抽成独立模块 `AdapterAvailabilityProbeCoordinator`（`server/src/services/adapter-probe-coordinator.ts`），在 `index.ts`/`tests/helpers.ts` 中实例化**单例**，同时注入 `AdapterConfigService` 与 `RunDispatchService` 构造函数。`reprobeAdapterOnFailure()` 现在与 `validate()` 用同一套 `claimProbe()`/`isCurrentProbe()`/`getConfigGeneration()` 接口：探测开始前在共享 coordinator 上为 `(adapterId, workspaceId)` scope 领取 generation，写入前检查该 generation 是否仍是最新——不论调用发起方是哪个 service。新增跨服务集成测试覆盖检视报告要求的两个方向（`adapter-availability-convergence.test.ts` 新增 describe 分组）：

1. A = Run failure re-probe（先发起），B = 用户显式 workspace Validate（后发起）；B 先完成——B 胜出。
2. 同样的 A/B，但 A 先完成、B 后完成——B 仍需胜出（这是暴露旧 bug 的关键方向：旧实现下 A 会无条件覆盖，因为 A 完全不知道 B 的存在）。

两个用例都通过让 A、B 报告不同的 `errorMessage`（而非 Available/Unavailable）来验证胜负，因为 `reprobeAdapterOnFailure()` 按设计只会写 `Unavailable`（探测到 available 时直接提前返回，"never upgrades here"），Available/Unavailable 的二元区分不足以在两者报告方向相同时分辨谁真正生效。

**delete() 未清理 generation Map 条目（Low）**：`AdapterAvailabilityProbeCoordinator.forgetAdapter()` 已实现（清空该 adapter 的全局 key 与全部 `${adapterId}:` 前缀的 scoped key），在 `AdapterConfigService.delete()` 的数据库事务提交后调用。

**验证**：server 全量测试 1383 通过（另 17 个 real-CLI/POSIX-only 按 env/平台 gate 跳过；`run-routes.test.ts` 一例在全量并行负载下曾 5000ms 超时，单独重跑稳定通过，判定为既有的并发负载抖动，非本轮改动引入）、web 全量测试 164 通过、typecheck、生产构建均通过；新增跨服务测试重复运行 2 次无 flake；真实已登录 Codex/Claude/OpenCode CLI 追加验收（含 workspace-scoped 路径）。
