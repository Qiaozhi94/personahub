import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestServices, disposeTestServices, createTempDir, type TestServices } from "../helpers.js";
import {
  ThreadEventType,
  ActorType,
  RunStatus,
  AdapterStatus,
  FileChangeType,
  CommandTraceCapability,
} from "@personahub/shared/types";
import { parseEvidenceRef, EvidenceService } from "../../src/services/evidence.js";
import { buildEvidenceRef } from "../../src/evidence-ref.js";
import { AppError } from "../../src/api/errors.js";
import { ErrorCode } from "@personahub/shared/errors";

function setupIssueAndRun(services: TestServices, tempDir: string) {
  const project = services.projectService.create("Test", "desc");
  services.workspaceService.bind(project.id, tempDir);
  const { issue } = services.issueService.create(project.id, { title: "Test", goal: "Goal" });
  const adapter = services.agentConfigRepo.create({
    project_id: project.id, name: "Fake", role: "implementation", cli_provider: "fake",
    command: "fake", args: [], capability_tags: [], default_model: null, status: AdapterStatus.Available,
  });
  const run = services.runRepo.create({
    issue_id: issue.id, thread_id: issue.primary_thread_id!, workspace_id: issue.workspace_id,
    adapter_config_id: adapter.id, instructions: "test", status: RunStatus.Queued,
  });
  return { project, issue, adapter, run };
}

