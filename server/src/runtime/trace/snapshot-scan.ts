import { createHash } from "node:crypto";
import { readFileSync, statSync, readdirSync, lstatSync } from "node:fs";
import { join } from "node:path";
import { FileChangeType } from "@personahub/shared/types";
import type { FileChangeDraft, ScanLimits, WorkspaceSnapshot, FileEntry } from "./snapshot-types.js";
import { shouldIgnorePath, normalizeWorkspacePath } from "./path-utils.js";
import { SCAN_REASON_CODES } from "./constants.js";

/**
 * Shared filesystem primitives used by both the git and filesystem workspace
 * scanners. Keeping fingerprinting, the bounded tree walk, and the entry diff
 * in one place avoids the near-identical duplication the two scanners used to
 * carry; the scanners only differ in the git-specific metadata they capture.
 */

export function fingerprintFile(filePath: string, maxBytes: number): { fingerprint: string; size: number } {
  try {
    const stat = statSync(filePath);
    if (stat.size > maxBytes) {
      return { fingerprint: `size:${stat.size}:mtime:${stat.mtimeMs}`, size: stat.size };
    }
    const content = readFileSync(filePath);
    const hash = createHash("sha256").update(content).digest("hex");
    return { fingerprint: hash, size: stat.size };
  } catch {
    return { fingerprint: "unreadable", size: 0 };
  }
}

/**
 * Deterministic, bounded, depth-first walk of the workspace. Ignores symlinks
 * (never follows outside the workspace), applies ignore rules, and stops with a
 * stable reason on entry-count/time limits or permission errors.
 */
export function scanTree(
  workspacePath: string,
  currentPath: string,
  entries: Map<string, FileEntry>,
  limits: ScanLimits,
  deadline: number,
): { truncated: boolean; stopReason: string | null } {
  let names: string[];
  try {
    names = readdirSync(currentPath).sort();
  } catch {
    return { truncated: false, stopReason: SCAN_REASON_CODES.permissionDenied };
  }

  for (const name of names) {
    if (entries.size >= limits.maxEntries) {
      return { truncated: true, stopReason: SCAN_REASON_CODES.entryLimit };
    }
    if (Date.now() > deadline) {
      return { truncated: true, stopReason: SCAN_REASON_CODES.timeout };
    }

    const absPath = join(currentPath, name);
    const relPath = normalizeWorkspacePath(workspacePath, absPath);
    if (relPath === null) continue;
    if (shouldIgnorePath(relPath)) continue;

    let lstat;
    try {
      lstat = lstatSync(absPath);
    } catch {
      continue;
    }

    if (lstat.isSymbolicLink()) continue;

    if (lstat.isDirectory()) {
      const result = scanTree(workspacePath, absPath, entries, limits, deadline);
      if (result.truncated || result.stopReason !== null) return result;
    } else if (lstat.isFile()) {
      const { fingerprint, size } = fingerprintFile(absPath, limits.hashedBytesPerFile);
      entries.set(relPath, { path: relPath, fingerprint, size });
    }
  }

  return { truncated: false, stopReason: null };
}

/**
 * Net change between two entry snapshots. Added/deleted are only reported when
 * both snapshots are complete (a missing path under truncation could just be
 * beyond the frontier); modified is reported whenever both sides observed the
 * path and its fingerprint changed. Results are sorted for stable persistence.
 */
export function diffSnapshotEntries(
  before: WorkspaceSnapshot,
  after: WorkspaceSnapshot,
): FileChangeDraft[] {
  const drafts: FileChangeDraft[] = [];
  const bothComplete = before.scanComplete && after.scanComplete;
  const allPaths = new Set<string>([...before.entries.keys(), ...after.entries.keys()]);

  for (const path of allPaths) {
    const beforeEntry = before.entries.get(path);
    const afterEntry = after.entries.get(path);

    if (beforeEntry && !afterEntry) {
      if (bothComplete) {
        drafts.push({
          path, previous_path: null, change_type: FileChangeType.Deleted,
          before_fingerprint: beforeEntry.fingerprint, after_fingerprint: null,
        });
      }
    } else if (!beforeEntry && afterEntry) {
      if (bothComplete) {
        drafts.push({
          path, previous_path: null, change_type: FileChangeType.Added,
          before_fingerprint: null, after_fingerprint: afterEntry.fingerprint,
        });
      }
    } else if (beforeEntry && afterEntry && beforeEntry.fingerprint !== afterEntry.fingerprint) {
      drafts.push({
        path, previous_path: null, change_type: FileChangeType.Modified,
        before_fingerprint: beforeEntry.fingerprint, after_fingerprint: afterEntry.fingerprint,
      });
    }
  }

  return drafts.sort((a, b) => a.path.localeCompare(b.path));
}
