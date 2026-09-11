# 检视复盘记录

> 每完成一个检视循环(`stop_condition_met` 全部满足)追加一条,不建立新文件。
> 循环进行中的报告见 `docs/reviews/CURRENT-doc.md` / `CURRENT-code.md`,或对应
> feature 目录下的同名文件(按 `report_type` 分文件,同一时间可以有多个并行)。
>
> **本文件保留每一轮的具体发现标题+严重度**,不只是模式性叙述或计数——
> 项目结束后复盘要能回答"某个具体问题当时是怎么发现的",只有严重度计数
> 回答不了这个。少数标 `⚠️原文件已丢失` 的条目是本文件重写前已被删除且
> 从未进入 git 历史的文件,细节永久丢失,只保留当时记录下的计数/摘要。
>
> **统一用一张表格式**(ID|标题|严重度|分类|根因/症状|来源|状态|修复方案|
> 回归测试|首次出现轮次|修复轮次|模式标签),批量条目和被点名的"复现模式"案例
> 用同一张表,不再区分"完整/轻量"两种格式。没有把握精确判断的字段(比如原始
> 文件已删除、无法逆向还原具体修复轮次或来源分类的)填 `—` 占位,不编造看起来
> 精确实则可能错的数据。
>
> **`CURRENT-doc.md` / `CURRENT-code.md` 只能由检视人(reviewer)在复核完成后
> 删除,执行修复的一方不得自行删除**——哪怕修复者已经把 issue 表原样追加进本
> 文件、自认为"已经闭环"。执行者和检视人是协议里两个独立视角,自己批准自己的
> 修复等于取消了这层制衡;实践中也确实发生过"刚写完修复就顺手删掉检视文档"
> 的情况,一旦复核发现修复不完整就无据可查。同一个 agent 同会话内先后扮演
> 两个角色时,也要显式切换视角重新核对一遍再删,不能把"刚写完"当"已复核"。
> 完整规则见 `~/.agents/skills/review-convergence/SKILL.md` 第 8 节。

---

## 循环 0: 顶层架构评审(v0.1 编码前)

- **report_type**: doc-review
- **周期**: 2026-07-12,单轮 · **状态**: 已归档(`superseded: 2026-08-01`,内容被
  循环3吸收)
- **⚠️ 死链**: 原文件 `superseded_by` 指向仓库根目录一份已不存在的
  `code-review-report.md`,应指向循环3
- **五项主要问题**: escalation 执行模型落不了地、workspace 锁无 stale 恢复、
  `AgentAdapter` 抽象太薄、事件流缺 cursor/replay、Artifact 无落点

---

## 循环 1: F003/F004/F005 规格三件套设计检视

- **report_type**: doc-review
- **周期**: 2026-07-16,同一文件内3轮(初审→回填→复核→回填) · **状态**: 已闭环
- **⚠️ 原文件已丢失**(`design-review-F003-F004-F005.md`,从未进 git):第一轮6项
  全部落地,第二轮新发现3项细化点回填后关闭,原始9项具体标题未能保留
- **已知具体模式**: F004↔F005 跨 feature 契约冲突(nullable role 与 DB NOT NULL、
  validator 上下文该绑定哪个 Run)——本项目"跨文档契约不同步"最早先例

---

## 循环 2: 单次代码检视(commit `51c39df`)

- **report_type**: code-review
- **周期**: 2026-07-16,单轮 · **范围**: F001/F002 两份新增 UI flow 测试文件
- **状态**: 已闭环,"质量良好可以合入",无阻塞项
- **⚠️ 原文件已丢失**:已知内容是 mock/fixture 重复、未使用 import、
  happy-path-only 覆盖等 P1-P3 建议,均非阻塞

---

## 循环 2b: v0.1→v0.2 过渡入口检视

- **report_type**: code-review
- **周期**: 2026-08-01,单轮 · **范围**: 全仓库状态快照(不针对具体feature)
- **状态**: 已闭环,以"全部已修复"姿态呈现
- **⚠️ 原文件已丢失**(`code-review-2026-08-01-v02-entry.md`):Findings表格本身
  就是 Resolved 回顾表,具体条目未能保留

---

## 循环 3: v0.2 F006/F007/F008 需求文档检视(6轮,109条发现)

- **report_type**: doc-review
- **周期**: 2026-08-01 → 2026-08-02(密集连续同一天到次日) · **状态**: 已闭环,
  但**从未有一份报告文件自己宣布"全部关闭"**——真正的闭环证据是6轮之后再无
  新检视 commit,直接转入实现阶段(`7799603`)
- **⚠️ 流程缺陷(长期记忆)**: 完全依赖单人连续输出,靠 commit message 数字对账
  ("采纳第N轮检视M条")确认改动对应关系,**没有一次独立验证"改的内容是否真的
  解决了问题"**——与循环4(F006实现)的"自述vs独立复核"显式区分形成对比

### 第1轮(`v02-requirements.md`,10H/10M)— commit `b024220` 采纳关闭

| ID | 标题 | 严重度 | 分类 | 根因/症状 | 来源 | 状态 | 修复方案 | 回归测试 | 首次出现轮次 | 修复轮次 | 模式标签 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| v02-r1-01 | F006 result refs cannot deliver predecessor output as designed | 🟠 | correctness | root-cause | original-coding | fixed | — | — | 1 | 1 | — |
| v02-r1-02 | Existing escalation cancels queued graph siblings, contradicting documented recovery model | 🟠 | correctness | root-cause | original-coding | fixed | — | — | 1 | 1 | — |
| v02-r1-03 | F006 has no complete cancellation transition or recovery path | 🟠 | correctness | root-cause | original-coding | fixed | — | — | 1 | 1 | — |
| v02-r1-04 | Graph initialization and terminal advancement not atomic/recoverable from partial writes | 🟠 | correctness | root-cause | original-coding | fixed | — | — | 1 | 1 | — |
| v02-r1-05 | F007 cannot make a graph use the adapter/roster confirmed by the user | 🟠 | correctness | root-cause | spec-drift | fixed | — | — | 1 | 1 | — |
| v02-r1-06 | F007 incorrectly equates two independently scheduled nodes with two available adapters | 🟠 | correctness | root-cause | original-coding | fixed | — | — | 1 | 1 | — |
| v02-r1-07 | Intake confirmation is neither idempotent nor failure-atomic | 🟠 | correctness | root-cause | original-coding | fixed | — | — | 1 | 1 | — |
| v02-r1-08 | `setStatus(active)` can create multiple active templates, bypass safe activation transaction | 🟠 | correctness | root-cause | original-coding | fixed | — | — | 1 | 1 | — |
| v02-r1-09 | Invalid `steps_json` can be saved and activated without a defined gate | 🟠 | correctness | root-cause | original-coding | fixed | — | — | 1 | 1 | — |
| v02-r1-10 | Required template audit event has no valid Thread or actor model | 🟠 | correctness | root-cause | spec-drift | fixed | — | — | 1 | 1 | — |
| v02-r1-11 | F006 schema omits referential and active-attempt invariants required by spec | 🟡 | correctness | root-cause | original-coding | fixed | — | — | 1 | 1 | — |
| v02-r1-12 | Fixed Edge definition does not yet satisfy ADR 0006's first-class Edge contract | 🟡 | correctness | root-cause | spec-drift | fixed | — | — | 1 | 1 | — |
| v02-r1-13 | NodeRun status timing is underspecified | 🟡 | quality | root-cause | original-coding | fixed | — | — | 1 | 1 | — |
| v02-r1-14 | Graph definition version retention is assumed but not guaranteed | 🟡 | correctness | root-cause | original-coding | fixed | — | — | 1 | 1 | — |
| v02-r1-15 | Recommendation freshness not fully specified for adjusted choices | 🟡 | quality | root-cause | original-coding | fixed | — | — | 1 | 1 | — |
| v02-r1-16 | "Complete Issue fields" has no deterministic rule contract | 🟡 | quality | root-cause | original-coding | fixed | — | — | 1 | 1 | — |
| v02-r1-17 | `stale_lock_suspected` does not match actual stale-lock cleanup semantics | 🟡 | correctness | root-cause | spec-drift | fixed | — | — | 1 | 1 | — |
| v02-r1-18 | `queue_starved` will flag intentionally ineligible queues as broken | 🟡 | correctness | root-cause | original-coding | fixed | — | — | 1 | 1 | — |
| v02-r1-19 | Health API lacks concrete scope, cannot reach one promised metric as designed | 🟡 | quality | root-cause | original-coding | fixed | — | — | 1 | 1 | — |
| v02-r1-20 | All three feature designs missing required end-to-end API contracts despite `ready-for-development` | 🟡 | quality | symptom-patch | process-gap | fixed | — | — | 1 | 1 | marked-done-not-implemented |

### 第2轮(`v02-recheck.md`,13H/16M/1L)— commit `699060d` 采纳关闭

| ID | 标题 | 严重度 | 分类 | 根因/症状 | 来源 | 状态 | 修复方案 | 回归测试 | 首次出现轮次 | 修复轮次 | 模式标签 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| v02-r2-01 | F007 both forbids and requires persistence during recommendation | 🟠 | correctness | root-cause | original-coding | fixed | — | — | 2 | 2 | — |
| v02-r2-02 | `recommendation_id` collides for different goals, not claimed by PK | 🟠 | correctness | root-cause | original-coding | fixed | — | — | 2 | 2 | — |
| v02-r2-03 | Confirmed graph execution plan absent from F006, cannot survive until synthesis | 🟠 | correctness | root-cause | spec-drift | fixed | — | — | 2 | 2 | — |
| v02-r2-04 | Confirmation and execution services have incompatible transaction ownership | 🟠 | correctness | root-cause | spec-drift | fixed | — | — | 2 | 2 | — |
| v02-r2-05 | Mandated `AdapterResolver` cannot enforce node capabilities | 🟠 | correctness | root-cause | original-coding | fixed | — | — | 2 | 2 | — |
| v02-r2-06 | F008 exposes template fields whose edits have no defined runtime effect | 🟠 | correctness | root-cause | original-coding | fixed | — | — | 2 | 2 | — |
| v02-r2-07 | "one active graph per Issue" index excludes recoverable blocked graphs | 🟠 | correctness | root-cause | original-coding | fixed | — | — | 2 | 2 | — |
| v02-r2-08 | Graph blockers do not all have a usable recovery transition | 🟠 | correctness | root-cause | original-coding | fixed | — | — | 2 | 2 | — |
| v02-r2-09 | Queued cancellation has no lifecycle seam for documented NodeRun transition | 🟠 | correctness | root-cause | original-coding | fixed | — | — | 2 | 2 | — |
| v02-r2-10 | F007 marked ready while required API design is explicitly unfinished | 🟠 | quality | symptom-patch | process-gap | fixed | — | — | 2 | 2 | marked-done-not-implemented |
| v02-r2-11 | Synthesis NodeRun created both at graph start and again at join | 🟠 | correctness | root-cause | original-coding | fixed | — | — | 2 | 2 | — |
| v02-r2-12 | Recovery cannot repair a swallowed failure of terminal transaction one | 🟠 | correctness | root-cause | original-coding | fixed | — | — | 2 | 2 | — |
| v02-r2-13 | Graph success/failure finalization not defined as atomic transition | 🟠 | correctness | root-cause | original-coding | fixed | — | — | 2 | 2 | — |
| v02-r2-14 | F008 does not structurally protect template version/active-version uniqueness | 🟡 | correctness | root-cause | original-coding | fixed | — | — | 2 | 2 | — |
| v02-r2-15 | Template mutation and audit insertion not explicitly one transaction | 🟡 | correctness | root-cause | original-coding | fixed | — | — | 2 | 2 | — |
| v02-r2-16 | Invalid current template prevents activating its valid repair | 🟡 | correctness | root-cause | original-coding | fixed | — | — | 2 | 2 | — |
| v02-r2-17 | `intake_confirmations` lacks lifecycle/referential/retention rules | 🟡 | quality | root-cause | original-coding | fixed | — | — | 2 | 2 | — |
| v02-r2-18 | Recommendation staleness ignores capability changes | 🟡 | correctness | root-cause | original-coding | fixed | — | — | 2 | 2 | — |
| v02-r2-19 | Node-result truncation timing and storage bounds ambiguous | 🟡 | quality | root-cause | original-coding | fixed | — | — | 2 | 2 | — |
| v02-r2-20 | Graph-wide cancellation specified but no API/command task | 🟡 | quality | root-cause | original-coding | fixed | — | — | 2 | 2 | — |
| v02-r2-21 | F007 spec still says a topology may require two executors | 🟡 | quality | symptom-patch | spec-drift | fixed | — | — | 2 | 2 | — |
| v02-r2-22 | `CLAUDE.md` still summarizes the disproved evidence design | 🟡 | quality | symptom-patch | spec-drift | fixed | — | — | 2 | 2 | — |
| v02-r2-23 | F006 recovery wording only scans running graphs despite recoverable blocked reasons | 🟡 | correctness | root-cause | original-coding | fixed | — | — | 2 | 2 | — |
| v02-r2-24 | Aggregate health loses workspace-specific adapter status | 🟡 | quality | root-cause | original-coding | fixed | — | — | 2 | 2 | — |
| v02-r2-25 | Schema health reports actual version without expected/mismatch diagnosis | 🟡 | quality | root-cause | original-coding | fixed | — | — | 2 | 2 | — |
| v02-r2-26 | Singular graph projection ambiguous when Issue has graph history | 🟡 | quality | root-cause | original-coding | fixed | — | — | 2 | 2 | — |
| v02-r2-27 | F008 blanket immutability conflicts with status activation/deactivation | 🟡 | correctness | root-cause | original-coding | fixed | — | — | 2 | 2 | — |
| v02-r2-28 | F008 relies on permissive parser for a strict activation gate | 🟡 | correctness | root-cause | original-coding | fixed | — | — | 2 | 2 | — |
| v02-r2-29 | "Adjust each item" exceeds UI and confirmation contract | 🟡 | quality | root-cause | original-coding | fixed | — | — | 2 | 2 | — |
| v02-r2-30 | Modified documents retain stale `updated` metadata | 🟢 | quality | symptom-patch | process-gap | fixed | — | — | 2 | 2 | — |

### 第3轮(`v02-recheck-2.md`,5H/11M)— commit `cd03f4c` 采纳关闭

| ID | 标题 | 严重度 | 分类 | 根因/症状 | 来源 | 状态 | 修复方案 | 回归测试 | 首次出现轮次 | 修复轮次 | 模式标签 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| v02-r3-01 | Self-contained confirmation token has no integrity protection | 🟠 | correctness | root-cause | fix-regression | fixed | — | — | 3 | 3 | — |
| v02-r3-02 | Graph creation both rejects invalid plan and persists recoverable blocked graph | 🟠 | correctness | root-cause | original-coding | fixed | — | — | 3 | 3 | — |
| v02-r3-03 | Capability failure downgrades to a sequential plan that is also incapable | 🟠 | correctness | root-cause | original-coding | fixed | — | — | 3 | 3 | — |
| v02-r3-04 | `result_unparsable` leaves NodeRun both completed and failed | 🟠 | correctness | root-cause | original-coding | fixed | — | — | 3 | 3 | — |
| v02-r3-05 | F008 tasks simultaneously allow and forbid repairing invalid active template | 🟠 | correctness | root-cause | fix-regression | fixed | — | — | 3 | 3 | — |
| v02-r3-06 | Confirmation state semantics unreachable/undefined inside one transaction | 🟡 | correctness | root-cause | original-coding | fixed | — | — | 3 | 3 | — |
| v02-r3-07 | `recommendation_id` and server truth source have three incompatible definitions | 🟡 | correctness | root-cause | fix-regression | fixed | — | — | 3 | 3 | — |
| v02-r3-08 | Fresh issuance metadata contradicts "identical result" determinism tests | 🟡 | test-coverage | root-cause | original-coding | fixed | — | — | 3 | 3 | — |
| v02-r3-09 | Confirm DTO does not couple topology to roster shape | 🟡 | quality | root-cause | original-coding | fixed | — | — | 3 | 3 | — |
| v02-r3-10 | Graph completion writes an undeclared sixth event type | 🟡 | correctness | root-cause | spec-drift | fixed | — | — | 3 | 3 | — |
| v02-r3-11 | Definition-unavailable recovery ordered after operations requiring the definition | 🟡 | correctness | root-cause | original-coding | fixed | — | — | 3 | 3 | — |
| v02-r3-12 | Graph projection and executor-recovery responses remain incomplete | 🟡 | quality | root-cause | fix-regression | fixed | — | — | 3 | 3 | — |
| v02-r3-13 | Join concurrency test asserts pre-created entity, not duplicated side effect | 🟡 | test-coverage | symptom-patch | original-coding | fixed | — | — | 3 | 3 | — |
| v02-r3-14 | New template versions have no specified source to inherit from | 🟡 | quality | root-cause | original-coding | fixed | — | — | 3 | 3 | — |
| v02-r3-15 | Several corrected F006 contracts still retain old wording | 🟡 | quality | symptom-patch | spec-drift | fixed | — | — | 3 | 3 | — |
| v02-r3-16 | `CLAUDE.md` still presents rejected evidence path as active F006 summary | 🟡 | quality | symptom-patch | spec-drift | fixed | — | — | 3 | 3 | — |

### 第4轮(`v02-recheck-3.md`,中文报告,6H/7M,用了H-01~M-07编号)— commit `502255a` 采纳关闭

| ID | 标题 | 严重度 | 分类 | 根因/症状 | 来源 | 状态 | 修复方案 | 回归测试 | 首次出现轮次 | 修复轮次 | 模式标签 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| v02-r4-H01 | F007确认表只允许写"最终事实",但确认流程仍要求先写不完整的认领行 | 🟠 | correctness | root-cause | original-coding | fixed | — | — | 4 | 4 | — |
| v02-r4-H02 | F006没有定义图节点的`Run.instructions`,节点职责和输出契约无法送入执行器 | 🟠 | correctness | root-cause | original-coding | fixed | — | — | 4 | 4 | — |
| v02-r4-H03 | 已确认的adapter只在建图时校验,延迟创建Attempt时没有资格复核和blocker产生点 | 🟠 | correctness | root-cause | original-coding | fixed | — | — | 4 | 4 | — |
| v02-r4-H04 | 新增的`assigned_adapter_config_id`外键没有接入现有adapter删除保护 | 🟠 | correctness | root-cause | original-coding | fixed | — | — | 4 | 4 | — |
| v02-r4-H05 | F008把版本继承来源与当前active版本混称为source,可能绕过关闭验证的确认门 | 🟠 | correctness | root-cause | original-coding | fixed | — | — | 4 | 4 | — |
| v02-r4-H06 | F006 blocker恢复矩阵仍保留被最终决策否定的状态转换 | 🟠 | correctness | symptom-patch | spec-drift | fixed | — | — | 4 | 4 | — |
| v02-r4-M01 | F007的HMAC密钥生命周期仍是二选一描述,没有可实现的配置契约 | 🟡 | quality | root-cause | original-coding | fixed | — | — | 4 | 4 | — |
| v02-r4-M02 | 整图取消没有定义数据库状态变更与外部进程取消的先后顺序 | 🟡 | correctness | root-cause | original-coding | fixed | — | — | 4 | 4 | — |
| v02-r4-M03 | F006对graph事件类型数量仍同时写5类和6类 | 🟡 | quality | symptom-patch | spec-drift | fixed | — | — | 4 | 4 | — |
| v02-r4-M04 | `resolve-executors`的幂等响应与blocker错误矩阵在running状态下冲突 | 🟡 | correctness | root-cause | original-coding | fixed | — | — | 4 | 4 | — |
| v02-r4-M05 | F007的响应DTO漏掉已经定义的阻塞错误码 | 🟡 | correctness | root-cause | original-coding | fixed | — | — | 4 | 4 | — |
| v02-r4-M06 | F007概览仍声称确认复用`RunDispatchService.dispatch()`,与已定的分流契约相反 | 🟡 | quality | symptom-patch | spec-drift | fixed | — | — | 4 | 4 | — |
| v02-r4-M07 | `BACKLOG.md`仍把F007依赖写成旧的`start(issueId, plan)`签名 | 🟡 | quality | symptom-patch | spec-drift | fixed | — | — | 4 | 4 | — |

### 第5轮(`v02-recheck-4.md`,6H/10M)— commit `e91f980` 采纳关闭

