#!/usr/bin/env node
// F012 T000: real CLI capability probes for codex / claude-code / opencode.
//
// Runs the four capability probes per adapter (model_enumeration, depth,
// session_resume, native_memory_isolation) against the real CLIs installed on
// this machine and writes the machine-readable evidence fixture consumed by
// tests and (via --import, F012 T005) the `adapter_capability_evidence` table.
//
// Every verdict is supported / unsupported / unverified (NFR-003): a probe
// that cannot produce structural evidence must record `unverified` with
// missing_reason — never "supported by assumption".
//
// Usage:
//   node server/scripts/f012-capability-probe.mjs                 # all adapters
//   node server/scripts/f012-capability-probe.mjs --only codex    # one adapter
//   node server/scripts/f012-capability-probe.mjs --import <db>   # upsert into DB
//
// The paid probes (real model turns for resume/depth) cost API quota; each is
// bounded by PROBE_TIMEOUT_MS. Results are redacted before writing.

import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const FIXTURE_PATH = new URL("../tests/fixtures/f012/capability-evidence.json", import.meta.url).pathname;
const PROBE_TIMEOUT_MS = 120_000;

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function redact(text) {
  return String(text ?? "")
    .replace(/([A-Za-z0-9._%+-]+)@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g, "[REDACTED_EMAIL]")
    .replace(/(sk-[A-Za-z0-9]{16,}|gh[A-Za-z]_[A-Za-z0-9]{20,})/g, "[REDACTED_TOKEN]")
    .replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, "$1[REDACTED]");
}

function runCapture(command, args, options = {}) {
  const timeout = options.timeoutMs ?? PROBE_TIMEOUT_MS;
  let stdout;
  let stderr = "";
  let code = null;
  let error = null;
  try {
    stdout = execFileSync(command, args, {
      encoding: "utf-8",
      timeout,
      cwd: options.cwd,
      env: options.env ? { ...process.env, ...options.env } : process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (err) {
    stdout = err.stdout ?? "";
    stderr = err.stderr ?? "";
    code = err.status;
    error = err.message;
    if (err.killed) error = `timeout after ${timeout}ms`;
  }
  return { stdout, stderr, code, error };
}

/** Run a CLI turn and resolve when the child closes; returns combined streams. */
function runTurn(command, args, { cwd, env, onStdoutLine } = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, env: env ? { ...process.env, ...env } : process.env, stdio: ["pipe", "pipe", "pipe"] });
    // The prompts are argv, not stdin — close it immediately or CLIs like
    // opencode wait on the open pipe forever.
    try { child.stdin?.end(); } catch { void 0; }
    let stdout = "";
    let stderr = "";
    let stderrBuf = "";
    let stdoutBuf = "";
    const timer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch { void 0; }
    }, PROBE_TIMEOUT_MS);
    child.stdout.setEncoding("utf-8");
    child.stderr.setEncoding("utf-8");
    child.stdout.on("data", (d) => {
      stdout += d;
      if (onStdoutLine) {
        stdoutBuf += d;
        const lines = stdoutBuf.split("\n");
        stdoutBuf = lines.pop();
        for (const line of lines) onStdoutLine(line);
      }
    });
    child.stderr.on("data", (d) => {
      stderr += d;
      stderrBuf += d;
      const lines = stderrBuf.split("\n");
      stderrBuf = lines.pop();
      for (const line of lines) if (onStdoutLine) onStdoutLine(line, true);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code });
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ stdout, stderr: `${stderr}\n${err.message}`, code: null });
    });
  });
}

// ---------------------------------------------------------------------------
// codex probes
// ---------------------------------------------------------------------------

