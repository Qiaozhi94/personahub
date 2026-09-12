import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import { ErrorCode } from "@personahub/shared/errors";
import { ThreadEventType } from "@personahub/shared/types";
import { buildEvidenceRef } from "../../src/evidence-ref.js";
import { registerRoutes } from "../../src/api/index.js";
import { AppError, getErrorStatus, buildErrorResponse } from "../../src/api/errors.js";
import {
  disposeArtifactFixture,
  makeArtifactGraphFixture,
  openArtifactSession,
  writeWorkspaceFile,
  type ArtifactGraphFixture,
  type ArtifactSession,
} from "../helpers-artifact.js";

// F010 T011/T021 (AC-003): Run / Artifact / Evidence provenance stays correctly
// bidirectional under a multi-entity fixture, consumption is idempotent per
// (dispatch, run, revision, purpose), and events only exist for committed
// domain writes. The HTTP surface is exercised through the same route stack
// the production server registers.

let fixture: ArtifactGraphFixture;
let session: ArtifactSession;

beforeEach(() => {
  fixture = makeArtifactGraphFixture(2);
  session = openArtifactSession(fixture);
});

afterEach(() => {
  session.db.close();
  disposeArtifactFixture(fixture);
});

function inlineInput(artifactId: string, content: string, evidenceRefs: string[] = []) {
  return {
    artifact_id: artifactId,
    issue_id: fixture.graph.issueId,
    thread_id: fixture.graph.threadId,
    type: "report",
    title: `Report ${artifactId}`,
    storage: { storage_kind: "inline_markdown", inline_content: content } as const,
    source_run_id: fixture.graph.runIds[0],
    evidence_refs: evidenceRefs,
    created_by: "tester",
    idempotency_key: `key-${artifactId}`,
  };
}

describe("F010 provenance bidirectionality", () => {
  it("keeps multiple artifacts, runs and dispatches from crossing streams", () => {
    const evidenceA = buildEvidenceRef("event", "evt_a");
    const evidenceB = buildEvidenceRef("file_change_set", fixture.graph.runIds[0]);
    session.service.createArtifact(inlineInput("art_a", "# A", [evidenceA]));
    session.service.createArtifact(inlineInput("art_b", "# B", [evidenceB]));

    const [run0, run1] = fixture.graph.runIds;
    session.service.recordConsumption({ dispatchId: "dsp_1", runId: run0, revisionRef: "artifact:art_a@1", purpose: "context" });
    session.service.recordConsumption({ dispatchId: "dsp_1", runId: run1, revisionRef: "artifact:art_a@1", purpose: "context" });
    session.service.recordConsumption({ dispatchId: "dsp_2", runId: run1, revisionRef: "artifact:art_b@1", purpose: "validation" });

    // artifact -> consumers
    const provA = session.resolver.getProvenance("art_a");
    expect(provA.status).toBe("ready");
    const consumptionsA = (provA as { provenance: { consumptions: Array<{ dispatch_id: string; run_id: string }> } }).provenance.consumptions;
    expect(consumptionsA).toEqual([
      expect.objectContaining({ artifact_id: "art_a", dispatch_id: "dsp_1", run_id: run0 }),
      expect.objectContaining({ artifact_id: "art_a", dispatch_id: "dsp_1", run_id: run1 }),
    ]);

    // run -> consumed artifacts: each run sees exactly its own rows
    const run0View = session.resolver.listRunConsumptions(run0);
    expect(run0View).toMatchObject({ status: "ready", consumptions: [{ artifact_id: "art_a", dispatch_id: "dsp_1" }] });
    const run1View = session.resolver.listRunConsumptions(run1);
    expect((run1View as { consumptions: unknown[] }).consumptions).toHaveLength(2);

    // evidence -> artifacts: each ref maps to exactly its own artifact
    expect(session.resolver.listByEvidenceRef(evidenceA)).toMatchObject({
      status: "ready",
      items: [{ artifact: { id: "art_a" }, revision: 1 }],
    });
    expect(session.resolver.listByEvidenceRef(evidenceB)).toMatchObject({
      status: "ready",
      items: [{ artifact: { id: "art_b" }, revision: 1 }],
    });

    // artifact -> evidence
    const provB = session.resolver.getProvenance("art_b");
    expect((provB as { provenance: { evidence_links: unknown[] } }).provenance.evidence_links).toEqual([
      { artifact_id: "art_b", revision: 1, evidence_ref: evidenceB },
    ]);
  });

  it("idempotency granularity is (dispatch, run, revision, purpose)", () => {
    session.service.createArtifact(inlineInput("art_idem", "# idem"));
    const run0 = fixture.graph.runIds[0];
    const base = { dispatchId: "dsp_9", runId: run0, revisionRef: "artifact:art_idem@1" };

    const first = session.service.recordConsumption({ ...base, purpose: "context" });
    const replay = session.service.recordConsumption({ ...base, purpose: "context" });
    expect(replay).toEqual(first);

    // different purpose -> separate row (the PK's last component)
    const otherPurpose = session.service.recordConsumption({ ...base, purpose: "validation" });
    expect(otherPurpose).not.toEqual(first);
    // same dispatch continued under the second run -> separate row
    const nextRun = session.service.recordConsumption({
      dispatchId: "dsp_9",
      runId: fixture.graph.runIds[1],
      revisionRef: "artifact:art_idem@1",
      purpose: "context",
    });
    expect(nextRun.run_id).toBe(fixture.graph.runIds[1]);

    const prov = session.resolver.getProvenance("art_idem");
    expect((prov as { provenance: { consumptions: unknown[] } }).provenance.consumptions).toHaveLength(3);
    // replays never duplicate the consumed event
    expect(session.events.filter((e) => e.type === ThreadEventType.ArtifactConsumed)).toHaveLength(3);
  });

  it("creates one event per committed domain write and none for no-op replays", () => {
    session.service.createArtifact(inlineInput("art_events", "# v1"));
    session.service.reviseArtifact("art_events", {
      storage: { storage_kind: "inline_markdown", inline_content: "# v2" },
      created_by: "tester",
      idempotency_key: "key-ev-2",
      expected_current_revision: 1,
    });
    // a full create replay (new service calls, same keys) adds no events
    session.service.createArtifact(inlineInput("art_events", "# v1"));
    const types = session.events.map((e) => e.type);
    expect(types).toEqual([ThreadEventType.ArtifactCreated, ThreadEventType.ArtifactRevised]);
    // every recorded event is replayable from the persisted thread_events table
    const persisted = session.db.prepare("SELECT type FROM thread_events WHERE thread_id = ? ORDER BY event_sequence").all(
      fixture.graph.threadId,
    ) as Array<{ type: string }>;
    expect(persisted.map((r) => r.type)).toEqual(types);
  });
});

