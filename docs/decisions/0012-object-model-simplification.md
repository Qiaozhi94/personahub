---
topics: [decision, domain-model, hierarchy, agent, thread, room, runtime, squad, naming]
doc_kind: decision
status: proposed
created: 2026-08-29
---

# 0012: 对象模型简化——收敛到当前真正需要的那一层

## 背景

v0.3 交互设计推进到「一个 Issue 对应什么」时，暴露出对象模型里有一批**为未来预留、但当前无人使用**的层级，以及一批**职责重叠**的对象。它们的直接后果是界面上说不清：设计评审中反复出现「这两个 tab 有什么区别」「primary Thread 我还是觉得奇怪」「Room 和协作现场是什么关系」这类问题——每一次追下去，根子都在模型而不在界面。

本决策把模型收敛到当前真正需要的最小集，并给每个保留下来的对象一个不重叠的职责。

四条判断依据，全部来自本轮讨论中被验证的事实：

1. **执行单位是 `adapter + 模型 + 深度`，不是「成员」。** 使用者的原话：「代码开发我可以给 gpt-5.6 也可以给 deepseek-v4-flash，但是架构设计我肯定不会给 deepseek-v4-flash」。PRD 第 5 节 `[2026-08-15 修订]` 早已裁定「`capability_tags` 是路由主依据，`role` 降级为展示标签……界面也按能力项呈现成员，**不写成「它是 reviewer」**」——但 v3.1 原型全程用 `@实现者` / `@独立验证员` / `@架构研究员`，直接违反。
2. **Space 在数据层根本不存在。** 核实：`projects` 表无 `space_id`（`server/src/db/schema-v1.ts:2`），全仓库 `space_id` / `spaceId` 零命中，303 处 `space` 全是 `workspace_id` 的子串。它只活在 PRD 与界面左上角。
3. **游离态 Issue 是成立的做法。** multica 的 `issue.project_id` 是 `UUID REFERENCES project(id) ON DELETE SET NULL`（`server/migrations/034_projects.up.sql:19`）——可空，且 project 删除后 issue 仍在。
4. **Workflow Template 已经包含完成标准。** `docs/personahub-user-journeys.md:145`：「Workflow Template | 工作方式 | 推荐确认时展示**建议路径与完成标准（验证要求、什么算 Done）**」。而 `issues` 表同时有 `workflow_template_id` 与 `validation_policy_id` 两个独立外键，是历史遗留的重复。

## 决策

### 1. 层级定稿

```text
全局
├─ Runtime（运行时）      本机资源：adapter 安装 / 登录状态 / 可用模型 / 额度
├─ 设置与诊断             本地数据 · 健康诊断
└─ Space（工作区）× N     部门 / 小组；共享与归属的最外层
   ├─ Skills                          各组自己的做法，承接原成员的 system_instructions
   ├─ Memory：user preference / workflow note
   ├─ 知识库                          人写的指导文档（≠ Memory，见第 6 条）
   ├─ Squad（编组）                   为后续智能指派服务，见第 5 条
   ├─ Project（项目）× N
   │  ├─ Workspace（代码目录）        权限边界 + 写锁 + git 状态
   │  ├─ 资源库                       文档与素材 / 产出 / 知识
   │  ├─ Workflow Template            含验证段，见第 4 条
   │  ├─ Memory：project fact / decision / lesson
   │  └─ Automation                   只创建 Issue，不形成第二套任务体系
   └─ Issue（任务）  labels 分类，project_id 可空 → 游离态
      ├─ Room（会话）× N              承载什么由用户决定；惰性创建
      │   └─ Thread                   一对一，不单独露出
      ├─ 派工记录                     执行组合 + 上下文范围 + Handoff Packet
      │   └─ Run / Attempt
      ├─ Graph / NodeRun              多节点协作时的执行图
      ├─ Artifact / Evidence
      └─ 主张 / 论证 / 证据           ADR 0010
```

