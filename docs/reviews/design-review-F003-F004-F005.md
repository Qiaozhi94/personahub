# F003 / F004 / F005 规格三件套检视

> 检视人：Claude（Opus 4.8）｜日期：2026-07-16
> 范围：三个 feature 的 **spec + design + tasks** 共 9 份文档
> - `docs/features/0.1/F003-development-trace/{spec,design,tasks}.md`（已提交）
> - `docs/features/0.1/F004-autonomous-validation/{spec,design,tasks}.md`（design/tasks 未跟踪）
> - `docs/features/0.1/F005-multi-agent-manual-routing/{spec,design,tasks}.md`（design/tasks 未跟踪）
>
> 说明：本文是对早前"仅 design"检视的**扩展与修正**。结合 spec/tasks 后，原先两个被判为 P1 的问题**降级**（tasks 已兜住），详见第三节。

## 〇、处理结果（2026-07-16）

本检视提出的源文档问题已处理，原始发现保留在下文作为审计记录。最终采用的修正如下：

- **发现 1 已解决**：不重建`runs`表，也不把consult伪存成implementation；F005扩展`RunRole`新增非空持久化值`consult`，继续保持F004的`role TEXT NOT NULL`。
- **发现 2 已解决并收窄适用范围**：workflow validator严格按`implementation_run_id`绑定handoff/test/file/evidence；普通implementation/consult仍使用latest eligible prior handoff。
- **发现 3 已解决**：F005落地后`capability_tags`成为能力判断唯一真相源，手动routing与自动`ValidatorSelector`复用`hasCapability()`；旧`agent_configs.role`仅作迁移/展示兼容。
- **schema/事件缺口已解决**：F004 schema SQL补入`final_message TEXT`，共享contract显式列出五类validation事件及`issue.done`/`issue.unblocked`。
- **FIFO边界已解决**：queue drain在每次启动前按Run role和Issue当前状态复核eligibility；stale Run以`issue_state_changed_before_start`取消并继续drain，validator不获得跨Issue插队权。
- **整洁项已解决**：F005 spec按FR-008/FR-009顺序排列，`RunDispatchSource`明确为扩展F004枚举；F005 T062已明确替换F004即时创建validator的测试语义。

同时修正了原动作建议中的两个范围问题：consult role优先采用第三种非空枚举方案；validator绑定`implementation_run_id`只适用于validation context，不取代普通手动Run的latest handoff规则。

## 一、总体评价

三件套整体**质量很高**，且三份之间**交叉一致性好**：

- **spec**：US + 独立测试 + FR/DR/TR/IR/UX/NFR 分类需求 + 验收清单 + 可追踪性表，Given/When/Then 完整，边界场景（queued cancel 不产 handoff、证据不足 Blocked 而非伪 Done、同源验证如实标记）都写到了。
- **design**：数据流图开篇，事务/幂等/恢复/安全边界逐项落点。
- **tasks**：一律 TDD 顺序（先测试后实现）、Phase + Checkpoint 硬门槛、`Requirement → Task` 映射齐全，并明确标注**跨 feature 依赖**（F004 必须在 F003 Checkpoint 7 之后、F005 必须在 F004 Checkpoint 8 之后），migration 版本号"按实际前序落地顺延"的处理也很稳妥。

没有"推翻设计"级问题。下面按**穿透三件套后的真实严重度**排列。

## 二、核实无误（易误判，已对代码查证）

- **枚举字面量大小写**：F005 `WHERE status = 'Validating'`（issues 首字母大写）与 F004 `status IN ('queued','running')`（runs 小写）**都正确**——`IssueStatus`（`shared/src/types/index.ts:96`）大写、`RunStatus:169` 小写，partial index 能命中。
- **F004 `ALTER TABLE runs ADD COLUMN role`** 不重复：现有 `role`/`capability_tags` 在 `agent_configs`（`schema-v2.ts:6,10`），`runs` 表无 `role`。
- **`max_validation_rounds`** 是 `validation_policies` 已有独立列（`schema-v1.ts:50`，DEFAULT 3），F004 §6.5 引用成立。

## 三、对"仅 design"检视的修正（结合 spec/tasks 后降级）

> 这是三件套一起看才能得出的结论，特此更正：

