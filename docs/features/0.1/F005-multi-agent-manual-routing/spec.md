---
feature_ids: [F005]
related_features: [F002, F003, F004]
topics: [agent-adapter, claude-code, opencode, manual-routing, multi-agent, v0.1.4]
doc_kind: spec
created: 2026-07-12
---

# F005：Manual Multi-Agent Routing（手动多 Agent 路由）

> Status: spec | Owner: TBD | Target: v0.1.4

## 0. 规格元信息

- **PRD 来源**：`docs/personahub-prd.md` 第 15 节 v0.1.4 手动多 Agent 路由、第 8 节 P0 功能列表（Claude Code / OpenCode 接入 + OAuth/API key）、第 7.5 节 validator 独立性。
- **架构来源**：`docs/personahub-architecture.md` 第 3 节 `AgentAdapter` 抽象（已按多 adapter 设计，本 feature 是第二、第三个真实落地的 adapter）、第 9 节 CLI Agent 执行权限模型（凭据隔离原则须对新 adapter 同样生效）。
- **系统设计来源**：`docs/personahub-system-design.md` 中的 Agent、Run、ThreadEvent、HandoffPacket。
- **上游决策**：`docs/decisions/0002-first-agent-adapter.md`（Codex 是 P0 第一个 adapter，registry 已预留扩展点）、`docs/decisions/0004-ui-styling-stack.md`（composer 里的 agent 选择器沿用同一套组件/token）。
- **上游 feature**：F002 Agent Command Center（本 feature 扩展其 Adapter Registry 和 dispatch 模型，不重新设计）、F003 Development Trace（复用 Handoff Packet / evidence refs）、F004 Autonomous Validation（手动指定的 validator Run 要接入其状态机）。
- **功能类型**：user-facing / backend / runtime。
- **规格模式**：full。
- **变更类型**：ADDED（新增 Claude Code / OpenCode adapter 和手动路由 UI），对 F002 的 Run 创建接口做 MODIFIED（增加 purpose/role 区分）。
- **一句话意图**：让用户在 Issue 的 primary Thread 里手动 @ 选择 Codex / Claude Code / OpenCode 中的一个处理当前指令，被选中的 agent 自动读取上一轮的 Handoff Packet 和证据作为上下文，不需要用户手动复制结论。

## 1. 问题与目标

### 问题

F001-F004 交付后，PersonaHub 能自动完成"一个 implementation agent + 一个 validator agent"的顺序闭环，但闭环里始终只有 Codex 一种 CLI。用户真实的多 agent 协同需求——比如让 Claude Code 专门做代码 review、让 OpenCode 做通用调研或使用其他模型——目前无法满足：只要需要用到 Codex 之外的能力，用户就得离开 PersonaHub，回到这些 CLI 各自的终端，手动把结论和上下文复制过去。这正是 PRD 第 4.1 节承诺要消除的"传话筒"角色，在多 agent 场景下还没有被真正解决；而完整解决（Coordinator 自动组队、Room 可视化协作）还要等 v0.2、v0.3，中间这段空白需要一个更轻量的过渡方案。

### 目标

- 在 F002 已接入的 Codex adapter 基础上，接入 **Claude Code CLI adapter** 和 **OpenCode CLI adapter**，三者同时可配置、可用。
- 支持三种 adapter 的鉴权配置：Codex、Claude Code 走 **OAuth 登录**（复用各 CLI 自身的登录机制）；OpenCode 除了 OAuth 外，还支持**单独配置 API key / model 等信息**，因为 OpenCode 定位是可对接多种模型 provider 的通用 CLI。
- Thread composer 提供一个 agent 选择器（例如 @ 提及或下拉），用户下发指令时手动指定由哪个已配置 adapter 处理这一轮。
- 手动派发的 Run 自动读取上一轮的 Handoff Packet（F003）和 evidence refs 作为上下文，用户不需要手动复制结论。
- 手动指定的 agent 如果承接的是当前 Issue 的 validator 角色（implementation 完成、Issue 处于 `Validating` 时），其输出要接入 F004 已有的 validation 状态机（pass/fail/blocked 路由），而不是另建一套判定逻辑。
- 危险操作的 escalation / 凭据隔离（F002）必须对 Claude Code、OpenCode 同样生效，不能只保护 Codex。

### 非目标

