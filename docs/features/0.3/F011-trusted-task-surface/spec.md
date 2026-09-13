---
kind: feature
id: F011
version: "0.3"
status: draft
gate_version: 1
eval_contract: required
related_features: [F006, F009, F010, F012, F013, F014]
topics: [task-surface, claims, evidence, resources, trace]
doc_kind: spec
created: 2026-08-09
updated: 2026-09-13
---

# F011：Trusted Task Surface

> Owner: unassigned | Target: v0.3

## 0. 来源与意图

- PRD：第 5.3、5.7、5.8、6.1、7.3、7.4、9、10 节。
- 交互基线：`ui-reference/personahub-draft/personahub-v3.1/docs/design.md` 的任务四视图与可信交付；`browser-check.json` 中 F011 适用断言见 F009 `v344-browser-check-applicability.md`。
- 上游契约：F009 壳层 / 迁移矩阵，F010 Artifact revision / resolver，F012 Session / Dispatch / Attempt / context snapshot，F013 effective completion requirements。
- 决策：ADR 0009、0010、0011、0012。
- 意图：让用户在一个稳定的任务工作面内判断现在发生了什么、结果是否可信，以及下一步需要做什么。

## 1. 问题、目标与非目标

现有生产任务页把 Thread、Run、Graph、Trace、Evidence 与 validation 按后端对象分段展示。用户需要自己拼接“当前状态—实际成果—验证可信度—恢复动作”，相同事实还会在会话与 Inspector 重复出现；现有 Evidence Summary 也不能表达完成要求、显式论证、未覆盖项和上下文独立性。

本 Feature 的目标是：

1. 用同一 TaskProjection 驱动任务列表、任务头和概览 / 会话 / 验收 / 资源四视图，不让页面各自推断状态。
2. 把完成要求、主张、论证、证据、剩余风险与完成摘要连成一条可追溯写链。
3. 对正常、等待、异常与完成状态给出不同的首屏优先级和唯一主操作，同时始终保留原始执行事实。
4. 由真实新工作面接管 F009 迁移矩阵中归 F011 的兼容宿主与动作。

非目标：

- 不重新设计 Session、Dispatch、Attempt、GraphRun 或 Issue 的 canonical 生命周期。
- 不实现 Memory、自动化、完整统计、非 coding 专用 Evidence Adapter 或多执行机器。
- 不用总体通过率、信任分或 Agent 自述代替逐条完成要求的判断。
- 不把任务活动、会话消息与 Run Trace 合并成一条事件流。

## 2. 用户场景

### US-001：判断任务现状与下一步（Priority: P1）

用户打开任务后，先看到当前最重要的事实、影响和唯一主操作，而不是先阅读底层日志。

**独立测试**：11 个具名 Task state fixture 使用同一 projection contract；逐项断言首屏优先级、唯一主操作、恢复结果和必须保留事实，并单独断言动作 owner。归档与无法可靠映射的旧记录另走只读边界 fixture。

1. Given 任务等待权限，when 打开概览，then 缺失权限、影响和审批 / 拒绝入口先于普通活动，且动作调用 F012 canonical API。
2. Given 任务已完成，when 打开概览，then 不可变完成摘要与非阻塞建议同时可见，且没有新的执行主操作。
3. Given 页面收到重复 SSE 事件，when 重放 projection，then 状态与人工待办计数不增加第二次。

### US-002：核对结果是否可信（Priority: P1）

用户按冻结的完成要求查看主张、论证、证据和未覆盖项，能够区分机器事实、模型陈述与用户判断。

**独立测试**：同源验证、`context_scope=all`、原生 memory 隔离为 unsupported / unverified、缺失 ref、hash mismatch 和失败证据均不能得到“已独立验证”。

1. Given 一条完成要求尚无证据，when 打开验收，then 它以“需要处理”留在主张树中，不能被空态或总数折叠掉。
2. Given 实现者自产自验，when 证据本身通过，then 精确结论显示同源原因，视觉状态仍为“有证据待验证”。
3. Given Artifact revision 缺失或 hash 不符，when 查看依据，then 保留原 ref 与失败原因，不回退到 current revision。

### US-003：确认完成要求与完成任务（Priority: P1）

用户在写入前看到基线差异，在必要主张满足或逐项接受剩余风险后生成不可变完成摘要，并可靠推进任务完成。

