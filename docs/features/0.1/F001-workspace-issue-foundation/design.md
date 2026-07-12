---
feature_ids: [F001]
related_features: []
topics: [project, workspace, issue, thread, sqlite, api, ui, v0.1.0]
doc_kind: design
created: 2026-07-12
updated: 2026-07-12
---

# F001：Workspace & Issue Foundation - 设计

> Status: draft | Owner: TBD | Spec: `spec.md`

## 1. 技术概要

F001 实现 PersonaHub 第一层持久化本地数据切片：

```text
Project
  -> default Workspace
  -> coding Issue
  -> primary Thread
  -> issue.created ThreadEvent
```

Backend 负责 filesystem 校验、git metadata 检测、SQLite 写入和关系不变量。Frontend 提供最小工作台流程：创建 Project、绑定 Workspace、创建 coding Issue、查看生成的 primary Thread。

所有 Project / Workspace / Issue / Thread 创建都通过 SQLite 之上的 Repository 接口完成。Issue 创建必须是事务性的：Issue、primary Thread、`Issue.primary_thread_id` 和初始 `issue.created` ThreadEvent 要么全部持久化成功，要么全部回滚。

## 2. 影响面

- **前端**：Project switcher/list、Project 创建 UI、Workspace 绑定 UI、Issue 创建 UI、primary Thread 空态/详情视图、Settings 或 Project Inspector 中的关系展示。
- **后端 / API**：Project CRUD、Workspace 绑定/读取、Issue CRUD、Thread 读取、ThreadEvent 读取。
- **存储 / migrations**：Project、Workspace、Issue、Thread、ThreadEvent 初始 SQLite schema，以及最小 WorkflowTemplate / ValidationPolicy seed data。
- **Runtime / agent adapters**：不实现 agent runtime 行为。只存储 F002 需要的字段，例如 `Workspace.lock_state`。
- **事件 / evidence**：只写入 `issue.created`；本 feature 不要求 evidence refs。
- **文档 / 配置**：只更新 feature docs。如果最终 schema 与当前系统设计草案不同，需要回写全局 system design。

## 3. 数据模型 / Migration

### Tables

具体表命名在实现阶段确定，但持久化概念必须映射到以下实体。

### ID 与排序策略

P0 统一使用带实体前缀的 ULID string 作为公开 ID，例如 `prj_...`、`wsp_...`、`iss_...`、`thr_...`、`evt_...`。前缀用于调试和 API 可读性，ULID 部分用于稳定排序和外部引用。

实现约定：

- DB 可以额外使用内部 integer primary key，但所有 API、外键引用和事件 payload 中必须使用公开 string id。
- ThreadEvent 必须持久化 `event_sequence`，作为排序、cursor 和断线重读的稳定依据。
- ThreadEvent 公开 `id` 只作为身份标识，不作为唯一排序依据。
- `created_at` 只用于展示和粗粒度筛选，不作为确定性 cursor。

#### Project

- `id`
- `name`
- `description`
- `default_workspace_id`
- `default_coordinator_agent_id`
- `created_at`
- `updated_at`

约束：

- `name` 必填，trim 后不能为空。
- `default_workspace_id` 在 Workspace 绑定成功前可为空。
- `default_coordinator_agent_id` 可为空，F001 不实现相关行为。

#### Workspace

- `id`
- `project_id`
- `local_path`
- `git_branch`
- `lock_state`
- `locked_by_run_id`
- `created_at`
- `updated_at`

约束：