describe("Evidence Ref Parser/Resolver (T016)", () => {
  let services: TestServices;
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
    services = createTestServices();
  });
  afterEach(() => {
    disposeTestServices(services);
  });

  describe("parseEvidenceRef", () => {
    it("parses event ref", () => {
      const parsed = parseEvidenceRef("event:evt_123");
      expect(parsed.kind).toBe("event");
      expect(parsed.id).toBe("evt_123");
    });

    it("parses file-change-set ref", () => {
      const parsed = parseEvidenceRef("file-change-set:run_456");
      expect(parsed.kind).toBe("file_change_set");
      expect(parsed.id).toBe("run_456");
    });

    it("returns unknown for bare id", () => {
      const parsed = parseEvidenceRef("evt_123");
      expect(parsed.kind).toBe("unknown");
    });

    it("returns unknown for unrecognized prefix", () => {
      const parsed = parseEvidenceRef("artifact:art_789");
      expect(parsed.kind).toBe("unknown");
    });

    it("returns unknown for empty string", () => {
      const parsed = parseEvidenceRef("");
      expect(parsed.kind).toBe("unknown");
    });
  });

  // ADR 0014 P4: 构造侧收敛到 buildEvidenceRef 后，构造与解析必须是同一张前缀表的
  // 两个方向——任何一侧被单独改动都会让这些断言失败。
  describe("buildEvidenceRef", () => {
    it("builds the event wire form", () => {
      expect(buildEvidenceRef("event", "evt_123")).toBe("event:evt_123");
    });

    it("builds the file-change-set wire form", () => {
      expect(buildEvidenceRef("file_change_set", "run_456")).toBe("file-change-set:run_456");
    });

    it("round-trips every known kind through parseEvidenceRef", () => {
      for (const kind of ["event", "file_change_set"] as const) {
        const parsed = parseEvidenceRef(buildEvidenceRef(kind, "id_1"));
        expect(parsed).toEqual({ kind, id: "id_1" });
      }
    });

    it("keeps ids containing a colon intact through a round trip", () => {
      const parsed = parseEvidenceRef(buildEvidenceRef("event", "evt:with:colons"));
      expect(parsed).toEqual({ kind: "event", id: "evt:with:colons" });
    });
  });

  describe("EvidenceService.resolve", () => {
    it("resolves event ref to target metadata only", () => {
      const { issue, run } = setupIssueAndRun(services, tempDir);
      const event = services.threadEventRepo.create({
        thread_id: issue.primary_thread_id!, type: ThreadEventType.CommandStarted,
        actor_type: ActorType.System, actor_id: null,
        payload: { run_id: run.id }, evidence_refs: [],
      });

      const service = new EvidenceService(services.threadEventRepo, services.fileChangeRepo, services.runRepo, services.runTraceRepo);
      const results = service.resolve([`event:${event.id}`], {
        issueId: issue.id, threadId: issue.primary_thread_id!, runId: run.id,
      });

      expect(results).toHaveLength(1);
      expect(results[0].status).toBe("resolved");
      expect(results[0].target!.id).toBe(event.id);
      expect(results[0].target!.type).toBe(ThreadEventType.CommandStarted);
      expect(results[0].target!.run_id).toBe(run.id);
    });

    it("returns missing for nonexistent event", () => {
      const { issue, run } = setupIssueAndRun(services, tempDir);
      const service = new EvidenceService(services.threadEventRepo, services.fileChangeRepo, services.runRepo, services.runTraceRepo);
      const results = service.resolve(["event:nonexistent"], {
        issueId: issue.id, threadId: issue.primary_thread_id!, runId: run.id,
      });
      expect(results[0].status).toBe("missing");
    });

    it("resolves file-change-set ref", () => {
      const { issue, run } = setupIssueAndRun(services, tempDir);
      const now = new Date().toISOString();
      services.runTraceRepo.createPending(run.id, CommandTraceCapability.Supported, now);
      services.runTraceRepo.markFinalized(run.id, now);
      services.fileChangeRepo.replaceForRun(run.id, [
        { path: "a.ts", previous_path: null, change_type: FileChangeType.Added, before_fingerprint: null, after_fingerprint: "x" },
      ], now);

      const service = new EvidenceService(services.threadEventRepo, services.fileChangeRepo, services.runRepo, services.runTraceRepo);
      const results = service.resolve([`file-change-set:${run.id}`], {
        issueId: issue.id, runId: run.id,
      });
      expect(results[0].status).toBe("resolved");
      expect(results[0].run_id).toBe(run.id);
    });

    it("resolves file-change-set ref with zero changes", () => {
      const { issue, run } = setupIssueAndRun(services, tempDir);
      const now = new Date().toISOString();
      services.runTraceRepo.createPending(run.id, CommandTraceCapability.Supported, now);
      services.runTraceRepo.markFinalized(run.id, now);

      const service = new EvidenceService(services.threadEventRepo, services.fileChangeRepo, services.runRepo, services.runTraceRepo);
      const results = service.resolve([`file-change-set:${run.id}`], {
        issueId: issue.id, runId: run.id,
      });
      expect(results[0].status).toBe("resolved");
    });

    it("dedupes refs preserving first occurrence order", () => {
      const { issue, run } = setupIssueAndRun(services, tempDir);
      const event = services.threadEventRepo.create({
        thread_id: issue.primary_thread_id!, type: ThreadEventType.CommandStarted,
        actor_type: ActorType.System, actor_id: null,
        payload: { run_id: run.id }, evidence_refs: [],
      });

      const service = new EvidenceService(services.threadEventRepo, services.fileChangeRepo, services.runRepo, services.runTraceRepo);
      const results = service.resolve(
        [`event:${event.id}`, `event:${event.id}`],
        { issueId: issue.id, threadId: issue.primary_thread_id!, runId: run.id },
      );
      expect(results).toHaveLength(1);
    });

    it("rejects event ref from different thread", () => {
      const { issue, run } = setupIssueAndRun(services, tempDir);
      const event = services.threadEventRepo.create({
        thread_id: issue.primary_thread_id!, type: ThreadEventType.CommandStarted,
        actor_type: ActorType.System, actor_id: null,
        payload: { run_id: run.id }, evidence_refs: [],
      });

      const service = new EvidenceService(services.threadEventRepo, services.fileChangeRepo, services.runRepo, services.runTraceRepo);
      const results = service.resolve([`event:${event.id}`], {
        issueId: issue.id, threadId: "other-thread", runId: run.id,
      });
      expect(results[0].status).toBe("missing");
      expect(results[0].reason).toBe("scope_mismatch_thread");
    });

    it("returns missing for invalid ref grammar", () => {
      const { issue } = setupIssueAndRun(services, tempDir);
      const service = new EvidenceService(services.threadEventRepo, services.fileChangeRepo, services.runRepo, services.runTraceRepo);
      const results = service.resolve(["invalid-ref"], { issueId: issue.id });
      expect(results[0].status).toBe("missing");
    });
  });

  describe("EvidenceService.validateWriteScope", () => {
    it("throws EVIDENCE_REF_INVALID for invalid grammar", () => {
      const { issue } = setupIssueAndRun(services, tempDir);
      const service = new EvidenceService(services.threadEventRepo, services.fileChangeRepo, services.runRepo, services.runTraceRepo);
      expect(() =>
        service.validateWriteScope(["invalid-ref"], { issueId: issue.id }),
      ).toThrow(AppError);
    });

    it("throws EVIDENCE_REF_INVALID for nonexistent event target", () => {
      const { issue } = setupIssueAndRun(services, tempDir);
      const service = new EvidenceService(services.threadEventRepo, services.fileChangeRepo, services.runRepo, services.runTraceRepo);
      expect(() =>
        service.validateWriteScope(["event:nonexistent"], { issueId: issue.id, threadId: issue.primary_thread_id! }),
      ).toThrow(AppError);
    });

    it("throws EVIDENCE_SCOPE_MISMATCH for cross-thread ref", () => {
      const { issue, run } = setupIssueAndRun(services, tempDir);
      const event = services.threadEventRepo.create({
        thread_id: issue.primary_thread_id!, type: ThreadEventType.CommandStarted,
        actor_type: ActorType.System, actor_id: null,
        payload: { run_id: run.id }, evidence_refs: [],
      });

      const service = new EvidenceService(services.threadEventRepo, services.fileChangeRepo, services.runRepo, services.runTraceRepo);
      expect(() =>
        service.validateWriteScope([`event:${event.id}`], {
          issueId: issue.id, threadId: "other-thread",
        }),
      ).toThrow(AppError);
    });

    it("passes for valid same-scope ref", () => {
      const { issue, run } = setupIssueAndRun(services, tempDir);
      const event = services.threadEventRepo.create({
        thread_id: issue.primary_thread_id!, type: ThreadEventType.CommandStarted,
        actor_type: ActorType.System, actor_id: null,
        payload: { run_id: run.id }, evidence_refs: [],
      });

      const service = new EvidenceService(services.threadEventRepo, services.fileChangeRepo, services.runRepo, services.runTraceRepo);
      expect(() =>
        service.validateWriteScope([`event:${event.id}`], {
          issueId: issue.id, threadId: issue.primary_thread_id!, runId: run.id,
        }),
      ).not.toThrow();
    });
  });
});
