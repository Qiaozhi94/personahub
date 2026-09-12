---
kind: feature
id: F013
version: "0.3"
related_features: [F009, F010, F012, F014]
topics: [space, project, repository, skill, composition, capability]
doc_kind: design
created: 2026-08-09
updated: 2026-09-12
---

# F013：Space, Project & Skills Foundation - 设计

> Owner: unassigned | Spec: `spec.md` | Tasks: `tasks.md`

## 0. 输入与约束

- **行为契约**：本目录 `spec.md`。
- **产品与系统约束**：PRD §5.1、§5.2、§5.6、§6.2、§7.1、§7.5；`docs/personahub-system-design.md` §3。
- **上游决策**：ADR 0012（对象模型简化：取消 AI 成员 / primary Thread；Validation Policy 与 Workflow Template 收敛进 Skill；Skill 与编组统一）、ADR 0014（贡献点与单一激活路径）、ADR 0018（Skill / 插件 / MCP 三概念与三档信任，v0.3 只做 Skill revision、steps、项目 refs、来源与冲突）。
- **F009 交接**：`migration-matrix.md` 中 owner 为 F013 的 8 行——P002、P003、P009、A001、A002、A003、A029、A030，各自的 `delete_when` 是本 Feature 的验收条件，里程碑 M2。
- **实现约束**：不为兼容旧 UI 保留第二套可编辑 Workflow；`/projects/:projectId/:tab` 与「能力」槽位在 F009 为 not-registered，由本 Feature 首次注册；不读取 Dispatch，跨 Feature 快照集成只由 F012 验收。

## 1. 技术概要与影响面

新增 Space 归属根、repository reference + 机器路径授权、Skill revision 与 effective-requirements 契约；项目只持 refs。旧 Workspace / WorkflowTemplate / ValidationPolicy 进入一次性兼容迁移，不再有写入口。

- **前端**：注册 `/projects/:projectId/:tab`（文件 / Skills / 设置）与「能力」槽位的 Skills 列表 + 详情；首次设置 Space 流程；删除 F009 的 8 个 transitional-host。
- **后端 / API**：SpaceService、RepositoryRegistry、ProjectService、SkillRegistry、EffectiveRequirementsResolver；IssueService 创建签名改为要求 `space_id`、允许 `project_id` 为空。
- **存储 / Migration**：新增 `spaces`、`repositories`、`repository_machine_paths`、`project_repository_refs`、`skills`、`skill_revisions`、`project_skill_refs`、`skill_legacy_aliases`；**重建 `issues` 表**（唯一一处修改既有列，见 §3）。
- **Runtime**：派工前的路径授权复核点，由 F012 在组装上下文时调用本 Feature 的只读 contract。
- **Event / Evidence**：Space 创建 / 选择、路径授权变更、项目引用变更、Skill revision 激活 / 冲突写审计事件；无会话上下文的配置类事件按 §4 规则处理。
- **文档 / 配置**：`docs/personahub-system-design.md` §3 回写；`docs/features/0.3/README.md` 第 4 节不变量 11 由本 Feature 兑现。

## 2. 架构与模块边界

`SpaceService` 是 Space 创建 / 选择 / 归档的唯一写入口，并拥有默认 Space 的幂等升级。`RepositoryRegistry` 拥有仓库事实（真实路径、git remote、identity 探测），是路径授权的唯一裁决者；`ProjectService` 只保存引用与**进一步收紧**的范围，不能放宽 registry 的授权。`SkillRegistry` 是 Skill revision 创建、激活、禁用与冲突判定的唯一入口（ADR 0014「单一激活路径」）。`EffectiveRequirementsResolver` 只读，按 Skill revision ref 计算能力要求与完成要求。

`IssueService` 保持 Issue 写入口不变，仅调整入参契约：`space_id` 必填、`project_id` 可空。F013 不改 Issue 状态机。

