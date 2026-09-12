import type Database from "better-sqlite3";
import {
  ActorType,
  ThreadEventType,
  type Artifact,
  type ArtifactConsumption,
  type ArtifactRevision,
  type CreateArtifactInput,
  type ReviseArtifactInput,
  type ThreadEvent,
} from "@personahub/shared/types";
import { ErrorCode } from "@personahub/shared/errors";
import { AppError } from "../../api/errors.js";
import { parseEvidenceRef, resolveForDispatch } from "../../evidence-ref.js";
import type { ArtifactRepository } from "../../repositories/artifact.js";
import type { IssueRepository } from "../../repositories/issue.js";
import type { ThreadRepository } from "../../repositories/thread.js";
import type { RunRepository } from "../../repositories/run.js";
import type { WorkspaceRepository } from "../../repositories/workspace.js";
import type { ThreadEventService } from "../thread-event.js";
import type { ArtifactArchive } from "./archive.js";
import {
  artifactCreateFingerprint,
  artifactReviseFingerprint,
  assertInlineSize,
  contentHashFor,
  stageAndPublishFile,
  type PublishedFilePayload,
} from "./publication.js";

/**
 * F010 ArtifactService — the single write entry for create / revise / retire /
 * recordConsumption (design §2). The repository is not exposed to routes or
 * F012; reads go through ArtifactResolver.
 *
 * Publication protocol (design §5): inline revisions commit manifest, pointer
 * CAS and events in one DB transaction. File revisions stage a temp blob →
 * fsync → atomic rename into the content-addressed archive → then run the DB
 * transaction (manifest insert + pointer CAS + pendingEvents). The DB commit
 * is the only visibility point; every earlier crash leaves at most an
 * unreferenced archive orphan for the sweeper. Events broadcast only after
 * commit — the intake-service pendingEvents pattern.
 */

/** Production default is `undefined`; fault tests throw inside these seams
 *  only and must not re-enact publication steps themselves (design §8). */
export interface ArtifactPublicationTestHooks {
  afterTempWrite?: () => void;
  afterFsync?: () => void;
  afterRename?: () => void;
  afterRevisionInsert?: () => void;
  afterPointerCas?: () => void;
  afterCommit?: () => void;
}

export interface ArtifactServiceDeps {
  db: Database.Database;
  artifactRepo: ArtifactRepository;
  issueRepo: IssueRepository;
  threadRepo: ThreadRepository;
  runRepo: RunRepository;
  workspaceRepo: WorkspaceRepository;
  threadEventService: ThreadEventService;
  archive: ArtifactArchive;
  maxBytes: number;
  log?: (info: Record<string, unknown>) => void;
  testHooks?: ArtifactPublicationTestHooks;
}

export interface ArtifactWriteResult {
  artifact: Artifact;
  revision: ArtifactRevision;
  replayed: boolean;
}

export interface RecordConsumptionInput {
  dispatchId: string;
  runId: string;
  /** Only `artifact:<id>@<revision>` is accepted; floating refs are rejected. */
  revisionRef: string;
  purpose: string;
  /** Dispatch-owned thread for rejection events (F012 supplies it). */
  dispatchThreadId?: string;
}

export class ArtifactService {
  constructor(private deps: ArtifactServiceDeps) {}

  // ------------------------------------------------------------------ create

