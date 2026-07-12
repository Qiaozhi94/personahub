---
feature_ids: [F001]
related_features: []
topics: [project, workspace, issue, thread, sqlite, v0.1.0]
doc_kind: spec
created: 2026-07-12
updated: 2026-07-12
---

# F001：Workspace & Issue Foundation

> Status: spec | Owner: TBD | Target: v0.1.0

## 0. 规格元信息

- **PRD 来源**：`docs/personahub-prd.md` 第 4.1、5、7.1、7.2、8、9、12、15 节。
- **架构来源**：`docs/personahub-architecture.md` 中的“整体分层”“运行时与进程模型”“事件与 Trace 层”“存储层”“前端”小节。
- **系统设计来源**：`docs/personahub-system-design.md` 中的 Project、Workspace、Issue、Thread、ThreadEvent、WorkflowTemplate、ValidationPolicy。
- **上游决策**：`docs/decisions/0001-frontend-stack.md`、`docs/decisions/0003-backend-runtime.md`。
- **功能类型**：user-facing / backend / data-model。
- **规格模式**：full，因为本 feature 会创建后续 runtime feature 依赖的持久化地基。
- **变更类型**：ADDED。
- **一句话意图**：建立启动 agent run 之前必须具备的最小 Project / Workspace / Issue / Thread 基础。

## 1. 问题与目标

### 问题

PersonaHub v0.1 的目标是让用户通过 Issue-managed Thread 执行 coding workflow，但当前还没有持久化的 Project、Workspace、Issue、primary Thread 管理层。没有这层地基，后续 agent command dispatch、run events、handoff、validation、evidence summary 都没有可靠的位置挂载状态和 trace 历史。

### 目标

用户可以创建 Project，为 Project 绑定或替换一个 default 本地 Workspace，在该 Project 下创建 coding Issue，并立即得到一个带 `issue.created` 事件的 primary Thread。所有数据都持久化在本地 SQLite 中，并能在应用重启后恢复。

### 非目标

- 本 feature 不启动 agent，也不接入 Codex CLI；这些属于 F002。
- 本 feature 不实现 Run 记录、run events、command/test/file-change evidence、handoff packet 或 validation loop。
- 本 feature 不实现 workspace 写锁行为，只存储后续 feature 所需的锁相关字段。
- 本 feature 不实现 Room、Artifact、Memory、Skill、Coordinator Agent 行为，也不实现非 coding workflow 执行。
- 本 feature 不实现 board view。

## 2. 用户场景与独立测试

### US1：创建并切换 Project（Priority: P1）

作为用户，我希望创建并切换 Project，以便 PersonaHub 有一个用于归属 Issues、Threads、Agents 和未来 Evidence 的逻辑空间。

**为什么是这个优先级**：Project 是顶层管理对象。没有 Project，Workspace 和 Issue 的关系无法正确归属。

**独立测试**：创建两个 Project，切换它们，重启应用后确认两个 Project 仍然存在，并能显示当前选中的 Project。

**验收场景**：

1. Given 当前没有 Project，when 用户使用有效名称创建 Project，then 系统保存该 Project，并在 Project list 中展示。
2. Given 已存在多个 Project，when 用户切换到另一个 Project，then 应用展示的数据被限定在被选中的 Project 范围内。
3. Given Project 名称为空，when 用户尝试创建 Project，then 系统拒绝请求并返回清晰的校验错误。

### US2：绑定本地 Workspace（Priority: P1）

作为用户，我希望把本地 workspace path 绑定到 Project，以便后续 agent run 知道在哪里读取文件、运行命令和检查 git 状态。

**为什么是这个优先级**：Workspace 是后续所有 coding agent 行为的执行边界。

**独立测试**：把一个存在且可读的本地路径绑定到 Project，验证 Workspace 关系、git metadata、Project default workspace 引用都被存储，并能在重启后恢复。

**验收场景**：

