---
feature_ids: [F008]
related_features: [F004, F005, F007]
topics: [workflow-template, admin-ui, runtime-health, observability]
doc_kind: design
created: 2026-08-01
updated: 2026-08-09
---

# F008：Workflow Template Admin & Runtime Health - 设计

> Status: ready-for-development | Owner: TBD | Spec: `spec.md`

## 1. 技术概要

两块互相独立的能力放在同一个 feature，因为它们共享同一条主线：把系统已经拥有但用户看不到的状态呈现出来。

- **模板管理**：给 `WorkflowTemplateRepository` 补写方法，编辑一律走"新增版本"，既有行不可变。
- **Runtime health**：新增一个纯只读聚合服务，全部数据来自既有仓储查询，不新增表、不触发任何副作用。

## 2. 影响面

- **存储**：`workflow_templates` 本身无变更（`version` / `status` 列已具备），但**新增 `admin_audit_events` 表**（`schema-v10.ts`）——初稿"无 schema 变更"的说法因 FR-004 的审计载体需要而修正，理由见第 7 节。
- **后端**：`WorkflowTemplateRepository` 补 `listByIssueType` / `listVersions` / `insertVersion` / `activate` / `deactivate`（**不提供通用 `setStatus`**，见第 4 节）；新增 `WorkflowTemplateAdminService`、`RuntimeHealthService`。
- **API**：模板 CRUD 子集 + `GET /api/projects/:projectId/health/runtime`。
- **前端**：模板管理面板 + health 面板。
- **不影响**：`validator-selector.ts`、`IssueService.create()`、F004 validation 语义。

## 3. Q1（已关闭）：版本化而非原地修改

`workflow_templates` 已有 `version` 与 `status` 列，且 `issues.workflow_template_id` **没有外键约束**（`schema-v1.ts:63` 是裸 `TEXT NOT NULL`），进行中的 Issue 只是持有一个 id 字符串。这意味着：

- 原地修改一行，会**立刻改变所有引用该 id 的进行中 Issue 的行为**——包括 validation 是否启用。这是不可接受的。
- 版本化则天然安全：进行中 Issue 继续指向旧 id，新 Issue 用新 id。

因此 `insertVersion()` 插入新行（新 id、`version = max(version) + 1`），**从不 UPDATE 既有行的内容字段**。既有行唯一允许被改的是 `status`，但**不能用一个通用的 `setStatus()`**——理由见第 4 节。

## 4. Q2（已关闭）：新版本不得悄悄接管

`getDefault()` 的实现是：

```sql
SELECT * FROM workflow_templates
WHERE issue_type = 'coding' AND status = 'active'
ORDER BY version DESC LIMIT 1
```

也就是说，**只要插入一个 `status='active'` 且版本号更高的行，它立刻成为所有新 Issue 的默认模板**，无需任何显式"设为默认"动作。这是个容易踩的陷阱：用户以为自己只是"存了个草稿"。

因此 `insertVersion()` 的入参必须显式携带 `activate: boolean`：

- `activate: false`（默认）→ 新版本以 `status='inactive'` 落库，不影响任何人。
- `activate: true` → 在**同一事务内**把同 `issue_type` 的其他 active 版本置为 inactive，再插入新的 active 版本。

UI 上"保存"与"启用"必须是两个动作，且启用时明确提示"此后新建的 Issue 将使用该版本"。

### 不能有通用的 `setStatus()`（初稿漏洞，已修正）

初稿一边要求 `insertVersion({activate:true})` 事务性停用同类 active 版本，一边又允许 `setStatus()` 自由切 `active ↔ inactive`。**用后者重新激活一个旧版本就能造出两个 active 行**，`getDefault()` 的结果重新退回"谁版本号大谁赢"这条隐式规则——正是 Q2 声称已关闭的陷阱。而且旧版本的版本号更小，激活它反而不会生效，用户看到的是"我启用了它但没用"。

去掉通用状态写入，换成两个语义明确的命令，二者都是**唯一保持不变量的路径**，新版本与既有版本共用同一条：

