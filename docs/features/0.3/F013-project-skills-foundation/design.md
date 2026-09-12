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
- `is_default INTEGER NOT NULL DEFAULT 0`、`is_selected INTEGER NOT NULL DEFAULT 0`、`created_at`、`updated_at`
- `UNIQUE INDEX idx_spaces_default ON spaces(is_default) WHERE is_default = 1`：**部分唯一索引**保证默认 Space 至多一个，重复升级不可能创建第二个。
- `UNIQUE INDEX idx_spaces_selected ON spaces(is_selected) WHERE is_selected = 1`：同上，当前选中的 Space 至多一个。

**default 与 selected 是两个不同的事实，不可互相推导**：`is_default` 是**升级归属根**——历史 Project / Issue / Skill 回填到它，一经创建不再改变，用于保证旧数据永远有归属；`is_selected` 是**当前工作焦点**，用户每次切换即改写。二者初始重合（首个 Space 既是 default 也是 selected），之后独立演化。

选中态**存在服务端**而非前端：ADR 0012 允许本地多 Space 与切换，若只存浏览器状态，重启、换浏览器或多标签页会得到不同的"当前 Space"，而 Space 决定任务列表的可见范围，这类漂移会直接表现为"任务不见了"。

生命周期：`create` 写入新行（首个 Space 同时置 `is_default=1, is_selected=1`）；`select` 在单事务内清旧选中、置新选中，目标必须 `state='active'`；`archive` 要求目标非当前选中且非 default，否则返回 `SPACE_ARCHIVE_BLOCKED`——**默认 Space 永不可归档**，因为历史数据以它为归属根；`restore` 把 `archived` 改回 `active`，不自动选中。v0.3 不支持物理删除（spec §5）。

`repositories` — 仓库事实，跨项目共享同一份

- `id TEXT PRIMARY KEY`、`kind TEXT NOT NULL CHECK (kind IN ('local_dir','remote_url'))`
- `display_name TEXT NOT NULL`（自动识别得到，不要求用户手填，FR-004）
- `git_remote_url TEXT`：仓库自身的事实，跨机器一致，可以存在这里；探测失败留空不阻断保存
- `created_at`、`updated_at`
- **不存 `git_identity`**：提交身份是 `git config user.name / user.email`，属于**执行机器**而非仓库——V3.44 `implementation-notes.md:168` 明确"读执行机器上的 git config，不另存一份"。存成 repositories 的列会在两台机器取值不同时互相覆盖或误报。identity 由 `GET /api/repositories/:id/identity?runtime_id=` 在读取时实时探测返回，带 `read_at` 时间戳，不落库。

`repository_machine_paths` — 每台机器一份真实路径授权

- `(repository_id, runtime_id)` 复合主键（`runtime_id` 见 ADR 0015；v0.3 只有一台执行机器，但不把它硬编码成全局唯一行）
- `raw_path TEXT NOT NULL`：用户输入原文；**每次派工复核都从它重新解析**，不是只用于展示
- `real_path TEXT NOT NULL`：授权时 `realpathSync` 的结果，作为"授权当时指向哪里"的基线
- `authorized_identity TEXT NOT NULL`：授权时该真实路径的文件系统 identity（`dev:ino`，Windows 用 `volumeSerial:fileIndex`）。目录被删后重建会得到新 identity，即使路径字符串不变
- `access TEXT NOT NULL CHECK (access IN ('read_write','read_only'))`
- `scope_json TEXT`：机器级读写范围，形状见下方「scope schema」
- `authorized_at TEXT NOT NULL`、`last_verified_at TEXT`（每次成功复核时更新，是新鲜度事实而非装饰）

#### scope schema

`repository_machine_paths.scope_json` 与 `project_repository_refs.scope_json` 共用同一形状，Task 级范围由 F012 在派工请求里以同样形状传入：

```ts
type Scope = {
  read:  string[];   // 相对仓库根的 POSIX 风格前缀，"" 表示整仓
  write: string[];   // 必须是 read 的子集；read_only 仓库恒为 []
};
```

