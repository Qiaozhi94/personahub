import { ulid } from "ulid";

export function generateProjectId(): string {
  return `prj_${ulid()}`;
}

export function generateWorkspaceId(): string {
  return `wsp_${ulid()}`;
}

export function generateIssueId(): string {
  return `iss_${ulid()}`;
}

export function generateThreadId(): string {
  return `thr_${ulid()}`;
}

export function generateEventId(): string {
  return `evt_${ulid()}`;
}

export function generateRunId(): string {
  return `run_${ulid()}`;
}

export function generateAdapterConfigId(): string {
  return `adp_${ulid()}`;
}

export function generateFileChangeId(): string {
  return `fcg_${ulid()}`;
}

export function generateEvidenceSummaryId(): string {
  return `evs_${ulid()}`;
}