  createArtifact(input: CreateArtifactInput): ArtifactWriteResult {
    const fingerprint = artifactCreateFingerprint(input);

    // Replay short-circuit before any file work: the same (artifact, key) with
    // the same fingerprint returns the published revision untouched.
    const preexisting = this.deps.artifactRepo.getRevisionByIdempotencyKey(input.artifact_id, input.idempotency_key);
    if (preexisting) {
      return this.replayOrConflict(input.artifact_id, preexisting.revision, fingerprint);
    }

    this.assertEntitiesExist(input.issue_id, input.thread_id, input.source_run_id ?? null);
    this.assertEvidenceRefsKnown(input.evidence_refs ?? []);
    assertInlineSize(input.storage, this.deps.maxBytes);

    const published = this.publishIfFile(input.storage, input.issue_id);
    const pendingEvents: ThreadEvent[] = [];
    let result: ArtifactWriteResult;
    try {
      result = this.deps.db.transaction(() => {        const now = new Date().toISOString();
        const artifactRow: Artifact = {
          id: input.artifact_id,
          issue_id: input.issue_id,
          thread_id: input.thread_id,
          type: input.type,
          title: input.title,
          state: "active",
          current_revision: null,
          created_by: input.created_by,
          created_at: now,
          updated_at: now,
        };
        this.deps.artifactRepo.createArtifact(artifactRow);
        const revision = this.revisionRow(input.artifact_id, 1, input.storage, published, input, now);
        this.deps.artifactRepo.insertRevision({
          ...revision,
          idempotency_key: input.idempotency_key,
          request_fingerprint: fingerprint,
        });
        this.deps.testHooks?.afterRevisionInsert?.();
        if (!this.deps.artifactRepo.advanceCurrentRevisionCas(artifactRow.id, null, 1, now)) {
          throw new AppError(ErrorCode.ARTIFACT_REVISION_CONFLICT, "Create lost the pointer publication race.");
        }
        this.deps.testHooks?.afterPointerCas?.();
        this.insertEvidenceLinks(input.artifact_id, 1, input.evidence_refs ?? []);
        pendingEvents.push(
          this.deps.threadEventService.write(input.thread_id, ThreadEventType.ArtifactCreated, ActorType.System, null, {
            artifact_id: artifactRow.id,
            revision: 1,
            issue_id: input.issue_id,
            ...(input.source_run_id ? { source_run_id: input.source_run_id } : {}),
          }),
        );
        return { artifact: artifactRow, revision, replayed: false };
      })();
    } catch (error) {
      if (!isUniqueViolation(error, "artifacts.id")) throw error;
      // Lost a create race across connections: the artifact exists now and the
      // idempotency rules decide replay vs conflict — never a raw 500.
      const winner = this.deps.artifactRepo.getRevisionByIdempotencyKey(input.artifact_id, input.idempotency_key);
      if (winner) {
        result = this.replayOrConflict(input.artifact_id, winner.revision, fingerprint);
      } else {
        throw new AppError(
          ErrorCode.ARTIFACT_IDEMPOTENCY_CONFLICT,
          `Artifact ${input.artifact_id} already exists with a different idempotency key.`,
        );
      }
    }
    this.deps.testHooks?.afterCommit?.();
    for (const event of pendingEvents) this.deps.threadEventService.broadcast(event);
    return result;
  }

  // ------------------------------------------------------------------ revise

  reviseArtifact(artifactId: string, input: ReviseArtifactInput): ArtifactWriteResult {
    const fingerprint = artifactReviseFingerprint(artifactId, input);

    // Key hit outranks revision allocation: a retried revise whose current
    // pointer has since advanced must return the existing revision, not a
    // spurious CAS conflict (design §5).
    const preexisting = this.deps.artifactRepo.getRevisionByIdempotencyKey(artifactId, input.idempotency_key);
    if (preexisting) {
      return this.replayOrConflict(artifactId, preexisting.revision, fingerprint);
    }

    const artifact = this.assertActiveArtifact(artifactId);
    this.assertEntitiesExist(artifact.issue_id, artifact.thread_id, input.source_run_id ?? null);
    this.assertEvidenceRefsKnown(input.evidence_refs ?? []);
    assertInlineSize(input.storage, this.deps.maxBytes);

    const published = this.publishIfFile(input.storage, artifact.issue_id);
    const pendingEvents: ThreadEvent[] = [];
    const result = this.deps.db.transaction(() => {
      const fresh = this.assertActiveArtifact(artifactId);
      const keyHit = this.deps.artifactRepo.getRevisionByIdempotencyKey(artifactId, input.idempotency_key);
      if (keyHit) {
        return this.replayOrConflict(artifactId, keyHit.revision, fingerprint);
      }
      const current = fresh.current_revision;
      if (current === null || current !== input.expected_current_revision) {
        throw new AppError(
          ErrorCode.ARTIFACT_REVISION_CONFLICT,
          `Expected current revision ${input.expected_current_revision}, actual ${current}.`,
        );
      }
      const nextRevision = current + 1;
      const now = new Date().toISOString();
      const revision = this.revisionRow(artifactId, nextRevision, input.storage, published, input, now);
      this.deps.artifactRepo.insertRevision({
        ...revision,
        idempotency_key: input.idempotency_key,
        request_fingerprint: fingerprint,
      });
      this.deps.testHooks?.afterRevisionInsert?.();
      if (!this.deps.artifactRepo.advanceCurrentRevisionCas(artifactId, current, nextRevision, now)) {
        throw new AppError(ErrorCode.ARTIFACT_REVISION_CONFLICT, "Revise lost the pointer CAS race.");
      }
      this.deps.testHooks?.afterPointerCas?.();
      this.insertEvidenceLinks(artifactId, nextRevision, input.evidence_refs ?? []);
      pendingEvents.push(
        this.deps.threadEventService.write(fresh.thread_id, ThreadEventType.ArtifactRevised, ActorType.System, null, {
          artifact_id: artifactId,
          revision: nextRevision,
          issue_id: fresh.issue_id,
          ...(input.source_run_id ? { source_run_id: input.source_run_id } : {}),
        }),
      );
      return { artifact: { ...fresh, current_revision: nextRevision }, revision, replayed: false };
    })();
    this.deps.testHooks?.afterCommit?.();
    for (const event of pendingEvents) this.deps.threadEventService.broadcast(event);
    return result;
  }