- 缺省值：机器级 `{read:[""], write:[""]}`（read_write）或 `{read:[""], write:[]}`（read_only）；项目级与任务级缺省为"继承上层"（字段缺失 ≠ 空数组，空数组表示"显式不允许"）。
- **交集算法**：`effective.read = 逐层 containment 收窄`——下层的每个前缀必须被上层某个前缀包含，否则该前缀被丢弃并记 `scope_narrowed` 诊断；`effective.write = read ∩ 各层 write`。任何一层 `write` 为空，结果 write 即为空。
- 前缀比较用规范化后的 `path.relative` 判断包含关系，不用字符串 `startsWith`（`src/ab` 不在 `src/a` 内）。

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

- `skills`：`id TEXT PRIMARY KEY`、`space_id TEXT REFERENCES spaces(id)`（NULL 表示内置 / 全局）、`display_name TEXT NOT NULL`、`source_kind TEXT NOT NULL CHECK (source_kind IN ('builtin','user','legacy-workflow'))`、`source_identity TEXT NOT NULL`、`current_revision INTEGER`、`state TEXT NOT NULL CHECK (state IN ('active','disabled','conflict'))`
  - `source_identity` 是**跨扫描稳定的来源身份**（内置为包内路径、用户为创建时分配的 ULID、legacy 为 `workflow:<旧id>`）。冲突消解、重复扫描去重都以它为准；只靠 `display_name` 无法区分"同一个来源被重扫"与"另一个来源同名"。
- `skill_revisions`：`(skill_id, version)` 复合主键、`title`、`description`、`capability_tags_json`、`steps_json`（可空；非空即编组，FR-005）、`completion_requirements_json`、`source_locator TEXT`、`content_hash TEXT NOT NULL`、`created_at`
  - `content_hash` 是规范化 JSON（键排序、去空白）的 SHA-256，既是 revision 的完整性锚点，也让"同内容重复导入"可判定。
  - **不可变由数据库保证**，不依赖 repository 自觉：建 `BEFORE UPDATE` trigger，对内容列的任何 UPDATE 抛 `SQLITE_CONSTRAINT`。AC-004 的"逐字不变"因此有结构性依据，而不是约定。
- `skill_revision_files`：`(skill_id, version, rel_path)` 主键 + `content_hash`、`size_bytes`。承载 FR-008 的"只读文件"清单；文件内容按 `source_locator` + `rel_path` 读取，API 只返回清单与 hash，正文单独取。
- `skill_delivery_status`：`(skill_id, version, adapter_id)` 主键 + `state TEXT CHECK (state IN ('delivered','unsupported','failed'))`、`native_format TEXT`、`detail TEXT`、`updated_at`。**"下发状态"是"翻译成哪些 adapter 原生格式"的事实，不能由 `skills.state='active'` 推断**（V3.44 语义）。v0.3 由 SkillRegistry 在激活时写入，adapter 不支持即 `unsupported`，不阻断激活。

#### canonical revision schema

`steps_json` 与 `completion_requirements_json` 的形状是 F012 的消费契约，必须冻结：

```ts
type Requirement = {
  id: string;              // revision 内唯一，kebab-case，保留前缀 "sys-" 不可用
  kind: "capability" | "completion";
  strength: "hard" | "soft";   // hard 不满足即 ineligible；soft 只降权、不阻断
  tags: string[];              // 结构化，不接受自由文本（ADR 0012：确定性规则引擎无法消费自由文本）
  description?: string;        // 给人读，不参与匹配
};
type Step = { id: string; order: number; title: string; requirements: Requirement[] };
```

- **未知字段 fail-closed**：解析时遇到 schema 外的键一律拒绝激活并返回 `SKILL_SCHEMA_UNKNOWN_FIELD`，不静默丢弃——静默丢弃会让下一版 schema 的内容在旧版本上"看起来生效了"。
- `Step.order` 在 revision 内必须连续且唯一；`Requirement.id` 在 revision 内唯一。
- **合并规则**：effective requirements = Skill 级 requirements ∪ 所有 step 的 requirements，按 `(kind, tags 排序后, strength)` 去重；同 tags 不同 strength 时取 `hard`（只会加严，§5）。输出按 `(kind, id)` 稳定排序，保证同一 ref 的两次解析逐字节相同。

#### 冲突消解闭环

冲突不是终态，必须有出口（spec US-002 场景 1）：

