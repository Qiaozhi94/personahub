---
topics: [research, plugin, extensibility, architecture, dsh, clowder]
doc_kind: note
created: 2026-08-31
---

# 插件机制调研：DeepSeek Harness 与 clowder-ai

调研日期：2026-08-31
调研对象：`D:\Projects\deepseek-harness`（MIT，DeepSeek AI 官方 agent harness）、`D:\Projects\clowder-ai`（多 agent 协作平台）
用途：为 PersonaHub 后续集成插件能力提供事实基础。结论性取舍见 `../decisions/0014-plugin-contribution-points.md`。

本文只描述两个项目**实际是怎么做的**，不作为 PersonaHub 的产品或技术真相源。

## 0. 一句话结论

两个项目走的是完全不同的两条路线，且**都不能整体照搬**：

- **dsh = 一切皆插件**。它成立的前提是插件框架（Cordis）从第一行代码就是运行时本身，不是后加的能力。
- **clowder = 宿主保留权威的受控扩展**。它是在既有 Fastify 应用上开出有限扩展点，声明式 manifest + Host 逐项准入。

PersonaHub 的运行时形态（Fastify + better-sqlite3 单进程本地应用）与 clowder 同源，与 dsh 不同源。

---

## 1. DeepSeek Harness：一切皆插件

### 1.1 底座是 Cordis，不是自研插件系统

`docs/cordis-primer.zh.md` 给出的五个概念就是全部机制：

| 概念 | 含义 |
| --- | --- |
| 插件 | 一个导出 `apply(ctx)` 的模块，或一个 `Service` 子类。没有别的形态 |
| 上下文 | 服务容器。一个服务占一个稳定的 `ctx.<key>`（`ctx.tools` / `ctx.llm` / `ctx.sessions`），其他插件按 key 查找，不 import 具体实现 |
| `inject` | 插件声明依赖的服务后等待其就绪才启动。**加载顺序由依赖表达，不手写启动序列** |
| 类型化事件 | 通过 TS 声明合并注册事件名，四种分发模式：`emit` / `waterfall` / `parallel` / `serial`。模式是事件的公开约定 |
| 注册即可逆副作用 | 提示词片段、工具 schema、适配器、监听器都通过 `ctx.effect()` / `ctx.on()` 安装，reload 和 teardown 时按预期撤销 |

`docs/architecture.zh.md` 的关键论断：

> 不存在需要打补丁的特权内核：扩展 dsh 的方式是把插件挂载到其他插件旁边，而各项注册都是副作用，会在其插件卸载时撤销。

模型适配器、工具注册表、会话日志、**agent loop 本身**都是插件行，都能从配置替换。

### 1.2 组装机制：profile → bundle → patch

这是「可插」真正的落点，也是 dsh 最值得研究的一层。

```text
$DSH_HOME/profiles/<name>/
├── package.json      # dsh.profile.bundles：有序 bundle 列表 + 树外插件 dependencies
└── cordis.patch.yml  # 用户自己的 patch 层
```

- **bundle**：一个 npm 包，`package.json` 声明 `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`。它回答「这个包贡献什么」。
- **profile**：`$DSH_HOME/profiles/<name>` 下的目录，`package.json` 声明 `dsh.profile.bundles`。它回答「这套配置由哪些 bundle 按什么顺序组成」。
- **patch**：一个 YAML 数组，两种操作——`insert` 插入新行，或按 `id` 定位替换某行的**整个 config**（刻意不做深合并，因此覆盖方必须重述要保留的字段）。

层序（见 dsh `packages/boot/app-boot/README.zh.md`）：各 bundle 按 profile 列出的顺序 → profile 的 `cordis.patch.yml` → home 级的那份 → 任意 `--patch` overlay。后写胜出。

可见性保证是 `dsh --profile web --dump-config`：**打印出来的每一行都可以被用户自己的 patch 替换。**

`dsh-base` 是每个 profile 的第一层（模型适配器、工具、持久化、沙箱与审批策略、设置、凭据、遥测），`dsh-web-app` 加浏览器应用，`dsh-headless` 加一次性运行器且完全不带服务器。

### 1.3 安装：`dsh plugin` 是 pnpm 的薄转发器

dsh `apps/cli/src/plugin.ts` 全文不到 200 行，逻辑是：

1. 首次使用时 `initProfile`（以 `@deepseek-ai/dsh-base` 作为第一个 bundle）；
2. 在 profile 目录内 `spawnSync('pnpm', args)`，因此所有 pnpm 子命令都可用；
3. **按安装后的实际状态**回填 `dsh.profile.bundles`——某依赖解析出的包若声明了 `dsh.bundle` 就入列，否则出列。

按实际状态而不是按依赖 diff 回填带来一个具体好处：某个包在新版本里长出 `dsh.bundle` 声明时，一次 `update` 就会自动激活它。

没有 `dsh.bundle` 声明的包仍可安装，但只作为普通依赖并打印一行警告——这是供插件 import 的库的正确形态。

最小可发布插件包只需三个文件：