- `project_id` 引用 Project。
- `local_path` 必填。
- `lock_state` 默认是 `idle`。
- `locked_by_run_id` 可为空。
- F001 通过 `Project.default_workspace_id` 支持一个 Project 一个 default Workspace；不构建 multi-workspace UI。
- `local_path` 在保存前做 backend 规范化，至少去除首尾空白并转换为当前 OS 可比较的 absolute path。
- Workspace path 判重使用规范化比较 key；Windows 上比较 key 必须大小写不敏感，并统一 `/` / `\` 分隔符。
- 同一 Project 下相同规范化 `local_path` 应复用已有 Workspace 记录，不重复创建。

#### Issue

- `id`
- `project_id`
- `workspace_id`
- `primary_thread_id`
- `issue_type`
- `workflow_template_id`
- `validation_policy_id`
- `title`
- `goal`
- `status`
- `owner_agent_id`
- `coordinator_agent_id`
- `priority`
- `labels`
- `validation_round_count`
- `created_at`
- `updated_at`

约束：

- F001 UI 创建的所有 Issue 都是 `issue_type = coding`。
- F001 创建的新 Issue 默认是 `Inbox`；`Ready` 保留在模型中，但 F001 不开放。
- `validation_round_count` 默认是 `0`。
- `priority` 默认是 `normal`，P0 允许值为 `low` / `normal` / `high`。
- `owner_agent_id` 可为空，F001 不实现 Agent 配置。
- `coordinator_agent_id` 可为空，F001 不实现 coordinator 行为。
- `primary_thread_id` 在创建 primary Thread 的同一事务中设置。
- `labels` P0 使用 JSON text 存储 string array；创建时去除空字符串、trim、去重，并保持输入顺序。

#### Thread

- `id`
- `issue_id`
- `room_id`
- `thread_type`
- `title`
- `created_at`
- `updated_at`

约束：

- `issue_id` 引用 Issue。
- `room_id` 可为空，F001 不使用。
- F001 创建的 Thread 都是 `thread_type = primary`。
- 必须增加 DB 级 partial unique 约束（例如 `UNIQUE (issue_id) WHERE thread_type = 'primary'`），不能只靠应用层保证。primary Thread 是后续所有 Run 的入口，应用层校验无法防止并发请求或未来代码路径绕过检查而产生重复记录；这条约束成本很低，不应该只是"成本合理再加"。

#### ThreadEvent

- `id`
- `event_sequence`
- `thread_id`
- `type`
- `actor_type`
- `actor_id`
- `payload_json`
- `evidence_refs`
- `created_at`

约束：

- `thread_id` 引用 Thread。
- `event_sequence` 必须持久化且单调递增；P0 推荐全局递增，至少同一 Thread 内递增。
- F001 写入的事件类型是 `issue.created`。
- `payload_json` 包含 `issue_id`、`project_id`、`workspace_id`、`issue_type`、`status`。
- F001 中 `evidence_refs` 为空。

#### WorkflowTemplate / ValidationPolicy Seed

Seed 最小记录：

- Coding Workflow Template：`id = wft_coding_default`，`name = Coding Workflow`，`version = 1`，`status = active`。
- Coding Validation Policy：`id = vpl_coding_default`，`name = Coding Validation Policy`，`version = 1`，`status = active`。

这些记录只是 reference data。F001 不执行 workflow steps 或 validation。Migration 必须保证这两条 seed 记录存在；运行时缺失属于数据库不变量损坏，而不是普通用户输入错误。

### Migration 工具与执行方式

**决定**：不引入 Drizzle / Knex / Prisma 等迁移框架，采用版本化内联 SQL + `schema_version` 表的轻量模式。参考 clowder-ai（同为 Node/TS + `better-sqlite3` 技术栈）的真实实现：每个领域模块维护一份按版本号排列的 SQL 字符串（`SCHEMA_V1`、`SCHEMA_V2`...），一张 `schema_version(version INTEGER PRIMARY KEY, applied_at TEXT)` 表记录当前版本，启动时调用一个 `applyMigrations(db)` 函数，按 `if (currentVersion < N) { db.exec(SCHEMA_VN); INSERT INTO schema_version ... }` 逐级推进到最新版本。

约定：

- 迁移函数在 backend 进程启动时调用，不需要单独的 migration CLI；必须幂等，可以每次启动都安全执行。
- 新增列使用 `ALTER TABLE ... ADD COLUMN`，用 try/catch 容忍"列已存在"（应对迁移中途失败后重启的场景）。
- 不做 down-migration；SQLite + 个人本地场景不需要回滚到旧 schema。
- 迁移历史随时间会变成一串 `if (currentVersion < N)` 代码块，需要保持每个版本块小而独立，避免单文件失控增长。

不采用 Drizzle/Knex 的原因：这类工具主要价值在 schema diff 生成和跨数据库可移植性，但 P0 明确只用 SQLite，不需要跨数据库；引入框架依赖换来的收益，在这个规模下不如少一个依赖、直接复用已验证的同技术栈模式。

### 建表依赖顺序

按以下外键依赖顺序建表：

1. Project 表。
2. Workspace 表。
3. WorkflowTemplate / ValidationPolicy 表或 seed rows 所依赖的表，取决于最终 schema。
4. Issue 表。
5. Thread 表。
6. ThreadEvent 表，包含 `event_sequence`。

使用 SQLite driver 支持的 foreign keys，并启用 foreign key enforcement。

## 4. API / Contract 设计

F001 API 使用本地 backend HTTP contract。具体框架由实现阶段决定，但 request / response / error shape 应保持稳定，便于前端和集成测试对齐。

### Projects

#### `POST /api/projects`

创建 Project。

Request:

```json
{
  "name": "PersonaHub",
  "description": "Personal agent team OS"
}
```

Response `201`:

```json
{
  "project": {
    "id": "prj_...",
    "name": "PersonaHub",
    "description": "Personal agent team OS",
    "default_workspace_id": null,
    "default_coordinator_agent_id": null,
    "created_at": "2026-07-12T00:00:00.000Z",
    "updated_at": "2026-07-12T00:00:00.000Z"
  }
}
```

Errors:

- `400 PROJECT_NAME_REQUIRED`

#### `GET /api/projects`

列出 Projects。

Response `200`:

```json
{
  "projects": [
    {
      "id": "prj_...",
      "name": "PersonaHub",
      "description": "Personal agent team OS",
      "default_workspace_id": "wsp_...",
      "created_at": "2026-07-12T00:00:00.000Z",
      "updated_at": "2026-07-12T00:00:00.000Z"
    }
  ]
}
```

排序：按 `updated_at desc`，同值时按 `created_at desc`。

#### `GET /api/projects/:project_id`

读取 Project。

Response `200`:

```json
{
  "project": {
    "id": "prj_...",
    "name": "PersonaHub",
    "description": "Personal agent team OS",
    "default_workspace_id": "wsp_...",
    "default_coordinator_agent_id": null,
    "created_at": "2026-07-12T00:00:00.000Z",
    "updated_at": "2026-07-12T00:00:00.000Z",
    "default_workspace": {
      "id": "wsp_...",
      "local_path": "D:\\Projects\\personahub",
      "git_branch": "main",
      "lock_state": "idle"
    }
  }
}
```

未绑定 Workspace 时，`default_workspace` 必须为 `null`。

Errors:

- `404 PROJECT_NOT_FOUND`

### Workspace

#### `PUT /api/projects/:project_id/workspace`

绑定或替换 Project default Workspace。

Request:

```json
{
  "local_path": "D:\\Projects\\personahub"
}
```

Response `200`:

```json
{
  "workspace": {
    "id": "wsp_...",
    "project_id": "prj_...",
    "local_path": "D:\\Projects\\personahub",
    "git_branch": "main",
    "lock_state": "idle",
    "locked_by_run_id": null,
    "created_at": "2026-07-12T00:00:00.000Z",
    "updated_at": "2026-07-12T00:00:00.000Z"
  }
}
```

行为：

- backend 校验 path 存在且可读。
- backend 将 path 规范化为 absolute path 后持久化。
- backend best-effort 检测 git branch。
- 非 git 目录不报错，`git_branch` 返回 `null`。
- 如果同一 Project 已存在相同规范化 path 的 Workspace，复用该记录并刷新 `git_branch` / `updated_at`。
- 如果 path 不同，创建新的 Workspace 记录，并更新 `Project.default_workspace_id` 指向新 Workspace。
- 旧 Workspace 记录保留，已有 Issue 仍引用创建时的 Workspace；F001 UI 只展示当前 default Workspace。
- Windows 上 `D:\Projects\personahub` 与 `d:/projects/personahub` 这类等价路径应被判定为同一个 Workspace。

Errors:

- `400 WORKSPACE_PATH_REQUIRED`
- `400 WORKSPACE_PATH_NOT_FOUND`
- `400 WORKSPACE_PATH_NOT_READABLE`
- `404 PROJECT_NOT_FOUND`

#### `GET /api/projects/:project_id/workspace`

读取 Project default Workspace。

Response `200`:

```json
{
  "workspace": {
    "id": "wsp_...",
    "project_id": "prj_...",
    "local_path": "D:\\Projects\\personahub",
    "git_branch": "main",
    "lock_state": "idle",
    "locked_by_run_id": null
  }
}
```

未绑定 Workspace 时：

```json
{
  "workspace": null
}
```

#### `GET /api/workspaces/:workspace_id`

读取指定 Workspace。用于历史 Issue 引用的非 default Workspace 追溯；F001 UI 不需要提供多 Workspace 切换。

Response `200`:

```json
{
  "workspace": {
    "id": "wsp_...",
    "project_id": "prj_...",
    "local_path": "D:\\Projects\\personahub",
    "git_branch": "main",
    "lock_state": "idle",
    "locked_by_run_id": null,
    "created_at": "2026-07-12T00:00:00.000Z",
    "updated_at": "2026-07-12T00:00:00.000Z"
  }
}
```

Errors:

- `404 WORKSPACE_NOT_FOUND`

### Issues

#### `POST /api/projects/:project_id/issues`

创建 coding Issue。

Request:

```json
{
  "title": "Implement project creation",
  "goal": "Add the minimum Project CRUD flow.",
  "priority": "normal",
  "labels": ["v0.1.0", "foundation"]
}
```

Response `201`:

```json
{
  "issue": {
    "id": "iss_...",
    "project_id": "prj_...",
    "workspace_id": "wsp_...",
    "primary_thread_id": "thr_...",
    "issue_type": "coding",
    "workflow_template_id": "wft_coding_default",
    "validation_policy_id": "vpl_coding_default",
    "title": "Implement project creation",
    "goal": "Add the minimum Project CRUD flow.",
    "status": "Inbox",
    "owner_agent_id": null,
    "coordinator_agent_id": null,
    "priority": "normal",
    "labels": ["v0.1.0", "foundation"],
    "validation_round_count": 0,
    "created_at": "2026-07-12T00:00:00.000Z",
    "updated_at": "2026-07-12T00:00:00.000Z"
  },
  "primary_thread": {
    "id": "thr_...",
    "issue_id": "iss_...",
    "thread_type": "primary",
    "title": "Implement project creation"
  }
}
```

行为：

- `issue_type` 固定为 `coding`。
- `status` 固定为 `Inbox`。
- `priority` 省略时默认为 `normal`；如果提供，必须是 `low` / `normal` / `high`。
- 在同一事务中创建 Issue、primary Thread 和 `issue.created` ThreadEvent。

Errors:

- `400 ISSUE_TITLE_REQUIRED`
- `400 ISSUE_GOAL_REQUIRED`
- `400 ISSUE_PRIORITY_INVALID`
- `404 PROJECT_NOT_FOUND`
- `409 PROJECT_WORKSPACE_REQUIRED`

#### `GET /api/projects/:project_id/issues`

列出 Project Issues。

Response `200`:

```json
{
  "issues": [
    {
      "id": "iss_...",
      "project_id": "prj_...",
      "workspace_id": "wsp_...",
      "primary_thread_id": "thr_...",
      "issue_type": "coding",
      "title": "Implement project creation",
      "status": "Inbox",
      "priority": "normal",
      "labels": ["v0.1.0", "foundation"],
      "created_at": "2026-07-12T00:00:00.000Z",
      "updated_at": "2026-07-12T00:00:00.000Z"
    }
  ]
}
```

#### `GET /api/issues/:issue_id`

读取 Issue。

Response `200`:

```json
{
  "issue": {
    "id": "iss_...",
    "project_id": "prj_...",
    "workspace_id": "wsp_...",
    "primary_thread_id": "thr_...",
    "issue_type": "coding",
    "workflow_template_id": "wft_coding_default",
    "validation_policy_id": "vpl_coding_default",
    "title": "Implement project creation",
    "goal": "Add the minimum Project CRUD flow.",
    "status": "Inbox",
    "owner_agent_id": null,
    "coordinator_agent_id": null,
    "priority": "normal",
    "labels": ["v0.1.0", "foundation"],
    "validation_round_count": 0,
    "created_at": "2026-07-12T00:00:00.000Z",
    "updated_at": "2026-07-12T00:00:00.000Z"
  },
  "primary_thread": {
    "id": "thr_...",
    "thread_type": "primary",
    "title": "Implement project creation"
  }
}
```

Errors:

- `404 ISSUE_NOT_FOUND`

### Threads

#### `GET /api/threads/:thread_id`

读取 Thread。

Response `200`:

```json
{
  "thread": {
    "id": "thr_...",
    "issue_id": "iss_...",
    "room_id": null,
    "thread_type": "primary",
    "title": "Implement project creation",
    "created_at": "2026-07-12T00:00:00.000Z",
    "updated_at": "2026-07-12T00:00:00.000Z"
  }
}
```

Errors:

- `404 THREAD_NOT_FOUND`

#### `GET /api/threads/:thread_id/events`

列出 Thread events。

Query:

- `after_event_id` optional

Response `200`:

```json
{
  "events": [
    {
      "id": "evt_...",
      "event_sequence": 1,
      "thread_id": "thr_...",
      "type": "issue.created",
      "actor_type": "user",
      "actor_id": null,
      "payload_json": {
        "issue_id": "iss_...",
        "project_id": "prj_...",
        "workspace_id": "wsp_...",
        "issue_type": "coding",
        "status": "Inbox",
        "workflow_template_id": "wft_coding_default",
        "validation_policy_id": "vpl_coding_default",
        "primary_thread_id": "thr_..."
      },
      "evidence_refs": [],
      "created_at": "2026-07-12T00:00:00.000Z"
    }
  ]
}
```

排序：按 ThreadEvent 的 `event_sequence` 升序。`after_event_id` 需要先解析到对应 `event_sequence`，再返回 sequence 更大的事件。`created_at` 只用于展示，不作为唯一排序依据。

### 错误结构

所有接口使用统一结构化错误：

```json
{
  "error": {
    "code": "WORKSPACE_PATH_NOT_FOUND",
    "message": "Workspace path does not exist.",
    "field": "local_path",
    "details": {}
  }
}
```

UI 不应解析原始 exception message。

## 5. Runtime / Workflow 设计

### Project 创建

```text
validate input
create Project
return Project
```

### Workspace 绑定

```text
load Project
validate path exists and is readable
normalize path and build comparable path key
detect git branch best-effort
if comparable path key already exists for Project:
  update existing Workspace git_branch and updated_at