| ID | 标题 | 严重度 | 分类 | 根因/症状 | 来源 | 状态 | 修复方案 | 回归测试 | 首次出现轮次 | 修复轮次 | 模式标签 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| v02-r5-01 | F007可针对非默认workspace推荐,但确认创建的Issue永远落到默认workspace | 🟠 | correctness | root-cause | original-coding | fixed | — | — | 5 | 5 | — |
| v02-r5-02 | `resolve-executors`只改执行者和图状态,没有创建此前被刻意省略的Attempt | 🟠 | correctness | root-cause | fix-regression | fixed | — | — | 5 | 5 | — |
| v02-r5-03 | 新资格复核仍覆盖不到已经queued、尚未启动的前驱Attempt | 🟠 | correctness | root-cause | fix-regression | fixed | — | — | 5 | 5 | — |
| v02-r5-04 | 整图取消的DB-first协议与现有`cancelRun()` CAS/锁释放路径不兼容 | 🟠 | correctness | root-cause | original-coding | fixed | — | — | 5 | 5 | — |
| v02-r5-05 | F007外层事务只禁止提前drain,没有禁止事务内broadcast phantom ThreadEvent | 🟠 | correctness | root-cause | fix-regression | fixed | — | — | 5 | 5 | — |
| v02-r5-06 | 图推进"事务二"仍要求创建下游NodeRun,与全部预建模型正面冲突 | 🟠 | correctness | root-cause | fix-regression | fixed | — | — | 5 | 5 | — |
| v02-r5-07 | 已确认token超期后重放究竟返回200还是409未定义 | 🟡 | quality | root-cause | original-coding | fixed | — | — | 5 | 5 | — |
| v02-r5-08 | F007仍残留已删除的status模型和旧密钥来源 | 🟡 | quality | symptom-patch | spec-drift | fixed | — | — | 5 | 5 | — |
| v02-r5-09 | synthesis首次入队没有对应的`graph.node_queued`写入任务 | 🟡 | correctness | root-cause | original-coding | fixed | — | — | 5 | 5 | — |
| v02-r5-10 | `graph.completed`是否覆盖cancelled/blocked没有统一,payload又要求成功态专属字段 | 🟡 | correctness | root-cause | original-coding | fixed | — | — | 5 | 5 | — |
| v02-r5-11 | `graph.node_result`的256KB上限可被未受限的`not_reviewed`绕过 | 🟡 | correctness | root-cause | original-coding | fixed | — | — | 5 | 5 | — |
| v02-r5-12 | 目标文件glob缺少稳定排序、去重、路径安全与事务外预计算规则 | 🟡 | correctness | root-cause | original-coding | fixed | — | — | 5 | 5 | — |
| v02-r5-13 | `resolve-executors`所称"供审计"的reassigned只存在于HTTP响应 | 🟡 | quality | symptom-patch | fix-regression | fixed | — | — | 5 | 5 | — |
| v02-r5-14 | `CLAUDE.md`与schema摘要仍称F007只新增一张表 | 🟡 | quality | symptom-patch | spec-drift | fixed | — | — | 5 | 5 | — |
| v02-r5-15 | `stale_lock_suspected`的超时与宽限没有具体数值或配置来源 | 🟡 | quality | root-cause | original-coding | fixed | — | — | 5 | 5 | — |
| v02-r5-16 | Health UI任务仍写"三条派生判断",与DTO的九类diagnostics不一致 | 🟡 | quality | symptom-patch | spec-drift | fixed | — | — | 5 | 5 | — |

### 第6轮(`v02-recheck-5.md`,7H/7M)— commit `03ac1fb` 采纳关闭,此后转入实现

| ID | 标题 | 严重度 | 分类 | 根因/症状 | 来源 | 状态 | 修复方案 | 回归测试 | 首次出现轮次 | 修复轮次 | 模式标签 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| v02-r6-01 | `cancelling`未贯穿迁移任务与重启恢复,重启后图可永久卡住 | 🟠 | correctness | root-cause | original-coding | fixed | — | — | 6 | 6 | — |
| v02-r6-02 | "kill无返回"会绕过既有执行超时,当前验收无法由"不修改既有cancel路径"实现 | 🟠 | correctness | root-cause | original-coding | fixed | — | — | 6 | 6 | — |
| v02-r6-03 | `graph.terminal`把可恢复的`blocked`声明成终态,事件语义与状态机相互矛盾 | 🟠 | correctness | root-cause | original-coding | fixed | — | — | 6 | 6 | — |
| v02-r6-04 | 事务外预检未进入`createGraph`契约,F007也没有可执行的调用顺序 | 🟠 | correctness | root-cause | original-coding | fixed | — | — | 6 | 6 | — |
| v02-r6-05 | 冻结的`TargetFileSet`没有结构化真相源,延迟synthesis与重启恢复无法确定性重建指令 | 🟠 | correctness | root-cause | original-coding | fixed | — | — | 6 | 6 | — |
| v02-r6-06 | `resolve-executors`不知道究竟哪些节点被资格失败阻塞,且可能越过join提前创建下游Attempt | 🟠 | correctness | root-cause | fix-regression | fixed | — | — | 6 | 6 | — |
| v02-r6-07 | `cancelling`的API契约与并发守卫缺失,取消期间可能被retry/resolve反向恢复 | 🟠 | correctness | root-cause | original-coding | fixed | — | — | 6 | 6 | — |
| v02-r6-08 | `result_too_large`已称为第8个blocker,却未加入枚举清单与恢复矩阵 | 🟡 | quality | symptom-patch | spec-drift | fixed | — | — | 6 | 6 | — |
| v02-r6-09 | queued claim新增的`adapter_no_longer_eligible`没有进入共享`FailureReason`实施任务 | 🟡 | quality | root-cause | fix-regression | fixed | — | — | 6 | 6 | — |
| v02-r6-10 | F007的提交后收尾只写drain,漏掉F006强制的pending event broadcast | 🟡 | correctness | root-cause | fix-regression | fixed | — | — | 6 | 6 | — |
| v02-r6-11 | F006 spec的Q3仍保留旧的6类事件和`completed`名称 | 🟡 | quality | symptom-patch | spec-drift | fixed | — | — | 6 | 6 | — |
| v02-r6-12 | F008用默认超时诊断stale lock,与实际per-adapter timeout不同源 | 🟡 | correctness | root-cause | spec-drift | fixed | — | — | 6 | 6 | — |
| v02-r6-13 | 前端状态清单漏掉`cancelling`,无法呈现设计要求的卡住/健康诊断 | 🟡 | quality | root-cause | original-coding | fixed | — | — | 6 | 6 | — |
| v02-r6-14 | 取消恢复与无运行Attempt的直接取消缺少明确的原子性验收 | 🟡 | test-coverage | root-cause | original-coding | fixed | — | — | 6 | 6 | — |

---

## 循环 4: F006 实现代码检视(9轮)

- **report_type**: fix-verification
- **周期**: 2026-08-02 → 2026-08-07(5天) · **状态**: 已闭环,`7799603` 是确认点
- **三条最有价值的可复用教训**,结构化记录如下(详见各轮明细叙事):

| ID | 标题 | 严重度 | 分类 | 根因/症状 | 来源 | 状态 | 修复方案 | 回归测试 | 首次出现轮次 | 修复轮次 | 模式标签 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| glob-zero-depth-not-matched | `**/*.ts`自制glob正则漏掉workspace根目录文件(0层目录) | Medium | correctness | root-cause | original-coding | fixed | `globToRegex()`两步正则替换(`(.*/)?`前缀+`.*`),同时覆盖0层与多层路径 | Node命令行实测(未见独立测试文件) | 2 | 6 | partial-symmetric-fix |
| graph-blocked-event-half-broadcast | `graph.blocked`事件广播只覆盖parse-failure分支,run-failure分支没有 | Medium | correctness | root-cause | original-coding | fixed | `anyFailed`分支补写`graph.blocked`事件,加入`pendingBroadcasts`统一广播 | 见F006全文(第五轮修复段落) | 1 | ~5-6(见叙事) | partial-symmetric-fix |
| dropped-count-truncation-uncounted | `dropped_count`截断计数只算了重复计数,没算slice截断 | High | correctness | root-cause | original-coding | fixed(第七轮前) | 见F006全文相应段落 | 见F006全文 | 见F006全文 | 见F006全文 | partial-symmetric-fix |
| cancelling-finalizer-missing-transaction | `tryFinalizeCancellingGraph()`四步操作(CAS/CAS/写事件/broadcast)没有事务包裹 | Critical | correctness | root-cause | fix-regression | fixed | `tryFinalizeCancellingGraph()`改用`db.transaction()`包裹GraphRun CAS+Issue CAS+事件write,提交后再broadcast | 独立复核实测崩溃注入场景(未见新增自动化测试文件) | 5(第5轮新引入) | 6 | partial-symmetric-fix |
| block-cancelled-precursor-test-vacuous | `blockGraphOnCancelledPrecursor`直接单测被删,换成断言修复前错误行为的模拟测试 | High | test-coverage | symptom-patch | process-gap | fixed | 测试改为真实调用`blockGraphOnCancelledPrecursor()`,不再手写模拟 | `graph-adapter-tests.test.ts` | 8 | 9 | test-simulates-itself |
| graph-recovery-retry-cancel-tests-vacuous | `graph-recovery.test.ts` 4条retry/cancel测试全部直接调仓储层方法模拟,从未调用真实端点 | High | test-coverage | symptom-patch | process-gap | fixed | 删除vacuous的retry/cancel flow测试,由真实HTTP调用的`graph-routes-mutations.test.ts`承担覆盖 | `graph-routes-mutations.test.ts` | 8 | 9 | test-simulates-itself |
| tasks-md-web-ui-checked-not-implemented | `tasks.md` T052-T054b打勾但Web UI缺取消按钮/resolve-executors界面/专属测试 | Medium | quality | symptom-patch | process-gap | fixed | 补齐取消按钮+resolve-executors UI,`tasks.md`改回如实标注 | `web/src/f006-graph-run-card.test.tsx` | 8 | 9 | marked-done-not-implemented |
| tasks-md-spec-md-contradict-each-other | `tasks.md`100%打勾与`spec.md` AC-001~009仍0%勾选互相矛盾 | Medium | quality | symptom-patch | process-gap | fixed | `tasks.md`/`spec.md`双向同步回写,AC-001~009逐条补证据引用 | — | 4 且 8(复现2次) | 4且9 | marked-done-not-implemented |

1. **`partial-symmetric-fix` 复现4次以上**:glob(多层修好、0层漏了,第六轮才靠
     两步替换法彻底解决,经历"完全不工作→多层修好0层漏了→死代码删了0层仍未修→
     两步替换同时覆盖"四个阶段)、`graph.blocked`事件广播(parse-failure分支
     修了、run-failure分支没修)、`dropped_count`截断计数、`tryFinalizeCancellingGraph`
     缺事务包裹(第五轮新引入,第六轮才修——这条 `origin` 标 `fix-regression`
     而非 `original-coding`,因为它是第五轮为了修另一个问题新写的函数自己带的坑)
2. **`test-simulates-itself` 复现2次**(第八轮发现,第九轮修复):
     `blockGraphOnCancelledPrecursor`直接单测被删,换成断言修复前错误行为的模拟
     测试;`graph-recovery.test.ts` 4条retry/cancel测试全部直接调仓储层方法
     模拟,从未调用真实端点。`origin` 标 `process-gap`:production代码本身没有
     退化,退化的是测试对"完成度"的表述——这类问题不会被任何门禁挡住(typecheck/
     lint/test全绿是必然的,因为新测试断言的是它们自己写的逻辑)
3. **`marked-done-not-implemented` 复现2次**(第四轮`tasks.md`全勾但代码只有
     骨架;第八轮`tasks.md`打勾但UI缺关键交互,且`tasks.md`与`spec.md`两份文档
     互相矛盾——第九轮已修复,补齐UI+改回如实标注)。和 market-game-sim 循环1
     的三条同 `pattern_tag` 案例(KPI-011/§6.2/chain_depth)是跨项目同源问题

### Phase 1子检视(`F006-phase1-schema-v8.md`,1H/5M)— 独立于主线的早期子轮

| ID | 标题 | 严重度 | 分类 | 根因/症状 | 来源 | 状态 | 修复方案 | 回归测试 | 首次出现轮次 | 修复轮次 | 模式标签 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| f006-p1-01 | 约束错误mapper未接入任何生产调用链,T016的409仍不可达 | 🟠 | correctness | root-cause | original-coding | fixed | 接入`server/src/db/sqlite-errors.ts`的mapper到生产调用链 | — | Phase1 | Phase1 | — |
| f006-p1-02 | duplicate NodeRun被错误映射成"节点不可重试" | 🟡 | correctness | root-cause | original-coding | fixed | 修正错误映射 | — | Phase1 | Phase1 | — |
| f006-p1-03 | `target_files_dropped_count`接受小数,持久化的"数量"不一定是整数 | 🟡 | correctness | root-cause | original-coding | fixed | 类型约束修正 | — | Phase1 | Phase1 | — |
| f006-p1-04 | `RunCreateInput`仍未用判别联合表达GraphNode/`node_run_id`关联 | 🟡 | quality | root-cause | original-coding | carried-forward(Phase2) | — | — | Phase1 | — | — |
| f006-p1-05 | 迁移测试仍未注入"DDL后、版本写入前"的失败 | 🟡 | test-coverage | symptom-patch | original-coding | fixed | 补充故障注入测试 | `server/tests/integration/migration-v8.test.ts` | Phase1 | Phase1 | — |
| f006-p1-06 | Adapter删除修复只有repository查询测试,没有service/API回归 | 🟡 | test-coverage | symptom-patch | original-coding | carried-forward(Phase2) | — | — | Phase1 | — | — |

### 第1轮(`F006-implementation.md`,5C/6H/3M/1L)

首轮实现检视,全部15条 `origin` 均为 `original-coding`(F006第一次实现就带的
缺口,不是修复引入的)。`resolved_round`:同轮修复的直接标轮次;跨轮才修的,
因中间轮次措辞在改写、无法逐条精确倒查,标"见叙事"——第2-4轮以标题类似的
表述持续追踪同一批问题,最终在第7轮(补完第六轮复核指出的全部剩余缺口)一次性
清零,可信下界是"不晚于第7轮"。

| ID | 标题 | 严重度 | 分类 | 根因/症状 | 来源 | 状态 | 修复方案 | 回归测试 | 首次出现轮次 | 修复轮次 | 模式标签 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| f006-r1-01 | F006服务未进入生产composition root,系统没有可执行的建图/恢复入口 | 🔴 | correctness | root-cause | original-coding | fixed | 接入composition root,建图/恢复端点真正可调用 | — | 1 | 1 | — |
| f006-r1-02 | 前驱NodeRun以`pending`创建,queued Run启动时无法把它推进到`running` | 🔴 | correctness | root-cause | original-coding | fixed | 前驱NodeRun创建时状态改为正确初值,queued Run能推进到running | — | 1 | 1 | — |
| f006-r1-03 | GraphNode完成钩子直接返回,所有图节点在Run终态后停止推进 | 🔴 | correctness | root-cause | original-coding | fixed | 补齐完成钩子的推进逻辑 | — | 1 | 1 | — |
| f006-r1-04 | 结果处理仍是skeleton:不读/解析payload、不写结果事件,join永远不执行 | 🔴 | correctness | root-cause | original-coding | fixed | 结果处理从skeleton补成读取/解析payload+写结果事件 | — | 1 | 1 | — |
| f006-r1-05 | synthesis Attempt没有任何前驱payload,边traversal也明确记录空引用 | 🔴 | correctness | root-cause | original-coding | fixed | synthesis Attempt补齐前驱payload与边traversal引用 | — | 1 | 1 | — |
| f006-r1-06 | 建图便利入口提交后不drain,queued Attempt不会主动开始 | 🟠 | correctness | root-cause | original-coding | fixed | 建图便利入口提交后补drain | — | 1 | 1 | — |
| f006-r1-07 | fan-in的CAS、资格复核、Attempt与事件写入不在事务中,任一步失败留下吸收态 | 🟠 | correctness | root-cause | original-coding | 见叙事(不晚于第7轮) | 第7轮`node-completion.ts`重构统一实时/恢复两条路径的事务边界 | — | 1 | ≤7 | — |
| f006-r1-08 | 图失败、成功、取消与重启均无生命周期实现,非终态图会永久占用唯一索引 | 🟠 | correctness | root-cause | original-coding | 见叙事(不晚于第7轮) | 第7轮`GraphRecoveryService.reconcile()`补齐join重评估与终态化 | — | 1 | ≤7 | — |
| f006-r1-09 | queued claim未复核GraphNode adapter资格,escalation仍会取消所有兄弟图节点 | 🟠 | correctness | root-cause | original-coding | fixed | 补齐adapter资格复核 | — | 1 | 1 | — |
| f006-r1-10 | target glob实现没有匹配扩展名,symlink越界检查也可被同前缀兄弟目录绕过 | 🟠 | correctness | root-cause | original-coding | fixed | glob匹配扩展名+symlink越界检查修复(0层目录问题留到第6轮才彻底解决) | — | 1 | 1 | partial-symmetric-fix |
| f006-r1-11 | `createGraph()`信任调用方提供的scope/preflight,未复核实体关系/workspace path/hash | 🟠 | correctness | root-cause | original-coding | 见叙事(不晚于第7轮) | 第7轮`resolve-executors`端点实现时一并补齐scope/preflight复核 | — | 1 | ≤7 | — |
| f006-r1-12 | 结果envelope的上限统计不完整,部分可变字段仍无界 | 🟡 | quality | root-cause | original-coding | 见叙事(不晚于第7轮) | 见F006全文 | — | 1 | ≤7 | — |
| f006-r1-13 | Graph projection返回伪history、空edges与占位文案,Web端没有任何图展示 | 🟡 | quality | root-cause | original-coding | 见叙事(不晚于第7轮) | 第7轮`edges`字段改为查询真实`graph.edge_traversed`事件回填 | — | 1 | ≤7 | — |
| f006-r1-14 | 所谓端到端fan-in测试绕过production path,核心函数完全无测试 | 🟡 | test-coverage | symptom-patch | original-coding | 见叙事(不晚于第7轮) | 第7轮新增18条集成测试覆盖production path | — | 1 | ≤7 | — |
| f006-r1-15 | 已注入的instruction builder未使用,另有模块级重复实例 | 🟢 | quality | symptom-patch | original-coding | 见叙事(不晚于第7轮) | 见F006全文 | — | 1 | ≤7 | — |

### 第2轮(`F006-final-recheck.md`,4C/6H/4M/2L)

| ID | 标题 | 严重度 | 分类 | 根因/症状 | 来源 | 状态 | 修复方案 | 回归测试 | 首次出现轮次 | 修复轮次 | 模式标签 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| f006-r2-01 | GraphRuntime仍无生产调用入口,注入到GET-only route后从未使用 | 🔴 | correctness | root-cause | original-coding | 见叙事(≤7) | — | — | 1 | ≤7 | — |
| f006-r2-02 | NodeRun先置completed、再写result event,hook异常被吞后留下不可恢复永久态 | 🔴 | correctness | root-cause | original-coding | 见叙事(≤7) | — | — | 1 | ≤7 | — |
| f006-r2-03 | fan-in对缺失前驱结果使用`continue`,会带半份甚至零份输入启动synthesis | 🔴 | correctness | root-cause | original-coding | 见叙事(≤7) | — | — | 1 | ≤7 | — |
| f006-r2-04 | Graph成功、失败、取消与重启仍没有终态化/恢复实现 | 🔴 | correctness | root-cause | original-coding | 见叙事(≤7) | — | — | 1 | ≤7 | — |
| f006-r2-05 | queued GraphNode未复核adapter/GraphRun资格,且NodeRun CAS失败也照样启动provider | 🟠 | correctness | root-cause | original-coding | 见叙事(≤7) | — | — | 1 | ≤7 | — |
| f006-r2-06 | queued Run取消仍不推进NodeRun/GraphRun,系统取消路径可制造孤儿ready节点 | 🟠 | correctness | root-cause | original-coding | 见叙事(≤7) | — | — | 1 | ≤7 | — |
| f006-r2-07 | fan-in绕过trusted payload resolver,edge refs写进payload而非`evidence_refs` | 🟠 | correctness | root-cause | original-coding | 见叙事(≤7) | — | — | 1 | ≤7 | — |
| f006-r2-08 | graph result/node lifecycle events没有完整broadcast/持久化 | 🟠 | correctness | root-cause | original-coding | 见叙事(≤7) | — | — | 1 | ≤7 | — |
| f006-r2-09 | createGraph scope/snapshot复核仍不完整,Issue状态CAS失败也会提交图 | 🟠 | correctness | root-cause | original-coding | 见叙事(≤7) | — | — | 1 | ≤7 | — |
| f006-r2-10 | F006测试仍手工驱动状态,1442个绿色测试没有一条走production graph path | 🟠 | test-coverage | symptom-patch | original-coding | 见叙事(≤7) | — | — | 1 | ≤7 | — |
| f006-r2-11 | Result parser的数量/字段边界仍不准确 | 🟡 | quality | root-cause | original-coding | 见叙事(≤7) | — | — | 1 | ≤7 | — |
| f006-r2-12 | Graph API仍返回伪history、空edges和占位文案,Web没有F006展示 | 🟡 | quality | root-cause | original-coding | 见叙事(≤7) | — | — | 1 | ≤7 | — |
| f006-r2-13 | `**/*.ts`的自制glob正则漏掉workspace根目录文件(0层目录问题,第一次被记录) | 🟡 | correctness | root-cause | original-coding | fixed | `globToRegex()`两步正则替换 | — | 2 | 6 | partial-symmetric-fix |
| f006-r2-14 | constraint mapper的catch丢弃AppError,重新抛出原始GraphConstraintError | 🟡 | quality | symptom-patch | original-coding | 见叙事(≤7) | — | — | 1 | ≤7 | — |
| f006-r2-15 | 存在两套completion实现与不安全的repository类型伪装 | 🟢 | quality | symptom-patch | original-coding | 见叙事(≤7) | — | — | 1 | ≤7 | — |
| f006-r2-16 | 质量门禁仍有formatting failure | 🟢 | quality | symptom-patch | original-coding | 见叙事(≤7) | — | — | 1 | ≤7 | — |

