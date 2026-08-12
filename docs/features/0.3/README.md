---
topics: [v0.3, artifact, room, squad, planning]
doc_kind: plan
created: 2026-08-09
updated: 2026-08-09
---

# v0.3 Artifact-Centered Collaboration 规划审查稿

> **暂停（2026-08-12）**：v0.2 首轮 dogfood 暴露了阻塞性用户旅程与操作可发现性缺口，
> 因此本版本停止需求评审和开发排期。F009-F012 保持 `draft`，不得推进到
> `ready-for-development`，原有 25-40 日时间线作废。恢复条件和当前执行顺序以
> <a href="../../reviews/product-experience-reset-plan.md">`docs/reviews/product-experience-reset-plan.md`</a>
> 为准：先批准用户旅程，再批准 HTML 原型，最后依据影响面分析重估 v0.3。
>
> Status: review-draft。本文确定版本目标、Feature 边界、顺序和验收口径；F009-F012 已分别建立 draft `spec.md` / `design.md` / `tasks.md`，评审通过后再把对应 Feature 推进到 `ready-for-development`。产品范围仍以 `docs/personahub-prd.md` 第 15 节为准。

## 1. 版本判断

v0.3 不应被实现成“再加一个聊天页面”。它要验证的产品判断是：复杂 coding Issue 的关键上下文能否从聊天历史中独立出来，成为有类型、有来源、可引用、可验证的阶段成果；Room 只是让用户观察和控制这些协作过程的现场。

建议把版本拆为四个 Feature，按以下顺序交付：

| ID                                                  | Feature                          | 单一 intent                                            | 最小可独立验证结果                                                          | 依赖                   |
| --------------------------------------------------- | -------------------------------- | ------------------------------------------------------ | --------------------------------------------------------------------------- | ---------------------- |
| [F009](F009-artifact-foundation-provenance/spec.md) | Artifact Foundation & Provenance | 建立可追溯、可引用的结构化成果模型                     | 用户能创建/查看 artifact，并从 artifact 追到 Issue、Thread、Run 和 evidence | F003、F004             |
| [F010](F010-artifact-centered-coding-slice/spec.md) | Artifact-Centered Coding Slice   | 让一个复杂 coding workflow 真正以 artifacts 交接和验证 | 一次真实 Issue 产出四类阶段 artifact，下游只靠 refs 可继续工作              | F006、F009             |
| [F011](F011-work-room-human-intervention/spec.md)   | Work Room & Human Intervention   | 给多节点协作增加用户可见、可控制的临时现场             | 用户能进入 Room，查看分工，暂停/纠偏/调整后续执行并归档                     | F006、F007、F008、F009、F010 |
| [F012](F012-reusable-agent-squads/spec.md)          | Reusable Agent Squads            | 保存并复用静态 agent 分组                              | 用户能创建 Squad，并在 Room/推荐确认时选用；执行前重新校验成员              | F007、F011             |

F009 + F010 构成版本的最小价值闭环；F011 + F012 完成 PRD 对 v0.3 的完整承诺。不要并行设计 F011/F012 的持久化契约：Room 的成员变更语义应先稳定，再抽取可复用 Squad。

## 2. Feature 范围

### F009：Artifact Foundation & Provenance

**目标**：建立 Artifact 的领域模型、存储边界、typed ref 和基础 UI，让 artifact 成为可被后续 workflow 消费的稳定契约。

范围内：

- Artifact 归属 Issue，并可追溯到来源 Thread、Room、Run、创建者和时间。
- 首批类型：`research_findings`、`synthesis_plan`、`implementation_log`、`verification_results`；类型允许后续扩展，但未知类型不能静默进入执行上下文。
- 支持 `inline_markdown` 与 workspace 内受控 `local_file_path`；`db_record` 是否首批开放由 design 阶段核实真实消费者后决定。
- 新增 `artifact:<artifact_id>` typed ref，并扩展统一 resolver；现有 `event:` / `file-change-set:` refs 保持兼容。
- artifact 与 evidence refs 双向可追溯；内容修改采用新 revision，不覆盖已被 Run/Handoff 引用的历史版本。
- Inspector 提供列表、详情、来源、引用状态以及 loading / empty / missing / invalid 状态。

不做：外部 URL 存储、富文本/多人编辑、全文搜索、自动 memory/skill 沉淀、跨 Project artifact 共享。

