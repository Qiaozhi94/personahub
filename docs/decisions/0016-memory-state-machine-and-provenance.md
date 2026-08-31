---
topics: [decision, memory, state-machine, provenance, stance, retrieval, health, scope-control]
doc_kind: decision
status: accepted
created: 2026-08-31
---

# 0016: Memory 的状态治理机与来源包——把 0013 的 B 档变成一张表

## 背景

ADR 0013 裁定了「抄 clowder 的失败记录，不抄它的架构」，并把 typed truth + revision 归入 B 档「结构上采纳，实现按本项目规模」。但 B 档只说了**要建**，没说**长什么样**。本决策补上形状。

### 核查：clowder 的账本已刷新，结论未变

ADR 0013 引用的是 `memory-system-overview.md` 的 `2026-08-04` 快照。该文档已更新至 `as_of: 2026-08-15`，逐条复核后核心红灯一条未变：

| 环节 | 2026-08-04 | 2026-08-15 |
| --- | --- | --- |
| F152 durable supply | ❌ 产品链未闭 | ❌ 读写不同 store，generalizable mark 仍 404 |
| F256 utility | 🟡 `follow/use = 0` | 🟡 21 durable row / 56 hint，**`followed=0 / used=0`** |
| Write Opportunity Plane | 局部骨架 | 🟡 合同冻结，**runtime 零个 entry 迁移** |
| F296 Context Presentation | — | 🟡 合同冻结，**runtime 未实现** |
| 通用 derived view | — | 🟡 合同冻结，**generic propagation 未实现** |

因此 ADR 0013 第 3 节的 C 档（不采纳 14 层管线、Cue Plane、主动写入、向量检索、拟人身份）继续有效，本决策不推翻它。

### 本决策的输入：一次逐项核定

使用者在通读 clowder 记忆系统全部架构文档后，逐项给出了借鉴清单。核定结果：4 项直接采纳、4 项改造后采纳、1 项降级、3 项确认不采纳。改造与降级的理由写在下面各条里，不单列。

**关键的三处改造**（与使用者原始提法不同，理由在对应条款）：

- 归属**不新增 `collection_id`**，用 `scope_type + scope_id` 两列——新增独立字段会与 ADR 0012 已有的 Project / Space 归属构成第二套坐标，正是 0013 A 档第二类病（拓扑分裂）的出生方式。
- 混合检索**分三阶段**，第一阶段**不上向量**——`sqlite-vec` 是 native extension，与本项目「本地个人工具、Windows 优先」的形态冲突，且 PRD 第 15 节已定第一阶段不上向量。
- 知识图谱**只做一跳邻居与写入时防悬空**，全局可视化降级——clowder 真正在用的是 `graph_resolve(anchor, depth=1)`，全局图在个人规模（数百条）下是毛球。

## 决策

### 1. 主状态机：六态，迁移函数是唯一入口

```text
                  ┌──reject──▶ rejected（终态）
   proposed ──────┤
                  └──accept──▶ active ◀──revalidate──┐
                                 │  ▲                │
                     evidence_broken │                │
                                 ▼  └──reactivate──┐ │
                              suspect ─────retire──┼─┼──▶ retired ──forget──▶ forgotten（终态）
                                 │                 │ │        ▲
   active ───────────retire──────┼─────────────────┘ │        │
                                 └───────────────────┴────────┘
```

| 状态 | 含义 | 可召回 |
| --- | --- | --- |
| `proposed` | 由验收事件生成的候选，等用户裁决 | 否 |
| `rejected` | 用户否决。**保留不删**，用于抑制重复提议 | 否 |
| `active` | 在库，参与召回与上下文装配 | 是 |
| `suspect` | 支撑证据失效，暂停召回，等复核 | 否 |
| `retired` | 仍真但已翻篇，移出召回，保留 provenance。**可逆** | 否 |
| `forgotten` | payload 已清空，只留 tombstone（证明它存在过及为何不可再取回）。终态 | 否 |

四条硬规则：

1. **`forgotten` 只能从 `retired` 进入。** 遗忘是两步操作，不接受从 `active` 一步删除。
2. **`supersede` 不是状态，是 `retire` 的一种。** 被替代时置 `state='retired'` 且 `superseded_by` 指向新条目——三个动词各治一病（`suspect` 治「可能不再真」、`retired`+`superseded_by` 治「被替代」、纯 `retired` 治「仍真但已翻篇」），但只占一个状态列。
3. **所有迁移只能经 `transitionMemory()` 一个函数。** 业务代码禁止直接 `UPDATE memories SET state = ...`；非法迁移抛错。
4. **`proposed` 不得永久悬挂。** 超过阈值未裁决的候选进健康度视图的「未裁决积压」，不静默沉底。

