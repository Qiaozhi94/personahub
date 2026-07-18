import { FileChangeType } from "@personahub/shared/types";
import { TRACE_LIMITS } from "./constants.js";

export interface FileEntry {
  path: string;
  fingerprint: string;
  size: number;
}

export interface WorkspaceSnapshot {
  scannerType: "git" | "filesystem";
  scanComplete: boolean;
  scanTruncated: boolean;
  stopReason: string | null;
  entries: Map<string, FileEntry>;
  headOid: string | null;
  gitStatus: Map<string, string> | null;
  scannerVersion: number;
}

export interface FileChangeDraft {
  path: string;
  previous_path: string | null;
  change_type: FileChangeType;
  before_fingerprint: string | null;
  after_fingerprint: string | null;
}

export interface ScanLimits {
  wallTimeMs: number;
  maxEntries: number;
  hashedBytesPerFile: number;
  persistedChanges: number;
}

export const DEFAULT_SCAN_LIMITS: ScanLimits = {
  wallTimeMs: TRACE_LIMITS.scanWallTimeMs,
  maxEntries: TRACE_LIMITS.scannedEntries,
  hashedBytesPerFile: TRACE_LIMITS.hashedBytesPerFile,
  persistedChanges: TRACE_LIMITS.persistedChanges,
};