**独立测试**：基线变更未经确认不生效；重复命令返回同一结果；摘要写入故障不产生 `acceptance.completed`；事件重复投递不产生重复摘要或重复完成。

1. Given Skill revision 带来完成要求变化，when 用户未确认差异，then 当前基线、覆盖结论和 Issue 状态都不改变。
2. Given 仍有未满足要求，when 用户没有逐项填写剩余风险理由，then 完成命令被拒绝并返回确定的阻塞项。
3. Given 完成事务已提交而 Issue consumer 尚未成功，when 打开任务，then 显示“正在完成”及可恢复状态，不把它误报为失败或已完成。

### US-004：连续查看会话、轨迹与资源（Priority: P1）

用户在会话旁查看 adapter 轨迹，在资源清单就地预览输入与产出，并在四视图之间切换而不丢失输入草稿。

**独立测试**：Room 切换、trace 搜索 / 分页 / 放大、Artifact 六态读取、文件变化定位与视图切换使用真实 API；草稿以 task ID 为 key 保留。

1. Given 同一任务有多个会话，when 切换 Room，then 消息与轨迹一起切换，Task 状态不被 Room 状态覆盖。
2. Given 一个 Artifact revision 既被生产又被后续 Dispatch 消费，when 查看资源，then 产出与输入关系均可见且都固定到确定 revision。
3. Given 从验收打开长文档，when 返回任务，then 恢复原验收位置；从资源点文件只更新副栏预览，不离开任务。

### US-005：从任务列表进入可信工作面（Priority: P1）

用户从稳定组织的任务列表创建或打开任务，不因状态变化而在左栏跳组；直接创建仍保留目标原文并在确认前不落库。

**独立测试**：F009 迁移矩阵 P005 / A004 / A005 的列表、创建、打开和未知 ID 旅程由新 Task surface 接管，旧 `IssueList` / `CreateIssueDialog` 不再可达。

## 3. 范围与边界

### 范围内

- `/tasks` 的稳定组织列表、直接创建 / 打开入口，以及 `/tasks/:taskId/{overview,conversation,acceptance,resources}` 四视图。
- 任务头、跨视图输入框、活动 / 轨迹 / 大纲 / 预览四个可折叠副栏。
- 11 个 active presentation state、归档只读边界和无法可靠映射时的 `legacy_unknown` 诊断态。
- 完成要求不可变基线及确认变更；主张 revision、论证、evidence ref link、逐项剩余风险接受和不可变完成摘要。
- 三种用户可见可信状态：已独立验证、有证据待验证、需要处理；精确原因单独显示。
- Artifact / 文件的输入与产出清单、确定 revision 预览、provenance 跳转、trace 搜索 / 分页 / 放大。
- F009 迁移矩阵中 replacement owner 为 F011 的 P005、P008、A004、A005、A016–A024 的接管与旧入口退出。

### 范围外

- F012 所有 Session / Dispatch / Attempt / pause / cancel / retry / validation dispatch 写语义；本 Feature 只调用其公共 API。
- F013 的 Skill revision、requirements 合并、仓库授权与文件读取裁决；本 Feature 只消费冻结快照和授权读取结果。
- F014 的首次配置到可信完成全旅程、跨版本 migration report 与 v0.3 发布声明。
- v0.4 的 Memory / 自动化 / Usage 集成；v0.5 的非 coding 领域状态映射。

### 边界场景

- tab 数字只计需要人工动作的事项；每个事项以稳定 key 归属唯一处理视图，不因同一事实出现在概览摘要而重复计数。
- `draft` / `starting` Dispatch 与 `queued` Attempt 分别显示“等待启动”与“已排队”，不能合并。
- 正在写入、只存在 source path 而未发布、missing / invalid / hash mismatch 的 Artifact 均不算完成依据。
- 完成摘要已提交但 Issue 尚未消费事件时显示“正在完成”；此后禁止修改当前验收链。
- 归档任务保持四视图只读可达，不进入 M4 的 11 个 active state 计数；旧数据无法确定语义时显示 `legacy_unknown`，不猜测映射。
- 大列表、消息、trace、资源与 evidence 均分页；TaskProjection 是统一语义服务，不等于一次返回所有正文。

## 4. 需求

### 功能需求