- 不做 Coordinator 自动推荐/自动选择该用哪个 agent；"该找谁"这个判断由用户手动做，这是 v0.2 的范围。
- 不做 Workflow Template / Collaboration Topology 的自动识别或推荐（v0.2）。
- 不做 Room 可视化协作现场、agent 之间的讨论展示、动态组队（v0.3）。
- 不做真正的多 agent **并行**执行；同一时刻仍然只有一个 agent 在跑，F002 的 workspace 写锁模型不变——手动路由改变的是"下一个 Run 交给谁"，不改变"同一时刻只能有一个 Run 在写 workspace"这条约束。
- 不重新设计 F004 的 validation 状态机或 round limit 逻辑，只是让"由谁承担 validator 角色"这件事除了 Workflow Template 的默认配置外，多一条用户手动指定的路径。

## 2. 用户场景与独立测试

### US1：配置 Claude Code / OpenCode adapter（Priority: P1）

作为用户，我希望在 Project 中配置 Claude Code 和 OpenCode adapter，以便 Thread 里能手动调度它们。

**为什么是这个优先级**：没有可用 adapter，手动路由无从谈起。

**独立测试**：分别配置一个 Claude Code adapter（OAuth 登录）和一个 OpenCode adapter（可选 OAuth 或直接填 API key + model），验证 Project 的 Agents 列表里三个 adapter 都显示可用状态。

**验收场景**：

1. Given Project 已存在，when 用户配置 Claude Code adapter 并完成 OAuth 登录，then 系统保存配置并显示可用。
2. Given Project 已存在，when 用户为 OpenCode adapter 填写 provider/model/API key，then 系统保存配置、校验 key 有效性并显示可用，不要求走 OAuth。
3. Given OpenCode 也支持 OAuth 登录，when 用户选择 OAuth 方式而不填 API key，then 系统同样接受。
4. Given 任一 adapter 的鉴权信息无效或过期，when 用户查看 Agents 列表，then 该 adapter 显示不可用及原因。

### US2：Thread 里手动指定由谁处理这一轮指令（Priority: P1）

作为用户，我希望在输入指令时手动选择由 Codex、Claude Code 还是 OpenCode 处理，而不是永远只能用 Codex。

**为什么是这个优先级**：这是"多 agent 协同"这个核心诉求最小可用的切片。

**独立测试**：在一个已有 implementation Run 完成的 Issue 里，手动选择 Claude Code 处理下一轮指令，验证系统创建的 Run 确实使用 Claude Code adapter，而不是默认的 Codex。

**验收场景**：

1. Given Project 已配置多个可用 adapter，when 用户在 composer 中选择一个 agent 并发送指令，then 系统创建 Run 时使用被选中的 `adapter_id`。
2. Given 用户没有主动选择，when 用户直接发送指令，then 系统使用一个明确的默认 adapter（不是随机挑选），并在 UI 上显式标出当前默认是谁。
3. Given 某个 adapter 当前不可用，when 用户尝试选择它，then 该选项在 UI 上被禁用并说明原因。

### US3：被指定的 agent 自动读取上一轮结论，不需要手动复制（Priority: P1）

作为用户，我希望换一个 agent 处理时，它能自动知道前面发生了什么，而不需要我把结论重新讲一遍。

**为什么是这个优先级**：这是本 feature 解决"传话筒"问题的核心机制，没有它，多 adapter 只是多了几个可以选的选项，问题本身没解决。

**独立测试**：implementation Run（Codex）完成并生成 Handoff Packet 后，手动 @ Claude Code，验证 Claude Code 收到的 context 里包含上一轮的 summary、changed files、evidence refs，而不是空白上下文。

**验收场景**：

1. Given 上一轮 Run 已生成 Handoff Packet 和 evidence refs，when 用户手动指定另一个 adapter 处理下一轮，then 系统组装的 context 中包含该 Handoff Packet 和 evidence refs。
2. Given 这是 Issue 的第一轮（没有上一轮 Handoff），when 用户手动指定 agent，then context 仅包含 Issue 本身的 goal / title，不报错。

### US4：手动指定的 agent 承接 validator 角色（Priority: P1）

作为用户，我希望在 implementation 完成后，手动指定 Claude Code（而不是系统默认）来做这一轮的验证，并且验证结果照样能推进 Issue 到 Done 或 Blocked。

**为什么是这个优先级**：这是"多 agent 协同"里最有实际价值的场景——用一个和实现方完全不同的 provider 做验证，天然满足 F004 的独立性要求，比同 provider 不同 model 更可信。

