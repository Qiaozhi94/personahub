---
topics: [sop, workflow]
doc_kind: note
created: 2026-07-11
---

# 开发流程（个人版）

## Workflow

进入 Step 1 前的强制前提：对应 feature 的 `design.md` 的"待确认设计问题"章节必须已清空（所有条目已关闭并给出结论，或已转为 `tasks.md` 里的具体验证任务）。带着未解决的设计问题开工，等于把设计判断推迟到实现中间做，详见 `docs/features/README.md`"Review Checklist"。

| Step | What |
|------|------|
| 1 | 建分支/worktree 做隔离开发 |
| 2 | 自检：对照 spec / acceptance criteria 过一遍，跑测试 |
| 3 | （可选）让 AI agent 扮演 reviewer 角色审一遍 diff，输出 findings |
| 4 | 合并 + 清理分支 |

## PRD 版本拆解为 Feature 的节奏

- v0.1–v0.3 是 PRD（第 15 节）划定的近期承诺范围。v0.1 已经拆成 v0.1.0～v0.1.3 四个子版本，各对应一个 Feature spec（F001、F002...）；v0.2、v0.3 大概率也需要同样拆解——整版本 bundle 了好几个明显不同的能力（例如 v0.2 的 Coordinator Agent、Topology 推荐、Handoff Packet、Workflow Template 管理 UI），直接整版本写一个 spec 会违反"一个 feature 一个主要 intent"的原则。
- 拆解按需进行：只在即将开始某个版本的开发前才把它拆成具体 Feature，不要提前把后面几个版本都拆好。前一个版本的实现和实际使用反馈，大概率会影响下一个版本该怎么拆、拆成什么样。
- v0.4 及以后，PRD 第 15 节自己标注为"方向性设想"，不是当前排期承诺。在 v0.1–v0.3 跑完、这部分方向被重新评估或拍板之前，不需要拆成 Feature spec。

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
