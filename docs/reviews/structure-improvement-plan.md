# PersonaHub 目录结构改造方案

> 状态：**Candidate v3（待确认，尚未实施）**
> 创建：2026-08-09
> 修订：2026-08-09（完成方案审查并把全部风险处置正式并入正文）
> 修订：2026-08-09（gate_version 边界从"F008 起"后移至"v0.3/F009 起"，F001-F008
> 全部按 v0 处理，不再要求 F008 回填 tests: 路径或改写 design.md 章节）
> 背景：vibe coding 调研（github/spec-kit 125k★、Fission-AI/OpenSpec 64k★）后对照
> market-game-sim 项目结构，给本仓库的可落地改造计划。
> 原则：**只补缺口，不动已经有效的东西**。feature 三件套 + TEMPLATE、Fxxx 跨版本
> 编号、ADR、SOP.md 真实环境纪律、Review Checklist、BACKLOG 单一入口都是标杆级
> 实践，不在改造范围内。

## 0. 现状结论（复核后）

对照 market-game-sim 与 OpenSpec 循环并复核当前仓库后，剩余缺口收敛为六类：

1. **TEMPLATE 已经和实际写法脱节**：`docs/features/TEMPLATE/spec.md` 还是旧的
   15 节结构（含独立的「13. 可追踪性」表格章节）；但从 F006 起，实际 spec.md
   改用更短的 8 节结构，可追踪性直接内联进「6. 验收清单」（
   `AC-001（FR-001）：描述 — test.ts` 这种写法），比表格更紧凑。TEMPLATE 没跟着
   更新，新建 feature 时复制出来的还是过时结构。
2. **Feature 状态没有唯一机器可读真相源**：当前状态散落在 `spec.md`、`design.md`、
   `tasks.md` 与 BACKLOG，已经出现 F006 的 `done` / `complete` 和 F009-F012 的
   `draft` / `spec` 混用。必须先统一状态模型，门禁才有可靠输入。
3. **缺少可执行的完成门禁**：目前无法自动阻止未勾完任务/AC、无测试证据、测试路径
   不存在、设计问题未关闭或 BACKLOG 漂移的 Feature 被标成 `done`。
4. **无版本收口仪式**：0.1 全部 done 后没有 release 摘要和明确的关闭记录；但物理
   移动 `docs/features/0.1/` 会破坏大量稳定引用，因此应做逻辑收口而非目录搬迁。
5. **本地运行产物分散**：多组日志与 SQLite 文件散落在根目录和 `server/`。它们虽被
   Git 忽略，仍会干扰目录浏览与 agent 自检，适合独立迁到 `.local/`。
6. **文档职责清楚但缺少统一地图和所有权门禁**：PRD、architecture、system-design、
   decisions、Feature artifacts 和 SOP 已经各有职责，但新参与者必须读多处文字才能
   判断真相源；CLAUDE 与 BACKLOG 又积累了大量历史叙述，需要缩回“当前入口”。

**以下两项原本以为是缺口，核实后发现已经落地，不需要再做**：

- **检视报告归档机制已经在运行**：`docs/reviews/RETROSPECTIVE.md` 已存在
  （605 行，更新到「循环 9」，2026-08-09），`.gitignore` 已白名单
  `RETROSPECTIVE.md` / `CURRENT-doc.md` / `CURRENT-code.md`，`docs/SOP.md`
  2026-08-09 的修订已加入"检视文档生命周期纪律"。曾经积累在 `F005/` 目录下的
  7+ 份 `code-review-report*.md` 现已清理，目录下只剩 1 份当前有效文件。这套
  由 `review-convergence` skill 配套带起来的机制，功能上覆盖了原方案 2.2/2.3
  想解决的问题。
- **CLAUDE.md 瘦身仍有价值，但目的地不是 RETROSPECTIVE.md**：`RETROSPECTIVE.md`
  是 `review-convergence` skill 专属的"每轮检视发现了什么缺陷"日志，格式和语义
  都是缺陷记录；CLAUDE.md 里 F001-F008 的历史叙述是"这个 feature 交付了什么"，
  语义不同，硬塞进去会污染 skill 固定格式的文件。如果要瘦身，目的地应该是
  下面 2.3（原 2.5）的 `docs/features/releases/0.x.md`。

## 1. 改造内容总览

