---
topics: [decision, requirements, validation, evidence, assurance-case, traceability, generality]
doc_kind: decision
status: proposed
created: 2026-08-27
---

# 0010: 需求与验收的结构模型——主张与证据，不是固定层级

## 背景

v0.3 交互设计把可信度的锚点从「证据」换成「用例」之后，下一个问题立刻出现：**用例挂在什么上**。

设计过程中提出的方案是「需求分三级：旅程（Epic）→ Feature → User Story，用例也分三级，按层级展示」。这个方案有两个吸引力：它和仓库现状吻合，也看起来能通过换层级名来支持非代码场景。

但在把它写进设计稿之前，需要先回答一个问题：**这套结构有没有支撑，还是只是软件行业的习惯**。因此做了一次理论核查，结论改变了方案。

### 仓库现状：这套层级已经在用，只是没被当成产品概念

- `docs/personahub-user-journeys.md`：`J1` / `J2` / `J3` / `J4` 四条旅程。
- `docs/features/{version}/Fxxx-*/spec.md`：Feature 一级。
- 同一份 spec 内：`### US-001 / US-002 / US-003（Priority: P1）`。
- 每个 US 之下：`AC-001` … `AC-009`。

所以问题不是「要不要引入层级」，而是「这套已经存在的层级该以什么形式提上界面」。

### 核查结论一：三级命名不是理论，是工具惯例

英文维基百科 `User story` 条目「Relationship to epics, themes and initiatives/programs」一节明确写：

> There is probably **not a common definition** because different approaches exist for different styles of product design and development. In this sense, **some also suggest to not use any kind of hard groups and hierarchies.**
>
> For instance, **Jira** seems to use a hierarchically organized to-do-list, in which they named the first level of to-do-tasks 'user-story', the second level 'epics' and the third level 'initiatives'.

也就是说，`Epic → Feature → Story` 的层数与命名来自 Jira 的对象模型，不是研究结论。照抄它等于把一套工具的取舍固化进产品。

Jeff Patton 的 User Story Mapping（技术 2005–2014 成形，同名著作 2013 年出版）确实把用户旅程放在最上层——但它的核心是**叙事顺序与产品全貌**，不是层数；层数在这套方法里是可变的。

### 核查结论二：真正的支撑在另外三处

**V-Model**（英文维基 `V-model (software development)`）：

> The V-Model demonstrates the relationships between each phase of the development life cycle and **its associated phase of testing**. The horizontal and vertical axes represent time or project completeness (left-to-right) and **level of abstraction**.

纵轴就是抽象层级。「高层需求配高层验收、低层需求配低层验收」是 V 模型的定义本身，与层数是三还是四无关。**被支撑的是对应关系，不是层数。**

**Assurance Case / Goal Structuring Notation**（英文维基 `Safety case`、`Goal structuring notation`）：

> A Safety Case is a **structured argument, supported by evidence**, intended to justify that a system is acceptably safe for a specific application in a specific operating environment.
>
> GSN … was developed at the University of York during the 1990s to present safety cases … **standardized in 2011** … can be applied to **any type of argument** and has been used in other contexts such as **patent claims, debate strategy, and legal arguments**.

三点关键：

1. 它**不限于软件、不限于工程**——维基列出的用途包含专利主张、辩论策略、法律论证；行业覆盖航空、汽车、铁路、核电、临床。这正是本项目要的「不局限于代码开发」。
2. 它的诞生动机是「克服用 **Toulmin 论证模型**表达安全论证时的问题」，而 Toulmin 是通用论证理论。
3. **`UndevelopedGoal` 是 GSN 的一等元素**：未被支撑的主张必须显式画出来。已在四个互相独立的实现中核实——Eclipse Epsilon 的 `epsilonlabs/SACM-UML-Profile`（`GSN/shapes/undevelopedGoal.svg`）、GE 的 `ge-high-assurance/RITE`（`UNDEVGOAL("gsn:UndevelopedGoal")`）、`wrwei/Jorvik`、`alby-shinoj/GNS-diagram-designer`（`NodeType.UndevelopedGoal`）。

第 3 点直接给交互设计里那段「还没有被证明」提供了背书：把未支撑的主张显式在场，是安全论证四十年的标准做法，不是界面创意。

**GQM**（英文维基 `GQM`，Basili，马里兰大学 / NASA Goddard）：

> GQM defines a measurement model on **three levels**: 1. Conceptual level (Goal) …

