---
topics: [decision, architecture, agent, session, context, resume, evidence, cost]
doc_kind: decision
status: accepted
created: 2026-08-27
updated: 2026-09-08
---

# 0009: Agent Session 生命周期——同组合续跑，跨上下文范围冷启动

## 背景

Codex、Claude Code 与 OpenCode 都可能拥有自己的 session / resume 机制，但 PersonaHub 必须自己保存用户目标、会话、派工、Artifact 和 Evidence。原生 session 可以减少重复上下文与延迟，不能成为产品记录的唯一真相，也不能跨过验证围栏。

V3.44 已取消 AI 成员。会话是用户组织讨论与派工的 Room / Thread；执行身份是 adapter + 接入方式 + 模型 + 思考深度；派工意图由 Dispatch 承载。

## 决策

### 1. PersonaHub 记录是第一层，原生 session 只是优化

即使 adapter 不支持 resume，用户也必须能从 PersonaHub 的事件、refs 和 Handoff 重建下一次执行上下文。任何只存在 CLI 私有 session、无法导出或回放的内容都不能成为后续执行或验收的唯一依据。

adapter 支持 resume 时可以复用上游 session；不支持、捕获失败或恢复被拒绝时冷启动。降级必须在轨迹中明确显示，不能让用户误以为上文仍在。

### 2. Resume key

```text
(执行组合, Issue, Room, 上下文范围)
```

四项完全相同且上一 session 可恢复时才允许 resume。更换 adapter、接入方式、模型、深度、任务、会话或上下文范围中的任意一项都必须冷启动。

运行机器进入执行快照。多机落地后，即使其他维度相同，也不得跨机器假定原生 session 可用；是否能迁移需要 provider 的明确能力与单独决策。

### 3. 上下文范围是派工选择，不是角色或会话属性

| 范围 | 包含 | 典型用途 |
|---|---|---|
| 全部 | 目标、成果、证据、变化与本会话过程 | 同一工作连续执行、过程复盘 |
| 只给结果 | 目标、成果、证据与变化，不含实现过程自述 | 独立验证 |
| 只给目标 | 目标与事前完成要求，不含实现产物 | 先固定用例 / 验收设计 |

默认值由 Skill / 步骤目的建议并固定在 Dispatch 中，用户可更改。验证改为“全部”时必须把独立性降级为“有证据待验证”，并记录原因。

### 4. 强制冷启动条件

除 resume key 不同外，下列情况不得复用原生 session：

- 用户明确选择重新开始；
- 上下文溢出、session 损坏或上游拒绝恢复；
- 上一次执行因中毒 / 不可信输入而终止；
- 进入要求独立性的验证或事前用例设计；
- adapter 原生记忆无法关闭，无法证明范围边界。

冷启动不表示丢失 PersonaHub 历史；ContextAssembler 仍按当前范围重新组装有来源的输入。

### 5. 持久事实

每次 Dispatch / Attempt 至少记录：

- context scope 与每项 included / filtered / reason；
- session start mode：cold / resumed；
- provider session ID（如有，作为敏感运行元数据处理）；
- resume 来源 Attempt；
- 执行组合、运行机器、Skill revisions 与 Handoff refs；
- resume 失败或强制冷启动的理由。

历史记录不能依赖当前 adapter 配置回查。session ID 不进入普通导出、插件或 Memory；诊断导出需遮罩。

### 6. 能力与失败语义

`supportsSessionResume` 由 adapter 能力报告，不由 consumer 判断 provider 名。能力缺失时组合仍可用于普通执行，但所有派工冷启动；若该能力缺失会破坏某一步硬要求，eligibility 必须不可选并说明原因。

恢复失败只影响本次启动方式，不得改写上一次 Attempt。新执行建立新的 Attempt，轨迹记录“请求续跑但已冷启动”。

## 不做什么

- 不做常驻在线“成员”或以进程存活表示会话状态。
- 不同步三个 CLI 的私有 session 文件作为产品数据库。
- 不让 Room 边界自动决定上下文范围。
- 不用 `implement / verify` 两档 `context_lane` 替代三档显式范围。
- 不承诺 resume 一定更省钱；只保证它是否发生可观察、可计量。

## 实现门槛

F012 实现前对三个 adapter 分别 probe：session ID 来源、resume 参数、失效条件、原生记忆隔离和取消行为。无法证明的能力按缺失处理，不猜测支持。

## 后果

可信上下文不依赖某个 CLI 私有格式，验证围栏也不能被 resume 静默穿透；代价是每个 adapter 都需要独立 probe 与协议适配，部分组合会永久冷启动。

## 关联

- `0011-disable-native-agent-memory.md`：关闭绕过上下文范围的原生记忆。
- `0012-object-model-simplification.md`：执行组合、会话与 Dispatch。
- `../features/0.3/F012-session-dispatch-intervention/spec.md`：实现 owner。
