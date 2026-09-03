---
topics: [features, spec-driven-development, docs]
doc_kind: guide
created: 2026-07-12
updated: 2026-08-09
---

# Feature Specs Guide

本目录用于记录 PersonaHub 的 feature-level SDD artifacts。后续所有需求都按"一 feature 一文件夹"的结构输出，不再使用 `Fxxx-feature-name.md` 单文件格式；feature 文件夹按 PRD 第 15 节的大版本（`0.1`、`0.2`…）分层存放。

## Directory Shape

```text
docs/features/
  0.1/
    README.md                   该版本已收口的声明（保留稳定路径，只读维护）
    ux-prototype.html           该大版本交付目标的 UX 原型（可选）
    Fxxx-feature-name/
      spec.md
      design.md
      tasks.md
  0.2/
    Fxxx-feature-name/
      ...
  0.3/
    Fxxx-feature-name/
      ...
  releases/
    0.1.md                      版本发布与收口摘要
    0.2.md
  TEMPLATE/
    spec.md
    design.md
    tasks.md
```

创建新 feature 时，从 `docs/features/TEMPLATE/` 复制一份，放到对应版本目录下并重命名：

```text
docs/features/TEMPLATE/
  spec.md
  design.md
  tasks.md
```

命名规则：

- Feature ID 使用 `F001`、`F002`、`F003` 递增，跨版本连续编号，不按版本重新从 001 开始。
- 文件夹名使用 `Fxxx-kebab-case-feature-name`，放在其所属大版本目录下（对照 PRD 第 15 节该 feature 对应的 `v{X.Y.Z}`，取整数大版本作为目录名，例如 v0.1.0-v0.1.4 都归在 `0.1/` 下）。
- 单个 feature 级别的 UX 原型（如果需要）放在该 feature 文件夹内；体现某个大版本整体交付效果的原型放在该版本目录顶层（例如 `docs/features/0.1/ux-prototype.html`），不要和某一个具体 feature 的原型混在一起。
- `BACKLOG.md` 中的链接指向该 feature 的 `spec.md`，并注明所属版本。

## Feature Status Model（状态唯一真相源）

Feature 状态只保存在 `spec.md` 的 frontmatter，是机器可读的唯一真相源。允许的
状态流转（单向推进，不可回退）：

```text
draft → ready-for-development → in-progress → review → done
```

- `design.md` / `tasks.md` **不允许**再声明独立 Status（frontmatter 或正文都不行），
  避免出现第二状态真相源。
- `spec.md` frontmatter 固定包含 `kind: feature`、`id`、`version`、`status`、
  `gate_version`、`updated`。其中 `status` 只在 spec 保存。
- `gate_version` 表示该 Feature 适用哪一级门禁：
  - `gate_version: 0` 只做结构 / 元数据 / BACKLOG 校验（显式记录的历史债务，
    F001-F008 及同批历史 Feature 用；不允许新建 v0 Feature）。
  - `gate_version: 1`（v0.3/F009 起强制）额外做章节结构、验收清单、测试路径、
    待确认问题等完整校验。
- `BACKLOG.md` 是由该状态派生的活跃索引（只列 `status != done` 的 Feature），
  不是第二个状态真相源。

## Artifact Responsibilities

### `spec.md`

`spec.md` 是 feature 的行为契约，回答“要做什么”和“怎样算完成”。

应该包含：

- 问题和目标。
- scope / non-goals。
- 用户场景和独立测试。
- 可观察、可测试的 requirements。
- Given / When / Then scenarios。
- edge cases。
- acceptance checklist。
- test plan。
- risks / open questions。

不应该包含：

- 详细表结构。
- service / repository / component 拆分。
- 具体实现步骤。
- 具体库或框架选择，除非它本身已经是上游决策或用户可见约束。

原则：spec 写行为，不写实现。

`spec.md` 固定使用以下 9 个顶层章节（标题不得省略或改号）：

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

- 「1. 非目标」只记录产品意图层的明确排除；「3. 范围外」记录本次交付切片的具体
  边界，两者不得复制同一段文字。
- 「5. 生命周期与不变量」和「8. 待确认问题」标题始终存在。前者不适用时写
  `不适用：<理由>`；后者无开放项时写 `无`。
- spec 的待确认问题用 `Q-xxx`，design 的待确认设计问题用 `DQ-xxx`，统一 checkbox：
  `- [ ] Q-001: <问题>` 表示开放，关闭后 `- [x] Q-001: <问题> — 决策：<结论>`；
  无问题时只写 `无`。禁止用普通 bullet 或“以后再看”等自由文本绕过门禁。
- 「7. 测试、依赖与决策」固定包含 `### 测试策略`、`### 依赖`、`### 决策与风险`
  三个子标题。schema/service/repository/component 等实现拆分仍属于 `design.md`。

#### Eval / Tracking Contract（第 6 节条件子节）

