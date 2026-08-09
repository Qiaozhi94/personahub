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

## 循环 9: v0.3 F009-F012 规划文档检视(2轮)

- **report_type**: doc-review
- **周期**: 2026-08-09,2轮 · **状态**: 已闭环(修复已落工作区,尚未提交)
- **背景**: F009-F012(v0.3:Artifact Foundation、Artifact-Centered Coding Slice、
  Work Room、Reusable Agent Squads)四个 Feature 的 draft spec/design/tasks 首次
  整体评审,与 F008 的循环 7/8 是两条独立审查线(用 `docs/reviews/
  CURRENT-doc-v0.3.md` 与 `CURRENT-doc.md` 区分,互不阻塞)。第1轮全量通读四份
  Feature 的三件套 + README,第2轮只复核第1轮8条发现对应的文档 diff。

| ID | 标题 | 严重度 | 分类 | 根因/症状 | 来源 | 状态 | 修复方案 | 回归测试 | 首次出现轮次 | 修复轮次 | 模式标签 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| F010-R001 | `artifact_run_links`生产端唯一索引建在`(run_id,direction,purpose,producer_slot)`,但spec.md NFR-003把幂等键定义为`(source_run_id,artifact_type,producer_slot)`;`purpose`是consumed链路的自由描述文本,从未声明等于`artifact_type`,同一producer_slot的两次finalize换个purpose字符串即可绕过唯一约束,直接打穿AC-005"retry/restart不重复revision" | 🟠 | correctness | root-cause | original-coding | fixed | 唯一索引改为只用`(run_id,producer_slot)`;新增`CHECK((direction='produced' AND producer_slot IS NOT NULL) OR direction='consumed')`同时堵上"produced行producer_slot为NULL时NULL互不相等、唯一索引形同虚设"这个连带漏洞;spec/design两处幂等键描述统一改为同一字段组 | `tasks.md::T001,T010` | 1 | 2 | idempotency-key-field-mismatch |
| F011-R001 | spec.md US3写"暂停只阻止尚未启动的派工",字面不限定graph节点;但design.md唯一给出的机制(`queuedRunEligibility()`加Room gate)只作用于图的排队Attempt认领,F010引入的implementation/validation Run走既有F004/ManualRoutingService路径不经过这个gate,图跑完后Room实际已拦不住后续派工,与spec字面承诺不符 | 🟡 | correctness | root-cause | spec-drift | fixed | 收窄spec而非扩大机制:非目标段、US3、FR-004、AC-002统一明确"v0.3的Room是当前orchestrator_subagent Graph(research/synthesis阶段)的控制面,不拦截图完成后在primary Thread创建的普通implementation/validation Run" | — | 1 | 2 | scope-promise-mechanism-gap |
| F011-R002 | design.md/tasks.md假设代码库里已存在共享的`queuedRunEligibility()`可直接挂Room gate,但该函数当前并不存在(逻辑内联在`run-dispatch.ts`派工循环的`continue`分支里);F008 design.md同样只泛泛提到"复用一个共享的、无副作用的资格判定器",两份文档都没给出确切签名或提取任务 | 🟡 | correctness | root-cause | spec-drift | fixed | 明确共享classifier的提取由F008 `tasks.md::T041b`拥有(从`startNextQueuedRun()`抽取);F011 `tasks.md::T011`改为显式依赖并复用该导出,不得自行复制判断,同时在依赖关系里声明"若F008尚未落地,F011不得自行复制判定" | `F008 tasks.md::T041b`、`F011 tasks.md::T011` | 1 | 2 | cross-feature-contract-drift |
| F010-R002 | `graph.node_result`是单一ThreadEventType且已在`TRUSTED_INTERNAL_ALLOWLIST`里,design.md称新graph definition发"v2 payload"、旧definition继续发完整payload,但没写明下游怎样在解析前区分两种形状 | 🟡 | correctness | root-cause | original-coding | fixed | 固定discriminator字段`payload_schema:"graph.node_result.v2"`,`ArtifactContextAssembler`先校验discriminator再用NodeRun→GraphRun冻结的definition id/version交叉验证;缺discriminator的事件只允许属于F006 legacy definition/version,未知/错配组合统一`artifact_invalid`,`resolveTrustedPayload()`本身不承担版本判别职责 | — | 1 | 2 | event-payload-version-ambiguity |
| F010-R003 | F004既有验证循环允许多轮重试,但spec/design都没说清一次多轮验证对应几个`verification_results` artifact——每轮各一个,还是只有最终结果落地 | 🟡 | correctness | symptom-patch | original-coding | fixed | 明确每个成功解析出规范result的validator Run(含非最终轮、round-limit blocked)都创建独立的`verification_results`实体revision 1,轮次由可信`runs.validation_round`投影;非pass artifact进入下一轮consumed links,最终Evidence Summary引用最终轮并列出此前各轮refs | `tasks.md::T023` | 1 | 2 | cardinality-underspecified |
| F0912-R001 | F009 design.md明确点出schema版本号依赖F008落地顺序("F008若先落地则F009用v11"),但F010/F011/F012的design.md都只写"下一个migration",没有重述这条级联,打破项目一贯"design阶段写明目标版本供评审"的约定 | 🟢 | quality | symptom-patch | process-gap | fixed | 四份design.md统一改为按既定实施顺序钉死具体版本号(F008=v10、F009=v11、F010=v12、F011=v13、F012=v14),并各自声明"若落地前实施顺序改变,整体重新编号,已应用版本永不修改或追加" | — | 1 | 2 | schema-version-not-stated |
| F011-R003 | `threads.room_id`自schema v1建表起就存在且恒为NULL(为未来Room功能预留的正向指针),F011引入反向指针`work_rooms.thread_id`后,design.md没说清创建Room Thread时要不要顺手填上这个沉睡多年的列 | 🟢 | quality | symptom-patch | original-coding | fixed | 明确`work_rooms.thread_id`是canonical relation、`threads.room_id`是必填反向导航字段(不再保持NULL);创建Room Thread时同事务写入两侧,新增`idx_threads_one_room_thread`唯一索引,Repository/Projection每次读取断言双向一致,不一致返回`ROOM_THREAD_LINK_INVALID` | `tasks.md::T002,T003` | 1 | 2 | dead-column-disposition-unclear |
| F009-R001 | design.md只写"并发revise由CAS保证...冲突重试一次",三方及以上并发revise时重试后仍冲突的行为未定义 | 🟢 | correctness | symptom-patch | original-coding | fixed | 明确第二次CAS冲突终止请求、返回409`ARTIFACT_REVISION_CONFLICT`+`latest_revision`,服务端不得无界重试;spec.md IR-001错误码列表同步补上该code | — | 1 | 2 | retry-bound-unspecified |
| F011-R004 | 修复F011-R002时把"F011依赖F008 T041b"这个新的硬依赖边写进了F011自己的design.md/tasks.md,但没有同步传播到README.md的Feature依赖表(F011行仍只列F006、F007、F009、F010)和F011三件套frontmatter的`related_features` | 🟡 | quality | symptom-patch | fix-regression | fixed | README.md依赖表F011行补上F008;F011 spec/design/tasks三份frontmatter的`related_features`同步加入F008 | — | 2 | 2 | fix-propagation-gap |

**来源标注说明**: F011-R004是本轮修复F011-R002时自身遗漏的传播,标`fix-regression`;
其余7条首次出现于第1轮全量通读,标`original-coding`/`spec-drift`/`process-gap`。

**可复用教训**: F010-R001与循环7的F008-R002同属一个更大的模式——**唯一性/幂等
保证被拆成两个字段名不同但语义被默认相同的表述**(schema列名`purpose` vs 契约
文字`artifact_type`),文档双方都没写"这两个是不是同一个东西",只有对照实际
SQL约束逐字段核对才发现。F011-R002再次印证循环7/8已识别的"假设某个共享机制
已存在"模式,这次额外确认了修复本身的传播盲区(F011-R004)——与循环8的教训完全
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
- **背景**: 聚焦复核 `structure-improvement-plan.md` 2.1,对照旧TEMPLATE与F006-F012
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