| 命令 | 事务内行为 | 拒绝条件 |
|---|---|---|
| `activate(id)` | 停用同 `issue_type` 的**全部** active 行 → 激活 `id` | `steps_json` 非法/NULL（见第 6 节）；模板不存在 |
| `deactivate(id)` | 仅置该行 inactive | 它是该 `issue_type` 最后一个 active 模板 |

- `insertVersion({activate:true})` 内部即调用 `activate()`，不另写一份停用逻辑。
- **两个不变量下沉到数据库**，不只靠 service 守规矩：

```sql
CREATE UNIQUE INDEX idx_workflow_templates_issue_type_version
  ON workflow_templates(issue_type, version);
CREATE UNIQUE INDEX idx_workflow_templates_one_active
  ON workflow_templates(issue_type) WHERE status = 'active';
```

  第一条堵住并发建草稿时两次 `max(version)+1` 算出同一个版本号；第二条让"至多一个 active"对**所有**写入方成立，而不只是对记得调 `activate()` 的那些。`max+1` 与 INSERT 必须在同一事务内，冲突映射为用户级错误或重试，不得逃逸成 500。

  这两个索引与 `admin_audit_events` 同批落在 `schema-v10.ts`。既有种子数据只有一行 `wft_coding_default` v1 active，不会与新索引冲突。
- `activate()` 允许作用于任意版本（含旧版本），但必须提示"这会使新建 Issue 改用版本 N"——因为激活旧版本时 `getDefault()` 仍按 `ORDER BY version DESC` 取，若还有更高版本的 active 行结果会与用户预期不符；`activate()` 停用全部同类 active 行正是为了消除这个歧义。
- 并发与重复激活都要有测试：两次 `activate()` 不同版本、`activate()` 与 `insertVersion({activate:true})` 交错，断言任一时刻同 `issue_type` 至多一个 active 行。

## 5. Q3（已关闭）：health 采集哪五类状态

全部来自既有仓储的只读查询，**不新增表、不触发 probe、不取锁**（FR-006）：

| 类别 | 数据来源 | 用于回答 |
|---|---|---|
| schema 版本 | `SELECT MAX(version) FROM schema_version`（`migrations.ts:18` 同一查询） | 数据库迁移是否落到预期版本 |
| adapter 可用性 | `agent_configs` + `adapter_workspace_status`，经 `effectiveAdapterStatus()` | 哪个 adapter 现在不能用、上次检查是什么时候 |
| workspace 锁 | `workspaceRepo.listLockedWorkspaces()` | 锁被哪个 Run 持有、持有多久（`locked_at` 到现在） |
| Run 队列 | `runRepo.listQueuedByWorkspace()` + `listRunning()` | 队列多深、有没有 Run 在跑 |
| 后台任务 | `AdapterConfigService.pendingAvailabilityProbes` 与 `AdapterFailureReprobe.pending` 两个 Set 的 size | 有没有 probe 卡住 |

### 后台任务计数怎么拿到（初稿够不着，已修正）

两个 Set 都是 `private`（`adapter-config.ts:30`、`adapter-failure-reprobe.ts:13`），需要只读的 size 访问器。但仅给 `AdapterFailureReprobe` 加访问器**够不着**——它是 `RunDispatchService` 内部 `new` 出来的私有字段（`run-dispatch.ts:46` 声明、构造函数体内约第 74 行实例化），没有任何外部持有者，`RuntimeHealthService` 拿不到那个实例。

因此按 **service 级只读快照**暴露，而不是把 health 耦合到 Set 实例上：

- `AdapterConfigService.healthSnapshot(): { pendingProbeCount: number }`
- `RunDispatchService.healthSnapshot(): { pendingReprobeCount: number }`（内部转发给它私有的 `failureReprobe`）
- `RuntimeHealthService` 注入这两个 service，只读快照。

**不得暴露 Set 本身的可变引用**——它们参与 shutdown 的等待逻辑，交出可写引用等于开了一个能干扰关停流程的入口。

### 派生判断必须与实际恢复规则同源

**派生判断（而非原始数据）才是有用的部分**，但初稿的两条判据都与运行时的真实行为对不上：