else:
  create Workspace with lock_state = idle
set Project.default_workspace_id
return Workspace
```

Path 校验和 git 检测应在 backend 完成，因为 backend 才是拥有本地 filesystem 访问权的进程。

### Issue 创建

```text
load Project and default Workspace
load default coding workflow template and validation policy
derive initial Issue status = Inbox
begin transaction
  create Issue
  create primary Thread
  update Issue.primary_thread_id
  create issue.created ThreadEvent
commit transaction
return Issue + Thread summary
```

任何步骤失败都回滚事务。系统绝不能留下没有 primary Thread 的 Issue。

### 初始状态

F001 采用保守 readiness：

```text
Inbox  F001 创建的新 Issue 默认状态
Ready  F001 不开放；后续 Agent 配置能力出现后再启用
```

由于 F001 不实现 agent 配置和 owner agent 选择，所有新建 Issue 都默认进入 `Inbox`，仍然附加 workflow/policy 引用。`Ready` 的进入条件由 F002 或后续 Agent 配置 feature 重新定义。

## 6. UI 设计说明

### 视觉基础（design tokens，决策 0004）

参考 multica `packages/ui/styles/tokens.css` 的结构（不逐字复制文件本身），中性灰阶和 token 命名沿用其体系，品牌色相换成 PersonaHub 自己的颜色（青蓝色相，h≈195，区别于 multica 的蓝色 h=255），保持同一套"大量留白、极简边框、低饱和度"的简约效果，同时形成独立视觉身份：

```css
:root {
  --background: oklch(1 0 0);
  --foreground: oklch(0.141 0.005 285.823);
  --card: oklch(1 0 0);
  --popover: oklch(1 0 0);
  --primary: oklch(0.21 0.006 285.885);
  --primary-foreground: oklch(0.985 0 0);
  --secondary: oklch(0.967 0.001 286.375);
  --muted: oklch(0.967 0.001 286.375);
  --muted-foreground: oklch(0.552 0.016 285.938);
  --accent: oklch(0.967 0.001 286.375);
  --destructive: oklch(0.577 0.245 27.325);
  --success: oklch(0.55 0.16 145);
  --warning: oklch(0.75 0.16 85);
  --border: oklch(0.92 0.004 286.32);
  --input: oklch(0.92 0.004 286.32);
  --ring: oklch(0.705 0.015 286.067);
  --brand: oklch(0.55 0.16 195);       /* PersonaHub 品牌色相：青蓝，区别于 multica 的蓝色 (h=255) */
  --chart-1: oklch(0.55 0.16 195);
  --chart-2: oklch(0.66 0.13 195);
  --chart-3: oklch(0.76 0.10 195);
  --chart-4: oklch(0.85 0.06 195);
  --chart-5: oklch(0.92 0.03 195);
  --radius: 0.625rem;                  /* --radius-sm/md/lg/xl/2xl 由此推导 */
}

