---
feature_ids: [F001, F002, F003, F004, F005, F006, F007, F008]
related_features: [F009, F010, F011, F012, F013, F014]
topics: [architecture, runtime, storage, events, frontend]
doc_kind: design
created: 2026-07-11
updated: 2026-09-08
---

# PersonaHub 软件架构设计

## 1. 文档边界

本文拥有全局模块、依赖方向、进程与运行时边界。产品对象和路线由 `personahub-prd.md` 拥有，字段由 `personahub-system-design.md` 拥有，单 Feature 技术细节由各自 `design.md` 拥有。

V3.44 是最终交互目标，不代表当前实现已具备全部模块。本文用“已实现 / v0.3 目标 / 后续”区分事实与方向。

## 2. 当前实现基线（v0.2）

```text
React / Vite web
  ↓ HTTP + SSE
Fastify API
  ├─ route / DTO validation
  ├─ application services
  │  ├─ intake / coordinator rules
  │  ├─ thread / run / validation
  │  ├─ graph orchestration
  │  └─ runtime health / workflow admin
  ├─ runtime
  │  ├─ adapter registry
  │  ├─ workspace FIFO + lock
  │  └─ child process adapters
  └─ repositories
     ↓
SQLite schema v11 + local workspace files
```

当前是单进程、本地 SQLite、浏览器与服务进程同生命周期的模式。Codex CLI、Claude Code、OpenCode 已有 adapter；Work Graph、推荐确认、验证循环、Trace、Evidence Summary 与恢复逻辑已经交付。

## 3. 稳定架构原则

### 3.1 依赖方向

```text
UI → API → Application Service → Repository / Runtime Provider
                                ↘ Event publisher（commit 后）
```

- route 不直接写数据库或 spawn。
- UI projection 不拥有 canonical 状态。
- service 是事务、幂等、权限和状态迁移的唯一入口。
- repository 不决定产品流程。
- adapter 不知道 Project、Skill 或 Evidence UI；它只执行已组装的请求并报告能力与结果。

### 3.2 事务后副作用

任何会创建 Issue、Session、Dispatch、Graph、Run 或 Artifact manifest 的操作，先在数据库事务中固定事实，再 spawn、广播或 drain。事务失败不能留下孤儿进程或“成功”事件。

### 3.3 Agent 可见即已记录

进入 CLI 上下文的目标、会话片段、Handoff、Artifact、Evidence、Memory、Skill 与权限说明必须先有可持久引用或事件。任何无法回放的隐式注入都不允许进入验证链。

### 3.4 单一写入口

每类状态只有一个 service 可写。TaskProjection、运行时、统计、项目记忆等都是派生读取；不得为某个新页面新开一条旁路写入。

## 4. v0.3 目标分层

```text
Presentation
├─ V3.44 App shell / surface registry / routes
├─ F009 legacy view adapters              transitional
├─ Task surface (overview / conversation / acceptance / resources)
├─ Session / Project / Skills / Runtime surfaces
└─ Shared accessible table / tab / dialog primitives

Application
├─ TaskProjectionService                 read-only
├─ SessionService                        Room / Thread ownership
├─ DispatchService + EligibilityEvaluator
├─ ArtifactService + RefResolver
├─ ClaimEvidenceProjection
├─ ProjectRepositoryService
└─ SkillRegistry

Runtime
├─ RuntimeMachineRegistry                v0.3: one machine
├─ AdapterInstallationRegistry
├─ ContextAssembler
├─ WorkspaceQueue / ClaimBarrier
└─ Adapter Providers

Persistence
├─ SQLite repositories
├─ append-only event / revision records
└─ authorized local files
```

F009 先替换生产前端骨架，并用只读兼容投影承载 v0.1–v0.2 已交付事实；它不改写业务表。F010–F013 各自拥有领域契约，并在接管页面后删除对应兼容 adapter；F014 只负责跨层集成、兼容清零和版本旅程，不得新增业务 store。