依赖方向固定为：API → Service → Repository；`EffectiveRequirementsResolver` 与 `RepositoryRegistry.getAuthorization()` 是 F012 唯一可见的两个只读入口，**F013 不感知 Dispatch、不调用 F012**。Skill revision 的不可变 ID / version 契约由本 Feature 自持，不依赖 F010 Artifact 实现。

## 3. 数据模型与 Migration

### 新增表

`spaces`

- `id TEXT PRIMARY KEY`、`name TEXT NOT NULL`、`state TEXT NOT NULL CHECK (state IN ('active','archived'))`
- `is_default INTEGER NOT NULL DEFAULT 0`、`created_at`、`updated_at`
- `UNIQUE INDEX idx_spaces_default ON spaces(is_default) WHERE is_default = 1`：**部分唯一索引**保证默认 Space 至多一个，重复升级不可能创建第二个。

`repositories` — 仓库事实，跨项目共享同一份

- `id TEXT PRIMARY KEY`、`kind TEXT NOT NULL CHECK (kind IN ('local_dir','remote_url'))`
- `display_name TEXT NOT NULL`（自动识别得到，不要求用户手填，FR-004）
- `git_remote_url TEXT`、`git_identity TEXT`：只读探测结果，探测失败留空不阻断保存
- `created_at`、`updated_at`

`repository_machine_paths` — 每台机器一份真实路径授权

- `(repository_id, runtime_id)` 复合主键（`runtime_id` 见 ADR 0015；v0.3 只有一台执行机器，但不把它硬编码成全局唯一行）
- `raw_path TEXT NOT NULL`：用户输入原文，仅用于展示与诊断
- `real_path TEXT NOT NULL`：`realpathSync` 解析后的绝对路径，**授权判定只用这一列**
- `access TEXT NOT NULL CHECK (access IN ('read_write','read_only'))`
- `authorized_at TEXT NOT NULL`、`last_verified_at TEXT`

`project_repository_refs`

- `(project_id, repository_id)` 复合主键、`role TEXT NOT NULL CHECK (role IN ('primary','reference'))`
- `UNIQUE INDEX idx_project_primary_repo ON project_repository_refs(project_id) WHERE role = 'primary'`：主目录最多一个（spec 边界场景），由索引而非应用逻辑保证。
- `scope_json TEXT`：项目级文件范围，只能在机器授权之上收紧。

`skills` / `skill_revisions`

> **对规划期形状的一处变更（已裁决，DQ-001 关闭）**：v0.3 规划锁定的形状是 `spaces`、`space_skills`
> 两张表（Skill 与 Space 多对多）。**现改为 `spaces` 与 `skills.space_id` 的一对多归属**，
> `space_skills` 关联表不建。对应的门禁锁点短语已同步更新——这是显式契约变更，不是绕过门禁。
>
> **未来扩展为多对多的路径是叠加而非重构**：`skills.space_id` 表达的是**所有权**，届时新增一张
> `skill_visibility(skill_id, space_id, access)` 表达**可见范围**，`space_id` 语义自然从"归属"变为
> "所有者"，是纯追加 migration，不需要重建 `skills` 表。反方向（多对多退回一对多）才需要压数据删表。

- `skills`：`id TEXT PRIMARY KEY`、`space_id TEXT REFERENCES spaces(id)`（NULL 表示内置 / 全局）、`display_name TEXT NOT NULL`、`source TEXT NOT NULL CHECK (source IN ('builtin','user','legacy-workflow'))`、`current_revision INTEGER`、`state TEXT NOT NULL CHECK (state IN ('active','disabled','conflict'))`
- `skill_revisions`：`(skill_id, version)` 复合主键、`title`、`description`、`capability_tags_json`、`steps_json`（可空；非空即编组，FR-005）、`completion_requirements_json`、`created_at`；**发布后禁止 UPDATE 内容列**
- 同名冲突**不用唯一约束表达**——唯一约束会让第二个来源直接插入失败、无法进入可见的 `conflict` 状态。冲突由 `SkillRegistry` 在激活前检测并把**双方**置为 `conflict`（spec US-002 场景 1：两者都不生效），检测键为 `(space_id, lower(display_name))`。一对多归属使这个键唯一确定，`state` 因而能留在 `skills` 行上。

