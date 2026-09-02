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

1. **执行单位是 `adapter + 配置 + 模型 + 深度`，不是「成员」。** 使用者的原话：「代码开发我可以给 gpt-5.6 也可以给 deepseek-v4-flash，但是架构设计我肯定不会给 deepseek-v4-flash」。PRD 第 5 节 `[2026-08-15 修订]` 早已裁定「`capability_tags` 是路由主依据，`role` 降级为展示标签……界面也按能力项呈现成员，**不写成「它是 reviewer」**」——但 v3.1 原型全程用 `@实现者` / `@独立验证员` / `@架构研究员`，直接违反。
2. **Space 在数据层根本不存在。** 核实：`projects` 表无 `space_id`（`server/src/db/schema-v1.ts:2`），全仓库 `space_id` / `spaceId` 零命中，303 处 `space` 全是 `workspace_id` 的子串。它只活在 PRD 与界面左上角。
3. **游离态 Issue 是成立的做法。** multica 的 `issue.project_id` 是 `UUID REFERENCES project(id) ON DELETE SET NULL`（`server/migrations/034_projects.up.sql:19`）——可空，且 project 删除后 issue 仍在。
4. **Workflow Template 已经包含完成标准。** `docs/personahub-user-journeys.md:145`：「Workflow Template | 工作方式 | 推荐确认时展示**建议路径与完成标准（验证要求、什么算 Done）**」。而 `issues` 表同时有 `workflow_template_id` 与 `validation_policy_id` 两个独立外键，是历史遗留的重复。

## 决策

### 1. 层级定稿

```text
全局
├─ Runtime（运行时）      本机资源，分两层，见第 2 条
│  ├─ Adapter（CLI 安装）  版本 / 能力位 / 原生记忆能否关闭 / 执行位置；每台机器一份
│  └─ 配置 × N            base_url / 认证方式 / 订阅或 API / 可用模型 / 额度 / 项目可用性
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

**Runtime 与 Space 平级**，因为它是本机资源：换一个 Space 不该重新配置本机的 CLI；更硬的理由是**额度挂在 adapter 配置上**——在 A Space 用掉的配额，B Space 也少了，挂在 Space 下会算错。

### 2. 取消五个对象

| 对象 | 取消理由 |
| --- | --- |
| **Agent（AI 成员）** | 执行单位改为 `adapter + 配置 + 模型 + 深度`（如 `codex-gpt5.6-high`）。adapter 本身是 harness，对同一模型的表现有实质影响，因此四元组缺一不可。历史表现挂在这个组合上——这同时解决了「同一成员换模型后历史表现怎么算」的问题。四元组的展开见下方「执行组合的四个维度」 |
| **Project Thread** | 它唯一的存在理由是 v3 设计里「让 Dock 在没选中任务时不空着」。Dock 已取消，理由随之消失。跨任务提问归为 `inquiry` 类型的 Issue，不需要新对象 |
| **primary Thread** | 它被赋予两个职责——「Issue 级主控制线」与「完整生命周期记录」。前者归 Room，后者归轨迹视图（跨 Room 按时间聚合）。职责拆开后它本身没有剩余职责 |
| **Room 归档动作** | PRD 原文强调的是「**而不是物理删除**」，不是「必须归档」。Issue 内的 Room 数量有限，不需要为降噪而归档。改为「活跃 / 已结束」两个状态，Room 永不删除 |
| **父子 Issue** | 不引入层级。粒度差异用 `issues.labels`（`schema-v1.ts:71`，字段已存在）表达，零 schema 改动 |

#### 执行组合的四个维度

`adapter` 一词在本项目里同时被用于指两个不同的东西，写作本决策初稿时未加区分——因为当时脑子里的例子是 codex 与 claude-code，**这两个 CLI 一个安装只有一种配法**，两层重合，怎么理解都对。OpenCode 一进来就分叉：一个安装可以同时挂国内 coding plan 与官方 API 两份凭据（`agent_configs` 里就是两行 `cli_provider = opencode`）。因此四个维度分别是：

| 维度 | 是什么 | 承载的事实 |
| --- | --- | --- |
| **adapter** | 一个 **CLI 安装** | 版本、能力位（`AgentAdapterCapabilities`）、原生记忆能否关闭、执行位置（ADR 0015 的 `runtime_id`）。每台机器一份，装完只读，不是配置项 |
| **配置** | 一份**驱动这个 CLI 的方式**（`agent_configs` 的一行） | `base_url`、认证方式、订阅或 API、可用模型、额度、该项目/代码目录下的可用状态 |
| **模型** | — | 单价与能力档位 |
| **深度** | — | 每次派工可调，不烧进配置 |

**adapter 与配置是两层，不能合成一个词。** 三条后果决定了这一刀必须切：

1. **同一模型两条路时 ID 会撞车。** OpenCode 底下若有一个模型经套餐与经官方 API 都可达，只写 `opencode-<模型>-<深度>` 会指向两个东西：一个吃套餐额度，一个按 token 真花钱。派工清单上出现两行一模一样的选项，「计费：订阅 / API Key」这一列无处安放。区分依据是配置行上的 `base_url` 与名称——**它们是配置的字段，不是 CLI 安装的字段**，因此配置必须进 ID。
2. **历史表现会被平均掉，本条自己的承诺随之失效。** 上表说「历史表现挂在这个组合上」；若键在 CLI 安装上，OpenCode 两条路的成功率、耗时、失败模式会被并成一个数。而这两条路的失败模式**结构性不同**——套餐那条撞限流，官方 API 那条烧钱不限流。平均之后这张表就不能用来做判断了，而它存在的唯一理由就是做判断。
3. **「可用」住在配置层，不住在安装层。** `agent_configs` 是按项目的（`project_id`），另有代码目录级的 `effective_status` 覆盖（`shared/src/types/index.ts:284-293`）。「codex 可用」从来不是一个全局布尔；运行时页那句「3 个项目可用」显示的正是这个 per-project 事实。

**显示上不因此变丑**：一个 adapter 只有一份配置时省略配置段。按当前用法（Claude Pro 只在 Claude Code 用、GPT Plus 只在 Codex 用、OpenCode 只调国内 coding plan 与官方 API），codex 与 claude-code 永远只有一份配置，`codex-gpt5.6-high` 原样保留；只有 OpenCode 会显示四段。

### 3. 新增两个对象

**Runtime**：分 adapter（CLI 安装）与配置两层，见第 2 条。安装位置、版本、能力位、执行位置属于前者；登录状态、可用模型清单、并发上限、**剩余额度**属于后者。额度此前在 PRD 里只有 `budget_policy_json` 这样的策略字段，没有一等对象承载实时余量，导致「派工时看到剩余额度」无处取数。

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
(adapter + 配置 + 模型 + 深度, Issue, 上下文范围)
同组合 + 同范围 → 可 resume；换了范围 → 冷启动
```

