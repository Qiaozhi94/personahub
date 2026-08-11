# PersonaHub 使用问题记录（dogfooding bug log）

> 只记录**已确认的 bug**，暂不做分类；等积累多了再用主表聚合复盘。
> 存放于 `docs/reviews/dogfooding-bugs.md`（纳入 git）。
> 主表是**唯一事实源**（状态/发现时间/严重度/修复 commit 以主表为准；时间统一 UTC），详情块只补「现象/复现/根因/修复/回归测试」这类不适合塞进表格的内容。
> 统计/校验/列 open 用：`npm run bug:log`。

## 主表

| ID | 状态 | 发现时间 | 严重度 | 问题（一句话） | 根因（一句话） | 涉及文件 | 回归测试 | 修复 commit |
|---|---|---|---|---|---|---|---|---|
| BUG-001 | fixed | 2026-08-11 14:27 | 高 | 调度器 claim validator 后不派工，验证卡 queued | scheduler tick claim 后未 drainWorkspace | validation-dispatch-scheduler.ts / index.ts / test | validation-dispatch-scheduler.test.ts::dispatches_the_claimed_validator | 7b81076 |
| BUG-002 | fixed | 2026-08-11 14:34 | 中 | web cancel 空 body 带 JSON content-type → 500 | apiFetch 无条件设 Content-Type，Fastify 拒空 body | api-client.ts | f002-ui-flows.test.tsx | 89ed06d |
| BUG-003 | open | 2026-08-11 15:36 | 高 | 中断 validator 死锁 round 槽位，重验证无法开始 | interrupted 不推进 round_count 且仍占 round 槽 | result-processor.ts | — | — |

## 详情

### BUG-001：validator run 卡在 queued，验证环节永久不启动

- **现象**：Implementation 完成后进验证，`validation.dispatch_pending` 已写、Issue 转 `Validating`、`validation_dispatch_due_at` 已设。但 validator run 停在 `queued`、`started_at=null`，永远不启动。
- **复现**：建 coding Issue 跑完 implementation → 等 grace 窗口到期（~10s）→ validator 一直 `queued` 不 start。
- **根因**：`ValidationDispatchScheduler.tick()` 里 `claimValidatorSlot(auto)` 创建 queued validator run，但 claim 后**没调 `drainWorkspace`/`startNextQueuedRun`**。对照正常路径都派工：implementation 完成同步路径（`finalizeAndDrain`→`startNextQueuedRun`）、手动触发路径（claim 后 `drainWorkspace`）——唯独 scheduler 漏了。
- **修复**：`tick()` 改异步，先同步 claim 所有到期 Issue，再对 claim 成功 workspace 去重后逐个 `drainWorkspace`。构造器新增第 4 参 `drainWorkspace`（默认 no-op），index.ts 注入真实 drain。
- **回归测试**：新增用例 `dispatches the claimed validator by draining the workspace`，断言 claim 成功后 drain 被调用且传对 workspace_id。
- **备注**：原 wedge 只在 server 不重启时持续；重启时 startup 的 `drainWorkspace` 会意外把它拉起。

### BUG-002：web 端 cancel 请求返回 500（空 JSON body 被 Fastify 拒绝）

- **现象**：UI 点 Cancel（POST `/api/runs/:run_id/cancel`）或 graph cancel 返回 **500**。日志 `FST_ERR_CTP_EMPTY_JSON_BODY: Body cannot be empty when content-type is set to 'application/json'`。
- **复现**：对任意 queued/running run 点 Cancel → 请求带 `Content-Type: application/json` 但无 body → Fastify 拒空 body → 500。
- **根因**：`apiFetch()` 无条件对所有请求设 `Content-Type: application/json`（含无 body POST）。代码已有规避痕迹：`adapter validate` 特意传 `{}` 躲开此坑，cancel 端点漏了。
- **修复**：`apiFetch()` 仅在存在 body 时才设 `Content-Type: application/json`（`hasBody` 判断）。
- **回归测试**：web `f002-ui-flows.test.tsx` cancel 流程用例通过（6/6）；改动在 fetch 层，测试 mock 了 apiClient，主要靠 typecheck + 既有用例。

### BUG-003：被中断的 validator 死锁 round 槽位，重验证永远无法开始

- **现象**：validator 运行中被中断（重启 `server_restarted` 或人为取消）→ Issue 变 `Blocked`（`validator_run_failed`）。但即使 unblock 后重跑 implementation，进验证后 validator 仍不启动；Issue 卡 `Validating`。
- **复现**：implementation 完成 → 验证中 → 中断 validator → unblock → Ready → 重跑 implementation → 又进 `Validating` → validator 不再被创建/启动，卡死。
- **根因**：两条 validator 结束路径不同——正常 fail（`processFailed`）`validation_round_count +1`；中断/failed/cancelled（`result-processor.ts::process` 调 `blockIssue`）**不推进 round_count**。而 `getValidatorRunByRound(round)` 返回该 round **任何状态** run（含 terminal interrupted）→ 旧 interrupted validator 占着 round-1 槽、round_count 停 0 → 重验证 round 仍=1 → `per_round_conflict`。且 claim 的 round 取自冻结的 `dispatch_pending` 事件，调度器 / recovery / 手动触发全部解不开。
- **修复方向（待实施）**：`result-processor.ts` 对 Interrupted/Failed/Cancelled validator 调 `blockIssue` 时同时推进 `validation_round_count`（对齐 `processFailed`）。需配回归测试：中断后能通过 unblock + 重跑恢复验证。
- **当前缓解**：新建 coding Issue 重跑（旧 Issue 有 stale interrupted validator 卡着）；或等修复后清理 DB。
- **备注**：修复后回填「中断 → unblock → 重跑」能否干净恢复的验证证据。
