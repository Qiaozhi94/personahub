---
topics: [frontend, v344, migration, inventory]
doc_kind: feature-contract
created: 2026-09-09
updated: 2026-09-09
---

# F009 生产前端迁移矩阵

## 0. 状态与用途

- **status**: frozen-for-development
- inventory_baseline: `main@53c3c55`
- **design_baseline**: V3.44
- **source_scope**: `web/src/App.tsx` 可达的生产入口、其直接组件与 `web/src/lib/api-client.ts`

本矩阵是 F009 进入编码前的冻结设计输入，不是编码结束后的盘点产物。它覆盖 v0.1–v0.2
生产页面、入口、动作、API 与代表性回归测试，并分别给出冻结的
`target_disposition`（`migrated / deferred / retired`）、当前 `implementation_status` 及
`stable-shell / final-surface / transitional-host` 生命周期。实现中发现遗漏时，必须先更新本矩阵
和对应门禁，再继续迁移；不得用组件是否碰巧被复用来反推范围。

## 1. 字段与完成规则

- `target_disposition` 是开发前冻结的目标处置：`migrated` 表示 F009 生产路径继续提供；
  `deferred` 表示 F009 不暴露入口且必须写明接管 Feature；`retired` 表示产品裁决不再提供写面，
  旧事实需要时只读保留并写明替代路径。实现不得自行改变目标处置。
- `implementation_status` 是当前实施进度，只能从 `inventoried` 推进到与
  `target_disposition` 同名的终态。编码开始前全部为 `inventoried`；不得用目标处置冒充完成状态。
- `completion_evidence` 在 `inventoried` 时固定为 `pending`。推进到 `migrated` 前必须同时记录
  `route=<生产入口>`、`data=<真实数据或 canonical API>`、`write=<唯一写入口或 read-only / client-only / none>`
  与 `browser=<浏览器证据>`；推进到 `deferred / retired` 前必须记录 `registry=absent` 及接管或产品
  裁决证据。证据没有齐备时不得推进状态。
- `stable-shell`：F009 长期拥有的壳层能力。
- `final-surface`：F009 已能直接落到最终工作面的既有能力，不需要过渡宿主。
- `transitional-host`：只为连续使用既有能力存在；`replacement_owner`、`delete_when`、
  `latest_milestone` 三项不得为空。删除以 owner 的验收成立为条件，不以日期或“以后清理”代替。

每行必须同时给出旧位置、用户可观察能力、既有 API、代表测试、目标处置、当前实施状态、完成
证据、生命周期、新入口和写入 owner。读操作在“canonical 写 API”列记 `read-only`；纯浏览器
本地动作记 `client-only`。

## 2. 页面与入口清单

