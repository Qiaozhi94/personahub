import type { ArtifactStoragePayload, ReviseArtifactInput, CreateArtifactInput } from "@personahub/shared/types";
import { ErrorCode } from "@personahub/shared/errors";
import { ulid } from "ulid";
import { AppError } from "../../api/errors.js";
import type { ArtifactPublicationTestHooks } from "./service.js";
import { ArtifactArchive, sha256Hex } from "./archive.js";
import { resolveSourceWithinRoot } from "./paths.js";
import { canonicalRequestFingerprint } from "./fingerprint.js";

/**
 * Shared publication steps for file revisions (design §5): boundary check →
 * stage → fsync → content-addressed publish, with the crash-injection hooks
 * between steps. Inline revisions skip all of it and only need the size cap
 * plus the UTF-8 byte hash.
 */

export interface PublishedFilePayload {
  contentHash: string;
  archiveRelative: string;
  sourceRelativeNormalized: string;
}

export function stageAndPublishFile(
  archive: ArtifactArchive,
  maxBytes: number,
  workspaceRoot: string,
  sourcePath: string,
  hooks?: ArtifactPublicationTestHooks,
): PublishedFilePayload {
  const resolved = resolveSourceWithinRoot(workspaceRoot, sourcePath);
  // stageFile self-cleans its partial temp on a mid-stream overage.
  const staged = archive.stageFile(resolved.fileReal, maxBytes, `art-stage-${ulid()}`);
  try {
    hooks?.afterTempWrite?.();
    archive.fsyncStaged(staged.tempPath);
    hooks?.afterFsync?.();
    const archiveRelative = archive.publishStaged(staged);
    hooks?.afterRename?.();
    return {
      contentHash: staged.hash,
      archiveRelative,
      sourceRelativeNormalized: resolved.sourceRelativeNormalized,
    };
  } catch (error) {
    archive.removeStaged(staged.tempPath);
    throw error;
  }
}

export function assertInlineSize(storage: ArtifactStoragePayload, maxBytes: number): void {
  if (storage.storage_kind === "inline_markdown" && Buffer.byteLength(storage.inline_content, "utf8") > maxBytes) {
    throw new AppError(ErrorCode.ARTIFACT_TOO_LARGE, `Inline artifact exceeds ${maxBytes} UTF-8 bytes.`);
  }
}

export function contentHashFor(storage: ArtifactStoragePayload, published: PublishedFilePayload | null): string {
  if (published) {
    return published.contentHash;
  }
  if (storage.storage_kind !== "inline_markdown") {
    throw new AppError(ErrorCode.INTERNAL_ERROR, "File revision requires a published archive payload.");
  }
  return sha256Hex(storage.inline_content);
}

export function artifactCreateFingerprint(input: CreateArtifactInput): string {
  return canonicalRequestFingerprint({
    op: "create",
    artifact_id: input.artifact_id,
    issue_id: input.issue_id,
    thread_id: input.thread_id,
    type: input.type,
    title: input.title,
    storage: input.storage,
    source_run_id: input.source_run_id ?? null,
    evidence_refs: [...(input.evidence_refs ?? [])].sort(),
    created_by: input.created_by,
  });
}

export function artifactReviseFingerprint(artifactId: string, input: ReviseArtifactInput): string {
  return canonicalRequestFingerprint({
    op: "revise",
    artifact_id: artifactId,
    storage: input.storage,
    source_run_id: input.source_run_id ?? null,
    evidence_refs: [...(input.evidence_refs ?? [])].sort(),
    created_by: input.created_by,
    expected_current_revision: input.expected_current_revision,
  });
}
