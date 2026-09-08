---
topics: [decision, plugin, extensibility, architecture, seam, scope-control]
doc_kind: decision
status: accepted
created: 2026-08-31
updated: 2026-09-08
---

# 0014: 插件贡献点——先定能扩展什么，再决定何时开缝

## 背景

PersonaHub 采用普通 route / service / repository 分层和手工装配，不是“一切皆插件”的运行时。为将来整体替换为插件框架而预抽接口，会产生无法由第二实现验证的半成品 seam；但完全不记录潜在扩展点，又容易让业务代码把它们写死。

因此本决策维护一张具名清单。清单表达目标边界，不授权当前实现，也不替代 ADR 0008 的触发判断。

## 决策

### 1. 贡献点清单

| ID | 贡献点 | 当前状态 | 开放条件 / 版本 |
|---|---|---|---|
| P1 | Agent adapter provider | 已有成熟 seam | Codex / Claude Code / OpenCode 已验证 |
| P2 | Dispatch context source | 核心组装器先固定 | 出现第二种真实资料来源后按 ADR 0008 开缝 |
| P3 | Graph definition / node output contract | 内建定义 | 第二条真实非 coding graph；最早 v0.5 |
| P4 | Evidence ref kind | 核心注册表独占 | 外部不得定义语义；只由核心 Feature 扩展 |
| P5 | Skill revision | F013 目标 | v0.3 建数据契约；插件贡献延至 v0.8 |
| P6 | Skill steps / 编组 | 与 P5 同一 schema | 不建独立 Squad seam |
| P7 | Evidence adapter / domain checker | 候选 | 首个非 coding 垂直切片；最早 v0.5 |
| P8 | Memory candidate producer / provenance gate | 候选 | v0.4 有第二来源时 |
| P9 | Execution provider | 候选 | v0.7 出现本机之外的真实执行世界时 |
| P10 | Automation trigger / admission | 候选 | v0.4 定时与 Webhook 两种来源形成后 |
| P11 | Notification sink | 候选 | 出现第二通知目的地后 |
| P12 | Declarative capability surface | 候选 | v0.8 首个带数据视图的插件 |

P5 与 P6 都是 Skill revision；有 `steps` 即编组。不存在独立 Workflow Template、Validation Policy、Squad 或“能力包”贡献点。

### 2. 开缝规则

每个贡献点独立判断，满足以下条件才建立 Definition / Provider / Consumer 三角色：

1. 已有至少两个真实实现，或第二实现已经进入当前 Feature 范围。
2. 两者差异能够写成稳定 contract，而不是用 `unknown` 把差异推给运行时。
3. Consumer 确实不需要知道具体 provider。
4. 失败、能力缺失和生命周期可以由统一语义表达。

不满足时写普通函数或具名 service。清单中出现不等于要创建空接口。

### 3. 插件准入公理

即使尚未开放插件，这些规则立即约束可贡献数据：

- **声明不等于授权**：manifest 只产生候选资源；宿主校验、授权并激活后才生效。
- **单一激活路径**：每类资源只有一个写入口；不得为插件建立 ad hoc writer。
- **所有权与失败局部化**：记录 source / version；冲突直接拒绝；单一来源失败不影响其余。
- **动作走白名单**：插件 surface 只能调用宿主动作；“创建任务”必须创建普通任务并按需建立会话，不能绕过验收链。
- **核心链路不依赖可选 surface**：adapter 等派工必需能力不能藏在插件 tab 中。

### 4. 上下文和策略纪律

任何进入 agent 上下文的贡献物都必须先有持久事件或 typed ref，能从历史重建。插件、Skill 或 MCP 不得直接向进程注入不可见文本。

将来如出现多个策略参与同一决策，采用可追溯的有序 chain：策略 provider 可以短路并记录决定，观察 provider 只能继续委托。无返回值的广播事件不能承担准入、验证或派工决策。

### 5. 声明式 surface 边界

P12 只允许插件声明数据 schema、宿主组件类型、空 / 错误状态和白名单动作。插件不提供前端代码、任意 HTML 或 DOM hook。挂载点只在能力面；设置 · 插件仍是安装和授权唯一入口。

宿主动作的稳定语义按产品对象表达，例如“归档外部条目”和“创建普通任务”；不得把历史 API 名 `createWithRoom` 固化成新契约。

## 明确不做

- 不引入 Cordis 或等价容器重写当前装配与生命周期。
- 不允许任意同权限脚本被描述为低风险插件。
- 不为尚无第二实现的 P2–P12 批量建立接口。
- 不允许插件贡献新的 Evidence ref 解析规则或直接写核心表。
- 不在 v0.3 开放插件 surface、MCP 注入、远程 marketplace 或签名链。

## 维护规则

当新 Feature 修改表中位置的 provider 数、contract 或开放版本时，同步更新本清单。某个贡献点真正开缝时，需在对应 Feature design 中记录第二实现、统一失败语义和测试证据。

## 后果

扩展路线变成可逐项验证的边界，而不是一次性插件框架工程；代价是清单需要人工维护，且插件体验会晚于核心可信任务闭环。

## 关联

- `0008-capability-seam-convention.md`：建立 seam 的正式判据。
- `0018-capability-library-and-packs.md`：Skills、插件、MCP 与信任模型。
- `../personahub-architecture.md`：当前装配和后续运行时边界。