1. **扫描入口** `POST /api/skills:scan` 重新枚举 builtin 与 user 来源，按 `source_identity` 对齐已有行——同一来源重扫是更新，不是新建。
2. **检测**：同一 `(space_id, lower(display_name))` 下出现多个不同 `source_identity` 的 active 候选 → 在同一事务内把**全部**涉及行置 `conflict`，并写 `skill.conflict_detected`。
3. **消解**：`POST /api/skills/:id/resolve-conflict`，用户选定保留哪一个 → 事务内把选中行置 `active`、其余同组行置 `disabled`（不是删除，来源仍在）。
4. **恢复**：当一组冲突只剩一个非 disabled 成员时（例如另一方被禁用或其来源消失），扫描或消解动作把它自动置回 `active`；**不会有"冲突已消失但仍卡在 conflict"的悬挂状态**。
5. UI 的 `conflict` 状态必须给出可执行下一步，对应的就是第 3 步这个 API。

`project_skill_refs`：`(project_id, skill_id)` 主键 + `is_default INTEGER NOT NULL DEFAULT 0` + `pinned_version INTEGER NULL`（NULL = 跟随 current）。只存引用，不复制内容（FR-007）。两条完整性约束：

- `UNIQUE INDEX idx_project_default_skill ON project_skill_refs(project_id) WHERE is_default = 1`：spec FR-007 的"默认 Skill ref"是单数，由索引保证唯一，不靠应用逻辑。
- `FOREIGN KEY (skill_id, pinned_version) REFERENCES skill_revisions(skill_id, version)`：pin 一个不存在的 revision 会被数据库拒绝。`pinned_version` 为 NULL 时跟随 `skills.current_revision`，而后者由 revision 插入事务维护，**不存在指向空 revision 的默认 ref**。

`skill_legacy_aliases`：`(source_kind, legacy_id)` **复合主键**（`source_kind IN ('workflow_template','validation_policy')`）、`skill_id`、`version`、`raw_payload_json TEXT NOT NULL`。两张旧表各有自己的 ID 空间，单列主键在两表出现相同 ID 时只能保真一条；复合主键消除这个碰撞。原始行整体保存在 `raw_payload_json`，无法无损映射的字段不猜测语义（spec §7 决策）。

### 索引

```sql
CREATE INDEX idx_repo_machine_paths_real ON repository_machine_paths(real_path);
CREATE INDEX idx_project_repo_refs_repo  ON project_repository_refs(repository_id);
CREATE INDEX idx_skill_revisions_skill   ON skill_revisions(skill_id);
CREATE INDEX idx_issues_space            ON issues(space_id);
CREATE INDEX idx_projects_space          ON projects(space_id);
```

前两条支撑「这个真实路径是否已授权」与「删除仓库时的引用保护」，第三条支撑按 skill 取版本列表，后两条支撑 Space 内的任务列表与项目列表；五张表的主键最左前缀都不是这些查询键。

### 重建 `projects` 与 `issues`（本 Feature 唯一两处修改既有列）

**`projects` 同样需要 `space_id`**：FR-001 把 Space 定为 Project 的归属根，Space 切换后项目列表必须按 Space 隔离；仅给 `issues` 加 Space 而让 `projects` 悬空，会让"当前 Space 的项目"无法查询，AC-001 也无法断言 Project 归属。`projects` 现有列无 `space_id`，且需要 `NOT NULL`——`ALTER TABLE ADD COLUMN NOT NULL` 要求编译期常量默认值，而默认 Space 的 ULID 是运行时生成的，因此 `projects` 与 `issues` 在同一 migration 内一起走 rebuild。

`issues` 另有四个与最终模型冲突的 `NOT NULL` 列（`server/src/db/schema-v1.ts`）：`project_id`、`workspace_id`、`workflow_template_id`、`validation_policy_id`。FR-001 要求 `project_id` 可空，ADR 0012 要求后三者退出新 UI。**SQLite 无法 ALTER COLUMN 去掉 NOT NULL**，因此采用官方 table rebuild：

