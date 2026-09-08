---
kind: feature
id: F014
version: "0.3"
status: draft
gate_version: 1
related_features: [F009, F010, F011, F012, F013]
topics: [journey, migration, integration, release]
doc_kind: spec
created: 2026-09-08
updated: 2026-09-08
---

# F014：Trusted Task Journey Closure

> Owner: unassigned | Target: v0.3

## 0. 来源与意图

- PRD：第 7、10、11 节。
- 用户旅程：J1–J5。
- 版本计划：`docs/features/0.3/README.md` 第 5 节。
- 意图：作为唯一集成 owner，证明 F009–F013 在真实 CLI、历史迁移和浏览器中形成一条完整旅程。

## 1. 问题、目标与非目标

领域 Feature 可以各自通过，却仍让用户卡在配置、导航、派工、恢复或验收的接缝。目标是拥有跨 Feature 验收、跨 schema 兼容迁移、最终工作面装配和发布证据。非目标是重复 F009 的首次前端换壳、复制任何 canonical 状态或在本 Feature 内补第二套业务服务。

## 2. 用户场景

### US-001：首次配置到可信完成（Priority: P1）

用户无需离开产品完成 J1–J4 的真实 coding 旅程。

**独立测试**：以 PersonaHub 仓库和真实 CLI 运行版本验收旅程，并保存 Evidence Summary。

1. Given 清洁配置，when 用户完成最小设置并创建任务，then 可派工组合和边界明确。
2. Given 执行与独立验证完成，when 用户验收，then 每条要求可追到确定 revision 与原始事件。

### US-002：历史数据安全迁移（Priority: P1）

升级用户能继续打开 v0.1–v0.2 的 Project、Issue、Thread、Run、Trace 与 Evidence，不被新模型伪造含义。

**独立测试**：从每个已发布 schema fixture 升级到当前 schema 并回放代表任务。

1. Given 旧 Agent / Workflow 字段无法无损映射，when 升级，then 标 legacy 并保留 raw 来源，不猜成新 Skill / Dispatch。
2. Given migration 中断，when 重启，then 安全重试且不重复记录。

### US-003：异常恢复与可访问使用（Priority: P1）

用户能在真实浏览器中从排队、权限、失败、中断、取消和验证未收敛分别恢复。

**独立测试**：Playwright + 进程 kill / restart 覆盖各状态和键盘路径。

## 3. 范围与边界

### 范围内

- 在 F009 壳层中装配 F010–F013 已验收工作面，并完成剩余生产路由切流。
- J1–J5 的跨 Feature API / 页面胶水和发布 fixture。
- 所有历史 schema 升级、剩余 legacy projection / 深链与 migration report。
- 真实 CLI、restart、Playwright、可访问性和 dogfood 发布验收。
- 用户文档、升级说明和版本收口证据。

### 范围外

- F009–F013 已拥有的前端迁移与领域写入、Memory、自动化、完整统计、多机。

### 边界场景

- 未实现的最终工作面不得以死导航或只有 toast 的页面出现。
- 集成层不得通过跨表直写修补业务缺口。
- 历史事实缺失时显示 unknown / legacy，不从当前配置反推过去。

## 4. 需求

### 功能需求

- **FR-001**：核对 F009 生产导航只暴露 v0.3 已形成完整页面的工作面，并完成最后的路由切流与兼容清零。
- **FR-002**：J1–J5 全程使用 F009–F013 提供的生产 UI 与 canonical API，不复制状态。
- **FR-003**：升级器覆盖所有发布 schema，输出成功、legacy、需人工处理的逐项报告。
- **FR-004**：旧深链跳转到对应新对象或明确 legacy 页面，不产生 404 / 空白页。
- **FR-005**：版本验收生成可回放的测试、运行、Artifact 与 Evidence 证据索引。

### UX 需求

- **UX-001**：核心旅程不出现死按钮；键盘、焦点、表格、页签和弹窗满足全局契约。
- **UX-002**：错误和高风险动作在操作前表达影响与恢复，不依赖文档解释。

### 非功能需求

- **NFR-001**：升级前后历史记录数量、ID、终态和 refs 守恒；migration 幂等。
- **NFR-002**：发布门禁包含构建、真实浏览器 E2E 和真实 CLI smoke。

## 5. 生命周期与不变量

本 Feature 不拥有业务状态机。发布候选只有在所有跨 Feature AC、迁移、真实 CLI 和人工浏览器检查通过后才能收口；任一失败回到对应 owner 修复，不在集成层加旁路。

## 6. 成功与验收

### 成功标准

- **SC-001**：首次用户和升级用户都能完成可信 coding 旅程。
- **SC-002**：v0.3 可以用一份端到端证据声明完成，而不是四份局部报告相加。

### 验收清单

- [ ] **AC-001** (`FR-001`, `FR-002`, `UX-001`): F010–F013 工作面在 F009 壳层完成最终装配，J1–J5 浏览器旅程连续且无死入口或残余双写入口。
- [ ] **AC-002** (`FR-003`, `FR-004`, `NFR-001`): 所有发布 schema fixture 升级、深链和 legacy 报告通过。
- [ ] **AC-003** (`FR-005`, `NFR-002`): 真实 CLI 执行、独立验证、中断恢复与完成摘要证据完整。
- [ ] **AC-004** (`UX-001`, `UX-002`, `NFR-002`): 可访问性、高风险动作和全量发布门禁通过。

### Eval / Tracking Contract

- **主要用户与激活信号**：使用本地 AI CLI 的个人开发者；激活为首次真实任务创建首个 Dispatch 并进入执行。
- **摩擦指标**：首次可派工时间、旅程失败点、人工复制上下文次数、等待状态到动作的时间。
- **回归夹具**：清洁首次设置；v0.2 最新库升级；中断后恢复；同源验证负例；Artifact revision 缺失。
- **退役信号**：当发布流程已有独立、持续维护的跨版本 journey suite 与 release owner，并连续两个版本直接复用且迁移报告由平台级升级模块接管时，删除 F014 专用集成代码，仅保留通用门禁。

## 7. 测试、依赖与决策

### 测试策略

从 J1–J5 派生 Playwright；每个 schema fixture 做升级与守恒断言；至少一次真实 CLI + kill/restart；最后人工按设计稿 125 条契约抽查生产对应项。

### 依赖

依赖 F009–F013；发现缺口必须回到对应 Feature 修订与实现。F014 不重新建设 App Shell，也不把 F009 的首次迁移拖到版本末尾。

### 决策与风险

本 Feature 是交付 owner 而非新领域。最大风险是为赶集成绕过 canonical service；以代码所有权检查和跨层写入审查阻断。

## 8. 待确认问题

无。