**独立测试**：implementation Run（Codex）完成、Issue 进入 `Validating` 后，用户手动 @ Claude Code 而不是等待系统默认 validator，验证 Claude Code 的输出被解析为 F004 定义的 validation result，并正确驱动 Issue 状态。

**验收场景**：

1. Given Issue 处于 `Validating`，when 用户手动指定一个 adapter 处理这一轮，then 该 Run 被标记为 validator 角色，其输出按 F004 `FR-003` 的规则解析为 pass/fail/blocked。
2. Given 手动指定的 validator 与 implementation 使用不同的 `cli_provider`，when validation passed，then Evidence Summary 中 `same_origin_validation` 标记为 `false`。
3. Given 用户在 Issue 处于 `Validating` 时没有手动指定，when 达到系统默认的等待时间或用户明确不介入，then 沿用 F004 已有的自动 validator 逻辑，不因为本 feature 的存在而破坏原有自动闭环。

### US5：自由咨询式 Run，不驱动 Issue 状态机（Priority: P2）

作为用户，我希望能临时拉一个 agent 做点和当前 Workflow 阶段无关的事情（比如调研一个库），这次交互只是留痕，不应该影响 Issue 的状态流转。

**为什么是这个优先级**：这类用法很自然会发生，但不是"多 agent 协同"最核心的诉求，可以在核心路由能力稳定后再完善。

**独立测试**：在 Issue 处于任意状态时，手动 @ OpenCode 让它做一次调研，验证 Issue 状态不变，但 Thread 里留下这次交互的完整记录。

**验收场景**：

1. Given Issue 处于 `Running` 或 `Validating`，when 用户手动 @ 一个 adapter 做非 implementation/validator 性质的请求，then 系统创建一个"咨询性" Run，不改变 Issue 状态。
2. Given 咨询性 Run 已完成，when 用户或后续 Run 查看 Thread，then 可以看到这次交互的完整输出，可作为后续参考。

### US6：危险操作 escalation 覆盖所有 adapter（Priority: P1）

作为用户，我希望 Claude Code、OpenCode 触发危险操作时，也和 Codex 一样受 F002 的凭据隔离和 escalation 机制保护，而不是只有 Codex 受保护。

**为什么是这个优先级**：PRD 的安全边界是对"agent"整体的承诺，不是只针对某一个 CLI；接入新 adapter 时如果漏掉这一层，等于开了后门。

**独立测试**：让 Claude Code 或 OpenCode 尝试 `git push`，验证同样因为缺少 push 凭据而失败，并触发 escalation。

**验收场景**：

1. Given Workspace 未开启 `push_credentials_enabled`，when Claude Code 或 OpenCode 在 Run 中尝试 `git push`，then 行为与 Codex 一致：push 因缺少凭据失败，触发 escalation，Issue 置 `Blocked`。

## 3. 范围

### 范围内

- Claude Code CLI adapter、OpenCode CLI adapter 的配置和可用性校验。
- Codex / Claude Code 的 OAuth 登录流程引导；OpenCode 的 API key / model 配置表单。
- Agent Adapter Registry 扩展为支持多 provider 类型的查找（在 F002 已有 registry 基础上）。
- Thread composer 的 agent 选择器（选择由谁处理这一轮）。
- 手动派发的 Run 自动携带上一轮 Handoff Packet + evidence refs 作为 context。
- 手动指定的 validator Run 接入 F004 已有的 validation 状态机。
- 手动派发的"咨询性" Run（不对应 workflow 阶段角色）的最小支持：创建、记录、不驱动 Issue 状态机。
- F002 的 workspace 写锁、凭据隔离、escalation 机制扩展到 Claude Code、OpenCode。

### 范围外

- Coordinator 自动推荐/分派该用哪个 agent（v0.2）。
- Workflow Template / Collaboration Topology 自动识别或推荐（v0.2）。
- Room、多 agent 并行执行、agent 之间的可视化讨论（v0.3）。
- Squads / Agent Team Template 的分组管理（v0.2/v0.3）。
- 除 Claude Code、OpenCode 外的更多 provider。
- AgentOps trust scoring、跨 adapter 的成本/质量对比（v0.5）。

### 边界场景

- Claude Code / OpenCode 未安装、登录态失效或 API key 失效。
- 用户在 Issue 已经 `Blocked` 时尝试手动派发 Run。
- 手动指定的 validator Run 输出无法解析（复用 F004 的 `validation.blocked` 处理，不新建一套）。
- 同一个 Issue 短时间内被 @ 多个不同 adapter，workspace 锁仍然只允许一个在跑，其余排队。
- 用户在没有任何已配置 adapter 时尝试发送指令。
- OpenCode 同时配置了 OAuth 和 API key 两种鉴权信息。

