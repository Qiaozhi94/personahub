// F006: Orchestrated Coding Graph Slice — graph-level types.
// GraphRun / NodeRun lifecycles are defined in design.md §7.

/** Non-terminal statuses include cancelling: the graph is waiting for
 *  running Attempts to exit, and must not be replaced by a new graph. */
export enum GraphRunStatus {
  Running = "running",
  Blocked = "blocked",
  Cancelling = "cancelling",
  Completed = "completed",
  Cancelled = "cancelled",
}

/** NodeRun lifecycle: pending (join unsatisfied) → ready (Attempt queued)
 *  → running → completed | failed | interrupted | cancelled. */
export enum NodeRunStatus {
  Pending = "pending",
  Ready = "ready",
  Running = "running",
  Completed = "completed",
  Failed = "failed",
  Interrupted = "interrupted",
  Cancelled = "cancelled",
}

/** Graph-level blocker reasons. Independent of ValidationBlockReason
 *  — validation. unblock() hard-rejects non-validation blockers. */
export enum GraphBlockReason {
  NodeRunFailed = "node_run_failed",
  NodeRunCancelled = "node_run_cancelled",
  JoinUnsatisfiable = "join_unsatisfiable",
  NoCapableAdapter = "no_capable_adapter",
  ResultUnparsable = "result_unparsable",
  ResultTooLarge = "result_too_large",
  DefinitionVersionUnavailable = "definition_version_unavailable",
  RecoveryInconsistent = "recovery_inconsistent",
}

/** Stable identifier for a node within a definition. */
export type GraphNodeKey = string;

/** Row projection for graph_runs. Raw DB columns are parsed by the
 *  repository mapper; consumers see structured types only. */
export interface GraphRun {
  id: string;
  issue_id: string;
  thread_id: string;
  workspace_id: string;
  definition_id: string;
  definition_version: number;
  status: GraphRunStatus;
  blocked_reason_code: GraphBlockReason | null;
  blocked_node_keys: GraphNodeKey[];
  target_files: readonly string[];
  target_files_hash: string;
  target_files_truncated: boolean;
  target_files_dropped_count: number;
  created_at: string;
  updated_at: string;
}

/** Row projection for node_runs. */
export interface NodeRun {
  id: string;
  graph_run_id: string;
  node_key: GraphNodeKey;
  status: NodeRunStatus;
  join_satisfied_at: string | null;
  result_event_id: string | null;
  assigned_adapter_config_id: string;
  created_at: string;
  updated_at: string;
}

/** Non-terminal GraphRunStatus values — used by the partial unique
 *  index that enforces at-most-one active graph per Issue. */
export const NON_TERMINAL_GRAPH_STATUSES: readonly GraphRunStatus[] = [
  GraphRunStatus.Running,
  GraphRunStatus.Blocked,
  GraphRunStatus.Cancelling,
];

/** Active Attempt statuses — used by the partial unique index that
 *  enforces at-most-one active Attempt per NodeRun. */
export const ACTIVE_ATTEMPT_STATUSES: readonly string[] = ["queued", "running"];

/** Projection of a Run attached to a graph node. */
export interface NodeRunAttemptProjection {
  run_id: string;
  status: string;
  adapter_config_id: string;
  adapter_identity: unknown;
  failure_reason: string | null;
  started_at: string | null;
  completed_at: string | null;
}

/** Projection of a NodeRun returned by graph APIs. */
export interface ProjectedNodeRun {
  node_key: GraphNodeKey;
  title: string;
  responsibility: string;
  status: NodeRunStatus;
  join_satisfied_at: string | null;
  result_event_id: string | null;
  attempts: NodeRunAttemptProjection[];
}

/** Projection of a traversed graph edge. */
export interface ProjectedEdge {
  from: GraphNodeKey;
  to: GraphNodeKey;
  traversed_at: string | null;
  outcome: string | null;
  decided_by: string | null;
  input_refs: string[];
}

/** Projection of a GraphRun returned by graph APIs. */
export interface ProjectedGraphRun {
  id: string;
  status: GraphRunStatus;
  blocked_reason_code: GraphBlockReason | null;
  blocked_node_keys: GraphNodeKey[];
  definition_id: string;
  definition_version: number;
  created_at: string;
  updated_at: string;
}

/** Response from GET /api/issues/:issueId/graph. */
export interface IssueGraphResponse {
  current: {
    graph_run: ProjectedGraphRun;
    nodes: ProjectedNodeRun[];
    edges: ProjectedEdge[];
  } | null;
  history: Array<{ graph_run_id: string; status: string; created_at: string }>;
}

/** Response from POST /api/graph-runs/:graphRunId/cancel. */
export interface GraphRunCancelResponse {
  graph_run_id: string;
  status: string;
  cancelled_node_keys: GraphNodeKey[];
  active_run_ids: string[];
}

/** Response from POST /api/graph-runs/:graphRunId/nodes/:nodeKey/retry. */
export interface GraphNodeRetryResponse {
  node_run_id: string;
  run_id: string;
  status: NodeRunStatus;
}

/** Response from POST /api/graph-runs/:graphRunId/resolve-executors. */
export interface GraphResolveExecutorsResponse {
  graph_run_id: string;
  status: GraphRunStatus;
  reassigned: Array<{ node_key: GraphNodeKey; from: string; to: string }>;
  queued_run_ids: string[];
}

/** Response from POST /api/issues/:issueId/graph-runs. */
export interface GraphStartResponse {
  graph_run_id: string;
}
