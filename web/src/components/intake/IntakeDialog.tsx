import { useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  ErrorCode,
  type AgentRosterRecommendation,
  type ApiError,
  type ChosenPlan,
  type RecommendResponse,
  type TopologyRecommendationValue,
} from "@personahub/shared";
import { apiClient, toApiError } from "@/lib/api-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

interface IntakeDialogProps {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (issueId: string) => void;
}

type Status = "idle" | "loading" | "recommended" | "blocked" | "confirming" | "stale" | "confirmed";

const BLOCKED_CODES = new Set<string>([
  ErrorCode.NO_AVAILABLE_ADAPTER,
  ErrorCode.NO_AVAILABLE_CAPABLE_ADAPTER,
  ErrorCode.PROJECT_WORKSPACE_REQUIRED,
  ErrorCode.TOPOLOGY_NOT_EXECUTABLE,
]);

function isBlockedError(error: ApiError): boolean {
  return BLOCKED_CODES.has(error.code);
}

function buildChosenPlan(
  roster: AgentRosterRecommendation,
  topology: TopologyRecommendationValue,
  adapters: Record<string, string>,
): ChosenPlan | null {
  if (topology.value === "sequential") {
    const adapterConfigId = adapters["sequential"];
    if (!adapterConfigId) return null;
    return { topology: "sequential", adapter_config_id: adapterConfigId };
  }

  if (!topology.definition_id || topology.definition_version == null) return null;

  const nodeAssignments: Record<string, string> = {};
  for (const nodeKey of Object.keys(roster.by_node)) {
    const adapterId = adapters[nodeKey];
    if (!adapterId) return null;
    nodeAssignments[nodeKey] = adapterId;
  }

  return {
    topology: "orchestrator_subagent",
    definition_id: topology.definition_id,
    definition_version: topology.definition_version,
    node_assignments: nodeAssignments,
  };
}

function getSuggestedAction(error: ApiError): string {
  if (typeof error.details?.suggested_action === "string") {
    return error.details.suggested_action;
  }
  return error.message;
}

function topologyLabel(topology: TopologyRecommendationValue): string {
  if (topology.value === "sequential") return "Sequential";
  return `Orchestrator + subagent (${topology.definition_id ?? ""} v${topology.definition_version ?? ""})`;
}

function ChoiceButton({
  children,
  selected,
  disabled,
  onClick,
}: {
  children: ReactNode;
  selected: boolean;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "h-7 rounded-full border border-border px-3 text-xs capitalize transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        selected
          ? "border-primary bg-primary text-primary-foreground hover:bg-primary/90"
          : "hover:bg-secondary hover:text-secondary-foreground",
      )}
    >
      {children}
    </button>
  );
}

