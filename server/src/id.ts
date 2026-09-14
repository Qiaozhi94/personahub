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

// F008: workflow template admin
export function generateWorkflowTemplateId(): string {
  return `wft_${ulid()}`;
}

export function generateAdminAuditEventId(): string {
  return `aev_${ulid()}`;
}

// F013: Space / repository / skill
export function generateSpaceId(): string {
  return `spc_${ulid()}`;
}

export function generateRepositoryId(): string {
  return `rep_${ulid()}`;
}

export function generateSkillId(): string {
  return `skl_${ulid()}`;
}

// F012: session / dispatch / intervention
export function generateRoomId(): string {
  return `room_${ulid()}`;
}

export function generateDispatchId(): string {
  return `dsp_${ulid()}`;
}

export function generateAttemptId(): string {
  return `atm_${ulid()}`;
}

export function generateCapabilityEvidenceId(): string {
  return `cap_${ulid()}`;
}

export function generateOutboxEventId(): string {
  return `obx_${ulid()}`;
}
