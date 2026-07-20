import { describe, it, expect } from "vitest";
import { buildOpenCodeApiKeyAuthMaterial } from "../../src/runtime/auth-material.js";

// T029: AuthMaterial — env-only injection for OpenCode API-key auth, per the
// confirmed Phase 1 probe (server/tests/helpers/opencode-protocol-fixtures.md
// T007): setting the mapped <PROVIDER>_API_KEY env var is sufficient, no temp
// config file is needed for the providers verified so far.

const HIGHLY_IDENTIFIABLE_SECRET = "sk-T029-CANARY-4b8e21f7ac0d9531b6e2";

describe("buildOpenCodeApiKeyAuthMaterial() (T029)", () => {
  it("maps a known model_provider to its confirmed env var, holding only that one variable", () => {
    const material = buildOpenCodeApiKeyAuthMaterial("openai", HIGHLY_IDENTIFIABLE_SECRET);

    expect(material.env).toEqual({ OPENAI_API_KEY: HIGHLY_IDENTIFIABLE_SECRET });
    expect(Object.keys(material.env)).toHaveLength(1);
  });

  it("maps each confirmed provider to its own distinct env var (T007 allowlist)", () => {
    expect(buildOpenCodeApiKeyAuthMaterial("anthropic", "k").env).toEqual({ ANTHROPIC_API_KEY: "k" });
    expect(buildOpenCodeApiKeyAuthMaterial("deepseek", "k").env).toEqual({ DEEPSEEK_API_KEY: "k" });
    expect(buildOpenCodeApiKeyAuthMaterial("google", "k").env).toEqual({ GEMINI_API_KEY: "k" });
    expect(buildOpenCodeApiKeyAuthMaterial("openrouter", "k").env).toEqual({ OPENROUTER_API_KEY: "k" });
    expect(buildOpenCodeApiKeyAuthMaterial("groq", "k").env).toEqual({ GROQ_API_KEY: "k" });
    expect(buildOpenCodeApiKeyAuthMaterial("mistral", "k").env).toEqual({ MISTRAL_API_KEY: "k" });
    expect(buildOpenCodeApiKeyAuthMaterial("xai", "k").env).toEqual({ XAI_API_KEY: "k" });
    expect(buildOpenCodeApiKeyAuthMaterial("togetherai", "k").env).toEqual({ TOGETHER_API_KEY: "k" });
    expect(buildOpenCodeApiKeyAuthMaterial("perplexity", "k").env).toEqual({ PERPLEXITY_API_KEY: "k" });
  });

  it("rejects an unknown/unverified model_provider rather than guessing an env var name", () => {
    expect(() => buildOpenCodeApiKeyAuthMaterial("totally-made-up-provider", "k")).toThrow(/unknown|unsupported/i);
  });

  it("rejects an empty api_key", () => {
    expect(() => buildOpenCodeApiKeyAuthMaterial("openai", "")).toThrow();
    expect(() => buildOpenCodeApiKeyAuthMaterial("openai", "   ")).toThrow();
  });

  it("cleanup() resolves without side effects — no temp files are created for env-only material", async () => {
    const material = buildOpenCodeApiKeyAuthMaterial("openai", HIGHLY_IDENTIFIABLE_SECRET);
    await expect(material.cleanup()).resolves.toBeUndefined();
  });

  it("cleanup() is safe to call multiple times (idempotent)", async () => {
    const material = buildOpenCodeApiKeyAuthMaterial("openai", HIGHLY_IDENTIFIABLE_SECRET);
    await material.cleanup();
    await expect(material.cleanup()).resolves.toBeUndefined();
  });

  it("cleanup() still resolves even if an unrelated exception occurred after material was built (exception-safety)", async () => {
    const material = buildOpenCodeApiKeyAuthMaterial("openai", HIGHLY_IDENTIFIABLE_SECRET);
    try {
      throw new Error("simulated spawn failure");
    } catch {
      // adapter's finally-block equivalent
    } finally {
      await expect(material.cleanup()).resolves.toBeUndefined();
    }
  });

  describe("the secret never leaks outside the env map", () => {
    it("does not appear in any other property of the returned object", () => {
      const material = buildOpenCodeApiKeyAuthMaterial("openai", HIGHLY_IDENTIFIABLE_SECRET);
      const { env, ...rest } = material;
      expect(JSON.stringify(rest)).not.toContain(HIGHLY_IDENTIFIABLE_SECRET);
    });
  });
});
