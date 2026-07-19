import { useState, type FormEvent } from "react";
import { useUnblock } from "@/hooks/use-validation";
import { toApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

interface UnblockDialogProps {
  issueId: string | null;
  open: boolean;
  onOpenChange: () => void;
}

export function UnblockDialog({ issueId, open, onOpenChange }: UnblockDialogProps) {
  const [note, setNote] = useState("");
  const mutation = useUnblock(issueId);

  const errorMessage = mutation.isError ? toApiError(mutation.error).message : null;

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!note.trim()) return;

    mutation.mutate(
      { operator_note: note.trim() },
      {
        onSuccess: () => {
          setNote("");
          onOpenChange();
        },
      },
    );
  }

  function handleOpenChange() {
    if (!mutation.isPending) {
      setNote("");
      onOpenChange();
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Resolve Blocker</DialogTitle>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={handleSubmit}>
          <div className="grid gap-1.5">
            <Label htmlFor="unblock-note">
              Operator Note{" "}
              <span className="text-muted-foreground">(required)</span>
            </Label>
            <textarea
              id="unblock-note"
              className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Describe how the blocker was resolved..."
              rows={4}
              maxLength={4000}
              disabled={mutation.isPending}
            />
            <p className="text-[10px] text-muted-foreground text-right">
              {note.length}/4000
            </p>
          </div>
          {errorMessage ? (
            <p className="text-xs text-destructive">{errorMessage}</p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={handleOpenChange}
              disabled={mutation.isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!note.trim() || mutation.isPending}
            >
              {mutation.isPending ? "Unblocking…" : "Unblock"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
