import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@/app/router";

vi.mock("@/lib/api-client", () => import("@/test/api-client-mock"));

import { apiClient } from "@/lib/api-client";
import { SkillsPage } from "@/pages/SkillsPage";
import { SkillDetailPage } from "@/pages/SkillDetailPage";
import { ProjectSkillsTab } from "@/pages/project-tabs/ProjectSkillsTab";
import { SURFACE_REGISTRY } from "@/app/surface-registry";
import { resolveRoute } from "@/app/route-manifest";
import type { SkillListItem, SkillListResponse, ProjectSkillRef, SkillRevision } from "@personahub/shared";
import type { ReactNode } from "react";

// F013 AC-003（design §8 web）：普通 Skill 与编组共用一张列表/详情结构；
// 项目只保存 ref（修改 Skill 不产生项目侧副本）；"项目记忆" tab 未注册。

function skillItem(overrides: Partial<SkillListItem> = {}): SkillListItem {
  return {
    id: "skl_1",
    space_id: null,
    display_name: "API Migration",
    source_kind: "legacy-workflow",
    source_identity: "workflow:wft_1",
    current_revision: 2,
    state: "active",
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
    space_state: "active",
    has_steps: false,
    step_count: 0,
    requirement_count: 0,
    ...overrides,
  };
}

function renderWithQuery(ui: ReactNode): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <RouterProvider>
      <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
    </RouterProvider>,
  );
}

