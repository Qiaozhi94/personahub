# PersonaHub 使用问题记录（dogfooding bug log）

> 本文件只记录**已确认的 bug**，暂不做分类，等积累多了再单独复盘分类。
> 存放于 `docs/research/`（本地-only，gitignore），不纳入 git。
> 每条尽量记录详细：现象 / 复现 / 根因 / 状态 / 修复 / 回归测试。

## BUG-001：validator run 卡在 queued，验证环节永久不启动

**状态**：✅ fixed
**日期**：2026-08-11
**严重度**：高（阻塞验证闭环）
**涉及文件**：
- `server/src/services/validation-dispatch-scheduler.ts`
- `server/src/index.ts`
- `server/tests/integration/validation-dispatch-scheduler.test.ts`

### 现象
Implementation run 正常完成后进入验证环节，`validation.dispatch_pending` 事件已写、Issue 转 `Validating`、`validation_dispatch_due_at` 已设。但 validator run 停在 `queued`、`started_at=null`，永远不启动。手动触发也无法解（见 BUG-003 关联）。

### 复现步骤
1. 建 coding Issue，跑完 implementation（hello world 脚本）。
2. 等待 grace 窗口到期（默认 ~10s）。
3. 观察：validator run 状态一直是 `queued`，不 start。

### 根因
`ValidationDispatchScheduler.tick()` 里 `claimValidatorSlot(auto)` 创建了 `queued` 的 validator run，但 claim 后**没有调用 `drainWorkspace`/`startNextQueuedRun`** 去把 run 拉起。
对照两条正常的 claim 路径都派工：
- implementation 完成同步路径：`finalizeAndDrain` → `startNextQueuedRun`（run-dispatch.ts）
- 手动触发路径：validation.ts 手动 POST claim 后 `drainWorkspace`
唯独 scheduler 路径漏了派工。

### 修复
`scheduler.tick()` 改为异步，先同步 claim 所有到期 Issue，再对 claim 成功的 workspace **去重**后逐个 `drainWorkspace`。构造器新增第 4 参 `drainWorkspace`（默认 no-op，兼容既有测试），index.ts 注入真实 `runDispatchService.drainWorkspace`。

### 回归测试
`validation-dispatch-scheduler.test.ts` 新增用例：
`dispatches the claimed validator by draining the workspace` — 断言 claim 成功后 `drain` 被调用且传入正确 workspace_id。

### 备注
原 wedge 只在该 server 进程不被重启时才持续；server 重启时 startup 的 `drainWorkspace` 会意外把它拉起。

---

## BUG-002：web 端 cancel 请求返回 500（空 JSON body 被 Fastify 拒绝）

**状态**：✅ fixed
**日期**：2026-08-11
**严重度**：中（取消操作不可用）
**涉及文件**：
- `web/src/lib/api-client.ts`

### 现象
在 UI 点「Cancel Run」（POST `/api/runs/:run_id/cancel`）或 graph cancel，返回 **500**。日志报 `FST_ERR_CTP_EMPTY_JSON_BODY: Body cannot be empty when content-type is set to 'application/json'`。

### 复现步骤
1. 对任意 queued/running run 点 Cancel。
2. 请求带 `Content-Type: application/json` 但无 body。
3. Fastify 默认 JSON 解析器拒绝空 body → 500。

### 根因
`apiFetch()` 无条件对所有请求设 `Content-Type: application/json`（包括无 body 的 POST）。Fastify 对 `application/json` + 空 body 直接抛错。代码里已有规避痕迹：`adapter validate` 那处特意传 `{}` 躲开这个坑，cancel 端点漏了。

### 修复
`apiFetch()` 改为**仅在存在 body 时**才设 `Content-Type: application/json`（`hasBody` 判断），无 body 的请求不带该 header。

### 回归测试
web `f002-ui-flows.test.tsx` 的 cancel 流程用例通过（6/6）。此改动在 fetch 层，测试 mock 了 apiClient，主要靠 typecheck + 既有用例覆盖。

---

## BUG-003：被中断的 validator 死锁 round 槽位，重验证永远无法开始

**状态**：⏳ open（已定位，待修复）
**日期**：2026-08-11
**严重度**：高（中断后无法恢复验证）
**涉及文件**（预计）：
- `server/src/services/validation/result-processor.ts`

### 现象
validator 在运行中被中断（服务器重启 `server_restarted`，或人为取消）后，Issue 变 `Blocked`（`validator_run_failed`）。但**即使 unblock 后重跑 implementation**，进入验证环节后 validator 仍永远不启动；Issue 卡在 `Validating`，`validation_dispatch_due_at` 过期后调度器 claim 失败。

### 复现步骤
1. implementation 完成 → 验证进行中。
2. 中断 validator（如服务重启）。
3. unblock → Ready → 重新跑 implementation → 又进 `Validating`。
4. 观察：validator run 不再被创建/启动，Issue 卡死。

### 根因
对比两条 validator 结束路径：
- **正常 fail**（`processFailed`）：`validation_round_count +1`，round 推进 → 下次重验证 round+1，槽位空闲。
- **中断/failed/cancelled**（`result-processor.ts` 的 `process()`，对 Interrupted/Failed/Cancelled 调 `blockIssue`）：**不推进 `validation_round_count`**（仍=0）。

而 `getValidatorRunByRound(round)` 会返回该 round 的**任何状态** run（含 terminal 的 interrupted）。于是：
- 旧 interrupted validator（round 1）永远占着 round-1 槽位；
- `validation_round_count` 停在 0 → 重验证 round 仍=1 → `claimValidatorSlot` 撞 `per_round_conflict`；
- 且 claim 的 round 取自冻结的 `dispatch_pending` 事件，不随 `round_count` 变 → 调度器 / recovery / 手动触发全部解不开。

### 修复方向（待实施）
`result-processor.ts` 对 Interrupted/Failed/Cancelled 的 validator 调 `blockIssue` 时，同时推进 `validation_round_count`（对齐 `processFailed`），使下次验证使用新 round、槽位空闲。需配回归测试：中断后能通过 unblock + 重跑恢复验证。

### 当前缓解
- 新建一个 coding Issue 重跑（旧 Issue 有 stale interrupted validator 卡着）。
- 或等待上述修复落地后清理 DB。

---

## 待办 / 复盘提示
- BUG-003 修复后，回填「中断 → unblock → 重跑」能否干净恢复的验证证据。
- 积累足够多后，再按「调度 / 派工 / 恢复 / UI 契约」等维度分类复盘。
