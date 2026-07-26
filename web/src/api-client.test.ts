import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { apiClient } from "@/lib/api-client";
import { ErrorCode } from "@personahub/shared";

/**
 * Final-comprehensive-report regression: every other test file mocks the
 * whole `@/lib/api-client` module (`vi.mock("@/lib/api-client", ...)`), so
 * none of them exercise apiFetch()'s actual fetch/Response parsing. That let
 * a real bug through — `apiFetch()` called `res.json()` unconditionally on
 * any `res.ok`, including a 204 No Content DELETE response with an empty
 * body, which throws a SyntaxError and surfaces as a false mutation
 * failure even though the server-side delete succeeded. These tests stub
 * `global.fetch` directly and return real `Response` objects, not mocks of
 * apiClient itself.
 */
describe("apiFetch response parsing (bypasses the apiClient module mock other tests use)", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("adapters.delete() resolves (not throws) on a real 204 No Content response with an empty body", async () => {
    vi.mocked(global.fetch).mockResolvedValue(new Response(null, { status: 204 }));

    await expect(apiClient.adapters.delete("agt_1")).resolves.toBeUndefined();
  });

  it("a 200 response with a real JSON body still parses correctly", async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      new Response(JSON.stringify({ adapters: [] }), { status: 200, headers: { "Content-Type": "application/json" } }),
    );

    await expect(apiClient.adapters.listByProject("prj_1")).resolves.toEqual({ adapters: [] });
  });

  it("a non-ok response with a real JSON error body still throws the parsed ApiError", async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      new Response(
        JSON.stringify({ error: { code: ErrorCode.ADAPTER_NOT_FOUND, message: "not found" } }),
        { status: 404, headers: { "Content-Type": "application/json" } },
      ),
    );

    await expect(apiClient.adapters.delete("agt_missing")).rejects.toMatchObject({ code: ErrorCode.ADAPTER_NOT_FOUND });
  });

  it("a non-ok response with an unparsable body falls back to a generic ApiError instead of throwing a raw SyntaxError", async () => {
    vi.mocked(global.fetch).mockResolvedValue(new Response("not json", { status: 500 }));

    await expect(apiClient.adapters.delete("agt_1")).rejects.toMatchObject({ code: ErrorCode.INTERNAL_ERROR });
  });
});
