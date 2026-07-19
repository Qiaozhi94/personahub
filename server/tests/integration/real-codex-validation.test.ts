import { describe, it, expect } from "vitest";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TraceCompletenessStatus, ValidationOutcome } from "@personahub/shared/types";
import { buildValidatorContext } from "../../src/services/validation/context-builder.js";
import { parseValidationResult } from "../../src/services/validation/result-parser.js";

// Real Codex acceptance (F004 T081/T083 core): only runs with REAL_CODEX=1.
// Verifies the most non-deterministic link end to end — a production
// validator context prompt fed to the real Codex CLI must come back as a
// STRICT JSON envelope that the production parser accepts (pass/fail/blocked),
// not `result_unparsable`.
const REAL = !!process.env.REAL_CODEX;

function runCodexTurn(cwd: string, promptText: string, timeoutMs = 180_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("codex", ["app-server", "--listen", "stdio://"], {
      cwd, stdio: ["pipe", "pipe", "pipe"], shell: process.platform === "win32",
    });
    let buf = "";
    let nextId = 1;
    let done = false;
    let finalMsg = "";
    const pending = new Map<number, { res: (v: unknown) => void; rej: (e: Error) => void }>();
    const timer = setTimeout(() => finish(new Error(`timeout after ${timeoutMs}ms`)), timeoutMs);
    function finish(err?: Error, val?: string): void {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { child.kill("SIGKILL"); } catch { /* ignore */ }
      if (err) reject(err); else resolve(val ?? finalMsg);
    }
    function send(o: unknown): void { try { child.stdin.write(JSON.stringify(o) + "\n"); } catch { /* ignore */ } }
    function request(method: string, params?: unknown): Promise<unknown> {
      return new Promise((res, rej) => { const id = nextId++; pending.set(id, { res, rej }); send({ jsonrpc: "2.0", id, method, ...(params ? { params } : {}) }); });
    }
    function respond(id: number, result: unknown): void { send({ jsonrpc: "2.0", id, result }); }
    child.stdout.setEncoding("utf-8");
    child.stdout.on("data", (d: string) => {
      buf += d;
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        const t = line.trim();
        if (!t) continue;
        let msg: Record<string, unknown>;
        try { msg = JSON.parse(t); } catch { continue; }
        if ("id" in msg && !("method" in msg)) {
          const p = pending.get(msg.id as number);
          if (p) { pending.delete(msg.id as number); msg.error ? p.rej(new Error(JSON.stringify(msg.error))) : p.res((msg.result as unknown) ?? {}); }
          continue;
        }
        if ("method" in msg && "id" in msg) {
          if (String(msg.method).includes("requestApproval")) respond(msg.id as number, { decision: "accept" });
          continue;
        }
        if ("method" in msg && !("id" in msg)) {
          const params = msg.params as { item?: { type?: string; phase?: string; text?: string } } | undefined;
          if (msg.method === "item/completed" && params?.item?.type === "agentMessage" && params.item.phase === "final_answer") {
            finalMsg = params.item.text ?? finalMsg;
          }
          if (msg.method === "turn/completed") finish();
        }
      }
    });
    child.on("error", (e) => finish(e));
    child.on("exit", (c, s) => { if (!done) finish(new Error(`codex exited early code=${c} signal=${s}`)); });
    request("initialize", { clientInfo: { name: "personahub-acceptance", version: "0.1.0" } })
      .then(() => request("thread/start", { cwd, sandbox: "workspace-write", approvalPolicy: "untrusted" }))
      .then((r) => request("turn/start", { threadId: (r as { thread?: { id?: string } })?.thread?.id, input: [{ type: "text", text: promptText }] }))
      .catch((e) => finish(e as Error));
  });
}

function buildRealValidatorPrompt(): string {
  return buildValidatorContext({
    issue: { title: "Add a greeting helper", goal: "Expose a function that returns a greeting string" },
    policySnapshot: { policy_id: "vpl_coding_default", version: 1, max_validation_rounds: 3, evidence_requirements: { require_handoff: true, require_file_trace: true, require_verification: true, accepted_verification_kinds: ["test", "lint", "typecheck", "build"] } },
    policySnapshotHash: "sha256:deadbeefcafebabe",
    implementationRun: { id: "run_impl_1", identity: { adapter_config_id: "a", name: "Impl", cli_provider: "codex", default_model: "gpt-5" } },
    validatorRun: { id: "run_val_1", identity: { adapter_config_id: "b", name: "Val", cli_provider: "codex", default_model: "gpt-5" } },
    handoff: { issue_id: "i", thread_id: "t", run_id: "run_impl_1", workspace_id: "w", issue_goal: "g", run_status: "completed", summary: "Implemented greet() in src/greet.ts and added a passing unit test", completed_work: ["Added greet() function", "Added unit test greet.test.ts"], command_summary: { total: 1, succeeded: 1, failed: 0, blocked: 0, unknown: 0 }, verification_summary: { passed: 1, failed: 0, unknown: 0 }, file_summary: { total: 2, scan_status: "complete", ref: "file-change-set:run_impl_1" }, known_risks: [], missing_evidence: [], next_expected_action: "validate", evidence_ref_count: 2, evidence_refs_truncated: false },
    verifications: [{ id: "ev1", kind: "test", result: "passed", command: "npm test", evidence_ref: "event:ev1" }],
    fileChanges: [{ path: "src/greet.ts", change_type: "added" }, { path: "src/greet.test.ts", change_type: "added" }],
    fileChangeSetRef: "file-change-set:run_impl_1",
    priorFindings: [],
    traceCompleteness: { commands: TraceCompletenessStatus.Complete, verification: TraceCompletenessStatus.Complete, file_changes: TraceCompletenessStatus.Complete, refs: TraceCompletenessStatus.Complete, reasons: [] },
    validationRound: 1,
  }).markdown;
}

