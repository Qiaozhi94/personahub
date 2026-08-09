---
report_type: fix-verification
round: 2
date: 2026-08-09
prior_report: 5ef5055 (feat(f008) 提交后第 1 轮 full-scan)
scope: diff-only
stop_condition_met: true
severity_counts: {critical: 0, high: 0, medium: 0, low: 0}
issues:
  - id: f008-ack-dialog-false-positive
    title: 启用校验的编辑流程被误判为"关闭校验"并弹出错误确认文案
    severity: medium
    category: correctness
    root_cause: root-cause
    origin: original-coding
    pattern_tag: client-server-gate-logic-divergence
    status: fixed
    fix_summary: needsAcknowledge 第三分支镜像服务端 runActivationGate 的 before.valid 判定，仅当 active 校验状态未知或目标移除 validator 时才要求确认
    regression_test: web/src/f008-workflow-template-admin.test.tsx::enabling validation from an active no-validator template does not open the confirmation dialog
    location: web/src/components/workflow-template/WorkflowTemplateAdminDialog.tsx:83-91
    first_seen_round: 1
    resolved_round: 1
  - id: f008-diagnostic-key-collision
    title: 同一 workspace 内多条同 code 诊断在健康面板中产生重复 React key
    severity: medium
    category: correctness
    root_cause: root-cause
    origin: original-coding
    pattern_tag: missing-batch-scenario-test
    status: fixed
    fix_summary: diagnosticKey 纳入 detail（内含 run id/issue id，批量场景唯一）
    regression_test: web/src/f008-runtime-health.test.tsx::renders multiple same-code diagnostics for one workspace without duplicate-key warnings
    location: web/src/components/runtime-health/diagnostic-code.ts:101-106
    first_seen_round: 1
    resolved_round: 1
  - id: f008-schema-version-hardcoded
    title: EXPECTED_SCHEMA_VERSION 与 migrations.ts 的迁移数量各自维护，无单一真相源
    severity: low
    category: quality
    root_cause: root-cause
    origin: original-coding
    pattern_tag: hardcoded-duplicate-constant
    status: fixed
    fix_summary: migrations.ts 导出 CURRENT_SCHEMA_VERSION 常量并用于最后一个迁移块；runtime-health.ts 默认参数改引常量
    regression_test: server/tests/integration/migration-v10.test.ts::CURRENT_SCHEMA_VERSION matches the applied migration count
    location: server/src/db/migrations.ts:12 / server/src/services/runtime-health.ts:19
    first_seen_round: 1
    resolved_round: 1
---

# F008：Workflow Template Admin & Runtime Health — 代码检视（第 2 轮，diff-only 复核，已闭环）

## 结论先行

第 1 轮 full-scan 的 3 条发现（2 Medium + 1 Low）已全部修复并有回归测试锁定：
- **f008-ack-dialog-false-positive（fixed）**：`needsAcknowledge` 第三分支镜像服务端 `runActivationGate()` 的 `before.valid` 判定——仅当 active 模板校验状态未知（null/缺失）或目标移除 validator 时才要求确认；"active 已知无 validator + 目标新增 validator"（启用校验）不再误弹"Disable validation?"。修复后 typecheck 暴露一处 `!== undefined` 应为 `!== null` 的自身修正（fix-regression，第 2 轮内就地闭环）。
- **f008-diagnostic-key-collision（fixed）**：`diagnosticKey` 纳入 `detail`（逐 Run/Issue 诊断的 detail 内含 run id/issue id），同 workspace 同 code 批量场景 key 唯一；新增批量样本测试断言 `console.error` 无重复 key 警告。
- **f008-schema-version-hardcoded（fixed）**：`migrations.ts` 导出 `CURRENT_SCHEMA_VERSION` 单一真相源（最后一个迁移块使用它），`RuntimeHealthService` 默认参数改引常量，删除本地重复字面量。

**第 2 轮复核（diff-only）**：三条修复 diff 逐一与服务端/后端契约核对等价（needsAcknowledge 四象限 vs `!before.valid ? true : !targetHasValidator`；key 唯一性；历史迁移块保留字面量不违反"不得追加已应用版本"铁律）。本地门禁：`npm run typecheck`（server+web）、`npm run lint`、`npm run build` 全部通过；server F008 相关测试 205/205、web F008 相关测试 33/33 全绿（git-scanner/scanner-selector 的 Windows git 子进程环境噪音与本次改动无交集，同第 1 轮结论）。CI 未验证（未 push）。

`stop_condition_met: true`——Critical/High 清零，3 条修复全部落地，第 2 轮 diff-only 复核未发现新问题。

## 发现