**Issue 挂在 Space 下而不是 Project 下**，因为它可以游离。Project 是可选归类，不是必经容器。

**Runtime 与 Space 平级**，因为它是本机资源：换一个 Space 不该重新配置本机的 CLI；更硬的理由是**额度是账号级的**——在 A Space 用掉的配额，B Space 也少了，挂在 Space 下会算错。

### 2. 取消五个对象

| 对象 | 取消理由 |
| --- | --- |
| **Agent（AI 成员）** | 执行单位改为 `adapter + 模型 + 深度`（如 `codex-gpt5.6-high`）。adapter 本身是 harness，对同一模型的表现有实质影响，因此三元组缺一不可。历史表现挂在这个组合上——这同时解决了「同一成员换模型后历史表现怎么算」的问题 |
| **Project Thread** | 它唯一的存在理由是 v3 设计里「让 Dock 在没选中任务时不空着」。Dock 已取消，理由随之消失。跨任务提问归为 `inquiry` 类型的 Issue，不需要新对象 |
| **primary Thread** | 它被赋予两个职责——「Issue 级主控制线」与「完整生命周期记录」。前者归 Room，后者归轨迹视图（跨 Room 按时间聚合）。职责拆开后它本身没有剩余职责 |
| **Room 归档动作** | PRD 原文强调的是「**而不是物理删除**」，不是「必须归档」。Issue 内的 Room 数量有限，不需要为降噪而归档。改为「活跃 / 已结束」两个状态，Room 永不删除 |
| **父子 Issue** | 不引入层级。粒度差异用 `issues.labels`（`schema-v1.ts:71`，字段已存在）表达，零 schema 改动 |

### 3. 新增两个对象

**Runtime**：adapter 的安装位置、版本、登录状态、可用模型清单、并发上限、**剩余额度**。额度此前在 PRD 里只有 `budget_policy_json` 这样的策略字段，没有一等对象承载实时余量，导致「派工时看到剩余额度」无处取数。

**派工记录（Dispatch）**：把「用什么跑」与「跑出了什么」拆开。

| 派工记录 | Run / Attempt |
| --- | --- |
| 执行组合、上下文范围、Handoff Packet | 命令、退出码、原始输出、文件变更 |
| 一次派工可对应多次 Attempt（重试） | 单次进程执行 |

ADR 0009 的 `context_lane` 落在派工记录上，取值改为**上下文范围**（见下条）。

### 4. 上下文范围由派工决定，不由 Room 边界决定

ADR 0009 提出的分段是 `implement` / `verify` 枚举；本决策推进设计时一度改为「Room 即分段，换角色必须开新 Room」，被使用者否决——理由成立：临时拉人验证、拉观察者总结过程，都不该被迫开新房间。

正确的拆分是：

| | 由谁决定 |
| --- | --- |
| **Room** = 阅读容器 / 组织单位 | 用户，想怎么分就怎么分 |
| **上下文范围** = 这次派工给它看什么 | 派工时显式选，不是 Room 边界的副作用 |

三档取值：

```text
全部      目标 + 主张 + 产物 + 证据 + 变更 + 本 Room 对话历史
只给结果  目标 + 主张 + 产物 + 证据 + 变更          ← 不含过程对话
只给目标  目标 + 主张（+ 设计文档）                  ← 连产物都不给
```

**污染源只有一个**：实现者写在对话里的自述。它藏在「对话历史」里。所以真正的轴不是给多少，是**给不给过程对话**。第三档为「生成用例」准备——写用例时看得到实现，用例会被写成迁就实现的样子，这是 ADR 0010「用例先于实现固定」在运行时的保证。

**默认值按这一步要它干什么预选**，不设全局默认：

| 这一步是 | 预选 | 判据来源 |
| --- | --- | --- |
| 同组合续跑同一件事 | 全部 + resume | 上次派工记录 |
| 换组合接手同类工作 | 全部（含前任自述） | Handoff Packet 的正常用途 |
| 验证 / 复核 | 只给结果 + 冷启动 | Workflow Template 的验证段 |
| 生成用例 / 设计验收 | 只给目标 + 冷启动 | 同上 |
| 观察者 / 总结改进过程 | 全部 | 它要的恰恰是过程 |

