---
topics: [concept-mapping, reference, ui-assembly, multica, clowder-ai]
doc_kind: review
created: 2026-08-13
updated: 2026-08-13
---

# 概念映射表：multica / clowder-ai ↔ PersonaHub

> **产出于** <a href="product-experience-reset-plan.md">`product-experience-reset-plan.md`</a>
> M4-T01（页面拼装的前置条件）。
>
> **判定口径**：一一对应 = 语义基本相同，区块可直接借用；近似需调整 = 形态可借用但语义
> 必须改写；无对应 = 两个参考项目都没有，进空白区清单。
>
> **第 2 版（2026-08-13）**：按用户反馈深挖 clowder-ai 源码后修正。**原判"四项无对应"
> 是错的——其中三项 clowder 都有实现，只是不叫这个名字**（见 §4）。

## 1. 两个参考项目的定位差异

| 项目 | 定位 | 强项（值得借） | 弱项（不要借） |
|---|---|---|---|
| multica | 团队协作工具，「智能体，也在看板上」 | 工程化任务管理骨架、执行可观测性、克制视觉 | 团队/计费/多人协作包袱 |
| clowder-ai | agent 团队平台层，把孤立 agent 变成真正团队 | agent 长期成员组织方式、evidence/memory 体系、审批闭环 | 情感化 IP 玩法、**缺产品思维导致的界面冗余** |

**PersonaHub 的取法（用户 2026-08-13 定）**：

> **流程走 multica 式，内核走 clowder 式。**

multica 给出的是"一个工程化产品该怎么组织工作流"，clowder 给出的是"agent 团队真正需要
哪些底层概念"。前者的形态 + 后者的内核，就是 PersonaHub 想要的结合体。

## 2. 主映射表

| PersonaHub 概念 | multica | clowder-ai | 判定 | 拼装含义 |
|---|---|---|---|---|
| **Project** | 项目（归类工作，挂仓库文档） | chat 侧栏「项目」分组 | 近似需调整 | 流程借 multica，归属心智借 clowder（见 §3） |
| **Workspace** | 「工作区」= 组织级团队空间 | 项目空间（新建对话须选项目） | **内核取 clowder**（见 §3） | multica 的工作区切换器**不要**；clowder 的"对话归属项目"才是对的心智 |
| **Issue** | Issues / 任务（派给智能体、有状态、进审核） | 无（对话驱动） | 近似需调整 | 列表与详情骨架借 multica；团队字段按旅程重判 |
| **Thread** | issue 详情页「动态」feed | chat thread（有 Thread Memory、Session Chain） | 近似需调整 | 形态借 multica，**语义借 clowder**——clowder 的 thread 带滚动记忆与决策提取，比评论区更接近 PRD 定义 |
| **Room** | 无 | **Mission Hub**（部分，见 §4） | **仍是空白区** | 唯一真正无对应的核心概念 |
| **Coordinator Agent** | 小队 leader | 多 Agent 编排 + 传球决策树 | 近似需调整 | clowder 的**能力路由**思路值得借（见 §7） |
| **Agent** | 智能体（起名、选提供方、配运行时） | Agent（持久身份、跨 session 记忆） | 一一对应 | 三页可借；但**字段结构按 §7 调整** |
| **Squad** | 小队（人机混编） | 无显式概念 | 近似需调整 | multica 小队页是 F012 参考；**删人类成员** |
| **Skill** | Skills（沉淀复用） | Skills 框架（按需加载 + capability wakeup 索引） | 一一对应 | 两边都可借 |
| **Memory** | 无 | 记忆页：知识动态/索引状态/健康度/图书馆/知识图谱 | 一一对应 | clowder 是唯一参考源 |
| **Artifact** | 无 | **Evidence 体系**（见 §4.1） | **有对应，改判** | 11 种 kind + 10 种 status，直接可借 |
| **Provenance Gate** | 无 | **审批中心 + Marker 生命周期**（见 §4.2） | **有对应，改判** | 含完整状态机与 UI |
| **Handoff Packet** | 无 | **ball-custody 球权托管**（见 §4.3） | **有对应，改判** | 有独立 domain |
| **Validation Policy** | 「人来验收」= 人工 gate | 跨模型互审 + quality-gate / merge-gate skill | 近似需调整 | 两者都不是自动 loop（PRD §13 要求 validation 不得退化为人工 gate） |
| **Issue Type / Workflow Template** | 无 | `cat_cafe_update_workflow` 阶段告示牌 + SOP stage | 弱对应 | 只有"阶段进度可见"这一层可借 |
| **Trace Events** | 执行日志（工具调用/命令/报错带时间戳，可回放） | 审计事件 / Session / Runtime | 一一对应 | multica 借形态，clowder 借分层 |
| **Adapter / Runtime** | 运行时（daemon） | Agent CLI adapter 表 | 一一对应 | multica 运行时页可直接借 |

