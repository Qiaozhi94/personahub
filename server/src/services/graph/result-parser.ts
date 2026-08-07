import type { NodeRunStatus, GraphBlockReason } from "@personahub/shared/types";
import { NodeRunStatus as NRS, GraphBlockReason as GBR } from "@personahub/shared/types";

export interface FindingV1 {
  severity: "high" | "medium" | "low";
  file: string;
  line: number;
  claim: string;
  failure_scenario: string;
  source_nodes?: string[];
}

export interface ParsedResultV1 {
  node_key: string;
  findings: FindingV1[];
  not_reviewed: string[];
  duplicates_merged?: number;
  truncated?: boolean;
  dropped_count?: number;
}

export interface EnvelopeParseSuccess {
  status: "ok";
  nodeStatus: NodeRunStatus;
  payload: ParsedResultV1;
}

export interface EnvelopeParseFailure {
  status: "failed";
  nodeStatus: NodeRunStatus;
  blockReason: GraphBlockReason;
}

export type EnvelopeParseResult = EnvelopeParseSuccess | EnvelopeParseFailure;

const MAX_FINDINGS = 200;
const MAX_FIELD_CHARS = 2000;
const MAX_NOT_REVIEWED_CHARS = 1000;
const MAX_NOT_REVIEWED = 100;
const MAX_PAYLOAD_BYTES = 256 * 1024;

function truncateField(s: unknown): string | null {
  if (typeof s !== "string") return null;
  if (s.length <= MAX_FIELD_CHARS) return s;
  return null;
}

function isValidFinding(f: unknown): f is FindingV1 {
  if (typeof f !== "object" || f === null) return false;
  const finding = f as Record<string, unknown>;
  return (
    typeof finding.severity === "string" &&
    ["high", "medium", "low"].includes(finding.severity) &&
    typeof finding.file === "string" &&
    typeof finding.line === "number" &&
    Number.isSafeInteger(finding.line) &&
    finding.line >= 1 &&
    typeof finding.claim === "string" &&
    typeof finding.failure_scenario === "string"
  );
}

export function parseNodeResult(
  finalMessage: string | null,
  nodeKey: string,
): EnvelopeParseResult {
  if (!finalMessage) {
    return { status: "failed", nodeStatus: NRS.Failed, blockReason: GBR.ResultUnparsable };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(finalMessage.trim());
  } catch {
    return { status: "failed", nodeStatus: NRS.Failed, blockReason: GBR.ResultUnparsable };
  }

  if (typeof parsed !== "object" || parsed === null) {
    return { status: "failed", nodeStatus: NRS.Failed, blockReason: GBR.ResultUnparsable };
  }

  const obj = parsed as Record<string, unknown>;

  const resultNodeKey = obj.node_key;
  if (typeof resultNodeKey !== "string" || resultNodeKey !== nodeKey) {
    return { status: "failed", nodeStatus: NRS.Failed, blockReason: GBR.ResultUnparsable };
  }

  const rawFindings = obj.findings;
  if (!Array.isArray(rawFindings)) {
    return { status: "failed", nodeStatus: NRS.Failed, blockReason: GBR.ResultUnparsable };
  }

  const rawNotReviewed = obj.not_reviewed;
  if (rawNotReviewed !== undefined && !Array.isArray(rawNotReviewed)) {
    return { status: "failed", nodeStatus: NRS.Failed, blockReason: GBR.ResultUnparsable };
  }

  const findings: FindingV1[] = [];

  for (const f of rawFindings) {
    if (!isValidFinding(f)) continue;

    const claim = truncateField(f.claim);
    const failureScenario = truncateField(f.failure_scenario);
    const file = truncateField(f.file);
    const severity = truncateField(f.severity);

    if (!claim || !failureScenario || !file || !severity) {
      continue;
    }

    findings.push({
      severity: f.severity as "high" | "medium" | "low",
      file,
      line: f.line,
      claim,
      failure_scenario: failureScenario,
      source_nodes: Array.isArray(f.source_nodes)
        ? f.source_nodes.filter((s): s is string => typeof s === "string")
        : undefined,
    });
  }

  const notReviewedRaw = Array.isArray(rawNotReviewed) ? rawNotReviewed : [];
  const notReviewed: string[] = [];

  for (const item of notReviewedRaw.slice(0, MAX_NOT_REVIEWED)) {
    if (typeof item !== "string") {
      continue;
    }
    const trimmed = typeof item === "string" && item.length <= MAX_NOT_REVIEWED_CHARS ? item : null;
    if (!trimmed) continue;
    notReviewed.push(trimmed);
  }

  const findingsBeforeSlice = findings.length;
  const notReviewedBeforeSlice = notReviewed.length;

  const finalFindings = findings.slice(0, MAX_FINDINGS);
  const finalNotReviewed = notReviewed.slice(0, MAX_NOT_REVIEWED);

  const totalDropped =
    Math.max(0, rawFindings.length - findingsBeforeSlice) + Math.max(0, findingsBeforeSlice - finalFindings.length) +
    Math.max(0, notReviewedRaw.length - notReviewedBeforeSlice) + Math.max(0, notReviewedBeforeSlice - finalNotReviewed.length);
  const truncated = totalDropped > 0;

  const payload: ParsedResultV1 = {
    node_key: nodeKey,
    findings: finalFindings,
    not_reviewed: finalNotReviewed,
    duplicates_merged: typeof obj.duplicates_merged === "number" ? obj.duplicates_merged : undefined,
    truncated,
    dropped_count: totalDropped,
  };

  const payloadJson = JSON.stringify(payload);
  if (Buffer.byteLength(payloadJson, "utf-8") > MAX_PAYLOAD_BYTES) {
    while (
      (payload.findings.length > 0 || payload.not_reviewed.length > 0) &&
      Buffer.byteLength(JSON.stringify(payload), "utf-8") > MAX_PAYLOAD_BYTES
    ) {
      if (payload.not_reviewed.length > 0) {
        payload.not_reviewed.pop();
        payload.dropped_count = (payload.dropped_count ?? 0) + 1;
      } else if (payload.findings.length > 0) {
        payload.findings.pop();
        payload.dropped_count = (payload.dropped_count ?? 0) + 1;
      } else {
        break;
      }
      payload.truncated = true;
    }

    if (Buffer.byteLength(JSON.stringify(payload), "utf-8") > MAX_PAYLOAD_BYTES) {
      return { status: "failed", nodeStatus: NRS.Failed, blockReason: GBR.ResultTooLarge };
    }
  }

  return { status: "ok", nodeStatus: NRS.Completed, payload };
}