### 第3轮(`F006-final-recheck-2.md`,4C/6H/4M/2L)

| ID | 标题 | 严重度 | 分类 | 根因/症状 | 来源 | 状态 | 修复方案 | 回归测试 | 首次出现轮次 | 修复轮次 | 模式标签 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| f006-r3-01 | GraphRuntime仍没有任何生产启动入口 | 🔴 | correctness | root-cause | original-coding | 见叙事(≤7) | — | — | 1 | ≤7 | — |
| f006-r3-02 | queued GraphNode先把Run置running,NodeRun CAS失败后留下永久悬空Run | 🔴 | correctness | root-cause | original-coding | 见叙事(≤7) | — | — | 1 | ≤7 | — |
| f006-r3-03 | Graph成功、失败、取消与重启仍没有闭环 | 🔴 | correctness | root-cause | original-coding | 见叙事(≤7) | — | — | 1 | ≤7 | — |
| f006-r3-04 | completion hook不区分Attempt终态,且CAS失败仍提交孤儿result event | 🔴 | correctness | root-cause | original-coding | 见叙事(≤7) | — | — | 1 | ≤7 | — |
| f006-r3-05 | queued cancel只推进到NodeRun cancelled,GraphRun仍永久running | 🟠 | correctness | root-cause | original-coding | 见叙事(≤7) | — | — | 1 | ≤7 | — |
| f006-r3-06 | fan-in仍绕过可信payload resolver | 🟠 | correctness | root-cause | original-coding | 见叙事(≤7) | — | — | 1 | ≤7 | — |
| f006-r3-07 | fan-in在资格/结果校验前把synthesis置ready,失败后留下无Attempt的ready节点 | 🟠 | correctness | root-cause | original-coding | 见叙事(≤7) | — | — | 1 | ≤7 | — |
| f006-r3-08 | graph blocked/terminal生命周期事件仍不完整 | 🟠 | correctness | root-cause | original-coding | 见叙事(≤7) | — | — | 1 | ≤7 | — |
| f006-r3-09 | createGraph的thread/workspace scope仍未闭合 | 🟠 | correctness | root-cause | original-coding | 见叙事(≤7) | — | — | 1 | ≤7 | — |
| f006-r3-10 | 现有57条F006测试没有覆盖production graph path | 🟠 | test-coverage | symptom-patch | original-coding | 见叙事(≤7) | — | — | 1 | ≤7 | — |
| f006-r3-11 | Result parser仍未完全落实字段约束 | 🟡 | quality | root-cause | original-coding | 见叙事(≤7) | — | — | 1 | ≤7 | — |
| f006-r3-12 | Graph projection仍是占位实现,Web没有F006展示或恢复入口 | 🟡 | quality | root-cause | original-coding | 见叙事(≤7) | — | — | 1 | ≤7 | — |
| f006-r3-13 | projection对每个节点重复查询整个Issue的Runs | 🟡 | quality | symptom-patch | original-coding | 见叙事(≤7) | — | — | 1 | ≤7 | — |
| f006-r3-14 | 建图调度用节点名称硬编码precursor,而不是使用定义拓扑 | 🟡 | quality | symptom-patch | original-coding | 见叙事(≤7) | — | — | 1 | ≤7 | — |
| f006-r3-15 | workflow临时伪装ProjectRepository,且注入的builder/runtime service未实际使用 | 🟢 | quality | symptom-patch | original-coding | 见叙事(≤7) | — | — | 1 | ≤7 | — |
| f006-r3-16 | 根format check未覆盖F006新文件 | 🟢 | quality | symptom-patch | original-coding | 见叙事(≤7) | — | — | 1 | ≤7 | — |

### 第4轮(`F006-final-recheck-3.md`,2C/6H/4M/2L)

全部14条 `origin` 仍为 `original-coding`(第1轮遗留的持续追踪,4轮里表述
逐步变化但本质是同一批未解决问题)。第4轮起`tasks.md`已被发现全勾但代码只有
骨架(`marked-done-not-implemented`,见上方复用教训表),这是本轮叙事记录、
未在本表格单独列出的一条独立发现。

| ID | 标题 | 严重度 | 分类 | 根因/症状 | 来源 | 状态 | 修复方案 | 回归测试 | 首次出现轮次 | 修复轮次 | 模式标签 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| f006-r4-01 | Graph成功、失败、取消与重启仍没有完整生命周期 | 🔴 | correctness | root-cause | original-coding | fixed | 见第7轮`GraphRecoveryService.reconcile()`补齐 | — | 1 | 7 | — |
| f006-r4-02 | Run与NodeRun启动仍非原子,当前会留下孤儿running NodeRun | 🔴 | correctness | root-cause | original-coding | 见叙事(≤7) | — | — | 1 | ≤7 | — |
| f006-r4-03 | queued/late terminal GraphNode没有GraphRun状态守卫 | 🟠 | correctness | root-cause | original-coding | 见叙事(≤7) | — | — | 1 | ≤7 | — |
| f006-r4-04 | queued GraphNode启动前没有重新校验assigned adapter | 🟠 | correctness | root-cause | original-coding | 见叙事(≤7) | — | — | 1 | ≤7 | — |
| f006-r4-05 | malformed result会形成GraphRun blocked、Issue Running的持久化矛盾 | 🟠 | correctness | root-cause | original-coding | 见叙事(≤7) | — | — | 1 | ≤7 | — |
| f006-r4-06 | queued cancel仍无法推进GraphRun | 🟠 | correctness | root-cause | original-coding | 见叙事(≤7) | — | — | 1 | ≤7 | — |
| f006-r4-07 | failure/block writes非原子且事件未广播 | 🟠 | correctness | root-cause | original-coding | 见叙事(≤7) | — | — | 1 | ≤7 | — |
| f006-r4-08 | fan-in仍绕过EvidenceService的可信payload/scope校验 | 🟠 | correctness | root-cause | original-coding | 见叙事(≤7) | — | — | 1 | ≤7 | — |
| f006-r4-09 | 新增graph start POST使用无效的TypeScript cast代替zod | 🟡 | quality | root-cause | fix-regression | 见叙事(≤7) | — | — | 4 | ≤7 | — |
| f006-r4-10 | GraphRuntimeService仍信任调用方分别提供thread/workspace/path | 🟡 | correctness | root-cause | original-coding | 见叙事(≤7) | — | — | 1 | ≤7 | — |
| f006-r4-11 | projection与Web仍未满足可追踪/可恢复验收 | 🟡 | quality | root-cause | original-coding | 见叙事(≤7) | — | — | 1 | ≤7 | — |
| f006-r4-12 | 57条F006测试仍未覆盖新增production path | 🟡 | test-coverage | symptom-patch | original-coding | 见叙事(≤7) | — | — | 1 | ≤7 | — |
| f006-r4-13 | result parser和definition-driven调度仍有契约偏差 | 🟢 | quality | symptom-patch | original-coding | 见叙事(≤7) | — | — | 1 | ≤7 | — |
| f006-r4-14 | composition仍含unsafe repository cast,format gate再次失败 | 🟢 | quality | symptom-patch | original-coding | 见叙事(≤7) | — | — | 1 | ≤7 | — |

### 第5轮修复(2026-08-03,`preflight.ts`等)— 6项全部修复,origin均为original-coding(第4轮遗留)

| ID | 标题 | 严重度 | 分类 | 根因/症状 | 来源 | 状态 | 修复方案 | 回归测试 | 首次出现轮次 | 修复轮次 | 模式标签 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| f006-r5-01 | `retry` Issue CAS用错期望值(`gr.status`大小写不匹配) | 🔴 | correctness | root-cause | original-coding | fixed | `graph.ts:157-158`改用正确的`IssueStatus`枚举比较 | — | 4 | 5 | — |
| f006-r5-02 | `cancel`实时路径无法收敛(新增`tryFinalizeCancellingGraph`共享函数) | 🟠 | correctness | root-cause | original-coding | fixed | 新建`cancelling-finalizer.ts`共享函数 | — | 4 | 5 | — |
| f006-r5-03 | `blocked_node_keys`过滤不完整 | 🟡 | correctness | root-cause | original-coding | fixed | 过滤条件改为与`anyFailed`同构 | — | 4 | 5 | — |
| f006-r5-04 | `cancel`纯空终端流程缺失 | 🟡 | correctness | root-cause | original-coding | fixed | 补齐纯空终端场景的Issue CAS+事件写 | — | 4 | 5 | — |
| f006-r5-05 | `handleCancellingGraph`缺`graph.terminal` | 🟡 | correctness | root-cause | original-coding | fixed | 改用共享的`tryFinalizeCancellingGraph` | — | 4 | 5 | — |
| f006-r5-06 | projection `blocked_node_keys`未暴露 | 🟡 | quality | root-cause | original-coding | fixed | API层透出该字段 | — | 4 | 5 | — |

**第5轮独立复核**新发现1项(自述未提及): 🟡 `tryFinalizeCancellingGraph()`本身
没有事务包裹(GraphRun CAS、Issue CAS、事件write、broadcast四步未包在
`db.transaction()`里)。同时纠正自述里一处不准确表述:"edges已从定义派生"被
错误标记为本轮已修复,实际从第一轮起就没变过。

### 第6轮修复(2026-08-03同天)— 2项代码bug清零

| ID | 标题 | 严重度 | 分类 | 根因/症状 | 来源 | 状态 | 修复方案 | 回归测试 | 首次出现轮次 | 修复轮次 | 模式标签 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| f006-r6-01 | `tryFinalizeCancellingGraph()`缺事务包裹(补第5轮遗漏) | 🔴 | correctness | root-cause | fix-regression | fixed | `db.transaction()`包裹四步操作 | — | 5 | 6 | partial-symmetric-fix |
| f006-r6-02 | `preflight.ts` 0层目录文件不匹配`**` glob(两步正则替换法,四阶段生命周期终于走完) | 🟡 | correctness | root-cause | original-coding | fixed | `globToRegex()`两步正则替换 | — | 2 | 6 | partial-symmetric-fix |

**第6轮独立复核结论**:代码层面"挑不出新的具体代码错误",但对"缺陷清零"整体
定性有保留意见——`resolve-executors`端点缺失和`GraphRecoveryService`的join
重评估被重新归类为"Phase 7功能开发"从而排除在缺陷统计外,这个分类被指出
"值得商榷"(它们是design.md定稿范围内的正式AC对应功能,不是新范围)。

### 第7轮(2026-08-04,补完第六轮复核指出的全部剩余缺口)— 5项逐一实现

| ID | 标题 | 严重度 | 分类 | 根因/症状 | 来源 | 状态 | 修复方案 | 回归测试 | 首次出现轮次 | 修复轮次 | 模式标签 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| f006-r7-01 | `projectRepo` null依赖伪造已去掉,正常注入 | 🟠 | quality | symptom-patch | original-coding | fixed | 构造函数新增`projectRepo`参数正常注入 | — | 1 | 7 | — |
| f006-r7-02 | `edges`字段填充真实运行时状态(查`graph.edge_traversed`事件回填) | 🟡 | quality | root-cause | original-coding | fixed | 查询`graph.edge_traversed`事件按`(from,to)`建索引回填 | — | 1 | 7 | — |
| f006-r7-03 | `resolve-executors`端点已实现(按design.md第9节优先级判断顺序) | 🟠 | correctness | root-cause | original-coding | fixed | 新端点,按design.md第9节优先级实现 | `server/tests/integration/graph-recovery.test.ts` | 1 | 7 | — |
| f006-r7-04 | `GraphRecoveryService.reconcile()`的join重评估(design §7 第0/3/4/5/6/7步)全部实现 | 🟠 | correctness | root-cause | original-coding | fixed | 补齐第0/3/4/5/6/7步,合并3/4/6步为一次`reevaluateOutgoingJoins`操作 | `server/tests/integration/graph-recovery.test.ts` | 1 | 7 | — |
| f006-r7-05 | 单节点取消死锁路径已修复(`blockGraphOnCancelledPrecursor`) | 🟠 | correctness | root-cause | original-coding | fixed | 新函数,取消队列节点时检查是否为下游必需前驱 | `server/tests/integration/graph-recovery.test.ts` | 1 | 7 | — |
| f006-r7-06 | `/cancel`端点GraphRun自身CAS放在等待运行节点取消完成的await之后,导致静默跳过收尾 | 🟡 | correctness | root-cause | fix-regression | fixed | 调整顺序:先CAS到cancelling/cancelled,再处理非运行中节点,最后await运行中节点 | 写测试时暴露(未见独立测试文件名) | 7 | 7 | — |

**写测试过程中新发现并修复1个bug**: `/cancel`端点把GraphRun自身的
`running→cancelling` CAS放在了等待运行中节点取消完成的`await`之后,导致
静默跳过收尾——这个bug人工代码审查没发现,是写"调用API后重新查库断言最终
状态"测试时才暴露的。

### 第8轮(2026-08-07,T063真实CLI场景验收核实)

- ✅ T063本身核实为真,已用真实Codex CLI独立复现(259秒,通过)
- ⚠️ 同批改动发现3类问题:`tasks.md`打勾但UI缺取消按钮/resolve-executors界面/
  T054b要求的3个UI测试为零;`spec.md` AC-001~009仍0%勾选与`tasks.md` 100%
  打勾矛盾;`blockGraphOnCancelledPrecursor`直接单测被删换成vacuous模拟测试,
  `graph-recovery.test.ts` 4条retry/cancel测试从未调用真实端点

### 第9轮(2026-08-07同天,逐条核实修复 + 逐条落实建议)

第8轮指出的三类问题(测试质量回归、文档自相矛盾、Web UI关键交互缺失)**均已
得到真实、可验证的修复**:`blockGraphOnCancelledPrecursor`/retry/cancel测试
改回真实调用、vacuous测试删除、Web UI补齐取消按钮与resolve-executors面板、
`tasks.md`/`spec.md`如实回写并双向同步。复核中新发现1处测试名不对题的小问题
(`disables retry buttons while cancelling`测试实际测的是Blocked态,功能本身
没问题)。F006在本轮之后进入扎实的收尾状态。

---

## 循环 5: F007 开发前需求检视(R001-R008)

- **report_type**: doc-review
- **周期**: 2026-08-08,同一文件内3轮 · **状态**: 已闭环,`3bc8d17`(R001-R005)+
  `cc57c72`(R006-R008)

| ID | 标题 | 严重度 | 分类 | 根因/症状 | 来源 | 状态 | 修复方案 | 回归测试 | 首次出现轮次 | 修复轮次 | 模式标签 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| F007-R001 | `sequential`确认路径与F006实际接口不兼容 | 🟠 | correctness | root-cause | spec-drift | fixed | — | — | 1 | 1 | — |
| F007-R002 | 推荐响应缺少PRD要求的Issue Type推荐 | 🟠 | correctness | root-cause | original-coding | fixed | — | — | 1 | 1 | — |
| F007-R003 | 通用`Recommendation<Record<string,string>>`无法清晰表达逐节点roster候选与排除原因 | 🟠 | quality | root-cause | original-coding | fixed | — | — | 1 | 1 | — |
| F007-R004 | `tasks.md`和部分design文本仍引用已废弃接口与身份语义 | 🟡 | quality | symptom-patch | spec-drift | fixed | — | — | 2 | 2 | — |
| F007-R005 | 项目级真相源仍保留F006开发前及ADR初稿结论 | 🟡 | quality | symptom-patch | spec-drift | fixed | — | — | 2 | 2 | — |
| F007-R006 | `createSequentialRun()`的instructions来源存在三处不一致 | 🟡 | correctness | root-cause | original-coding | fixed | — | — | 2 | 2 | — |
| F007-R007 | sequential Run的provenance与`RunQueued`事件字段未完整定义 | 🟡 | correctness | root-cause | original-coding | fixed | — | — | 2 | 2 | — |
| F007-R008 | 两处旧术语及检视状态尚未收尾 | 🟢 | quality | symptom-patch | spec-drift | fixed | — | — | 3 | 3 | — |

---

## 循环 6: F007 实现代码检视(7轮)

- **report_type**: fix-verification
- **周期**: 2026-08-08 → 2026-08-09 · **状态**: 已闭环(第7轮修复后)
- **⚠️ 收尾时发现的流程信号**: `BACKLOG.md`在第7轮问题仍开放时就已把F007标记
  为`done`,整个实现+检视周期直到闭环那一刻都还没有任何一次提交
- **可复用教训**: 第7轮问题是"只修对称结构的一半"模式(普通replay加了drain,
  唯一键冲突走的另一条replay分支没加)在F007的复现——与循环4(F006)的
  glob/事件广播/事务包裹三个案例同源,本项目至少4次独立复现同一根因类别

### 第1-6轮 — ⚠️ 原文件已丢失,原始标题未能保留,仅严重度计数可考(均已在对应轮次关闭)

题目列("—")栏位说明:原始 `code-review-report.md`/`recheck.md`~`recheck-5.md`
六个文件此前从未进入 git 历史,在按本协议整理时已删除,只有严重度计数当时被
记录下来,无法逆向还原每条的具体标题。按用户要求统一用完整格式表示,行数
与当时记录的计数一致,标题栏诚实标"—"而不是编造内容。