1. Given Project 存在且本地路径存在并可读，when 用户把该路径绑定为 Project Workspace，then 系统保存 Workspace，并将其设为 Project default workspace。
2. Given 路径是 git repository，when Workspace 被绑定，then 系统记录当前 branch。
3. Given 路径不是 git repository，when Workspace 被绑定，then 系统仍然保存 Workspace，并将 git branch metadata 留空。
4. Given 路径不存在或不可读，when 用户尝试绑定，then 系统拒绝请求并返回清晰的校验错误。
5. Given Project 已有 default Workspace，when 用户绑定另一个有效路径，then 系统将新路径设为 default Workspace，并保留已有 Issue 对旧 Workspace 的引用。
6. Given 用户再次绑定同一个路径但大小写或分隔符不同，when 当前 OS 认为它们指向同一路径，then 系统复用已有 Workspace 记录，不重复创建。

### US3：创建带 primary Thread 的 coding Issue（Priority: P1）

作为用户，我希望在 Project 下创建 coding Issue，以便工作从一开始就通过 primary Thread 被追踪。

**为什么是这个优先级**：Issue + primary Thread 是 v0.1 coding workflow 的核心产品模型。

**独立测试**：在绑定了 Workspace 的 Project 下创建 coding Issue，验证 Issue、primary Thread 和 `issue.created` ThreadEvent 都被持久化，并且关系正确。

**验收场景**：

1. Given Project 已有 default Workspace，when 用户创建带 title 和 goal 的 coding Issue，then 系统在该 Project 和 Workspace 下创建 Issue。
2. Given Issue 创建成功，when 创建流程完成，then 系统创建且只创建一个 primary Thread，并将其 id 回填到 `Issue.primary_thread_id`。
3. Given Issue 创建成功且 primary Thread 已创建，when 系统写入初始 trace，then 系统向该 Thread 写入一条 `issue.created` 事件。
4. Given Issue 缺少必要执行信息，when Issue 被创建，then 系统将 Issue status 设为 `Inbox`。
5. Given F001 尚未实现 owner agent 配置，when Issue 被创建，then 系统将 Issue status 设为 `Inbox`；`Ready` 状态留到 F002 或后续 Agent 配置能力出现后再开放。

### US4：重启后恢复数据（Priority: P2）

作为用户，我希望 Project / Workspace / Issue / Thread 数据在应用重启后仍然存在，以便 PersonaHub 成为工作状态的持久化真相源。

**为什么是这个优先级**：持久化是 P0 可信度要求，但可以在基本创建流程跑通后验证。

**独立测试**：创建 Project、绑定 Workspace、创建 Issue，重启 backend/app 后确认所有关系和初始事件仍然可读。

**验收场景**：

1. Given 已存在持久化的 Project / Workspace / Issue / Thread 记录，when 应用重启，then 系统可以从本地 SQLite 加载这些记录。
2. Given Issue 拥有 primary Thread，when 应用重启，then Issue 仍然引用同一个 primary Thread。
3. Given Thread 拥有 `issue.created` 事件，when 应用重启，then 该事件仍然可以通过 Thread 查询。

## 3. 范围

### 范围内

- Project create / list / get / switch 支持。
- 为 Project 绑定本地 Workspace。
- 替换 Project default Workspace；历史 Issue 继续引用创建时的 Workspace。
- Workspace path 存在性和可读性校验。
- 尽力识别 git repository 和当前 branch。
- 在 Project 和 Workspace 下创建 coding Issue。
- 默认引用 Coding Workflow Template 和 Validation Policy。
- F001 创建的新 Issue 默认进入 `Inbox`；`Ready` 状态保留在模型中，但不作为 F001 可达状态验收。
- 为每个 Issue 自动创建 primary Thread。
- 写入初始 `issue.created` ThreadEvent。
- Project / Workspace / Issue / Thread / ThreadEvent 最小数据的本地 SQLite 持久化。
- 创建 Project、绑定 Workspace、创建 Issue、查看关系所需的最小 UI 路径。

### 范围外

- Agent adapter 配置和执行。
- Run lifecycle 和 run event stream。
- Workspace queueing 或真实写锁执行。
- Validation pass/fail loop。
- Evidence summary export。
- Room、Artifact、Memory、Skill、Coordinator Agent 行为。
- 多 Workspace UI、手动选择 active Workspace、一个 Issue 跨多个 Workspace 执行。
- Git commit / push 行为。

### 边界场景

