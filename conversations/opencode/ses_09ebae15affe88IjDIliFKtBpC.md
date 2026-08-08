---
tool: "opencode"
tool_name: "OpenCode"
session_id: "ses_09ebae15affe88IjDIliFKtBpC"
title: "Explore F001 tasks and architecture docs (@explore subagent)"
project: "D:/Projects/personahub"
model: "deepseek-v4-flash"
created_at: "2026-07-14T15:35:47Z"
updated_at: "2026-07-14T15:36:58Z"
tokens_input: 47451
tokens_output: 5694
cost: 0.0086
parent_id: "ses_09ebc25a8ffe7RrQUtTRsL8v77"
---

# Explore F001 tasks and architecture docs (@explore subagent)

## user · 2026-07-14T15:35:47Z

[CONTEXT]: I'm working on PersonaHub. F001 is complete and I need to understand the existing architecture and system design documents, plus how F001 tasks were structured.

[GOAL]: Understand the global architecture (runtime, storage, agent adapter boundaries), system design (data models), and F001's completed task patterns.

[DOWNSTREAM]: I need to ensure F002 implementation follows the architecture boundaries and that new data models (Run, adapter config, workspace lock) align with the system design.

[REQUEST]: Read and summarize:
1. D:\Projects\personahub\docs\personahub-architecture.md - focus on sections about agent adapter, runtime, storage, event layer, workspace lock, safety/escalation
2. D:\Projects\personahub\docs\personahub-system-design.md - focus on data models for Agent, Run, Workspace, Issue, Thread, ThreadEvent
3. D:\Projects\personahub\docs\features\0.1\F001-workspace-issue-foundation\tasks.md - understand the task completion pattern
4. D:\Projects\personahub\docs\decisions\0005-code-directory-structure.md - understand code directory structure rules
5. D:\Projects\personahub\docs\decisions\0002-first-agent-adapter.md - understand why Codex CLI was chosen
6. D:\Projects\personahub\docs\decisions\0003-backend-runtime.md - understand backend runtime choice

Return: architecture constraints that F002 must follow, existing data model definitions, and the task execution pattern from F001.
<!-- OMO_INTERNAL_INITIATOR -->

## assistant · 2026-07-14T15:35:47Z

- **tool**: `read({"filePath": "D:\\Projects\\personahub\\docs\\personahub-architecture.md"})`
- **tool**: `read({"filePath": "D:\\Projects\\personahub\\docs\\personahub-system-design.md"})`
- **tool**: `read({"filePath": "D:\\Projects\\personahub\\docs\\features\\0.1\\F001-workspace-issue-foundation\\tasks.md"})`
- **tool**: `read({"filePath": "D:\\Projects\\personahub\\docs\\decisions\\0005-code-directory-structure.md"})`
- **tool**: `read({"filePath": "D:\\Projects\\personahub\\docs\\decisions\\0002-first-agent-adapter.md"})`
- **tool**: `read({"filePath": "D:\\Projects\\personahub\\docs\\decisions\\0003-backend-runtime.md"})`


> [reasoning] The user wants me to read and summarize several documentation files to understand the architecture, system design, task patterns, and key decisions for PersonaHub. Let me start by reading all these files in parallel.
<analysis>
**Literal Request**: Read and summarize 6 specific documentation files about architecture, system design, F001 tasks, and key decisions.

**Actual Need**: Understand architecture boundaries, data models, and task patterns so F002 implementation aligns with existing structure. They need constraints (what they MUST follow), definitions (existing data models), and patterns (how F001 structured work).

**Success Looks Like**: A concise reference document that tells them:
- What architectural boundaries F002 must not cross
- What data models already exist (and their fields)
- How F001 tasks were structured (so F002 can follow same pattern)
- Why key decisions were made (Codex CLI, backend runtime, directory structure)
</analysis>

