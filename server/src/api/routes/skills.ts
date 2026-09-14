import type { FastifyPluginAsync } from "fastify";
import { AppError, parseRequestBody } from "../../api/errors.js";
import { ErrorCode } from "@personahub/shared/errors";
import { z } from "zod";
import type { SkillRegistry } from "../../services/skill-registry.js";
import type { EffectiveRequirementsResolver } from "../../services/effective-requirements.js";
import type { SkillDeliveryService } from "../../services/skill-delivery.js";
import type { SpaceService } from "../../services/space.js";
import type { ProjectService } from "../../services/project.js";

export interface SkillRoutesOptions {
  skillRegistry: SkillRegistry;
  resolver: EffectiveRequirementsResolver;
  delivery: SkillDeliveryService;
  spaceService: SpaceService;
  projectService: ProjectService;
}

const createSkillSchema = z.object({
  display_name: z.string().min(1),
  space_id: z.string().optional(),
  capability_tags: z.array(z.string()).optional(),
  steps: z.array(z.unknown()).nullable().optional(),
  completion_requirements: z.array(z.unknown()).nullable().optional(),
  files: z
    .array(z.object({ rel_path: z.string(), content: z.string() }))
    .optional(),
});

const addRevisionSchema = createSkillSchema.omit({ display_name: true, space_id: true });

const resolveConflictSchema = z.object({
  space_id: z.string().min(1),
  keep_skill_id: z.string().min(1),
});

