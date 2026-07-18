import { FileChangeType } from "@personahub/shared/types";
import type { FileChangeDraft, ScanLimits, WorkspaceSnapshot } from "./snapshot-types.js";
import { DEFAULT_SCAN_LIMITS } from "./snapshot-types.js";
import { captureGitSnapshot, diffGitSnapshots } from "./git-workspace-scanner.js";
import { captureFilesystemSnapshot, diffFilesystemSnapshots } from "./filesystem-workspace-scanner.js";
import { SCAN_REASON_CODES } from "./constants.js";

export interface CaptureResult {
  snapshot: WorkspaceSnapshot;
  scannerType: "git" | "filesystem";
  fallbackReason: string | null;
}

export interface DiffResult {
  changes: FileChangeDraft[];
  truncated: boolean;
  stopReason: string | null;
}

export function captureSnapshot(
  workspacePath: string,
  limits: ScanLimits = DEFAULT_SCAN_LIMITS,
): CaptureResult {
  // Capture the git snapshot once; reuse its stopReason as the fallback reason
  // when we drop to the filesystem scanner, rather than spawning git twice.
  const gitSnapshot = captureGitSnapshot(workspacePath, limits);
  const gitUnusable =
    gitSnapshot.stopReason === SCAN_REASON_CODES.notAGitWorkspace ||
    gitSnapshot.stopReason === SCAN_REASON_CODES.gitUnavailable;

  if (!gitUnusable) {
    return { snapshot: gitSnapshot, scannerType: "git", fallbackReason: null };
  }

  const fsSnapshot = captureFilesystemSnapshot(workspacePath, limits);
  return {
    snapshot: fsSnapshot,
    scannerType: "filesystem",
    fallbackReason: gitSnapshot.stopReason,
  };
}

export function diffSnapshots(before: WorkspaceSnapshot, after: WorkspaceSnapshot): DiffResult {
  if (before.scannerType !== after.scannerType) {
    return {
      changes: [],
      truncated: true,
      stopReason: "scanner_type_mismatch",
    };
  }

  let changes: FileChangeDraft[];
  if (before.scannerType === "git") {
    changes = diffGitSnapshots(before, after);
  } else {
    changes = diffFilesystemSnapshots(before, after);
  }

  const truncated = before.scanTruncated || after.scanTruncated || changes.length > DEFAULT_SCAN_LIMITS.persistedChanges;
  const stopReason = before.stopReason ?? after.stopReason;

  if (changes.length > DEFAULT_SCAN_LIMITS.persistedChanges) {
    changes = changes.slice(0, DEFAULT_SCAN_LIMITS.persistedChanges);
  }

  return { changes, truncated, stopReason };
}

export function snapshotToJson(snapshot: WorkspaceSnapshot): string {
  return JSON.stringify({
    scannerType: snapshot.scannerType,
    scanComplete: snapshot.scanComplete,
    scanTruncated: snapshot.scanTruncated,
    stopReason: snapshot.stopReason,
    headOid: snapshot.headOid,
    scannerVersion: snapshot.scannerVersion,
    entries: Array.from(snapshot.entries.entries()).map(([path, entry]) => ({
      path, fingerprint: entry.fingerprint, size: entry.size,
    })),
  });
}

export function snapshotFromJson(json: string): WorkspaceSnapshot | null {
  try {
    const data = JSON.parse(json) as {
      scannerType: "git" | "filesystem";
      scanComplete: boolean;
      scanTruncated: boolean;
      stopReason: string | null;
      headOid: string | null;
      scannerVersion: number;
      entries: Array<{ path: string; fingerprint: string; size: number }>;
    };

    const entries = new Map<string, { path: string; fingerprint: string; size: number }>();
    for (const entry of data.entries) {
      entries.set(entry.path, entry);
    }

    return {
      scannerType: data.scannerType,
      scanComplete: data.scanComplete,
      scanTruncated: data.scanTruncated,
      stopReason: data.stopReason,
      entries,
      headOid: data.headOid,
      gitStatus: null,
      scannerVersion: data.scannerVersion,
    };
  } catch {
    return null;
  }
}