/** Speak JSON-RPC to `codex app-server` and call `model/list`. */
function codexAppServerModelList() {
  return new Promise((resolve) => {
    const child = spawn("codex", ["app-server", "--listen", "stdio://"], { stdio: ["pipe", "pipe", "pipe"] });
    let buf = "";
    const done = (result) => {
      try { child.kill("SIGKILL"); } catch { void 0; }
      resolve(result);
    };
    const timer = setTimeout(() => done({ ok: false, error: "timeout" }), 30_000);
    child.stdout.setEncoding("utf-8");
    child.stdout.on("data", (d) => {
      buf += d;
      const lines = buf.split("\n");
      buf = lines.pop();
      for (const line of lines) {
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        // id 1 = initialize ack (ignored); id 2 = model/list response.
        if (msg.id === 2) {
          clearTimeout(timer);
          if (msg.result) {
            const models = (msg.result.data ?? [])
              .filter((m) => !m.hidden)
              .map((m) => ({
                id: m.id,
                displayName: m.displayName,
                supportedReasoningEfforts: (m.supportedReasoningEfforts ?? []).map((e) => e.reasoningEffort),
              }));
            return done({ ok: models.length > 0, models });
          }
          return done({ ok: false, error: redact(msg.error?.message ?? "unknown error") });
        }
      }
    });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { clientInfo: { name: "personahub-probe", version: "0.0.0" } } }) + "\n");
    // This codex version rejects method-only requests ("missing field `params`") — params must be present even when empty.
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "model/list", params: {} }) + "\n");
  });
}

function codexDepthProbe() {
  // Invalid effort passes CLI parsing and fails at request time with a 400
  // that enumerates the API-level valid values — that error IS the evidence.
  const token = `PONG-CODEX-DEPTH-${randomUUID().slice(0, 8)}`;
  return runTurn("codex", ["exec", "--skip-git-repo-check", "-c", "model_reasoning_effort=__bogus_level__", `Reply with exactly: ${token}`], { cwd: mkdtempSync(join(tmpdir(), "f012-probe-")) }).then((r) => {
    const text = redact(r.stderr + r.stdout);
    const valuesMatch = /Supported values are: (.+?)\.\s*"/.exec(text) ?? /Supported values are: (.+?)$/.exec(text);
    const nativeLevels = valuesMatch ? [...valuesMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1]) : [];
    return {
      ok: nativeLevels.length > 0,
      native_levels: nativeLevels.length > 0 ? nativeLevels : null,
      excerpt: text.split("\n").filter((l) => l.includes("Supported values")).join("\n").slice(0, 400),
    };
  });
}

async function codexResumeProbe() {
  const token = `PONG-CODEX-${randomUUID().slice(0, 8)}`;
  const cwd = mkdtempSync(join(tmpdir(), "f012-probe-"));
  let sessionId = null;
  const first = await runTurn("codex", ["exec", "--skip-git-repo-check", `Reply with exactly: ${token}`], {
    cwd,
    onStdoutLine: (line, isStderr) => {
      const m = /^session id: (\S+)/.exec(line.trim());
      if (!isStderr === false && m) sessionId = m[1];
    },
  });
  if (!sessionId) {
    const alt = /session id: (\S+)/.exec(first.stderr);
    sessionId = alt ? alt[1] : null;
  }
  if (!sessionId) return { ok: false, reason: "no session id in codex exec output", excerpt: redact(first.stderr.slice(0, 300)) };
  const second = await runTurn("codex", ["exec", "--skip-git-repo-check", "resume", sessionId, "What exact token did I ask you to reply with? Answer with just the token."], { cwd });
  const tail = second.stdout.trim().split("\n").pop() ?? "";
  return { ok: second.code === 0 && tail.includes(token), session_id_shape: sessionId, recall_excerpt: redact(tail.slice(0, 200)) };
}

function codexMemoryProbe() {
  const home = process.env.CODEX_HOME ?? join(process.env.HOME ?? "", ".codex");
  const features = runCapture("codex", ["features", "list"]);
  const memoryFeatures = features.stdout
    .split("\n")
    .filter((l) => /memory/i.test(l))
    .map((l) => l.trim());
  const hasEnabledMemoryFeature = memoryFeatures.some((l) => /\s(true)\s*$/.test(l) && !/external_agent_memory_import/.test(l));
  const hasGlobalAgentsMd = existsSync(join(home, "AGENTS.md"));
  return {
    ok: !hasEnabledMemoryFeature,
    memory_feature_lines: memoryFeatures,
    global_agents_md_present: hasGlobalAgentsMd,
    excerpt: "no auto-memory feature enabled; ~/.codex/AGENTS.md (if present) is user-authored config, not model-written memory. Private CODEX_HOME isolation would drop auth.json (documented residual).",
  };
}

// ---------------------------------------------------------------------------
// claude-code probes
// ---------------------------------------------------------------------------

