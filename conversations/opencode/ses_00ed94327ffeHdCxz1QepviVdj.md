---
tool: "opencode"
tool_name: "OpenCode"
session_id: "ses_00ed94327ffeHdCxz1QepviVdj"
title: "Agent Adapters仅能创建一个？缺少新增按钮"
project: "D:/Projects/personahub"
model: "deepseek-v4-flash"
created_at: "2026-08-11T14:07:55Z"
updated_at: "2026-08-11T14:13:40Z"
tokens_input: 36025
tokens_output: 1668
cost: 0.0
---

# Agent Adapters仅能创建一个？缺少新增按钮

## user · 2026-08-11T14:07:55Z

[search-mode]
MAXIMIZE SEARCH EFFORT. Launch multiple background agents IN PARALLEL:
- explore agents (codebase patterns, file structures, ast-grep)
- librarian agents (remote repos, official docs, GitHub examples)
Plus direct tools: Grep, ripgrep (rg), ast-grep (sg)
NEVER stop at first result - be exhaustive.

---

项目启动起来了，但是发现了一个问题：Agent Adapters创建了一个出来之后没有新增按钮，意思是只能创建一个吗

## assistant · 2026-08-11T14:07:55Z

- **tool**: `grep({"pattern": "[Aa]dapter", "output_mode": "files_with_matches"})`
- **tool**: `bash({"command": "set CI=\"true\" && set DEBIAN_FRONTEND=\"noninteractive\" && set GIT_TERMINAL_PROMPT=\"0\" && set GCM_INTERACTIVE=\"never\" && set HOMEBREW_NO_AUTO_UPDATE=\"1\" && set GIT_EDITOR=\":\" && set EDITOR=\":\" && set VISUAL=\"\" && set GIT_SEQUENCE_EDITOR=\":\" && set GIT_MERGE_AUTOEDIT=\"no\" && set GIT_PAGER=\"cat\" && set PAGER=\"cat\" && set npm_config_yes=\"true\" && set PIP_NO_INPUT=\"1\" && set YARN_ENABLE_IMMUTABLE_INSTALLS=\"false\" && git -C D:\\Projects\\personahub status --sh
…[truncated])`


> [reasoning] The user is asking about a bug: "Agent Adapters created one but no add button, meaning can only create one?"

This is an investigation task. Let me explore the codebase to understand the Agent Adapters feature and how creation works.

Let me start by exploring the codebase structure. This is the personahub project. Let me find relevant files.

Let me launch explore agents in parallel and also do direct searches.
I'll investigate the Agent Adapters creation flow. Let me search in parallel.

  <details><summary>tool output</summary>

  ```text
Found 419 match(es) in 419 file(s)

D:\Projects\personahub\CLAUDE.md

D:\Projects\personahub\conversations\timeline.md

D:\Projects\personahub\conversations\timeline-summary.md

D:\Projects\personahub\conversations\retrospective.md

D:\Projects\personahub\conversations\claude\f1b4399d-deb7-4d04-907a-fa658e6a7bac.md

D:\Projects\personahub\conversations\claude\dc84a73c-434d-49c3-a81f-11bab39ffeba.md

D:\Projects\personahub\conversations\claude\dc155cb5-2087-4fce-8cba-796dff34f29a.md

D:\Projects\personahub\conversations\claude\ced3c86e-85bd-4705-8cc0-ca3da0fa8db9.md

D:\Projects\personahub\conversations\claude\bfe8ad05-e118-40bb-a378-50061e5ac930.md

D:\Projects\personahub\conversations\claude\b8505ce2-8f55-4bb5-83dd-789ab187b320.md

D:\Projects\personahub\conversations\claude\968c8180-d3fa
…[truncated]
  ```
  </details>

  <details><summary>tool output</summary>

  ```text
---BRANCH---
main
  ```
  </details>

## assistant · 2026-08-11T14:08:09Z

- **tool**: `read({"filePath": "D:\\Projects\\personahub\\web\\src\\hooks\\use-adapters.ts"})`
- **tool**: `read({"filePath": "D:\\Projects\\personahub\\web\\src\\components\\adapter\\AdapterSettings.tsx"})`
- **tool**: `read({"filePath": "D:\\Projects\\personahub\\web\\src\\components\\adapter\\AdapterRow.tsx"})`
- **tool**: `read({"filePath": "D:\\Projects\\personahub\\web\\src\\components\\adapter\\AdapterDialog.tsx"})`


