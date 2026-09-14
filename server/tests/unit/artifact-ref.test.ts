import { describe, it, expect } from "vitest";
import { buildEvidenceRef, parseEvidenceRef, resolveForRead, resolveForDispatch } from "../../src/evidence-ref.js";

// F010 T003: the `artifact` ref kind with its optional `@revision` segment.
// The wire contract (design §4): `artifact:<id>@<revision>` for definite
// revisions, `artifact:<id>` for interactive current reads. The parser never
// throws — malformed input lands on `unknown` with the raw post-colon payload
// preserved for diagnostics.

describe("F010 artifact ref wire format", () => {
  describe("parseEvidenceRef", () => {
    it("parses a floating artifact ref as current (no revision)", () => {
      expect(parseEvidenceRef("artifact:art_123")).toEqual({ kind: "artifact", id: "art_123" });
      expect(parseEvidenceRef("artifact:art_123").revision).toBeUndefined();
    });

    it("parses a definite-revision artifact ref", () => {
      expect(parseEvidenceRef("artifact:art_123@7")).toEqual({ kind: "artifact", id: "art_123", revision: 7 });
    });

    it("keeps unknown results non-throwing with the raw payload", () => {
      const cases: Array<[string, string]> = [
        ["artifact:", ""], // empty id
        ["artifact:@3", "@3"], // empty id with revision
        ["artifact:art_1@0", "art_1@0"], // zero is not a positive integer
        ["artifact:art_1@-2", "art_1@-2"],
        ["artifact:art_1@abc", "art_1@abc"],
        ["artifact:art_1@1.5", "art_1@1.5"],
        ["artifact:art_1@1@2", "art_1@1@2"], // repeated @
        ["artifact:art_1@", "art_1@"],
        ["artifact:art_1@007", "art_1@007"], // leading zero is not canonical
        ["artifact:art_1@9007199254740993", "art_1@9007199254740993"], // beyond MAX_SAFE_INTEGER
      ];
      for (const [input, expectedPayload] of cases) {
        const parsed = parseEvidenceRef(input);
        expect(parsed.kind).toBe("unknown");
        expect(parsed.id).toBe(expectedPayload);
      }
    });

    it("accepts revision 1 and multi-digit revisions", () => {
      expect(parseEvidenceRef("artifact:a@1")).toEqual({ kind: "artifact", id: "a", revision: 1 });
      expect(parseEvidenceRef("artifact:a@12")).toEqual({ kind: "artifact", id: "a", revision: 12 });
    });

    it("never aliases a leading-zero revision onto its canonical value", () => {
      expect(parseEvidenceRef("artifact:x@007").kind).toBe("unknown");
      expect(parseEvidenceRef("artifact:x@7")).toEqual({ kind: "artifact", id: "x", revision: 7 });
      expect(resolveForDispatch(parseEvidenceRef("artifact:x@007"))).toEqual({ ok: false, reason: "not_artifact" });
      expect(parseEvidenceRef("artifact:x@9007199254740993").kind).toBe("unknown");
    });

    it("leaves non-artifact kinds untouched, including ids containing @", () => {
      expect(parseEvidenceRef("event:evt_1@2")).toEqual({ kind: "event", id: "evt_1@2" });
      expect(parseEvidenceRef("file-change-set:run_1")).toEqual({ kind: "file_change_set", id: "run_1" });
    });
  });

  describe("buildEvidenceRef", () => {
    it("builds the floating and pinned wire forms", () => {
      expect(buildEvidenceRef("artifact", "art_1")).toBe("artifact:art_1");
      expect(buildEvidenceRef("artifact", "art_1", 3)).toBe("artifact:art_1@3");
    });

    it("round-trips through the parser", () => {
      expect(parseEvidenceRef(buildEvidenceRef("artifact", "art_1", 5))).toEqual({
        kind: "artifact",
        id: "art_1",
        revision: 5,
      });
      expect(parseEvidenceRef(buildEvidenceRef("artifact", "art_1"))).toEqual({ kind: "artifact", id: "art_1" });
    });

    it("throws on a non-positive-integer revision (caller bug, not agent input)", () => {
      expect(() => buildEvidenceRef("artifact", "art_1", 0)).toThrow(/positive integer/);
      expect(() => buildEvidenceRef("artifact", "art_1", 1.5)).toThrow(/positive integer/);
    });
  });

  describe("resolveForRead", () => {
    it("allows a floating ref and reads current", () => {
      expect(resolveForRead(parseEvidenceRef("artifact:art_1"))).toEqual({
        ok: true,
        artifactId: "art_1",
        revision: null,
      });
    });

    it("passes a pinned revision through", () => {
      expect(resolveForRead(parseEvidenceRef("artifact:art_1@4"))).toEqual({
        ok: true,
        artifactId: "art_1",
        revision: 4,
      });
    });

    it("rejects non-artifact and unknown kinds", () => {
      expect(resolveForRead(parseEvidenceRef("event:evt_1"))).toEqual({ ok: false, reason: "not_artifact" });
      expect(resolveForRead(parseEvidenceRef("artifact:art_1@0"))).toEqual({ ok: false, reason: "not_artifact" });
      expect(resolveForRead(parseEvidenceRef("garbage"))).toEqual({ ok: false, reason: "not_artifact" });
    });
  });

  describe("resolveForDispatch", () => {
    it("accepts only pinned artifact refs", () => {
      expect(resolveForDispatch(parseEvidenceRef("artifact:art_1@4"))).toEqual({
        ok: true,
        artifactId: "art_1",
        revision: 4,
      });
    });

    it("rejects floating refs so no drifting snapshot enters a Dispatch", () => {
      expect(resolveForDispatch(parseEvidenceRef("artifact:art_1"))).toEqual({ ok: false, reason: "missing_revision" });
    });

    it("rejects unknown and non-artifact kinds", () => {
      expect(resolveForDispatch(parseEvidenceRef("event:evt_1"))).toEqual({ ok: false, reason: "not_artifact" });
      expect(resolveForDispatch(parseEvidenceRef("artifact:art_1@x"))).toEqual({ ok: false, reason: "not_artifact" });
    });
  });
});
