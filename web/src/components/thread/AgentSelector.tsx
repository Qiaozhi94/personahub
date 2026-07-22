import { AdapterStatus, AgentCapability, IssueStatus, type AdapterConfig } from "@personahub/shared";
import { previewRunRouting } from "@/lib/routing-preview";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";

/**
 * design §10.2: always visible (never hidden for a single/zero-adapter
 * Project); marks the Project default; keeps unavailable adapters in the
 * list but disabled with their reason; previews the purpose/role the
 * server will derive — preview only, the real Run's metadata always comes
 * from what the server returns (never this component's guess).
 */
export interface AgentSelectorProps {
  adapters: AdapterConfig[];
  /** null = omit adapter_id, let the server resolve the Project default. */
  selectedAdapterId: string | null;
  onSelect: (adapterId: string | null) => void;
  issueStatus: IssueStatus;
  explicitConsult: boolean;
  onExplicitConsultChange: (consult: boolean) => void;
}

const CAPABILITY_LABEL: Record<AgentCapability, string> = {
  [AgentCapability.Implementation]: "implementation",
  [AgentCapability.Validator]: "validator",
};

export function AgentSelector({
  adapters, selectedAdapterId, onSelect, issueStatus, explicitConsult, onExplicitConsultChange,
}: AgentSelectorProps) {
  const defaultAdapter = adapters.find((a) => a.is_default) ?? null;
  const resolvedAdapter = selectedAdapterId
    ? adapters.find((a) => a.id === selectedAdapterId) ?? null
    : defaultAdapter;

  const preview = resolvedAdapter
    ? previewRunRouting(issueStatus, resolvedAdapter.capability_tags, explicitConsult)
    : null;

  return (
    <div className="grid gap-1.5">
      <div className="flex items-center gap-2">
        <Label htmlFor="agent-selector" className="shrink-0 text-xs text-muted-foreground">
          Agent
        </Label>
        <select
          id="agent-selector"
          aria-label="Agent"
          className="h-7 flex-1 rounded-md border border-input bg-background px-2 text-xs text-foreground"
          value={selectedAdapterId ?? ""}
          onChange={(e) => onSelect(e.target.value || null)}
        >
          <option value="">
            {defaultAdapter ? `Project default (${defaultAdapter.name})` : "Project default (none set)"}
          </option>
          {adapters.map((a) => {
            const unavailable = a.status !== AdapterStatus.Available;
            const suffix = [
              a.is_default ? "default" : null,
              unavailable ? (a.auth_status_message ? `unavailable — ${a.auth_status_message}` : "unavailable") : null,
            ].filter(Boolean).join(", ");
            return (
              <option key={a.id} value={a.id} disabled={unavailable}>
                {a.name}{suffix ? ` (${suffix})` : ""}
              </option>
            );
          })}
        </select>
        <label className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={explicitConsult}
            onChange={(e) => onExplicitConsultChange(e.target.checked)}
          />
          Ask (consult)
        </label>
      </div>

      {resolvedAdapter ? (
        <div className="flex items-center gap-1.5 pl-[52px] text-[11px] text-muted-foreground">
          {resolvedAdapter.capability_tags.map((cap) => (
            <Badge key={cap} variant="secondary" className="text-[9px]">
              {CAPABILITY_LABEL[cap]}
            </Badge>
          ))}
          {preview?.allowed ? (
            <span>{preview.label}</span>
          ) : preview && !preview.allowed ? (
            <span>Issue is in a terminal status — no new Runs can be dispatched</span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
