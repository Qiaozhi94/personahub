# PersonaHub

个人优先的开源 AI Agent Team 自动化工作台：用 Project / Issue / Thread 管理代码开发、系统排障、论文/书籍拆解等个人任务，让不同 agent team 按 workflow 自主执行、验证、沉淀证据和记忆。

## 现状

v0.1（F001-F005：Workspace/Issue 基础、Agent Command Center、Development Trace、Autonomous Validation、Multi-Agent Manual Routing）与 v0.2（F006-F008：Orchestrated Coding Graph Slice、Coordinator Agent & Routing Recommendation、Workflow Template Admin & Runtime Health）均已收口。交付范围、已知限制与技术基线见 `docs/features/releases/0.1.md` / `0.2.md`；逐条 FR/AC 见对应 `docs/features/0.{1,2}/Fxxx-*/spec.md`（历史 Feature，均为 `gate_version: 0`）。

当前 active 版本是 v0.3：F009（Artifact Foundation & Provenance）/ F010（Artifact-Centered Coding Slice）/ F011（Work Room & Human Intervention）/ F012（Reusable Agent Squads），均已完成 draft spec/design/tasks，处于需求与设计审查阶段。版本判断、Feature 顺序与依赖见 `docs/features/0.3/README.md`。

图执行（F006）与推荐路由（F007）留下的跨 feature 契约——`createGraph()`/`resolveEligibleAdapter()`/HMAC 签名确认 token 等——由各自 `design.md` 拥有并保持权威；v0.3 新 Feature（尤其 F011 Room、F012 Squad）引用它们时请直接查对应 `design.md`，不在本文件重复描述。

## 当前结构

- `docs/personahub-prd.md`：正式 PRD，产品判断以此为准。
- `docs/personahub-system-design.md`：数据模型等实现级设计内容，随实现迭代，不作为产品判断的真相源。
- `docs/personahub-architecture.md`：整体软件架构设计（模块划分、运行时/进程模型、存储与通信层），随实现迭代，不作为产品判断的真相源。
- `docs/SOP.md`：个人开发流程约定。
- `docs/features/`：功能规格目录，按大版本（0.1、0.2…）分层；`docs/features/releases/` 存放版本收口摘要。
- `docs/decisions/`：重要产品/技术决策记录目录。
- `docs/research/`：前期调研和竞品分析归档，仅作背景材料，不作为产品/技术判断的真相源；2026-08-12 起纳入 git。
- `docs/reviews/`：设计/代码评审记录与产品级计划，**全量纳入 git**（2026-08-12 起，见 `.gitignore`）。常驻文件：`RETROSPECTIVE.md`（检视复盘）、`dogfooding-bugs.md`（使用问题记录，主表唯一事实源，`npm run bug:log` 统计/校验）、`dogfooding-notes.md`（使用体验记录，不算 bug 的交互/易用性等发现）；`CURRENT-doc.md` / `CURRENT-code.md` 是检视进行中的临时文件，按 `docs/SOP.md`「检视文档生命周期纪律」由检视人复核后删除。
- `server/scripts/`：一次性/可复现的运维与 probe 脚本（如 Codex final-message probe，见 F004 T002/T003）。
- `BACKLOG.md`：近期功能拆分和执行跟踪入口，只列非 done Feature。
- `shared/` / `server/` / `web/`：npm workspaces monorepo 代码，目录结构和分层约定见 `docs/decisions/0005-code-directory-structure.md`。

## 技术栈

- Frontend: Vite + React + 本地 API（见 `docs/decisions/0001-frontend-stack.md`）；样式栈 Tailwind CSS v4 + shadcn/ui CLI（底层 Radix） + OKLCH design token（参考 multica，见 `docs/decisions/0004-ui-styling-stack.md`）
- Backend: Node.js + TypeScript，Fastify + better-sqlite3（见 `docs/decisions/0003-backend-runtime.md`）
- Storage: 本地 SQLite（见 `docs/personahub-architecture.md`）
- Agent adapters: Codex CLI / Claude Code / OpenCode 均已落地；Codex 仍是首个 adapter 的历史决策（见 `docs/decisions/0002-first-agent-adapter.md`）
- 代码目录结构：npm workspaces（`shared`/`server`/`web`），分层与命名约定见 `docs/decisions/0005-code-directory-structure.md`

## 开发约定

- 开发流程见 `docs/SOP.md`。
- Feature 记录见 `BACKLOG.md` 和 `docs/features/`。
- 代码目录结构、分层规则、命名约定见 `docs/decisions/0005-code-directory-structure.md`；新增代码前先看这份文档确定该放哪一层。
- 质量门禁：统一入口 `npm run verify`（串联 lint、format:check、typecheck、测试、文档门禁 `check:features` / `check:doc-links` / `check:doc-ownership` 与 build）。Feature 状态变更前必须运行它；需要自动格式化当前增量基线文件时运行 `npm run format`。Prettier 暂采用增量目标，修改未纳入的旧文件时同步扩展 `package.json` 中的 format targets，避免一次性制造全仓格式噪声。
