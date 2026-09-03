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
| BUG-003 | fixed | 2026-08-11 23:36 | 高 | 任务级 | — | 中断 validator 死锁 round 槽位，重验证无法开始 | 无结论的终态 validator 占着 `(issue, round)` 唯一索引槽，而 round_count 只记已形成的 failed 结论，两者永不前进 | validation | db/schema-v11.ts / repositories/run.ts / validation/validator-slot-claimer.ts / shared/types/index.ts | validation-validator-uniqueness.test.ts::supersedes_a_{interrupted,cancelled,failed}_validator_with_a_new_attempt + migration-v11.test.ts | PENDING3 |
| BUG-004 | fixed | 2026-09-03 17:02 | 中 | 任务级 | — | 装了 agent CLI 的机器上 executable-resolver 单测 7 例必红，`npm run verify` 长期红灯 | 用例是 Windows 形状（`.exe`/`.cmd` fixture、无 exec 位）却在 POSIX 上跑；PATH 又是 prepend 而非替换，于是落回宿主真实二进制 | runtime | server/tests/unit/executable-resolver.test.ts / package.json | executable-resolver.test.ts::does_not_fall_back_to_a_same-named_executable_elsewhere_on_PATH | 3ceed8d |
| BUG-005 | fixed | 2026-09-03 17:02 | 中 | 任务级 | — | 以 root 运行时权限拒绝扫描用例必红（T089） | 用 chmod 000 构造权限拒绝，但 root 无视 DAC 位；守卫只排除了 win32，没排除 root | workspace | server/tests/integration/filesystem-scanner.test.ts / package.json | filesystem-scanner.test.ts::T089 + ::reaches_the_same_permission_denied_stop_reason_from_real_chmod | 5e6f34e |
| BUG-006 | fixed | 2026-09-03 17:24 | 低 | 任务级 | — | Feature 门禁在 Linux 上不拒绝 Windows 绝对路径（`C:\Users\test` 被判合法测试路径） | `validateTestPathSyntax` 用 `path.isAbsolute`，在 Linux 是 posix 语义，识别不出盘符路径；注释写的是「Unix 或 Windows 都拒绝」 | tooling | tools/check-feature-gates.mjs / tools/check-doc-links.mjs / tools/check-docs.test.mjs | check-feature-gates.test.mjs::validateTestPathSyntax::rejects_Windows_absolute_path + check-docs.test.mjs::validateLinkPathBoundary::rejects_Windows_absolute_path | 30ea8d1 |

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
- **根因补全（2026-09-03）**：原记录只说到「不推进 round_count」，漏了另一半——`schema-v5.ts` 有唯一索引
  `idx_runs_validator_per_round ON runs(issue_id, validation_round) WHERE role='validator' AND validation_round IS NOT NULL`，
  **与终态无关**。所以死锁是两个不变量对撞：round 槽被无结论的死 run 永久占着，而 round_count
  按 PRD 定义只记「已形成 failed 结果」的轮次、不会因它前进。两边都不动 = 永远同一个 round、
  永远撞同一条死 run。同一形状还覆盖 `processBlocked`（outcome=blocked 也不推进 round_count）。
