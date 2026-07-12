---
topics: [decision, code-structure, monorepo, backend, frontend]
doc_kind: decision
status: accepted
created: 2026-07-13
---

# 0005: 代码目录结构约定

## 背景

F001 实现过程中已经自然长出一套 npm workspaces monorepo 结构（`shared/` / `server/` / `web/`），分层也已经比较清楚（server 的 api/services/repositories/db，web 的 components-by-domain + hooks/lib/types）。但这套结构从未被写成文档：`CLAUDE.md` 里"随着技术选型和代码规范落地，在此补充实际的目录结构"这句话一直是占位。结果是新代码往哪放全靠现场比照已有文件，容易在后续 feature（尤其是不同的人/agent 实现）里跑偏。本决策把已经在用、效果良好的结构正式确认下来，作为后续 F002-F005 都要遵守的约定，而不是重新设计一套。

## 决策

### 顶层结构

npm workspaces monorepo，三个包：

```text
personahub/
  shared/     @personahub/shared  — 前后端共享的类型和错误码
  server/     @personahub/server  — Fastify + better-sqlite3 后端
  web/        @personahub/web     — Vite + React 前端
```

根 `package.json` 的 `workspaces` 字段声明这三个包；根 `tsconfig.base.json` 提供公共 TS 编译选项，各包 `tsconfig.json` 继承并覆盖。

### `shared/`：跨端类型和错误码

```text
shared/src/
  types/index.ts     领域类型（Project、Workspace、Issue、Thread、ThreadEvent…）+ 各类型对应的 API request/response 形状
  errors/index.ts     ErrorCode 枚举 + ApiError/ApiErrorResponse 形状
  index.ts            从 types/、errors/ 重新导出
```

- 通过 package.json 的 subpath exports 暴露 `@personahub/shared`、`@personahub/shared/types`、`@personahub/shared/errors` 三个导入路径；后端多用后两者（更精确），前端多用聚合的 `@personahub/shared`。
- **新增一个领域类型或 API request/response 形状，一律先加到这里**，不要在 `server/` 或 `web/` 里各自定义一份重复类型。
- 当前 `types/index.ts`、`errors/index.ts` 都是单文件；单文件明显过长（预估超过 300-400 行或涵盖的领域超过 5 个）时，拆成 `types/<domain>.ts` 多文件，由 `index.ts` 统一 re-export，导入路径不变。

### `server/`：分层规则

```text
server/src/
  index.ts                  进程入口：建 DB 连接、实例化 repositories/services、启动 Fastify
  id.ts                     统一的 ID 生成（ulid），所有实体 ID 从这里生成，不要在别处直接调用 ulid()
  api/
    index.ts                registerRoutes()：把各 routes 模块注册到 Fastify app
    errors.ts                AppError 类、ErrorCode -> HTTP status 映射、buildErrorResponse()
    routes/<domain>.ts       Fastify route handler：只做参数校验（zod）、调用对应 service、序列化响应；不直接碰 db
  services/<domain>.ts       业务规则、事务边界（db.transaction）、跨 repository 编排、抛 AppError
  repositories/<domain>.ts   纯 DB 访问：prepared statement + row-to-domain-type 映射；不含业务判断，不抛 AppError
  db/
    index.ts                 openDatabase()：建连接、设置 pragma、跑 migrations
    migrations.ts             applyMigrations()：按 schema_version 表递增执行
    schema-v{N}.ts             每个 schema 版本一份完整 SQL（沿用 F001 design.md 已定的"versioned inline SQL"迁移方式，不引入 Drizzle/Knex）
```

调用方向严格单向：`routes -> services -> repositories -> db`，禁止 routes 直接访问 repositories 或 db，禁止 repositories 反向调用 services。一个 domain（例如 `run`）新增功能时，默认四层都以同一个 `<domain>.ts` 文件名对应，方便按名字找到对应层，但不是硬性 1:1：

- `routes/` 文件名用 REST 路径的复数形式（`issues.ts`、`projects.ts`、`threads.ts`、`workspaces.ts`），对应 URL `/issues`、`/projects`；`services/`、`repositories/` 用单数领域概念（`issue.ts`、`project.ts`）。复数/单数的差异是有意的，不需要为了"三层同名"改成一致。
- 子资源（例如 `ThreadEvent` 从属于 `Thread`、`ValidationPolicy`/`WorkflowTemplate` 从属于 workspace 级配置）可以只有 `repositories/` 层的文件，由父领域的 `services/<parent>.ts` 内部调用，不必为每个子资源单独开一条 routes/services 链路。

### `web/`：业务逻辑与 UI 分离