**独立完成判据**：创建一个 artifact 后，API 与 UI 能从它定位来源 Run 和 evidence；删除或修改源文件不会伪造旧 revision，引用解析会明确返回 missing/invalid。

### F010：Artifact-Centered Coding Slice

**目标**：把 F006 的三节点图与既有 validation/handoff 串成首个 artifact-first 垂直切片，而不是只提供 artifact CRUD。

范围内：

- 复杂 coding Issue 至少产出 `research_findings`、`synthesis_plan`、`implementation_log`、`verification_results`。
- 节点输出先通过类型/大小/归属校验，再登记为 artifact；进程成功但 artifact 不合格时，节点不得被视为逻辑成功。
- `HandoffPacket` 引用 artifact refs 与 evidence refs；下游上下文从 resolver 装配，不依赖复制完整聊天历史。
- synthesis/implementation/validator 明确记录实际消费的 artifact revision；missing、越权、类型不匹配、过大均走可观察的 blocked/failed 路径。
- Thread 和 Inspector 展示“产出 → 被谁消费 → 验证结果”的链路。

不做：任意自然语言 workflow 编译、Canvas、物理并行写 workspace、非 coding workflow。

**独立完成判据**：真实 CLI 跑完一个复杂 coding Issue；隐藏早期聊天文本后，下游仍能仅凭 handoff + artifact/evidence refs 完成 synthesis 和 validation，并能回放完整消费链。

### F011：Work Room & Human Intervention

**目标**：把 Room 做成现有 Graph/NodeRun/Run/Thread 之上的协作与控制边界，不新增第二套执行状态机。

范围内：

- Human Lead 可手动创建 Room；Coordinator 在用户确认 `orchestrator_subagent` 方案后可按确定性规则创建 Room。
- Room 拥有独立 Thread、目标、阶段、topology、成员快照、输入/输出契约、evidence 要求、终止条件和状态。
- 用户可查看创建理由、节点/成员分工、Run 状态、artifacts、evidence 和关键决策。
- 用户可暂停后续派工、补充约束、取消正在运行的 Run、调整尚未开始的节点执行者，并显式恢复。
- 所有人工介入和 override 写入结构化事件；Room 结束后只归档，不物理删除。

不做：agents 自由闲聊、独立于 Graph/Run 的 Room 调度器、运行中进程热换 agent、多人权限、语音/视频、跨 Issue Room。

**独立完成判据**：在一个 active Room 中暂停未开始节点、纠偏并更换其执行者、恢复到完成；事件回放能解释原计划、人工改动、最终执行者和产物。

### F012：Reusable Agent Squads

**目标**：把反复使用的 adapter 组合保存为静态分组，同时保持运行时资格校验，避免把 Squad 误当成永远可执行的部署单元。

范围内：

- Project 内创建、重命名、归档 Squad；成员引用 adapter config，可附显示名称和用途说明。
- Room 创建/调整成员和 Coordinator 确认界面可选择 Squad，也可在本次请求中覆盖成员。
- 使用 Squad 时保存成员快照；adapter 后续改名、失效或删除不篡改历史 Room。
- 执行前仍按 workspace availability 与 capability tags 逐节点校验；失效成员给出候选和阻塞原因，不静默替换。

不做：组织/权限、跨 Project Squad、自动学习最佳 Squad、Agent Team Template 与 Workflow Template 的强绑定。

**独立完成判据**：保存一个 Squad，用它创建 Room；使其中一个 adapter 失效后，历史 Room 仍可解释，新 Room 明确阻塞或要求用户替换。

## 3. 跨 Feature 不变量

1. **单一执行真相源**：Room/Squad 不拥有独立 Run 生命周期；执行、取消、恢复继续由 Graph/NodeRun/Run 和 workspace FIFO 负责。
2. **引用不可漂移**：任何被消费的 artifact 必须指向确定 revision；更新 title/content 不得改变历史 handoff 或 validation 的输入。
3. **事务后副作用**：创建 Room、图、artifact manifest 的数据库事务提交前，不得启动子进程或广播不可回滚事件。
4. **运行时重新校验**：Room/Squad 记录的是用户选择与历史快照，不替代 workspace-scoped availability、capability 和 adapter 删除守卫。
5. **原始 AgentOps 信号**：人工介入/override、duration、retry、validation round、blocked reason、错误终态纠正和 artifact 消费链必须有结构化事件；v0.3 不做聚合评分 UI。