### 5. Squad 保留，但必须结构化

保留理由（使用者原话）：为后续版本的**智能指派**服务——自动选 Squad 完成接下来的任务，减少人介入次数，提升长任务的自主执行度。

因此 Squad 是建模对象，不只是收藏夹。字段至少包含：

- 成员组合：一组 `adapter + 配置 + 模型 + 深度`
- **结构化能力边界**：可匹配的 tags，不是自由文本
- 自由文本的擅长 / 不擅长说明：给人读，也给未来的语义匹配留材料
- **不含历史表现字段**：编组的表现是一次查询，不是一份属性。由 Run 记录（含当次的编组 `id@version`）现算，永远带口径与样本量

**「能力边界不能只是自由文本」是硬约束。** ADR 0007 已裁定 Coordinator 是**进程内确定性规则引擎，只推荐不派工**；确定性规则引擎无法消费自由文本。若要靠 LLM 做语义匹配来选 Squad，那是突破 ADR 0007 的边界，必须单独立决策，不能从 Squad 的字段设计里偷偷长出来。

**防护条款**：Squad **不产生持久身份**，历史表现仍记在 `adapter + 配置 + 模型 + 深度` 上（四元组的理由见第 2 条）。否则用久了一个「架构师 Squad」就变成了一个成员，第 2 条取消的固定角色会从后门回来。

**本条约束的是身份积累，不是观察。** 编组的增量价值——同样几个组合，换步骤顺序、换上下文围栏、换谁验谁，结果会不同——恰恰是这个对象存在的理由，按组合归因的数字看不见它。因此允许**现算并显示**「用这个编组的 N 次里验收一次通过 M 次」，条件是三条：只从 Run 记录现算、不落成挂在编组上的字段；永远带口径与样本量（派工次数不足 30 次标「样本不足」）；**编组维度不可排序、不进统计模块的排行位**（ADR 0017 第 1 条不变，统计模块仍无编组维度）。分数是身份，带样本量的句子是观察——凝固成评分或排行榜的那一刻，防护条款就失效了。

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
| CLI 安装 | `cli_provider` | **adapter** | 用它指一份配置 |
| 一份驱动配置 | `agent_configs` 的一行 | **adapter 配置** | 叫「账号」——凭据只是它的一个字段，且它还携带 base_url、可用模型与项目可用性 |
| 派工的最小单位 | —（由上四者算出） | **执行组合** | 当作可增删的配置项——它是检查结果，不是配置 |

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

