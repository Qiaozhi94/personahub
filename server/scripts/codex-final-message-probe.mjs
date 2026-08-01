#!/usr/bin/env node
// Codex final-message protocol probe (F004 T002/T003).
//
// Replicates PersonaHub's production Codex app-server handshake
// (initialize -> thread/start -> turn/start) and dumps the full raw
// JSON-RPC stream so we can lock down how the *final agent message* is
// delivered and confirm command output never leaks into it.
//
// Zero dependencies — Node built-ins only. No project build needed.
//
// Usage (PowerShell / bash):
//   node codex-final-message-probe.mjs --command codex
//   node codex-final-message-probe.mjs --command codex --scenario a
//   node codex-final-message-probe.mjs --command "codex" --args "--foo bar" --shell
//
// Output:
//   * console summary per scenario (version, reconstructed final message,
//     whether command output stayed isolated, byte size, unicode check)
//   * raw stream written to codex-probe-<scenario>-<timestamp>.jsonl next
//     to this script — one JSON object per line, tagged with direction.
//
// NOTE: the .jsonl may contain absolute workspace paths. Review before
// sharing; the console summary redacts your home dir.

import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const HOME = homedir();
const OVERALL_TIMEOUT_MS = 120_000;

// ---- CLI args -------------------------------------------------------------
function parseArgs(argv) {
  const out = { command: "codex", args: [], scenario: "both", shell: undefined };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--command") out.command = argv[++i];
    else if (a === "--args") out.args = (argv[++i] ?? "").split(/\s+/).filter(Boolean);
    else if (a === "--scenario") out.scenario = (argv[++i] ?? "both").toLowerCase();
    else if (a === "--shell") out.shell = true;
    else if (a === "--no-shell") out.shell = false;
    else if (a === "--help" || a === "-h") { printHelp(); process.exit(0); }
  }
  if (out.shell === undefined) out.shell = process.platform === "win32";
  return out;
}
function printHelp() {
  console.log("node codex-final-message-probe.mjs --command codex [--args \"...\"] [--scenario a|b|both] [--shell|--no-shell]");
}

const CFG = parseArgs(process.argv.slice(2));

function redact(s) {
  if (typeof s !== "string") return s;
  return s.split(HOME).join("~");
}

// ---- Scenarios ------------------------------------------------------------
// A: pure answer, no commands. Includes Unicode to probe T003 boundaries.
// B: forces a shell command, so we can confirm its output lands under
//    commandExecution.aggregatedOutput and NOT inside the agent message.
const MARKER = "PERSONAHUB_PROBE_OK";
const CMD_MARKER = "PROBE_CMD_OUTPUT_MARKER_9F3A";
const SCENARIOS = {
  a: {
    label: "a-pure-answer",
    prompt: `Reply with exactly one line and nothing else: ${MARKER} ✓ 中文 café . Do NOT run any shell commands.`,
    expectCommand: false,
  },
  b: {
    label: "b-with-command",
    prompt: `Run exactly this shell command: echo ${CMD_MARKER}\nThen reply with the single word: DONE`,
    expectCommand: true,
  },
};

