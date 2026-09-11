import * as React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

// Shared feedback primitive (V3.44 design.md §5): persistent state changes
// render a StatusBanner with its recovery entry; completed operations render a
// short-lived TransientFeedback announcement; actions that are currently
// impossible render DisabledAction with the visible reason and the
// alternative path. The three classes must not be mixed up.

export type FeedbackTone = "info" | "success" | "warning" | "error";

const toneClasses: Record<FeedbackTone, string> = {
  info: "border-border bg-secondary/60",
  success: "border-success/40 bg-success/10",
  warning: "border-warning/40 bg-warning/10",
  error: "border-destructive/40 bg-destructive/10",
};

export function StatusBanner({
  tone,
  title,
  description,
  action,
}: {
  tone: FeedbackTone;
  title: string;
  description?: string;
  action?: { label: string; onAction: () => void };
}) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border px-3 py-2 text-sm",
        toneClasses[tone],
      )}
    >
      <span className="font-medium">{title}</span>
      {description ? <span className="text-muted-foreground">{description}</span> : null}
      {action ? (
        <button
          type="button"
          onClick={action.onAction}
          className="ml-auto rounded-md border border-border-strong px-2.5 py-1 text-xs hover:bg-accent"
        >
          {action.label}
        </button>
      ) : null}
    </div>
  );
}

export interface TransientFeedbackController {
  message: string | null;
  notify: (message: string) => void;
}

const TRANSIENT_FEEDBACK_MS = 3500;

export function useTransientFeedback(): TransientFeedbackController {
  const [message, setMessage] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  const notify = useCallback((next: string) => {
    setMessage(next);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setMessage(null), TRANSIENT_FEEDBACK_MS);
  }, []);

  return { message, notify };
}

export function TransientFeedback({ feedback }: { feedback: TransientFeedbackController }) {
  if (!feedback.message) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="rounded-md border border-border bg-secondary/70 px-3 py-1.5 text-sm"
    >
      {feedback.message}
    </div>
  );
}

/** Renders a disabled control together with the reason it is disabled and the
 *  path to change that — the V3.44 rule: explain, do not just hide. */
export function DisabledAction({ reason, children }: { reason: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1">
      {children}
      <p className="text-xs text-muted-foreground">{reason}</p>
    </div>
  );
}
