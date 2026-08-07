import type { GraphDefinitionV1, GraphNodeV1 } from "./types.js";
import type { GraphRun } from "@personahub/shared/types";

export interface InstructionBuilderInput {
  node: GraphNodeV1;
  definition: GraphDefinitionV1;
  graphRun: GraphRun;
  inputPayloads?: Record<string, string>;
  truncationNote?: string;
}

const OUTPUT_CONTRACT_SCHEMAS: Record<string, string> = {
  findings_v1: `{
  "node_key": "<your node key>",
  "findings": [{ "severity": "high|medium|low", "file": "...", "line": 123, "claim": "...", "failure_scenario": "..." }],
  "not_reviewed": ["..."]
}`,
  synthesis_v1: `{
  "node_key": "synthesize_findings",
  "findings": [{ "severity": "high|medium|low", "file": "...", "line": 123, "claim": "...", "failure_scenario": "...", "source_nodes": ["..."] }],
  "duplicates_merged": 0,
  "not_reviewed": ["..."]
}`,
};

export class GraphNodeInstructionBuilder {
  build(input: InstructionBuilderInput): string {
    const sections: string[] = [];

    sections.push(`## Node: ${input.node.key}`);
    sections.push("");
    sections.push(input.node.instructionTemplate);

    sections.push("");
    sections.push("## Target Files");
    if (input.graphRun.target_files.length === 0) {
      sections.push("(no target files — graph was created with an empty file set)");
    } else {
      sections.push(`The following ${input.graphRun.target_files.length} file(s) are in scope:`);
      sections.push("```");
      for (const f of input.graphRun.target_files) {
        sections.push(f);
      }
      sections.push("```");
    }
    if (input.graphRun.target_files_truncated) {
      sections.push(`Note: ${input.graphRun.target_files_dropped_count} file(s) were dropped due to the 500-file / 64 KB limit.`);
    }

    if (input.inputPayloads && Object.keys(input.inputPayloads).length > 0) {
      sections.push("");
      sections.push("## Input from Upstream Nodes");
      for (const [slot, payload] of Object.entries(input.inputPayloads)) {
        sections.push(`### ${slot}`);
        sections.push("```json");
        sections.push(payload);
        sections.push("```");
      }
    }

    if (input.truncationNote) {
      sections.push("");
      sections.push("## Truncation");
      sections.push(input.truncationNote);
    }

    sections.push("");
    sections.push("## Required Output Contract");
    sections.push(`You MUST return a valid JSON object matching the \`${input.node.outputContract}\` schema:`);
    sections.push("```json");
    sections.push(OUTPUT_CONTRACT_SCHEMAS[input.node.outputContract] ?? "(unknown contract)");
    sections.push("```");
    sections.push("Return ONLY this JSON object as your final message. No markdown, no explanation.");

    return sections.join("\n");
  }
}
