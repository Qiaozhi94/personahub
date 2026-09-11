import * as React from "react";
import { cn } from "@/lib/utils";

// Shared page-state primitive (UX-002 / BC-046): loading, empty, error and
// partial are the only sanctioned non-happy states. Each one keeps the page
// context, explains what happened in one place, and offers exactly one
// executable recovery action — never two competing buttons, never a dead end.

export interface PageStateAction {
  label: string;
  onAction: () => void;
}

export function PageLoading({ label }: { label: string }) {
  return (
    <div role="status" aria-busy="true" className="grid place-items-center gap-2 p-8 text-sm text-muted-foreground">
      <span
        aria-hidden="true"
        className="h-4 w-4 animate-spin rounded-full border-2 border-border-strong border-t-primary"
      />
      <span>{label}</span>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
  actionRef,
}: {
  title: string;
  description?: string;
  action?: PageStateAction;
  /** Lets a caller that opens a dialog from this action (e.g. via
   *  restoreFocusRef) restore focus here on close, same as any other
   *  dialog trigger — see DialogContent's restoreFocusRef (BC-049). */
  actionRef?: React.RefObject<HTMLButtonElement | null>;
}) {
  return (
    <div className="grid place-items-center gap-2 p-8 text-center">
      <p className="text-sm font-medium">{title}</p>
      {description ? <p className="max-w-md text-sm text-muted-foreground">{description}</p> : null}
      {action ? (
        <button
          ref={actionRef}
          type="button"
          onClick={action.onAction}
          className="mt-1 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          {action.label}
        </button>
      ) : null}
    </div>
  );
}

export function ErrorState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action: PageStateAction;
}) {
  return (
    <div role="alert" className="grid place-items-center gap-2 p-8 text-center">
      <p className="text-sm font-medium text-destructive">{title}</p>
      {description ? <p className="max-w-md text-sm text-muted-foreground">{description}</p> : null}
      <button
        type="button"
        onClick={action.onAction}
        className="mt-1 rounded-md border border-border-strong px-3 py-1.5 text-sm hover:bg-accent"
      >
        {action.label}
      </button>
    </div>
  );
}

export function PartialState({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="grid gap-3">
      <div
        role="status"
        className={cn(
          "flex items-start gap-2 rounded-md border border-border bg-secondary/60 px-3 py-2",
          "text-sm text-muted-foreground",
        )}
      >
        <span className="font-medium text-foreground">{title}</span>
        {description ? <span>{description}</span> : null}
      </div>
      {children}
    </div>
  );
}
