import { describe, it, expect } from "vitest";
import { normalizeWorkspacePath, isPathWithinWorkspace, shouldIgnorePath } from "../../src/runtime/trace/path-utils.js";
import { createTempDir } from "../helpers.js";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

describe("Path Normalization (T024)", () => {
  it("normalizes relative path to workspace-relative", () => {
    const tmp = createTempDir();
    const result = normalizeWorkspacePath(tmp, join(tmp, "src", "app.ts"));
    expect(result).toBe("src/app.ts");
  });

  it("returns . for workspace root", () => {
    const tmp = createTempDir();
    const result = normalizeWorkspacePath(tmp, tmp);
    expect(result).toBe(".");
  });

  it("converts Windows backslashes to forward slashes", () => {
    const tmp = createTempDir();
    const inputPath = join(tmp, "src", "app.ts");
    const result = normalizeWorkspacePath(tmp, inputPath);
    expect(result).not.toContain("\\");
  });

  it("rejects path with NUL character", () => {
    const tmp = createTempDir();
    const result = normalizeWorkspacePath(tmp, join(tmp, "src\0app.ts"));
    expect(result).toBeNull();
  });

  it("rejects path with .. that escapes workspace", () => {
    const tmp = createTempDir();
    const escaping = join(tmp, "..", "..", "etc", "passwd");
    const result = normalizeWorkspacePath(tmp, escaping);
    expect(result).toBeNull();
  });

  it("rejects path exceeding max bytes", () => {
    const tmp = createTempDir();
    const longName = "a".repeat(2000);
    const result = normalizeWorkspacePath(tmp, join(tmp, longName));
    expect(result).toBeNull();
  });

  it("rejects empty string", () => {
    const tmp = createTempDir();
    expect(normalizeWorkspacePath(tmp, "")).toBeNull();
  });

  it("isPathWithinWorkspace returns true for inside path", () => {
    const tmp = createTempDir();
    expect(isPathWithinWorkspace(tmp, join(tmp, "src"))).toBe(true);
  });

  it("isPathWithinWorkspace returns false for outside path", () => {
    const tmp = createTempDir();
    expect(isPathWithinWorkspace(tmp, join(tmp, "..", "outside"))).toBe(false);
  });
});

describe("Ignore Rules (T024)", () => {
  it("ignores .git directory", () => {
    expect(shouldIgnorePath(".git/config")).toBe(true);
  });

  it("ignores node_modules", () => {
    expect(shouldIgnorePath("node_modules/react/index.js")).toBe(true);
  });

  it("ignores __pycache__", () => {
    expect(shouldIgnorePath("__pycache__/app.cpython-311.pyc")).toBe(true);
  });

  it("ignores .db files", () => {
    expect(shouldIgnorePath("data/test.db")).toBe(true);
  });

  it("ignores .db-shm files", () => {
    expect(shouldIgnorePath("data/test.db-shm")).toBe(true);
  });

  it("ignores .db-wal files", () => {
    expect(shouldIgnorePath("data/test.db-wal")).toBe(true);
  });

  it("does not ignore dist directory", () => {
    expect(shouldIgnorePath("dist/bundle.js")).toBe(false);
  });

  it("does not ignore build directory", () => {
    expect(shouldIgnorePath("build/output.js")).toBe(false);
  });

  it("does not ignore normal source files", () => {
    expect(shouldIgnorePath("src/app.ts")).toBe(false);
  });
});
