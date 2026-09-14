// F013: Space、仓库授权与 Skill 的 schema（design.md §3）。
//
// 本版本是本 Feature 唯一修改既有列的 migration：重建 projects 与 issues 两张表
// （SQLite 无法 ALTER COLUMN 去掉 NOT NULL，ADD COLUMN NOT NULL 又要求常量默认值，
// 而默认 Space 的 ULID 是运行时生成的）。其余只追加表 / 索引 / 触发器。
//
// 编排（FK 开关、foreign_key_check、默认 Space 回填、legacy 数据迁移）在
// migrations-v12.ts —— 本文件只放静态 DDL。

/** 新增表：Space 归属根 + 仓库事实 + 机器路径授权 + 项目仓库引用。 */
export const SCHEMA_V12_SPACES_AND_REPOSITORIES = `
CREATE TABLE IF NOT EXISTS spaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('active','archived')),
  is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0,1)),
  is_selected INTEGER NOT NULL DEFAULT 0 CHECK (is_selected IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- default 与 selected 是两个不同的事实，不可互相推导：default 是升级归属根，
-- selected 是当前工作焦点。部分唯一索引把"至多一个"交给数据库而非升级器的判断顺序。
CREATE UNIQUE INDEX IF NOT EXISTS idx_spaces_default
  ON spaces(is_default) WHERE is_default = 1;
CREATE UNIQUE INDEX IF NOT EXISTS idx_spaces_selected
  ON spaces(is_selected) WHERE is_selected = 1;

-- 仓库事实，跨项目共享同一份。不存 git_identity：提交身份属于执行机器而非仓库，
-- 由 GET /api/repositories/:id/identity 在读取时实时探测（design §3）。
CREATE TABLE IF NOT EXISTS repositories (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('local_dir','remote_url')),
  display_name TEXT NOT NULL,
  git_remote_url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 每台机器一份真实路径授权。授权行只在授权动作时创建（real_path NOT NULL），
-- legacy workspace 迁移只登记仓库与项目引用，不得伪造授权（design §7）。
CREATE TABLE IF NOT EXISTS repository_machine_paths (
  repository_id TEXT NOT NULL REFERENCES repositories(id),
  runtime_id TEXT NOT NULL,
  raw_path TEXT NOT NULL,
  real_path TEXT NOT NULL,
  authorized_identity TEXT NOT NULL,
  access TEXT NOT NULL CHECK (access IN ('read_write','read_only')),
  scope_json TEXT,
  case_insensitive INTEGER CHECK (case_insensitive IN (0,1)),
  authorized_at TEXT NOT NULL,
  last_verified_at TEXT,
  PRIMARY KEY (repository_id, runtime_id)
);

CREATE INDEX IF NOT EXISTS idx_repo_machine_paths_real
  ON repository_machine_paths(real_path);

-- 项目对仓库的引用。reference 角色在数据库层恒为只读（spec 边界场景），
-- 不靠应用逻辑；项目级 access 是"这个项目要用到什么程度"，与机器级取较严者。
CREATE TABLE IF NOT EXISTS project_repository_refs (
  project_id TEXT NOT NULL REFERENCES projects(id),
  repository_id TEXT NOT NULL REFERENCES repositories(id),
  role TEXT NOT NULL CHECK (role IN ('primary','reference')),
  access TEXT NOT NULL CHECK (access IN ('read_write','read_only')),
  scope_json TEXT,
  legacy_workspace_id TEXT REFERENCES workspaces(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (project_id, repository_id),
  CHECK (role = 'primary' OR access = 'read_only')
);

-- 主目录最多一个（spec 边界场景），由索引而非应用逻辑保证。
CREATE UNIQUE INDEX IF NOT EXISTS idx_project_primary_repo
  ON project_repository_refs(project_id) WHERE role = 'primary';

CREATE INDEX IF NOT EXISTS idx_project_repo_refs_repo
  ON project_repository_refs(repository_id);
`;

