import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { ErrorCode } from "@personahub/shared/errors";
import { ThreadEventType } from "@personahub/shared/types";
import { buildEvidenceRef } from "../../src/evidence-ref.js";
import {
  disposeArtifactFixture,
  makeArtifactGraphFixture,
  openArtifactSession,
  type ArtifactGraphFixture,
} from "../helpers-artifact.js";
import { AppError } from "../../src/api/errors.js";

// F010 T011 (AC-002): resolver failure modes are observable before consumption
// — missing, out-of-root, hash mismatch and unknown refs all fail explicitly —
// and a published archive is immune to later source-file changes.

let fixture: ArtifactGraphFixture;

beforeEach(() => {
  fixture = makeArtifactGraphFixture();
});

afterEach(() => {
  disposeArtifactFixture(fixture);
});

function createInlineArtifact(session: ReturnType<typeof openArtifactSession>, artifactId: string, content = "# v1") {
  return session.service.createArtifact({
    artifact_id: artifactId,
    issue_id: fixture.graph.issueId,
    thread_id: fixture.graph.threadId,
    type: "report",
    title: "Report",
    storage: { storage_kind: "inline_markdown", inline_content: content },
    source_run_id: fixture.graph.runIds[0],
    evidence_refs: [],
    created_by: "tester",
    idempotency_key: `key-${artifactId}`,
  });
}

function createFileArtifact(
  session: ReturnType<typeof openArtifactSession>,
  artifactId: string,
  content = "archive me",
) {
  const rel = `docs/${artifactId}.md`;
  mkdirSync(join(fixture.workspaceDir, "docs"), { recursive: true });
  writeFileSync(join(fixture.workspaceDir, rel), content);
  return session.service.createArtifact({
    artifact_id: artifactId,
    issue_id: fixture.graph.issueId,
    thread_id: fixture.graph.threadId,
    type: "report",
    title: "Report",
    storage: { storage_kind: "workspace_file", source_path: rel },
    source_run_id: fixture.graph.runIds[0],
    evidence_refs: [],
    created_by: "tester",
    idempotency_key: `key-${artifactId}`,
  });
}