**`stale_lock`**：初稿要求"持有超 30 分钟 **且** 持有者终态"，并说这正是启动清理处理的情况。核实后不是——`cleanupStaleLocks()` 对持有者缺失或已终态的锁是**立即释放，完全不看时长**（`stale-recovery.ts:95-114`）。按初稿实现，一个终态持有者占锁 2 分钟已经在堵队列，health 却报"无异常"。改为分级：

| 情形 | 判断 | 建议动作 |
|---|---|---|
| 持有者 Run 不存在 | `stale_lock_confirmed` | 重启即自动释放；或手动释放 |
| 持有者 Run 已终态 | `stale_lock_confirmed` | 同上 |
| 持有者 Run 仍 running 且持有时长 > `DEFAULT_EXECUTION_TIMEOUT_MS + LOCK_DIAGNOSTIC_GRACE_MS` | `stale_lock_suspected` | 检查该 Run 的 adapter 进程 |
| 持有者 Run 仍 running，但 `locked_at` 缺失/非法/晚于当前时间（算不出持有时长） | `lock_timestamp_invalid` | **不建议直接释放**——持有者仍在运行，释放会破坏 workspace 互斥；提示人工核查该 Run 与锁记录 |

阈值不能留给实现者自行决定，否则测试写不出确定的时间边界。取值与判据：

- **实际超时是 per-adapter 的**：`AgentRunner` 用的是 `adapter.capabilities.executionTimeoutMs ?? DEFAULT_EXECUTION_TIMEOUT_MS`（`agent-runner.ts:108`），不是固定的默认值。当前三个内置 adapter 都**显式**声明该字段并等于默认值（`claude-code-adapter.ts:38`、`codex-cli-adapter.ts:39`、`opencode-adapter.ts:45`），字段本身在类型上是必填的（`AgentAdapterCapabilities.executionTimeoutMs: number`，`types.ts:61`），`??` 分支目前是类型系统意义上够不到的防御，不影响下面的处置结论。直接拿 `DEFAULT` 当阈值并声称"与实际超时同源"是不成立的——未来一个长任务 adapter 会被提前误报，短超时 adapter 又会延迟告警。
- v0.2 的处置：**限制全部 v0.2 adapter 的 `executionTimeoutMs` 必须等于 `DEFAULT_EXECUTION_TIMEOUT_MS`**（当前三个内置 adapter 恰好如此），把这条写进 adapter contract 并加一条断言测试；health 因而可以安全使用该默认值。等真出现自定义超时的 adapter 时，改为在 Run 启动时持久化 `effective_execution_timeout_ms` 快照、health 读快照——那样还能顺带避免"运行中改配置导致同一个 Run 的诊断阈值漂移"。**不假装现在就同源。**
- 新增 `LOCK_DIAGNOSTIC_GRACE_MS = 60_000`：留出超时触发到清理落库之间的窗口，避免正常收尾被报成可疑。
- 比较用**严格大于**；时钟一律取服务端 `Date.now()`，与 `locked_at` 同源。
- **`locked_at` 异常时不能无条件归入 `stale_lock_confirmed`（初稿漏洞，已修正）**：`confirmed` 的语义是"与 `cleanupStaleLocks()` 的真实释放条件一致"——那个函数只看持有者是否缺失/终态，从不比较时长。若持有者**仍 running**，仅仅因为算不出持有时长就默认"安全释放"，会让 UI 建议用户手动释放一个正在跑的 Run，这本身就会破坏 workspace 互斥、与真实恢复规则相悖。因此拆开：持有者缺失/终态时，`locked_at` 是否异常不影响 `stale_lock_confirmed` 结论（这两行本就不看时长）；持有者仍 running 且 `locked_at` 异常时，归入独立诊断 `lock_timestamp_invalid`（见上表第四行），不给出释放类建议。
- 测试覆盖：阈值前 1 毫秒、恰等于阈值、超过阈值、`locked_at` 非法（持有者缺失/终态 → confirmed；持有者 running → `lock_timestamp_invalid`）四类以上。

一并返回持有者 run id、`locked_at` 与已持有时长。

**`queue_starved`**：初稿判据"有 queued、无 running、锁空闲"会把**故意不可执行**的队列误报成故障。F006 在 Issue `Blocked` 时**有意保留**排队中的图节点是其中一类。改为复用一个与队列 drain **共享的、无副作用的资格判定器**，分状态报告：