来源：clowder-ai 的 `feat-lifecycle` Eval Contract 门禁，判断依据见
<a href="../reviews/clowder-governance-borrowing.md">`docs/reviews/clowder-governance-borrowing.md`</a> §4.2。
借的是**轻量四字段版**——clowder 的九字段重型「指标出生证」两年只有 3 份实例，四字段版有 49 份；
差别就是重量。

**触发（两问都是 yes 才填）**：

1. 这个改动会改变**用户旅程或成员行为**吗？
2. 存在**效用不确定、且有明确 consumer**（有人会据此决定保留/调整/删除）的主张吗？

任一为 no 即不触发。**不触发时不要写空节，也不要用 N/A 占位**——N/A 农场是这类门禁的死法。

**声明（frontmatter，`gate_version: 1` 且状态 ≥ `ready-for-development` 时必填）**：

```yaml
eval_contract: required          # 触发
# 或
eval_contract: exempt
eval_contract_exempt_reason: "两问为何都是 no"
```

`draft` 可以不声明：用户场景还没定稿，这时写出的契约是虚构的。但**一旦写了子节，四个字段
一律校验**——半填的比不填更糟。

**四个字段（`required` 时必填，缺一不过）**：

```markdown
### Eval / Tracking Contract

- **主要用户与激活信号**：谁在用；什么事件说明它真的被用起来了。
- **摩擦指标**：这件事做得顺不顺，用什么数字看。
- **回归夹具**：至少 1 条，建议 2-5 条，说明哪些场景必须一直成立。
- **退役信号**：**什么条件成立时，这个 Feature 的专用实现应当被删除。**
```

**退役信号空填直接不通过，不设 reviewer 签字降级**（clowder KD-4）。这条是整个门禁的承重墙：
一个谁都不会不通过的契约，就是谁都不会写的契约。写「有个更好的方案就删」不算——要写出可判定
的条件（谁接管、满足什么迁移与回放要求）。

它也是 PRD §15「预留没有消费者的字段就是下次要删的东西」的可执行版本；版本收口时按下方
「Version Closure Rules」复检一次。

**门禁**：`npm run check:features`（`checkEvalContract`）。`gate_version: 0` 的历史批次
（F001-F008）不追溯。

### `design.md`

`design.md` 是该 feature 的技术设计，回答“怎么实现”。

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

应该包含：

- API / contract 设计。
- schema migration / 数据模型变更。
- backend service / repository 边界。
- frontend state / UI surface 设计。
- runtime / workflow / lock / recovery 设计。
- event / trace payload 设计。
- failure handling。
- test strategy。
- 重要技术取舍。

`design.md` 可以引用 `docs/personahub-architecture.md` 和 `docs/personahub-system-design.md`，但不要把全局架构判断复制进来。全局稳定设计回写到对应全局文档；单 feature 的实现细节留在本文件。

**硬性约束：`design.md` 的"待确认设计问题"章节必须清空（或所有条目都标注"已关闭"并给出结论）才能进入代码开发阶段。** 带着未解决的设计问题开始写代码，等于把设计判断推迟到实现中间去做，容易导致返工、状态不一致或安全边界被绕过（参考 F002 escalation 设计中"排队 Run 未检查 Issue 是否 Blocked"这类因为设计判断不完整而产生的漏洞）。如果某个问题确实要等实现阶段才能验证（例如"Windows 环境下子进程是否继承凭据缓存"），应该：
- 在 `design.md` 里把它写成一个**已经拍板的假设/决定**，而不是留白的"待确认"；
- 把验证动作作为具体任务写进 `tasks.md`（例如"手动验证 XXX，如果不成立则切换到备选方案 YYY"），由任务而非悬而未决的设计问题来跟踪。

### `tasks.md`

`tasks.md` 是实施 checklist，回答“按什么顺序做”。

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
  只能放明确移交给其它 Feature/版本的内容，必须写目标 Feature/版本。
- tasks 不重复声明状态，也不重新解释需求或技术设计；只链接 `spec.md` / `design.md`。

任务要足够小，便于 agent 或人类逐项完成和勾选。避免一个任务写成“实现整个 feature”。

## Writing Rules

- 每个 feature 应有一个清晰 intent，能用一句话说清。
- `spec.md` 中的每个 requirement 应描述一个可观察行为。
- 每个重要 requirement 至少有一个 scenario。
- 重要的错误、边界和恢复场景要写成 scenario 或 acceptance check。
- 如果实现过程中发现 spec 与现实不一致，先更新 artifact，再继续实现。
- 高风险 feature 可以写 full spec；低风险 feature 可以保留 lite spec，但必须至少有 scope、requirements、acceptance checklist。
- 不确定项写入 Open Questions，并尽量给出推荐倾向。

## Review Checklist

**验收清单硬性规则（对应 `spec.md` 第 6 节）：**

