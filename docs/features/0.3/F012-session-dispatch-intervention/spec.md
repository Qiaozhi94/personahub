---
kind: feature
id: F012
version: "0.3"
status: code-reviewing
gate_version: 1
eval_contract: exempt
eval_contract_exempt_reason: "本 Feature 改变用户旅程（派工选择、撤销窗口、会话与介入），但交付的是执行语义与可追溯契约（Dispatch / Attempt / DomainOutbox / capability evidence），不提出需用效用数据决定保留或退役的不确定主张；退役条件已由 migration-matrix 的 18 行 delete_when 与 v0.7 多机运行时接管显式登记"
related_features: [F005, F006, F009, F010, F011, F013, F014]
topics: [session, dispatch, runtime, context, intervention]
doc_kind: spec
created: 2026-08-09
updated: 2026-09-15
---

# F012：Session, Dispatch & Intervention

> Owner: unassigned | Target: v0.3

## 0. 来源与意图

- PRD：第 5.4、5.5、5.10、7.2、7.3 节；安全与可信边界 8.3、8.5、8.7。
- 设计基线：V3.44 会话、派工选择器和运行时基础。
- 决策：ADR 0009、0011、0012、0015；用量口径引用 ADR 0017（v0.3 只读额度事实，不做聚合）。
- 意图：将讨论容器、执行选择、上下文与进程结果拆开记录，使派工和介入可解释、可恢复。

## 1. 问题、目标与非目标

现有 AgentConfig / Thread / Run 同时承担身份、会话与执行选择，无法准确表达换模型、换深度、限制上下文和撤销派工。目标是引入会话语义与 Dispatch，并建立最小运行时盘点。非目标是把执行位置做成可扩展的多机能力、让系统替用户自动选择或自动重试、以及建立成本与效能的统计口径。

## 2. 用户场景

### US-001：选择并撤销派工（Priority: P1）

用户分开选择模型、思考深度和上下文范围，看到建议 / 可选 / 不可选理由，并可在启动窗口内撤销。

**独立测试**：确认后立即存在一个 draft Dispatch；撤销窗口内取消保留 cancelled Dispatch 且不产生 Run，窗口后只创建一个首个 Attempt / Run。

1. Given 验证步骤，when 选择与实现同源的模型，then 该组合仍可选，但派工前明示结论将降级为“有证据待验证”并记录同源原因。
2. Given 验证步骤且该 adapter 的原生记忆无法关闭或无法验证，when 选择该组合，then 选项不可选且说明结构性原因与替代路径。
3. Given 可选组合不满足软要求，when 用户坚持选择，then 允许派工并持久标注偏离。

### US-002：连续会话与上下文控制（Priority: P1）

用户在任务的一个或多个会话中派工；切换上下文范围会冷启动且披露过滤内容。

**独立测试**：同组合同范围可 resume，换范围不复用 session。

1. Given 独立会话，when 未转成任务，then 可以派工与执行，但不产生验收或 Memory 写入。
2. Given 验证上下文改为全部，when 派工，then 结论明确降级为非独立。

### US-003：安全介入与恢复（Priority: P1）

用户能暂停后续派工、取消当前 Attempt、补充约束、改派并恢复，且影响范围明确。

**独立测试**：pause 只阻止新 claim，running Attempt 继续；restart 保留 pause 意图。

1. Given 一个 running Attempt 与一个 draft Dispatch，when 用户暂停该任务的后续派工，then running Attempt 继续执行、draft 不再进入启动，并显示保留什么、作废什么、不动什么。
2. Given 运行时全局闸门被暂停，when 任意任务确认派工，then 确认被拒绝并给出恢复入口；已运行的执行不受影响。
3. Given 一个 running Attempt，when 用户取消该 Attempt，then 只有该 Attempt 终止，同一任务的其他 Attempt 与历史 Dispatch 不被改写。
4. Given 用户改派另一执行组合，when 提交，then 产生新的 Dispatch 记录，原 Dispatch 及其快照保持不变。

## 3. 范围与边界

### 范围内

- Room / Thread 一对一的会话模型、会话消息与独立会话转任务。
- Dispatch、四维执行组合、上下文范围和生效 Skill 快照。
- 建议 / 可选 / 不可选 eligibility 结果及来源理由。
- 可撤销启动、立即开始、暂停后续派工（任务 / 图 / 运行时三层闸门）、取消 Attempt、改派与恢复。
- 单台执行机器上的 adapter、模型、深度、工具和额度读取基础。
- 持久 DomainOutbox 公共基础设施。