| ID | 标题 | 严重度 | 分类 | 根因/症状 | 来源 | 状态 | 修复方案 | 回归测试 | 首次出现轮次 | 修复轮次 | 模式标签 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| f007-r1-01 | — | 🟠 | — | — | — | fixed | — | — | 1 | 1 | — |
| f007-r1-02 | — | 🟠 | — | — | — | fixed | — | — | 1 | 1 | — |
| f007-r1-03 | — | 🟡 | — | — | — | fixed | — | — | 1 | 1 | — |
| f007-r1-04 | — | 🟡 | — | — | — | fixed | — | — | 1 | 1 | — |
| f007-r1-05 | — | 🟡 | — | — | — | fixed | — | — | 1 | 1 | — |
| f007-r1-06 | — | 🟡 | — | — | — | fixed | — | — | 1 | 1 | — |
| f007-r1-07 | — | 🟡 | — | — | — | fixed | — | — | 1 | 1 | — |
| f007-r1-08 | — | 🟡 | — | — | — | fixed | — | — | 1 | 1 | — |
| f007-r1-09 | — | 🟡 | — | — | — | fixed | — | — | 1 | 1 | — |
| f007-r1-10 | — | 🟡 | — | — | — | fixed | — | — | 1 | 1 | — |
| f007-r1-11 | — | 🟡 | — | — | — | fixed | — | — | 1 | 1 | — |
| f007-r1-12 | — | 🟢 | — | — | — | fixed | — | — | 1 | 1 | — |
| f007-r1-13 | — | 🟢 | — | — | — | fixed | — | — | 1 | 1 | — |
| f007-r2-01 | — | 🟡 | — | — | — | fixed | — | — | 2 | 2 | — |
| f007-r2-02 | — | 🟡 | — | — | — | fixed | — | — | 2 | 2 | — |
| f007-r2-03 | — | 🟡 | — | — | — | fixed | — | — | 2 | 2 | — |
| f007-r2-04 | — | 🟡 | — | — | — | fixed | — | — | 2 | 2 | — |
| f007-r3-01 | — | 🟡 | — | — | — | fixed | — | — | 3 | 3 | — |
| f007-r3-02 | — | 🟡 | — | — | — | fixed | — | — | 3 | 3 | — |
| f007-r3-03 | — | 🟡 | — | — | — | fixed | — | — | 3 | 3 | — |
| f007-r3-04 | — | 🟢 | — | — | — | fixed | — | — | 3 | 3 | — |
| f007-r4-01 | — | 🟡 | — | — | — | fixed | — | — | 4 | 4 | — |
| f007-r4-02 | — | 🟡 | — | — | — | fixed | — | — | 4 | 4 | — |
| f007-r4-03 | — | 🟡 | — | — | — | fixed | — | — | 4 | 4 | — |
| f007-r4-04 | — | 🟡 | — | — | — | fixed | — | — | 4 | 4 | — |
| f007-r5-01 | UI topology切换初始化effect覆盖用户选择(全量测试里真实复现失败,非理论问题) | 🟡 | correctness | root-cause | original-coding | fixed | 修正effect依赖,避免覆盖用户已做的选择 | — | 5 | 5 | — |
| f007-r5-02 | — | 🟡 | — | — | — | fixed | — | — | 5 | 5 | — |
| f007-r5-03 | — | 🟡 | — | — | — | fixed | — | — | 5 | 5 | — |
| f007-r5-04 | — | 🟡 | — | — | — | fixed | — | — | 5 | 5 | — |
| f007-r6-01 | 普通replay恢复(drain逻辑) | 🟡 | correctness | root-cause | original-coding | fixed | 补齐drain调用 | — | 6 | 6 | — |
| f007-r6-02 | UI旧请求失效处理 | 🟡 | quality | root-cause | original-coding | fixed | `requestGeneration`同时处理旧请求resolve/reject | — | 6 | 6 | — |
| f007-r6-03 | 逐尝试事件缓冲+证据文案 | 🟡 | quality | symptom-patch | original-coding | fixed | `attemptEvents`移入retry attempt,回滚不再污染成功后broadcast | — | 6 | 6 | — |

### 第7轮(2026-08-09,`code-review-report-recheck-6.md`)— 已闭环

| ID | 标题 | 严重度 | 分类 | 根因/症状 | 来源 | 状态 | 修复方案 | 回归测试 | 首次出现轮次 | 修复轮次 | 模式标签 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| nonce-conflict-replay-skips-drain | 唯一键冲突replay绕过新加的drain恢复 | 🟡 | correctness | root-cause | fix-regression | fixed | 新增`IntakeService.returnReplay()`,统一普通replay与nonce冲突winner replay的drain逻辑 | `server/tests/integration/intake-confirm.test.ts` | 7 | 7 | partial-symmetric-fix |

来源标 `fix-regression` 而非 `original-coding`:普通replay路径的drain是第6轮
才加上的修复,唯一键冲突路径是同一次修复动作里被漏掉的对称分支,不是F007从
最初设计就带的缺陷。

**Problem**: 普通幂等命中路径(请求开头发现`existing`)会先`drainWorkspace`,
但真实多进程竞争走另一条路径——失败者撞`intake_confirmations.nonce`唯一键,
catch后读取winner直接返回`replayed: true`,没有drain。两组现有测试(no-op drain
的OS竞争测试、只覆盖`existing`分支的replay-recovery测试)都测不到这个分叉。

**Resolution**: 新增`IntakeService.returnReplay()`,统一普通replay与
nonce unique-conflict winner replay的project归属校验、响应构造和
`drainWorkspace(confirmation.workspace_id)`;新增故障注入测试强制进入
conflict catch,断言返回winner前完成drain。F007 server 78/78、Web 10/10、
`npm test`/`typecheck`/`lint`/`format:check`/`git diff --check`全绿。

---

## 循环 7: F008 开发前需求检视

- **report_type**: doc-review
- **周期**: 2026-08-09,单轮 · **状态**: 已闭环(文档修复已落工作区,尚未提交)
- **背景**: F008 的 spec/design/tasks 此前已在循环3(6轮)里做过自洽性检视,但
  design.md 写于2026-08-02、彼时F006/F007尚未实现完毕,里面大量断言了具体
  文件路径/行号/函数名。开发前最后一轮检视核对这些断言与2026-08-09实际代码
  (F006/F007均已完整落地)是否仍然一致,方法与循环5(F007开发前检视)相同。

| ID | 标题 | 严重度 | 分类 | 根因/症状 | 来源 | 状态 | 修复方案 | 回归测试 | 首次出现轮次 | 修复轮次 | 模式标签 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| F008-R001 | `waiting_for_validation_due`诊断被设计成"排队Run分类"的产物,但验证者Run只在due time到达并被claim的同一事务内才创建为Queued,等待期间该workspace根本没有对应的排队Run,这条分类结构上不可能从该路径产出 | 🟠 | correctness | root-cause | spec-drift | fixed | 改为独立的Issue级只读查询(`status='Validating' AND validation_dispatch_due_at IS NOT NULL`,复用`idx_issues_validation_due`),与排队Run判定器解耦;同时更正"这是为防止queue_starved误报"的错误动机(等待期间queued计数本为0,naive检查不会因此误报) | — | 1 | 1 | — |
| F008-R002 | design.md/tasks.md假设"存在一个与队列drain共享的、无副作用的资格判定器"可直接复用,但该判定逻辑完全内嵌在`RunDispatchService.startNextQueuedRun()`私有方法内,与取消/加锁/状态CAS/真实派发等副作用交织在同一循环体,当前没有任何可独立调用的纯函数 | 🟠 | correctness | root-cause | spec-drift | fixed | tasks.md T041b改写为"先从`startNextQueuedRun()`抽取纯函数分类器,drain与health共用同一份代码",不得在health里另写一份重复判断——本项目已在循环4(F006)/循环6(F007)反复踩过"只改对称结构一半"导致两处判断静默分叉的同类问题 | — | 1 | 1 | — |
| F008-R003 | design.md引用的多处文件行号(`hasValidationStep()`、`run-dispatch.ts`内`AdapterFailureReprobe`字段位置等)因F007落地后代码整体下移而过期 | 🟢 | quality | symptom-patch | spec-drift | fixed | 逐处核对当前实际行号并更新design.md引用 | — | 1 | 1 | — |

**可复用教训**: F008-R001/R002共同指向同一类根因——设计文档在没有真实实现的阶段,
对"某个可复用机制已经存在"做了未经代码核实的假设。循环5(F007)的核心教训是
"假设的接口与真实签名不符",这里进一步扩展为"假设的机制(纯函数判定器)压根不
存在、假设的数据流(排队Run代表等待状态)在真实实现里不成立"——两类假设都只有
逐行核对当前代码才能发现,单靠文档自洽检视(循环3的6轮)测不出来。

---

## 循环 8: F008 开发前需求检视(第2-3轮,diff-only复检)

- **report_type**: doc-review
- **周期**: 2026-08-09,2轮 · **状态**: 已闭环(第3轮独立复核通过,尚未提交)
- **背景**: 循环7修完后又对F008 design.md做了一轮diff-only复检(`docs/reviews/
  CURRENT-doc.md`,round 2),只审循环7改动的diff及其相邻契约,而不是重新通读
  全文——三条发现都出在循环7新写的三段文字本身(而不是原有内容),说明修复动作
  本身也需要过一遍"是否引入新的不同源判断"的检查,不能修完就当结束。

| ID | 标题 | 严重度 | 分类 | 根因/症状 | 来源 | 状态 | 修复方案 | 回归测试 | 首次出现轮次 | 修复轮次 | 模式标签 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| F008-R004 | `waiting_for_validation_due`查询没有比较due time与服务端当前时间,已逾期未被调度器claim的Issue会和正常等待混在同一个诊断code里 | 🟠 | correctness | root-cause | fix-regression | fixed | 按`now`分流:未到期或在`VALIDATION_DISPATCH_GRACE_MS`(新增,5秒,覆盖调度器默认1秒tick延迟)窗口内仍报`waiting_for_validation_due`;超过grace仍未被claim改报新增的`validation_dispatch_overdue`(`detail`附`overdue_ms`) | `tasks.md::T041f` | 2 | 3 | time-boundary-collapse |
| F008-R005 | `locked_at`异常(为空/晚于当前时间)被无条件归入`stale_lock_confirmed`,但该code的真实语义是"与`cleanupStaleLocks()`一致、可安全释放"——若持有者仍running,时间戳异常并不能证明可以安全释放,建议用户手动释放会破坏workspace互斥 | 🟠 | correctness | root-cause | spec-drift | fixed | 拆分:持有者缺失/终态时`locked_at`是否异常不影响`stale_lock_confirmed`(这两种情形本就不看时长);持有者仍running且`locked_at`异常时归入新增的`lock_timestamp_invalid`,不给出释放类建议 | `tasks.md::T041` | 2 | 3 | diagnostic-recovery-rule-drift |
| F008-R006 | `eligible_but_not_running`与`queue_starved`并列成两个同级公开DTO code,没有定义二者是否同时输出、谁是谁的聚合结果 | 🟡 | correctness | root-cause | original-coding | fixed | 明确`eligible_but_not_running`只是内部纯分类器的返回值,不进入公开`diagnostics[].code`判别联合;health服务层聚合——锁空闲时产出唯一的`queue_starved`,锁占用时不产出任何诊断 | `tasks.md::T041b,T041c,T054` | 2 | 3 | diagnostic-state-conflation |

**来源标注说明**: F008-R004是循环7“改用Issue级查询”的修复动作漏掉时间比较,
因此标`fix-regression`;F008-R005的错误兜底在循环7之前已存在,是文档与真实恢复
规则漂移,标`spec-drift`;F008-R006是原有文字未定义清楚,标`original-coding`。

**第3轮独立复核证据**: 逐项核对F008三件套与当前源码后确认:R004使用的5秒
grace大于`ValidationDispatchScheduler`生产默认1秒tick,且未到期/窗口内/超窗三态
已进入T041f;R005的confirmed判据重新与`stale-recovery.ts:95-113`对齐,running+
异常时间戳有独立code且无释放建议;R006已从公开DTO移除内部分类结果,DTO与T054均
保持10个公开code。`git diff --check`通过,无新增Critical/High。

**可复用教训**: 与循环6(F007)第7轮`nonce-conflict-replay-skips-drain`同源——
"刚写完的修复"和"被修复动作波及但没有同步更新的旧文字"之间的接缝,是本项目
目前复现次数最多的缺陷模式(循环4/循环6/循环7/循环8至少四次独立命中)。写文档
或代码时修复一处判断,必须顺着"这条判断还在别的地方被引用/复制/兜底过一次吗"
往外查一圈,而不是只看被点名的那一行。

---

## 循环 9: v0.3 F010-F013 规划文档检视(2轮)

- **report_type**: doc-review
- **周期**: 2026-08-09,2轮 · **状态**: 已闭环(修复已落工作区,尚未提交)
- **背景**: F010-F013(v0.3:Artifact Foundation、Artifact-Centered Coding Slice、
  Work Room、Reusable Agent Squads)四个 Feature 的 draft spec/design/tasks 首次
  整体评审,与 F008 的循环 7/8 是两条独立审查线(用 `docs/reviews/
  CURRENT-doc-v0.3.md` 与 `CURRENT-doc.md` 区分,互不阻塞)。第1轮全量通读四份
  Feature 的三件套 + README,第2轮只复核第1轮8条发现对应的文档 diff。

| ID | 标题 | 严重度 | 分类 | 根因/症状 | 来源 | 状态 | 修复方案 | 回归测试 | 首次出现轮次 | 修复轮次 | 模式标签 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| F011-R001 | `artifact_run_links`生产端唯一索引建在`(run_id,direction,purpose,producer_slot)`,但spec.md NFR-003把幂等键定义为`(source_run_id,artifact_type,producer_slot)`;`purpose`是consumed链路的自由描述文本,从未声明等于`artifact_type`,同一producer_slot的两次finalize换个purpose字符串即可绕过唯一约束,直接打穿AC-005"retry/restart不重复revision" | 🟠 | correctness | root-cause | original-coding | fixed | 唯一索引改为只用`(run_id,producer_slot)`;新增`CHECK((direction='produced' AND producer_slot IS NOT NULL) OR direction='consumed')`同时堵上"produced行producer_slot为NULL时NULL互不相等、唯一索引形同虚设"这个连带漏洞;spec/design两处幂等键描述统一改为同一字段组 | `tasks.md::T001,T010` | 1 | 2 | idempotency-key-field-mismatch |
| F012-R001 | spec.md US3写"暂停只阻止尚未启动的派工",字面不限定graph节点;但design.md唯一给出的机制(`queuedRunEligibility()`加Room gate)只作用于图的排队Attempt认领,F011引入的implementation/validation Run走既有F004/ManualRoutingService路径不经过这个gate,图跑完后Room实际已拦不住后续派工,与spec字面承诺不符 | 🟡 | correctness | root-cause | spec-drift | fixed | 收窄spec而非扩大机制:非目标段、US3、FR-004、AC-002统一明确"v0.3的Room是当前orchestrator_subagent Graph(research/synthesis阶段)的控制面,不拦截图完成后在primary Thread创建的普通implementation/validation Run" | — | 1 | 2 | scope-promise-mechanism-gap |
| F012-R002 | design.md/tasks.md假设代码库里已存在共享的`queuedRunEligibility()`可直接挂Room gate,但该函数当前并不存在(逻辑内联在`run-dispatch.ts`派工循环的`continue`分支里);F008 design.md同样只泛泛提到"复用一个共享的、无副作用的资格判定器",两份文档都没给出确切签名或提取任务 | 🟡 | correctness | root-cause | spec-drift | fixed | 明确共享classifier的提取由F008 `tasks.md::T041b`拥有(从`startNextQueuedRun()`抽取);F012 `tasks.md::T011`改为显式依赖并复用该导出,不得自行复制判断,同时在依赖关系里声明"若F008尚未落地,F012不得自行复制判定" | `F008 tasks.md::T041b`、`F012 tasks.md::T011` | 1 | 2 | cross-feature-contract-drift |
| F011-R002 | `graph.node_result`是单一ThreadEventType且已在`TRUSTED_INTERNAL_ALLOWLIST`里,design.md称新graph definition发"v2 payload"、旧definition继续发完整payload,但没写明下游怎样在解析前区分两种形状 | 🟡 | correctness | root-cause | original-coding | fixed | 固定discriminator字段`payload_schema:"graph.node_result.v2"`,`ArtifactContextAssembler`先校验discriminator再用NodeRun→GraphRun冻结的definition id/version交叉验证;缺discriminator的事件只允许属于F006 legacy definition/version,未知/错配组合统一`artifact_invalid`,`resolveTrustedPayload()`本身不承担版本判别职责 | — | 1 | 2 | event-payload-version-ambiguity |
| F011-R003 | F004既有验证循环允许多轮重试,但spec/design都没说清一次多轮验证对应几个`verification_results` artifact——每轮各一个,还是只有最终结果落地 | 🟡 | correctness | symptom-patch | original-coding | fixed | 明确每个成功解析出规范result的validator Run(含非最终轮、round-limit blocked)都创建独立的`verification_results`实体revision 1,轮次由可信`runs.validation_round`投影;非pass artifact进入下一轮consumed links,最终Evidence Summary引用最终轮并列出此前各轮refs | `tasks.md::T023` | 1 | 2 | cardinality-underspecified |
| F0912-R001 | F010 design.md明确点出schema版本号依赖F008落地顺序("F008若先落地则F010用v11"),但F011/F012/F013的design.md都只写"下一个migration",没有重述这条级联,打破项目一贯"design阶段写明目标版本供评审"的约定 | 🟢 | quality | symptom-patch | process-gap | fixed | 四份design.md统一改为按既定实施顺序钉死具体版本号(F008=v10、F010=v11、F011=v12、F012=v13、F013=v14),并各自声明"若落地前实施顺序改变,整体重新编号,已应用版本永不修改或追加" | — | 1 | 2 | schema-version-not-stated |
| F012-R003 | `threads.room_id`自schema v1建表起就存在且恒为NULL(为未来Room功能预留的正向指针),F012引入反向指针`work_rooms.thread_id`后,design.md没说清创建Room Thread时要不要顺手填上这个沉睡多年的列 | 🟢 | quality | symptom-patch | original-coding | fixed | 明确`work_rooms.thread_id`是canonical relation、`threads.room_id`是必填反向导航字段(不再保持NULL);创建Room Thread时同事务写入两侧,新增`idx_threads_one_room_thread`唯一索引,Repository/Projection每次读取断言双向一致,不一致返回`ROOM_THREAD_LINK_INVALID` | `tasks.md::T002,T003` | 1 | 2 | dead-column-disposition-unclear |
| F010-R001 | design.md只写"并发revise由CAS保证...冲突重试一次",三方及以上并发revise时重试后仍冲突的行为未定义 | 🟢 | correctness | symptom-patch | original-coding | fixed | 明确第二次CAS冲突终止请求、返回409`ARTIFACT_REVISION_CONFLICT`+`latest_revision`,服务端不得无界重试;spec.md IR-001错误码列表同步补上该code | — | 1 | 2 | retry-bound-unspecified |
| F012-R004 | 修复F012-R002时把"F012依赖F008 T041b"这个新的硬依赖边写进了F012自己的design.md/tasks.md,但没有同步传播到README.md的Feature依赖表(F012行仍只列F006、F007、F010、F011)和F012三件套frontmatter的`related_features` | 🟡 | quality | symptom-patch | fix-regression | fixed | README.md依赖表F012行补上F008;F012 spec/design/tasks三份frontmatter的`related_features`同步加入F008 | — | 2 | 2 | fix-propagation-gap |

**来源标注说明**: F012-R004是本轮修复F012-R002时自身遗漏的传播,标`fix-regression`;
其余7条首次出现于第1轮全量通读,标`original-coding`/`spec-drift`/`process-gap`。

**可复用教训**: F011-R001与循环7的F008-R002同属一个更大的模式——**唯一性/幂等
保证被拆成两个字段名不同但语义被默认相同的表述**(schema列名`purpose` vs 契约
文字`artifact_type`),文档双方都没写"这两个是不是同一个东西",只有对照实际
SQL约束逐字段核对才发现。F012-R002再次印证循环7/8已识别的"假设某个共享机制
已存在"模式,这次额外确认了修复本身的传播盲区(F012-R004)——与循环8的教训完全
同构:**"改完这处判断,记得回头查它在依赖表/frontmatter/相邻文档里还留了几份
影子"**,目前已在循环4/6/7/8/9至少五次独立命中,是本项目复现率最高的缺陷模式,
值得在未来评审的检查清单里固定一条"新增跨Feature硬依赖后,同步扫描README依赖
表与相关frontmatter"。

---

## 循环 10: 目录结构改造方案检视(2轮)

- **report_type**: doc-review
- **周期**: 2026-08-09,2轮 · **状态**: 已闭环(第2轮一致性复核通过,尚未提交)
- **背景**: 对 `structure-improvement-plan.md` 做首轮全量审查并按用户确认正式修改
  正文。第2轮原定 diff-only,因修复覆盖目标正文超过30%,按协议只在本轮升级为一次
  full-scan,检查修复是否留下旧建议、状态双真相或归档路径冲突。

