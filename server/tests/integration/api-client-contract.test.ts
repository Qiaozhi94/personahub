import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import type { AddressInfo } from "node:net";
import {
  createTestServices,
  disposeTestServices,
  createTempDir,
  cleanupTempDir,
  type TestServices,
} from "../helpers.js";
import { runRoutes } from "../../src/api/routes/runs.js";
import { AppError, getErrorStatus, buildErrorResponse } from "../../src/api/errors.js";
import { ErrorCode } from "@personahub/shared/errors";
// The real browser client, imported across workspaces on purpose: api-client.ts
// only depends on @personahub/shared, so it loads here unchanged. Testing a
// copy of its request-building logic would defeat the point.
import { apiClient } from "../../../web/src/lib/api-client.js";

/**
 * Cross-end contract tests (self-test-system-plan.md §3.1.3, class 6).
 *
 * The seam these cover: every web component test mocks the whole apiClient
 * module (web/src/test/api-client-mock.ts), and web/src/api-client.test.ts
 * stubs global.fetch — so the *request* the client actually builds has never
 * been checked against a server that could reject it. BUG-002 lived exactly
 * there: apiFetch() sent `Content-Type: application/json` on a bodyless POST,
 * Fastify's JSON parser rejected the empty body, and both sides' suites stayed
 * green.
 *
 * So: real apiClient -> real fetch -> real Fastify. The only shim is base-URL
 * resolution (apiClient uses the relative "/api" a browser would), and it
 * forwards method, headers and body untouched. Stubbing fetch here would
 * reintroduce the blind spot.
 */
describe("api-client <-> Fastify request contract", () => {
  let services: TestServices;
  let tempDir: string;
  let app: FastifyInstance;
  let origin: string;
  const originalFetch = globalThis.fetch;
  // Captured server-side, per request: what the client actually put on the
  // wire, not what the client's own tests expect it to.
  const contentTypes = new Map<string, string | undefined>();

  beforeAll(async () => {
    tempDir = createTempDir();
    services = createTestServices();
    app = Fastify();
    app.setErrorHandler((error: Error, _request, reply) => {
      if (error instanceof AppError) {
        reply.code(getErrorStatus(error.code));
        return buildErrorResponse(error);
      }
      reply.code(500);
      return { error: { code: ErrorCode.INTERNAL_ERROR, message: error.message ?? "unexpected", details: {} } };
    });
    // Must be registered before listen(): Fastify rejects addHook on a
    // started instance.
    app.addHook("onRequest", async (request) => {
      contentTypes.set(request.url, request.headers["content-type"]);
    });
    await app.register(runRoutes, {
      runDispatchService: services.runDispatchService,
      runService: services.runService,
    });
    await app.listen({ port: 0, host: "127.0.0.1" });
    origin = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
    globalThis.fetch = (input, init) => originalFetch(new URL(String(input), origin), init);
  });

  afterAll(async () => {
    globalThis.fetch = originalFetch;
    await app.close();
    disposeTestServices(services);
    cleanupTempDir(tempDir);
  });

  it("BUG-002 regression: a bodyless POST reaches the handler instead of failing JSON parsing", async () => {
    // Asserts the terminal state (§3.1.1): the server-side handler ran and
    // produced its own domain error. A Content-Type/body mismatch never gets
    // that far — Fastify rejects it as FST_ERR_CTP_EMPTY_JSON_BODY (400/500)
    // before any route code executes.
    await expect(apiClient.runs.cancel("run_does_not_exist")).rejects.toMatchObject({
      code: ErrorCode.RUN_NOT_FOUND,
    });
  });

  it("sends no Content-Type on a bodyless POST", async () => {
    // Belt-and-braces on the exact header that caused BUG-002, observed on the
    // server side rather than asserted against the client's own expectation.
    const url = "/api/runs/run_header_probe/cancel";
    await expect(apiClient.runs.cancel("run_header_probe")).rejects.toBeDefined();
    expect(contentTypes.has(url)).toBe(true);
    expect(contentTypes.get(url)).toBeUndefined();
  });
});