1. 事务外 `PRAGMA foreign_keys=OFF`（见下方「migration orchestration」——不能在事务内切换）；
2. 先建 `spaces` 并写入默认 Space，取得其 id；
3. 事务内建 `projects_new`：新增 `space_id TEXT NOT NULL REFERENCES spaces(id)`，其余列逐字保留；`INSERT … SELECT`，`space_id` 回填默认 Space id；
4. 事务内建 `issues_new`：新增 `space_id TEXT NOT NULL REFERENCES spaces(id)`；`project_id` 放宽为可空；`workspace_id` / `workflow_template_id` / `validation_policy_id` **保留但放宽为可空**；其余列与约束逐字保留；`INSERT … SELECT` 同样回填 `space_id`；
5. `DROP TABLE` 旧表、`ALTER TABLE … RENAME TO` 新名，**先 projects 后 issues**（issues 的外键指向 projects）；
6. 重建两张表的全部索引与触发器；
7. `PRAGMA foreign_key_check` 必须零行，否则整事务 rollback；
8. 事务提交后 `PRAGMA foreign_keys=ON`。

**保留三列而不是删除**，因为 v0.1–v0.2 的历史 Run / Trace / Evidence 引用它们（`docs/features/0.3/README.md` 跨 Feature 不变量 8：迁移不得破坏历史 refs）。新建 Issue 在 F012 接管前仍按 §7「分阶段兼容」写入这三列；旧行原值不动。

### 默认 Space 升级

升级器以稳定幂等键（`is_default = 1` 的部分唯一索引）创建唯一默认 Space，再回填历史 Project / Issue / Space 级 Skill；**不改变任何既有 ID**（FR-002）。重复执行因索引冲突而幂等。

#### legacy Workflow + Validation Policy 的合并映射

ADR 0012 第 7 条要求两者**一起**收敛进 Skill——只迁 workflow 会丢掉完成标准，而完成标准正是 Skill revision 要承载的东西。映射矩阵：

| 旧字段 | 去向 | 规则 |
|---|---|---|
| `workflow_templates.steps_json` | `skill_revisions.steps_json` | 逐步转 `Step`，`order` 按原数组下标；无 id 的步骤生成 `legacy-step-<n>` |
| `workflow_templates.evidence_requirements_json` | step / Skill 级 `completion` Requirement | 能映射成 tags 的转为结构化 Requirement；纯自由文本转 `description` 且 `strength='soft'`，**不伪造 tags** |
| `validation_policies` 的判定条件 | Skill 级 `completion` Requirement，`strength='hard'` | 验证要求默认是硬要求 |
| 两表其余字段 | `skill_legacy_aliases.raw_payload_json` | 原样保留，不猜测语义 |

**取哪个 policy**：`workflow_templates.validation_policy_id` 与 `issues.validation_policy_id` 都存在且不同时，**以 Issue 上的为准**——它是这条历史任务实际执行时生效的那份，workflow 上的只是创建时的默认值。为此迁移按 `(workflow_template_id, validation_policy_id)` **组合**生成 Skill revision：同一 workflow 配过两个 policy，就产生两个 revision，各自 alias 指回来源组合。没有任何 Issue 引用的 workflow 用其自带 policy 生成一条 revision。

**逐 Issue 保真**：迁移后每条历史 Issue 的 `(workflow_template_id, validation_policy_id)` 组合都必须能经 alias 解析到确定的 `skill@version`；迁移测试逐行断言这一点，不允许"大部分能解析"。

### Migration orchestration（本 Feature 需要改 runner）

当前 `server/src/db/migrations.ts:84-92` 把每个版本整体包进 `db.transaction(() => { db.exec(SCHEMA_Vn); insert schema_version })()`。**SQLite 在事务内切换 `PRAGMA foreign_keys` 是静默 no-op**——照现有框架直接写 rebuild，外键不会真的关闭，`DROP TABLE projects` 会因子表引用而失败或留下悬空引用，而 DDL 本身不报错，失败方式是沉默的。

因此本版本 migration 不能复用既有形状，需要一个显式的 orchestration 分支：

```
db.pragma('foreign_keys = OFF');            // 事务外，返回值需断言已生效
try {
  db.transaction(() => {
    /* rebuild projects → rebuild issues → 建新表 → 回填 */
    const violations = db.pragma('foreign_key_check');
    if (violations.length > 0) throw new Error(...);   // 事务内检查，违规即 rollback
    db.prepare('INSERT INTO schema_version ...').run(N, now);
  })();
} finally {
  db.pragma('foreign_keys = ON');           // 无论成败都恢复，异常路径不得留下关闭状态
}
```

三条约束必须由测试锁定：`foreign_keys` 在 migration 前后都为 `ON`；**抛异常的失败路径也必须恢复为 `ON`**；`schema_version` 与表结构在同一事务内提交，不存在"表已改、版本没记"的中间态。`db.pragma('foreign_keys')` 的读回值是断言对象，不能只看没报错。

