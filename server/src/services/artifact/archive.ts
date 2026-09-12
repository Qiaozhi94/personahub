import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  readSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { AppError } from "../../api/errors.js";
import { ErrorCode } from "@personahub/shared/errors";

/**
 * Content-addressed archive for file revisions (design §5/§7).
 *
 * Protocol: stage to a temp blob (hashing + size cap while streaming) → fsync
 * → atomic rename to `<sha256[0:2]>/<sha256>` → only then may the DB manifest
 * transaction run. The DB commit is the single visibility point; a crash
 * before it leaves an unreferenced archive file that only the orphan sweeper
 * (after the grace period) removes.
 *
 * Archive root is an application-level convention, not an OS boundary: the
 * resolver's per-read hash verification is the integrity backstop (design §7).
 */

const STAGE_CHUNK_BYTES = 1024 * 1024;

export const ARCHIVE_NAME_PATTERN = /^([0-9a-f]{2})\/([0-9a-f]{64})$/;

export function sha256Hex(content: Buffer | string): string {
  return createHash("sha256").update(content).digest("hex");
}

export function archiveRelativeFor(hash: string): string {
  return `${hash.slice(0, 2)}/${hash}`;
}

export function isWellFormedArchivePath(archiveRelative: string): boolean {
  return ARCHIVE_NAME_PATTERN.test(archiveRelative);
}

export interface StagedBlob {
  tempPath: string;
  hash: string;
  sizeBytes: number;
}

export class ArtifactArchive {
  constructor(
    readonly rootDir: string,
    readonly tempDir: string,
  ) {}

  archiveAbsolutePath(archiveRelative: string): string {
    if (!isWellFormedArchivePath(archiveRelative)) {
      throw new AppError(ErrorCode.ARTIFACT_HASH_MISMATCH, `Malformed archive locator: ${archiveRelative}`);
    }
    const [dir, file] = archiveRelative.split("/");
    return join(this.rootDir, dir, file);
  }

  /**
   * Copy `sourceAbs` into a staged temp blob, hashing the raw bytes while
   * streaming and enforcing the hard byte cap before anything else happens.
   * Throws ARTIFACT_TOO_LARGE without leaving an Artifact, revision or temp
   * file behind (the caller removes the partial temp on failure).
   */
  stageFile(sourceAbs: string, maxBytes: number, tempName: string): StagedBlob {
    // Pre-read stat: reject before copying when the size is already known to
    // exceed the cap. The streaming cap below still guards TOCTOU growth.
    const preStat = statSync(sourceAbs);
    if (preStat.size > maxBytes) {
      throw new AppError(ErrorCode.ARTIFACT_TOO_LARGE, `Artifact source exceeds ${maxBytes} bytes.`);
    }
    mkdirSync(this.tempDir, { recursive: true });
    const tempPath = join(this.tempDir, tempName);
    const hash = createHash("sha256");
    const readFd = openSync(sourceAbs, "r");
    let writeFd: number | null = null;
    let sizeBytes = 0;
    try {
      writeFd = openSync(tempPath, "wx");
      const chunk = Buffer.allocUnsafe(STAGE_CHUNK_BYTES);
      for (;;) {
        const read = readSync(readFd, chunk, 0, STAGE_CHUNK_BYTES, null);
        if (read === 0) break;
        sizeBytes += read;
        if (sizeBytes > maxBytes) {
          throw new AppError(ErrorCode.ARTIFACT_TOO_LARGE, `Artifact source exceeds ${maxBytes} bytes.`);
        }
        hash.update(chunk.subarray(0, read));
        this.writeAll(writeFd, chunk.subarray(0, read));
      }
      return { tempPath, hash: hash.digest("hex"), sizeBytes };
    } catch (error) {
      // No partial temp may outlive a failed stage: ARTIFACT_TOO_LARGE must
      // leave no artifact, revision or temp file behind (design §4).
      try {
        unlinkSync(tempPath);
      } catch {
        // nothing to clean
      }
      throw error;
    } finally {
      closeSync(readFd);
      if (writeFd !== null) closeSync(writeFd);
    }
  }

