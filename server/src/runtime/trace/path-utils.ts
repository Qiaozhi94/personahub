import { resolve, relative, normalize, isAbsolute } from "node:path";
import { TRACE_LIMITS, IGNORED_DIRS, IGNORED_FILE_SUFFIXES } from "./constants.js";

export function normalizeWorkspacePath(
  workspaceRoot: string,
  inputPath: string,
): string | null {
  if (typeof inputPath !== "string" || inputPath.length === 0) {
    return null;
  }
  if (inputPath.includes("\0")) {
    return null;
  }
  if (Buffer.byteLength(inputPath, "utf8") > TRACE_LIMITS.pathMaxBytes) {
    return null;
  }

  const absolute = isAbsolute(inputPath) ? inputPath : resolve(workspaceRoot, inputPath);
  const normalized = normalize(absolute);
  const root = normalize(workspaceRoot);

  const rel = relative(root, normalized);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    return null;
  }
  if (rel === "") {
    return ".";
  }

  return rel.replace(/\\/g, "/");
}

export function isPathWithinWorkspace(
  workspaceRoot: string,
  inputPath: string,
): boolean {
  return normalizeWorkspacePath(workspaceRoot, inputPath) !== null;
}

export function shouldIgnorePath(relPath: string): boolean {
  const parts = relPath.split("/");
  for (const part of parts) {
    if (IGNORED_DIRS.has(part)) {
      return true;
    }
  }
  for (const suffix of IGNORED_FILE_SUFFIXES) {
    if (relPath.endsWith(suffix)) {
      return true;
    }
  }
  return false;
}
