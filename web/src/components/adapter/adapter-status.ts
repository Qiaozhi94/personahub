import { AdapterStatus, type AdapterConfig } from "@personahub/shared";

export const STATUS_VARIANT: Record<AdapterStatus, "success" | "destructive" | "secondary"> = {
  [AdapterStatus.Available]: "success",
  [AdapterStatus.Unavailable]: "destructive",
  [AdapterStatus.Unknown]: "secondary",
};

export const STATUS_LABEL: Record<AdapterStatus, string> = {
  [AdapterStatus.Available]: "available",
  [AdapterStatus.Unavailable]: "unavailable",
  [AdapterStatus.Unknown]: "unknown",
};

export function effectiveStatusOf(adapter: AdapterConfig): AdapterStatus {
  return adapter.effective_status ?? adapter.status;
}

export function formatCheckedAt(iso: string | null): string {
  if (!iso) return "never validated";
  try {
    return `checked ${new Date(iso).toLocaleString()}`;
  } catch {
    return "checked at unknown time";
  }
}