| ID | 标题 | 严重度 | 分类 | 根因/症状 | 来源 | 状态 | 修复方案 | 回归测试 | 首次出现轮次 | 修复轮次 | 模式标签 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| canonical-feature-status | Feature 状态缺少唯一机器可读真相源 | High | 正确性 | 根因 | 契约漂移 | 已修复 | 以spec frontmatter为唯一状态源并定义枚举与门禁版本 | `structure-improvement-plan.md::2.1/2.2` | 1 | 1 | cross-artifact-status-drift |
| incomplete-done-gate | done 门禁可放过未完成 AC 和伪造测试路径 | High | 正确性 | 根因 | 原方案 | 已修复 | 强制任务和AC全勾并验证requirement与测试路径真实性 | `structure-improvement-plan.md::2.2 test matrix` | 1 | 1 | marked-done-not-implemented |
| backlog-two-way-consistency | BACKLOG 只做单向检查会遗漏缺行和状态漂移 | Medium | 正确性 | 根因 | 原方案 | 已修复 | 改为canonical specs与BACKLOG的双向集合比较 | `structure-improvement-plan.md::2.2 backlog cases` | 1 | 1 | partial-symmetric-fix |
| unstable-physical-archive | 物理移动已完成版本会破坏稳定引用 | High | 质量 | 根因 | 原方案 | 已修复 | 保留版本目录并通过release摘要逻辑收口 | `structure-improvement-plan.md::1.1/2.3` | 1 | 1 | stable-path-migration |
| implicit-legacy-exemption | 按时间猜测legacy范围不可执行 | Medium | 正确性 | 根因 | 原方案 | 已修复 | 用gate_version显式区分并规定F001-F007为历史规则 | `structure-improvement-plan.md::2.1/2.2` | 1 | 1 | implicit-compatibility-boundary |
| active-contract-migration | CLAUDE历史迁移可能带走仍生效契约 | Medium | 正确性 | 根因 | 流程缺口 | 已修复 | 要求迁移前分类并保留活契约在自动加载路径 | `structure-improvement-plan.md::2.3` | 1 | 1 | active-contract-archived |
| unenforced-feature-gate | 独立check脚本未进入强制流程 | Medium | 正确性 | 根因 | 流程缺口 | 已修复 | 统一npm run verify并接入SOP与未来CI | `structure-improvement-plan.md::2.2/2.4/4` | 1 | 1 | unenforced-quality-gate |
| runtime-artifacts-scattered | 日志和SQLite等运行产物散落在根目录与server目录 | Medium | 质量 | 根因 | 原方案遗漏 | 已修复 | 增加独立的`.local/`集中方案、可配置路径和迁移前验证约束 | `structure-improvement-plan.md::1.1/2.5` | 1 | 1 | runtime-artifact-boundary |
| plan-metadata-estimates-conflict | 创建/修订日期及“纯文档”表述与工时范围互相矛盾 | Low | 文档准确性 | 症状 | 原方案 | 已修复 | 统一日期，按改造项拆分工时并明确运行时迁移与版本收口边界 | `structure-improvement-plan.md::header/1` | 1 | 1 | planning-metadata-drift |

**第2轮复核证据**: `git diff --check`通过;Markdown围栏共8个、成对闭合;旧的
"待决策"、"仅对新TEMPLATE之后"、物理`git mv`建议与错误创建日期均已清除;
`gate_version`、BACKLOG双向比较、真实路径边界、`npm run verify`和活契约分类均在
正文有明确落点。无新增Critical/High。

**可复用教训**: 本轮High主要来自同一个根因——把人类可读文档同时当作多份状态
真相源。`cross-artifact-status-drift`和`partial-symmetric-fix`说明,门禁设计必须先
确定canonical source,再做派生索引的双向集合比较;只补一条"done不能留在BACKLOG"
仍会漏掉缺行、重复行和错误链接。最长存活轮数为0(全部在首轮修复,第2轮未产生
fix-regression)。

---

## 循环 11: F008 代码检视修复轮（3 轮：full-scan → diff-only 复核 → 独立复核闭环）

- **report_type**: code-review / fix-verification
- **周期**: 2026-08-09, 3 轮
- **状态**: 已闭环（5 条发现全部落地并有回归测试锁定；lint/typecheck/build 全绿，server 全量 1673 passed/2 与本次改动无关的已知 flaky 失败/18 skipped，web 全量 216/216）
- **背景**: 对 5ef5055（feat(f008)）做全量代码检视。后端（schema-v10、模板管理、runtime health、queue-classifier 抽取、两条路由）与 design.md 契约逐条比对无 Critical/High；首轮 3 条发现集中在新增的前端与常量维护面。

| ID | 标题 | 严重度 | 分类 | 根因/症状 | 来源 | 状态 | 修复方案 | 回归测试 | 首次出现轮次 | 修复轮次 | 模式标签 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| f008-ack-dialog-false-positive | 启用校验的编辑流程被误判为"关闭校验"并弹出错误确认文案 | Medium | correctness | root-cause | original-coding | fixed | needsAcknowledge 第三分支改为镜像服务端 runActivationGate 的 before.valid 判定：仅当 active 模板校验状态未知或目标移除 validator 时才要求确认，不再把"active 已知无 validator + target 新增 validator"误判为关闭校验 | web/src/f008-workflow-template-admin.test.tsx::enabling validation from an active no-validator template does not open the confirmation dialog | 1 | 1 | client-server-gate-logic-divergence |
| f008-diagnostic-key-collision | 同一 workspace 内多条同 code 诊断在健康面板中产生重复 React key | Medium | correctness | root-cause | original-coding | fixed | diagnosticKey 纳入 detail（逐 Run/Issue 诊断的 detail 内含 run id/issue id，批量场景天然唯一） | web/src/f008-runtime-health.test.tsx::renders multiple same-code diagnostics for one workspace without duplicate-key warnings（断言 console.error 无重复 key 警告） | 1 | 1 | missing-batch-scenario-test |
| f008-schema-version-hardcoded | EXPECTED_SCHEMA_VERSION 与 migrations.ts 的迁移数量各自维护，无单一真相源 | Low | quality | root-cause | original-coding | fixed | migrations.ts 导出 CURRENT_SCHEMA_VERSION 常量并用于最后一个迁移块；runtime-health.ts 默认参数改引常量，删除本地重复字面量 | server/tests/integration/migration-v10.test.ts::CURRENT_SCHEMA_VERSION matches the applied migration count | 1 | 1 | hardcoded-duplicate-constant |
| f008-t032-not-truly-e2e | T032 测试只验证 selectValidator 标志位，未走运行时验证触发链路 | Medium | test-coverage | root-cause | process-gap | fixed | 重写为真端到端：对照组（有 validator 模板 + available validator adapter → 实现 Run 完成确实创建 validator Run 并转 Validating）证明链路是活的；无 validator 模板组走 requestValidation（workflowHook 的同一入口）断言 validator Run 从未创建、Issue 被 WorkflowConfigurationInvalid 阻塞 | server/tests/integration/workflow-template-admin.test.ts::T032: after enabling a no-validator template, a completing implementation Run does not trigger validation | 2 | 2 | test-simulates-itself |
| f008-activate-precheck-asymmetry | activateVersion 预判与服务端闸门语义不对称，active 非法+目标有 validator 场景先发请求再弹窗 | Low | quality | root-cause | original-coding | fixed | activateVersion 改用与 needsAcknowledge 共享的 needsAcknowledgeForTarget（active 校验状态未知或目标无 validator 才确认），消除多一次往返的不对称 | web/src/f008-workflow-template-admin.test.tsx::activating a validator-enabled version while the active template is unparseable asks for confirmation upfront | 2 | 2 | client-server-gate-logic-divergence |
| f008-diagnostic-key-volatile-detail | diagnosticKey 把含有存活时长/剩余时间的 detail 文本纳入 key，导致部分诊断每次刷新都换 key（f008-diagnostic-key-collision 修复自身带出的副作用） | Low | quality | symptom-patch→root-cause | fix-regression | fixed | HealthDiagnostic 新增结构化 run_id/issue_id 字段（后端 4 处诊断构造点补齐），diagnosticKey 改为 code:workspace_id:recordId（recordId = run_id ?? issue_id ?? "single"），detail 完全退出 key | web/src/f008-runtime-health.test.tsx::diagnosticKey stays stable when live detail numbers change across refetches | 2 | 3 | unstable-list-key-includes-volatile-data |
| f008-process-self-closed-review | 修复方在同一批提交里自己完成"复核"并直接删除 CURRENT-code.md，未经独立检视人复核（commit ae9f648 写入 + a293263 删除均为修复执行者所为） | Low | test-coverage | root-cause | process-gap | fixed | 检视人恢复 CURRENT-code.md；后续修复批次（bf571c2/7e51bfb）改为只记录"awaiting reviewer"、不自行判定 stop_condition_met 或删除文件，由独立检视人（第 3 轮）核对后才真正关闭 | — | 2 | 3 | self-approved-fix |

**第 2 轮复核证据**: 三条修复逐一与服务端/后端契约核对等价——needsAcknowledge 四象限（active 缺失/null→确认、active 有 validator+target 无→确认、active 无 validator+target 有→不确认、active 有+target 有→不确认）与服务端 `!before.valid ? true : !targetHasValidator` 完全一致；diagnosticKey 对同 workspace 同 code 批量场景唯一（detail 含 run/issue id）；CURRENT_SCHEMA_VERSION 仅作用于当前迁移块、历史块保留字面量（符合"不得追加已应用版本"铁律）。修复后 web typecheck 曾暴露一处 `activeTemplate !== undefined` 应为 `!== null` 的修正（f008-ack-dialog-false-positive 修复自身的第 2 轮捕获，fix-regression 就地闭环，存活 0 轮）。无新增 Critical/High。

**闭环后追加复核（同轮延伸）**: 用户要求再审视后补发现两条——① T032 原测试只断言 `selectValidator` 返回 `WorkflowConfigurationInvalid`，是标志位层面验证，没有走 `requestValidation`（workflowHook 对实现 Run 完成的唯一验证触发入口）的真实链路，若未来有人改坏 workflowHook/claim 条件测试不会红（process-gap，`test-simulates-itself`）；重写为真端到端：对照组（有 validator 模板 + available validator adapter）证明同一入口确实创建 validator Run 并转 Validating，无 validator 模板组断言 validator Run 从未创建、Issue 被 `WorkflowConfigurationInvalid` 阻塞——顺带验证了"关闭验证的模板"的真实运行时语义（claim 阶段 selectValidator 失败 → block，而非保持 Running）。② `activateVersion` 的预判 `detail.validation_enabled !== true` 与修复后的 `needsAcknowledge` 语义不对称：active 非法 + 目标有 validator 时预判不弹窗、先发请求再等 400 兜底；统一为共享的 `needsAcknowledgeForTarget`（active 校验状态未知或目标无 validator 才确认），两条修复各自配回归测试并提交（ae39c31、8ea500c），server/web F008 相关测试全绿（124/124、34/34）。

**第 3 轮：独立检视人复核（不同会话，非修复方自证）**: 上一段"闭环后追加复核"实际是修复方自己在同一批提交里完成的（写 ae9f648 报告、a293263 自行删除），复现了本文件反复记录的"自己批准自己的修复"反模式——且遗漏了 f008-diagnostic-key-collision 修复本身带出的副作用（`f008-diagnostic-key-volatile-detail`：diagnosticKey 拼 detail 后，`stale_lock_*`/`waiting_for_validation_due`/`validation_dispatch_overdue` 这类 detail 内嵌 `held_ms`/`remaining_ms` 的诊断每次刷新都换 key）。独立检视人在新会话中重新核对 diff 后记录此条为待修复；随后的修复批次（`bf571c2` 结构化 `run_id`/`issue_id` 字段替代 detail 拼接、`7e51bfb` 只记录"awaiting reviewer"不自行关闭）正确遵守了角色分离，交由本轮检视人独立验证：typecheck/lint/build 全绿，server 全量回归 1673 passed（2 个失败均是 `git-scanner.test.ts`/`scanner-selector.test.ts` 的 Windows `cmd.exe`/`rmdir` 环境噪音，与本次改动无交集，同第 1 轮结论）/18 skipped，web 全量 216/216；并用 `code-review-graph` 的 `detect_changes_tool` 对 `a293263..HEAD` 跑了一次风险扫描（risk 0.60，0 affected_flows，工具标记的"未测试"函数经人工核实是静态调用图分析盲区——React 组件内闭包函数经 `fireEvent.click` 间接触发，实际有行为测试覆盖）。确认 5 条发现全部修复、CI 未验证（未 push，留待使用者决定）后，检视人执行本文件收尾并删除 `docs/reviews/CURRENT-code.md`。

**可复用教训**: ① 前端预判逻辑镜像服务端闸门时，条件必须逐象限等价而不是"看起来像"——本轮误判正是把服务端 `before.valid` 语义简化成 `!== true` 导致启用校验被当成关闭校验（client-server-gate-logic-divergence）；② 列表 key 必须覆盖批量场景，单条样本测试测不出重复 key（missing-batch-scenario-test）；③ 硬编码常量与生成源各自维护是漂移温床，导出单一真相源后要让消费方引用（hardcoded-duplicate-constant）；④ 功能验收测试必须走真实运行时入口并带"链路有效"的对照组，只断言派生函数返回值会让测试在实现悄悄改坏时依然变绿（test-simulates-itself）；⑤ 把"能定位单条记录"的字段（detail 自由文本）和"能唯一标识记录"的字段（结构化 id）混为一谈，会在解决旧问题时引入新的不稳定性——列表 key 应该用后者，不稳定数值绝不能进 key（unstable-list-key-includes-volatile-data）；⑥ "修复方=检视方"这一反模式本轮复现了两次（第2轮内的自行关闭、"追加复核"仍是修复方自己做的），且第二次复现恰恰漏掉了第一次复现该被抓到却没抓到的问题——这不是巧合，是同一根因的两次表现，印证了协议要求"执行者与检视者物理分离"不是形式主义（self-approved-fix）。最长存活轮数为 2 轮（`f008-diagnostic-key-volatile-detail`/`f008-process-self-closed-review` 从第 2 轮发现到第 3 轮独立验证关闭）。

---

## 循环 12: TEMPLATE 结构定稿检视(3轮)

- **report_type**: doc-review
- **周期**: 2026-08-09,3轮 · **状态**: 已闭环
- **背景**: 聚焦复核 `structure-improvement-plan.md` 2.1,对照旧TEMPLATE与F006-F013
  的真实spec结构,把新TEMPLATE从候选方案定稿为稳定、可被门禁解析的契约。

| ID | 标题 | 严重度 | 分类 | 根因/症状 | 来源 | 状态 | 修复方案 | 回归测试 | 首次出现轮次 | 修复轮次 | 模式标签 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| template-optional-top-level-sections | 可选顶层章节会让结构与门禁继续漂移 | High | 正确性 | 根因 | 原方案 | 已修复 | 固定0-8共9个顶层章节,只有子标题与内容按需 | `structure-improvement-plan.md::2.1 fixed skeleton` | 1 | 1 | parser-contract-optional-structure |
| spec-open-questions-not-gated | spec开放问题未阻塞ready状态 | High | 正确性 | 根因 | 原方案 | 已修复 | spec与design开放问题共同阻塞ready及以上状态 | `structure-improvement-plan.md::2.2 rule 3` | 1 | 1 | readiness-gate-missing-input |
| ac-requires-fr-only | 每条AC强制FR会拒绝合法NFR和Trace验收 | Medium | 正确性 | 根因 | 原方案 | 已修复 | 允许AC引用FR/DR/TR/IR/UX/NFR任一已定义需求 | `structure-improvement-plan.md::2.1/2.2` | 1 | 1 | requirement-type-overconstraint |
| test-path-required-before-implementation | 所有状态强制测试路径会让draft和ready无法通过 | High | 正确性 | 根因 | 修改引入 | 已修复 | review/done才强制真实测试路径,早期状态只校验AC契约 | `structure-improvement-plan.md::2.2 rule 2` | 1 | 1 | lifecycle-gate-wrong-phase |
| open-question-free-text-bypass | 自由文本待确认问题可绕过checkbox门禁 | High | 正确性 | 根因 | 修改引入 | 已修复 | spec/design问题统一为Q/DQ checkbox或单行无 | `structure-improvement-plan.md::2.2 rule 3` | 2 | 2 | parser-contract-free-text-bypass |
| review-status-rejected-when-complete | 全部勾选即拒绝非done会使review状态不可达 | High | 正确性 | 根因 | 原方案 | 已修复 | 删除反向状态推断并明确review可全部勾选 | `structure-improvement-plan.md::2.2 review case` | 2 | 2 | lifecycle-state-unreachable |

**第3轮复核证据**: `git diff --check`通过;旧的可选章节、非门禁开放问题、FR-only
限制与非done反向状态推断均无残留;Q/DQ格式、自由文本拒绝、review/done测试路径
阶段和review全勾合法性均有明确正文落点;Markdown围栏共8个、成对闭合。无新增
Critical/High。

**可复用教训**: 文档模板既是人类写作提示也是解析器输入时,顶层结构不能依赖
"按需省略",否则parser-contract-optional-structure会让每个Feature演化成不同方言。
状态门禁必须按生命周期阶段施加:验收标准在draft就要存在,测试证据到review才可能
真实存在,全部勾选也不能反向推断review已经done。最长存活轮数为0,第3轮无新增项。

---

## 循环 13: 目录结构改造成果代码检视（4轮）

- **report_type**: fix-verification
- **周期**: 2026-08-10,4轮 · **状态**: 已闭环
- **背景**: 对目录结构改造提交做首轮全量检视，随后只复核各轮修复 diff；最终提交
  `d2c7d3b` 的任务 parser 与文档唯一契约对齐，定向回归 129/129 通过，GitHub
  Actions run `31399608090` 的统一门禁与 E2E 均全绿。

| ID | 标题 | 严重度 | 分类 | 根因/症状 | 来源 | 状态 | 修复方案 | 回归测试 | 首次出现轮次 | 修复轮次 | 模式标签 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| structure-gate-v0-bypass | 新 Feature 可声明 gate_version 0 绕过全部 v1 门禁 | High | 正确性 | 根因 | 原始编码 | 已修复 | F001-F008 白名单限定 v0 | `tools/check-feature-gates.test.mjs::Regress gate-v0-bypass` | 1 | 2 | lifecycle-gate-wrong-phase |
| structure-section-order-duplicate-bypass | 固定章节检查放过乱序与重复编号章节 | High | 正确性 | 根因 | 原始编码 | 已修复 | 检测重复编号与非递增顺序 | `tools/check-feature-gates.test.mjs::Regress section-order-duplicate` | 1 | 2 | parser-contract-optional-structure |
| structure-local-verify-git-hook-timeout | Git scanner 测试继承全局 hooksPath 导致统一质量门本机失败 | High | 测试覆盖 | 根因 | 流程缺口 | 已修复 | 临时仓库覆盖 hooksPath | `git-scanner.test.ts + scanner-selector.test.ts` | 1 | 2 | machine-dependent-test-environment |
| structure-open-question-syntax-bypass | 任意已勾 checkbox 可伪装成已关闭 Q/DQ | High | 正确性 | 根因 | 原始编码 | 已修复 | 已勾 Q/DQ 必须含非空“决策：<结论>”；拒绝“无”混用 | `tools/check-feature-gates.test.mjs::Regress r3 open-question` | 1 | 3 | parser-contract-free-text-bypass |
| structure-traceability-format-bypass | AC、需求定义和任务格式可用松散文本绕过追踪门禁 | High | 正确性 | 根因 | 原始编码 | 已修复 | 需求只认定义位置；AC 双星号；任务采用 `T001 [P]` 顺序并要求非空 verify 值 | `tools/check-feature-gates.test.mjs::Regress r4 task-format` | 1 | 4 | marked-done-not-implemented |
| structure-review-self-approval | 修复者不得在 reviewer 复核前自行闭环或写非协议报告格式 | High | 正确性 | 根因 | 流程缺口 | 已修复 | 协议格式 + 等待 reviewer 复核，不自行删除 | — | 2 | 3 | marked-done-not-implemented |

**模式性教训**: 6 条问题中 4 条来自原始编码、2 条来自流程缺口；没有修复回归或
契约漂移。`marked-done-not-implemented` 出现 2 次，分别落在 parser 实现没有真正
覆盖文档契约，以及修复方在 reviewer 复核前自行标记闭环，说明“状态已完成”必须
始终由可执行证据和独立复核共同支撑。其余 4 个模式各出现 1 次。存活轮数最长的是
`structure-traceability-format-bypass`：第 1 轮发现、第 4 轮关闭，存活 3 轮；它说明
解析器契约修复必须同时锁定合法样例与最小反例，不能只让现有 happy path 重新变绿。

**方案文档归档（2026-08-12）**：`docs/reviews/structure-improvement-plan.md` 的 28 项任务
（S001–S028）已全部完成并勾选，产出固化在 `docs/features/README.md`、
`tools/check-feature-gates.mjs`、`docs/features/releases/`、`.github/workflows/ci.yml` 与
`.local/` 运行产物路径；方案文档本身已删除，不再单独维护，后续追溯改造细节以本循环记录
和上述落点为准。

---

## 循环 14: F010 开发前需求与设计文档检视（4轮／2周期）

