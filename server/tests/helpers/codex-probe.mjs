#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

const VERSION = "codex-cli probe v1";
const tempDir = mkdtempSync(join(tmpdir(), "codex-probe-"));

function redact(text) {
  return text
    .replace(/(--(?:token|api-key|apikey|password|passwd|secret|key|auth)["']?\s*[:=]\s*["']?)[^"'%\s]+/gi, "$1[REDACTED]")
    .replace(/(Bearer\s+)[A-Za-z0-9_\-\.]+/gi, "$1[REDACTED]")
    .replace(/(https?:\/\/[^:\/\s]+:)[^@\/\s]+(@)/gi, "$1[REDACTED]$2")
    .replace(/(gh[pousr]_)[A-Za-z0-9]{36,}/g, "$1[REDACTED]")
    .replace(/(sk-)[A-Za-z0-9]{20,}/g, "$1[REDACTED]");
}

function redactMessage(msg) {
  try {
    const parsed = typeof msg === "string" ? JSON.parse(msg) : msg;
    if (parsed.params) {
      if (parsed.params.command) parsed.params.command = redact(String(parsed.params.command));
      if (parsed.params.delta) parsed.params.delta = redact(String(parsed.params.delta));
      if (parsed.params.text) parsed.params.text = redact(String(parsed.params.text));
    }
    return JSON.stringify(parsed);
  } catch {
    return redact(String(msg));
  }
}

console.log(`[probe] ${VERSION}`);
console.log(`[probe] temp dir: ${tempDir}`);

mkdirSync(join(tempDir, "src"));
writeFileSync(join(tempDir, "package.json"), JSON.stringify({
  name: "probe-test", version: "1.0.0", scripts: { test: "echo test passed" },
}, null, 2));
writeFileSync(join(tempDir, "src", "app.ts"), "console.log('hello');\n");

try {
  const { execSync } = await import("node:child_process");
  execSync("git init && git add -A && git commit -m initial", {
    cwd: tempDir, encoding: "utf-8", timeout: 10000,
    env: { ...process.env, GIT_AUTHOR_NAME: "probe", GIT_AUTHOR_EMAIL: "probe@test.com", GIT_COMMITTER_NAME: "probe", GIT_COMMITTER_EMAIL: "probe@test.com" },
  });
  console.log("[probe] git repo initialized");
} catch (e) {
  console.error("[probe] git init failed:", e.message);
}

const child = spawn("codex", ["app-server", "--listen", "stdio://"], {
  cwd: tempDir,
  stdio: ["pipe", "pipe", "pipe"],
  shell: process.platform === "win32",
});

let lineBuffer = "";
const notifications = [];
let nextId = 1;
const pending = new Map();

function send(msg) {
  child.stdin.write(JSON.stringify(msg) + "\n");
}

function sendRequest(method, params) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    send({ jsonrpc: "2.0", id, method, ...(params ? { params } : {}) });
  });
}

function sendResponse(id, result) {
  send({ jsonrpc: "2.0", id, result });
}

child.stdout.setEncoding("utf-8");
child.stdout.on("data", (data) => {
  lineBuffer += data;
  const lines = lineBuffer.split("\n");
  lineBuffer = lines.pop() ?? "";
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const msg = JSON.parse(trimmed);
      if (msg.id !== undefined && msg.result !== undefined && pending.has(msg.id)) {
        const handler = pending.get(msg.id);
        pending.delete(msg.id);
        handler.resolve(msg);
        continue;
      }
      if (msg.method && msg.id !== undefined) {
        console.log(`[probe] REQUEST ${msg.method}:`, redactMessage(msg));
        notifications.push({ type: "request", method: msg.method, params: msg.params });
        if (msg.method.includes("requestApproval")) {
          sendResponse(msg.id, { decision: "accept" });
        } else {
          sendResponse(msg.id, {});
        }
        continue;
      }
      if (msg.method) {
        console.log(`[probe] NOTIF ${msg.method}:`, redactMessage(msg));
        notifications.push({ type: "notification", method: msg.method, params: msg.params });
      }
    } catch {
      console.log(`[probe] RAW (non-JSON):`, redact(trimmed).slice(0, 200));
    }
  }
});

child.stderr.setEncoding("utf-8");
child.stderr.on("data", (data) => {
  console.log(`[probe] STDERR:`, redact(data.trim()).slice(0, 200));
});

child.on("exit", (code, signal) => {
  console.log(`[probe] child exited: code=${code} signal=${signal}`);
});

const timeout = setTimeout(() => {
  console.error("[probe] TIMEOUT - killing child");
  child.kill("SIGKILL");
  process.exit(1);
}, 60000);

try {
  console.log("[probe] sending initialize...");
  const initResp = await sendRequest("initialize", {
    clientInfo: { name: "personahub-probe", version: "0.1.0" },
  });
  console.log("[probe] initialize result:", JSON.stringify(initResp.result).slice(0, 300));

  console.log("[probe] sending thread/start...");
  const threadResp = await sendRequest("thread/start", {
    cwd: tempDir,
    sandbox: "workspace-write",
    approvalPolicy: "untrusted",
  });
  const threadId = threadResp.result?.thread?.id;
  console.log("[probe] threadId:", threadId);

  console.log("[probe] sending turn/start with command instruction...");
  const turnResp = await sendRequest("turn/start", {
    threadId,
    input: [{ type: "text", text: "Run 'npm test' and then create a file called output.txt with the text 'done'" }],
  });
  console.log("[probe] turn started:", JSON.stringify(turnResp.result).slice(0, 200));

  await new Promise((resolve) => setTimeout(resolve, 45000));

  console.log("[probe] capturing notifications done");
  clearTimeout(timeout);

  console.log("\n[probe] === NOTIFICATION SUMMARY ===");
  const byMethod = {};
  for (const n of notifications) {
    const key = `${n.type}:${n.method}`;
    byMethod[key] = (byMethod[key] ?? 0) + 1;
  }
  for (const [key, count] of Object.entries(byMethod)) {
    console.log(`  ${key}: ${count}`);
  }

  const commandItems = notifications.filter(
    (n) => n.params?.item?.type === "commandExecution" || n.method?.includes("commandExecution"),
  );
  console.log("\n[probe] === COMMAND ITEM NOTIFICATIONS ===");
  for (const n of commandItems) {
    console.log(`  ${n.type} ${n.method}:`, JSON.stringify(n.params).slice(0, 400));
  }

  try { child.stdin.end(); } catch {}
  setTimeout(() => { child.kill("SIGKILL"); process.exit(0); }, 2000);
} catch (e) {
  console.error("[probe] ERROR:", e.message);
  clearTimeout(timeout);
  child.kill("SIGKILL");
  process.exit(1);
}