- Workspace path 不存在。
- Workspace path 存在但不可读。
- Workspace path 可读但不是 git repository。
- 重复绑定同一个 Workspace path。
- 将 Project default Workspace 替换为另一个 path。
- Windows path 大小写或分隔符不同但指向同一路径。
- Git 命令或 git branch 检测失败。
- 创建 Issue 时 Project 没有 default Workspace。
- Issue 创建在 Thread 创建后发生部分失败。
- 同一个 Issue 被重复创建 primary Thread。
- 应用在数据创建后重启。

## 4. 需求

### 功能需求

### Requirement: Project 创建（`FR-001`）

系统应当允许用户创建带非空名称和可选描述的 Project。

#### Scenario: 有效 Project

- GIVEN 用户提供非空 Project 名称
- WHEN 用户创建 Project
- THEN Project 被持久化，并带有 `created_at` 和 `updated_at`

#### Scenario: 空 Project 名称

- GIVEN Project 名称为空
- WHEN 用户创建 Project
- THEN 系统拒绝请求并返回校验错误

### Requirement: Project 列表与切换（`FR-002`）

系统应当允许用户查看和切换已有 Project。

#### Scenario: 切换当前 Project

- GIVEN 已存在两个 Project
- WHEN 用户选择第二个 Project
- THEN 应用展示被选中 Project 范围内的数据

### Requirement: Workspace 绑定（`FR-003`）

系统应当允许一个 Project 在 v0.1 中绑定或替换一个默认本地 Workspace path。F001 只展示当前 default Workspace，但历史 Issue 应继续引用创建时的 Workspace。

#### Scenario: 绑定可读本地路径

- GIVEN Project 存在
- AND 本地路径存在且可读
- WHEN 用户将该路径绑定为 Project Workspace
- THEN Workspace 被持久化
- AND `Project.default_workspace_id` 引用该 Workspace

#### Scenario: 替换 default Workspace

- GIVEN Project 已绑定 default Workspace A
- WHEN 用户绑定另一个有效路径作为 Workspace B
- THEN 系统将 `Project.default_workspace_id` 更新为 Workspace B
- AND 已有 Issue 仍引用创建时的 Workspace A

#### Scenario: 复用相同 Workspace

- GIVEN Project 已绑定 Workspace A
- WHEN 用户再次绑定与 Workspace A 等价的规范化路径
- THEN 系统复用 Workspace A
- AND 不创建重复 Workspace

### Requirement: Workspace path 校验（`FR-004`）

如果 Workspace path 不存在或不可读，系统应当拒绝绑定请求并返回清晰校验错误。

#### Scenario: 无效路径

- GIVEN 用户提供不存在的路径
- WHEN 用户绑定 Workspace
- THEN 系统拒绝请求
- AND 不创建 Workspace

### Requirement: Git metadata 检测（`FR-005`）

绑定 Workspace 时，系统应当检测该路径是否是 git repository，并在可用时记录当前 branch。

#### Scenario: Git Workspace

- GIVEN 路径是 git repository
- WHEN Workspace 被绑定
- THEN `Workspace.git_branch` 存储当前 branch

#### Scenario: 非 Git Workspace

- GIVEN 路径不是 git repository
- WHEN Workspace 被绑定
- THEN Workspace 绑定仍然成功
- AND `Workspace.git_branch` 为空

### Requirement: Coding Issue 创建（`FR-006`）

系统应当允许用户在 Project 及其 default Workspace 下创建 coding Issue。

#### Scenario: Coding Issue

- GIVEN Project 已有 default Workspace
- WHEN 用户创建 `issue_type = coding` 的 Issue
- THEN Issue 被持久化，并带有 `project_id` 和 `workspace_id`

#### Scenario: 非法 priority

- GIVEN 用户提供不在 `low` / `normal` / `high` 范围内的 priority
- WHEN 用户创建 coding Issue
- THEN 系统拒绝请求并返回校验错误

### Requirement: 默认 Workflow 引用（`FR-007`）

创建 coding Issue 时，系统应当附加默认 Coding Workflow Template 和 Validation Policy 引用。

#### Scenario: 默认模板引用

