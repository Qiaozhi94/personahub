import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { ErrorCode } from "@personahub/shared/errors";
import type { WorkflowTemplateAdminService } from "../../services/workflow-template-admin.js";
import { parseRequestBody, AppError } from "../errors.js";

export interface WorkflowTemplateRoutesOptions {
  workflowTemplateAdminService: WorkflowTemplateAdminService;
}

// F008 T020/AC-008: only name and steps_json are editable content fields.
// Any other field in the body -> 400 TEMPLATE_FIELD_NOT_EDITABLE (not silently
// ignored): a save-and-activate that silently dropped non-editable fields
// would let users believe they changed behavior that has no runtime consumer.
const ALLOWED_CREATE_FIELDS = new Set(["name", "steps_json", "activate", "acknowledge_validation_disabled"]);

function rejectNonEditableFields(body: unknown): void {
  if (body && typeof body === "object" && !Array.isArray(body)) {
    for (const key of Object.keys(body as Record<string, unknown>)) {
      if (!ALLOWED_CREATE_FIELDS.has(key)) {
        throw new AppError(
          ErrorCode.TEMPLATE_FIELD_NOT_EDITABLE,
          `Field '${key}' is not editable. Only 'name' and 'steps_json' (plus 'activate' and 'acknowledge_validation_disabled') are accepted.`,
          key,
        );
      }
    }
  }
}

const listQuerySchema = z.object({
  issue_type: z.string().optional(),
});

const createVersionSchema = z.object({
  name: z.string().optional(),
  steps_json: z.string().nullable().optional(),
  activate: z.boolean().optional(),
  acknowledge_validation_disabled: z.boolean().optional(),
});

const activateSchema = z.object({
  acknowledge_validation_disabled: z.boolean().optional(),
});

export const workflowTemplateRoutes: FastifyPluginAsync<WorkflowTemplateRoutesOptions> = async (app, opts) => {
  const { workflowTemplateAdminService } = opts;

  app.get("/api/workflow-templates", async (request) => {
    const query = parseRequestBody(listQuerySchema, request.query ?? {});
    const issueType = query.issue_type ?? "coding";
    const templates = workflowTemplateAdminService.list(issueType);
    return { templates };
  });

  app.get("/api/workflow-templates/:id", async (request) => {
    const { id } = request.params as { id: string };
    const template = workflowTemplateAdminService.detail(id);
    return { template };
  });

  app.post("/api/workflow-templates/:sourceId/versions", async (request, reply) => {
    const { sourceId } = request.params as { sourceId: string };
    rejectNonEditableFields(request.body);
    const body = parseRequestBody(createVersionSchema, request.body ?? {});
    const template = workflowTemplateAdminService.createVersion(sourceId, {
      name: body.name,
      steps_json: body.steps_json,
      activate: body.activate,
      acknowledge_validation_disabled: body.acknowledge_validation_disabled,
    });
    reply.code(201);
    return { template };
  });

  app.post("/api/workflow-templates/:id/activate", async (request) => {
    const { id } = request.params as { id: string };
    const body = parseRequestBody(activateSchema, request.body ?? {});
    const template = workflowTemplateAdminService.activate(id, body.acknowledge_validation_disabled);
    return { template };
  });

  app.post("/api/workflow-templates/:id/deactivate", async (request) => {
    const { id } = request.params as { id: string };
    parseRequestBody(z.object({}).optional(), request.body ?? {});
    const template = workflowTemplateAdminService.deactivate(id);
    return { template };
  });
};