- `eligible_but_not_running`（真正的 drain 没被触发）
- `waiting_for_recovery`（等节点级恢复，F006 场景）
- `invalid_queued_run`（既不合格也无合法等待理由，真异常）

**只有至少一个 queued Run 当前合格且锁空闲时才标 `queue_starved`。**

### `eligible_but_not_running` 不是公开 code，是内部分类结果（初稿未定义两者关系，已修正）

上面三个分类是**内部纯函数**的返回值，但 §5b 的 `diagnostics[].code` 判别联合最初把 `eligible_but_not_running` 和 `queue_starved` 并列成两个同级的公开 code，没有说明二者到底是分类层与聚合层的关系、还是会同时出现在响应里。核实后二者不能同时公开：

- `waiting_for_recovery`、`invalid_queued_run` 这两类分类结果本身就是异常（是否成立与锁状态无关），**原样**作为公开诊断输出。
- `eligible_but_not_running` 不是异常本身，只是"这个 Run 现在有没有资格跑"的中间判断。health 服务层再结合锁状态聚合一次：**锁空闲**时，只要至少一个 Run 分类为 `eligible_but_not_running`，就产出**唯一**的公开诊断 `queue_starved`（不重复输出内部分类结果）；**锁被占用**时，`eligible_but_not_running` 只表示"正常排在前面 Run 后面"，不产出任何诊断。

因此 `eligible_but_not_running` 从 §5b 的公开 `diagnostics[].code` 判别联合中移除，只作为内部分类函数返回类型的一个 variant，不出现在对外 API 响应里。

### 该判定器目前不存在，必须从 `startNextQueuedRun()` 抽取（初稿"复用现成"的假设不成立，已修正）

上面三类判据的实现前提是"存在一个与 drain 共享的纯函数"，但核实后**这样的函数当前不存在**：全部判定逻辑内嵌在 `RunDispatchService.startNextQueuedRun()`（`run-dispatch.ts` 约 310-397 行，私有方法）内部，且与副作用（`cancelQueued`、`workspaceLockService.acquire`、`nodeRunRepo.compareAndSetStatus`、真实派发 `startAdapter`）交织在同一循环体里，没有任何可以脱离副作用单独调用的分类函数。因此 Phase 4 必须先把这段分类逻辑（Blocked/Done/角色状态门/round 匹配）从 `startNextQueuedRun()` 里**抽取成一个新的纯函数**，drain 与 health 共用同一份判定代码——而不是在 health 里重新写一份"看起来一样"的判断。两处判断各自实现、只靠人工保持同步，正是本项目已经反复踩过的失败模式（`RETROSPECTIVE.md` 循环4/循环6 记录的"只修对称结构的一半"）。

### `waiting_for_validation_due` 不是排队 Run 的分类，是完全独立的 Issue 级诊断（初稿数据流不成立，已修正）

初稿把 `waiting_for_validation_due` 也列进上面"排队 Run 分类"的判定结果里，但核实后这条**结构上不可能从那条路径产出**：验证者 Run 只在 due time 到达并被 `claimValidatorSlot()` 消费的**同一事务**内才创建为 `Queued`（`validator-slot-claimer.ts:207-225`），该事务同时把 `validation_dispatch_due_at` 清空。也就是说，等待 due time 期间，这个 workspace 里**根本没有对应的 queued Run 行**——不存在"一个排队中但因 due time 未到而不合格"的 Run 可供分类器判断。连带地，初稿"这是为了防止 naive `queue_starved` 误报"的动机也不成立：等待期间 queued 计数本来就是 0（或与本次等待无关的其它 Run），naive 检查根本不会因为这个场景而误报。

这条诊断真正的价值不是"修正误报"，而是主动回答 SC-003（"能定位卡住的直接原因"）——用户看到 Issue 停在 `Validating` 却没有任何 Run 在跑，需要一个信号告诉他"这是在等 grace period，不是故障"。数据源必须独立于队列判定器，直接查询 Issue 表：

```sql
SELECT * FROM issues WHERE status = 'Validating' AND validation_dispatch_due_at IS NOT NULL
```