- GIVEN 默认 coding workflow 和 validation policy 记录存在
- WHEN coding Issue 被创建
- THEN Issue 存储 `workflow_template_id`
- AND Issue 存储 `validation_policy_id`

### Requirement: Issue 初始状态（`FR-008`）

创建 Issue 时，系统应当将其初始状态设为 `Inbox`。`Ready` 是后续 Agent 配置或 owner agent 能力出现后的状态，不在 F001 中开放。

#### Scenario: F001 默认 Inbox

- GIVEN 用户在 F001 中创建 coding Issue
- WHEN Issue 被创建
- THEN status 为 `Inbox`

#### Scenario: Ready 暂不开放

- GIVEN F001 尚未实现 owner agent 配置
- WHEN Issue 被创建
- THEN status 不应为 `Ready`

### Requirement: Primary Thread 创建（`FR-009`）

创建 Issue 时，系统应当为该 Issue 创建且只创建一个 primary Thread。

#### Scenario: Primary Thread 已创建

- GIVEN Issue 创建请求成功
- WHEN Issue 被持久化
- THEN 创建一个 `thread_type = primary` 的 Thread
- AND `Issue.primary_thread_id` 引用该 Thread

### Requirement: 读取初始 Thread Events（`FR-010`）

系统应当允许读取本 feature 写入的 Thread events，并保持稳定创建顺序。

#### Scenario: 读取 Issue Created Event

- GIVEN Issue 拥有 primary Thread
- AND Thread 拥有 `issue.created` 事件
- WHEN client 读取 Thread events
- THEN 返回稳定顺序下的 `issue.created` 事件

### Requirement: 本地持久化（`FR-011`）

系统应当将 Project / Workspace / Issue / Thread / ThreadEvent 数据持久化在本地 SQLite 中。

#### Scenario: 重启恢复

- GIVEN 应用重启前已创建记录
- WHEN 应用重新启动
- THEN 系统可以从 SQLite 加载记录和关系

### 数据 / 实体需求

- **DR-001**：Project 应当存储 `id`、`name`、`description`、`default_workspace_id`、`default_coordinator_agent_id`、`created_at`、`updated_at`。
- **DR-002**：Workspace 应当存储 `id`、`project_id`、`local_path`、`git_branch`、`lock_state`、`locked_by_run_id`、`created_at`、`updated_at`。同一 Project 下等价规范化路径应复用同一 Workspace 记录；Windows 路径比较按大小写不敏感处理。
- **DR-003**：Issue 应当存储 `id`、`project_id`、`workspace_id`、`primary_thread_id`、`issue_type`、`workflow_template_id`、`validation_policy_id`、`title`、`goal`、`status`、`owner_agent_id`、`coordinator_agent_id`、`priority`、`labels`、`validation_round_count`、`created_at`、`updated_at`。`coordinator_agent_id` 可为空，F001 不实现 coordinator 行为。
- **DR-004**：Thread 应当存储 `id`、`issue_id`、可空 `room_id`、`thread_type`、`title`、`created_at`、`updated_at`。
- **DR-005**：ThreadEvent 应当存储 `id`、`event_sequence`、`thread_id`、`type`、`actor_type`、`actor_id`、`payload_json`、`evidence_refs`、`created_at`。
- **DR-006**：Issue 创建应当把 Issue、primary Thread 和 `issue.created` event 作为一个一致操作持久化；如果操作失败，不应留下没有 primary Thread 的部分 Issue。
- **DR-007**：v0.1.0 migration 应当保证最小默认 Coding Workflow Template 和 Validation Policy seed 记录存在，供 Issue 使用，但不实现 workflow execution。

### 事件 / Trace 需求

- **TR-001**：Issue 创建时，系统应当向 Issue primary Thread 写入一条 `issue.created` ThreadEvent。
- **TR-002**：`issue.created` event payload 至少包含 `issue_id`、`project_id`、`workspace_id`、`issue_type`、`status`。
- **TR-003**：本 feature 写入的 ThreadEvents 应当可以通过 `thread_id` 查询。
- **TR-004**：ThreadEvent 应当使用持久化 `event_sequence` 保持稳定顺序；公开 event id 只作为身份标识，不作为唯一排序依据。