延续决策 0004 已定的方向，具体落地为：

```text
web/src/
  main.tsx / App.tsx          应用入口、路由/顶层布局装配
  components/
    ui/                       shadcn/ui CLI 生成的组件（button、dialog、input…），不含业务逻辑，可被任何 domain 复用
    <domain>/                 按领域分的业务组件（issue/、thread/、workspace/、project/、inspector/、layout/、empty-states/），可以调用同领域的 hooks，不直接调用 apiClient 或 fetch
  hooks/use-<domain>.ts       TanStack Query 封装（useQuery/useMutation），是组件和 apiClient 之间唯一的数据获取入口
  lib/
    api-client.ts              唯一的后端调用出口：一个 apiClient 对象，按后端 domain 分命名空间（apiClient.projects.xxx），内部统一处理 fetch、错误转换（toApiError）
    utils.ts                   与领域无关的纯函数工具（cn() 等）
  types/index.ts               `export * from "@personahub/shared"` 的转发 barrel，方便组件内用 `@/types` 而不必直接写 `@personahub/shared`；不在这里定义新类型，新类型一律加到 shared/
  styles/globals.css           OKLCH design token、Tailwind 入口
```

规则：

- **组件不直接 `fetch`，一律通过 `hooks/` 里的 TanStack Query hook**；hook 不直接 `fetch`，一律通过 `lib/api-client.ts` 的 `apiClient`。三层单向：`components -> hooks -> apiClient`。
- 新增一个后端资源的前端接入，三处对应新增：`api-client.ts` 加一个方法、`hooks/` 加一个 `use-<domain>.ts`、`components/<domain>/` 放对应 UI。
- `@/` 是 `web/src` 的路径别名（见 `web/tsconfig.json`），组件间引用统一用 `@/...`，不用相对路径 `../../..`。

### 测试文件位置

server 和 web 的测试组织方式不同，各自延续自己生态的惯例，不强行统一：

```text
server/tests/
  unit/<domain>.test.ts              纯函数/单层逻辑单元测试
  integration/<scenario>.test.ts     跨层（service+repository+真实 sqlite）集成测试
  helpers.ts                          测试专用的公共 setup（建临时 db 等）

web/src/
  test/setup.ts                       vitest + jsdom 全局 setup（由 vitest.config.ts 的 setupFiles 引用）
  <name>.test.tsx                     组件/页面测试，与被测代码同级或就近放置（如 App.tsx 对应 app.test.tsx）
```

- server 测试集中在独立顶层 `tests/` 目录，不和 `src/` 混放，`unit/` 和 `integration/` 按测试类型分；新测试先判断是"只测单个 service/repository 的逻辑"（unit）还是"要打通几层 + 真实 db"（integration）。
- web 测试跟 Vite/Vitest 生态惯例走，就近放在被测文件旁边或 `src/` 根，不建单独的顶层 `tests/` 目录；`src/test/` 只放全局测试基础设施（setup 文件），不放具体测试用例。

### 命名约定

- React 组件文件：`PascalCase.tsx`（如 `IssueList.tsx`、`CreateIssueDialog.tsx`）。
- 其余 TS 文件（services、repositories、routes、hooks、lib）：`kebab-case.ts`（如 `use-workspace.ts`、`workspace.ts`）。
- server 端 `services/`、`repositories/`、`routes/` 三层用同一个 domain 名作为文件名（例如 `workspace.ts` 在三层各出现一次），不要三层文件名不一致。

## 理由

- 这套结构不是新设计，是 F001 实现过程中已经跑出来、并且各层职责边界清晰（routes 不碰 db、repositories 不含业务判断）的结构，直接固化比重新设计风险更低。
- 严格单向调用链（routes → services → repositories → db；components → hooks → apiClient）是这份文档要解决的核心问题：没有这条规则，后续 feature 很容易图省事在 route handler 里直接写 SQL，或在组件里直接 fetch，几次之后分层名存实亡。
- 命名约定统一是为了让"新增一个 domain 的完整链路"可以通过复制已有 domain 的文件名模式完成，不需要每次现想。

## 影响

- `CLAUDE.md` 补充"代码目录结构"一节，指向本决策，替换掉原来的占位句。
- `.gitignore` 补充 SQLite 运行时文件（`*.db`、`*.db-shm`、`*.db-wal`）和非项目相关的工具运行时目录（`.sisyphus/`），避免本地数据库或无关工具状态被提交。
- 后续 F002-F005 的 `design.md` 在设计具体 schema/API 时，直接遵循这套分层落地，不需要重新讨论目录结构。
