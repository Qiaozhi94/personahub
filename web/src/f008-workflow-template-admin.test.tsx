import { describe, it, expect, beforeEach, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import {
  IssueType,
  type WorkflowTemplateDetail,
  type WorkflowTemplateDetailResponse,
  type WorkflowTemplateVersionSummary,
} from "@personahub/shared";
import { WorkflowTemplateAdminDialog } from "@/components/workflow-template/WorkflowTemplateAdminDialog";
import { renderWithQuery } from "@/test/ui-flow-helpers";

vi.mock("@/lib/api-client", () => import("@/test/api-client-mock"));

import { apiClient } from "@/lib/api-client";

const TS = "2026-01-01T00:00:00.000Z";

const ACTIVE_V1: WorkflowTemplateVersionSummary = {
  id: "wft_1",
  name: "Default workflow",
  issue_type: IssueType.Coding,
  status: "active",
  version: 1,
  validation_enabled: true,
  created_at: TS,
  updated_at: TS,
};

const INACTIVE_V2: WorkflowTemplateVersionSummary = {
  id: "wft_2",
  name: "No validation",
  issue_type: IssueType.Coding,
  status: "inactive",
  version: 2,
  validation_enabled: false,
  created_at: TS,
  updated_at: TS,
};

const VALID_STEPS = JSON.stringify({
  schema_version: 1,
  steps: [
    { id: "implementation", role: "implementation" },
    { id: "validation", role: "validator" },
  ],
});

const DETAIL_V1: WorkflowTemplateDetail = {
  id: "wft_1",
  name: "Default workflow",
  issue_type: IssueType.Coding,
  collaboration_topology: "sequential",
  agent_team_template_id: null,
  validation_policy_id: "vpl_1",
  steps_json: VALID_STEPS,
  handoff_policy_json: null,
  evidence_requirements_json: null,
  status: "active",
  version: 1,
  steps: [
    { id: "implementation", role: "implementation" },
    { id: "validation", role: "validator" },
  ],
  validation_enabled: true,
  parse_error: null,
  created_at: TS,
  updated_at: TS,
};

function detailResponse(detail: WorkflowTemplateDetail): WorkflowTemplateDetailResponse {
  return { template: detail };
}

describe("T050/T051: workflow template version list and detail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(apiClient.workflowTemplates.list).mockResolvedValue({ templates: [ACTIVE_V1, INACTIVE_V2] });
    vi.mocked(apiClient.workflowTemplates.get).mockResolvedValue(detailResponse(DETAIL_V1));
  });

  it("lists every version with version number, name, status and validation_enabled badge", async () => {
    renderWithQuery(<WorkflowTemplateAdminDialog open onOpenChange={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText("Default workflow")).toBeInTheDocument();
    });
    expect(screen.getByText("v1")).toBeInTheDocument();
    expect(screen.getByText("v2")).toBeInTheDocument();
    expect(screen.getByText("No validation")).toBeInTheDocument();
    expect(screen.getByText("active")).toBeInTheDocument();
    expect(screen.getByText("inactive")).toBeInTheDocument();
    expect(screen.getByText("Validation enabled")).toBeInTheDocument();
    expect(screen.getByText("Validation disabled")).toBeInTheDocument();
  });

  it("shows an unknown validation badge for versions whose steps_json cannot be parsed", async () => {
    vi.mocked(apiClient.workflowTemplates.list).mockResolvedValue({
      templates: [{ ...ACTIVE_V1, validation_enabled: null }],
    });
    renderWithQuery(<WorkflowTemplateAdminDialog open onOpenChange={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText("Validation state unknown")).toBeInTheDocument();
    });
  });

  it("shows the active-version summary in the list footer", async () => {
    renderWithQuery(<WorkflowTemplateAdminDialog open onOpenChange={() => {}} />);
    await waitFor(() => {
      expect(screen.getByText(/Active version: v1 \(Default workflow\)/)).toBeInTheDocument();
    });
  });

  it("opens a version's detail showing steps and validation_enabled", async () => {
    renderWithQuery(<WorkflowTemplateAdminDialog open onOpenChange={() => {}} />);
    await waitFor(() => {
      expect(screen.getByText("v1")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: /v1/ }));

    await waitFor(() => {
      expect(apiClient.workflowTemplates.get).toHaveBeenCalledWith("wft_1");
    });
    expect((await screen.findAllByText("implementation")).length).toBeGreaterThan(0);
    expect(screen.getByText("validator")).toBeInTheDocument();
    expect(screen.getByText("Validation enabled")).toBeInTheDocument();
  });

  it("annotates the four non-editable fields as not affecting runtime behavior in v0.2", async () => {
    renderWithQuery(<WorkflowTemplateAdminDialog open onOpenChange={() => {}} />);
    await waitFor(() => {
      expect(screen.getByText("v1")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: /v1/ }));

    await waitFor(() => {
      expect(screen.getByText(/v0.2 does not affect runtime behavior/)).toBeInTheDocument();
    });
    expect(screen.getByText(/collaboration_topology: sequential/)).toBeInTheDocument();
    expect(screen.getByText(/validation_policy_id: vpl_1/)).toBeInTheDocument();
  });

  it("marks a version with a parse error as not enableable and disables its Activate button", async () => {
    vi.mocked(apiClient.workflowTemplates.get).mockResolvedValue(
      detailResponse({
        ...DETAIL_V1,
        status: "inactive",
        steps_json: "{not json",
        steps: [],
        validation_enabled: null,
        parse_error: "Failed to parse workflow steps_json",
      }),
    );
    renderWithQuery(<WorkflowTemplateAdminDialog open onOpenChange={() => {}} />);
    await waitFor(() => {
      expect(screen.getByText("v1")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: /v1/ }));

    await waitFor(() => {
      expect(screen.getByText(/cannot be enabled/)).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "Activate" })).toBeDisabled();
  });
});

