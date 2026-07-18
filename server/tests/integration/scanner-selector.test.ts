import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTempDir, cleanupTempDir } from "../helpers.js";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { captureSnapshot, diffSnapshots, snapshotToJson, snapshotFromJson } from "../../src/runtime/trace/workspace-scanner.js";

describe("Scanner Selector (T030)", () => {
  let dir: string;

  beforeEach(() => {
    dir = createTempDir();
  });
  afterEach(() => {
    cleanupTempDir(dir);
  });

  it("uses git scanner for git workspace", () => {
    execSync("git init", { cwd: dir, encoding: "utf-8", timeout: 5000 });
    execSync('git config user.email "t@t.com"', { cwd: dir, encoding: "utf-8" });
    execSync('git config user.name "T"', { cwd: dir, encoding: "utf-8" });
    writeFileSync(join(dir, "app.ts"), "content");
    execSync("git add -A && git commit -m init", { cwd: dir, encoding: "utf-8", timeout: 5000 });

    const result = captureSnapshot(dir);
    expect(result.scannerType).toBe("git");
    expect(result.fallbackReason).toBeNull();
  });

  it("falls back to filesystem for non-git workspace", () => {
    writeFileSync(join(dir, "app.ts"), "content");

    const result = captureSnapshot(dir);
    expect(result.scannerType).toBe("filesystem");
    expect(result.fallbackReason).not.toBeNull();
  });

  it("produces stable reason code when git unavailable", () => {
    writeFileSync(join(dir, "app.ts"), "content");
    const result = captureSnapshot(dir);
    expect(result.fallbackReason).toBeDefined();
  });

  it("diffSnapshots returns changes for matching scanner types", () => {
    writeFileSync(join(dir, "app.ts"), "original");
    const before = captureSnapshot(dir).snapshot;
    writeFileSync(join(dir, "app.ts"), "modified");
    writeFileSync(join(dir, "new.ts"), "new");
    const after = captureSnapshot(dir).snapshot;

    const result = diffSnapshots(before, after);
    expect(result.changes.length).toBeGreaterThan(0);
  });

  it("diffSnapshots returns truncated for mismatched scanner types", () => {
    writeFileSync(join(dir, "app.ts"), "content");
    const fsSnapshot = captureSnapshot(dir).snapshot;

    const gitSnapshot = {
      scannerType: "git" as const,
      scanComplete: true, scanTruncated: false, stopReason: null,
      entries: new Map(), headOid: "abc", gitStatus: new Map(), scannerVersion: 1,
    };

    const result = diffSnapshots(fsSnapshot, gitSnapshot);
    expect(result.truncated).toBe(true);
    expect(result.stopReason).toBe("scanner_type_mismatch");
  });

  it("snapshotToJson and snapshotFromJson round-trip", () => {
    writeFileSync(join(dir, "app.ts"), "content");
    const snapshot = captureSnapshot(dir).snapshot;
    const json = snapshotToJson(snapshot);
    const restored = snapshotFromJson(json);
    expect(restored).not.toBeNull();
    expect(restored!.scannerType).toBe(snapshot.scannerType);
    expect(restored!.entries.size).toBe(snapshot.entries.size);
  });

  it("snapshotFromJson returns null for corrupt json", () => {
    expect(snapshotFromJson("not json")).toBeNull();
  });
});