.dark {
  --background: oklch(0.18 0.005 285.823);
  --foreground: oklch(0.985 0 0);
  --card: oklch(0.21 0.006 285.885);
  --border: oklch(1 0 0 / 10%);
  --brand: oklch(0.65 0.16 195);
  /* 其余同名变量按 multica 暗色模式的明度曲线镜像调整 */
}
```

约定：

- Tailwind v4 CSS-first 配置（不用单独 `tailwind.config.js`），token 通过 `@theme inline` 映射成 Tailwind 的 `color-*`/`radius-*` 工具类。
- 交互原语用 shadcn/ui CLI 生成的组件代码，底层基于 Radix（不用 Base UI，也不手写封装），配 `class-variance-authority` + `clsx` + `tailwind-merge` 写变体样式；组件代码生成到当前项目 `src/components/ui/`，不建独立的 `@personahub/ui` 包（理由见决策 0004）。
- 图标统一用 `lucide-react`。
- 主题切换（light/dark）用 `data-theme` 属性 + 上述 CSS variable，不引入 Next.js 专用的 `next-themes`。
- F001 范围内只需要 Project/Workspace/Issue/Thread 相关的基础组件（button、input、card、empty state、toast/inline error），不需要 F001 阶段就把所有可能用到的组件都建好。

### 前端目录结构：业务逻辑与 UI 组件分离

这是决策 0004 里为未来多端（尤其是桌面/移动）预留的低成本约定，F001 是第一个落地的 feature，之后所有前端 feature 都要遵守：

```text
src/
  components/       UI 组件（含 components/ui/ 下 shadcn/ui 生成的基础组件）
  lib/               API client（对本地 backend HTTP API 的封装，不含 React 依赖）
  hooks/             数据获取/状态逻辑（例如 useProjects、useIssue，内部调用 lib/ 的 API client）
  types/             领域类型（Project、Workspace、Issue、Thread、ThreadEvent 等，和 system-design.md 的实体对应）