- **FR-001**：Task list 按置顶、最近、项目、收藏等稳定组织维度读取与筛选，不按瞬时状态搬组；直接创建在用户确认前不落库，重复提交只产生一个任务且保留目标原文。
- **FR-002**：单一 TaskProjectionService 以同一组 canonical facts 生成任务头、四视图公共 envelope、presentation state、唯一主操作与人工待办；各视图不得自行推断 Issue / Dispatch / Attempt 状态。
- **FR-003**：概览只回答目标、待决定、现状和下一步；活动副栏只显示任务级状态 / 基线 / 派工 / 验收事件，不复制消息正文、证据树或 Run Trace。
- **FR-004**：会话视图读取 F012 Session / Thread / Dispatch，轨迹副栏读取 input / model / tool / timing 事实并支持搜索、类型分页、折叠和全宽复盘；Room 不拥有 Task 或 Attempt 状态。
- **FR-005**：验收按“完成要求 → 主张 revision → 论证 → evidence ref”组织；未支撑主张与已支撑主张同层可见，机器事实、模型陈述和用户决定保留来源类型。
- **FR-006**：系统按 evidence 原生状态、执行身份、上下文范围、冷启动与 adapter 隔离能力计算精确结论，再投影为三种用户可见状态；UI 无权手写或提升独立性。
- **FR-007**：资源视图按产出 / 输入展示 Artifact revision、Artifact consumption 与实际文件变化；预览只解析确定 ref，失败保留原 ref 和稳定错误，不回退到最新内容。
- **FR-008**：AcceptanceService 是完成要求、主张链、风险接受与完成摘要的唯一写入口；所有命令要求 actor、幂等键、请求 fingerprint 和 expected acceptance version。
- **FR-009**：初始基线与任务创建在同一事务内冻结；基线变更先返回逐项 diff，用户确认后新增 immutable baseline，未变化 requirement 保留身份，变化 / 删除项保留历史且不继承覆盖结论。
- **FR-010**：只有当前基线的每条必要要求已满足、明确不适用或由用户逐项接受剩余风险，且没有 active Attempt / 未决权限动作时，AcceptanceService 才能在一个事务内生成不可变完成摘要并写 `acceptance.completed` outbox event。
- **FR-011**：IssueService 只接受 AcceptanceService 发出的 `acceptance.completed`，并幂等核对 summary / acceptance version 后推进 done；重复投递不重复完成，完成摘要失败不得推进 Issue done，consumer 失败不得丢失可重试事实。
- **FR-012**：F011 新工作面通过验收后删除迁移矩阵所列 F011 transitional host；旧 validation 记录只做显式 legacy projection，不伪造 normalized claim 或独立性。

### 数据与追溯需求

- **DR-001**：baseline、requirement、claim revision、argument、evidence link、risk acceptance、completion summary 与 outbox event 均可追溯到 Issue、操作者、时间和来源版本。
- **DR-002**：完成摘要固定当前 baseline、claim revisions、arguments、evidence refs、独立性原因、风险决定和 Artifact revisions；生成后不随当前 Skill、最新 Artifact、adapter 配置或价表变化。
- **DR-003**：TaskProjection 每项 activity / attention / resource / evidence 都携带稳定 source key；SSE replay 按 source key 去重并可从持久状态重建。

### UX 需求

- **UX-001**：任务头第一行是标识 / 标题 / 元信息，第二行固定四视图；正文宽度与左边界不随视图切换跳动，四个 tab 使用标准键盘模型。
- **UX-002**：任务底部只有一个输入框并按 task ID 保留草稿；视图、Room 和副栏切换不清空，只有匹配该提交 generation 的成功响应才能清空。
- **UX-003**：tab badge 只显示该视图负责处理的人工待办数；概览摘要可以链接到处理视图，但不取得第二个计数。
- **UX-004**：异常先显示“发生了什么 / 影响什么 / 建议做什么”，再给唯一主操作；高风险动作说明会动什么、不动什么和恢复边界。
- **UX-005**：验收长文档使用主栏全文 + 返回条；资源使用清单 + 同屏预览；Markdown 不执行原始 HTML / script，代码和文件变化支持上一处 / 下一处。

### 非功能需求

- **NFR-001**：TaskProjection 可从 SQLite 与授权文件读取重建；断线重连、重复 outbox delivery 与 SSE replay 不重复事件、状态或待办计数。
- **NFR-002**：Acceptance 写链在进程崩溃、并发命令、expected version 冲突和重复幂等键下保持线性一致；不得出现无摘要 done、重复摘要或静默覆盖基线。
- **NFR-003**：正文读取继续受 F010 resolver 与 F013 路径授权约束；错误、日志、SSE 与诊断不泄露未授权正文、绝对路径、provider session ID 或凭据。
- **NFR-004**：TaskProjection 公共 envelope 不随正文数量无界增长；消息、trace、resources、claims 使用稳定 cursor 分页，默认页的查询计划命中索引。