## 4. 版本验收旅程

使用 PersonaHub 自身仓库完成一次真实复杂 coding Issue：

1. Coordinator 推荐 `orchestrator_subagent`，用户确认 roster 或选择一个 Squad，系统创建 Issue、Room 和图。
2. 两个研究节点各自产出可追溯的 `research_findings`；synthesis 只通过 artifact refs 消费它们并产出 `synthesis_plan`。
3. 用户在 Graph Room 暂停尚未启动的 synthesis/其他 GraphNode Attempt，补充约束并更换该节点执行者，再恢复执行；running 节点与普通 Run 不受本次 pause 影响。
4. Graph 完成后 Room 自动归档；随后 primary Thread 中的 implementation 与每轮 validation 分别产出 `implementation_log`、独立的 `verification_results`，handoff 与最终 Evidence Summary 可回溯全部确定 artifact revisions。
5. 重启应用后，已归档 Room 的状态、成员快照、人工介入以及后续 primary Thread 的 artifact 消费链和最终结论都能完整回放。

版本只有在这条旅程通过真实 CLI 验收、自动化测试、typecheck、lint、format check 和生产构建后才算完成。

## 5. 建议里程碑

| 里程碑               | 包含                                  | 退出条件                                         | 粗估          |
| -------------------- | ------------------------------------- | ------------------------------------------------ | ------------- |
| M1：契约冻结         | F009 spec/design/tasks + artifact ADR | revision、storage、typed ref、路径安全问题关闭   | 2–3 个工作日  |
| M2：Artifact 闭环    | F009                                  | CRUD、resolver、provenance UI、恢复/边界测试通过 | 5–8 个工作日  |
| M3：Coding 垂直切片  | F010                                  | 四类 artifact 的真实 CLI 旅程通过                | 6–10 个工作日 |
| M4：可控 Room        | F011                                  | 暂停/纠偏/换人/恢复/归档旅程通过                 | 8–12 个工作日 |
| M5：Squad 与版本收口 | F012 + 全版本回归                     | Squad 复用、失效校验、全版本验收通过             | 4–7 个工作日  |

总粗估 25–40 个单人工作日。该估算用于判断范围大小，不承诺发布日期；F011 的取消/恢复一致性是最大不确定项。

## 6. 评审需确认的 5 个已采用决策

以下推荐结论已经写入四个 Feature 的 draft spec/design/tasks；评审若改变任一结论，需要同步修改受影响的下游 Feature 后才能进入开发。

| ID  | 问题                                   | 推荐结论                                                     | 不同结论的影响                                      |
| --- | -------------------------------------- | ------------------------------------------------------------ | --------------------------------------------------- |
| Q1  | v0.3 是否以 F009+F010 为最小发布切片？ | 是；先验证 artifact 是否真能减少上下文损耗                   | 若四项绑定发布，Room 风险会推迟 artifact 价值验证   |
| Q2  | artifact 是否允许原地覆盖？            | 不允许；采用实体 + immutable revision                        | 允许覆盖会破坏历史 handoff/validation 的可复现性    |
| Q3  | local file 的允许范围？                | 仅 workspace 内的受控 artifact directory，保存规范化相对路径 | 允许任意绝对路径会扩大泄露、搬迁和 Windows 路径风险 |
| Q4  | Room 的控制粒度？                      | v0.3 只调整未开始节点；运行中调整先 cancel 再重建 Attempt    | 热换 agent 需要新的进程协议和状态机，不适合本版本   |
| Q5  | Squad 是否绑定 capability role？       | 仅保存成员与说明，能力以 adapter tags 在使用时判断           | 固化 role 会重新引入 F005 已废弃的单 role 真相源    |

## 7. 明确延后

- v0.4：非 coding workflow、Provenance Gate 初版、skill candidate、Board/Multi-workspace 等按 PRD 排期处理。
- v0.5：AgentOps 聚合、评价 UI、比较分析与 trust scoring；v0.3 只保证原始信号完整。
- v0.6：从 Done Issue 提取/审核/加载 reusable skill；artifact 在 v0.3 只是可追溯输入，不自动成为 memory 或 skill。
- 未出现真实需求前不做 external URL storage、Graph Canvas、Room 间通信、跨 Project Squad。
