/**
 * F010: Artifact & Provenance Foundation 共享契约。
 *
 * 模型是实体 + immutable revision：Artifact 持有一个只进不退的
 * `current_revision` 指针，已发布 revision 行不可原地覆盖。下游只通过
 * `artifact:<id>@<revision>` typed ref 消费确定 revision，历史 ref 永不跟随
 * 指针漂移（spec §5）。字段级冻结契约见 F010 design.md §3；本文件是它的
 * TS 投影，两边必须同步修改。
 */

export type ArtifactState = "active" | "retired";

export type ArtifactStorageKind = "inline_markdown" | "workspace_file";

export interface Artifact {
  id: string;
  /** v0.3 唯一归属列；Project / Workspace 由 Issue 关系推导，不复制第二套归属。 */
  issue_id: string;
  /** 创建与事件回放所属会话；解析拒绝事件也落在这里（可得时）。 */
  thread_id: string;
  type: string;
  title: string;
  state: ArtifactState;
  /** 已发布 revision 指针；创建事务发布 revision 1 后置为 1，不指向草稿。 */
  current_revision: number | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface ArtifactRevision {
  artifact_id: string;
  revision: number;
  storage_kind: ArtifactStorageKind;
  /** inline 专有：正文。file revision 恒为 null。 */
  inline_content: string | null;
  /** file 专有：可变 source locator（只作 provenance，resolver 不读）。 */
  source_relative_path: string | null;
  /** file 专有：不可变 content-addressed archive locator `<2hex>/<sha256>`。 */
  archive_relative_path: string | null;
  /** 原始内容字节的 SHA-256，小写十六进制。 */
  content_hash: string;
  /** 现有 runs 行即 Attempt；Room / Thread / Issue 通过 Run 与 Artifact 外键回放。 */
  source_run_id: string | null;
  created_by: string;
  created_at: string;
}

export interface ArtifactConsumption {
  artifact_id: string;
  revision: number;
  /** Dispatch 表由 F012 拥有；F010 阶段是显式 soft reference，无外键。 */
  dispatch_id: string;
  run_id: string;
  purpose: string;
  consumed_at: string;
}

export interface ArtifactEvidenceLink {
  artifact_id: string;
  revision: number;
  /** 已通过公共 ref parser 解析为已知 kind 的 evidence ref 线格式。 */
  evidence_ref: string;
}

/** Artifact → 反向证据链查询返回的单条关系视图（不复制 Evidence / Run 状态）。 */
export interface ArtifactEvidenceLinkView extends ArtifactEvidenceLink {}

/** provenance 读取：一个 Artifact 的全部来源与消费关系。 */
export interface ArtifactProvenance {
  artifact: Artifact;
  consumptions: ArtifactConsumption[];
  evidence_links: ArtifactEvidenceLinkView[];
}

/**
 * 读取契约（design §6）：显式 discriminated state。`empty` 表示查询成功但
 * 列表无记录；`missing` 表示确定 revision 的 manifest 或 archive 不存在；
 * 两者不得合并。失败态携带稳定错误码、ref 与可安全显示的诊断信息（不含正文）。
 * `loading` 是客户端 hooks 的本地状态，不属于 API 返回。
 */
export type ArtifactReadStatus = "ready" | "empty" | "missing" | "invalid" | "hash_mismatch";

export interface ArtifactReadFailure {
  /** 稳定错误码，与 shared ErrorCode 同名（如 ARTIFACT_REF_INVALID）。 */
  code: string;
  ref: string | null;
  /** 可安全显示的诊断信息；绝不携带 Artifact 正文。 */
  message: string;
}

/** 单实体读取（GET /api/artifacts/:id）。 */
export type ArtifactEntityRead =
  { status: "ready"; artifact: Artifact } | ({ status: "missing" | "invalid" } & ArtifactReadFailure);

/**
 * 确定 revision 读取（GET /api/artifacts/:id/revisions/:revision）。
 * 正文按 storage kind 投影：inline 直出文本；file 以 base64 保真交付
 * （hash 校验基于原始字节，二进制安全），渲染安全由 F011 的只读视图负责。
 */
export type ArtifactRevisionRead =
  | {
      status: "ready";
      artifact: Artifact;
      revision: ArtifactRevision;
      content:
        | { storage_kind: "inline_markdown"; text: string }
        | { storage_kind: "workspace_file"; content_base64: string; size_bytes: number };
    }
  | ({ status: "missing" | "invalid" | "hash_mismatch" } & ArtifactReadFailure);

/** Issue 下 Artifact 列表（GET /api/artifacts?issue_id=...）。 */
export type ArtifactListRead = { status: "empty" } | { status: "ready"; artifacts: Artifact[] };

/** Run 反查消费过的 Artifact revision（GET /api/runs/:id/artifacts）。 */
export type RunArtifactRead = { status: "empty" } | { status: "ready"; consumptions: ArtifactConsumption[] };

/** Evidence ref 反查关联 Artifact（GET /api/evidence/artifacts?ref=...）。 */
export type EvidenceArtifactRead =
  | { status: "empty" }
  | { status: "ready"; items: Array<{ artifact: Artifact; revision: number }> }
  | ({ status: "invalid" } & ArtifactReadFailure);

export type ArtifactProvenanceRead =
  | { status: "ready"; artifact: Artifact; provenance: ArtifactProvenance }
  | ({ status: "missing" } & ArtifactReadFailure);

/** inline / file 互斥的 storage payload；create 与 revise 共用。 */
export type ArtifactStoragePayload =
  { storage_kind: "inline_markdown"; inline_content: string } | { storage_kind: "workspace_file"; source_path: string };

export interface CreateArtifactInput {
  /** 调用方生成的稳定 Artifact ID（客户端 ULID；幂等重放的关键之一）。 */
  artifact_id: string;
  issue_id: string;
  thread_id: string;
  type: string;
  title: string;
  storage: ArtifactStoragePayload;
  source_run_id?: string | null;
  /** 每项都必须先通过公共 ref parser 解析为已知 kind。 */
  evidence_refs?: string[];
  created_by: string;
  idempotency_key: string;
}

export interface ReviseArtifactInput {
  storage: ArtifactStoragePayload;
  source_run_id?: string | null;
  evidence_refs?: string[];
  created_by: string;
  idempotency_key: string;
  /** CAS 期望值；不匹配返回 ARTIFACT_REVISION_CONFLICT。 */
  expected_current_revision: number;
}

export interface ArtifactRevisionWriteResult {
  artifact: Artifact;
  revision: ArtifactRevision;
}
