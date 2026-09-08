---
topics: [space, project, repository, skill, composition, capability]
doc_kind: design
created: 2026-08-09
updated: 2026-09-08
---

# F013：Space, Project & Skills Foundation - 设计

## 0. 输入与约束

输入为 `spec.md`、ADR 0012/0014/0018、V3.44 项目 / Skills 契约和 F009 项目 / 管理入口兼容清单。不得为兼容旧 UI 保留第二套可编辑 Workflow。

## 1. 技术概要与影响面

新增 Space、repository reference / machine path authorization 与 Skill revision 领域服务；项目只持 refs。提供旧 Workspace / Workflow Template 的兼容读取与一次性迁移。

## 2. 架构与模块边界

SpaceService 是 Space 创建、选择与归档的唯一写入口；RepositoryRegistry 管真实仓库事实；ProjectService 管项目引用与进一步收紧的范围；IssueService 创建时要求 `space_id`、允许 `project_id` 为空；SkillRegistry 是版本和冲突的唯一激活入口；F012 只读 effective requirements。

## 3. 数据模型与 Migration

新增 `spaces`、`space_skills`，并为 Project / Issue 增加 Space 外键；`issues.space_id` 非空、`issues.project_id` 可空。仓库、仓库机器路径、项目仓库引用、Skill、Skill revision、项目默认 Skill refs 分表，`steps_json` 属 revision。升级器先以稳定幂等键创建唯一默认 Space，再回填历史 Project / Issue / Space 级 Skill；旧 WorkflowTemplate 转为来源 `legacy-workflow` 的 Skill revision，保留旧 ID alias。

## 4. 接口、Contract 与 Event

API 覆盖 Space create/list/select/archive、仓库识别 / 授权、项目 refs、Skill list/detail/activate/disable 与 effective requirements。事件记录 Space 创建 / 选择、路径授权、项目引用、Skill revision 激活 / 冲突和默认引用变化。

## 5. Runtime、Workflow 与并发

派工前同时校验机器路径授权、项目范围和任务范围，取交集。Skill requirements 与步骤 requirements 取并集，只会加严。版本更新不影响已创建 Dispatch。

## 6. UI 与可观测性

项目四 tab：文件、项目记忆占位说明、Skills、设置；v0.3 不实现完整 Memory 数据时不展示空的项目记忆 tab。能力面提供 Skills 列表与整页详情；MCP tab 延后到真实注入 contract 可用时进入生产。

## 7. 失败、恢复、安全与兼容

真实路径解析失败不授权；参考仓库写权限硬拒绝；冲突 Skill 不生效。迁移保留别名与 raw legacy payload，可回放旧任务但不可从旧 UI 再编辑。

## 8. 测试策略与验收映射

AC-001 默认 Space migration / 首次设置 / 游离任务；AC-002 路径 / git / authorization；AC-003 UI 与统一 schema；AC-004 dispatch snapshot；AC-005 conflict / migration / restart。

## 9. 已确认决策与残余风险

F013 是 Space schema、默认数据迁移与首次设置的唯一 owner；Skill / 编组统一，项目只存引用。残余风险是旧 Workflow 自由 JSON 无法全部映射，采用显式 legacy attachment 并由 F014 统计未迁移数量。

## 10. 待确认设计问题

无。