### API / 接口需求

- **IR-001**：后端应当提供创建、列出、读取 Project 的接口。
- **IR-002**：后端应当提供绑定或读取 Project Workspace 的接口。
- **IR-003**：后端应当提供在 Project 下创建、列出、读取 Issues 的接口。
- **IR-004**：后端应当提供读取 Thread 及其 events 的接口。
- **IR-005**：非法请求应当返回结构化错误，UI 无需解析原始异常即可展示。
- **IR-006**：后端应当提供按 `workspace_id` 读取 Workspace 的接口，以便历史 Issue 引用的非 default Workspace 仍可追溯。

### UX 需求

- **UX-001**：UI 应当允许用户创建、查看和切换 Projects。
- **UX-002**：UI 应当允许用户为当前 Project 绑定本地 Workspace path。
- **UX-003**：Workspace 绑定失败时，UI 应当展示清晰错误。
- **UX-004**：UI 应当允许用户在当前 Project 下创建 coding Issue。
- **UX-005**：Issue 创建后，UI 应当导航到或展示 Issue primary Thread。
- **UX-006**：UI 应当在 Settings 或 Project Inspector 中展示 Project / Workspace 关系。
- **UX-007**：v0.1.0 中，UI 不应开放非 coding Issue Type 创建。

### 非功能需求

- **NFR-001**：本 feature 应当在本地运行，不依赖 cloud account。
- **NFR-002**：数据应当在 backend 或 app 重启后保留。
- **NFR-003**：Workspace path 处理应考虑 Windows 路径，包括盘符、反斜杠和大小写不敏感比较。
- **NFR-004**：非 git Workspace path 不应被视为错误。
- **NFR-005**：如果新增 dev server 默认端口，必须避开 PRD 中记录的本机保留端口。

## 5. 关键实体 / 概念

- **Project**：PersonaHub 工作的逻辑管理空间。它归属 Issues，并在 v0.1 中引用一个 default Workspace。
- **Workspace**：本地文件系统路径，未来 agents 会在这里读取文件和执行命令。F001 只负责绑定和记录。
- **Issue**：Project 下的工作对象。F001 UI 只开放 `coding` Issue 创建。
- **Thread**：Issue 的持久化协作记录。F001 为每个 Issue 创建且只创建一个 primary Thread。
- **ThreadEvent**：Thread 中持久化的 trace event。F001 写入 `issue.created`。
- **Coding Workflow Template / Validation Policy**：附加到 coding Issue 的默认引用。执行逻辑留给后续 feature。

## 6. 状态、工作流或生命周期

```text
Project missing -> Project exists       创建 Project
Project exists  -> Workspace bound      绑定可读本地路径
Workspace bound -> Workspace rebound    替换 Project default Workspace
Workspace bound -> Issue created        创建 coding Issue
Issue created   -> Primary Thread made  同一操作中自动创建
Issue created   -> Inbox                缺少执行所需信息
Issue created   -> Ready                F001 不开放；后续 Agent 配置能力出现后再启用
```

规则：

- F001 创建的新 Issue 默认进入 `Inbox`，不应进入 `Ready`、`Running`、`Validating`、`Done` 或 `Blocked`。
- 每个 Issue 在创建操作被视为成功前，必须已经拥有且只拥有一个 primary Thread。
- Issue 创建后引用当时的 Workspace；后续替换 Project default Workspace 不改变已有 Issue 的 `workspace_id`。
- Workspace `lock_state` 默认是 `idle`；真实锁行为从 F002 开始。

## 7. 成功标准

- **SC-001**：用户可以在 PersonaHub 内完成创建 Project、绑定可读本地 Workspace、创建 coding Issue，并看到该 Issue 的 primary Thread。
- **SC-002**：重启应用不会丢失 Project / Workspace / Issue / Thread / `issue.created` event 数据。
- **SC-003**：F001 创建的 coding Issue 拥有足够的持久化关系数据，供 F002 在其 Workspace 和 primary Thread 上启动 Run。

## 8. 验收清单