Let me read all 6 files in parallel:

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\docs\personahub-architecture.md</path>
<type>file</type>
<content>
1: ---
2: topics: [architecture, runtime, module-design, agent-team-os]
3: doc_kind: design
4: created: 2026-07-12
5: ---
6: 
7: # PersonaHub 软件架构设计
8: 
9: > Status: draft | Owner: TBD
10: 
11: ## 与 PRD / 数据模型文档的关系
12: 
13: 本文档承载"整体怎么搭"的实现级设计：模块划分、运行时/进程模型、存储与通信层、agent adapter 抽象。产品判断、范围和路线仍以 `docs/personahub-prd.md` 为唯一真相源（PRD 第 16 节）；字段级数据模型以 `docs/personahub-system-design.md` 为准，本文档不重复定义表结构，只在必要处引用。
14: 
15: 本版本已根据 `docs/personahub-architecture-review.md` 的评审意见修订，重点补齐了 CLI agent 执行权限模型、workspace 锁崩溃恢复、事件流 cursor/replay 契约、Agent Adapter 会话模型、Artifact 落点五处此前遗漏的实质缺口。
16: 
17: ### 设计深度边界
18: 
19: 按 PRD 第 15 节的版本路线，本文档的设计深度分两档，避免"过度平台化"（PRD 第 13 节风险）：
20: 
21: - **主干做到能撑住 v0.7**：运行时/进程模型、agent ada
…[truncated]
  ```
  </details>

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\docs\personahub-system-design.md</path>
<type>file</type>
<content>
1: ---
2: feature_ids: []
3: related_features: []
4: topics: [design, data-model, agent-team-os]
5: doc_kind: design
6: created: 2026-07-11
7: ---
8: 
9: # PersonaHub 系统设计草案：数据模型
10: 
11: > Status: draft | Owner: TBD
12: 
13: ## 与 PRD 的关系
14: 
15: 本文档从 `docs/personahub-prd.md` 拆出，承载数据模型这类实现级别的设计内容。产品判断、范围和路线仍以 PRD 为唯一真相源（见 PRD 第 16 节"文档关系"）；本文档描述的是"如何实现"，会随实现推进比 PRD 更频繁地变化，字段增删、拆表、类型调整不需要同步修改 PRD。
16: 
17: PRD 第 5 节"核心概念"是这些实体的产品语义来源，本文档只补充字段级细节，不重复定义概念。
18: 
19: 模块划分、运行时/进程模型、存储与通信层等"整体怎么搭"的设计见 `docs/personahub-architecture.md`，本文档不重复定义，只提供该文档引用的字段级 schema。
20: 
21: ## 数据模型草案
22: 
23: ```text
24: Project
25:   id
26:   name
27:   description
28:   default_workspace_id
29:   default_coordinator
…[truncated]
  ```
  </details>

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\docs\features\0.1\F001-workspace-issue-foundation\tasks.md</path>
<type>file</type>
<content>
1: ---
2: feature_ids: [F001]
3: related_features: []
4: topics: [project, workspace, issue, thread, sqlite, api, ui, v0.1.0]
5: doc_kind: tasks
6: created: 2026-07-12
7: updated: 2026-07-13
8: ---
9: 
10: # F001：Workspace & Issue Foundation - 任务
11: 
12: > Status: draft | Owner: TBD | Spec: `spec.md` | Design: `design.md`
13: 
14: ## 规则
15: 
16: - 任务应当能追踪到 `spec.md` 中的需求 ID。
17: - 只有当任务修改不同文件且没有顺序依赖时，才标记 `[P]`。
18: - 标记需求完成前，应先添加或更新对应测试。
19: - 本 feature 不实现 agent execution、Run lifecycle、validation loop、Room、Artifact、Memory 或 Skill 行为。
20: 
21: ## Phase 1：项目初始化与存储基础
22: 
23: - [x] T001（`DR-001` - `DR-007`）：按 `design.md` 第 3 节已定的方案（版本化内联 SQL + `schema_version` 表，参考 clow
…[truncated]
  ```
  </details>

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\docs\decisions\0005-code-directory-structure.md</path>
<type>file</type>
<content>
1: ---
2: topics: [decision, code-structure, monorepo, backend, frontend]
3: doc_kind: decision
4: status: accepted
5: created: 2026-07-13
6: ---
7: 
8: # 0005: 代码目录结构约定
9: 
10: ## 背景
11: 
12: F001 实现过程中已经自然长出一套 npm workspaces monorepo 结构（`shared/` / `server/` / `web/`），分层也已经比较清楚（server 的 api/services/repositories/db，web 的 components-by-domain + hooks/lib/types）。但这套结构从未被写成文档：`CLAUDE.md` 里"随着技术选型和代码规范落地，在此补充实际的目录结构"这句话一直是占位。结果是新代码往哪放全靠现场比照已有文件，容易在后续 feature（尤其是不同的人/agent 实现）里跑偏。本决策把已经在用、效果良好的结构正式确认下来，作为后续 F002-F005 都要遵守的约定，而不是重新设计一套。
13: 
14: ## 决策
15: 
16: ### 顶层结构
17: 
18: npm workspaces monorepo，三个包：
19: 
20: ```text
21: personahub/
22:   shared/     @personahub/shared  — 前后端共享
…[truncated]
  ```
  </details>

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\docs\decisions\0002-first-agent-adapter.md</path>
<type>file</type>
<content>
1: ---
2: topics: [decision, tech-stack, agent-adapter]
3: doc_kind: decision
4: status: accepted
5: created: 2026-07-12
6: ---
7: 
8: # 0002: P0 首个 agent adapter 选择 Codex CLI
9: 
10: ## 背景
11: 
12: PersonaHub PRD 第 14 节曾把"P0 首个 agent adapter 先做 Codex CLI、Claude Code 还是 OpenCode"列为阻塞项：不拍板，v0.1.0 无法真正开始排期。
13: 
14: ## 决策
15: 
16: P0 首个接入的本地 coding CLI adapter 是 Codex CLI。Coding agent adapter registry 预留 Claude Code、OpenCode 等多 adapter 扩展点，但 P0 不要求同时支持三个。
17: 
18: ## 理由
19: 
20: 当前 PersonaHub 的产品打磨和真实使用场景就发生在 Codex 工作流中，dogfooding 反馈回路最短。P0 最重要的不是同时适配多个 agent，而是验证 PersonaHub 能否管住一个真实 agent 的执行、事件、证据和验证闭环。
21: 
22: ## 影响
23: 
24: - `docs/personahub-prd.md` 第 8 节 P0 功能列表中 "Coding agent ad
…[truncated]
  ```
  </details>

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\docs\decisions\0003-backend-runtime.md</path>
<type>file</type>
<content>
1: ---
2: topics: [decision, tech-stack, backend]
3: doc_kind: decision
4: status: accepted
5: created: 2026-07-12
6: ---
7: 
8: # 0003: 本地 API 后端运行时选择 Node.js + TypeScript
9: 
10: ## 背景
11: 
12: `docs/decisions/0001-frontend-stack.md` 定了前端 Vite + React + "本地 API"，但"本地 API"用什么语言/运行时实现一直是 TBD（`CLAUDE.md` Backend 项）。整体软件架构设计（`docs/personahub-architecture.md`）需要先确定这一项，才能落地进程模型、agent adapter 子进程管理、SQLite 访问方式和事件流实现。
13: 
14: ## 决策
15: 
16: 本地 API 后端采用 Node.js + TypeScript。
17: 
18: ## 理由
19: 
20: - 与前端 Vite + React 同语言、共享类型定义（例如 ThreadEvent、Issue 等实体类型可在 frontend/backend 间直接复用），减少个人开发的上下文切换成本。
21: - Node.js 的 `child_process` 管理本地 CLI 子进程（P0 是 Codex CLI）、SSE/WebSocket 事件推送、`better-sqlite3` 访问本
…[truncated]
  ```
  </details>