这四条来自 clowder Standing Reflex Contract v1 的硬不变量（`delivered` 不算判断完成、`abstain` 不是失败、一次 observation 只生成一份可独立裁决的 proposal），按本项目规模收缩后保留。

### 2. `stance` 是正交轴，走独立迁移，同样留痕

`stance` 的三个取值、`type × stance` 白名单与「`claimed` 不进验证类上下文」的硬规则由 ADR 0013 第 1.2 / 1.2.1 条拥有，本决策不重复定义，只补迁移形式：

```text
claimed ──verified_by──▶ verified ──user_confirms──▶ confirmed
   ▲                         │                            │
   └────evidence_revoked─────┴────confirmation_withdrawn───┘
```

`stance` 与 `state` 分别记入 `memory_revisions` 的两条轴，**不合并**——合并会产生 6 × 3 的组合爆炸，且「它什么时候变成 verified 的」与「它什么时候被退役的」是两个独立问题。

### 3. 类型化来源包：三组字段，全部 `NOT NULL`

PRD 第 5 节已有 provenance 组（`source_issue_id` / `source_thread_id` / `source_event_ids` / `author agent` / `evidence reference`）。本决策补两组，取自 clowder stance collapse 复盘的字段下限，按本项目场景收缩：

**`origin_type`（这句话在什么身份下产生）**——clowder 列了 9 个值（含 `leader_request` / `work_deliverable` / `roleplay`），那是它的场景。本项目是单用户 + 有验收的任务，收缩为三个：

| 值 | 含义 |
| --- | --- |
| `user_direct` | 用户在 Issue / Thread 里直接说的 |
| `agent_output` | 某个成员执行产出的 |
| `external_doc` | 从 Artifact 或外部文档引入的 |

**`usage_policy`（这条最多允许被怎么用）**：

```yaml
auto_inject: never | only_as_candidate | confirmed_only
dangerous_if_used_for: [user_preference, project_baseline, validation_context]
```

`auto_inject` 的默认值是 `only_as_candidate`。它与 ADR 0013 第 5 条（不做主动供给）一致：字段的存在不是为了打开自动注入，而是为了让「哪些绝对不能自动进上下文」在数据层可判，而不是靠调用方自觉。

**执行方式是本条的重点**：这些列必须 `NOT NULL`，且只能由写入函数填。clowder 的教训是它把字段下限写进了 Design Gate 文档，然后 A2 / A9 照样写到分裂的 store 里去了——**文档约定挡不住第二类病**。

### 4. 删除 `confidence`，拆成三个互不替代的轴

PRD 第 5 节与 `personahub-system-design.md` 现有 `confidence` 字段，语义含混。按 clowder F263 Phase A（删除歧义的 rank-derived `confidence`）与 F188 AC-J1（`authority` / `verified_at` / `usage_signal` 三层互不替代）的双重教训，拆为：

| 轴 | 字段 | 回答 | **不回答** |
| --- | --- | --- | --- |
| 背书 | `stance` | 谁为这条背书 | 它被用过几次 |
| 验证 | `verified_at` | 何时发生过显式验证事件 | 它现在是否相关 |
| 使用 | `reference_count` / `last_referenced_at` | 它被引用过几次、最近一次何时 | 它是否为真 |

**硬规则：`reference_count` 不得写入 `verified_at`，也不得提升 `stance`。**「常被引用」不等于「是真的」——这是 clowder M14 与 AC-J8 的同一条边界，也是本项目 ADR 0010「证据覆盖不等于验证通过」在记忆层的延伸。

### 5. 归属用 `scope_type + scope_id`，不设 `collection_id`

```sql
scope_type TEXT NOT NULL,   -- 'project' | 'space'；未来团队协作加值不加列
scope_id   TEXT NOT NULL
```

理由：ADR 0012 已定 Project / Space 三层归属，Memory 归 Project。若新增 `collection_id`：

