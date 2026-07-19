export const CODEX_FINAL_MESSAGE_MAX_BYTES = 64 * 1024;

interface AgentMessageItem {
  type?: unknown;
  phase?: unknown;
  text?: unknown;
}

export class CodexFinalMessageCapture {
  private finalMessage: string | null = null;

  handleNotification(method: string, params: Record<string, unknown> | undefined): void {
    if (method !== "item/completed") return;
    if (!params) return;
    const item = params.item as AgentMessageItem | undefined;
    if (!item || typeof item !== "object") return;
    if (item.type !== "agentMessage") return;
    if (item.phase !== "final_answer") return;
    if (typeof item.text !== "string") return;
    this.finalMessage = item.text;
  }

  getFinalMessage(): string | null {
    return this.finalMessage;
  }

  reset(): void {
    this.finalMessage = null;
  }
}

export function truncateFinalMessage(
  text: string | null,
  maxBytes: number = CODEX_FINAL_MESSAGE_MAX_BYTES,
): string | null {
  if (text === null) return null;
  const byteLength = Buffer.byteLength(text, "utf8");
  if (byteLength <= maxBytes) return text;
  const buf = Buffer.from(text, "utf8");
  return buf.subarray(0, maxBytes).toString("utf8");
}
