---
topics: [decision, agent, memory, context, isolation, security, adapter]
doc_kind: decision
status: accepted
created: 2026-08-29
---

# 0011: 关闭 agent CLI 的原生 memory——它是上下文围栏的后门

## 背景

ADR 0009 裁定了每次执行的上下文从哪来：跨围栏冷启动、同分段可 resume。v0.3 交互设计进一步把「这次派工给它看什么」做成显式选项（全部 / 只给结果 / 只给目标），并要求降级必须披露。

这套机制有一个前提：**PersonaHub 是 agent 上下文的唯一来源**。

这个前提当前不成立，而且我们不知道它不成立。

### multica 踩过这个坑，并留下了完整论证

`multica-ai/multica` 的 `server/internal/daemon/execenv/codex_memory.go` 文件头注释记录了原因与事故：

> Codex CLI ships a native auto-memory subsystem: by default it writes summaries of agent turns to `$CODEX_HOME/memories/raw_memories.md` plus `state_*.sqlite`, and reads them back into the model context on the next turn. **The decision of what gets written is internal to Codex — users cannot audit or edit the contents from any Multica UI.**
>
> This conflicts with the Multica daemon's context model. Multica already keeps per-(agent, issue) state via PriorSessionID, the issue description / comments, issue metadata, and CLAUDE.md skill memory — **each channel is explicit, user-visible, and editable.** Layering Codex native memory on top introduces an **opaque, daemon-uncontrolled second store that can leak across tasks and (worse) across workspaces**

它记录了两条泄漏路径，第二条有真实事故编号：

- per-task 的 `codex-home/memories/` 在 `Reuse()` 之间被保留、从不清理，于是同一 `(agent, issue)` 上一轮的陈旧记忆会喂进下一轮；
- Codex CLI 还会读 `~/.codex/memories/` 这一**用户级**状态，完全在 daemon 的 per-task 隔离之外。`multica-ai/multica#3130` 的复现里，宿主本地项目 `D:\Project\MoHaYu\WowChat` 的 Raw Memories 被注入到一个**全新** multica issue 的第一轮 Codex 调用中。

multica 的处理：在 per-task `config.toml` 里写一个 managed block，关掉 `features.memories` 与 `memories.*` 的生成/消费开关；**用户全局 `~/.codex/config.toml` 一个字不改**。想要原生 memory 的用户可以用环境变量显式打开并自担泄漏风险。

同一目录下的 `hermes_memory.go` 处理的是同类问题：Hermes 把长期记忆放在 `MEMORY.md` / `USER.md`，overlay 继承了「记忆放哪」的决定并把它改成 task-local。

### 对 PersonaHub 的直接影响

PersonaHub 与 multica 的执行模型同构——都是 spawn CLI 进程（`server/src/runtime/adapters/codex-cli-adapter.ts:194` 及另外两个 adapter），因此同样会中招。后果比 multica 更严重，因为我们把上下文当成了可信度的基础：

1. **围栏被绕过且不可见。** 用户为独立验证选了「只给结果」，PersonaHub 确实没有把实现者的对话放进 prompt——但 CLI 自己从 `~/.codex/memories/` 读回上一轮的自述。验证结论仍会显示为「独立验证通过」，而它已经不是。
2. **跨 Issue、跨 Project 污染。** 用户级 memory 不区分 PersonaHub 的任何边界，A 项目的内容会进入 B 项目的首轮调用。
3. **复盘失真。** ADR 0009 把 Issue trace 定为复盘真相源，前提是 PersonaHub 记录了进入模型的全部上下文。有一个它看不见的通道时，「它当时凭什么这么判断」就答不全。

## 决策

### 1. 默认关闭 adapter 的原生 memory 子系统

每个 adapter 在准备执行环境时，必须显式关闭其原生 memory 的**写入与读取**，两侧都关。只关写入不够——历史残留文件仍会被读回。

关闭方式限定为**每次执行的私有配置**（per-task home / 私有 config），**不得修改用户的全局配置文件**。用户在 PersonaHub 之外使用同一个 CLI 的行为不受影响。

