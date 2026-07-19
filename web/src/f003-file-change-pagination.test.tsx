import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, waitFor, fireEvent } from "@testing-library/react";
import { renderHook } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import {
  ActorType,
  FileChangeType,
  RunDispatchSource,
  RunRole,
  RunStatus,
  ThreadEventType,
  TraceCompletenessStatus,
  type RunEvidenceResponse,
  type RunFileChange,
  type ThreadEvent,
} from "@personahub/shared";
import { FileChangeTraceCard } from "@/components/trace/FileChangeTraceCard";
import { useRunEvidence } from "@/hooks/use-trace";
import { createTestQueryClient, renderWithQuery } from "@/test/ui-flow-helpers";

vi.mock("@/lib/api-client", () => import("@/test/api-client-mock"));

import { apiClient } from "@/lib/api-client";

function makeFileChanges(count: number, startIdx: number): RunFileChange[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `fc_${startIdx + i}`,
    run_id: "run_1",
    path: `src/file_${startIdx + i}.ts`,
    previous_path: null,
    change_type: FileChangeType.Modified,
    created_at: "2026-07-19T00:00:00.000Z",
  }));
}

function makeEvidencePage(overrides: Partial<RunEvidenceResponse> = {}): RunEvidenceResponse {
  return {
    run: {
      id: "run_1",
      issue_id: "iss_1",
      thread_id: "thr_1",
      workspace_id: "wsp_1",
      adapter_config_id: "agt_1",
      status: RunStatus.Completed,
      failure_reason: null,
      instructions: "Implement it",
      started_at: "2026-07-16T00:00:00.000Z",
      completed_at: "2026-07-16T00:01:00.000Z",
      exit_code: null,
      error_message: null,
      role: RunRole.Implementation,
      workflow_step: "implementation",
      validation_round: null,
      dispatch_source: RunDispatchSource.UserExplicit,
      adapter_identity: null,
      has_final_message: false,
      created_at: "2026-07-16T00:00:00.000Z",
      updated_at: "2026-07-16T00:01:00.000Z",
    },
    events: [],
    file_changes: [],
    evidence: [],
    completeness: {
      commands: TraceCompletenessStatus.Complete,
      verification: TraceCompletenessStatus.Complete,
      file_changes: TraceCompletenessStatus.Complete,
      refs: TraceCompletenessStatus.Complete,
      reasons: [],
    },
    next_after_event_id: null,
    next_after_file_change_id: null,
    ...overrides,
  };
}

function makeChangeSummaryEvent(overrides: Record<string, unknown> = {}): ThreadEvent {
  return {
    id: "evt_summary",
    event_sequence: 3,
    thread_id: "thr_1",
    type: ThreadEventType.FileChangeSummary,
    actor_type: ActorType.System,
    actor_id: null,
    payload_json: {
      run_id: "run_1",
      scanner: "git",
      total_count: 250,
      added_count: 100,
      modified_count: 100,
      deleted_count: 50,
      renamed_count: 0,
      preview: Array.from({ length: 5 }, (_, i) => ({
        path: `src/file_${i}.ts`,
        change_type: FileChangeType.Modified,
      })),
      scan_truncated: false,
      recovered_after_restart: false,
      ...overrides,
    },
    evidence_refs: [],
    created_at: "2026-07-19T00:00:00.000Z",
  };
}

