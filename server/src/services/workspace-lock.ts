import type { WorkspaceLockState } from "@personahub/shared/types";
import type { WorkspaceRepository } from "../repositories/workspace.js";

export class WorkspaceLockService {
  constructor(private workspaceRepo: WorkspaceRepository) {}

  acquire(workspaceId: string, runId: string): boolean {
    return this.workspaceRepo.acquireLock(workspaceId, runId);
  }

  release(workspaceId: string): void {
    this.workspaceRepo.releaseLock(workspaceId);
  }

  releaseByRunId(runId: string): void {
    this.workspaceRepo.releaseLockByRunId(runId);
  }

  isLocked(workspaceId: string): boolean {
    const ws = this.workspaceRepo.getById(workspaceId);
    if (!ws) return false;
    return ws.lock_state === ("locked" as WorkspaceLockState);
  }
}