describe("F010 resolver read states", () => {
  it("reports missing for a nonexistent artifact entity and ref", () => {
    const session = openArtifactSession(fixture);
    const entity = session.resolver.getEntity("art_nope");
    expect(entity.status).toBe("missing");
    expect((entity as { code: string }).code).toBe(ErrorCode.ARTIFACT_NOT_FOUND);

    const byRef = session.resolver.resolveForReadRef("artifact:art_nope@1");
    expect(byRef.status).toBe("missing");
    expect((byRef as { code: string }).code).toBe(ErrorCode.ARTIFACT_NOT_FOUND);
    session.db.close();
  });

  it("reads current via a floating ref without drifting pinned history", () => {
    const session = openArtifactSession(fixture);
    createInlineArtifact(session, "art_float");
    session.service.reviseArtifact("art_float", {
      storage: { storage_kind: "inline_markdown", inline_content: "# v2" },
      created_by: "tester",
      idempotency_key: "key-2",
      expected_current_revision: 1,
    });

    const current = session.resolver.resolveForReadRef("artifact:art_float");
    expect(current.status).toBe("ready");
    expect((current as { revision: { revision: number } }).revision.revision).toBe(2);

    const pinned = session.resolver.resolveForReadRef("artifact:art_float@1");
    expect(pinned.status).toBe("ready");
    expect((pinned as { revision: { revision: number; inline_content: string | null } }).revision.inline_content).toBe(
      "# v1",
    );

    const unpinnedEntity = session.resolver.getRevisionRead("art_float", 1);
    expect(unpinnedEntity.status).toBe("ready");
    session.db.close();
  });

  it("reports missing for an unpublished pinned revision and a floating ref with no publication", () => {
    const session = openArtifactSession(fixture);
    createInlineArtifact(session, "art_gaps");
    const unpinned = session.resolver.resolveForReadRef("artifact:art_gaps@9");
    expect(unpinned.status).toBe("missing");
    expect((unpinned as { code: string }).code).toBe(ErrorCode.ARTIFACT_REVISION_NOT_FOUND);
    session.db.close();
  });

  it("rejects unknown and malformed refs as invalid before any consumption", () => {
    const session = openArtifactSession(fixture);
    createInlineArtifact(session, "art_refs");
    for (const ref of ["event:evt_1", "artifact:art_refs@0", "artifact:@1", "memory:x"]) {
      const read = session.resolver.resolveForReadRef(ref);
      expect(read.status).toBe("invalid");
      expect((read as { code: string }).code).toBe(ErrorCode.ARTIFACT_REF_INVALID);
    }
    session.db.close();
  });

  it("fails hash mismatch observably: reject event on the artifact thread, no damaged body", () => {
    const session = openArtifactSession(fixture);
    const created = createFileArtifact(session, "art_tamper");
    // tamper with the published archive bytes in place
    const [dir, file] = created.revision.archive_relative_path!.split("/");
    writeFileSync(join(fixture.archive.rootDir, dir, file), "tampered bytes");

    const read = session.resolver.resolveForReadRef(`artifact:art_tamper@1`);
    expect(read.status).toBe("hash_mismatch");
    expect((read as { code: string }).code).toBe(ErrorCode.ARTIFACT_HASH_MISMATCH);
    expect(JSON.stringify(read)).not.toContain("tampered bytes");

    const rejectEvents = session.events.filter((e) => e.type === ThreadEventType.ArtifactResolveRejected);
    expect(rejectEvents).toHaveLength(1);
    expect(rejectEvents[0].thread_id).toBe(fixture.graph.threadId);
    expect(rejectEvents[0].payload).toMatchObject({
      ref: "artifact:art_tamper@1",
      caller_mode: "resolve_read",
      reason_code: ErrorCode.ARTIFACT_HASH_MISMATCH,
    });
    session.db.close();
  });

  it("fails hash mismatch for inline bodies too, with the same reject protocol", () => {
    const session = openArtifactSession(fixture);
    createInlineArtifact(session, "art_inline_tamper", "# original");
    // mutate the persisted inline body while keeping the manifest hash
    session.db
      .prepare("UPDATE artifact_revisions SET inline_content = ? WHERE artifact_id = ? AND revision = 1")
      .run("# TAMPERED", "art_inline_tamper");

    const read = session.resolver.resolveForReadRef("artifact:art_inline_tamper@1");
    expect(read.status).toBe("hash_mismatch");
    expect((read as { code: string }).code).toBe(ErrorCode.ARTIFACT_HASH_MISMATCH);
    expect(JSON.stringify(read)).not.toContain("TAMPERED");

    const rejectEvents = session.events.filter((e) => e.type === ThreadEventType.ArtifactResolveRejected);
    expect(rejectEvents).toHaveLength(1);
    expect(rejectEvents[0].payload).toMatchObject({
      ref: "artifact:art_inline_tamper@1",
      caller_mode: "resolve_read",
      reason_code: ErrorCode.ARTIFACT_HASH_MISMATCH,
    });
    session.db.close();
  });

  it("reports a malformed archive locator as invalid, not a hash mismatch", () => {
    const session = openArtifactSession(fixture);
    createFileArtifact(session, "art_badlocator");
    session.db
      .prepare("UPDATE artifact_revisions SET archive_relative_path = ? WHERE artifact_id = ? AND revision = 1")
      .run("../escape", "art_badlocator");

    const read = session.resolver.resolveForReadRef("artifact:art_badlocator@1");
    expect(read.status).toBe("invalid");
    expect((read as { code: string }).code).toBe(ErrorCode.INTERNAL_ERROR);
    session.db.close();
  });

  it("distinguishes an unreadable archive object from a malformed locator", () => {
    const session = openArtifactSession(fixture);
    const created = createFileArtifact(session, "art_unreadable");
    const [dir, file] = created.revision.archive_relative_path!.split("/");
    const target = join(fixture.archive.rootDir, dir, file);
    unlinkSync(target);
    mkdirSync(target); // a directory squats on the content address: readFileSync -> EISDIR

    const read = session.resolver.resolveForReadRef("artifact:art_unreadable@1");
    expect(read.status).toBe("invalid");
    expect((read as { code: string }).code).toBe(ErrorCode.INTERNAL_ERROR);
    const message = (read as { message: string }).message;
    expect(message).not.toContain("malformed");
    expect(message).toContain("unreadable");
    session.db.close();
  });

  it("reports missing when the archive object is gone, and is immune to source-file changes", () => {
    const session = openArtifactSession(fixture);
    const created = createFileArtifact(session, "art_archive");
    const [dir, file] = created.revision.archive_relative_path!.split("/");
    unlinkSync(join(fixture.archive.rootDir, dir, file));
    const gone = session.resolver.resolveForReadRef(`artifact:art_archive@1`);
    expect(gone.status).toBe("missing");
    expect((gone as { code: string }).code).toBe(ErrorCode.ARTIFACT_REVISION_NOT_FOUND);
    session.db.close();

    // source independence: changing the workspace source never alters a
    // published archive (spec §3 boundary)
    const session2 = openArtifactSession(fixture);
    createFileArtifact(session2, "art_independent");
    writeFileSync(join(fixture.workspaceDir, "docs/art_independent.md"), "source mutated after publication");
    const read = session2.resolver.resolveForReadRef("artifact:art_independent@1");
    expect(read.status).toBe("ready");
    const content = (read as { content: { content_base64: string } }).content;
    expect(Buffer.from(content.content_base64, "base64").toString()).toBe("archive me");
    session2.db.close();
  });
});

