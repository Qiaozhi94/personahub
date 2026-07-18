import type { FileChangeDraft, ScanLimits, WorkspaceSnapshot, FileEntry } from "./snapshot-types.js";
import { DEFAULT_SCAN_LIMITS } from "./snapshot-types.js";
import { scanTree, diffSnapshotEntries } from "./snapshot-scan.js";

const SCANNER_VERSION = 1;

export function captureFilesystemSnapshot(
  workspacePath: string,
  limits: ScanLimits = DEFAULT_SCAN_LIMITS,
): WorkspaceSnapshot {
  const entries = new Map<string, FileEntry>();
  const deadline = Date.now() + limits.wallTimeMs;
  const result = scanTree(workspacePath, workspacePath, entries, limits, deadline);

  return {
    scannerType: "filesystem",
    scanComplete: !result.truncated && result.stopReason === null,
    scanTruncated: result.truncated,
    stopReason: result.stopReason,
    entries,
    headOid: null,
    gitStatus: null,
    scannerVersion: SCANNER_VERSION,
  };
}

export function diffFilesystemSnapshots(
  before: WorkspaceSnapshot,
  after: WorkspaceSnapshot,
): FileChangeDraft[] {
  return diffSnapshotEntries(before, after);
}
