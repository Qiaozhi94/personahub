---
kind: feature
id: F012
version: "0.3"
status: draft
gate_version: 1
related_features: [F005, F006, F009, F010, F011, F013, F014]
topics: [session, dispatch, runtime, context, intervention]
doc_kind: spec
created: 2026-08-09
updated: 2026-09-08
---

# F012：Session, Dispatch & Intervention

> Owner: unassigned | Target: v0.3

## 0. 来源与意图

- PRD：第 5.4、5.5、5.10、7.2、7.3 节。
- 设计基线：V3.44 会话、派工选择器和运行时基础。
- 决策：ADR 0009、0011、0012、0015。
- 意图：将讨论容器、执行选择、上下文与进程结果拆开记录，使派工和介入可解释、可恢复。

## 1. 问题、目标与非目标

现有 AgentConfig / Thread / Run 同时承担身份、会话与执行选择，无法准确表达换模型、换深度、限制上下文和撤销派工。目标是引入会话语义与 Dispatch，并建立最小运行时盘点。非目标是多执行机器、自动续派、完整统计或独立 Room 调度器。

## 2. 用户场景

### US-001：选择并撤销派工（Priority: P1）

用户分开选择模型、思考深度和上下文范围，看到建议 / 可选 / 不可选理由，并可在启动窗口内撤销。

**独立测试**：撤销窗口内取消不产生 Run；窗口后创建一个 Dispatch 与首个 Attempt。

1. Given 验证步骤，when 选择实现同源模型，then 选项不可选且说明独立性原因。
2. Given 可选组合不满足软要求，when 用户坚持选择，then 允许派工并持久标注偏离。

### US-002：连续会话与上下文控制（Priority: P1）

用户在任务的一个或多个会话中派工；切换上下文范围会冷启动且披露过滤内容。

**独立测试**：同组合同范围可 resume，换范围不复用 session。

1. Given 独立会话，when 未转成任务，then 不产生验收或 Memory 写入。
2. Given 验证上下文改为全部，when 派工，then 结论明确降级为非独立。

### US-003：安全介入与恢复（Priority: P1）

用户能暂停后续派工、取消当前 Attempt、补充约束、改派并恢复，且影响范围明确。

**独立测试**：pause 只阻止新 claim，running Attempt 继续；restart 保留 pause 意图。

## 3. 范围与边界

### 范围内

- Room / Thread 一对一的会话模型与独立会话转任务。
- Dispatch、四维执行组合、上下文范围和生效 Skill 快照。
- 建议 / 可选 / 不可选 eligibility 结果及来源理由。
- 可撤销启动、暂停后续派工、取消 Attempt、改派与恢复。
- 单台执行机器上的 adapter、模型、深度、工具和额度读取基础。

### 范围外

- AI 成员、Primary / Project Thread、Room 归档、Room 自有状态机。
- 多机注册与调度、自动降级、自动续派、成本聚合。

### 边界场景

- running Attempt 不热换执行组合；先取消再新建 Dispatch。
- adapter 离线、登录未知、额度不足、结构性不能隔离均不可选但可见。
- pause 与 claim 并发必须线性化，不能在暂停后漏启动一个 Run。

## 4. 需求

### 功能需求

- **FR-001**：会话保存可选任务归属；Thread 作为内部一对一事件流，不单独暴露。
- **FR-002**：Dispatch 固定执行组合、运行机器、上下文范围、Handoff 与 Skills 版本。
- **FR-003**：eligibility 返回三档候选、逐项理由与要求来源，不自动替用户降级。
- **FR-004**：派工在 Run 创建前提供可撤销窗口；超时后幂等创建 Dispatch / Attempt。
- **FR-005**：resume key 包含执行组合、任务、会话和上下文范围；换范围冷启动。
- **FR-006**：暂停后续派工只阻止新 Attempt；取消只终止目标 Attempt；所有介入写事件。
- **FR-007**：独立会话转任务后才允许进入 Artifact / Evidence / Memory 链。
- **FR-008**：运行时基础提供一台机器上的 adapter 状态、模型 / 深度、工具与额度事实。

### 非功能需求

- **NFR-001**：Dispatch 创建、撤销、pause / resume 与 claim 在并发和重启后保持幂等。
- **NFR-002**：agent 可见上下文可从事件和 refs 完整重建。

## 5. 生命周期与不变量

Dispatch：draft → starting → dispatched，starting 可撤销为 cancelled；dispatched 不可撤销，只能取消 Attempt。会话 active / ended，永不物理删除。暂停是任务 / 图的派工闸门，不是会话或 Run 状态。Run / Attempt 继续拥有执行终态。

## 6. 成功与验收

### 成功标准

- **SC-001**：每次执行都能回答由什么组合、在哪台机器、看过什么、为何可选。
- **SC-002**：介入与重启不会产生幽灵 Run、重复派工或错误独立性。

### 验收清单

- [ ] **AC-001** (`FR-002`, `FR-003`): 四维组合、要求来源和三档 eligibility 在派工前可核对。
- [ ] **AC-002** (`FR-004`, `NFR-001`): 撤销期取消零 Run，超时 / 重复提交只产生一个 Dispatch 与 Attempt。
- [ ] **AC-003** (`FR-005`, `NFR-002`): resume / 冷启动与三档上下文组装、过滤披露正确。
- [ ] **AC-004** (`FR-006`, `NFR-001`): pause / claim 并发、取消、改派和 restart 恢复正确。
- [ ] **AC-005** (`FR-001`, `FR-007`, `FR-008`): 独立 / 任务会话和单机运行时基础完成浏览器旅程。

## 7. 测试、依赖与决策

### 测试策略

Eligibility 与上下文组装单测；dispatch/pause barrier/restart 集成测试；真实 CLI resume probe；Playwright 派工、撤销、会话切换和运行时状态。

### 依赖

依赖 F005 adapter、F006 graph、F009 新壳层、F010 refs / `recordConsumption`，以及 F013 发布的 effective requirements 与路径授权 contract。派工 UI 直接接入 F009 稳定槽位；F011 后续消费本 Feature 的 Dispatch / 会话公开契约，F014 完成迁移验收。

### 决策与风险

不保留 AI 成员兼容抽象；旧 AgentConfig 数据通过迁移映射为 adapter 接入事实。原生记忆无法关闭的 adapter 不能承担独立验证。深度能力必须从 adapter 探测，不硬编码三档都可用。

## 8. 待确认问题

无。