复用调度器已有的 `idx_issues_validation_due`（`schema-v6.ts`），只读、无副作用，符合 FR-006。

**查出的行不能不加区分地都算"正常等待"（初稿漏洞，已修正）**：`ValidationDispatchScheduler` 只在 `validation_dispatch_due_at` 到期后才去 claim（`validation-dispatch-scheduler.ts`，默认 1 秒 tick），如果查询时刻这个字段仍在未来，属于正常等待；但如果它已经**早于当前时间却仍未被 claim**（对应的 Queued Validator Run 依然不存在），说明调度器可能已经停止 tick 或这个 Issue 被漏处理——这是真实异常，和"正在正常等待"是两种完全不同的用户认知，混在一个 code 里会让用户把故障当成"系统在正常工作，别急"。

对每一行，与服务端 `Date.now()` 比较（与其它 health 判断同一时钟来源），并留出覆盖调度器 tick 延迟的 grace 窗口（新增 `VALIDATION_DISPATCH_GRACE_MS = 5_000`，5 秒，明显大于默认 1 秒 tick 间隔，避免一个刚跨过 due time、还在等下一次 tick 的正常 Issue 被误报）：

- `validation_dispatch_due_at > now - VALIDATION_DISPATCH_GRACE_MS`（即尚未到期，或刚到期还在 grace 窗口内）：`waiting_for_validation_due`——正常等待，`detail` 附剩余毫秒数（未到期时为正）。
- `validation_dispatch_due_at <= now - VALIDATION_DISPATCH_GRACE_MS`（超过 grace 窗口仍未被 claim）：`validation_dispatch_overdue`——真实异常，`detail` 附 `overdue_ms = now - due_at`。

按 `issue.workspace_id` 归入对应 workspace 的诊断列表；两者都与 `queue_starved` 互斥，因为等待/逾期期间这个 workspace 都没有对应的 queued Run（那次判定压根不会因为这个场景而触发）。

`no_available_adapter`：该 Project 在该 workspace 下没有任何 Available adapter。

health 只诊断不修复（非目标），但每条派生判断附一句建议动作。

## 5b. Health API 契约

初稿的服务签名是 `collect(projectId)`、文字描述是 Project + workspace 作用域，路由却是无参的 `GET /api/health/runtime`——三者对不上，且拿不到租户归属。定为：

```
GET /api/projects/:projectId/health/runtime?workspace_id=<可选>
```

- `projectId` 走既有的归属校验；`workspace_id` 非法或跨 Project → `WORKSPACE_NOT_FOUND`（沿用 F005 已统一的语义）。
- 省略 `workspace_id` 时返回该 Project 全部 workspace 的聚合。

```ts
interface RuntimeHealthSnapshot {
  // 全局项
  schema: { actual_version: number; expected_version: number; status: "current" | "behind" | "ahead" };
  background: { pending_probe_count: number; pending_reprobe_count: number };
  // 按 workspace 分组——adapter 有效状态本身就是 workspace 级的
  workspaces: Array<{
    workspace_id: string;
    adapters: Array<{ id: string; name: string; effective_status: AdapterStatus; last_checked_at: string | null }>;
    lock: { locked_by_run_id: string | null; locked_at: string | null; held_ms: number | null };
    queue: { queued_count: number; running_run_id: string | null };
  }>;
  diagnostics: Array<{
    code: "stale_lock_confirmed" | "stale_lock_suspected" | "lock_timestamp_invalid" | "queue_starved"
        | "waiting_for_recovery" | "invalid_queued_run"
        | "waiting_for_validation_due" | "validation_dispatch_overdue"
        | "no_available_adapter" | "schema_version_mismatch";
    workspace_id: string | null; detail: string; suggested_action: string;
  }>;
}
```

两处形状是刻意的：

- **adapter 必须挂在 workspace 下**。`effectiveAdapterStatus()` 是 workspace 级的（schema v7 覆盖表），同一个 adapter 完全可能在 workspace A 可用、在 B 不可用。用一个扁平的 `{id, effective_status}` 表示不了两者，聚合视图会对可路由性说谎——而 workspace 级覆盖正是 F005 花了五轮检视才收敛的核心不变量，不能在 health 里被拍平。
- **schema 要给出期望值**。只回一个 `actual_version` 只是清点库存，回答不了"迁移有没有到位"；前端也不该去复制一份后端常量。`behind` 与 `ahead` 都要产出 `schema_version_mismatch` 诊断——前者是迁移没跑，后者通常是数据库被更新版本的程序打开过，都需要用户知道。

