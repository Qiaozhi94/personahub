// F013 T004: Scope 契约——前缀校验、containment 与三层交集（design.md §3 scope schema）。
// 纯函数，无 IO，供入库校验与 verifyAuthorization 共用。

import path from "node:path";
import { ErrorCode } from "@personahub/shared/errors";
import type { RepositoryAccess, Scope } from "@personahub/shared/types";
import { AppError } from "../api/errors.js";

export class ScopeValidationError extends AppError {
  constructor(
    public readonly reason: "SCOPE_INVALID_PREFIX" | "SCOPE_WRITE_NOT_IN_READ",
    message: string,
    public readonly prefix?: string,
  ) {
    super(
      reason === "SCOPE_INVALID_PREFIX" ? ErrorCode.SCOPE_INVALID_PREFIX : ErrorCode.SCOPE_WRITE_NOT_IN_READ,
      message,
      "scope",
      { prefix },
    );
  }
}

const CONTROL_CHARS = /[\x00-\x1f\x7f]/;

/**
 * 第 0 步：整仓别名归一（在任何拒绝规则之前）。字面量 ""、"."、"/" 都表示
 * 整仓，一律归一成 ""。只接受恰好一个字符的 "/"；"/src" 不在此列，走拒绝规则。
 * 返回 null 表示整仓。
 */
export function normalizeScopePrefix(raw: string): string | null {
  if (raw === "" || raw === "." || raw === "/") return null;

  // 第 1 步逐条校验（对归一后非空的前缀）。任一不通过即整体拒绝，
  // 不静默丢弃该条——否则用户以为限制生效了。
  if (CONTROL_CHARS.test(raw)) {
    throw new ScopeValidationError("SCOPE_INVALID_PREFIX", "Scope prefix contains NUL or control characters", raw);
  }
  if (raw.includes("\\")) {
    throw new ScopeValidationError("SCOPE_INVALID_PREFIX", "Scope prefix must use / (backslash is rejected)", raw);
  }
  // POSIX 的 isAbsolute 不认 Windows 盘符与 UNC，显式拒绝。
  if (path.posix.isAbsolute(raw)) {
    throw new ScopeValidationError("SCOPE_INVALID_PREFIX", "Scope prefix must be a relative path", raw);
  }
  if (/^[A-Za-z]:/.test(raw)) {
    throw new ScopeValidationError("SCOPE_INVALID_PREFIX", "Windows drive prefixes are not allowed", raw);
  }
  if (/^\\\\/.test(raw)) {
    throw new ScopeValidationError("SCOPE_INVALID_PREFIX", "UNC prefixes are not allowed", raw);
  }

  let normalized = path.posix.normalize(raw);
  // 其余归一：去掉尾部 /（path.posix.normalize 会保留它）。
  normalized = normalized.replace(/\/+$/, "");
  if (normalized === ".." || normalized.startsWith("../")) {
    throw new ScopeValidationError("SCOPE_INVALID_PREFIX", "Scope prefix escapes the repository root", raw);
  }
  return normalized === "" ? null : normalized === "." ? null : normalized;
}

/** containment 用规范化后的 path.relative 判断，不用 startsWith（`src/ab` 不在 `src/a` 内）。 */
export function scopePrefixContained(prefix: string, container: string, caseInsensitive: boolean): boolean {
  if (container === "") return true; // 整仓包含一切
  if (prefix === "") return false;
  const cmp = (value: string): string => (caseInsensitive ? value.toLowerCase() : value);
  const rel = path.posix.relative(cmp(container), cmp(prefix));
  return rel === "" || (!rel.startsWith("../") && rel !== ".." && !path.posix.isAbsolute(rel));
}

/** 同数组去重：同值合并；被同数组另一前缀包含的保留较短者。保持首现顺序。 */
function dedupePrefixes(prefixes: string[], caseInsensitive: boolean): string[] {
  const kept: string[] = [];
  for (const prefix of prefixes) {
    // 已保留项包含新项 → 丢弃新项；新项包含已保留项 → 顶替它。
    let absorbed = false;
    for (let i = 0; i < kept.length; i += 1) {
      if (scopePrefixContained(prefix, kept[i], caseInsensitive)) {
        absorbed = true;
        break;
      }
    }
    if (absorbed) continue;
    for (let i = kept.length - 1; i >= 0; i -= 1) {
      if (scopePrefixContained(kept[i], prefix, caseInsensitive)) {
        kept.splice(i, 1);
      }
    }
    kept.push(prefix);
  }
  return kept;
}

