---
topics: [sop, workflow]
doc_kind: note
created: 2026-07-11
updated: 2026-08-09
---

# 开发流程（个人版）

## 修订记录

| 日期 | 来源提交 | 修订目的 | 修订内容 |
| --- | --- | --- | --- |
| 2026-08-09 | （本次修订） | F008 检视中出现"执行修复的一方复核完自己就直接删掉 `docs/reviews/CURRENT-doc.md`"的情况，违反 `review-convergence` skill 里"执行者+审查者"双人视角制衡的设计，且该文件在 `.gitignore` 里、删了就永久丢失细节 | 新增"检视文档生命周期纪律"：`CURRENT-doc.md`/`CURRENT-code.md` 只能由检视人复核完成后删除，执行修复的一方不得自行删除；同步修订 `review-convergence` skill 与 `docs/reviews/RETROSPECTIVE.md` 头部说明 |
| 2026-07-29 | `docs/decisions/0006-executable-work-graph.md` | 五轮检视中，第一次给出的"用 `git worktree`/目录拷贝隔离只读 Node"缓解方案本身被证明不成立（`cwd` 不是文件系统权限边界，`git worktree` 还与主仓库共享 `.git` 元数据），暴露出"看起来更安全的方案"和"真正的结构性保证"没有被区分对待的问题，固化为通用纪律 | 新增"结构性隔离与安全边界声明纪律" |
| 2026-07-19 | （本次修订） | 修复自检环节把需要真实环境的测试自动延后/跳过、导致真实端到端始终未验证的问题 | 增加自检纪律：本机即真实环境，所有真实环境测试必须直接在本机执行，不得默认标记为“待用户在真实环境验证/manual verification pending”而跳过；只有客观不可执行（缺凭证、缺二进制、需外部账号等）时才允许延后，且必须在自检结论中显式列出原因与缺失项 |
| 2026-07-18 | `4d13cab` | 防止后续版本把多个语义不同的 Workflow 一次拆成浅层模板，确保平台抽象由真实任务逐步验证 | 增加 v0.4+ 非 coding Workflow 的拆分规则：按任务范式一次选择一个垂直切片，完成真实端到端验证后再进入下一类；候选 Issue Type 不等于已支持 Workflow |
| 2026-07-13 | `6c71e13` | 将 F001 实施中验证有效的逐任务执行纪律固化到通用开发流程 | 要求严格按 `tasks.md` 顺序实施、完成一项立即勾选、仅并行 `[P]` 任务；若任务顺序过时，先修订任务文档再继续，并将自检、review、合并顺延为后续步骤 |
| 2026-07-12 | `4af80c1` | 建立 PersonaHub 个人开发流程基线 | 创建分支/worktree、实现、自检、可选 AI review、合并清理的基本流程；定义 PRD 按需拆 Feature 的节奏、参考 clowder-ai / multica 验证设计假设的方法及初始代码质量约定 |

## Workflow

进入 Step 1 前的强制前提：对应 feature 的 `design.md` 的"待确认设计问题"章节必须已清空（所有条目已关闭并给出结论，或已转为 `tasks.md` 里的具体验证任务）。带着未解决的设计问题开工，等于把设计判断推迟到实现中间做，详见 `docs/features/README.md`"Review Checklist"。

| Step | What |
|------|------|
| 1 | 建分支/worktree 做隔离开发 |
| 2 | 严格按 `tasks.md` 里的顺序逐项实现，不跳过、不并成大块一次性写完；每完成一项立即在 `tasks.md` 里勾掉，不要攒到最后统一补标。标记为 `[P]` 的任务可以并行，其余按文档顺序来。如果实现中发现某个任务顺序不对或已经过时，先改 `tasks.md` 再继续，不要绕开文档直接改代码 |
| 3 | 自检：对照 spec / acceptance criteria 过一遍，跑 `npm run verify`（本地高频门禁：lint、format:check、typecheck、测试、文档门禁）；状态改 `done` 前再跑 `npm run verify:release`（追加 build 与真实浏览器 E2E）。含真实环境测试，见下方“真实环境测试纪律” |
| 4 | （可选）让 AI agent 扮演 reviewer 角色审一遍 diff，输出 findings |
| 5 | 合并 + 清理分支 |

## 真实环境测试纪律

- **本机就是真实环境。** 需要真实 agent / 真实 CLI（如 Codex CLI）、真实文件系统、真实进程或真实端到端流程的测试，一律直接在本机执行，作为自检（Step 3）的一部分，不允许默认标记成“待用户在真实环境验证 / manual verification pending”而跳过。之所以有这条：F004 的 T081-T085 这类真实端到端任务被长期挂成 pending，等于把最关键的验证一直推迟，feature 标了 `done` 但真实链路从未跑通。
- **允许延后的唯一情形是客观不可执行**：缺凭证、缺二进制、需要外部账号或联网服务、会造成破坏性副作用等。此时不得静默跳过，必须在自检结论里显式写出：哪条测试、为什么跑不了、缺什么，以及补齐后如何执行。
- tasks.md 里的真实环境验证任务默认由开发流程在本机跑完并勾选，而不是甩给“用户在真实环境执行”。确实无法在本机执行的，按上一条显式标注原因。
- 自检结论要如实反映：本机跑过并通过的说通过，跳过的说跳过并给原因，绝不把“未执行”写成“通过”。

