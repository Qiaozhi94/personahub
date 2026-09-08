---
topics: [journey, migration, integration, release]
doc_kind: design
created: 2026-09-08
updated: 2026-09-08
---

# F014：Trusted Task Journey Closure - 设计

## 0. 输入与约束

输入为 `spec.md`、J1–J5、F009–F013 contracts、V3.44 设计和现有 release verification。不得拥有新的领域表或直接写入其他模块表。

## 1. 技术概要与影响面

核对并最终切换 F009 production route composition，增加跨 schema legacy redirect / projection、migration report、跨 Feature fixture builder 和 release journey suite；更新用户文档与收口脚本。

## 2. 架构与模块边界

Journey layer 仅编排公开 API。Migration adapter 读取旧结构并调用各 owner 的 import contract；report 是结果，不是第二真相源。E2E fixture 经 API 创建，不直接插表，migration fixture 除外。

## 3. 数据模型与 Migration

不新增业务表。若需要 migration journal，只记录 migration ID、source version、result 与 error，不复制实体内容。每个旧 schema fixture 保存在测试资产中。

## 4. 接口、Contract 与 Event

提供只读 migration report 与 legacy route resolver。发布证据索引引用现有 Run / Artifact / Evidence / test report，不复制正文。路由映射为显式表并有全覆盖测试。

## 5. Runtime、Workflow 与并发

真实 CLI journey 使用隔离临时代码目录与测试数据库。kill/restart 在明确 barrier 注入，断言已完成节点不重跑、running Attempt 中断、恢复创建新 Attempt。

## 6. UI 与可观测性

生产导航沿用 F009 壳层且只装配已交付面。升级后首次进入展示一次性迁移摘要；legacy 对象在原位置给明确标识和可用动作。全旅程可用键盘完成。

## 7. 失败、恢复、安全与兼容

Migration 可重复运行；失败停止在实体边界并给报告，不删除旧数据。真实 CLI 测试禁止使用用户现有项目目录。日志与导出剥离密钥和绝对路径。

## 8. 测试策略与验收映射

AC-001 production E2E；AC-002 schema matrix / deep links；AC-003 real CLI / restart / evidence index；AC-004 accessibility / destructive-action / release gates。

## 9. 已确认决策与残余风险

F014 只做集成 owner。残余风险为真实 CLI 环境波动；区分产品失败、环境未满足和已知 adapter 能力，不把 flaky 重试当通过。

## 10. 待确认设计问题

无。
