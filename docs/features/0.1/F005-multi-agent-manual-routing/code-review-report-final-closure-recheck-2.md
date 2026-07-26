# F005 Code Review Report — Final Closure Recheck 2

**Reviewed**: `code-review-report-final-closure-recheck.md` 的 2 High、3 Medium、1 Low 处理结果，以及本轮相关迁移、并发保护与测试  
**Language(s)**: TypeScript, SQL, React  
**Review Date**: 2026-07-26  
**Severity Legend**: 🔴 Critical | 🟠 High | 🟡 Medium | 🟢 Low | 🔵 Info

---

## Executive Summary

上一轮的 `args` 统一失效、update/delete 事务、workspace-scoped list API 测试均已正确落地；“相同状态的 scoped probe 不单独保存 workspace 时间”也可以作为明确记录的产品取舍接受。全量 Server 1378、Web 164、typecheck 和 production build 均通过。

但本轮仍发现 **2 项 High、1 项 Medium、1 项 Low**。最直接的发布阻塞项是把新 `availability_revision` 列追加进已经存在的 schema v7：旧 v7 数据库不会再执行该迁移，运行时将缺列。另一个 High 是当前 CAS 实际实现“最先完成的 probe 获胜”，仍未实现上一轮建议的“后发起的 probe 获胜”，并且 scoped baseline-result 路径连“先完成者获胜”也不能稳定保证。因此 F005 仍不建议关闭。

## Previous Findings Recheck

| 上一轮 finding | 结果 | 说明 |
| --- | --- | --- |
| `args` 单独变化未使全局状态失效 | ✅ 关闭 | 所有 availability-relevant 字段已统一置 Unknown/Unavailable、清时间和 message、删除 override，并触发后台真实 probe |
| global 重叠 validate 无写序保护 | ⚠️ 未完整关闭 | CAS 阻止后完成者覆盖先完成者，但没有按调用顺序分配 generation；较早调用仍可能压掉较晚调用 |
| scoped 同状态结果不保留独立时间 | ✅ 接受设计取舍 | exception-only 语义已明确记录；若未来需要逐 workspace 历史，再独立扩表 |
| update/delete 多步写不原子 | ✅ 关闭 | 两条路径均已包入 `better-sqlite3` transaction |
| scoped validate 未快照 workspace 环境 | ⚠️ 部分关闭 | 已增加 guard，但比较整个 `workspace.updated_at`，会被锁和 branch 等无关写误触发 |
| workspace-scoped list 缺少 Server 测试 | ✅ 关闭 | effective 投影、sibling 隔离、非法/跨 Project、secret-safe 已有 route 测试 |

## Findings

### Correctness / Database Migration

#### 🟠 新 CAS 列被追加进已存在的 schema v7，旧 v7 数据库永远不会获得该列 — `server/src/db/schema-v7.ts:12-23`; `server/src/db/migrations.ts:48-52`

**Severity**: High

**Problem**: workspace-aware availability 在前几轮已经以 schema v7 落地并运行，本轮却直接把下面的 DDL 插回同一个版本：

```sql
ALTER TABLE agent_configs
ADD COLUMN availability_revision INTEGER NOT NULL DEFAULT 0;
```

迁移入口仍然只判断：

```ts
if (currentVersion < 7) {
  db.exec(SCHEMA_V7);
  // record version 7
}
```

所以任何已经记录 `schema_version = 7`、但使用旧版 v7（只有 `adapter_workspace_status` 表）的数据库都会跳过新 DDL。此后：

- `AgentConfigRecord.availability_revision` 从数据库读到 `undefined`；
- availability-relevant update 执行 `availability_revision = availability_revision + 1` 时 SQLite 报 `no such column`；
- global validate 的 CAS SQL同样失败；
- 服务无法正常编辑或验证 adapter。

已做最小复现：依次应用 v1-v6，创建旧 v7 的 `adapter_workspace_status` 表并写入版本 7，再运行当前 `applyMigrations()`。结果仍为 version 7，`PRAGMA table_info(agent_configs)` 中没有 `availability_revision`。现有 migration tests 只覆盖 fresh install、v3/v5 到 latest 和“当前 latest 重跑”，没有覆盖“旧 v7 到新代码”。