function parsePrefixList(value: unknown, field: "read" | "write"): string[] {
  if (!Array.isArray(value)) {
    throw new ScopeValidationError("SCOPE_INVALID_PREFIX", `scope.${field} must be an array`);
  }
  const normalized: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") {
      throw new ScopeValidationError("SCOPE_INVALID_PREFIX", `scope.${field} entries must be strings`);
    }
    const normalizedEntry = normalizeScopePrefix(entry);
    if (normalizedEntry === null) {
      normalized.push(""); // 整仓别名
    } else {
      normalized.push(normalizedEntry);
    }
  }
  return normalized;
}

/**
 * 入库前的整体校验：read/write 归一与去重，随后断言 write ⊆ read
 * （不满足返回 SCOPE_WRITE_NOT_IN_READ）。caseInsensitive 传机器授权行实测的
 * 大小写行为；NULL 一律按敏感处理（没有任何平台走"默认不敏感"）。
 */
export function validateScope(raw: unknown, caseInsensitive = false): Scope {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new ScopeValidationError("SCOPE_INVALID_PREFIX", "scope must be an object with read/write arrays");
  }
  const candidate = raw as Record<string, unknown>;
  if (!("read" in candidate) || !("write" in candidate)) {
    throw new ScopeValidationError("SCOPE_INVALID_PREFIX", "scope requires read and write arrays");
  }
  const read = dedupePrefixes(parsePrefixList(candidate.read, "read"), caseInsensitive);
  const write = dedupePrefixes(parsePrefixList(candidate.write, "write"), caseInsensitive);

  for (const writePrefix of write) {
    if (!read.some((readPrefix) => scopePrefixContained(writePrefix, readPrefix, caseInsensitive))) {
      throw new ScopeValidationError(
        "SCOPE_WRITE_NOT_IN_READ",
        `scope.write prefix "${writePrefix || "(整仓)"}" is not contained in scope.read`,
        writePrefix,
      );
    }
  }
  return { read, write };
}

/** 机器级缺省：read_write → 整仓读写；read_only → 整仓只读。 */
export function defaultMachineScope(access: RepositoryAccess): Scope {
  return access === "read_write" ? { read: [""], write: [""] } : { read: [""], write: [] };
}

export interface EffectiveScopeResult {
  scope: Scope;
  /** 因下层前缀未被上层包含而被丢弃（scope_narrowed）的前缀，附丢弃时所在层。 */
  narrowed: Array<{ layer: "project" | "task"; scope: "read" | "write"; prefix: string }>;
}

/**
 * 三层交集（机器 ∩ 项目 ∩ 任务，design §3 / §5）：
 * - effective.read 逐层 containment 收窄——下层的每个前缀必须被上层某个前缀包含，
 *   否则丢弃并记 scope_narrowed；
 * - effective.write = read ∩ 各层 write；任何一层 write 为空，结果 write 即为空。
 * 层缺省（scope_json 为 NULL）= 继承上层；空数组 = 显式不允许。
 */
export function computeEffectiveScope(input: {
  machine: Scope;
  project?: Scope | null;
  task?: Scope | null;
  caseInsensitive: boolean;
}): EffectiveScopeResult {
  const narrowed: EffectiveScopeResult["narrowed"] = [];
  const { machine, caseInsensitive } = input;

  let read = machine.read;
  let write = machine.write;

  const layers: Array<{ name: "project" | "task"; scope: Scope | null | undefined }> = [
    { name: "project", scope: input.project },
    { name: "task", scope: input.task },
  ];

  for (const layer of layers) {
    if (!layer.scope) continue; // 缺省继承上层

    const nextRead: string[] = [];
    for (const prefix of layer.scope.read) {
      if (read.some((upper) => scopePrefixContained(prefix, upper, caseInsensitive))) {
        nextRead.push(prefix);
      } else {
        narrowed.push({ layer: layer.name, scope: "read", prefix });
      }
    }
    read = dedupePrefixes(nextRead, caseInsensitive);

    // 下层 write 必须是下层 read 的子集（入库校验已保证）；这里再对上层收窄。
    const nextWrite: string[] = [];
    for (const prefix of layer.scope.write) {
      if (
        read.some((upper) => scopePrefixContained(prefix, upper, caseInsensitive)) &&
        layer.scope.read.some((lowerRead) => scopePrefixContained(prefix, lowerRead, caseInsensitive))
      ) {
        nextWrite.push(prefix);
      } else {
        narrowed.push({ layer: layer.name, scope: "write", prefix });
      }
    }
    write = dedupePrefixes(nextWrite, caseInsensitive);
  }

  return { scope: { read, write }, narrowed };
}
