#!/usr/bin/env node
import * as readline from "node:readline";

const mode = process.env.FAKE_CODEX_MODE ?? "success";

const rl = readline.createInterface({ input: process.stdin });
process.stdin.resume();

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

function sendResponse(id, result) {
  send({ jsonrpc: "2.0", id, result });
}

function sendNotification(method, params) {
  send({ jsonrpc: "2.0", method, params });
}

let turnCount = 0;
const fakeThreadId = "fake-thread-1";
const fakeTurnId = "fake-turn-1";

rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let msg;
  try { msg = JSON.parse(trimmed); } catch { return; }

  if (msg.id !== undefined && msg.method !== undefined) {
    if (msg.method === "initialize") {
      sendResponse(msg.id, {
        codexHome: "/tmp/fake-codex-home",
        platformFamily: process.platform,
        platformOs: process.platform,
        userAgent: "fake-codex/1.0",
      });
    } else if (msg.method === "thread/start") {
      sendResponse(msg.id, { thread: { id: fakeThreadId } });
    } else if (msg.method === "turn/start") {
      if (!msg.params?.threadId) {
        send({ jsonrpc: "2.0", id: msg.id, error: { code: -32602, message: "Missing required param: threadId" } });
        return;
      }
      turnCount++;
      sendResponse(msg.id, { turn: { id: fakeTurnId } });

      if (mode === "success") {
        setTimeout(() => {
          sendNotification("item/agentMessage/delta", { delta: "Working on it...\n", itemId: "item-1", threadId: fakeThreadId, turnId: fakeTurnId });
          setTimeout(() => {
            sendNotification("item/agentMessage/delta", { delta: "Done!\n", itemId: "item-2", threadId: fakeThreadId, turnId: fakeTurnId });
            setTimeout(() => {
              sendNotification("turn/completed", { turn: { id: fakeTurnId, status: "completed" } });
            }, 10);
          }, 10);
        }, 10);
      } else if (mode === "failure") {
        setTimeout(() => process.exit(1), 20);
      } else if (mode === "escalation") {
        setTimeout(() => {
          send({ jsonrpc: "2.0", id: 9001, method: "item/commandExecution/requestApproval", params: {
            command: "git push origin main",
            threadId: fakeThreadId,
            turnId: fakeTurnId,
            itemId: "item-1",
            startedAtMs: Date.now(),
          }});
        }, 10);
      }
    } else if (msg.method === "turn/interrupt") {
      if (!msg.params?.threadId || !msg.params?.turnId) {
        send({ jsonrpc: "2.0", id: msg.id, error: { code: -32602, message: "Missing required params: threadId and turnId" } });
        return;
      }
      sendResponse(msg.id, {});
      setTimeout(() => process.exit(0), 5);
    } else {
      sendResponse(msg.id, {});
    }
  } else if (msg.id !== undefined && msg.result !== undefined) {
    if (msg.result?.decision === "cancel") {
      setTimeout(() => process.exit(0), 5);
    }
  }
});