- **`final_message` 列**（原判 P1 → 实为 P2 文档一致性）：F004 **tasks T009 明确写了**"加入 Run final_message 内部列"，design §6.7 正文也要求。**只是 design §4.1 的 schema SQL 代码块漏列**。实现不会漏（T009 兜底），但作为权威参照的 §4.1 SQL 应补齐。
- **`issue.done` / `issue.unblocked` 事件类型**（原判 P1 → 实为 P2/P3）：F004 **spec DR-005 明确要求**、**tasks T006 扩展 `ThreadEventType` + T036 覆盖 done/unblocked payload**。只是 design §3 的类型清单没有像 F003 design 那样把这两个新增枚举值显式列出。属 design 文档完整性缺口，不会导致漏实现。

## 四、发现项

### 1.〔F004↔F005 穿透三件套仍未解决 · P1〕`Run.role` nullable 与 DB `NOT NULL` 冲突，且缺放宽约束的 migration

- F004：schema v4（design §4.1 / tasks T009）建列 `role TEXT NOT NULL DEFAULT 'implementation'`；shared 类型 `role: RunRole`（非空）。
- F005：design §3 声明 `role: RunRole | null`（consult Run 的 role 为 null），**tasks T023 明确要测 "nullable role"**。
- 但 F005 的 v5 migration（design §4.1 / tasks T014-T015）**没有任何放宽 `runs.role` NOT NULL 约束的动作**。SQLite 把 `NOT NULL` 列改成可空**必须重建表**，`ADD COLUMN` 做不到。

**这是三份文档都没兜住的真实缺口**：要么 F005 增加一个"重建 runs 表放宽 role 约束"的 migration 任务，要么明确 consult Run 在 DB 层存 `'implementation'`、仅 public DTO 投影为 `null`（靠 `purpose=ad_hoc_consult` 区分）——两种都行，但必须选一个并写进 F005 design §4.1 + tasks，否则实现到 T023/T055 时会卡在"consult 插入 role=null 违反约束"。partial unique index（`WHERE role='validator'`）对两种方案都不受影响。

### 2.〔F004↔F005 语义 · correctness · P1/P2〕validator 上下文应绑定被验证的 implementation Run，而非"最新 handoff"

- F004 design §5.3 取 "**Latest handoff payload**"；F005 design §6.5 / tasks **T049 仍是 "latest prior handoff"**。
- 但 F003 规定**所有** terminal Run（含 F005 consult Run）都产 `handoff.created`；F005 允许 consult Run 在 **Validating** 期间执行（design §7.3）。
- 结合 F005 §8.1 的 10 秒 grace：implementation 完成 → Validating → 用户 grace 窗口内发一个 consult Run → consult 又写了更"新"的 handoff → validator 启动后按"最新 handoff"读到的是 **consult 的**，而非被验证的 implementation 的。

F004 §6.2 里 validator Run 已带 `implementation_run_id`——**建议把 validator 的 handoff/上下文严格绑定该 `implementation_run_id`**，并统一 F004 §5.3、F005 §6.5、tasks T049 的措辞。这是三份都用"latest handoff"埋下的一致隐患。

### 3.〔F005 衔接 · P2〕validator 选择真相源从 `agent_configs.role` 迁到 `capability_tags`，无专门任务

- F004 §6.1 `ValidatorSelector` / `listAvailableByProjectAndRole(projectId,'validator')` 基于 **`agent_configs.role`** 查询。
- F005 引入 `AgentCapability` 与 `capability_tags`，v5 migration 把空 `capability_tags` 按 `role` 补齐——即能力真相源转为 **`capability_tags`**。
- 但 F005 tasks（T051-T054 routing classifier、T027-T028 registry）**没有一条任务**处理"把 F004 `ValidatorSelector` 的查询依据从 `role` 列切到 `capability_tags`"。

不改会出现双真相源（UI 用 capability 勾选 validator，自动选择器仍按 role 列筛）。建议在 F005 design §6.1 与 tasks 补一条明确同步。

### 4.〔F005 spec 文档整洁 · P3〕功能需求编号乱序

F005 spec §4 的功能需求顺序是 `FR-001…FR-007` → **`FR-009`**（validator 互斥）→ **`FR-008`**（Escalation 覆盖），FR-009 排在 FR-008 之前。design 和 tasks 的映射表里是顺序排列的，只有 spec 正文颠倒。建议调整 spec 中两节顺序（或说明为何 FR-009 紧跟 FR-006/FR-007），避免阅读困惑。

### 5.〔演进管理 · P3 · tasks 已部分覆盖〕

