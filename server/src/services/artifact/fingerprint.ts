import { createHash } from "node:crypto";

/**
 * Request fingerprint for artifact create/revise idempotency (design §4):
 * the SHA-256 of the canonical (sorted-key) request JSON excluding volatile
 * fields (timestamps). Equal fingerprints on an idempotency-key collision mean
 * "same request replayed" and return the existing revision; different
 * fingerprints surface ARTIFACT_IDEMPOTENCY_CONFLICT instead of silently
 * reusing unrelated content.
 */

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export function canonicalizeJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return value.map(canonicalizeJson);
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, JsonValue> = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = canonicalizeJson(value[key]);
    }
    return out;
  }
  return value;
}

export function canonicalRequestFingerprint(payload: Record<string, JsonValue>): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalizeJson(payload)))
    .digest("hex");
}