  stageInline(content: string, tempName: string): StagedBlob {
    mkdirSync(this.tempDir, { recursive: true });
    const tempPath = join(this.tempDir, tempName);
    const bytes = Buffer.from(content, "utf8");
    const writeFd = openSync(tempPath, "wx");
    try {
      this.writeAll(writeFd, bytes);
    } finally {
      closeSync(writeFd);
    }
    return { tempPath, hash: sha256Hex(bytes), sizeBytes: bytes.length };
  }

  fsyncStaged(tempPath: string): void {
    const fd = openSync(tempPath, "r+");
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  }

  removeStaged(tempPath: string): void {
    try {
      unlinkSync(tempPath);
    } catch {
      // best-effort: the sweeper removes leftovers after the grace period
    }
  }

  /**
   * Publish a staged blob under its content address. When the target already
   * exists the bytes decide: identical content shares the archive entry (and
   * the temp blob is dropped); different content is a hard collision. A rename
   * that loses a race re-runs the same verification, which also avoids Win32
   * EPERM/EBUSY from renaming onto a target that is being read (design §5).
   */
  publishStaged(staged: StagedBlob): string {
    const archiveRelative = archiveRelativeFor(staged.hash);
    const target = this.archiveAbsolutePath(archiveRelative);
    mkdirSync(dirname(target), { recursive: true });
    let renamed = false;
    if (!existsSync(target)) {
      try {
        renameSync(staged.tempPath, target);
        renamed = true;
      } catch {
        // lost a race: the target appeared between the check and the rename;
        // fall through to byte verification against whatever is there now.
      }
    }
    if (!renamed) {
      const existingHash = sha256Hex(readFileSync(target));
      if (existingHash !== staged.hash) {
        this.removeStaged(staged.tempPath);
        throw new AppError(
          ErrorCode.ARTIFACT_ARCHIVE_COLLISION,
          `Archive collision at ${archiveRelative}: existing bytes differ from the staged content.`,
        );
      }
      this.removeStaged(staged.tempPath);
    }
    return archiveRelative;
  }

  /** Reads published archive bytes, or null when the archive file is gone. */
  readArchive(archiveRelative: string): Buffer | null {
    const target = this.archiveAbsolutePath(archiveRelative);
    if (!existsSync(target)) {
      return null;
    }
    return readFileSync(target);
  }

  /** Every file under the archive root, as `<2hex>/<hash>` relative paths. */
  listArchiveFiles(): string[] {
    if (!existsSync(this.rootDir)) {
      return [];
    }
    const out: string[] = [];
    for (const dir of readdirSync(this.rootDir).sort()) {
      if (!/^[0-9a-f]{2}$/.test(dir)) continue;
      for (const file of readdirSync(join(this.rootDir, dir)).sort()) {
        out.push(`${dir}/${file}`);
      }
    }
    return out;
  }

  listTempFiles(): string[] {
    if (!existsSync(this.tempDir)) {
      return [];
    }
    return readdirSync(this.tempDir)
      .sort()
      .map((name) => join(this.tempDir, name));
  }

  removeArchiveFile(archiveRelative: string): void {
    try {
      unlinkSync(this.archiveAbsolutePath(archiveRelative));
    } catch {
      // already gone
    }
  }

  removeTempFile(tempPath: string): void {
    try {
      unlinkSync(tempPath);
    } catch {
      // already gone
    }
  }

  realpathRoot(): string {
    return realpathSync(this.rootDir);
  }

  private writeAll(fd: number, bytes: Buffer): void {
    let written = 0;
    while (written < bytes.length) {
      written += writeSync(fd, bytes, written, bytes.length - written);
    }
  }
}