- **F004→F005 requestValidation 行为切换**：F004 立即创建 validator（design §6.2、测试 T042"requested+validator run.queued 同事务"），F005 改为 10 秒 grace 延迟创建。**F004 tasks 备注已声明**"先实现立即路径并收敛到可复用 `request/claim` service，避免 F005 重写状态机"，F005 tasks T062-T063 也对应。衔接是清楚的——只需注意 **F004 的 T042 顺序测试在 F005 落地后需同步调整**，建议在 F005 tasks 里点一句。
- **`RunDispatchSource` 枚举**：F004 定义 `{UserExplicit,System}`、F005 定义 `{UserExplicit,UserDefault,System}`。建议 F005 文档写成"**扩展** F004 已有枚举，新增 `user_default`"，而非像重新定义一份。

### 6.〔待澄清 · 中低 · P3〕workflow hook "早于 drain" 与 FIFO 队列

F004 design §2.2 要求 "workflow hook 早于 queue drain"，hook 创建 queued validator Run。但 drain 按 `idx_runs_workspace_status` FIFO，validator 是最新创建；若队列里有更早的 workflow implementation queued Run（在 `Ready/Running` 阶段创建），FIFO 会先启动它，而此时 Issue 已是 `Validating`。请在 F004 design 补一句 **drain 出队时是否重新校验 Issue 当前状态**（Validating 下这条旧 implementation 是被拒绝/降级还是照跑）。tasks T056/T062 涉及顺序，但没写出队时的状态复核规则。

## 五、spec / tasks 专项评价（正面）

- **覆盖完整性**：三份 tasks 的 `Requirement → Task` 映射把每条 FR/AC 都落到了具体任务；F003 spec 的 AC-001…AC-012、F004 AC-001…AC-010、F005 AC-001…AC-007 都能在 tasks 里找到对应 Phase 和验收任务（各 feature 末尾都有"逐项走查 spec acceptance"的收尾任务）。
- **风险闭环**：spec §11 风险表与 §12 待确认问题都给了"已关闭"依据，且把真实 CLI 不确定性统一转成 Phase 1 probe 任务 + 明确降级路径（拿不到可靠 trace/final message → capability 降级 / Blocked，不伪造 pass），方向拍板、非阻塞。
- **安全门禁**：F005 tasks 把 secret 泄漏扫描列为独立硬门槛（T081/T105），credential isolation 对三 provider 分别回归（T031-T032/T104），OpenCode 不夸大前置审批（T046/T088）——安全边界处理得克制且诚实。

## 六、动作清单

| 优先级 | 动作 | 位置 |
| --- | --- | --- |
| P1 | 选定 consult `role` 的 nullable 方案：重建表放宽约束，或 DB 存 `'implementation'`+DTO 投影 null；写进 design §4.1 与新增 migration 任务 | F005 §4.1 / tasks（发现 1） |
| P1 | validator 上下文/handoff 绑定 `implementation_run_id`，统一三份措辞 | F004 §5.3 / F005 §6.5 / T049（发现 2） |
| P2 | 补 `ALTER TABLE runs ADD COLUMN final_message TEXT` 到 design SQL；在 §3 显式列出 `issue.done`/`issue.unblocked` | F004 §4.1 / §3（第三节修正项） |
| P2 | 增补"`ValidatorSelector` 查询切换到 `capability_tags`"的设计与任务 | F005 §6.1 / tasks（发现 3） |
| P3 | 调整 spec FR-008/FR-009 顺序；`RunDispatchSource` 写成"扩展"；标注 T042 将被 F005 改写；补 drain 出队状态复核 | 各文档（发现 4、5、6） |

## 七、第二轮复核（2026-07-16，针对"处理结果"版本）

**结论：第一轮六项发现已全部落地，方案自洽，tasks 完全同步，三份 design 的"待确认设计问题"章节实质清零。** 逐项复验：

- 发现 1：F005 §3 新增 `RunRole.Consult = "consult"`（非空），保留 F004 `role TEXT NOT NULL`，不重建表；tasks T012/T014/T015/T023 同步（拒绝 null role）。partial unique index 语义不变。✓
- 发现 2：F004 §5.3 把 `implementation_run_id` 定为 validator context 的**强制 scope**（handoff/verification/file/refs 全绑定），F005 §6.5 令 `context_source_run_id == implementation_run_id`、consult 更新 handoff 不串入；T049 覆盖。并正确**收窄**：只 validation context 绑定，普通 run 仍用 latest eligible handoff。✓
- 发现 3：F005 §6.1(277 行) 把 `ValidatorSelector` 改为查 `capability_tags contains 'validator'`，与手动 routing 共用 `hasCapability()`；`agent_configs.role` 降为迁移/展示；T028/T053/T054 同步。✓
- 发现 4/5/6：`final_message`（§4.1 T009）、`IssueDone`/`IssueUnblocked` 枚举（§3）、FR 顺序、`RunDispatchSource` 注明"扩展"、drain eligibility 新增 §6.1.1 / F005 §7.5（stale run 以 `issue_state_changed_before_start` 取消并续扫，consult 在 Validating 可跑但不污染 validator context）——均已落地。✓