**Suggested Fix**:

新增不可变的 schema v8，不再修改已经执行过的 v7：

```ts
// schema-v8.ts
export const SCHEMA_V8 = `
ALTER TABLE agent_configs
ADD COLUMN availability_revision INTEGER NOT NULL DEFAULT 0;
`;
```

```ts
if (currentVersion < 8) {
  db.transaction(() => {
    db.exec(SCHEMA_V8);
    db.prepare(
      "INSERT INTO schema_version (version, applied_at) VALUES (?, ?)",
    ).run(8, new Date().toISOString());
  })();
}
```

同时恢复 v7 为原始的 workspace status table/index 内容，并新增真实升级测试：

```ts
it("upgrades an already-applied old v7 database to v8", () => {
  setupOldV7Db(db);
  applyMigrations(db);

  expect(maxSchemaVersion(db)).toBe(8);
  expect(columnNames(db, "agent_configs"))
    .toContain("availability_revision");
});
```

**Explanation**: migration version 一旦可能被执行就必须视为不可变。即便 F005 尚未合并，前几轮实现已经实际运行过 v7；用 v8 可以同时保证现有开发数据库和未来 fresh install 正确。

---

### Correctness / Concurrency

#### 🟠 CAS 只实现“先完成者获胜”，没有实现“后发起的 Validate 获胜” — `server/src/services/adapter-config.ts:657-678,721-729`; `server/src/repositories/agent-config.ts:229-249`; `server/tests/unit/adapter-config-validate-registry.test.ts:384-459`

**Severity**: High

**Problem**: 两个重叠 global validate 都在开始时读取同一个 revision。谁先完成，谁先 CAS 成功并递增 revision；另一个无论调用顺序如何都会失败。因此当前规则是 completion-order first-wins：

```text
A（旧请求）开始，snapshot = 0
B（新请求）开始，snapshot = 0
A 先结束并 CAS 成功，revision = 1
B 后结束，但 CAS 失败
最终保留 A，而不是较晚发起、较能代表用户最新意图的 B
```

这是上一轮竞态的镜像，并未落实报告建议的“每次调用开始时分配单调 generation，只有最新 generation 可写”。现实场景中 A 很可能是 update/create 自动 probe，B 是用户随后点击的显式 Validate；当前实现可能丢弃用户主动发起的结果。

新增测试只覆盖了“B 后调用但先结束”，测试名称也明确改成“finishes first”，因此无法发现反向 completion order：

```ts
resolvers[1]({ available: false }); // B 先完成
await promiseB;
resolvers[0]({ available: true });  // A 后完成
```

scoped 路径同样以 override `updated_at` 实现 first-completion guard；而当先完成的结果等于 global baseline、目标原本也没有 override 时，`delete()` 不产生任何版本标记，后完成的 probe 仍可继续写入，连 first-completion 规则也不稳定。

**Suggested Fix**:

在 probe **开始时**领取 scope-specific 单调 generation，而不是在 probe 完成写结果时才递增：

```ts
const generation = this.probeRevisionRepo.begin(id, workspaceId);
const result = await adapter.validate(...);

if (!this.probeRevisionRepo.isCurrent(id, workspaceId, generation)) {
  return this.currentEffectiveAdapter(id, workspaceId);
}

this.probeRevisionRepo.writeResultIfCurrent(
  id,
  workspaceId,
  generation,
  result,
);
```

- global key 为 adapter id；
- scoped key 为 `(adapter id, workspace id)`，不要让不同 workspace 的 probe 互相取消；
- generation 必须独立于 exception-only 状态行，否则 baseline result 删除行后没有竞争标记；
- 如果系统保证永久单进程，可先使用 service 内 Map；若要跨进程/重启一致，应使用独立 DB generation 表或 revision 行。

必须补充 global/scoped 双向 completion-order 测试：

1. A 开始、B 开始、B 先完成、A 后完成，最终为 B；
2. A 开始、B 开始、A 先完成、B 后完成，最终仍为 B；
3. scoped B 返回 global baseline 时也必须保留 B 的调用顺序语义。

**Explanation**: “结果最后写入”和“请求最后发起”不是同一件事。只有在调用开始时分配 token，才能稳定表达用户最新一次 Validate 的意图，并同时处理自动 probe 与显式 probe 重叠。