## 5. Runtime 与进程模型

### 5.1 执行身份

一次派工的执行身份由以下事实组成：

```text
runtime machine
adapter installation
adapter access（仅真实存在多套时）
model
reasoning depth
```

用户界面将后四项显示为执行组合；机器进入快照但不进入组合名。历史快照不能依赖今天仍存在的配置。

### 5.2 Dispatch 与 Attempt

Dispatch 表达意图：执行组合、上下文范围、Handoff、Skill revisions、能力偏离与权限快照。Attempt（当前 `runs`）表达单次进程执行。一个 Dispatch 可以因基础设施故障产生多个 Attempt，但不能改写原意图。

```text
draft → starting ──撤销→ cancelled（零 Run）
              └─deadline / commit→ dispatched → Attempt 1..N
```

### 5.3 Session resume

resume key 至少包含执行组合、Issue、Room 与上下文范围。同组合同范围可以 resume；换模型、深度、接入方式、会话或范围必须冷启动。验证类执行默认冷启动。

### 5.4 上下文范围

- 全部：目标、成果、证据、变化与本会话过程。
- 只给结果：不含实现过程对话。
- 只给目标：不含实现产物，用于先固定用例 / 验收设计。

ContextAssembler 记录每个候选输入的 included / filtered 与原因。过滤不是日志细节，而是验证独立性的证据。

### 5.5 Workspace queue 与锁

写入同一代码目录的 Attempt 继续经过 FIFO 与排他锁。普通 worktree 或目录复制不构成强隔离；在未有 OS 级不可达保证前，只读节点也按串行安全基线处理。

pause 是 Dispatch claim barrier：提交后新 Attempt 不得 claim，已 running 进程继续。取消运行必须针对确定 Attempt。两者不能共用模糊“停止”动作。

### 5.6 崩溃恢复

启动顺序：

1. 应用所有 migration。
2. 校验 app secret、schema 与不可恢复损坏。
3. 将遗留 running Attempt 标为 interrupted，保留输出和 Trace。
4. 恢复 Artifact 临时文件协议并核对 manifest。
5. 恢复 starting Dispatch deadline、pause intent、Graph / NodeRun。
6. 重新计算可 claim 队列并 drain。
7. 开始 SSE 与调度器。

已完成 Node 不重跑；中断步骤创建新 Attempt；fan-in 不因重启提前收敛。

## 6. Adapter 抽象

Adapter 是当前唯一成熟 provider seam。统一契约至少包括：

- validate / discover models / report capabilities；
- start / resume / cancel execution；
- structured trace、final message 和 usage（能力可缺失）；
- CLI 登录态读取或 PersonaHub 管理的 API access；
- 工具实际可用清单，包括内置工具与 MCP 注入结果。

能力缺失要表达产品后果。例如无法关闭原生记忆意味着不能承担独立验证；没有 approval hook 意味着写操作不会进入等待授权。UI 不暴露一张抽象 capability 矩阵，而是在对应 adapter 中写清后果。

新增 adapter 必须经 `AgentAdapterRegistry` 唯一注册。业务 consumer 不出现 provider 名分支；确实不同的认证 / 启动协议留在 provider 内。

## 7. Event、Trace 与 Projection

ThreadEvent 是用户、执行组合与系统动作的顺序记录；RunTrace 是 adapter 内部输入 / 模型 / 工具过程。Task activity 是更粗的任务级投影。三者不可混成一条流：

| 层 | 目的 | 示例 |
|---|---|---|
| 会话事件 | 谁说了什么、下了什么指令 | 用户消息、派工、决定 |
| 任务活动 | 什么状态变化值得回看 | 基线修改、阶段完成、Memory 候选 |
| Run Trace | adapter 实际如何执行 | 命令、工具调用、模型耗时 |

