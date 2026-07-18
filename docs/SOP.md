---
topics: [sop, workflow]
doc_kind: note
created: 2026-07-11
updated: 2026-07-18
---

# 开发流程（个人版）

## 修订记录

| 日期 | 来源提交 | 修订目的 | 修订内容 |
| --- | --- | --- | --- |
| 2026-07-18 | `4d13cab` | 防止后续版本把多个语义不同的 Workflow 一次拆成浅层模板，确保平台抽象由真实任务逐步验证 | 增加 v0.4+ 非 coding Workflow 的拆分规则：按任务范式一次选择一个垂直切片，完成真实端到端验证后再进入下一类；候选 Issue Type 不等于已支持 Workflow |
| 2026-07-13 | `6c71e13` | 将 F001 实施中验证有效的逐任务执行纪律固化到通用开发流程 | 要求严格按 `tasks.md` 顺序实施、完成一项立即勾选、仅并行 `[P]` 任务；若任务顺序过时，先修订任务文档再继续，并将自检、review、合并顺延为后续步骤 |
| 2026-07-12 | `4af80c1` | 建立 PersonaHub 个人开发流程基线 | 创建分支/worktree、实现、自检、可选 AI review、合并清理的基本流程；定义 PRD 按需拆 Feature 的节奏、参考 clowder-ai / multica 验证设计假设的方法及初始代码质量约定 |

## Workflow

进入 Step 1 前的强制前提：对应 feature 的 `design.md` 的"待确认设计问题"章节必须已清空（所有条目已关闭并给出结论，或已转为 `tasks.md` 里的具体验证任务）。带着未解决的设计问题开工，等于把设计判断推迟到实现中间做，详见 `docs/features/README.md`"Review Checklist"。

| Step | What |
|------|------|
| 1 | 建分支/worktree 做隔离开发 |
| 2 | 严格按 `tasks.md` 里的顺序逐项实现，不跳过、不并成大块一次性写完；每完成一项立即在 `tasks.md` 里勾掉，不要攒到最后统一补标。标记为 `[P]` 的任务可以并行，其余按文档顺序来。如果实现中发现某个任务顺序不对或已经过时，先改 `tasks.md` 再继续，不要绕开文档直接改代码 |
| 3 | 自检：对照 spec / acceptance criteria 过一遍，跑测试 |
| 4 | （可选）让 AI agent 扮演 reviewer 角色审一遍 diff，输出 findings |
| 5 | 合并 + 清理分支 |

## PRD 版本拆解为 Feature 的节奏

- v0.1–v0.3 是 PRD（第 15 节）划定的近期承诺范围。v0.1 已经拆成 v0.1.0～v0.1.3 四个子版本，各对应一个 Feature spec（F001、F002...）；v0.2、v0.3 大概率也需要同样拆解——整版本 bundle 了好几个明显不同的能力（例如 v0.2 的 Coordinator Agent、Topology 推荐、Handoff Packet、Workflow Template 管理 UI），直接整版本写一个 spec 会违反"一个 feature 一个主要 intent"的原则。
- 拆解按需进行：只在即将开始某个版本的开发前才把它拆成具体 Feature，不要提前把后面几个版本都拆好。前一个版本的实现和实际使用反馈，大概率会影响下一个版本该怎么拆、拆成什么样。
- v0.4 及以后，PRD 第 15 节自己标注为"方向性设想"，不是当前排期承诺。在 v0.1–v0.3 跑完、这部分方向被重新评估或拍板之前，不需要拆成 Feature spec。
- v0.4 开始扩展非 coding Workflow 时，按“一种新任务范式一个垂直切片”拆 Feature：先选择一个场景完成输入、执行、artifact、evidence、validation、权限/escalation 和 Done policy 的真实端到端验证，再根据暴露出的抽象问题决定下一类。不得把 Windows 排障、Paper/Research、Writing/Book 同时拆成一批只更换角色名和 prompt 的模板 Feature。
- 数据模型中存在某个 `Issue Type`、候选 template 或规划文案，不代表产品已经支持该 Workflow。只有通过真实端到端验收的内置 Workflow 才能在 UI、README 和发布说明中标记为 supported；其余明确标记 experimental / planned。

## 参考开源项目验证设计假设的节奏

PersonaHub 的产品构想是 clowder-ai（本机 `D:\Projects\clowder-ai`）和 multica（本机 `D:\Projects\multica`）的结合体，这两个项目在设计/实现阶段的参考价值分两个层次，用法不一样：

- **产品/叙事层面**：早期基于 README 的竞品分析报告（`docs/research/clowder-ai-analysis-report.md`、`docs/research/multica-analysis-report.md`）已经完成，并且已经实际塑造了 PRD 的核心概念（Project/Issue/Thread、Workflow Template、Evidence/Memory 等）。这部分不需要重做。
- **架构/设计层面**：写 feature 的 `design.md`，或者 review 发现"待确认设计问题"时，先问一句——**clowder 或 multica 是不是已经解决过一模一样的问题**。如果是，先去读对应功能的真实代码，而不是自己从零摸索或者干等本地 probe/实验。README 级别的介绍通常不够深（连协议细节、具体机制都不会写），必须直接看代码才能拿到可验证、可落地的答案。

两个项目的参考侧重点不同，按需去挖，不要混着用：

- **multica**：偏工程骨架——daemon、runtime、进程管理、crash recovery、CLI adapter 的具体协议实现。适合回答"这个技术机制具体怎么实现"类问题。
- **clowder-ai**：偏平台层概念——身份、Hard Rails + Soft Power、SOP Guardian、跨模型审阅。适合回答"这类安全策略/协作规则该怎么组织"类问题。

验证时如实标注证据强度：单一项目的实现是"二手证据、待本地验证"；如果两个独立项目都采用相同方案，可以适当提高置信度，但仍需在本地环境验证后才能视为确认结论。

## Code Quality

- Lint/format 工具：TBD（技术栈确定后补充命令）
- File limits: 200 行建议拆分 / 350 行硬上限
