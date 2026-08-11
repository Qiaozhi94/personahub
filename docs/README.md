---
topics: [docs, index, ownership]
doc_kind: guide
created: 2026-08-09
updated: 2026-08-09
---

# PersonaHub 文档地图

本文件是仓库文档的**唯一入口与所有权索引**：从一个入口最多两次点击即可到达任何
权威文档。它只记录所有权和链接，**不复制正文**。产品、架构、数据模型、Feature 状态
和流程各有且只有一个机器可读拥有者。

## 权威文档所有权矩阵

| 信息 | 唯一拥有者 | 说明 |
|---|---|---|
| 产品目标、范围和路线 | `personahub-prd.md` | 产品判断的真相源 |
| 全局模块、进程与运行时边界 | `personahub-architecture.md` | 整体软件架构 |
| 字段、表和数据关系 | `personahub-system-design.md` | 实现级数据模型，随实现迭代 |
| 跨 Feature 长期决策 | `decisions/` | ADR 决策记录 |
| Feature 行为与状态 | `features/<version>/Fxxx-*/spec.md` | 状态唯一真相源 |
| Feature 实现方案 | `features/<version>/Fxxx-*/design.md` | 技术设计 |
| 开发、验收和检视纪律 | `SOP.md` | 开发流程约定 |
| 当前 active Feature 与强提醒 | `../CLAUDE.md` | 自动加载入口 |
| 非 done Feature 派生索引 | `../BACKLOG.md` | 活跃 feature 索引 |
| 缺陷和过程教训 | `reviews/RETROSPECTIVE.md` | 检视复盘 |
| 使用中发现的 bug 实时记录 | `reviews/dogfooding-bugs.md` | 主表唯一事实源；`npm run bug:log` 统计/校验 |
| 使用中发现的体验类问题实时记录 | `reviews/dogfooding-notes.md` | 主表唯一事实源；不算 bug 的交互/易用性/缺失能力等 |

## 权威文档导航

- **PRD（产品判断）**：→ [`personahub-prd.md`](personahub-prd.md)
- **架构**：→ [`personahub-architecture.md`](personahub-architecture.md)
- **系统设计（数据模型）**：→ [`personahub-system-design.md`](personahub-system-design.md)
- **开发流程 SOP**：→ [`SOP.md`](SOP.md)
- **Feature 规格指南与状态门禁规则**：→ [`features/README.md`](features/README.md)
- **Feature 目录（按版本分层）**：→ [`features/`](features/)
  - v0.1（已收口）→ [`features/0.1/README.md`](features/0.1/README.md)
  - v0.2（已收口）→ [`features/0.2/README.md`](features/0.2/README.md)
  - v0.3（规划审查稿）→ [`features/0.3/README.md`](features/0.3/README.md)
- **版本发布与收口摘要**：→ [`features/releases/`](features/releases/)
  - [0.1 收口于 2026-08-09](features/releases/0.1.md)
  - [0.2 收口于 2026-08-09](features/releases/0.2.md)
- **ADR（决策记录）**：→ [`decisions/`](decisions/)
- **检视复盘**：→ [`reviews/RETROSPECTIVE.md`](reviews/RETROSPECTIVE.md)
- **使用问题记录（dogfooding bug log，实时追踪）**：→ [`reviews/dogfooding-bugs.md`](reviews/dogfooding-bugs.md)
- **使用体验记录（dogfooding notes，实时追踪）**：→ [`reviews/dogfooding-notes.md`](reviews/dogfooding-notes.md)

## 所有权规则（机器可校验）

- `status` 只能出现在 Feature `spec.md` frontmatter；`design.md` / `tasks.md`
  不得声明独立 Status。
- `BACKLOG.md` 与所有非 done Feature 做双向集合比较（ID/version/status/链接一致）。
- 本 README 中的权威入口必须存在且唯一。
- `releases/` 与 `RETROSPECTIVE.md` 仅作历史记录与复盘，不得充当当前产品、状态或
  实现的权威入口（当前权威入口见上方所有权矩阵）。

以上规则由 `npm run verify`（含 `check:doc-links` / `check:doc-ownership`）强制执行。
