---
topics: [artifact, revision, provenance, typed-ref]
doc_kind: design
created: 2026-08-09
updated: 2026-09-08
---

# F010：Artifact & Provenance Foundation - 设计

## 0. 输入与约束

输入为本目录 `spec.md`、ADR 0010、F003/F004/F006 契约和 F009 前端壳层边界。先读取当前 migration 头，不预占版本号。

## 1. 技术概要与影响面

新增 Artifact repository/service、revision 存储、统一 typed-ref resolver 与 consumption link；扩展 API、Trace 和最小读取投影。既有 Evidence ref 保持兼容。

## 2. 架构与模块边界

ArtifactService 是创建 / 修订唯一写入口；resolver 只读；派工上下文组装器记录消费；EvidenceService 通过公共 ref 模块解析，不直接读 Artifact 表。

## 3. 数据模型与 Migration

新增 `artifacts`、`artifact_revisions`、`artifact_consumptions`。实体保存 current revision 指针；revision 保存 storage kind、摘要、来源 Attempt，并将工作区 source locator 与 content-addressed archive locator 分开保存，resolver 永不把可变 source 当历史正文；消费表保存 dispatch/run 与确定 revision。Migration 从实施时真实 schema 顺延并包含回滚前兼容检查。

## 4. 接口、Contract 与 Event

API 提供 create、revise、list、get revision、provenance。ref 规范为 `artifact:<artifact_id>@<revision>`；不含 revision 的 ref 只允许交互读取当前值，禁止进入派工快照。事件覆盖 created / revised / consumed / resolve_rejected。

## 5. Runtime、Workflow 与并发

inline 内容在单事务发布。文件内容使用以下协议：`临时 blob → 校验并 fsync → 原子改名到 content-addressed archive → DB 事务插入 revision manifest 并 CAS 更新 current pointer / outbox`。DB commit 是 revision 对 resolver 可见的唯一发布点；因此 rename 后 crash 或 DB / CAS 失败只留下不可见的 archive orphan，绝不留下已提交但缺文件的 revision。archive path 由内容 hash 派生且只读，source locator 仅用于解释来源，resolver 只读取 archive locator。事件广播只消费 commit 后 outbox。

## 6. UI 与可观测性

本 Feature 只向 F009 新壳层提供资源 / 验收面所需读取组件和状态，不建立或恢复旧 Inspector。显示类型、revision、来源、消费者、missing / invalid / hash mismatch；正文安全渲染。

## 7. 失败、恢复、安全与兼容

真实路径越界拒绝；未知 storage kind 拒绝；retired 仍可读历史。重启先清理无效临时文件；archive orphan 由带租约的 sweep 处理，重启清理只删除超过安全宽限期且未被任何 manifest 引用的 orphan，避免与在途发布竞争。并发 CAS 败者不删除可能被相同 hash revision 引用的 archive。旧 Evidence ref 继续解析。

## 8. 测试策略与验收映射

AC-001 对应 repository/migration/restart，并在临时写、fsync、rename、DB insert、CAS、commit 各点注入 crash，断言 resolver 只能返回完整 published revision 或 not-found；AC-002 对应 resolver/source/archive path/hash；AC-003 对应 integration/API/outbox replay。并发用不同内容与相同内容两组 CAS fixture 验证败者 orphan 不影响赢家。

## 9. 已确认决策与残余风险

已确认 immutable revision、确定 ref、受控本地文件。残余风险是大文件存储上限，v0.3 以配置上限阻断，不引入 Blob store。

## 10. 待确认设计问题

无。