- 当 `collection_id == project_id` 时，同一概念两个列名，是拓扑分裂的出生方式；
- 当两者不等时，需要先回答「团队协作时一条记忆归项目还是归集合」，而这个问题当前没有答案，预留一个语义未定的字段等于预埋一次迁移。

联邦检索的形状（每个 scope 独立查 → scope 级融合 → 按敏感度过滤）在这个 schema 下完全成立。按 ADR 0008，**第一版写成一个接受 `scope[]` 的函数，不抽 Provider 接口**；出现第二类 scope 且行为确有差异时再抽。

### 6. 五类病自检表：第五类落门禁，其余四类是检查表

ADR 0013 A 档 1.1 的五类病检查表在此获得执行方式，闭掉 0013「没有强制执行手段」这条未闭合项：

| 病 | 执行强度 |
| --- | --- |
| 一、触发器缺失 | 人工检查表（新增写入路径时逐条问） |
| 二、拓扑分裂 | 人工 + 架构评审（本决策第 5 条是它的一次预防） |
| 三、索引盲区 | 人工 |
| 四、易失写入 | 人工 |
| **五、失败无观测** | **落成 `npm run verify` 的一条 lint** |

第五类可机器判定，其余四类需要判断，因此只有它进门禁。规则范围限定在记忆写入路径：禁止空 `catch`、`catch { continue }`、以及只 `log` 不抛不计数的失败处理。clowder 第五类病的三个样本全是这个形态（`catch{continue}`、null fail-open、失败仅 log）。

**本项目自身的写入拒绝同样受此约束**：违反 `type × stance` 白名单或非法状态迁移的写入请求被拒绝时，必须落一条拒绝记录（尝试的类型、stance、迁移、来源、时间），不允许静默丢弃。

### 7. 检索分三阶段，向量是第二个 provider 不是第一版内容

| 阶段 | 内容 | 触发条件 |
| --- | --- | --- |
| **一** | SQLite FTS5（`trigram` tokenizer）+ 治理列排序 + 单路也走融合接口 | 立即 |
| **二** | 实体 / 别名解析（Issue 编号、Artifact 路径、成员名的同一性） | 记忆量到达可观察规模后 |
| **三** | 向量召回作为第二路 provider，两路 RRF 融合 | 出现真实召回缺口证据后 |

**第一阶段不上向量**的理由：`sqlite-vec` 是 native extension（每平台一份二进制），clowder 的 embedding 是独立 GPU HTTP 服务——两者都与「本地个人工具」的分发形态冲突；PRD 第 15 节已明确个人版第一阶段不上向量。第三阶段按 ADR 0008 接入：向量是同一个召回 seam 的第二个 provider，消费方不写 provider 分支。

**第一阶段必须做对的两件事**（比向量重要）：

1. **中文分词**。FTS5 默认 `unicode61` 对中文近似按字切。clowder 为此打了两个补丁（长查询强弱 token 分级、CJK 查询给向量路 1.5 倍投票权）。本项目直接用 SQLite 内置的 `trigram` tokenizer 绕开该问题；可用性在实现时以一行验证确认，不可用则退回 clowder 的强弱 token 方案。
2. **治理列排在相关性之前**。这是 clowder 检索管线第 2 层 SQL 里最值钱的三行，成本近零：

   ```sql
   ORDER BY (superseded_by IS NOT NULL),
            (state IN ('retired', 'suspect')),
            authority_rank,      -- 由 type × stance 派生，不是独立字段
            bm25(...)
   ```

   **时态与背书排在匹配度之前**，直接对应 ADR 0010「证据覆盖不等于验证通过」。

融合层第一版即写成 RRF 形状（`score = Σ 1/(k + rank_i)`，`k = 60`），即使只有一路。理由是 RRF 不需要对齐各路的分数量纲，接入第二路时消费方零改动。

### 8. 关系用三列边表，写入时防悬空，不做全局图可视化

```sql
CREATE TABLE memory_edges (
  from_id  TEXT NOT NULL,
  to_id    TEXT NOT NULL,
  relation TEXT NOT NULL,
  PRIMARY KEY (from_id, to_id, relation)
);
```

三列、无 id、无时间戳——**边是可重建的投影，不是真相源**。

**写入时做 canonical 解析**：所有建边路径统一经同一个 target resolver，目标不存在则拒绝建边并计数。clowder 是先积累了 `201` 条 orphan edges，才回头做一次性 migration + 写入侧 prevention（F188 AC-J5）；本项目直接从 prevention 开始。