/** 新增表：Skill、revision、文件快照、per-Space 生效状态、下发状态与 legacy 桥。 */
export const SCHEMA_V12_SKILLS = `
-- Skill 归属：skills.space_id 一对多（所有权），取代规划期的 space_skills 关联表
-- （用户裁决 2026-09-12，DQ-001）。NULL 表示内置 / 全局，所有 Space 可见。
CREATE TABLE IF NOT EXISTS skills (
  id TEXT PRIMARY KEY,
  space_id TEXT REFERENCES spaces(id),
  display_name TEXT NOT NULL,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('builtin','user','legacy-workflow')),
  source_identity TEXT NOT NULL,
  -- 不变量 A：无条件非空，没有 disabled 特例——Skill 不存在"没有任何 revision"的状态。
  current_revision INTEGER NOT NULL,
  -- 全局意图只有 active / disabled；conflict 是 per-Space 结果，住在 skill_space_state。
  state TEXT NOT NULL CHECK (state IN ('active','disabled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (id, current_revision) REFERENCES skill_revisions(skill_id, version)
    DEFERRABLE INITIALLY DEFERRED
);

-- 同一 Space 内同一来源身份只能有一行：重复扫描去重以 source_identity 为准。
CREATE UNIQUE INDEX IF NOT EXISTS idx_skills_space_source_identity
  ON skills(COALESCE(space_id, ''), source_identity);

CREATE TABLE IF NOT EXISTS skill_revisions (
  skill_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  title TEXT,
  description TEXT,
  capability_tags_json TEXT NOT NULL DEFAULT '[]',
  -- 可空；非空即编组（FR-005）。
  steps_json TEXT,
  completion_requirements_json TEXT,
  source_locator TEXT,
  -- 规范化 JSON（键排序、去空白）的 SHA-256，revision 的完整性锚点。
  content_hash TEXT NOT NULL,
  -- NULL = 构建期（可写内容列、可增删文件）；非空 = 冻结期（任何修改被拒）。
  published_at TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (skill_id, version),
  -- 延迟到事务末：允许"先插 revision（构建期）→ 发布 → 再插 skills 行"的写入时序。
  FOREIGN KEY (skill_id) REFERENCES skills(id) DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX IF NOT EXISTS idx_skill_revisions_skill
  ON skill_revisions(skill_id);

CREATE TABLE IF NOT EXISTS skill_revision_files (
  skill_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  rel_path TEXT NOT NULL,
  content BLOB NOT NULL,
  content_hash TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  PRIMARY KEY (skill_id, version, rel_path)
);

-- per-Space 生效结果：全局 Skill 在每个 Space 各一行，Space 私有 Skill 只有自己那行。
-- 读取与 eligibility 必须两层与运算：skills.state='active' AND skill_space_state.state='active'。
CREATE TABLE IF NOT EXISTS skill_space_state (
  skill_id TEXT NOT NULL REFERENCES skills(id),
  space_id TEXT NOT NULL REFERENCES spaces(id),
  state TEXT NOT NULL CHECK (state IN ('active','shadowed','conflict')),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (skill_id, space_id)
);

-- 不变量 C：下发身份属于安装 (runtime_id, cli_provider)，不属于 project-scoped 的
-- agent_configs 行。激活事务不包含下发；pending / failed 在读取契约里必须可见。
CREATE TABLE IF NOT EXISTS skill_delivery_status (
  skill_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  runtime_id TEXT NOT NULL,
  cli_provider TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending','delivered','unsupported','failed')),
  target_path TEXT,
  native_format TEXT,
  detail TEXT,
  attempted_at TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (skill_id, version, runtime_id, cli_provider)
);

-- legacy 迁移的两张职责不同的桥：alias 管来源追溯（一行一个旧对象，不指向 revision），
-- combo_map 管组合解析（历史 Issue 的 (workflow, policy) → 确定 skill@version）。
-- 无 policy 的旧行用哨兵 '-'（SQLite 主键列不接受 NULL）。
CREATE TABLE IF NOT EXISTS skill_legacy_aliases (
  source_kind TEXT NOT NULL CHECK (source_kind IN ('workflow_template','validation_policy')),
  legacy_id TEXT NOT NULL,
  raw_payload_json TEXT NOT NULL,
  PRIMARY KEY (source_kind, legacy_id)
);

CREATE TABLE IF NOT EXISTS skill_legacy_combo_map (
  workflow_template_id TEXT NOT NULL,
  validation_policy_id TEXT NOT NULL CHECK (validation_policy_id <> ''),
  skill_id TEXT NOT NULL REFERENCES skills(id),
  version INTEGER NOT NULL,
  PRIMARY KEY (workflow_template_id, validation_policy_id),
  FOREIGN KEY (skill_id, version) REFERENCES skill_revisions(skill_id, version)
);

-- 项目只存 Skill 引用，不复制内容（FR-007）。
CREATE TABLE IF NOT EXISTS project_skill_refs (
  project_id TEXT NOT NULL REFERENCES projects(id),
  skill_id TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0,1)),
  pinned_version INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (project_id, skill_id),
  FOREIGN KEY (skill_id) REFERENCES skills(id),
  -- pinned 非空时挡不存在的 revision；pinned 为 NULL 时按 MATCH SIMPLE 跳过。
  FOREIGN KEY (skill_id, pinned_version) REFERENCES skill_revisions(skill_id, version)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_project_default_skill
  ON project_skill_refs(project_id) WHERE is_default = 1;
`;

