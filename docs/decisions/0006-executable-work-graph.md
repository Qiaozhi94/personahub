---
topics: [decision, architecture, graph-engineering, multi-agent, workflow]
doc_kind: decision
status: accepted
created: 2026-07-28
---

# 0006: Executable Work Graph 作为 v0.2+ 多 Agent 编排的目标架构

## 背景

`docs/personahub-prd.md` 已经把 Collaboration Topology、Agent Team Template、Room 等多 Agent 协作概念写进 v0.2/v0.3 路线（多数标注 P1/P2）。也就是说"未来会出现多种图形状的协作"不是猜测，是产品既定方向。问题只是：现在（F005 刚收尾、v0.2 还没开始）要不要提前把通用图执行引擎建出来。

对照实际代码核实过当前状态，现状确认如下：

- `context_source_run_id`（`server/src/db/schema-v6.ts`）是 `runs` 表上的单列外键，`run-context-builder.ts` 的 `resolveContextSourceRunId()` 只返回单个 `string | null`，不支持多前驱（fan-in）。
- Evidence Summary（`server/src/repositories/evidence-summary.ts`）字段只有 `validator_run_id` / `implementation_run_id` 两个单值列，且以 `ON CONFLICT(issue_id) DO NOTHING` 保证每个 Issue 最多一条，假设单实现 + 单验证。
- `WorkflowTemplate.collaboration_topology` 只在 `workflow-template.ts` 做行映射，全仓库没有其他分支逻辑读取它；`steps_json` 唯一实际用途是 `validator-selector.ts` 里判断"是否存在 validator 角色"的布尔门禁。二者都是描述字段，不驱动实际执行顺序——真正的流程顺序硬编码在 `ValidationWorkflowService` 等 service 里。
- `Run` 实体（`shared/src/types/index.ts`）同时承担状态机字段（`status`）、逻辑角色（`role`/`workflow_step`/`purpose`）、具体一次 provider 执行属性（`adapter_config_id`/`adapter_identity`/`exit_code`），四种职责压在同一张表的不同列上，没有分层。
- `workspace-lock.ts` 是整个 `workspaceId` 级别的排他锁，没有节点/子路径粒度，同一 workspace 内多个写节点无法并行。

这五点都指向同一个结论：现有模型只经受住了"一种图形状"（Implementation → Validation 循环 + Thread 内手动接力）的检验，还没有为第二种图形状（并行 fan-out/fan-in、条件路由、多前驱 synthesis）准备好扩展点。

## 决策

### 1. 接受的目标架构方向

把 **Executable Work Graph** 确立为 v0.2 及以后多 Agent 协作编排的核心模型，替换掉此前"topology-aware automation"的表述，改为"graph-orchestrated work"。核心设计原则：

- **Node 表达责任，不表达固定 Agent**：Node 携带 `required_capabilities`，实际执行者由能力匹配 + 可用性决定，不在 Node 定义里写死某个 Agent。
- **Edge 是一等契约**：除 `source`/`target` 外，至少要能表达结果路由（outcome/condition）、多前驱汇聚策略（join）、载荷传递和路由决策的来源，不能只有 `dependsOn`；具体字段名称和数据结构属于下方"待验证的假设"，本节固定的是语义要求，不是字段清单。
- **Definition / Run / NodeRun / Attempt 分层**：

  ```text
  WorkflowGraphDefinition（版本化声明，可复用）
    └─ GraphRun（某个 Issue 的一次实际拓扑实例）
        ├─ NodeRun（一项逻辑工作，可有多次尝试）
        │   ├─ Attempt 1（具体一次 Agent/Provider 执行）
        │   └─ Attempt 2（Provider 失败后的 fallback 执行）
        └─ EdgeTraversal（记录一次实际的边转移：outcome + 决策者 + 理由）
  ```

- **Graph Runtime 组合领域服务，不取代领域服务**：F004 已经跑通的 validator envelope 解析、deterministic policy gate、validation round/max rounds、Blocked 语义，继续留在现有 service 代码里，不降级成通用图上的条件表达式。Graph Engine 负责根据这些 service 的输出选择 Edge、创建下一个 NodeRun/Attempt、记录 EdgeTraversal，而不是重新实现一遍判定逻辑。

