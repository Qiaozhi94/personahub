import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ErrorCode, type Artifact } from "@personahub/shared";
import {
  useArtifact,
  useArtifactRevision,
  useArtifactsByIssue,
  useArtifactProvenance,
  useRunArtifacts,
  useEvidenceArtifacts,
} from "@/hooks/use-artifacts";

vi.mock("@/lib/api-client", () => import("@/test/api-client-mock"));

import { apiClient } from "@/lib/api-client";

// F010 T012 (AC-003 web side): API client + read-only hooks distinguish
// loading / empty / ready / missing / invalid / hash_mismatch, and F010 ships
// no visible component and no SurfaceRegistry slot (design §6). The file name
// is pinned by spec.md's AC-003 tests list, so JSX is avoided (createElement)
// to keep the .ts extension valid for esbuild.

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

const artifactFixture: Artifact = {
  id: "art_1",
  issue_id: "iss_1",
  thread_id: "thr_1",
  type: "report",
  title: "Report",
  state: "active",
  current_revision: 2,
  created_by: "tester",
  created_at: "2026-09-12T00:00:00Z",
  updated_at: "2026-09-12T00:00:00Z",
};

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("apiClient.artifacts", () => {
  it("exposes the F010 read surface", () => {
    expect(apiClient.artifacts).toBeDefined();
    for (const fn of [
      "create",
      "revise",
      "listByIssue",
      "get",
      "getRevision",
      "getProvenance",
      "listByRun",
      "listByEvidenceRef",
    ]) {
      expect(typeof apiClient.artifacts[fn as keyof typeof apiClient.artifacts]).toBe("function");
    }
  });

  it("encodes typed refs exactly once in the query string", async () => {
    // this file mocks @/lib/api-client for the hook tests; the URL contract
    // needs the real apiFetch, so pull it via importActual
    const real = await vi.importActual<typeof import("@/lib/api-client")>("@/lib/api-client");
    global.fetch = vi
      .fn()
      .mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ status: "empty" }), { status: 200 })));
    try {
      await real.apiClient.artifacts.listByEvidenceRef("event:evt 1/x?y");
      const called = vi.mocked(global.fetch).mock.calls[0]?.[0] as string | undefined;
      expect(called).toBe(`/api/evidence/artifacts?ref=${encodeURIComponent("event:evt 1/x?y")}`);
      expect(called).not.toContain("%25");

      await real.apiClient.artifacts.listByIssue("iss a&b");
      expect(vi.mocked(global.fetch).mock.calls[1]?.[0]).toBe(
        `/api/artifacts?issue_id=${encodeURIComponent("iss a&b")}`,
      );
    } finally {
      vi.restoreAllMocks();
    }
  });
});