/**
 * Skill 相关触发器。注意：引用 projects 的 trg_project_skill_refs_* 必须在
 * projects 重建（DROP + RENAME）之后创建——ALTER TABLE RENAME 会重解析整个
 * schema，若此时存在引用旧表名的 trigger，rebuild 会以 "no such table" 失败。
 * 判据是 T011 的穷举测试，不是这里的具体形态（design §3 不变量 A）。
 */
export const SCHEMA_V12_SKILL_TRIGGERS = `
-- 不得跨 Space 引用 Skill：被引用的 Skill 必须全局（space_id IS NULL）或属于
-- 该 Project 的 Space。列表过滤只是显示层，完整性由 trigger 在写入时挡下。
CREATE TRIGGER IF NOT EXISTS trg_project_skill_refs_space_insert
  BEFORE INSERT ON project_skill_refs
  FOR EACH ROW
  WHEN EXISTS (
    SELECT 1 FROM skills s JOIN projects p ON p.id = NEW.project_id
    WHERE s.id = NEW.skill_id AND s.space_id IS NOT NULL AND s.space_id <> p.space_id
  )
BEGIN
  SELECT RAISE(ABORT, 'SKILL_SPACE_MISMATCH');
END;

-- 不带 OF：任一列的 UPDATE（包括只改 skill_id）都要重查归属。
CREATE TRIGGER IF NOT EXISTS trg_project_skill_refs_space_update
  BEFORE UPDATE ON project_skill_refs
  FOR EACH ROW
  WHEN EXISTS (
    SELECT 1 FROM skills s JOIN projects p ON p.id = NEW.project_id
    WHERE s.id = NEW.skill_id AND s.space_id IS NOT NULL AND s.space_id <> p.space_id
  )
BEGIN
  SELECT RAISE(ABORT, 'SKILL_SPACE_MISMATCH');
END;

-- 不变量 A：任何写入路径结束后，每条引用都必须解析到一条已发布 revision。
-- 解析 = skill_id + COALESCE(pinned_version, skills.current_revision) 命中
-- published_at IS NOT NULL 的行；ghost Skill / pinned 指向 draft / current 指向
-- draft 都在此被拒。INSERT OR REPLACE 的写半段与 UPSERT DO UPDATE 分别走
-- INSERT / UPDATE 触发器，四类路径由 T011 穷举测试证明完备。
CREATE TRIGGER IF NOT EXISTS trg_project_skill_refs_resolvable_insert
  BEFORE INSERT ON project_skill_refs
  FOR EACH ROW
  WHEN NOT EXISTS (
    SELECT 1 FROM skills s JOIN skill_revisions r
      ON r.skill_id = s.id AND r.version = COALESCE(NEW.pinned_version, s.current_revision)
    WHERE s.id = NEW.skill_id AND r.published_at IS NOT NULL
  )
BEGIN
  SELECT RAISE(ABORT, 'SKILL_REF_UNRESOLVABLE');
END;

CREATE TRIGGER IF NOT EXISTS trg_project_skill_refs_resolvable_update
  BEFORE UPDATE ON project_skill_refs
  FOR EACH ROW
  WHEN NOT EXISTS (
    SELECT 1 FROM skills s JOIN skill_revisions r
      ON r.skill_id = s.id AND r.version = COALESCE(NEW.pinned_version, s.current_revision)
    WHERE s.id = NEW.skill_id AND r.published_at IS NOT NULL
  )
BEGIN
  SELECT RAISE(ABORT, 'SKILL_REF_UNRESOLVABLE');
END;

-- skills.current_revision 只能指向已发布 revision，由数据库保证而非"激活事务自觉"。
CREATE TRIGGER IF NOT EXISTS trg_skills_current_revision_insert
  BEFORE INSERT ON skills
  FOR EACH ROW
  WHEN NEW.current_revision IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM skill_revisions r
    WHERE r.skill_id = NEW.id AND r.version = NEW.current_revision
      AND r.published_at IS NOT NULL
  )
BEGIN
  SELECT RAISE(ABORT, 'SKILL_CURRENT_REVISION_NOT_PUBLISHED');
END;

CREATE TRIGGER IF NOT EXISTS trg_skills_current_revision_update
  BEFORE UPDATE ON skills
  FOR EACH ROW
  WHEN NEW.current_revision IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM skill_revisions r
    WHERE r.skill_id = NEW.id AND r.version = NEW.current_revision
      AND r.published_at IS NOT NULL
  )
BEGIN
  SELECT RAISE(ABORT, 'SKILL_CURRENT_REVISION_NOT_PUBLISHED');
END;

-- ---- 不变量 B：published revision 可先构建后冻结。五个发布态 trigger 各绑
-- ---- 一种事件、各带发布态条件，互不重叠；published_at 的首次置位
-- ---(NULL → 时间戳)天然放行，从非空改回 NULL 属于"改已发布行"被拒。

CREATE TRIGGER IF NOT EXISTS trg_skill_rev_no_update
  BEFORE UPDATE ON skill_revisions
  FOR EACH ROW
  WHEN OLD.published_at IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'SKILL_REVISION_FROZEN');
END;

CREATE TRIGGER IF NOT EXISTS trg_skill_rev_no_delete
  BEFORE DELETE ON skill_revisions
  FOR EACH ROW
  WHEN OLD.published_at IS NOT NULL
     OR EXISTS (SELECT 1 FROM skills WHERE id = OLD.skill_id AND current_revision = OLD.version)
     OR EXISTS (SELECT 1 FROM project_skill_refs WHERE skill_id = OLD.skill_id AND pinned_version = OLD.version)
BEGIN
  SELECT RAISE(ABORT, 'SKILL_REVISION_FROZEN');
END;

CREATE TRIGGER IF NOT EXISTS trg_skill_files_no_insert
  BEFORE INSERT ON skill_revision_files
  FOR EACH ROW
  WHEN (SELECT published_at FROM skill_revisions
        WHERE skill_id = NEW.skill_id AND version = NEW.version) IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'SKILL_REVISION_FROZEN');
END;

CREATE TRIGGER IF NOT EXISTS trg_skill_files_no_update
  BEFORE UPDATE ON skill_revision_files
  FOR EACH ROW
  WHEN (SELECT published_at FROM skill_revisions
        WHERE skill_id = OLD.skill_id AND version = OLD.version) IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'SKILL_REVISION_FROZEN');
END;

CREATE TRIGGER IF NOT EXISTS trg_skill_files_no_delete
  BEFORE DELETE ON skill_revision_files
  FOR EACH ROW
  WHEN (SELECT published_at FROM skill_revisions
        WHERE skill_id = OLD.skill_id AND version = OLD.version) IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'SKILL_REVISION_FROZEN');
END;
`;

