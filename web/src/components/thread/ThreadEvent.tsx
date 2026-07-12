import { Fragment } from "react";
import type { ThreadEvent as ThreadEventType } from "@personahub/shared";

interface ThreadEventProps {
  event: ThreadEventType;
}

const FIELD_LABELS: Record<string, string> = {
  issue_id: "issue_id",
  project_id: "project_id",
  workspace_id: "workspace_id",
  issue_type: "issue_type",
  status: "status",
  workflow_template_id: "workflow_template_id",
  validation_policy_id: "validation_policy_id",
  primary_thread_id: "primary_thread_id",
};

export function ThreadEvent({ event }: ThreadEventProps) {
  const payload = event.payload_json;
  const fields = Object.keys(FIELD_LABELS).filter((key) => key in payload);

  return (
    <div className="mx-auto grid w-full max-w-[720px] gap-1.5 rounded-lg border border-l-[3px] border-border border-l-brand bg-card px-3.5 py-3">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[12.5px] font-semibold text-foreground">{event.type}</span>
        <span className="text-[11px] text-muted-foreground">
          {new Date(event.created_at).toLocaleString()}
        </span>
      </div>
      {fields.length > 0 ? (
        <div className="grid grid-cols-[auto_1fr] gap-x-2.5 gap-y-1 font-mono text-xs">
          {fields.map((key) => (
            <Fragment key={key}>
              <span className="text-muted-foreground">{FIELD_LABELS[key]}</span>
              <span className="text-foreground">{String(payload[key])}</span>
            </Fragment>
          ))}
        </div>
      ) : null}
    </div>
  );
}