**界面上第一版只做一跳邻居**：Memory 详情页展示「引用了 / 被引用」两组列表，深度固定 1。全局图可视化推迟到记忆量超过 500 条、或出现「我想看这个 Project 的知识结构」这一真实诉求之后。clowder 自己的 `graph_resolve` 也把 `depth` 默认设为 1，并注明「深度 ≥2 时 fan-out 容易上百」。

### 9. 健康度视图：四个指标，每个必须配可执行动作

本决策把健康度视图的优先级排在检索增强之前。理由是 clowder 用数字证明的：Health Dashboard 上线后，使用者**第一次在日常路径看到真实债务**——`201` 条 orphan edges、`724` 篇 unverified docs。这些债务在指标出现之前一直存在且无人知晓。**健康度视图是唯一能在写侧真正坏掉之前发现它坏了的东西**，它是第五类病（失败无观测）的读侧对偶。

| 指标 | 定义 | 配套动作 |
| --- | --- | --- |
| 过期 | `state='suspect'`，或支撑证据的 Artifact revision 已变 | 重新验证 / 转 `retired` |
| 孤立 | 无入边无出边，且 N 天未被引用 | 批量 `retire` 的 dry-run |
| 冲突 | 同 `scope` 同 `type` 下内容高度相似但 `stance` 不一致 | 并排展示 → 选一条 `supersede` 另一条 |
| 未验证债 | `stance='claimed'` 且创建超过 N 天 | 升级到 `verified` 或 `retire` |
| 未裁决积压 | `state='proposed'` 且超过阈值 | 批量裁决入口 |

**硬规则：每个指标必须配一个 dry-run + apply 的修复动作。** clowder Phase J 的结论原文是「指标可信以后，系统必须告诉猫如何治理，而不是把数字扔给 operator」。只显示数字不给动作的健康视图是债务展览馆。

自动修复只对 dry-run 能证明安全的项执行；语义冲突与事实判断一律留给用户。

## 明确不做的事

- **不做 14 层检索管线。** 但其中三个判断单独采纳，已写入第 7 / 4 条：治理列排在 BM25 之前、高背书条目不因低引用沉底、输出拆成互不替代的多轴。
- **不做 person memory、拟人身份、私人主动性。** PRD 第 5 节已定「不做强拟人包装」。**注意不要误伤**：clowder M17「写入是反射」对应到本项目是「验收事件自动生成 candidate」，这条 ADR 0013 第 4 条已采纳，不属于私人主动性。
- **不做「给 Memory 做摘要」。** 提出该设想时的用途是「给记忆做一层摘要以便快速浏览」，核定后不采纳，理由有三：

  1. 本项目的 Memory 本来就是短条目（一条 lesson 数句话）。**在短条目之上再压一层，压缩收益接近零，失真风险却是全额的。**
  2. 它同时命中 clowder 反模式博物馆的两条展品：G3「小模型摘要当召回面」——没被摘中的细节成为「存储上存在、检索上不存在」的幽灵；G9「belief laundering」——摘要出现在浏览位后获得「像既有认知」的权威外观，而 provenance 的样子替代了 provenance 本身。
  3. 它违反 M11 的 allowed-use ceiling：**有损产物可以站导航位与排序位，不能站内容位**。而「便于快速浏览」这个用途恰恰要求它站在内容位。

  真要解决「记忆太多不好浏览」，正确的方向是**第 7 条的检索**与**第 9 条的健康度治理**（退役、遗忘、合并冲突），而不是再造一层不可回源的派生正文。

  clowder 的 `summary_segments` schema（`level` / `from_message_id` / `supersedes_segment_ids` / `model_id` / `prompt_version`）本身写得好，尤其后两列使得换模型或改 prompt 后可重算、旧的不删。但它在 clowder 属于 **Thread 上下文压缩**，与 Memory 是两个域；且 A10 digest 链正是其五类病中「失败静默」的主样本。若本项目日后要做 Thread 压缩，那是一个独立议题，不进 Memory 域。**本决策不为摘要预留任何字段。**
- **不做主动供给 / Cue 投影。** ADR 0013 第 5 条已定，不改。
- **不新增 `collection_id`。** 见第 5 条。

## 已知未闭合项