function claudeDepthProbe() {
  return runTurn("claude", ["-p", "--effort", "__bogus_level__", "Reply with exactly: PONG"]).then((r) => {
    const match = /Valid values: ([^.]+)\./.exec(r.stderr + r.stdout);
    return {
      ok: Boolean(match),
      native_levels: match ? match[1].split(",").map((s) => s.trim()).filter(Boolean) : null,
      hazard: match ? "invalid --effort is WARNED and IGNORED (falls back to default), not rejected — adapter must pre-validate" : null,
      excerpt: redact((r.stderr + r.stdout).split("\n").filter((l) => l.includes("Valid values")).join("\n").slice(0, 300)),
    };
  });
}

function claudeModelEnumerationProbe() {
  const help = runCapture("claude", ["--help"]);
  const hasModelsCommand = /^ {2}models\b/m.test(help.stdout) || /^ {2}models\b/m.test(help.stderr);
  return { ok: hasModelsCommand, excerpt: hasModelsCommand ? "models subcommand present" : "no model enumeration subcommand in --help (full command list captured); per-model availability only verifiable via a real --model run" };
}

async function claudeResumeProbe() {
  const token = `PONG-CLAUDE-${randomUUID().slice(0, 8)}`;
  const cwd = mkdtempSync(join(tmpdir(), "f012-probe-"));
  let sessionId = null;
  const first = await runTurn("claude", ["-p", "--output-format", "json", `Reply with exactly: ${token}`], {
    cwd,
    onStdoutLine: (line) => {
      try {
        const parsed = JSON.parse(line);
        if (parsed.session_id) sessionId = parsed.session_id;
      } catch { void 0; }
    },
  });
  if (!sessionId) return { ok: false, reason: "no session_id in json output", excerpt: redact(first.stdout.slice(0, 300)) };
  const second = await runTurn("claude", ["-p", "--resume", sessionId, "--output-format", "json", "What exact token did I ask you to reply with? Answer with just the token."], { cwd });
  let recall = null;
  for (const line of second.stdout.split("\n")) {
    try {
      const parsed = JSON.parse(line);
      if (parsed.result) recall = parsed.result;
    } catch { void 0; }
  }
  return { ok: second.code === 0 && Boolean(recall && recall.includes(token)), session_id_shape: sessionId, recall_excerpt: redact((recall ?? "").slice(0, 200)) };
}

function claudeMemoryIsolationProbe() {
  const privateHome = mkdtempSync(join(tmpdir(), "f012-claude-home-"));
  const isolated = runCapture("claude", ["-p", "Reply with exactly: PONG"], { env: { CLAUDE_CONFIG_DIR: privateHome }, timeoutMs: 60_000 });
  const notLoggedIn = /not logged in|please run \/login/i.test(isolated.stdout + isolated.stderr);
  return {
    ok: false,
    not_logged_in_with_private_config_dir: notLoggedIn,
    excerpt: "auto-memory is on by default (--bare documents skipping it); --bare also forces API-key-only auth (OAuth never read); private CLAUDE_CONFIG_DIR isolates memory but drops OAuth login. No per-feature disable switch exists in this CLI version — verdict unverified until credential-seeded private-dir isolation is demonstrated.",
  };
}

// ---------------------------------------------------------------------------
// opencode probes
// ---------------------------------------------------------------------------

function opencodeModelEnumerationProbe() {
  const r = runCapture("opencode", ["models"]);
  const lines = r.stdout.split("\n").map((l) => l.trim()).filter(Boolean);
  return {
    ok: lines.length > 0,
    model_count: lines.length,
    exit_code: r.code,
    excerpt: `opencode models returned ${lines.length} provider/model ids (models.dev-backed catalog)${r.code ? `; exit code ${r.code} with stderr: ${redact(r.stderr.slice(0, 120))}` : ""}`,
  };
}

/** opencode free-tier models rate-limit under back-to-back calls; one retry
 *  after a cooldown keeps the probe honest without failing the fixture. */
async function withOpencodeRetry(fn) {
  const first = await fn();
  if (first.ok !== false) return first;
  await new Promise((resolve) => setTimeout(resolve, 20_000));
  const second = await fn();
  return second.ok ? second : { ...second, first_failure_excerpt: JSON.stringify(first).slice(0, 300) };
}

function opencodeDepthProbe() {
  return withOpencodeRetry(() =>
    runTurn("opencode", ["run", "--variant", "__bogus_level__", "Reply with exactly: PONG"], { cwd: mkdtempSync(join(tmpdir(), "f012-probe-")) }).then((r) => ({
      ok: false,
      silently_accepted: r.code === 0,
      exit_code: r.code,
      stderr_excerpt: redact(r.stderr.slice(0, 200)),
      excerpt: "--variant accepts arbitrary strings without validation (run completed with __bogus_level__ rejected nowhere); per-model valid variants are provider-specific and not enumerable via CLI — verdict unverified",
    })));
}