| ID | 旧页面 / 组件 | 用户可观察能力 | 既有 API | 代表测试 | target_disposition | implementation_status | completion_evidence | 生命周期 | F009 唯一生产入口 | replacement_owner | delete_when | latest_milestone |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| P001 | `App.tsx` + `AppLayout` | 三栏 App Shell、当前对象选择、全局反馈 | projects / issues / workspace 聚合读取 | `web/src/app.test.tsx` | migrated | inventoried | pending | stable-shell | `ApplicationShell` | — | — | — |
| P002 | `ProjectSwitcher` + `CreateProjectDialog` | 项目列表、选择、创建 | `GET/POST /api/projects` | `web/src/f001-ui-flows.test.tsx` | migrated | inventoried | pending | transitional-host | `/projects` | F013 | F013 项目列表与 Space 归属旅程通过，原 Project ID 深链守恒 | M2 |
| P003 | `WorkspaceBinding` | 查看和绑定代码目录 | `GET/PUT /api/projects/:id/workspace` | `web/src/f001-ui-flows.test.tsx` | migrated | inventoried | pending | transitional-host | `/projects/:projectId` 的“代码目录（兼容）”区 | F013 | repository reference 与机器路径授权 API/UI 通过，旧 workspace 写入口移除 | M2 |
| P004 | `AdapterSettings` / `AdapterDialog` / `AdapterRow` | adapter 列表、配置、验证、默认项 | adapters / providers / default-adapter API | `web/src/f005-adapter-settings.test.tsx` | migrated | inventoried | pending | transitional-host | `/runtime/adapters` | F012 | execution identity 与 adapter 兼容迁移通过，所有配置动作改走 F012 contract | M3 |
| P005 | `IssueList` + `CreateIssueDialog` | 任务列表、选择、直接创建 | project issues API | `web/src/f001-ui-flows.test.tsx` | migrated | inventoried | pending | transitional-host | `/tasks`、`/tasks/:taskId` | F011 | TaskProjection 与任务创建/打开旅程通过，旧 Issue 组件不可达 | M4 |
| P006 | `IntakeDialog` | 推荐执行方案、确认后创建任务 | intake recommend / confirm API | `web/src/f007-intake-dialog.test.tsx` | migrated | inventoried | pending | transitional-host | `/tasks` 的“新建任务”动作 | F012 | Dispatch 确认与撤销窗口接管创建后派工，旧 intake 确认写入口移除 | M3 |
| P007 | `ThreadView` / `AgentSelector` / graph cards | 查看事件、发送指令、启动或恢复执行 | threads / runs / graph-runs API | `web/src/f005-composer-routing.test.tsx`、`web/src/f006-graph-run-card.test.tsx` | migrated | inventoried | pending | transitional-host | `/tasks/:taskId` 的“执行与会话（兼容）”区 | F012 | Session / Dispatch / Intervention 旅程通过，旧 Thread/Run 写入口不可达 | M3 |
| P008 | `IssueInspector` + Evidence / Validation sections | 任务、Run、Graph、Trace、Evidence、validation 事实与控制 | issue / run / graph / trace / validation API | `web/src/f004-inspector-validation.test.tsx`、`web/src/f005-inspector-routing.test.tsx` | migrated | inventoried | pending | transitional-host | `/tasks/:taskId` 的兼容详情区 | F011 | 四视图与 AcceptanceService 旅程覆盖对应读写，旧 Inspector 不在 registry | M4 |
| P009 | `WorkflowTemplateAdminDialog` | 模板列表 / 详情及编辑、启停 | workflow-templates API | `web/src/f008-workflow-template-admin.test.tsx` | retired | inventoried | pending | transitional-host | `/settings/legacy-workflows` 仅列表 / 详情 | F013 | legacy Workflow 转 Skill revision 且 alias 可回放；只读入口由 Skill 详情替换 | M2 |
| P010 | `RuntimeHealthDialog` | adapter、锁、队列、后台任务与 schema 诊断 | runtime-health API | `web/src/f008-runtime-health.test.tsx` | migrated | inventoried | pending | transitional-host | `/runtime`（执行资源）与 `/settings/system-diagnostics`（schema） | F012 | F012 runtime projection 接管 adapter/锁/队列；系统诊断保留 schema 读数且无重复入口 | M3 |
| P011 | `App.tsx` disabled Settings 按钮 | 无可达页面 | none | `web/src/app.test.tsx` | retired | inventoried | pending | stable-shell | 不注册旧占位；只注册本矩阵列出的真实设置子页 | — | — | — |

## 3. 动作与事实清单