| # | 改造 | 工作量 | 何时做 |
|---|------|--------|--------|
| 1 | 定稿并更新 spec/design/tasks 三份 TEMPLATE，可追踪性内联进验收清单 | 约 1~2 小时 | 现在（v0.3/F009 起强制用新 TEMPLATE） |
| 2 | feature 状态门禁校验脚本 | 约 2~3 小时 + 测试 | 现在 |
| 3 | 版本逻辑收口规则（含 CLAUDE.md 历史迁移目的地；保留 Feature 稳定路径） | 约 30 分钟（规则）；1~2 小时/版本 | 规则与 0.1 收口现在做；0.2 等 F008 完成 |
| 4 | GitHub Actions 基线 CI | 约 1 小时 | 现在；10 分结构的必需门禁 |
| 5 | （可选）本地运行产物集中到 `.local/` | 约 1~2 小时 + 回归测试 | 独立实施 |
| 6 | `docs/README.md` 文档地图 + 链接/所有权门禁 + CLAUDE/BACKLOG 瘦身 | 约 2~3 小时 + 测试 | 现在 |

当前达到目标结构所需的 #1~#4、#6 与 0.1 收口约 8~12 小时；#5 可独立实施，
但仓库卫生验收前也必须完成。0.2 release 等 F008 完成后另做。

### 1.1 目标目录结构

改造后的目标结构如下。核心原则是：**Feature 历史路径保持稳定，版本通过发布摘要
完成逻辑收口；仓库级校验工具与本机运行产物各自集中管理。**

```text
personahub/
├─ .github/
│  └─ workflows/
│     └─ ci.yml                         # 可选：统一 CI
├─ .local/                              # gitignored，本机运行产物
│  ├─ db/
│  │  └─ personahub.db
│  └─ logs/
│     └─ server.log
├─ docs/
│  ├─ README.md                          # 文档地图与所有权索引，不复制正文
│  ├─ decisions/                        # ADR，保持不变
│  ├─ features/
│  │  ├─ README.md                      # SDD、状态门禁、版本收口规则
│  │  ├─ TEMPLATE/
│  │  │  ├─ spec.md
│  │  │  ├─ design.md
│  │  │  └─ tasks.md
│  │  ├─ releases/                      # 新增：版本发布与收口摘要
│  │  │  ├─ 0.1.md
│  │  │  └─ 0.2.md
│  │  ├─ 0.1/                           # 保留原路径，已收口后只读维护
│  │  │  ├─ README.md                   # 标记版本已收口，链接 release
│  │  │  ├─ ux-prototype.html
│  │  │  ├─ F001-workspace-issue-foundation/
│  │  │  ├─ F002-agent-command-center/
│  │  │  ├─ F003-development-trace/
│  │  │  ├─ F004-autonomous-validation/
│  │  │  └─ F005-multi-agent-manual-routing/
│  │  ├─ 0.2/
│  │  │  ├─ F006-orchestrated-coding-graph-slice/
│  │  │  ├─ F007-coordinator-routing-recommendation/
│  │  │  └─ F008-workflow-template-admin-runtime-health/
│  │  └─ 0.3/
│  │     ├─ README.md
│  │     ├─ F009-artifact-foundation-provenance/
│  │     ├─ F010-artifact-centered-coding-slice/
│  │     ├─ F011-work-room-human-intervention/
│  │     └─ F012-reusable-agent-squads/
│  ├─ reviews/
│  │  ├─ RETROSPECTIVE.md
│  │  └─ structure-improvement-plan.md
│  ├─ personahub-prd.md
│  ├─ personahub-architecture.md
│  ├─ personahub-system-design.md
│  └─ SOP.md
├─ tools/                               # 新增：仓库级工程工具
│  ├─ check-feature-gates.mjs
│  ├─ check-feature-gates.test.mjs
│  ├─ check-doc-links.mjs
│  ├─ check-doc-ownership.mjs
│  └─ check-docs.test.mjs
├─ server/
│  ├─ src/
│  ├─ tests/
│  └─ scripts/
├─ shared/
│  └─ src/
├─ web/
│  └─ src/
├─ e2e/
│  └─ tests/
├─ AGENTS.md
├─ BACKLOG.md                           # 只列非 done Feature；受 frontmatter 双向校验
├─ CLAUDE.md                            # 约 6000~10000 字符的当前入口与活契约指针
├─ package.json
└─ package-lock.json
```

每个 Feature 继续保持固定的三件套，不增加第二套结构真相源：

```text
Fxxx-feature-name/
├─ spec.md
├─ design.md
└─ tasks.md
```

`spec.md` frontmatter 作为 Feature 状态的唯一机器可读真相源：

```yaml
---
kind: feature
id: F009
version: "0.3"
status: draft
gate_version: 1
updated: 2026-08-09
---
```

允许的状态统一为 `draft` → `ready-for-development` → `in-progress` → `review`
→ `done`；`BACKLOG.md` 是由该状态派生的活跃索引，不再作为第二个状态真相源。

## 2. 详细改造项

### 2.1 TEMPLATE 追平实际结构（对应总览 #1）