## assistant · 2026-07-14T15:35:56Z

- **tool**: `read({"filePath": "D:\\Projects\\personahub"})`
- **tool**: `read({"filePath": "D:\\Projects\\personahub\\docs\\features\\0.1"})`
- **tool**: `glob({"pattern": "**/*.ts", "path": "D:\\Projects\\personahub\\server\\src"})`
- **tool**: `glob({"pattern": "**/*.ts", "path": "D:\\Projects\\personahub\\shared\\src"})`


> [reasoning] Now I have all the information from the 6 documents. Let me compile a comprehensive summary covering:

1. Architecture constraints F002 must follow
2. Existing data model definitions
3. F001 task execution pattern

Let me also check for the actual implementation to see what currently exists in the codebase to give better context.
Now let me verify the actual code structure to cross-reference with the documents:

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub</path>
<type>directory</type>
<entries>
.agents/
.claude/
.git/
.gitignore
.history/
.playwright-mcp/
.sisyphus/
AGENTS.md
BACKLOG.md
CLAUDE.md
docs/
node_modules/
package-lock.json
package.json
server/
shared/
tsconfig.base.json
web/

(18 entries)
</entries>
  ```
  </details>

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\docs\features\0.1</path>
<type>directory</type>
<entries>
F001-workspace-issue-foundation/
F002-agent-command-center/
F003-development-trace/
F004-autonomous-validation/
F005-multi-agent-manual-routing/
ux-prototype.html

(6 entries)
</entries>
  ```
  </details>

  <details><summary>tool output</summary>

  ```text
Found 22 file(s)

D:\Projects\personahub\server\src\repositories\thread-event.ts
D:\Projects\personahub\server\src\services\thread.ts
D:\Projects\personahub\server\src\services\issue.ts
D:\Projects\personahub\server\src\services\workspace.ts
D:\Projects\personahub\server\src\services\project.ts
D:\Projects\personahub\server\src\repositories\workspace.ts
D:\Projects\personahub\server\src\repositories\workflow-template.ts
D:\Projects\personahub\server\src\repositories\validation-policy.ts
D:\Projects\personahub\server\src\repositories\thread.ts
D:\Projects\personahub\server\src\repositories\project.ts
D:\Projects\personahub\server\src\repositories\issue.ts
D:\Projects\personahub\server\src\index.ts
D:\Projects\personahub\server\src\id.ts
D:\Projects\personahub\server\src\db\schema-v1.ts
D:\P
…[truncated]
  ```
  </details>

  <details><summary>tool output</summary>

  ```text
Found 3 file(s)

D:\Projects\personahub\shared\src\types\index.ts
D:\Projects\personahub\shared\src\index.ts
D:\Projects\personahub\shared\src\errors\index.ts
  ```
  </details>

## assistant · 2026-07-14T15:36:02Z

- **tool**: `read({"filePath": "D:\\Projects\\personahub\\shared\\src\\types\\index.ts"})`
- **tool**: `read({"filePath": "D:\\Projects\\personahub\\shared\\src\\errors\\index.ts"})`
- **tool**: `read({"filePath": "D:\\Projects\\personahub\\docs\\features\\0.1\\F002-agent-command-center"})`
- **tool**: `read({"filePath": "D:\\Projects\\personahub\\server\\src\\index.ts"})`