| ID | 标题 | 严重度 | 分类 | 根因/症状 | 来源 | 状态 | 修复方案 | 回归测试 | 首次出现轮次 | 修复轮次 | 模式标签 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| f008-ack-dialog-false-positive | 启用校验的编辑流程被误判为"关闭校验"并弹出错误确认文案 | 🟡 Medium | correctness | root-cause | original-coding | open | — | — | 1 | — | client-server-gate-logic-divergence |
| f008-diagnostic-key-collision | 同一 workspace 内多条同 code 诊断在健康面板中产生重复 React key | 🟡 Medium | correctness | root-cause | original-coding | open | — | — | 1 | — | missing-batch-scenario-test |
| f008-schema-version-hardcoded | EXPECTED_SCHEMA_VERSION 与 migrations.ts 的迁移数量各自维护，无单一真相源 | 🟢 Low | quality | root-cause | original-coding | open | — | — | 1 | — | hardcoded-duplicate-constant |

### f008-ack-dialog-false-positive（Medium / correctness）

**位置**：`web/src/components/workflow-template/WorkflowTemplateAdminDialog.tsx:83-87`

```ts
function needsAcknowledge(stepsPreview: StepsPreview): boolean {
  if (!stepsPreview.valid) return false;
  if (!stepsPreview.hasValidator) return true;
  return activeTemplate?.validation_enabled !== true;
}
```

**问题**：这是"Save & enable"（`submitEnable`）流程里、发起 API 请求前的客户端预判——
决定要不要先弹出"Disable validation?"确认框。但它的第三个分支只要
`activeTemplate?.validation_enabled` 不是字面量 `true`（即当前 active 模板本来就
**没有** validator，值为 `false`）就返回 `true`，而不区分"当前 active 是否已经
没有校验"。

服务端 `runActivationGate()`（`server/src/services/workflow-template-admin.ts:224-249`）
的真实门槛是：

```ts
const acknowledgeRequired = !before.valid ? true : !targetHasValidator;
```

当 `before.valid === true` 且 `targetHasValidator === true`（正在**新增** validator
步骤，即启用校验）时，服务端结果是 `acknowledgeRequired = false`——这也正是
`workflow-template-admin.test.ts:509`"T030b: enabling validation (active no-validator
-> target validator) needs no acknowledge"锁定的行为。

**复现场景**：当前 active 模板 T1 没有 validator 步骤
（`activeTemplate.validation_enabled === false`）。用户打开任意历史版本（同样没有
validator），在编辑器里**添加**一个 `role: "validator"` 的 step，点击"Save & enable"。
`previewSteps()` 得到 `hasValidator: true`，进入 `needsAcknowledge` 第三分支：
`false !== true` → `true`——被判定为"需要确认"，于是弹出标题为"Disable validation?"、
文案为"Enabling this version will disable validation for all newly created issues"的
对话框，要求用户勾选"I understand: after this version is enabled, new issues will not
be validated"才能继续。这段文案与用户的真实操作（从无校验切换到有校验）完全相反。

**影响**：不产生数据错误（用户勾选后请求仍会成功，服务端本就不要求这个 ack），
但会让用户在执行一个良性操作时看到语义相反的警告，可能造成用户误以为自己操作有误而
放弃启用校验，或在困惑中被迫勾选一句不成立的陈述才能继续——这正是 FR-004"确认闸门"
本应精确对应"关闭校验"这一个场景的初衷落空。

**建议修复方向**：`needsAcknowledge` 的第三个分支应比较"当前 active 是否已知为有
validator"而不是简单判等 `true`；或者更彻底地——放弃客户端预判走查，统一依赖
`runActivate`/`runCreateVersion` 的 `onError` 已经实现的服务端 400
`VALIDATION_DISABLE_NOT_ACKNOWLEDGED` 兜底再弹窗（`activateVersion` 的自愈路径已经
证明这条路径可行，只是多一次往返）。二者选一，但不能保留当前"仅凭 target 是否有
validator 就在 before 已知无 validator 时依然拦截"的状态。

---

### f008-diagnostic-key-collision（Medium / correctness）

**位置**：`web/src/components/runtime-health/diagnostic-code.ts:101-103`，消费方
`web/src/components/runtime-health/RuntimeHealthDialog.tsx:64-66`

```ts
export function diagnosticKey(diagnostic: HealthDiagnostic): string {
  return `${diagnostic.code}:${diagnostic.workspace_id ?? "global"}`;
}
```
```tsx
{health.diagnostics.map((d) => (
  <DiagnosticRow key={diagnosticKey(d)} diagnostic={d} />
))}
```

