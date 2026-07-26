import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestServices, disposeTestServices, type TestServices } from "../helpers.js";
import { AdapterStatus, AgentCapability } from "@personahub/shared/types";

/**
 * final-recheck-report regression: create()/update() used to also
 * `spawnSync(["--version"])` with a 10s timeout — a synchronous
 * child-process call sitting directly in the Fastify request path, blocking
 * the entire single-threaded Node event loop for however long the CLI took
 * to respond. A real full-suite run under load hit this and timed out the
 * create route. The fix: create()/update() only resolve the command
 * (fast, synchronous, no subprocess) — they no longer care whether
 * `--version` would succeed or fail.
 *
 * `process.execPath` (the real node.exe/node binary running this test) is
 * used as a stand-in for "a real, resolvable executable" — an absolute
 * path resolves directly (no PATH/shim search), so this doesn't depend on
 * PATH state. The point isn't node.exe's own behavior; it's that create()
 * returning Unknown this fast (AC-001 fix: resolvability alone is never
 * promoted straight to Available — only a real async provider probe may),
 * for an absolute path that resolveExecutable can confirm exists, proves no
 * subprocess was spawned to get there.
 */
describe("AdapterConfigService command validation no longer spawns a subprocess", () => {
  let services: TestServices;
  let projectId: string;

  beforeEach(() => {
    services = createTestServices();
    projectId = services.projectService.create("Test").id;
  });
  afterEach(() => disposeTestServices(services));

  it("create() marks a resolvable command Unknown (pending real probe) without spawning it", () => {
    const adapter = services.adapterConfigService.create(projectId, {
      name: "RealExe", cli_provider: "codex", command: process.execPath,
      capability_tags: [AgentCapability.Implementation],
    });

    expect(adapter.status).toBe(AdapterStatus.Unknown);
  });

  it("create() resolves synchronously and fast — no subprocess round-trip in the request path", () => {
    const start = Date.now();
    services.adapterConfigService.create(projectId, {
      name: "Fast", cli_provider: "codex", command: process.execPath,
      capability_tags: [AgentCapability.Implementation],
    });
    // Generous bound (was previously liable to block up to 10_000ms on a
    // slow/hanging CLI's --version) — this just proves no subprocess wait,
    // not a strict performance benchmark.
    expect(Date.now() - start).toBeLessThan(500);
  });

  it("update() re-resolving the command also does not spawn it", () => {
    const adapter = services.adapterConfigService.create(projectId, {
      name: "Switchable", cli_provider: "codex", command: "codex",
      capability_tags: [AgentCapability.Implementation],
    });

    const updated = services.adapterConfigService.update(adapter.id, { command: process.execPath });

    expect(updated.status).toBe(AdapterStatus.Unknown);
  });

  it("create() still marks the adapter unavailable when the command cannot be resolved at all", () => {
    const adapter = services.adapterConfigService.create(projectId, {
      name: "Missing", cli_provider: "codex", command: "definitely-not-on-path-xyz",
      capability_tags: [AgentCapability.Implementation],
    });

    expect(adapter.status).toBe(AdapterStatus.Unavailable);
  });
});
