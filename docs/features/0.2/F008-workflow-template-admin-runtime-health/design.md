---
feature_ids: [F008]
related_features: [F004, F005, F007]
topics: [workflow-template, admin-ui, runtime-health, observability]
doc_kind: design
created: 2026-08-01
updated: 2026-08-01
---

# F008：Workflow Template Admin & Runtime Health - 设计

> Status: ready-for-development | Owner: TBD | Spec: `spec.md`

## 1. 技术概要

两块互相独立的能力放在同一个 feature，因为它们共享同一条主线：把系统已经拥有但用户看不到的状态呈现出来。

- **模板管理**：给 `WorkflowTemplateRepository` 补写方法，编辑一律走"新增版本"，既有行不可变。
- **Runtime health**：新增一个纯只读聚合服务，全部数据来自既有仓储查询，不新增表、不触发任何副作用。

## 2. 影响面

- **存储**：无 schema 变更（`workflow_templates` 表已具备 `version` / `status` 列）。
- **后端**：`WorkflowTemplateRepository` 补 `listByIssueType` / `insertVersion` / `setStatus`；新增 `WorkflowTemplateAdminService`、`RuntimeHealthService`。
- **API**：模板 CRUD 子集 + `GET /api/health/runtime`。
- **前端**：模板管理面板 + health 面板。
- **不影响**：`validator-selector.ts`、`IssueService.create()`、F004 validation 语义。

## 3. Q1（已关闭）：版本化而非原地修改

`workflow_templates` 已有 `version` 与 `status` 列，且 `issues.workflow_template_id` **没有外键约束**（`schema-v1.ts:63` 是裸 `TEXT NOT NULL`），进行中的 Issue 只是持有一个 id 字符串。这意味着：

- 原地修改一行，会**立刻改变所有引用该 id 的进行中 Issue 的行为**——包括 validation 是否启用。这是不可接受的。
- 版本化则天然安全：进行中 Issue 继续指向旧 id，新 Issue 用新 id。

因此 `insertVersion()` 插入新行（新 id、`version = max(version) + 1`），**从不 UPDATE 既有行的内容字段**。唯一允许的既有行写入是 `setStatus()` 改 `status`（active ↔ inactive），因为它不改变已引用该版本的 Issue 的执行语义（`getById()` 仍能取到）。

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
- `activate: true` → 在**同一事务内**把同 `issue_type` 的其他 active 版本置为 inactive，再插入新的 active 版本，避免出现两个 active 版本导致 `getDefault()` 的结果依赖版本号大小这一隐式规则。

UI 上"保存"与"启用"必须是两个动作，且启用时明确提示"此后新建的 Issue 将使用该版本"。

## 5. Q3（已关闭）：health 采集哪五类状态

全部来自既有仓储的只读查询，**不新增表、不触发 probe、不取锁**（FR-006）：

| 类别 | 数据来源 | 用于回答 |
|---|---|---|
| schema 版本 | `SELECT MAX(version) FROM schema_version`（`migrations.ts:16` 同一查询） | 数据库迁移是否落到预期版本 |
| adapter 可用性 | `agent_configs` + `adapter_workspace_status`，经 `effectiveAdapterStatus()` | 哪个 adapter 现在不能用、上次检查是什么时候 |
| workspace 锁 | `workspaceRepo.listLockedWorkspaces()` | 锁被哪个 Run 持有、持有多久（`locked_at` 到现在） |
| Run 队列 | `runRepo.listQueuedByWorkspace()` + `listRunning()` | 队列多深、有没有 Run 在跑 |
| 后台任务 | `AdapterConfigService.pendingAvailabilityProbes` 与 `AdapterFailureReprobe.pending` 两个 Set 的 size | 有没有 probe 卡住 |

这两个 Set 目前都是 `private`（`adapter-config.ts:29`、`adapter-failure-reprobe.ts:13`），需要各补一个只读的 size 访问器。**不得改为公开可变引用**——它们参与 shutdown 的等待逻辑，暴露可写引用会让 health 变成一个能干扰关停流程的入口。

**派生判断（而非原始数据）才是有用的部分**，因此响应中同时给出：

- `stale_lock_suspected`：锁持有时长超过 `DEFAULT_EXECUTION_TIMEOUT_MS`（30 分钟，`runtime/types.ts:124`）且持有者 Run 已是终态。这正是 `StaleRecoveryService.cleanupStaleLocks()` 在启动时清理的情况，health 让它在运行期间也可见。
- `queue_starved`：某 workspace 有 queued Run 但无 running Run 且锁空闲——说明 drain 没被触发。
- `no_available_adapter`：该 Project 在该 workspace 下没有任何 Available adapter。

health 只诊断不修复（非目标），但每条派生判断附一句建议动作。

## 6. 模板详情的派生投影

`validation_enabled` **必须复用 `validator-selector.ts` 已导出的 `parseWorkflowSteps()` + `hasValidationStep()`**，不得在 admin service 里另写一遍 JSON 解析（FR-001）。理由：这两处一旦不同源，UI 会显示"验证已启用"而实际不跑，属于最坏的一类不一致。

`steps_json` 非法时 `parseWorkflowSteps()` 抛 `ValidatorSelectorError("invalid_steps_json")`；admin 详情接口捕获它并返回 `validation_enabled: null` + 明确的解析错误信息，而不是让整个详情请求失败——用户正需要看到详情才能修好这个 JSON。

## 7. 破坏性改动的确认闸门

| 改动 | 闸门 |
|---|---|
| 新版本移除 validator 步骤 | 请求必须带 `acknowledge_validation_disabled: true`，否则 400 并说明后果；确认值记入 ThreadEvent/审计（FR-004） |
| 停用最后一个 active 模板 | 直接拒绝（FR-005）。否则 `IssueService.create()` 会走到 `INTERNAL_ERROR "Default coding workflow template not found. Database may be corrupted."`——一个把用户操作误报成数据库损坏的错误 |
| 启用新版本 | 提示"此后新建 Issue 将使用该版本"，同事务停用旧 active 版本 |

## 8. 开放项（不阻塞开发）

- Validation Policy 的编辑不在本 feature；当前只读展示模板与 policy 的关联。
- health 的指标历史与告警等待真实需要。
- 多 Project 场景下 health 的聚合视角，当前按 Project + workspace 维度返回即可。

> 全部 Q1-Q3 已关闭，可按 `tasks.md` 展开实现。