```

规则：

- 组件文件（`components/`）不直接写 `fetch`/API 调用；数据获取通过 `hooks/` 提供的 hook 完成。
- `lib/` 和 `types/` 不 import 任何 React 组件，保持可以独立于 UI 层被复用或提取。
- F001 只需要按这个结构把 Project/Workspace/Issue 相关的 API client、hooks、类型放对位置，不需要现在就搭建完整的多端抽象。

### 最小 UI Surface

- 左侧导航中的 Project list / switcher。
- Create Project action。
- Settings 或 Project Inspector 中的 Workspace binding control。
- Coding Issue creation action。
- Issue 创建后的 primary Thread view。
- Project Inspector 或 Settings 中的 Project -> Workspace 关系展示。

### UI 状态

- 空态：没有 Project 时，引导创建 Project。
- Project 存在但没有 Workspace：提示先绑定 Workspace，再创建可执行 Issue。
- Workspace binding loading state。
- Workspace binding error state。
- Issue creation error state。
- Primary Thread 空态，展示或表示 `issue.created` trace/event。

### 明确不展示

- F001 不展示可选择的非 coding Issue Types。
- F001 不展示 agent execution controls。
- F001 不展示 Room UI。

## 7. Event / Trace 设计

### `issue.created`

Issue 创建成功时写入。

必需 payload：

```json
{
  "issue_id": "...",
  "project_id": "...",
  "workspace_id": "...",
  "issue_type": "coding",
  "status": "Inbox"
}
```

可选 payload 字段：

```json
{
  "workflow_template_id": "...",
  "validation_policy_id": "...",
  "primary_thread_id": "..."
}
```

Actor：

- `actor_type`：F001 本地单用户模式固定为 `user`。
- `actor_id`：P0 固定为 `null`，直到引入真实用户身份。

排序：

- ThreadEvents 按持久化 `event_sequence` 排序返回。
- 不要只依赖 `created_at` 做确定性排序。

## 8. 失败处理

- **校验错误**：Project name 为空、Issue title 为空、Workspace path 缺失、path 不可读时返回结构化错误。
- **权限 / escalation 失败**：F001 不实现 escalation flow；不可读 Workspace path 视为校验错误。
- **持久化失败**：回滚多记录操作，并返回结构化 server error。默认 workflow/policy seed 缺失属于 migration 或数据库不变量损坏，返回内部错误并记录诊断信息。
- **进程 / runtime 失败**：Git 检测失败不应导致 Workspace 绑定失败，除非 path 校验本身失败。
- **恢复行为**：重启后从 SQLite 读取持久化记录。F001 不需要 active run recovery。

## 9. 测试策略

### 单元测试

- Project 校验。
- Workspace path validation wrapper。
- Workspace path normalize / comparable key wrapper，覆盖 Windows 大小写不敏感比较。
- Git branch detection wrapper，覆盖成功、非 git、失败场景。
- Issue initial status derivation。
- Issue priority validation。
- `issue.created` payload builder。

### 集成测试

- SQLite migration 能顺利应用。
- Migration 后默认 coding workflow/policy seed 记录存在。
- 创建 Project 能持久化记录。
- 绑定 Workspace 会更新 Project default Workspace。
- 重复绑定等价 Workspace path 会复用已有 Workspace。
- 替换 Project default Workspace 不会改变已有 Issue 的 `workspace_id`，历史 Workspace 可通过 id 读取。
- 创建 Issue 的事务会创建 Issue、Thread、ThreadEvent。
- 失败的 Issue transaction 不会留下没有 Thread 的部分 Issue。
- 重启 / 重新打开 database 后可以读取所有关系。

### UI / E2E

- 创建 Project。
- 成功绑定 Workspace。
- 绑定无效 Workspace 并看到错误。
- 创建 coding Issue 并进入 primary Thread。
- 验证 Project / Workspace 关系可见。

### 手动验证

- 带盘符的 Windows path。
- 使用反斜杠的 Windows path。
- 大小写不同但等价的 Windows path。
- 非 git directory。
- 当前 branch 上的 git repository。

## 10. 设计决策

| 决策 | 理由 | 替代方案 |
| --- | --- | --- |
| Backend 负责 Workspace path 校验 | Frontend 在不同打包模式下无法可靠验证本地 filesystem 访问 | Frontend-only validation 更快，但不权威 |
| Issue + primary Thread + 初始 event 使用事务 | 后续 feature 必须信任每个 Issue 都有 primary Thread | 分开创建再修复，但会削弱不变量 |
| Git metadata 是 best effort | 非 git folder 是合法 Workspace，git 也可能不可用 | 强制要求 git，但与 PRD 的 Workspace 概念冲突 |
| F001 存储 lock 字段但不执行锁 | 锁行为属于 F002 Run dispatch | 现在实现锁，但会过早引入 Run lifecycle |
| 默认 coding workflow/policy 只是 seed reference | Issue 在 workflow execution 存在前也需要引用 | 推迟到 F002/F003，但会削弱 Issue 完整性 |
| F001 新 Issue 默认 `Inbox` | owner agent / Agent 配置尚未实现，`Ready` 在本 feature 中不可验证 | 临时 seed owner agent，但会污染 F001 范围 |
| 公开 ID 使用带前缀 ULID string | API 可读、可导出，并能支撑事件 cursor | 纯 SQLite integer id 简单但外部引用不友好 |
| ThreadEvent 使用 `event_sequence` 排序 | 避免依赖 ULID 同毫秒单调性，cursor 更稳定 | 仅按 ULID id 排序，但库行为差异会影响一致性 |
| Workspace 替换保留旧记录 | 已有 Issue 需要稳定引用创建时 Workspace | 原地更新 Workspace，但会改变历史 Issue 的执行上下文 |
| labels P0 使用 JSON text | F001 不需要复杂 label 查询，降低 schema 复杂度 | normalized label relation，但当前收益不足 |
| 默认 workflow/policy seed 由 migration 保证 | Issue 创建依赖默认引用，缺失属于数据库不变量损坏 | 运行时允许 seed 缺失并返回业务错误，但会增加无意义分支 |
| primary Thread 唯一性用 DB partial unique 约束，不只靠应用层 | 参考 clowder-ai/multica 源码对照分析：这类不变量应该在数据层强制，成本低、收益是防止后续 feature 因为并发或代码路径疏漏产生重复 primary Thread | 只在应用层校验，实现更简单但不能防止未来绕过 |
| Migration 采用版本化内联 SQL + `schema_version` 表，不引入 Drizzle/Knex | 参考 clowder-ai 同技术栈（Node/TS + better-sqlite3）真实实现，验证过可行；P0 只用 SQLite，不需要跨数据库能力 | 引入 Drizzle/Knex，多一个依赖但换来 schema diff/codegen 能力，当前规模收益不足 |

## 11. 待确认设计问题

目前没有待确认的设计问题。此前列出的两项已解决：SQLite migration 工具选型见第 3 节"Migration 工具与执行方式"；Issue 默认状态见第 10 节设计决策"F001 新 Issue 默认 `Inbox`"。
