import { useState } from "react";
import type { Dispatch, ThreadEvent } from "@personahub/shared";
import { Button } from "@/components/ui/button";
import { PageFrame } from "@/pages/page-frame";
import { DispatchPanel, UndoBanner } from "@/components/session/DispatchPanel";
import { useConvertToTask, useSendMessage, useSession } from "@/hooks/use-f012";
import { GraphRunPanel } from "@/components/graph/GraphRunPanel";

// F012 T015: the session surface at /sessions/:sessionId (§6.3). Reuses the
// F009 message skeleton conventions: user messages right, execution combos
// left, tool events folded; Thread IDs never appear. An independent room
// offers 转成任务; a task-bound room renders its task link. Dispatch writes go
// exclusively through DispatchPanel → DispatchService (唯一派工写入口).

export function SessionsPage({ sessionId }: { sessionId: string }) {
  const session = useSession(sessionId);
  const sendMessage = useSendMessage(sessionId);
  const convertToTask = useConvertToTask(sessionId);
  const [draft, setDraft] = useState("");
  const [activeDispatch, setActiveDispatch] = useState<Dispatch | null>(null);
  const [goal, setGoal] = useState("");

  if (session.isLoading) {
    return <PageFrame>加载会话…</PageFrame>;
  }
  if (session.isError || !session.data) {
    return <PageFrame>会话不存在或无法加载：{(session.error as Error | undefined)?.message}</PageFrame>;
  }

  const { room, messages } = session.data;

  return (
    <PageFrame>
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">{room.title}</h1>
          <p className="text-xs text-muted-foreground">
            {room.issue_id ? (
              <>
                任务会话 ·{" "}
                <a className="underline" href={`/tasks/${room.issue_id}`}>
                  查看任务
                </a>
              </>
            ) : (
              "独立会话"
            )}
            {room.state === "ended" ? " · 已结束" : ""}
          </p>
        </div>
      </header>

      <section aria-label="消息" className="grid min-h-40 gap-2">
        {messages.length === 0 ? <p className="text-sm text-muted-foreground">还没有消息——发送第一条开始。</p> : null}
        {messages.map((message) => (
          <MessageBubble key={message.id} message={message} />
        ))}
      </section>

      {room.state === "active" ? (
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (!draft.trim()) return;
            sendMessage.mutate(
              { body: draft, idempotencyKey: `msg_${Date.now()}_${Math.random().toString(36).slice(2)}` },
              { onSuccess: () => setDraft("") },
            );
          }}
        >
          <input
            aria-label="会话输入框"
            className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="发送普通消息，或在下方派工"
          />
          <Button type="submit" disabled={sendMessage.isPending || !draft.trim()}>
            发送
          </Button>
        </form>
      ) : null}

      {room.issue_id === null && room.state === "active" ? (
        <section aria-label="转成任务" className="grid gap-2 rounded-md border border-border p-3 text-sm">
          <p className="text-muted-foreground">独立会话可以派工讨论；转成任务后执行产物才会进入 Artifact / 验收链。</p>
          <div className="flex gap-2">
            <input
              aria-label="任务目标"
              className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={goal}
              onChange={(event) => setGoal(event.target.value)}
              placeholder="任务目标"
            />
            <Button
              type="button"
              variant="outline"
              disabled={!goal.trim() || convertToTask.isPending}
              onClick={() => convertToTask.mutate({ goal })}
            >
              转成任务
            </Button>
          </div>
          {convertToTask.isSuccess ? (
            <p className="text-xs text-emerald-600">
              已创建任务{" "}
              <a className="underline" href={`/tasks/${convertToTask.data.issue_id}`}>
                {convertToTask.data.issue_id}
              </a>
            </p>
          ) : null}
        </section>
      ) : null}

      {activeDispatch ? (
        <UndoBanner sessionId={sessionId} dispatch={activeDispatch} onGone={() => setActiveDispatch(null)} />
      ) : null}

      {room.issue_id && room.state === "active" ? (
        <>
          <section aria-label="协作图" className="grid gap-2 rounded-md border border-border p-3">
            <p className="text-sm font-medium">协作图</p>
            <GraphRunPanel issueId={room.issue_id} />
          </section>
          <DispatchPanel sessionId={sessionId} purpose="execute" onDispatched={(d) => setActiveDispatch(d)} />
        </>
      ) : null}
    </PageFrame>
  );
}

function MessageBubble({ message }: { message: ThreadEvent }) {
  const body = (message.payload_json as { body?: string }).body ?? "";
  const aligned = message.actor_type === "user" ? "justify-end" : "justify-start";
  return (
    <div className={`flex ${aligned}`}>
      <div className="max-w-[80%] rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
        {body || message.type}
      </div>
    </div>
  );
}