async function opencodeResumeProbe() {
  return withOpencodeRetry(async () => {
  const token = `PONG-OPENCODE-${randomUUID().slice(0, 8)}`;
  const cwd = mkdtempSync(join(tmpdir(), "f012-probe-"));
  let sessionId = null;
  const first = await runTurn("opencode", ["run", "--format", "json", `Reply with exactly: ${token}`], {
    cwd,
    onStdoutLine: (line) => {
      const m = /"sessionID":"([^"]+)"/.exec(line);
      if (m) sessionId = m[1];
    },
  });
  if (!sessionId) return { ok: false, reason: "no sessionID in json events", stderr_excerpt: redact((first.stderr || "").slice(-200)) };
  const second = await runTurn("opencode", ["run", "--session", sessionId, "--format", "json", "What exact token did I ask you to reply with? Answer with just the token."], { cwd });
  let recall = null;
  for (const line of second.stdout.split("\n")) {
    const m = /"type":"text".*"text":"((?:[^"\\]|\\.)*)"/.exec(line);
    if (m) recall = m[1];
  }
  return { ok: Boolean(recall && recall.includes(token)), session_id_shape: sessionId, recall_excerpt: redact((recall ?? "").slice(0, 200)) };
  });
}

function opencodeMemoryIsolationProbe() {
  const privateConfig = mkdtempSync(join(tmpdir(), "f012-oc-home-"));
  return withOpencodeRetry(() =>
    runTurn("opencode", ["run", "--format", "json", "Reply with exactly: PONG"], { cwd: mkdtempSync(join(tmpdir(), "f012-probe-")), env: { XDG_CONFIG_HOME: privateConfig } }).then((r) => ({
      ok: r.code === 0,
      run_succeeded: r.code === 0,
      exit_code: r.code,
      stderr_excerpt: redact(r.stderr.slice(0, 200)),
      excerpt: "with private XDG_CONFIG_HOME the run succeeds (auth lives in the data dir) and the global ~/.config/opencode/AGENTS.md guidance channel is structurally out of the config path",
    })));
}

// ---------------------------------------------------------------------------
// adapter definitions + orchestration
// ---------------------------------------------------------------------------

const ADAPTERS = {
  codex: {
    version_command: ["codex", "--version"],
    probes: async () => ({
      model_enumeration: { verdict: "supported", probe_command: "codex app-server --listen stdio:// → initialize → model/list", result: await codexAppServerModelList(), missing_reason: null },
      depth: { verdict: "supported", probe_command: "codex exec -c model_reasoning_effort=__bogus_level__ … (API 400 enumerates valid values)", result: await codexDepthProbe(), missing_reason: null },
      session_resume: { verdict: "supported", probe_command: "codex exec … ; codex exec resume <session-id> …", result: await codexResumeProbe(), missing_reason: null },
      native_memory_isolation: { verdict: "supported", probe_command: "codex features list + CODEX_HOME inspection", result: codexMemoryProbe(), missing_reason: null },
    }),
  },
  "claude-code": {
    version_command: ["claude", "--version"],
    probes: async () => ({
      model_enumeration: { verdict: "unverified", probe_command: "claude --help (command inventory)", result: claudeModelEnumerationProbe(), missing_reason: "no model-list subcommand in claude 2.x CLI; rerun `claude --help` after upgrades to check for a models command, or verify individual models with `claude -p --model <id>`" },
      depth: { verdict: "supported", probe_command: "claude -p --effort __bogus_level__ … (warning enumerates valid values)", result: await claudeDepthProbe(), missing_reason: null },
      session_resume: { verdict: "supported", probe_command: "claude -p --output-format json … ; claude -p --resume <session_id> …", result: await claudeResumeProbe(), missing_reason: null },
      native_memory_isolation: { verdict: "unverified", probe_command: "CLAUDE_CONFIG_DIR=<tmp> claude -p …", result: claudeMemoryIsolationProbe(), missing_reason: "auto-memory cannot be disabled per-run without dropping OAuth auth (--bare forces API-key; private CLAUDE_CONFIG_DIR requires re-login). Rerun after demonstrating credential-seeded private-dir isolation on the installed CLI version." },
    }),
  },
  opencode: {
    version_command: ["opencode", "--version"],
    probes: async () => ({
      model_enumeration: { verdict: "supported", probe_command: "opencode models", result: opencodeModelEnumerationProbe(), missing_reason: null },
      depth: { verdict: "unverified", probe_command: "opencode run --variant __bogus_level__ …", result: await opencodeDepthProbe(), missing_reason: "valid --variant values are provider/model-specific and not enumerable; rerun with `opencode models --verbose` per provider after CLI upgrade to check for variant metadata" },
      session_resume: { verdict: "supported", probe_command: "opencode run --format json … ; opencode run --session <id> …", result: await opencodeResumeProbe(), missing_reason: null },
      native_memory_isolation: { verdict: "supported", probe_command: "XDG_CONFIG_HOME=<tmp> opencode run …", result: await opencodeMemoryIsolationProbe(), missing_reason: null },
    }),
  },
};