// ---- One scenario run -----------------------------------------------------
function runScenario(scn) {
  return new Promise((resolve) => {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const logPath = join(SCRIPT_DIR, `codex-probe-${scn.label}-${stamp}.jsonl`);
    const workDir = mkdtempSync(join(tmpdir(), "codex-probe-"));
    // give the agent something innocuous in the workspace
    writeFileSync(join(workDir, "README.txt"), "probe workspace\n");

    const summary = {
      label: scn.label,
      logPath,
      workDir,
      initializeResult: null,
      deltaField: null,          // which param field carried delta text
      deltaChunks: 0,
      reconstructedFinal: "",     // accumulated from item/agentMessage/delta
      completedAgentMessages: [], // any item/completed with type agentMessage
      turnCompletedParams: null,
      commandOutputs: [],         // aggregatedOutput seen under commandExecution
      commandMarkerInFinal: false,
      approvalsSeen: [],
      error: null,
    };

    const logLine = (dir, obj) => {
      try { appendFileSync(logPath, JSON.stringify({ ts: Date.now(), dir, msg: obj }) + "\n"); }
      catch { /* ignore */ }
    };

    let child;
    let lineBuffer = "";
    let nextId = 1;
    let threadId = null;
    let done = false;
    const pending = new Map();

    const finish = (err) => {
      if (done) return;
      done = true;
      if (err) summary.error = String(err);
      clearTimeout(timer);
      try { child?.stdin?.end(); } catch { /* ignore */ }
      try { if (child && child.exitCode === null && !child.killed) child.kill("SIGKILL"); } catch { /* ignore */ }
      // final analysis
      summary.commandMarkerInFinal = summary.reconstructedFinal.includes(CMD_MARKER)
        || summary.completedAgentMessages.some((m) => JSON.stringify(m).includes(CMD_MARKER));
      resolve(summary);
    };

    const timer = setTimeout(() => finish(new Error(`timeout after ${OVERALL_TIMEOUT_MS}ms`)), OVERALL_TIMEOUT_MS);

    const send = (obj) => {
      logLine("send", obj);
      try { child.stdin.write(JSON.stringify(obj) + "\n"); } catch { /* ignore */ }
    };
    const request = (method, params) => new Promise((res, rej) => {
      const id = nextId++;
      pending.set(id, { res, rej });
      send({ jsonrpc: "2.0", id, method, ...(params ? { params } : {}) });
    });
    const respond = (id, result) => send({ jsonrpc: "2.0", id, result });

    const onMessage = (msg) => {
      logLine("recv", msg);
      const isResp = "id" in msg && !("method" in msg);
      const isReq = "method" in msg && "id" in msg;
      const isNotif = "method" in msg && !("id" in msg);

      if (isResp) {
        const p = pending.get(msg.id);
        if (p) { pending.delete(msg.id); msg.error ? p.rej(new Error(JSON.stringify(msg.error))) : p.res(msg.result ?? {}); }
        return;
      }
      if (isReq) {
        // auto-approve so scenario B's echo can run; log what was asked
        if (String(msg.method).includes("requestApproval")) {
          summary.approvalsSeen.push({ method: msg.method, params: msg.params });
          respond(msg.id, { decision: "accept" });
        }
        return;
      }
      if (isNotif) {
        const { method, params } = msg;
        if (method === "item/agentMessage/delta") {
          const field = params?.delta !== undefined ? "delta" : (params?.text !== undefined ? "text" : null);
          const chunk = params?.delta ?? params?.text ?? "";
          if (typeof chunk === "string") {
            if (field && !summary.deltaField) summary.deltaField = field;
            summary.deltaChunks++;
            summary.reconstructedFinal += chunk;
          }
          return;
        }
        if (method === "item/completed") {
          const item = params?.item;
          if (item && typeof item === "object") {
            if (item.type === "agentMessage") {
              summary.completedAgentMessages.push(item);
            }
            if (item.type === "commandExecution" && typeof item.aggregatedOutput === "string") {
              summary.commandOutputs.push(item.aggregatedOutput);
            }
          }
          return;
        }
        if (method === "turn/completed") {
          summary.turnCompletedParams = params ?? null;
          finish(null);
          return;
        }
      }
    };

    try {
      child = spawn(CFG.command, [...CFG.args, "app-server", "--listen", "stdio://"], {
        cwd: workDir,
        stdio: ["pipe", "pipe", "pipe"],
        shell: CFG.shell,
      });
    } catch (err) {
      finish(new Error(`spawn threw: ${err}`));
      return;
    }

    child.on("error", (err) => finish(new Error(`spawn error: ${err.message} (try --shell or a full path to codex)`)));
    child.on("exit", (code, signal) => {
      if (!done) finish(new Error(`process exited early (code=${code} signal=${signal}) before turn/completed`));
    });

    child.stdout.setEncoding("utf-8");
    child.stderr.setEncoding("utf-8");
    child.stdout.on("data", (data) => {
      lineBuffer += data;
      const lines = lineBuffer.split("\n");
      lineBuffer = lines.pop() ?? "";
      for (const line of lines) {
        const t = line.trim();
        if (!t) continue;
        try { onMessage(JSON.parse(t)); } catch { logLine("recv-unparsed", { raw: t.slice(0, 500) }); }
      }
    });
    child.stderr.on("data", (data) => logLine("stderr", { text: String(data) }));

    request("initialize", { clientInfo: { name: "personahub-probe", version: "0.1.0" } })
      .then((r) => { summary.initializeResult = r; return request("thread/start", { cwd: workDir, sandbox: "workspace-write", approvalPolicy: "untrusted" }); })
      .then((r) => { threadId = r?.thread?.id ?? null; return request("turn/start", { threadId, input: [{ type: "text", text: scn.prompt }] }); })
      .catch((err) => finish(new Error(`handshake failed: ${err}`)));
  });
}

