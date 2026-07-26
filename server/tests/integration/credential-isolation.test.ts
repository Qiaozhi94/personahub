import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { buildChildEnv } from "../../src/runtime/workspace-context.js";

describe("Windows Credential Isolation Verification (T062)", () => {
  it("subprocess does not inherit SSH_AUTH_SOCK when push_credentials_enabled=false", () => {
    const env = buildChildEnv({ push_credentials_enabled: false, local_path: "/fake/workspace" });

    const result = spawnSync(process.execPath, ["-e", "console.log(JSON.stringify(process.env))"], {
      env: { ...env, PATH: process.env.PATH ?? "" },
      encoding: "utf-8",
      timeout: 5000,
    });

    expect(result.status).toBe(0);
    const childEnv = JSON.parse(result.stdout.trim()) as Record<string, string>;
    expect(childEnv.SSH_AUTH_SOCK).toBeUndefined();
    expect(childEnv.SSH_AGENT_PID).toBeUndefined();
    expect(childEnv.GIT_ASKPASS).toBe("");
    expect(childEnv.GIT_TERMINAL_PROMPT).toBe("0");
  });

  it("subprocess HOME is not the user's real home when push_credentials_enabled=false", () => {
    const env = buildChildEnv({ push_credentials_enabled: false, local_path: "/fake/workspace" });

    const result = spawnSync(process.execPath, ["-e", "console.log(process.env.HOME)"], {
      env: { ...env, PATH: process.env.PATH ?? "" },
      encoding: "utf-8",
      timeout: 5000,
    });

    expect(result.status).toBe(0);
    const childHome = result.stdout.trim();
    expect(childHome).toBe("/fake/workspace");
    expect(childHome).not.toBe(process.env.HOME);
  });

  it("subprocess inherits real environment when push_credentials_enabled=true", () => {
    const env = buildChildEnv({ push_credentials_enabled: true, local_path: "/fake/workspace" });

    const result = spawnSync(process.execPath, ["-e", "console.log(process.env.HOME)"], {
      env,
      encoding: "utf-8",
      timeout: 5000,
    });

    expect(result.status).toBe(0);
    const childHome = result.stdout.trim();
    expect(childHome).toBe(process.env.HOME);
  });

  it("subprocess does not have GH_TOKEN when process.env has it and push_credentials_enabled=false", () => {
    const originalToken = process.env.GH_TOKEN;
    process.env.GH_TOKEN = "secret-token";

    const env = buildChildEnv({ push_credentials_enabled: false, local_path: "/fake/workspace" });

    process.env.GH_TOKEN = originalToken;

    expect(env.GH_TOKEN).toBeUndefined();
    expect(env.GITHUB_TOKEN).toBeUndefined();
    expect(env.GITLAB_TOKEN).toBeUndefined();
  });

  // Review-report regression: an isolated Run for ANY provider (Codex,
  // Claude, or OpenCode) used to still inherit every OTHER model provider's
  // API key from the operator's own shell env — only Git/SSH credentials
  // were stripped. A canary key per known OPENCODE_MODEL_PROVIDER_ENV entry
  // proves none of them leak through, regardless of which provider a Run
  // actually needs (auth-material.ts injects the one legitimate key back
  // separately, on top of this already-clean env).
  it("subprocess does not inherit other model providers' API keys when push_credentials_enabled=false", () => {
    const canaryKeys = {
      OPENAI_API_KEY: "sk-canary-openai",
      ANTHROPIC_API_KEY: "sk-canary-anthropic",
      DEEPSEEK_API_KEY: "canary-deepseek",
      GEMINI_API_KEY: "canary-gemini",
      OPENROUTER_API_KEY: "canary-openrouter",
      GROQ_API_KEY: "canary-groq",
      MISTRAL_API_KEY: "canary-mistral",
      XAI_API_KEY: "canary-xai",
      TOGETHER_API_KEY: "canary-together",
      PERPLEXITY_API_KEY: "canary-perplexity",
    };
    const originals: Record<string, string | undefined> = {};
    for (const [key, value] of Object.entries(canaryKeys)) {
      originals[key] = process.env[key];
      process.env[key] = value;
    }

    const env = buildChildEnv({ push_credentials_enabled: false, local_path: "/fake/workspace" });

    for (const [key, original] of Object.entries(originals)) {
      if (original === undefined) delete process.env[key];
      else process.env[key] = original;
    }

    for (const key of Object.keys(canaryKeys)) {
      expect(env[key]).toBeUndefined();
    }
  });

  it("subprocess DOES inherit model provider API keys when push_credentials_enabled=true (no isolation requested)", () => {
    const originalKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "sk-real-key";

    const env = buildChildEnv({ push_credentials_enabled: true, local_path: "/fake/workspace" });

    process.env.OPENAI_API_KEY = originalKey;

    expect(env.OPENAI_API_KEY).toBe("sk-real-key");
  });

  // final-recheck-report regression: the OPENCODE_MODEL_PROVIDER_ENV
  // denylist only covered the 10 F005-supported model-provider keys —
  // common cloud-platform credentials (AWS/Azure/GCP/HF/...) that happen to
  // be set in the operator's shell still leaked through, even though a
  // shell-capable agent Run can read and exfiltrate any of them.
  it("subprocess does not inherit common cloud-platform credentials when push_credentials_enabled=false", () => {
    const canaryKeys = {
      AWS_ACCESS_KEY_ID: "canary-aws-key-id",
      AWS_SECRET_ACCESS_KEY: "canary-aws-secret",
      AWS_SESSION_TOKEN: "canary-aws-session",
      AZURE_CLIENT_SECRET: "canary-azure-secret",
      AZURE_OPENAI_API_KEY: "canary-azure-openai",
      GOOGLE_APPLICATION_CREDENTIALS: "/fake/canary-gcp-creds.json",
      HF_TOKEN: "canary-hf-token",
      NPM_TOKEN: "canary-npm-token",
    };
    const originals: Record<string, string | undefined> = {};
    for (const [key, value] of Object.entries(canaryKeys)) {
      originals[key] = process.env[key];
      process.env[key] = value;
    }

    const env = buildChildEnv({ push_credentials_enabled: false, local_path: "/fake/workspace" });

    for (const [key, original] of Object.entries(originals)) {
      if (original === undefined) delete process.env[key];
      else process.env[key] = original;
    }

    for (const key of Object.keys(canaryKeys)) {
      expect(env[key]).toBeUndefined();
    }
  });

  it("is case-insensitive when stripping model-provider/cloud credentials (Windows env vars are case-insensitive)", () => {
    const original = process.env.openai_api_key;
    process.env.openai_api_key = "sk-lowercase-canary";

    const env = buildChildEnv({ push_credentials_enabled: false, local_path: "/fake/workspace" });

    process.env.openai_api_key = original;

    expect(env.openai_api_key).toBeUndefined();
  });

  // final-recheck-report-2 regression: buildChildEnv() was a denylist
  // (copy everything except known-bad names), which can never enumerate
  // every possible secret env var — SENTRY_AUTH_TOKEN, DATABASE_URL, a
  // company's own custom *_TOKEN, etc. all leaked through. It's now an
  // allowlist (only explicitly-safe infra names survive), so an arbitrary,
  // never-named-anywhere secret is excluded by construction, not because
  // someone remembered to list it.
  it("does not inherit an arbitrary secret-shaped env var that isn't on any denylist (proves allowlist, not denylist)", () => {
    const originals = {
      PERSONAHUB_TEST_SECRET: process.env.PERSONAHUB_TEST_SECRET,
      SENTRY_AUTH_TOKEN: process.env.SENTRY_AUTH_TOKEN,
      DATABASE_URL: process.env.DATABASE_URL,
      SOME_COMPANYS_INTERNAL_API_TOKEN: process.env.SOME_COMPANYS_INTERNAL_API_TOKEN,
    };
    process.env.PERSONAHUB_TEST_SECRET = "canary-arbitrary-secret";
    process.env.SENTRY_AUTH_TOKEN = "canary-sentry";
    process.env.DATABASE_URL = "postgres://canary:canary@host/db";
    process.env.SOME_COMPANYS_INTERNAL_API_TOKEN = "canary-internal";

    const env = buildChildEnv({ push_credentials_enabled: false, local_path: "/fake/workspace" });

    for (const [key, original] of Object.entries(originals)) {
      if (original === undefined) delete process.env[key];
      else process.env[key] = original;
    }

    expect(env.PERSONAHUB_TEST_SECRET).toBeUndefined();
    expect(env.SENTRY_AUTH_TOKEN).toBeUndefined();
    expect(env.DATABASE_URL).toBeUndefined();
    expect(env.SOME_COMPANYS_INTERNAL_API_TOKEN).toBeUndefined();
  });

  it("still passes through the non-secret infra vars a CLI actually needs to run (PATH, proxy config)", () => {
    const originalProxy = process.env.HTTPS_PROXY;
    process.env.HTTPS_PROXY = "http://proxy.example.internal:8080";

    const env = buildChildEnv({ push_credentials_enabled: false, local_path: "/fake/workspace" });

    process.env.HTTPS_PROXY = originalProxy;

    expect(env.PATH).toBe(process.env.PATH);
    expect(env.HTTPS_PROXY).toBe("http://proxy.example.internal:8080");
  });

  // final-recheck-3-report regression: a standard proxy URL can embed
  // credentials as userinfo (http://user:pass@host:port) — being on the
  // name allowlist isn't enough; the value itself must be checked too.
  it("does not inherit a proxy URL that embeds userinfo credentials", () => {
    const originals = {
      HTTP_PROXY: process.env.HTTP_PROXY,
      HTTPS_PROXY: process.env.HTTPS_PROXY,
      ALL_PROXY: process.env.ALL_PROXY,
    };
    process.env.HTTP_PROXY = "http://proxyuser:proxysecret@proxy.example.internal:8080";
    process.env.HTTPS_PROXY = "https://proxyuser:proxysecret@proxy.example.internal:8443";
    process.env.ALL_PROXY = "socks5://proxyuser:proxysecret@proxy.example.internal:1080";

    const env = buildChildEnv({ push_credentials_enabled: false, local_path: "/fake/workspace" });

    for (const [key, original] of Object.entries(originals)) {
      if (original === undefined) delete process.env[key];
      else process.env[key] = original;
    }

    expect(env.HTTP_PROXY).toBeUndefined();
    expect(env.HTTPS_PROXY).toBeUndefined();
    expect(env.ALL_PROXY).toBeUndefined();
  });

  it("still passes through a proxy URL with no embedded credentials", () => {
    const original = process.env.HTTP_PROXY;
    process.env.HTTP_PROXY = "http://proxy.example.internal:8080";

    const env = buildChildEnv({ push_credentials_enabled: false, local_path: "/fake/workspace" });

    process.env.HTTP_PROXY = original;

    expect(env.HTTP_PROXY).toBe("http://proxy.example.internal:8080");
  });

  it("drops a malformed/unparseable proxy value rather than guessing it's safe", () => {
    const original = process.env.HTTP_PROXY;
    process.env.HTTP_PROXY = "not a valid url";

    const env = buildChildEnv({ push_credentials_enabled: false, local_path: "/fake/workspace" });

    process.env.HTTP_PROXY = original;

    expect(env.HTTP_PROXY).toBeUndefined();
  });

  it("still passes through NO_PROXY unchanged (a hostname list, not a credential-bearing URL)", () => {
    const original = process.env.NO_PROXY;
    process.env.NO_PROXY = "localhost,127.0.0.1,.internal";

    const env = buildChildEnv({ push_credentials_enabled: false, local_path: "/fake/workspace" });

    process.env.NO_PROXY = original;

    expect(env.NO_PROXY).toBe("localhost,127.0.0.1,.internal");
  });
});