`project_skill_refs`：`(project_id, skill_id)` 主键 + `pinned_version INTEGER NULL`（NULL = 跟随 current）。只存引用，不复制内容（FR-007）。

`skill_legacy_aliases`：`legacy_id TEXT PRIMARY KEY`、`skill_id`、`version`、`raw_payload_json TEXT NOT NULL`。旧 `workflow_templates` / `validation_policies` 的原始行整体保存在 `raw_payload_json`，无法无损映射的字段不猜测语义（spec §7 决策）。

### 索引

```sql
CREATE INDEX idx_repo_machine_paths_real ON repository_machine_paths(real_path);
CREATE INDEX idx_project_repo_refs_repo  ON project_repository_refs(repository_id);
CREATE INDEX idx_skill_revisions_skill   ON skill_revisions(skill_id);
CREATE INDEX idx_issues_space            ON issues(space_id);
```

前两条支撑「这个真实路径是否已授权」与「删除仓库时的引用保护」，第三条支撑按 skill 取版本列表，第四条支撑 Space 内任务列表；四张表的主键最左前缀都不是这些查询键。

### 重建 `issues` 表（本 Feature 唯一一处修改既有列）

`issues` 当前有四个与最终模型冲突的 `NOT NULL` 列（`server/src/db/schema-v1.ts`）：`project_id`、`workspace_id`、`workflow_template_id`、`validation_policy_id`。FR-001 要求 `project_id` 可空，ADR 0012 要求后三者退出新 UI。**SQLite 无法 ALTER COLUMN 去掉 NOT NULL**，因此采用官方 12-step table rebuild：

1. 事务外 `PRAGMA foreign_keys=OFF`；
2. 事务内建 `issues_new`：新增 `space_id TEXT NOT NULL REFERENCES spaces(id)`；`project_id` 放宽为可空；`workspace_id` / `workflow_template_id` / `validation_policy_id` **保留但放宽为可空**；其余列与约束逐字保留；
3. `INSERT INTO issues_new SELECT …`，`space_id` 回填为默认 Space；
4. `DROP TABLE issues`、`ALTER TABLE issues_new RENAME TO issues`；
5. 重建全部索引与触发器；
6. `PRAGMA foreign_key_check` 必须零行；
7. 事务提交后 `PRAGMA foreign_keys=ON`。

**保留三列而不是删除**，因为 v0.1–v0.2 的历史 Run / Trace / Evidence 引用它们（`docs/features/0.3/README.md` 跨 Feature 不变量 8：迁移不得破坏历史 refs）。新建 Issue 一律不写这三列；旧行原值不动。

### 默认 Space 升级

升级器以稳定幂等键（`is_default = 1` 的部分唯一索引）创建唯一默认 Space，再回填历史 Project / Issue / Space 级 Skill；**不改变任何既有 ID**（FR-002）。重复执行因索引冲突而幂等。旧 `workflow_templates` 每行转为一条 `source='legacy-workflow'` 的 Skill revision，并在 `skill_legacy_aliases` 保留旧 ID 与原始 payload。

### Migration 版本号与 F010 的并行协调

`CURRENT_SCHEMA_VERSION` 当前为 11，F010 与 F013 并行且都要顺延。**两者都不预占版本号**：实施时读取仓库当前值 +1；先合入者取得该号，后合入者 rebase 后重新编号并改 migration 文件名。禁止在文档或 tasks 中写死 `v12`。Migration 除上述 `issues` 重建外只追加表 / 索引；仓库没有 down migration，不声明不可执行的「回滚前检查」。

## 4. 接口、Contract 与 Event

### API