### Migration 版本号与 F010 的并行协调

`CURRENT_SCHEMA_VERSION` 当前为 11，F010 与 F013 并行且都要顺延。**两者都不预占版本号**：实施时读取仓库当前值 +1；先合入者取得该号，后合入者 rebase 后重新编号并改 migration 文件名。禁止在文档或 tasks 中写死 `v12`。Migration 除上述 `issues` 重建外只追加表 / 索引；仓库没有 down migration，不声明不可执行的「回滚前检查」。

## 4. 接口、Contract 与 Event

### API

- `POST /api/spaces`、`GET /api/spaces`、`POST /api/spaces/:id/select`、`POST /api/spaces/:id/archive`、`POST /api/spaces/:id/restore`；`GET /api/spaces` 返回每行的 `is_default` / `is_selected`，前端不自行推断"当前 Space"。
- **Space 作用域规则**：`GET /api/projects` 与 `GET /api/issues` 默认按当前 `is_selected` 的 Space 过滤，并接受显式 `space_id` 覆盖；按 ID 直接读取单个 Project / Issue **不做 Space 过滤**，否则 F009 已发布的 `/projects/:projectId` 深链在切换 Space 后会 404（跨 Feature 不变量 8）。返回体带 `space_id`，由前端提示"该对象属于其它 Space"。
- `POST /api/repositories:resolve`：输入本地路径或 URL，返回自动识别的 `kind`、`display_name`、`real_path`、`git_remote_url`、`git_identity` 与授权预判；**不落库**，供 UI 先看后存（FR-004 的"不要求手填名称"）。
- `POST /api/repositories`、`PUT /api/projects/:id/repositories`（整体设置 primary + references）
- `GET /api/skills`、`GET /api/skills/:id/revisions/:version`、`POST /api/skills/:id/revisions`、`POST /api/skills/:id/{activate,disable}`
- `POST /api/skills:scan`（重新枚举来源，按 `source_identity` 对齐）、`POST /api/skills/:id/resolve-conflict`（选定保留方，其余置 disabled）
- `GET /api/skills/:id/revisions/:version/files`（只读文件清单 + hash）、`GET /api/skills/:id/revisions/:version/delivery`（按 adapter 的下发事实）
- `PUT /api/projects/:id/default-skill`
- `GET /api/skills/:id/effective-requirements?version=<n>`：返回能力要求与完成要求的并集，**按 revision ref 确定**；version 走 query 而非 path segment，避免 `@` 在 path 中的编码歧义。

### 供 F012 消费的只读契约（跨 Feature 边界）

```ts
resolveEffectiveRequirements(skill_ref: "<skill_id>@<version>") -> {
  capability_requirements: Requirement[],   // Skill 级 ∪ 所有 step，按 §3 合并规则去重排序
  completion_requirements: Requirement[],
  source_revision: { skill_id, version },
} | { not_found: true }

// 每次派工前调用；不是读缓存，而是当场重新解析文件系统
verifyAuthorization(input: {
  repository_id, runtime_id, project_id, task_scope?: Scope
}) -> {
  ok: true,
  real_path: string,                 // 本次重新 realpath 的结果
  access: "read_write" | "read_only",
  effective_scope: Scope,            // 机器 ∩ 项目 ∩ 任务，算法见 §3
  verified_at: string,
} | {
  ok: false,
  reason: "REPO_PATH_UNRESOLVED" | "REPO_IDENTITY_CHANGED" | "REPO_NOT_AUTHORIZED"
        | "REPO_SCOPE_EMPTY",
}
```

`resolveEffectiveRequirements` 纯读；**遇到未知 ref 返回显式 not-found 而非抛异常**（与 `server/src/evidence-ref.ts` 的既有约定同源）。

`verifyAuthorization` 是 NFR-002「每次派工前复核」的落点，**不返回已保存的 `real_path`，而是当场重做三件事**：① 从 `raw_path` 重新 `realpathSync`；② 读取当前 identity 并与 `authorized_identity` 比对，不一致即 `REPO_IDENTITY_CHANGED`（覆盖授权后 symlink 换靶、目录删除后重建这两种"路径没变但目标变了"的情况）；③ 计算三层 scope 交集。成功时更新 `last_verified_at`。它有一次写（时间戳），因此不是纯读，但不改变任何授权决定。

