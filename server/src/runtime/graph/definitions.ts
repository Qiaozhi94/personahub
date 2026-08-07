import type { GraphDefinitionV1 } from "./types.js";
import { AgentCapability, NodeRunStatus } from "@personahub/shared/types";

const WGD_CODING_DUAL_REVIEW_V1: GraphDefinitionV1 = {
  id: "wgd_coding_dual_review",
  version: 1,
  targetGlobs: ["**/*.ts", "**/*.tsx", "**/*.sql"],
  nodes: [
    {
      key: "review_concurrency",
      requiredCapabilities: [AgentCapability.Implementation],
      inputSlots: [],
      outputContract: "findings_v1",
      instructionTemplate: `You are performing a **concurrency, state consistency, and recovery-path** review of the target codebase.

## Review Scope
- Examine all state management: locks, transactions, CAS operations, recovery services, queue drains.
- For each file, identify: race conditions, missing atomicity, incorrect recovery assumptions, stale state handling.

## Output Format (findings_v1)
Return a JSON envelope with this exact structure:
{
  "node_key": "review_concurrency",
  "findings": [
    {
      "severity": "high|medium|low",
      "file": "relative/path/to/file.ts",
      "line": 123,
      "claim": "One-sentence defect statement",
      "failure_scenario": "Concrete input/state → incorrect result"
    }
  ],
  "not_reviewed": ["honest-scope-declaration"]
}`,
    },
    {
      key: "review_contract",
      requiredCapabilities: [AgentCapability.Implementation],
      inputSlots: [],
      outputContract: "findings_v1",
      instructionTemplate: `You are performing a **contract, boundary validation, and error semantics** review of the target codebase.

## Review Scope
- Examine API contracts, input validation, error codes, error messages, boundary conditions.
- For each file, identify: missing validation, incorrect error codes, schema mismatches, null/undefined handling gaps.

## Output Format (findings_v1)
Return a JSON envelope with this exact structure:
{
  "node_key": "review_contract",
  "findings": [
    {
      "severity": "high|medium|low",
      "file": "relative/path/to/file.ts",
      "line": 123,
      "claim": "One-sentence defect statement",
      "failure_scenario": "Concrete input/state → incorrect result"
    }
  ],
  "not_reviewed": ["honest-scope-declaration"]
}`,
    },
    {
      key: "synthesize_findings",
      requiredCapabilities: [AgentCapability.Implementation],
      inputSlots: ["review_concurrency", "review_contract"],
      outputContract: "synthesis_v1",
      instructionTemplate: `You are performing **finding synthesis** — merging and deduplicating code review findings from two independent reviewers.

## Your Inputs
You will receive findings from:
- **review_concurrency** (concurrency, state consistency, recovery paths)
- **review_contract** (contracts, boundary validation, error semantics)

## Tasks
1. Merge findings that describe the same defect -- pick the better description.
2. Deduplicate identical findings -- note duplicates_merged count.
3. Cross-reference: if one reviewer found a defect the other missed, flag it.
4. Produce a unified report with source attribution.

## Output Format (synthesis_v1)
Return a JSON envelope with this exact structure:
{
  "node_key": "synthesize_findings",
  "findings": [
    {
      "severity": "high|medium|low",
      "file": "relative/path/to/file.ts",
      "line": 123,
      "claim": "One-sentence defect statement",
      "failure_scenario": "Concrete input/state → incorrect result",
      "source_nodes": ["review_concurrency", "review_contract"]
    }
  ],
  "duplicates_merged": 0,
  "not_reviewed": ["honest-scope-declaration"]
}`,
    },
  ],
  edges: [
    {
      from: "review_concurrency",
      to: "synthesize_findings",
      acceptedOutcomes: [NodeRunStatus.Completed],
      required: true,
      joinGroup: "all_required",
      inputSlot: "review_concurrency",
    },
    {
      from: "review_contract",
      to: "synthesize_findings",
      acceptedOutcomes: [NodeRunStatus.Completed],
      required: true,
      joinGroup: "all_required",
      inputSlot: "review_contract",
    },
  ],
};

const REGISTRY = new Map<string, GraphDefinitionV1>();

function registryKey(id: string, version: number): string {
  return `${id}@v${version}`;
}

REGISTRY.set(registryKey(WGD_CODING_DUAL_REVIEW_V1.id, WGD_CODING_DUAL_REVIEW_V1.version), WGD_CODING_DUAL_REVIEW_V1);

export function getDefinition(id: string, version: number): GraphDefinitionV1 | null {
  return REGISTRY.get(registryKey(id, version)) ?? null;
}

export { WGD_CODING_DUAL_REVIEW_V1 };