前端各态：`loading` / `healthy`（`diagnostics` 为空）/ `has_diagnostics` / `error`。

## 5c. 可编辑字段白名单：只有 `steps_json` 真正生效

`workflow_templates` 有 `collaboration_topology`、`validation_policy_id`、`steps_json`、`handoff_policy_json`、`evidence_requirements_json` 五个内容字段，但**运行时只消费 `steps_json`**（`validator-selector.ts:61-63` 的 `hasValidationStep()`）。其余四个全仓库没有任何运行时读取方：

- `issues.validation_policy_id` 来自 `IssueService.create()` 对 `validation_policies` 表的独立查询（`issue.ts:108`），不是从模板取的。
- `policy-gate.ts` 读的 `evidence_requirements_json` 是 `validation_policies` 表的同名列，与模板无关。
- `collaboration_topology` 由 F007 独立推荐，不读模板。
- `handoff_policy_json` 无任何读取方。

做一个能保存并启用这些字段的界面，等于让用户以为改了行为而实际什么都没变——这是静默的正确性失败，不是"UI 文案没写完"。v0.2 的处置：

| 字段 | v0.2 | UI |
|---|---|---|
| `steps_json` | **可编辑**，运行时生效 | 正常编辑 + 第 7 节的确认闸门 |
| `name` | 可编辑，仅展示用 | 正常编辑 |
| 其余四个内容字段 | **只读**，新版本原样继承 | 展示值 + 明确标注"v0.2 不影响运行时行为" |

- 新增版本的请求体只接受 `name` 与 `steps_json`；其余字段出现在请求里 → 400 `TEMPLATE_FIELD_NOT_EDITABLE`，而不是静默忽略。
- 把这些字段接进运行时是 v0.3 的活，不在本 feature 范围。

## 6. 模板详情的派生投影

`validation_enabled` **必须复用 `validator-selector.ts` 已导出的 `parseWorkflowSteps()` + `hasValidationStep()`**，不得在 admin service 里另写一遍 JSON 解析（FR-001）。理由：这两处一旦不同源，UI 会显示"验证已启用"而实际不跑，属于最坏的一类不一致。

`steps_json` 非法时 `parseWorkflowSteps()` 抛 `ValidatorSelectorError("invalid_steps_json")`；admin 详情接口捕获它并返回 `validation_enabled: null` + 明确的解析错误信息，而不是让整个详情请求失败——用户正需要看到详情才能修好这个 JSON。

### 非法 `steps_json` 的写入侧闸门（初稿缺失，已补）

初稿只定义了读侧的容错（`validation_enabled: null`），没有任何一处阻止**非法模板被启用**。而运行时解析器是抛异常的，一旦这种模板成为默认，新建的 Issue 会直接进入一个跑不起来的 workflow——读侧诊断拦不住这件事。

分开定义草稿与启用两档：

| 动作 | 对 `steps_json` 的要求 |
|---|---|
| 保存为 inactive 草稿 | 允许非法/NULL，但 UI 必须显著标记"该版本无法启用"，并给出解析错误 |
| `activate()` | **硬拒绝** NULL、非法 JSON、未知 step 版本或未知 role；错误码 `TEMPLATE_STEPS_INVALID` + 具体解析错误 |

- 允许存非法草稿，是因为用户往往要先存下来才能慢慢修；禁止启用，是因为启用即生效于所有新 Issue。
- **目标版本必须合法**，无条件要求。
- **"源"一律指当前 active 版本，不是继承来源**（见下）。当前 active 本身非法时（历史数据或手工改坏——恰恰是"可读的非法详情"要帮用户修的场景），不能一刀切拒绝，否则用户存得下正确的替代版本却永远启用不了，管理功能没有逃生口。改为：**保守要求 `acknowledge_validation_disabled: true`**（因为无法证明验证没被关掉），审计里把前值记为 `unknown`，允许启用这个修复版本。
- 测试矩阵：当前 active 非法 → 目标合法（可启用，需确认）、目标非法（拒绝）、目标为 NULL（拒绝）、未知 role（拒绝）、合法但无 validator 步骤（走第 7 节确认闸门而非拒绝）。