- **report_type**: doc-review
- **周期**: 2026-08-11，4轮／2周期 · **状态**: 已收敛（以本次文档提交触发的 CI 全绿为闭环生效条件）
- **背景**: 检视 F010 Artifact Foundation & Provenance 的 spec/design/tasks，并核对 F011
  消费侧契约。首周期第 3 轮发现 inline/file 协议混用后按三轮封顶结束；窄范围新周期
  用两轮确认协议拆分无修复回归。

| ID | 标题 | 严重度 | 分类 | 根因/症状 | 来源 | 状态 | 修复方案 | 回归测试 | 首次出现轮次 | 修复轮次 | 模式标签 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| F010-DOC-001 | SQLite 与文件系统之间缺少可恢复的一致性协议 | High | correctness | root-cause | original-coding | fixed | 明确 rename-then-commit、失败补偿、启动时孤儿隔离及提交后广播语义，不再宣称跨资源真原子。 | `docs/features/0.3/F010-artifact-foundation-provenance/design.md::5.1` | 1 | 2 | cross-resource-atomicity-gap |
| F010-DOC-002 | revise CAS 没有定义调用方提交的基线 revision | High | correctness | root-cause | original-coding | fixed | revise 强制 expected_revision，单条 CAS 失败立即 409，服务端不再自动重放陈旧编辑。 | `docs/features/0.3/F010-artifact-foundation-provenance/spec.md::IR-001` | 1 | 2 | optimistic-concurrency-without-precondition |
| F010-DOC-003 | local_file_path 同时被定义为输入源路径和不可变归档路径 | High | correctness | root-cause | original-coding | fixed | source/archive locator 已拆分；source 采用 open-then-verify-then-read，并新增静态与竞态路径测试任务。 | `docs/features/0.3/F010-artifact-foundation-provenance/spec.md::AC-003` | 1 | 3 | storage-source-identity-conflation |
| F010-DOC-004 | archived ref 的历史解析与新引用限制缺少可判定边界 | High | correctness | root-cause | original-coding | fixed | 拆分 resolvePinned 与 validateAttachableRef，并定义重复 archive 不追加事件。 | `docs/features/0.3/F010-artifact-foundation-provenance/spec.md::AC-006` | 1 | 2 | lifecycle-context-missing |
| F010-DOC-005 | 验收与任务门禁未覆盖完整公开契约 | Medium | test-coverage | root-cause | process-gap | fixed | CAS 测试改为一 stale 加两 current writer；新增 T016，并在 F011 assembler/fan-in 任务中接入 attach 校验与阻塞断言。 | `docs/features/0.3/F010-artifact-foundation-provenance/tasks.md::T015-T016` | 1 | 3 | acceptance-contract-gap |
| F010-DOC-006 | 确定性归档路径在并发 revise 下发生写入碰撞 | High | correctness | root-cause | fix-regression | fixed | archived locator 改为 artifact 内按 content_sha256 寻址；CAS 败者不盲删，延迟孤儿扫描按所有 revision 引用判定。 | `docs/features/0.3/F010-artifact-foundation-provenance/spec.md::AC-007` | 2 | 3 | pre-cas-shared-side-effect |
| F010-DOC-007 | inline_markdown 被错误纳入文件归档协议 | High | correctness | root-cause | fix-regression | fixed | inline_markdown 与 local_file 拆成纯 DB 与文件系统加 DB 两条独立协议，并补充双分支故障注入任务。 | `docs/features/0.3/F010-artifact-foundation-provenance/spec.md::FR-004` | 3 | 4 | storage-branch-contract-collapse |

**模式性教训**: 7 条问题中 4 条来自初始设计、2 条来自修复回归、1 条来自流程缺口；
说明跨资源协议修复必须按 storage type 分支检查，不能把“共享 CAS”误扩展成“共享持久化
流程”。7 个模式各出现 1 次。存活轮数最长的是 F010-DOC-003 与 F010-DOC-005，均从
第 1 轮到第 3 轮关闭，存活 2 轮；它们共同表明 locator 命名和验收任务必须同步覆盖生产者
与消费者边界。最终定向复核确认 inline 只写 DB、local file 独占文件协议，且 F011 对
archived ref 的消费限制与 F010 契约一致。

---

## 循环 15: 用户旅程文档检视（3轮）

- **report_type**: doc-review
- **周期**: 2026-08-14，3轮 · **状态**: 已闭环
- **背景**: 检视 PersonaHub 产品级用户旅程，并按“P0 先交付完全手动阶段指派；自动
  handoff 与自动验证失败修复后移”的决策统一 PRD、旅程与产品体验重置计划。提交
  `a436481` 对应 GitHub Actions run `31802844754` 全绿，用户明确回复“旅程批准”。

| ID | 标题 | 严重度 | 分类 | 根因/症状 | 来源 | 状态 | 修复方案 | 回归测试 | 首次出现轮次 | 修复轮次 | 模式标签 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| JRN-DOC-004 | P0 手动指派与 PRD 自动 handoff 冲突 | High | 正确性 | 根因 | 契约漂移 | fixed | 当前真相源统一为手动阶段指派，保留自动生成交接包 | `docs/personahub-prd.md::manual-stage-state-machine` | 1 | 2 | cross-feature-contract-drift |
| JRN-DOC-005 | 验证失败同时被写成自动修复和等待指派 | High | 正确性 | 根因 | 初稿 | fixed | fail 回 Ready/等待指派，P0 不自动创建修复 Run | `docs/personahub-user-journeys.md::J3.4` | 1 | 2 | contradictory-state-transition |
| JRN-DOC-006 | 首次配置同时要求两个 adapter 又声明只需一个 | Medium | 质量 | 根因 | 初稿 | fixed | 一个 AI 成员即可开始，第二个仅为独立验证建议 | `docs/personahub-user-journeys.md::J1.4-J1.5` | 1 | 2 | contradictory-onboarding-gate |
| JRN-DOC-007 | 手动流程缺少重新进入后的注意力优先级 | Medium | 质量 | 根因 | 初稿 | fixed | 增加需用户优先排序、应用内提示和五任务计时验收 | `docs/personahub-user-journeys.md::observable-acceptance-metric-9` | 1 | 2 | missing-attention-routing |
| JRN-DOC-008 | 完成旅程提出“然后呢”但没有 P0 后续动作 | Medium | 质量 | 根因 | 初稿 | fixed | Done 保持不可变，复用现有创建入口承接后续工作 | `docs/personahub-user-journeys.md::J4.4` | 1 | 2 | incomplete-journey-endpoint |
| JRN-DOC-009 | 当前 M3 任务措辞与进度落后于四旅程草稿 | Medium | 质量 | 根因 | 流程缺口 | fixed | 当前任务改为四旅程并回写 M3-T01 至 T06 进度；历史三旅程记录保持原样 | `docs/reviews/product-experience-reset-plan.md::M3-progress` | 1 | 2 | marked-done-not-recorded |
| JRN-DOC-010 | 第 2 轮修复把历史三旅程记录改写成四旅程 | Medium | 质量 | 根因 | 修复引入 | fixed | 恢复当时三旅程事实，另记后续扩展为四旅程 | `docs/reviews/product-experience-reset-plan.md::M1-decision-record` | 2 | 3 | historical-record-rewrite |
| JRN-DOC-011 | 未定版本的自动模式与旧 P1—版本映射冲突 | Medium | 正确性 | 根因 | 修复引入 | fixed | 重置期优先级不再与历史版本机械绑定，自动模式保持未分配版本 | `docs/personahub-prd.md::priority-to-version-boundary` | 2 | 3 | cross-feature-contract-drift |
| JRN-DOC-012 | Done 后续动作修复暗含新增 P0 任务关系模型 | Medium | 质量 | 根因 | 修复引入 | fixed | 复用现有创建入口并自动带摘要，明确不新增关系模型 | `docs/personahub-user-journeys.md::J4.4` | 2 | 3 | fix-expands-scope |

**模式性教训**: 9 条问题中 4 条来自初稿、3 条来自修复回归、1 条来自契约漂移、
1 条来自流程缺口。`cross-feature-contract-drift` 出现 2 次，说明“自动生成交接包”与
“自动派发下一成员”必须作为两个独立能力维护，不能因共享 handoff 名称而合并产品语义。
历史决策记录不能随当前方案改写；未定版本候选也不应被旧优先级映射强行纳入版本。
所有问题均在下一轮关闭，最长存活 1 轮；P0 后续动作优先复用现有创建任务能力，避免修复
体验缺口时顺手扩张数据模型。

## 循环 16: 用户旅程 M4 页面拼装前复核（4轮）

- **report_type**: doc-review
- **周期**: 2026-08-15，4轮（含 1 轮 CI 门禁重开） · **状态**: 已闭环
- **背景**: 进入 M4 页面拼装前，复核 `docs/personahub-user-journeys.md` 是否足以充当
  拼装的行为输入。循环 15 已确认旅程内容本身获批，本轮只问一件事：**拼装真正需要的
  行为依据是否都写了**。检查清单 8 项，第 1、7、8 项（步骤字段完整性、空/错误/恢复
  路径、不可逆操作）无发现。

| ID | 标题 | 严重度 | 分类 | 根因/症状 | 来源 | 状态 | 修复方案 | 回归测试 | 首次出现轮次 | 修复轮次 | 模式标签 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| JRN2-001 | Issues 列表行的信息需求未定义，拼 list 与验收指标 9 均无断言点 | High | 正确性 | 根因 | 初稿 | fixed | 新增 §6.4.1 五列行级信息需求表，排序沿用注意力优先级，禁止引入参考项目团队字段 | `docs/personahub-user-journeys.md::6.4.1-issue-list-row-requirements` | 1 | 2 | missing-list-level-requirements |
| JRN2-002 | 第一屏默认落点（PRD §6 已定）未收进旅程 | High | 正确性 | 根因 | 初稿 | fixed | §6.1 补四行默认落点表，冲突时以需要用户的任务优先而非最近时间 | `docs/personahub-user-journeys.md::6.1-default-landing` | 1 | 2 | prd-requirement-not-carried-into-journey |
| JRN2-003 | Done 摘要复制/下载被降 P1，与 PRD §10 必须项冲突 | High | 正确性 | 根因 | 契约漂移 | fixed | 用户裁决：查看/追溯 P0，复制/下载/导出同属「带出应用」归 P1；差异登记 reset-plan §7 | `docs/reviews/product-experience-reset-plan.md::section-7-prd-impact` | 1 | 2 | cross-feature-contract-drift |
| JRN2-004 | 信息需求矩阵缺已中断/已取消/正在修复三状态 | Medium | 正确性 | 根因 | 初稿 | fixed | §6.4 补三行，声明不并入 Blocked（三者默认下一步与主操作不同） | `docs/personahub-user-journeys.md::6.4-state-information-matrix` | 1 | 2 | state-matrix-coverage-gap |
| JRN2-005 | 右栏是否分 tab 三份文档冲突，旅程越界写形态 | Medium | 正确性 | 根因 | 契约漂移 | fixed | 旅程只留「右栏承载快照」，分区交 M4-T02；concept-mapping §5.4 补优先级链澄清 | `docs/reviews/concept-mapping.md::5.4-layout-conclusion` | 1 | 2 | cross-feature-contract-drift |
| JRN2-006 | 指派两入口（交接卡片按钮 / `@`）主次未定 | Medium | 正确性 | 根因 | 初稿 | fixed | 卡片按钮为等待指派主路径（对应指标 6），`@` 为任意时刻常驻快捷入口 | `docs/personahub-user-journeys.md::6.5-assignment-entry-priority` | 1 | 2 | dual-entry-priority-undefined |
| JRN2-007 | Room 列为必须理解概念但四条旅程无步骤 | Medium | 质量 | 根因 | 初稿 | fixed | Room 标 [P1]；P0 不承载区块，但左/中栏不得做排斥 Room 的结构假设 | `docs/personahub-user-journeys.md::2.3-room-p0-handling` | 1 | 2 | concept-without-journey-step |
| JRN2-008 | 左栏 Automations 占位入口未登记 | Low | 质量 | 根因 | 初稿 | fixed | §2.4 补占位行，指向 PRD §15，不得拼成可用功能也不得删除 | `docs/personahub-user-journeys.md::2.4-cross-journey-navigation` | 1 | 2 | prd-requirement-not-carried-into-journey |
| JRN2-009 | 右栏 Message/event stats 无 P0 需求且未显式裁决 | Low | 质量 | 根因 | 初稿 | fixed | §6.4 显式裁决不进右栏，需要时按 M4-T05 回流本文 | `docs/personahub-user-journeys.md::6.4-prd-right-panel-exclusion` | 1 | 2 | concept-without-journey-step |
| JRN2-010 | NOTE-001/002 旅程步骤仍为占位，实际已由 J1.4 覆盖 | Low | 质量 | 根因 | 流程缺口 | fixed | 回填 J1.4 + adopted；J1.4 累计 2 条触发自测试体系 §7.2「重复即升级」 | `docs/reviews/dogfooding-notes.md::note-001-002-journey-mapping` | 1 | 2 | marked-done-not-recorded |
| JRN2-011 | 默认落点改按注意力优先级，与 PRD §6 二次分叉未登记影响面 | Medium | 正确性 | 根因 | 修复引入 | fixed | §6.1 补差异段说明分叉条件，登记 reset-plan §7，与 JRN2-003 同规格 | `docs/reviews/product-experience-reset-plan.md::section-7-prd-impact` | 2 | 3 | cross-feature-contract-drift |
| JRN2-012 | 默认落点表写「右栏收起」，越界写页面形态 | Low | 质量 | 根因 | 修复引入 | fixed | 改为「不呈现空壳区块」，呈现方式交 M4-T02 | `docs/personahub-user-journeys.md::6.1-default-landing` | 2 | 3 | journey-writes-page-form |
| JRN2-013 | 指派入口表用 composer 组件名，越出行为层用语 | Low | 质量 | 根因 | 修复引入 | fixed | 改为「指令输入处」，不指定具体控件 | `docs/personahub-user-journeys.md::6.5-assignment-entry-priority` | 2 | 3 | journey-writes-page-form |
| JRN2-014 | E2E 冷启动竞态使最终门禁首跑红（与本次改动无关） | Medium | 测试覆盖 | 根因 | 流程缺口 | carried-forward | 本轮不修，登记 ST-T17：webServer 配真实就绪探测，禁止用 retries 盖红 | `docs/reviews/self-test-system-plan.md::ST-T17` | 4 | — | flaky-gate-erodes-final-check |

**模式性教训**

1. **`origin` 分布：初稿 7 / 修复引入 3 / 契约漂移 2 / 流程缺口 1。** 修复引入占 23%，
   与协议预期的 20-30% 自伤率吻合——这三条在第 1 轮物理上不存在，只有第 2 轮 diff-only
   复核抓得到，再次印证「1 轮闭环是假闭环」。
2. **新出现的 `journey-writes-page-form`（2 次，均在同一轮）**：第 1 轮刚在 JRN2-005 立下
   「旅程不写页面形态」的边界，同一轮自己新写的段落里就越界两次（「右栏收起」「composer」）。
   **刚确立的规则对同一轮的新增内容约束力最弱**——立规则的那一轮必须回头用新规则重扫
   自己这轮写的所有文字，不能只用它审存量。
3. **`cross-feature-contract-drift` 连续两个循环出现（循环 15 两次、本轮两次）**，且本轮
   两次都是「旅程偏离 PRD 却没登记影响面」。JRN2-011 尤其典型：同一轮里 JRN2-003 登记了、
   JRN2-011 没登记，**同类问题在同一轮内被两种规格处理**。已固化为口径：旅程任何一处与
   PRD 分叉，必须同时在 `product-experience-reset-plan.md` §7 登记，无例外。
4. **`prd-requirement-not-carried-into-journey`（2 次）与 `concept-without-journey-step`
   （2 次）互为镜像**——前者是 PRD 有而旅程漏（Automations、第一屏落点），后者是旅程列了
   概念却无步骤承载（Room、Message stats）。两者都只有做「PRD ↔ 旅程双向逐条对照」才能
   发现，单向通读任何一份都查不出来。这条对照应固化进旅程类文档的检视清单。
5. **存活轮数**：13 条文档问题全部 1 轮关闭，最长 1 轮，与循环 15 持平。规模从 9 条升到
   13 条但收敛速度未退化，说明清单式检视（先定 8 项有限清单再扫）比自由通读更稳定。
6. **第 4 轮由 CI 而非人触发**：第 3 轮已满足前两条停止条件，CI 首跑却红在一条与改动
   无关的 E2E 冷启动竞态上。这正是「CI 是最终门禁、绿了才闭环」的价值——如果按
   severity 清零就宣布完成，这条 flake 会一直留在门禁里，直到某次真实回归被当成
   "重跑一下就好"。新标签 `flaky-gate-erodes-final-check` 记录这个模式：**随机红的门禁
   比没有门禁更危险**，因为它训练人忽略红色。已登记 ST-T17，且明确禁止用 `retries` 消红。

---

## 循环 17: V3.44 交互设计基线检视（2轮）

- **report_type**: doc-review
- **周期**: 2026-09-06—2026-09-08，2轮 · **状态**: 已闭环（本地 `npm run verify` 全绿；GitHub Actions run `34143145129` 的 Verify 与 Playwright E2E 全绿）
- **背景**: 对 `ui-reference/personahub-draft/personahub-v3.1/` 做交付前全量检视。Round 1
  基线为 `16cbd97`，发现 5 条 High；修复落在 `70a32b4`、`d337e3d`、`a933c0e`、
  `a58833e`、`1a2af6e`。Round 2 原定 diff-only，但首个修复覆盖目标产物超过 30%，按协议
  升级为一次 full-scan；当前 125 条浏览器断言全绿，五类联合变异均能使目标断言转红。

| ID | 标题 | 严重度 | 分类 | 根因/症状 | 来源 | 状态 | 修复建议 | 修复方案 | 裁决理由 | 回归测试 | 首次出现轮次 | 修复轮次 | 模式标签 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| UX-BL-R1-001 | 新建任务丢失用户目标并绕过推荐确认主路径 | High | correctness | root-cause | original-coding | fixed | 读取真实目标，恢复 J2 推荐与确认路径，并用唯一目标文本做端到端断言 | 提交逻辑保留 `data-task-goal` 原文；确认前只生成可调整推荐，确认后幂等创建任务并把原文带入任务与会话 | 接纳；实现与建议一致 | `browser-check.mjs::新建任务：目标原文端到端保留，确认前不创建，重复提交不重复创建` | 1 | 2 | journey-contract-not-exercised |
| UX-BL-R1-002 | 首次设置页面存在但没有任何可达入口 | High | correctness | root-cause | spec-drift | fixed | 统一 `start/setup` 路由并跑通 J1.1-J1.6 | 统一为 `setup` 路由，增加可见入口；代码目录、成员、执行检查与首个任务可连续完成，含 loading、失败和重试 | 接纳；实现与建议一致 | `browser-check.mjs::首次设置：入口可达，J1.1-J1.6 连续走通且检查有失败与重试` | 1 | 2 | route-id-contract-drift |
| UX-BL-R1-003 | 异常恢复状态覆盖不完整且设计文档仍描述已取消结构 | High | correctness | root-cause | spec-drift | fixed | 补齐恢复状态与主操作，清理任务 tab 等过期契约 | 新增实现失败、已中断、已取消、已排队代表画面；每态具有唯一主操作、影响预览和恢复保证，并清理已撤销导航契约 | 接纳；实现与建议一致 | `browser-check.mjs::异常与恢复状态：四种都进得去，各有主操作与影响预览` | 1 | 2 | source-of-truth-prototype-drift |
| UX-BL-R1-004 | 弹层、数据表与页签未达到基础键盘和读屏契约 | High | test-coverage | root-cause | process-gap | fixed | 统一 Dialog、Tabs、DataTable，并新增键盘与语义门禁 | Dialog 统一名称、焦点圈、Esc 与焦点归还；DataTable 补列头/单元格关系；Tabs 补选中态、单一 tab stop 与方向键模型 | 接纳；实现覆盖建议及相邻键盘契约 | `browser-check.mjs::弹层、数据表与页签回归组` | 1 | 2 | structural-check-misses-behavior |
| UX-BL-R1-005 | 密钥与全局暂停没有使用一致的高风险操作保护 | High | correctness | root-cause | original-coding | fixed | 遮罩密钥；为全局暂停补影响预览、确认、恢复并裁决归属 | 所有密钥默认遮罩并显式查看；暂停全部派工在运行时给出影响预览和确认，确认后保留持久状态与唯一恢复入口 | 接纳；运行时只管理全局派工闸门，不承担单任务停止 | `browser-check.mjs::凭据与暂停派工回归组` | 1 | 2 | risk-tier-affordance-missing |

