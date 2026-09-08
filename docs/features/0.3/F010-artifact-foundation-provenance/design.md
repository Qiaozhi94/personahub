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

新增 `artifacts`、`artifact_revisions`、`artifact_consumptions`。实体保存 current revision 指针，revision 保存 storage kind、内容 / 相对路径、摘要与来源 Attempt；消费表保存 dispatch/run 与确定 revision。Migration 从实施时真实 schema 顺延并包含回滚前兼容检查。

## 4. 接口、Contract 与 Event

API 提供 create、revise、list、get revision、provenance。ref 规范为 `artifact:<artifact_id>@<revision>`；不含 revision 的 ref 只允许交互读取当前值，禁止进入派工快照。事件覆盖 created / revised / consumed / resolve_rejected。

## 5. Runtime、Workflow 与并发

inline 内容在单事务发布。文件内容先写临时文件并校验，再提交 DB manifest，最后原子改名；失败清理临时文件。修订以 expected current revision 做 CAS。任何副作用和事件广播发生在 commit 后。

## 6. UI 与可观测性

本 Feature 只向 F009 新壳层提供资源 / 验收面所需读取组件和状态，不建立或恢复旧 Inspector。显示类型、revision、来源、消费者、missing / invalid / hash mismatch；正文安全渲染。

## 7. 失败、恢复、安全与兼容

真实路径越界拒绝；未知 storage kind 拒绝；retired 仍可读历史；重启清理未被 manifest 引用的临时文件。旧 Evidence ref 继续解析。

## 8. 测试策略与验收映射

AC-001 对应 repository/migration/restart；AC-002 对应 resolver/path/hash；AC-003 对应 integration/API/event replay。加入故障注入验证 DB / 文件两个完成顺序。

## 9. 已确认决策与残余风险

已确认 immutable revision、确定 ref、受控本地文件。残余风险是大文件存储上限，v0.3 以配置上限阻断，不引入 Blob store。

## 10. 待确认设计问题

无。