### `inheritanceSource` 与 `currentlyActive` 是两个东西

第 8 节允许从**任意** `:sourceId` 克隆新版本，包括一个旧的 inactive 版本。若破坏性判断也拿这个 `sourceId` 当"改动前的状态"，会开出一个绕过确认闸门的口子：

> 当前 active 是 v3（有 validator）。用户从无 validator 的 inactive v1 克隆出 v4 并激活。按 `v1 → v4` 比较，验证状态"没变化"，于是不要求 `acknowledge_validation_disabled`——而系统默认实际从"有验证"切成了"无验证"。

因此类型与实现都必须把两者分开：

- **`inheritanceSource`（`:sourceId`）**：只决定复制哪些字段、`issue_type` 取自哪一行。除此之外不参与任何判断。
- **`currentlyActive`**：在**激活事务内**读取的当前 active 行。所有破坏性判断、`acknowledge_validation_disabled` 要求、审计的"前值"一律以它为准。

激活事务内必须重新读取当前 active（而不是复用请求发起时的快照），否则两个并发激活会各自基于过期的前值做判断。测试必须包含"从 inactive 旧版本克隆，且它与当前 active 的验证状态不同"这一条。

### 严格校验器与宽松解析器是两件事

启用闸门要求"拒绝未知 schema 版本与未知 role"，但 `parseWorkflowSteps()` **做不到**：它完全忽略 `schema_version`、接受任意 role 字符串、并且**静默过滤掉畸形条目**（`validator-selector.ts:30-59`）。拿它当写入闸门，会把部分损坏的内容洗成看起来合法的内容。

因此分成两个：

- `parseWorkflowSteps()` / `hasValidationStep()`：**运行时解释路径**，保持宽松，保持 FR-001 要求的同源，一字不改。
- 新增 `validateStepsSchema(stepsJson)`：**仅用于启用前的写入闸门**，严格拒绝——不支持的 `schema_version`、未知 role、畸形/空 steps、重复 step id、非预期字段。启用时先过严格校验器，再由校验后的值派生展示用的解析结果。

两者职责不同：宽松读器保证老数据还能跑，严格写闸保证新数据不带病入库。

## 7. 破坏性改动的确认闸门

| 改动 | 闸门 |
|---|---|
| 启用移除了 validator 步骤的版本 | 请求必须带 `acknowledge_validation_disabled: true`，否则 400 并说明后果；确认值记入审计（FR-004，载体见下） |
| 停用最后一个 active 模板 | 直接拒绝（FR-005）。否则 `IssueService.create()` 会走到 `INTERNAL_ERROR "Default coding workflow template not found. Database may be corrupted."`——一个把用户操作误报成数据库损坏的错误 |
| 启用任意版本 | 提示影响范围，同事务停用同类全部 active 版本（第 4 节） |
| 启用 `steps_json` 非法的版本 | 直接拒绝（第 6 节） |

### 审计事件写在哪（初稿不可实现，已修正）

初稿写"确认值记入 ThreadEvent/审计"。这条按现有 schema **无法实现**：

- 模板管理是**全局**的——`workflow_templates` 表没有 `project_id`（`schema-v1.ts:27-41`），也没有 workspace 归属。
- 改模板发生在任何受影响的 Issue **存在之前**，那些 Issue 还没被创建。
- `thread_events.thread_id` 是 `NOT NULL REFERENCES threads(id)`（`schema-v1.ts:93`），没有合法的 thread 可写。把它塞进某个无关 Issue 的 thread 更糟：审计溯源被挂到了一个与该改动无关的实体上。

新增一张全局审计表（`schema-v10.ts`，版本号按实际落地顺序取，**不得追加进已应用版本**）：