Goal → Question → Metric。它说明「三层」这个数字有先例，且 GQM 从不假设对象是代码。

**监管侧的旁证**（英文维基 `Requirements traceability`）：DO-178C（航空）、ISO 26262（汽车）、IEC 61508（功能安全）共同要求「关键需求必须被验证，且该验证必须通过**可追溯性**来证明」。「每个需求都要有验收覆盖」在这些标准里是强制条款，不是团队偏好。

## 决策

### 1. 骨架是「主张 → 论证 → 证据」，不是固定层级

PersonaHub 的需求与验收结构采用三个角色，与 GSN 同构：

| 角色                 | 含义                                 | coding 下的实例                  | 写作下的实例                    |
| -------------------- | ------------------------------------ | -------------------------------- | ------------------------------- |
| **主张（Claim）**    | 一句可判真假的断言：这件事做成了     | 完成要求 / AC                    | 一个论点                        |
| **论证（Strategy）** | 凭什么这么说——从主张到证据的连接方式 | 「两条端到端用例走完整读取路径」 | 「三处原始出处 + 一次交叉核对」 |
| **证据（Evidence）** | 可核对的原件                         | 用例执行结果                     | 引用与出处                      |

**范围血统与主张结构分开。** `旅程 → Feature → US` 回答「这条主张属于哪里」，不是三层上位主张；可判真假的完成要求 / AC 才进入主张—论证—证据结构。范围层数不预先规定，coding 常见三层血统，写作可能只有作品与章节。

**证据使用已有的天然标识，不新建编号体系。** 测试用测试名，文件用 workspace 相对路径，源码引用用「仓库 · 路径 · 符号」，验证结论用「成员 · Run」，反证用文字标签。PersonaHub 的证据对象本来就各自可寻址（Run ID、ThreadEvent ID、artifact revision、文件路径），再造一套 `TEST-xxx` / `SRC-xxx` 前缀只会多出一份需要人工维护、且与真实对象二次对齐的编号表。

**「论证」这一层不可省略。** 设计评审中出现过「三段像在讲同一件事但抓不住联系」的反馈，缺的正是它：主张与证据之间没有显式连线，读者只能自己脑补。GSN 把 Strategy 作为独立节点，正是为了消除这种脑补。

### 2. 未被支撑的主张必须显式在场

采纳 GSN 的 `UndevelopedGoal` 语义：**没有证据的主张不能不显示，也不能伪装成有证据。**它以未支撑状态出现在与已支撑主张同一张表里，不折叠、不下沉到二级页面。

对应交互设计中「还没有被证明」的表达；本决策把它从一条界面判断升格为结构约束。

**证据覆盖不等于验证通过。** 一条主张至少区分 `无证据 / 有证据待验证 / 独立验证通过 / 同源验证 / 验证失败`。实现者产生的证据可以支撑后续验证，但不能单独获得最终绿勾；证据执行者、上下文独立性和 validator 结论必须分别可见。

### 3. 验收项与主张同层对应（V-Model 抽象层级轴）

一条主张的最终验证应由**匹配其抽象层级**的证据支撑：

- 旅程级主张 ← 端到端旅程用例
- Feature 级主张 ← 功能验收用例
- US 级主张 ← 场景用例（即现在的 AC）

**单元测试默认不计入用户级主张覆盖率。** 它主要测实现内部，界面上作为“实现回归”单独成段并默认折叠，避免与端到端验收混算成「18 / 18 通过」。但低层技术主张可以显式引用单元测试或属性测试；是否足够仍由该主张所属 Validation Policy 决定，不做“一律不能支撑”的绝对规则。

### 4. 通用性靠角色不变、实例可换，不靠为每个 Issue Type 硬编码层级

「流程即插件」的插法是：骨架永远是主张 / 论证 / 证据三角色，**插件提供 Evidence Adapter**——证据类型、摘要与预览、打开动作、时效、独立性、领域结论到通用状态的映射，以及「分解到什么算够」的判据——而不是一套新的层级定义。

PRD 已有的 Validation Policy 表按 Issue Type 给出了证据类型（coding = tests pass / diff review / verification trace；research = 来源足够 / 结论有证据 / 分歧被标注；writing = 目标读者 / 结构 / 论点 / 证据 / 风格；troubleshooting = 现象消失 / 命令输出正常 / 日志无关键错误）。它升格为插件定义，不需要新建概念。

