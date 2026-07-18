import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTempDir, cleanupTempDir } from "../helpers.js";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { captureGitSnapshot, diffGitSnapshots } from "../../src/runtime/trace/git-workspace-scanner.js";
import { FileChangeType } from "@personahub/shared/types";

function initGitRepo(dir: string): void {
  execSync("git init", { cwd: dir, encoding: "utf-8", timeout: 5000 });
  execSync('git config user.email "test@test.com"', { cwd: dir, encoding: "utf-8" });
  execSync('git config user.name "Test"', { cwd: dir, encoding: "utf-8" });
}

function gitCommit(dir: string, msg: string): void {
  execSync("git add -A", { cwd: dir, encoding: "utf-8", timeout: 5000 });
  execSync(`git commit -m "${msg}"`, { cwd: dir, encoding: "utf-8", timeout: 5000 });
}

describe("Git Workspace Scanner (T026)", () => {
  let dir: string;

  beforeEach(() => {
    dir = createTempDir();
  });
  afterEach(() => {
    cleanupTempDir(dir);
  });

  it("captures clean baseline after commit", () => {
    initGitRepo(dir);
    writeFileSync(join(dir, "app.ts"), "console.log('hello');");
    gitCommit(dir, "initial");

    const snapshot = captureGitSnapshot(dir);
    expect(snapshot.scanComplete).toBe(true);
    expect(snapshot.scanTruncated).toBe(false);
    expect(snapshot.headOid).not.toBeNull();
    expect(snapshot.gitStatus!.size).toBe(0);
  });

  it("detects added file in final snapshot", () => {
    initGitRepo(dir);
    writeFileSync(join(dir, "existing.ts"), "old");
    gitCommit(dir, "initial");

    const before = captureGitSnapshot(dir);

    writeFileSync(join(dir, "new.ts"), "new content");

    const after = captureGitSnapshot(dir);
    const diffs = diffGitSnapshots(before, after);
    const added = diffs.find(d => d.change_type === FileChangeType.Added);
    expect(added).toBeDefined();
    expect(added!.path).toBe("new.ts");
  });

  it("detects modified file", () => {
    initGitRepo(dir);
    writeFileSync(join(dir, "app.ts"), "original");
    gitCommit(dir, "initial");

    const before = captureGitSnapshot(dir);

    writeFileSync(join(dir, "app.ts"), "modified content");

    const after = captureGitSnapshot(dir);
    const diffs = diffGitSnapshots(before, after);
    const modified = diffs.find(d => d.change_type === FileChangeType.Modified);
    expect(modified).toBeDefined();
    expect(modified!.path).toBe("app.ts");
  });

  it("detects deleted file", () => {
    initGitRepo(dir);
    writeFileSync(join(dir, "app.ts"), "content");
    writeFileSync(join(dir, "remove.ts"), "to be removed");
    gitCommit(dir, "initial");

    const before = captureGitSnapshot(dir);

    rmSync(join(dir, "remove.ts"));

    const after = captureGitSnapshot(dir);
    const diffs = diffGitSnapshots(before, after);
    const deleted = diffs.find(d => d.change_type === FileChangeType.Deleted);
    expect(deleted).toBeDefined();
    expect(deleted!.path).toBe("remove.ts");
  });

  it("pre-existing dirty file committed by agent is not false positive", () => {
    initGitRepo(dir);
    writeFileSync(join(dir, "clean.ts"), "clean committed");
    gitCommit(dir, "initial");

    writeFileSync(join(dir, "dirty.ts"), "dirty before run");

    const before = captureGitSnapshot(dir);

    writeFileSync(join(dir, "dirty.ts"), "dirty after run");
    gitCommit(dir, "agent commit");

    const after = captureGitSnapshot(dir);
    const diffs = diffGitSnapshots(before, after);
    const modified = diffs.find(d => d.path === "dirty.ts");
    expect(modified).toBeDefined();
    expect(modified!.change_type).toBe(FileChangeType.Modified);
  });

  it("returns not_a_git_workspace for non-git directory", () => {
    writeFileSync(join(dir, "app.ts"), "content");
    const snapshot = captureGitSnapshot(dir);
    expect(snapshot.stopReason).toBe("not_a_git_workspace");
    expect(snapshot.scanComplete).toBe(false);
  });

  it("handles unborn repo (no commits)", () => {
    initGitRepo(dir);
    writeFileSync(join(dir, "app.ts"), "content");

    const snapshot = captureGitSnapshot(dir);
    expect(snapshot.headOid).toBeNull();
    expect(snapshot.scanComplete).toBe(true);
  });
}, { timeout: 30000 });
