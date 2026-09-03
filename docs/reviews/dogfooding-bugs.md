# PersonaHub 使用问题记录（dogfooding bug log）

> 只记录**已确认的 bug**，暂不做分类；等积累多了再用主表聚合复盘。
> 存放于 `docs/reviews/dogfooding-bugs.md`（纳入 git）。
> 主表是**唯一事实源**（状态/发现时间/严重度/逃逸层级/旅程步骤/修复 commit 以主表为准；时间统一本地时区 Asia/Singapore，UTC+8），详情块只补「现象/复现/根因/修复/回归测试/发现方式」这类不适合塞进表格的内容。
> 严重度判定：**高**=阻塞主流程（无法继续/数据错误）；**中**=有绕过方案但体验受损；**低**=瑕疵不影响使用。
> **逃逸层级**（必填）=「本该被哪一层拦住」，合法值 `任务级` / `需求级` / `发布级`；回归用例必须补在这一层，判定规则见 <a href="self-test-system-plan.md">`self-test-system-plan.md`</a> §7.1。
> **旅程步骤**（必填）=该问题落在哪条旅程的哪一步；P0 旅程尚未定稿时填 `—`。同一步骤累计出现 ≥2 次即触发 §7.2「重复即升级」，须补该步骤的需求级 spec。
> 统计/校验/列 open 用：`npm run bug:log`。

## 主表

| ID | 状态 | 发现时间 | 严重度 | 逃逸层级 | 旅程步骤 | 问题（一句话） | 根因（一句话） | 关联模块 | 涉及文件 | 回归测试 | 修复 commit |
|---|---|---|---|---|---|---|---|---|---|---|---|
| BUG-001 | fixed | 2026-08-11 22:27 | 高 | 任务级 | — | 调度器 claim validator 后不派工，验证卡 queued | scheduler tick claim 后未 drainWorkspace | validation | validation-dispatch-scheduler.ts / index.ts / test | validation-dispatch-scheduler.test.ts::dispatches_the_claimed_validator | 7b81076 |
| BUG-002 | fixed | 2026-08-11 22:34 | 中 | 任务级 | — | web cancel 空 body 带 JSON content-type → 500 | apiFetch 无条件设 Content-Type，Fastify 拒空 body | web | api-client.ts | f002-ui-flows.test.tsx | 89ed06d |
| BUG-003 | open | 2026-08-11 23:36 | 高 | 任务级 | — | 中断 validator 死锁 round 槽位，重验证无法开始 | interrupted 不推进 round_count 且仍占 round 槽 | validation | result-processor.ts | — | — |
| BUG-004 | fixed | 2026-09-03 17:02 | 中 | 任务级 | — | 装了 agent CLI 的机器上 executable-resolver 单测 7 例必红，`npm run verify` 长期红灯 | 用例是 Windows 形状（`.exe`/`.cmd` fixture、无 exec 位）却在 POSIX 上跑；PATH 又是 prepend 而非替换，于是落回宿主真实二进制 | runtime | server/tests/unit/executable-resolver.test.ts / package.json | executable-resolver.test.ts::does_not_fall_back_to_a_same-named_executable_elsewhere_on_PATH | PENDING |
| BUG-005 | open | 2026-09-03 17:02 | 中 | 任务级 | — | 以 root 运行时权限拒绝扫描用例必红（T089） | 用 chmod 000 构造权限拒绝，但 root 无视 DAC 位；守卫只排除了 win32，没排除 root | workspace | server/tests/integration/filesystem-scanner.test.ts | — | — |

## 详情

### BUG-001：validator run 卡在 queued，验证环节永久不启动

- **现象**：Implementation 完成后进验证，`validation.dispatch_pending` 已写、Issue 转 `Validating`、`validation_dispatch_due_at` 已设。但 validator run 停在 `queued`、`started_at=null`，永远不启动。
- **复现**：建 coding Issue 跑完 implementation → 等 grace 窗口到期（~10s）→ validator 一直 `queued` 不 start。
- **根因**：`ValidationDispatchScheduler.tick()` 里 `claimValidatorSlot(auto)` 创建 queued validator run，但 claim 后**没调 `drainWorkspace`/`startNextQueuedRun`**。对照正常路径都派工：implementation 完成同步路径（`finalizeAndDrain`→`startNextQueuedRun`）、手动触发路径（claim 后 `drainWorkspace`）——唯独 scheduler 漏了。
- **修复**：`tick()` 改异步，先同步 claim 所有到期 Issue，再对 claim 成功 workspace 去重后逐个 `drainWorkspace`。构造器新增第 4 参 `drainWorkspace`（默认 no-op），index.ts 注入真实 drain。
- **回归测试**：新增用例 `dispatches the claimed validator by draining the workspace`，断言 claim 成功后 drain 被调用且传对 workspace_id。
- **发现方式**：人工 dogfood（实跑 coding Issue 时观察到卡住）。
- **备注**：原 wedge 只在 server 不重启时持续；重启时 startup 的 `drainWorkspace` 会意外把它拉起。