```text
hello-plugin/
├── package.json       # "dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
├── index.js           # export function apply() {}
└── cordis.patch.yml   # - insert: [{ id: hello, name: dsh-hello-plugin }]
```

### 1.4 capability seam 三角色

PersonaHub 已在 `../decisions/0008-capability-seam-convention.md` 采纳此术语，此处只补两点本次调研新确认的事实：

- 规范范例是 dsh `packages/shell`：`dsh-shell` 导出抽象类 `ShellExecutor extends Service`（占 `ctx.shell`，构造时 `super(ctx, 'shell')`）→ `dsh-bash-local` / `dsh-bash-sandbox`（Provider）→ `dsh-tool-bash`（Consumer）。同一 context 内注册第二个 `ctx.shell` 会抛错，这是 Cordis 的重复服务标准行为。
- seam 的复利在于共享执行世界：文件系统与进程 Provider 指向远程沙箱后，Bash、PTY 和 LSP 一并搬过去，**不需要 Provider 专用的 fork**。

### 1.5 最值得抄的产物：「新行为归属位置」表

dsh `docs/architecture.zh.md` 末尾有一张 16 行的映射表，把「插件能贡献什么」变成可查清单，而不是靠读代码猜。摘录其形态：

| 目标 | 机制 |
| --- | --- |
| 添加模型提供方 | 在 `ctx.llm` 上注册其适配器 |
| 添加面向模型的能力 | 在 `ctx.tools` 上注册；其 schema 加入提示词组装 |
| 添加用户命令 | 在 `ctx.commands` 上注册；无需模型轮次即可分派 |
| 拦截请求、工具或轮次 | 使用相应的 `agent/*` 或 `tools/*` 事件 |
| 添加持久会话状态 | 扩展 `SessionEventMap`；从日志渲染和回放 |

配套一句纪律：**改动循环本身时，本映射随之更新。**

### 1.6 两条防止插件失控的硬纪律

**（一）模型可见即已记录。** 任何抵达模型请求的东西都必须能从 session log 重建，并由一项运行时不变量断言这一点。因此新增一项模型可见输入就必须新增一个会话事件（扩展 `SessionEventMap` 并从日志渲染）。插件无法偷偷污染上下文。

**（二）waterfall 语义写死在文档里。** `ctx.waterfall` 是环绕中间件，监听器接收 `(...args, next)`：调 `next()` 执行下游并可包装其返回值，不调则短路。约定是——策略型监听器在拥有决策权时可以短路，仅做标注或观察的监听器**必须**委托。`prepend: true` 只在必须先于普通注册运行时使用。

### 1.7 还有一层：运行时动态插件

dsh `packages/extensions` 让 agent 自己在会话里写 Cordis 插件代码，分 Host / Client 两半运行（`ctx.dynamicCordisRunner`）。模型是：Plugin 稳定身份 + Package 不可变版本 + run 生命周期，Client 半边需要用户 approval，`approveFutureVersions` 可覆盖同一 Plugin 的后续版本；`cordis/dynamic-package` 与 `cordis/dynamic-retract` 事件广播激活与撤回。

这层对 PersonaHub 现阶段超前，记录备查。

### 1.8 热更新

`watchUserPatches` 持续监视 `cordis.patch.yml`：每次新增、变更或移除都以事务方式重新组合完整 patch 列表。读取失败、解析失败或 Loader 候选被拒时，**最后一个可用树继续运行**，HMR 服务记录错误后广播 `hmr/config-update-failed`。

---

## 2. clowder-ai：声明式 manifest + Host 权威

clowder 不追求「一切皆插件」，追求「扩展点可控」。它的 `docs/decisions/021-f129-pack-system-architecture.md` 明确否决过「同权限脚本插件」，插件框架是那次否决之后的产物。

### 2.1 本地插件：一个目录一份 YAML

clowder `packages/api/src/plugins/<plugin-id>/plugin.yaml`：

```yaml
id: video-analysis
name: 视频分析
version: "1.0.0"
config:                      # 声明配置字段
  - envName: VIDEO_ANALYSIS_API_KEY
    label: API Key
    sensitive: true
    required: true
  - envName: VIDEO_ANALYSIS_PROVIDER
    type: select
    options: [{ value: gemini, label: Gemini }, { value: zhipu, label: 智谱 }]
resources:                   # 声明拥有的资源
  - type: mcp                # type ∈ skill | mcp | limb | schedule
    name: video-analysis-toolset
    command: node
    args: ["packages/mcp-server/dist/protocol-server.js", "--prefix", "VIDEO_ANALYSIS"]
```

`github/plugin.yaml` 展示了 schedule 类型的关键约束：

```yaml
resources:
  - type: schedule
    name: cicd-check
    factoryId: github.cicd-check   # 白名单引用，不是可执行代码
  - type: schedule
    name: repo-scan
    factoryId: github.repo-scan
    optional: true                 # 依赖缺失时不计入 partial 状态
```

**schedule 只能引用白名单 `factoryId`，插件不能提供任意可执行脚本。**

