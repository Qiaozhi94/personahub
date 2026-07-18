export const TRACE_LIMITS = {
  scanWallTimeMs: 10_000,
  scannedEntries: 20_000,
  hashedBytesPerFile: 8 * 1024 * 1024,
  persistedChanges: 5_000,
  eventPreview: 100,
  exportChanges: 5_000,
  commandMaxBytes: 8 * 1024,
  summaryMaxBytes: 2 * 1024,
  pathMaxBytes: 1 * 1024,
  handoffEvidenceRefsMax: 50,
  outputSummaryMaxBytes: 2 * 1024,
  outputRefMax: 5,
} as const;

export const FINALIZATION_RETRY_MAX = 3;

export const IGNORED_DIRS = new Set([
  ".git",
  "node_modules",
  "__pycache__",
  ".venv",
  "venv",
  ".cache",
  ".tmp",
  ".DS_Store",
]);

export const IGNORED_FILE_SUFFIXES = [".db", ".db-shm", ".db-wal", ".log"];

export const SCAN_REASON_CODES = {
  gitUnavailable: "git_unavailable",
  notAGitWorkspace: "not_a_git_workspace",
  permissionDenied: "permission_denied",
  timeout: "timeout",
  entryLimit: "entry_limit",
  snapshotCorrupt: "snapshot_corrupt",
  pathOutsideWorkspace: "path_outside_workspace",
  workspaceOwnershipLost: "workspace_ownership_lost",
  unknown: "unknown",
} as const;

export const DEFAULT_PLATFORM = process.platform;