describe("artifact read-model states", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("starts in loading while the request is in flight", () => {
    vi.mocked(apiClient.artifacts.get).mockImplementation(() => new Promise(() => {}));
    const { result } = renderHook(() => useArtifact("art_1"), { wrapper: createWrapper() });
    expect(result.current.state).toBe("loading");
  });

  it("maps a ready entity read", async () => {
    vi.mocked(apiClient.artifacts.get).mockResolvedValue({ status: "ready", artifact: artifactFixture });
    const { result } = renderHook(() => useArtifact("art_1"), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.state).toBe("ready"));
    expect(result.current.state === "ready" && result.current.data.id).toBe("art_1");
  });

  it("keeps empty (no rows) and missing (entity absent) distinct on the list hook", async () => {
    vi.mocked(apiClient.artifacts.listByIssue).mockResolvedValue({ status: "empty" });
    const empty = renderHook(() => useArtifactsByIssue("iss_1"), { wrapper: createWrapper() });
    await waitFor(() => expect(empty.result.current.state).toBe("empty"));

    vi.mocked(apiClient.artifacts.listByIssue).mockResolvedValue({
      status: "ready",
      artifacts: [artifactFixture],
    });
    const ready = renderHook(() => useArtifactsByIssue("iss_1"), { wrapper: createWrapper() });
    await waitFor(() => expect(ready.result.current.state).toBe("ready"));

    vi.mocked(apiClient.artifacts.get).mockResolvedValue({
      status: "missing",
      code: ErrorCode.ARTIFACT_NOT_FOUND,
      ref: "artifact:art_missing",
      message: "Artifact not found",
    });
    const missing = renderHook(() => useArtifact("art_missing"), { wrapper: createWrapper() });
    await waitFor(() => expect(missing.result.current.state).toBe("missing"));
    expect(missing.result.current.state === "missing" && missing.result.current.code).toBe(
      ErrorCode.ARTIFACT_NOT_FOUND,
    );
    expect(missing.result.current.state === "missing" && missing.result.current.ref).toBe("artifact:art_missing");
  });

  it("surfaces invalid and hash_mismatch as their own states", async () => {
    vi.mocked(apiClient.artifacts.listByEvidenceRef).mockResolvedValue({
      status: "invalid",
      code: ErrorCode.ARTIFACT_REF_INVALID,
      ref: "bogus-ref",
      message: "Unknown evidence ref kind.",
    });
    const invalid = renderHook(() => useEvidenceArtifacts("bogus-ref"), { wrapper: createWrapper() });
    await waitFor(() => expect(invalid.result.current.state).toBe("invalid"));

    vi.mocked(apiClient.artifacts.getRevision).mockResolvedValue({
      status: "hash_mismatch",
      code: ErrorCode.ARTIFACT_HASH_MISMATCH,
      ref: "artifact:art_1@1",
      message: "bytes do not match",
    });
    const mismatch = renderHook(() => useArtifactRevision("art_1", 1), { wrapper: createWrapper() });
    await waitFor(() => expect(mismatch.result.current.state).toBe("hash_mismatch"));
    expect(mismatch.result.current.state === "hash_mismatch" && mismatch.result.current.code).toBe(
      ErrorCode.ARTIFACT_HASH_MISMATCH,
    );
  });

  it("classifies transport-level ApiErrors by stable code", async () => {
    vi.mocked(apiClient.artifacts.getProvenance).mockRejectedValue({
      code: ErrorCode.ARTIFACT_NOT_FOUND,
      message: "gone",
    });
    const missing = renderHook(() => useArtifactProvenance("art_gone"), { wrapper: createWrapper() });
    await waitFor(() => expect(missing.result.current.state).toBe("missing"));

    vi.mocked(apiClient.artifacts.listByRun).mockRejectedValue({ code: ErrorCode.INTERNAL_ERROR, message: "boom" });
    const invalid = renderHook(() => useRunArtifacts("run_1"), { wrapper: createWrapper() });
    await waitFor(() => expect(invalid.result.current.state).toBe("invalid"));
  });

  it("returns loading (never fires) when the key is null", () => {
    vi.mocked(apiClient.artifacts.get).mockImplementation(() => new Promise(() => {}));
    const { result } = renderHook(() => useArtifact(null), { wrapper: createWrapper() });
    expect(result.current.state).toBe("loading");
    expect(apiClient.artifacts.get).not.toHaveBeenCalled();
  });

  it("delivers revision content with the base64 payload intact", async () => {
    const bytes = Buffer.from("# body", "utf8").toString("base64");
    vi.mocked(apiClient.artifacts.getRevision).mockResolvedValue({
      status: "ready",
      artifact: artifactFixture,
      revision: {
        artifact_id: "art_1",
        revision: 1,
        storage_kind: "workspace_file",
        inline_content: null,
        source_relative_path: "docs/a.md",
        archive_relative_path: "ab/" + "a".repeat(64),
        content_hash: "a".repeat(64),
        source_run_id: null,
        created_by: "tester",
        created_at: "2026-09-12T00:00:00Z",
      },
      content: { storage_kind: "workspace_file", content_base64: bytes, size_bytes: 6 },
    });
    const { result } = renderHook(() => useArtifactRevision("art_1", 1), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.state).toBe("ready"));
    const content = result.current.state === "ready" ? result.current.data.content : null;
    expect(content?.storage_kind).toBe("workspace_file");
    if (content?.storage_kind !== "workspace_file") {
      throw new Error("expected workspace_file content");
    }
    expect(Buffer.from(content.content_base64, "base64").toString()).toBe("# body");
  });

  it("keeps the in-flight promise unobserved until the query resolves (loading guard)", async () => {
    const gate = deferred<{ status: string } & Record<string, unknown>>();
    vi.mocked(apiClient.artifacts.getRevision).mockImplementation(() => gate.promise as never);
    const { result, rerender } = renderHook(() => useArtifactRevision("art_1", 1), { wrapper: createWrapper() });
    expect(result.current.state).toBe("loading");
    gate.resolve({ status: "empty" });
    rerender();
    await waitFor(() => expect(result.current.state).not.toBe("loading"));
  });
});

describe("F010 surface boundary", () => {
  it("registers no visible component exports in the hooks module", async () => {
    const mod = await import("@/hooks/use-artifacts");
    for (const exportName of Object.keys(mod)) {
      // hooks only: every runtime export must be a hook function, not a component
      expect(exportName.startsWith("use")).toBe(true);
    }
  });

  it("adds no SurfaceRegistry slot or route for F010", async () => {
    const { SURFACE_REGISTRY } = await import("@/app/surface-registry");
    expect(SURFACE_REGISTRY.some((surface) => surface.id.includes("artifact"))).toBe(false);
    expect(SURFACE_REGISTRY.some((surface) => surface.route?.includes("artifact"))).toBe(false);
  });
});