## 5. 生命周期与不变量

TaskProjection 只读，不拥有 Issue、Session、Dispatch、Attempt、Artifact 或 validation 状态。页面主操作携带 `owner`，分别调用 AcceptanceService、IssueService 或 F012 的 canonical service；projection 不提供旁路写入口。

11 个 active presentation state 是 canonical facts 的有优先级投影，不是新状态机：

| Task state fixture | 首屏优先级 | 唯一主操作 | 动作 owner / 恢复结果 | 必须保留事实 |
|---|---|---|---|---|
| 刚创建 | 目标与完成要求 | 配置派工 | F012 / 进入等待启动 | 目标原文、初始基线 |
| 等待启动 | 撤销截止时间与选定组合 | 撤销派工 | F012 / 已取消或 CAS 后已排队 | draft / starting Dispatch、确认与撤销事件 |
| 权限阻塞 | 缺失权限、影响范围 | 审批或拒绝 | F012 / 已排队或继续阻塞 | 请求范围、裁决、操作者 |
| 已排队 | Attempt 与队列事实 | 取消 Attempt | F012 / 已取消 | Dispatch snapshot、排队时间、pause revision |
| 执行中 | 当前 Attempt 与真实输出 | 取消 Attempt | F012 / 已取消或已中断 | 流式事件、已发布 revision、context snapshot |
| 等待指派 | 阶段结果与下一步 | 创建下一派工 | F012 / 进入等待启动 | terminal Attempt、Handoff、Artifact revisions |
| 验证未收敛 | 未满足要求与 finding | 发起修复派工 | F012 / 进入等待启动 | 失败证据、轮次、旧改动、当前基线 |
| 执行失败 | 原因与可重试性 | 重试或改派 | F012 / 进入等待启动 | 退出码、stderr 摘要、执行组合、保留产物 |
| 已中断 | 中断点与恢复边界 | 从该步恢复 | F012 / 进入等待启动 | 已完成步骤、最后 cursor、revisions |
| 已取消 | 取消影响范围 | 新建派工 | F012 / 进入等待启动 | 取消前事件、产物、操作者 |
| 已完成 | 完成摘要与剩余建议 | 查看完成摘要 | F011 read-only / 保持完成 | baseline、主张链、refs、风险决定 |

状态优先级必须确保：归档边界最先裁决；已提交 completion summary 进入“正在完成”子态并锁定验收写入；等待权限高于普通 queued / running 展示；最新有效 Dispatch / Attempt 高于旧终态；没有可靠映射时进入 `legacy_unknown`。`legacy_unknown` 只给诊断 / 返回列表动作，不伪造恢复命令。

Acceptance lifecycle 为：`open → finalizing → completed`。`open` 允许带 expected version 的验收命令；完成事务原子写 immutable summary 与 outbox 后进入 `finalizing` 并锁定写入；IssueService 消费成功后为 `completed`。summary 和 event 必须一同存在或一同不存在。任何 baseline 变更都创建新 baseline；任何 claim 文本变更都创建新 revision；evidence ref 与 risk decision 不原地改写。

## 6. 成功与验收

### 成功标准

- **SC-001**：用户无需打开底层日志即可从首屏判断任务现状、影响和下一步，11 个 active state 均只有一个主操作。
- **SC-002**：用户能从每条当前完成要求追到主张、论证、原始事件 / 文件 / Artifact revision，并看出为何是独立、同源、失败或缺失。
- **SC-003**：完成命令在重试、崩溃与事件重放下只生成一个摘要，并最终得到一个匹配的 done 状态。
- **SC-004**：F009 中归 F011 的旧任务 / Inspector 生产入口全部退出，历史事实仍可读取。

### 验收清单