以上四条是**已接受的不变量**，独立于具体字段形状成立，触发 Slice 1 时直接作为起点。但 Edge 具体带哪些字段（`joinPolicy`/`payloadMapping`/`routingAuthority` 等）、`EdgeTraversal` 是否需要单独持久化、`Definition`/`GraphRun`/`NodeRun`/`Attempt` 最终要不要拆成四张独立表，属于**待验证的假设**，本决策只给出方向性草图（见下方模型），具体形状以触发条件出现时的真实场景（当前已知触发点是 v0.2 `orchestrator_subagent`，见"触发条件"一节）校验后再定稿，不是提前锁死的设计。

### 2. 现在只接受方向，不现在建运行时

本决策生效后立即执行的范围仅限于：

- 本 ADR 本身（目标模型、命名、分层原则）。
- 后续新代码在能便宜地对齐目标模型时优先对齐（见下方"允许的增量动作"），但不做专门的重构项目。

明确**不在现在做**、也不安排具体时间表的范围：

- 无条件新建 `graph_runs` / `node_runs` / `node_attempts` / `edge_traversals` 等运行时表——是否需要新建，以及新建到什么程度，是 Slice 1 触发后由 `design.md` 判断的实现决策，不是本决策现在就拍板的结论（见下方"3. Slice 1 与触发条件"）。
- 把 F004 现有状态机改写成通过通用 Graph Runtime 驱动。
- Graph Compiler / Linter、自然语言 Graph Draft、Graph Inspector UI、Canvas 编辑器。
- 扩展 `context_source_run_id` 为多对多、扩展 Evidence Summary 为多实现/多验证的完整 schema 迁移。

### 3. Slice 1 与触发条件

**Slice 1 是一个能力验收，不是"新建运行时表"这一具体实现动作的代号**：某个协作场景能以显式 Node/Edge 语义执行，且每一步的执行者、依赖、结果和收敛决策可追踪、可恢复。是否需要为此新增独立持久化的运行时表（`graph_runs`/`node_runs`/…），是 `design.md` 阶段基于恢复、审计、并发和演进需求做出的实现决策；只有当 `design.md` 证明现有 Run/Event 模型无法满足上述验收标准时，才需要引入独立运行时表迁移——这不是本决策预先规定的结论，避免"选轻量实现就等于没触发 Slice 1"这种自相矛盾的读法。

"可恢复"不是一个不言自明的词，本决策把它固定为以下最小语义，PRD / 架构文档的完成判据必须原样引用，不能只写"可追踪"而丢掉这一条：

- 进程重启后可重建 Graph/Node 的已完成、运行中和待执行状态。
- 已完成的 Node 不重复执行。
- 重启时仍处于执行中的 Attempt 标记为 `interrupted`，不假装成功。
- 用户或确定性策略可以从对应 Node 发起新的 Attempt。
- fan-in 只在所需前驱重新满足后才继续，不因重启而提前或跳过收敛。

触发 Slice 1 设计工作的条件（而不是按日历时间）：

> 出现第一个真实需要的多节点场景——即用户自己实际想跑一次"至少两个节点、且不是简单串行 Implementation→Validation"的协作（例如并行 review + synthesis）。

**这个条件已经有具体落点，不是纯假设**：`docs/personahub-prd.md` 第 15 节 v0.2 完成判据明确要求"至少 coding workflow 支持 `orchestrator_subagent` 拓扑，且至少覆盖一次真实 fan-out → fan-in"，且 v0.2 属于第 15 节"近期承诺范围"（v0.1–v0.3）。第 5 节 topology 目录也已把 `orchestrator_subagent` 定义为"至少两个可独立调度子任务 + 显式边回传 + 收敛"，排除了"单一子 agent 顺序接力也算数"的歧义，使其成为一个可验证的最小场景，而不只是一个拓扑名字。因此 v0.2 落地 `orchestrator_subagent` 就是启动 Slice 1 设计的已知触发场景；范围严格收窄到这一个拓扑实际验收需要的 Node/Edge/NodeRun/Attempt 能力，不因为触发了就顺带把 Graph Compiler、自然语言 Graph Draft、Canvas UI 等第 2 节列出的"不在现在做"范围一起展开——那些仍然等待各自独立的真实需要。

在触发前，`orchestrator_subagent` 的具体设计仍应先用这一个真实场景校验 Node/Edge/NodeRun/Attempt 的具体字段形状，比现在凭空设计更准，返工概率更低。

**并行边界必须和现有 workspace 锁一致，不能默认放开写并发**：本决策"背景"一节已确认 `workspace-lock.ts` 是整个 `workspaceId` 级别的排他锁，同一 workspace 内多个写节点无法并行——这条约束在 v0.2 `orchestrator_subagent` 落地时依然成立，本决策不因为要满足"并行"验收就隐含放宽或替换现有锁。