F012 负责把结果冻结进 Dispatch snapshot；F013 不感知 snapshot 是否存在。**Task scope 由 F012 作为入参传入**——F013 不读 Dispatch，也不猜测任务范围从哪来。

### Event / Trace contract

事件类型：`space.created`、`space.selected`、`repository.authorized`、`project.refs_changed`、`skill.revision_activated`、`skill.conflict_detected`、`project.default_skill_changed`。

`thread_events.thread_id` 是 `NOT NULL REFERENCES threads(id)`（`schema-v1.ts`），而上述事件多数发生在**没有会话上下文**的配置界面。因此：配置类事件**不写 `thread_events`**，改写 `admin_audit_events`（该表已存在，v0.2 起用于管理动作审计）；只有由任务内动作触发的 Skill 引用变更才带 thread 上下文。**不得为配置事件编造 thread id。**

## 5. Runtime、Workflow 与并发

派工前的授权复核（NFR-002）由 `verifyAuthorization()` 执行，取三者交集：机器路径授权 ∩ 项目范围 ∩ 任务范围，任一层缺失即不授权。**复核是一次真实的文件系统读取**（重新 realpath + 比对 identity），不是读回授权时保存的结论——否则授权后被换掉的 symlink 会一直沿用旧结论。范围只能逐层收紧，`ProjectService` 无法放宽 `RepositoryRegistry` 的 `access`；参考仓库的 `read_write` 请求**硬拒绝**而非降级。

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
- **分阶段兼容：F013 放宽列，但不切断 legacy 写**。`server/src/services/issue.ts:102` 当前以 `project_id` / `workspace_id` / `workflow_template_id` / `validation_policy_id` 四个必填字段创建 Issue，现有 Run / Graph / Validation 链路继续读 `workspace_id`。依赖顺序是 F013 → F012 → F011，**如果 F013 在放宽列的同时就停止写这三列，F012 接管前的创建与执行旅程会当场断掉**——这不是旧 UI 隐藏与否的问题，而是运行时读取方还没换。
  因此本 Feature 的边界是：schema 允许为空、新对象模型不再依赖它们，但 `IssueService` 在有 Project 上下文时**继续按兼容投影写入**（`workspace_id` 取该 Project 主仓库对应的 workspace 行，`workflow_template_id` / `validation_policy_id` 取 legacy 默认）；游离任务（无 Project）三列为空，且**不得进入 v0.2 执行链路**，直到 F012 接管派工。兼容投影的删除条件绑定 `migration-matrix.md` 的 A003 / A005 / A007 / A009 行，由 F012 / F011 在各自验收时逐行删除，F013 只负责不提前破坏它们。
- **引用保护**：仓库被任何 `project_repository_refs` 引用时不可删除；项目归档可恢复，归档后历史任务的文件 refs、执行与证据仍可读（US-001 场景 2）。
- **迁移兼容**：legacy Skill 保留 alias 与 raw payload，可回放旧任务但不可从旧 UI 再编辑；旧 workflow-template 写 API 保留供历史兼容但 UI 不可达（migration-matrix A030）。

## 8. 测试策略与验收映射

Migration 测试必须从 F009 `v02-fixture-contract.md` 固定的 release v10 原始 fixture 起步，执行 v10 → current head 真实升级链，而不是在空库上建表——`issues` 重建的风险全部在"有历史数据"这一侧。

