import { useState } from "react";
import { ErrorCode, type WorkflowTemplateDetail, type WorkflowTemplateVersionSummary } from "@personahub/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  useWorkflowTemplates,
  useWorkflowTemplate,
  useCreateWorkflowTemplateVersion,
  useActivateWorkflowTemplate,
  useDeactivateWorkflowTemplate,
} from "@/hooks/use-workflow-templates";
import {
  isActiveTemplate,
  templateStatusLabel,
  templateStatusVariant,
  validationEnabledState,
} from "./template-status";

interface WorkflowTemplateAdminDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface StepsPreview {
  valid: boolean;
  hasValidator: boolean;
  error: string | null;
}

function previewSteps(stepsJson: string | null | undefined): StepsPreview {
  if (!stepsJson) return { valid: true, hasValidator: false, error: null };
  try {
    const parsed = JSON.parse(stepsJson) as { steps?: Array<{ role?: string }> };
    const steps = Array.isArray(parsed.steps) ? parsed.steps : [];
    return { valid: true, hasValidator: steps.some((s) => s.role === "validator"), error: null };
  } catch (e) {
    return { valid: false, hasValidator: false, error: (e as Error).message };
  }
}

export function WorkflowTemplateAdminDialog({ open, onOpenChange }: WorkflowTemplateAdminDialogProps) {
  const templatesQuery = useWorkflowTemplates();
  const templates = templatesQuery.data?.templates ?? [];
  const activeTemplate = templates.find((t) => t.status === "active") ?? null;

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorName, setEditorName] = useState("");
  const [editorSteps, setEditorSteps] = useState("");
  const [acknowledgeOpen, setAcknowledgeOpen] = useState(false);
  const [acknowledgeChecked, setAcknowledgeChecked] = useState(false);
  const [acknowledgeError, setAcknowledgeError] = useState<string | null>(null);
  const [pendingCreate, setPendingCreate] = useState<{ name: string; steps_json: string | null } | null>(null);
  const [pendingActivateId, setPendingActivateId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const detailQuery = useWorkflowTemplate(selectedId);
  const createVersion = useCreateWorkflowTemplateVersion();
  const activate = useActivateWorkflowTemplate();
  const deactivate = useDeactivateWorkflowTemplate();

  function closeEditor() {
    setEditorOpen(false);
    setPendingCreate(null);
    setPendingActivateId(null);
    setAcknowledgeOpen(false);
    setAcknowledgeChecked(false);
    setAcknowledgeError(null);
    setError(null);
  }

  function openEditor(source: WorkflowTemplateDetail | WorkflowTemplateVersionSummary) {
    setEditorName(source.name);
    setEditorSteps("steps_json" in source ? (source.steps_json ?? "") : "");
    setEditorOpen(true);
    setError(null);
  }

  function needsAcknowledge(stepsPreview: StepsPreview): boolean {
    if (!stepsPreview.valid) return false;
    if (!stepsPreview.hasValidator) return true;
    return activeTemplate?.validation_enabled !== true;
  }

  function submitEnable(name: string, stepsJson: string | null) {
    const preview = previewSteps(stepsJson);
    if (!preview.valid) {
      setError(`steps_json is not valid JSON: ${preview.error}`);
      return;
    }
    if (needsAcknowledge(preview)) {
      setPendingCreate({ name, steps_json: stepsJson });
      setAcknowledgeError(
        "This version does not enable validation for new issues (or the current active template's validation state is unknown). Enabling it will take effect for all newly created issues.",
      );
      setAcknowledgeChecked(false);
      setAcknowledgeOpen(true);
      return;
    }
    runCreateVersion({ name, steps_json: stepsJson, activate: true });
  }

  function runCreateVersion(input: { name: string; steps_json: string | null; activate: boolean }) {
    if (!selectedId) return;
    setError(null);
    createVersion.mutate(
      { sourceId: selectedId, input },
      {
        onSuccess: () => {
          closeEditor();
          setSelectedId(null);
        },
        onError: (err) => {
          const code = (err as { code?: string })?.code;
          if (code === ErrorCode.VALIDATION_DISABLE_NOT_ACKNOWLEDGED) {
            setPendingCreate({ name: input.name, steps_json: input.steps_json });
            setAcknowledgeError("This version removes validation for new issues. You must confirm to enable it.");
            setAcknowledgeChecked(false);
            setAcknowledgeOpen(true);
          } else if (code === ErrorCode.TEMPLATE_VERSION_CONFLICT) {
            setError(
              "Version conflict — another version was created concurrently. The list has been refreshed; try again.",
            );
          } else {
            setError((err as { message?: string })?.message ?? "Failed to create version.");
          }
        },
      },
    );
  }

  function confirmCreate() {
    if (!pendingCreate) return;
    const input = {
      name: pendingCreate.name,
      steps_json: pendingCreate.steps_json,
      activate: true,
      acknowledge_validation_disabled: acknowledgeChecked,
    };
    setAcknowledgeOpen(false);
    setPendingCreate(null);
    runCreateVersion(input);
  }

  function activateVersion(id: string, detail: WorkflowTemplateDetail | null) {
    setError(null);
    const needsAck = detail ? detail.validation_enabled !== true : true;
    if (needsAck) {
      setPendingActivateId(id);
      setAcknowledgeError(
        "Activating this version disables validation for new issues (or its validation state cannot be confirmed).",
      );
      setAcknowledgeChecked(false);
      setAcknowledgeOpen(true);
      return;
    }
    runActivate(id);
  }

  function runActivate(id: string) {
    setError(null);
    activate.mutate(
      { id },
      {
        onError: (err) => {
          const code = (err as { code?: string })?.code;
          if (code === ErrorCode.VALIDATION_DISABLE_NOT_ACKNOWLEDGED) {
            setPendingActivateId(id);
            setAcknowledgeError("The server requires explicit confirmation that validation will be disabled.");
            setAcknowledgeChecked(false);
            setAcknowledgeOpen(true);
          } else if (code === ErrorCode.TEMPLATE_STEPS_INVALID) {
            setError(
              "This version cannot be enabled: its steps_json is invalid. Fix it by creating a corrected version.",
            );
          } else {
            setError((err as { message?: string })?.message ?? "Failed to activate version.");
          }
        },
      },
    );
  }

  function confirmActivate() {
    if (!pendingActivateId) return;
    const id = pendingActivateId;
    setAcknowledgeOpen(false);
    setPendingActivateId(null);
    activate.mutate({ id, input: { acknowledge_validation_disabled: acknowledgeChecked } });
  }

  function deactivateVersion(id: string) {
    setError(null);
    if (
      !window.confirm(
        "Deactivate this workflow template version? New issues will keep using the remaining active version.",
      )
    ) {
      return;
    }
    deactivate.mutate(id, {
      onError: (err) => {
        const code = (err as { code?: string })?.code;
        if (code === ErrorCode.LAST_ACTIVE_TEMPLATE) {
          setError("Cannot deactivate the last active template — new issues would have no workflow to run.");
        } else {
          setError((err as { message?: string })?.message ?? "Failed to deactivate version.");
        }
      },
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) closeEditor();
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Workflow templates</DialogTitle>
          <DialogDescription>
            Versions of the coding workflow. Only <code>steps_json</code> and <code>name</code> are editable —
            <code>steps_json</code> is the single switch that controls whether validation runs for new issues.
          </DialogDescription>
        </DialogHeader>

        {error ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        ) : null}

        {editorOpen ? (
          <Editor
            name={editorName}
            steps={editorSteps}
            onNameChange={setEditorName}
            onStepsChange={setEditorSteps}
            onSaveDraft={() => {
              if (!selectedId) return;
              runCreateVersion({ name: editorName, steps_json: editorSteps, activate: false });
            }}
            onSaveAndEnable={() => submitEnable(editorName, editorSteps)}
            onCancel={() => setEditorOpen(false)}
            pending={createVersion.isPending}
          />
        ) : templatesQuery.isLoading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : selectedId && detailQuery.data ? (
          <TemplateDetail
            detail={detailQuery.data.template}
            onBack={() => setSelectedId(null)}
            onEdit={() => openEditor(detailQuery.data!.template)}
            onActivate={() => activateVersion(selectedId, detailQuery.data!.template)}
            onDeactivate={() => deactivateVersion(selectedId)}
            activating={activate.isPending}
          />
        ) : (
          <>
            <div className="grid max-h-72 gap-1 overflow-y-auto">
              {templates.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setSelectedId(t.id)}
                  className="flex w-full items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-left text-sm hover:bg-accent"
                >
                  <span className="min-w-0">
                    <span className="font-medium">v{t.version}</span>
                    <span className="ml-2 text-muted-foreground">{t.name}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    <Badge variant={templateStatusVariant(t.status)}>{templateStatusLabel(t.status)}</Badge>
                    <ValidationBadge enabled={t.validation_enabled} />
                  </span>
                </button>
              ))}
              {templates.length === 0 ? (
                <div className="rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
                  No workflow template versions found.
                </div>
              ) : null}
            </div>

            <span className="text-xs text-muted-foreground">
              Active version: {activeTemplate ? `v${activeTemplate.version} (${activeTemplate.name})` : "none"}
            </span>
          </>
        )}
      </DialogContent>

      <AcknowledgeDialog
        open={acknowledgeOpen}
        error={acknowledgeError}
        checked={acknowledgeChecked}
        onCheckedChange={setAcknowledgeChecked}
        onCancel={() => {
          setAcknowledgeOpen(false);
          setPendingCreate(null);
          setPendingActivateId(null);
        }}
        onConfirm={pendingCreate ? confirmCreate : confirmActivate}
      />
    </Dialog>
  );
}

