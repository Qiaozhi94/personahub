import { existsSync, readFileSync } from "node:fs";
import { resolve as resolvePath, join, dirname, extname, delimiter, sep } from "node:path";

/**
 * T009a: resolves a configured adapter `command` to a concrete executable the
 * runtime can spawn with `shell: false`. Windows `.cmd`/`.bat` shims cannot be
 * executed directly without a shell — this module unwraps the two real shim
 * shapes observed on this machine (see server/tests/helpers/{claude,opencode}
 * -protocol-fixtures.md T009a) instead of falling back to `shell: true`.
 *
 * Unknown/unsupported shim shapes fail closed (`resolved: null`) — this module
 * never guesses at arbitrary batch file semantics.
 */

export interface ResolvedExecutable {
  executable: string;
  prefixArgs: string[];
  source: "direct" | "verified_shim";
}

export interface ResolveExecutableResult {
  resolved: ResolvedExecutable | null;
  errorMessage: string | null;
}

const DEFAULT_EXTENSIONS = [".exe", ".cmd", ".bat", ".com"];

function getPathExtensions(): string[] {
  const raw = process.env.PATHEXT;
  if (!raw) return DEFAULT_EXTENSIONS;
  const parts = raw
    .split(";")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return parts.length > 0 ? parts : DEFAULT_EXTENSIONS;
}

function looksLikePath(command: string): boolean {
  return command.includes("/") || command.includes("\\") || command.startsWith(".");
}

/** Locates an existing file for a bare command name via PATH+PATHEXT search, or resolves a path-like command directly. */
function locateCandidate(command: string): string | null {
  if (looksLikePath(command)) {
    const resolved = resolvePath(command);
    return existsSync(resolved) ? resolved : null;
  }

  const pathDirs = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  const hasExt = extname(command) !== "";
  const extCandidates = hasExt ? [""] : getPathExtensions();

  for (const dir of pathDirs) {
    for (const ext of extCandidates) {
      const candidate = join(dir, command + ext);
      if (existsSync(candidate)) return candidate;
    }
    if (hasExt) {
      const candidate = join(dir, command);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

function expandShimMacros(text: string, shimDir: string): string {
  const dp0 = shimDir.endsWith(sep) ? shimDir : shimDir + sep;
  return text.replace(/%~dp0/gi, dp0).replace(/%dp0%/gi, dp0);
}

/**
 * Pattern A: a single-layer forward straight to a bundled .exe, e.g.
 *   "%dp0%\node_modules\opencode-ai\bin\opencode.exe"   %*
 * Quotes are required — an unquoted `foo.exe %*` line is not treated as a
 * confirmed shape, matching design's "只支持经过 fixture 固化的已知 npm shim 形态".
 */
function tryExeForwardShim(content: string, shimDir: string): ResolvedExecutable | null | undefined {
  const match = content.match(/^[ \t]*"([^"\r\n]+\.exe)"[ \t]+%\*[ \t]*$/im);
  if (!match) return undefined;
  const rawPath = expandShimMacros(match[1], shimDir);
  const resolvedExe = resolvePath(rawPath);
  if (!existsSync(resolvedExe)) return null;
  return { executable: resolvedExe, prefixArgs: [], source: "verified_shim" };
}

/**
 * Pattern B: forward to `node.exe <entry.js> %*`, e.g. codex.cmd:
 *   SET "_prog=%dp0%\node.exe"   (only if that file exists, else SET "_prog=node")
 *   "%_prog%"  "%dp0%\node_modules\@openai\codex\bin\codex.js" %*
 */
function tryNodeEntryForwardShim(content: string, shimDir: string): ResolvedExecutable | null | undefined {
  const jsMatch = content.match(/"([^"\r\n]+\.js)"[ \t]+%\*/i);
  if (!jsMatch) return undefined;

  const resolvedJs = resolvePath(expandShimMacros(jsMatch[1], shimDir));
  if (!existsSync(resolvedJs)) return null;

  let nodeExe: string | null = null;
  const embeddedNodeMatch = content.match(/SET\s+"_prog=([^"\r\n]+?node\.exe)"/i);
  if (embeddedNodeMatch) {
    const candidateNode = resolvePath(expandShimMacros(embeddedNodeMatch[1], shimDir));
    if (existsSync(candidateNode)) nodeExe = candidateNode;
  }
  if (!nodeExe) {
    nodeExe = locateCandidate("node");
  }
  if (!nodeExe) return null;

  return { executable: nodeExe, prefixArgs: [resolvedJs], source: "verified_shim" };
}

function parseShim(shimPath: string): ResolvedExecutable | null {
  const content = readFileSync(shimPath, "utf-8").replace(/\r\n/g, "\n");
  const shimDir = dirname(shimPath);

  const exeForward = tryExeForwardShim(content, shimDir);
  if (exeForward !== undefined) return exeForward;

  const nodeForward = tryNodeEntryForwardShim(content, shimDir);
  if (nodeForward !== undefined) return nodeForward;

  return null;
}

const SHIM_EXTENSIONS = new Set([".cmd", ".bat"]);

export function resolveExecutable(command: string): ResolveExecutableResult {
  const trimmed = command.trim();
  if (!trimmed) {
    return { resolved: null, errorMessage: "Command is empty." };
  }

  const candidate = locateCandidate(trimmed);
  if (!candidate) {
    return { resolved: null, errorMessage: `Command not found: ${trimmed}` };
  }

  const ext = extname(candidate).toLowerCase();
  if (!SHIM_EXTENSIONS.has(ext)) {
    return { resolved: { executable: candidate, prefixArgs: [], source: "direct" }, errorMessage: null };
  }

  const shimResult = parseShim(candidate);
  if (!shimResult) {
    return {
      resolved: null,
      errorMessage: `Unsupported or unresolvable shim, or its target does not exist: ${candidate}`,
    };
  }
  return { resolved: shimResult, errorMessage: null };
}
