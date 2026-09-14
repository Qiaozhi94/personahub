import { statSync } from "node:fs";
import { ErrorCode } from "@personahub/shared/errors";
import { AppError } from "../../api/errors.js";
import type { ArtifactRepository } from "../../repositories/artifact.js";
import { isWellFormedArchivePath, type ArtifactArchive } from "./archive.js";

/**
 * Orphan sweeper (design §7): the only component that takes the
 * `archive-maintenance` DB lease (CAS — at most one sweeper at any moment,
 * takeover only after expiry). Publication never participates in the lease;
 * its isolation from sweeping comes from the grace period plus the manifest
 * back-check, so distinct Artifacts can publish concurrently while a sweep
 * runs.
 *
 * A staged temp blob or an archive file is deleted only when it is older than
 * the safety grace period AND (for archive files) referenced by no revision
 * manifest AND carries a well-formed content-addressed name. An in-flight
 * publication is therefore never a sweep candidate: its temp blob is young,
 * and once the rename lands the file is either referenced or young.
 */

export const ARCHIVE_MAINTENANCE_LEASE = "archive-maintenance";

export const DEFAULT_ORPHAN_GRACE_MS = 3_600_000; // 1 hour
export const DEFAULT_SWEEP_LEASE_MS = 30_000; // 30 seconds

export interface OrphanSweeperOptions {
  artifactRepo: ArtifactRepository;
  archive: ArtifactArchive;
  graceMs?: number;
  leaseMs?: number;
  ownerId?: string;
  nowMs?: () => number;
  log?: (info: Record<string, unknown>) => void;
}

export interface SweepResult {
  /** False when another live lease holder skipped this run. */
  ran: boolean;
  deletedArchives: string[];
  deletedTemps: string[];
}

export class ArtifactOrphanSweeper {
  private readonly graceMs: number;
  private readonly leaseMs: number;
  private readonly ownerId: string;
  private readonly nowMs: () => number;

  constructor(private opts: OrphanSweeperOptions) {
    this.graceMs = opts.graceMs ?? DEFAULT_ORPHAN_GRACE_MS;
    this.leaseMs = opts.leaseMs ?? DEFAULT_SWEEP_LEASE_MS;
    this.ownerId = opts.ownerId ?? `sweeper-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
    this.nowMs = opts.nowMs ?? (() => Date.now());
  }

  sweep(): SweepResult {
    const now = this.nowMs();
    if (!this.opts.artifactRepo.tryAcquireLease(ARCHIVE_MAINTENANCE_LEASE, this.ownerId, now, this.leaseMs)) {
      this.opts.log?.({ event: "artifact.sweep_skipped", reason: "lease_held" });
      return { ran: false, deletedArchives: [], deletedTemps: [] };
    }
    try {
      const referenced = new Set(this.opts.artifactRepo.listReferencedArchivePaths());
      const cutoff = now - this.graceMs;
      const deletedArchives: string[] = [];
      for (const candidate of this.opts.archive.listArchiveFiles()) {
        if (referenced.has(candidate)) continue;
        if (!isWellFormedArchivePath(candidate)) continue;
        if (!this.olderThan(this.opts.archive.archiveAbsolutePath(candidate), cutoff)) continue;
        this.opts.archive.removeArchiveFile(candidate);
        deletedArchives.push(candidate);
      }
      const deletedTemps: string[] = [];
      for (const tempPath of this.opts.archive.listTempFiles()) {
        if (!this.olderThan(tempPath, cutoff)) continue;
        this.opts.archive.removeTempFile(tempPath);
        deletedTemps.push(tempPath);
      }
      if (deletedArchives.length > 0 || deletedTemps.length > 0) {
        this.opts.log?.({
          event: "artifact.sweep",
          deleted_archives: deletedArchives.length,
          deleted_temps: deletedTemps.length,
        });
      }
      return { ran: true, deletedArchives, deletedTemps };
    } finally {
      this.opts.artifactRepo.releaseLease(ARCHIVE_MAINTENANCE_LEASE, this.ownerId);
    }
  }

  private olderThan(path: string, cutoffMs: number): boolean {
    try {
      return statSync(path).mtimeMs <= cutoffMs;
    } catch {
      // vanished between listing and stat — nothing to delete
      return false;
    }
  }
}

/** Resolves the configured artifact size cap. Exported for wiring + tests. */
export function resolveArtifactMaxBytes(env: NodeJS.ProcessEnv = process.env): number {
  return numberFromEnv(env, "PERSONAHUB_ARTIFACT_MAX_BYTES", 10_485_760);
}

export function resolveOrphanGraceMs(env: NodeJS.ProcessEnv = process.env): number {
  return numberFromEnv(env, "PERSONAHUB_ARTIFACT_ORPHAN_GRACE_MS", DEFAULT_ORPHAN_GRACE_MS);
}

export function resolveSweepLeaseMs(env: NodeJS.ProcessEnv = process.env): number {
  return numberFromEnv(env, "PERSONAHUB_ARTIFACT_SWEEP_LEASE_MS", DEFAULT_SWEEP_LEASE_MS);
}

function numberFromEnv(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const raw = env[key];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new AppError(ErrorCode.INTERNAL_ERROR, `${key} must be a positive integer, got ${raw}`);
  }
  return value;
}