**模式性教训**

1. 来源分布为原方案 2、规格漂移 2、流程缺口 1；没有 fix-regression。5 条均在 Round 2
   关闭，最长存活 1 轮。
2. `journey-contract-not-exercised` 与 `structural-check-misses-behavior` 指向同一问题：结构断言
   全绿不能证明用户旅程可走。门禁必须输入唯一文本、执行真实键盘路径并验证确认前后状态。
3. 5 条建议均被实质采用，建议命中率 100%；没有 partial/rejected 裁决。命中率偏高的原因是
   首轮发现均附带了可直接执行的关闭条件，而不是只有风格偏好。
4. 联合变异删除任务目标入口、首次设置路由、异常状态入口、Dialog 语义和密钥遮罩后，五条
   目标回归全部转红；还原后 125/125 全绿，证明新增门禁具备抓回归能力。

---

## 循环 18：v0.3 及后续版本重排规划检视（4轮）

- **report_type**: doc-review
- **周期**: 2026-09-08，4轮（含 1 轮 CI 门禁重开） · **状态**: 已收敛（最终闭环以本总结提交对应的 GitHub Actions 全绿为准）
- **背景**: 以 `main@f2b2f7e`、V3.44、F009–F014 为修复基线，检查领域写 owner、Feature
  依赖、持久化发布、生命周期、迁移真实性、状态覆盖和后续版本边界。Round 1 全量扫描；
  Round 2/3 只审修复 diff 与相邻契约；Round 4 由首个 CI 的断链失败触发。14 条 finding 均有
  独立提交、仓库内回归测试与变异证据。

| ID | 标题 | 严重度 | 分类 | 根因/症状 | 来源 | 状态 | 修复方案 | 回归测试 | 首次出现轮次 | 修复轮次 | 模式标签 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| V03-PLAN-R1-001 | 可信验收闭环缺少 canonical 写入 owner | High | 正确性 | 根因 | 原方案 | fixed | AcceptanceService 成为完成要求、主张链、风险接受与完成摘要的唯一写入口，IssueService 只消费完成事件 | `tools/check-v03-plan-contracts.test.mjs::V03-PLAN-R1-001` | 1 | 2 | journey-contract-without-write-owner |
| V03-PLAN-R1-002 | 最终根对象 Space 没有 schema 与 Feature owner | High | 正确性 | 根因 | 规格漂移 | fixed | F013 拥有 Space schema、默认迁移、Project/Issue 归属和首次设置 | `tools/check-v03-plan-contracts.test.mjs::V03-PLAN-R1-002` | 1 | 2 | root-domain-without-feature-owner |
| V03-PLAN-R1-003 | F010/F012/F013 的真实依赖形成闭环 | High | 正确性 | 根因 | 规格漂移 | fixed | 改为 F009→(F010∥F013)→F012→F011→F014，并分离 Artifact core、requirements 输出和 Dispatch 集成 owner | `tools/check-v03-plan-contracts.test.mjs::V03-PLAN-R1-003` | 1 | 2 | cross-feature-dependency-cycle |
| V03-PLAN-R1-004 | Artifact 文件发布顺序会留下已提交但不可读取的 revision | High | 正确性 | 根因 | 原方案 | fixed | 先 fsync 并原子发布 content-addressed archive，再以 DB commit 作为唯一可见点，补齐 CAS/orphan/restart 语义 | `tools/check-v03-plan-contracts.test.mjs::V03-PLAN-R1-004` | 1 | 2 | cross-resource-publication-order |
| V03-PLAN-R1-005 | adapter probe 未闭合却被写成开发前置事实 | High | 正确性 | 根因 | 流程缺口 | fixed | F012 Phase 0 负责 probe 与持久证据，unsupported/unverified 采用保守 eligibility | `tools/check-v03-plan-contracts.test.mjs::V03-PLAN-R1-005` | 1 | 2 | readiness-prerequisite-unowned |
| V03-PLAN-R1-006 | Dispatch 在撤销窗口前后何时创建存在两套语义 | High | 正确性 | 根因 | 原方案 | fixed | 确认时创建 draft，超时 CAS 到 starting 并原子写 snapshot/consumption/Attempt/Run，commit 后才 spawn | `tools/check-v03-plan-contracts.test.mjs::V03-PLAN-R1-006` | 1 | 2 | lifecycle-transition-creation-ambiguity |
| V03-PLAN-R1-007 | F009 迁移即将退役的管理面会制造确定性二次实现 | Medium | 质量 | 根因 | 原方案 | fixed | 迁移矩阵区分 stable-shell/final-surface/transitional-host，并为临时宿主指定替换 owner、删除条件和期限 | `tools/check-v03-plan-contracts.test.mjs::V03-PLAN-R1-007` | 1 | 2 | transitional-layer-overinvestment |
| V03-PLAN-R1-008 | 旧收藏链接验收建立在不存在的历史路由契约上 | Medium | 质量 | 症状 | 规格漂移 | fixed | 历史 URL inventory 只认已发布根入口，新 canonical deep links 作为新增能力独立验收 | `tools/check-v03-plan-contracts.test.mjs::V03-PLAN-R1-008` | 1 | 2 | migration-contract-without-existing-surface |
| V03-PLAN-R1-009 | 七类状态验收不足以覆盖十一类任务状态 | Medium | 测试覆盖 | 根因 | 规格漂移 | fixed | F011 逐项列出十一种具名 fixture，并为每态定义首屏优先级、主操作、恢复结果和保留事实 | `tools/check-v03-plan-contracts.test.mjs::V03-PLAN-R1-009` | 1 | 2 | acceptance-state-matrix-undercoverage |
| V03-PLAN-R1-010 | v0.4 同时绑定四条独立价值链 | Medium | 质量 | 根因 | 原方案 | fixed | v0.4 改为方向性 umbrella，v0.4.0 只保留最小边界，其余作为独立候选线 | `tools/check-v03-plan-contracts.test.mjs::V03-PLAN-R1-010` | 1 | 2 | release-bundle-multiple-intents |
| V03-PLAN-R2-011 | F010/F013 并行声明仍被前置表与 Dispatch owner 破坏 | High | 正确性 | 根因 | 修复引入 | fixed | F013 只发布 versioned effective requirements，F012 独占 Dispatch snapshot 集成及升级/禁用不变性验收 | `tools/check-v03-plan-contracts.test.mjs::V03-PLAN-R2-011` | 2 | 3 | dependency-table-owner-drift |
| V03-PLAN-R2-012 | F009 场景与范围仍承诺无依据的旧链接和退役管理面 | Medium | 质量 | 根因 | 修复引入 | fixed | 用户场景改为根入口与新 deep link；Workflow Template 编辑 retired，只保留旧数据只读迁移 | `tools/check-v03-plan-contracts.test.mjs::V03-PLAN-R2-012` | 2 | 3 | partial-symmetric-fix |
| V03-PLAN-R3-013 | 检视过程稿未被忽略而可能误入 Git | Medium | 质量 | 根因 | 流程缺口 | fixed | `.gitignore` 精确忽略 `CURRENT-*.md` 与 `FIX-log.md`，长期 reviews 文档继续纳入 Git | `tools/check-v03-plan-contracts.test.mjs::V03-PLAN-R3-013` | 3 | 3 | active-review-artifact-not-ignored |
| V03-PLAN-R4-014 | Artifact Feature 改号后下游评估文档仍引用已删除的 F009 路径 | Medium | 测试覆盖 | 根因 | 规格漂移 | fixed | 将文字与链接改指 F010，并增加当前引用必需、旧路径禁用的契约门禁 | `tools/check-v03-plan-contracts.test.mjs::V03-PLAN-R4-014` | 4 | 4 | cross-document-reference-drift |

**问题与实际修复证据**

- R1-001/002 原问题分别是可信完成链和根归属对象无人拥有；`69313bc`、`91c5311` 把写链与
  Space schema/migration/首次设置落到唯一 Feature owner。
- R1-003/004 原问题分别是跨 Feature 环和 DB/文件双资源半发布；`15a7f6c`、`577e471` 固定
  无环顺序与 archive-before-manifest 发布不变量。
- R1-005/006 原问题分别是未执行 probe 冒充前置事实和撤销窗口双时序；`4af7df3`、`806ee26`
  增加 owned Phase 0 证据并统一 draft→starting→dispatched/cancelled 的事务边界。
- R1-007/008 原问题是临时面过度建设与虚构旧路由；`461d924`、`4035ca6` 限定兼容宿主生命周期，
  只迁移有发布证据的根入口并单列新 deep links。
- R1-009/010 原问题是状态矩阵少四类与 v0.4 多价值链捆绑；`171c349`、`f3d48e3` 补齐十一态并
  将后续路线拆成可独立评估的候选线。
- R2-011/012 是首轮修复的相邻契约未对称同步；`29fd59d`、`323197a` 明确 F012/F013 owner，
  并同步收缩 F009 的场景、范围、需求和回归口径。
- R3-013 是闭环检查发现的流程缺口；`6969b65` 兼容项目“长期文档可追溯”和 skill“过程稿不入库”
  两项要求，`git check-ignore -v` 已分别命中两个临时文件模式。
- R4-014 由 GitHub Actions run `34202024137` 的 `check:doc-links` 首次暴露：本地用户改动恰好遮住
  了已提交版本的旧 F009 链接；`9a54ff5` 只暂存三处引用修复及专属门禁，没有吞入同文件其余改动。

**模式性教训**

1. `origin` 分布：原方案 5、规格漂移 5、修复引入 2、流程缺口 2。首轮修复自伤率 2/10，处于
   协议预期的 20–30%，再次证明第二轮 diff-only 不能省。
2. 最长存活 1 轮：R1 十条在 Round 2 关闭，R2 两条在 Round 3 关闭；R3-013 与 R4-014 当轮
   以红→绿门禁关闭。没有 finding 连续三轮失败，无需触发不收敛升级。
3. `cross-feature-dependency-cycle` 与 `dependency-table-owner-drift` 表明依赖图、依赖表、任务 AC 和
   integration owner 必须作为一个对称契约修改；只改路线图文字会在相邻 Feature 中留下隐性反向边。
4. `partial-symmetric-fix` 表明“退役一个 surface”必须同时搜索用户场景、范围、FR/NFR、tasks 和 AC；
   只修发现所在段落会让同一旧承诺从另一段复活。
5. 文档门禁共 14 条，均对必需短语执行删除变异；涉及禁止旧契约的三条还执行反向注入变异。
   完整本地 `npm run verify`：Server 1680 passed / 30 skipped，Web 216/216，feature gate 144/144，
   docs gate 108/108，其余文档与治理门禁全绿。
6. 首个 CI 的 E2E 已绿，但 Verify 被已提交版本的断链阻塞；这说明脏工作树可能让本地文档门禁
   读取到尚未提交的修正，从而掩盖 HEAD 的真实状态。后续收口应额外对 `git show HEAD:<file>`
   或干净 worktree 跑涉及全仓链接的门禁，不能只看当前工作树全绿。

---

## 循环 19：F009 开发前设计检视（9轮）

- **report_type**: doc-review
- **周期**: 2026-09-08—2026-09-09，9轮（含 1 轮 CI 门禁重开） · **状态**: 已收敛（最终闭环以本总结提交对应的 GitHub Actions 全绿为准）
- **背景**: 以 `main@53c3c55` 为修复基线，对设计重构后的 F009 做开发前最后检视。
  Round 1 全量扫描，Round 6 因累计修订超过 30% 使用一次例外全量复核，其余后续轮次只复核
  修复 diff 与相邻契约。用户自有改动
  `docs/quant-factor-research-tradingview-assessment.md` 全程排除且未暂存。

| ID | 标题 | 严重度 | 分类 | 根因/症状 | 来源 | 状态 | 修复方案 | 回归测试 | 首次出现轮次 | 修复轮次 | 模式标签 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| F009-DOC-R1-001 | 迁移矩阵尚未成为开发前设计输入 | High | 正确性 | 根因 | 流程缺口 | fixed | 冻结 11 个生产页面/入口与 31 个动作/事实的迁移矩阵，逐项记录处置、生命周期、新入口、canonical API、替换 owner、删除条件与期限 | `tools/check-v03-plan-contracts.test.mjs::F009-DOC-R1-001` | 1 | 1 | readiness-prerequisite-unowned |
| F009-DOC-R1-002 | canonical route 的身份和阶段语义未闭合 | High | 正确性 | 根因 | 规格漂移 | fixed | 固定 M1 route manifest；仅发布稳定 Task/Project 身份，Session route 延至 F012，并定义默认、非法值、异步失败和 history 行为 | `tools/check-v03-plan-contracts.test.mjs::F009-DOC-R1-002` | 1 | 1 | route-id-contract-drift |
| F009-DOC-R1-003 | M1 生产 SurfaceRegistry 没有枚举 | High | 正确性 | 根因 | 原方案 | fixed | 枚举九个一级槽位：Task/Project/Runtime/Settings enabled，其余 not-registered；禁止 visible-disabled 伪工作面 | `tools/check-v03-plan-contracts.test.mjs::F009-DOC-R1-003` | 1 | 1 | surface-registry-boundary-underspecified |
| F009-DOC-R1-004 | 既有写动作在 transitional-host 间归属不完整 | High | 正确性 | 根因 | 原方案 | fixed | 对 A001–A030 逐项指定唯一宿主、canonical API、生命周期和下游接管 owner，保留 validation trigger/unblock/reset 等现有动作 | `tools/check-v03-plan-contracts.test.mjs::F009-DOC-R1-004` | 1 | 1 | migration-action-disposition-missing |
| F009-DOC-R1-005 | v0.2 schema fixture 前置条件当前不可执行 | High | 测试覆盖 | 根因 | 流程缺口 | fixed | 新增 Phase 0 T000，钉 source commit `5ef5055`、schema v10、文本 SQL/raw seed 与 v10→v11→head 真实升级链；清除“最新 schema”双解 | `tools/check-v03-plan-contracts.test.mjs::F009-DOC-R1-005` | 1 | 2 | readiness-prerequisite-unowned |
| F009-DOC-R1-006 | 125 条 V3.44 browser checks 缺少适用性分母 | Medium | 测试覆盖 | 根因 | 流程缺口 | fixed | 逐条分类为 adapted 28/deferred 96/not-applicable 1，并以源 SHA256、连续 ID、精确计数及变异锁定分母 | `tools/check-v03-plan-contracts.test.mjs::F009-DOC-R1-006` | 1 | 2 | acceptance-subset-without-denominator |
| F009-DOC-R1-007 | 未提交草稿的保存边界不明确 | Medium | 正确性 | 根因 | 原方案 | fixed | ApplicationShell 持有按 Task 分键的内存 TaskDraftStore；定义切换/刷新、revision 匹配清理、提交失败和对象删除语义 | `tools/check-v03-plan-contracts.test.mjs::F009-DOC-R1-007` | 1 | 1 | transient-state-owner-missing |
| F009-DOC-R2-008 | 根入口与任务列表猜测首个 Project，破坏稳定身份 | High | 正确性 | 根因 | 修复引入 | fixed | `/` 固定跳转 `/projects`；无显式 project 的 `/tasks` 显示选择器，只有用户选择后才 push identity URL | `tools/check-v03-plan-contracts.test.mjs::F009-DOC-R2-008` | 2 | 2 | route-id-contract-drift |
| F009-DOC-R4-009 | browser catalog 删除变异只适配 LF | Medium | 测试覆盖 | 根因 | 修复引入 | fixed | 行删除显式处理 LF/CRLF/文件末行，并在两种换行 fixture 上先断言输入实际变化、再断言 125 行校验转红 | `tools/check-v03-plan-contracts.test.mjs::F009-DOC-R1-006 (LF/CRLF mutation)` | 4 | 5 | mutation-not-platform-equivalent |
| F009-DOC-R6-010 | 迁移矩阵混淆目标处置与当前实施状态 | High | 正确性 | 根因 | 修复引入 | fixed | 拆分冻结的目标处置、当前实施状态和完成证据；42 行按当前事实初始化为 `inventoried / pending` | `tools/check-v03-plan-contracts.test.mjs::F009-DOC-R6-010` | 6 | 7 | marked-done-not-implemented |
| F009-DOC-R6-011 | 版本验收仍使用有歧义的 v0.2 最新 fixture | Medium | 测试覆盖 | 根因 | 规格漂移 | fixed | 固定 source commit `5ef5055`、release schema v10 raw fixture 与 v10→v11→current head 升级链 | `tools/check-v03-plan-contracts.test.mjs::F009-DOC-R6-011` | 6 | 7 | cross-document-reference-drift |
| F009-DOC-R6-012 | 草稿清除后 revision 是否复用未定义 | Medium | 正确性 | 根因 | 修复引入 | fixed | 草稿身份使用不可复用的 key/generation/revision；pending discard 后旧响应只能 no-op | `tools/check-v03-plan-contracts.test.mjs::F009-DOC-R6-012` | 6 | 7 | partial-symmetric-fix |
| F009-DOC-R7-013 | 迁移完成证据门禁仍接受占位证据 | Medium | 测试覆盖 | 根因 | 修复引入 | fixed | evidence 值 trim 并忽略英文大小写后拒绝完整占位值；三种终态均有失败变异并保留完整正例 | `tools/check-v03-plan-contracts.test.mjs::F009-DOC-R7-013` | 7 | 9 | structural-check-misses-semantics |

**问题与实际修复证据**

- R1-001～R1-004 分别由 `1a098f8`、`55f8e2d`、`e605aad`、`f9af144` 关闭，把迁移范围、
  route identity、SurfaceRegistry 和写动作 owner 从原则性文字变成可枚举开发输入。
- R1-005～R1-007 分别由 `6f44d3c`/`bb31627`、`61c1dd0`/`aeb5ec4`、`e3e56cc` 关闭；
  fixture 与 browser catalog 在 Round 2 又补了禁止模糊口径和源漂移的防线。
- R2-008 是 Round 1 路由修复引入的相邻契约问题；`97b6eab` 删除首项目猜测，恢复“身份只来自
  URL 或用户显式选择”的统一规则。
- R4-009 由 GitHub Actions run `34305259879` 的 Windows Verify job 暴露：原删除正则显式匹配
  `\n`，但 `.` 不消费 `\r`，所以 CRLF 下变异根本未发生；`6102e5b` 增加 mutation-applied 断言并
  使用换行无关删除，Round 5 diff-only 复核无新增问题。
- `b2a590b` 在全部 finding 关闭后才把 F009、BACKLOG、v0.3 README 与项目说明同步到
  `ready-for-development`，同时记录不需要效用假设评估的具体豁免理由。
- Round 6 的例外全量复核发现：`f8525f5` 把迁移目标与进度拆开并初始化全部 42 行；
  `b1605f0` 固定 v0.2 release schema v10 fixture；`766211b` 用不可复用 generation 封住草稿
  丢弃后的晚到响应，三条均在 Round 7 由 reviewer 复核关闭。
- R7-013 首次修复 `b8475b8` 只拒绝空值和缺键，Round 8 独立变异仍可用 TODO/TBD 等占位文字
  伪造完成。`6d05e8d` 补齐精确占位集合、大小写/空白归一以及 migrated/deferred/retired 失败
  变异，Round 9 复核关闭；“引用真实且匹配实现”明确保留为状态推进 PR 的人工审查责任。
- 会话归档在当前 WSL 只能读取 13 个本机会话；闭环时保留仓库已有的 174 个跨机历史会话，
  合并新增会话后重建 index、timeline、timeline-summary 与 retrospective，避免全量重导抹去
  其他机器上采集的过程证据。

**模式性教训**

1. `origin` 分布：原方案 3、规格漂移 2、流程缺口 3、修复引入 5。修复引入已成为最大来源：
   Round 2/7/8 的 diff-only 与 Round 4 Windows CI 都实际捕获了上一轮不存在的问题，说明修复后
   的相邻契约复核、失败变异和异构 runner 缺一不可。
2. `readiness-prerequisite-unowned` 再次出现 2 次：开发前依赖如果只写成“应已有”，而没有钉 source、
   owner、产物和验证方法，就不是前置条件，只是愿望。迁移 inventory 与历史 fixture 都应进入 Phase 0。