1. **三件套 TEMPLATE 目标结构（2026-08-09 正式定稿，尚未执行）**：不照抄旧 15 节
   TEMPLATE、F006-F008 的 8 节历史快照或 F009-F012 任一份 draft。综合当前演化后，
   三份模板同时定稿：`spec.md` 最严格，`design.md` 固定技术关注面，`tasks.md` 固定
   外层骨架但允许动态 Phase。顶层标题不得省略或改号；固定骨架让人和门禁使用同一
   套边界，避免 F009-F012 继续各自演化成不同文档方言。

   `spec.md` 固定使用以下 9 个顶层章节：

   ```text
   0. 来源与意图         # PRD/architecture/system-design/ADR 指针 + 一句话意图
   1. 问题、目标与非目标 # 为什么做、成功改变什么、产品层明确不做什么
   2. 用户场景           # US-xxx（Priority）+ 独立测试 + Given/When/Then 验收场景
   3. 范围与边界         # 范围内 / 范围外 / 边界场景
   4. 需求               # FR/DR/TR/IR/UX/NFR 子标题按需出现
   5. 生命周期与不变量   # 状态机、工作流、不变量；不适用时写明理由
   6. 成功与验收         # SC-xxx + AC-xxx；可追踪性内联，不再单列追踪表
   7. 测试、依赖与决策   # 三个固定子标题；风险和已关闭权衡放“决策”
   8. 待确认问题         # 固定保留；无开放项时明确写“无”
   ```

   章节职责边界正式确定如下：

   - 「1. 非目标」只记录产品意图层的明确排除；「3. 范围外」记录本次交付切片的
     具体边界，两者不得复制同一段文字。
   - 「5. 生命周期与不变量」和「8. 待确认问题」标题始终存在。前者不适用时写
     `不适用：<理由>`；后者无开放项时写 `无`。固定标题比省略更利于 review 和门禁
     可靠定位，也避免后续章节改号。
   - spec 的待确认问题使用 `Q-xxx`，design 的待确认设计问题使用 `DQ-xxx`，两者
     统一采用 checkbox：`- [ ] Q-001: <问题>` 表示开放，关闭后改为
     `- [x] Q-001: <问题> — 决策：<结论>`。无问题时只写 `无`。禁止用普通 bullet
     或“以后再看”等自由文本绕过门禁。
   - 「7. 测试、依赖与决策」固定包含 `### 测试策略`、`### 依赖`、`### 决策与风险`
     三个子标题。这里只记录行为验证、跨 Feature/环境依赖、已经拍板的权衡和残余
     风险；schema、service、repository、component 等实现拆分仍属于 `design.md`。
   `design.md` 固定使用以下 11 个顶层章节：

   ```text
   0. 输入与约束
   1. 技术概要与影响面
   2. 架构与模块边界
   3. 数据模型与 Migration
   4. 接口、Contract 与 Event
   5. Runtime、Workflow 与并发
   6. UI 与可观测性
   7. 失败、恢复、安全与兼容
   8. 测试策略与验收映射
   9. 已确认决策与残余风险
   10. 待确认设计问题
   ```

   - 不适用的技术关注面保留标题并写 `不适用：<理由>`，不得通过删章节隐藏未评估面。
   - 第 10 节只允许规范的 `DQ-xxx` checkbox 或单独一行 `无`；进入
     `ready-for-development` 前必须全部关闭。
   - design 只描述结构、契约、状态、失败和技术取舍，不写逐步编码任务。

   `tasks.md` 固定使用以下 6 个顶层章节：

   ```text
   0. 来源与执行规则
   1. 前置条件
   2. 实现任务
      ### Phase 1：<按 Feature 定义>
      ### Phase 2：<按 Feature 定义>
   3. 验证与验收任务
   4. 依赖与并行关系
   5. 明确后移
   ```

   - Phase 数量和名称可以变化，但只能作为第 2 节的三级标题，不能各自成为顶层章节。
   - 任务统一为
     `- [ ] T001 [P] (FR-001, AC-001): <一个可验证动作> — verify: <测试/命令>`；
     `[P]` 只用于修改不同文件且没有顺序依赖的任务。
   - 第 3 节必须包含 AC 对应的自动化测试、所需真实环境验证与最终质量门；第 5 节
     只能放明确移交给其它 Feature/版本的内容，必须写目标 Feature/版本，不能隐藏
     当前范围内未完成任务。
   - tasks 不重复声明状态，也不重新解释需求或技术设计；只链接 `spec.md` / `design.md`。

   F009-F012 四份 draft 的 spec/design/tasks 必须在进入 `ready-for-development` 前
   统一改写到这套固定结构；旧 F001-F008 保持 `gate_version: 0`，不做无收益的历史
   章节重排。