**问题**：`RuntimeHealthSnapshot.diagnostics` 里的诊断条目**不保证同一 `(code,
workspace_id)` 组合唯一**。后端 `RuntimeHealthService.collectWorkspaceDiagnostics()`
（`server/src/services/runtime-health.ts:213-234`）对同一 workspace 下的每个 queued
Run 分别调用 `classifyQueuedRun()`，`waiting_for_recovery` 与 `invalid_queued_run`
两个分类结果是**逐条 push**、按 Run 数量可能出现多条——例如同一 workspace 下有两个
`Blocked` Issue 各自挂着一个 `GraphNode` 排队 Run，就会产生两条
`code: "waiting_for_recovery"`、`workspace_id` 相同的诊断；或两个 Issue 状态已变化但
仍有排队 Run，产生两条同 workspace 的 `invalid_queued_run`。这是完全可达的批量场景，
不是边界假设。

`diagnosticKey()` 只用 `code:workspace_id` 拼接，没有纳入区分单条记录的字段（比如
`detail` 里包出现的 run id），这类批量场景下会生成**重复的 React key**，违反 React
对列表 key 唯一性的要求——在后续 refetch（例如点击"Refresh"按钮，或 react-query 的
自动重新请求）时，如果两条同 key 诊断中的一条状态发生变化（比如其中一个排队 Run 被
处理掉、另一个还在），React 的 reconciliation 可能把内容更新错配到错误的 DOM 节点上，
并在控制台产生 "Encountered two children with the same key" 警告。

**测试覆盖缺口**：`web/src/f008-runtime-health.test.tsx` 用 `ALL_CODES` 数组逐个
code 各构造一条诊断（保证互不相同），后端 `runtime-health.test.ts` 的诊断类测试也都
是单条断言，**没有一处构造"同一 workspace、同一 code、两条不同 run 的诊断"**这一
批量样本——按 review-convergence 协议第 5 条，这类涉及多条记录同批处理的路径必须有
专属批量测试，目前缺失。

**建议修复方向**：`diagnosticKey` 改为纳入能唯一区分单条记录的信息（例如把
`detail` 纳入哈希，或者后端诊断结构体加一个可选的 `run_id`/`issue_id` 字段，前端用
`code:workspace_id:run_id` 或数组下标兜底 `code:workspace_id:index` 组合）。

---

### f008-schema-version-hardcoded（Low / quality）

**位置**：`server/src/services/runtime-health.ts:19`（`export const
EXPECTED_SCHEMA_VERSION = 10;`），对照 `server/src/db/migrations.ts` 全文——该文件
用 10 个手写的 `if (currentVersion < N)` 块隐式编码"当前最高 schema 版本是
10"，没有导出任何常量供别处复用。

**问题**：`RuntimeHealthService` 用这个硬编码值和数据库里
`SELECT MAX(version) FROM schema_version` 的实际值比较，得出
`current`/`behind`/`ahead`。当前两处恰好一致（都是 10），但两者是**各自独立维护、
无编译期或运行期关联**的数字。未来若新增 `SCHEMA_V11` 并在 `migrations.ts` 里追加
第 11 个 `if` 块，只要忘记同步修改 `runtime-health.ts` 这一行，`RuntimeHealthService`
会对每一个正确迁移到 v11 的数据库都误报 `status: "ahead"` 并产出
`schema_version_mismatch` 诊断，建议"upgrade or revert the server"——这是一个把
正常状态误报为异常的假阳性，且没有任何测试会在"新增一个 schema 版本"时失败提醒开发者
同步这个常量。

**建议修复方向**：从 `migrations.ts` 导出一个`CURRENT_SCHEMA_VERSION`
常量（可以直接是"已注册的迁移块数量"或末尾那次 `INSERT ... VALUES (?, ...)` 里的
字面量来源），`RuntimeHealthService` 默认参数改为引用该常量而不是重复字面量
`10`。工作量很小，且能让这类硬编码走查在下次加 schema 版本时不需要人工记住。

## 停止条件核对

1. ✅ Critical/High 清零——第 2 轮后 0 Critical / 0 High / 0 Medium / 0 Low（3 条已修复）。
2. ✅ 本地 lint/typecheck/build/test 全绿（server F008 相关 205/205、web F008 相关 33/33；git-scanner/scanner-selector 的 Windows git 子进程环境噪音与本次改动无交集，同第 1 轮结论）；**CI 未验证**（尚未 push）。
3. — 本项目未接入 `code-review-graph` 系列 MCP 工具，第 2 轮以 diff-only 人工复核三条修复及其相邻契约。

`stop_condition_met: true`——3 条发现全部 fixed 并各自配回归测试锁定，第 2 轮复核未引入新问题，本文件可以闭环。