**保护条款**：用户把验证类的上下文手动改回「全部」时，该次验证的结论必须降级——主张从「独立验证通过」变为「验证者读过实现者的自述，不构成独立验证」。这条比默认值本身更重要，它让推翻默认不会**静默地**毁掉可信度。

resume 的键相应改为：

```text
(adapter + 模型 + 深度, Issue, 上下文范围)
同组合 + 同范围 → 可 resume；换了范围 → 冷启动
```

### 5. Squad 保留，但必须结构化

保留理由（使用者原话）：为后续版本的**智能指派**服务——自动选 Squad 完成接下来的任务，减少人介入次数，提升长任务的自主执行度。

因此 Squad 是建模对象，不只是收藏夹。字段至少包含：

- 成员组合：一组 `adapter + 模型 + 深度`
- **结构化能力边界**：可匹配的 tags，不是自由文本
- 自由文本的擅长 / 不擅长说明：给人读，也给未来的语义匹配留材料
- 历史表现：成功率、典型耗时、失败模式

**「能力边界不能只是自由文本」是硬约束。** ADR 0007 已裁定 Coordinator 是**进程内确定性规则引擎，只推荐不派工**；确定性规则引擎无法消费自由文本。若要靠 LLM 做语义匹配来选 Squad，那是突破 ADR 0007 的边界，必须单独立决策，不能从 Squad 的字段设计里偷偷长出来。

**防护条款**：Squad **不产生持久身份**，历史表现仍记在 `adapter + 模型 + 深度` 上。否则用久了一个「架构师 Squad」就变成了一个成员，第 2 条取消的固定角色会从后门回来。

### 6. 知识库 ≠ Memory，且实际是三种东西

| | 谁产生 | 归属 | 例 |
| --- | --- | --- | --- |
| **Memory** | 系统从执行中沉淀 | Project / Space（按类型） | 「自动回路必须提供介入点」 |
| **Space 知识库** | 人写 | Space | 这个组的协作约定、FAQ |
| **项目资料** | 人写 | Project 资源库 | PRD、设计稿、参考资料 |
| **产品帮助** | PersonaHub 内置 | 全局 | 怎么用 PersonaHub |

使用者提到的「智能帮助中心」对应第四种，是产品自带的，不属于任何 Space。三者混在一起会重演 clowder 记录过的写入侧问题（见 `docs/architecture/memory-write-side-autopsy-2026-07.md`）。

**判据**：Memory 必须带 `source_issue_id` / `source_thread_id` / `source_event_ids`（PRD 第 5 节已有要求）。写不出来源的，就不是 Memory。

### 7. Validation Policy 并入 Workflow Template

`user-journeys.md:145` 表明 Workflow Template 在界面上已经承担「建议路径与**完成标准**（验证要求、什么算 Done）」，与 Validation Policy 重叠。

**决策**：Validation 降为 Workflow Template 内部的一个段落，概念保留、层级取消。`issues` 表的 `validation_policy_id` 停用。

ADR 0010 第 4 条「Validation Policy 升格为 Evidence Adapter 契约」相应改为「**Workflow Template 的验证段**升格为 Evidence Adapter 契约」。

**明确不做**：不保留「同一 workflow 换验证严格度」的切换能力。使用者确认不需要；保留它就得维持两层。

### 8. 命名纪律

| 概念 | 代码名 | UI 名 | 禁止 |
| --- | --- | --- | --- |
| Space | `space` | 工作区 | 代码里用 `workspace` 指协同层 |
| Project | `project` | 项目 | |
| Workspace | `workspace` | **代码目录** | UI 上叫「工作区」 |
| Issue | `issue` | 任务 | |
| Room（含其 Thread） | `room` | **会话** | 「协作现场」——它是视图不是对象 |
| Issue 的界面容器 | —（无对象） | **任务面** | `workspace` / 「工作区」 |