- **修复（2026-09-03，第二版——按使用者裁决改用 attempt 维度）**：**没有采用原记录里「推进
  round_count」的方向**。那会让一次服务器重启吃掉用户 1/3 的验证预算——三次重启就能把 Issue 推到
  `round_limit_reached`，而用户一个结论都没拿到。这正是「证据不足」和「真失败」被压进同一个出口。

  第一版实现改成把死 run 的 `validation_round` 置 NULL 来交还槽位，但那与 PRD §7.5
  「每条 validator Run 记录自身不可变的 `validation_round`」字面冲突。使用者裁决：**加 attempt
  维度、保持 `validation_round` 不可变**。最终实现：

  1. **schema-v11**：`runs` 增列 `validation_attempt`；把唯一索引
     `idx_runs_validator_per_round(issue_id, validation_round)` 换成
     `idx_runs_validator_per_round_attempt(issue_id, validation_round, validation_attempt)`。
     历史 validator 行回填 attempt=1——迁移前第二个 attempt 根本插不进来，不可能有别的值。
  2. **概念分离**：**round 是预算单位**（`max_validation_rounds` 花的是它），
     **attempt 是「为拿到这一轮的结论试了几次」**。死掉的 attempt 保留自己的 round 与 attempt
     号供审计，由 attempt N+1 取代；预算一分不扣。
  3. **claimer**：终态且无结论（failed/cancelled/interrupted）的 attempt 不再触发
     `per_round_conflict`，新 run 取 `nextValidationAttempt()`。**Completed 仍然占位**——
     它的结论可能只是还没被处理（既有 T093 用例正是这个场景）。
  4. **`getValidatorRunByRound` 返回最新 attempt** 而非最早的，否则「现在谁拥有这一轮」会答出尸体。
     按 `validation_attempt DESC` 排序，不依赖时钟精度。
  5. `idx_runs_one_active_validator`（schema-v4）继续保证一个 Issue 同时只有一个活跃 validator，
     所以多个 attempt 不可能并发。
  6. Issue 仍然照常 Blocked——validator 死了用户必须知道；解开的是 unblock 之后的重试路径。
- **对既有卡死数据的影响**：迁移后自愈，不需清库。第一版曾把部分 run 的 `validation_round`
  置 NULL；若某个开发库跑过那一版，那些行的 round 无法恢复（迁移只回填 attempt，不猜 round），
  但它们已不占索引槽，不影响重试。
- **回归测试**：
  - `validation-validator-uniqueness.test.ts` 新增三例，**interrupted / cancelled / failed 各断言
    一遍**——三者走同一段代码，只特判 `interrupted` 的修法会把同样的死锁留在 cancel 与 spawn
    失败后面。每例断言：Issue 仍 Blocked、`validation_round_count` 仍为 0、**死 run 的 round 与
    attempt 都没被改动**、unblock 后 claim 成功且拿到 round 1 / attempt 2、
    `getValidatorRunByRound` 答出的是 attempt 2。
  - `migration-v11.test.ts` 覆盖：到达 head 版本、幂等、加列、回填（有 round 的置 1、无 round 的
    保持 NULL）、索引替换，以及**同一 round 的第二个 attempt 可插入而重复 attempt 被拒**
    ——即旧索引挡住的那条插入。
- **发现方式**：人工 dogfood（中断 validator 后重跑观察到卡死）。
- **顺带修掉的一类脆弱断言**：本次加 migration 时有 14 个既有用例红，全都是把
  **当前 head schema 版本号硬编码**在与该版本无关的断言里（`expect(row.v).toBe(10)`），
  以及 v5/v6 用例直接断言旧索引名。已改为引用 `CURRENT_SCHEMA_VERSION` 与新索引名，
  并把「fresh install reaches latest (v8)」这类会随时间说谎的用例名改成版本无关表述。
  这与 §7.5「宿主无关」是同一条毛病的另一面：**断言钉在了偶然事实上**。

### BUG-005：以 root 运行时，权限拒绝扫描用例必红（T089）

- **现象**：`server/tests/integration/filesystem-scanner.test.ts` 的
  `does not produce false added/deleted when subdirectory is permission denied (T089)` 失败，
  `after.scanComplete` 仍为 `true`（期望 `false`）。
- **复现**：以 root 身份跑 `npx vitest run --root server tests/integration/filesystem-scanner.test.ts`。
- **根因**：用例用 `chmodSync(join(dir, "sub"), 0o000)` 构造"权限拒绝"场景，但 **root 无视 DAC 权限位**，仍能遍历该目录，因此 `scanComplete` 不会变 false、`stopReason` 也不是 `permission_denied`。用例的运行守卫只排除了 Windows（`it.runIf(process.platform !== "win32")`），没有排除 root。
- **修复**：改测试，不改产品代码。**没有采用"加 uid 守卫跳过"**——容器与 CI 常以 root 跑，跳过等于这条守卫在最需要它的环境里从不生效，那比现在红着更糟。改为直接驱动被测分支：`scanTree` 到达 `permission_denied` 的唯一条件是 `readdirSync` 抛错，因此用 `vi.mock("node:fs", …)` 只对**一个指定目录**让 `readdirSync` 抛 `EACCES`，其余调用原样透传。开关是模块级的 `deniedDir.path`，默认 `null`，`afterEach` 复位，所以同文件其余用例继续走真实文件系统。这样该用例在**任何平台、任何 uid** 下都真实覆盖 `permission_denied` 分支。
- **回归测试**：
  - `T089` 本体现在无条件运行（原先在 root 下必红、在 Windows 下被跳过）；
  - 新增 `reaches the same permission_denied stop reason from real chmod 0o000 (non-root POSIX)`——真实文件系统那一半，守卫为 `platform !== "win32" && getuid() !== 0`。它证明上面的 mock 建模的是真实会发生的事；作为 OS 能提供时的**额外**保证，而不是唯一保证。
