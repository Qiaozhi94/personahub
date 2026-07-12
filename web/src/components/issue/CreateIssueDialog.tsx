import { useState, type FormEvent } from "react";
import { IssuePriority } from "@personahub/shared";
import { useCreateIssue } from "@/hooks/use-issues";
import { toApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

interface CreateIssueDialogProps {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (issueId: string) => void;
}

const PRIORITIES: IssuePriority[] = [IssuePriority.Low, IssuePriority.Normal, IssuePriority.High];

export function CreateIssueDialog({ projectId, open, onOpenChange, onCreated }: CreateIssueDialogProps) {
  const [title, setTitle] = useState("");
  const [goal, setGoal] = useState("");
  const [priority, setPriority] = useState<IssuePriority>(IssuePriority.Normal);
  const [labelsInput, setLabelsInput] = useState("");
  const createIssue = useCreateIssue(projectId);

  const errorMessage = createIssue.isError ? toApiError(createIssue.error).message : null;

  function reset() {
    setTitle("");
    setGoal("");
    setPriority(IssuePriority.Normal);
    setLabelsInput("");
    createIssue.reset();
  }

  function handleOpenChange(next: boolean) {
    if (!next) reset();
    onOpenChange(next);
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const labels = labelsInput
      .split(",")
      .map((label) => label.trim())
      .filter(Boolean);
    createIssue.mutate(
      { title, goal, priority, labels: labels.length > 0 ? labels : undefined },
      {
        onSuccess: (res) => {
          handleOpenChange(false);
          onCreated(res.issue.id);
        },
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New coding issue</DialogTitle>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={handleSubmit}>
          <div className="grid gap-1.5">
            <Label htmlFor="issue-title">Title</Label>
            <Input
              id="issue-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Implement project creation"
              autoFocus
              required
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="issue-goal">Goal</Label>
            <Textarea
              id="issue-goal"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="What should be true when this issue is done?"
              required
            />
          </div>
          <div className="grid gap-1.5">
            <Label>Priority</Label>
            <div className="flex gap-1.5">
              {PRIORITIES.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPriority(p)}
                  className={cn(
                    "h-7 rounded-full border border-border px-3 text-xs capitalize transition-colors hover:bg-secondary",
                    priority === p && "border-primary bg-primary text-primary-foreground hover:bg-primary/90",
                  )}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="issue-labels">Labels (comma-separated)</Label>
            <Input
              id="issue-labels"
              value={labelsInput}
              onChange={(e) => setLabelsInput(e.target.value)}
              placeholder="v0.1.0, foundation"
            />
          </div>
          {errorMessage ? <p className="text-xs text-destructive">{errorMessage}</p> : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!title.trim() || !goal.trim() || createIssue.isPending}
            >
              {createIssue.isPending ? "Creating…" : "Create"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
