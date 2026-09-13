import { ErrorCode, type ErrorCode as ErrorCodeValue } from "@personahub/shared/errors";
import {
  ActorType,
  ThreadEventType,
  type Artifact,
  type ArtifactConsumption,
  type ArtifactEntityRead,
  type ArtifactListRead,
  type ArtifactProvenanceRead,
  type ArtifactRevision,
  type ArtifactRevisionRead,
  type EvidenceArtifactRead,
  type RunArtifactRead,
} from "@personahub/shared/types";
import { parseEvidenceRef, resolveForRead } from "../../evidence-ref.js";
import type { ArtifactRepository } from "../../repositories/artifact.js";
import type { ThreadEventService } from "../thread-event.js";
import { sha256Hex, type ArtifactArchive } from "./archive.js";

/**
 * F010 ArtifactResolver — the only read path for artifact content. It reads
 * the immutable manifest and the content-addressed archive, never the mutable
 * workspace source (design §2). Every archive read verifies SHA-256 against
 * the manifest; a mismatch is reported as `hash_mismatch`, persists an
 * `artifact.resolve_rejected` event on the artifact's thread, and never
 * returns the damaged body (design §7).
 *
 * Read states follow the shared discriminated contract: `ready` / `missing` /
 * `invalid` / `hash_mismatch`; list reads add `empty` for a successful query
 * with no rows. `missing` (manifest or archive absent) and `empty` never
 * merge.
 */

export interface ArtifactResolverDeps {
  artifactRepo: ArtifactRepository;
  archive: ArtifactArchive;
  threadEventService: ThreadEventService;
}

function failure<S extends "missing" | "invalid" | "hash_mismatch">(
  status: S,
  code: ErrorCodeValue,
  ref: string | null,
  message: string,
) {
  return { status, code, ref, message };
}

export class ArtifactResolver {
  constructor(private deps: ArtifactResolverDeps) {}

  // ------------------------------------------------------------- entity reads

  getEntity(artifactId: string, ref: string | null = null): ArtifactEntityRead {
    const artifact = this.deps.artifactRepo.getArtifact(artifactId);
    if (!artifact) {
      return failure("missing", ErrorCode.ARTIFACT_NOT_FOUND, ref, `Artifact not found: ${artifactId}`);
    }
    return { status: "ready", artifact };
  }

  listByIssue(issueId: string): ArtifactListRead {
    const artifacts = this.deps.artifactRepo.listByIssue(issueId);
    return artifacts.length === 0 ? { status: "empty" } : { status: "ready", artifacts };
  }

  /**
   * Resolve a typed ref to a definite revision. Floating refs
   * (`artifact:<id>`) read the current pointer; pinned refs read exactly that
   * revision — history never follows the pointer (spec §5).
   */
  getRevisionRead(artifactId: string, revision: number, ref: string | null = null): ArtifactRevisionRead {
    const artifact = this.deps.artifactRepo.getArtifact(artifactId);
    if (!artifact) {
      return failure("missing", ErrorCode.ARTIFACT_NOT_FOUND, ref, `Artifact not found: ${artifactId}`);
    }
    return this.readRevisionContent(artifact, revision, ref);
  }

  /** `resolveForRead` entry: accepts floating and pinned artifact refs. */
  resolveForReadRef(ref: string): ArtifactRevisionRead {
    const check = resolveForRead(parseEvidenceRef(ref));
    if (!check.ok) {
      return failure("invalid", ErrorCode.ARTIFACT_REF_INVALID, ref, "Ref is not a well-formed artifact ref.");
    }
    const artifact = this.deps.artifactRepo.getArtifact(check.artifactId);
    if (!artifact) {
      return failure("missing", ErrorCode.ARTIFACT_NOT_FOUND, ref, `Artifact not found: ${check.artifactId}`);
    }
    const revision = check.revision ?? artifact.current_revision;
    if (revision === null) {
      return failure("missing", ErrorCode.ARTIFACT_REVISION_NOT_FOUND, ref, "Artifact has no published revision.");
    }
    return this.readRevisionContent(artifact, revision, ref);
  }

  // ---------------------------------------------------------- provenance reads

