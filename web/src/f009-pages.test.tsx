import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "@/App";

vi.mock("@/lib/api-client", () => import("@/test/api-client-mock"));

import { apiClient } from "@/lib/api-client";
import { IssuePriority, IssueStatus, IssueType, ThreadType, WorkspaceLockState } from "@personahub/shared";

// T010 (A001–A005): project selection/creation, code-directory binding, task
// list/creation, and current-task context in the new surface pages, reusing
// the canonical APIs. Includes the deterministic unknown-ID outcomes.

const TIMESTAMP = "2026-07-16T00:00:00.000Z";

function primaryThread(id: string, issueId: string, title: string) {
  return {
    id,
    issue_id: issueId,
    thread_type: ThreadType.Primary,
    title,
    room_id: null,
    created_at: TIMESTAMP,
    updated_at: TIMESTAMP,
  };
}

function project(id: string, name: string, withWorkspace: boolean) {
  return {
    id,
    name,
    description: null,
    default_workspace_id: withWorkspace ? `ws_${id}` : null,
    default_coordinator_agent_id: null,
    default_adapter_config_id: null,
    space_id: "spc_1",
    state: "active" as const,
    archived_at: null,
    created_at: TIMESTAMP,
    updated_at: TIMESTAMP,
  };
}

function issue(id: string, title: string, status: IssueStatus) {
  return {
    id,
    space_id: "spc_1",
    project_id: "prj_a",
    workspace_id: "ws_a",
    primary_thread_id: `thr_${id}`,
    issue_type: IssueType.Coding,
    workflow_template_id: "wft_coding_default",
    validation_policy_id: "vpl_coding_default",
    title,
    goal: "目标",
    status,
    owner_agent_id: null,
    coordinator_agent_id: null,
    priority: IssuePriority.Normal,
    labels: [],
    validation_round_count: 0,
    blocked_reason_code: null,
    blocked_reason_message: null,
    validation_dispatch_due_at: null,
    created_at: TIMESTAMP,
    updated_at: TIMESTAMP,
  };
}

function renderApp(path = "/"): void {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0 } },
  });
  window.history.replaceState(null, "", path);
  render(
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(apiClient.projects.list).mockResolvedValue({
    projects: [project("prj_a", "项目甲", true), project("prj_b", "项目乙", false)],
  });
});

describe("ProjectsPage (A001/A002)", () => {
  it("lists projects and opens a project through explicit selection", async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.projects.get).mockResolvedValue({
      project: {
        ...project("prj_a", "项目甲", true),
        default_workspace: null,
      },
    });
    vi.mocked(apiClient.workspaces.getByProject).mockResolvedValue({ workspace: null });

    renderApp("/projects");

    await user.click(await screen.findByRole("button", { name: /项目甲/ }));

    await waitFor(() => {
      expect(window.location.pathname).toBe("/projects/prj_a");
    });
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "项目甲" })).toBeInTheDocument();
    });
    expect(apiClient.projects.get).toHaveBeenCalledWith("prj_a");
  });

  it("creates a project through the canonical API and deep-links to it", async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.projects.create).mockResolvedValue({
      project: project("prj_new", "新项目", false),
    });

    renderApp("/projects");

    await user.click(await screen.findByRole("button", { name: "新建项目" }));
    await user.type(screen.getByLabelText(/name/i), "新项目");
    await user.click(screen.getByRole("button", { name: /^create$/i }));

    await waitFor(() => {
      expect(apiClient.projects.create).toHaveBeenCalledWith("新项目", undefined);
    });
    await waitFor(() => {
      expect(window.location.pathname).toBe("/projects/prj_new");
    });
  });
});