2. 在 `docs/features/README.md` 的「`spec.md`」职责说明和「Review Checklist」
   里加入硬性规则：验收清单每项必须有唯一 `AC-xxx`，并引用至少一个在第 4 节中
   真实定义的需求 ID；允许的类型为 `FR/DR/TR/IR/UX/NFR`，**不强制每条 AC 都引用
   FR**，因为纯可靠性、Trace、UX 验收可能只对应 NFR/TR/UX。进入 `review` 前必须
   回填仓库内真实存在的测试文件；标记 `done` 前还必须勾选。唯一格式为：

   ```markdown
   - [ ] **AC-001** (`FR-001`, `NFR-002`): 可观察行为 — tests: `server/tests/integration/example.test.ts`
   ```

   `draft`、`ready-for-development`、`in-progress` 阶段允许 `tests:` 暂缺；此时 AC 仍须
   有合法 ID、需求引用和可观察行为，不能等实现完成后才补写验收标准。

   不新增独立追踪表、不引入 JSON 真相源。门禁只承诺验证元数据和证据引用一致，
   **不宣称能证明该测试真实覆盖了对应 AC**。
3. 三件套 frontmatter 同步更新：`spec.md` 增加 `kind`、`id`、`version`、`status`、
   `gate_version`；`status` 只在 `spec.md` 保存。`design.md`/`tasks.md` 保留 Owner 与
   互链，但移除重复的 Status 字段，避免产生第二状态真相源。
4. 一次性规范化现有文档：所有 Feature 的 `spec.md` 回填规范状态。**兼容策略已于
   2026-08-09 二次修订**：F001-F008（0.1、0.2 全部既有 Feature，含已完成的 F008）
   一律显式写 `gate_version: 0`，不需要为满足新规则回填 `tests:` 路径、也不需要
   改写 `design.md` 的"待确认设计问题"章节；v0.3 起（F009 及之后）必须写
   `gate_version: 1`，严格执行全部规则。v0 只用于这批既有历史 Feature，不允许新建
   或回退到 v0。是否 legacy 只看该字段，**不按日期、编号或目录位置猜测**。未来若
   逐项补齐历史证据，可以单向从 v0 升到 v1，但不要求一次性返工全部旧 Feature。
   **前置条件**：F009-F012 当前三件套章节结构都不统一，在各自进入
   `ready-for-development` 前，必须先统一改写为本节定稿的 spec/design/tasks 结构。

### 2.2 feature 状态门禁校验脚本（对应总览 #2）

新建 `tools/check-feature-gates.mjs`（Node 项目，用 `node:fs` 即可，零依赖），
只发现 `docs/features/<major.minor>/Fddd-*/`；按路径形状排除 `TEMPLATE/`、
`releases/`、版本 README 和其它辅助文件。脚本必须跳过 fenced code block，且只解析
指定章节内的 checkbox，不能全文件搜索 `[ ]`。

所有 Feature 都执行以下基础校验：

1. 三件套齐全；Feature ID 跨版本唯一；frontmatter 中 `kind: feature`、`id` / `version` 与目录
   一致；`status` 只能是 `draft`、`ready-for-development`、`in-progress`、`review`、
   `done`；`gate_version` 只能是脚本明确支持的版本。
2. `spec.md` 是状态唯一真相源；`design.md` / `tasks.md` 不允许再声明独立 Status。
3. `BACKLOG.md` 做双向集合比较：所有且仅有 `status != done` 的 Feature 必须各出现
   一次，且 ID、version、status、链接必须与 `spec.md` 完全一致；链接必须存在并指向
   对应 `spec.md`。`done` Feature 不得留在活跃表。

`gate_version: 0` 只执行上述结构、元数据和 BACKLOG 校验，作为显式记录的历史债务；
不得靠 legacy 规则创建新的 `done` Feature。

`gate_version: 1` 额外执行：

1. spec/design/tasks 顶层章节必须与 2.1 完全一致；design 不适用章节必须有理由；
   tasks 的 Phase 只能位于「2. 实现任务」下，任务行必须符合 Txxx 格式并引用合法 ID。
2. `status: done` 时，`tasks.md` 第 2、3 节的任务与 `spec.md` 验收清单必须都非空且
   全部 `[x]`；
   已勾任务不得仍含 `TODO`、`TBD`、`待补`、`未补`、`pending` 等未完成标记。确实
   不适用的项目用统一的 `N/A: <reason>` 格式说明，而不是伪装完成。
3. 所有状态下，每条 AC 都必须有唯一 `AC-xxx`，并引用至少一个在当前 spec 第 4 节
   真实定义的 `FR/DR/TR/IR/UX/NFR` ID。`review` / `done` 状态下每条 AC 还必须有至少
   一个 `tests:` 路径；更早状态允许路径暂缺。路径必须是仓库相对路径，经
   `path.resolve()` 后仍在 repository root 内，并由 `fs.existsSync()` 证明是真实
   文件；拒绝绝对路径、`..` 逃逸、目录和 glob。
