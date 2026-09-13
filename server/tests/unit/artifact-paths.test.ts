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
  it("folds case on demand; the default deliberately follows platform semantics", () => {
    expect(isPathWithinRoot("/root", "/root/docs/a.md")).toBe(true);
    expect(isPathWithinRoot("/root", "/rooted/a.md")).toBe(false);
    // Explicit folding is platform-independent, so it is safe to assert.
    expect(isPathWithinRoot("/root", "/ROOT/a.md", { caseInsensitive: true })).toBe(true);
    // The *default* is not asserted on purpose: it inherits path.relative's
    // native semantics — case-sensitive on POSIX, insensitive on Win32 — and
    // design §7 wants exactly that. An earlier revision of this test asserted
    // the POSIX answer unconditionally and turned Windows CI red (R5-022).
  });

  it("rejects the root itself and any escape", () => {
    expect(isPathWithinRoot("/root", "/root")).toBe(false);
    expect(isPathWithinRoot("/root", "/etc/passwd")).toBe(false);
  });
});