## 3. Workspace 重判：内核是 clowder 的项目空间

**原判为"术语冲突不可借用"，现修正。** 三方对照：

| | multica「工作区」 | clowder「项目」 | PersonaHub Workspace |
|---|---|---|---|
| 是什么 | 组织级团队空间 | 对话/工作的归属空间，chat 侧栏一级分组 | 真实文件与执行环境的本地路径 |
| 用户动作 | 顶部切换"我在哪个团队" | **新建对话时选项目** | 选定 agent 在哪读写文件 |
| 数量关系 | 一账号 N 个团队 | 一用户 N 个项目 | v0.1 一 Project 绑一 Workspace |

**结论**：

- **心智内核取 clowder** ——「开始一件新工作前先确定它属于哪个项目空间」，这与 PersonaHub
  「Issue 必须绑定 Workspace 才能执行」是同一件事。
- **流程形态取 multica** ——先建 Project、再在其中派活的工程化流程，比 clowder 的
  对话优先更适合 Issue 驱动的产品。
- **仍然不要的**：multica 顶部的组织级工作区切换器。PersonaHub 没有"团队"这一层，
  把它借进来会凭空造出一个用户不需要的维度。

## 4. 原判"无对应"四项的深挖结果

用户判断正确：**clowder 里有对应实现，只是不叫这个名字**。逐项列证据。

### 4.1 Artifact ≈ clowder Evidence 体系 ✅ 有对应

`packages/api/src/domains/memory/interfaces.ts`：

```ts
EVIDENCE_KINDS = ['feature','decision','plan','session','lesson','thread',
                  'discussion','research','architecture','diary','pack-knowledge']

EvidenceStatus = 'active'|'done'|'archived'|'review'|'invalidated'
               |'superseded'|'drifted'|'stale'|'historical'|'retired'
```

**可直接借鉴的三点**：

1. **按 kind 分类而非按格式分类**——PersonaHub 的 v0.3 artifact 类型（research_findings /
   synthesis_plan / implementation_log / verification_results）与之同构。
2. **status 区分"失效原因"**——`invalidated`（被证伪）/ `superseded`（被取代）/ `drifted`
   （与真实状态漂移）/ `stale`（过期）四种失效语义分开，这比单一 `archived` 表达力强得多，
   直接解决"证据还在但已经不可信"的问题。
3. **evidence 有独立 store 与检索维度**，不是挂在消息上的附件。

### 4.2 Provenance Gate ≈ 审批中心 + Marker 生命周期 ✅ 有对应

```ts
MARKER_STATUSES = ['captured','normalized','approved','rejected',
                   'needs_review','materialized','indexed']
```

配套还有 `packages/api/src/domains/approval-hub/` 独立 domain，以及 memory 页上的
**「待确认 / 已确认 / 高频 / 升级」** tab 与「没有待确认的知识」空状态。

**这就是 Provenance Gate 的完整形态**：证据从捕获到进入长期记忆，中间有 normalize、
人工审核（approved/rejected/needs_review）、物化、索引五道关。PersonaHub 的
Provenance Gate 不必从零设计，UI 与状态机都有现成参考。

### 4.3 Handoff Packet ≈ ball-custody 球权托管 ✅ 有对应

`packages/api/src/domains/ball-custody/` 是独立 domain，含
`ActionSuccessorAdmissionContract`（后继者准入契约）、`LocalReviewEvidenceProvider`。
配合 `assets/prompt-templates/handoff-decision-tree.md` 的传球决策树：