function ValidationBadge({ enabled }: { enabled: boolean | null }) {
  const state = validationEnabledState(enabled);
  return <Badge variant={state.variant}>{state.label}</Badge>;
}

function TemplateDetail({
  detail,
  onBack,
  onEdit,
  onActivate,
  onDeactivate,
  activating,
}: {
  detail: WorkflowTemplateDetail;
  onBack: () => void;
  onEdit: () => void;
  onActivate: () => void;
  onDeactivate: () => void;
  activating: boolean;
}) {
  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={onBack}>
          ← All versions
        </Button>
        <span className="flex items-center gap-1.5">
          <Badge variant={templateStatusVariant(detail.status)}>{templateStatusLabel(detail.status)}</Badge>
          <ValidationBadge enabled={detail.validation_enabled} />
        </span>
      </div>

      <div>
        <h3 className="text-sm font-semibold">
          v{detail.version} — {detail.name}
        </h3>
        {detail.parse_error ? (
          <p className="mt-1 text-xs text-destructive">
            steps_json cannot be parsed: {detail.parse_error}. This version cannot be enabled.
          </p>
        ) : null}
      </div>

      <div className="grid gap-1.5">
        <span className="text-xs text-muted-foreground">Steps</span>
        {detail.steps.length === 0 ? (
          <div className="rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
            No steps. Validation is disabled for new issues created from this template.
          </div>
        ) : (
          <div className="grid gap-1">
            {detail.steps.map((step) => (
              <div
                key={step.id}
                className="flex items-center justify-between rounded-md border border-border px-3 py-1.5 text-xs"
              >
                <span className="font-medium">{step.id}</span>
                <span className="text-muted-foreground">{step.role}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="grid gap-1.5">
        <span className="text-xs text-muted-foreground">Read-only fields (v0.2 does not affect runtime behavior)</span>
        <div className="grid grid-cols-2 gap-1.5 text-xs">
          <div className="rounded-md border border-border px-3 py-1.5">
            collaboration_topology: {detail.collaboration_topology || "—"}
          </div>
          <div className="rounded-md border border-border px-3 py-1.5">
            validation_policy_id: {detail.validation_policy_id || "—"}
          </div>
          <div className="rounded-md border border-border px-3 py-1.5">
            handoff_policy_json: {detail.handoff_policy_json || "—"}
          </div>
          <div className="rounded-md border border-border px-3 py-1.5">
            evidence_requirements_json: {detail.evidence_requirements_json || "—"}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button variant="secondary" size="sm" onClick={onEdit}>
          Edit &amp; create new version
        </Button>
        {isActiveTemplate(detail) ? (
          <Button variant="outline" size="sm" onClick={onDeactivate}>
            Deactivate
          </Button>
        ) : (
          <Button variant="default" size="sm" onClick={onActivate} disabled={activating || detail.parse_error !== null}>
            Activate
          </Button>
        )}
      </div>
    </div>
  );
}

function Editor({
  name,
  steps,
  onNameChange,
  onStepsChange,
  onSaveDraft,
  onSaveAndEnable,
  onCancel,
  pending,
}: {
  name: string;
  steps: string;
  onNameChange: (v: string) => void;
  onStepsChange: (v: string) => void;
  onSaveDraft: () => void;
  onSaveAndEnable: () => void;
  onCancel: () => void;
  pending: boolean;
}) {
  return (
    <div className="grid gap-3 rounded-md border border-border p-3">
      <div className="grid gap-1.5">
        <Label htmlFor="wft-name">Name</Label>
        <Input id="wft-name" value={name} onChange={(e) => onNameChange(e.target.value)} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="wft-steps">steps_json</Label>
        <Textarea
          id="wft-steps"
          rows={6}
          value={steps}
          onChange={(e) => onStepsChange(e.target.value)}
          placeholder='{"schema_version": 1, "steps": [{"id": "implementation", "role": "implementation"}, {"id": "validation", "role": "validator"}]}'
          className="font-mono text-xs"
        />
        <p className="text-[11px] text-muted-foreground">
          Including a step with role "validator" keeps validation enabled for new issues. Removing it disables
          validation.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={onSaveDraft} disabled={pending}>
          Save draft
        </Button>
        <Button variant="default" size="sm" onClick={onSaveAndEnable} disabled={pending}>
          Save &amp; enable
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function AcknowledgeDialog({
  open,
  error,
  checked,
  onCheckedChange,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  error: string | null;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onCancel();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Disable validation?</DialogTitle>
          <DialogDescription>
            {error ?? "Enabling this version will disable validation for all newly created issues."}
          </DialogDescription>
        </DialogHeader>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => onCheckedChange(e.target.checked)}
            className="mt-0.5"
            aria-label="Acknowledge validation disabled"
          />
          <span>
            I understand: after this version is enabled, new issues will not be validated until a template with a
            validator step is enabled again.
          </span>
        </label>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="destructive" size="sm" disabled={!checked} onClick={onConfirm}>
            Enable anyway
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
