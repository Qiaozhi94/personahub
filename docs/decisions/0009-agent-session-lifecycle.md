---
topics: [decision, architecture, agent, session, context, resume, evidence, cost]
doc_kind: decision
status: accepted
created: 2026-08-27
---

# 0009: Agent Session 生命周期——同成员续跑，跨围栏冷启动

## 背景

v0.3 交互设计定稿过程中出现一个此前没有答案的问题：**复盘时该看谁的记录**。追下去发现它背后是一个更根本、且尚未被任何文档裁定的问题——**每次执行是开新会话还是接着上一次**。

这个问题同时决定三件事，因此必须先裁定：

1. **可信度**：验证者能不能看见实现者的自述，直接决定「独立验证」是不是自证。
2. **成本**：接着上一次意味着每轮重发全部历史，成本随轮次递增；开新会话意味着重建理解，成本恒定。
3. **复盘**：Run 之间有没有上下文继承关系，决定轨迹记录能不能解释「它当时凭什么这么判断」。

### PersonaHub 现状：全部冷启动，且不可追

代码核实结果：

- 三个 adapter 各自 `spawn` 一个全新进程，跑完退出。`runtime/adapters/codex-cli-adapter.ts:194`、`claude-code-adapter.ts`、`opencode-adapter.ts` 同构。**没有常驻进程，没有在线成员**——界面上的「成员在协作现场里」是一份调度记录与权限清单，不是在线状态。
- `runs` 表（`db/schema-v2.ts:21`）字段为 `id / issue_id / thread_id / workspace_id / adapter_config_id / status / failure_reason / instructions / started_at / completed_at / exit_code / error_message / created_at / updated_at`。**没有任何字段指向 CLI 自身的 session**；`grep -rn "session_id\|sessionId" server/src` 在全仓库零命中。
- 因此当 PersonaHub 自己的记录不够用时，**回不到原始 session 排查**——找不到是哪个文件。

跨 Run 的上下文目前只靠 Handoff Packet（PRD 第 5 节，v0.1.4 已交付）承载，这一层是对的，但它假设了「每次都是冷启动」，而这个假设从未被写下来，也没有被检验过是否划算。

### 两个成熟实现都不是纯冷启动

调研 `multica-ai/multica`（Go + Postgres）与 `zts212653/clowder-ai`（TS + Redis）两个公开仓库源码，结论如下。

**multica：有条件 resume，护栏比机制本身重要。**

- session 指针存在自己的业务表，不依赖 CLI 的 session 文件：`chat_session.session_id / runtime_id / work_dir`（对话路径），`agent_task_queue.session_id`（任务路径，按 `(agent_id, issue_id)` 取最近一次，见 `server/pkg/db/queries/agent.sql` 的 `GetLastTaskSession`）。
- 十余个 adapter 全部实现 resume：`qwen` / `codebuddy` 走 `--resume <id>`，`qoder` / `traecli` / `kiro` / `grok` / `kimi` / `mcode` / `reasonix` 走 `session/resume` RPC。
- **中毒隔离**：六种终态禁止 resume——`agent_error.context_overflow`、`iteration_limit`、`codex_resume_oversized`、`codex_semantic_inactivity`、`api_invalid_request`、`agent_fallback_message`。源码注释给出的理由是「resume 上去会立刻再次溢出」「可能重放同一个卡死状态」。
- **拒绝回退**：`resume_rejected` → 丢弃 session id → fresh-session retry。
- **手动重来必冷启**：`RerunIssue` 走 `force_fresh_session=true`。
- **降级必须披露**：`session_rollout_missing` 标志使下一次运行必须告知「上一轮的上下文没能带过来」。
- **跨 agent 不走 session，走文件**：daemon 每次在 workdir 写 `.agent_context/issue_context.md`（`server/internal/daemon/execenv/context.go`），skills 写进各 provider 原生目录；`handoff_note` 是 `agent_task_queue` 上的一等字段（`migrations/122_task_handoff_note.up.sql`），指派时附带并渲染进开场 prompt。

**clowder：Session Chain，把 context window 当会耗尽的资源管理。**

