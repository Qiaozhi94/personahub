import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { API_BASE } from "./env.js";

async function api<T>(method: string, urlPath: string, body?: unknown): Promise<T> {
  const res = await fetch(API_BASE + urlPath, {
    method,
    headers: { "content-type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new Error(`${method} ${urlPath} -> ${res.status}: ${text}`);
  }
  return data as T;
}

export interface SeededIssue {
  projectId: string;
  projectName: string;
  workspaceId: string;
  issueId: string;
  threadId: string;
  adapterIds: string[];
}

/**
 * Binds a real (but throwaway) long-ish directory so the Workspace path
 * card exercises the same wrapping the F005 layout review flagged, without
 * depending on any real project checkout being present on the test host.
 */
function ensureWorkspaceDir(): string {
  const dir = path.join(os.tmpdir(), "personahub-e2e-workspace", "layout-regression-fixture");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Seeds one Project with a bound workspace, three adapters (one with a long
 * name to exercise badge wrapping), and one Issue — entirely through the
 * public HTTP API, so this fixture breaks the same way a real client would
 * if the routes regress.
 *
 * Use deliberately unresolvable commands (`personahub-e2e-fixture-*`,
 * guaranteed not to resolve on PATH on any machine) so layout fixtures
 * never invoke real locally installed provider CLIs or pass fixture
 * credentials to them. This also matters beyond isolation hygiene:
 * AdapterConfigService.create() only kicks off its async real-provider
 * validate() probe when the command *does* resolve (status Unknown) — on a
 * dev machine with real codex/claude/opencode CLIs on PATH, a resolvable
 * command here would fire a real probe against them (complete with the
 * fake OpenCode API key below), observed taking 20-30s+ per adapter before
 * this fixture used unresolvable commands.
 */
export async function seedProjectWithAdapters(namePrefix: string): Promise<SeededIssue> {
  const suffix = Date.now().toString(36);
  const projectName = `${namePrefix} ${suffix}`;
  const { project } = await api<{ project: { id: string } }>("POST", "/projects", {
    name: projectName,
  });

  const { workspace } = await api<{ workspace: { id: string } }>(
    "PUT",
    `/projects/${project.id}/workspace`,
    { local_path: ensureWorkspaceDir() },
  );

  const adapterDefs = [
    {
      name: "Codex Implementer",
      cli_provider: "codex",
      command: "personahub-e2e-fixture-codex",
      capability_tags: ["implementation"],
    },
    {
      name: "Claude Validator With A Fairly Long Descriptive Adapter Name",
      cli_provider: "claude-code",
      command: "personahub-e2e-fixture-claude",
      default_model: "claude-opus-5-thinking",
      capability_tags: ["implementation", "validator"],
    },
    {
      name: "OpenCode Backup",
      cli_provider: "opencode",
      command: "personahub-e2e-fixture-opencode",
      auth_type: "api_key",
      model_provider: "openai",
      default_model: "gpt-4o-mini",
      api_key: "sk-e2e-fixture-not-real",
      capability_tags: ["implementation"],
    },
  ];

  const adapterIds: string[] = [];
  for (const def of adapterDefs) {
    const { adapter } = await api<{ adapter: { id: string } }>(
      "POST",
      `/projects/${project.id}/adapters`,
      def,
    );
    adapterIds.push(adapter.id);
  }

  const { issue } = await api<{ issue: { id: string; primary_thread: { id: string } } }>(
    "POST",
    `/projects/${project.id}/issues`,
    {
      title: "Fix add function so it also validates negative and floating point inputs correctly",
      goal: "add function should reject invalid input and cover edge cases",
      priority: "normal",
    },
  );

  return {
    projectId: project.id,
    projectName,
    workspaceId: workspace.id,
    issueId: issue.id,
    threadId: issue.primary_thread.id,
    adapterIds,
  };
}
