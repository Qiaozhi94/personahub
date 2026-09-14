// F013 T005/T006/T007: RepositoryRegistry——仓库事实（真实路径、git remote、
// identity 探测）的唯一写入口，也是路径授权的唯一裁决者（design.md §2）。
// verifyAuthorization() 是 F012 唯一可见的只读契约之一：不返回已保存的结论，
// 每次派工前当场重做 realpath + identity 比对 + 三层 scope 交集（NFR-002）。
//
// 安全边界如实声明：realpath + 前缀比较能挡 symlink 逃逸与 ..，但不是 OS 级
// 隔离——同用户 agent 进程仍可用绝对路径访问未授权目录。本 Feature 提供的是
// "宿主不会把未授权路径下发给 adapter"，不声称"adapter 无法访问"（design §7）。

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { ErrorCode } from "@personahub/shared/errors";
import type {
  AuthorizationVerification,
  GitIdentity,
  Repository,
  RepositoryAccess,
  RepositoryResolveResponse,
  Scope,
} from "@personahub/shared/types";
import { AppError } from "../api/errors.js";
import { AuditService } from "./audit.js";
import { computeEffectiveScope, defaultMachineScope, validateScope } from "./scope.js";
import { generateRepositoryId, generateWorkspaceId } from "../id.js";

/** ADR 0015：v0.3–v0.6 恒为本机执行，不硬编码进 schema 行之外的任何逻辑。 */
export const LOCAL_RUNTIME_ID = "local";

interface MachinePathRow {
  repository_id: string;
  runtime_id: string;
  raw_path: string;
  real_path: string;
  authorized_identity: string;
  access: RepositoryAccess;
  scope_json: string | null;
  case_insensitive: number | null;
  authorized_at: string;
  last_verified_at: string | null;
}

interface ProjectRefRow {
  project_id: string;
  repository_id: string;
  role: "primary" | "reference";
  access: RepositoryAccess;
  scope_json: string | null;
  legacy_workspace_id: string | null;
}

function statIdentity(target: string): string {
  // dev:ino；Windows 上 dev 恒 0，退化为 fileIndex——目录删除重建后 index 变化，
  // 足以识别"路径没变但目标变了"。
  const stat = fs.statSync(target, { bigint: true });
  return `${stat.dev.toString()}:${stat.ino.toString()}`;
}

function display_nameOfAnyPlatform(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? p;
}

function isRemoteUrl(source: string): boolean {
  return (
    /^https?:\/\//i.test(source) ||
    /^ssh:\/\//i.test(source) ||
    /^git@/.test(source) ||
    (/\.git$/i.test(source) && !fs.existsSync(source))
  );
}