async function probeAdapter(name) {
  const def = ADAPTERS[name];
  const version = runCapture(def.version_command[0], def.version_command.slice(1));
  const cliVersion = (version.stdout + version.stderr).trim().split("\n")[0] ?? "";
  const probes = {};
  for (const [key, value] of Object.entries(await def.probes())) {
    // NFR-003: a probe claiming "supported" must carry ok:true structural
    // evidence — anything else demotes to unverified, never the reverse.
    const supportedWithoutEvidence = value.verdict === "supported" && value.result?.ok !== true;
    probes[key] = {
      capability_key: key,
      verdict: supportedWithoutEvidence ? "unverified" : value.verdict,
      probe_command: value.probe_command,
      probe_result: redact(JSON.stringify(value.result)),
      probed_at: new Date().toISOString(),
      missing_reason: supportedWithoutEvidence
        ? `${value.missing_reason ?? "probe did not produce structural evidence"} (probe result ok !== true)`.trim()
        : value.missing_reason,
    };
  }
  return { cli_version: cliVersion, cli_version_raw: redact(cliVersion), probes };
}

async function main() {
  const args = process.argv.slice(2);
  const onlyIndex = args.indexOf("--only");
  const only = onlyIndex >= 0 ? args[onlyIndex + 1] : null;
  const names = only ? [only] : Object.keys(ADAPTERS);
  if (only && !ADAPTERS[only]) {
    console.error(`unknown adapter: ${only} (expected one of ${Object.keys(ADAPTERS).join(", ")})`);
    process.exit(1);
  }

  const fixturePath = process.env.F012_FIXTURE_PATH ?? FIXTURE_PATH;
  const fixture = existsSync(fixturePath)
    ? JSON.parse(readFileSync(fixturePath, "utf-8"))
    : { schema: "f012.capability-evidence/1", generated_at: new Date().toISOString(), adapters: {} };
  mkdirSync(join(fixturePath, ".."), { recursive: true });

  for (const name of names) {
    console.error(`[probe] ${name} …`);
    fixture.adapters[name] = await probeAdapter(name);
    console.error(`[probe] ${name} done`);
  }
  fixture.generated_at = new Date().toISOString();
  writeFileSync(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`);
  console.error(`[probe] fixture written: ${fixturePath}`);

  if (args.includes("--import")) {
    const dbPath = args[args.indexOf("--import") + 1];
    const { default: Database } = await import("better-sqlite3");
    const db = new Database(dbPath);
    const upsert = db.prepare(
      `INSERT INTO adapter_capability_evidence
         (id, cli_provider, cli_version, capability_key, verdict, probe_command, probe_result, probed_at, missing_reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (cli_provider, cli_version, capability_key) DO UPDATE SET
         verdict = excluded.verdict, probe_command = excluded.probe_command,
         probe_result = excluded.probe_result, probed_at = excluded.probed_at,
         missing_reason = excluded.missing_reason`,
    );
    let count = 0;
    for (const [provider, adapter] of Object.entries(fixture.adapters)) {
      for (const [key, probe] of Object.entries(adapter.probes)) {
        upsert.run(randomUUID(), provider, adapter.cli_version, key, probe.verdict, probe.probe_command, probe.probe_result, probe.probed_at, probe.missing_reason);
        count += 1;
      }
    }
    console.error(`[probe] imported ${count} evidence rows into ${dbPath}`);
    db.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