describe("F013 AC-003: capabilities surface (web)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(apiClient.spaces.list).mockResolvedValue({
      spaces: [
        {
          id: "spc_1",
          name: "Default Space",
          state: "active",
          is_default: true,
          is_selected: true,
          created_at: "2026-09-01T00:00:00Z",
          updated_at: "2026-09-01T00:00:00Z",
        },
      ],
    });
  });

  it("renders plain skills and group skills in ONE shared list with grouped marker", async () => {
    const skills: SkillListItem[] = [
      skillItem({ id: "skl_plain", display_name: "Plain skill" }),
      skillItem({
        id: "skl_group",
        display_name: "Grouped skill",
        current_revision: 1,
        has_steps: true,
        step_count: 2,
      }),
    ];
    vi.mocked(apiClient.skills.list).mockResolvedValue({ skills } as SkillListResponse);

    renderWithQuery(<SkillsPage />);

    expect(await screen.findByRole("table", { name: "Skills 列表" })).toBeInTheDocument();
    expect(screen.getByText("Plain skill")).toBeInTheDocument();
    expect(screen.getByText("Grouped skill")).toBeInTheDocument();
    expect(screen.getByText("编组（2 步）")).toBeInTheDocument();
    // 只有一张表：普通与编组同列渲染，没有第二套入口。
    expect(screen.getAllByRole("table")).toHaveLength(1);
    expect(apiClient.skills.list).toHaveBeenCalledWith("spc_1");
  });

  it("shows disabled and shadowed as DISTINCT unusable reasons", async () => {
    vi.mocked(apiClient.skills.list).mockResolvedValue({
      skills: [
        skillItem({ id: "skl_off", display_name: "Disabled one", state: "disabled", space_state: "active" }),
        skillItem({ id: "skl_shadow", display_name: "Shadowed one", space_state: "shadowed" }),
        skillItem({ id: "skl_conflict", display_name: "Conflicted one", space_state: "conflict" }),
      ],
    } as SkillListResponse);

    renderWithQuery(<SkillsPage />);

    expect(await screen.findByText("已禁用")).toBeInTheDocument();
    expect(screen.getByText("被同名项遮蔽")).toBeInTheDocument();
    expect(screen.getByText("同名冲突")).toBeInTheDocument();
  });

  it("capabilities surface is enabled with route and 项目记忆 is not", () => {
    const capabilities = SURFACE_REGISTRY.find((surface) => surface.id === "capabilities");
    expect(capabilities?.state).toBe("enabled");
    expect(capabilities?.route).toBe("/capabilities");

    const route = resolveRoute("/capabilities", "");
    expect(route.kind).toBe("capabilities");
    const detail = resolveRoute("/capabilities/skl_1", "");
    expect(detail.kind).toBe("skill");

    // "项目记忆" tab 在 v0.3 无真实数据，不注册（空 tab 是无法兑现的承诺）。
    const memory = resolveRoute("/projects/prj_1/memory", "");
    expect(memory.kind).toBe("project-unsupported-tab");
  });

  it("switches the project default skill through a real A→B reference change (R1-017)", async () => {
    const refA: ProjectSkillRef = {
      project_id: "prj_1",
      skill_id: "skl_a",
      is_default: true,
      pinned_version: null,
      created_at: "2026-09-01T00:00:00Z",
      updated_at: "2026-09-01T00:00:00Z",
    };
    const refB: ProjectSkillRef = { ...refA, skill_id: "skl_b" };
    vi.mocked(apiClient.skills.listProjectRefs)
      .mockResolvedValueOnce({ refs: [refA] })
      .mockResolvedValue({ refs: [refB] });
    vi.mocked(apiClient.skills.list).mockResolvedValue({
      skills: [
        skillItem({ id: "skl_a", display_name: "API Migration", current_revision: 2 }),
        skillItem({ id: "skl_b", display_name: "Release Ops", current_revision: 3 }),
      ],
    } as SkillListResponse);
    vi.mocked(apiClient.skills.setProjectDefault).mockResolvedValue({
      project_id: "prj_1",
      skill_id: "skl_b",
      pinned_version: null,
    });

    renderWithQuery(<ProjectSkillsTab projectId="prj_1" />);

    expect(await screen.findByText(/默认 Skill：skl_a（跟随最新版本）/)).toBeInTheDocument();
    await screen.findByRole("option", { name: /API Migration/ });
    expect(screen.getByRole("option", { name: /Release Ops/ })).toBeInTheDocument();

    // 选择另一个 Skill → PUT default-skill（引用），UI 切到 B 且绝不复制内容。
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("选择默认 Skill"), "skl_b");
    await waitFor(() => {
      expect(apiClient.skills.setProjectDefault).toHaveBeenCalledWith("prj_1", "skl_b", null);
    });
    expect(await screen.findByText(/默认 Skill：skl_b（跟随最新版本）/)).toBeInTheDocument();
    expect(apiClient.projects.create).not.toHaveBeenCalled();
  });

  it("opens the skill's current revision and lets the user choose another published revision", async () => {
    const revision = (version: number): SkillRevision => ({
      skill_id: "skl_1",
      version,
      title: `Revision ${version}`,
      description: null,
      capability_tags: [],
      has_steps: false,
      step_count: 0,
      requirement_count: 0,
      source_locator: null,
      content_hash: `hash-${version}`,
      published_at: "2026-09-01T00:00:00Z",
      created_at: "2026-09-01T00:00:00Z",
    });
    vi.mocked(apiClient.skills.get).mockResolvedValue({ skill: skillItem({ current_revision: 2 }) });
    vi.mocked(apiClient.skills.revisions).mockResolvedValue({ revisions: [revision(1), revision(2)] });
    vi.mocked(apiClient.skills.revisionDetail).mockImplementation(async (_id, version) => ({
      revision: revision(version),
      steps: [],
      completion_requirements: [],
    }));

    renderWithQuery(<SkillDetailPage skillId="skl_1" />);

    expect(await screen.findByText("来源：legacy-workflow · workflow:wft_1")).toBeInTheDocument();
    expect(await screen.findByText("版本 v2 · 内容指纹 hash-2…")).toBeInTheDocument();
    expect(apiClient.skills.revisionDetail).toHaveBeenCalledWith("skl_1", 2);
    await userEvent.setup().selectOptions(screen.getByLabelText("选择 Skill 版本"), "1");
    await waitFor(() => expect(apiClient.skills.revisionDetail).toHaveBeenCalledWith("skl_1", 1));
    expect(await screen.findByText("版本 v1 · 内容指纹 hash-1…")).toBeInTheDocument();
  });
});