  // ------------------------------------------------------------------ retire

  retireArtifact(artifactId: string): Artifact {
    const artifact = this.deps.artifactRepo.getArtifact(artifactId);
    if (!artifact) {
      throw new AppError(ErrorCode.ARTIFACT_NOT_FOUND, `Artifact not found: ${artifactId}`);
    }
    if (artifact.state === "retired") {
      return artifact; // single forward transition; retiring twice is a no-op
    }
    this.deps.artifactRepo.retireArtifact(artifactId, new Date().toISOString());
    return this.deps.artifactRepo.getArtifact(artifactId)!;
  }

  // ------------------------------------------------------- recordConsumption

  recordConsumption(input: RecordConsumptionInput): ArtifactConsumption {
    const check = resolveForDispatch(parseEvidenceRef(input.revisionRef));
    const rejectThread = () => input.dispatchThreadId ?? this.deps.artifactRepo.getArtifact(check.ok ? check.artifactId : "")?.thread_id ?? null;
    if (!check.ok) {
      this.rejectResolve(input.revisionRef, "record_consumption", ErrorCode.ARTIFACT_REF_INVALID, rejectThread());
    }
    const artifact = this.deps.artifactRepo.getArtifact(check.artifactId);
    if (!artifact) {
      this.rejectResolve(input.revisionRef, "record_consumption", ErrorCode.ARTIFACT_NOT_FOUND, input.dispatchThreadId ?? null);
    }
    if (!this.deps.artifactRepo.getRevision(artifact.id, check.revision!)) {
      this.rejectResolve(input.revisionRef, "record_consumption", ErrorCode.ARTIFACT_REVISION_NOT_FOUND, artifact.thread_id);
    }
    if (!this.deps.runRepo.getById(input.runId)) {
      throw new AppError(ErrorCode.RUN_NOT_FOUND, `Run not found: ${input.runId}`);
    }

    const pendingEvents: ThreadEvent[] = [];
    let consumed: ArtifactConsumption | null = null;
    this.deps.db.transaction(() => {      consumed =
        this.deps.artifactRepo.getConsumption(input.dispatchId, input.runId, artifact.id, check.revision!, input.purpose) ??
        null;
      if (consumed) return;
      const row: ArtifactConsumption = {
        artifact_id: artifact.id,
        revision: check.revision!,
        dispatch_id: input.dispatchId,
        run_id: input.runId,
        purpose: input.purpose,
        consumed_at: new Date().toISOString(),
      };
      try {
        this.deps.artifactRepo.insertConsumption(row);
      } catch (error) {
        // Concurrent identical insert: the PK winner's row is the answer.
        if (!isUniqueViolation(error, "artifact_consumptions.")) throw error;
        consumed =
          this.deps.artifactRepo.getConsumption(input.dispatchId, input.runId, artifact.id, check.revision!, input.purpose) ??
          null;
        if (!consumed) throw error;
        return;
      }
      pendingEvents.push(
        this.deps.threadEventService.write(artifact.thread_id, ThreadEventType.ArtifactConsumed, ActorType.System, null, {
          artifact_id: artifact.id,
          revision: row.revision,
          issue_id: artifact.issue_id,
          dispatch_id: input.dispatchId,
          run_id: input.runId,
          purpose: input.purpose,
        }),
      );
      consumed = row;
    })();
    for (const event of pendingEvents) this.deps.threadEventService.broadcast(event);
    return consumed!;
  }

  // ----------------------------------------------------------------- helpers

  /** Resolve rejection (TR-001): persist `artifact.resolve_rejected` on the
   *  best-available thread and broadcast; when no thread is derivable, only
   *  the service log records the refusal — never a fabricated thread id. */
  private rejectResolve(ref: string, callerMode: string, reasonCode: ErrorCode, threadId: string | null): never {
    if (threadId) {
      const event = this.deps.threadEventService.write(
        threadId,
        ThreadEventType.ArtifactResolveRejected,
        ActorType.System,
        null,
        { ref, caller_mode: callerMode, reason_code: reasonCode },
      );
      this.deps.threadEventService.broadcast(event);
    } else {
      this.deps.log?.({
        event: "artifact.resolve_rejected",
        persisted: false,
        ref,
        caller_mode: callerMode,
        reason_code: reasonCode,
      });
    }
    throw new AppError(reasonCode, `Artifact ref rejected (${reasonCode}): ${ref}`);
  }

