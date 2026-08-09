import type { WorkflowTemplateVersionSummary, WorkflowTemplateDetail } from "@personahub/shared";

export type ValidationEnabledState =
  | { kind: "enabled"; label: "Validation enabled"; variant: "success" }
  | { kind: "disabled"; label: "Validation disabled"; variant: "warning" }
  | { kind: "unknown"; label: "Validation state unknown"; variant: "destructive" };

export function validationEnabledState(
  value: boolean | null,
): ValidationEnabledState {
  if (value === true) {
    return { kind: "enabled", label: "Validation enabled", variant: "success" };
  }
  if (value === false) {
    return { kind: "disabled", label: "Validation disabled", variant: "warning" };
  }
  return { kind: "unknown", label: "Validation state unknown", variant: "destructive" };
}

export function templateStatusLabel(status: string): string {
  return status === "active" ? "active" : "inactive";
}

export function templateStatusVariant(status: string): "success" | "secondary" {
  return status === "active" ? "success" : "secondary";
}

export function isActiveTemplate(template: WorkflowTemplateVersionSummary | WorkflowTemplateDetail): boolean {
  return template.status === "active";
}
