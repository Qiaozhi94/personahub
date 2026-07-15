import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import {
  AdapterStatus,
  IssuePriority,
  IssueStatus,
  IssueType,
  RunStatus,
  ThreadType,
  WorkspaceLockState,
  type AdapterConfig,
  type IssueWithThread,
  type Run,
  type Workspace,
} from "@personahub/shared";

const TIMESTAMP = "2026-07-16T00:00:00.000Z";

export function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

export function renderWithQuery(ui: React.ReactNode) {
  const queryClient = createTestQueryClient();
  const view = render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );

  return {
    ...view,
    queryClient,
    rerenderWithQuery(nextUi: React.ReactNode) {
      view.rerender(
        <QueryClientProvider client={queryClient}>{nextUi}</QueryClientProvider>,
      );
    },
  };
}

export function createWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: "wsp_1",
    project_id: "prj_1",
    local_path: "D:\\repo",
    git_branch: "main",
    lock_state: WorkspaceLockState.Idle,
    locked_by_run_id: null,
    locked_at: null,
    push_credentials_enabled: false,
    created_at: TIMESTAMP,
    updated_at: TIMESTAMP,
    ...overrides,
  };
}

export function createIssue(overrides: Partial<IssueWithThread> = {}): IssueWithThread {
  return {
    id: "iss_1",
    project_id: "prj_1",
    workspace_id: "wsp_1",
    primary_thread_id: "thr_1",
    issue_type: IssueType.Coding,
    workflow_template_id: "wft_coding_default",
    validation_policy_id: "vpl_coding_default",
    title: "Build foundation",
    goal: "Foundation works",
    status: IssueStatus.Inbox,
    owner_agent_id: null,
    coordinator_agent_id: null,
    priority: IssuePriority.Normal,
    labels: [],
    validation_round_count: 0,
    created_at: TIMESTAMP,
    updated_at: TIMESTAMP,
    primary_thread: {
      id: "thr_1",
      issue_id: "iss_1",
      thread_type: ThreadType.Primary,
      title: "Build foundation",
    },
    ...overrides,
  };
}

export function createAdapter(overrides: Partial<AdapterConfig> = {}): AdapterConfig {
  return {
    id: "agt_1",
    project_id: "prj_1",
    name: "Codex CLI",
    role: "implementation",
    cli_provider: "codex",
    command: "codex",
    args: ["--quiet"],
    capability_tags: [],
    default_model: "gpt-5",
    status: AdapterStatus.Available,
    last_checked_at: TIMESTAMP,
    created_at: TIMESTAMP,
    updated_at: TIMESTAMP,
    ...overrides,
  };
}

export function createRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run_1",
    issue_id: "iss_1",
    thread_id: "thr_1",
    workspace_id: "wsp_1",
    adapter_config_id: "agt_1",
    status: RunStatus.Running,
    failure_reason: null,
    instructions: "Implement it",
    started_at: "2026-07-16T00:01:00.000Z",
    completed_at: null,
    exit_code: null,
    error_message: null,
    created_at: TIMESTAMP,
    updated_at: "2026-07-16T00:01:00.000Z",
    ...overrides,
  };
}
