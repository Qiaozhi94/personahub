---
topics: [architecture-review, design-review, runtime, agent-team-os]
doc_kind: review
status: superseded
created: 2026-07-12
superseded: 2026-08-01
superseded_by: code-review-report.md
related_docs:
  - docs/personahub-architecture.md
  - docs/personahub-prd.md
  - docs/personahub-system-design.md
---

# PersonaHub 软件架构设计评审

> **已归档 / Superseded（2026-08-01）**：本文评审的是编码前的 v0.1 架构草案，问题已在后续实现和当前评审中处理，不再作为现状或开发入口。当前结论见仓库根目录 `code-review-report.md`，实现真相源见 `CLAUDE.md` 与 `docs/features/`。

> Review target: `docs/personahub-architecture.md`
> Review date: 2026-07-12

## 总体结论

`personahub-architecture.md` 的整体方向是正确的：它没有把 v0.1 写成一次性脚本，而是把本地 API、Runner、Repository、事件流、Workspace 边界设计成未来 daemon / queue / multi-workspace / isolation 的前身。这符合 PRD 中“个人优先、本地优先、但不把后路堵死”的判断。

当前文档已经可以作为 v0.1 实现的起点，但在进入编码前，建议优先补齐三类底层契约：

- Runtime recovery / stale lock：避免 workspace 锁在进程崩溃后永久卡死。
- CLI agent 安全与 escalation 执行模型：确保 PRD 中的硬阻塞边界能被架构真正落住。
- Event cursor + replay contract：确保 SSE 断线重连、历史补齐和前端去重有明确机制。

## 主要问题

### 1. Escalation 目前在架构上不可真正保证

架构文档第 8 节写道：Runner / Workflow Engine 在检测到 escalation 条件时暂停或终止 run，并要求“Runner 发起任何子进程动作前必须先过 escalation 检查”。

问题在于：P0 的 agent 是 CLI 子进程。一旦 Codex CLI 被 spawn 到 workspace 中，后续它自己执行的 `git push`、不可逆删除、跨目录写入、申请凭据等行为，仅靠 Runner 的事前检查无法可靠拦截。

这与 PRD 第 11 节的硬边界存在落差：

- 不可逆文件或数据删除需要 escalation。
- 跨 workspace 写入需要 escalation。
- `git push`、force push、直接写入受保护分支默认禁止，需要 operator 显式授权。
- Escalation 是硬阻塞，不是软提示。

建议在架构中补充“执行权限模型”，至少说明 v0.1 如何组合以下机制：

- Adapter 启动参数和工作目录限制。
- 危险命令检测。
- Git 操作策略，例如允许本地 commit，但禁止 push / force push。
- 文件变更扫描，确认写入是否越过 workspace 边界。
- 对无法技术拦截的 CLI 行为，明确降级为“检测后阻塞 / 标记风险 / 不承诺完全拦截”。

否则“硬阻塞”会成为产品承诺，但架构无法兑现。

### 2. Workspace 锁的持久化恢复策略有死锁风险

架构文档第 2 节提出 workspace 写锁同时保存在内存 mutex 和 DB 字段中，重启后可从 DB 恢复锁状态。

这个方向是对的，但当前缺少 stale lock 的恢复机制。如果 Node 进程崩溃，或 agent 子进程已经退出但 DB 中仍保留 `locked_by_run_id`，workspace 可能永久处于 locked 状态，后续 run 一直排队。

建议补充：

- Workspace lock 增加 `locked_at`、`lease_expires_at` 或 `runner_instance_id`。
- Runner 定期 heartbeat，刷新当前 run / lock 状态。
- API server 启动时扫描 `Running` / `locked` 状态。
- 对无法确认仍活跃的 run 标记为 `interrupted` 或 `failed`。
- 确认无活跃 owner 后释放 stale lock，并写入 `run.interrupted` / `workspace.lock_recovered` 事件。

这样既保留了“重启后不忘记锁”的谨慎性，也避免崩溃后永久卡死。

### 3. AgentAdapter 抽象太薄，可能撑不住 Thread 中持续指挥 agent

当前接口只有：

```ts
interface AgentAdapter {
  start(input: {
    issueId: string
    workspace: WorkspaceContext
    instructions: string
  }): RunHandle
}
```

以及 `onOutput`、`onExit`、`cancel`。

但 PRD 要求用户可以在 Thread 中持续下发开发、修复、验证等指令，并尽量不切换到 CLI。这里至少需要明确 adapter 的会话模型：

- 每条 Thread 指令是否都会创建一个新 Run？
- Codex CLI 是否以长会话方式运行？
- 如果是长会话，是否需要 `sendInput()` / session resume / approval callback？
- 如果是一次性命令，如何把历史 Thread、handoff packet、evidence refs 重新组装成 prompt context？
- Adapter 是否需要暴露 capability，例如 supportsInteractiveInput、supportsResume、supportsStructuredOutput？

建议在架构文档中明确 P0 采用哪一种模式。否则前端、Runner 和 Workflow Engine 会对“一个 agent run 到底是什么”产生不同理解。

