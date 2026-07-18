import { describe, it, expect } from "vitest";
import { classifyVerificationCommand } from "../../src/runtime/trace/verification-classifier.js";
import { VerificationKind } from "@personahub/shared/types";

describe("Verification Classifier (T020)", () => {
  describe("test commands", () => {
    it.each([
      ["npm test", VerificationKind.Test],
      ["pnpm test", VerificationKind.Test],
      ["yarn test", VerificationKind.Test],
      ["bun test", VerificationKind.Test],
      ["npx vitest", VerificationKind.Test],
      ["npx jest", VerificationKind.Test],
      ["pytest", VerificationKind.Test],
      ["cargo test", VerificationKind.Test],
      ["go test", VerificationKind.Test],
      ["dotnet test", VerificationKind.Test],
      ["mvn test", VerificationKind.Test],
      ["gradle test", VerificationKind.Test],
      ["./gradlew test", VerificationKind.Test],
      ["./mvnw test", VerificationKind.Test],
    ])("classifies %s as test", (cmd, expected) => {
      expect(classifyVerificationCommand(cmd)).toBe(expected);
    });
  });

  describe("lint commands", () => {
    it.each([
      ["npm run lint", VerificationKind.Lint],
      ["pnpm lint", VerificationKind.Lint],
      ["eslint src/", VerificationKind.Lint],
      ["biome check", VerificationKind.Lint],
      ["ruff check .", VerificationKind.Lint],
    ])("classifies %s as lint", (cmd, expected) => {
      expect(classifyVerificationCommand(cmd)).toBe(expected);
    });
  });

  describe("typecheck commands", () => {
    it.each([
      ["npm run typecheck", VerificationKind.Typecheck],
      ["pnpm typecheck", VerificationKind.Typecheck],
      ["tsc --noEmit", VerificationKind.Typecheck],
      ["tsc", VerificationKind.Typecheck],
      ["mypy src/", VerificationKind.Typecheck],
      ["pyright", VerificationKind.Typecheck],
    ])("classifies %s as typecheck", (cmd, expected) => {
      expect(classifyVerificationCommand(cmd)).toBe(expected);
    });
  });

  describe("build commands", () => {
    it.each([
      ["npm run build", VerificationKind.Build],
      ["pnpm build", VerificationKind.Build],
      ["webpack", VerificationKind.Build],
      ["vite build", VerificationKind.Build],
      ["make", VerificationKind.Build],
    ])("classifies %s as build", (cmd, expected) => {
      expect(classifyVerificationCommand(cmd)).toBe(expected);
    });
  });

  describe("PowerShell/cmd wrappers", () => {
    it("handles powershell -Command wrapper", () => {
      expect(classifyVerificationCommand("powershell -Command npm test")).toBe(VerificationKind.Test);
    });
    it("handles pwsh -c wrapper", () => {
      expect(classifyVerificationCommand("pwsh -c npm test")).toBe(VerificationKind.Test);
    });
    it("handles cmd /c wrapper", () => {
      expect(classifyVerificationCommand("cmd /c npm test")).toBe(VerificationKind.Test);
    });
    it("handles & call operator", () => {
      expect(classifyVerificationCommand("& npm test")).toBe(VerificationKind.Test);
    });
  });

  describe("false positives", () => {
    it.each([
      ["echo npm test"],
      ["cat README.md"],
      ["ls -la"],
      ["git status"],
      ["node script.js"],
      ["python app.py"],
      ["rm -rf dist"],
      ["cd src && npm test"],
    ])("returns null for %s", (cmd) => {
      expect(classifyVerificationCommand(cmd)).toBeNull();
    });
  });

  describe("edge cases", () => {
    it("returns null for empty string", () => {
      expect(classifyVerificationCommand("")).toBeNull();
    });
    it("returns null for whitespace-only", () => {
      expect(classifyVerificationCommand("   ")).toBeNull();
    });
    it("handles quoted commands", () => {
      expect(classifyVerificationCommand('"npm" "test"')).toBe(VerificationKind.Test);
    });
    it("returns null for cargo build (not test subcommand)", () => {
      expect(classifyVerificationCommand("cargo build")).toBeNull();
    });
    it("returns null for go build (not test subcommand)", () => {
      expect(classifyVerificationCommand("go build")).toBeNull();
    });
  });
});