因此非代码场景**不是「去掉验证主线」**——那会让「可信交付」这条产品承诺只在代码场景成立。它换的是证据类型和领域结论；研究至少还需要部分支持、有争议、已失效等状态，不能强压成二元 pass/fail。这里承诺的是信息骨架可复用，不承诺所有 Evidence Adapter 可以零代码接入。

### 5. 明确不做的事

- **不照抄 Jira 的 Epic / Story / Initiative 三级。** 它没有共同定义，且工具惯例不该成为产品结构。
- **不给每个 Issue Type 各配一套层级定义。** 见第 4 条。
- **不把单元测试默认并入用户级覆盖率。** 低层技术主张的例外见第 3 条。
- **不引入 GSN 的图形记法。** 采纳的是它的语义（主张 / 论证 / 证据 / 未支撑），不是它的图形符号；本产品的呈现形态是表，不是论证图。

## 已知未闭合项

**仓库里 AC 与 US 之间没有显式连线。** 核实 `docs/features/0.3/F009-artifact-foundation-provenance/spec.md` 后确认：AC 追溯到的是 `FR-xxx` / `DR-xxx` / `NFR-xxx` / `UX-xxx`，例如

```text
- [ ] AC-002 (`FR-002`, `FR-003`): 旧 revision ref 永远解析旧内容。
```

而不是追溯到 `US-002`。也就是说「US-002 有哪几条 AC」目前要靠人读出来，范围级汇总算不出来。这个缺口不影响第一版在单任务内展示 AC，但会阻塞 Feature / US 的上卷统计。

处理方式：修改 `docs/features/README.md` 的 spec 模板，要求 AC 同时标注所属 US。**本决策不代改模板**，按 `docs/SOP.md` 的文档纪律另行处理。

**「分解到什么算够」的判据尚未定义。** GSN 实践里这依赖评审人判断，没有机械规则。第一版先由用户自己决定何时停止分解，并在界面上把未支撑的叶子显式标出——不能停的地方会自己暴露出来。

**范围血统的引用规则尚未统一。** `docs/personahub-user-journeys.md` 已有 `J3.1` 等步骤 ID，但 spec 还没有统一声明 Feature / US 对应哪一步旅程。完整血统和上层贡献汇总前必须补齐；默认只显示当前 US 的单任务界面不受阻塞。

**跨任务范式的复用尚未验证。** 本 ADR 保持 `proposed`，直到 coding、research、troubleshooting 三类静态样例都能用同一组通用状态表达，并由使用者确认没有把领域差异藏进自由文本。

## 后果

- **收益一**：交互设计里三段互相重叠的内容（三卡覆盖率、完成要求与依据、还没有被证明）有了统一解释——它们是同一棵主张树的三种读法，因此可以合并成一张表。设计评审中「抓不住联系」的问题定位到了缺失的「论证」层。
- **收益二**：通用性不再依赖为每个 Issue Type 造一套层级。骨架有四十年跨行业实践（航空、汽车、核电、临床、法律论证）背书，且明确不限于软件。
- **收益三**：「未支撑的主张必须显式在场」从产品判断变成有出处的结构约束，未来被以「界面太满」为由删掉时，有据可依。
- **成本**：spec 模板要改（AC 标注所属 US）；旅程引用规则要统一；每类 Workflow 需要 Evidence Adapter。前两项是文档工作，最后一项会产生运行时与界面实现成本。
- **不承诺**：本决策不声称采纳 GSN 语义能提高交付质量。理论核查只能证明这个方向不是凭空发明；它在本产品里好不好用，仍要靠真实使用验证。
- **对 PRD 的影响**：Validation Policy 从「按 Issue Type 的一句话描述」升格为 Evidence Adapter 契约。本决策不代改 PRD。

## 关联

- 依赖：`docs/decisions/0009-agent-session-lifecycle.md`（跨围栏冷启动决定证据能不能算独立）
- 约束：`docs/personahub-prd.md` 第 5 节 Validation Policy（升格为插件定义）
- 约束：`docs/personahub-user-journeys.md`（步骤 ID `J1.1`–`J3.6` 已存在；需补的是 Feature / US 对应哪一步的引用规则）
- 约束：`docs/features/README.md` 的 spec 模板（AC 需标注所属 US）
- 落点：v3.1 交互设计基线 `ui-reference/personahub-draft/personahub-v3.1/docs/design.md`