## 4. 需求

### 功能需求

### Requirement: Claude Code Adapter 配置（`FR-001`）

系统应当允许用户为 Project 配置 Claude Code adapter，通过 OAuth 登录完成鉴权。

#### Scenario: 配置并登录

- GIVEN Project 已存在
- WHEN 用户添加 Claude Code adapter 并完成 OAuth 登录
- THEN 系统保存 adapter 配置
- AND 状态显示为可用

### Requirement: OpenCode Adapter 配置（`FR-002`）

系统应当允许用户为 Project 配置 OpenCode adapter，支持 OAuth 登录或直接配置 provider / model / API key 两种鉴权方式。

#### Scenario: API key 配置

- GIVEN Project 已存在
- WHEN 用户为 OpenCode 填写 provider、model 和 API key
- THEN 系统校验并保存配置
- AND 状态显示为可用，不要求 OAuth 登录

#### Scenario: OAuth 配置

- GIVEN Project 已存在
- WHEN 用户选择让 OpenCode 走 OAuth 登录
- THEN 系统同样接受，不要求填写 API key

### Requirement: Adapter Registry 支持多 provider 查找（`FR-003`）

系统应当能根据 provider 类型（`codex` / `claude-code` / `opencode`）从 registry 中查找到对应的可用 adapter。

#### Scenario: 按 provider 查找

- GIVEN Project 已配置多个不同 provider 的 adapter
- WHEN 系统需要为某次 dispatch 解析 adapter
- THEN registry 返回与请求的 `adapter_id` / provider 匹配的实现

### Requirement: Thread 手动指定处理 agent（`FR-004`）

用户在 Thread 中下发指令时，系统应当允许手动指定由哪个已配置 adapter 处理。

#### Scenario: 手动选择

- GIVEN Project 配置了多个可用 adapter
- WHEN 用户在 composer 中选择一个 adapter 并发送指令
- THEN 系统创建的 Run 使用用户选择的 `adapter_id`

#### Scenario: 未手动选择时的默认行为

- GIVEN 用户未在 composer 中做出选择
- WHEN 用户发送指令
- THEN 系统使用一个明确标识的默认 adapter
- AND UI 上显式展示当前默认是谁

### Requirement: 自动携带上一轮上下文（`FR-005`）

系统应当在创建手动指定的 Run 时，自动把上一轮的 Handoff Packet 和 evidence refs 组装进 context。

#### Scenario: 有上一轮 Handoff

- GIVEN Issue 已有上一轮 Run 生成的 Handoff Packet
- WHEN 用户手动指定另一个 adapter 处理下一轮
- THEN 该 Run 的 context 包含上一轮 Handoff Packet 和 evidence refs

#### Scenario: 没有上一轮 Handoff

- GIVEN Issue 是第一轮交互，没有 Handoff Packet
- WHEN 用户手动指定 adapter
- THEN context 仅包含 Issue 的 title / goal，不报错

### Requirement: 手动 validator 接入 F004 状态机（`FR-006`）

当 Issue 处于 `Validating` 且用户手动指定 adapter 处理这一轮时，系统应当将该 Run 标记为 validator 角色，并按 F004 已有规则解析其输出。

#### Scenario: 手动 validator 判定通过

- GIVEN Issue 处于 `Validating`
- WHEN 用户手动指定的 adapter 输出 pass
- THEN 系统按 F004 `FR-004` 的规则将 Issue 置为 `Done`
- AND Evidence Summary 记录该 adapter 作为 `validator_identity`

#### Scenario: 手动 validator 判定失败

- GIVEN Issue 处于 `Validating`
- WHEN 用户手动指定的 adapter 输出 fail
- THEN 系统按 F004 `FR-005` 的规则回流 findings，Issue 回到 `Running`

### Requirement: 咨询性 Run 不驱动状态机（`FR-007`）

系统应当以"这次 @ 是否命中当前 Issue 状态期望的角色"作为判定 Run 是 workflow-bound 还是咨询性的信号，而不是要求用户每次显式声明。参考 clowder-ai 对 Message 和 Invocation 解耦的设计（只有 `@` 命中目标才创建正式 Invocation，否则只是普通消息，不触碰任务状态）：Issue 处于 `Validating` 且用户 @ 的 adapter 具备 validator 能力时，视为 workflow-bound（承接 validator 角色）；其余情况下的 @ 指令视为咨询性 Run，不改变 Issue 状态。