---

### Correctness / Workspace Snapshot

#### 🟡 使用整个 `workspace.updated_at` 作为 probe guard，会被 lock/branch 等无关变化误伤 — `server/src/services/adapter-config.ts:657-685`; `server/src/repositories/workspace.ts:74-101,117-122`

**Severity**: Medium

**Problem**: scoped probe 的真实输入只有 `push_credentials_enabled`，但代码快照的是整个 workspace `updated_at`：

```ts
const snapshotWorkspaceUpdatedAt = workspace.updated_at;
// await probe
const workspaceEnvChanged =
  currentWorkspace.updated_at !== snapshotWorkspaceUpdatedAt;
```

`updated_at` 同时会在以下无关操作中变化：

- 更新 git branch；
- acquire workspace lock；
- release workspace lock；
- recovery 按 run id 释放 lock。

因此一个 1-30 秒的真实 provider probe 期间，只要另一个 Run 正常获取或释放锁，新 probe 结果就会被当作 stale 丢弃。若旧 effective status 是 Available、新 probe 实际发现 Unavailable，系统仍会保留旧 Available 并继续尝试路由。

**Suggested Fix**:

直接快照实际依赖字段：

```ts
const snapshotPushCredentialsEnabled =
  workspace.push_credentials_enabled;

// after probe
const workspaceEnvChanged =
  !currentWorkspace ||
  currentWorkspace.push_credentials_enabled !==
    snapshotPushCredentialsEnabled;
```

如果未来 probe 依赖更多 workspace 环境字段，可新增专用 `availability_environment_revision`，只在这些字段变化时递增，不复用通用 `updated_at`。

新增两个测试：

- probe 期间 acquire/release lock，结果仍应落地；
- probe 期间翻转 `push_credentials_enabled`，结果必须丢弃。

**Explanation**: guard 应只覆盖 probe 的真实输入。过宽的 snapshot 不只是多做一次验证，而是会静默拒绝刚获得的真实状态，并可能保留错误的 Available。

---

### Documentation

#### 🟢 design 仍声称 workspace-aware UI 尚未跟进，与当前实现和其他文档矛盾 — `docs/features/0.1/F005-multi-agent-manual-routing/design.md:319`

**Severity**: Low

**Problem**: design 的 OpenCode 矩阵仍写着“UI 尚未跟进、Validate 不选 workspace”，但上一轮已经接通 `workspace_id` list/Validate、effective fields 和 Adapter Settings。CLAUDE.md、spec 和检视报告均声称 UI 已闭环。

**Suggested Fix**: 将该段改为当前事实，并注明 UI 采用 Project 当前绑定的单 workspace 模型，不是让用户在 Adapter Settings 内自由选择任意 workspace。

**Explanation**: 这段是 workspace availability 的关键设计说明，保留旧结论会误导后续维护者重新实现或错误回退现有行为。

## Positive Observations

- `args` 已与 command/auth/model/key 一样统一触发全局状态失效、时间/message 清理、override 清理和后台真实 probe。
- update/delete 的多步数据库写入已正确纳入同步 transaction。
- API workspace 归属校验和 secret-safe DTO 投影保持正确。
- workspace-scoped list 的 Server route 测试覆盖了 effective fields、sibling 隔离和非法/跨 Project workspace。
- global CAS 至少消除了“后完成结果无条件覆盖先完成结果”的 last-write race，为最终 generation 方案提供了 repository 基础。
- 全量测试、typecheck、production build 均通过。

## Verification

| Check | Result |
| --- | --- |
| Targeted Server tests | 4 files / 98 passed |
| Full Server tests | 107 files passed, 9 skipped / 1378 passed, 17 skipped |
| Full Web tests | 21 files / 164 passed |
| Server + Web typecheck | Passed |
| Production build | Passed |
| Old-v7 migration reproduction | Failed as predicted: version stays 7 and `availability_revision` is absent |
| `git diff --check` | Passed for this report |

Web tests仍会输出既有的 React Query “query data cannot be undefined” mock warnings；本轮未发现它们对应新的 F005 功能失败。

## Summary

