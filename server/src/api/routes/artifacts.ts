import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { ErrorCode } from "@personahub/shared/errors";
import type { CreateArtifactInput, ReviseArtifactInput } from "@personahub/shared/types";
import type { ArtifactService } from "../../services/artifact/service.js";
import type { ArtifactResolver } from "../../services/artifact/resolver.js";
import { AppError, parseRequestBody } from "../errors.js";

export interface ArtifactRoutesOptions {
  artifactService: ArtifactService;
  artifactResolver: ArtifactResolver;
}

/**
 * F010 provenance routes. Typed refs travel only in the query string: the
 * client percent-encodes once, Fastify's query parser decodes once, and the
 * route/service handle the decoded raw ref — never decode a second time
 * (design §4).
 */

const storagePayloadSchema = z.discriminatedUnion("storage_kind", [
  z.object({
    storage_kind: z.literal("inline_markdown"),
    inline_content: z.string().min(1),
  }),
  z.object({
    storage_kind: z.literal("workspace_file"),
    source_path: z.string().min(1),
  }),
]);

const createArtifactSchema = z.object({
  artifact_id: z.string().min(1),
  issue_id: z.string().min(1),
  thread_id: z.string().min(1),
  type: z.string().min(1),
  title: z.string().min(1),
  storage: storagePayloadSchema,
  source_run_id: z.string().min(1).nullish(),
  evidence_refs: z.array(z.string().min(1)).optional(),
  created_by: z.string().min(1),
  idempotency_key: z.string().min(1),
});

const reviseArtifactSchema = z.object({
  storage: storagePayloadSchema,
  source_run_id: z.string().min(1).nullish(),
  evidence_refs: z.array(z.string().min(1)).optional(),
  created_by: z.string().min(1),
  idempotency_key: z.string().min(1),
  expected_current_revision: z.number().int().min(1),
});

function parseRevisionParam(raw: string): number {
  if (!/^\d+$/.test(raw) || Number(raw) < 1 || !Number.isSafeInteger(Number(raw))) {
    throw new AppError(ErrorCode.INVALID_QUERY, "revision must be a positive integer.");
  }
  return Number(raw);
}

export const artifactRoutes: FastifyPluginAsync<ArtifactRoutesOptions> = async (
  app: FastifyInstance,
  opts: ArtifactRoutesOptions,
): Promise<void> => {
  const { artifactService, artifactResolver } = opts;

  app.post("/api/artifacts", async (request, reply) => {
    const body = parseRequestBody(createArtifactSchema, request.body);
    const input: CreateArtifactInput = {
      artifact_id: body.artifact_id,
      issue_id: body.issue_id,
      thread_id: body.thread_id,
      type: body.type,
      title: body.title,
      storage: body.storage,
      source_run_id: body.source_run_id ?? null,
      evidence_refs: body.evidence_refs,
      created_by: body.created_by,
      idempotency_key: body.idempotency_key,
    };
    const result = artifactService.createArtifact(input);
    reply.code(result.replayed ? 200 : 201);
    return { artifact: result.artifact, revision: result.revision, replayed: result.replayed };
  });

  app.post("/api/artifacts/:artifact_id/revisions", async (request, reply) => {
    const { artifact_id: artifactId } = request.params as { artifact_id: string };
    const body = parseRequestBody(reviseArtifactSchema, request.body);
    const input: ReviseArtifactInput = {
      storage: body.storage,
      source_run_id: body.source_run_id ?? null,
      evidence_refs: body.evidence_refs,
      created_by: body.created_by,
      idempotency_key: body.idempotency_key,
      expected_current_revision: body.expected_current_revision,
    };
    const result = artifactService.reviseArtifact(artifactId, input);
    reply.code(result.replayed ? 200 : 201);
    return { artifact: result.artifact, revision: result.revision, replayed: result.replayed };
  });

  app.get("/api/artifacts", async (request) => {
    const query = request.query as { issue_id?: string };
    if (!query.issue_id) {
      throw new AppError(ErrorCode.INVALID_QUERY, "issue_id query parameter is required.");
    }
    return artifactResolver.listByIssue(query.issue_id);
  });

  app.get("/api/artifacts/:artifact_id", async (request) => {
    const { artifact_id: artifactId } = request.params as { artifact_id: string };
    return artifactResolver.getEntity(artifactId);
  });

  app.get("/api/artifacts/:artifact_id/revisions/:revision", async (request) => {
    const { artifact_id: artifactId, revision } = request.params as { artifact_id: string; revision: string };
    return artifactResolver.getRevisionRead(artifactId, parseRevisionParam(revision));
  });

  app.get("/api/artifacts/:artifact_id/provenance", async (request) => {
    const { artifact_id: artifactId } = request.params as { artifact_id: string };
    return artifactResolver.getProvenance(artifactId);
  });

  app.get("/api/runs/:run_id/artifacts", async (request) => {
    const { run_id: runId } = request.params as { run_id: string };
    return artifactResolver.listRunConsumptions(runId);
  });

  app.get("/api/evidence/artifacts", async (request) => {
    const query = request.query as { ref?: string };
    if (!query.ref) {
      throw new AppError(ErrorCode.INVALID_QUERY, "ref query parameter is required.");
    }
    return artifactResolver.listByEvidenceRef(query.ref);
  });
};