> 每条 A2A 串行回合必选其一，缺 = 消息不完整。1) 另一只猫能做 → `@句柄`；
> 2) 等外部条件 → `hold_ball` 并**必须声明等什么**，不声明 = 400 拒绝；3) 只有人能做 → 升级。

**最值得借的是"球权不能掉地上"这条硬约束**——每次交接必须明确下一棒是谁或在等什么，
不允许模糊结束。这正好对应 PersonaHub 的"用户不知道现在该谁动、要等多久"问题。

### 4.4 Room ≈ Mission Hub（部分）⚠️ 仍是空白区

`Mission Hub` 是 **Feature 进度看板**——从 feature docs 自动提取 Phase 进度、AC 完成度、
依赖关系和风险（`cat-cafe-skills/refs/feature-doc-template.md`）。它是"多个工作项的进度
汇总现场"，**不是"一群 agent 就某个阶段临时协作的现场"**。

clowder 的协作发生在 thread 里（含平行世界、cross-thread 投递），但 thread 没有 Room 的
成员/拓扑/输入输出契约/终止条件这套结构。

**结论：Room 是四项里唯一真正的空白区**，也是竞争力 `graph-orchestrated` 的落点。

### 4.5 Issue Type / Workflow Template ⚠️ 弱对应

只有 `cat_cafe_update_workflow`（阶段进度告示牌，"给下棒可见"）和 SOP stage 模板。
没有"按 Issue 类型选择流程模板"这一层。可借的只有**阶段进度对下游可见**这个交互点。

## 5. 右栏 Context Inspector：重点参考 clowder，但必须做减法

clowder chat 页右栏实测区块：

```text
状态栏      当前模式 / 猫猫状态 / 消息统计（总数·猫猫消息·系统消息·Evidence·Follow-up）
            / Session Chain（active · total）
对话信息    Thread / Thinking / CLI 气泡 / 心里话 / 悄悄话 / 揭秘全部
审计&Session 审计事件 / Session / Runtime / 搜索
运行日志    查看日志
```

对照 PRD §6 要求的 Context Inspector：

| PRD §6 要求 | clowder 对应 | 判定 |
|---|---|---|
| Issue info | 对话信息 | ✅ 借 |
| Agent status | 猫猫状态 / 当前模式 | ✅ 借 |
| Message stats | 消息统计 | ✅ 借 |
| Evidence | 消息统计中的 Evidence 计数 | ✅ 借，且要更重（PersonaHub 的竞争力） |
| Run logs | 运行日志 | ✅ 借 |
| Audit / trace events | 审计事件 / Session / Runtime | ✅ 借，分层方式很好 |
| Blockers | 无 | ❌ 需原创 |

**几乎逐项对应**——PRD 的 Inspector 设计与 clowder 的右栏高度一致，这是最强的可借鉴项。

**但必须做减法（用户 2026-08-13 判断：参考项目缺产品思维导致过于冗余）**：

| 删掉 | 原因 |
|---|---|
| 心里话 / 悄悄话 / 揭秘全部 | IP 玩法，与工作无关 |
| 切换游戏 / 猫猫训练营 / 首选猫 | 同上 |
| Thinking 折叠、CLI 气泡开关 | 调试开关不该占据一级位置，收进设置或开发者模式 |
| 状态面板与状态栏重复 | 同一信息两处呈现，合并 |

**减法原则**：右栏每个区块必须回答 PRD §6 明列的某一项；回答不了的一律删。
**PRD §13「UI 过重」是硬约束**——右侧 Inspector 分 tab，不允许无限堆叠面板。

## 6. "不该要"的内容：结合 PRD 判断未来归属