describe("ProjectDetailPage (A003/F013)", () => {
  const REF_TS = TIMESTAMP;
  function repoRef(repositoryId: string, role: "primary" | "reference", overrides: Record<string, unknown> = {}) {
    return {
      project_id: "prj_a",
      repository_id: repositoryId,
      role,
      access: role === "primary" ? ("read_write" as const) : ("read_only" as const),
      scope_json: null,
      legacy_workspace_id: null,
      created_at: REF_TS,
      updated_at: REF_TS,
      ...overrides,
    };
  }
  function repository(id: string, displayName: string) {
    return {
      id,
      kind: "local_dir" as const,
      display_name: displayName,
      git_remote_url: null,
      created_at: REF_TS,
      updated_at: REF_TS,
    };
  }
  function machinePath(rawPath: string, access: "read_write" | "read_only") {
    return {
      runtime_id: "local",
      raw_path: rawPath,
      real_path: rawPath,
      authorized_identity: "1:1",
      access,
      scope_json: null,
      case_insensitive: null,
      authorized_at: REF_TS,
      last_verified_at: null,
    };
  }
  function mockProjectWithLegacyPath(): void {
    vi.mocked(apiClient.projects.get).mockResolvedValue({
      project: {
        ...project("prj_a", "项目甲", false),
        default_workspace: {
          id: "ws_a",
          local_path: "/repo/project-a",
          git_branch: null,
          lock_state: WorkspaceLockState.Idle,
        },
      },
    });
  }

  it("adds a read-only reference without replacing the primary repository", async () => {
    const user = userEvent.setup();
    mockProjectWithLegacyPath();
    vi.mocked(apiClient.repositories.listByProject).mockResolvedValue({
      project_id: "prj_a",
      references: [repoRef("repo_primary", "primary", { legacy_workspace_id: "ws_a" })],
    } as never);
    vi.mocked(apiClient.repositories.resolve).mockResolvedValue({
      kind: "local_dir",
      display_name: "参考仓库",
      real_path: "/repo/reference",
      git_remote_url: null,
      git_identity: null,
      authorizable: true,
    });
    vi.mocked(apiClient.repositories.create).mockResolvedValue({
      repository: repository("repo_reference", "参考仓库"),
    });
    vi.mocked(apiClient.repositories.get).mockImplementation(async (repositoryId: string) =>
      repositoryId === "repo_reference"
        ? { repository: repository("repo_reference", "参考仓库"), machine_path: null }
        : { repository: repository(repositoryId, repositoryId), machine_path: null },
    );

    renderApp("/projects/prj_a");

    await screen.findByRole("heading", { name: "项目甲" });
    await screen.findByText(/\/repo\/project-a/);
    await user.type(screen.getByLabelText("添加代码仓"), "/repo/reference");
    await user.click(screen.getByRole("button", { name: "添加参考仓库" }));

    await waitFor(() => {
      expect(apiClient.repositories.setForProject).toHaveBeenCalledWith("prj_a", {
        primary: { repository_id: "repo_primary", access: "read_write", scope: undefined },
        references: [{ repository_id: "repo_reference", scope: undefined }],
      });
    });
    expect(apiClient.repositories.authorize).toHaveBeenCalledWith("repo_reference", "/repo/reference", "read_only");
  });

  it("keeps the full reference set when adding a reference (R1-008 batch regression)", async () => {
    const user = userEvent.setup();
    mockProjectWithLegacyPath();
    const initialRefs = [
      repoRef("repo_primary", "primary", { legacy_workspace_id: "ws_a" }),
      repoRef("repo_ref_a", "reference", { scope_json: { read: ["lib"], write: [] } }),
    ];
    const afterAdd = [...initialRefs, repoRef("repo_ref_b", "reference")].map((ref) =>
      ref.repository_id === "repo_ref_a" ? { ...ref, scope_json: { read: ["lib"], write: [] } } : ref,
    );
    vi.mocked(apiClient.repositories.listByProject)
      .mockResolvedValueOnce({ project_id: "prj_a", references: initialRefs } as never)
      .mockResolvedValue({ project_id: "prj_a", references: afterAdd } as never);
    vi.mocked(apiClient.repositories.resolve).mockResolvedValue({
      kind: "local_dir",
      display_name: "参考 B",
      real_path: "/repo/reference-b",
      git_remote_url: null,
      git_identity: null,
      authorizable: true,
    });
    vi.mocked(apiClient.repositories.create).mockResolvedValue({ repository: repository("repo_ref_b", "参考 B") });
    vi.mocked(apiClient.repositories.get).mockImplementation(async (repositoryId: string) => ({
      repository: repository(repositoryId, repositoryId),
      machine_path: null,
    }));

    renderApp("/projects/prj_a");

    await screen.findByTestId("repo-ref-repo_ref_a");
    await user.type(screen.getByLabelText("添加代码仓"), "/repo/reference-b");
    await user.click(screen.getByRole("button", { name: "添加参考仓库" }));

    await waitFor(() => {
      expect(apiClient.repositories.setForProject).toHaveBeenCalledWith("prj_a", {
        primary: { repository_id: "repo_primary", access: "read_write", scope: undefined },
        references: [
          { repository_id: "repo_ref_a", scope: { read: ["lib"], write: [] } },
          { repository_id: "repo_ref_b", scope: undefined },
        ],
      });
    });
    // 写入后的读取仍保留 A 与 B。
    expect(await screen.findByTestId("repo-ref-repo_ref_b")).toBeInTheDocument();
    expect(screen.getByTestId("repo-ref-repo_ref_a")).toBeInTheDocument();
  });

  it("does not downgrade an existing machine read_write authorization (R1-009)", async () => {
    const user = userEvent.setup();
    mockProjectWithLegacyPath();
    vi.mocked(apiClient.repositories.listByProject).mockResolvedValue({
      project_id: "prj_a",
      references: [repoRef("repo_primary", "primary", { legacy_workspace_id: "ws_a" })],
    } as never);
    vi.mocked(apiClient.repositories.resolve).mockResolvedValue({
      kind: "local_dir",
      display_name: "共享仓库",
      real_path: "/repo/shared",
      git_remote_url: null,
      git_identity: null,
      authorizable: true,
    });
    vi.mocked(apiClient.repositories.create).mockResolvedValue({ repository: repository("repo_shared", "共享仓库") });
    vi.mocked(apiClient.repositories.get).mockImplementation(async (repositoryId: string) =>
      repositoryId === "repo_shared"
        ? { repository: repository("repo_shared", "共享仓库"), machine_path: machinePath("/repo/shared", "read_write") }
        : { repository: repository(repositoryId, repositoryId), machine_path: null },
    );

    renderApp("/projects/prj_a");

    await screen.findByTestId("repo-ref-repo_primary");
    await user.type(screen.getByLabelText("添加代码仓"), "/repo/shared");
    await user.click(screen.getByRole("button", { name: "添加参考仓库" }));

    await waitFor(() => {
      expect(apiClient.repositories.setForProject).toHaveBeenCalledWith(
        "prj_a",
        expect.objectContaining({
          references: [{ repository_id: "repo_shared", scope: undefined }],
        }),
      );
    });
    // 已有机器授权（read_write）时不得再调用 authorize 覆写为 read_only。
    expect(apiClient.repositories.authorize).not.toHaveBeenCalled();
  });

  it("binds a primary directory for a project that has none (R1-013)", async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.projects.get).mockResolvedValue({
      project: { ...project("prj_a", "项目甲", false), default_workspace: null },
    });
    vi.mocked(apiClient.repositories.listByProject).mockResolvedValue({
      project_id: "prj_a",
      references: [],
    } as never);
    vi.mocked(apiClient.repositories.resolve).mockResolvedValue({
      kind: "local_dir",
      display_name: "新主目录",
      real_path: "/repo/new",
      git_remote_url: null,
      git_identity: null,
      authorizable: true,
    });
    vi.mocked(apiClient.repositories.create).mockResolvedValue({ repository: repository("repo_new", "新主目录") });
    vi.mocked(apiClient.repositories.get).mockResolvedValue({
      repository: repository("repo_new", "新主目录"),
      machine_path: null,
    });

    renderApp("/projects/prj_a");

    await screen.findByText("尚未绑定主目录。");
    await user.type(screen.getByLabelText("主目录路径"), "/repo/new");
    await user.click(screen.getByRole("button", { name: "绑定主目录" }));

    await waitFor(() => {
      expect(apiClient.repositories.authorize).toHaveBeenCalledWith("repo_new", "/repo/new", "read_write");
      expect(apiClient.repositories.setForProject).toHaveBeenCalledWith("prj_a", {
        primary: { repository_id: "repo_new", access: "read_write" },
        references: [],
      });
    });
  });

  it("rebinds the primary and does not keep the old primary as reference (R1-013)", async () => {
    const user = userEvent.setup();
    mockProjectWithLegacyPath();
    vi.mocked(apiClient.repositories.listByProject).mockResolvedValue({
      project_id: "prj_a",
      references: [repoRef("repo_old", "primary", { legacy_workspace_id: "ws_a" })],
    } as never);
    vi.mocked(apiClient.repositories.resolve).mockResolvedValue({
      kind: "local_dir",
      display_name: "新主目录",
      real_path: "/repo/new-home",
      git_remote_url: null,
      git_identity: null,
      authorizable: true,
    });
    vi.mocked(apiClient.repositories.create).mockResolvedValue({
      repository: repository("repo_new_home", "新主目录"),
    });
    vi.mocked(apiClient.repositories.get).mockResolvedValue({
      repository: repository("repo_new_home", "新主目录"),
      machine_path: null,
    });

    renderApp("/projects/prj_a");

    await screen.findByTestId("repo-ref-repo_old");
    await user.type(screen.getByLabelText("主目录路径"), "/repo/new-home");
    await user.click(screen.getByRole("button", { name: "改绑主目录" }));

    await waitFor(() => {
      expect(apiClient.repositories.setForProject).toHaveBeenCalledWith("prj_a", {
        primary: { repository_id: "repo_new_home", access: "read_write" },
        references: [],
      });
    });
  });

  it("removes one reference without touching the primary or the other reference (R1-013)", async () => {
    const user = userEvent.setup();
    mockProjectWithLegacyPath();
    vi.mocked(apiClient.repositories.listByProject).mockResolvedValue({
      project_id: "prj_a",
      references: [
        repoRef("repo_primary", "primary", { legacy_workspace_id: "ws_a" }),
        repoRef("repo_ref_a", "reference"),
        repoRef("repo_ref_b", "reference"),
      ],
    } as never);
    vi.mocked(apiClient.repositories.get).mockImplementation(async (repositoryId: string) => ({
      repository: repository(repositoryId, repositoryId),
      machine_path: null,
    }));

    renderApp("/projects/prj_a");

    await screen.findByTestId("repo-ref-repo_ref_a");
    await user.click(screen.getByRole("button", { name: "删除参考仓库 repo_ref_a" }));

    await waitFor(() => {
      expect(apiClient.repositories.setForProject).toHaveBeenCalledWith("prj_a", {
        primary: { repository_id: "repo_primary", access: "read_write", scope: undefined },
        references: [{ repository_id: "repo_ref_b", scope: undefined }],
      });
    });
  });

  it("edits the machine scope of the primary with read and write prefixes (R1-013)", async () => {
    const user = userEvent.setup();
    mockProjectWithLegacyPath();
    vi.mocked(apiClient.repositories.listByProject).mockResolvedValue({
      project_id: "prj_a",
      references: [repoRef("repo_primary", "primary", { legacy_workspace_id: "ws_a" })],
    } as never);
    vi.mocked(apiClient.repositories.get).mockResolvedValue({
      repository: repository("repo_primary", "主目录"),
      machine_path: machinePath("/repo/project-a", "read_write"),
    });

    renderApp("/projects/prj_a");

    await screen.findByLabelText("机器范围 read repo_primary");
    fireEvent.change(screen.getByLabelText("机器范围 read repo_primary"), { target: { value: "src\ntests" } });
    fireEvent.change(screen.getByLabelText("机器范围 write repo_primary"), { target: { value: "src" } });
    await user.click(screen.getByRole("button", { name: "保存机器范围 repo_primary" }));

    await waitFor(() => {
      expect(apiClient.repositories.authorize).toHaveBeenCalledWith("repo_primary", "/repo/project-a", "read_write", {
        read: ["src", "tests"],
        write: ["src"],
      });
    });
  });

  it("edits a reference's project scope as read-only (R1-013)", async () => {
    const user = userEvent.setup();
    mockProjectWithLegacyPath();
    vi.mocked(apiClient.repositories.listByProject).mockResolvedValue({
      project_id: "prj_a",
      references: [
        repoRef("repo_primary", "primary", { legacy_workspace_id: "ws_a" }),
        repoRef("repo_ref_a", "reference"),
      ],
    } as never);
    vi.mocked(apiClient.repositories.get).mockImplementation(async (repositoryId: string) => ({
      repository: repository(repositoryId, repositoryId),
      machine_path: null,
    }));

    renderApp("/projects/prj_a");

    await screen.findByLabelText("项目范围 read repo_ref_a");
    fireEvent.change(screen.getByLabelText("项目范围 read repo_ref_a"), { target: { value: "lib" } });
    await user.click(screen.getByRole("button", { name: "保存项目范围 repo_ref_a" }));

    await waitFor(() => {
      expect(apiClient.repositories.setForProject).toHaveBeenCalledWith("prj_a", {
        primary: { repository_id: "repo_primary", access: "read_write", scope: undefined },
        references: [{ repository_id: "repo_ref_a", scope: { read: ["lib"], write: [] } }],
      });
    });
  });

  it("accepts a remote URL as a reference without machine authorization (R1-013)", async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.projects.get).mockResolvedValue({
      project: { ...project("prj_a", "项目甲", false), default_workspace: null },
    });
    vi.mocked(apiClient.repositories.listByProject).mockResolvedValue({
      project_id: "prj_a",
      references: [],
    } as never);
    vi.mocked(apiClient.repositories.resolve).mockResolvedValue({
      kind: "remote_url",
      display_name: "remote-repo",
      real_path: null,
      git_remote_url: "https://example.com/remote-repo.git",
      git_identity: null,
      authorizable: false,
      unauthorized_reason: "REMOTE_URL_NOT_LOCAL",
    });
    vi.mocked(apiClient.repositories.create).mockResolvedValue({
      repository: {
        ...repository("repo_remote", "remote-repo"),
        kind: "remote_url",
        git_remote_url: "https://example.com/remote-repo.git",
      },
    });
    vi.mocked(apiClient.repositories.get).mockResolvedValue({
      repository: repository("repo_remote", "remote-repo"),
      machine_path: null,
    });

    renderApp("/projects/prj_a");

    await screen.findByText("尚未绑定主目录。");
    await user.type(screen.getByLabelText("添加代码仓"), "https://example.com/remote-repo.git");
    await user.click(screen.getByRole("button", { name: "添加参考仓库" }));

    await waitFor(() => {
      expect(apiClient.repositories.setForProject).toHaveBeenCalledWith("prj_a", {
        primary: null,
        references: [{ repository_id: "repo_remote" }],
      });
    });
    expect(apiClient.repositories.authorize).not.toHaveBeenCalled();
    expect(await screen.findByText(/远程参考仓库/)).toBeInTheDocument();
  });

  it("replaces an unknown project id with a diagnostic project list", async () => {
    vi.mocked(apiClient.projects.get).mockRejectedValue({
      code: "PROJECT_NOT_FOUND",
      message: "not found",
    });

    renderApp("/projects/prj_missing");

    await waitFor(() => {
      expect(window.location.pathname).toBe("/projects");
    });
    expect(window.location.search).toContain("not_found=prj_missing");
    expect(window.location.search).toContain("from=");
    expect(await screen.findByText("项目不存在")).toBeInTheDocument();
  });
});