#### Scenario: @ 命中期望角色

- GIVEN Issue 处于 `Validating`
- AND 用户 @ 的 adapter 被配置了 validator 能力
- WHEN 用户发送指令
- THEN 系统将该 Run 标记为 workflow-bound（validator 角色）

#### Scenario: @ 未命中期望角色（咨询性）

- GIVEN Issue 处于任意非终态状态
- WHEN 用户手动 @ 一个 adapter，且当前 Issue 状态没有期望这个角色介入（例如 Issue 处于 `Running` 而不是 `Validating`，或被 @ 的 adapter 不具备当前阶段需要的能力）
- THEN 系统创建 Run 并记录输出
- AND Issue 状态保持不变

### Requirement: 手动 validator 与自动 validator 互斥（`FR-009`）

系统应当保证同一 Issue 同一时刻只有一条 pending（`queued`/`running`）的 validator 角色 Run，无论它是用户手动指定还是系统自动触发。

#### Scenario: 手动介入抢先

- GIVEN Issue 刚进入 `Validating`，系统尚未创建自动 validator Run
- WHEN 用户在此之前手动指定了一个 adapter 承接 validator 角色
- THEN 系统不再自动创建默认 validator Run
- AND 后续系统自动创建请求因唯一约束冲突而被拒绝，不产生重复 Run

#### Scenario: 自动流程抢先

- GIVEN 系统已经自动创建了 validator Run 且处于 `queued`/`running`
- WHEN 用户此时尝试手动指定另一个 adapter 也承接 validator 角色
- THEN 系统拒绝该请求，并提示已有一条 validator Run 在进行中

### Requirement: Escalation 覆盖所有 adapter（`FR-008`）

F002 定义的凭据隔离和 escalation 机制应当对 Claude Code、OpenCode 同样生效，不因为 adapter 类型不同而失效。

#### Scenario: 非 Codex adapter 触发 escalation

- GIVEN Workspace 未开启 push 凭据
- WHEN Claude Code 或 OpenCode 在 Run 中尝试 `git push`
- THEN 行为与 Codex 一致：push 失败，触发 escalation，Issue 置 `Blocked`

### 数据 / 实体需求

- **DR-001**：Adapter config 应当支持 `auth_type`（`oauth` / `api_key`）；`api_key` 方式下的凭据字段**沿用 multica / clowder-ai 的存储方式**——不做额外加密，明文存储在本地（DB 列或本地配置文件），只在 API 响应/UI 展示时打码（如 `****`），并通过本地文件/数据库的访问权限做基本保护。这是有意识的从简决定，不是遗漏；如果后续需要更强的机密性保证（例如 OS keychain 集成），作为独立的安全加固任务另行评估，不在本 feature 阻塞。
- **DR-002**：Run 应当增加区分"workflow-bound"（implementation / validator，驱动 Issue 状态机）和"ad-hoc consult"（咨询性，不驱动状态机）的字段。
- **DR-003**：Run 应当能记录是否由用户手动指定 adapter（区别于系统默认），用于审计和回溯。
- **DR-004**：其余 Run / ThreadEvent 字段沿用 F002 既有定义，不重复设计。
- **DR-005**：Run 表应当增加一条数据库级 partial unique 约束，保证同一 `issue_id` 同一时刻最多只有一条 `role = validator` 且 `status IN (queued, running)` 的记录，作为 `FR-009` 互斥规则的强制手段（参考 multica `agent_task_queue` 的同类约束，以及 F001 primary Thread 唯一性约束的既有先例）。应用层可以有一次前置检查作为优化（减少无意义的失败），但正确性以这条 DB 约束为准，不依赖进程内锁——同一时刻先提交成功的一方获胜，另一方收到明确的冲突错误，不产生重复 Run。

### 事件 / Trace 需求

- **TR-001**：手动创建 Run 时，`run.queued` payload 应当标注该 Run 是否为用户手动指定 adapter。
- **TR-002**：咨询性 Run 完成时，应当有明确的 trace 记录其"不驱动状态机"的性质，避免用户误以为它是正式的 workflow 步骤。
- **TR-003**：其余事件沿用 F002 / F003 / F004 已定义的 `run.*` / `validation.*` / `handoff.*` 事件，不新增重复概念。

