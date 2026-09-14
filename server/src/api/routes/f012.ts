// F012 T013 + T010/T012 routes: session surface (rooms/messages/convert) and
// the dispatch/intervention/runtime endpoints (design §4.1–§4.3). Route layer
// validates types only (zod); business rules and ErrorCodes live in the
// services. Dispatch writes go through DispatchService exclusively (不变量 7).

import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { GateScopeType } from "@personahub/shared/types";
import type { SessionService } from "../../services/session-service.js";
import type { DispatchService } from "../../services/dispatch-service.js";
import type { DispatchGateService } from "../../services/dispatch-gate-service.js";
import type { EligibilityEvaluator } from "../../services/eligibility-evaluator.js";
import type { RuntimeProjectionService } from "../../services/runtime-projection.js";
import { DepthNormalized, DispatchPurpose, type ContextScope } from "@personahub/shared/types";
import { parseRequestBody } from "../errors.js";

export interface F012RoutesOptions {
  sessionService: SessionService;
  dispatchService: DispatchService;
  gateService: DispatchGateService;
  eligibilityEvaluator: EligibilityEvaluator;
  runtimeProjection: RuntimeProjectionService;
}

const createRoomSchema = z.object({
  space_id: z.string(),
  issue_id: z.string().nullable().optional(),
  title: z.string(),
});

const appendMessageSchema = z.object({
  body: z.string(),
});

const convertToTaskSchema = z.object({
  project_id: z.string().nullable().optional(),
  goal: z.string(),
});

const confirmDispatchSchema = z.object({
  room_id: z.string(),
  purpose: z.enum(["execute", "validate", "design_cases"]),
  adapter_config_id: z.string(),
  model: z.string(),
  depth_raw: z.string(),
  depth_normalized: z.enum(["high", "medium", "low"]),
  context_scope: z.enum(["all", "result_only", "goal_only"]),
  skill_revision_refs: z.array(z.string()).default([]),
  effective_requirements_json: z.string().default("[]"),
  effective_requirements_hash: z.string().default("sha256:none"),
  handoff_refs: z.array(z.string()).default([]),
  task_scope: z.record(z.array(z.string())).nullable().optional(),
  requirement_override: z
    .object({ requirementId: z.string(), strength: z.string(), reason: z.string() })
    .nullable()
    .optional(),
  user_requested_restart: z.boolean().optional(),
});

const eligibilityQuerySchema = z.object({
  purpose: z.enum(["execute", "validate", "design_cases"]),
  skill_refs: z.array(z.string()).optional(),
  context_scope: z.enum(["all", "result_only", "goal_only"]).default("all"),
});

const gateStateSchema = z.object({
  state: z.enum(["open", "paused"]),
  reason: z.string().nullable().optional(),
});


