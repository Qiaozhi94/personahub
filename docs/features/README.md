---
topics: [features, spec-driven-development, docs]
doc_kind: guide
created: 2026-07-12
updated: 2026-07-12
---

# Feature Specs Guide

本目录用于记录 PersonaHub 的 feature-level SDD artifacts。后续所有需求都按“一 feature 一文件夹”的结构输出，不再使用 `Fxxx-feature-name.md` 单文件格式。

## Directory Shape

```text
docs/features/
  Fxxx-feature-name/
    spec.md
    design.md
    tasks.md
```

创建新 feature 时，从 `docs/features/TEMPLATE/` 复制一份并重命名：

```text
docs/features/TEMPLATE/
  spec.md
  design.md
  tasks.md
```

命名规则：

- Feature ID 使用 `F001`、`F002`、`F003` 递增。
- 文件夹名使用 `Fxxx-kebab-case-feature-name`。
- `BACKLOG.md` 中的链接指向该 feature 的 `spec.md`。

## Artifact Responsibilities

### `spec.md`

`spec.md` 是 feature 的行为契约，回答“要做什么”和“怎样算完成”。

应该包含：

- 问题和目标。
- scope / non-goals。
- 用户场景和独立测试。
- 可观察、可测试的 requirements。
- Given / When / Then scenarios。
- edge cases。
- acceptance checklist。
- test plan。
- risks / open questions。

不应该包含：

- 详细表结构。
- service / repository / component 拆分。
- 具体实现步骤。
- 具体库或框架选择，除非它本身已经是上游决策或用户可见约束。

原则：spec 写行为，不写实现。

### `design.md`

`design.md` 是该 feature 的技术设计，回答“怎么实现”。

应该包含：

- API / contract 设计。
- schema migration / 数据模型变更。
- backend service / repository 边界。
- frontend state / UI surface 设计。
- runtime / workflow / lock / recovery 设计。
- event / trace payload 设计。
- failure handling。
- test strategy。
- 重要技术取舍。

`design.md` 可以引用 `docs/personahub-architecture.md` 和 `docs/personahub-system-design.md`，但不要把全局架构判断复制进来。全局稳定设计回写到对应全局文档；单 feature 的实现细节留在本文件。

**硬性约束：`design.md` 的"待确认设计问题"章节必须清空（或所有条目都标注"已关闭"并给出结论）才能进入代码开发阶段。** 带着未解决的设计问题开始写代码，等于把设计判断推迟到实现中间去做，容易导致返工、状态不一致或安全边界被绕过（参考 F002 escalation 设计中"排队 Run 未检查 Issue 是否 Blocked"这类因为设计判断不完整而产生的漏洞）。如果某个问题确实要等实现阶段才能验证（例如"Windows 环境下子进程是否继承凭据缓存"），应该：
- 在 `design.md` 里把它写成一个**已经拍板的假设/决定**，而不是留白的"待确认"；
- 把验证动作作为具体任务写进 `tasks.md`（例如"手动验证 XXX，如果不成立则切换到备选方案 YYY"），由任务而非悬而未决的设计问题来跟踪。

### `tasks.md`

`tasks.md` 是实施 checklist，回答“按什么顺序做”。

应该包含：

- 可执行的小任务。
- 每个任务尽量引用 `spec.md` 中的 requirement / acceptance ID。
- 测试任务。
- 可以并行的任务标记 `[P]`。
- 阶段性 checkpoint。

任务要足够小，便于 agent 或人类逐项完成和勾选。避免一个任务写成“实现整个 feature”。

## Writing Rules

- 每个 feature 应有一个清晰 intent，能用一句话说清。
- `spec.md` 中的每个 requirement 应描述一个可观察行为。
- 每个重要 requirement 至少有一个 scenario。
- 重要的错误、边界和恢复场景要写成 scenario 或 acceptance check。
- 如果实现过程中发现 spec 与现实不一致，先更新 artifact，再继续实现。
- 高风险 feature 可以写 full spec；低风险 feature 可以保留 lite spec，但必须至少有 scope、requirements、acceptance checklist。
- 不确定项写入 Open Questions，并尽量给出推荐倾向。

## Review Checklist

在实现前检查：

- [ ] 这个 feature 是否只有一个主要 intent？
- [ ] `spec.md` 是否定义了可测试的完成标准？
- [ ] 是否没有把详细实现混进 requirements？
- [ ] 关键 requirement 是否有 Given / When / Then scenario？
- [ ] `design.md` 是否覆盖数据、API、UI、runtime、failure handling 中相关的部分？
- [ ] `design.md` 的"待确认设计问题"章节是否已清空（所有条目已关闭并给出结论，或已转为 `tasks.md` 里的具体验证任务）？**未清空不得开始编码。**
- [ ] `tasks.md` 是否能按顺序执行，并能追踪回 spec？
- [ ] `BACKLOG.md` 是否链接到该 feature 的 `spec.md`？

## Relationship To Other Docs

- `docs/personahub-prd.md`：产品真相源。Feature spec 必须服从 PRD。
- `docs/personahub-architecture.md`：全局架构设计。Feature design 不应绕过其中的 runtime / storage / adapter / safety 边界。
- `docs/personahub-system-design.md`：全局数据模型草案。Feature design 中的新字段或关系，稳定后应回写到这里。
- `BACKLOG.md`：active feature 索引，只记录状态和入口链接。

## Migration Note

旧格式：

```text
docs/features/F001-workspace-issue-foundation.md
```

新格式：

```text
docs/features/F001-workspace-issue-foundation/spec.md
docs/features/F001-workspace-issue-foundation/design.md
docs/features/F001-workspace-issue-foundation/tasks.md
```