### API / 接口需求

- **IR-001**：Adapter config 的创建/更新接口应当支持 `auth_type` 和 OpenCode 特有的 provider/model/API key 字段。
- **IR-002**：F002 的创建 Run 接口（`adapter_id` 已必填）应当支持标注该 Run 的 purpose（workflow-bound / ad-hoc consult）。
- **IR-003**：读取 Issue 的接口应当能区分展示 workflow-bound Run 和咨询性 Run。

### UX 需求

- **UX-001**：composer 应当提供 agent 选择器，展示所有可用 adapter，并标出当前默认。
- **UX-002**：Agents 列表应当展示每个 adapter 的鉴权方式（OAuth 已登录 / API key 已配置）和可用状态。
- **UX-003**：Thread 中应当能区分 workflow-bound Run 和咨询性 Run 的展示（避免用户误解咨询性 Run 会影响 Issue 状态）。
- **UX-004**：不可用的 adapter 在选择器中应当被禁用并说明原因。

### 非功能需求

- **NFR-001**：本 feature 应本地优先运行，不依赖云账号，OAuth 登录态和 API key 均存储在本地。
- **NFR-002**：多 adapter 并存不改变 workspace 写锁语义——同一 workspace 同一时刻仍然只有一个 Run 在写。
- **NFR-003**：Claude Code、OpenCode 的危险操作处理能力边界需要如实展示，不得夸大保证。两者能力不对等：Claude Code 的 `stream-json` 协议有真实的 `control_request`/`control_response` 前置审批通道（参考 multica `claude.go` 已经写好但未接入生产分发逻辑的 `handleControlRequest`，因为默认传了 `--permission-mode bypassPermissions`），本 feature 应当接入这个通道实现真正的前置拦截；OpenCode 没有等价的消息级协议（clowder-ai `opencode-auto-approval.ts` 只是探测 CLI flag 兼容性，不是审批协议），只能完全依赖 F002 已定的凭据隔离作为主防线，不能对 OpenCode 承诺前置拦截能力。
- **NFR-004**：Windows 环境下 OAuth 登录流程和 API key 存储方式需要验证兼容性。

## 5. 关键实体 / 概念

- **Adapter Auth Type**：adapter 的鉴权方式，`oauth` 或 `api_key`，决定配置表单和校验逻辑。
- **手动路由（Manual Routing）**：用户在 Thread composer 中主动指定由哪个 adapter 处理当前指令，区别于 v0.2 Coordinator 的自动推荐。
- **Workflow-bound Run**：对应 Workflow Template 某个阶段角色（implementation / validator）的 Run，其结果驱动 Issue 状态机。
- **Ad-hoc Consult Run**：用户临时发起、不对应任何 workflow 阶段角色的 Run，只留痕，不驱动状态机。
- **Handoff 自动上下文**：手动指定的 Run 在创建时自动携带上一轮 Handoff Packet 和 evidence refs，是本 feature 解决"传话筒"问题的核心机制。

## 6. 状态、工作流或生命周期

本 feature 不新增 Issue 状态，但明确 Run 的两条分支如何影响既有状态机：

```text
Workflow-bound Run（implementation / validator）
  完全遵循 F004 已定义的状态机：
  Running -> Validating -> Done / Running / Blocked

Ad-hoc Consult Run
  Issue 状态不变
  仅产生独立的 Run 记录和 ThreadEvent
```

规则：

- 一个 Run 在创建时必须明确是 workflow-bound 还是 ad-hoc consult，不允许中途改变性质。
- Workflow-bound 的手动 validator Run，其 pass/fail/blocked 判定逻辑完全复用 F004，不新建判定规则。
- Ad-hoc consult Run 不计入 `validation_round_count`，不受 `max_validation_rounds` 约束。
- 同一 workspace 的 Run（无论 workflow-bound 还是 ad-hoc consult）仍然按 F002 的写锁排队，不允许并发写。

## 7. 成功标准

- **SC-001**：用户可以在同一个 Issue 的 Thread 里，依次手动 @ Codex、Claude Code、OpenCode 中的任意一个处理某一轮指令。
- **SC-002**：被手动指定的 adapter 能自动读取上一轮的 Handoff Packet 和证据，用户不需要手动复制。
- **SC-003**：手动指定的 validator Run 能像自动路径一样驱动 Issue 到 `Done` 或 `Blocked`。
- **SC-004**：Claude Code、OpenCode 都能完成鉴权配置并显示可用状态，OpenCode 额外支持 API key 配置。
- **SC-005**：危险操作的 escalation 和凭据隔离对三个 adapter 都同样生效。

