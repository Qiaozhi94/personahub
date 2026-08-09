# PersonaHub 目录结构改造方案

> 创建：2026-08-10
> 背景：vibe coding 调研（github/spec-kit 125k★、Fission-AI/OpenSpec 64k★）后对照
> market-game-sim 项目结构，给本仓库的可落地改造计划。
> 原则：**只补缺口，不动已经有效的东西**。feature 三件套 + TEMPLATE、Fxxx 跨版本
> 编号、ADR、SOP.md 真实环境纪律、Review Checklist、BACKLOG 单一入口都是标杆级
> 实践，不在改造范围内。

## 0. 现状结论（为什么这样改）

本项目的 feature 目录体系（`docs/features/{0.1,0.2,0.3}/Fxxx/{spec,design,tasks}.md`）
已经具备 OpenSpec / spec-kit 的核心结构。对照 market-game-sim 与 OpenSpec 循环，
存在四个实质缺口：

1. **需求↔测试无可追踪性**：FR/AC 编号只存在于 spec.md 正文，没有任何机制检查
   「每个 AC 都被测试覆盖」或「spec 里的 FR 编号与 tasks 引用一致」。market-game-sim
   用 `traceability.json` + T607 校验锁死了这一点，本仓库全靠人工。
2. **CLAUDE.md 历史堆积**：当前 CLAUDE.md 把 F001~F008 每一轮的检视历史写进正文，
   文件已远超一个会话能高效消化的长度。每开一个 session 都要付这份上下文成本。
3. **Review 报告散落在 feature 目录**：`F005/` 下积累了 7+ 份 `code-review-report*.md`，
   只进不出。market-game-sim 的做法是收口进单一 `RETROSPECTIVE.md`。
4. **无版本收口仪式**：0.1 全部 done 后 `docs/features/0.1/` 会永远留在原地，
   没有「归档/合并真相」动作（OpenSpec 的 archive 环节缺失）。

## 1. 改造内容总览

| # | 改造 | 工作量 | 何时做 |
|---|------|--------|--------|
| 1 | spec.md 增加需求追踪表（含 TEMPLATE 同步） | 约 1~2 小时 | 现在（F008/v0.3 开始用） |
| 2 | CLAUDE.md 瘦身 + 复盘收口 | 约 1 小时 | 现在 |
| 3 | 版本归档仪式规则 | 约 30 分钟（规则）；2~3 小时（0.1 收口执行） | 规则现在立，执行在 0.2 完成后 |
| 4 | feature 状态门禁校验脚本 | 约 2~3 小时 + 测试 | 现在 |
| 5 | （可选）GitHub Actions 基线 CI | 约 1 小时 | 看需求 |

总投入约半天；#3 的执行大头在 0.2 之后。

## 2. 详细改造项

### 2.1 需求追踪表（对应总览 #1）

在 `docs/features/TEMPLATE/spec.md` 的 acceptance checklist 之后新增固定章节
「## Traceability」，并在 `docs/features/README.md` 的 spec 职责说明中同步：

```markdown
## Traceability

| FR/AC ID | 行为描述 | Scenario/检查位置 | 测试路径（实现后回填） |
|----------|----------|-------------------|------------------------|
| FR-004   | ……        | §x.y scenario 3    | server/tests/unit/….test.ts |
```

规则（写入 README）：

- 实现期间每完成一个 AC 的测试，立即回填「测试路径」列，不攒到最后；
- 标记 `done` 前，所有 AC 的测试路径必须非空（由 2.4 的门禁脚本校验）；
- 追踪表只登记 spec 里的 FR/AC 编号，**不**登记 tasks 内部的 T 编号（T 编号本身
  已在 tasks.md 里引用回 FR/AC）。

这一步补齐的是 market-game-sim `traceability.json` 的轻量版——不引入 JSON 真源和
生成脚本，用 markdown 表格 + 门禁校验即可，因为本项目 FR 数量级（每 feature 十几条）
不需要独立矩阵文件。

### 2.2 CLAUDE.md 瘦身 + 复盘收口（对应总览 #2）

1. 新建 `docs/reviews/RETROSPECTIVE.md`，格式仿照 market-game-sim：
   `## 循环 N: <范围>` 下记录周期、收尾状态、遗留项、修复清单，每条一行。
2. 把 CLAUDE.md 中 F001~F008 的**历史叙述段落**（「2026-07-25~26 又经过五轮独立
   检视…」这类）整体移入 RETROSPECTIVE.md，每轮压缩成 2~3 行摘要 + 指向原报告路径。
3. CLAUDE.md 只保留：项目一句话定位、当前 active feature 及状态（指向
   `docs/features/0.2/F008/`、`docs/features/0.3/README.md`）、结构索引、开发约定。
   目标长度：**现在的 1/5 以内**。
4. 约定写入 SOP.md：**以后每轮检视收尾时，向 RETROSPECTIVE.md 追加一条记录，
   不在 CLAUDE.md 正文写历史**。

收益：每个新 session 的上下文成本直接下降；历史可追溯性不降（RETROSPECTIVE 里有
指针回到完整报告）。