3. `route-id-contract-drift` 跨轮出现 2 次：仅列 route pattern 不等于定义身份。根入口、集合页、对象页、
   默认参数、非法参数、history 和异步 not-found 必须一次写成 manifest，尤其禁止按列表顺序猜对象。
4. 最长存活 2 轮的是 R7-013：Round 7 发现，Round 8 证明首修只锁住“非空”结构而没有锁住
   “非占位”语义，Round 9 才关闭。R1-005/R1-006 与 R6-010～R6-012 均存活 1 轮，其余当轮关闭。
5. 十三条 finding 均有独立修复提交和仓库内回归；目标测试均记录先红后绿。Round 3、Round 5
   与 Round 9 的 reviewer diff-only 复核未发现新的开放问题，Feature 状态与路线图真相源一致。
6. `mutation-not-platform-equivalent` 是新的门禁模式：变异测试不能只断言“校验器抛错”，还必须先断言
   变异确实改变输入；涉及文本行时至少用 LF 与 CRLF 两种 fixture，否则 Linux 绿不能代表 Windows CI。
7. `structural-check-misses-semantics` 说明解析出合法 `key=value` 只证明结构存在，不能证明值可用；
   自动门禁应机械拒绝团队已定义的占位全集，同时把引用存在性和与实现一致性明确交给状态推进 PR
   复核，避免“门禁能自动证明任意自由文本语义”的虚假承诺。

---

## 循环 20：F009 实现代码检视（6轮）

- **report_type**: fix-verification
- **周期**: 2026-09-10—2026-09-12，6轮（Round 1 全量扫描，Round 2-6 diff-only） · **状态**: 已收敛（Round 6 的 GitHub Actions run 34626457401 两个 job 全绿）
- **背景**: F009 开发与自检完成、状态进入 `review` 后，对 v0.1/v0.2 生产前端迁移成果做实现级检视。
  基线依次为 `f009-v344-frontend-foundation@`（R1）→ `6dee56e`（R4 起）→ `d2ecc74`（R5 复核对象）。
  修复方以 `FIX-log.md` 按轮追加声明，检视方对每条声明做独立变异核对后才翻状态；
  Round 4 的独立变异一次性推翻了 5 条"已修复"声明，Round 5 全部复核通过并触发最终 CI；
  CI 在 Windows 上红，按停止条件第 3 条重开 Round 6（角色合并：检视人带着报告上下文亲自下场修复），
  Round 6 修完 3 条 Windows 可移植性缺陷 + 1 条自伤后 CI 全绿。
  用户既有未提交文件 `docs/quant-factor-research-tradingview-assessment.md` 全程排除。

| ID | 标题 | 严重度 | 分类 | 根因/症状 | 来源 | 状态 | 修复建议 | 修复方案 | 回归测试 | 首次出现轮次 | 修复轮次 | 模式标签 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| F009-CODE-R1-001 | 主区域不可滚动，超出视口的任务详情无法到达 | High | 正确性 | 根因 | 初始实现 | fixed | — | main 成为纵向滚动 owner | `e2e/tests/f009-shell.spec.ts::R1-001` | 1 | 2 | scroll-container-missing |
| F009-CODE-R1-002 | Composer 的 adapter/consult 状态在缓存任务之间串用 | High | 正确性 | 根因 | 初始实现 | fixed | — | 草稿与 adapter/consult 状态按 task key 隔离 | `web/src/f009-execution-host.test.tsx::keeps adapter and consult selection per task key` | 1 | 2 | route-scoped-state-leak |
| F009-CODE-R1-003 | 生产界面没有显式丢弃草稿动作（设计已定义，实现缺失） | High | 正确性 | 根因 | 初始实现 | fixed | — | 增加 pending 状态可用的丢弃动作 | `web/src/f009-execution-host.test.tsx::offers a production discard action` | 1 | 2 | marked-done-not-implemented |
| F009-CODE-R1-004 | 历史工作流页存在路由但无任何入口可发现 | High | 正确性 | 根因 | 初始实现 | fixed | — | 设置目录只列真实可达子页 | `e2e/tests/f009-shell.spec.ts::BC-097` | 1 | 2 | route-exists-but-undiscoverable |
| F009-CODE-R1-005 | 黄金旅程未真正执行冻结的关键写动作，改由单元测试断言入口存在 | High | 测试覆盖 | 根因 | 初始实现 | fixed | — | J1-J9 通过确定性 fixture 真实执行写动作并写后读 | `e2e/tests/f009-golden-journey.spec.ts::J1-J9` | 1 | 3 | test-simulates-itself |
| F009-CODE-R1-006 | adapted 行未锁住全部生产交互实例（连续三轮补散点、每轮仍漏一个触发分支） | High | 测试覆盖 | 根因 | 初始实现 | fixed | 先建可执行的 dialog×触发分支分母，再参数化覆盖完整分母 | `DIALOG_INSTANCES` 可执行清单（每个生产 dialog、每个打开方式各一行）+ 单一参数化测试体，补齐 Adapter Edit 分支 | `e2e/tests/f009-a11y.spec.ts::BC-048/049/050 ×10 实例` | 1 | 5 | acceptance-subset-without-denominator |
| F009-CODE-R1-007 | 错误与空状态恢复合同不完整，多个 query surface 无真实重试 | High | 正确性 | 根因 | 初始实现 | fixed | — | 五个剩余 query surface 均接入真实 retry/refetch | `web/src/f009-pages.test.tsx` 等 F009 recovery 测试 | 1 | 3 | partial-symmetric-fix |
| F009-CODE-R1-008 | 未覆盖真实 server 首启迁移这一集成缝 | Medium | 测试覆盖 | 根因 | 初始实现 | fixed | — | v10 fixture 由真实 server 首启迁移产生 | `e2e/tests/f009-golden-journey.spec.ts::J1 schema head` | 1 | 2 | integration-seam-not-exercised |
| F009-CODE-R1-009 | popstate 监听生命周期错误，最后一个订阅注销后仍残留 | Medium | 正确性 | 根因 | 初始实现 | fixed | — | 首订阅注册、末订阅注销 | `web/src/f009-shell.test.tsx::keeps remaining subscribers updating` | 1 | 2 | shared-listener-lifetime |
| F009-CODE-R1-010 | Graph 弹窗在异步结果返回前就关闭，失败无处显示 | Medium | 正确性 | 根因 | 初始实现 | fixed | — | 失败保留弹窗、仅成功关闭 | `web/src/f009-execution-host.test.tsx::keeps the graph dialog open on failure` | 1 | 2 | async-dialog-closes-before-outcome |
| F009-CODE-R1-011 | T031 完成标记与执行证据不一致，上下游文档互相矛盾 | Medium | 测试覆盖 | 根因 | 流程缺口 | fixed | 作一次真正的规格裁决并同步全部证据，不能只改下游 tasks/matrix | design.md §10 新增 DQ-008 裁决「结构事实必须自动化、只有审美判断留人工」，spec/design/tasks/journey-matrix 四处口径同步；门禁计数重新实跑核对 | `design.md §10 DQ-008` + `tools/check-v03-plan-contracts.test.mjs::F009-CODE-DEFERRED-INVENTORY` | 1 | 5 | marked-done-not-recorded |
| F009-CODE-R1-012 | format 门禁的增量目标漏掉 F009 新增文件 | Medium | 质量 | 根因 | 初始实现 | fixed | — | 扩展 package.json 的增量 format targets | `npm run format:check` | 1 | 2 | gate-coverage-gap |
| F009-CODE-R1-013 | DataTable 把自定义 ReactNode 字符串化后渲染 | Low | 质量 | 根因 | 初始实现 | fixed | — | custom ReactNode 原样渲染 | `web/src/f009-primitives.test.tsx::renders a custom ReactNode as-is` | 1 | 2 | render-contract-stringifies-node |
| F009-CODE-R2-014 | tabs 只切换选中态、不切换可见面板 | Medium | 正确性 | 根因 | 修复引入 | fixed | — | 可见 tabpanel 与 active tab 绑定 | `e2e/tests/f009-a11y.spec.ts::BC-052` | 2 | 3 | control-state-not-bound-to-content |
| F009-CODE-R2-015 | 新增回归测试未等待 React 更新，缺陷存在时仍绿 | Medium | 测试覆盖 | 根因 | 修复引入 | fixed | — | 手工 popstate dispatch 由 act 包裹 | `web/src/f009-execution-host.test.tsx`、`web/src/f009-shell.test.tsx` | 2 | 3 | unawaited-react-update |
| F009-CODE-R3-016 | 测试用 FakeAgentAdapter 可重新进入生产启动路径而测试不红 | High | 测试覆盖 | 根因 | 修复引入 | fixed | 把环境解析与 registry 构造收进一个可导入的 production composition 函数并直接断言默认环境结果 | 抽出 `buildProductionAdapterRegistry(env)` 作为 index.ts 唯一调用点，源码扫描锁定该调用点传入未修改的 `process.env`；`main()` 加 entrypoint 守卫以便测试导入 | `server/tests/unit/register-adapters.test.ts::server/src/index.ts wiring` | 3 | 5 | test-double-in-production-wiring |
| F009-CODE-R3-017 | E2E invocation 生命周期未被回归锁定，且 teardown 实际每次泄漏目录 | High | 正确性 | 根因 | 修复引入 | fixed | 以真实 invocation lifecycle 做并发回归，并断言运行结束后目录消失 | 并发回归改为调用真实 `createInvocationDir()`；定位到 Playwright 会在每个 worker 进程重复求值 config 才是泄漏根因，改为按进程树幂等（worker 继承 orchestrator 目录）并新增真实运行后断言零残留的 lifecycle 校验，接入 CI 与 verify:release | `server/tests/integration/f009-v02-fixture.test.ts::keeps two concurrent fixture builds fully isolated` + `e2e/tests/support/verify-invocation-dir-lifecycle.mjs` | 3 | 5 | shared-fixed-temp-path |
| F009-CODE-R3-018 | CI 与发布门禁的 E2E 集合一致性没有可失败的契约测试 | Medium | 测试覆盖 | 根因 | 修复引入 | fixed | 解析根 scripts 与 workflow，断言两者包含相同 E2E 集合 | 静态契约测试提取 CI e2e job 与 verify:release 的 `test:e2e*` 集合，断言 release ⊆ CI，并做双向变异 | `tools/check-v03-plan-contracts.test.mjs::F009-CODE-R3-018` | 3 | 5 | release-gate-diverges-from-ci |
| F009-CODE-R5-019 | DIALOG_INSTANCES 是手工清单，新增 dialog 不会让任何测试变红 | Medium | 测试覆盖 | 根因 | 初始实现 | open | 仿 R3-016 的源码扫描，加一条测试统计生产 DialogTitle/AppDialog 实例并断言与清单条目一一对应 | — | — | 5 | — | acceptance-subset-without-denominator |
| F009-CODE-R5-020 | 并发 fixture 回归在 worker 失败时泄漏 mkdtemp 目录 | Low | 质量 | 根因 | 修复引入 | fixed | 把 execFileAsync 的 Promise.all 移回 try 内，或在 catch 内按 prefix 兜底清理 | await 移进 try，finally 改为按 prefix 扫描清理（与 R6-025 同一语句，`32831f8`） | `server/tests/integration/f009-v02-fixture.test.ts::keeps two concurrent fixture builds fully isolated` | 5 | 6 | cleanup-outside-try |
| F009-CODE-R5-021 | lifecycle 校验脚本用全局 tmp 快照差分，并发运行会误报泄漏 | Low | 质量 | 根因 | 初始实现 | open | 给该次调用指定专属 TMPDIR 或独占 prefix，只在该范围内快照差分 | — | — | 5 | — | global-snapshot-diff-not-isolated |
| F009-CODE-R5-022 | 检视过程稿被提交进 git，违反 gitignore 纪律 | Medium | 质量 | 根因 | 流程缺口 | fixed | 回写 RETROSPECTIVE 后从版本库移除，保留 .gitignore 规则 | 闭环时由检视人把 issue 表回写本文件并 `git rm --cached` 两份过程稿 | `git check-ignore -v docs/reviews/CURRENT-code.md docs/reviews/FIX-log.md` | 5 | 5 | process-artifact-committed |
| F009-CODE-R5-024 | 新增的 e2e `.mjs` 校验脚本未纳入 format 门禁目标 | Low | 质量 | 根因 | 修复引入 | open | 把 `e2e/tests/support/*.mjs` 加进 package.json 的 format targets | — | — | 5 | — | gate-coverage-gap |
| F009-CODE-R6-025 | 并发回归测试 spawn `node_modules/.bin/tsx`，Windows 上 ENOENT | High | 正确性 | 根因 | 修复引入 | fixed | 改用 `node --import tsx` 这种两个平台一致的 spawn 形式 | `execFileAsync(process.execPath, ["--import", "tsx", ...])`（`32831f8`） | `server/tests/integration/f009-v02-fixture.test.ts::keeps two concurrent fixture builds fully isolated` | 6 | 6 | bin-shim-not-portable |
| F009-CODE-R6-026 | invocation 目录清理放在 globalTeardown，Windows 上必然 EPERM | High | 正确性 | 根因 | 修复引入 | fixed | 把清理移到 webServer 真正关闭之后的生命周期钩子 | Playwright 在 globalTeardown 之后才关 webServer，此时 SQLite 文件仍被占用；改为 owner 进程的 `process.on("exit")` + rmSync maxRetries，删除 globalTeardown 与 invocation-dir-teardown.ts（`91a244c`） | `e2e/tests/support/verify-invocation-dir-lifecycle.mjs` | 6 | 6 | cleanup-in-wrong-lifecycle-hook |
| F009-CODE-R6-027 | lifecycle 校验脚本 spawn `npx` 外壳脚本，Windows 上 ENOENT | High | 正确性 | 根因 | 修复引入 | fixed | 解析 @playwright/test/cli 并用 process.execPath 运行 | `createRequire(import.meta.url).resolve("@playwright/test/cli")`（`7883b98`） | `e2e/tests/support/verify-invocation-dir-lifecycle.mjs` 自身在 CI 的 Windows runner 上通过 | 6 | 6 | bin-shim-not-portable |
| F009-CODE-R6-028 | R6-026 的退出清理让父进程再也 stat 不到 worker 目录，断言必然失败 | Medium | 测试覆盖 | 根因 | 修复引入 | fixed | 把「每个 invocation 拥有完整 fixture」的观察点移进拥有该目录的进程 | worker 自检 hasDatabase/hasWorkspace 并回传，父进程断言这两个布尔 + 两目录不同（`22b4c6c`） | `server/tests/integration/f009-v02-fixture.test.ts::keeps two concurrent fixture builds fully isolated` | 6 | 6 | cleanup-invalidates-observer |
| F009-CODE-R5-023 | createInvocationDir 会沿用外部环境里已存在的同名变量 | Low | 质量 | 根因 | 修复引入 | open | 用 owner pid 的祖先关系或额外的 invocation nonce 判断继承来源，而非只看变量是否存在 | — | — | 5 | — | env-inherited-state-trusted |

**问题与实际修复证据**

- Round 4 的独立变异是这个循环最关键的一轮：五条被声明"已修复"的 finding，逐条把生产代码改坏后
  目标测试**全部仍然绿**——R1-006 的 a11y 用例只点了 Adapter 的 Configure 分支、R3-016 的测试只调用
  helper 而从不触及 `index.ts` 真实调用点、R3-017 的并发用例自己预建两个目录从而绕过
  `createInvocationDir()`、R3-018 根本没有测试、R1-011 只改了下游 tasks/matrix。这一轮证明
  "声明+计数"不能替代独立变异：修复方当轮报告的门禁计数（主 E2E 30/30、server 1695）与检视方
  独立实跑（31/31、1692）也对不上。
- Round 5 逐条复核通过：R3-016 变异后 `register-adapters.test.ts` 2 failed；R3-017 两个变异分别
  复现 `SqliteError: duplicate column name` 与真实残留目录；R1-006 变异后**只有** `adapter — edit branch`
  一条变红；R3-018 两个方向的 workflow 变异都让契约测试变红。R1-011 的四处文档口径与
  `docs/SOP.md` 的被引章节均已核对存在，FIX-log 的门禁计数与独立实跑逐项相等。
- R3-017 的根因在 Round 5 之前一直被当作"teardown 没删干净"的症状处理。真正原因是 Playwright
  会在 orchestrator 之外、每个 forked worker 里**再次求值 config 模块**，无条件的 `mkdtemp()` 因此
  每个 worker 都多造一个永不回收的目录。修复改为按进程树幂等 + 只有 owner 进程建 fixture。
- 检视人另做了一项相邻风险核对：R3-016 为可测试性给 `main()` 加了 entrypoint 守卫，而
  `node dist/index.js` 这条生产入口没有任何测试覆盖。实跑编译产物确认启动正常、`/api/health` 返回 ok。
- 轮末全量门禁（检视人独立实跑）：`npm run verify` PASS；server 129 files / 1699 tests；
  web 31 files / 268 tests；`npm run build` 1771 modules；主 E2E 37/37；empty-db 4/4；
  invocation-lifecycle PASS 且 `/tmp` 零残留。

**模式性教训**

1. `origin` 分布：初始实现 13、修复引入 13、流程缺口 2。修复引入占到三分之一，且其中
   R3-016/R3-017/R3-018 三条都是"上一轮修复本身没有被门禁锁住"——修复引入的问题不都是
   行为回归，更多是**修复没有留下能变红的证据**。
2. `acceptance-subset-without-denominator` 在本循环与循环 19 各出现一次，且本次连续三轮
   反复复发：每轮补上一个被点名的遗漏实例，下一轮独立变异又找出另一个。只有在第 4 轮
   触发不收敛升级协议、改成"先建可执行分母再参数化覆盖"之后才真正关闭。教训是：
   同形态的散点补丁连续失败两次就应该停手改结构，不要等第三次。
3. 最长存活的是 R1-006 与 R1-011（首次出现 1、关闭于 5，存活 4 轮），其次是
   R3-016/R3-017/R3-018（3→5，存活 2 轮）。两条 4 轮存活的都不是难修，而是每轮都在
   修症状：一个补断言、一个改下游文档，都没碰真正的不变量/规格本身。
4. 裁决分布：accepted 18、partial 0、rejected 0；`suggested_fix` 与 `fix_summary` 实质一致的
   有 5/5（Round 4 五条 carried-forward 全部按建议方向修复，且 R3-017 在建议之外自行
   定位到更深的 worker 重复求值根因）。零拒绝在本循环是合理的——Round 4 的五条都附了
   可复现的变异证据，没有留下"觉得没必要"的空间。
5. `process-artifact-committed` 是本循环新增的流程教训：过程稿虽在 `.gitignore` 里，仍可能被
   `git add -f` 以"跨机同步"为由提交进版本库。跨机续作的正确载体是 RETROSPECTIVE 或
   分支上的代码本身，不是把检视协议的过程稿变成版本库文件。

8. **Round 6 是"本地全绿 ≠ 可闭环"的又一次实证**（循环 19 的 R4-009 是第一次）。本地 Linux 上
   `verify` + build + 三套 E2E 全绿，Windows CI 仍然红三处，而且三处全部出自本循环的 R3-017 修复：
   两处 `bin-shim-not-portable`（spawn `.bin/tsx`、spawn `npx`——Windows 上它们只有 `.cmd`/`.ps1`
   外壳，Node 加固后 execFile 无法直接启动），一处 `cleanup-in-wrong-lifecycle-hook`
   （Playwright 在 globalTeardown 之后才关 webServer，POSIX 允许 unlink 已打开文件而 Windows 不允许，
   所以那份清理在 Windows 上从来就不可能成功）。教训：跨平台 CI 是停止条件的一部分而不是形式，
   凡是"spawn 一个 node_modules/.bin 下的东西"或"删除一个可能被子进程占用的文件"的代码，
   本地绿都不构成证据。
9. **修复自伤率再次兑现**：Round 6 的三条修复又引入了 R6-028（退出清理让父进程无法再观察 worker
   目录），当轮的轮末全量门禁抓到。这正是 skill 里"细提交、粗验证"的价值——如果只在最后跑一次
   门禁并直接 push，这条会变成下一轮的 CI 红。
10. **角色合并确实收敛**：Round 6 按 skill 第 7 条的升级选项 (b) 让检视人带着完整报告上下文亲自
   下场修复，从 CI 红到 CI 绿只用了一轮三个提交。对比 Round 3→4 的对抗式分离循环（五条"已修复"
   声明全部被变异推翻），这个差异和 skill 里记录的实测一致。
