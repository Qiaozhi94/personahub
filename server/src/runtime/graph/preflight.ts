import { readdirSync, statSync, realpathSync } from "node:fs";
import { join, relative, sep, isAbsolute } from "node:path";
import { createHash } from "node:crypto";
import type { GraphDefinitionV1, GraphPreflight } from "./types.js";

const MAX_FILES = 500;
const MAX_TARGET_JSON_BYTES = 64 * 1024;

function normalizePath(p: string): string {
  return p.split(sep).join("/");
}

function globToRegex(pattern: string): RegExp {
  const parts = pattern.split("/");
  const segments = parts.map((part) => {
    if (part === "**") return "«GLOBSTAR»";
    return part.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*");
  });
  const re = segments
    .join("/")
    .replace(/«GLOBSTAR»\//g, "(.*/)?")
    .replace(/«GLOBSTAR»/g, ".*");
  return new RegExp(`^${re}$`);
}

function globFiles(rootPath: string, globs: string[]): string[] {
  const seen = new Set<string>();
  const results: string[] = [];
  const rootReal = normalizePath(realpathSync(rootPath));

  for (const pattern of globs) {
    const prefix = pattern.replace(/\*\*\/?\*?.*$/, "").replace(/\/$/, "");
    const baseDir = prefix ? join(rootPath, prefix) : rootPath;
    const regex = globToRegex(pattern);

    let entries: string[];
    try {
      entries = readdirSync(baseDir, { recursive: true }) as string[];
    } catch {
      continue;
    }

    const matched = entries
      .filter((entryPath) => {
        try {
          const fullPath = join(baseDir, entryPath);
          return statSync(fullPath).isFile();
        } catch {
          return false;
        }
      })
      .map((entryPath) => normalizePath(relative(rootPath, join(baseDir, entryPath))))
      .filter((relPath) => regex.test(relPath))
      .filter((relPath) => {
        if (seen.has(relPath)) return false;
        const absPath = join(rootPath, relPath);
        try {
          const real = realpathSync(absPath);
          const rel = relative(rootReal, realpathSync(real));
          if (rel === "" || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return false;
        } catch {
          return false;
        }
        return true;
      })
      .sort((a, b) => {
        const bufA = Buffer.from(a, "utf-8");
        const bufB = Buffer.from(b, "utf-8");
        for (let i = 0; i < Math.min(bufA.length, bufB.length); i++) {
          if (bufA[i] !== bufB[i]) return bufA[i] - bufB[i];
        }
        return bufA.length - bufB.length;
      });

    for (const f of matched) {
      if (seen.has(f)) continue;
      seen.add(f);
      results.push(f);
    }
  }

  return results;
}

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

export function prepareGraph(
  workspacePath: string,
  workspaceId: string,
  definition: GraphDefinitionV1,
  definitionId: string,
  definitionVersion: number,
): GraphPreflight {
  const files = globFiles(workspacePath, definition.targetGlobs);

  let truncated = false;
  let droppedCount = 0;

  if (files.length > MAX_FILES) {
    droppedCount = files.length - MAX_FILES;
    files.splice(MAX_FILES);
    truncated = true;
  }

  const filesJson = JSON.stringify(files);
  if (Buffer.byteLength(filesJson, "utf-8") > MAX_TARGET_JSON_BYTES) {
    while (files.length > 0 && Buffer.byteLength(JSON.stringify(files), "utf-8") > MAX_TARGET_JSON_BYTES) {
      files.pop();
      droppedCount++;
    }
    truncated = true;
  }

  const finalJson = JSON.stringify(files);

  return {
    workspaceId,
    workspacePath,
    definitionId,
    definitionVersion,
    targetFiles: files,
    targetFilesHash: sha256(finalJson),
    truncated,
    droppedCount,
  };
}