### 2.2 三个类，职责切得很干净

| 文件 | 行数 | 职责 |
| --- | --- | --- |
| `PluginRegistry.ts` | 212 | 扫描 + 校验 + 状态派生 |
| `PluginResourceActivator.ts` | 1023 | 四类资源的**唯一**激活路径 |
| `plugin-config-store.ts` | — | 配置持久化，走既有 secret 边界 |

`PluginRegistry.scan()` 的四道校验值得逐条记：

1. **目录名必须等于 manifest `id`**，否则 skip 并打印原因；
2. **保留的 builtin plugin id 直接拒绝**（`BUILTIN_PLUGIN_IDS`）；
3. **跨插件配置键冲突检测**：用一个 `envClaims: Map<envName, pluginId>` 边扫边占坑，冲突者整体 skip；
4. 候选先按 id 排序再逐个准入，**保证扫描结果与目录遍历顺序无关**（可复现）。

单个插件坏掉只 skip 它自己，不影响其他插件——失败被局部化。

`PluginResourceActivator` 的所有权模型：资源写入 `.cat-cafe/capabilities.json` 时带 `pluginId` 元数据，enable/disable **只动本插件拥有的记录**，跨插件所有权冲突直接拒绝。重启只 rehydrate 仍然 enabled + valid 的插件，失效插件保持 inactive 且错误状态可见。

### 2.3 外部包插件（K-2 系列）：三层隔离

```text
domains/plugin/host-inventory/    已准入的 package / installation / grant / activation 真相
domains/plugin/host-broker/       一次性握手 session、runtime lease、durable call ledger
domains/plugin/external-runtime/  子进程 stdio、不可变 digest 路径、closed 非密环境
```

铁律（clowder `docs/architecture/ownership/cells/plugin.md`）：

- **外部可执行插件绝不加载进 API 进程。**
- 调用意图先持久化再 dispatch；恢复时必须查询所属域的 canonical settlement，**不能盲目重放有歧义的副作用**。
- Broker 只拥有传输结算，接收域拥有授权、幂等和持久产品真相。

官方 catalog 策略**静态写死在 Host 代码里**（包名、插件身份、grants、允许的 release channel）；只有「更高版本 + 固定 registry tarball + SHA512 + npm provenance」能刷新元数据；更新必须 fence 到用户在 Settings 里确认过的那个 version+digest；刷新本身是有界的进程内投影，带单调 last-known-good 回退，**不等于安装**。

值得注意的是：这套 K-2A~D 目前**构造了但处于 dormant 状态**——生产装配会构造并重启恢复这些边界，但不暴露激活路由、不启动任何包。他们自己也没敢直接上线。

### 2.4 最值钱的一句话

> A plugin-declared contribution is a candidate resource, never proof of identity, installation, permission, health, or execution authority.

声明 ≠ 授权。这是整个 clowder 插件设计的公理。

---

## 3. 对比

| 维度 | dsh | clowder |
| --- | --- | --- |
| 扩展单位 | Cordis 插件（代码，`apply(ctx)`） | YAML manifest 声明的资源 |
| 表达力 | 极高，连 agent loop 都能替换 | 受限：4 种 resource type + 白名单 factory |
| 信任模型 | 同进程同权限，信任配置树 | 声明是候选，Host 逐项准入；外部包出进程 |
| 组装 | profile / bundle / patch 三层，可 `--dump-config` | Settings UI enable/disable，能力表落盘 |
| 隔离 | seam 换 Provider（fs + subprocess 指向沙箱） | 子进程 + 不可变 digest + closed env |
| 热更新 | HMR，patch 变更事务式重组，失败保留最后可用树 | 重启 rehydrate |
| 失败模式 | 启动期 fail loud，列出每个未解析插件 | 单插件 skip，局部化 |
| 目标用户 | 开发者向 harness，用户即开发者 | 产品向平台，用户是运维者 |

**核心张力**：dsh 的「一切皆插件」不是加上去的能力，是运行时本身。任何已有的常规分层应用想事后获得它，代价是重写运行时。

---

## 4. 对 PersonaHub 的直接含义

三条事实判断：

1. **PersonaHub 的运行时形态与 clowder 同源**（Fastify + SQLite 单进程本地应用，路由/服务/仓储分层），与 dsh 不同源。引入 Cordis 等于重写 `server/src` 的装配与生命周期。
2. **PersonaHub 已经有一个真 seam**（`AgentAdapterRegistry` + `AgentAdapter` + 4 个 Provider），且 Consumer 里没有 provider 身份分支——这一点在 `../decisions/0008-capability-seam-convention.md` 已核实。插件能力的第一批贡献点应当优先落在**已经有第二实现需求的位置**，而不是全面开缝。
3. **`../personahub-architecture.md` 把 MCP/A2A 协议层放在 v0.8「方向性设想」**，PRD 第 13 节把「过度平台化」列为明确风险。因此现在该做的是**定清单**，不是建框架。

具体取舍与首批贡献点见 `../decisions/0014-plugin-contribution-points.md`。