- [ ] **AC-001** (`FR-002`, `FR-003`, `UX-003`, `UX-004`): 11 个具名 active fixture 共用同一 projection contract，并逐项断言首屏优先级、唯一主操作、owner、恢复结果和必须保留事实；归档只读与 `legacy_unknown` 另有显式 fixture。
- [ ] **AC-002** (`FR-005`, `FR-006`, `DR-001`): 完成要求、主张 revision、论证、证据、未覆盖项和三态投影可观察；同源、全上下文、非冷启动、隔离 unsupported / unverified、missing / invalid / hash mismatch 均不能显示为独立验证。
- [ ] **AC-003** (`FR-004`, `FR-007`, `UX-002`, `UX-005`, `NFR-003`): 多 Room 会话与轨迹连续查看；资源按输入 / 产出固定 revision 并在授权边界内预览；切视图不丢草稿，长文档可返回原验收位置。
- [ ] **AC-004** (`FR-002`, `DR-003`, `UX-001`, `NFR-001`, `NFR-004`): 键盘 / 语义 / 分页 / 查询计划与 SSE replay 测试通过；重复 source event 不增加活动或 badge。
- [ ] **AC-005** (`FR-008`, `FR-009`, `NFR-002`): 初始基线与任务创建原子提交；变更 diff 未确认不生效；重复 / 冲突命令不覆盖；未变化 requirement 保持身份，变化项不继承旧覆盖。
- [ ] **AC-006** (`FR-010`, `FR-011`, `DR-002`, `NFR-002`): 未满足要求、未逐项接受风险或 active Attempt 时不能完成；摘要 / outbox 故障注入、consumer 重启与重复 delivery 下不存在无摘要 done、重复摘要或不匹配完成。
- [ ] **AC-007** (`FR-001`, `FR-012`): P005、P008、A004、A005、A016–A024 的新读写旅程逐行通过并记录 completion evidence；旧 `IssueList`、`CreateIssueDialog`、`IssueInspector` 与 validation transitional host 不在 production route / registry 可达。

### Eval / Tracking Contract

- **主要用户与激活信号**：个人开发者在真实任务中打开至少两个任务视图，并从验收视图打开一条 evidence 或执行一次处理动作；以 task view / evidence open / canonical action 事件按 task 去重。
- **摩擦指标**：首次打开任务到执行唯一主操作或打开目标 evidence 的中位步骤数；`legacy_unknown`、无 owner 主操作和 projection 加载失败分别计数，不合成总分。
- **回归夹具**：11 个具名 active state + 归档 / legacy_unknown；同源验证降级；Artifact missing / hash mismatch；摘要事务提交后 consumer 重启重放；四视图切换草稿保留。
- **退役信号**：若后续统一任务工作面在不丢失上述状态矩阵、claim-evidence 独立性和 completion outbox 回放证据的前提下完全接管四视图，并且 F011 专用 route / projection / acceptance API 的全部 consumer 已迁移，则删除 F011 专用 surface 适配层；不得在仍有生产 consumer 时仅因使用量低而删除验收数据模型。

## 7. 测试、依赖与决策

### 测试策略

按“纯投影函数 → repository / migration → AcceptanceService 故障注入 → API / SSE contract → React 状态矩阵 → Playwright 真实旅程”分层。V3.44 的 F011 deferred browser checks 必须逐条映射到自动化断言；只有布局观感与措辞自然度保留人工体验复核，结构 / 行为不得标为人工。

### 依赖

依赖 F009 新壳层、F010 Artifact 契约和 F012 已提交的 Dispatch / 会话契约；具体读取 F010 的 Artifact 六态 / provenance，以及 F012 已验收的 Session / Dispatch / Attempt / outbox 公共契约。初始与迁移基线消费 F013 的 versioned effective completion requirements，但不修改 Skill revision。F006 Graph facts 只读进入投影；F014 负责跨 Feature 全旅程与发布收口。

F011 可以在 F010 检视尾声完成文档设计，但实现必须等待 F012 与 F013 的实际公共契约通过验收；若上游实现形状与本设计引用不一致，先修订三件套再开工，不建立临时字段。

### 决策与风险

- 采用一个 projection service + 按 view 分页的 discriminated payload，不用四套状态查询，也不一次返回所有正文。
- 跨服务完成推进使用持久 outbox；F010 的 Artifact 通知仍沿用可重建的 commit 后广播，不追溯改造。
- 独立性是持久事实的计算结果，不保存一个可被 UI 提升的布尔值或分数。
- 历史 Evidence Summary 只投影为 `legacy`；主要风险是旧数据缺 requirement snapshot，必须显示未解析范围并交 F014 migration report，不伪造 normalized claim。

## 8. 待确认问题

无。