| 验收项 | 测试层级 | 计划文件 / 场景 | 关键断言 |
|---|---|---|---|
| `AC-001` | integration | `server/tests/integration/migration-space.test.ts` | v10 fixture 升级后 `issues.space_id` 与 `projects.space_id` 全部非空、`issues.project_id` 语义可空、原 Project / Issue ID 逐一守恒；重复升级只有一个 `is_default=1` 与一个 `is_selected=1`；`PRAGMA foreign_key_check` 零行；五条新索引存在 |
| `AC-001` | integration | `server/tests/integration/space-first-run.test.ts` | 清洁库首次创建 Space 后可创建游离任务（`project_id` 为空）；`select` 后重启服务，当前 Space 仍是选中的那个；默认 Space 归档被拒绝（`SPACE_ARCHIVE_BLOCKED`）；按 ID 深链读取其它 Space 的 Project 不 404 |
| `AC-001` | integration | `server/tests/integration/migration-runner-fk.test.ts` | migration 前后 `PRAGMA foreign_keys` 均为 ON；注入异常的失败路径提交后仍恢复 ON；失败时 `schema_version` 未推进且表结构未改（无"表已改、版本没记"中间态） |
| `AC-001` | integration | `server/tests/integration/legacy-compat-projection.test.ts` | 升级后经 `IssueService` 创建带 Project 的任务，三列仍按兼容投影写入且 v0.2 执行链路可跑通；游离任务三列为空且不进入该链路 |
| `AC-002` | unit + integration | `server/tests/unit/repository-path.test.ts`、`server/tests/integration/repository-registry.test.ts` | symlink / junction 越界拒绝、大小写路径、`path.relative` 边界（`/a/bc` 不在 `/a/b` 内、`src/ab` 不在 `src/a` 内）、参考仓库 `read_write` 硬拒绝、项目范围只能收紧、旧 workspace 迁移不产生已授权 `real_path` |
| `AC-002` | integration | `server/tests/integration/authorization-recheck.test.ts` | 授权后把 symlink 换靶 → `REPO_IDENTITY_CHANGED`；删除目录再同名重建 → 同样拒绝；路径失联 → `REPO_UNRESOLVED`；三层 scope 交集（含"某层 write 为空则结果 write 为空"与缺省继承）逐例断言；成功复核更新 `last_verified_at` |
| `AC-002` | unit | `server/tests/unit/git-identity.test.ts` | identity 实时从 `git config` 读取并带 `read_at`，`repositories` 表无 `git_identity` 列 |
| `AC-003` | unit + contract | `web/src/f013-project-skills.test.tsx` | 普通 Skill 与编组共用列表 / 详情；项目只存 ref（修改 Skill 不产生项目侧副本）；"项目记忆" tab 未注册 |
| `AC-001` | integration | `server/tests/integration/legacy-skill-migration.test.ts` | 每条历史 Issue 的 `(workflow_template_id, validation_policy_id)` 组合都能经 alias 解析到确定 `skill@version`（逐行断言，不接受"大部分能解析"）；Issue 上的 policy 优先于 workflow 自带；同 workflow 配两个 policy 产生两个 revision；两表同 ID 时复合主键各自保真；自由文本要求不被伪造成 tags |
| `AC-004` | integration | `server/tests/integration/effective-requirements.test.ts` | 同一 `skill@version` ref 在 Skill 升级、禁用、冲突后解析结果逐字不变；未知 ref 返回 not-found 而非抛异常 |
| `AC-003` | integration | `server/tests/integration/skill-revision-schema.test.ts` | 未知字段拒绝激活（`SKILL_SCHEMA_UNKNOWN_FIELD`）；`sys-` 保留前缀、重复 Requirement id、不连续 order 均拒绝；trigger 使内容列 UPDATE 抛 `SQLITE_CONSTRAINT`；同 tags 的 hard/soft 合并取 hard；两次解析输出逐字节相同 |
| `AC-003` | integration | `server/tests/integration/skill-default-ref.test.ts` | 一个项目至多一条 `is_default=1`；pin 不存在的 revision 被外键拒绝；默认 ref 永远能解析到一个真实 revision |
| `AC-005` | integration | `server/tests/integration/skill-conflict.test.ts` | 同名双来源**双方**都进入 `conflict` 且都不生效；`resolve-conflict` 后保留方 `active`、其余 `disabled`；一组只剩一个非 disabled 成员时自动回 `active`（无悬挂 conflict）；同一 `source_identity` 重扫是更新不是新建；非法 steps schema / 保留 ID / 无来源在激活前拒绝；重启后冲突状态可见 |
| `AC-003` | integration | `server/tests/integration/skill-delivery.test.ts` | 下发状态按 adapter 独立记录，`unsupported` 不阻断激活；`active` 不能推断出 `delivered` |

批量场景（`review-convergence` 第 5 条）：migration 测试的 fixture 必须同时含**多个** Project、多个 Issue（含无 workspace 的历史行）与多个 legacy workflow，不能只测单条记录——`issues` 重建与 Space 回填正是典型的"单条通过、批量错位"场景。

门禁先做红→绿：每条文档契约锁点先删关键短语确认 `test:docs` 变红。

