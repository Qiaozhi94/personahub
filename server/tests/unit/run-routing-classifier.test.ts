import { describe, it, expect } from "vitest";
import { classifyRunRequest } from "../../src/services/run-routing-classifier.js";
import { IssueStatus, RunPurpose, RunRole, AgentCapability } from "@personahub/shared/types";

// T051: design §7.2 matrix — pure classifier, no CLI/repo needed.

describe("classifyRunRequest (T051/T052) - expected role / purpose matrix", () => {
  describe("terminal statuses reject all Runs", () => {
    it("rejects Done regardless of purpose/capability", () => {
      expect(classifyRunRequest(IssueStatus.Done, undefined, [AgentCapability.Implementation])).toEqual({ allowed: false });
      expect(classifyRunRequest(IssueStatus.Done, RunPurpose.AdHocConsult, [])).toEqual({ allowed: false });
    });

    it("rejects Blocked regardless of purpose/capability", () => {
      expect(classifyRunRequest(IssueStatus.Blocked, undefined, [AgentCapability.Validator])).toEqual({ allowed: false });
      expect(classifyRunRequest(IssueStatus.Blocked, RunPurpose.AdHocConsult, [])).toEqual({ allowed: false });
    });
  });

  describe("explicit ad_hoc_consult always succeeds as consult on non-terminal status", () => {
    it.each([IssueStatus.Inbox, IssueStatus.Ready, IssueStatus.Running, IssueStatus.Validating])(
      "forces consult on %s regardless of capability_tags",
      (status) => {
        const result = classifyRunRequest(status, RunPurpose.AdHocConsult, []);
        expect(result).toEqual({ allowed: true, purpose: RunPurpose.AdHocConsult, role: RunRole.Consult });
      },
    );

    it("forces consult even when the adapter has the matching workflow capability", () => {
      const result = classifyRunRequest(IssueStatus.Running, RunPurpose.AdHocConsult, [AgentCapability.Implementation]);
      expect(result).toEqual({ allowed: true, purpose: RunPurpose.AdHocConsult, role: RunRole.Consult });
    });
  });

  describe("Inbox/Ready/Running expect implementation", () => {
    it.each([IssueStatus.Inbox, IssueStatus.Ready, IssueStatus.Running])(
      "workflow-bound implementation when adapter has Implementation capability on %s",
      (status) => {
        const result = classifyRunRequest(status, undefined, [AgentCapability.Implementation]);
        expect(result).toEqual({ allowed: true, purpose: RunPurpose.WorkflowBound, role: RunRole.Implementation });
      },
    );

    it("degrades to consult when adapter only has Validator capability", () => {
      const result = classifyRunRequest(IssueStatus.Running, undefined, [AgentCapability.Validator]);
      expect(result).toEqual({ allowed: true, purpose: RunPurpose.AdHocConsult, role: RunRole.Consult });
    });
  });

  describe("Validating expects validator", () => {
    it("workflow-bound validator when adapter has Validator capability", () => {
      const result = classifyRunRequest(IssueStatus.Validating, undefined, [AgentCapability.Validator]);
      expect(result).toEqual({ allowed: true, purpose: RunPurpose.WorkflowBound, role: RunRole.Validator });
    });

    it("an implementation-only adapter never accidentally advances validation — degrades to consult", () => {
      const result = classifyRunRequest(IssueStatus.Validating, undefined, [AgentCapability.Implementation]);
      expect(result).toEqual({ allowed: true, purpose: RunPurpose.AdHocConsult, role: RunRole.Consult });
    });
  });

  describe("multi-capability adapters", () => {
    it("an adapter with both capabilities gets whichever role the current status expects, not its own choice", () => {
      const both = [AgentCapability.Implementation, AgentCapability.Validator];
      expect(classifyRunRequest(IssueStatus.Running, undefined, both)).toEqual({ allowed: true, purpose: RunPurpose.WorkflowBound, role: RunRole.Implementation });
      expect(classifyRunRequest(IssueStatus.Validating, undefined, both)).toEqual({ allowed: true, purpose: RunPurpose.WorkflowBound, role: RunRole.Validator });
    });
  });

  describe("empty capability_tags", () => {
    it.each([IssueStatus.Inbox, IssueStatus.Ready, IssueStatus.Running, IssueStatus.Validating])(
      "always degrades to consult on %s, never misfires a workflow role",
      (status) => {
        const result = classifyRunRequest(status, undefined, []);
        expect(result).toEqual({ allowed: true, purpose: RunPurpose.AdHocConsult, role: RunRole.Consult });
      },
    );
  });

  describe("client cannot force workflow_bound", () => {
    it("an explicit workflow_bound request is treated identically to omitted/auto", () => {
      const explicit = classifyRunRequest(IssueStatus.Running, RunPurpose.WorkflowBound, [AgentCapability.Implementation]);
      const omitted = classifyRunRequest(IssueStatus.Running, undefined, [AgentCapability.Implementation]);
      expect(explicit).toEqual(omitted);
      expect(explicit).toEqual({ allowed: true, purpose: RunPurpose.WorkflowBound, role: RunRole.Implementation });
    });

    it("an explicit workflow_bound request from a non-matching adapter still degrades to consult (not forced)", () => {
      const result = classifyRunRequest(IssueStatus.Running, RunPurpose.WorkflowBound, [AgentCapability.Validator]);
      expect(result).toEqual({ allowed: true, purpose: RunPurpose.AdHocConsult, role: RunRole.Consult });
    });
  });
});