SSE 使用单调 cursor、断线 replay 与去重。事务内事件先缓冲，commit 后按顺序广播。投影必须可从 SQLite 重建，不能只活在前端内存。

## 8. Artifact 与 Evidence

ArtifactService 保存实体与 immutable revision。RefResolver 统一解析 Artifact、系统事件、文件变化等 typed refs；进入 Dispatch 的 Artifact ref 必须带 revision。

ClaimEvidenceProjection 按“完成要求 → 主张 → 论证 → 证据”组织读取。独立性由执行身份、上下文范围、adapter 隔离能力和 Evidence 来源共同计算，不由 UI 手工写状态。

Evidence Summary 是完成时的确定性投影；生成后不可随当前配置、最新 Artifact 或价表变化而漂移。

## 9. Project、Repository 与 Skill

RepositoryRegistry 负责真实路径、Git remote 和每台机器的路径授权；Project 只引用一个主目录与多个只读参考仓库，并进一步收紧范围。

SkillRegistry 管 `id@version`、来源、冲突、能力要求、steps 与完成要求。有 steps 的 Skill 投影为编组，不建立第二种 provider 或表。生效 Skill revision 固定进 Dispatch。

旧 Workflow Template 在迁移完成前保留兼容读取，但生产 UI 不再提供第二套编辑入口；独立 Validation Policy 同理。

## 10. Frontend 架构

### 10.1 Route 与状态所有权

- App shell 拥有一级导航和全局搜索。
- Task route 拥有当前任务、四视图、输入草稿和副栏展开状态。
- 各视图消费同一 TaskProjection，不各自请求 / 推断状态。
- 长文档从验收中进入任务内全文；资源视图采用就地预览。
- 未完整交付的工作面不进入生产导航，不放只有 toast 的死入口。

### 10.2 共享交互原语

Dialog、table、tabs、menu、status banner 由共享组件统一实现语义与键盘模型。新增交互范式必须同时扩展组件测试和 Playwright 可访问性门禁。

### 10.3 原型与生产隔离

V3.44 原型是交互契约，不是组件源码。生产实现复用项目 Tailwind / shadcn / Radix 基础和现有 API 层；不得复制静态 HTML、mock 数据或原型脚本进入 `web/`。

## 11. 存储与安全

- SQLite 是当前 canonical store；单用户不预建 rollup、多租户或云同步层。
- 本地文件只通过授权真实路径访问，禁止用字符串前缀替代 path containment。
- 密钥不进入公共 DTO、事件、日志或导出。当前明文 SQLite 风险在系统诊断明确披露，后续 secret store 另立设计。
- 插件代码与主进程同权，故不允许插件提供前端代码；声明式数据先校验、准入、激活。
- 删除任何被历史引用的配置 / Skill / Repository / Memory 时保留历史快照或墓碑，不级联破坏证据。

## 12. 后续扩展

### v0.4

Memory pipeline、自动化、usage / monitoring / memory utility 与 Provenance Gate。直接基于 v0.3 的验收事件、Dispatch 和 Artifact，不旁路创建后台结果。

### v0.5–v0.6

按单个垂直切片扩展 Evidence Adapter；在真实历史足够后才加入自动续派与智能编组推荐。

### v0.7

服务进程 daemon 化与 RuntimeMachine 多实例。执行世界抽象只有到 OS 级隔离或远端执行出现第二 provider 时才开缝。

### v0.8+

声明式插件 surface、MCP / 外部协议、自托管与远程访问。保持核心依赖可选层，而非反向依赖插件。

## 13. 明确不在架构中预承诺

- 零改动迁移到 Postgres / pgvector。
- 任意插件热卸载或同源 UI 沙箱。
- 普通 worktree 的并行写安全。
- 所有 adapter 都能提供精确 usage、approval hook 或结构化 trace。
- 多人权限、多租户隔离和云端同步。

这些能力出现真实需求时单独立 ADR / Feature，不以空接口提前承诺。