- **发现方式**：自动化测试——2026-09-03 提交文档改动前的例行 `npm run verify`。
- **备注**：与 BUG-004 同源于一类问题——**用例把"宿主环境恰好是什么样"当成了测试前提**（BUG-004 是宿主装了什么 CLI + 跑在什么平台，本条是以什么身份运行）。修复后 server 全量 1672 passed / 0 failed。按 CLAUDE.md 增量格式化约定，把该文件纳入 `package.json` 的 prettier format targets。

### BUG-006：Feature 门禁在 Linux 上不拒绝 Windows 绝对路径

- **现象**：`npm run verify` 的 `test:feature-gates` 阶段红灯，
  `tools/check-feature-gates.test.mjs` 的
  `validateTestPathSyntax > rejects Windows absolute path` 失败——
  `validateTestPathSyntax('C:\\Users\\test')` 在 Linux 上返回 `ok: true`。
- **复现**：在 Linux/macOS 上跑 `npm run test:feature-gates`。Windows 上不复现。
- **根因**：`tools/check-feature-gates.mjs:578` 用 `path.isAbsolute(p)` 判断绝对路径，
  而 `path` 在 Linux 上是 posix 实现，识别不出 `C:\…` 盘符路径。**紧邻的注释写的是
  「Reject absolute paths (Unix or Windows)」——意图明确，实现只覆盖了当前平台。**
- **影响判断**：这不只是测试问题，是**门禁本身的漏洞**——在 Linux 上，Feature spec 里写
  `tests: C:\Users\x.test.ts` 这样的测试路径不会被拒。严重度定为「低」是因为触发它需要
  有人在 spec 里手写盘符路径；但它落在**守护其他所有门禁的那一层**，不宜久留。
- **修复**：改为 `pathPosix.isAbsolute(p) || pathWin32.isAbsolute(p)`，两种语义都显式判，
  不再走宿主默认实现。**同型扫描后一并修了 `tools/check-doc-links.mjs` 的
  `validateLinkPathBoundary`**——同一处缺陷、同一意图（把链接挡在仓库根内）、同一目录，
  属于当前 scope 内的同型命中，不留到下次。
- **回归测试**：`check-feature-gates.test.mjs::validateTestPathSyntax::rejects Windows absolute path`
  原本就写对了、当时是红的，修复后转绿——**这一侧不需要新增用例，用例没错，实现错了**。
  `validateLinkPathBoundary` 那一侧则**缺**对应用例（只断言了 posix 绝对路径），
  按 7.5 的双向覆盖要求补了 `rejects Windows absolute path`。
- **发现方式**：自动化测试——修完 BUG-004/005 后跑 `npm run verify` 时暴露。
- **备注**：这是同一缺陷家族的**第三例**（BUG-004 宿主装了什么 + 什么平台、BUG-005 什么身份、
  本条什么平台）。按 <a href="self-test-system-plan.md">`self-test-system-plan.md`</a> §7.2
  「重复即升级」，处置不应再是第三个点修。该约束已于 2026-09-03 落为
  <a href="self-test-system-plan.md">`self-test-system-plan.md`</a> **§7.5「宿主无关：判定结果
  不得取决于谁在跑」**——含 5 条具体规则与跳过的边界判据，并诚实登记了"暂无自动门禁、靠纪律
  维持"这一状态。修复后 `npm run verify` 首次全绿（exit 0）。