- 模型是 `Thread → N Sessions per cat`，带 context health 追踪。
- 三种 per-agent 可配策略（`packages/api/src/config/session-strategy.ts`）：`handoff`（到阈值封印开新）、`compress`（让 CLI 自己压缩）、`hybrid`（允许 N 次压缩后再封印，仅限支持 hook 的 provider）。阈值按 provider 分：anthropic `0.8/0.9`、openai `0.75/0.85`、google `0.55/0.65`、opencode `0.75/0.85`。
- 封印/重生：`PreCompact` hook → `POST /api/sessions/seal`；`SessionStart` → `GET /api/sessions/latest-digest`；新 session 的 bootstrap 注入 Task 快照 + Thread metadata + ThreadMemory + 上一次 digest（`docs/features/F065-session-continuity.md`）。
- `ThreadMemory` 是线程级滚动记忆（3k–6k token 上限），专门解决「Session 5 对 Session 1 失明」。
- 两条工程护栏值得记：bootstrap 有 section-aware token cap；注入的 task 内容做 sanitize 并配 12 个 prompt injection 测试。

### 结论方向

两个项目都证明了 resume 可行且有收益，但**两者都不需要回答 PersonaHub 必须回答的那个问题**：验证者能不能看到实现者的自述。multica 的 chat/issue 两条路径都是「同一个 agent 把活干完」，clowder 的 session chain 是同一只猫的生命延续。PersonaHub 的产品承诺里有一条它们没有的硬约束——**实现与验证的上下文必须隔离**（PRD 第 7.5 节；v3.1 交互设计称之为「上下文围栏」）。

因此不能整套照抄，需要一条自己的规则。

## 决策

### 1. 三层规则

```text
1. 跨围栏          → 永远冷启动        产品承诺，不让位于效率
2. 同分段 · 短链   → resume            省成本，保留上一轮的推理过程
3. 同分段 · 长链   → 封印重生          带 digest 开新，避免成本反转与 overflow
```

**第 1 层是硬约束，不可配置、不可关闭。** 只有冷启动能保证围栏成立——resume 一定继承全部历史。任何以成本或速度为由绕过它的做法，都会让「独立验证」退化成自证，而界面上看不出来。

**第 2 层是优化。** 同一个成员在同一个上下文分段内的第二次执行（例如实现者的第 2 轮修复），冷启动会丢掉它上一轮的推理，重读一遍代码，慢且贵。

**第 3 层 v0.3 不实现，只预留判据。** 理由见第 5 条。

### 2. resume 的键是「执行组合 × Issue × 上下文范围」，不是 CLI

> **`[2026-08-29 修订]`** 本条原文写的是「成员 × Issue × 上下文分段」，分段取值为 `implement` / `verify`。ADR 0012 取消了「成员」这一层（执行单位改为 `adapter + 配置 + 模型 + 深度`，四个维度见该决策第 2 条），并把分段改为**派工时显式选择的上下文范围**——因为上下文边界不该是 Room 或角色的副作用，而应是每次派工的显式决定。下文按修订后的口径阅读。

**这是本决策最容易踩错、且踩错不报错的一条。**

multica 用 `(agent_id, issue_id)`。若 PersonaHub 照抄成 `(cli_provider, issue_id)`，会踩一个致命的坑：实现者和验证员很可能跑在同一个 Codex CLI 上，按 CLI 做键会让验证员 resume 到实现者的 session——**围栏失效，自证复活，且无任何报错**。

正确的键有三段：

| 段 | 取值 | 已有承载 |
| --- | --- | --- |
| 执行组合 | `adapter + 配置 + 模型 + 深度`（如 `codex-gpt5.6-high`；adapter 只有一份配置时省略配置段） | `runs.adapter_config_id` 指向的记录改为运行配置，见 ADR 0012 第 2 条 |
| Issue | `runs.issue_id` | 已存在 |
| 上下文范围 | `全部` / `只给结果` / `只给目标` | **需新增**，挂在派工记录上（ADR 0012 第 3、4 条） |

PRD 已经把成员与 CLI 的关系裁定清楚：