真实 CLI 协议字段的不确定性统一转为 Phase 1 probe + 明确 fallback（拿不到可靠 trace/final message → capability 降级 / Blocked），属"外部事实待实测、设计边界已定"，不算待确认设计问题。

### 仍可再细化的点（非阻塞，但按"零遗留"标准建议补）

1.〔**`workflow_step` 取值规则未集中定义** · 建议补〕`runs.workflow_step`（`"implementation" | "validation" | null`）由 F004 引入，但整套文档只明确了 **validator run = `validation`**（F004 §6.2 步骤 4）。**workflow-bound implementation run 与 consult run 创建时该写什么，没有任何一处规定**——F005 §7.4 的 create-transaction 与 payload 示例只推导 `purpose/role`，未提 `workflow_step`。实现者创建这两类 run 时会缺一个确定答案（合理推断是 implementation→`"implementation"`、consult→`null`，但应写死）。建议在 F005 §7.4 或 F004 §3 补一张 `role × workflow_step` 对应表，或直接声明 `workflow_step` 完全由 `role` 派生（若如此，甚至可说明其为纯展示冗余）。

2.〔**validator 的 `implementation_run_id` 是"推导"而非"存储"，且依赖一个隐含不变量** · 建议点明〕`runs` 表没有 `implementation_run_id` 列（只有 `evidence_summaries` 有）。validator run 关联的 implementation run 实际是运行时用 `RunRepository.getLatestCompletedByRole(issueId,'implementation',beforeRunId?)`（F004 §4.3）**推导**的。但 F005 §6.5"validator 严格使用**其** `implementation_run_id`"的措辞像是 validator run 存了该字段，易让实现者误建列或误解。其推导正确性还**依赖一个未点明的不变量**：Validating 期间不会产生新的 completed implementation run（由 §6.1.1 drain 取消 stale implementation 来保证）。建议：(a) 在 §6.5 澄清 implementation_run_id 是推导值及其来源方法；(b) 显式记录"Validating 期间无新 completed implementation"这条不变量，避免日后改 drain 规则时悄悄破坏 validator 绑定。

3.〔次要 UX〕§6.1.1 用 `issue_state_changed_before_start` 取消 Validating 下排队的 stale implementation run，会静默丢弃用户此前排入的那条指令。建议在 Thread/composer 文案明确提示"该指令因 Issue 进入验证被取消，请在验证结束后重发"，避免用户以为指令已执行。

> 上述三点均可在编码时按合理默认落地，不构成设计返工；但第 1、2 点属于"实现者需要一个唯一确定答案"的细节，与"细化到可直接编码"的目标最相关。

### 第二轮三点的处理结果（2026-07-16）

三点已按建议补入源文档：

- **点 1（`workflow_step` 取值）已解决**：F004 §3 新增 `role → workflow_step` 派生表（implementation→`implementation`、validator→`validation`、consult→`null`），明确"完全由 role 派生、不接受客户端传入"；F005 §7.4 create-transaction 明确固化规则；测试承载补入 F004 T016、F005 T055。
- **点 2（`implementation_run_id` 来源）已解决，且比原判断更干净**：核实后 `implementation_run_id` **本就固化在 `validation.requested` event payload**（F004 §8），并非运行时用 `getLatestCompletedByRole` 反复推导——因此不存在"依赖脆弱不变量"的真问题，只是措辞未点明。已在 F004 §5.3 与 F005 §6.5 显式声明"固化来源 + 全程读同一值 + 不重新推导"，并在 F004 T060 recovery 测试补断言。
- **点 3（stale cancel 的 UX）已解决**：F005 §7.5 补明"必须以文案展示 `issue_state_changed_before_start`（提示指令被取消需重发）"，测试承载补入 F005 T095。

至此，三件套无遗留的待确认设计问题，可进入开发。