- 验收清单每项必须有唯一 `AC-xxx`，并引用至少一个在第 4 节中真实定义的需求 ID。
- 允许引用的需求类型为 `FR/DR/TR/IR/UX/NFR`。**不强制每条 AC 都引用 FR**——
  纯可靠性、Trace、UX 验收可能只对应 NFR/TR/UX。
- 进入 `review` 前必须回填仓库内真实存在的测试文件；标记 `done` 前还必须勾选。
- 唯一格式为：

  ```markdown
  - [ ] **AC-001** (`FR-001`, `NFR-002`): 可观察行为 — tests: `server/tests/integration/example.test.ts`
  ```

- `draft`、`ready-for-development`、`in-progress` 阶段允许 `tests:` 暂缺；此时 AC
  仍须有合法 ID、需求引用和可观察行为，不能等实现完成后才补写验收标准。
- 不新增独立追踪表、不引入 JSON 真相源。门禁只验证元数据和证据引用一致，不证明
  测试真实覆盖了对应 AC。

在实现前检查：

- [ ] 这个 feature 是否只有一个主要 intent？
- [ ] `spec.md` 是否使用了 9 节固定结构，顶层标题未省略或改号？
- [ ] `spec.md` 是否定义了可测试的完成标准，且每条 AC 有唯一 `AC-xxx` 并引用第 4 节真实需求 ID？
- [ ] `spec.md` 第 8 节与 `design.md` 第 10 节是否用 `Q-xxx` / `DQ-xxx` checkbox 或单独 `无`？
- [ ] `design.md` 是否覆盖数据、API、UI、runtime、failure handling 中相关的部分？不适用章节是否写了 `不适用：<理由>`？
- [ ] `design.md` 的"待确认设计问题"章节是否已清空（所有条目已关闭并给出结论，或已转为 `tasks.md` 里的具体验证任务）？**未清空不得开始编码。**
- [ ] `tasks.md` 是否使用 6 节固定结构，Phase 只出现在第 2 节？
- [ ] `tasks.md` 是否能按顺序执行，并能追踪回 spec？
- [ ] `BACKLOG.md` 是否链接到该 feature 的 `spec.md`，且状态与 spec frontmatter 一致？

## Version Closure Rules（版本收口规则）

某大版本（如 0.1）全部 feature 状态为 `done` 后，执行逻辑收口，**不移动版本目录**：

1. 新建 `docs/features/releases/<version>.md`，汇总该版本交付的 feature 列表、每个
   feature 的 FR 摘要、已知限制与遗留项。数据来源：版本目录内各 `spec.md` + PRD；
   `BACKLOG.md` 不保存 done Feature，不能作为 release 数据源。
2. **保留版本原路径**，不在目录内增加 `README.md`，注明「该版本已收口，产品判断以
   `docs/personahub-prd.md` + `docs/features/releases/<version>.md` 为准；本目录仅作
   历史追溯」。这样既完成生命周期收口，也不破坏源码注释、测试、配置、文档和外部
   链接中的稳定路径。
3. 在 `docs/README.md` 的 releases 索引增加 `<version> → 收口于 <日期>`；BACKLOG
   删除该版本全部 done Feature。
4. 收口动作必须跑一遍 `npm run verify` 的门禁脚本，确认该版本所有 Feature 确实
   `done`，再写入 release 的 `closed_at` 元数据。版本目录收口后只允许修复历史错误
   或死链，不再追加新需求。
5. **复检该版本每个 `eval_contract: required` Feature 的退役信号**，在 release 文档里
   逐条写明「已触发 / 未触发 / 无法判定」；已触发的进入下一版本的删除候选。写一次就沉底
   的退役信号，本身就是「没有 consumer 的字段」——正是它要防的东西。

## Relationship To Other Docs

- `docs/personahub-prd.md`：产品真相源。Feature spec 必须服从 PRD。
- `docs/personahub-architecture.md`：全局架构设计。Feature design 不应绕过其中的 runtime / storage / adapter / safety 边界。
- `docs/personahub-system-design.md`：全局数据模型草案。Feature design 中的新字段或关系，稳定后应回写到这里。
- `BACKLOG.md`：active feature 索引，只记录状态和入口链接。

## Migration Note

第一次迁移（单文件 → 三件套）：

```text
docs/features/F001-workspace-issue-foundation.md
  ->
docs/features/F001-workspace-issue-foundation/spec.md
docs/features/F001-workspace-issue-foundation/design.md
docs/features/F001-workspace-issue-foundation/tasks.md
```

第二次迁移（按大版本分层）：

```text
docs/features/F001-workspace-issue-foundation/
  ->
docs/features/0.1/F001-workspace-issue-foundation/
```

F001-F005 分别对应 PRD 第 15 节 v0.1.0-v0.1.4，均已归到 `docs/features/0.1/` 下；`docs/features/0.1/ux-prototype.html` 是体现 v0.1 全版本交付效果的原型，和单个 feature-level 原型是两个东西。v0.2 从 F006 起继续递增编号，放在 `docs/features/0.2/` 下。
