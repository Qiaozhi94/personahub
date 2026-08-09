import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CreateWorkflowTemplateVersionInput, ActivateWorkflowTemplateInput } from "@personahub/shared";
import { apiClient } from "@/lib/api-client";

const ISSUE_TYPE = "coding";

export function useWorkflowTemplates() {
  return useQuery({
    queryKey: ["workflow-templates", ISSUE_TYPE],
    queryFn: () => apiClient.workflowTemplates.list(ISSUE_TYPE),
  });
}

export function useWorkflowTemplate(id: string | null) {
  return useQuery({
    queryKey: ["workflow-template", id],
    queryFn: () => apiClient.workflowTemplates.get(id!),
    enabled: id !== null,
  });
}

export function useCreateWorkflowTemplateVersion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ sourceId, input }: { sourceId: string; input: CreateWorkflowTemplateVersionInput }) =>
      apiClient.workflowTemplates.createVersion(sourceId, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["workflow-templates", ISSUE_TYPE] });
    },
  });
}

export function useActivateWorkflowTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input?: ActivateWorkflowTemplateInput }) =>
      apiClient.workflowTemplates.activate(id, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["workflow-templates", ISSUE_TYPE] });
      qc.invalidateQueries({ queryKey: ["workflow-template"] });
    },
  });
}

export function useDeactivateWorkflowTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.workflowTemplates.deactivate(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["workflow-templates", ISSUE_TYPE] });
      qc.invalidateQueries({ queryKey: ["workflow-template"] });
    },
  });
}