4. `ready-for-development` 及以上状态要求 `spec.md` 的「8. 待确认问题」和
   `design.md` 的「10. 待确认设计问题」都没有未关闭项。解析边界为对应标题到下一个
   同级标题，代码块里的 checkbox 不计入；内容只允许规范的 `Q-xxx` / `DQ-xxx`
   checkbox 或单独一行 `无`。存在 `[ ]`、自由文本 bullet、空章节或省略章节都视为
   未关闭。`review` 可以合法地已有全部任务/AC 勾选，其与 `done` 的差别是审查尚未
   完成，因此门禁不得从 checkbox 反向推断状态。

配套测试：`tools/check-feature-gates.test.mjs`（node:test，零依赖），覆盖：

- 合法的 gate v0 / v1 Feature；缺三件套、非法/重复 ID、非法状态/门禁版本；
- spec/design/tasks 固定章节缺失、改号或合并；不适用 design 章节缺理由；Phase 放在
  tasks 第 2 节之外、非法任务格式、`[P]` 任务仍声明前置依赖；
- done 有未勾任务/AC、空任务/AC、已勾任务仍含未完成标记、AC/需求 ID 不存在或重复；
- 测试路径缺失、不存在、指向目录、绝对路径、`..` 逃逸、glob 与多路径合法场景；
- spec/design 待确认问题未关闭、自由文本 bullet/空章节/缺章节、`无` 合法、代码块
  checkbox 不应误报、CRLF 文档；`review` 全部勾选仍合法；
- BACKLOG 缺行、多行、done 残留、状态/version/link 不一致及坏链接；
- 一个多个版本、多个 Feature 同时存在的批量用例（项目强制规则）。

脚本导出可测试的纯函数，CLI 只负责读取真实仓库与设置退出码；测试用临时目录构造
fixture，不修改真实 `docs/features/`。

在 `package.json` 增加：

```json
{
  "scripts": {
    "check:features": "node tools/check-feature-gates.mjs",
    "test:feature-gates": "node --test tools/check-feature-gates.test.mjs",
    "check:doc-links": "node tools/check-doc-links.mjs",
    "check:doc-ownership": "node tools/check-doc-ownership.mjs",
    "test:docs": "node --test tools/check-docs.test.mjs",
    "verify": "npm run lint && npm run format:check && npm run typecheck && npm test && npm run test:shared && npm run test:feature-gates && npm run test:docs && npm run check:features && npm run check:doc-links && npm run check:doc-ownership && npm run build"
  }
}
```

`check:features` 不是可选提示：`docs/SOP.md` Step 3 明确要求 Feature 状态变更前运行
`npm run verify`。CI 落地后也只调用同一个 `verify` 入口，避免本地与 CI 维护两套门禁。

### 2.2.1 文档地图、所有权与入口瘦身（对应总览 #6）

新增 `docs/README.md`，确保从一个入口最多两次点击即可到达任何权威文档。它只记录
所有权和链接，不复制正文：

| 信息 | 唯一拥有者 |
|---|---|
| 产品目标、范围和路线 | `docs/personahub-prd.md` |
| 全局模块、进程与运行时边界 | `docs/personahub-architecture.md` |
| 字段、表和数据关系 | `docs/personahub-system-design.md` |
| 跨 Feature 长期决策 | `docs/decisions/` |
| Feature 行为与状态 | 对应 Feature `spec.md` |
| Feature 实现方案 | 对应 Feature `design.md` |
| 开发、验收和检视纪律 | `docs/SOP.md` |
| 当前 active Feature 与强提醒 | `CLAUDE.md` |
| 非 done Feature 派生索引 | `BACKLOG.md` |
| 缺陷和过程教训 | `docs/reviews/RETROSPECTIVE.md` |

`check-doc-links.mjs` 校验仓库内 Markdown 链接、锚点、路径边界和目标文件；
`check-doc-ownership.mjs` 只检查可机器证明的越权声明，例如：

- status 只能出现在 Feature `spec.md` frontmatter；
- BACKLOG 与所有非 done Feature 做双向集合比较；
- docs README 中的权威入口必须存在且唯一；
- release/RETROSPECTIVE 不得被声明为当前产品、状态或实现真相源。

校验器不声称能理解自然语言语义，也不尝试判断某段架构文字是否“应该”属于另一文件；
这类内容所有权由 Review Checklist 人工确认。

