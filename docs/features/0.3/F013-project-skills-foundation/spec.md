---
kind: feature
id: F013
version: "0.3"
status: draft
gate_version: 1
related_features: [F009, F010, F012, F014]
topics: [space, project, repository, skill, composition, capability]
doc_kind: spec
created: 2026-08-09
updated: 2026-09-08
---

# F013：Space, Project & Skills Foundation

> Owner: unassigned | Target: v0.3

## 0. 来源与意图

- PRD：第 5.1、5.2、5.6、6.2、7.1、7.5 节。
- 设计基线：V3.44 项目与能力面。
- 决策：ADR 0012、0014、0018。
- 意图：建立最终归属根，并统一项目的文件边界与可复用方法，不再引入独立 Workflow / Squad / AI 成员对象。

## 1. 问题、目标与非目标

现有数据没有 Space，Project、Workspace、Workflow Template 和 AgentConfig 的 UI / 归属又与最终模型冲突。目标是建立持久化 Space 根对象、项目主目录 / 参考仓库和统一 Skill schema；带 steps 的 Skill 即编组。非目标是多人 Space 权限、插件市场、自动推荐、Memory 或非 coding Skill 生态。

### US-000：完成首次 Space 设置（Priority: P1）

首次启动时，用户选择已有 Space 或创建一个 Space；从旧库升级时，历史 Project、Issue 与 Space 级 Skill 自动归入唯一默认 Space。

**独立测试**：清洁库与仅含历史 Project / Issue 的旧库都得到一个可进入的 Space，重复升级不重复创建默认 Space。

1. Given 清洁安装，when 创建首个 Space，then 进入该 Space 且可以创建游离任务。
2. Given v0.2 数据，when 升级，then `issues.space_id` 非空、原 `issues.project_id` 保持且允许为空。

## 2. 用户场景

### US-001：维护项目文件边界（Priority: P1）

用户为项目选择一个可写主目录和多个只读参考仓库，并清楚每台机器的真实路径授权。

**独立测试**：软链越界被拒绝；参考仓库写入不可授权。

1. Given 输入本地路径或仓库地址，when 保存，then 系统自动识别且不要求手填名称。
2. Given 项目已归档，when 查看历史任务，then 文件 refs、执行和证据仍可读取。

### US-002：选择和复用 Skill / 编组（Priority: P1）

用户从一张 Skills 表选择方法；带 steps 的行标为编组，并在派工时贡献能力要求与完成要求。

**独立测试**：Skill 更新产生新版本，历史 Dispatch 仍指向旧版本。

1. Given 两个来源同名，when 扫描，then 两者都不生效直到冲突处理。
2. Given 项目选择默认 Skill，when 创建任务，then 显示引用而不复制一份项目工作流。

## 3. 范围与边界

### 范围内

- Space 创建 / 选择、默认 Space 升级、Space 级 Skill 归属与首次设置。
- 项目信息、一个主代码目录、多个只读参考仓库和文件范围。
- 代码仓单一添加入口、真实路径解析、Git remote / identity 只读探测。
- Skill `id@version`、来源、说明、能力要求、steps、完成要求和下发状态。
- 项目默认 Skill 引用、Skill 详情只读下钻、Dispatch 版本快照。

### 范围外

- Space 成员、角色、共享权限与跨设备同步。
- 独立 Workflow Template / Validation Policy / Squad 表和 AI 成员。
- 插件代码运行、声明式 surface、Skill 自动生成与 marketplace。

### 边界场景

- 主目录最多一个且可读写；参考仓库始终只读。
- 项目文件权限只能收紧机器授权，不能扩大。
- 同名 / 保留 ID / 无来源 / 非法步骤 schema 在生效前拒绝。

## 4. 需求

### 功能需求

- **FR-001**：Space 是 Project、Issue 与 Space 级 Skill 的持久化归属根；Issue 必属一个 Space、可不属 Project。
- **FR-002**：清洁安装创建 Space；旧库升级幂等创建唯一默认 Space并归入历史 Project / Issue / Skill，不改变既有 ID。
- **FR-003**：项目保存一个主目录引用、多个参考仓库引用与文件访问范围。
- **FR-004**：添加代码仓自动识别本地路径 / URL、真实路径、Git remote 与名称。
- **FR-005**：Skill 使用统一版本 schema；`steps` 可选，有 steps 即投影为编组。
- **FR-006**：Skill 的能力要求与步骤完成要求进入 F012 eligibility / Dispatch snapshot。
- **FR-007**：项目只保存默认 Skill ref，不复制 Skill 内容。
- **FR-008**：Skill 详情展示来源、版本、要求、下发状态与只读文件。

### 非功能需求

- **NFR-001**：历史 Dispatch / Artifact / Evidence 不随 Skill、仓库或项目配置变化而漂移。
- **NFR-002**：路径授权基于真实路径并在每次派工前复核。

## 5. 生命周期与不变量

Space 可 active / archived，v0.3 不支持物理删除；项目归档可恢复，删除受引用保护。`issues.space_id` 非空，`issues.project_id` 可空。Skill revision 不可变，active / disabled / conflict 是当前生效状态；禁用不改历史。编组表现只从 Run 现算，不保存评分字段。

## 6. 成功与验收

### 成功标准

- **SC-001**：用户能从项目直接进入真实文件与统一 Skill，不遇到重复配置入口。
- **SC-002**：一次派工可解释采用了哪版 Skill、哪些要求生效及其来源。

### 验收清单

- [ ] **AC-001** (`FR-001`, `FR-002`, `NFR-001`): 清洁首次设置与 v0.2 升级均产生正确 Space 归属；重复升级幂等，Project / Issue 原 ID 和可空 Project 语义守恒。
- [ ] **AC-002** (`FR-003`, `FR-004`, `NFR-002`): 主目录 / 参考仓库、自动识别、真实路径和读写边界正确。
- [ ] **AC-003** (`FR-005`, `FR-007`, `FR-008`): 普通 Skill / 编组共用列表与详情，项目只存引用。
- [ ] **AC-004** (`FR-006`, `NFR-001`): Dispatch 快照固定 Skill 版本和要求，升级 / 禁用不改历史。
- [ ] **AC-005** (`FR-005`, `NFR-001`): 同名冲突与非法来源在激活前被拒绝且状态可见。

## 7. 测试、依赖与决策

### 测试策略

Space / 路径边界与 Skill schema 单测；默认 Space、repo/Skill migration 和历史快照集成测试；首次设置、项目四 tab、Skill 详情和派工要求 Playwright。

### 依赖

依赖 F009 新壳层、F010 revision 思路与 F012 Dispatch / eligibility；F014 负责端到端整合。

### 决策与风险

沿用旧目录路径是为了保持文档链接稳定，Feature 含义以本 spec 为准。旧 Workflow Template 数据迁移为 Skill revision；无法无损映射的字段保留 legacy attachment，不猜测语义。

## 8. 待确认问题

无。