export const skillRoutes: FastifyPluginAsync<SkillRoutesOptions> = async (app, opts) => {
  const { skillRegistry, resolver, delivery, spaceService, projectService } = opts;

  app.post("/api/skills:scan", async () => {
    return skillRegistry.scan();
  });

  // 普通 Skill 与编组共用一张表；两层状态并报（全局意图 + 当前 Space 生效结果）。
  app.get("/api/skills", async (request) => {
    const query = request.query as { space_id?: string };
    const spaceId = query.space_id ?? spaceService.getSelected()?.id;
    if (!spaceId) return { skills: [] };
    return { skills: skillRegistry.listForSpace(spaceId) };
  });

  app.get("/api/skills/:skill_id", async (request) => {
    const { skill_id } = request.params as { skill_id: string };
    return { skill: skillRegistry.getSkillRow(skill_id) };
  });

  app.get("/api/skills/:skill_id/revisions", async (request) => {
    const { skill_id } = request.params as { skill_id: string };
    return { revisions: skillRegistry.listRevisions(skill_id) };
  });

  app.get("/api/skills/:skill_id/revisions/:version", async (request) => {
    const { skill_id, version } = request.params as { skill_id: string; version: string };
    const parsed = skillRegistry.getRevision(skill_id, Number(version));
    return {
      revision: parsed.revision,
      steps: parsed.content.steps ?? [],
      completion_requirements: parsed.content.completionRequirements,
    };
  });

  // 只读文件清单 + hash（FR-008 详情下钻）。
  app.get("/api/skills/:skill_id/revisions/:version/files", async (request) => {
    const { skill_id, version } = request.params as { skill_id: string; version: string };
    return { files: skillRegistry.getRevisionFiles(skill_id, Number(version)) };
  });

  // 按 adapter 的下发事实（FR-008）：pending / failed 都必须可见。
  app.get("/api/skills/:skill_id/revisions/:version/delivery", async (request) => {
    const { skill_id, version } = request.params as { skill_id: string; version: string };
    return { deliveries: delivery.list(skill_id, Number(version)) };
  });

  // version 走 query 而非 path segment，避免 `@` 在 path 中的编码歧义。
  app.get("/api/skills/:skill_id/effective-requirements", async (request) => {
    const { skill_id } = request.params as { skill_id: string };
    const query = request.query as { version?: string };
    const version = Number(query.version ?? skillRegistry.getSkillRow(skill_id).current_revision);
    const result = resolver.resolveEffectiveRequirements(`${skill_id}@${version}`);
    if ("not_found" in result) {
      return { not_found: true };
    }
    return { ...result, skill_id, version };
  });

  app.post("/api/skills", async (request, reply) => {
    const body = parseRequestBody(createSkillSchema, request.body);
    const { skill, version } = skillRegistry.createSkill({
      display_name: body.display_name,
      space_id: body.space_id ?? spaceService.getSelected()?.id ?? null,
      draft: {
        capability_tags: body.capability_tags,
        steps: body.steps ?? null,
        completion_requirements: body.completion_requirements ?? null,
        files: body.files?.map((f) => ({ rel_path: f.rel_path, content: f.content })),
      },
    });
    // 激活先提交，下发在其后逐安装执行（失败不回滚激活）。
    delivery.enqueuePending(skill.id, version);
    delivery.deliverAll(skill.id, version);
    reply.code(201);
    return { skill, version };
  });

  app.post("/api/skills/:skill_id/revisions", async (request, reply) => {
    const { skill_id } = request.params as { skill_id: string };
    const body = parseRequestBody(addRevisionSchema, request.body);
    const { version } = skillRegistry.addRevision(skill_id, {
      capability_tags: body.capability_tags,
      steps: body.steps ?? null,
      completion_requirements: body.completion_requirements ?? null,
      files: body.files?.map((f) => ({ rel_path: f.rel_path, content: f.content })),
    });
    delivery.enqueuePending(skill_id, version);
    delivery.deliverAll(skill_id, version);
    reply.code(201);
    return { version };
  });

  app.post("/api/skills/:skill_id/activate", async (request) => {
    const { skill_id } = request.params as { skill_id: string };
    const body = (request.body ?? {}) as { version?: number };
    void skill_id;
    const version = body.version ?? skillRegistry.getSkillRow(skill_id).current_revision;
    skillRegistry.activate(skill_id, version);
    delivery.enqueuePending(skill_id, version);
    delivery.deliverAll(skill_id, version);
    return { skill_id, version };
  });

  app.post("/api/skills/:skill_id/disable", async (request) => {
    const { skill_id } = request.params as { skill_id: string };
    skillRegistry.disable(skill_id);
    return { skill: skillRegistry.getSkillRow(skill_id) };
  });

  // 冲突消解必须带 space_id（该 Space 内选定保留方置 active、其余 shadowed）。
  app.post("/api/skills/:skill_id/resolve-conflict", async (request) => {
    const { skill_id } = request.params as { skill_id: string };
    const body = parseRequestBody(resolveConflictSchema, request.body);
    if (body.keep_skill_id !== skill_id) {
      // 保留方必须与 URL 中的 skill 一致，避免歧义的多 keep 请求。
      throw new AppError(ErrorCode.REQUEST_BODY_INVALID, "keep_skill_id must match the URL skill id.", "keep_skill_id");
    }
    skillRegistry.resolveConflict(body.space_id, body.keep_skill_id);
    return { skills: skillRegistry.listForSpace(body.space_id) };
  });

  // 项目默认 Skill 引用：只存引用，不复制内容（FR-007）。
  app.put("/api/projects/:project_id/default-skill", async (request) => {
    const { project_id } = request.params as { project_id: string };
    const body = (request.body ?? {}) as { skill_id?: string | null; pinned_version?: number | null };
    const current = projectService.getById(project_id);
    if (!current) {
      projectService.get(project_id);
    }
    projectService.assertNotArchived(current!);
    const now = new Date().toISOString();
    if (!body.skill_id) {
      skillRegistry.clearDefaultSkillRef(project_id, now);
      return { project_id, skill_id: null, pinned_version: null };
    }
    const pinnedVersion = body.pinned_version ?? null;
    if (pinnedVersion !== null && (!Number.isSafeInteger(pinnedVersion) || pinnedVersion <= 0)) {
      throw new AppError(ErrorCode.REQUEST_BODY_INVALID, "pinned_version must be a positive safe integer.");
    }
    skillRegistry.setDefaultSkillRef(project_id, body.skill_id, pinnedVersion, now);
    return { project_id, skill_id: body.skill_id, pinned_version: pinnedVersion };
  });

  app.get("/api/projects/:project_id/skills", async (request) => {
    const { project_id } = request.params as { project_id: string };
    projectService.get(project_id);
    return { refs: skillRegistry.listProjectSkillRefs(project_id) };
  });
};