export const f012Routes: FastifyPluginAsync<F012RoutesOptions> = async (app, opts) => {
  const { sessionService, dispatchService, gateService, eligibilityEvaluator, runtimeProjection } = opts;

  // ------------------------------------------------------------- sessions
  app.post("/api/rooms", async (request, reply) => {
    const body = parseRequestBody(createRoomSchema, request.body ?? {});
    const room = sessionService.createRoom(body);
    reply.code(201);
    return { room };
  });

  app.get("/api/rooms/:roomId", async (request) => {
    const { roomId } = request.params as { roomId: string };
    const query = parseRequestBody(z.object({ before: z.coerce.number().optional() }), request.query ?? {});
    return sessionService.getRoomMessages(roomId, query.before);
  });

  app.post("/api/rooms/:roomId/messages", async (request) => {
    const { roomId } = request.params as { roomId: string };
    const body = parseRequestBody(appendMessageSchema, request.body ?? {});
    const idempotencyKey = request.headers["idempotency-key"];
    const event = sessionService.appendMessage(
      roomId,
      body.body,
      typeof idempotencyKey === "string" ? idempotencyKey : null,
    );
    return { event };
  });

  app.post("/api/rooms/:roomId/end", async (request) => {
    const { roomId } = request.params as { roomId: string };
    return { room: sessionService.endRoom(roomId) };
  });

  app.post("/api/rooms/:roomId/convert-to-task", async (request) => {
    const { roomId } = request.params as { roomId: string };
    const body = parseRequestBody(convertToTaskSchema, request.body ?? {});
    return sessionService.convertToTask(roomId, body);
  });

  // ----------------------------------------------------------- eligibility
  app.get("/api/rooms/:roomId/eligibility", async (request) => {
    const { roomId } = request.params as { roomId: string };
    const query = parseRequestBody(eligibilityQuerySchema, request.query ?? {});
    return eligibilityEvaluator.evaluate({
      roomId,
      purpose: query.purpose as DispatchPurpose,
      skillRefs: query.skill_refs ?? [],
      contextScope: (query.context_scope ?? "all") as ContextScope,
    });
  });

  // ------------------------------------------------------ dispatch + gates
  app.post("/api/rooms/:roomId/dispatches", async (request, reply) => {
    const { roomId } = request.params as { roomId: string };
    const body = parseRequestBody(confirmDispatchSchema, request.body ?? {});
    const idempotencyKey = request.headers["idempotency-key"];
    const dispatch = await dispatchService.confirm({
      roomId,
      clientRequestId: typeof idempotencyKey === "string" ? idempotencyKey : `auto_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      purpose: body.purpose as DispatchPurpose,
      identity: {
        runtime_id: "local",
        adapter_config_id: body.adapter_config_id,
        access_ref: null,
        model: body.model,
        depth_raw: body.depth_raw,
        depth_normalized: body.depth_normalized as DepthNormalized,
      },
      identitySnapshotJson: JSON.stringify({ adapter_config_id: body.adapter_config_id, runtime_id: "local" }),
      contextScope: (body.context_scope ?? "all") as ContextScope,
      skillRevisionRefs: body.skill_revision_refs ?? [],
      effectiveRequirementsJson: body.effective_requirements_json ?? "[]",
      effectiveRequirementsHash: body.effective_requirements_hash ?? "sha256:none",
      handoffRefs: body.handoff_refs ?? [],
      taskScopeJson: body.task_scope ? JSON.stringify(body.task_scope) : null,
      requirementOverride: body.requirement_override ?? null,
      graceWindowMs: Number(process.env.DISPATCH_GRACE_WINDOW_MS ?? 10_000),
      actor: "user",
      userRequestedRestart: body.user_requested_restart ?? false,
    });
    reply.code(201);
    return { dispatch };
  });

  app.post("/api/dispatches/:id/cancel", async (request) => {
    const { id } = request.params as { id: string };
    return { dispatch: dispatchService.cancel(id, "user") };
  });

  app.post("/api/dispatches/:id/start-now", async (request) => {
    const { id } = request.params as { id: string };
    const outcome = await dispatchService.startNow(id, "http-request");
    return { dispatch: outcome.dispatch, attempt_id: outcome.attemptId, run_id: outcome.runId, start_mode: outcome.startMode };
  });

  app.get("/api/dispatches/:id", async (request) => {
    const { id } = request.params as { id: string };
    const dispatch = dispatchService.get(id);
    return {
      dispatch,
      attempts: dispatchService.listAttempts(id),
      context_snapshot: dispatchService.getContextSnapshot(id),
    };
  });

  app.post("/api/attempts/:id/cancel", async (request) => {
    const { id } = request.params as { id: string };
    return { attempt: await dispatchService.cancelAttempt(id, "user") };
  });

  app.put("/api/gates/:scopeType/:scopeId", async (request) => {
    const { scopeType, scopeId } = request.params as { scopeType: string; scopeId: string };
    if (!Object.values(GateScopeType).includes(scopeType as GateScopeType)) {
      throw Object.assign(new Error(`Unknown gate scope: ${scopeType}`), { code: "GATE_SCOPE_UNKNOWN", statusCode: 404 });
    }
    const body = parseRequestBody(gateStateSchema, request.body ?? {});
    const gate = gateService.setPaused(
      scopeType as GateScopeType,
      scopeId,
      body.state === "paused",
      body.reason ?? null,
      "user",
    );
    return { gate };
  });

  // ------------------------------------------------------------- runtime
  app.get("/api/runtime/machines/:machineId", async (request) => {
    const { machineId } = request.params as { machineId: string };
    return runtimeProjection.getMachineSnapshot(machineId);
  });

  app.get("/api/runtime/adapters/:adapterConfigId", async (request) => {
    const { adapterConfigId } = request.params as { adapterConfigId: string };
    return runtimeProjection.getAdapterFacts(adapterConfigId);
  });
};