  getProvenance(artifactId: string): ArtifactProvenanceRead {
    const artifact = this.deps.artifactRepo.getArtifact(artifactId);
    if (!artifact) {
      return {
        status: "missing",
        code: ErrorCode.ARTIFACT_NOT_FOUND,
        ref: null,
        message: `Artifact not found: ${artifactId}`,
      };
    }
    return {
      status: "ready",
      artifact,
      provenance: {
        artifact,
        consumptions: this.deps.artifactRepo.listConsumptionsByArtifact(artifactId),
        evidence_links: this.deps.artifactRepo.listEvidenceLinksByArtifact(artifactId),
      },
    };
  }

  listRunConsumptions(runId: string): RunArtifactRead {
    const consumptions = this.deps.artifactRepo.listConsumptionsByRun(runId);
    return consumptions.length === 0 ? { status: "empty" } : { status: "ready", consumptions };
  }

  listByEvidenceRef(ref: string): EvidenceArtifactRead {
    if (parseEvidenceRef(ref).kind === "unknown") {
      return { status: "invalid", code: ErrorCode.ARTIFACT_REF_INVALID, ref, message: "Unknown evidence ref kind." };
    }
    const links = this.deps.artifactRepo.listByEvidenceRef(ref);
    if (links.length === 0) {
      return { status: "empty" };
    }
    const items: Array<{ artifact: Artifact; revision: number }> = [];
    for (const link of links) {
      const artifact = this.deps.artifactRepo.getArtifact(link.artifact_id);
      if (artifact) {
        items.push({ artifact, revision: link.revision });
      }
    }
    return items.length === 0 ? { status: "empty" } : { status: "ready", items };
  }

  listConsumptionsForRunEntities(runId: string): ArtifactConsumption[] {
    return this.deps.artifactRepo.listConsumptionsByRun(runId);
  }

  // ------------------------------------------------------------------ helpers

  private readRevisionContent(artifact: Artifact, revision: number, ref: string | null): ArtifactRevisionRead {
    const manifest: ArtifactRevision | null = this.deps.artifactRepo.getRevision(artifact.id, revision);
    if (!manifest) {
      return failure(
        "missing",
        ErrorCode.ARTIFACT_REVISION_NOT_FOUND,
        ref,
        `Revision ${revision} of ${artifact.id} has no published manifest.`,
      );
    }
    if (manifest.storage_kind === "inline_markdown") {
      const text = manifest.inline_content ?? "";
      // Inline storage is verified on every read too: the hash is over the
      // UTF-8 encoded bytes (design §7). A mutated body must fail exactly like
      // a mutated archive, never return the damaged text.
      if (sha256Hex(Buffer.from(text, "utf8")) !== manifest.content_hash) {
        return this.rejectHashMismatch(
          artifact,
          revision,
          ref,
          `Inline bytes of ${artifact.id}@${revision} do not match manifest hash.`,
        );
      }
      return {
        status: "ready",
        artifact,
        revision: manifest,
        content: { storage_kind: "inline_markdown", text },
      };
    }
    const bytes = this.deps.archive.readArchive(manifest.archive_relative_path!);
    if (bytes === null) {
      return failure(
        "missing",
        ErrorCode.ARTIFACT_REVISION_NOT_FOUND,
        ref,
        `Archive object ${manifest.archive_relative_path} of ${artifact.id}@${revision} is absent.`,
      );
    }
    const actualHash = sha256Hex(bytes);
    if (actualHash !== manifest.content_hash) {
      return this.rejectHashMismatch(
        artifact,
        revision,
        ref,
        `Archive bytes of ${artifact.id}@${revision} do not match manifest hash.`,
      );
    }
    return {
      status: "ready",
      artifact,
      revision: manifest,
      content: { storage_kind: "workspace_file", content_base64: bytes.toString("base64"), size_bytes: bytes.length },
    };
  }

  /** Integrity failure is always persisted on the artifact's thread and never
   *  returns the damaged body (design §7) — shared by both storage kinds. */
  private rejectHashMismatch(
    artifact: Artifact,
    revision: number,
    ref: string | null,
    message: string,
  ): ArtifactRevisionRead {
    const event = this.deps.threadEventService.write(
      artifact.thread_id,
      ThreadEventType.ArtifactResolveRejected,
      ActorType.System,
      null,
      { ref, caller_mode: "resolve_read", reason_code: ErrorCode.ARTIFACT_HASH_MISMATCH },
    );
    this.deps.threadEventService.broadcast(event);
    return failure("hash_mismatch", ErrorCode.ARTIFACT_HASH_MISMATCH, ref, message);
  }
}
