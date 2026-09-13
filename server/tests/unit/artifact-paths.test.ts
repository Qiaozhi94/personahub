import { describe, it, expect } from "vitest";
import { isPathWithinRoot, toPosixLocator } from "../../src/services/artifact/paths.js";

// F010 code review R4-020: `source_relative_path` is persisted and served over
// the API, so it must not depend on which OS published the revision. Windows CI
// caught `docs\report.md` where every other platform records `docs/report.md`.
// `separator` is injected here so the Windows shape is assertable everywhere.

describe("F010 source locator normalization", () => {
  it("rewrites Windows separators into a stable POSIX locator", () => {
    expect(toPosixLocator("docs\\report.md", "\\")).toBe("docs/report.md");
    expect(toPosixLocator("a\\b\\c.md", "\\")).toBe("a/b/c.md");
  });

  it("leaves an already-POSIX locator untouched", () => {
    expect(toPosixLocator("docs/report.md", "/")).toBe("docs/report.md");
    expect(toPosixLocator("report.md", "/")).toBe("report.md");
  });

  it("never emits a backslash, whichever separator produced the input", () => {
    for (const [input, separator] of [
      ["docs\\deep\\report.md", "\\"],
      ["docs/deep/report.md", "/"],
    ] as const) {
      expect(toPosixLocator(input, separator)).not.toContain("\\");
    }
  });
});

describe("F010 path boundary comparison", () => {
  it("keeps the boundary check case-sensitive by default and foldable on demand", () => {
    expect(isPathWithinRoot("/root", "/root/docs/a.md")).toBe(true);
    expect(isPathWithinRoot("/root", "/rooted/a.md")).toBe(false);
    expect(isPathWithinRoot("/root", "/ROOT/a.md")).toBe(false);
    expect(isPathWithinRoot("/root", "/ROOT/a.md", { caseInsensitive: true })).toBe(true);
  });

  it("rejects the root itself and any escape", () => {
    expect(isPathWithinRoot("/root", "/root")).toBe(false);
    expect(isPathWithinRoot("/root", "/etc/passwd")).toBe(false);
  });
});