**"只读 Node 不持锁并行"不能只靠 Node 角色或 prompt 自称只读来保证**：对照实际代码核实过，当前运行时没有任何机制强制这一点——`server/src/runtime/types.ts` 的 `WorkspaceContext` 只有 `workspaceId`/`localPath`/`gitBranch`/`pushCredentialsEnabled`，没有访问模式或允许写入路径字段；Codex adapter 以 `sandbox: "workspace-write"` 启动（`codex-cli-adapter.ts`）；Claude Code、OpenCode adapter 直接以 `workspace.localPath` 作为子进程 `cwd` 启动，没有任何只读限制（`claude-code-adapter.ts`/`opencode-adapter.ts`）。也就是说，一个被标记为"只读分析"的 Node，实际执行时和写 Node 一样对同一份代码有完整写权限——这和 `docs/personahub-prd.md` 第 11 节"同一时刻只有一个 agent 进程对 workspace 执行写操作"这条系统必须保证的强约束直接冲突，属于安全边界问题，不是调度优化问题（呼应 F005 用凭据隔离而不是信任 CLI 自身 approval 钩子的同一原则——结构性保证优于信任角色/prompt）。

因此 v0.2 首个 coding slice 的并行范围以**是否存在结构性隔离**为准，由 `design.md` 明确记录选了哪一种。这里必须先纠正一个容易踩的坑：**普通 `git worktree` 或普通文件拷贝本身不构成结构性隔离**——`cwd` 只限制子进程的起始目录，不限制其文件系统权限；Claude Code、OpenCode 是普通子进程，能用 `..`、绝对路径或调用工具访问原 workspace；`git worktree` 还和主仓库共享 `.git` 对象库和管理元数据（分支、config、hooks 等仓库级状态不会因为签出目录不同而被隔离）；普通目录拷贝即使去掉 `.git` 关联，也挡不住同一 OS 用户的进程访问磁盘上其它路径。这些方案换汤不换药，仍然是"信任进程不会跑出 cwd"，不是结构性保证。

合格的结构性隔离至少要满足：

- 输入来自固定 commit/内容快照，运行期间视图稳定。
- 活 workspace 及其 Git 管理目录不在子进程可访问/可写的文件系统视图中（不是"没有理由访问"，而是"访问不到"）。
- 仅一次性执行目录可写，或整个快照被强制只读。
- 子进程及其后代进程继承相同边界，不能通过它们启动的工具绕过。
- 结果通过受控 artifact/output 通道回传，不依赖对原 workspace 的直接写入。
- 三个 adapter（Codex/Claude Code/OpenCode）都经过越权写入测试验证。

可以用容器/沙箱、受限用户 + ACL、只暴露快照的挂载/命名空间等机制实现；`git worktree`/目录拷贝可以是这类隔离**内部**用来提供快照内容的手段，但不能单独作为隔离本身。三个 adapter 中是否有 provider 级别的强制只读/沙箱能力可以替代上述隔离，同样需要逐一验证并一致覆盖三者，不能只验证其中一个。

**如果 v0.2 design 阶段没有落地并验证上述边界，只读 Node 也必须进入 workspace 排他锁串行队列**——此时 `orchestrator_subagent` 的"并行"只体现为图上的逻辑 fan-out（多个 Node 被同时调度、可独立追踪），物理执行仍然串行，这依然满足"至少两个可独立调度子任务"的判据，只是不满足"物理并行"；这是当前默认应该采用的安全基线，"结构性隔离"是需要额外设计和验证成本才能解锁的加分项，不是默认路径。

写 Node（包括最终把 fan-in 结果落盘的 synthesis/implementation Node）在任何方案下都继续受 workspace 排他锁保护、串行执行；独立 worktree/branch 级别的并行**写入**及合并冲突处理不属于 Slice 1 范围，除非 v0.2 `design.md` 通过单独的设计决策显式纳入并给出锁粒度收紧方案。

### 4. 触发前允许的增量动作

以下动作成本低、和目标模型不冲突，触发条件出现前也可以顺手做，不算违反"先不做运行时"：