| Severity | Count |
| --- | ---: |
| 🔴 Critical | 0 |
| 🟠 High | 2 |
| 🟡 Medium | 1 |
| 🟢 Low | 1 |
| 🔵 Info | 0 |

**Bottom Line**: 大部分上一轮修复已经正确闭环，但必须先把 revision 改为新 migration 版本，并将 probe 竞争规则改成调用开始时领取 generation；完成这 2 项 High 后再考虑关闭 F005。

---

## 处理结果（2026-07-26 追加）

本报告的 2 项 High + 1 项 Medium + 1 项 Low 均已核实并修复。两项 High 采用同一个根本性方案解决，而不是分别打补丁：

**放弃 DB 持久化 revision，改为进程内 generation 追踪**——复核后判断，上一轮引入的 `agent_configs.availability_revision` 列本身就是不必要的：它想解决的"覆盖同一 server 进程内正在进行的探测竞争"问题，天然只在单进程存活期间有意义（重启后没有任何探测"仍在进行中"），与本模块已有的 `pendingAvailabilityProbes`（Set）、`WorkspaceLockService` 内存锁是同一类协调机制，本就不该落库。已撤销该列（`schema-v7.ts` 恢复为不含 `availability_revision` 的原始内容，`AgentConfigRepository.casUpdateAvailability()`/相关字段一并移除），改为 `AdapterConfigService` 内两张纯内存 Map：

- `configGenerations`（key=adapterId）：`update()` 每次使 availability 失效时递增——任何针对该 adapter 的在途 `validate()`（无论 global 还是任意 workspace 的 scoped）据此判定为陈旧。
- `probeGenerations`（key=adapterId，或 scoped 时 `adapterId:workspaceId`）：**在每次 `validate()` 调用开始时**（而非探测完成写入时）领取一个新 generation；写入前若该 scope 的最新 generation已不是自己持有的，则丢弃——这才是检视报告要求的"后发起的 probe 获胜"语义，与完成顺序无关。

> **已扩展（2026-07-26）**：`code-review-report-final-closure-recheck-3.md` 指出这两张 Map 当时是 `AdapterConfigService` 的私有状态，`RunDispatchService.reprobeAdapterOnFailure()`（写同一批 `adapter_workspace_status` 行的第二个写入方）完全不知情，跨服务竞争时仍可能被更早发起的失败 re-probe 压过更晚的显式 Validate。已抽成独立的 `AdapterAvailabilityProbeCoordinator` 单例，注入两个 service 共用，详见该文档"处理结果"。

这个方案同时解决了两项 High：
1. **不再有可能"漏迁移"的 DB 列**——因为压根没有新增列，规避了"旧 v7 数据库永远不会执行该 DDL"的迁移不可变性风险（已用 `node -e` 直接检查本机真实 `personahub.db`，确认其当前处于更早的 schema_version，验证了该风险类别客观存在，即便本次未被这个具体文件命中）。
2. **CAS 从"先完成者获胜"升级为"后发起者获胜"**——新增双向补充测试（`adapter-config-validate-registry.test.ts`）覆盖检视报告要求的两种完成顺序（B 后调用但先完成 / A 先调用且先完成，均验证 B 最终生效），以及 scoped 路径中 B 结果等于 baseline（走 `delete()` 而非 `upsert()`）时同样保留 B 的胜出语义。

**Medium（workspace snapshot 过宽）**：guard 已从整个 `workspace.updated_at` 改为只快照 `push_credentials_enabled`。新增两个测试：probe 期间正常 acquire/release lock 不再误判为 stale；`push_credentials_enabled` 本身翻转才会丢弃结果。

**Low（design.md 文档过期）**：`design.md` OpenCode 矩阵段落已更新为当前事实（workspace-scoped list/Validate/effective fields 已闭环，且明确这是"Project 当前绑定的单一 workspace"模型，不是多 workspace 选择器）。

**验证**：server 全量测试 1382 通过（另 17 个 real-CLI/POSIX-only 按 env/平台 gate 跳过）、web 全量测试 164 通过、typecheck、生产构建均通过；新增的双向完成顺序测试重复运行 3 次无 flake；真实已登录 Codex/Claude/OpenCode CLI 追加验收 validate() 相关路径。
