# PersonaHub

个人优先的开源 AI Agent Team 自动化工作台：用 Project / Issue / Thread 管理代码开发、系统排障、论文/书籍拆解等个人任务，让不同 agent team 按 workflow 自主执行、验证、沉淀证据和记忆。

## 现状

F001（Workspace & Issue Foundation）和 F002（Agent Command Center）已完成代码、行为验收及关键 UI 自动化测试，typecheck、server/web 自动化测试和生产构建均通过，状态为 `done`。F003（Development Trace）已完成全部 88 个任务、验收清单、自动化测试与真实 Codex CLI probe，状态为 `done`。

F004（Autonomous Validation）已完成全部实现（T090-T095 final review 缺口修复）、自动化测试（server 969 + web 78 全绿，生产构建成功）与文档回写，并在本机真实 Codex CLI 0.144.5 完成核心 production-path 验收（validator envelope 双路径分流、完整 pass→Done→EvidenceSummary→Markdown、round-limit Blocked、same-origin true/false），状态为 `done`；T083 blocked 矩阵与 T084 restart 由确定性自动化套件覆盖。真实验收工具（env-gated `REAL_CODEX=1`，默认 skip）见 `server/tests/integration/real-codex-*.test.ts`。正式产品需求与后续设计/实现真相源见 `docs/personahub-prd.md`。

F005（Manual Multi-Agent Routing，新增 Claude Code / OpenCode adapter 与手动路由）全部 13 个 Phase（T001-T110）代码已完成：三 provider（Codex/Claude/OpenCode）真实 CLI probe 与 adapter 落地、schema v6 + closure v7、secret-safe DTO、`ManualRoutingService` 统一 Run 创建入口、Validator Grace 两阶段 dispatch、HTTP API 收尾、Adapter Settings UI、Composer/Thread/Inspector UI。Phase 13 在本机用真实已登录 CLI（Claude Pro OAuth、OpenCode 自身 auth、Codex）完成端到端验收，定位、修复了 OpenCode Windows hang（`HOMEDRIVE`/`HOMEPATH`/`USERPROFILE` 不一致导致）与 Claude validator envelope 遵从度问题，详见 `docs/features/0.1/F005-multi-agent-manual-routing/tasks.md` Phase 13 记录。

Phase 13 完成后，2026-07-23~24 又经过七轮独立人工代码检视（`code-review-report-implementation.md` → `code-review-report-recheck.md`/`code-review-report-recheck-2.md` → `code-review-report-final-comprehensive.md` → `code-review-report-final-recheck.md`/`-2`/`-3`，均在 feature 目录下）逐条核实并修复，涉及：validator context 绑定/孤儿 Run、手动 validator 指令注入、adapter capability_tags 持久化、跨 workspace credential 隔离下的模型 provider/云平台 API key 泄漏、HTTP 边界运行时校验（改用项目既定的 zod 方案覆盖 adapters/runs 全部路由，不再是部分字段手写校验）、adapter 编辑清空语义、204 响应解析、POSIX 下 executable resolver 无法解析无扩展名命令、auth 错误信息脱敏覆盖面、adapter availability 收敛的竞态与 shutdown 生命周期、adapter create/update 路径同步 `spawnSync` 阻塞 Node 事件循环（已改为纯同步无子进程的 command 解析）等一系列问题。**此前记录的两处遗留架构问题已于 2026-07-24 二次实施完成并关闭**：① AC-001 语义修复——create/update 不再凭命令可解析即写 `Available`，统一先落 `Unknown`，异步真实 provider `validate()` 收敛后才置 `Available`（并按需应用 default-adapter 分配），探测失败或异常绝不静默提升；② workspace-aware availability——新增 schema v7 `adapter_workspace_status` 表作为"例外覆盖"（`agent_configs.status` 保持 Project 级保守基线，覆盖表只存与基线不同的 `(adapter_config_id, workspace_id)` 行），`effectiveAdapterStatus()` 统一合并入口，`AdapterResolver`/`ValidationWorkflowService.claimValidatorSlot()`/`RunDispatchService.reprobeAdapterOnFailure()`/`AdapterConfigService.validate(id, workspaceId)` 全部切换，workspace 自己验证成功后即可在该 workspace 内路由，某 workspace 失败不再连累同 Project 其它 workspace。AC-001 现已满足，详见 `spec.md` 第 8 节。

