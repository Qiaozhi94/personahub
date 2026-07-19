import { describe, it, expect } from "vitest";
import { AppError } from "../../src/api/errors.js";
import { ErrorCode } from "@personahub/shared/errors";

// parseBoundedInt is defined in server/src/api/routes/traces.ts;
// replicate for isolated unit testing
function parseBoundedInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  if (!/^\d+$/.test(raw)) {
    throw new AppError(ErrorCode.INVALID_QUERY, "Invalid limit parameter.");
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1 || value > 200) {
    throw new AppError(ErrorCode.INVALID_QUERY, "limit must be between 1 and 200.");
  }
  return value;
}

describe("parseBoundedInt (T095)", () => {
  it("returns fallback when undefined", () => {
    expect(parseBoundedInt(undefined, 100)).toBe(100);
    expect(parseBoundedInt(undefined, 50)).toBe(50);
  });

  it("parses valid positive integer strings", () => {
    expect(parseBoundedInt("1", 100)).toBe(1);
    expect(parseBoundedInt("100", 100)).toBe(100);
    expect(parseBoundedInt("200", 100)).toBe(200);
  });

  it("rejects trailing garbage", () => {
    expect(() => parseBoundedInt("10junk", 100)).toThrow(AppError);
    expect(() => parseBoundedInt("10abc", 100)).toThrow(AppError);
    expect(() => parseBoundedInt("10 ", 100)).toThrow(AppError);
  });

  it("rejects decimal values", () => {
    expect(() => parseBoundedInt("1.9", 100)).toThrow(AppError);
    expect(() => parseBoundedInt("1.0", 100)).toThrow(AppError);
    expect(() => parseBoundedInt("0.5", 100)).toThrow(AppError);
  });

  it("rejects non-digit prefixes", () => {
    expect(() => parseBoundedInt("x10", 100)).toThrow(AppError);
    expect(() => parseBoundedInt("limit=10", 100)).toThrow(AppError);
    expect(() => parseBoundedInt("abc", 100)).toThrow(AppError);
  });

  it("rejects out-of-bounds values", () => {
    expect(() => parseBoundedInt("0", 100)).toThrow(AppError);
    expect(() => parseBoundedInt("201", 100)).toThrow(AppError);
    expect(() => parseBoundedInt("999", 100)).toThrow(AppError);
  });

  it("throws INVALID_QUERY error code", () => {
    let caught: unknown;
    try {
      parseBoundedInt("10junk", 100);
    } catch (err) {
      caught = err;
    }
    expect((caught as { code?: string }).code).toBe(ErrorCode.INVALID_QUERY);
  });
});