function createQueryWrapper() {
  const qc = createTestQueryClient();
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

describe("useRunEvidence pagination", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls getRunEvidence without cursor on first page", async () => {
    const page1 = makeEvidencePage({ file_changes: makeFileChanges(100, 0) });
    vi.mocked(apiClient.traces.getRunEvidence).mockResolvedValue(page1);

    const { result } = renderHook(() => useRunEvidence("run_1"), {
      wrapper: createQueryWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(apiClient.traces.getRunEvidence).toHaveBeenCalledWith(
      "run_1",
      undefined,
      undefined,
      undefined,
      100,
    );
    expect(result.current.allFileChanges).toHaveLength(100);
    expect(result.current.hasNextPage).toBe(false);
  });

  it("exposes hasNextPage=true when next_after_file_change_id is set", async () => {
    const page1 = makeEvidencePage({
      file_changes: makeFileChanges(100, 0),
      next_after_file_change_id: "fc_99",
    });
    vi.mocked(apiClient.traces.getRunEvidence).mockResolvedValue(page1);

    const { result } = renderHook(() => useRunEvidence("run_1"), {
      wrapper: createQueryWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.hasNextPage).toBe(true);
  });

  it("fetchNextPage passes cursor from previous page", async () => {
    const page1 = makeEvidencePage({
      file_changes: makeFileChanges(100, 0),
      next_after_file_change_id: "fc_99",
    });
    const page2 = makeEvidencePage({
      file_changes: makeFileChanges(100, 100),
      next_after_file_change_id: "fc_199",
    });
    vi.mocked(apiClient.traces.getRunEvidence)
      .mockResolvedValueOnce(page1)
      .mockResolvedValueOnce(page2);

    const { result } = renderHook(() => useRunEvidence("run_1"), {
      wrapper: createQueryWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    await result.current.fetchNextPage();

    await waitFor(() => {
      expect(result.current.isFetchingNextPage).toBe(false);
    });

    expect(apiClient.traces.getRunEvidence).toHaveBeenCalledTimes(2);
    expect(apiClient.traces.getRunEvidence).toHaveBeenNthCalledWith(
      2,
      "run_1",
      undefined,
      "fc_99",
      undefined,
      100,
    );
    expect(result.current.hasNextPage).toBe(true);
    expect(result.current.allFileChanges).toHaveLength(200);
  });

  it("hasNextPage becomes false on last page", async () => {
    const page1 = makeEvidencePage({
      file_changes: makeFileChanges(100, 0),
      next_after_file_change_id: "fc_99",
    });
    const page2 = makeEvidencePage({
      file_changes: makeFileChanges(50, 100),
      next_after_file_change_id: null,
    });
    vi.mocked(apiClient.traces.getRunEvidence)
      .mockResolvedValueOnce(page1)
      .mockResolvedValueOnce(page2);

    const { result } = renderHook(() => useRunEvidence("run_1"), {
      wrapper: createQueryWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    await result.current.fetchNextPage();

    await waitFor(() => {
      expect(result.current.isFetchingNextPage).toBe(false);
    });

    expect(result.current.hasNextPage).toBe(false);
    expect(result.current.allFileChanges).toHaveLength(150);
  });

  it("does not fetch when runId is null", () => {
    renderHook(() => useRunEvidence(null), {
      wrapper: createQueryWrapper(),
    });

    expect(apiClient.traces.getRunEvidence).not.toHaveBeenCalled();
  });
});

describe("FileChangeTraceCard pagination", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows Load more button when next_after_file_change_id exists", async () => {
    const page1 = makeEvidencePage({
      file_changes: makeFileChanges(100, 0),
      next_after_file_change_id: "fc_99",
    });
    vi.mocked(apiClient.traces.getRunEvidence).mockResolvedValue(page1);

    renderWithQuery(<FileChangeTraceCard event={makeChangeSummaryEvent()} />);

    fireEvent.click(await screen.findByText("View all"));

    await waitFor(() => {
      expect(screen.queryByText("Loading...")).not.toBeInTheDocument();
    });

    expect(screen.getByText("Load more")).toBeInTheDocument();
    expect(screen.getByText("Show less")).toBeInTheDocument();
  });

  it("appends file changes after clicking Load more", async () => {
    const page1 = makeEvidencePage({
      file_changes: makeFileChanges(100, 0),
      next_after_file_change_id: "fc_99",
    });
    const page2 = makeEvidencePage({
      file_changes: makeFileChanges(50, 100),
      next_after_file_change_id: null,
    });
    vi.mocked(apiClient.traces.getRunEvidence)
      .mockResolvedValueOnce(page1)
      .mockResolvedValueOnce(page2);

    renderWithQuery(<FileChangeTraceCard event={makeChangeSummaryEvent()} />);

    fireEvent.click(await screen.findByText("View all"));

    await waitFor(() => {
      expect(screen.queryByText("Loading...")).not.toBeInTheDocument();
    });

    expect(screen.getByText("Load more")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Load more"));

    await waitFor(() => {
      expect(screen.queryByText("Load more")).not.toBeInTheDocument();
    });

    expect(screen.getByText("src/file_0.ts (modified)")).toBeInTheDocument();
    expect(screen.getByText("src/file_99.ts (modified)")).toBeInTheDocument();
    expect(apiClient.traces.getRunEvidence).toHaveBeenCalledTimes(2);
  });

  it("shows Loading more... while fetching next page", async () => {
    const page1 = makeEvidencePage({
      file_changes: makeFileChanges(100, 0),
      next_after_file_change_id: "fc_99",
    });

    let resolvePage2!: (value: RunEvidenceResponse) => void;
    const page2Promise = new Promise<RunEvidenceResponse>((resolve) => {
      resolvePage2 = resolve;
    });

    vi.mocked(apiClient.traces.getRunEvidence)
      .mockResolvedValueOnce(page1)
      .mockReturnValueOnce(page2Promise);

    renderWithQuery(<FileChangeTraceCard event={makeChangeSummaryEvent()} />);

    fireEvent.click(await screen.findByText("View all"));

    await waitFor(() => {
      expect(screen.queryByText("Loading...")).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Load more"));

    await waitFor(() => {
      expect(screen.getByText("Loading more...")).toBeInTheDocument();
    });

    const loadMoreBtn = screen.getByText("Loading more...");
    expect(loadMoreBtn).toBeDisabled();

    const page2 = makeEvidencePage({
      file_changes: makeFileChanges(50, 100),
      next_after_file_change_id: null,
    });
    resolvePage2(page2);

    await waitFor(() => {
      expect(screen.queryByText("Loading more...")).not.toBeInTheDocument();
    });
  });

  it("does not show Load more when no next_after_file_change_id", async () => {
    const page1 = makeEvidencePage({
      file_changes: makeFileChanges(5, 0),
      next_after_file_change_id: null,
    });
    vi.mocked(apiClient.traces.getRunEvidence).mockResolvedValue(page1);

    renderWithQuery(<FileChangeTraceCard event={makeChangeSummaryEvent()} />);

    fireEvent.click(await screen.findByText("View all"));

    await waitFor(() => {
      expect(screen.queryByText("Loading...")).not.toBeInTheDocument();
    });

    expect(screen.queryByText("Load more")).not.toBeInTheDocument();
    expect(screen.queryByText("... more available")).not.toBeInTheDocument();
  });

  it("handles API error gracefully", async () => {
    vi.mocked(apiClient.traces.getRunEvidence).mockRejectedValue(
      new Error("Network error"),
    );

    renderWithQuery(<FileChangeTraceCard event={makeChangeSummaryEvent()} />);

    fireEvent.click(await screen.findByText("View all"));

    await waitFor(() => {
      expect(screen.getByText("Failed to load file changes")).toBeInTheDocument();
    });

    expect(screen.queryByText("Load more")).not.toBeInTheDocument();
  });

  it("renders scan_failed event without evidence fetching", () => {
    const event: ThreadEvent = {
      id: "evt_scan_failed",
      event_sequence: 3,
      thread_id: "thr_1",
      type: ThreadEventType.FileChangeScanFailed,
      actor_type: ActorType.System,
      actor_id: null,
      payload_json: {
        reason_code: "git_timeout",
        message: "Git scan timed out",
        recovered_after_restart: false,
      },
      evidence_refs: [],
      created_at: "2026-07-19T00:00:00.000Z",
    };

    renderWithQuery(<FileChangeTraceCard event={event} />);

    expect(screen.getByText("Scan Failed")).toBeInTheDocument();
    expect(screen.getByText("Git scan timed out")).toBeInTheDocument();
    expect(screen.getByText("reason: git_timeout")).toBeInTheDocument();
    expect(apiClient.traces.getRunEvidence).not.toHaveBeenCalled();
  });
});