### 2.3 Review 报告收口（对应总览 #2 的一部分）

- feature 目录内只保留**当前进行中的** review 报告；一轮结束后摘要进
  RETROSPECTIVE.md，原报告移入 `docs/reviews/archive/`（注意：`docs/reviews/`
  目前在 `.gitignore` 里是本地-only，规则要写明归档动作同样在本机执行即可）。
- `docs/reviews/README.md` 说明两类文件的区别：`RETROSPECTIVE.md`（跨轮次摘要，
  常驻）vs `archive/`（原始报告，按需查证）。

### 2.4 feature 状态门禁校验脚本（对应总览 #4）

新建 `tools/check-feature-gates.mjs`（Node 项目，用 `node:fs` 即可，零依赖），
扫描 `docs/features/` 全部 feature，校验：

1. 三件套齐全（`spec.md` / `design.md` / `tasks.md`）。
2. `tasks.md` 中所有 checkbox 均为 `[x]` 时，feature 状态才是 `done`（反过来
   `done` 的 feature 不允许存在未勾选任务）。
3. `spec.md` 存在 Traceability 章节，且所有 AC 的「测试路径」列非空（仅对
   `done` 状态强制）。
4. `design.md` 不含未关闭的「待确认设计问题」（`[ ]` 未勾选项，仅对
   `ready-for-development` 及以上状态强制）。
5. `BACKLOG.md` 的活跃表与 feature 目录状态一致（表里 `done` 的必须从活跃表移出）。

配套测试：`tools/check-feature-gates.test.mjs`（node:test，零依赖），覆盖：

- 合法 feature 通过；
- 每种违规各一个负向用例（缺文件 / done 有未勾任务 / done 缺测试路径 /
  待确认问题未关闭 / BACKLOG 不一致）；
- 一个「多个 feature 同时存在」的批量用例（本项目规则：批量场景必须测）。

挂进 `package.json` 的 `scripts.check:features`，与 typecheck 同级。

### 2.5 版本收口仪式（对应总览 #3）

**规则（现在写入 `docs/features/README.md`）**：某大版本（如 0.1）全部 feature 状态
为 `done` 后，执行收口：

1. 新建 `docs/features/releases/0.1.md`：汇总该版本交付的 feature 列表、每个
   feature 的 FR 摘要、已知限制与遗留项（数据来源：各 spec.md 头部 + BACKLOG）。
2. `docs/features/0.1/` 目录整体移入 `docs/features/archive/0.1/`，目录内加
   `README.md` 注明「0.1 已收口，产品判断以 `docs/personahub-prd.md` + 发布摘要
   为准；本目录仅作历史追溯」。
3. BACKLOG.md 顶部加一条版本记录：`0.1 → 收口于 <日期>，见 releases/0.1.md`。
4. 收口动作纯文档，但必须跑一遍 2.4 的门禁脚本确认移入 archive 前所有 feature
   确实 `done`。

### 2.6 （可选）CI 基线（对应总览 #5）

本仓库目前没有 `.github/workflows/`。若接受外网 CI，建议最小集：

- `ci.yml`：`npm ci` → `typecheck` → `server`/`web` 测试 → `check:features`。
- 依赖锁版本（与 market-game-sim 的经验一致：CI 与本地工具版本漂移是最常见的
  「本地绿 CI 红」来源；`package-lock.json` 已存在，CI 用 `npm ci` 即天然锁定）。

这一步与目录结构改造无关，是顺带补齐的工程基线，可独立决定做不做。

## 3. 实施顺序（按依赖排）

1. **先做 #1**：TEMPLATE 加 Traceability 章节 + README 规则（约 1 小时）。
2. **再做 #2 + #3**：CLAUDE.md 瘦身、建 RETROSPECTIVE.md、写 review 收口规则
   （约 1 小时，纯文档，风险最低）。
3. **再做 #4**：门禁脚本 + 测试（约 2~3 小时），写完跑 `npm run check:features`
   与现有测试确认全绿。
4. **#5 规则部分与 #1~#4 同批提交**；执行部分（0.1 收口）等 0.2 的 F008 完成后
   单独做。
5. （可选）#6 独立提交。

## 4. 提交与验证要求

- 每个改造项同一提交内带配套测试（#4 的负向用例清单见上）。
- 提交前跑：typecheck、server/web 测试、`npm run check:features`、生产构建。
- CLAUDE.md 瘦身时同步更新「当前结构」索引，加入本方案文件链接与
  RETROSPECTIVE.md。

## 5. 不做的事（明确排除）

- 不引入 OpenSpec CLI / specify CLI（项目无此规模需求，且会增加运行时依赖）。
- 不改动 `docs/features/0.1/`、`0.2/` 现有目录名与 Fxxx 编号规则（编号跨版本连续
  是正确设计，BACKLOG 与大量交叉引用依赖它）。
- 不把 `docs/personahub-prd.md` / `-architecture.md` / `-system-design.md` 移入
  feature 体系（全局真相与 feature 增量分层是正确的）。
- 不把 `docs/research/` 纳入 git（本地-only 是刻意的，竞品分析不进版本库）。