CLAUDE.md 收缩到**约 6000～10000 字符**（不用物理行数做验收指标：本仓库 Markdown
段落不强制硬换行，当前 CLAUDE.md 只有 62 行却有 23372 字符，平均每行 377 字符，
行数完全无法反映真实体量；若要同时给一个直观的行数参考，需先约定换行规范——按
正常 40～60 字/行折算，6000～10000 字符对应约 120～250 行），只保留项目定位、
当前 active Feature、5—10 条硬规则、仍生效的跨 Feature 契约指针、`npm run verify`
和权威文档入口。处理规则：

- 纯交付历史压缩到 `docs/features/releases/<version>.md`；
- 长期技术不变量回写 architecture/system-design/ADR，CLAUDE 只留短指针；
- Feature 局部契约回到对应 design；
- 检视发现只进 RETROSPECTIVE；
- 当前仍被多个 active Feature 依赖且必须自动加载的短提醒才留在 CLAUDE。

BACKLOG 同步删除多轮检视叙事和已完成 Feature 详情，只保留非 done Feature 的 ID、version、
status 和 spec 链接；发布历史由 releases 负责。

### 2.3 版本收口仪式（对应总览 #3）

**规则（现在写入 `docs/features/README.md`）**：某大版本（如 0.1）全部 feature
状态为 `done` 后，执行收口：

1. 新建 `docs/features/releases/0.1.md`：汇总该版本交付的 feature 列表、每个
   feature 的 FR 摘要、已知限制与遗留项（数据来源：版本目录内各 spec.md + PRD；
   BACKLOG 不再保存 done Feature，不能作为 release 数据源）。
   迁移 CLAUDE.md 前逐段标为「交付历史」或「仍生效契约」：只有纯交付历史移入
   release，压缩成摘要 + 原 Feature / `RETROSPECTIVE.md` 指针；跨 Feature 契约、
   安全不变量、当前 Feature 仍依赖的入口继续留在 CLAUDE.md，或先迁回契约真正的
   拥有方（如对应 `design.md`）再用短指针替代。不得整段机械搬走。
2. **保留 `docs/features/0.1/` 原路径，不移动到 `archive/`**；在目录内增加
   `README.md`，注明「0.1 已收口，产品判断以 `docs/personahub-prd.md` +
   `docs/features/releases/0.1.md` 为准；本目录仅作历史追溯」。这样既完成生命周期
   收口，也不破坏源码注释、测试、配置、文档和外部链接中的稳定路径。
3. 在 `docs/README.md` 的 releases 索引增加 `0.1 → 收口于 <日期>`；BACKLOG 删除该版本
   全部 done Feature，不加入 release 历史行。
4. 收口动作必须跑一遍 2.2 的门禁脚本，确认该版本所有 Feature 确实 `done`，再写入
   release 的 `closed_at` 元数据；版本目录收口后只允许修复历史错误或死链，不再追加
   新需求。
5. CLAUDE.md 收口后控制在约 6000～10000 字符（见 2.2.1 的指标说明，不用行数验收）；
   不能迁移的活契约必须先回写到真正拥有者，
   再以短指针保留。BACKLOG 只保留非 done Feature 派生索引，不能继续承担 release notes
   或多轮检视历史。

### 2.4 CI 基线（对应总览 #4）

本仓库目前没有 `.github/workflows/`。为避免本地门禁只靠开发者记忆，目标结构要求落地
以下最小 CI：

- `ci.yml`：`npm ci` → `npm run verify`；浏览器 E2E 保持独立 job，按凭证和运行环境
  决定是否作为必需检查。
- 依赖锁版本（与 market-game-sim 的经验一致：CI 与本地工具版本漂移是最常见的
  「本地绿 CI 红」来源；`package-lock.json` 已存在，CI 用 `npm ci` 锁定依赖）。
- 新增 `.nvmrc` 或等价工具版本文件，CI 使用其中的 Node LTS；`package.json.engines`
  与其保持同一 major，不再只写过宽的 `>=20`。

CI 与目录移动本身解耦，但属于“10 分结构”的完成条件，不再作为可选项。

### 2.5 （可选）本地运行产物集中（对应总览 #5）

当前根目录和 `server/` 下存在多组已被 `.gitignore` 忽略的日志与 SQLite 文件，
例如 `server-error*.log`、`server-output*.log`、`server/personahub.db*` 和
`server/server-*.log`。它们不会污染 Git，但会让目录浏览和 agent 自检误把运行产物
当成项目源码。

建议把开发环境默认输出统一到 `.local/`：

- 数据库写入 `.local/db/personahub.db`；
- 服务日志写入 `.local/logs/server.log`；
- 测试继续使用各自的临时目录，不共享开发数据库；
- 路径保持环境变量可配置，迁移前先确认没有正在运行的 server 占用旧数据库；
- 旧文件不在本次方案修订中删除，待新路径验证通过后再单独确认清理。

