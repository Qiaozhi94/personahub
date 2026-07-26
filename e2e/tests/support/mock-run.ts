import type { Page } from "@playwright/test";

/**
 * Intercepts the Runs/ThreadEvents endpoints for one Issue and returns a
 * synthetic completed Run with enough `run.output` chunks to make the Run
 * Logs box internally scrollable and push the Inspector past one screen —
 * the exact shape that used to trigger IssueInspector's
 * `scrollIntoView()` regression (it dragged the whole right sidebar down
 * to the log tail instead of leaving the Inspector scrolled to the top).
 * Mocked rather than driven through a real adapter because the HTTP API
 * only accepts the codex/claude_code/opencode providers, none of which are
 * guaranteed installed on a CI/test host — this keeps the layout
 * regression test independent of any real CLI being available.
 */
export async function mockCompletedRunWithLogs(
  page: Page,
  opts: { issueId: string; threadId: string; workspaceId: string; adapterId: string; lineCount?: number },
): Promise<void> {
  const lineCount = opts.lineCount ?? 40;
  const now = new Date().toISOString();
  const runId = "run_mock_e2e";

  const run = {
    id: runId,
    issue_id: opts.issueId,
    thread_id: opts.threadId,
    workspace_id: opts.workspaceId,
    adapter_config_id: opts.adapterId,
    status: "completed",
    failure_reason: null,
    instructions: "mock instructions for layout regression test",
    started_at: now,
    completed_at: now,
    exit_code: 0,
    error_message: null,
    role: "implementation",
    workflow_step: "implementation",
    validation_round: null,
    dispatch_source: "user_explicit",
    adapter_identity: {
      adapter_config_id: opts.adapterId,
      name: "Codex Implementer",
      cli_provider: "codex",
      default_model: "gpt-5.1-high-reasoning-preview",
    },
    has_final_message: false,
    purpose: "workflow_bound",
    context_source_run_id: null,
    created_at: now,
    updated_at: now,
  };

  const events = [
    {
      id: "evt_mock_0",
      event_sequence: 0,
      thread_id: opts.threadId,
      type: "issue.created",
      actor_type: "system",
      actor_id: null,
      payload_json: {},
      evidence_refs: [],
      created_at: now,
    },
    {
      id: "evt_mock_1",
      event_sequence: 1,
      thread_id: opts.threadId,
      type: "run.started",
      actor_type: "agent",
      actor_id: opts.adapterId,
      payload_json: { run_id: runId },
      evidence_refs: [],
      created_at: now,
    },
    ...Array.from({ length: lineCount }, (_, i) => ({
      id: `evt_mock_output_${i}`,
      event_sequence: i + 2,
      thread_id: opts.threadId,
      type: "run.output",
      actor_type: "agent",
      actor_id: opts.adapterId,
      payload_json: {
        run_id: runId,
        chunk: `[mock] line ${i + 1} of simulated adapter stdout for the auto-scroll regression check\n`,
        stream: "stdout",
        sequence: i + 1,
      },
      evidence_refs: [],
      created_at: now,
    })),
    {
      id: "evt_mock_last",
      event_sequence: lineCount + 2,
      thread_id: opts.threadId,
      type: "run.completed",
      actor_type: "agent",
      actor_id: opts.adapterId,
      payload_json: { run_id: runId },
      evidence_refs: [],
      created_at: now,
    },
  ];

  await page.route(`**/api/issues/${opts.issueId}/runs`, (route) =>
    route.fulfill({ json: { runs: [run] } }),
  );
  await page.route(`**/api/threads/${opts.threadId}/events`, (route) =>
    route.fulfill({ json: { events } }),
  );
}