> **Agent 是用户创建的一层，不等于 CLI** `[2026-08-15 澄清]`：CLI adapter 是执行通道，Agent 是建立在通道之上的成员配置——同一个 Claude Code 可以被配置出多个不同的 Agent。

本决策给这条设计加上第二个、更硬的理由：**成员是上下文隔离的最小单位。**

**关于表名的提示**：`agent_configs` 就是「AI 成员」表（字段为 `name / role / cli_provider / capability_tags / default_model`），`runs.adapter_config_id` 是成员外键。名字读起来像 CLI 配置，是 v0.1 的历史命名，**不改名**（改名的收益不抵迁移成本），但新代码与文档一律称其为「成员」，避免有人按字面理解成 CLI 而把键取错。

**为什么还需要第三段「上下文范围」**：同一个执行组合可以先后承担实现与验证两种工作，此时前两段完全相同，只有范围能把围栏表达出来。范围由 Workflow Template 的验证段预选（ADR 0012 第 7 条），但**用户可改**；改回「全部」时验证结论必须降级，见 ADR 0012 第 4 条的保护条款。

### 3. 中毒隔离与降级披露，第一版就要有

这两条不是优化，是可用性底线，**必须与 resume 同批交付**：

- **中毒隔离**：以下终态之后禁止 resume，强制冷启动——上下文溢出、迭代次数上限、session 过大无法读回、语义无活动超时、上游拒绝会话历史。缺了这条，第一次溢出之后会陷入「resume 上去必崩、又不知道为什么」的循环。
- **降级披露**：resume 失败或被拒绝而回退到冷启动时，**界面必须显式说明「上一轮的上下文没有带过来」**，对应 multica 的 `session_rollout_missing`。静默降级会让用户以为成员记得上文，而它并不记得——这类误解产生的错误判断，比直接冷启动更贵。
- **手动重来必冷启**：用户显式发起的重跑一律冷启动。用户要的就是干净重来。

### 4. 记录什么

`runs` 表新增五个字段（迁移编号届时按序取）：

| 字段 | 用途 |
| --- | --- |
| `context_scope` | `全部` / `只给结果` / `只给目标`。resume 查找键的第三段，挂在派工记录上（原名 `context_lane`，取值为 `implement`/`verify`，已由 ADR 0012 第 4 条取代） |
| `session_start_mode` | `cold` / `resume` / `reseal`。轨迹页据此标注每个 Run 的上下文血统 |
| `resume_of_run_id` | 续自哪一次 Run；`cold` 时为空 |
| `agent_session_ref` | provider 侧的 session 标识或文件路径。**仅供诊断层使用，不进产品语言**，符合交互设计 §5 原则 5「高级内部信息渐进披露」 |
| `context_carry_lost` | 降级披露标志。为真时界面必须告知上下文未带过来 |

**`agent_session_ref` 不是复盘的真相源。** 复盘的真相源是 PersonaHub 自己的 Issue trace（F003 Development Trace：`thread_events` + `runs` + evidence），理由有四条，最后一条是决定性的：

1. CLI 的 session 碎片化——一个 Issue 的 N 次执行散在 N 个文件、跨 3 个 vendor、3 种格式；
2. 只有 agent 单方视角——你的指派、暂停、改派、权限决定、跨成员交接都不在里面；
3. 是各 CLI 的私有实现，会轮转、GC、改格式，建在上面等于依赖别人的私有 API；
4. **它记录的是 agent 的叙述，而叙述正是不可信的那一层。** 复盘需要的机器事实（命令、退出码、文件变更、用例结果）本来就在 PersonaHub 手里。

`agent_session_ref` 的定位是**真相源失灵时的逃生口**，不是替代品。

### 5. 明确不做的事

