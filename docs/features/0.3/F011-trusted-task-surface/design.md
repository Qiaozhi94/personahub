---
topics: [task-surface, projection, claims, evidence]
doc_kind: design
created: 2026-08-09
updated: 2026-09-08
---

# F011：Trusted Task Surface - 设计

## 0. 输入与约束

输入为 `spec.md`、F009 壳层 / 兼容投影、F010 契约、ADR 0010 和 V3.44 browser checks。前端不得拥有 canonical 执行状态。

## 1. 技术概要与影响面

在 F009 新壳层内增加 TaskProjection 查询服务与四视图 React 容器，复用现有 Issue、ThreadEvent、RunTrace、FileChange、Evidence 与 Artifact 数据，并删除被接管的任务兼容投影。

## 2. 架构与模块边界

Projection 层只读聚合；AcceptanceService 是完成要求、主张链、风险接受与完成摘要的唯一写入口，EvidenceService 只提供证据事实，IssueService 只消费 `acceptance.completed` 推进 done，Dispatch / Run 服务不写验收状态。前端一个 task route 持有当前视图、草稿和副栏状态，视图组件消费同一 projection。

## 3. 数据模型与 Migration

新增 completion requirement baseline、claim、argument、claim-evidence link、risk acceptance 与 completion summary 规范化表；完成要求和摘要均不可原地覆盖。UI 筛选与展开状态不持久化为领域事实。具体 migration 顺延当前版本。

## 4. 接口、Contract 与 Event

`GET task projection` 返回 header、attention count、overview、conversation refs、claims、resources、trace summary 与 version cursor。验收命令 API 覆盖 freeze requirements、upsert claim chain、accept residual risk 与 complete；统一使用幂等键和 expected version。完成事务写入不可变摘要与 outbox `acceptance.completed`，IssueService 幂等消费后推进 done；事件 replay 只推进 cursor，不重算为新事件。

## 5. Runtime、Workflow 与并发

不改运行调度。投影读取必须容忍 Run 与 Artifact 在事务边界间短暂不同步，以明确 pending 状态表达，不提前推断完成。完成摘要失败不得推进 Issue done；outbox 重放只允许同一 acceptance version 完成一次。

## 6. UI 与可观测性

四 tab + 四副栏；输入框由 route shell 持有。验收文件全文替换主栏并用返回条恢复；资源文件就地预览。异常条在首屏并显示影响。

## 7. 失败、恢复、安全与兼容

旧记录缺 claim 数据时显示 legacy evidence summary，不伪造论证。未知状态显示诊断入口。Markdown 禁止原始 HTML；文件读取继续走授权边界。

## 8. 测试策略与验收映射

AC-001 使用 spec 的 11 行命名矩阵生成 fixture；每行分别断言首屏优先级、唯一主操作、动作后的恢复结果和必须保留事实，禁止以状态数量断言代替逐项语义。claim 独立性和 missing ref 覆盖 AC-002；资源 / 轨迹 / 草稿覆盖 AC-003；axe、键盘和 SSE replay 覆盖 AC-004；验收写链故障注入、幂等与 outbox replay 覆盖 AC-005。

## 9. 已确认决策与残余风险

取消 Inspector、Dock、独立轨迹 tab 和底部执行面板。残余风险是历史任务 projection 不完整，以显式 legacy 状态处理并由 F014 迁移验收。

## 10. 待确认设计问题

无。