/** 重建后的 projects 表形状（rebuild 时补列）。 */
export const SCHEMA_V12_PROJECTS_NEW = `
CREATE TABLE projects_f013 (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  default_workspace_id TEXT,
  default_coordinator_agent_id TEXT,
  default_adapter_config_id TEXT,
  space_id TEXT NOT NULL REFERENCES spaces(id),
  state TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active','archived')),
  archived_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;

/** 重建后的 issues 表形状：space_id 必填，project 与三个 legacy 列放宽为可空。 */
export const SCHEMA_V12_ISSUES_NEW = `
CREATE TABLE issues_f013 (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id),
  workspace_id TEXT REFERENCES workspaces(id),
  primary_thread_id TEXT,
  issue_type TEXT NOT NULL DEFAULT 'coding',
  workflow_template_id TEXT,
  validation_policy_id TEXT,
  title TEXT NOT NULL,
  goal TEXT,
  status TEXT NOT NULL DEFAULT 'Inbox',
  owner_agent_id TEXT,
  coordinator_agent_id TEXT,
  priority TEXT NOT NULL DEFAULT 'normal',
  labels TEXT,
  validation_round_count INTEGER NOT NULL DEFAULT 0,
  blocked_reason_code TEXT,
  blocked_reason_message TEXT,
  validation_dispatch_due_at TEXT,
  space_id TEXT NOT NULL REFERENCES spaces(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;

/** 重建后补回的索引与触发器：Issue 与 Project 的 Space 必须一致 + 两张表的 Space 索引。 */
export const SCHEMA_V12_REBUILT_INDEXES_AND_TRIGGERS = `
CREATE INDEX IF NOT EXISTS idx_projects_space ON projects(space_id);
CREATE INDEX IF NOT EXISTS idx_issues_space ON issues(space_id);

CREATE INDEX IF NOT EXISTS idx_issues_validation_due
  ON issues(status, validation_dispatch_due_at)
  WHERE status = 'Validating' AND validation_dispatch_due_at IS NOT NULL;

-- CHECK 不能跨表：issues.space_id 与其 project 的 space_id 一致性由 trigger 保证。
-- Project 改 Space 在 v0.3 不提供，因此不需要级联更新。
CREATE TRIGGER IF NOT EXISTS trg_issues_space_mismatch_insert
  BEFORE INSERT ON issues
  FOR EACH ROW
  WHEN NEW.project_id IS NOT NULL
   AND NEW.space_id <> (SELECT space_id FROM projects WHERE id = NEW.project_id)
BEGIN
  SELECT RAISE(ABORT, 'ISSUE_SPACE_MISMATCH');
END;

-- 不带 OF：任一列的 UPDATE（包括只改 project_id 的改绑）都重查一致性。
CREATE TRIGGER IF NOT EXISTS trg_issues_space_mismatch_update
  BEFORE UPDATE ON issues
  FOR EACH ROW
  WHEN NEW.project_id IS NOT NULL
   AND NEW.space_id <> (SELECT space_id FROM projects WHERE id = NEW.project_id)
BEGIN
  SELECT RAISE(ABORT, 'ISSUE_SPACE_MISMATCH');
END;
`;