// ---- Report ---------------------------------------------------------------
function printReport(s) {
  const line = "-".repeat(64);
  console.log("\n" + line);
  console.log(`SCENARIO: ${s.label}`);
  console.log(line);
  if (s.error) console.log(`⚠ error/incomplete: ${s.error}`);
  console.log(`raw stream : ${redact(s.logPath)}`);
  console.log(`workspace  : ${redact(s.workDir)}`);
  console.log(`codex init : ${redact(JSON.stringify(s.initializeResult))}`);
  console.log("");
  console.log(`delta field name          : ${s.deltaField ?? "(no delta notifications seen)"}`);
  console.log(`delta chunks              : ${s.deltaChunks}`);
  console.log(`item/completed agentMsgs  : ${s.completedAgentMessages.length}`);
  console.log(`  -> is there a terminal item carrying the FULL message? ${s.completedAgentMessages.length > 0 ? "YES" : "NO (must accumulate deltas)"}`);
  const finalLen = Buffer.byteLength(s.reconstructedFinal, "utf-8");
  console.log(`reconstructed final (bytes): ${finalLen}`);
  console.log(`reconstructed final (text) : ${JSON.stringify(redact(s.reconstructedFinal))}`);
  if (s.completedAgentMessages.length > 0) {
    console.log(`terminal agentMessage item : ${redact(JSON.stringify(s.completedAgentMessages[s.completedAgentMessages.length - 1]))}`);
  }
  console.log(`unicode preserved (✓中文café): ${s.reconstructedFinal.includes("✓ 中文 café") ? "YES" : "check manually"}`);
  console.log("");
  console.log(`command outputs captured   : ${s.commandOutputs.length}`);
  if (s.commandOutputs.length > 0) {
    console.log(`  sample                   : ${JSON.stringify(redact(s.commandOutputs[0].slice(0, 200)))}`);
  }
  console.log(`approval requests          : ${s.approvalsSeen.length}`);
  console.log(`>>> ISOLATION CHECK: command marker leaked into final message? ${s.commandMarkerInFinal ? "❌ YES (BAD)" : "✅ NO (good)"}`);
  console.log(`turn/completed params      : ${redact(JSON.stringify(s.turnCompletedParams))}`);
}

// ---- Main -----------------------------------------------------------------
async function main() {
  const which = CFG.scenario === "both" ? ["a", "b"] : [CFG.scenario];
  console.log(`Codex final-message probe`);
  console.log(`  command  : ${CFG.command} ${CFG.args.join(" ")} app-server --listen stdio://`);
  console.log(`  shell    : ${CFG.shell}   (win32 default true; use --no-shell to mirror production adapter)`);
  console.log(`  scenarios: ${which.join(", ")}`);

  const results = [];
  for (const key of which) {
    const scn = SCENARIOS[key];
    if (!scn) { console.log(`unknown scenario '${key}' (use a|b|both)`); continue; }
    console.log(`\n▶ running scenario ${key} (${scn.label}) ...`);
    const s = await runScenario(scn);
    printReport(s);
    results.push(s);
  }

  console.log("\n" + "=".repeat(64));
  console.log("NEXT STEP: paste the console summary above (and, if you like, the");
  console.log(".jsonl files after reviewing them for absolute paths) back to me.");
  console.log("Key questions the fixtures answer for F004 §5.1/§8:");
  console.log("  1. final message = accumulate deltas, or one terminal item?");
  console.log("  2. exact delta field name (delta vs text)");
  console.log("  3. command output stays isolated from the final message?");
  console.log("  4. unicode / byte-size behavior at the boundary");
  console.log("=".repeat(64));

  const anyError = results.some((r) => r.error);
  process.exit(anyError ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