## 9. 已确认决策与残余风险

| 决策 / 风险 | 结论或缓解 | 理由 | 替代方案 / 后续 |
|---|---|---|---|
| `projects` / `issues` 表重建 | 同一 migration 内先后 rebuild，放宽 issues 四列，保留三个退役列不删 | SQLite 无法 ALTER COLUMN，且 `ADD COLUMN NOT NULL` 要常量默认值而默认 Space id 是运行时 ULID；删列会破坏 v0.1–v0.2 历史 refs（不变量 8） | 若未来确认无历史引用，由独立清理 Feature 删除 |
| migration runner 改造 | 本版本用专用分支：事务外开关 FK、事务内 `foreign_key_check` 与 schema_version 原子提交、`finally` 恢复 FK | 现有 runner 把 migration 包进事务，而事务内切换 `PRAGMA foreign_keys` 是静默 no-op——照抄会得到"看起来成功"的错误迁移 | 若后续还有 rebuild 需求，把该分支提炼成 runner 能力 |
| legacy 写入口的退场时机 | F013 只放宽 schema，不停止写三列；兼容投影由 F012 / F011 按 migration-matrix A003/A005/A007/A009 删除 | 依赖顺序是 F013 → F012 → F011，读取方尚未换；提前切断会在 F012 接管前破坏创建与执行旅程 | — |
| Skill 归属形状 | `skills.space_id` 一对多，取代规划期的 `space_skills` 关联表（用户裁决 2026-09-12） | 多对多会把 `conflict` 变成 per-space 状态、连带重定义激活 / 禁用写入口与 UI 状态显示，而 v0.3 只有一个 Space，这些复杂度零消费者；spec §3「范围外」明确排除跨 Space 共享（PRD §15） | 未来共享叠加 `skill_visibility` 表，纯追加 migration；见 §3 与 DQ-001 |
| 同名冲突的表达 | 不用唯一约束，由 SkillRegistry 事务内检测并把双方置 `conflict` | 唯一约束会让第二来源插入失败，无法满足"两者都不生效且状态可见" | — |
| 默认 Space 唯一性 | 部分唯一索引 `WHERE is_default = 1` | 把幂等性交给数据库而不是升级器的判断顺序 | — |
| 配置类事件的载体 | 写 `admin_audit_events`，不写 `thread_events` | `thread_events.thread_id` 非空，配置界面没有会话上下文，编造 thread id 会污染会话流 | 若 v0.4 引入全局事件流再迁移 |
| 路径授权的安全等级 | 应用层过滤，如实声明不是 OS 级隔离 | 同用户 agent 进程仍可用绝对路径绕过；按 SOP 纪律不得把前者写成后者 | 容器 / 受限账户在 v0.7 评估 |
| Migration 版本号 | 不预占，先合入者取号，后者 rebase 重编号 | F010 与 F013 并行，任何一方写死版本号都会在合入时撞车 | — |
| legacy workflow 映射 | 按 `(workflow, policy)` 组合生成 revision，Issue 上的 policy 优先；alias 用 `(source_kind, legacy_id)` 复合主键；保留 raw payload，不猜测语义 | ADR 0012 要求两者一起收敛，只迁 workflow 会丢完成标准；Issue 上的 policy 才是历史任务实际生效的那份；两张旧表 ID 空间独立，单列主键会碰撞 | 未迁移字段数量由 F014 统计 |

## 10. 待确认设计问题

- [x] DQ-001: Skill 与 Space 的归属是一对多（`skills.space_id`）还是多对多（`space_skills` 关联表）？
  — 决策：**一对多**（用户裁决 2026-09-12），后续可扩展为多对多。规划期固化的多对多形状不再采用，
  `space_skills` 不建；`tools/check-v03-plan-contracts.test.mjs::V03-PLAN-R1-002` 的锁点短语已同步
  更新为 `` `spaces` 与 `skills.space_id` ``。决定性理由是 `conflict` 状态的归属：多对多下同一 Skill
  在不同 Space 的冲突结论不同，`state` 必须从 `skills` 搬到关联行，整套激活 / 禁用写入口要按 Space
  上下文重定义，而 v0.3 只有一个 Space。扩展路径见 §3——叠加 `skill_visibility` 可见性表，
  `skills.space_id` 语义从"归属"变为"所有者"，不重构已有归属。