### 范围外

- AI 成员、Primary / Project Thread、Room 归档、Room 自有状态机。
- 第二台执行机器的注册与调度、自动降级、自动续派、成本聚合与排行。

### 边界场景

- running Attempt 不热换执行组合；先取消再新建 Dispatch。
- adapter 离线、登录未知、额度不足、结构性不能隔离均不可选但可见。
- pause 与 claim 并发必须线性化，不能在暂停后漏启动一个 Run。
- 验收进入 finalizing / completed 后不得再产生新的执行。

## 4. 需求

### 功能需求

- **FR-001**：会话保存可选任务归属；会话内可发送普通消息；Thread 作为内部一对一事件流，不单独暴露。
- **FR-002**：Dispatch 固定执行组合、运行机器、上下文范围、Handoff 与 Skills 版本。
- **FR-003**：eligibility 返回三档候选、逐项理由与要求来源，不自动替用户降级；同源组合可选并声明结论降级，只有结构性能力缺失才不可选。
- **FR-004**：确认事务立即创建唯一 `draft` Dispatch 和 deadline，幂等键为会话与客户端请求标识的组合，与任务归属无关；撤销只执行 `draft → cancelled` 且零 Run，超时或用户选择立即开始时执行 `draft → starting → dispatched` 并幂等创建首个 Attempt / Run。撤销窗口时长有默认值、可配置，并允许配置为零。
- **FR-005**：resume key 包含执行组合、任务、会话和上下文范围；换范围冷启动。用户重新开始、session 不可用、上一次因不可信输入终止、进入要求独立性的验证或事前用例设计、原生记忆无法关闭这五种情况一律强制冷启动并记录原因；恢复失败不改写上一个 Attempt。
- **FR-006**：暂停后续派工只阻止新 Attempt，分任务、图和运行时全局三层；取消只终止目标 Attempt；所有介入写事件。
- **FR-007**：独立会话可以派工与执行，转任务后才允许进入 Artifact / Evidence / Memory 链。
- **FR-008**：运行时基础提供一台机器上的 adapter 状态、模型 / 深度、session、原生 memory 隔离、工具与额度事实；每项 probe 只允许 supported / unsupported / unverified 三态并附证据时间与 CLI 版本；深度以探测到的原生档位与统一三档映射同时记录。
- **FR-009**：提供持久 DomainOutbox 公共 contract：同一事务 enqueue、worker 投递、consumer ack、失败重试与 poison 保留。Dispatch 广播与 F011 的 `acceptance.completed` 跨服务推进复用同一基础设施；enqueue 与产生事件的领域事务原子提交，重复投递幂等，poison 事件保留稳定错误与诊断而不自动跳过。
- **FR-010**：任务的验收处于 finalizing 或 completed 时，创建与确认 Dispatch 一律被拒绝并给出替代路径；该判断在确认与超时启动两条路径上都生效。
- **FR-011**：上下文组装时复核路径授权，取机器路径授权、项目范围与任务范围的交集；任务级范围只能进一步收紧，不能放宽；复核不通过不产生 Run。

### 非功能需求

- **NFR-001**：Dispatch 创建、撤销、pause / resume 与 claim 在并发和重启后保持幂等。
- **NFR-002**：agent 可见上下文可从事件和 refs 完整重建。
- **NFR-003**：能力未知时保守失败；不得把缺失 probe 当作 supported，unsupported 与 unverified 都不能承担依赖该能力的独立验证。
- **NFR-004**：密钥与 provider session 标识默认遮罩，不进入普通导出；诊断导出同样遮罩。

## 5. 生命周期与不变量

Dispatch 有三条合法路径：`draft → cancelled`、`draft → starting → dispatched`，或确定性启动失败时 `draft → starting → start_failed`。确认事务以请求幂等键创建 draft 并写 drafted outbox；撤销与 deadline claim 对 draft 做互斥 CAS，starting 不再接受撤销。worker 取得带期限租约的 starting 后组装上下文，再以同一事务写入 context snapshot、Artifact consumption、首个 Attempt / queued Run、dispatched 状态与 outbox，commit 后才 spawn；start_failed 保留诊断且不创建 Run。dispatched 不可撤销，只能取消 Attempt。一次 Dispatch 可对应多个 Attempt，每个 Attempt 恰有一个 Run。会话 active / ended，永不物理删除；暂停是任务、图与运行时的派工闸门，不是会话或 Run 状态。Run / Attempt 继续拥有执行终态。

## 6. 成功与验收

### 成功标准

