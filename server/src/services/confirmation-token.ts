import { createHmac, createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { ConfirmationToken, ConfirmationTokenPayload } from "@personahub/shared/types";
import type { AppSecretRepository } from "../repositories/app-secret.js";

export const HMAC_SECRET_NAME = "intake_token_hmac";
export const HMAC_SECRET_BYTES = 32;

export function generateNonce(): string {
  return randomUUID();
}

/** 规范化序列化 (design §5)：对象键升序、无多余空白、数组保持产出顺序。
 *  签名与验签必须共用同一函数，否则同一内容会算出两个签名。 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
}

export function computeRecommendationId(payload: ConfirmationTokenPayload): string {
  return createHash("sha256").update(canonicalJson(payload)).digest("hex");
}

export class ConfirmationTokenService {
  constructor(private readonly secretKeyBase64: string) {}

  private get key(): Buffer {
    return Buffer.from(this.secretKeyBase64, "base64");
  }

  sign(payload: ConfirmationTokenPayload): ConfirmationToken {
    const canonical = canonicalJson(payload);
    const signature = createHmac("sha256", this.key).update(canonical).digest("base64");
    return { payload, signature };
  }

  verify(token: ConfirmationToken): boolean {
    const canonical = canonicalJson(token.payload);
    const expected = createHmac("sha256", this.key).update(canonical).digest("base64");
    const expectedBuf = Buffer.from(expected, "base64");
    const providedBuf = Buffer.from(token.signature ?? "", "base64");
    return providedBuf.length === expectedBuf.length && timingSafeEqual(providedBuf, expectedBuf);
  }
}

const STRICT_BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function parseSecret(raw: string, name: string): Buffer {
  if (!raw) {
    throw new Error(
      `Fatal configuration error: app secret '${name}' is empty. In-flight confirmation tokens would be unverifiable; refusing to silently regenerate. Delete the row and restart to rotate.`,
    );
  }
  // Strict base64: Buffer.from(raw, "base64") silently ignores non-alphabet
  // characters, so a 32-byte decode can succeed on a value with trailing
  // garbage. Reject any non-canonical encoding (charset, padding) first.
  if (!STRICT_BASE64.test(raw)) {
    throw new Error(
      `Fatal configuration error: app secret '${name}' is not valid base64. In-flight confirmation tokens would be unverifiable; refusing to silently regenerate.`,
    );
  }
  const decoded = Buffer.from(raw, "base64");
  if (decoded.toString("base64") !== raw) {
    throw new Error(
      `Fatal configuration error: app secret '${name}' is not canonical base64. In-flight confirmation tokens would be unverifiable; refusing to silently regenerate.`,
    );
  }
  if (decoded.length !== HMAC_SECRET_BYTES) {
    throw new Error(
      `Fatal configuration error: app secret '${name}' is corrupt (expected ${HMAC_SECRET_BYTES} bytes). Refusing to silently regenerate; delete the row and restart to rotate.`,
    );
  }
  return decoded;
}

/** 密钥生命周期 (design §1)：首次启动生成 32 字节 CSPRNG 并 INSERT；后续启动
 *  读回同一行（跨重启不变）；值损坏/为空则视为致命配置错误启动失败，不静默重生成。 */
export function loadOrCreateHmacSecret(appSecretRepo: AppSecretRepository): string {
  const existing = appSecretRepo.get(HMAC_SECRET_NAME);
  if (existing) {
    parseSecret(existing.value, HMAC_SECRET_NAME);
    return existing.value;
  }
  const generated = randomBytes(HMAC_SECRET_BYTES).toString("base64");
  appSecretRepo.create(HMAC_SECRET_NAME, generated, new Date().toISOString());
  return generated;
}
