import { useQuery } from "@tanstack/react-query";
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