| 概念 | 出处 | PRD 依据 | 归属判断 |
|---|---|---|---|
| 用量 / 计费 | multica | §4.2 非目标、§2 本地优先 | **不进路线**。除非未来做 cloud/多人，否则本地单机无计费对象 |
| Autopilot（cron 自动化） | multica | §15 v0.4「Scheduled Issue / Recurring Issue 仅在至少一个非 coding 垂直切片稳定后按需引入」 | **v0.4 之后按需**，PRD 已有明确归属 |
| 人类队友 / member | multica | §13「过度平台化」风险、§2.2 个人 OS 愿景 | **不进路线**。开源采用路径（§3.3）若走向小团队再重估 |
| Board View | multica | §6「Board view 是 P2」 | **P2**，PRD 已定 |
| 落地页 / 登录页 | 两者 | §6「直接进工作台，不做 landing page」 | **不做** |
| 收件箱 Inbox | multica | 无直接对应；但 v0.2 有 escalation 概念 | **v0.4+ 候选**。当 escalation 与多 Issue 并行增多时，需要一个"只在要我拍板时提醒"的统一入口。记入后移清单 |
| 情感化 IP / persona 配色 | clowder | §5 Agent「不做强拟人包装」 | **不做**，PRD 已明确 |
| 信号 / 主题页 | clowder | 无对应 | 不做 |

## 7. 借鉴：用能力项描述 Agent，而不是强分配角色

**来源**：clowder-ai 创始人讲座观点（用户 2026-08-13 转述并认可）——
不建议给每个 Agent 强分配角色，因为 agent 背后其实是 CLI 工具和模型；应从**能力项**入手
描述，让主 Agent 根据能力描述自主分配任务。

### 7.1 clowder 的实际做法（代码证据）

`packages/api/src/domains/cats/services/stores/ports/ThreadStore.ts`：

```ts
export type ThreadRoutingScope = 'review' | 'architecture';

export interface ThreadRoutingRule {
  preferCats?: CatId[];   // 优先给谁
  avoidCats?: CatId[];    // 避免给谁（除非显式 @）
  reason?: string;        // 人类可读理由，如 "budget"
  expiresAt?: number;     // 可过期
}
```

三个关键设计：

1. **路由作用域只有两个**（review / architecture），不是十个角色枚举。
2. **规则挂在 thread 上，不挂在 agent 上**——同一个 agent 在不同 thread 里可以承担不同工作。
3. **规则可带理由、可过期**——是"这段时间这类事优先给它"，不是"它就是 reviewer"。

agent 之间的实际差异来自背后的 CLI 与模型（Claude / GPT / Gemini / opencode），
而不是被赋予的角色名。

### 7.2 PersonaHub 现状与调整方向

PRD §5 Agent 当前**同时**有两套：

```
- role: coordinator / architect / coder / reviewer / verifier /
        researcher / reader / writer / curator / custom
- capability_tags
```

**调整方向（已决定，待 PRD 修订落地）**：

- **以 `capability_tags` 为路由主依据**，Coordinator 按能力描述匹配任务，不按 role 名匹配。
- **`role` 降级为可选的人类可读标签**，用于列表展示与用户理解，不参与调度决策。
- **路由偏好可挂在 Issue / Room 层级**（对应 clowder 的 thread 级），支持
  prefer / avoid + 理由 + 过期，而不是把偏好烧死在 agent 定义里。

### 7.3 影响面（本轮只登记，不修改）

| 受影响对象 | 影响 |
|---|---|
| `docs/personahub-prd.md` §5 Agent | 字段定义与 role/capability 的主次关系 |
| F007 推荐路由 `resolveEligibleAdapter()` | 匹配依据从 role 改为 capability |
| Agent 新建 / 详情页 | 表单以能力项为主，role 退居次要；影响 R014 页面选型 |
| F012 Squad | 成员按能力组合，而非按角色配齐一套班子 |
| PRD §15 v0.4「新场景优先通过 Workflow Template / Validation Policy / **Agent capability** 扩展」 | PRD 已有伏笔，本调整与之一致 |

**这是产品级修改，需走 PRD 修订流程**，已记入主计划第 7 节「需要重新评估的现有文档」。

## 8. 对拼装的直接结论（第 2 版）

1. **可直接借骨架**：三栏布局、Issue 列表、Agent 三页、Skills、运行时、设置、执行日志
   （multica）；memory 页、审批中心、右栏 Inspector 分层（clowder）。
