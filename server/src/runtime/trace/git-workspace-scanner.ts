import { spawnSync } from "node:child_process";
import type { FileChangeDraft, ScanLimits, WorkspaceSnapshot, FileEntry } from "./snapshot-types.js";
import { DEFAULT_SCAN_LIMITS } from "./snapshot-types.js";
import { SCAN_REASON_CODES } from "./constants.js";
import { scanTree, diffSnapshotEntries } from "./snapshot-scan.js";

const GIT_TIMEOUT_MS = 10_000;
const SCANNER_VERSION = 1;

function runGit(workspacePath: string, args: string[]): { ok: boolean; stdout: string; stderr: string } {
  try {
    const result = spawnSync("git", args, {
      cwd: workspacePath,
      timeout: GIT_TIMEOUT_MS,
      encoding: "utf-8",
      shell: false,
      windowsHide: true,
    });
    if (result.error) {
      return { ok: false, stdout: "", stderr: String(result.error) };
    }
    return {
      ok: result.status === 0,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
    };
  } catch (err) {
    return { ok: false, stdout: "", stderr: String(err) };
  }
}

function isGitWorkspace(workspacePath: string): boolean {
  const result = runGit(workspacePath, ["rev-parse", "--is-inside-work-tree"]);
  return result.ok && result.stdout.trim() === "true";
}

function getHeadOid(workspacePath: string): string | null {
  const result = runGit(workspacePath, ["rev-parse", "HEAD"]);
  if (!result.ok) return null;
  return result.stdout.trim() || null;
}

function parseGitStatus(output: string): Map<string, string> {
  const status = new Map<string, string>();
  const entries = output.split("\0").filter((s) => s.length > 0);
  for (const entry of entries) {
    if (entry.length < 2) continue;
    const statusCode = entry.substring(0, 2);
    const path = entry.substring(3).replace(/\\/g, "/");
    if (path.length > 0) {
      status.set(path, statusCode);
    }
  }
  return status;
}

export function captureGitSnapshot(
  workspacePath: string,
  limits: ScanLimits = DEFAULT_SCAN_LIMITS,
): WorkspaceSnapshot {
  if (!isGitWorkspace(workspacePath)) {
    return {
      scannerType: "git",
      scanComplete: false,
      scanTruncated: false,
      stopReason: SCAN_REASON_CODES.notAGitWorkspace,
      entries: new Map(),
      headOid: null,
      gitStatus: null,
      scannerVersion: SCANNER_VERSION,
    };
  }

  const headOid = getHeadOid(workspacePath);
  const statusResult = runGit(workspacePath, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);

  if (!statusResult.ok) {
    return {
      scannerType: "git",
      scanComplete: false,
      scanTruncated: false,
      stopReason: SCAN_REASON_CODES.gitUnavailable,
      entries: new Map(),
      headOid,
      gitStatus: null,
      scannerVersion: SCANNER_VERSION,
    };
  }

  const gitStatus = parseGitStatus(statusResult.stdout);
  const entries = new Map<string, FileEntry>();
  const deadline = Date.now() + limits.wallTimeMs;
  const result = scanTree(workspacePath, workspacePath, entries, limits, deadline);

  return {
    scannerType: "git",
    scanComplete: !result.truncated && result.stopReason === null,
    scanTruncated: result.truncated,
    stopReason: result.stopReason,
    entries,
    headOid,
    gitStatus,
    scannerVersion: SCANNER_VERSION,
  };
}

export function diffGitSnapshots(
  before: WorkspaceSnapshot,
  after: WorkspaceSnapshot,
): FileChangeDraft[] {
  return diffSnapshotEntries(before, after);
}
