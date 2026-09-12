import { realpathSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
import { AppError } from "../../api/errors.js";
import { ErrorCode } from "@personahub/shared/errors";

/**
 * Workspace source-path boundary for file artifacts (design §7).
 *
 * Protocol: realpath the authorized root and the source file first — this
 * resolves junctions/symlinks to their targets — then take the platform-native
 * relative(root, file) and require it to be inside. On Windows the comparison
 * is case-insensitive; elsewhere it is case-sensitive. The result is a
 * normalized workspace-relative locator for provenance display; the resolver
 * never reads this path (it reads the archive).
 *
 * This is a real-path boundary check, not an OS sandbox: it constrains which
 * files F010 accepts as artifact sources, not what other processes may do.
 */

export interface PathBoundaryOptions {
  /** Windows semantics (junction targets, case-insensitive filesystem). */
  caseInsensitive?: boolean;
}

/** True when `fileReal` lies inside `rootReal` (both must be realpaths). */
export function isPathWithinRoot(rootReal: string, fileReal: string, opts: PathBoundaryOptions = {}): boolean {
  const fold = (p: string) => (opts.caseInsensitive ? p.toLowerCase() : p);
  const rel = relative(fold(rootReal), fold(fileReal));
  if (rel === "" || isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`)) {
    return false;
  }
  return true;
}

/**
 * Resolves `sourceRelative` against the authorized workspace root and returns
 * the normalized relative locator. Throws:
 *  - WORKSPACE_PATH_NOT_FOUND when the file (or root) does not exist;
 *  - ARTIFACT_SOURCE_OUTSIDE_ROOT when the resolved path escapes the root
 *    (including via junction/symlink) — after normalization, per spec §3.
 */
export function resolveSourceWithinRoot(
  rootPath: string,
  sourceRelative: string,
  opts: PathBoundaryOptions = {},
): { rootReal: string; fileReal: string; sourceRelativeNormalized: string } {
  let rootReal: string;
  let fileReal: string;
  try {
    rootReal = realpathSync(rootPath);
  } catch {
    throw new AppError(ErrorCode.WORKSPACE_PATH_NOT_FOUND, `Authorized root does not exist: ${rootPath}`);
  }
  try {
    fileReal = realpathSync(join(rootPath, sourceRelative));
  } catch {
    throw new AppError(
      ErrorCode.WORKSPACE_PATH_NOT_FOUND,
      `Artifact source file does not exist: ${sourceRelative}`,
    );
  }
  if (!isPathWithinRoot(rootReal, fileReal, opts)) {
    throw new AppError(
      ErrorCode.ARTIFACT_SOURCE_OUTSIDE_ROOT,
      `Artifact source escapes the authorized root after normalization: ${sourceRelative}`,
    );
  }
  return {
    rootReal,
    fileReal,
    sourceRelativeNormalized: relative(rootReal, fileReal),
  };
}
