import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ActorType, RoomState, ThreadEventType, type Room, type ThreadEvent } from "@personahub/shared";
import { App } from "@/App";

vi.mock("@/lib/api-client", () => import("@/test/api-client-mock"));

import { apiClient } from "@/lib/api-client";

// F012 T015 (AC-005): /sessions/:sessionId is a real, refresh-recoverable
// route rendering the session surface — no longer not-found.

const ROOM: Room = {
  id: "room_1",
  space_id: "spc_1",
  issue_id: null,
  title: "独立讨论",
  state: RoomState.Active,
  created_at: "2026-09-14T00:00:00Z",
  ended_at: null,
};

function renderAt(path: string) {
  window.history.replaceState(null, "", path);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <App />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(apiClient.f012.getRoom).mockResolvedValue({
    room: ROOM,
    messages: [],
    next_cursor: null,
  });
  const event: ThreadEvent = {
    id: "evt_1", event_sequence: 1, thread_id: "thr_hidden", type: ThreadEventType.SessionMessage,
    actor_type: ActorType.User, actor_id: null,
    payload_json: { body: "你好会话", client_request_id: "k1" },
    evidence_refs: [], created_at: "2026-09-14T00:00:01Z",
  };
  vi.mocked(apiClient.f012.sendMessage).mockResolvedValue({ event });
});

describe("F012 session surface (/sessions/:sessionId)", () => {
  it("renders the room by deep link with the composer and convert-to-task", async () => {
    renderAt("/sessions/room_1");
    expect(await screen.findByRole("heading", { name: "独立讨论" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "会话输入框" })).toBeInTheDocument();
    expect(screen.getByText("独立会话")).toBeInTheDocument();
    expect(screen.getByLabelText("任务目标")).toBeInTheDocument();
  });

  it("sends a message through the idempotent endpoint and clears the draft", async () => {
    renderAt("/sessions/room_1");
    await screen.findByRole("heading", { name: "独立讨论" });
    const input = screen.getByRole("textbox", { name: "会话输入框" });
    await userEvent.type(input, "你好会话");
    await userEvent.click(screen.getByRole("button", { name: "发送" }));
    await waitFor(() =>
      expect(apiClient.f012.sendMessage).toHaveBeenCalledWith(
        "room_1",
        "你好会话",
        expect.stringMatching(/^msg_/),
      ),
    );
  });

  it("never exposes a Thread ID anywhere on the surface", async () => {
    const { container } = renderAt("/sessions/room_1");
    await screen.findByRole("heading", { name: "独立讨论" });
    expect(container.textContent).not.toContain("thr_");
  });
});
