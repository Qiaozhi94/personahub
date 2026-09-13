/**
 * 统一的 typed evidence ref 构造与解析。所有 `<prefix>:<id>` 形式的 evidence ref
 * 从这里生成和解析，不要在别处写模板字符串或比较前缀字面量
 * （与 `id.ts` 对 ULID 生成的约定同源）。
 *
 * ADR 0014 P4：此前只有解析侧收敛（`parseEvidenceRef`），构造侧散在 7 个文件
 * 的 18 处模板字符串里。现在两个方向都从 `REF_PREFIX_BY_KIND` 派生，新增一种
 * ref 种类（F010 计划中的 `artifact:`）只需改这张表一行，两个方向不可能漂移。
 *
 * F010：新增 `artifact` kind 与可选 revision。公共线格式为
 * `artifact:<artifact_id>@<revision>`，交互读取 current 可省略 `@revision`。
 * `@` 切分与正整数校验只对 artifact 前缀生效——既有 `event` /
 * `file_change_set` 的 id 语义（可能合法包含 `@` 等字符）保持不变。
 *
 * 层中立：runtime / services / api 均可直接导入，不构成跨层反向依赖；
 * 本模块零依赖（不 import shared/errors），错误码映射由调用方完成。
 */

/** 已知的 evidence ref 种类。新增种类时同步扩展 `REF_PREFIX_BY_KIND`。 */
export type EvidenceRefKind = "event" | "file_change_set" | "artifact";

/** 解析结果的 kind：已知种类，或无法识别的 `unknown`。 */
export type ParsedRefKind = EvidenceRefKind | "unknown";

export interface ParsedRef {
  kind: ParsedRefKind;
  id: string;
  /** 仅 artifact kind 携带。缺省表示 floating ref（读取 current）。 */
  revision?: number;
}

/**
 * kind -> 线上前缀。这是 ref 线格式的唯一真相源；`buildEvidenceRef` 与
 * `parseEvidenceRef` 都从它派生，因此两个方向不可能漂移。
 */
const REF_PREFIX_BY_KIND: Record<EvidenceRefKind, string> = {
  event: "event",
  file_change_set: "file-change-set",
  artifact: "artifact",
};

const REF_KIND_BY_PREFIX = new Map<string, EvidenceRefKind>(
  (Object.entries(REF_PREFIX_BY_KIND) as [EvidenceRefKind, string][]).map(([kind, prefix]) => [prefix, kind]),
);

/**
 * 构造一个 typed evidence ref。
 *
 * 调用方拿到的 id 必须已经是对应实体的 id（`event` 对 ThreadEvent.id，
 * `file_change_set` 对 Run.id，`artifact` 对 Artifact.id）；本函数不校验 id
 * 是否存在，那是 resolver / EvidenceService 在 scope 内的职责。
 *
 * `revision` 仅对 artifact 有意义：给定时追加 `@<revision>`。非正整数是
 * 调用方编程错误，直接抛出（解析侧对等输入返回 unknown，不抛）。
 */
export function buildEvidenceRef(kind: EvidenceRefKind, id: string, revision?: number): string {
  const prefix = REF_PREFIX_BY_KIND[kind];
  if (revision === undefined) {
    return `${prefix}:${id}`;
  }
  if (!Number.isSafeInteger(revision) || revision < 1) {
    throw new Error(`Ref revision must be a positive integer, got ${revision}`);
  }
  return `${prefix}:${id}@${revision}`;
}

/**
 * 解析一个 typed evidence ref。
 *
 * 无法识别的输入一律返回 `kind: "unknown"` 而不抛异常——ref 可能来自 agent 输出，
 * 未知种类必须走可观察的 missing/invalid 路径，不能中断解析流程。unknown 结果
 * 在冒号后保留原始 payload 供诊断。
 *
 * artifact 的 `@revision` 必须是规范的正整数：无前导零、十进制且在安全整数
 * 范围内；空 id、重复 `@`、非法 revision 都按 unknown 返回（保留冒号后 payload）。
 */
export function parseEvidenceRef(ref: string): ParsedRef {
  if (typeof ref !== "string" || ref.length === 0) {
    return { kind: "unknown", id: "" };
  }
  const colonIdx = ref.indexOf(":");
  if (colonIdx < 0) {
    return { kind: "unknown", id: ref };
  }
  const prefix = ref.substring(0, colonIdx);
  const payload = ref.substring(colonIdx + 1);
  const kind = REF_KIND_BY_PREFIX.get(prefix);
  if (!kind) {
    return { kind: "unknown", id: payload };
  }
  if (kind !== "artifact") {
    return { kind, id: payload };
  }

  const atIdx = payload.indexOf("@");
  if (atIdx < 0) {
    if (payload.length === 0) {
      return { kind: "unknown", id: payload };
    }
    return { kind, id: payload };
  }
  const id = payload.substring(0, atIdx);
  const revisionPart = payload.substring(atIdx + 1);
  // 重复 `@`、空 id、非规范正整数（前导零 / 溢出安全整数）都不猜意图：按 unknown
  // 返回原始 payload。`009` 若被规范化成 9 会让两个不同线格式消费到同一 revision。
  if (id.length === 0 || revisionPart.includes("@") || !/^[1-9]\d*$/.test(revisionPart)) {
    return { kind: "unknown", id: payload };
  }
  const revision = Number(revisionPart);
  if (!Number.isSafeInteger(revision)) {
    return { kind: "unknown", id: payload };
  }
  return { kind, id, revision };
}

/** Artifact ref 的模式化校验结果。`revision: null` 表示读取 current 指针。 */
export type ArtifactRefCheck =
  | { ok: true; artifactId: string; revision: number | null }
  | { ok: false; reason: "not_artifact" | "missing_revision" };

/**
 * 读取模式：artifact ref 允许无 revision（读 current 指针）；带 revision 的
 * 合法 ref 原样透传。非 artifact 或 unknown ref 不成立。
 *
 * 解析非法（kind 为 unknown，例如 `artifact:id@0`）在 parse 阶段就落为
 * unknown，因此这里只需拒绝非 artifact kind。
 */
export function resolveForRead(parsed: ParsedRef): ArtifactRefCheck {
  if (parsed.kind !== "artifact") {
    return { ok: false, reason: "not_artifact" };
  }
  return { ok: true, artifactId: parsed.id, revision: parsed.revision ?? null };
}

/**
 * 派工 / 消费模式：只接受含确定 revision 的 artifact ref。floating ref、
 * 未知 kind 一律拒绝——禁止调用方绕过该模式把 floating ref 放入 Dispatch
 * snapshot（design §4）。调用方把 `ok: false` 映射为 `ARTIFACT_REF_INVALID`。
 */
export function resolveForDispatch(parsed: ParsedRef): ArtifactRefCheck {
  if (parsed.kind !== "artifact") {
    return { ok: false, reason: "not_artifact" };
  }
  if (parsed.revision === undefined) {
    return { ok: false, reason: "missing_revision" };
  }
  return { ok: true, artifactId: parsed.id, revision: parsed.revision };
}
