import type { AgentCapability, NodeRunStatus } from "@personahub/shared/types";

export type GraphNodeKey = string;

export interface GraphNodeV1 {
  key: GraphNodeKey;
  requiredCapabilities: AgentCapability[];
  instructionTemplate: string;
  inputSlots: string[];
  outputContract: "findings_v1" | "synthesis_v1";
}

export interface GraphEdgeV1 {
  from: GraphNodeKey;
  to: GraphNodeKey;
  acceptedOutcomes: NodeRunStatus[];
  required: boolean;
  joinGroup: string;
  inputSlot: string;
}

export interface GraphDefinitionV1 {
  id: string;
  version: number;
  nodes: GraphNodeV1[];
  edges: GraphEdgeV1[];
  targetGlobs: string[];
}

export interface GraphExecutionPlan {
  definitionId: string;
  definitionVersion: number;
  nodeAssignments: Record<GraphNodeKey, string>;
  premiseHash: string | null;
}

export interface GraphPreflight {
  workspaceId: string;
  workspacePath: string;
  definitionId: string;
  definitionVersion: number;
  targetFiles: readonly string[];
  targetFilesHash: string;
  truncated: boolean;
  droppedCount: number;
}
