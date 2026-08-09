import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AppError, parseRequestBody } from "../errors.js";
import { ErrorCode } from "@personahub/shared/errors";
import type { ConfirmationToken } from "@personahub/shared/types";
import type { RoutingRecommendationService } from "../../services/routing-recommendation-service.js";
import { isBlockedRecommendationCode } from "../../services/routing-recommendation-service.js";
import type { IntakeService } from "../../services/intake-service.js";

export interface IntakeRoutesOptions {
  recommendationService: RoutingRecommendationService;
  intakeService: IntakeService;
}

const recommendSchema = z.object({
  goal: z.string(),
});

function recommendationSchema<T extends z.ZodTypeAny>(inner: T) {
  return z.object({
    value: inner,
    rule: z.string(),
    candidates: z.array(inner),
    excluded: z.array(z.object({ id: z.string(), reason: z.string() })),
  });
}

const issueDraftSchema = z.object({
  title: recommendationSchema(z.string()),
  goal: recommendationSchema(z.string()),
  priority: recommendationSchema(z.string()),
});

const topologyValueSchema = z.object({
  value: z.union([z.literal("sequential"), z.literal("orchestrator_subagent")]),
  definition_id: z.string().optional(),
  definition_version: z.number().optional(),
});

const nodeRosterSchema = z.object({
  candidates: z.array(z.string()),
  excluded: z.array(z.object({ id: z.string(), reason: z.string() })),
});

const agentRosterSchema = z.object({
  value: z.record(z.string()),
  rule: z.string(),
  by_node: z.record(nodeRosterSchema),
});

const premiseAdapterSchema = z.object({
  effective_status: z.enum(["available", "unavailable", "unknown"]),
  capability_tags: z.array(z.enum(["implementation", "validator"])),
  updated_at: z.string(),
});

const premiseSchema = z.object({
  project_id: z.string(),
  workspace_id: z.string(),
  adapters: z.record(premiseAdapterSchema),
  workflow_template_id: z.string(),
  workflow_template_version: z.number(),
  graph_definition_id: z.string().nullable(),
  graph_definition_version: z.number().nullable(),
});

const recommendedSchema = z.object({
  issue_type: recommendationSchema(z.enum(["coding"])),
  issue_draft: issueDraftSchema,
  workflow_template: recommendationSchema(z.object({ id: z.string(), version: z.number() })),
  collaboration_topology: recommendationSchema(topologyValueSchema),
  agent_roster: agentRosterSchema,
});

const tokenSchema = z.object({
  payload: z.object({
    nonce: z.string(),
    issued_at: z.string(),
    project_id: z.string(),
    workspace_id: z.string(),
    premise: premiseSchema,
    recommended: recommendedSchema,
  }),
  signature: z.string(),
});

const chosenSchema = z.discriminatedUnion("topology", [
  z
    .object({
      topology: z.literal("sequential"),
      adapter_config_id: z.string().min(1),
    })
    .strict(),
  z
    .object({
      topology: z.literal("orchestrator_subagent"),
      definition_id: z.string().min(1),
      definition_version: z.number().int().positive(),
      node_assignments: z.record(z.string().min(1)),
    })
    .strict(),
]);

const confirmBodySchema = z
  .object({
    token: tokenSchema,
    chosen: chosenSchema,
  })
  .strict();

export default async function intakeRoutes(app: FastifyInstance, opts: IntakeRoutesOptions): Promise<void> {
  const { recommendationService, intakeService } = opts;

  app.post("/api/projects/:projectId/intake/recommend", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const body = parseRequestBody(recommendSchema, request.body);
    const goal = body.goal ?? "";
    if (!goal.trim()) {
      throw new AppError(ErrorCode.ISSUE_GOAL_REQUIRED, "Issue goal is required.", "goal");
    }
    try {
      const result = recommendationService.recommend(projectId, goal);
      reply.code(200);
      return result;
    } catch (err) {
      if (err instanceof AppError && isBlockedRecommendationCode(err.code)) {
        reply.code(409);
        return {
          error: {
            code: err.code,
            message: err.message,
            details: err.details ?? {},
          },
        };
      }
      throw err;
    }
  });

  app.post("/api/projects/:projectId/intake/confirm", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const body = parseRequestBody(confirmBodySchema, request.body);
    const token = body.token as unknown as ConfirmationToken;
    const result = await intakeService.confirm(projectId, token, body.chosen);
    reply.code(result.replayed ? 200 : 201);
    return result.response;
  });
}