这项改造涉及运行时默认路径，不和纯文档/门禁提交混在一起。

根目录文档同时收口：

- `structure-improvement-plan.md` 定稿后迁入 `docs/reviews/`；
- 根 `code-review-report.md` 若仍开放则按协议改为 `docs/reviews/CURRENT-code.md`，已闭环则
  在复盘信息完整后由 reviewer 删除；
- 根目录最终只保留入口、workspace/build 配置和 lockfile，不保留临时报告或运行日志。

## 3. 实施顺序（按依赖排）

1. **先做 #1 + #6 的文档规则部分**：spec/design/tasks 三份 TEMPLATE、docs README、
   所有权矩阵和 CLAUDE/
   BACKLOG 目标边界先定稿，v0.3/F009 起新建的 Feature 直接受益（并需先把 F009-F012
   统一改写为新 TEMPLATE 结构，见 2.1 第 4 点）。
2. **再做 #2 + #6 的机器门**：规范化既有状态元数据，落 Feature/链接/所有权脚本、
   测试和 `npm run verify`；先让
   当前仓库通过，再把门禁接入 SOP，不能用 warning 绕过失败。
3. **执行 #3 的 0.1 收口**：生成 0.1 release，迁移 CLAUDE 历史并清理 BACKLOG；不移动
   `docs/features/0.1/`。0.2 release 等 F008 完成后执行。
4. **落地 #4 CI**：只调用 `npm ci` + `npm run verify`，E2E 独立 job。
5. **最后做 #5**：切换 `.local/` 默认路径，验证新路径后再确认清理旧运行产物。

## 4. 提交与验证要求

- 每个可执行改造项同一提交内带配套测试（#2 的负向用例清单见上）。
- 门禁落地后统一跑 `npm run verify`，不再依赖人记住零散命令；本地、SOP 与 CI
  必须复用同一入口。
- 0.1 收口执行时同步更新 CLAUDE.md「当前结构」索引，加入 `releases/` 目录说明；
  检查 `docs/features/0.1/` 原路径仍然有效。

## 5. 不做的事（明确排除）

- 不引入 OpenSpec CLI / specify CLI（项目无此规模需求，且会增加运行时依赖）。
- 不移动或改名 `docs/features/0.1/`、`0.2/` 与现有 Feature 目录，不改 Fxxx 编号规则
  （编号跨版本连续是正确设计，BACKLOG 与大量交叉引用依赖稳定路径）。
- 不把 `docs/personahub-prd.md` / `-architecture.md` / `-system-design.md` 移入
  feature 体系（全局真相与 feature 增量分层是正确的）。
- 不把 `docs/research/` 纳入 git（本地-only 是刻意的，竞品分析不进版本库）。
- 不重建检视报告归档机制——`RETROSPECTIVE.md` + `review-convergence` skill +
  `docs/SOP.md` 的「检视文档生命周期纪律」已经覆盖，重做等于制造第二套并行
  规则。

## 6. 已采纳的风险处置

| 原风险 | 正式处置 | 落点 |
|---|---|---|
| 历史 Feature 会被新规则立即拉红 | 已确认 F001-F008 全部显式使用 `gate_version: 0`；v0.3（F009）起强制 v1，v0 不得用于新 Feature，只允许未来单向升级 | 2.1、2.2 |
| F009-F012 结构互不相同，无法统一套用 gate_version 1 | 进入 v1 强制校验前先把四份 draft 改写为统一后的新 TEMPLATE 结构 | 2.1 |
| 物理归档破坏引用 | 保留版本稳定路径，用 `releases/` + 版本 README 逻辑收口 | 1.1、2.3 |
| CLAUDE.md 混有活契约 | 迁移前分类，只移动交付历史，活契约留在自动加载路径或契约拥有方 | 2.3 |
| 测试路径可伪造 | 校验规范、存在性、文件类型与仓库边界，并明确门禁不证明覆盖关系 | 2.1、2.2 |
| 门禁可能无人执行 | 建立唯一 `npm run verify`，强制接入 SOP Step 3，CI 复用同一入口 | 2.2、2.4、4 |
| 文档职责清楚但难发现 | 新增 docs README 所有权地图，保证两次点击内到达权威文档 | 1.1、2.2.1 |
| BACKLOG/CLAUDE 成为历史仓库 | done/交付历史进入 releases，缺陷进入 RETROSPECTIVE，入口只保留当前信息 | 2.2.1、2.3 |
| 所有权规则只靠人工记忆 | 链接与可机器判定的越权声明进入 `npm run verify` | 2.2.1、4 |

以上处置均已进入实施范围，不再作为待决策事项。若实现阶段需要改变其中任一项，
必须先修订本方案，再开始修改代码或 Feature 状态。

## 7. “10 分结构”验收标准