## 8. 验收清单

- [ ] **AC-001**（`FR-001`, `FR-002`）：Claude Code 通过 OAuth、OpenCode 通过 OAuth 或 API key 均可完成配置并显示可用状态。
- [ ] **AC-002**（`FR-003`, `FR-004`）：用户可以在 composer 中手动选择 Codex / Claude Code / OpenCode 中的一个处理当前指令，未选择时使用明确的默认值。
- [ ] **AC-003**（`FR-005`）：手动指定的 Run 自动携带上一轮 Handoff Packet 和 evidence refs 作为 context；没有上一轮时不报错。
- [ ] **AC-004**（`FR-006`）：手动指定的 validator Run 的 pass/fail 输出正确驱动 Issue 到 `Done` 或回到 `Running`，Evidence Summary 正确记录 `validator_identity` 和 `same_origin_validation`。
- [ ] **AC-005**（`FR-007`）：@ 命中当前期望角色时判定为 workflow-bound，未命中时判定为咨询性且不改变 Issue 状态；两种情况在 Thread 中都留下完整记录。
- [ ] **AC-006**（`FR-008`）：Claude Code、OpenCode 触发危险 git 操作时，行为与 Codex 一致，同样被凭据隔离挡住并触发 escalation。
- [ ] **AC-007**（`FR-009`, `DR-005`）：同一 Issue 同一时刻只能有一条 pending validator Run；无论是手动介入还是系统自动触发先到，后到的一方都会被数据库唯一约束拒绝，不产生重复 Run。

## 9. 测试计划

### 单元测试

- Adapter auth_type 校验（oauth / api_key 两种路径）。
- Adapter registry 按 provider 查找。
- Run purpose 判定（workflow-bound vs ad-hoc consult）。
- 手动 validator 输出解析复用 F004 parser 的兼容性。

### 集成测试

- 配置 Claude Code（OAuth）和 OpenCode（API key）两种 adapter，验证均可用。
- 手动指定 adapter 创建 Run，验证 context 正确携带上一轮 Handoff。
- 手动 validator Run pass/fail 分别驱动 Issue 到 Done / Running。
- 咨询性 Run 不影响 Issue 状态。
- 非 Codex adapter 触发 escalation 的路径。

### UI / 端到端测试

- composer 选择器展示、禁用不可用 adapter。
- Thread 中区分 workflow-bound 和咨询性 Run 的展示。
- Agents 列表展示鉴权方式和可用状态。

### 手动验证

- Windows 环境下 Claude Code / OpenCode 的 OAuth 登录流程。
- OpenCode API key 配置的存储和读取。
- 真实 Claude Code / OpenCode CLI 的 escalation 能力边界（是否有前置 approval 钩子）。

## 10. 依赖

### 上游依赖

- F002 Agent Command Center 已完成 Adapter Registry、Run lifecycle、workspace 锁、凭据隔离机制。
- F003 Development Trace 已完成 Handoff Packet、evidence refs。
- F004 Autonomous Validation 已完成 validation 状态机、Evidence Summary。
- `docs/decisions/0002-first-agent-adapter.md`：registry 预留多 adapter 扩展点的既有判断。

### 下游依赖

- v0.2 Coordinator Workflow 会在本 feature 提供的多 adapter 基础上，把"手动指定"升级为"自动推荐"。
- v0.3 Room 会需要本 feature 已经具备的"多个不同 provider 可用"作为前提。

### 外部 / 环境依赖

- 本地 Claude Code CLI、OpenCode CLI 可执行文件或命令。
- Claude Code / OpenCode 各自的 OAuth 登录机制。
- OpenCode 对应模型 provider 的 API key。

