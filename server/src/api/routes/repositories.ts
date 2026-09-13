import type { FastifyPluginAsync } from "fastify";
import { parseRequestBody } from "../../api/errors.js";
import { z } from "zod";
import type { RepositoryRegistry } from "../../services/repository-registry.js";

export interface RepositoryRoutesOptions {
  repositoryRegistry: RepositoryRegistry;
}

const resolveBodySchema = z.object({
  source: z.string().min(1),
  runtime_id: z.string().optional(),
});

const createBodySchema = z.object({
  source: z.string().min(1),
  runtime_id: z.string().optional(),
});

const authorizeBodySchema = z.object({
  raw_path: z.string().min(1),
  runtime_id: z.string().optional(),
  access: z.enum(["read_write", "read_only"]),
  scope: z.unknown().optional(),
});

export const repositoryRoutes: FastifyPluginAsync<RepositoryRoutesOptions> = async (app, opts) => {
  const { repositoryRegistry } = opts;

  // 只探测不落库，供 UI 先看后存（FR-004 的"不要求手填名称"）。
  app.post("/api/repositories:resolve", async (request) => {
    const body = parseRequestBody(resolveBodySchema, request.body);
    return repositoryRegistry.resolve(body.source, body.runtime_id);
  });

  app.post("/api/repositories", async (request, reply) => {
    const body = parseRequestBody(createBodySchema, request.body);
    const repository = repositoryRegistry.create(body);
    reply.code(201);
    return { repository };
  });

  app.get("/api/repositories/:repository_id", async (request) => {
    const { repository_id } = request.params as { repository_id: string };
    const repository = repositoryRegistry.getById(repository_id);
    const machinePath = repositoryRegistry.getMachinePath(repository_id, "local");
    return {
      repository,
      machine_path: machinePath
        ? {
            runtime_id: machinePath.runtime_id,
            raw_path: machinePath.raw_path,
            real_path: machinePath.real_path,
            access: machinePath.access,
            scope_json: machinePath.scope_json ? (JSON.parse(machinePath.scope_json) as unknown) : null,
            case_insensitive: machinePath.case_insensitive === null ? null : machinePath.case_insensitive === 1,
            authorized_at: machinePath.authorized_at,
            last_verified_at: machinePath.last_verified_at,
          }
        : null,
    };
  });

  // 提交身份属于执行机器：读取时实时探测，不落库（design §3）。
  app.get("/api/repositories/:repository_id/identity", async (request) => {
    const { repository_id } = request.params as { repository_id: string };
    const query = request.query as { runtime_id?: string };
    const gitIdentity = repositoryRegistry.probeGitIdentity(repository_id, query.runtime_id);
    return { git_identity: gitIdentity };
  });

  // 机器路径授权（NFR-002 的授权半边）；幂等 upsert。
  app.post("/api/repositories/:repository_id/authorize", async (request, reply) => {
    const { repository_id } = request.params as { repository_id: string };
    const body = parseRequestBody(authorizeBodySchema, request.body);
    const { machine_path } = repositoryRegistry.authorizePath({
      repository_id,
      raw_path: body.raw_path,
      runtime_id: body.runtime_id,
      access: body.access,
      scope: body.scope,
    });
    reply.code(201);
    return { machine_path: { ...machine_path, scope_json: machine_path.scope_json ? (JSON.parse(machine_path.scope_json) as unknown) : null } };
  });
};