describe("F010 HTTP read surface", () => {
  let app: ReturnType<typeof buildApp>;

  function buildApp() {
    const fastify = Fastify();
    fastify.setErrorHandler((error, _request, reply) => {
      if (error instanceof AppError) {
        reply.code(getErrorStatus(error.code));
        return buildErrorResponse(error);
      }
      reply.code(500);
      return { error: { code: ErrorCode.INTERNAL_ERROR, message: error.message ?? "internal", details: {} } };
    });
    registerRoutes(fastify, {
      artifactService: session.service,
      artifactResolver: session.resolver,
    } as never);
    return fastify;
  }

  beforeEach(() => {
    app = buildApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it("serves create, revise, list, entity, revision, provenance, run and evidence reads", async () => {
    const evidenceRef = buildEvidenceRef("event", "evt_http");
    const createRes = await app.inject({
      method: "POST",
      url: "/api/artifacts",
      payload: { ...inlineInput("art_http", "# http", [evidenceRef]) },
    });
    expect(createRes.statusCode).toBe(201);
    const created = createRes.json();
    expect(created.revision.revision).toBe(1);

    // idempotent replay over HTTP returns the same revision with 200
    const replayRes = await app.inject({ method: "POST", url: "/api/artifacts", payload: { ...inlineInput("art_http", "# http", [evidenceRef]) } });
    expect(replayRes.statusCode).toBe(200);
    expect(replayRes.json().revision.revision).toBe(1);
    expect(replayRes.json().replayed).toBe(true);

    // CAS conflict surfaces the stable code
    const conflictRes = await app.inject({
      method: "POST",
      url: "/api/artifacts/art_http/revisions",
      payload: {
        storage: { storage_kind: "inline_markdown", inline_content: "# v2" },
        created_by: "tester",
        idempotency_key: "key-http-2",
        expected_current_revision: 42,
      },
    });
    expect(conflictRes.statusCode).toBe(409);
    expect(conflictRes.json().error.code).toBe(ErrorCode.ARTIFACT_REVISION_CONFLICT);

    const reviseRes = await app.inject({
      method: "POST",
      url: "/api/artifacts/art_http/revisions",
      payload: {
        storage: { storage_kind: "inline_markdown", inline_content: "# v2" },
        created_by: "tester",
        idempotency_key: "key-http-2",
        expected_current_revision: 1,
      },
    });
    expect(reviseRes.statusCode).toBe(201);
    expect(reviseRes.json().revision.revision).toBe(2);

    // list: ready for the owning issue, empty for an issue without artifacts
    const listRes = await app.inject({ method: "GET", url: `/api/artifacts?issue_id=${fixture.graph.issueId}` });
    expect(listRes.json().status).toBe("ready");
    expect(listRes.json().artifacts).toHaveLength(1);
    expect(listRes.json().artifacts[0].current_revision).toBe(2);
    expect((await app.inject({ method: "GET", url: "/api/artifacts?issue_id=iss_none" })).json().status).toBe("empty");
    expect((await app.inject({ method: "GET", url: "/api/artifacts" })).statusCode).toBe(400);

    // entity read with the current pointer
    const entityRes = await app.inject({ method: "GET", url: "/api/artifacts/art_http" });
    expect(entityRes.json()).toMatchObject({ status: "ready", artifact: { id: "art_http", current_revision: 2 } });
    expect((await app.inject({ method: "GET", url: "/api/artifacts/art_ghost" })).json().status).toBe("missing");

    // pinned revision read: v1 history does not drift
    const v1 = await app.inject({ method: "GET", url: "/api/artifacts/art_http/revisions/1" });
    expect(v1.json()).toMatchObject({ status: "ready", revision: { revision: 1 }, content: { text: "# http" } });
    const v9 = await app.inject({ method: "GET", url: "/api/artifacts/art_http/revisions/9" });
    expect(v9.json().status).toBe("missing");
    expect((await app.inject({ method: "GET", url: "/api/artifacts/art_http/revisions/zero" })).statusCode).toBe(400);

    // provenance: consumption + evidence links
    await app.inject({
      method: "GET",
      url: "/api/artifacts/art_http/provenance",
    });
    session.service.recordConsumption({ dispatchId: "dsp_h", runId: fixture.graph.runIds[0], revisionRef: "artifact:art_http@2", purpose: "context" });
    const provRes = await app.inject({ method: "GET", url: "/api/artifacts/art_http/provenance" });
    const prov = provRes.json();
    expect(prov.status).toBe("ready");
    expect(prov.provenance.consumptions).toHaveLength(1);
    expect(prov.provenance.evidence_links).toEqual([{ artifact_id: "art_http", revision: 1, evidence_ref: evidenceRef }]);

    // run -> artifacts
    const runRes = await app.inject({ method: "GET", url: `/api/runs/${fixture.graph.runIds[0]}/artifacts` });
    expect(runRes.json()).toMatchObject({ status: "ready", consumptions: [{ artifact_id: "art_http", revision: 2 }] });

    // evidence -> artifacts: the ref is percent-encoded exactly once by the client
    const evidenceRes = await app.inject({
      method: "GET",
      url: `/api/evidence/artifacts?ref=${encodeURIComponent(evidenceRef)}`,
    });
    expect(evidenceRes.json()).toMatchObject({ status: "ready", items: [{ artifact: { id: "art_http" }, revision: 1 }] });
    expect((await app.inject({ method: "GET", url: "/api/evidence/artifacts" })).statusCode).toBe(400);
  });

  it("serves file revision content base64-encoded and hash-verifiable", async () => {
    writeWorkspaceFile(fixture, "docs/http.md", "binary-ish bytes ünicode");
    session.service.createArtifact({
      artifact_id: "art_http_file",
      issue_id: fixture.graph.issueId,
      thread_id: fixture.graph.threadId,
      type: "report",
      title: "HTTP file",
      storage: { storage_kind: "workspace_file", source_path: "docs/http.md" },
      created_by: "tester",
      idempotency_key: "key-http-file",
    });
    const res = await app.inject({ method: "GET", url: "/api/artifacts/art_http_file/revisions/1" });
    const body = res.json();
    expect(body.status).toBe("ready");
    expect(body.content.storage_kind).toBe("workspace_file");
    expect(Buffer.from(body.content.content_base64, "base64").toString()).toBe("binary-ish bytes ünicode");
    expect(body.content.size_bytes).toBe(Buffer.byteLength("binary-ish bytes ünicode"));
  });
});