describe("T052/T053: save draft vs save & enable, and the disable-validation confirmation gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(apiClient.workflowTemplates.list).mockResolvedValue({ templates: [ACTIVE_V1, INACTIVE_V2] });
    vi.mocked(apiClient.workflowTemplates.get).mockResolvedValue(detailResponse(DETAIL_V1));
  });

  async function openEditor() {
    renderWithQuery(<WorkflowTemplateAdminDialog open onOpenChange={() => {}} />);
    await waitFor(() => {
      expect(screen.getByText("v1")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: /v1/ }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Edit & create new version/ })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: /Edit & create new version/ }));
    await waitFor(() => {
      expect(screen.getByLabelText("Name")).toBeInTheDocument();
    });
  }

  it("Save draft creates a new version with activate: false and does not enable it", async () => {
    await openEditor();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Draft" } });
    fireEvent.change(screen.getByLabelText("steps_json"), { target: { value: VALID_STEPS } });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() => {
      expect(apiClient.workflowTemplates.createVersion).toHaveBeenCalledWith("wft_1", {
        name: "Draft",
        steps_json: VALID_STEPS,
        activate: false,
      });
    });
  });

  it("Save & enable with a validator step activates directly without a confirmation", async () => {
    vi.mocked(apiClient.workflowTemplates.createVersion).mockResolvedValue({
      template: { ...DETAIL_V1, id: "wft_new", version: 3 },
    });
    await openEditor();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "New" } });
    fireEvent.change(screen.getByLabelText("steps_json"), { target: { value: VALID_STEPS } });
    fireEvent.click(screen.getByRole("button", { name: "Save & enable" }));

    await waitFor(() => {
      expect(apiClient.workflowTemplates.createVersion).toHaveBeenCalledWith("wft_1", {
        name: "New",
        steps_json: VALID_STEPS,
        activate: true,
      });
    });
  });

  it("removing the validator step opens the confirmation dialog and only enables after acknowledgment", async () => {
    const NO_VALIDATOR_STEPS = JSON.stringify({
      schema_version: 1,
      steps: [{ id: "implementation", role: "implementation" }],
    });
    vi.mocked(apiClient.workflowTemplates.createVersion).mockResolvedValue({
      template: { ...DETAIL_V1, id: "wft_new", version: 3, validation_enabled: false },
    });
    await openEditor();
    fireEvent.change(screen.getByLabelText("steps_json"), { target: { value: NO_VALIDATOR_STEPS } });
    fireEvent.click(screen.getByRole("button", { name: "Save & enable" }));

    await waitFor(() => {
      expect(screen.getByText("Disable validation?")).toBeInTheDocument();
    });
    // Not acknowledged yet — nothing sent
    expect(apiClient.workflowTemplates.createVersion).not.toHaveBeenCalled();
    // Enable anyway is disabled until the checkbox is ticked
    expect(screen.getByRole("button", { name: "Enable anyway" })).toBeDisabled();

    fireEvent.click(screen.getByLabelText("Acknowledge validation disabled"));
    fireEvent.click(screen.getByRole("button", { name: "Enable anyway" }));

    await waitFor(() => {
      expect(apiClient.workflowTemplates.createVersion).toHaveBeenCalledWith("wft_1", {
        name: "Default workflow",
        steps_json: NO_VALIDATOR_STEPS,
        activate: true,
        acknowledge_validation_disabled: true,
      });
    });
  });

  it("enabling validation from an active no-validator template does not open the confirmation dialog", async () => {
    vi.mocked(apiClient.workflowTemplates.list).mockResolvedValue({
      templates: [{ ...ACTIVE_V1, validation_enabled: false }],
    });
    vi.mocked(apiClient.workflowTemplates.get).mockResolvedValue(
      detailResponse({
        ...DETAIL_V1,
        steps_json: JSON.stringify({ schema_version: 1, steps: [{ id: "implementation", role: "implementation" }] }),
        steps: [{ id: "implementation", role: "implementation" }],
        validation_enabled: false,
      }),
    );
    await openEditor();
    fireEvent.change(screen.getByLabelText("steps_json"), { target: { value: VALID_STEPS } });
    fireEvent.click(screen.getByRole("button", { name: "Save & enable" }));

    await waitFor(() => {
      expect(apiClient.workflowTemplates.createVersion).toHaveBeenCalledWith("wft_1", {
        name: "Default workflow",
        steps_json: VALID_STEPS,
        activate: true,
      });
    });
    expect(screen.queryByText("Disable validation?")).not.toBeInTheDocument();
  });

  it("surfaces VALIDATION_DISABLE_NOT_ACKNOWLEDGED by opening the confirmation dialog", async () => {
    vi.mocked(apiClient.workflowTemplates.createVersion).mockRejectedValue({
      code: "VALIDATION_DISABLE_NOT_ACKNOWLEDGED",
      message: "Activating this template disables validation for all newly created issues.",
    });
    await openEditor();
    fireEvent.change(screen.getByLabelText("steps_json"), { target: { value: VALID_STEPS } });
    fireEvent.click(screen.getByRole("button", { name: "Save & enable" }));

    await waitFor(() => {
      expect(screen.getByText("Disable validation?")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByLabelText("Acknowledge validation disabled"));
    fireEvent.click(screen.getByRole("button", { name: "Enable anyway" }));

    await waitFor(() => {
      expect(apiClient.workflowTemplates.createVersion).toHaveBeenCalledWith(
        "wft_1",
        expect.objectContaining({ acknowledge_validation_disabled: true }),
      );
    });
  });

  it("shows a version-conflict message on TEMPLATE_VERSION_CONFLICT", async () => {
    vi.mocked(apiClient.workflowTemplates.createVersion).mockRejectedValue({
      code: "TEMPLATE_VERSION_CONFLICT",
      message: "Another version was created concurrently with the same version number.",
    });
    await openEditor();
    fireEvent.change(screen.getByLabelText("steps_json"), { target: { value: VALID_STEPS } });
    fireEvent.click(screen.getByRole("button", { name: "Save & enable" }));

    await waitFor(() => {
      expect(screen.getByText(/Version conflict/)).toBeInTheDocument();
    });
  });

  it("deactivates an active version after window.confirm", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderWithQuery(<WorkflowTemplateAdminDialog open onOpenChange={() => {}} />);
    await waitFor(() => {
      expect(screen.getByText("v1")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: /v1/ }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Deactivate" })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "Deactivate" }));

    await waitFor(() => {
      expect(apiClient.workflowTemplates.deactivate).toHaveBeenCalledWith("wft_1");
    });
  });

  it("surfaces the LAST_ACTIVE_TEMPLATE rejection instead of failing silently", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.mocked(apiClient.workflowTemplates.deactivate).mockRejectedValue({
      code: "LAST_ACTIVE_TEMPLATE",
      message: "Cannot deactivate the last active workflow template.",
    });
    renderWithQuery(<WorkflowTemplateAdminDialog open onOpenChange={() => {}} />);
    await waitFor(() => {
      expect(screen.getByText("v1")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: /v1/ }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Deactivate" })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "Deactivate" }));

    await waitFor(() => {
      expect(screen.getByText(/Cannot deactivate the last active template/)).toBeInTheDocument();
    });
  });

  it("activating an existing inactive version sends the acknowledge flag when it disables validation", async () => {
    vi.mocked(apiClient.workflowTemplates.get).mockResolvedValue(
      detailResponse({
        ...DETAIL_V1,
        id: "wft_2",
        name: "No validation",
        status: "inactive",
        version: 2,
        validation_enabled: false,
      }),
    );
    renderWithQuery(<WorkflowTemplateAdminDialog open onOpenChange={() => {}} />);
    await waitFor(() => {
      expect(screen.getByText("v2")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: /v2/ }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Activate" })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "Activate" }));

    await waitFor(() => {
      expect(screen.getByText("Disable validation?")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByLabelText("Acknowledge validation disabled"));
    fireEvent.click(screen.getByRole("button", { name: "Enable anyway" }));

    await waitFor(() => {
      expect(apiClient.workflowTemplates.activate).toHaveBeenCalledWith("wft_2", {
        acknowledge_validation_disabled: true,
      });
    });
  });
});