| 维度 | 通过条件 |
|---|---|
| 可发现性 | 从 `docs/README.md` 最多两次点击到达任一已跟踪的权威文档 |
| 单一真源 | 产品、架构、数据模型、Feature 状态和流程各有且只有一个机器可读拥有者 |
| 可执行性 | Feature、链接和可判定所有权规则全部进入 `npm run verify` 与 CI |
| 生命周期 | Feature 从 draft 到 done、版本从 active 到 release、review 从 CURRENT 到删除都有门禁 |
| 仓库卫生 | 根目录无日志、数据库、过期 review 或结构方案，运行产物统一进入 `.local/` |

五项全部满足、本地 `npm run verify` 全绿且 CI 必需 job 全绿，才视为结构改造完成。
constitution 不作为独立文件新增；跨项目原则由 PRD、architecture、decisions、SOP 和
CLAUDE 按所有权矩阵分别承载。

## 8. 实施任务清单

本节是结构改造的执行进度真相源。开始一项时在任务末尾标记 `（进行中）`；完成并验证后
立即把 `[ ]` 改为 `[x]`，不得攒到最后统一补勾。任一时刻只允许一个非 `[P]` 任务处于
进行中。进度直接按已勾选数量计算，不另维护容易漂移的百分比。

### Phase A：三件套模板与文档规则

- [x] S001：按 2.1 定稿结构重写 `docs/features/TEMPLATE/spec.md`。
- [x] S002 [P]：按 2.1 定稿结构重写 `docs/features/TEMPLATE/design.md`。
- [x] S003 [P]：按 2.1 定稿结构重写 `docs/features/TEMPLATE/tasks.md`。
- [x] S004：更新 `docs/features/README.md`，写入三件套职责、Q/DQ、AC/tests 与状态规则。
- [x] S005：把 F009-F012 的 spec/design/tasks 统一到新模板，不改变已定稿的需求语义。
- [x] S006：为所有 Feature 的 spec 回填 canonical status 与 gate_version；移除
  design/tasks 的重复 Status。

### Phase B：文档地图、所有权与机器门

- [x] S007：新增 `docs/README.md` 文档地图和所有权矩阵，验证权威文档两次点击可达。
- [x] S008 [P]：按 2.2 实现 `tools/check-feature-gates.mjs` 的纯函数与 CLI。
- [x] S009 [P]：实现仓库内 Markdown 链接、路径边界和可判定所有权检查。
- [x] S010：补齐 gate v0/v1、三件套结构、AC/tests、Q/DQ、BACKLOG 和批量场景测试。
- [x] S011：规范化 BACKLOG 活跃索引，确保与 canonical spec 状态双向一致。
- [x] S012：新增根 `npm run verify`，串联 lint、format、typecheck、测试、文档门和 build。
- [x] S013：更新 `docs/SOP.md` Step 3、CLAUDE 和入口文档，统一只引用 `npm run verify`。

### Phase C：版本逻辑收口

- [x] S014：生成 `docs/features/releases/0.1.md`，记录 Feature、需求、限制、证据和
  `closed_at`。
- [x] S015 [P]：新增 `docs/features/0.1/README.md`，标记逻辑收口且保留稳定路径。
- [x] S016：分类 CLAUDE 中的交付历史与活契约；只迁移历史，保留或回归活契约拥有方。
- [x] S017：清理 BACKLOG 已完成项并加入 0.1 release 指针，验证所有旧链接仍有效。
- [x] S018：F008/F0.2 满足收口条件后，以同一流程生成 0.2 release；条件未满足时保持未勾。

### Phase D：CI 基线

- [x] S019：新增并统一 Node LTS 版本文件与 `package.json.engines` major。
- [x] S020：新增 `.github/workflows/ci.yml`，使用 `npm ci` + `npm run verify`。
- [x] S021：把浏览器 E2E 设为独立 job，并明确凭证/环境不足时的 gate 规则。
- [ ] S022：推送验证提交，等待并确认当前 HEAD 的所有必需 CI job 全绿。

### Phase E：本地运行产物与根目录收口

- [x] S023：让开发数据库和日志默认写入 `.local/db`、`.local/logs`，并保留环境变量覆盖。
- [x] S024：补测试证明测试数据库仍使用临时目录，且 `.local` 切换不改变生产/测试语义。
- [x] S025：确认无进程占用旧数据库后，经用户确认清理旧日志与 SQLite 运行产物。
- [x] S026：把定稿方案迁入 `docs/reviews/`，按 review 协议处置根 `code-review-report.md`。
- [x] S027：运行 `npm run verify`，逐项核对第 7 节五项验收标准并记录最终结果。
- [ ] S028：提交、推送当前 main，并确认远端当前 HEAD 的全部必需 CI job 全绿。