> [reasoning] Now let me also look at the actual existing shared types and the F002 spec/design to understand what F002 is about, since the user mentions "F002" needs to follow these constraints.
Let me also check the existing F002 and shared types to provide complete context:

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\shared\src\types\index.ts</path>
<type>file</type>
<content>
1: export interface Project {
2:   id: string;
3:   name: string;
4:   description: string | null;
5:   default_workspace_id: string | null;
6:   default_coordinator_agent_id: string | null;
7:   created_at: string;
8:   updated_at: string;
9: }
10: 
11: export interface Workspace {
12:   id: string;
13:   project_id: string;
14:   local_path: string;
15:   git_branch: string | null;
16:   lock_state: WorkspaceLockState;
17:   locked_by_run_id: string | null;
18:   created_at: string;
19:   updated_at: string;
20: }
21: 
22: export interface Issue {
23:   id: string;
24:   project_id: string;
25:   workspace_id: string;
26:   primary_thread_id: string | null;
27:   issue_type: IssueType;
28:   workflo
…[truncated]
  ```
  </details>

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\shared\src\errors\index.ts</path>
<type>file</type>
<content>
1: import type {
2:   Project,
3:   ProjectWithWorkspace,
4:   Workspace,
5:   Issue,
6:   IssueWithThread,
7:   Thread,
8:   ThreadEvent,
9:   IssueType,
10:   IssuePriority,
11: } from "../types/index.js";
12: 
13: export enum ErrorCode {
14:   PROJECT_NAME_REQUIRED = "PROJECT_NAME_REQUIRED",
15:   PROJECT_NOT_FOUND = "PROJECT_NOT_FOUND",
16:   WORKSPACE_PATH_REQUIRED = "WORKSPACE_PATH_REQUIRED",
17:   WORKSPACE_PATH_NOT_FOUND = "WORKSPACE_PATH_NOT_FOUND",
18:   WORKSPACE_PATH_NOT_READABLE = "WORKSPACE_PATH_NOT_READABLE",
19:   WORKSPACE_NOT_FOUND = "WORKSPACE_NOT_FOUND",
20:   ISSUE_TITLE_REQUIRED = "ISSUE_TITLE_REQUIRED",
21:   ISSUE_GOAL_REQUIRED = "ISSUE_GOAL_REQUIRED",
22:   ISSUE_PRIORITY_INV
…[truncated]
  ```
  </details>

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\docs\features\0.1\F002-agent-command-center</path>
<type>directory</type>
<entries>
design.md
spec.md
tasks.md

(3 entries)
</entries>
  ```
  </details>

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\server\src\index.ts</path>
<type>file</type>
<content>
1: import Fastify from "fastify";
2: import cors from "@fastify/cors";
3: import { ErrorCode } from "@personahub/shared/errors";
4: import { openDatabase } from "./db/index.js";
5: import { ProjectRepository } from "./repositories/project.js";
6: import { WorkspaceRepository } from "./repositories/workspace.js";
7: import { IssueRepository } from "./repositories/issue.js";
8: import { ThreadRepository } from "./repositories/thread.js";
9: import { ThreadEventRepository } from "./repositories/thread-event.js";
10: import { WorkflowTemplateRepository } from "./repositories/workflow-template.js";
11: import { ValidationPolicyRepository } from "./repositories/validation-policy.js";
12: import { ProjectService }
…[truncated]
  ```
  </details>

## assistant · 2026-07-14T15:36:09Z

- **tool**: `read({"filePath": "D:\\Projects\\personahub\\docs\\features\\0.1\\F002-agent-command-center\\design.md"})`
- **tool**: `read({"filePath": "D:\\Projects\\personahub\\docs\\features\\0.1\\F002-agent-command-center\\spec.md"})`
- **tool**: `read({"filePath": "D:\\Projects\\personahub\\docs\\features\\0.1\\F002-agent-command-center\\tasks.md"})`


> [reasoning] Now let me also look at the F002 design and spec to understand what F002 is about, as the user mentioned Run data model and agent adapter config.
Let me check the F002 design and spec to understand what F002 is planning:

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\docs\features\0.1\F002-agent-command-center\design.md</path>
<type>file</type>
<content>
1: ---
2: feature_ids: [F002]
3: related_features: [F001]
4: topics: [agent-adapter, codex-cli, run-events, workspace-lock, escalation, api, ui, v0.1.1]
5: doc_kind: design
6: created: 2026-07-12
7: updated: 2026-07-12
8: ---
9: 
10: # F002：Agent Command Center - 设计
11: 
12: > Status: draft | Owner: TBD | Spec: `spec.md`
13: 
14: ## 1. 技术概要
15: 
16: F002 在 F001 的 Project / Workspace / Issue / Thread 基础上，加入最小可运行 agent runtime：
17: 
18: ```text
19: Thread user instruction
20:   -> Run created
21:   -> Workspace write lock acquired
22:   -> CodexCliAdapter started
23:   -> stdout/stderr persisted as ThreadEvents
24:   -> Inspector shows status/logs
25:   -> Run terminal state

…[truncated]
  ```
  </details>

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\docs\features\0.1\F002-agent-command-center\spec.md</path>
<type>file</type>
<content>
1: ---
2: feature_ids: [F002]
3: related_features: [F001]
4: topics: [agent-adapter, codex-cli, run-events, workspace-lock, escalation, v0.1.1]
5: doc_kind: spec
6: created: 2026-07-12
7: updated: 2026-07-12
8: ---
9: 
10: # F002：Agent Command Center
11: 
12: > Status: spec | Owner: TBD | Target: v0.1.1
13: 
14: ## 0. 规格元信息
15: 
16: - **PRD 来源**：`docs/personahub-prd.md` 第 4.1、7.3、8、10、11、12、15 节。
17: - **架构来源**：`docs/personahub-architecture.md` 第 2、3、4、8、9 节；第 5 节仅引用 workflow dispatch / context 组装相关判断，不引用 validation loop。
18: - **系统设计来源**：`docs/personahub-system-design.md` 中的 Agent、Workspace、Issue、Thread、ThreadEvent、Run。
19: - **上游决策**：`docs/decisions/0002-first-agent-adapter
…[truncated]
  ```
  </details>

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\docs\features\0.1\F002-agent-command-center\tasks.md</path>
<type>file</type>
<content>
1: ---
2: feature_ids: [F002]
3: related_features: [F001]
4: topics: [agent-adapter, codex-cli, run-events, workspace-lock, escalation, api, ui, v0.1.1]
5: doc_kind: tasks
6: created: 2026-07-12
7: updated: 2026-07-12
8: ---
9: 
10: # F002：Agent Command Center - 任务
11: 
12: > Status: draft | Owner: TBD | Spec: `spec.md` | Design: `design.md`
13: 
14: ## 规则
15: 
16: - 任务应当能追踪到 `spec.md` 中的需求 ID。
17: - 先用 `FakeAgentAdapter` 建立可测 runtime，再接真实 Codex CLI。
18: - 标记需求完成前，应先添加或更新对应测试。
19: - 不实现 handoff、validation、artifact、多 adapter 或完整 sandbox/isolation。
20: - 如果 Codex CLI probe 结果改变 design 假设，先更新 `design.md` 再继续实现。
21: 
22: ## Phase 1：Codex CLI 能力 Probe
23: 
24: - [ ] T001（`FR-001`
…[truncated]
  ```
  </details>

## assistant · 2026-07-14T15:36:14Z


> [reasoning] Now I have all the information needed to provide a comprehensive summary. Let me organize this into a clear response that covers:

1. Architecture constraints F002 must follow
2. Existing data model definitions (both from system-design.md and shared/types)
3. F001 task execution pattern
4. Key decisions that influence F002

Let me compose a detailed response.
<results>
<files>
- /D:/Projects/personahub/docs/personahub-architecture.md - Global architecture: runtime model, agent adapter abstraction, workspace lock, safety/escalation
- /D:/Projects/personahub/docs/personahub-system-design.md - Data model definitions (all entities and fields)
- /D:/Projects/personahub/docs/features/0.1/F001-workspace-issue-foundation/tasks.md - F001 task completion pattern reference
- /D:/Projects/personahub/docs/features/0.1/F002-agent-command-center/spec.md - F002 spec (requirements, acceptance criteria)
- /D:/Projects/personahub/docs/features/0.1/F002-agent-command-center/design.md - F002 design (data models, API contracts, runtime)
- /D:/Projects/personahub/docs/features/0.1/F002-agent-command-center/tasks.md - F002 task breakdown (Phases 1-9)
- /D:/Projects/personahub/docs/decisions/0005-code-directory-structure.md - Code directory structure rules
- /D:/Projects/personahub/docs/decisions/0002-first-agent-adapter.md - Why Codex CLI (dogfooding, shortest feedback loop)
- /D:/Projects/personahub/docs/decisions/0003-backend-runtime.md - Why Node.js + TypeScript (shared types, child_process, SQLite)
- /D:/Projects/personahub/shared/src/types/index.ts - Live shared TypeScript types for all entities
- /D:/Projects/personahub/shared/src/errors/index.ts - Live shared error codes and API shapes
- /D:/Projects/personahub/server/src/index.ts - Server entry point showing current wiring pattern
</files>

---

## Architecture Constraints F002 Must Follow

### 1. Runtime / Process Model (Architecture §2)
- **Single-process local mode** for v0.1–v0.6: one Node.js process holds SQLite connection + workspace lock + agent runner
- **Workspace lock with crash recovery**: `Workspace` must have `locked_at`, `lease_expires_at`, `runner_instance_id` fields (arch §2). Lock state stored in DB, not just memory
- **Run lifecycle**: `queued -> running -> completed/failed/interrupted/cancelled` (arch §2). `interrupted` is distinct from `failed`/`cancelled` — models process crash vs agent failure vs user cancel
- **Startup stale recovery**: scan all `status = running` Runs on startup → mark `interrupted`, release workspace locks (arch §2)
- **v0.7 readiness**: even though v0.1 uses simple behavior, design for daemon/multi-workspace/isolation from day 1 (arch §2 table)

### 2. Agent Adapter Boundaries (Architecture §3)
- **One-shot invocation per Thread instruction**: each user command = new Run (not long-lived process). Context assembled by Workflow Engine, not CLI process memory
- **`CodexCliAdapter` is P0 only** (Decision 0002). Registry reserves `ClaudeCodeAdapter`/`OpenCodeAdapter` extension points but P0 doesn't require them
- **Adapter responsibility boundary**: adapter ONLY handles CLI subprocess interaction + output→structured events. NOT workflow ordering, NOT validation — those belong to Workflow Engine / Validation Policy

### 3. Event / Trace Layer (Architecture §4)
- **ThreadEvent is the single source of truth**. Events types include: `issue.created`, `run.started`, `run.completed`, `handoff.created`, `validation.passed`, `escalation.triggered`, `issue.blocked`
- **Write to SQLite first, then broadcast** — supports offline replay on reconnect
- **Cursor/replay contract**: ThreadEvent has globally monotonically increasing `id` for sort/dedup; SSE uses `Last-Event-ID`; explicit `?after_event_id=` query param
- **Event envelope**: `{id, type, thread_id, issue_id, payload, created_at}` — decoupled from transport (SSE now, WebSocket later)

### 4. Storage Layer (Architecture §6)
- **SQLite WAL mode** for v0.1–v0.6. Business code accesses ONLY through Repository layer — never raw SQL in business logic
- **Repository per entity**: each `system-design.md` entity gets a corresponding repository
- **Postgres/pgvector optional in v0.7**: only needs new Repository implementation, no Workflow Engine / Runner changes

### 5. Safety / Escalation (Architecture §9)
- **Execution boundary**: cwd = workspace.local_path, env vars whitelisted. Agent subprocess starts inside workspace
- **Credential isolation (primary defense)**: default NO git push credentials (no SSH agent, no cached HTTPS creds). `WorkspaceContext` explicitly provides them via `push_credentials_enabled`
- **Pre-execution interception (optional observability enhancement)**: if Codex CLI exposes approval hooks, adapter can use them. NOT the security baseline
- **Post-hoc detection (backstop)**: detects violations (irreversible deletes, cross-workspace writes) after the fact
- **Workspace write lock**: before spawning agent, atomically check/write `Workspace.lock_state` in Repository layer. If lock unavailable, Run queues
- **No "arbitrary dangerous command" blacklist** — scope is git push/force push, cross-workspace writes, irreversible deletes only

### 6. Code Directory Structure (Decision 0005)
- **npm workspaces monorepo**: `shared/`, `server/`, `web/`
- **Server layers** (strict one-way): `routes → services → repositories → db`
  - `routes/`: zod validation, call service, serialize response. NO direct db access
  - `services/`: business rules, transaction boundaries, cross-repository orchestration, throw AppError
  - `repositories/`: pure DB access via prepared statements. NO business logic, NO AppError
  - `db/`: `openDatabase()`, `applyMigrations()`, `schema-v{N}.ts` versioned inline SQL
- **Web layers** (strict one-way): `components → hooks → apiClient`
  - Components call hooks, never `fetch` directly
  - Hooks use `apiClient` from `lib/api-client.ts`
  - `components/ui/` = shadcn/ui (no business logic), `components/<domain>/` = business components
  - Types re-exported from `shared/`, not redefined
- **New domain = 4 new files**: `routes/<domain>.ts`, `services/<domain>.ts`, `repositories/<domain>.ts`, `db/schema-v{N}.ts` migration
- **New frontend resource = 3 new files**: `lib/api-client.ts` method, `hooks/use-<domain>.ts`, `components/<domain>/` UI

---

## Existing Data Model Definitions

### From `shared/src/types/index.ts` (LIVE — these are the canonical types):

| Entity | Key Fields |
|--------|-----------|
| **Project** | `id, name, description, default_workspace_id, default_coordinator_agent_id, created_at, updated_at` |
| **Workspace** | `id, project_id, local_path, git_branch, lock_state (Idle\|Locked), locked_by_run_id, created_at, updated_at` |
| **Issue** | `id, project_id, workspace_id, primary_thread_id, issue_type (coding), workflow_template_id, validation_policy_id, title, goal, status (Inbox\|Ready\|Running\|Validating\|Done\|Blocked), owner_agent_id, coordinator_agent_id, priority (low\|normal\|high), labels[], validation_round_count, created_at, updated_at` |
| **Thread** | `id, issue_id, room_id, thread_type (primary\|room\|incident\|council), title, created_at, updated_at` |
| **ThreadEvent** | `id, event_sequence (number), thread_id, type (issue.created), actor_type (user\|agent\|system), actor_id, payload_json (Record), evidence_refs (string[]), created_at` |
| **WorkflowTemplate** | `id, name, issue_type, collaboration_topology, agent_team_template_id, validation_policy_id, steps_json, handoff_policy_json, evidence_requirements_json, status, version, created_at, updated_at` |
| **ValidationPolicy** | `id, name, issue_type, pass_conditions_json, fail_conditions_json, evidence_requirements_json, max_validation_rounds, status, version, created_at, updated_at` |

### From `system-design.md` (draft — NOT yet in shared types, needs implementation):

| Entity | Key Fields |
|--------|-----------|
| **Run** | `id, issue_id, thread_id, agent_id, status, validation_round_count, started_at, completed_at, exit_code` |
| **Agent** | `id, name, role, cli_provider, runtime_id, capability_tags, default_model, system_instructions` |
| **HandoffPacket** | `id, issue_id, thread_id, from_agent_id, to_agent_id, to_room_id, current_phase, payload_json, artifact_refs, evidence_refs, created_at` |
| **WorkRoom** | `id, issue_id, thread_id, phase, goal, topology, leader_agent_id, member_agent_ids_json, input_contract_json, output_contract_json, evidence_requirements_json, budget_policy_json, termination_condition_json, status, created_at, updated_at` |
| **EvidenceSummary** | `id, issue_id, content_markdown, validation_result, source_event_ids, created_at` |
| **Artifact** | `id, issue_id, thread_id, room_id, run_id, artifact_type, title, storage_type, uri_or_content_ref, evidence_refs, created_by_agent_id, created_at, updated_at` |
| **AgentTeamTemplate** | `id, name, issue_type, roles_json, default_assignments_json` |
| **Memory** | `id, project_id, source_issue_id, source_thread_id, source_event_ids, type, content, confidence, originating_input_trust_level, human_confirmed, created_by, created_at` |
| **Skill** | `id, name, trigger, issue_type, topology, roles_json, phase_plan_json, instructions, output_schema, verification, provenance_json` |
| **ProvenanceGateDecision** | `id, target_type, target_id, source_issue_id, source_thread_id, source_event_ids, input_trust_level, decision, decided_by, created_at` |

### F002 Additions (from F002 design.md §3 — to be implemented in F002):
- **Agent/Adapter Config**: `id, project_id, name, role, cli_provider (codex), command, args[], capability_tags, default_model, status (unknown|available|unavailable), last_checked_at`
- **Run (extended)**: Add `workspace_id, adapter_config_id, failure_reason (enum), instructions, error_message`
- **Workspace (extended)**: Add `locked_at, lock_owner_instance_id, push_credentials_enabled (bool, default false)`
- **Run status enum**: `queued, running, completed, failed, interrupted, cancelled`
- **Failure reason enum**: `adapter_exit_nonzero, spawn_failed, execution_timeout, credential_isolation_blocked, pre_execution_approval_rejected, post_hoc_escalation, server_restarted, output_parse_failed`
- **ThreadEvent types (new)**: `run.queued, run.started, run.output, run.output_truncated, run.completed, run.failed, run.cancelled, run.interrupted, escalation.triggered, issue.blocked`

---

## F001 Task Execution Pattern

### Structure
F001 used **6 phases** with numbered tasks (T001–T038), each tracking back to `spec.md` requirement IDs:
1. **Phase 1: Storage Foundation** — migrations, schema, repositories
2. **Phase 2: Backend Services** — domain services (Project, Workspace, Issue, Thread)
3. **Phase 3: Backend API** — Fastify route handlers
4. **Phase 4: Frontend UI** — React components + hooks + apiClient
5. **Phase 5: Tests** — unit tests `[P]` (parallel), integration tests, UI/E2E
6. **Phase 6: Manual Verification & Documentation** — Windows paths, git detection, acceptance checklist walkthrough, system-design.md sync, BACKLOG.md update

### Key Patterns
- **`[P]` marker** = parallel tasks (no file conflict or sequential dependency)
- **Every task references spec requirement IDs** (e.g., `FR-003`, `DR-002`, `TR-001`)
- **Tests before completion**: tasks say "mark requirement done AFTER adding/updating tests"
- **Final phase always includes**: updating `system-design.md` if schema differs, updating `BACKLOG.md`
- **Phase blocking**: earlier phases block later ones (storage → services → API → UI → tests)
- **Boundary enforcement**: explicit non-goals stated upfront (e.g., "F001 does NOT implement agent execution, Run lifecycle, validation loop, Room, Artifact, Memory, or Skill")

### F001 Outcome
The code structure that emerged from F001 is now formalized in Decision 0005. Existing server has:
- 4 route files: `projects.ts`, `workspaces.ts`, `issues.ts`, `threads.ts`
- 4 service files: `project.ts`, `workspace.ts`, `issue.ts`, `thread.ts`
- 6 repository files: `project.ts`, `workspace.ts`, `issue.ts`, `thread.ts`, `thread-event.ts`, `workflow-template.ts`, `validation-policy.ts`
- 3 db files: `index.ts`, `migrations.ts`, `schema-v1.ts`
- Migration approach: versioned inline SQL (no Drizzle/Knex), `SCHEMA_V1` in `schema-v1.ts`
- Shared types: `Project`, `Workspace`, `Issue`, `Thread`, `ThreadEvent`, `WorkflowTemplate`, `ValidationPolicy` in `shared/src/types/index.ts`
- Error codes: `ErrorCode` enum in `shared/src/errors/index.ts` with `ApiError` / `ApiErrorResponse` shapes

---

## Key Decisions (Why)

| Decision | File | Reason |
|----------|------|--------|
| **Codex CLI P0** | `0002` | Dogfooding on real Codex workflow; shortest feedback loop for verifying agent execution/event/evidence/validation |
| **Node.js + TypeScript backend** | `0003` | Same language as frontend → shared types; `child_process` for CLI, `better-sqlite3` for SQLite, SSE; allows Tauri sidecar later |
| **Monorepo (shared/server/web)** | `0005` | Emerged naturally from F001; strict one-way call chains prevent architecture erosion; naming conventions (`<domain>.ts` per layer) make adding new domains mechanical |

---

## F002-Specific Alignment Summary

F002 design.md already defines what F002 must add:
- **New entities**: Agent/Adapter Config, Run (with `failure_reason` enum, `workspace_id`, `adapter_config_id`)
- **New workspace fields**: `locked_at`, `lock_owner_instance_id`, `push_credentials_enabled`
- **New ThreadEvent types**: 10 new event types (run lifecycle + escalation)
- **New API endpoints**: 8+ new routes (adapter CRUD, Run create/read/list/cancel, SSE stream)
- **New services**: RunService, WorkspaceLockService, AdapterRegistry, AgentRunner, ThreadEventService
- **New repositories**: Run repository, Adapter config repository, ThreadEvent extensions
- **Key design constraints**: CAS for Run state transitions, `escalation` is NOT a Run status, one-shot invocation, workspace lock in DB, credential isolation (plan c), `failure_reason` as fixed enum

<answer>
## Summary

### Architecture Boundaries F002 MUST Follow
1. **Single-process Node.js** — all components (SQLite, lock, runner, SSE) in one process. Stale recovery handles crash recovery
2. **Run lifecycle** — `queued → running → completed/failed/interrupted/cancelled`. `interrupted` is distinct. CAS for ALL state transitions
3. **Workspace lock** — persisted in DB (`lock_state`, `locked_by_run_id`). Acquire before starting adapter. Release on terminal state
4. **Agent adapter** — one-shot invocation per Run. Codex CLI only (P0). `FakeAgentAdapter` for tests. Adapter doesn't do workflow/validation
5. **ThreadEvent** — write to SQLite FIRST, then broadcast. Globally monotonic `event_sequence` for cursor/replay
6. **Strict layering** — `routes → services → repositories → db` (server) and `components → hooks → apiClient` (web). No shortcuts
7. **Credential isolation (primary safety)** — default no git push credentials. Approval hooks are optional observability, not security baseline
8. **Escalation** — NOT a Run status. `escalation.triggered → run.failed → issue.blocked` event order is fixed
9. **Blocked Issue prevents Run** — queued Runs must re-check Issue status before starting; if Blocked, cancel with `issue_blocked_before_start`

### Existing Data Models (Live in `shared/src/types/index.ts`)
`Project`, `Workspace` (with `lock_state`, `locked_by_run_id`), `Issue` (with `status: Inbox|Ready|Running|Validating|Done|Blocked`), `Thread`, `ThreadEvent` (with `event_sequence`), `WorkflowTemplate`, `ValidationPolicy`. Plus 9 draft entities in `system-design.md` (Run, Agent, HandoffPacket, WorkRoom, EvidenceSummary, Artifact, AgentTeamTemplate, Memory, Skill, ProvenanceGateDecision).

### F002 Must Add
- **New types**: Agent/Adapter Config, Run (with `failure_reason` enum), Run status enum
- **Extended types**: Workspace + `locked_at`, `lock_owner_instance_id`, `push_credentials_enabled`
- **New event types**: `run.queued`, `run.started`, `run.output`, `run.output_truncated`, `run.completed`, `run.failed`, `run.cancelled`, `run.interrupted`, `escalation.triggered`, `issue.blocked`
- **8 new API endpoints**: adapter CRUD + validate, Run create/read/list/cancel, SSE stream
- **New services**: RunService, WorkspaceLockService, AdapterRegistry, AgentRunner, ThreadEventService (write-then-broadcast)

### F001 Task Pattern
6 phases: Storage → Services → API → UI → Tests → Manual Verification. Each task references spec requirement IDs. `[P]` marks parallel tasks. Final phase always syncs `system-design.md` and updates `BACKLOG.md`. Tests required before marking requirements done. F002 (127 tasks in 9 phases) follows the same pattern, with Phase 1 being Codex CLI capability probe.
</answer>

<next_steps>
1. **F001 is complete** — its code structure (monorepo, layers, shared types) is the template for F002
2. **F002 spec, design, and tasks are already written** — they align with architecture and system design
3. **Start F002 with Phase 1** (T001-T003: Codex CLI capability probe) before writing any implementation code
4. **Add shared types to `shared/src/types/index.ts` first** — Run, Agent/Adapter Config, new ThreadEventType values, new error codes to `shared/src/errors/index.ts`
5. **Schema migration after types** — extend `schema-v1.ts` or create `schema-v2.ts` for Run table, adapter config, workspace extensions
6. **Repository → Service → Route** — follow the established per-file pattern (e.g., `repositories/run.ts`, `services/run.ts`, `api/routes/runs.ts`)
7. **FakeAgentAdapter before CodexCliAdapter** — T015 must precede T016 for deterministic tests
8. **Key invariants to enforce in code**:
   - Run state transitions use CAS (`UPDATE ... WHERE status = <expected>`)
   - `escalation` is NOT a Run status; Run goes to `failed`
   - Start queued Run only after re-checking Issue is not Blocked
   - `instructions`/`context` NEVER go into subprocess argv
   - Output truncation at 1 MiB (write `run.output_truncated` event)
   - Execution timeout at 30 min default
</next_steps>
</results>
