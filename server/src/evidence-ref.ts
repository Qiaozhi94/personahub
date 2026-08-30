/**
 * 统一的 typed evidence ref 构造与解析。所有 `<prefix>:<id>` 形式的 evidence ref
 * 从这里生成和解析，不要在别处写模板字符串或比较前缀字面量
 * （与 `id.ts` 对 ULID 生成的约定同源）。
 *
 * ADR 0014 P4：此前只有解析侧收敛（`parseEvidenceRef`），构造侧散在 7 个文件
 * 的 18 处模板字符串里。现在两个方向都从 `REF_PREFIX_BY_KIND` 派生，新增一种
 * ref 种类（F009 计划中的 `artifact:`）只需改这张表一行。
 *
 * 层中立：runtime / services / api 均可直接导入，不构成跨层反向依赖。
 */

/** 已知的 evidence ref 种类。新增种类时同步扩展 `REF_PREFIX_BY_KIND`。 */
export type EvidenceRefKind = "event" | "file_change_set";

/** 解析结果的 kind：已知种类，或无法识别的 `unknown`。 */
export type ParsedRefKind = EvidenceRefKind | "unknown";

export interface ParsedRef {
  kind: ParsedRefKind;
  id: string;
}

/**
 * kind -> 线上前缀。这是 ref 线格式的唯一真相源；`buildEvidenceRef` 与
 * `parseEvidenceRef` 都从它派生，因此两个方向不可能漂移。
 */
const REF_PREFIX_BY_KIND: Record<EvidenceRefKind, string> = {
  event: "event",
  file_change_set: "file-change-set",
};

const REF_KIND_BY_PREFIX = new Map<string, EvidenceRefKind>(
  (Object.entries(REF_PREFIX_BY_KIND) as [EvidenceRefKind, string][]).map(([kind, prefix]) => [prefix, kind]),
);

/**
 * 构造一个 typed evidence ref。
 *
 * 调用方拿到的 id 必须已经是对应实体的 id（`event` 对 ThreadEvent.id，
 * `file_change_set` 对 Run.id）；本函数不校验 id 是否存在，那是
 * `EvidenceService.resolve()` 在 scope 内的职责。
 */
export function buildEvidenceRef(kind: EvidenceRefKind, id: string): string {
  return `${REF_PREFIX_BY_KIND[kind]}:${id}`;
}

/**
 * 解析一个 typed evidence ref。
 *
 * 无法识别的输入一律返回 `kind: "unknown"` 而不抛异常——ref 可能来自 agent 输出，
 * 未知种类必须走可观察的 missing/invalid 路径，不能中断解析流程。
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
  const id = ref.substring(colonIdx + 1);
  const kind = REF_KIND_BY_PREFIX.get(prefix);
  return kind ? { kind, id } : { kind: "unknown", id };
}
