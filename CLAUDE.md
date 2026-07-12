# PersonaHub

个人优先的开源 AI Agent Team 自动化工作台：用 Project / Issue / Thread 管理代码开发、系统排障、论文/书籍拆解等个人任务，让不同 agent team 按 workflow 自主执行、验证、沉淀证据和记忆。

## 现状

F001（Workspace & Issue Foundation）正在实现中，`shared/` / `server/` / `web/` 已有代码。正式产品需求与后续设计/实现真相源见 `docs/personahub-prd.md`。

## 当前结构

- `docs/personahub-prd.md`：正式 PRD，产品判断以此为准。
- `docs/personahub-system-design.md`：数据模型等实现级设计内容，随实现迭代，不作为产品判断的真相源。
- `docs/personahub-architecture.md`：整体软件架构设计（模块划分、运行时/进程模型、存储与通信层），随实现迭代，不作为产品判断的真相源。
- `docs/SOP.md`：个人开发流程约定。
- `docs/features/`：后续功能规格目录。
- `docs/decisions/`：重要产品/技术决策记录目录。
- `docs/research/`：前期调研和竞品分析归档，仅作背景材料。
- `BACKLOG.md`：近期功能拆分和执行跟踪入口。
- `shared/` / `server/` / `web/`：npm workspaces monorepo 代码，目录结构和分层约定见 `docs/decisions/0005-code-directory-structure.md`。

## 技术栈

- Frontend: Vite + React + 本地 API（见 `docs/decisions/0001-frontend-stack.md`）；样式栈 Tailwind CSS v4 + shadcn/ui CLI（底层 Radix） + OKLCH design token（参考 multica，见 `docs/decisions/0004-ui-styling-stack.md`）
- Backend: Node.js + TypeScript，Fastify + better-sqlite3（见 `docs/decisions/0003-backend-runtime.md`）
- Storage: 本地 SQLite（见 `docs/personahub-architecture.md`）
- Agent adapters: P0 = Codex CLI，Claude Code / OpenCode 为后续扩展（见 `docs/decisions/0002-first-agent-adapter.md`）
- 代码目录结构：npm workspaces（`shared`/`server`/`web`），分层与命名约定见 `docs/decisions/0005-code-directory-structure.md`

## 开发约定

- 开发流程见 `docs/SOP.md`。
- Feature 记录见 `BACKLOG.md` 和 `docs/features/`。
- 代码目录结构、分层规则、命名约定见 `docs/decisions/0005-code-directory-structure.md`；新增代码前先看这份文档确定该放哪一层。
- lint/format 工具尚未引入，落地后在此补充。