- **SC-001**：每次执行都能回答由什么组合、在哪台机器、看过什么、为何可选。
- **SC-002**：介入与重启不会产生幽灵 Run、重复派工或错误独立性。

### 验收清单

- [ ] **AC-001** (`FR-002`, `FR-003`): 四维组合、要求来源和三档 eligibility 在派工前可核对；同源组合可选且声明降级，结构性缺失不可选；Dispatch 固定 Skill revision 与 effective requirements，Skill 升级 / 禁用不改已提交 Dispatch。 - tests: `server/tests/integration/eligibility-evaluator.test.ts` `server/tests/integration/dispatch-service.test.ts`
- [ ] **AC-002** (`FR-004`, `NFR-001`): 撤销期取消保留一个 cancelled Dispatch 且零 Run；默认窗口、零窗口与立即开始三种配置行为一致；超时、重复确认、cancel / claim 竞态和重启只产生一个 Dispatch 与首个 Attempt / Run，每个事件恰好对应其 commit 点。 - tests: `server/tests/integration/dispatch-service.test.ts` `server/tests/integration/f012-concurrency-outbox.test.ts`
- [ ] **AC-003** (`FR-005`, `NFR-002`): resume / 冷启动与三档上下文组装、过滤披露正确；五种强制冷启动条件各自可触发并记录原因，恢复失败不改写上一个 Attempt。 - tests: `server/tests/unit/context-assembler.test.ts` `server/tests/integration/f012-concurrency-outbox.test.ts`
- [ ] **AC-004** (`FR-006`, `NFR-001`): 任务、图与运行时三层 pause 与 claim 并发、取消、改派和 restart 恢复正确。 - tests: `server/tests/integration/dispatch-recovery.test.ts` `server/tests/integration/f012-concurrency-outbox.test.ts`
- [ ] **AC-005** (`FR-001`, `FR-007`, `FR-008`): 独立 / 任务会话、会话消息和单机运行时基础完成浏览器旅程。 - tests: `e2e/tests/f012-sessions.spec.ts`
- [ ] **AC-006** (`FR-003`, `FR-008`, `NFR-003`, `NFR-004`): Codex / Claude Code / OpenCode 的模型、深度、session 与原生 memory probe 均有版本化证据；unsupported / unverified 的候选、后果和独立性降级可观察且不可旁路；密钥与 session 标识在界面和导出中均已遮罩。 - tests: `server/tests/integration/eligibility-evaluator.test.ts` `server/tests/unit/capability-evidence.test.ts`
- [ ] **AC-007** (`FR-009`, `NFR-001`): Dispatch 广播与 F011 `acceptance.completed` 共用同一持久 outbox；enqueue 与领域事务原子提交，worker 崩溃 / 重启后重投递不丢不重，consumer ack 幂等，poison event 保留稳定错误与诊断。 - tests: `server/tests/integration/f012-concurrency-outbox.test.ts` `server/tests/unit/domain-outbox.test.ts`
- [ ] **AC-008** (`FR-010`, `FR-011`): 验收 finalizing / completed 时确认与超时启动两条路径都拒绝新 Dispatch 并给出替代路径；路径授权复核取三层交集，任务级范围只能收紧，未授权时零 Run 并保留诊断。 - tests: `server/tests/integration/dispatch-service.test.ts` `server/tests/integration/authorization-recheck.test.ts`

## 7. 测试、依赖与决策

### 测试策略

Eligibility 与上下文组装单测；dispatch/pause barrier/restart 集成测试；真实 CLI capability / resume probe；Playwright 派工、撤销、会话切换和运行时状态。probe 摘要持久写入本 Feature 的 `adapter-capability-evidence.md`，原始机器可读结果保存为测试 fixture 并记录 CLI 版本与时间。

### 依赖

依赖 F005 adapter、F006 graph、F009 新壳层、F010 refs / `recordConsumption`，以及 F013 发布的 effective requirements 与路径授权 contract。派工 UI 直接接入 F009 稳定槽位；F011 后续消费本 Feature 的 Dispatch / 会话公开契约，F014 完成迁移验收。

### 决策与风险

不保留 AI 成员兼容抽象；旧 AgentConfig 数据通过迁移映射为 adapter 接入事实。原生记忆无法关闭的 adapter 不能承担独立验证。深度能力必须从 adapter 探测，不硬编码三档都可用。同源组合按结论降级处理而不是禁止执行，禁止只保留给结构性能力缺失。路径授权是应用层过滤，不是操作系统级隔离，如实声明。

## 8. 待确认问题

无
