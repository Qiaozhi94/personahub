import { AppError } from "../api/errors.js";
import { ErrorCode } from "@personahub/shared/errors";
import type { GraphRunRepository } from "../repositories/graph-run.js";

const SQLITE_CONSTRAINT_UNIQUE = "SQLITE_CONSTRAINT_UNIQUE";

export type GraphConstraintKind = "active_attempt" | "nonterminal_graph" | "duplicate_node";

export class GraphConstraintError extends Error {
  constructor(
    message: string,
    public readonly kind: GraphConstraintKind,
  ) {
    super(message);
    this.name = "GraphConstraintError";
  }
}

interface SqliteError {
  code: string;
  message: string;
}

export function isSqliteUniqueConstraint(error: unknown, indexOrColumn: string): boolean {
  if (!(error instanceof Error)) return false;
  const sqliteErr = error as unknown as SqliteError;
  return (
    sqliteErr.code === SQLITE_CONSTRAINT_UNIQUE &&
    sqliteErr.message.includes(indexOrColumn)
  );
}

export function isActiveGraphAttemptConflict(error: unknown): boolean {
  return isSqliteUniqueConstraint(error, "runs.node_run_id");
}

export function isNonTerminalGraphConflict(error: unknown): boolean {
  return isSqliteUniqueConstraint(error, "graph_runs.issue_id");
}

export function isNodeRunDuplicateConflict(error: unknown): boolean {
  return isSqliteUniqueConstraint(error, "node_runs.graph_run_id");
}

export interface GraphConstraintContext {
  issueId?: string;
  graphRunRepo: GraphRunRepository;
}

export function mapGraphConstraint(error: unknown, context: GraphConstraintContext): never | string {
  if (!(error instanceof GraphConstraintError)) throw error;

  if (error.kind === "active_attempt") {
    throw new AppError(
      ErrorCode.NODE_RUN_ATTEMPT_IN_PROGRESS,
      "This graph node already has an active attempt.",
    );
  }
  if (error.kind === "duplicate_node") {
    throw new AppError(
      ErrorCode.INTERNAL_ERROR,
      "Graph node invariant violation: duplicate NodeRun detected for (graph_run_id, node_key).",
    );
  }
  if (error.kind === "nonterminal_graph" && context.issueId) {
    const existing = context.graphRunRepo.getNonTerminalByIssueId(context.issueId);
    if (existing) return existing.id;
  }
  throw error;
}