- `POST /api/spaces`、`GET /api/spaces`、`POST /api/spaces/:id/select`、`POST /api/spaces/:id/archive`
- `POST /api/repositories:resolve`：输入本地路径或 URL，返回自动识别的 `kind`、`display_name`、`real_path`、`git_remote_url`、`git_identity` 与授权预判；**不落库**，供 UI 先看后存（FR-004 的"不要求手填名称"）。
- `POST /api/repositories`、`PUT /api/projects/:id/repositories`（整体设置 primary + references）
- `GET /api/skills`、`GET /api/skills/:id/revisions/:version`、`POST /api/skills/:id/revisions`、`POST /api/skills/:id/{activate,disable}`
- `PUT /api/projects/:id/default-skill`
- `GET /api/skills/:id/effective-requirements?version=<n>`：返回能力要求与完成要求的并集，**按 revision ref 确定**；version 走 query 而非 path segment，避免 `@` 在 path 中的编码歧义。

### 供 F012 消费的只读契约（跨 Feature 边界）

```
resolveEffectiveRequirements(skill_ref: "<skill_id>@<version>") -> {
  capability_tags: string[],          // 步骤 tags 与 Skill tags 的并集
  completion_requirements: Requirement[],
  source_revision: { skill_id, version },
}
getAuthorization(repository_id, runtime_id) -> { real_path, access } | null
```

两者都是纯读、无副作用，**遇到未知 ref 返回显式 not-found 而非抛异常**（与 `server/src/evidence-ref.ts` 的既有约定同源）。F012 负责把结果冻结进 Dispatch snapshot；F013 不感知 snapshot 是否存在。

### Event / Trace contract

事件类型：`space.created`、`space.selected`、`repository.authorized`、`project.refs_changed`、`skill.revision_activated`、`skill.conflict_detected`、`project.default_skill_changed`。

`thread_events.thread_id` 是 `NOT NULL REFERENCES threads(id)`（`schema-v1.ts`），而上述事件多数发生在**没有会话上下文**的配置界面。因此：配置类事件**不写 `thread_events`**，改写 `admin_audit_events`（该表已存在，v0.2 起用于管理动作审计）；只有由任务内动作触发的 Skill 引用变更才带 thread 上下文。**不得为配置事件编造 thread id。**

## 5. Runtime、Workflow 与并发

派工前的授权复核（NFR-002）取三者交集：机器路径授权 ∩ 项目范围 ∩ 任务范围，任一层缺失即不授权。范围只能逐层收紧，`ProjectService` 无法放宽 `RepositoryRegistry` 的 `access`；参考仓库的 `read_write` 请求**硬拒绝**而非降级。

Skill requirements 与步骤 requirements 取**并集**，只会加严，不存在"步骤放宽 Skill 要求"的路径。

Skill 版本更新与禁用不影响已创建的 Dispatch——因为 F012 冻结的是 revision ref，而 revision 内容不可变（AC-004）。禁用只改 `skills.state`，不改任何 revision 行，因此按旧 ref 解析的 effective requirements 输出逐字不变。

并发：Skill 激活与冲突检测在单一 DB 事务内完成，检测与置位不可分离，否则两个来源可能同时判定"无冲突"后双双激活。仓库授权写入以 `(repository_id, runtime_id)` 主键做 upsert，天然幂等。

## 6. UI 与可观测性

项目详情注册三个 tab：**文件**（主目录 + 参考仓库 + 范围）、**Skills**（默认 Skill 引用与只读下钻）、**设置**。"项目记忆" tab 在 v0.3 无真实数据，**不注册**——F009 SurfaceRegistry 的规则是没有真实数据与可用动作的槽位不进生产导航，空 tab 是无法兑现的承诺。

「能力」一级槽位由本 Feature 首次注册，内容为 Skills 列表 + 整页详情（来源、版本、要求、下发状态、只读文件）。MCP tab 延后到真实注入 contract 可用（ADR 0018 分期：v0.8）。