2026-07-25~26 又经过五轮独立检视（`code-review-report-final-closure-check.md` → `-recheck.md` → `-recheck-2.md` → `-recheck-3.md` → `-recheck-4.md`，均在 feature 目录下）逐条核实并修复了 ①② 两处修复自身的收尾问题，累计 9 项 High + 7 项 Medium + 3 项 Low。核心内容：workspace-aware 状态补齐了 UI/API 闭环（`AdapterConfigService.list(projectId, workspaceId?)`/`GET .../adapters?workspace_id=` 与 `effective_status` 等投影字段，`AdapterSettings` 通过既有单 workspace 模型 `useWorkspace(projectId)` 贯穿展示）；`update()`/`delete()` 补上事务原子性与统一的 availability-relevant 失效判定（含 `args`）；非法/跨 Project `workspace_id` 统一抛 `WORKSPACE_NOT_FOUND`；生产 shutdown 补上等待后台 probe。并发写序保护是这几轮里反复收敛的重点：最初尝试给 `agent_configs` 加持久化 `availability_revision` 列做 CAS，因"追加进已跑过的 schema v7、旧数据库永远拿不到新列"的迁移不可变性风险和"只实现先完成者获胜、非后发起者获胜"两个问题被否决；改为进程内 generation Map 后，又发现该 Map 私有于 `AdapterConfigService`，未覆盖 `RunDispatchService.reprobeAdapterOnFailure()` 这第二个写入方——最终方案是抽出共享单例 `AdapterAvailabilityProbeCoordinator`（`server/src/services/adapter-probe-coordinator.ts`），`configGenerations`（按 adapterId，配置失效时递增）+ `probeGenerations`（按 scope key，**调用开始时**领取），注入两个 service 共用，在单进程生命周期内对所有写入方正确实现"最近一次调用胜出"，且无需任何 schema 变更；scoped 路径的 workspace 环境快照同时收窄为只比较 `push_credentials_enabled`（避免被 lock/branch 等无关写误伤）——但这一收窄最初只应用到了 `AdapterConfigService.validate()`，`RunDispatchService.reprobeAdapterOnFailure()` 同样依赖这个字段却遗漏了对称的快照/复核，第五轮检视发现后已补齐。当前 server 1385（另 17 个 real-CLI/POSIX-only 测试按 env/平台 gate 跳过）/web 164 自动化测试、typecheck、生产构建均通过；新增的跨服务双向完成顺序并发测试、workspace 环境翻转测试重复运行确认无 flake；credential/dispatch/validate 相关改动已多次用本机真实已登录 Codex/Claude/OpenCode CLI 追加验收。两项原始遗留 finding（AC-001、workspace-aware availability）现已真正闭环，详见 `spec.md` 第 8 节完整演进记录（7 条 AC 全部勾选）。代码已在 main 分支（working tree clean），2026-07-28 spec/design/tasks 状态回写为 `done`。UI 工作未做真实浏览器人工点击验证（本环境无浏览器工具，仅自动化测试覆盖）。

下一 active Feature 是 F006（Orchestrated Coding Graph Slice，`idea`）：只用一个真实三节点 coding 场景验证 ADR 0006 的 fan-out → fan-in、显式 Node/Edge 与恢复语义；设计问题关闭前不进入代码开发。入口见 `BACKLOG.md` 与 `docs/features/0.2/F006-orchestrated-coding-graph-slice/`。

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
- Agent adapters: Codex CLI / Claude Code / OpenCode 均已落地；Codex 仍是首个 adapter 的历史决策（见 `docs/decisions/0002-first-agent-adapter.md`）
- 代码目录结构：npm workspaces（`shared`/`server`/`web`），分层与命名约定见 `docs/decisions/0005-code-directory-structure.md`

## 开发约定

- 开发流程见 `docs/SOP.md`。
- Feature 记录见 `BACKLOG.md` 和 `docs/features/`。
- 代码目录结构、分层规则、命名约定见 `docs/decisions/0005-code-directory-structure.md`；新增代码前先看这份文档确定该放哪一层。
- 质量门禁：`npm run lint`、`npm run format:check`、`npm run typecheck`；需要自动格式化当前增量基线文件时运行 `npm run format`。Prettier 暂采用增量目标，修改未纳入的旧文件时同步扩展 `package.json` 中的 format targets，避免一次性制造全仓格式噪声。