describe("F010 resolver evidence reverse lookup", () => {
  it("maps evidence refs to artifacts bidirectionally", () => {
    const session = openArtifactSession(fixture);
    const evidenceRef = buildEvidenceRef("event", "evt_prod_1");
    session.service.createArtifact({
      artifact_id: "art_linked",
      issue_id: fixture.graph.issueId,
      thread_id: fixture.graph.threadId,
      type: "report",
      title: "Linked",
      storage: { storage_kind: "inline_markdown", inline_content: "# linked" },
      source_run_id: fixture.graph.runIds[0],
      evidence_refs: [evidenceRef],
      created_by: "tester",
      idempotency_key: "key-linked",
    });

    const byRef = session.resolver.listByEvidenceRef(evidenceRef);
    expect(byRef.status).toBe("ready");
    expect((byRef as { items: Array<{ artifact: { id: string }; revision: number }> }).items).toEqual([
      { artifact: expect.objectContaining({ id: "art_linked" }), revision: 1 },
    ]);

    const provenance = session.resolver.getProvenance("art_linked");
    expect(provenance.status).toBe("ready");
    expect(
      (provenance as { provenance: { evidence_links: Array<{ evidence_ref: string }> } }).provenance.evidence_links,
    ).toEqual([{ artifact_id: "art_linked", revision: 1, evidence_ref: evidenceRef }]);
    session.db.close();
  });

  it("distinguishes empty lists from unknown-ref invalid", () => {
    const session = openArtifactSession(fixture);
    expect(session.resolver.listByEvidenceRef("event:evt_unlinked")).toEqual({ status: "empty" });
    expect(session.resolver.listByEvidenceRef("bogus-ref")).toMatchObject({ status: "invalid" });
    expect(session.resolver.listRunConsumptions(fixture.graph.runIds[0])).toEqual({ status: "empty" });
    session.db.close();
  });
});

describe("F010 recordConsumption", () => {
  it("records and replays consumption idempotently, rejecting floating refs", async () => {
    const session = openArtifactSession(fixture);
    createInlineArtifact(session, "art_consumed");
    const runId = fixture.graph.runIds[0];

    const first = session.service.recordConsumption({
      dispatchId: "dsp_1",
      runId,
      revisionRef: "artifact:art_consumed@1",
      purpose: "context",
    });
    expect(first.consumed_at).toBeTruthy();
    const replay = session.service.recordConsumption({
      dispatchId: "dsp_1",
      runId,
      revisionRef: "artifact:art_consumed@1",
      purpose: "context",
    });
    expect(replay).toEqual(first);
    expect(session.events.filter((e) => e.type === ThreadEventType.ArtifactConsumed)).toHaveLength(1);

    // floating refs never enter consumption records
    try {
      session.service.recordConsumption({
        dispatchId: "dsp_1",
        runId,
        revisionRef: "artifact:art_consumed",
        purpose: "context",
      });
      expect.unreachable("floating ref must be rejected");
    } catch (error) {
      expect((error as AppError).code).toBe(ErrorCode.ARTIFACT_REF_INVALID);
    }
    session.db.close();
  });

  it("writes a resolve_rejected event when the ref cannot resolve but a thread is known", () => {
    const session = openArtifactSession(fixture);
    try {
      session.service.recordConsumption({
        dispatchId: "dsp_x",
        runId: fixture.graph.runIds[0],
        revisionRef: "artifact:art_ghost@1",
        purpose: "context",
        dispatchThreadId: fixture.graph.threadId,
      });
      expect.unreachable("unknown artifact must be rejected");
    } catch (error) {
      expect((error as AppError).code).toBe(ErrorCode.ARTIFACT_NOT_FOUND);
    }
    const rejects = session.events.filter((e) => e.type === ThreadEventType.ArtifactResolveRejected);
    expect(rejects).toHaveLength(1);
    expect(rejects[0].payload).toMatchObject({
      ref: "artifact:art_ghost@1",
      caller_mode: "record_consumption",
      reason_code: ErrorCode.ARTIFACT_NOT_FOUND,
    });
    session.db.close();
  });

  it("only logs when neither artifact nor caller thread can locate a thread", () => {
    const session = openArtifactSession(fixture);
    try {
      session.service.recordConsumption({
        dispatchId: "dsp_y",
        runId: fixture.graph.runIds[0],
        revisionRef: "artifact:art_ghost@1",
        purpose: "context",
      });
      expect.unreachable("unknown artifact must be rejected");
    } catch (error) {
      expect((error as AppError).code).toBe(ErrorCode.ARTIFACT_NOT_FOUND);
    }
    expect(session.events).toHaveLength(0);
    session.db.close();
  });
});