```sql
CREATE TABLE admin_audit_events (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL,              -- template.activated | template.deactivated | template.version_created
  target_type TEXT NOT NULL,         -- workflow_template
  target_id TEXT NOT NULL,
  target_version INTEGER,
  actor_type TEXT NOT NULL,          -- v0.2 恒为 'local_user'
  actor_id TEXT,                     -- 无鉴权，恒为 NULL
  details_json TEXT NOT NULL,        -- 含 acknowledge_validation_disabled、validation_enabled 前后值
  created_at TEXT NOT NULL
);
```

**"谁"这一半必须诚实降级**：本应用没有鉴权，不存在可记录的用户身份，`actor_id` 恒为 NULL。因此本表实际回答的是"**什么时候、把哪个模板的哪个版本、做了什么、当时确认了什么**"，不回答"是哪个人"。FR-004 的措辞按此收窄——把单机应用的本地用户写成一个假的 actor id 只是自欺。真需要"谁"要等到引入鉴权，届时本表加列即可。

**审计写入与模板变更必须同一事务。** FR-004 把这条记录列为正确性要求而非尽力而为的可观测性：审计后写而失败，会留下一个"验证已被关掉但无人知道是什么时候关的"状态；审计先写而模板变更回滚，则会记下一次没发生过的改动。因此版本创建 / 启用 / 停用与其审计行同提交同回滚，并对审计插入做故障注入测试，断言两侧一起回滚。

同时修正第 2 节"无 schema 变更"的说法。

## 8. 模板管理 API 契约

初稿只写了"CRUD 子集"，不足以确定前端的冲突与错误各态。

| 路由 | 用途 | 主要错误 |
|---|---|---|
| `GET /api/workflow-templates?issue_type=coding` | 版本列表（含 `status`、`version`、`validation_enabled`） | — |
| `GET /api/workflow-templates/:id` | 详情（`validation_enabled` 可为 `null` + 解析错误） | 404 `TEMPLATE_NOT_FOUND` |
| `POST /api/workflow-templates/:sourceId/versions` | 基于**指定版本**新增版本，body 仅接受 `name` / `steps_json` + `activate`、`acknowledge_validation_disabled` | 404 `TEMPLATE_NOT_FOUND`、400 `TEMPLATE_STEPS_INVALID`（启用时）、400 `VALIDATION_DISABLE_NOT_ACKNOWLEDGED`、400 `TEMPLATE_FIELD_NOT_EDITABLE`、409 `TEMPLATE_VERSION_CONFLICT` |
| `POST /api/workflow-templates/:id/activate` | 启用任意版本 | 400 `TEMPLATE_STEPS_INVALID`、400 `VALIDATION_DISABLE_NOT_ACKNOWLEDGED`、404 |
| `POST /api/workflow-templates/:id/deactivate` | 停用 | 409 `LAST_ACTIVE_TEMPLATE` |

- 无 `PATCH` / `PUT`：内容字段不可原地修改（第 3 节）。
- **新增版本必须走嵌套路由，`:sourceId` 就是继承来源。** 第 5c 节说四个不可编辑字段"由新版本原样继承"，但一个全局的 `POST /api/workflow-templates` 既没有 `source_template_id` 也没有 `issue_type`——一旦版本历史里有多行，服务端根本不知道在改哪一行；退而用"当前默认版本"作来源，会让用户编辑旧版本时静默继承到无关的值。`issue_type` 与四个继承字段一律取自 `:sourceId` 那一行。
- `:sourceId` 不存在 → 404；其所属 `issue_type` 家族在并发中已变（例如版本号被别的请求抢占）→ 409 `TEMPLATE_VERSION_CONFLICT`。
- 全部写操作成功后写 `admin_audit_events`（第 7 节）。
- 前端各态：`loading` / `list` / `detail` / `invalid_steps`（详情可读但不可启用）/ `confirm_validation_disabled`（二次确认）/ `conflict`（409 后刷新列表）。

## 9. 开放项（不阻塞开发）

- Validation Policy 的编辑不在本 feature；当前只读展示模板与 policy 的关联。
- health 的指标历史与告警等待真实需要。
- 多 Project 场景下 health 的聚合视角，当前按 Project + workspace 维度返回即可。

> 全部 Q1-Q3 已关闭，可按 `tasks.md` 展开实现。