  private assertActiveArtifact(artifactId: string): Artifact {
    const artifact = this.deps.artifactRepo.getArtifact(artifactId);
    if (!artifact) {
      throw new AppError(ErrorCode.ARTIFACT_NOT_FOUND, `Artifact not found: ${artifactId}`);
    }
    if (artifact.state === "retired") {
      throw new AppError(ErrorCode.ARTIFACT_RETIRED, `Artifact is retired: ${artifactId}`);
    }
    return artifact;
  }

  private publishIfFile(storage: CreateArtifactInput["storage"], issueId: string): PublishedFilePayload | null {
    if (storage.storage_kind !== "workspace_file") {
      return null;
    }
    return stageAndPublishFile(this.deps.archive, this.deps.maxBytes, this.workspaceRoot(issueId), storage.source_path, this.deps.testHooks);
  }

  private revisionRow(
    artifactId: string,
    revision: number,
    storage: CreateArtifactInput["storage"],
    published: PublishedFilePayload | null,
    input: CreateArtifactInput | ReviseArtifactInput,
    now: string,
  ): ArtifactRevision {
    return {
      artifact_id: artifactId,
      revision,
      storage_kind: storage.storage_kind,
      inline_content: storage.storage_kind === "inline_markdown" ? storage.inline_content : null,
      source_relative_path: published ? published.sourceRelativeNormalized : null,
      archive_relative_path: published ? published.archiveRelative : null,
      content_hash: contentHashFor(storage, published),
      source_run_id: input.source_run_id ?? null,
      created_by: input.created_by,
      created_at: now,
    };
  }

  private replayOrConflict(artifactId: string, revision: number, fingerprint: string): ArtifactWriteResult {
    // The fingerprint lives in the DB row, not in the shared API projection —
    // replay decisions are repository-level facts.
    const storedFingerprint = this.deps.artifactRepo.getRevisionFingerprint(artifactId, revision);
    if (storedFingerprint === null) {
      throw new AppError(ErrorCode.ARTIFACT_NOT_FOUND, `Artifact revision not found: ${artifactId}@${revision}`);
    }
    if (storedFingerprint !== fingerprint) {
      throw new AppError(
        ErrorCode.ARTIFACT_IDEMPOTENCY_CONFLICT,
        `Idempotency key already used with different content for ${artifactId}@${revision}.`,
      );
    }
    const existing = this.deps.artifactRepo.getRevision(artifactId, revision)!;
    const artifact = this.deps.artifactRepo.getArtifact(artifactId)!;
    return { artifact, revision: existing, replayed: true };
  }

  private insertEvidenceLinks(artifactId: string, revision: number, refs: string[]): void {
    for (const ref of refs) {
      this.deps.artifactRepo.insertEvidenceLink({ artifact_id: artifactId, revision, evidence_ref: ref });
    }
  }

  private assertEntitiesExist(issueId: string, threadId: string, sourceRunId: string | null): void {
    if (!this.deps.issueRepo.getById(issueId)) {
      throw new AppError(ErrorCode.ISSUE_NOT_FOUND, `Issue not found: ${issueId}`);
    }
    if (!this.deps.threadRepo.getById(threadId)) {
      throw new AppError(ErrorCode.THREAD_NOT_FOUND, `Thread not found: ${threadId}`);
    }
    if (sourceRunId && !this.deps.runRepo.getById(sourceRunId)) {
      throw new AppError(ErrorCode.RUN_NOT_FOUND, `Source run not found: ${sourceRunId}`);
    }
  }

  private assertEvidenceRefsKnown(refs: string[]): void {
    for (const ref of refs) {
      if (parseEvidenceRef(ref).kind === "unknown") {
        throw new AppError(ErrorCode.ARTIFACT_REF_INVALID, `Evidence ref grammar unknown: ${ref}`);
      }
    }
  }

  private workspaceRoot(issueId: string): string {
    const issue = this.deps.issueRepo.getById(issueId);
    if (!issue) throw new AppError(ErrorCode.ISSUE_NOT_FOUND, `Issue not found: ${issueId}`);
    const workspace = this.deps.workspaceRepo.getById(issue.workspace_id);
    if (!workspace) throw new AppError(ErrorCode.WORKSPACE_NOT_FOUND, `Workspace not found: ${issue.workspace_id}`);
    return workspace.local_path;
  }
}

function isUniqueViolation(error: unknown, columnFragment: string): boolean {
  return (
    error instanceof Error &&
    /UNIQUE constraint failed/.test(error.message) &&
    error.message.includes(columnFragment)
  );
}
