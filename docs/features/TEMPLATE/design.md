---
kind: feature
id: Fxxx
version: "0.x"
related_features: []
topics: []
doc_kind: design
created: YYYY-MM-DD
updated: YYYY-MM-DD
---

# Fxxx：功能名称 - 设计

> Owner: TBD | Spec: `spec.md` | Tasks: `tasks.md`

## 0. 输入与约束

- **行为契约**：`spec.md`
- **PRD / Architecture / System Design**：...
- **ADR / 上游 Contract**：...
- **实现约束**：...

## 1. 技术概要与影响面

用一段话概述实现方案，并列出受影响区域：

- 前端：...
- 后端 / API：...
- 存储 / Migration：...
- Runtime / Agent Adapter：...
- Event / Evidence：...
- 文档 / 配置：...

## 2. 架构与模块边界

说明模块职责、依赖方向、事务边界和唯一真相源。必要时使用简短流程图。

## 3. 数据模型与 Migration

描述 schema、索引、约束、migration 顺序、默认值、历史数据和回滚/前向兼容策略。

不适用时写：`不适用：<理由>`。

## 4. 接口、Contract 与 Event

### API / CLI / Adapter Contract

描述请求、响应、错误码、版本与兼容性。

### Event / Trace Contract

描述事件类型、payload、顺序、幂等键和查询方式。

不适用的子项写：`不适用：<理由>`。

## 5. Runtime、Workflow 与并发

描述状态流转、队列、锁、CAS、事务、重试、取消、恢复和不可回滚副作用边界。

不适用时写：`不适用：<理由>`。

## 6. UI 与可观测性

描述页面/交互状态、loading/empty/error、日志、诊断、指标和运维可见性。

不适用时写：`不适用：<理由>`。

## 7. 失败、恢复、安全与兼容

- 校验与失败映射：...
- 重启与恢复：...
- 权限 / escalation / 凭据边界：...
- Windows / POSIX / 版本兼容：...

不适用的子项写：`不适用：<理由>`。

## 8. 测试策略与验收映射

| 验收项 | 测试层级 | 计划文件 / 场景 | 关键断言 |
|---|---|---|---|
| `AC-001` | unit / integration / UI / E2E / manual | ... | ... |

明确批量、并发、失败、恢复与真实环境场景；不要只验证内部派生函数。

## 9. 已确认决策与残余风险

| 决策 / 风险 | 结论或缓解 | 理由 | 替代方案 / 后续 |
|---|---|---|---|
| ... | ... | ... | ... |

## 10. 待确认设计问题

只允许以下两种形式：

```markdown
- [ ] DQ-001: <阻塞性设计问题>
- [x] DQ-002: <已关闭问题> — 决策：<结论>
```

没有开放或历史问题时写：

```text
无
```
