import { describe, it, expect } from "vitest";
import {
  computeEffectiveScope,
  defaultMachineScope,
  normalizeScopePrefix,
  ScopeValidationError,
  scopePrefixContained,
  validateScope,
} from "../../src/services/scope.js";

// F013 AC-002 (design §8 scope-validation)：整仓别名归一先于拒绝规则；五类非法
// 前缀逐一被拒；containment 用 path.relative 语义；去重保留较短者；大小写一律
// 以实测为准（NULL 按敏感），不按平台名假定；write ⊆ read 断言。

describe("F013 AC-002: scope prefix validation", () => {
  it("normalizes the three whole-repo aliases before any rejection rule", () => {
    // "" / "." / "/" 都表示整仓：第 0 步先于第 1 步执行（"/" 是绝对路径，
    // 若拒绝规则先行会自相矛盾）。
    expect(normalizeScopePrefix("")).toBeNull();
    expect(normalizeScopePrefix(".")).toBeNull();
    expect(normalizeScopePrefix("/")).toBeNull();
  });

  it("still rejects /src as an absolute path", () => {
    expect(() => normalizeScopePrefix("/src")).toThrow(ScopeValidationError);
  });

  it("rejects the five illegal prefix classes with SCOPE_INVALID_PREFIX", () => {
    const illegal: Array<[string, RegExp]> = [
      ["C:\\x", /drive|backslash/i], // Windows 盘符
      ["\\\\server\\share", /backslash/i], // UNC（反斜杠规则先于绝对路径判断）
      ["../..", /escape/i], // 逃逸
      ["a\x00b", /control/i], // NUL / 控制字符
      ["src\\sub", /backslash/i], // 反斜杠
    ];
    for (const [prefix, pattern] of illegal) {
      try {
        normalizeScopePrefix(prefix);
        expect.unreachable(`${prefix} must be rejected`);
      } catch (error) {
        expect(error).toBeInstanceOf(ScopeValidationError);
        expect((error as ScopeValidationError).reason).toBe("SCOPE_INVALID_PREFIX");
        expect((error as Error).message).toMatch(pattern);
      }
    }
  });

  it("normalizes trailing slashes, duplicate slashes and dot segments", () => {
    expect(normalizeScopePrefix("src/")).toBe("src");
    expect(normalizeScopePrefix("src//sub")).toBe("src/sub");
    expect(normalizeScopePrefix("src/./sub")).toBe("src/sub");
    expect(normalizeScopePrefix("src/../sib")).toBe("sib"); // 未逃逸根，合法
  });

  it("dedupes equal and contained prefixes keeping the shorter (more general)", () => {
    const scope = validateScope({ read: ["src", "src", "src/a", "docs"], write: ["src/a"] });
    expect(scope.read).toEqual(["src", "docs"]); // 保持首现顺序
    expect(scope.write).toEqual(["src/a"]);
  });

  it("asserts write ⊆ read with SCOPE_WRITE_NOT_IN_READ", () => {
    try {
      validateScope({ read: ["src"], write: ["docs"] });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ScopeValidationError);
      expect((error as ScopeValidationError).reason).toBe("SCOPE_WRITE_NOT_IN_READ");
    }
  });
});

describe("F013 AC-002: containment semantics", () => {
  it("never treats a longer sibling as contained (path.relative, not startsWith)", () => {
    expect(scopePrefixContained("src/ab", "src/a", false)).toBe(false);
    expect(scopePrefixContained("src/a", "src", false)).toBe(true);
    expect(scopePrefixContained("src", "", false)).toBe(true);
    expect(scopePrefixContained("", "src", false)).toBe(false);
  });

  it("compares case-sensitively when measurement says sensitive or is unknown", () => {
    expect(scopePrefixContained("SRC/a", "src", false)).toBe(false);
  });

  it("compares case-insensitively only when the authorization measured it", () => {
    expect(scopePrefixContained("SRC/a", "src", true)).toBe(true);
  });
});

describe("F013 AC-002: three-layer scope intersection", () => {
  it("machine read_write defaults to whole-repo read and write", () => {
    expect(defaultMachineScope("read_write")).toEqual({ read: [""], write: [""] });
    expect(defaultMachineScope("read_only")).toEqual({ read: [""], write: [] });
  });

  it("narrows read layer by layer and reports narrowed prefixes", () => {
    const result = computeEffectiveScope({
      machine: { read: [""], write: [""] },
      project: { read: ["src"], write: ["src"] },
      task: { read: ["src/lib"], write: ["src/lib"] },
      caseInsensitive: false,
    });
    expect(result.scope.read).toEqual(["src/lib"]);
    expect(result.scope.write).toEqual(["src/lib"]);
    expect(result.narrowed).toHaveLength(0);
  });

  it("drops lower prefixes not contained upstream with a scope_narrowed diagnostic", () => {
    const result = computeEffectiveScope({
      machine: { read: ["src"], write: [] },
      project: { read: ["docs", "src/ok"], write: [] },
      caseInsensitive: false,
    });
    expect(result.scope.read).toEqual(["src/ok"]);
    expect(result.narrowed).toContainEqual({ layer: "project", scope: "read", prefix: "docs" });
  });

  it("empties the result write when any layer has an empty write (explicit deny)", () => {
    const result = computeEffectiveScope({
      machine: { read: [""], write: [""] },
      project: { read: ["src"], write: [] },
      caseInsensitive: false,
    });
    expect(result.scope.write).toEqual([]);
    expect(result.scope.read).toEqual(["src"]);
  });

  it("never lets a lower write layer widen an upper layer", () => {
    const narrowedByMachine = computeEffectiveScope({
      machine: { read: [""], write: ["src"] },
      project: { read: [""], write: ["docs"] },
      caseInsensitive: false,
    });
    expect(narrowedByMachine.scope.write).toEqual([]);

    const narrowedByProject = computeEffectiveScope({
      machine: { read: [""], write: [""] },
      project: { read: [""], write: [] },
      task: { read: ["src"], write: ["src"] },
      caseInsensitive: false,
    });
    expect(narrowedByProject.scope.write).toEqual([]);
  });

  it("treats a missing project/task layer as inherit and an explicit empty read as deny-all", () => {
    const inherited = computeEffectiveScope({
      machine: { read: ["src"], write: ["src"] },
      project: null,
      caseInsensitive: false,
    });
    expect(inherited.scope).toEqual({ read: ["src"], write: ["src"] });

    const denied = computeEffectiveScope({
      machine: { read: [""], write: [""] },
      project: { read: [], write: [] },
      caseInsensitive: false,
    });
    expect(denied.scope.read).toEqual([]); // 空 → REPO_SCOPE_EMPTY 的判定依据
  });
});