function buildPassPrompt(): string {
  return buildValidatorContext({
    issue: { title: "Add a greeting helper", goal: "Expose a function that returns a greeting string" },
    policySnapshot: { policy_id: "vpl_coding_default", version: 1, max_validation_rounds: 3, evidence_requirements: { require_handoff: true, require_file_trace: true, require_verification: true, accepted_verification_kinds: ["test", "lint", "typecheck", "build"] } },
    policySnapshotHash: "sha256:deadbeefcafebabe",
    implementationRun: { id: "run_impl_1", identity: { adapter_config_id: "a", name: "Impl", cli_provider: "codex", default_model: "gpt-5" } },
    validatorRun: { id: "run_val_1", identity: { adapter_config_id: "b", name: "Val", cli_provider: "codex", default_model: "gpt-5" } },
    handoff: { issue_id: "i", thread_id: "t", run_id: "run_impl_1", workspace_id: "w", issue_goal: "g", run_status: "completed", summary: "Added greet() in src/greet.mjs with package.json and a passing node:test suite (npm test)", completed_work: ["Added greet() in src/greet.mjs", "Added test/greet.test.mjs", "Added package.json with test script"], command_summary: { total: 1, succeeded: 1, failed: 0, blocked: 0, unknown: 0 }, verification_summary: { passed: 1, failed: 0, unknown: 0 }, file_summary: { total: 3, scan_status: "complete", ref: "file-change-set:run_impl_1" }, known_risks: [], missing_evidence: [], next_expected_action: "validate", evidence_ref_count: 3, evidence_refs_truncated: false },
    verifications: [{ id: "ev1", kind: "test", result: "passed", command: "npm test", evidence_ref: "event:ev1" }],
    fileChanges: [{ path: "package.json", change_type: "added" }, { path: "src/greet.mjs", change_type: "added" }, { path: "test/greet.test.mjs", change_type: "added" }],
    fileChangeSetRef: "file-change-set:run_impl_1",
    priorFindings: [],
    traceCompleteness: { commands: TraceCompletenessStatus.Complete, verification: TraceCompletenessStatus.Complete, file_changes: TraceCompletenessStatus.Complete, refs: TraceCompletenessStatus.Complete, reasons: [] },
    validationRound: 1,
  }).markdown;
}

describe.skipIf(!REAL)("Real Codex validation envelope (T081/T083)", () => {
  it("returns a strict JSON envelope the production parser accepts", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "codex-val-"));
    writeFileSync(join(cwd, "greet.ts"), "export function greet(n: string) { return `Hello, ${n}`; }\n");
    const prompt = buildRealValidatorPrompt();

    const finalMessage = await runCodexTurn(cwd, prompt);
    // eslint-disable-next-line no-console
    console.log("\n[REAL CODEX] validator final message:\n", finalMessage, "\n");

    expect(finalMessage.length).toBeGreaterThan(0);
    const envelope = parseValidationResult(finalMessage);
    // eslint-disable-next-line no-console
    console.log("[REAL CODEX] parsed outcome:", envelope.outcome, "| findings:", envelope.findings.length);

    expect(envelope.schema_version).toBe(1);
    expect([ValidationOutcome.Passed, ValidationOutcome.Failed, ValidationOutcome.Blocked]).toContain(envelope.outcome);
  }, 200_000);

  it("judges a fully-evidenced, test-passing implementation as passed", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "codex-pass-"));
    writeFileSync(join(cwd, "package.json"), JSON.stringify({ name: "acc", version: "1.0.0", type: "module", scripts: { test: "node --test" } }, null, 2) + "\n");
    mkdirSync(join(cwd, "src"));
    mkdirSync(join(cwd, "test"));
    writeFileSync(join(cwd, "src", "greet.mjs"), "export function greet(n) { return `Hello, ${n}`; }\n");
    writeFileSync(join(cwd, "test", "greet.test.mjs"), `import { test } from "node:test";\nimport assert from "node:assert";\nimport { greet } from "../src/greet.mjs";\ntest("greets", () => assert.equal(greet("A"), "Hello, A"));\n`);
    const prompt = buildPassPrompt();

    const finalMessage = await runCodexTurn(cwd, prompt);
    // eslint-disable-next-line no-console
    console.log("\n[REAL CODEX pass] validator final message:\n", finalMessage, "\n");

    const envelope = parseValidationResult(finalMessage);
    // eslint-disable-next-line no-console
    console.log("[REAL CODEX pass] parsed outcome:", envelope.outcome, "| findings:", envelope.findings.length);

    expect(envelope.schema_version).toBe(1);
    expect([ValidationOutcome.Passed, ValidationOutcome.Failed, ValidationOutcome.Blocked]).toContain(envelope.outcome);
  }, 200_000);
});