### 4. 事件流缺少 cursor / replay contract

架构文档第 4 节说明事件先写 SQLite，再通过 EventEmitter 广播，前端断线重连可从 DB 补历史。

但当前缺少具体契约：

- SSE 是否使用标准 `Last-Event-ID`？
- API 是否支持 `?after_event_id=`？
- `ThreadEvent.id` 是否是全局单调递增 cursor？
- 同一 thread 内如何保证顺序？
- 前端如何去重？
- 如果广播成功但前端 ack 丢失，如何避免重复渲染？

建议补充：

- 所有 `ThreadEvent` 有稳定、可排序、单调递增的 event id。
- SSE event id 使用 `ThreadEvent.id`。
- 订阅接口支持 `after_event_id` 或 `Last-Event-ID`。
- 前端按 event id 去重，并按 event id 排序渲染。
- `created_at` 只作为展示时间，不作为排序唯一依据。

这会直接影响 Thread 是否能成为可信 trace，而不是只靠实时 UI 状态。

### 5. Artifact 是 PRD 主线，但架构文档缺少落点

PRD v0.3 明确提出 artifact-centered collaboration，要求 Room、handoff、validator 和 evidence 都能引用 artifacts。当前架构文档虽然强调事件和 repository，但没有说明 Artifact Service、artifact storage、manifest、引用校验或导出边界。

不需要现在设计完整 v0.3 机制，但建议在第 4 节或第 6 节补一个轻量边界：

- Artifact 由 Repository / ArtifactService 管理。
- 支持 `inline_markdown`、`local_file_path`、`db_record` 等 storage type。
- `ThreadEvent`、`HandoffPacket`、`EvidenceSummary` 可以引用 artifact refs。
- Artifact refs 必须可追溯到 issue / thread / run。
- v0.1 的 evidence / handoff 先使用同一引用格式，避免后续迁移。

这样 v0.1 的 trace 不会写成只能依赖聊天文本，后续 v0.3 更容易接上。

### 6. “新增 Issue Type / Workflow 只是新增 template 数据”偏乐观

架构文档第 9 节认为 v0.4 新增 Windows Troubleshooting / Paper Reading 等 workflow “只是新增 template 数据，不需要动 Workflow Engine 本身”。

这个判断适合作为期望，但不宜写成架构承诺。不同 workflow 很可能影响运行时能力：

- Windows troubleshooting 涉及系统诊断命令、权限提升、环境变更和更严格的危险操作拦截。
- Paper / Book / Research 涉及资料输入、引用来源、长文本 artifact、外部文件读取和 evidence 类型扩展。
- Writing workflow 可能涉及 artifact versioning、导出格式和人工编辑闭环。

建议改成更保守的表述：

> v0.4 新 Issue Type 优先通过 WorkflowTemplate / ValidationPolicy / Agent capability 扩展；若出现新的执行边界、证据类型或权限模型，再局部扩展 Runner / Evidence / Adapter 层，不预先承诺完全不改 engine。

## 次要问题

### PRD 章节引用可以更稳

架构文档中多处引用“PRD 第 6 节”“PRD 第 5 节 Trace Events”。如果 PRD 后续调整章节编号，这些引用会很快漂移。

建议重要引用同时保留小节名，例如：

- PRD “信息架构”小节。
- PRD “Trace Events”小节。
- PRD “自动化与安全边界”小节。

### AgentOps metrics 不一定只是 Run 表加列

架构文档第 9 节说 v0.5 的 cost / duration / retry count 等只是在 Run 表加列。

基础指标可以落在 Run 表，但 workflow success rate、blocked reason、tool efficiency 等更可能来自事件投影或聚合表。建议改成：

> Run 表承载基础运行指标；聚合型 AgentOps 指标可由 ThreadEvent / Run 派生，必要时新增 projection 表，不影响 Runner 主流程。

## 建议修改优先级

### P0 前必须补齐

- CLI agent 安全与 escalation 执行模型。
- Workspace lock recovery / stale lock 策略。
- Event cursor / SSE replay contract。

### P0 实现中同步补齐

- AgentAdapter 会话模型。
- Run lifecycle：queued / running / completed / failed / interrupted / cancelled。
- Handoff / evidence refs 的统一引用格式。

### v0.1 后、v0.3 前补齐

- ArtifactService / artifact manifest / artifact refs。
- Room 和 artifact-centered collaboration 的最小运行时边界。

## 结论

这份架构文档的主干是可信的，尤其是 Repository、Runner、TopologyExecutor、SSE event stream 这些边界都放在了合适的位置。真正需要加强的是“运行时真实世界会坏掉时怎么办”：CLI 不受控、进程崩溃、事件断线、锁残留、危险操作漏拦。

建议先把这些 failure mode 写进架构文档，再进入 v0.1.0 实现。这样 PersonaHub 的第一版不会只是“能跑”，而是从一开始就有成为可信 agent team OS 的骨架。