**`base_url` 列尚不存在（落地规格已定，受 development freeze 门控）。** 第 2 条把「同一模型两条路靠 `base_url` 与名称区分」当作 ID 不撞车的依据，但核查后确认：当前 `agent_configs` 只有 `model_provider` / `api_key` / `auth_type` / `command` / `args`，**没有 `base_url`**。在它落地之前，唯一可用的区分依据是配置行的 `name`，而那是自由文本——改一次名字历史记录就对不上。

落地规格如下，`BACKLOG.md` 的 2026-08-12 冻结解除后可直接执行：

| # | 触点 | 改什么 |
| --- | --- | --- |
| 1 | `server/src/db/schema-v11.ts`（新建）+ `migrations.ts` | `ALTER TABLE agent_configs ADD COLUMN base_url TEXT;` 并把 `CURRENT_SCHEMA_VERSION` 提到 11。**可空**——理由与 ADR 0015 的 `runtime_id` 相反：执行位置永远存在，而 base_url **真会缺席**（走官方端点的配置就没有），正是 ADR 0015「为什么用 `'local'` 而不是 `null`」一节里划的那条界 |
| 2 | `shared/src/types/index.ts` 的 `AdapterConfig` | 加 `base_url: string \| null`，紧挨 `model_provider` |
| 3 | `server/src/repositories/agent-config.ts` | 行类型、`create` 的 INSERT 列表与占位、`update` 的 `sets.push`、`mapRow` 四处 |
| 4 | `server/src/repositories/agent-config-dto.ts` | DTO 投影加一行 |
| 5 | `server/src/services/adapter-config-contract.ts` | 校验：非空时必须是 `https://`（`http://` 仅允许 loopback），且**不校验可达性**——可达性是 `validate()` 的事，契约层只管形状 |
| 6 | `server/src/services/adapter-config-updater.ts`、`api/routes/adapters.ts` | 入参透传 |
| 7 | `web/src/components/adapter/AdapterAuthFields.tsx` | 仅在 API Key 一支出现输入框；OAuth 一支不得出现（design.md §3.5 凭据第 1 条：出现输入框就说明抽象漏了） |
| 8 | `shared/src/types/validation.ts` 的 `AdapterIdentitySnapshot` | **不加**。快照已有 `adapter_config_id`，配置的当时取值可由它回查；把 base_url 冻进快照等于把一个会变的运维字段刻进证据 |

**与 ADR 0015 的落地顺序**：第 1 条与 ADR 0015 的 `runtime_id` 同批改 `agent_configs`，两次 ALTER 合进同一个 schema-v11，避免为同一张表连开两个版本。但两者**不可互相等待**——ADR 0015 第 1、2 条自己是一批（列 + 快照字段），本列不进快照，不属于那一批。

**adapter 能力位尚未有产品表达。** `AgentAdapterCapabilities`（`server/src/runtime/types.ts:56`）已有 `supportsApprovalHook` / `supportsStructuredTrace` / `supportsFinalMessage` / `executionTimeoutMs`，加上 ADR 0011 的「OpenCode 原生记忆关不掉」，每一位都有产品后果（该 adapter 上「等待权限确认」不会发生、轨迹视图取不到逐次明细、上下文范围三档保证不了），而界面上一条都没说。**能力不足是一种事实上的放宽，且是静默的**——ADR 0018 第 5 条硬规则二「只能加严不能放宽」只管住了能力包，管不住执行体本身。表达形态待 `design.md` §3.5 的 adapter 能力矩阵落定。

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

- 修订：`docs/decisions/0009-agent-session-lifecycle.md`（`context_lane` 改为派工记录上的上下文范围；resume 键改为 `adapter+配置+模型+深度`）
- 修订：`docs/decisions/0010-claim-evidence-structure.md`（范围血统压为一层；Validation Policy 改称 Workflow Template 的验证段）
- 依赖：`docs/decisions/0007-coordinator-execution-channel.md`（Coordinator 是确定性规则引擎，约束 Squad 的能力边界必须结构化）
- 依赖：`docs/decisions/0011-disable-native-agent-memory.md`（上下文范围的前提保障）
- 约束：`docs/personahub-prd.md` 第 5 节
- 证据：`multica-ai/multica` 的 `server/migrations/034_projects.up.sql`（游离态 Issue）