读取契约返回显式状态：`loading`、`empty`、`ready`、`conflict`、`unauthorized`、`path_missing`；`conflict` 与 `unauthorized` 必须显示可执行的下一步，不能只显示错误码。

F009 的 8 个 transitional-host 在本 Feature 验收时按 `migration-matrix.md` 的 `delete_when` 逐行删除，包括 `/settings/legacy-workflows`（由 Skill 详情替换）。

## 7. 失败、恢复、安全与兼容

- **路径授权**：`realpathSync` 解析后比较，沿用 `server/src/runtime/graph/preflight.ts:29` 的既有模式，**不是** `server/src/services/workspace.ts:25` 的 `path.resolve`——后者不解析 symlink，无法满足 NFR-002 的"真实路径"。解析失败（路径不存在 / 无权限）一律不授权并返回 `REPO_PATH_UNRESOLVED`。迁移旧 workspace 时，`local_path_normalized` 是 `path.resolve` 的产物，**不得直接当作已授权真实路径**：迁移只填 `raw_path`，`real_path` 留待首次授权时解析。
- **安全边界的如实声明**：realpath + 前缀比较能挡住 symlink 逃逸与 `..`，但**不是操作系统级隔离**——同用户的 agent 进程仍可用绝对路径访问未授权目录。本 Feature 提供的是"宿主不会把未授权路径下发给 adapter"，不声称"adapter 无法访问"。结构性隔离仍按 `docs/SOP.md`「结构性隔离与安全边界声明纪律」留待容器 / 受限账户方案（v0.7 多执行机器）。
- **Windows / POSIX**：`real_path` 比较按平台语义——Windows 大小写不敏感、分隔符归一，junction 由 `realpathSync` 解析；比较用 `path.relative(root, target)` 判断结果非绝对路径且不以 `..` 开头，不用字符串 `startsWith`（`/a/bc` 会被误判为在 `/a/b` 内）。
- **引用保护**：仓库被任何 `project_repository_refs` 引用时不可删除；项目归档可恢复，归档后历史任务的文件 refs、执行与证据仍可读（US-001 场景 2）。
- **迁移兼容**：legacy Skill 保留 alias 与 raw payload，可回放旧任务但不可从旧 UI 再编辑；旧 workflow-template 写 API 保留供历史兼容但 UI 不可达（migration-matrix A030）。

## 8. 测试策略与验收映射

Migration 测试必须从 F009 `v02-fixture-contract.md` 固定的 release v10 原始 fixture 起步，执行 v10 → current head 真实升级链，而不是在空库上建表——`issues` 重建的风险全部在"有历史数据"这一侧。

| 验收项 | 测试层级 | 计划文件 / 场景 | 关键断言 |
|---|---|---|---|
| `AC-001` | integration | `server/tests/integration/migration-space.test.ts` | v10 fixture 升级后 `issues.space_id` 全部非空、`project_id` 语义可空、原 Project / Issue ID 逐一守恒；重复升级只有一个 `is_default=1`；`PRAGMA foreign_key_check` 零行；四条新索引存在 |
| `AC-001` | integration | `server/tests/integration/space-first-run.test.ts` | 清洁库首次创建 Space 后可创建游离任务（`project_id` 为空） |
| `AC-002` | unit + integration | `server/tests/unit/repository-path.test.ts`、`server/tests/integration/repository-registry.test.ts` | symlink / junction 越界拒绝、大小写路径、`path.relative` 边界（`/a/bc` 不在 `/a/b` 内）、参考仓库 `read_write` 硬拒绝、项目范围只能收紧、旧 workspace 迁移不产生已授权 `real_path` |
| `AC-003` | unit + contract | `web/src/f013-project-skills.test.tsx` | 普通 Skill 与编组共用列表 / 详情；项目只存 ref（修改 Skill 不产生项目侧副本）；"项目记忆" tab 未注册 |
| `AC-004` | integration | `server/tests/integration/effective-requirements.test.ts` | 同一 `skill@version` ref 在 Skill 升级、禁用、冲突后解析结果逐字不变；未知 ref 返回 not-found 而非抛异常 |
| `AC-005` | integration | `server/tests/integration/skill-conflict.test.ts` | 同名双来源**双方**都进入 `conflict` 且都不生效；非法 steps schema / 保留 ID / 无来源在激活前拒绝；重启后冲突状态可见 |

