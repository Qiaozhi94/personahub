# PersonaHub

个人优先的开源 AI Agent Team 自动化工作台：用 Project / Issue / Thread 管理代码开发、系统排障、论文/书籍拆解等个人任务，让不同 agent team 按 workflow 自主执行、验证、沉淀证据和记忆。

## 现状

F001（Workspace & Issue Foundation）和 F002（Agent Command Center）已完成代码、行为验收及关键 UI 自动化测试，typecheck、server/web 自动化测试和生产构建均通过，状态为 `done`。F003（Development Trace）已完成全部 88 个任务的代码实现和自动化测试，typecheck、server/web 自动化测试和生产构建均通过，状态为 `done`；真实 Codex CLI 手动 probe 和端到端验证（T001、T081-T084）待用户在真实环境中执行。

F004（Autonomous Validation）已完成全部实现（T090-T095 final review 缺口修复）、自动化测试（server 969 + web 78 全绿，生产构建成功）与文档回写，并在本机真实 Codex CLI 0.144.5 完成核心 production-path 验收（validator envelope 双路径分流、完整 pass→Done→EvidenceSummary→Markdown、round-limit Blocked、same-origin true/false），状态为 `done`；T083 blocked 矩阵与 T084 restart 由确定性自动化套件覆盖。真实验收工具（env-gated `REAL_CODEX=1`，默认 skip）见 `server/tests/integration/real-codex-*.test.ts`。正式产品需求与后续设计/实现真相源见 `docs/personahub-prd.md`。

F005（Manual Multi-Agent Routing，新增 Claude Code / OpenCode adapter 与手动路由）Phase 0-12（共 13 个 Phase，T001-T099）已完成：三 provider（Codex/Claude/OpenCode）真实 CLI probe 与 adapter 落地、schema v6、secret-safe DTO、`ManualRoutingService` 统一 Run 创建入口、Validator Grace 两阶段 dispatch（Phase A/B + `ValidationDispatchScheduler` + restart recovery）、HTTP API 收尾（adapter CRUD 全字段路由、default-adapter PUT、`GET /api/adapter-providers`、canary secret 扫描零泄漏）、Adapter Settings UI（provider→auth-type 级联表单、capability checkbox、API key 三态语义、default badge）、Composer/Thread/Inspector UI（独立 `AgentSelector` 始终可见+purpose 预览、Validating grace banner 精确文案"Start automatic validator now"且不暗示 Project default、Thread Run card 展示 workflow/consult badge+provider/model+context handoff 链接、`issue_state_changed_before_start` 诚实重发文案、Inspector routing metadata+manually-selected-validator 提示），typecheck、server（1277 测试）/web（151 测试）自动化测试和生产构建均通过，状态为 `in-progress`；全部 UI 工作均未做真实浏览器人工点击验证（本环境无浏览器工具，仅有自动化组件/集成测试覆盖）。剩余 Phase 13（安全/端到端/文档回写）待续，详见 `docs/features/0.1/F005-multi-agent-manual-routing/tasks.md`。

## 当前结构

- `docs/personahub-prd.md`：正式 PRD，产品判断以此为准。
- `docs/personahub-system-design.md`：数据模型等实现级设计内容，随实现迭代，不作为产品判断的真相源。
- `docs/personahub-architecture.md`：整体软件架构设计（模块划分、运行时/进程模型、存储与通信层），随实现迭代，不作为产品判断的真相源。
- `docs/SOP.md`：个人开发流程约定。
- `docs/features/`：后续功能规格目录。
- `docs/decisions/`：重要产品/技术决策记录目录。
- `docs/research/`：前期调研和竞品分析归档，仅作背景材料；**本地-only，不纳入 git**（见 `.gitignore`）。
- `docs/reviews/`：设计/代码评审记录；**本地-only，不纳入 git**（见 `.gitignore`）。
- `server/scripts/`：一次性/可复现的运维与 probe 脚本（如 Codex final-message probe，见 F004 T002/T003）。
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