function remoteDisplayName(source: string): string {
  const withoutProtocol = source.replace(/^(https?|ssh):\/\//i, "").replace(/^git@/, "");
  const last = withoutProtocol.split(/[/:]/).filter(Boolean).pop() ?? source;
  return last.replace(/\.git$/i, "") || source;
}

function git(args: string[], cwd: string): string | null {
  try {
    const out = execFileSync("git", args, {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 5000,
    }).trim();
    return out === "" ? null : out;
  } catch {
    return null;
  }
}

/**
 * 对仓库根实测大小写行为：写入探针文件后以变体大小写读取。所有平台都实测，
 * 不按平台名假定——APFS 可格式化为大小写敏感卷，NTFS 也可按目录开启大小写
 * 敏感（design §3）。探测失败一律返回 null，比较时按敏感处理。
 */
export function probeCaseInsensitive(dir: string): boolean | null {
  const probeName = `.__personahub_case_probe_${randomUUID()}`;
  const probePath = path.join(dir, probeName);
  const variant = path.join(dir, probeName.toUpperCase());
  let created = false;
  try {
    fs.writeFileSync(probePath, "probe", { flag: "wx" });
    created = true;
    try {
      return fs.existsSync(variant);
    } finally {
      if (created) fs.rmSync(probePath, { force: true });
    }
  } catch {
    if (created) fs.rmSync(probePath, { force: true });
    return null;
  }
}

export class RepositoryRegistry {
  constructor(
    private db: Database.Database,
    private audit: AuditService,
  ) {}

  /** POST /api/repositories:resolve —— 只探测不落库，供 UI 先看后存（FR-004）。 */
  resolve(source: string, _runtimeId: string = LOCAL_RUNTIME_ID): RepositoryResolveResponse {
    const trimmed = source?.trim();
    if (!trimmed) {
      throw new AppError(ErrorCode.REPOSITORY_SOURCE_REQUIRED, "Repository source is required.", "source");
    }

    if (isRemoteUrl(trimmed)) {
      return {
        kind: "remote_url",
        display_name: remoteDisplayName(trimmed),
        real_path: null,
        git_remote_url: trimmed,
        git_identity: null,
        authorizable: false,
        unauthorized_reason: "REMOTE_URL_NOT_LOCAL",
      };
    }

    let realPath: string;
    try {
      realPath = fs.realpathSync(path.resolve(trimmed));
    } catch {
      return {
        kind: "local_dir",
        display_name: display_nameOfAnyPlatform(trimmed),
        real_path: null,
        git_remote_url: null,
        git_identity: null,
        authorizable: false,
        unauthorized_reason: "REPO_PATH_UNRESOLVED",
      };
    }
    if (!fs.statSync(realPath).isDirectory()) {
      return {
        kind: "local_dir",
        display_name: display_nameOfAnyPlatform(realPath),
        real_path: realPath,
        git_remote_url: null,
        git_identity: null,
        authorizable: false,
        unauthorized_reason: "NOT_A_DIRECTORY",
      };
    }

    const gitRoot = git(["rev-parse", "--show-toplevel"], realPath);
    const remoteUrl = gitRoot ? git(["config", "--get", "remote.origin.url"], gitRoot) : null;
    return {
      kind: "local_dir",
      display_name: display_nameOfAnyPlatform(realPath),
      real_path: realPath,
      git_remote_url: remoteUrl,
      git_identity: this.probeGitIdentityForPath(realPath),
      authorizable: true,
    };
  }

  /** Git identity 实时从执行机器的 git config 读取，带 read_at，不落库（design §3）。 */
  probeGitIdentity(repositoryId: string, runtimeId: string = LOCAL_RUNTIME_ID): GitIdentity {
    const row = this.getMachinePath(repositoryId, runtimeId);
    if (!row) {
      throw new AppError(
        ErrorCode.REPOSITORY_NOT_AUTHORIZED,
        "Repository has no machine path authorization on this runtime.",
      );
    }
    return this.probeGitIdentityForPath(row.real_path);
  }

  private probeGitIdentityForPath(dir: string): GitIdentity {
    return {
      user_name: git(["config", "user.name"], dir),
      user_email: git(["config", "user.email"], dir),
      read_at: new Date().toISOString(),
    };
  }

  /** POST /api/repositories —— 落库。local_dir 按本机真实路径去重（仓库事实跨项目共享）。 */
  create(input: { source: string; runtime_id?: string }): Repository {
    const resolved = this.resolve(input.source, input.runtime_id);
    if (resolved.kind === "remote_url") {
      const existing = this.db
        .prepare("SELECT * FROM repositories WHERE kind = 'remote_url' AND git_remote_url = ?")
        .get(resolved.git_remote_url) as Repository | undefined;
      if (existing) return existing;
      const now = new Date().toISOString();
      const id = generateRepositoryId();
      this.db
        .prepare(
          "INSERT INTO repositories (id, kind, display_name, git_remote_url, created_at, updated_at) VALUES (?, 'remote_url', ?, ?, ?, ?)",
        )
        .run(id, resolved.display_name, resolved.git_remote_url, now, now);
      const created = this.db.prepare("SELECT * FROM repositories WHERE id = ?").get(id) as Repository;
      this.audit.record("repository.created", "repository", id, {
        kind: "remote_url",
        display_name: created.display_name,
      });
      return created;
    }

    if (!resolved.real_path || !resolved.authorizable) {
      throw new AppError(ErrorCode.WORKSPACE_PATH_NOT_FOUND, `Local path could not be resolved: ${input.source}`);
    }
    const existing = this.findByLocalRealPath(resolved.real_path, input.runtime_id ?? LOCAL_RUNTIME_ID);
    if (existing) return existing;

    const now = new Date().toISOString();
    const id = generateRepositoryId();
    this.db
      .prepare(
        "INSERT INTO repositories (id, kind, display_name, git_remote_url, created_at, updated_at) VALUES (?, 'local_dir', ?, ?, ?, ?)",
      )
      .run(id, resolved.display_name, resolved.git_remote_url, now, now);
    const created = this.db.prepare("SELECT * FROM repositories WHERE id = ?").get(id) as Repository;
    this.audit.record("repository.created", "repository", id, {
      kind: "local_dir",
      display_name: created.display_name,
      real_path: resolved.real_path,
    });
    return created;
  }

  private findByLocalRealPath(realPath: string, runtimeId: string): Repository | null {
    const row = this.db
      .prepare(
        `SELECT r.* FROM repositories r
         JOIN repository_machine_paths m ON m.repository_id = r.id AND m.runtime_id = ?
         WHERE m.real_path = ?`,
      )
      .get(runtimeId, realPath) as Repository | undefined;
    return row ?? null;
  }

  getById(repositoryId: string): Repository {
    const row = this.db.prepare("SELECT * FROM repositories WHERE id = ?").get(repositoryId) as Repository | undefined;
    if (!row) {
      throw new AppError(ErrorCode.REPOSITORY_NOT_FOUND, "Repository not found.");
    }
    return row;
  }

  /**
   * 授权入口：用户给出原始路径（可能与既有 raw_path 不同，视为重新授权）。
   * upsert (repository_id, runtime_id) 行，identity 与大小写行为在授权时实测，
   * 幂等可重放。
   */
  authorizePath(input: {
    repository_id?: string;
    raw_path: string;
    runtime_id?: string;
    access: RepositoryAccess;
    scope?: unknown;
  }): { repository: Repository; machine_path: MachinePathRow } {
    const runtimeId = input.runtime_id ?? LOCAL_RUNTIME_ID;
    const resolved = this.resolve(input.raw_path, runtimeId);
    if (!resolved.real_path || !resolved.authorizable) {
      throw new AppError(ErrorCode.WORKSPACE_PATH_NOT_FOUND, `Local path could not be resolved: ${input.raw_path}`);
    }
    const repository = input.repository_id
      ? this.getById(input.repository_id)
      : this.create({ source: input.raw_path, runtime_id: runtimeId });

    let identity: string;
    try {
      identity = statIdentity(resolved.real_path);
    } catch {
      throw new AppError(ErrorCode.WORKSPACE_PATH_NOT_READABLE, "Path exists but cannot be stat-ed.");
    }
    const caseInsensitive = probeCaseInsensitive(resolved.real_path);
    const previousScope = this.getMachinePath(repository.id, runtimeId)?.scope_json ?? null;
    const scope =
      input.scope === undefined ? null : JSON.stringify(validateScope(input.scope, caseInsensitive ?? false));

    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO repository_machine_paths
           (repository_id, runtime_id, raw_path, real_path, authorized_identity, access, scope_json, case_insensitive, authorized_at, last_verified_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (repository_id, runtime_id) DO UPDATE SET
           raw_path = excluded.raw_path,
           real_path = excluded.real_path,
           authorized_identity = excluded.authorized_identity,
           access = excluded.access,
           scope_json = excluded.scope_json,
           case_insensitive = excluded.case_insensitive,
           authorized_at = excluded.authorized_at,
           last_verified_at = NULL`,
      )
      .run(
        repository.id,
        runtimeId,
        input.raw_path,
        resolved.real_path,
        identity,
        input.access,
        scope,
        caseInsensitive === null ? null : caseInsensitive ? 1 : 0,
        now,
        null,
      );
    this.audit.record("repository.authorized", "repository", repository.id, {
      runtime_id: runtimeId,
      raw_path: input.raw_path,
      real_path: resolved.real_path,
      access: input.access,
    });
    // 授权范围变化（含首次显式设定）落账，便于回放"授权如何收紧/放宽"。
    const machinePath = this.getMachinePath(repository.id, runtimeId)!;
    if (machinePath.scope_json !== previousScope) {
      this.audit.record("repository.scope_changed", "repository", repository.id, {
        runtime_id: runtimeId,
        previous: previousScope ? (JSON.parse(previousScope) as unknown) : null,
        current: machinePath.scope_json ? (JSON.parse(machinePath.scope_json) as unknown) : null,
      });
    }
    return { repository, machine_path: machinePath };
  }

  revoke(repositoryId: string, runtimeId: string = LOCAL_RUNTIME_ID): void {
    const row = this.getMachinePath(repositoryId, runtimeId);
    if (!row) return;
    this.db
      .prepare("DELETE FROM repository_machine_paths WHERE repository_id = ? AND runtime_id = ?")
      .run(repositoryId, runtimeId);
    this.audit.record("repository.revoked", "repository", repositoryId, { runtime_id: runtimeId });
  }

  getMachinePath(repositoryId: string, runtimeId: string): MachinePathRow | null {
    const row = this.db
      .prepare("SELECT * FROM repository_machine_paths WHERE repository_id = ? AND runtime_id = ?")
      .get(repositoryId, runtimeId) as MachinePathRow | undefined;
    return row ?? null;
  }

  getProjectRef(projectId: string, repositoryId: string): ProjectRefRow | null {
    const row = this.db
      .prepare("SELECT * FROM project_repository_refs WHERE project_id = ? AND repository_id = ?")
      .get(projectId, repositoryId) as ProjectRefRow | undefined;
    return row ?? null;
  }

  listProjectRefs(projectId: string): ProjectRefRow[] {
    return this.db
      .prepare("SELECT * FROM project_repository_refs WHERE project_id = ? ORDER BY role ASC, repository_id ASC")
      .all(projectId) as ProjectRefRow[];
  }

  /**
   * F012 唯一可见的只读契约之一（NFR-002 落点）。当场重做三件事：
   * ① 从 raw_path 重新 realpathSync；② 读取当前 identity 并与授权时比对；
   * ③ 计算机器 ∩ 项目 ∩ 任务三层 scope 交集。成功时更新 last_verified_at。
   */
  verifyAuthorization(input: {
    repository_id: string;
    runtime_id?: string;
    project_id: string;
    task_scope?: Scope | null;
  }): AuthorizationVerification {
    const runtimeId = input.runtime_id ?? LOCAL_RUNTIME_ID;
    const machine = this.getMachinePath(input.repository_id, runtimeId);
    if (!machine) {
      return { ok: false, reason: "REPO_NOT_AUTHORIZED" };
    }

    let realPath: string;
    try {
      realPath = fs.realpathSync(machine.raw_path);
    } catch {
      this.recordVerifyFailed(input.repository_id, runtimeId, "REPO_PATH_UNRESOLVED");
      return { ok: false, reason: "REPO_PATH_UNRESOLVED" };
    }

    let identity: string;
    try {
      identity = statIdentity(realPath);
    } catch {
      this.recordVerifyFailed(input.repository_id, runtimeId, "REPO_PATH_UNRESOLVED");
      return { ok: false, reason: "REPO_PATH_UNRESOLVED" };
    }
    if (identity !== machine.authorized_identity) {
      // 覆盖授权后 symlink 换靶、目录删除后重建——路径没变但目标变了。
      this.recordVerifyFailed(input.repository_id, runtimeId, "REPO_IDENTITY_CHANGED");
      return { ok: false, reason: "REPO_IDENTITY_CHANGED" };
    }

    const ref = this.getProjectRef(input.project_id, input.repository_id);
    if (!ref) {
      this.recordVerifyFailed(input.repository_id, runtimeId, "REPO_NOT_AUTHORIZED");
      return { ok: false, reason: "REPO_NOT_AUTHORIZED" };
    }

    // 两级 access 取较严者：read_write 当且仅当两级都是 read_write。
    const access: RepositoryAccess =
      machine.access === "read_write" && ref.access === "read_write" ? "read_write" : "read_only";

    const caseInsensitive = machine.case_insensitive === null ? false : machine.case_insensitive === 1;
    const machineScope = machine.scope_json
      ? (JSON.parse(machine.scope_json) as Scope)
      : defaultMachineScope(machine.access);
    const projectScope = ref.scope_json ? (JSON.parse(ref.scope_json) as Scope) : null;
    const computed = computeEffectiveScope({
      machine: machineScope,
      project: projectScope,
      task: input.task_scope ?? null,
      caseInsensitive,
    });
    // Access is an independent upper bound. A read-only project reference
    // must never return a write scope merely because a malformed/legacy scope
    // row still contains write prefixes.
    const scope: Scope = access === "read_only" ? { ...computed.scope, write: [] } : computed.scope;

    if (scope.read.length === 0) {
      this.recordVerifyFailed(input.repository_id, runtimeId, "REPO_SCOPE_EMPTY");
      return { ok: false, reason: "REPO_SCOPE_EMPTY" };
    }

    const now = new Date().toISOString();
    this.db
      .prepare("UPDATE repository_machine_paths SET last_verified_at = ? WHERE repository_id = ? AND runtime_id = ?")
      .run(now, input.repository_id, runtimeId);
    return { ok: true, real_path: realPath, access, effective_scope: scope, verified_at: now };
  }

  private recordVerifyFailed(repositoryId: string, runtimeId: string, reason: string): void {
    this.audit.record("repository.verify_failed", "repository", repositoryId, {
      runtime_id: runtimeId,
      reason,
    });
  }

  /**
   * PUT /api/projects/:id/repositories（T007）：整体设置 primary + references。
   * 新建 / 改绑 primary 时在同一事务内按 (project_id, local_path_normalized)
   * upsert 一行 legacy workspaces 并回填 projects.default_workspace_id——不复用
   * 其它 Project 的 workspace 行，否则新项目进不了 v0.2 执行链。
   * 新建的 reference 行 legacy_workspace_id 恒为 NULL（只读，不参与 v0.2 执行）。
   */
  setProjectRepositories(
    projectId: string,
    assertProjectWritable: () => void,
    input: {
      primary?: { repository_id: string; access?: RepositoryAccess; scope?: unknown } | null;
      references?: Array<{ repository_id: string; scope?: unknown }>;
    },
  ): void {
    assertProjectWritable();
    const now = new Date().toISOString();

    this.db.transaction(() => {
      const existingRefs = this.listProjectRefs(projectId);
      const referenceInputs = input.references ?? [];
      const referenceIds = referenceInputs.map((reference) => reference.repository_id);
      const allIds = [input.primary?.repository_id, ...referenceIds].filter((id): id is string => Boolean(id));
      if (new Set(allIds).size !== allIds.length) {
        throw new AppError(
          ErrorCode.REPOSITORY_CONFLICT,
          "A repository cannot be both primary and reference or appear twice.",
        );
      }

      // Validate every desired row before changing the old collection. This
      // keeps malformed role swaps and invalid scopes atomic.
      const primaryRepository = input.primary ? this.getById(input.primary.repository_id) : null;
      if (primaryRepository && primaryRepository.kind !== "local_dir") {
        throw new AppError(ErrorCode.REPOSITORY_CONFLICT, "Primary repository must be a local directory.");
      }
      const primaryScope = input.primary?.scope === undefined ? null : validateScope(input.primary.scope);
      const referenceScopes = referenceInputs.map((reference) => {
        const scope = reference.scope === undefined ? null : validateScope(reference.scope);
        if (scope && scope.write.length > 0) {
          throw new AppError(
            ErrorCode.SCOPE_WRITE_NOT_IN_READ,
            "Reference repositories are read-only and cannot declare write scope.",
          );
        }
        this.getById(reference.repository_id);
        return { repository_id: reference.repository_id, scope };
      });

      const keepIds = new Set<string>(allIds);
      if (input.primary) keepIds.add(input.primary.repository_id);

      const existingPrimary = existingRefs.find((ref) => ref.role === "primary");
      const desiredReferenceIds = new Set(referenceIds);

      // Free the partial unique index before promoting a reference. If the old
      // primary is retained as a reference, demote it first; otherwise remove
      // it. Both paths remain inside this transaction.
      if (existingPrimary && existingPrimary.repository_id !== input.primary?.repository_id) {
        if (desiredReferenceIds.has(existingPrimary.repository_id)) {
          this.db
            .prepare(
              "UPDATE project_repository_refs SET role = 'reference', access = 'read_only', scope_json = NULL, legacy_workspace_id = NULL, updated_at = ? WHERE project_id = ? AND repository_id = ?",
            )
            .run(now, projectId, existingPrimary.repository_id);
        } else {
          this.db
            .prepare("DELETE FROM project_repository_refs WHERE project_id = ? AND repository_id = ?")
            .run(projectId, existingPrimary.repository_id);
        }
      }

      // 删除不再被引用的行（保留的更新）。
      for (const ref of existingRefs) {
        if (!keepIds.has(ref.repository_id)) {
          this.db
            .prepare("DELETE FROM project_repository_refs WHERE project_id = ? AND repository_id = ?")
            .run(projectId, ref.repository_id);
        }
      }

      if (input.primary && primaryRepository) {
        const access = input.primary.access ?? "read_write";
        const scopeJson = primaryScope ? JSON.stringify(primaryScope) : null;
        const machine = this.getMachinePath(primaryRepository.id, LOCAL_RUNTIME_ID);
        const legacyWorkspaceId =
          machine?.raw_path && machine.runtime_id === LOCAL_RUNTIME_ID
            ? this.upsertLegacyWorkspace(projectId, machine.raw_path, now)
            : null;
        this.db
          .prepare(
            `INSERT INTO project_repository_refs
               (project_id, repository_id, role, access, scope_json, legacy_workspace_id, created_at, updated_at)
             VALUES (?, ?, 'primary', ?, ?, ?, ?, ?)
             ON CONFLICT (project_id, repository_id) DO UPDATE SET
               role = 'primary', access = excluded.access, scope_json = excluded.scope_json,
               legacy_workspace_id = excluded.legacy_workspace_id, updated_at = excluded.updated_at`,
          )
          .run(projectId, primaryRepository.id, access, scopeJson, legacyWorkspaceId, now, now);

        // 同一事务内回填 projects.default_workspace_id——没有这一步，F013 之后
        // 新建的 Project 拿不到 workspace_id，进不了 v0.2 执行链（design §3）。
        if (legacyWorkspaceId) {
          this.db
            .prepare("UPDATE projects SET default_workspace_id = ?, updated_at = ? WHERE id = ?")
            .run(legacyWorkspaceId, now, projectId);
        } else {
          this.db
            .prepare("UPDATE projects SET default_workspace_id = NULL, updated_at = ? WHERE id = ?")
            .run(now, projectId);
        }
      } else {
        this.db
          .prepare("UPDATE projects SET default_workspace_id = NULL, updated_at = ? WHERE id = ?")
          .run(now, projectId);
      }

      for (const reference of referenceScopes) {
        const scopeJson = reference.scope ? JSON.stringify(reference.scope) : null;
        // access 恒 read_only：CHECK (role = 'primary' OR access = 'read_only') 在数据库层强制。
        this.db
          .prepare(
            `INSERT INTO project_repository_refs
               (project_id, repository_id, role, access, scope_json, legacy_workspace_id, created_at, updated_at)
             VALUES (?, ?, 'reference', 'read_only', ?, NULL, ?, ?)
             ON CONFLICT (project_id, repository_id) DO UPDATE SET
               role = 'reference', access = 'read_only', scope_json = excluded.scope_json, updated_at = excluded.updated_at`,
          )
          .run(projectId, reference.repository_id, scopeJson, now, now);
      }

      this.audit.record("project.refs_changed", "project", projectId, {
        primary: input.primary?.repository_id ?? null,
        references: (input.references ?? []).map((r) => r.repository_id),
      });
    })();
  }

  /**
   * legacy workspace upsert（(project_id, local_path_normalized) 唯一）。
   * 返回可写入 project_repository_refs.legacy_workspace_id 的 workspace id。
   */
  private upsertLegacyWorkspace(projectId: string, rawPath: string, now: string): string {
    const resolved = path.resolve(rawPath);
    const normalized = process.platform === "win32" ? resolved.toLowerCase() : resolved;
    const existing = this.db
      .prepare("SELECT id FROM workspaces WHERE project_id = ? AND local_path_normalized = ?")
      .get(projectId, normalized) as { id: string } | undefined;
    if (existing) {
      this.db
        .prepare("UPDATE workspaces SET local_path = ?, updated_at = ? WHERE id = ?")
        .run(resolved, now, existing.id);
      return existing.id;
    }
    const id = generateWorkspaceId();
    this.db
      .prepare(
        `INSERT INTO workspaces (id, project_id, local_path, local_path_normalized, git_branch, lock_state, locked_by_run_id, locked_at, push_credentials_enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, NULL, 'idle', NULL, NULL, 0, ?, ?)`,
      )
      .run(id, projectId, resolved, normalized, now, now);
    return id;
  }
}