## 11. 风险与缓解

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| Claude Code / OpenCode 的会话模型、escalation 能力未实测 | Adapter 实现可能返工 | 参考已有源码调研证据：multica 对 Claude 的实现是 `claude -p --output-format stream-json`，stdin 传 prompt，`--resume <id>` 续接会话，cancellation 走 context cancel + ~10s WaitDelay；Claude 有真实的 `control_request` 前置审批通道（multica 已写好处理函数但未接入分发逻辑）；OpenCode 无此通道，只能走 `--dangerously-skip-permissions` 之类的 flag 网关。这些是二手证据，实现前仍需用本地实际安装的 CLI 版本做能力 probe，参考 F002 对 Codex 的 probe 方式。 |
| OpenCode 的 API key 明文存储 | 本地文件/DB 被其他进程或备份泄露读取的风险 | 已按 `DR-001` 决定沿用 multica/clowder 的做法（明文 + 打码展示 + 文件权限保护），不做额外加密；如果后续认为风险不可接受，作为独立安全加固任务处理，不影响本 feature 交付 |
| 手动 validator 和自动 validator 的边界不清楚，可能两套逻辑打架 | 状态机出现不一致或产生重复 Run | `FR-006` 复用 F004 现有解析规则；`FR-009` + `DR-005` 用数据库级 partial unique 约束保证同一 Issue 同一时刻只有一条 pending validator Run，参考 multica `agent_task_queue` 的唯一约束模式 |
| 咨询性 Run 和 workflow-bound Run 的判定规则不清楚，可能误判 | 用户咨询性请求被误当成 validator，或反之 | `FR-007` 采用"@ 是否命中当前期望角色"作为判定信号（参考 clowder-ai Message/Invocation 解耦模式），不要求用户每次显式声明；边界场景（例如 @ 了一个同时具备多种能力的 adapter）留到 design 阶段细化 |

## 12. 待确认问题

目前没有遗留的开放问题，以下四项均已关闭：

- **Q1（已关闭）**：Claude Code 有真实的 `control_request` 前置审批通道（参考 multica `claude.go`），本 feature 应接入；OpenCode 无此通道，完全依赖 `NFR-003` 已定的凭据隔离主防线。二手证据，实现前仍需本地 probe 确认。
- **Q2（已关闭）**：OpenCode API key 明文存储，不加密，见 `DR-001`。
- **Q3（已关闭）**：workflow-bound / 咨询性判定用"@ 是否命中当前期望角色"，见 `FR-007`。
- **Q4（已关闭）**：手动/自动 validator 互斥用数据库唯一约束，见 `FR-009`、`DR-005`。

## 13. 可追踪性

| 规格项 | 来源 | 验证方式 |
| --- | --- | --- |
| `FR-001`, `FR-002` | PRD v0.1.4、第 8 节 P0 功能列表 | `AC-001`，adapter config tests |
| `FR-003`, `FR-004` | PRD v0.1.4 手动路由目标 | `AC-002`，registry / dispatch tests |
| `FR-005` | PRD"不再需要手动复制上下文" | `AC-003`，context assembly tests |
| `FR-006` | PRD 第 7.5 节 validator 独立性、F004 状态机 | `AC-004`，validation integration tests |
| `FR-007` | US5 咨询性场景、clowder-ai Message/Invocation 解耦模式 | `AC-005`，consult run tests |
| `FR-008` | F002 escalation / 凭据隔离机制 | `AC-006`，cross-adapter escalation tests |
| `FR-009`, `DR-005` | US4 场景 3、multica `agent_task_queue` 唯一约束模式 | `AC-007`，duplicate validator run race tests |

## 14. 实现备注

- 本 feature 的 `design.md` 暂不编写，按项目约定（`docs/SOP.md`"PRD 版本拆解为 Feature 的节奏"）等 F001-F004 实现完成、真正开始这个 feature 前再拆解。第 12 节的四个待确认问题已经关闭并有明确结论，design.md 阶段是把这些结论落到具体 schema/接口设计，不是重新讨论方向。
- Claude Code / OpenCode 的具体 adapter 实现应参考 F002 `CodexCliAdapter` 的落地经验（one-shot invocation、`WorkspaceContext` 凭据隔离、CAS 状态机等），不重新发明这些机制。
- Claude Code 的 `control_request` 前置审批接入方式，可以直接参考 multica `claude.go` 里已经写好但未接入的 `handleControlRequest` 函数形状，不需要从协议文档从零摸索。
- `FR-007`（@ 是否命中期望角色）和 `FR-009`（DB 唯一约束防重复）这两条机制在 design.md 阶段需要落到具体的 schema 和判定代码，但方向已经不需要再讨论。

## 15. 参考

- `docs/personahub-prd.md`
- `docs/personahub-architecture.md`
- `docs/personahub-system-design.md`
- `docs/features/0.1/F002-agent-command-center/spec.md`
- `docs/features/0.1/F003-development-trace/spec.md`
- `docs/features/0.1/F004-autonomous-validation/spec.md`
- `docs/features/README.md`
