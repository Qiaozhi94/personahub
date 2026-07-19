import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTempDir, cleanupTempDir } from "../helpers.js";
import { writeFileSync, mkdirSync, rmSync, symlinkSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { captureFilesystemSnapshot, diffFilesystemSnapshots } from "../../src/runtime/trace/filesystem-workspace-scanner.js";
import { FileChangeType } from "@personahub/shared/types";

describe("Filesystem Workspace Scanner (T028)", () => {
  let dir: string;

  beforeEach(() => {
    dir = createTempDir();
  });
  afterEach(() => {
    cleanupTempDir(dir);
  });

  it("captures files in empty workspace", () => {
    const snapshot = captureFilesystemSnapshot(dir);
    expect(snapshot.scanComplete).toBe(true);
    expect(snapshot.entries.size).toBe(0);
  });

  it("detects added file", () => {
    const before = captureFilesystemSnapshot(dir);
    writeFileSync(join(dir, "new.ts"), "content");
    const after = captureFilesystemSnapshot(dir);
    const diffs = diffFilesystemSnapshots(before, after);
    expect(diffs).toHaveLength(1);
    expect(diffs[0].change_type).toBe(FileChangeType.Added);
    expect(diffs[0].path).toBe("new.ts");
  });

  it("detects modified file", () => {
    writeFileSync(join(dir, "app.ts"), "original");
    const before = captureFilesystemSnapshot(dir);
    writeFileSync(join(dir, "app.ts"), "modified");
    const after = captureFilesystemSnapshot(dir);
    const diffs = diffFilesystemSnapshots(before, after);
    const modified = diffs.find(d => d.change_type === FileChangeType.Modified);
    expect(modified).toBeDefined();
  });

  it("detects deleted file", () => {
    writeFileSync(join(dir, "remove.ts"), "content");
    const before = captureFilesystemSnapshot(dir);
    rmSync(join(dir, "remove.ts"));
    const after = captureFilesystemSnapshot(dir);
    const diffs = diffFilesystemSnapshots(before, after);
    const deleted = diffs.find(d => d.change_type === FileChangeType.Deleted);
    expect(deleted).toBeDefined();
  });

  it("computes SHA-256 fingerprint for small files", () => {
    writeFileSync(join(dir, "app.ts"), "hello");
    const snapshot = captureFilesystemSnapshot(dir);
    const entry = snapshot.entries.get("app.ts");
    expect(entry).toBeDefined();
    expect(entry!.fingerprint).toHaveLength(64);
    expect(entry!.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it("uses size+mtime for large files", () => {
    const largeContent = "x".repeat(9 * 1024 * 1024);
    writeFileSync(join(dir, "large.bin"), largeContent);
    const snapshot = captureFilesystemSnapshot(dir);
    const entry = snapshot.entries.get("large.bin");
    expect(entry).toBeDefined();
    expect(entry!.fingerprint).toContain("size:");
    expect(entry!.fingerprint).toContain("mtime:");
  });

  it("ignores node_modules and .git directories", () => {
    mkdirSync(join(dir, "node_modules"));
    mkdirSync(join(dir, ".git"));
    writeFileSync(join(dir, "node_modules", "pkg.js"), "code");
    writeFileSync(join(dir, ".git", "config"), "config");
    writeFileSync(join(dir, "app.ts"), "app");

    const snapshot = captureFilesystemSnapshot(dir);
    expect(snapshot.entries.has("app.ts")).toBe(true);
    expect(snapshot.entries.has("node_modules/pkg.js")).toBe(false);
    expect(snapshot.entries.has(".git/config")).toBe(false);
  });

  it("uses deterministic lexical traversal order", () => {
    writeFileSync(join(dir, "z.ts"), "z");
    writeFileSync(join(dir, "a.ts"), "a");
    writeFileSync(join(dir, "m.ts"), "m");

    const snapshot1 = captureFilesystemSnapshot(dir);
    const snapshot2 = captureFilesystemSnapshot(dir);
    const paths1 = Array.from(snapshot1.entries.keys());
    const paths2 = Array.from(snapshot2.entries.keys());
    expect(paths1).toEqual(paths2);
    expect(paths1).toEqual(["a.ts", "m.ts", "z.ts"]);
  });

  it("does not produce false added/deleted when snapshot is truncated", () => {
    for (let i = 0; i < 100; i++) {
      writeFileSync(join(dir, `file${i}.ts`), `content${i}`);
    }
    const before = captureFilesystemSnapshot(dir, {
      wallTimeMs: 10_000, maxEntries: 50, hashedBytesPerFile: 8 * 1024 * 1024, persistedChanges: 5000,
    });
    writeFileSync(join(dir, "new.ts"), "new");
    const after = captureFilesystemSnapshot(dir, {
      wallTimeMs: 10_000, maxEntries: 50, hashedBytesPerFile: 8 * 1024 * 1024, persistedChanges: 5000,
    });
    const diffs = diffFilesystemSnapshots(before, after);
    const added = diffs.filter(d => d.change_type === FileChangeType.Added);
    const deleted = diffs.filter(d => d.change_type === FileChangeType.Deleted);
    const modified = diffs.filter(d => d.change_type === FileChangeType.Modified);
    expect(added.length + deleted.length).toBe(0);
    expect(modified.length).toBeGreaterThanOrEqual(0);
  });

  it.runIf(process.platform !== "win32")("does not follow symlinks outside workspace", () => {
    const outsideDir = createTempDir();
    writeFileSync(join(outsideDir, "secret.txt"), "secret");
    try {
      symlinkSync(outsideDir, join(dir, "link"));
      writeFileSync(join(dir, "app.ts"), "app");
      const snapshot = captureFilesystemSnapshot(dir);
      expect(snapshot.entries.has("app.ts")).toBe(true);
      expect(snapshot.entries.has("link/secret.txt")).toBe(false);
    } finally {
      cleanupTempDir(outsideDir);
    }
  });

  it.runIf(process.platform !== "win32")("does not produce false added/deleted when subdirectory is permission denied (T089)", () => {
    mkdirSync(join(dir, "sub"));
    writeFileSync(join(dir, "sub", "file.ts"), "content");
    writeFileSync(join(dir, "root.ts"), "root");

    const before = captureFilesystemSnapshot(dir);
    expect(before.scanComplete).toBe(true);
    expect(before.entries.has("root.ts")).toBe(true);
    expect(before.entries.has("sub/file.ts")).toBe(true);

    chmodSync(join(dir, "sub"), 0o000);

    try {
      const after = captureFilesystemSnapshot(dir);
      // Permission denied means incomplete but NOT truncated
      expect(after.scanComplete).toBe(false);
      expect(after.scanTruncated).toBe(false);
      expect(after.stopReason).toBe("permission_denied");

      // Root file still visible; sub dir not traversed
      expect(after.entries.has("root.ts")).toBe(true);
      expect(after.entries.has("sub/file.ts")).toBe(false);

      // No false added/deleted (bothComplete is false when scanComplete is false)
      const diffs = diffFilesystemSnapshots(before, after);
      const added = diffs.filter(d => d.change_type === FileChangeType.Added);
      const deleted = diffs.filter(d => d.change_type === FileChangeType.Deleted);
      expect(added.length).toBe(0);
      expect(deleted.length).toBe(0);
    } finally {
      chmodSync(join(dir, "sub"), 0o755);
    }
  });
});