2. **借形态改语义**：Issue 详情（删团队字段）、Thread（加状态与证据绑定，参考 clowder 的
   Thread Memory）、Squad（删人类成员）、Workspace（取 clowder 归属心智，弃 multica 切换器）。
3. **真正需要原创的只剩 Room**——从原判四项缩减为一项。Artifact / Provenance Gate /
   Handoff Packet 都有 clowder 实现可参考。
4. **右栏是最大的借鉴收益点**，PRD §6 的 Inspector 与 clowder 右栏几乎逐项对应；
   但必须按 §5 做减法，且 Blockers 一项需原创。
5. **Agent 字段结构按 §7 调整**，这会直接改变 agent 新建/详情页的拼装方案。

**下一步**：M4-T02（旅程步骤定位到三栏）与 M4-T03（页面选型表），均需 M3-T04 旅程草稿。

## 9. 对话式协作现场与人工介入：clowder 的 DispatchProposal 机制

> **来源**：用户 2026-08-13 明确产品诉求——「现场是对话式的触发，如果有执行异常的情况
> 我可以及时制止，同时手动指派从而矫正错误流程」。对应 dogfood 记录 NOTE-003/004/005。

### 9.1 先确认：这不是新需求，是 PRD 已写但未实现的能力

`docs/personahub-prd.md` §5 Room 定义中的 **Human Lead 能力**原文：

> - 查看 Coordinator Agent 为什么创建该 Room，以及为什么选择这些 agents。
> - 旁听各 agents 的讨论、分工、执行进展和阶段结论。
> - **随时打断、纠正方向、补充约束或要求暂停。**
> - **手动拉入新 agent、移除不合适的 agent，或指定某个 agent 接手。**
> - 要求某个 agent 提供证据、重做、总结或进入 validation。

**用户诉求与 PRD 逐条对应。** 差距不在产品判断，在于 v0.1/v0.2 只实现了 F004 的自动流转，
Human Lead 这一层从未落地——这正是 NOTE-003/004/005 三条的共同根因。

### 9.2 clowder 的做法：派活不直接执行，先变成可否决的提案

`packages/shared/src/types/dispatch-proposal.ts` + `domains/approval-hub/`：

```ts
interface DispatchProposal {
  effectClass: 'assign_work';   // 只有"派活"这一类动作才生成提案
  content: string;              // 被扣住的消息，创建到投递之间不可变
  senderCatId: string;          // 谁要派
  targetCats: string[];         // 派给谁
  sourceThreadId / targetThreadId;
  ownerUserId: string;          // 只有这个人能批准/拒绝
  status: DispatchProposalStatus;
  decidedAt?: number; decidedBy?: string;   // 谁在什么时候决定的
  supersededBy?: string;        // 被更新的同类提案取代
  cardMessageId?: string;       // 提案卡片在发起方 thread 里的消息 ID
  actionLeaseRef?: DispatchActionLeaseRef;  // 批准时原子获取执行租约
}
```

五个设计要点，逐条都能直接搬到 PersonaHub：

| 要点 | 机制 | 解决什么 |
|---|---|---|
| **派活是提案，不是命令** | agent 想把工作交给另一个 agent 时创建 proposal，消息被扣住不投递 | NOTE-003：换人这一刻变成可见事件，而不是静默发生 |
| **提案以对话卡片出现在现场** | `cardMessageId` + `buildApprovalCardBlock.ts`，卡片就在 thread 里 | 用户诉求的「对话式触发」——不用去别处找审批页 |
| **只有一类动作需要批准** | `effectClass: 'assign_work'`，其余动作直接执行 | 避免审批疲劳，这是能长期用下去的关键 |
| **拒绝形成定向否决围栏** | invocation-scoped negative authorization fence | 拒绝一次不会全局禁用该 agent，只否决这一次派发 |
| **批准与执行租约原子绑定** | `actionLeaseRef`，approve 的同时拿到 lease | 防止重复执行与竞态 |

配套的还有 `hold_ball`——agent 要等外部条件时必须**声明在等什么**，不声明直接 400 拒绝
（`assets/prompt-templates/l3-routing-rules.md`）。这条保证了现场永远能回答"现在在等谁/等什么"。

### 9.3 对 PersonaHub 的借鉴结论