### 2. 能力缺失时必须显式降级，不得静默继续

若某个 adapter 无法关闭原生 memory，或关闭结果无法验证：

- 该 adapter 的 `capabilities` 标记为不支持上下文隔离；
- 用它执行的验证类步骤，**结论不得显示为「独立验证通过」**，只能是「有证据待验证」，并在结论行写明原因；
- 界面上按 ADR 0009 第 3 条的降级披露规则处理。

这条比第 1 条更重要：**关不掉不是事故，关不掉却假装关掉了才是。**

### 3. 用户可以显式打开，但要承担并显示后果

允许通过显式配置逐 adapter 打开原生 memory（例如某些场景确实想让 CLI 记住偏好）。打开后：

- 该 adapter 参与的所有派工，上下文范围选择器旁标注「此 adapter 有不受控的额外上下文来源」；
- 其产出的验证结论一律按第 2 条降级。

### 4. 明确不做的事

- **不接管、不迁移、不读取** adapter 的原生 memory 内容。PersonaHub 的 Memory 有自己的定义（PRD 第 5 节：经确认或高置信沉淀，必须带 `source_issue_id` / `source_thread_id` / `source_event_ids`），与 CLI 的不透明摘要不是一回事，不做双向同步。
- **不清理用户机器上已有的 memory 文件。** 关闭读取通道即可达到隔离目的；删用户的数据不在本产品职责范围内。
- **不为此新增 UI。** 这是执行环境的默认行为，只在诊断层和降级提示里可见。

## 已知未闭合项

**三个 adapter 的具体关闭方式尚未逐一核实。** 已知 Codex CLI 走 `config.toml` 的 `features.memories` / `memories.*`；Claude Code 与 OpenCode 的原生 memory 形态、是否存在、以及关闭开关都需要在实现时逐个确认。核实结果应写进各 adapter 的 `capabilities`。

**「关闭是否生效」难以自证。** 目前没有可靠手段验证一次执行确实没有读到额外上下文——除非做对照实验（同一提示、有/无历史残留，比对输出）。第一版按「配置已写入」记录，不声称已验证；这一点必须在诚实性上守住，不能把「我们关了开关」说成「我们保证没有泄漏」。

**Skills / CLAUDE.md 一类的项目级约定文件不在本决策范围内。** 它们是显式、用户可见、可编辑的，属于 multica 论证里「合法通道」的一侧。但它们同样进入模型上下文，因此在派工的上下文范围里应当可见、可关——这留给后续决策。

## 后果

- **收益一**：ADR 0009 的上下文围栏与 v0.3 的「上下文范围」选择器有了前提保障。否则那套机制在界面上成立、在运行时被绕过，是最坏的一种情况——**它让不可信的东西看起来可信**。
- **收益二**：复盘真相源的完整性有了依据。PersonaHub 记录的上下文与实际进入模型的上下文之间，不再有一条它看不见的通道。
- **成本**：每个 adapter 需要一段准备逻辑；能力缺失时的降级路径需要贯通到界面。工作量随 adapter 数量线性增长。
- **不承诺**：本决策不声称能杜绝所有隐藏上下文来源。CLI 可能有其他未公开的状态通道；我们只处理已知且有开关的那些，并要求未知情况按第 2 条降级。
- **对 PRD 的影响**：第 5 节 Memory 段落建议补一句，明确 PersonaHub 的 Memory 与 agent CLI 原生 memory 是两回事，后者默认关闭。本决策不代改 PRD。

## 关联

- 依赖：`docs/decisions/0009-agent-session-lifecycle.md`（上下文围栏与降级披露规则）
- 依赖：`docs/decisions/0008-capability-seam-convention.md`（关闭能力走 `capabilities`，消费方不写 provider 分支）
- 约束：`docs/personahub-prd.md` 第 5 节 Memory
- 证据：`multica-ai/multica` 的 `server/internal/daemon/execenv/codex_memory.go` 与 `hermes_memory.go`，事故 `multica-ai/multica#3130`