- **不做 clowder 的三策略（handoff / compress / hybrid）**。那是为长对话设计的；PersonaHub 的 Issue 是任务不是对话，同一分段内的执行轮次远达不到需要策略切换的长度。只在 `session_start_mode` 里预留 `reseal` 取值，等真实出现长链再实现。
- **不做常驻 agent 进程 / 在线成员**。冷启动 + 显式上下文是本产品可解释性的基础，不是待优化的缺陷。
- **不给 `agent_configs` 改名**。见第 2 条。
- **不实现自动 lane 划分之外的分段扩展**。v0.3 只有 `implement` / `verify` 两个取值；更细的分段等 Workflow Template 真正需要时再加。

## 已知未闭合项

**三个 adapter 是否都能报出 session 标识，尚未逐一核实。** 已知情况不同：Codex 有 session 文件，Claude Code 在 stream-json 中带 session id，OpenCode 的 session 形如 `ses_…` 且带 `parent_id`（可见于本仓库 `conversations/opencode/` 归档）。但 PersonaHub 的三个 adapter 目前**都没有解析它**——`runtime/adapters/` 下无任何 session 相关代码。

处理方式：**能力缺失时降级为永远冷启动**，并在成员的 `capabilities` 上体现（对应 ADR 0008 第 1 条「Consumer 问能力位，不问身份」——消费方读 `supportsSessionResume`，不写 `if (provider === "codex")`）。

**成本反转的具体阈值未知。** 「resume 成本随轮次递增、冷启动成本恒定，某一轮会交叉」是结构性判断，但交叉点在哪取决于 provider 的缓存行为和 Issue 的上下文体量，本地无数据。第一版先记录 `session_start_mode` 与轮次，等 dogfooding 攒出数据再定阈值——这也是第 3 层暂不实现的原因。

**围栏的判定依赖 Workflow Template 的验证段能区分实现类与验证类步骤。** PRD 的 Validation Policy 表按 Issue Type 给出了验证方式（coding = tests pass / diff review / lint / verification trace 等），但尚未形式化到「某个 Run 属于哪一段」的粒度。这是 v0.3 交互设计「用例覆盖表 + 上下文围栏」落地时必须一并解决的，不能只在界面上画一条线。

## 后果

- **收益一**：交互设计里的「上下文围栏」从一句界面文案变成一条可执行、可验证的架构约束——围栏两侧永远是两个 session，这一点在 `session_start_mode` 与 `resume_of_run_id` 上可直接查验，无法伪造。
- **收益二**：轨迹页的每个 Run 能标出上下文血统（`⊘ 冷启动` / `⟳ 续跑自 Run #N` / `✂ 封印重生`）。复盘时判断「它当时是不是被上一轮污染了」，全靠这一个标记。
- **收益三**：同成员续跑不再每次重读代码，成本与延迟都下降；下降幅度未测，不做承诺。
- **成本**：`runs` 五个字段 + 一次迁移；三个 adapter 各需实现 session 捕获与 resume 传参，能力缺失时降级冷启动。工作量随 adapter 数量线性增长。
- **不承诺**：本决策不声称 resume 一定更省钱。它只保证**成本模型可解释**——每个 Run 是冷是续、上下文有没有丢，都有记录可查。
- **对 PRD 的影响**：第 5 节 Agent 段落建议补一句「成员是上下文隔离的最小单位」，作为「Agent 不等于 CLI」的第二个理由。本决策不代改 PRD，按 `docs/SOP.md` 的文档纪律另行处理。

## 关联

- 被修订：`docs/decisions/0012-object-model-simplification.md`（执行单位、上下文范围）
- 依赖：`docs/decisions/0011-disable-native-agent-memory.md`（关掉 agent 原生 memory，否则围栏有后门）
- 依赖：`docs/decisions/0008-capability-seam-convention.md`（`supportsSessionResume` 走 capabilities，不走 provider 分支）
- 依赖：`docs/features/0.1/F003-development-trace/spec.md`（复盘真相源）
- 约束：`docs/features/0.3/F009-artifact-foundation-provenance/spec.md`、`F010-artifact-centered-coding-slice/spec.md`（Artifact 是成员之间唯一的通信介质——成员之间没有共享上下文，只有共享产物）
- 约束：v3.1 交互设计基线 `ui-reference/personahub-draft/personahub-v3.1/docs/design.md`（上下文围栏、轨迹页的上下文血统标记）