describe("TasksPage (A004/A005)", () => {
  beforeEach(() => {
    vi.mocked(apiClient.issues.listByProject).mockResolvedValue({
      issues: [issue("iss_1", "任务一", IssueStatus.Running), issue("iss_2", "任务二", IssueStatus.Done)],
    });
  });

  it("asks for a project when no query is given and never guesses the first", async () => {
    renderApp("/tasks");

    expect(apiClient.issues.listByProject).not.toHaveBeenCalled();
    expect(await screen.findByText("先选择一个项目，再查看它的任务。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /项目甲/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /项目乙/ })).toBeInTheDocument();
  });

  it("lists the selected project's tasks after an explicit push", async () => {
    const user = userEvent.setup();

    renderApp("/tasks");

    await user.click(await screen.findByRole("button", { name: /项目甲/ }));

    await waitFor(() => {
      expect(window.location.search).toContain("project=prj_a");
    });
    expect(apiClient.issues.listByProject).toHaveBeenCalledWith("prj_a");
    expect(await screen.findByText("任务一")).toBeInTheDocument();
  });

  it("opens a task through user selection and shows its context", async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.issues.get).mockResolvedValue({
      issue: {
        ...issue("iss_1", "任务一", IssueStatus.Running),
        primary_thread: primaryThread("thr_iss_1", "iss_1", "任务一"),
      },
    });

    renderApp("/tasks?project=prj_a");

    await user.click(await screen.findByRole("button", { name: /任务一/ }));

    await waitFor(() => {
      expect(window.location.pathname).toBe("/tasks/iss_1");
    });
    expect(await screen.findByRole("heading", { name: "任务一" })).toBeInTheDocument();
    expect(apiClient.issues.get).toHaveBeenCalledWith("iss_1");
  });

  it("creates a task through the canonical API and opens it", async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.issues.create).mockResolvedValue({
      issue: {
        ...issue("iss_new", "新任务", IssueStatus.Inbox),
        primary_thread: primaryThread("thr_iss_new", "iss_new", "新任务"),
      },
      primary_thread: primaryThread("thr_iss_new", "iss_new", "新任务"),
    });

    renderApp("/tasks?project=prj_a");

    await user.click(await screen.findByRole("button", { name: "新建任务" }));
    await user.type(screen.getByLabelText(/title/i), "新任务");
    await user.type(screen.getByLabelText(/goal/i), "完成标准");
    await user.click(screen.getByRole("button", { name: /^create$/i }));

    await waitFor(() => {
      expect(apiClient.issues.create).toHaveBeenCalledWith("prj_a", {
        title: "新任务",
        goal: "完成标准",
        priority: IssuePriority.Normal,
        labels: undefined,
      });
    });
    await waitFor(() => {
      expect(window.location.pathname).toBe("/tasks/iss_new");
    });
  });

  it("keeps diagnostics and offers one recovery path for an unknown project", async () => {
    vi.mocked(apiClient.projects.list).mockResolvedValue({
      projects: [project("prj_a", "项目甲", true)],
    });
    vi.mocked(apiClient.issues.listByProject).mockRejectedValue({
      code: "PROJECT_NOT_FOUND",
      message: "not found",
    });

    renderApp("/tasks?project=prj_missing&from=%2Ftasks%2Fiss_gone");

    await waitFor(() => {
      expect(window.location.search).toContain("project=prj_missing");
    });
    expect(await screen.findByText("项目不存在")).toBeInTheDocument();
    // The URL keeps its diagnostics; recovery is a single explicit action.
    expect(window.location.search).toContain("from=");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "重新选择项目" }));
    await waitFor(() => {
      expect(window.location.pathname).toBe("/tasks");
      expect(window.location.search).toBe("");
    });
  });
});