## 检视文档生命周期纪律

- Step 4 的"reviewer 角色"和执行修复的一方是两个独立视角，**检视协议的进行中文档（`docs/reviews/CURRENT-doc.md` / `CURRENT-code.md`，见 `review-convergence` skill）只能由检视人在复核完成后删除，执行修复的一方不得自行删除**——哪怕修复者已经把 issue 表原样追加进 `RETROSPECTIVE.md`、自认为"已经闭环"。自己批准自己的修复等于取消了这层制衡，一旦复核发现修复不完整就无据可查。
- 同一个 agent 在同一次会话里先后扮演执行者和检视人时，也要显式切换视角重新核对一遍再删，不能把"刚写完修复"直接当成"已经复核过"。
- 完整的检视收敛协议（有限清单、严重度分层、diff-only 复审、停止条件、报告生命周期）见 `review-convergence` skill；本条只是把其中"删除权限专属检视人"这一条固化为项目级硬性要求，避免被跳过。

## 结构性隔离与安全边界声明纪律

- **任何"隔离/沙箱/只读/权限边界"类声明，判断标准是这个机制在结构上能不能挡住，不是它的用途或起始状态。** 换了个 `cwd`、给了个角色标签、prompt 里写了"只读"、约定俗成"不应该"这样用，都不构成结构性保证——它们只是换了包装的信任假设，本质上和"信任 Node 会照 prompt 说的做"是同一类风险。
- **检验方法：问"如果执行方恶意或意外地不按预期行为，这个机制真的会失败吗？"** 如果答案是"会"（例如恶意/失控的子进程照样能用 `..`、绝对路径或调用工具访问到本该隔离的资源），那就不能作为设计里依赖的安全边界，只能算"正常情况下大概率够用"，必须在文档里如实标注这个区别，不能把后者写成前者。
- **默认基线是更保守的那一侧，"结构性隔离"是需要额外设计和验证成本才能解锁的加分项，不是可以随手采用的默认方案。** 想不出真正的结构性方案时，宁可退回全部串行/全部拒绝，也不要用一个"看起来更安全"但没验证过的方案去换取并发或便利。
- **具体案例**（详见 `docs/decisions/0006-executable-work-graph.md` 第三节"并行边界"）：v0.2 `orchestrator_subagent` 设计中，"让只读 Node 运行在独立的 `git worktree`/目录拷贝上"最初被当作足够的隔离方案。复核时对照实际代码才发现：`cwd` 只限制子进程的起始目录、不限制文件系统权限，Claude Code/OpenCode 这类普通子进程能用相对/绝对路径或调用工具访问回原 workspace；`git worktree` 还和主仓库共享 `.git` 对象库和管理元数据。这个方案换汤不换药，本质仍是"信任进程不会跑出 cwd"。最终改为：默认全部进入 workspace 排他锁串行队列，只有验证过操作系统层面确实不可访问原 workspace（容器/沙箱/受限用户 ACL 等）才允许放开并行。
- 同类正面案例：F005 的 git push escalation 防护没有依赖"CLI 会遵守 approval 钩子"这种信任假设，而是用凭据隔离（agent 执行环境默认不下发 push 凭据）做结构性阻断——这是同一条纪律已经被正确应用过的先例，新设计遇到类似判断时可以直接参考这个模式。

## PRD 版本拆解为 Feature 的节奏

- v0.1–v0.3 是 PRD（第 15 节）划定的近期承诺范围。v0.1 已拆成 v0.1.0～v0.1.4 五个子版本，对应 F001～F005；v0.2、v0.3 同样按独立 intent 拆解——整版本 bundle 了多个不同能力（例如 v0.2 的 Coordinator Agent、Graph Slice、Topology 推荐、Workflow Template 管理 UI），直接整版本写一个 spec 会违反"一个 feature 一个主要 intent"的原则。
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

- 静态检查：`npm run lint`（ESLint，覆盖当前 server/shared/web/e2e 工作区；测试夹具保留宽松的未使用变量规则）。
- 格式检查：`npm run format:check`；自动格式化：`npm run format`。当前采用增量格式基线，只覆盖本轮重构热点与根配置，后续修改旧文件时应把它加入格式目标，避免一次性格式化全仓造成大面积无语义 diff。
- File limits: 200 行建议拆分 / 350 行硬上限