**「协作现场」退役为视图名**：Room ↔ Thread 一对一之后，用户看到的就是一个会话；一个 Room 可能只有用户和一个执行组合，叫「协作现场」过重。多成员并行时的成员泳道仍可称协作现场，但那是一种呈现形态，不是一个对象。

原则：**一个对象一个名字**。Room / Thread 两个对象共用一个界面，Room / 协作现场 一个对象两个名字，都在本决策中收掉。

## 已知未闭合项

**两处 schema 改动尚未实施**（使用者已确认方向）：

```text
issues.project_id    TEXT NOT NULL  →  可空（游离态 Issue）
issues.workspace_id  TEXT NOT NULL  →  可空（游离 Issue 无代码目录）
```

`inquiry` 这类只问不做的 Issue 天然没有项目与代码目录，当前的非空约束会挡住它。

**`agent_configs` 表语义变更未迁移。** 它现在是「AI 成员」表（`name` / `role` / `cli_provider` / `capability_tags` / `default_model`），需改为「adapter 运行配置」。第一版可不迁移：`name` 直接存 `codex-gpt5.6-high`、`role` 停用即可跑通，正式迁移等实现阶段。

**「深度」的取值范围未定。** `high / medium / low` 是按当前几个 CLI 的推理档位归纳的，不同 provider 的档位不一致（有的按 token 预算，有的按模式名）。需要在 Runtime 的能力探测里确认，并映射到统一取值。

**Memory 的 Project / Space 归属只有类型级判断，没有迁移规则。** 一条 lesson 是否可以从 Project 提升到 Space（「这条经验对所有项目都成立」），当前没有定义。

**Squad 的智能指派尚未有可行性验证。** 第 5 条只约束了「能力边界必须结构化」，没有验证结构化 tags 是否足以支撑有用的推荐。这需要在真实使用中攒够历史表现数据后才能判断，本决策不承诺它可行。

## 后果

- **收益一**：界面上反复出现的三个「这两个有什么区别」——两个输入框、两个会话 tab、primary Thread 与 Room——全部消失，因为造成它们的模型重叠被拿掉了。
- **收益二**：使用者对「一上来先定义几个固定角色」的质疑得到结构性回应。执行单位改为自解释的 `codex-gpt5.6-high`，不需要先建人再干活，也不会把职能烧进身份。
- **收益三**：额度、上下文范围这两个真实的日常决策依据，第一次有了承载对象。
- **成本**：两处 schema 改 nullable；`agent_configs` 语义变更；PRD 第 5 节多处需重写（Agent 整节、Thread、Room、Space、Validation Policy）。均为一次性成本，不随时间增长。
- **不承诺**：本决策不声称简化后的模型能覆盖未来需求。它明确按「当前真正需要」收敛，多人协同、跨 Space 共享、Issue 层级等能力在真实需要出现时再加——**代价是届时要做迁移**，这是本决策自觉接受的取舍。
- **对 PRD 的影响**：第 5 节需系统性修订。本决策不代改 PRD；按 `docs/SOP.md` 的文档纪律，在 v0.3 交互设计定稿后一并处理。

## 关联

- 修订：`docs/decisions/0009-agent-session-lifecycle.md`（`context_lane` 改为派工记录上的上下文范围；resume 键改为 `adapter+模型+深度`）
- 修订：`docs/decisions/0010-claim-evidence-structure.md`（范围血统压为一层；Validation Policy 改称 Workflow Template 的验证段）
- 依赖：`docs/decisions/0007-coordinator-execution-channel.md`（Coordinator 是确定性规则引擎，约束 Squad 的能力边界必须结构化）
- 依赖：`docs/decisions/0011-disable-native-agent-memory.md`（上下文范围的前提保障）
- 约束：`docs/personahub-prd.md` 第 5 节
- 证据：`multica-ai/multica` 的 `server/migrations/034_projects.up.sql`（游离态 Issue）