function RecommendationDetails<T>({
  value,
  rule,
  candidates,
  excluded,
  render,
}: {
  value: T;
  rule: string;
  candidates: T[];
  excluded: { id: string; reason: string }[];
  render: (item: T) => ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">{render(value)}</span>
        {candidates.map((candidate, index) => (
          <span key={index} className="text-xs text-muted-foreground">
            candidate: {render(candidate)}
          </span>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">Matched rule: {rule}</p>
      {excluded.length > 0 ? (
        <div className="text-xs text-muted-foreground">
          <span>Excluded:</span>
          <ul className="list-disc pl-4">
            {excluded.map((item) => (
              <li key={item.id}>
                {item.id}: {item.reason}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export function IntakeDialog({ projectId, open, onOpenChange, onCreated }: IntakeDialogProps) {
  const queryClient = useQueryClient();
  const [goal, setGoal] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [response, setResponse] = useState<RecommendResponse | null>(null);
  const [selectedTopology, setSelectedTopology] = useState<TopologyRecommendationValue | null>(null);
  const [selectedAdapters, setSelectedAdapters] = useState<Record<string, string>>({});
  const [blockedAction, setBlockedAction] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const requestGeneration = useRef(0);

  const editableSet = useMemo(() => new Set(response?.editable ?? []), [response?.editable]);
  const topologyEditable = editableSet.has("collaboration_topology");
  const rosterEditable = editableSet.has("agent_roster");

  const currentTopology = selectedTopology ?? response?.collaboration_topology.value ?? null;
  const activeRoster: AgentRosterRecommendation | null = currentTopology
    ? (response?.rosters_by_topology[currentTopology.value] ?? response?.agent_roster ?? null)
    : null;

  function applyRecommendation(res: RecommendResponse) {
    setResponse(res);
    setSelectedTopology(res.collaboration_topology.value);
    setSelectedAdapters(
      res.rosters_by_topology[res.collaboration_topology.value.value]?.value ?? res.agent_roster.value,
    );
  }

  function reset() {
    requestGeneration.current += 1;
    setGoal("");
    setStatus("idle");
    setResponse(null);
    setSelectedTopology(null);
    setSelectedAdapters({});
    setBlockedAction(null);
    setErrorMessage(null);
  }

  function handleOpenChange(next: boolean) {
    if (!next) reset();
    onOpenChange(next);
  }

  function selectTopology(candidate: TopologyRecommendationValue) {
    if (!topologyEditable || !response) return;
    setSelectedTopology(candidate);
    const roster = response.rosters_by_topology[candidate.value];
    if (roster) setSelectedAdapters(roster.value);
  }

  async function handleRecommend(e: FormEvent) {
    e.preventDefault();
    const trimmedGoal = goal.trim();
    if (!trimmedGoal) return;
    const generation = requestGeneration.current;

    setStatus("loading");
    setBlockedAction(null);
    setErrorMessage(null);

    try {
      const res = await apiClient.intake.recommend(projectId, trimmedGoal);
      if (generation !== requestGeneration.current) return;
      applyRecommendation(res);
      setStatus("recommended");
    } catch (err) {
      if (generation !== requestGeneration.current) return;
      const apiErr = toApiError(err);
      if (isBlockedError(apiErr)) {
        setBlockedAction(getSuggestedAction(apiErr));
        setStatus("blocked");
      } else {
        setErrorMessage(apiErr.message);
        setStatus("idle");
      }
    }
  }

  async function handleConfirm() {
    if (!response || !selectedTopology || !activeRoster) return;

    const chosen = buildChosenPlan(activeRoster, selectedTopology, selectedAdapters);
    if (!chosen) return;

    setStatus("confirming");
    setErrorMessage(null);

    try {
      const res = await apiClient.intake.confirm(projectId, response.token, chosen);
      await queryClient.invalidateQueries({ queryKey: ["issues", projectId] });
      handleOpenChange(false);
      onCreated(res.issue_id);
    } catch (err) {
      const apiErr = toApiError(err);
      if (apiErr.code === ErrorCode.RECOMMENDATION_STALE) {
        setStatus("stale");
      } else {
        setStatus("recommended");
        setErrorMessage(apiErr.message);
      }
    }
  }

  function handleRerun() {
    setStatus("idle");
    setResponse(null);
    setSelectedTopology(null);
    setSelectedAdapters({});
    setBlockedAction(null);
    setErrorMessage(null);
  }

  const chosenPlanReady =
    response && selectedTopology && activeRoster
      ? buildChosenPlan(activeRoster, selectedTopology, selectedAdapters) !== null
      : false;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Intake</DialogTitle>
        </DialogHeader>

        {(status === "idle" || status === "loading") && (
          <form className="grid gap-4" onSubmit={handleRecommend}>
            <div className="grid gap-1.5">
              <Label htmlFor="intake-goal">Goal</Label>
              <Textarea
                id="intake-goal"
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                placeholder="Describe the goal in plain language…"
                disabled={status === "loading"}
                required
              />
            </div>

            {errorMessage ? <p className="text-xs text-destructive">{errorMessage}</p> : null}

            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => handleOpenChange(false)}
                disabled={status === "loading"}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={!goal.trim() || status === "loading"}>
                {status === "loading" ? "Recommending…" : "Recommend"}
              </Button>
            </div>
          </form>
        )}

        {status === "blocked" && (
          <div className="grid gap-4">
            <div className="rounded-md border border-border bg-secondary/30 p-3 text-sm">
              <p className="font-medium text-destructive">Unable to recommend</p>
              <p className="mt-1 text-muted-foreground">{blockedAction}</p>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => handleOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={handleRerun}>Back</Button>
            </div>
          </div>
        )}

        {status === "stale" && (
          <div className="grid gap-4">
            <div className="rounded-md border border-border bg-secondary/30 p-3 text-sm">
              <p className="font-medium">Recommendation stale</p>
              <p className="mt-1 text-muted-foreground">
                The recommendation expired before confirmation. Re-run it to get a fresh plan.
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => handleOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={handleRerun}>Re-run recommendation</Button>
            </div>
          </div>
        )}

        {(status === "recommended" || status === "confirming") && response && (
          <div className="grid gap-4">
            <div className="grid gap-3">
              <div className="grid gap-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-semibold">Issue type</Label>
                  <span className="text-xs text-muted-foreground">当前只有 coding 候选</span>
                </div>
                <RecommendationDetails
                  value={response.issue_type.value}
                  rule={response.issue_type.rule}
                  candidates={response.issue_type.candidates}
                  excluded={response.issue_type.excluded}
                  render={(v) => <>{v}</>}
                />
              </div>

              <Separator />

              <div className="grid gap-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-semibold">Issue draft</Label>
                  <span className="text-xs text-muted-foreground">v0.2 不可调整</span>
                </div>
                <div className="grid gap-2 rounded-md border border-border bg-secondary/30 p-3">
                  <RecommendationDetails
                    value={response.issue_draft.title.value}
                    rule={response.issue_draft.title.rule}
                    candidates={response.issue_draft.title.candidates}
                    excluded={response.issue_draft.title.excluded}
                    render={(v) => <>{v}</>}
                  />
                  <RecommendationDetails
                    value={response.issue_draft.goal.value}
                    rule={response.issue_draft.goal.rule}
                    candidates={response.issue_draft.goal.candidates}
                    excluded={response.issue_draft.goal.excluded}
                    render={(v) => <>{v}</>}
                  />
                  <RecommendationDetails
                    value={response.issue_draft.priority.value}
                    rule={response.issue_draft.priority.rule}
                    candidates={response.issue_draft.priority.candidates}
                    excluded={response.issue_draft.priority.excluded}
                    render={(v) => (
                      <Badge variant="secondary" className="w-fit capitalize">
                        {v}
                      </Badge>
                    )}
                  />
                </div>
              </div>

              <Separator />

              <div className="grid gap-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-semibold">Workflow template</Label>
                  <span className="text-xs text-muted-foreground">v0.2 不可调整</span>
                </div>
                <div className="rounded-md border border-border bg-secondary/30 p-3">
                  <RecommendationDetails
                    value={response.workflow_template.value}
                    rule={response.workflow_template.rule}
                    candidates={response.workflow_template.candidates}
                    excluded={response.workflow_template.excluded}
                    render={(v) => (
                      <>
                        {v.id} v{v.version}
                      </>
                    )}
                  />
                </div>
              </div>

              <Separator />

              <div className="grid gap-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-semibold">Collaboration topology</Label>
                  {topologyEditable ? null : <span className="text-xs text-muted-foreground">v0.2 不可调整</span>}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {response.collaboration_topology.candidates.map((candidate) => (
                    <ChoiceButton
                      key={candidate.value}
                      selected={selectedTopology?.value === candidate.value}
                      disabled={!topologyEditable}
                      onClick={() => selectTopology(candidate)}
                    >
                      {topologyLabel(candidate)}
                    </ChoiceButton>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">Matched rule: {response.collaboration_topology.rule}</p>
                {response.collaboration_topology.excluded.length > 0 ? (
                  <div className="text-xs text-muted-foreground">
                    <span>Excluded:</span>
                    <ul className="list-disc pl-4">
                      {response.collaboration_topology.excluded.map((item) => (
                        <li key={item.id}>
                          {item.id}: {item.reason}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>

              <Separator />

              <div className="grid gap-2">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-semibold">Agent roster</Label>
                  {rosterEditable ? null : <span className="text-xs text-muted-foreground">v0.2 不可调整</span>}
                </div>
                <div className="grid gap-3">
                  {activeRoster
                    ? Object.entries(activeRoster.by_node).map(([nodeKey, node]) => (
                        <div key={nodeKey} className="grid gap-1.5 rounded-md border border-border p-3">
                          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            {nodeKey}
                          </Label>
                          <select
                            aria-label={`Adapter for ${nodeKey}`}
                            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                            value={selectedAdapters[nodeKey] ?? ""}
                            disabled={!rosterEditable}
                            onChange={(e) =>
                              setSelectedAdapters((prev) => ({
                                ...prev,
                                [nodeKey]: e.target.value,
                              }))
                            }
                          >
                            {node.candidates.map((adapterId) => (
                              <option key={adapterId} value={adapterId}>
                                {adapterId}
                              </option>
                            ))}
                          </select>
                          {node.excluded.length > 0 ? (
                            <div className="text-xs text-muted-foreground">
                              <span>Excluded:</span>
                              <ul className="list-disc pl-4">
                                {node.excluded.map((item) => (
                                  <li key={item.id}>
                                    {item.id}: {item.reason}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          ) : null}
                        </div>
                      ))
                    : null}
                </div>
                <p className="text-xs text-muted-foreground">
                  Matched rule: {activeRoster?.rule ?? response.agent_roster.rule}
                </p>
              </div>
            </div>

            {errorMessage ? <p className="text-xs text-destructive">{errorMessage}</p> : null}

            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => handleOpenChange(false)}
                disabled={status === "confirming"}
              >
                Cancel
              </Button>
              <Button type="button" disabled={!chosenPlanReady || status === "confirming"} onClick={handleConfirm}>
                {status === "confirming" ? "Confirming…" : "Confirm"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