- [ ] **AC-001**（`FR-001`, `FR-002`, `UX-001`）：用户可以创建、查看和切换 Projects。
- [ ] **AC-002**（`FR-003`, `FR-004`, `UX-002`, `UX-003`）：用户可以绑定可读本地 Workspace path，无效路径会以清晰错误失败。
- [ ] **AC-003**（`FR-005`, `NFR-004`）：Git Workspace 绑定会记录当前 branch；非 git Workspace 绑定成功且 git branch 为空。
- [ ] **AC-004**（`FR-006`, `FR-007`, `UX-004`, `UX-007`）：用户只能创建 `coding` Issue，且每个 Issue 获得默认 workflow 和 validation policy 引用；非法 priority 被拒绝。
- [ ] **AC-005**（`FR-008`）：F001 创建的新 Issue 初始状态是 `Inbox`，不会是 `Ready`、`Running`、`Validating`、`Done` 或 `Blocked`。
- [ ] **AC-006**（`FR-009`, `DR-006`）：Issue 创建会创建且只创建一个 primary Thread，并回填 `Issue.primary_thread_id`。
- [ ] **AC-007**（`TR-001`, `TR-002`, `TR-003`, `TR-004`）：Issue 创建会写入可读的 `issue.created` ThreadEvent，且 payload 包含必需字段。
- [ ] **AC-008**（`FR-011`, `NFR-002`）：Project / Workspace / Issue / Thread / ThreadEvent 记录在应用重启后仍保留，且关系完整。
- [ ] **AC-009**（`UX-005`, `UX-006`）：Issue 创建后，用户可以查看 primary Thread，并检查 Project / Workspace 关系。
- [ ] **AC-010**（`FR-003`, `DR-002`, `IR-006`, `NFR-003`）：替换 default Workspace 后，Project 指向新 Workspace，已有 Issue 仍可追溯旧 Workspace；等价 Windows path 不重复创建 Workspace。

## 9. 测试计划

### 单元测试

- Project 名称规则校验。
- Workspace path 存在性 / 可读性处理。
- Workspace path 规范化和 Windows 大小写不敏感比较。
- Issue 初始状态默认进入 `Inbox`。
- Issue priority 枚举校验。
- `issue.created` payload 构造。

### 集成测试

- 创建 Project -> 绑定 Workspace -> 创建 Issue -> 验证 SQLite 中的 primary Thread 和 event。
- 分别绑定 git Workspace 和非 git Workspace。
- 替换 Project default Workspace 后，已有 Issue 仍引用旧 Workspace，Project 指向新 Workspace。
- 重复绑定等价 Workspace path 不重复创建 Workspace。
- migration 后默认 coding workflow / validation policy seed 记录存在。
- 重启或重建 repository/database connection 后验证持久化关系。
- 模拟 Issue 创建部分失败，确认不会留下没有 primary Thread 的 Issue。

### UI / 端到端测试

- 通过 UI 创建 Project。
- 通过 UI 绑定 Workspace，并看到校验错误。
- 通过 UI 替换 Project default Workspace，并确认 Project / Workspace 关系更新。
- 通过 UI 创建 coding Issue，并进入 primary Thread。
- 确认 Project / Workspace 关系显示在 Settings 或 Project Inspector。

### 手动验证

- 测试带盘符和反斜杠的 Windows 绝对路径。
- 测试 Windows path 大小写不同但指向同一路径。
- 测试非 git 目录。
- 测试处于普通 branch 的 git repository。

## 10. 依赖

### 上游依赖

- 无上游 feature 依赖。
- 依赖 PRD 中“P0 只开放可运行 coding workflow”的产品判断。
- 依赖前端和后端 runtime 决策。

### 下游依赖

- F002 Agent Command Center 依赖 Project / Workspace / Issue / Thread 模型和关系。
- v0.1.2 Development Trace 依赖 ThreadEvent 存储和排序。
- v0.1.3 Autonomous Validation 依赖 Issue status 和默认 Validation Policy 引用。

### 外部 / 环境依赖

- 本地文件系统访问。
- 可选 git executable 或等价 git metadata 检测能力。
- 本地 SQLite 数据库文件。