- 继续加强基于 `capability_tags` 的 executor 选择（F005 已经在往这个方向走：adapter 有能力标签、validator 角色靠能力判定而非写死哪个 adapter），避免新代码里再出现"写死某个 Agent 才能做某件事"的写法。
- 如果因为其他近期需求（不是为了图而图）必须扩展 `context_source_run_id` 或 Evidence Summary，扩展方向要向本决策描述的多前驱/多输入形状靠拢，不要在现有单外键设计上再打补丁。
- PRD 等产品文档里的定位表述可以现在采纳"topology-aware" → "graph-orchestrated" 的措辞调整，这是纯文档改动（具体范围见"影响"一节，`CLAUDE.md` 本身不含这个 tagline 措辞，不在此列）。

## 理由

- **为什么现在就接受方向**：PRD 已经承诺 v0.2/v0.3 要有 Collaboration Topology / Room 级别的多 Agent 协作，不是凭空引入的新话题。把目标模型现在写下来成本接近零（纯文字，可随时修订），却能防止接下来 v0.1.x 的小改动（比如给 `Run` 表继续加字段、给 `context_source_run_id` 打补丁）不小心往和目标模型相反的方向越走越远，届时改起来比现在贵。
- **为什么现在不建运行时**：现有代码只被一种图形状检验过。在只有一个真实案例的情况下设计 Edge 的 `joinPolicy`/`payloadMapping`/`routingAuthority` 等字段形状，本质是猜测；等第二个真实场景出现时大概率要改，而那时候如果已经有真实 GraphRun 数据在跑，改的成本会高于现在直接不建。另外，F004 的 validator envelope / round limit / blocked 语义是经过约 12 轮代码检视才收敛到当前正确性水平的，现在把它折进一个通用执行器里，在没有任何新功能收益的前提下重新引入回归面，是纯支出，回报要等第二种图形状真正出现才能兑现。
- **这如何真正达成"减少返工"**：本 ADR 是低成本的保险——它把词汇和目标形状（Node/Edge/Definition/GraphRun/NodeRun/Attempt）先钉下来，触发条件出现时，工程实现从一份已经达成一致的设计开始，而不需要重新讨论"Node 到底该不该等于 Agent"这类问题；同时因为没有在触发条件出现前就写运行时代码，也不需要在等待期内维护一套没有真实调用方的通用引擎。

## 影响

- `docs/personahub-prd.md` 第 2 节"一句话"定位（英文 tagline）已同批更新为"issue-managed, graph-orchestrated, evidence-grounded work"（及中文对应表述），并新增 Executable Work Graph 与 Collaboration Topology 的层级关系说明，第 13 节差异化描述、第 15 节版本路线引言与 v0.2 完成判据同步措辞并指向本决策；`CLAUDE.md` 本身不含这个 tagline 措辞，不需要跟着改。
- 未来 v0.2 编写 Graph Definition / GraphRun 相关 `design.md` 时，以本决策第 1 节的四条不变量（Node≠Agent、Definition/GraphRun/NodeRun/Attempt 分层、Edge 一等对象、Graph Runtime 组合而非取代领域服务）为默认起点，不必逐条重新论证；但 Edge 具体字段、`EdgeTraversal` 是否持久化等"待验证假设"允许被 `orchestrator_subagent` 这个真实场景推翻或调整——若调整幅度大到改变本决策的结论，通过补充或 superseding ADR 记录，而不是直接在 design.md 里悄悄偏离且不留痕迹。
- 触发条件出现前，`server/src/services/manual-routing-service.ts`、`run-context-builder.ts`、`workflow-template.ts` 等现有代码按各自 feature 的既有设计继续演进，不因本决策产生额外重构任务。
- `docs/personahub-architecture.md` 第 5 节此前描述的 `TopologyExecutor`/`SequentialTopologyExecutor` 从未真正实现，与本决策的代码审计结论矛盾，已在同一批改动中修正：原设计草图标注"未实现，仅存档"，新增"实际实现"小节如实描述当前的 service 驱动执行路径，并指向本决策作为 `orchestrator_subagent` 等非 sequential topology 的目标架构。
- `docs/personahub-architecture.md` 第 2 节"Workspace 执行边界"一行此前声称 `WorkspaceContext` 携带"允许写入的路径"，与 `server/src/runtime/types.ts` 的实际接口（无访问模式字段）不符，已修正为如实描述，并注明这是本决策"只读 Node 不持锁并行"这条边界当前无法直接开放的根本原因。
- `docs/research/graph-engineering-agentspace-personahub-analysis.md`（AgentSpace 对比调研）是本决策的背景材料之一（该文件 2026-08-12 起随 `docs/research/` 一并纳入 git，此前为 local-only）；本决策已把其中与判断相关的证据摘录进"背景"一节，本 ADR 自身不依赖该文件也能独立成立。
