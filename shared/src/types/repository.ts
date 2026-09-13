// F013: 仓库事实与每台机器的真实路径授权（FR-003 / FR-004 / NFR-002）。

/** 机器级 / 项目级 / 任务级共用的文件范围形状（design §3 scope schema）。 */
export interface Scope {
  /** 相对仓库根的 POSIX 风格前缀，"" 表示整仓。 */
  read: string[];
  /** 必须是 read 的子集；read_only 仓库恒为 []。 */
  write: string[];
}

export type RepositoryKind = "local_dir" | "remote_url";
export type RepositoryAccess = "read_write" | "read_only";

/** repositories 行：仓库自身、跨机器一致的事实。git identity 不落库，读取时实时探测。 */
export interface Repository {
  id: string;
  kind: RepositoryKind;
  display_name: string;
  git_remote_url: string | null;
  created_at: string;
  updated_at: string;
}

/** 仓库在某台执行机器上的授权事实（design §3 repository_machine_paths）。 */
export interface RepositoryMachinePath {
  repository_id: string;
  runtime_id: string;
  raw_path: string;
  real_path: string;
  authorized_identity: string;
  access: RepositoryAccess;
  scope_json: Scope | null;
  case_insensitive: boolean | null;
  authorized_at: string;
  last_verified_at: string | null;
}

/** 项目对仓库的引用：项目级访问意图与范围只能收紧机器授权（FR-003）。 */
export interface ProjectRepositoryRef {
  project_id: string;
  repository_id: string;
  role: "primary" | "reference";
  access: RepositoryAccess;
  scope_json: Scope | null;
  legacy_workspace_id: string | null;
  created_at: string;
  updated_at: string;
}

/** POST /api/repositories:resolve —— 只探测不落库，供 UI 先看后存（FR-004）。 */
export interface RepositoryResolveInput {
  /** 本地路径或仓库地址。 */
  source: string;
  runtime_id?: string;
}

export interface GitIdentity {
  user_name: string | null;
  user_email: string | null;
  read_at: string;
}

export interface RepositoryResolveResponse {
  kind: RepositoryKind;
  display_name: string;
  real_path: string | null;
  git_remote_url: string | null;
  git_identity: GitIdentity | null;
  /** 授权预判：解析失败时为 false 并带原因。 */
  authorizable: boolean;
  unauthorized_reason?: string;
}

export interface RepositoryAuthorizeInput {
  repository_id: string;
  runtime_id?: string;
  access: RepositoryAccess;
  scope?: Scope;
}

export interface RepositoryAuthorizeResponse {
  machine_path: RepositoryMachinePath;
}

/** verifyAuthorization() 的输出（F012 唯一可见的只读契约之一，design §4）。 */
export type AuthorizationVerification =
  | {
      ok: true;
      real_path: string;
      access: RepositoryAccess;
      effective_scope: Scope;
      verified_at: string;
    }
  | {
      ok: false;
      reason:
        | "REPO_PATH_UNRESOLVED"
        | "REPO_IDENTITY_CHANGED"
        | "REPO_NOT_AUTHORIZED"
        | "REPO_SCOPE_EMPTY";
    };