| ID | 旧位置 | 动作 / 事实 | 既有 API | 代表测试 | target_disposition | implementation_status | completion_evidence | 生命周期 | F009 唯一生产入口 | canonical 写 API | replacement_owner | delete_when | latest_milestone |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| A001 | `ProjectSwitcher` | 列出 / 选择项目 | `GET /api/projects` | `web/src/f001-ui-flows.test.tsx` | migrated | inventoried | pending | transitional-host | `/projects` | read-only | F013 | Space / Project 列表接管且原 ID 不变 | M2 |
| A002 | `CreateProjectDialog` | 创建项目 | `POST /api/projects` | `web/src/f001-ui-flows.test.tsx` | migrated | inventoried | pending | transitional-host | `/projects` | `POST /api/projects` | F013 | ProjectService 新 contract 接管 | M2 |
| A003 | `WorkspaceBinding` | 查看 / 绑定本地目录 | `GET/PUT /api/projects/:id/workspace` | `web/src/f001-ui-flows.test.tsx` | migrated | inventoried | pending | transitional-host | `/projects/:projectId` | `PUT /api/projects/:id/workspace` | F013 | repository / path authorization 接管 | M2 |
| A004 | `IssueList` | 按项目列出 / 选择任务 | `GET /api/projects/:id/issues` | `web/src/f001-ui-flows.test.tsx` | migrated | inventoried | pending | transitional-host | `/tasks` | read-only | F011 | TaskProjection 列表接管 | M4 |
| A005 | `CreateIssueDialog` | 直接创建 coding task | `POST /api/projects/:id/issues` | `web/src/f001-ui-flows.test.tsx` | migrated | inventoried | pending | transitional-host | `/tasks` | `POST /api/projects/:id/issues` | F011 | 新任务创建旅程接管并保留原目标 | M4 |
| A006 | `IntakeDialog` | 生成路由建议 | `POST /api/projects/:id/intake/recommend` | `web/src/f007-intake-dialog.test.tsx` | migrated | inventoried | pending | transitional-host | `/tasks` | `POST /api/projects/:id/intake/recommend` | F012 | Eligibility / Dispatch 预览接管 | M3 |
| A007 | `IntakeDialog` | 确认建议并创建任务 / Run | `POST /api/projects/:id/intake/confirm` | `web/src/f007-intake-dialog.test.tsx` | migrated | inventoried | pending | transitional-host | `/tasks` | `POST /api/projects/:id/intake/confirm` | F012 | Dispatch 确认事务接管且重复提交幂等 | M3 |
| A008 | `ThreadView` | 读取 Thread 与事件 | `GET /api/threads/:id`、`/events` | `web/src/f005-thread-run-card.test.tsx` | migrated | inventoried | pending | transitional-host | `/tasks/:taskId` | read-only | F012 | Session projection 接管且 Thread 不再外露 | M3 |
| A009 | `ThreadView` composer | 选择 adapter、发送指令 / consult | `POST /api/issues/:id/runs` | `web/src/f005-composer-routing.test.tsx` | migrated | inventoried | pending | transitional-host | `/tasks/:taskId` | `POST /api/issues/:id/runs` | F012 | DispatchService 成为唯一派工写入口 | M3 |
| A010 | `StartGraphDialog` | 路由预览与启动 Graph | `GET /api/projects/:id/adapters`、`POST /api/issues/:id/graph-runs` | `web/src/f006-graph-run-card.test.tsx` | migrated | inventoried | pending | transitional-host | `/tasks/:taskId` | `POST /api/issues/:id/graph-runs` | F012 | Dispatch / execution identity 接管 graph 启动 | M3 |
| A011 | `IssueInspector` | 取消 queued / running Run | `POST /api/runs/:id/cancel` | `web/src/f005-inspector-routing.test.tsx` | migrated | inventoried | pending | transitional-host | `/tasks/:taskId` | `POST /api/runs/:id/cancel` | F012 | Intervention API 接管 | M3 |
| A012 | graph cards / inspector | 查看 Graph、node、edge 与 attempts | `GET /api/issues/:id/graph` | `web/src/f006-graph-run-card.test.tsx` | migrated | inventoried | pending | transitional-host | `/tasks/:taskId` | read-only | F012 | Session / Dispatch projection 接管 | M3 |
| A013 | graph cards / inspector | 取消 Graph | `POST /api/graph-runs/:id/cancel` | `web/src/f006-graph-run-card.test.tsx` | migrated | inventoried | pending | transitional-host | `/tasks/:taskId` | `POST /api/graph-runs/:id/cancel` | F012 | Intervention API 接管 | M3 |
| A014 | graph cards / inspector | 重试失败节点 | `POST /api/graph-runs/:id/nodes/:key/retry` | `web/src/f006-graph-run-card.test.tsx` | migrated | inventoried | pending | transitional-host | `/tasks/:taskId` | `POST /api/graph-runs/:id/nodes/:key/retry` | F012 | Intervention API 接管 | M3 |
| A015 | `GraphRunCard` | 为阻塞节点重新选择 executor | `POST /api/graph-runs/:id/resolve-executors` | `web/src/f006-graph-run-card.test.tsx` | migrated | inventoried | pending | transitional-host | `/tasks/:taskId` | `POST /api/graph-runs/:id/resolve-executors` | F012 | Eligibility / Intervention 接管 | M3 |
| A016 | `IssueInspector` | 查看任务、Run 状态、路由身份和日志 | issues / runs / thread-events API | `web/src/f005-inspector-routing.test.tsx` | migrated | inventoried | pending | transitional-host | `/tasks/:taskId` | read-only | F011 | TaskProjection 概览 / 会话接管 | M4 |
| A017 | trace cards | 查看命令、验证、handoff、文件变化并分页 | trace / run-evidence API | `web/src/f003-file-change-pagination.test.tsx`、`web/src/f004-validation-card.test.tsx` | migrated | inventoried | pending | transitional-host | `/tasks/:taskId` | read-only | F011 | 会话旁轨迹与资源视图接管 | M4 |
| A018 | `EvidenceSection` | 查看完整度、测试、文件与验证证据 | `GET /api/issues/:id/trace` | `web/src/f004-inspector-validation.test.tsx` | migrated | inventoried | pending | transitional-host | `/tasks/:taskId` | read-only | F011 | 验收 / 资源视图接管 | M4 |
| A019 | `EvidenceSection` | 导出 trace Markdown | `GET /api/issues/:id/trace/export` | `web/src/f004-evidence-summary-export.test.tsx` | migrated | inventoried | pending | transitional-host | `/tasks/:taskId` | read-only | F011 | 资源 / 验收导出入口接管 | M4 |
| A020 | `ValidationInspectorSection` | 查看 validation rounds / findings / summary | validation / evidence-summary API | `web/src/f004-inspector-validation.test.tsx` | migrated | inventoried | pending | transitional-host | `/tasks/:taskId` | read-only | F011 | Acceptance projection 接管 | M4 |
| A021 | `GraceValidatorBanner` | 手动触发 validation | `POST /api/issues/:id/validation` | `web/src/f004-validation-hooks.test.tsx` | migrated | inventoried | pending | transitional-host | `/tasks/:taskId` | `POST /api/issues/:id/validation` | F011 | AcceptanceService / Dispatch 验证入口接管 | M4 |
| A022 | `UnblockDialog` | 提交 operator note 解除阻塞 | `POST /api/issues/:id/unblock` | `web/src/f004-unblock-dialog.test.tsx` | migrated | inventoried | pending | transitional-host | `/tasks/:taskId` | `POST /api/issues/:id/unblock` | F011 | 任务恢复动作接管并保留影响说明 | M4 |
| A023 | `ResetRoundsDialog` | 重置 validation rounds | `POST /api/issues/:id/validation-rounds/reset` | `web/src/f004-round-reset-dialog.test.tsx` | migrated | inventoried | pending | transitional-host | `/tasks/:taskId` | `POST /api/issues/:id/validation-rounds/reset` | F011 | 任务恢复动作接管并保留审计说明 | M4 |
| A024 | validation summary | 复制 / 下载现有摘要 | client-only | `web/src/f004-evidence-summary-export.test.tsx` | migrated | inventoried | pending | transitional-host | `/tasks/:taskId` | client-only | F011 | 验收视图摘要动作接管 | M4 |
| A025 | `AdapterSettings` | 列出 adapter / provider 与 workspace 状态 | adapters / providers API | `web/src/f005-adapter-hooks.test.tsx` | migrated | inventoried | pending | transitional-host | `/runtime/adapters` | read-only | F012 | Runtime projection 接管 | M3 |
| A026 | adapter dialogs / rows | 创建、更新、删除、验证 adapter | adapters API | `web/src/f005-adapter-settings.test.tsx` | migrated | inventoried | pending | transitional-host | `/runtime/adapters` | `POST/PATCH/DELETE /api/adapters*` | F012 | Adapter compatibility write contract 接管 | M3 |
| A027 | `AdapterRow` | 设置项目默认 adapter | `PUT /api/projects/:id/default-adapter` | `web/src/f005-adapter-settings.test.tsx` | migrated | inventoried | pending | transitional-host | `/runtime/adapters` | `PUT /api/projects/:id/default-adapter` | F012 | 项目默认 execution identity 接管 | M3 |
| A028 | `RuntimeHealthDialog` | 查看 / 刷新 adapter、锁、队列、后台与 schema 健康 | `GET /api/projects/:id/health/runtime` | `web/src/f008-runtime-health.test.tsx` | migrated | inventoried | pending | transitional-host | `/runtime`、`/settings/system-diagnostics` | read-only | F012 | 运行时读模型拆分完成且同一事实无重复解释 | M3 |
| A029 | Workflow Template dialog | 列表 / 详情 | `GET /api/workflow-templates*` | `web/src/f008-workflow-template-admin.test.tsx` | migrated | inventoried | pending | transitional-host | `/settings/legacy-workflows` | read-only | F013 | legacy Skill alias / payload 可回放 | M2 |
| A030 | Workflow Template editor | 新建版本、激活、停用 | `POST /api/workflow-templates/:id/{versions,activate,deactivate}` | `web/src/f008-workflow-template-admin.test.tsx` | retired | inventoried | pending | transitional-host | 无写入口；只读页解释“由 Skills revision 接管” | none（禁止调用旧写 API） | F013 | Skill revision create / activate / disable 验收，旧 API 仅供历史兼容且 UI 不可达 | M2 |
| A031 | disabled Settings | 打开空设置页 | none | `web/src/app.test.tsx` | retired | inventoried | pending | stable-shell | 无；不得注册死入口 | none | — | — | — |

## 4. 完整性与变更纪律

1. 页面表中的每个 migrated transitional-host 必须能在动作表中找到其全部写动作；只读宿主不可
   暗含写按钮。
2. `web/src/App.tsx` 新增生产可达组件、`api-client.ts` 新增写方法或既有测试新增用户动作时，
   `tools/check-v03-plan-contracts.test.mjs` 必须先因矩阵缺项失败，再补矩阵。
3. F009 实施只允许把 `implementation_status` 从 `inventoried` 推进到既定
   `target_disposition`，且必须在同一变更中补齐 `completion_evidence`；不得自行把目标
   `retired` 改回 `migrated`。产品裁决变化需先修改 `spec.md`。
4. F011 / F012 / F013 完成替换时按 `delete_when` 逐行核对；F014 只负责最终跨 Feature 扫描，
   不替代各 replacement owner 的删除责任。