> [reasoning] Let me focus on the frontend adapter components. The key files are:
- `web/src/hooks/use-adapters.ts`
- `web/src/components/adapter/AdapterSettings.tsx`
- `web/src/components/adapter/AdapterRow.tsx`
- `web/src/components/adapter/AdapterDialog.tsx`
- `server/src/api/routes/adapters.ts`

Let me read these to understand the creation flow and whether there's an "add" button missing. Let me read the adapter components and the use-adapters hook.
Let me read the key adapter frontend files.

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\web\src\hooks\use-adapters.ts</path>
<type>file</type>
<content>
1: import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
2: import type { AdapterConfigCreateInput, AdapterConfigUpdateInput } from "@personahub/shared";
3: import { apiClient } from "@/lib/api-client";
4: 
5: /**
6:  * `workspaceId` (F005 workspace-aware availability closure): when provided,
7:  * each returned adapter also carries `effective_status`/
8:  * `effective_last_checked_at`/`effective_auth_status_message`/
9:  * `has_workspace_override` — the workspace-effective view
10:  * (`effectiveAdapterStatus()` server-side), which is what actually
11:  * determines routability/validator-selection for THIS workspace and can
12:  * differ from the Project-global `status`. 
…[truncated]
  ```
  </details>

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\web\src\components\adapter\AdapterSettings.tsx</path>
<type>file</type>
<content>
1: import { useState } from "react";
2: import { AlertTriangle } from "lucide-react";
3: import { AdapterStatus, AgentCapability, type AdapterConfig } from "@personahub/shared";
4: import { useAdapters } from "@/hooks/use-adapters";
5: import { useWorkspace } from "@/hooks/use-workspace";
6: import { Button } from "@/components/ui/button";
7: import { AdapterDialog } from "@/components/adapter/AdapterDialog";
8: import { AdapterRow } from "@/components/adapter/AdapterRow";
9: import { effectiveStatusOf } from "@/components/adapter/adapter-status";
10: 
11: interface AdapterSettingsProps {
12:   projectId: string;
13: }
14: 
15: export function AdapterSettings({ projectId }: Adapte
…[truncated]
  ```
  </details>

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\web\src\components\adapter\AdapterRow.tsx</path>
<type>file</type>
<content>
1: import { Trash2, RefreshCw, Cpu, Star } from "lucide-react";
2: import { AdapterStatus, AdapterAuthType, AgentCapability, type AdapterConfig } from "@personahub/shared";
3: import { useDeleteAdapter, useSetDefaultAdapter, useValidateAdapter } from "@/hooks/use-adapters";
4: import { toApiError } from "@/lib/api-client";
5: import { Button } from "@/components/ui/button";
6: import { Badge } from "@/components/ui/badge";
7: import { cn } from "@/lib/utils";
8: import { STATUS_LABEL, STATUS_VARIANT, effectiveStatusOf, formatCheckedAt } from "@/components/adapter/adapter-status";
9: 
10: interface AdapterRowProps {
11:   adapter: AdapterConfig;
12:   projectId: string;
13:   workspaceI
…[truncated]
  ```
  </details>

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\web\src\components\adapter\AdapterDialog.tsx</path>
<type>file</type>
<content>
1: import { useEffect, useState, type FormEvent } from "react";
2: import {
3:   AdapterAuthType,
4:   AgentCapability,
5:   CliProvider,
6:   type AdapterConfig,
7:   type AdapterConfigCreateInput,
8:   type AdapterConfigUpdateInput,
9: } from "@personahub/shared";
10: import { useAdapterProviders, useCreateAdapter, useUpdateAdapter } from "@/hooks/use-adapters";
11: import { toApiError } from "@/lib/api-client";
12: import { Button } from "@/components/ui/button";
13: import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
14: import { Input } from "@/components/ui/input";
15: import { Label } from "@/components/ui/label";
16: import { AdapterAut
…[truncated]
  ```
  </details>

## assistant · 2026-08-11T14:08:18Z

- **tool**: `grep({"output_mode": "content", "pattern": "AdapterSettings", "include": "*.tsx", "path": "D:\\Projects\\personahub\\web\\src"})`
- **tool**: `read({"filePath": "D:\\Projects\\personahub\\server\\src\\api\\routes\\adapters.ts"})`


> [reasoning] The frontend DOES have a "Configure adapter" button in `AdapterSettings.tsx` (line 92-94) which always renders regardless of adapter count. So the "add" button exists in the UI.

Wait, the user said "Agent Adapters创建了一个出来之后没有新增按钮" — after creating one, there's no add button. But looking at AdapterSettings.tsx, the "Configure adapter" button at line 92 always renders.

Hmm, but maybe the user is looking at a different UI. Let me check where AdapterSettings is rendered, and whether there might be a different panel. Also, the user mentions "Agent Adapters" specifically. Let me check where this AdapterSettings component is used, and check the server-side create route for any limit.

Actually wait — maybe the issue is server-side. Maybe the server restricts to one adapter? Let me check the adapters route and the create logic. Also let me check if there's a uniqueness constraint.

Actually, let me re-read. The user says "创建了一个出来之后没有新增按钮，意思是只能创建一个吗" = "After creating one, there's no add button — does that mean you can only create one?"

So the user created one adapter, and then the "add"/"configure" button disappeared? But in the code, the Configure adapter button always renders. Unless... there's another place. Let me check where AdapterSettings is used and if there's a different UI path. Let me also check the server route for any limit.

Let me search where AdapterSettings is rendered and check server adapters route.
The frontend `AdapterSettings.tsx` has a persistent "Configure adapter" button (line 92). Let me check where it's rendered and the server-side create route for any single-adapter limit.

  <details><summary>tool output</summary>

  ```text
Found 26 match(es) in 4 file(s)

D:\Projects\personahub\web\src\App.tsx
  10: import { AdapterSettings } from "@/components/adapter/AdapterSettings";
  115: {selectedProjectId ? <AdapterSettings projectId={selectedProjectId} /> : null}

D:\Projects\personahub\web\src\f002-ui-flows.test.tsx
  14: import { AdapterSettings } from "@/components/adapter/AdapterSettings";
  53: renderWithQuery(<AdapterSettings projectId="prj_1" />);
  80: renderWithQuery(<AdapterSettings projectId="prj_1" />);

D:\Projects\personahub\web\src\f005-adapter-settings.test.tsx
  4: import { AdapterSettings } from "@/components/adapter/AdapterSettings";
  30: renderWithQuery(<AdapterSettings projectId="prj_1" />);
  44: renderWithQuery(<AdapterSettings projectId="prj_1" />);
  53: renderWithQuery(<AdapterSettings proj
…[truncated]
  ```
  </details>

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\server\src\api\routes\adapters.ts</path>
<type>file</type>
<content>
1: import type { FastifyPluginAsync } from "fastify";
2: import { z } from "zod";
3: import type { AdapterConfigService } from "../../services/adapter-config.js";
4: import { AdapterAuthType, AgentCapability } from "@personahub/shared/types";
5: import { getProviderMetadata } from "../../runtime/provider-metadata.js";
6: import { parseRequestBody } from "../errors.js";
7: 
8: export interface AdapterRoutesOptions {
9:   adapterConfigService: AdapterConfigService;
10: }
11: 
12: /**
13:  * Route-boundary schemas (docs/decisions/0005: "只做参数校验（zod）") — the
14:  * service layer trusts these types once past this point. Every field a
15:  * malformed body could send with the wrong JS type (a number 
…[truncated]
  ```
  </details>

## assistant · 2026-08-11T14:08:33Z

- **tool**: `read({"filePath": "D:\\Projects\\personahub\\web\\src\\App.tsx"})`


> [reasoning] So the server create route has no limit. The frontend `AdapterSettings` always shows "Configure adapter" button. There is no single-adapter limit either server or frontend.

So the premise "after creating one, there's no add button" is surprising. Let me look at where AdapterSettings is rendered in App.tsx line 115. Maybe the panel is inside a section and it's collapsed? Or maybe there's a different "Agent Adapters" UI in a sidebar or something.

Actually wait — let me reconsider. The user says "Agent Adapters创建了一个出来之后没有新增按钮". Maybe the user is looking at a different area. Let me check App.tsx to see the layout context of AdapterSettings. Let me also check if there's maybe a collapsed/collapsible panel.

Actually, let me reconsider the whole thing. Perhaps the user's observation is on a different screen. But the most likely scenario: In `AdapterSettings`, the "Configure adapter" button DOES always render. So maybe the user's issue is about a different component.

Wait, but maybe there's caching. Let me check `useAdapters` - after creating one, the query key is `["adapters", projectId, workspaceId ?? null]`. The `useCreateAdapter` onSuccess invalidates `{ queryKey: ["adapters", projectId] }`. In react-query, invalidateQueries with a prefix `["adapters", projectId]` should match `["adapters", projectId, workspaceId]`. That's fine.

Hmm, but the button is outside the conditional - it always shows regardless of adapter count. So there's always a "Configure adapter" button.

Let me check App.tsx to understand the layout. Maybe AdapterSettings is only shown in a certain mode. Let me read App.tsx around line 115.

Actually, maybe the user is describing the actual behavior they see. Let me check if there's a different UI, maybe a workspace/agent panel. Let me look at App.tsx.
The server has no single-adapter limit, and `AdapterSettings` always renders the "Configure adapter" button. Let me check the layout context in `App.tsx` and verify there isn't a different panel rendering "Agent Adapters".

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\web\src\App.tsx</path>
<type>file</type>
<content>
1: import { useEffect, useMemo, useState } from "react";
2: import { Activity, FileText, Plus, Settings, Sparkles } from "lucide-react";
3: import { useProjects } from "@/hooks/use-projects";
4: import { useWorkspace } from "@/hooks/use-workspace";
5: import { useIssue, useIssues } from "@/hooks/use-issues";
6: import { AppLayout } from "@/components/layout/AppLayout";
7: import { ProjectSwitcher } from "@/components/project/ProjectSwitcher";
8: import { CreateProjectDialog } from "@/components/project/CreateProjectDialog";
9: import { WorkspaceBinding } from "@/components/workspace/WorkspaceBinding";
10: import { AdapterSettings } from "@/components/adapter/AdapterSettings";
11: import { IssueList } from "@/co
…[truncated]
  ```
  </details>

## assistant · 2026-08-11T14:08:49Z

- **tool**: `read({"filePath": "D:\\Projects\\personahub\\web\\src\\components\\layout\\AppLayout.tsx"})`
- **tool**: `grep({"include": "*.ts", "output_mode": "content", "path": "D:\\Projects\\personahub\\server\\src\\services\\adapter-config.ts", "pattern": "create|limit|max|already|unique|count"})`


> [reasoning] The "Agent Adapters" section (AdapterSettings) is rendered in the left sidebar at line 115. The "Configure adapter" button is always rendered regardless of adapter count (line 92 of AdapterSettings.tsx).

So the code shows the button always exists. So why would the user see "no add button after creating one"?

Wait — maybe the issue is a rendering/caching issue. Let me reconsider. Let me look at `useAdapters`. When the user creates an adapter via the dialog, `useCreateAdapter.onSuccess` invalidates `["adapters", projectId]`. The query key in `useAdapters` is `["adapters", projectId, workspaceId ?? null]`. Invalidate with prefix `["adapters", projectId]` should match. Fine.

But hold on — maybe the user is actually describing that after creating an adapter, they expected an "add" button but the "Configure adapter" button is labeled as such and maybe... Hmm.

Actually, let me reconsider. Maybe this is a genuinely different scenario. Let me re-read the user's statement: "Agent Adapters创建了一个出来之后没有新增按钮，意思是只能创建一个吗" = "Agent Adapters - after creating one, there's no add button. Does this mean only one can be created?"

So the user is at a screen showing "Agent Adapters" with one adapter, and there's no "add"/"new" button. But the code clearly has a "Configure adapter" button always rendered...

Wait, could it be that the sidebar is scrollable/collapsed and the button is below the fold? The AdapterSettings is in the left sidebar. With many items (ProjectSwitcher, New coding issue, Intake, Issues list, WorkspaceBinding, AdapterSettings, Configuration), the "Configure adapter" button at the bottom of AdapterSettings might be pushed off-screen if the sidebar doesn't scroll. But that's not "no button" — it's a layout/scroll issue.

Hmm, actually let me reconsider. Maybe the user is describing behavior where the "Configure adapter" button IS there initially (before any adapter created, when it shows "No adapter configured" + button), but after creating one, the button... no, the button code is unconditional.

Let me reconsider — maybe I should verify the actual behavior. Perhaps there's a bug where the button only renders conditionally. Let me re-read AdapterSettings lines 57-103. The button at line 92 is unconditional. So it should always appear.

Hold on, maybe the user means something else. Perhaps they're in a different panel — like the "runtime health" dialog or a workspace binding that shows adapters. Let me search more broadly for any UI that lists adapters without an add button.

Actually, wait. Let me reconsider the possibility that this is not actually a code bug, but the user's confusion, OR the layout pushes the button off-screen. Given ADHD instructions, I should give a focused answer.

But actually, I should verify empirically. Let me check if maybe there's a `max` or unique constraint, or maybe the user's observation is legit because of the sidebar scroll. Let me check AppLayout for overflow handling of the sidebar.

Actually, let me reconsider the whole thing more carefully. Let me reconsider: is it possible the user is looking at a specific scenario where the sidebar content overflows and the "Configure adapter" button is cut off? Let me check AppLayout.

Also I should double check: is there possibly a different "Agent Adapters" concept — like the runtime health dialog showing adapters? Let me search for any other place with "Agent Adapters" title.

Actually the grep for AdapterSettings showed only App.tsx and tests. The "Agent Adapters" title is only in AdapterSettings. So there's exactly one place.

Let me verify there's no server-side or data-layer single-adapter restriction. Let me check adapter-config service create for limits.

Actually I already saw the route calls create directly with no limit. Let me check adapter-config.ts create for any limit.

Let me also check the AppLayout for scroll behavior - this is the most likely real cause: the sidebar with the button pushed below viewport.

Let me read AppLayout and adapter-config create.
The "Agent Adapters" panel is in the left sidebar (`App.tsx` line 115), and `AdapterSettings` unconditionally renders the "Configure adapter" button. Let me verify the sidebar layout for overflow and check the server-side create for any limit.

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\web\src\components\layout\AppLayout.tsx</path>
<type>file</type>
<content>
1: import type { ReactNode } from "react";
2: 
3: interface AppLayoutProps {
4:   left: ReactNode;
5:   center: ReactNode;
6:   right: ReactNode;
7: }
8: 
9: export function AppLayout({ left, center, right }: AppLayoutProps) {
10:   return (
11:     <div className="grid h-screen grid-cols-[220px_minmax(420px,1fr)_260px] overflow-hidden xl:grid-cols-[300px_minmax(600px,1fr)_340px]">
12:       <aside className="flex min-w-0 flex-col gap-4 overflow-y-auto overflow-x-hidden border-r border-border bg-secondary px-4 py-4">
13:         {left}
14:       </aside>
15:       <main className="grid min-w-0 grid-rows-[58px_1fr] overflow-hidden bg-background">{center}</main>
16:       <aside className=
…[truncated]
  ```
  </details>

  <details><summary>tool output</summary>

  ```text
Found 5 match(es) in 1 file(s)

D:\Projects\personahub\server\src\services\adapter-config.ts
  48: console.warn("[AdapterConfigService] auto-validate after create/update failed:", error);
  98: create(projectId: string, input: AdapterConfigCreateServiceInput): AdapterConfig {
  125: // capability_tags defaults to [implementation] — F002/F004's create path
  138: // account is logged in / its API key works. Only validate()'s real
  144: const record = this.agentConfigRepo.create({

[Agent Usage Reminder]

You called a search/fetch tool directly without leveraging specialized agents.

RECOMMENDED: Use task with explore/librarian agents for better results:

```
// Parallel exploration - fire multiple agents simultaneously
task(subagent_type="explore", load_skills=[], prompt="Find all files ma
…[truncated]
  ```
  </details>

## assistant · 2026-08-11T14:09:18Z

- **tool**: `bash({"command": "set CI=\"true\" && set DEBIAN_FRONTEND=\"noninteractive\" && set GIT_TERMINAL_PROMPT=\"0\" && set GCM_INTERACTIVE=\"never\" && set HOMEBREW_NO_AUTO_UPDATE=\"1\" && set GIT_EDITOR=\":\" && set EDITOR=\":\" && set VISUAL=\"\" && set GIT_SEQUENCE_EDITOR=\":\" && set GIT_MERGE_AUTOEDIT=\"no\" && set GIT_PAGER=\"cat\" && set PAGER=\"cat\" && set npm_config_yes=\"true\" && set PIP_NO_INPUT=\"1\" && set YARN_ENABLE_IMMUTABLE_INSTALLS=\"false\" && git -C D:\\Projects\\personahub log --oneli
…[truncated])`


> [reasoning] The sidebar is `overflow-y-auto`, so the "Configure adapter" button could be below the fold, but it's still scrollable. Not "no button".

Let me look at the adapter-config create function fully to confirm no limit. Let me read lines 98-160.

Actually, the grep showed no limit logic. The create calls `agentConfigRepo.create` directly. No count check, no max. So server supports multiple.

So the answer to the user's question "does that mean only one can be created?" is: **No**. Both the frontend and backend support multiple adapters. The "Configure adapter" button always exists.

But the user observed no button after creating one. Given the code, this is likely a **rendering/caching** issue OR a **layout/scroll** issue, OR the user is mistaken/confused about where the button is.

Wait, let me reconsider. Let me re-read the AdapterSettings more carefully. When `adapters.length > 0`, line 82-90 shows a ValidatorWarning. The button is at line 92 always. So the button is definitely there.

Hmm. But wait — could there be a scenario where the query fails to refetch and the button... no, the button is unconditional.

Let me reconsider the possibility that the user means: initially the panel shows "No adapter configured" + "Configure adapter" button. After creating one, the button disappears from their view because... it's below the fold in the sidebar? The sidebar is scrollable though.

Actually, let me reconsider whether the user might be seeing a stale/cached UI. Or maybe there is an actual bug I'm missing. Let me re-examine: is there any chance the "Configure adapter" button is only rendered when adapters.length === 0 somewhere? No, it's unconditional at line 92.

Hmm, wait. Let me reconsider. Maybe the user is NOT talking about this AdapterSettings sidebar panel. Maybe "Agent Adapters" is something in the runtime-health dialog or somewhere. But grep showed the "Agent Adapters" title only appears in AdapterSettings.tsx.

Actually, let me reconsider once more. Perhaps the issue is a genuine React Query bug: after creating the first adapter, the `useAdapters` query refetches, but maybe there's an infinite or the button... no.

OK here's another thought. Maybe the real issue is the sidebar scroll. With `h-screen` and the sidebar `overflow-y-auto`, if the window is short, the "Configuration" section with `mt-auto` and AdapterSettings push the "Configure adapter" button below the visible area, requiring scroll. The user might not realize it scrolls, OR there's a `mt-auto` pushing content.

Actually, let me step back and think about what's most useful. The user is asking a question: "does that mean only one can be created?" This is an investigation + question intent, NOT an implementation request. Per intent gate, I should answer/analyze only.

So my job: determine the truth and answer clearly.

Findings:
1. Server: no limit — multiple adapters supported. Route `POST /api/projects/:id/adapters` calls `create()` with no count/max check.
2. Frontend: `AdapterSettings` always renders a "Configure adapter" button (line 92), regardless of how many adapters exist. So the add button is always present in code.

So logically, the user's observation ("no add button after creating one") contradicts the code. Possible explanations:
- The button is pushed below the fold in the sidebar (needs scroll). The sidebar `overflow-y-auto` on `h-screen` with lots of content (ProjectSwitcher, buttons, Issues, WorkspaceBinding, AdapterSettings, Configuration mt-auto) — on a short window, "Configure adapter" is below the visible area.
- A stale frontend build / caching.

Wait, but actually, let me reconsider. Is it possible that the button is there but the user just didn't scroll? That's plausible given the sidebar content is long and `mt-auto` on Configuration pushes things.

Actually, let me reconsider whether I should verify by actually checking git log / recent changes to AdapterSettings. Maybe the "Configure adapter" button was recently added or there's an intentional single-adapter design in an older version. But the current code is what matters.

Hmm, let me reconsider if maybe the real issue is something I haven't checked: maybe the `isLoading` guard. On first render `isLoading` might be true and it shows "Loading…" without the button. But once loaded, button shows.

Let me also reconsider: maybe there's a genuine rendering bug where the sidebar sections overlap. But I think the most defensible answer is:

**No, you can create multiple adapters.** Both UI and backend support it. The "Configure adapter" button always renders. If you don't see it, it's almost certainly scrolled below the fold in the left sidebar (the sidebar is `overflow-y-auto` and content is long), or a stale build.

Actually, wait. Let me reconsider whether maybe I should actually check if the button is rendered only conditionally in some branch. Let me re-read lines 57-103 once more:

```jsx
return (
    <section className="grid min-w-0 gap-1.5">
      <div className="flex items-center justify-between px-2.5">
        <span>Agent Adapters</span>
        {adapters.length > 0 ? <span>{adapters.length}</span> : null}
      </div>
      {adapters.length === 0 ? (<No adapter configured>) : (map AdapterRow)}
      {warnings}
      <Button variant="secondary" size="sm" className="w-full" onClick={openCreate}>
        Configure adapter
      </Button>
      <AdapterDialog ... />
    </section>
  );
```

Yes — the "Configure adapter" button is unconditional. So there IS always an add button in the current code.

So the answer: No, multiple adapters are supported. The button should always be there. If it's not visible, check the sidebar scroll.

Hmm, but I want to be careful. Maybe I should actually verify by checking whether the user might have an older build. But I can't verify user's runtime. 

Let me reconsider — is it possible the user is right and I'm looking at modified code? The git status earlier was empty (clean working tree). So the code in the repo is what runs (assuming built).

Let me double-check there's not a second "Agent Adapters" rendering path with a different button condition. I already confirmed via grep that AdapterSettings is only used in App.tsx. Good.

Let me also verify there's no CSS hiding the button. The button is `variant="secondary" size="sm" w-full`. Nothing hiding it.

I think I have enough to answer. But per the search-mode, I should be thorough. Let me consider whether the sidebar scroll is genuinely the issue. The sidebar has: ProjectSwitcher, "New coding issue" button, "Intake" button, Issues section, WorkspaceBinding, AdapterSettings, then Configuration section with `mt-auto`. The `mt-auto` on the Configuration section pushes it to the bottom of the sidebar. If the sidebar content is taller than the viewport, both AdapterSettings and Configuration could be partially visible, and the "Configure adapter" button (bottom of AdapterSettings) might be cut off below, requiring a scroll.

Given the sidebar is `overflow-y-auto`, you can scroll. But the user might not realize.

Actually, I realize I should give the user a clear, actionable answer rather than over-investigate. Let me also offer to actually fix it if they want (e.g., add a plus icon to the header, or make the button more discoverable). But per intent gate — the user asked a question, not to implement. So answer + offer.

Actually, let me reconsider if maybe I should verify this more rigorously by checking git history to see if the "Configure adapter" button was recently added, which would confirm the user is running an older build. Let me check git log for AdapterSettings.tsx.

Let me do a quick git log to see recent changes to this file. This could confirm whether the button is new.
Let me check git history on the AdapterSettings to see if the add button is a recent change (possible stale build on the user's side).

  <details><summary>tool output</summary>

  ```text
e7e8a22 refactor: 按职责拆分 adapter config / run dispatch / validation / AdapterSettings 热点文件
43b8f5c fix(F005): 修复前端 UI 检视报告发现的三栏布局裁切与 Inspector 自动滚动问题
8e4fe15 fix(F005): 收尾两处遗留架构问题——AC-001 语义修复与 workspace-aware availability
855e4b6 feat(F005): Phase 11 — Adapter Settings UI（provider/auth级联、capability勾选、default管理）
91b2a44 feat(F005): Phase 4 T025-T034 AdapterConfigService/registry/AuthMaterial
2aae7ac feat(F005): Phase 2 T011-T013 shared 类型契约与错误码
408d656 feat(F004): 固化 autonomous-validation 在制品基线，含 F003 code review 修复
934b51b Add frontend: adapter settings, thread events, inspector logs, SSE reconnect, run management
---STATUS---
99094e9 docs(review): close F009 document review
49c7fc2 docs(f009): finalize artifact provenance contract
5f819c0 test(migration): stabilize rollback test timeout

…[truncated]
  ```
  </details>

## assistant · 2026-08-11T14:10:15Z


> [reasoning] The "Configure adapter" button has been there since F005 Phase 11 (855e4b6). It's been there a long time. So the current code always has the button.

I have enough to answer. The answer:

**No, you can create multiple adapters.** Both frontend and backend support it. The "Configure adapter" button always renders regardless of how many adapters exist. The server create route has no limit/unique constraint.

So if you don't see the button after creating one, it's NOT because you're limited to one. Likely causes:
1. The button is scrolled below the fold in the left sidebar (sidebar is `overflow-y-auto`, content is long — ProjectSwitcher, buttons, Issues, WorkspaceBinding, AdapterSettings, and a `mt-auto` Configuration section).
2. Stale frontend build.

I should give a clear answer and offer to make the button more discoverable (e.g., a "+" icon in the "Agent Adapters" header, or ensure the panel is visible). But I should NOT implement without being asked, since this was a question.

Let me give a focused answer. This is a question intent — answer only, then offer.

Actually, I should be careful about one thing: is it possible the user's actual running code differs? The working tree is clean and matches HEAD. So the code has the button. The most likely explanation is the sidebar scroll / visibility.

Let me answer concisely with the ADHD format: lead with answer.
## 结论：不是只能创建一个。可以创建多个。

**代码证据（当前工作树干净，即仓库里跑的就是这个）：**

1. **前端** — `AdapterSettings.tsx` 第 92 行，"Configure adapter" 按钮**无条件渲染**，跟已有 adapter 数量无关：
   ```tsx
   <Button variant="secondary" size="sm" className="w-full" onClick={openCreate}>
     Configure adapter
   </Button>
   ```
   这个按钮自 F005（commit `855e4b6`）起就一直在。

2. **后端** — `server/src/api/routes/adapters.ts` 的 `POST /api/projects/:id/adapters` 直接调 `adapterConfigService.create()`，**没有任何数量上限 / 唯一约束 / 去重逻辑**。`adapter-config.ts` 里 create 也是直接写库，无 limit 检查。

## 那为什么你看到"没有新增按钮"？

最可能的原因（按概率排序）：

1. **按钮被挤到侧边栏折叠线以下了**。`AdapterSettings` 放在左侧边栏（`App.tsx:115`），侧边栏内容很长（ProjectSwitcher + 2 个按钮 + Issues 列表 + WorkspaceBinding + AdapterSettings + `mt-auto` 的 Configuration 区）。侧边栏是 `overflow-y-auto`，窗口矮时 "Configure adapter" 需要**往下滚动**才看得到。
2. **前端是旧构建/缓存**——你跑的 bundle 里可能没有这个按钮。

## 建议的下一步（可选）

如果你愿意，我可以把按钮做得更醒目/不会被挤出可视区，比如：
- 在 "Agent Adapters" 标题栏右侧加一个 `+` 图标按钮（`AdapterSettings.tsx:60` 那行 `justify-between` 处）
- 或把 "Configure adapter" 按钮移到列表上方/标题旁

要我改吗？还是你先滚动确认一下是不是滚动的问题？

## user · 2026-08-11T14:13:29Z

意思是Configure adapter按钮再次点开配置的就是新的adapter吗

## assistant · 2026-08-11T14:13:29Z


> [reasoning] The user asks: "So clicking 'Configure adapter' again opens config for a new adapter, right?" 

Yes. Let me confirm from the code. In AdapterSettings, `openCreate()` sets `setEditingAdapter(null)` and opens dialog. In AdapterDialog, when editingAdapter is null, isEdit=false, so it's create mode. So clicking "Configure adapter" always opens a fresh create form.

Let me answer concisely.
对。**每次点 "Configure adapter" 都是新建一个**，不是编辑已有的。

代码逻辑（`AdapterSettings.tsx:24-27`）：
```tsx
function openCreate() {
  setEditingAdapter(null);   // 关键：清空"正在编辑"状态
  setDialogOpen(true);
}
```

`AdapterDialog.tsx` 里 `isEdit = editingAdapter !== null`：
- `editingAdapter === null` → `isEdit = false` → 走 **create** 分支（表单全空，标题 "Configure adapter"，按钮 "Create"）
- 只有点某一行 adapter 的名字（`AdapterRow` 的 `onEdit`）才会 `setEditingAdapter(adapter)` → 走 edit 分支

所以：
- **"Configure adapter" 按钮** = 新增（每次都是空白新表单）
- **某行 adapter 名字** = 编辑那个已有的

两者是独立的。你创建了一个之后，再点 "Configure adapter" 就能创建第二个、第三个……没有数量限制。