### BUG-002：web 端 cancel 请求返回 500（空 JSON body 被 Fastify 拒绝）

- **现象**：UI 点 Cancel（POST `/api/runs/:run_id/cancel`）或 graph cancel 返回 **500**。日志 `FST_ERR_CTP_EMPTY_JSON_BODY: Body cannot be empty when content-type is set to 'application/json'`。
- **复现**：对任意 queued/running run 点 Cancel → 请求带 `Content-Type: application/json` 但无 body → Fastify 拒空 body → 500。
- **根因**：`apiFetch()` 无条件对所有请求设 `Content-Type: application/json`（含无 body POST）。代码已有规避痕迹：`adapter validate` 特意传 `{}` 躲开此坑，cancel 端点漏了。
- **修复**：`apiFetch()` 仅在存在 body 时才设 `Content-Type: application/json`（`hasBody` 判断）。
- **回归测试**：web `f002-ui-flows.test.tsx` cancel 流程用例通过（6/6）；改动在 fetch 层，测试 mock 了 apiClient，主要靠 typecheck + 既有用例。
- **发现方式**：人工 dogfood（UI 点 Cancel 时触发）。

### BUG-003：被中断的 validator 死锁 round 槽位，重验证永远无法开始

- **现象**：validator 运行中被中断（重启 `server_restarted` 或人为取消）→ Issue 变 `Blocked`（`validator_run_failed`）。但即使 unblock 后重跑 implementation，进验证后 validator 仍不启动；Issue 卡 `Validating`。
- **复现**：implementation 完成 → 验证中 → 中断 validator → unblock → Ready → 重跑 implementation → 又进 `Validating` → validator 不再被创建/启动，卡死。
- **根因**：两条 validator 结束路径不同——正常 fail（`processFailed`）`validation_round_count +1`；中断/failed/cancelled（`result-processor.ts::process` 调 `blockIssue`）**不推进 round_count**。而 `getValidatorRunByRound(round)` 返回该 round **任何状态** run（含 terminal interrupted）→ 旧 interrupted validator 占着 round-1 槽、round_count 停 0 → 重验证 round 仍=1 → `per_round_conflict`。且 claim 的 round 取自冻结的 `dispatch_pending` 事件，调度器 / recovery / 手动触发全部解不开。
- **修复方向（待实施）**：`result-processor.ts` 对 Interrupted/Failed/Cancelled validator 调 `blockIssue` 时同时推进 `validation_round_count`（对齐 `processFailed`）。需配回归测试：中断后能通过 unblock + 重跑恢复验证。
- **当前缓解**：新建 coding Issue 重跑（旧 Issue 有 stale interrupted validator 卡着）；或等修复后清理 DB。
- **发现方式**：人工 dogfood（中断 validator 后重跑观察到卡死）。
- **备注**：修复后回填「中断 → unblock → 重跑」能否干净恢复的验证证据。

### BUG-004：装了 agent CLI 的机器上，executable-resolver 单测 7 例必红

- **现象**：`npm run verify` 在 server 单测阶段红灯。`tests/unit/executable-resolver.test.ts` 的 `resolveExecutable (T009a)` 有 7 例失败，断言期望解析到临时 fixture，实得宿主真实二进制：

  ```text
  - Expected: "executable": "/tmp/resolver-test-Yepd56/bin/claude.exe"
  + Received: "executable": "/root/.nvm/versions/node/v24.20.0/bin/claude"
  ```

