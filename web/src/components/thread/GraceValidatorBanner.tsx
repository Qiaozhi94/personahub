import { useEffect, useState } from "react";
import { Clock } from "lucide-react";
import { useTriggerValidation } from "@/hooks/use-validation";
import { toApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";

interface GraceValidatorBannerProps {
  issueId: string;
  /** F005 §8.1: non-null means the grace window is still open — the server due timestamp is the truth, this countdown is a hint only. */
  validationDispatchDueAt: string | null;
}

function formatRemaining(dueAtMs: number, nowMs: number): string {
  const remainingMs = dueAtMs - nowMs;
  if (remainingMs <= 0) return "any moment now";
  const seconds = Math.ceil(remainingMs / 1000);
  return `~${seconds}s`;
}

export function GraceValidatorBanner({ issueId, validationDispatchDueAt }: GraceValidatorBannerProps) {
  const [now, setNow] = useState(() => Date.now());
  const triggerValidation = useTriggerValidation(issueId);

  useEffect(() => {
    if (!validationDispatchDueAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [validationDispatchDueAt]);

  if (!validationDispatchDueAt) return null;

  const dueAtMs = new Date(validationDispatchDueAt).getTime();
  const errorMessage = triggerValidation.isError ? toApiError(triggerValidation.error).message : null;

  return (
    <div className="flex items-center gap-2 rounded-md border border-brand/30 bg-brand/5 px-3 py-2 text-xs">
      <Clock className="h-3.5 w-3.5 shrink-0 text-brand" />
      <span className="flex-1 text-muted-foreground">
        Waiting for a manual validator pick — automatic validation starts in {formatRemaining(dueAtMs, now)} if no one picks first.
      </span>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={triggerValidation.isPending}
        onClick={() => triggerValidation.mutate()}
      >
        {triggerValidation.isPending ? "Starting…" : "Start automatic validator now"}
      </Button>
      {errorMessage ? <p className="text-destructive">{errorMessage}</p> : null}
    </div>
  );
}
