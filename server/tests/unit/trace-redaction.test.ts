import { describe, it, expect } from "vitest";
import { redactTraceText, redactAndTruncate, redactCommand, redactSummary } from "../../src/runtime/trace/redaction.js";

describe("Trace Redaction (T018)", () => {
  it("redacts --token=value form", () => {
    const result = redactTraceText("npm test --token=sk-secret123");
    expect(result).toContain("[REDACTED]");
    expect(result).not.toContain("sk-secret123");
  });

  it("redacts --token value form", () => {
    const result = redactTraceText("npm test --token sk-secret123");
    expect(result).toContain("[REDACTED]");
    expect(result).not.toContain("sk-secret123");
  });

  it("redacts --api-key value", () => {
    const result = redactTraceText("deploy --api-key abc123secret");
    expect(result).toContain("[REDACTED]");
    expect(result).not.toContain("abc123secret");
  });

  it("redacts --password value", () => {
    const result = redactTraceText("login --password mypass123");
    expect(result).toContain("[REDACTED]");
    expect(result).not.toContain("mypass123");
  });

  it("redacts Bearer token", () => {
    const result = redactTraceText("curl -H 'Authorization: Bearer eyJhb.abc123.xyz'");
    expect(result).toContain("[REDACTED]");
    expect(result).not.toContain("eyJhb.abc123.xyz");
  });

  it("redacts credential URL", () => {
    const result = redactTraceText("git clone https://user:secretpass@github.com/repo.git");
    expect(result).toContain("[REDACTED]");
    expect(result).not.toContain("secretpass");
  });

  it("redacts GitHub token pattern", () => {
    const result = redactTraceText("export GITHUB_TOKEN=ghp_1234567890abcdefghijklmnopqrstuvwxyz1234");
    expect(result).toContain("[REDACTED]");
    expect(result).not.toContain("ghp_1234567890abcdefghijklmnopqrstuvwxyz1234");
  });

  it("redacts OpenAI API key pattern", () => {
    const result = redactTraceText("export OPENAI_API_KEY=sk-proj1234567890abcdefghijklm");
    expect(result).toContain("[REDACTED]");
  });

  it("preserves Unicode content", () => {
    const result = redactTraceText("echo '你好世界 café'");
    expect(result).toContain("你好世界");
    expect(result).toContain("café");
  });

  it("handles empty string", () => {
    const result = redactTraceText("");
    expect(result).toBe("");
  });

  it("truncates long text and marks truncated", () => {
    const long = "x".repeat(10_000);
    const { text, truncated } = redactAndTruncate(long, 100);
    expect(truncated).toBe(true);
    expect(Buffer.byteLength(text, "utf8")).toBeLessThanOrEqual(100);
  });

  it("does not truncate short text", () => {
    const { text, truncated } = redactAndTruncate("short", 100);
    expect(truncated).toBe(false);
    expect(text).toBe("short");
  });

  it("redactCommand respects command max bytes", () => {
    const long = "npm test " + "x".repeat(10_000);
    const { text, truncated } = redactCommand(long);
    expect(truncated).toBe(true);
    expect(Buffer.byteLength(text, "utf8")).toBeLessThanOrEqual(8192);
  });

  it("redactSummary respects summary max bytes", () => {
    const long = "x".repeat(5000);
    const { text, truncated } = redactSummary(long);
    expect(truncated).toBe(true);
    expect(Buffer.byteLength(text, "utf8")).toBeLessThanOrEqual(2048);
  });

  it("redaction does not modify safe command", () => {
    const result = redactTraceText("npm test");
    expect(result).toBe("npm test");
  });

  it("handles redaction failure gracefully", () => {
    const result = redactTraceText(null as unknown as string);
    expect(result).toBe("[REDACTION_FAILED]");
  });
});
