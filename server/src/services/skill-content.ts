// F013: Skill revision 内容的规范化 JSON 与 content_hash（design.md §3）。
// content_hash 是规范化 JSON（键排序、去空白）的 SHA-256，既是 revision 的
// 完整性锚点，也让"同内容重复导入"可判定。

import { createHash } from "node:crypto";

/** 键排序、无空白的确定性 JSON 序列化。数组顺序保留（有语义，如 steps 的 order）。 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const keys = Object.keys(value).sort();
  const body = keys
    .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`)
    .join(",");
  return `{${body}}`;
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** 逐文件快照校验用：Buffer 内容的 SHA-256。 */
export function sha256HexOfBuffer(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}