describe("TaskDetailPage unknown id (FR-004)", () => {
  it("replaces an unknown task id with a diagnostic task selection", async () => {
    vi.mocked(apiClient.issues.get).mockRejectedValue({
      code: "ISSUE_NOT_FOUND",
      message: "not found",
    });

    renderApp("/tasks/iss_missing");

    await waitFor(() => {
      expect(window.location.pathname).toBe("/tasks");
    });
    expect(window.location.search).toContain("not_found=iss_missing");
    expect(window.location.search).toContain("from=");
    expect(await screen.findByText("任务不存在")).toBeInTheDocument();
  });
});

describe("review R1-006/R1-007 regressions", () => {
  it("keeps exactly one create action when the task list is empty", async () => {
    vi.mocked(apiClient.issues.listByProject).mockResolvedValue({ issues: [] });
    renderApp("/tasks?project=prj_a");

    expect(await screen.findByText("该项目还没有任务")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "新建任务" })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "推荐创建" })).not.toBeInTheDocument();
  });

  it("filters the task list through the label dropdown (BC-006)", async () => {
    const user = userEvent.setup();
    const labeled = [
      { ...issue("iss_1", "任务一", IssueStatus.Running), labels: ["parser"] },
      { ...issue("iss_2", "任务二", IssueStatus.Done), labels: ["ingest"] },
    ];
    vi.mocked(apiClient.issues.listByProject).mockResolvedValue({ issues: labeled });
    renderApp("/tasks?project=prj_a");

    expect(await screen.findByText("任务一")).toBeInTheDocument();
    expect(screen.getByText("任务二")).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("按标签筛选"), "parser");
    expect(screen.getByText("任务一")).toBeInTheDocument();
    expect(screen.queryByText("任务二")).not.toBeInTheDocument();
    expect(screen.getByText("1 项")).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("按标签筛选"), "all");
    expect(screen.getByText("任务二")).toBeInTheDocument();
  });
});
