import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { cn } from "@/lib/utils";

// Shared dialog primitive (UX-002 / BC-048/049/050): every overlay in the app
// renders exactly one dialog semantic — role="dialog", aria-modal, an
// accessible title, focus entering on open, Tab contained, Escape closing, and
// focus returning to the trigger. Radix owns the mechanics; pages must not
// bypass this wrapper with ad-hoc overlays.

interface AppDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}

export function AppDialog({ open, onOpenChange, title, description, children, className }: AppDialogProps) {
  // Radix restores focus itself only when a DialogTrigger owns the open
  // state; programmatic openers get the same guarantee through this fallback.
  const previouslyFocusedRef = React.useRef<HTMLElement | null>(null);
  React.useEffect(() => {
    if (open) {
      previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
    } else if (previouslyFocusedRef.current) {
      previouslyFocusedRef.current.focus();
      previouslyFocusedRef.current = null;
    }
  }, [open]);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60" />
        <DialogPrimitive.Content
          aria-modal="true"
          className={cn(
            "fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2",
            "grid gap-4 rounded-lg border border-border bg-popover p-6 shadow-xl",
            className,
          )}
        >
          <DialogPrimitive.Title className="text-base font-semibold leading-tight">{title}</DialogPrimitive.Title>
          {description ? (
            <DialogPrimitive.Description className="text-sm text-muted-foreground">
              {description}
            </DialogPrimitive.Description>
          ) : null}
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** Focus-returning close control for use inside an AppDialog. */
export function AppDialogClose({ children }: { children: React.ReactNode }) {
  return (
    <DialogPrimitive.Close asChild>
      <button type="button" className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent">
        {children}
      </button>
    </DialogPrimitive.Close>
  );
}

/** Trigger that opens an AppDialog and hands focus back on close. */
export function AppDialogTrigger({
  label,
  onOpen,
  disabled,
  disabledReason,
  className,
}: {
  label: React.ReactNode;
  onOpen: () => void;
  disabled?: boolean;
  disabledReason?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={disabled}
      aria-disabled={disabled || undefined}
      title={disabled ? disabledReason : undefined}
      className={cn(
        "rounded-md border border-border px-3 py-1.5 text-sm transition-colors",
        "hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
    >
      {label}
    </button>
  );
}