批量场景（`review-convergence` 第 5 条）：migration 测试的 fixture 必须同时含**多个** Project、多个 Issue（含无 workspace 的历史行）与多个 legacy workflow，不能只测单条记录——`issues` 重建与 Space 回填正是典型的"单条通过、批量错位"场景。

门禁先做红→绿：每条文档契约锁点先删关键短语确认 `test:docs` 变红。

## 9. 已确认决策与残余风险

| 决策 / 风险 | 结论或缓解 | 理由 | 替代方案 / 后续 |
|---|---|---|---|
| `issues` 表重建 | 12-step rebuild，放宽四列，保留三个退役列不删 | SQLite 无法 ALTER COLUMN；删列会破坏 v0.1–v0.2 历史 refs（不变量 8） | 若未来确认无历史引用，由独立清理 Feature 删除 |
| Skill 归属形状 | `skills.space_id` 一对多，取代规划期的 `space_skills` 关联表（用户裁决 2026-09-12） | 多对多会把 `conflict` 变成 per-space 状态、连带重定义激活 / 禁用写入口与 UI 状态显示，而 v0.3 只有一个 Space，这些复杂度零消费者；spec §3「范围外」明确排除跨 Space 共享（PRD §15） | 未来共享叠加 `skill_visibility` 表，纯追加 migration；见 §3 与 DQ-001 |
| 同名冲突的表达 | 不用唯一约束，由 SkillRegistry 事务内检测并把双方置 `conflict` | 唯一约束会让第二来源插入失败，无法满足"两者都不生效且状态可见" | — |
| 默认 Space 唯一性 | 部分唯一索引 `WHERE is_default = 1` | 把幂等性交给数据库而不是升级器的判断顺序 | — |
| 配置类事件的载体 | 写 `admin_audit_events`，不写 `thread_events` | `thread_events.thread_id` 非空，配置界面没有会话上下文，编造 thread id 会污染会话流 | 若 v0.4 引入全局事件流再迁移 |
| 路径授权的安全等级 | 应用层过滤，如实声明不是 OS 级隔离 | 同用户 agent 进程仍可用绝对路径绕过；按 SOP 纪律不得把前者写成后者 | 容器 / 受限账户在 v0.7 评估 |
| Migration 版本号 | 不预占，先合入者取号，后者 rebase 重编号 | F010 与 F013 并行，任何一方写死版本号都会在合入时撞车 | — |
| legacy workflow 映射 | 保留 alias + raw payload，不猜测语义 | 旧自由 JSON 无法全部映射 | 未迁移字段数量由 F014 统计 |

## 10. 待确认设计问题

- [x] DQ-001: Skill 与 Space 的归属是一对多（`skills.space_id`）还是多对多（`space_skills` 关联表）？
  — 决策：**一对多**（用户裁决 2026-09-12），后续可扩展为多对多。规划期固化的多对多形状不再采用，
  `space_skills` 不建；`tools/check-v03-plan-contracts.test.mjs::V03-PLAN-R1-002` 的锁点短语已同步
  更新为 `` `spaces` 与 `skills.space_id` ``。决定性理由是 `conflict` 状态的归属：多对多下同一 Skill
  在不同 Space 的冲突结论不同，`state` 必须从 `skills` 搬到关联行，整套激活 / 禁用写入口要按 Space
  上下文重定义，而 v0.3 只有一个 Space。扩展路径见 §3——叠加 `skill_visibility` 可见性表，
  `skills.space_id` 语义从"归属"变为"所有者"，不重构已有归属。