## 11. 风险与缓解

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| Windows 路径处理比预期复杂 | Workspace 绑定可能对有效路径失败 | 加入 Windows path 手动验证，并把校验放在有权访问本地文件系统的 backend 中 |
| Git 检测失败或 git 不可用 | Workspace 绑定可能变脆弱 | 将 git metadata 视为 best effort；非 git 或检测失败不阻塞绑定 |
| Issue 创建留下部分记录 | 后续 feature 无法信任 Issue / Thread 不变量 | 使用事务创建 Issue、Thread 和初始 ThreadEvent |
| 占位字段被误解为已实现行为 | 范围蔓延到 F002 / v0.2 | 明确 lock、coordinator、workflow execution 行为都在范围外 |
| 默认 workflow/policy seed 不清楚 | Issue 创建无法附加必要引用 | Migration 保证最小默认 coding workflow 和 validation policy seed 存在 |

## 12. 待确认问题

- **Q1**：F001 是否应该选择最终 SQLite migration 工具，还是只定义初始 schema？  
  **推荐**：F001 选择 migration 工具，因为这是第一个持久化 schema。选择结果记录到 `design.md`。

- **Q2**：Git metadata 检测应该 shell out 到 `git`，还是使用 library？  
  **推荐**：优先在可用时 shell out 到 `git`，并提供 graceful fallback。这样 F001 保持简单，避免在没有实现压力前引入依赖。

- **Q3**：F001 中是否允许 Issue 进入 `Ready`？  
  **结论**：不允许。F001 尚未实现 owner agent / Agent 配置，因此新 Issue 默认进入 `Inbox`；`Ready` 状态留到 F002 或后续 Agent 配置能力出现后再开放。

- **Q4**：ThreadEvent 是否需要独立 `event_sequence`？  
  **结论**：需要。公开 ID 使用带前缀 ULID，但 ThreadEvent 排序和 cursor 使用持久化 `event_sequence`，避免依赖同毫秒 ULID 单调性。

## 13. 可追踪性

| 规格项 | 来源 | 验证方式 |
| --- | --- | --- |
| `FR-001`, `FR-002` | PRD Project 概念、7.1 | `AC-001`，Project API/UI tests |
| `FR-003`, `FR-004`, `FR-005` | PRD Workspace 概念、7.1 | `AC-002`, `AC-003`, `AC-010`，Workspace integration tests |
| `FR-006`, `FR-007`, `FR-008` | PRD Issue 概念、7.2、9 | `AC-004`, `AC-005`，Issue integration tests |
| `FR-009`, `FR-010`, `TR-001` | PRD Thread 概念、Trace Events、7.2 | `AC-006`, `AC-007`，ThreadEvent tests |
| `FR-011`, `NFR-002` | PRD 12 MVP 验收 | `AC-008`，restart persistence tests |
| `UX-001` - `UX-007` | PRD 信息架构、7.1、7.2 | `AC-001`, `AC-002`, `AC-004`, `AC-009` |
| `DR-001` - `DR-007` | `system-design.md` 数据模型草案 | `AC-004`, `AC-006`, `AC-008`，migration / persistence tests |
| `TR-002` - `TR-004` | PRD Trace Events、架构事件层 | `AC-007`，ThreadEvent payload / event_sequence ordering tests |
| `IR-001` - `IR-006` | F001 API contract | `AC-001` - `AC-010`，API integration tests |
| `NFR-001` | PRD 本地优先验收 | local startup / no cloud account manual verification |
| `NFR-003` | PRD Windows 本机环境约束 | Windows path manual verification |
| `NFR-004` | PRD Workspace 规则 | `AC-003`，non-git workspace tests |
| `NFR-005` | PRD 非功能验收 | dev server config review |

## 14. 实现备注

- 具体 schema、API 名称、repository 边界和 UI component 结构写在 `design.md`。
- 实现时不要为了满足 F001 引入 Room 或 Run 行为。
- 默认 Coding Workflow Template 和 Validation Policy 在 F001 中只是 reference data。
- 默认 Coding Workflow Template 和 Validation Policy 由 migration seed 保证存在；运行时缺失属于数据库不变量损坏。

## 15. 参考

- `docs/personahub-prd.md`
- `docs/personahub-architecture.md`
- `docs/personahub-system-design.md`
- `docs/features/README.md`
