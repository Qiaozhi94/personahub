import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const API_BASE = "http://127.0.0.1:4321/api";

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
 * if the routes regress. Adapters are left at their post-create status
 * (Unknown) deliberately: the layout assertions don't need a real CLI probe
 * to pass, and this suite must run on hosts without codex/claude/opencode
 * installed.
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
    { name: "Codex Implementer", cli_provider: "codex", command: "codex", capability_tags: ["implementation"] },
    {
      name: "Claude Validator With A Fairly Long Descriptive Adapter Name",
      cli_provider: "claude-code",
      command: "claude",
      default_model: "claude-opus-5-thinking",
      capability_tags: ["implementation", "validator"],
    },
    {
      name: "OpenCode Backup",
      cli_provider: "opencode",
      command: "opencode",
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