**「冲突」指标的判定方式未定。** 第 9 条给的是「同 scope 同 type 内容高度相似但 stance 不一致」，其中「高度相似」在第一阶段只有 FTS 可用，会同时产生假阳与假阴。第一版把它做成候选列表交人工判断，不做自动合并。

**`origin_type` 三值可能不够。** 收缩自 clowder 的九值。若出现「用户转述了外部观点」这类混合情形，正确做法是新增一个值，而不是复用 `user_direct`——后者会重演 stance collapse 的 FM-01（提到过 = 认可）。

**`usage_policy` 目前无消费方。** ADR 0013 第 5 条不做主动供给，因此 `auto_inject` 字段在第一版没有任何读取者。这是刻意的：字段先存在并被强制填写，等到真的出现自动装配路径时它已有历史数据，而不是那时才补字段、把存量记忆全填成默认值。**但这意味着它的正确性在第一版无法被验证**，不得声称它已经在保护什么。

**`trigram` tokenizer 的可用性未验证。** 依赖 `better-sqlite3` 打包的 SQLite 是否启用 FTS5 与 trigram，实现时以一行脚本确认，不在本决策里假定。

**健康度阈值（N 天）全部未定。** 孤立、未验证债、未裁决积压三个指标都带一个时间阈值，当前没有任何使用数据可以据以设定。第一版取一个明显保守的值并允许调整，不声称它经过校准。

## 后果

- **收益一**：ADR 0013 的 B 档从「要建 typed truth + revision」变成一张可以直接建的表。状态机、来源包、归属列、边表四者的形状确定后，Memory 可以作为一个 Feature 排期。
- **收益二**：`confidence` 被拆成 `stance` / `verified_at` / `reference_count` 三轴，消掉了一个含混字段。库里出现一条记忆时，「谁背书」「何时验证过」「被用过几次」三个问题分别有答案，且互相不能顶替。
- **收益三**：第五类病落成 lint，闭掉 ADR 0013 的一条未闭合项。这是本项目唯一一条**在自己身上执行 clowder 教训**的门禁。
- **收益四**：健康度视图被提到检索增强之前。按 clowder 的经验，这是唯一能证明写侧没坏的机制；而写侧失灵正是 clowder 投入一年后仍未闭合的核心问题。
- **成本**：状态机 + revision + 拒绝记录 + 边表是四张表与一个迁移函数，是真实工作量。健康度视图的每个指标都要配 dry-run + apply，成本约等于指标本身的两倍——这是刻意付的账。
- **不承诺**：本决策不声称这套设计会让记忆好用。它承诺的只有两件事——不重复 clowder 已知的五类写侧失灵，以及在它真的失灵时能被看见。
- **对 PRD 的影响**：第 5 节 Memory 需增加 `state` / `origin_type` / `usage_policy` / `scope_type` / `scope_id` / `superseded_by` / `verified_at` / `reference_count`，删除 `confidence`；第 9 节需增加 Memory 状态机。本决策不代改 PRD。

## 关联

- 依赖：`0013-memory-borrowing-boundary.md`（借鉴边界、`stance` 定义、`type × stance` 白名单、五类病检查表、写入触发器限定为验收事件）
- 依赖：`0012-object-model-simplification.md`（Project / Space 归属，`scope_type` 的取值来源）
- 依赖：`0010-claim-evidence-structure.md`（主张生命周期即写入触发器；「证据覆盖不等于验证通过」）
- 依赖：`0008-capability-seam-convention.md`（向量召回与联邦查询何时才配抽 Provider）
- 约束：`0011-disable-native-agent-memory.md`（adapter 原生 memory 是不受控的第二来源，默认关闭）
- 约束：`../personahub-prd.md` 第 5 节 Memory、第 9 节状态机
- 证据：`zts212653/clowder-ai` 的 `docs/architecture/memory-system-overview.md`（闭环账本 `as_of: 2026-08-15`）、`memory-write-side-autopsy-2026-07.md`（五类病与 12 条路径 verdict）、`cloud-memory-stance-collapse-postmortem-2026-07.md`（字段下限与 10 个 failure mode）、`memory-standing-reflex-contract.md`（状态机硬不变量）、`memory-derived-view-contract.md`（`fresh/suspect/invalidated` 三态）、`retrieval-pipeline-deep-dive.md`（治理列排序、RRF、CJK 补丁）、`docs/features/F188-library-stewardship.md`（健康度视图与 Phase J 治理教训）