1. **在 F004 的自动流转前插入一层可否决的提案**——implementation 完成、要交给 validator
   之前，先在 Thread 里生成一张卡片：谁 → 谁、为什么、依据哪个 workflow、要做什么。
   用户可以放行、可以否决、可以改指派对象。**这一条同时解掉 NOTE-003/004/005。**
2. **默认放行还是默认阻塞，应可配置**。全部阻塞会拖慢正常闭环；建议默认放行 + 倒计时
   （"3 秒后自动交给 validator，点此接管"），异常时才需要用户动作。这是 clowder 没有、
   但 PersonaHub 单人场景更需要的调整。
3. **只对"跨 agent 派活"和 PRD §11 已定义的危险操作设 gate**，其余动作不打扰用户。
   照搬 `effectClass` 的分类思路。
4. **卡片必须带"改指派"入口**，不能只有批准/拒绝两个按钮——用户要的是矫正流程，
   不是单纯叫停。
5. **借鉴 `hold_ball` 的硬约束**：任何等待状态必须声明在等什么，界面才能始终回答
   "现在该谁动、要等多久"。

### 9.4 对 v0.3 计划的影响

主计划第 7 节原判 F011 Work Room「与观察、打断、纠偏高度相关，产品价值**可能**保留」。
基于本节证据，该判断可以更强：

> **F011 直接解决当前最痛的问题（NOTE-003/004/005），且有 clowder 的成熟机制可参考。**
> 它不该被理解为"v0.3 的新能力"，而是"v0.1 就承诺、至今未兑现的 Human Lead 能力"。

但**范围要收窄**：当前最需要的不是完整的多 agent Room 协作现场，而是**单 Issue 执行链路上
的介入能力**——看得见交接、能否决、能改指派。完整 Room 留给真正出现多 agent 并行时再做。

### 9.5 在 Room 里 @ agent 手动指派：对的方向，但有一个前提问题

**用户判断（2026-08-13）**：PersonaHub 已有 Room 设计，那么在 Room 内部 @ agent 手动指派
是最自然的交互。

这个判断成立，PRD §5 Room 的 Human Lead 能力里就有「手动拉入新 agent、移除不合适的 agent，
或**指定某个 agent 接手**」。clowder 的 `@句柄` 正是这套交互的成熟实现。

**但有一个必须先回答的前提问题：单 agent 执行时没有 Room，@ 指派在哪里发生？**

PRD 对两者的分工写得很清楚：

> Thread 记录事情怎么一路发生，Room 组织谁一起解决其中某一段问题。
> Room 是围绕某个 Issue **阶段临时创建**的结构化会话室。

也就是说 Room 不是常驻的——用户 dogfood 时遇到的那个场景（一个 agent 写脚本、自动交给下一个
执行）**根本没有 Room**，只有 Issue 的 primary Thread。如果 @ 指派只在 Room 里可用，那这个
最常见的场景依然无法介入。

**建议的分工（待 P1 旅程定稿确认）**：

| 场景 | 现场 | 介入方式 |
|---|---|---|
| 单 agent 顺序执行（最常见） | primary Thread | **Thread 里就能 @ 指派**，它是 Issue 级主控制线 |
| 多 agent 并行/协作某阶段 | Room | Room 内 @ 指派 + 成员增减 + 拓扑调整 |

即：**@ 指派是 Thread 和 Room 共有的能力，不是 Room 独有的**。Room 增加的是"多成员、有拓扑、
有终止条件"这些结构，不是"能不能 @"这件事本身。否则会出现「必须先开个 Room 才能纠正一个
单 agent 任务」的荒谬路径。

**从 clowder 借的两条机械规则**：

1. **`@句柄` 必须行首独立一行才生效**（行中、URL 内均不路由）。看似苛刻，实则是防歧义的
   硬规则——避免正文里提到 agent 名字被误判成指派。markdown 列表/引用前缀后的首字符
   （`- @cat` / `> @cat`）合法。
2. **每次交接必选其一，缺 = 消息不完整**：@ 下一棒 / 声明在等什么 / 升级给人。
   这条保证现场永远能回答"现在该谁动"，正是 NOTE-003 的解法。