- **复现**：在**装有 `claude` / `codex` 可执行文件**的 POSIX 机器上跑 `npx vitest run --root server tests/unit/executable-resolver.test.ts`。
- **根因（2026-09-03 修正——首次登记时判断有误）**：初判写的是"用例没隔离 PATH"，**不准确**。用例其实动了 PATH，真正的根因有两层：

  1. **主因：用例是 Windows 形状，却在 POSIX 上无条件运行。** fixture 名为 `claude.exe` / `opencode.cmd`，而 `getPathExtensions()` 只在 Windows 返回 `.exe/.cmd/.bat/.com`，POSIX 下返回 `[""]`——所以 `resolveExecutable("claude")` 在 POSIX 上永远匹配不到 `claude.exe`。绝对路径/相对路径两例则是另一半：fixture 用 `writeFileSync` 写出但没加 exec 位，而 `isExecutableFile()` 在 POSIX 上要求 `X_OK`。**这两类失败在没装 agent CLI 的干净 Linux 机器上同样会红**，只是报 `null` 而不是报错误的二进制。
  2. **放大因素：`putOnPath` 是 prepend 不是替换。** 宿主真实 PATH 仍然可达，于是 POSIX 匹配不到 fixture 后继续往下找，命中 `/root/.nvm/.../bin/claude`。它把"匹配不到"这个诚实失败，伪装成了"匹配到了别的东西"。

  另外还查出一处**假绿**：`.cmd` shim 的三条 "fails …" 用例在 POSIX 上是通过的，但通过原因是 shim 压根没被找到（返回 null），而不是解析器正确拒绝了它——断言 `resolved` 为 null 时无法区分这两种情况。
- **修复**：改测试，不改产品代码（开发冻结期内）。三条：
  1. 新增 `setPath()` **整体替换** PATH，不再 prepend——宿主装没装 agent CLI 与结果无关；
  2. 新增 `writeExecutable()` 按平台写 fixture：Windows 写 `<name>.exe`，POSIX 写无扩展名文件并 `chmod 0o755`，返回真实路径供断言，不再硬编码某个平台的命名；
  3. 三个 `.cmd` shim describe 块改为 `describe.runIf(IS_WINDOWS)`。这不是为了省事跳过——`%dp0%\node_modules\…` 是反斜杠路径，`expandShimMacros` + `resolvePath` 只在 Windows 能拼出真实路径；PATHEXT 发现 `.cmd` 也是 Windows 独有。在 POSIX 跑它们只能产出假绿。非 shim 路径的 POSIX 覆盖由 `direct executables` 块承担，未减少。
- **回归测试**：新增 `does not fall back to a same-named executable elsewhere on PATH when the fixture dir has none`——把宿主真实安装用一个 decoy 目录建模，断言它不在 PATH 上时必须报 not found。这条直接钉住本 bug 的放大因素。修复后本文件在 Linux 上 9 passed / 7 skipped，server 全量 1671 passed，仅剩 BUG-005 一条失败。
- **发现方式**：自动化测试——2026-09-03 提交文档改动前的例行 `npm run verify`。
- **备注**：这是**门禁可靠性缺陷，不是产品旅程缺陷**，故「旅程步骤」填 `—`。真正的危害是 `verify` 在真实开发机上长期红灯；红灯一旦常态化，门禁就失去意义。修复同时把该文件纳入 `package.json` 的 prettier format targets（按 CLAUDE.md 增量格式化约定）。

### BUG-005：以 root 运行时，权限拒绝扫描用例必红（T089）

- **现象**：`server/tests/integration/filesystem-scanner.test.ts:132` 的
  `does not produce false added/deleted when subdirectory is permission denied (T089)` 失败，
  `after.scanComplete` 仍为 `true`（期望 `false`）。
- **复现**：以 root 身份跑 `npx vitest run --root server tests/integration/filesystem-scanner.test.ts`。
- **根因**：用例用 `chmodSync(join(dir, "sub"), 0o000)` 构造"权限拒绝"场景，但 **root 无视 DAC 权限位**，仍能遍历该目录，因此 `scanComplete` 不会变 false、`stopReason` 也不是 `permission_denied`。用例的运行守卫只排除了 Windows（`it.runIf(process.platform !== "win32")`），没有排除 root。
- **修复方向（待实施）**：**不要**只加 uid 守卫跳过——容器与 CI 常以 root 跑，跳过等于这条守卫在最需要它的环境里从不生效。更可取的是改用不依赖 DAC 的方式模拟遍历失败（注入 fs 错误 / 用可替换的目录读取 seam），让用例在任何 uid 下都真实覆盖 `permission_denied` 分支。**开发冻结期内不改代码，仅登记。**
- **回归测试**：修复后该用例需在 root 与非 root 两种身份下都真实执行（而非 skip）并通过。
- **发现方式**：同 BUG-004，同一次 `npm run verify`。
- **备注**：与 BUG-004 同源于一类问题——**用例把"宿主环境恰好是什么样"当成了测试前提**（BUG-004 是宿主装了什么 CLI + 跑在什么平台，本条是以什么身份运行）。若第三例同型缺陷出现，应按 `self-test-system-plan.md` §7.2「重复即升级」补一条需求级约束：单测与集成测试不得依赖宿主 PATH、uid 或已安装的外部 CLI。
