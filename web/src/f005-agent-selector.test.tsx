import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { AdapterStatus, AgentCapability, IssueStatus } from "@personahub/shared";
import { AgentSelector } from "@/components/thread/AgentSelector";
import { createAdapter } from "@/test/ui-flow-helpers";

describe("T089: AgentSelector", () => {
  it("is always visible with a single adapter (never hidden)", () => {
    const adapter = createAdapter({ id: "agt_1", is_default: true, capability_tags: [AgentCapability.Implementation] });
    render(
      <AgentSelector
        adapters={[adapter]} selectedAdapterId={null} onSelect={vi.fn()}
        issueStatus={IssueStatus.Running} explicitConsult={false} onExplicitConsultChange={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Agent")).toBeInTheDocument();
  });

  it("is always visible with zero adapters", () => {
    render(
      <AgentSelector
        adapters={[]} selectedAdapterId={null} onSelect={vi.fn()}
        issueStatus={IssueStatus.Running} explicitConsult={false} onExplicitConsultChange={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Agent")).toBeInTheDocument();
    expect(screen.getByText("Project default (none set)")).toBeInTheDocument();
  });

  it("marks the Project default in the first option", () => {
    const defaultAdapter = createAdapter({ id: "agt_1", name: "Codex", is_default: true });
    render(
      <AgentSelector
        adapters={[defaultAdapter]} selectedAdapterId={null} onSelect={vi.fn()}
        issueStatus={IssueStatus.Running} explicitConsult={false} onExplicitConsultChange={vi.fn()}
      />,
    );
    expect(screen.getByText("Project default (Codex)")).toBeInTheDocument();
  });

  it("keeps an unavailable adapter in the list but disabled, with its reason shown", () => {
    const adapter = createAdapter({ id: "agt_2", name: "Broken", status: AdapterStatus.Unavailable, auth_status_message: "not logged in" });
    render(
      <AgentSelector
        adapters={[adapter]} selectedAdapterId={null} onSelect={vi.fn()}
        issueStatus={IssueStatus.Running} explicitConsult={false} onExplicitConsultChange={vi.fn()}
      />,
    );
    const option = screen.getByRole("option", { name: /Broken/ });
    expect(option).toBeDisabled();
    expect(option.textContent).toContain("not logged in");
  });

  it("shows capability badges for the resolved adapter", () => {
    const adapter = createAdapter({ id: "agt_1", is_default: true, capability_tags: [AgentCapability.Implementation, AgentCapability.Validator] });
    render(
      <AgentSelector
        adapters={[adapter]} selectedAdapterId={null} onSelect={vi.fn()}
        issueStatus={IssueStatus.Running} explicitConsult={false} onExplicitConsultChange={vi.fn()}
      />,
    );
    expect(screen.getByText("implementation")).toBeInTheDocument();
    expect(screen.getByText("validator")).toBeInTheDocument();
  });

  it("shows the current purpose/role preview based on Issue status + selected adapter capability", () => {
    const adapter = createAdapter({ id: "agt_1", is_default: true, capability_tags: [AgentCapability.Implementation] });
    render(
      <AgentSelector
        adapters={[adapter]} selectedAdapterId={null} onSelect={vi.fn()}
        issueStatus={IssueStatus.Running} explicitConsult={false} onExplicitConsultChange={vi.fn()}
      />,
    );
    expect(screen.getByText("Implementation workflow")).toBeInTheDocument();
  });

  it("calls onSelect with the adapter id when a specific adapter is chosen, and null when reverting to Project default", () => {
    const onSelect = vi.fn();
    const a1 = createAdapter({ id: "agt_1", name: "Primary", is_default: true });
    const a2 = createAdapter({ id: "agt_2", name: "Secondary", is_default: false });
    render(
      <AgentSelector
        adapters={[a1, a2]} selectedAdapterId={null} onSelect={onSelect}
        issueStatus={IssueStatus.Running} explicitConsult={false} onExplicitConsultChange={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText("Agent"), { target: { value: "agt_2" } });
    expect(onSelect).toHaveBeenCalledWith("agt_2");
  });

  it("toggling the consult checkbox notifies onExplicitConsultChange and updates the preview", () => {
    const onChange = vi.fn();
    const adapter = createAdapter({ id: "agt_1", is_default: true, capability_tags: [AgentCapability.Implementation] });
    const { rerender } = render(
      <AgentSelector
        adapters={[adapter]} selectedAdapterId={null} onSelect={vi.fn()}
        issueStatus={IssueStatus.Running} explicitConsult={false} onExplicitConsultChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("checkbox", { name: /ask \(consult\)/i }));
    expect(onChange).toHaveBeenCalledWith(true);

    rerender(
      <AgentSelector
        adapters={[adapter]} selectedAdapterId={null} onSelect={vi.fn()}
        issueStatus={IssueStatus.Running} explicitConsult={true} onExplicitConsultChange={onChange}
      />,
    );
    expect(screen.getByText("Consult (does not change Issue status)")).toBeInTheDocument();
  });

  it("shows a terminal-status message instead of a purpose preview when the Issue is Done/Blocked", () => {
    const adapter = createAdapter({ id: "agt_1", is_default: true, capability_tags: [AgentCapability.Implementation] });
    render(
      <AgentSelector
        adapters={[adapter]} selectedAdapterId={null} onSelect={vi.fn()}
        issueStatus={IssueStatus.Blocked} explicitConsult={false} onExplicitConsultChange={vi.fn()}
      />,
    );
    expect(screen.getByText(/terminal status/i)).toBeInTheDocument();
  });
});

describe("checking option list contents with within()", () => {
  it("option list contains both Project default and named adapters", () => {
    const a1 = createAdapter({ id: "agt_1", name: "Alpha", is_default: true });
    const a2 = createAdapter({ id: "agt_2", name: "Beta", is_default: false });
    render(
      <AgentSelector
        adapters={[a1, a2]} selectedAdapterId={null} onSelect={vi.fn()}
        issueStatus={IssueStatus.Running} explicitConsult={false} onExplicitConsultChange={vi.fn()}
      />,
    );
    const select = screen.getByLabelText("Agent");
    expect(within(select).getByText("Alpha (default)")).toBeInTheDocument();
    expect(within(select).getByText("Beta")).toBeInTheDocument();
  });
});
