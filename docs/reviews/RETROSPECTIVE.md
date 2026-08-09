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
> **来源(origin)/修复轮次(resolved_round)/模式标签(pattern_tag)的记录粒度**:
> 对已经点名成"复现模式"的案例(比如 `marked-done-not-implemented`、
> `partial-symmetric-fix`)给了完整的逐条字段,这些是本文件最高复用价值的部分。
> 对批量列表(如循环3的109条、循环4的90余条)只给"本轮来源构成"的汇总判断,
> 不逐行倒查精确修复轮次——原始文件多数已删除,逐行精确倒查的把握不够,
> 编造看起来精确实则可能错的数据比诚实地只给汇总判断更糟。

---

## 循环 0: 顶层架构评审(v0.1 编码前)

- **周期**: 2026-07-12,单轮 · **状态**: 已归档(`superseded: 2026-08-01`,内容被
  循环3吸收)
- **⚠️ 死链**: 原文件 `superseded_by` 指向仓库根目录一份已不存在的
  `code-review-report.md`,应指向循环3
- **五项主要问题**: escalation 执行模型落不了地、workspace 锁无 stale 恢复、
  `AgentAdapter` 抽象太薄、事件流缺 cursor/replay、Artifact 无落点

---

## 循环 1: F003/F004/F005 规格三件套设计检视

- **周期**: 2026-07-16,同一文件内3轮(初审→回填→复核→回填) · **状态**: 已闭环
- **⚠️ 原文件已丢失**(`design-review-F003-F004-F005.md`,从未进 git):第一轮6项
  全部落地,第二轮新发现3项细化点回填后关闭,原始9项具体标题未能保留
- **已知具体模式**: F004↔F005 跨 feature 契约冲突(nullable role 与 DB NOT NULL、
  validator 上下文该绑定哪个 Run)——本项目"跨文档契约不同步"最早先例

---

## 循环 2: 单次代码检视(commit `51c39df`)

- **周期**: 2026-07-16,单轮 · **范围**: F001/F002 两份新增 UI flow 测试文件
- **状态**: 已闭环,"质量良好可以合入",无阻塞项
- **⚠️ 原文件已丢失**:已知内容是 mock/fixture 重复、未使用 import、
  happy-path-only 覆盖等 P1-P3 建议,均非阻塞

---

## 循环 2b: v0.1→v0.2 过渡入口检视

- **周期**: 2026-08-01,单轮 · **范围**: 全仓库状态快照(不针对具体feature)
- **状态**: 已闭环,以"全部已修复"姿态呈现
- **⚠️ 原文件已丢失**(`code-review-2026-08-01-v02-entry.md`):Findings表格本身
  就是 Resolved 回顾表,具体条目未能保留

---

## 循环 3: v0.2 F006/F007/F008 需求文档检视(6轮,109条发现)

- **周期**: 2026-08-01 → 2026-08-02(密集连续同一天到次日) · **状态**: 已闭环,
  但**从未有一份报告文件自己宣布"全部关闭"**——真正的闭环证据是6轮之后再无
  新检视 commit,直接转入实现阶段(`7799603`)
- **⚠️ 流程缺陷(长期记忆)**: 完全依赖单人连续输出,靠 commit message 数字对账
  ("采纳第N轮检视M条")确认改动对应关系,**没有一次独立验证"改的内容是否真的
  解决了问题"**——与循环4(F006实现)的"自述vs独立复核"显式区分形成对比

### 第1轮(`v02-requirements.md`,10H/10M)— commit `b024220` 采纳关闭

| severity | 标题 | 位置 |
|---|---|---|
| 🟠 | F006 result refs cannot deliver predecessor output as designed | F006/design.md:153 |
| 🟠 | Existing escalation cancels queued graph siblings, contradicting documented recovery model | F006/design.md:191 |
| 🟠 | F006 has no complete cancellation transition or recovery path | F006/spec.md:84 |
| 🟠 | Graph initialization and terminal advancement not atomic/recoverable from partial writes | F006/tasks.md:34 |
| 🟠 | F007 cannot make a graph use the adapter/roster confirmed by the user | F007/design.md:85 |
| 🟠 | F007 incorrectly equates two independently scheduled nodes with two available adapters | F007/design.md:104 |
| 🟠 | Intake confirmation is neither idempotent nor failure-atomic | F007/design.md:85 |
| 🟠 | `setStatus(active)` can create multiple active templates, bypass safe activation transaction | F008/design.md:29 |
| 🟠 | Invalid `steps_json` can be saved and activated without a defined gate | F008/spec.md:84 |
| 🟠 | Required template audit event has no valid Thread or actor model | F008/design.md:85 |
| 🟡 | F006 schema omits referential and active-attempt invariants required by spec | F006/design.md:73 |
| 🟡 | Fixed Edge definition does not yet satisfy ADR 0006's first-class Edge contract | F006/tasks.md:32 |
| 🟡 | NodeRun status timing is underspecified | F006/design.md:191 |
| 🟡 | Graph definition version retention is assumed but not guaranteed | F006/design.md:64 |
| 🟡 | Recommendation freshness not fully specified for adjusted choices | F007/design.md:62 |
| 🟡 | "Complete Issue fields" has no deterministic rule contract | F007/spec.md:30 |
| 🟡 | `stale_lock_suspected` does not match actual stale-lock cleanup semantics | F008/design.md:71 |
| 🟡 | `queue_starved` will flag intentionally ineligible queues as broken | F008/design.md:74 |
| 🟡 | Health API lacks concrete scope, cannot reach one promised metric as designed | F008/tasks.md:35 |
| 🟡 | All three feature designs missing required end-to-end API contracts despite `ready-for-development` | docs/features/README.md:74 |

**本轮来源构成**: 三份设计文档首次成文后的第一次检视,以 `origin: original-coding`
(单文档内部设计gap)为主,约3-4条是F006↔F007跨文档不一致(`origin: spec-drift`)。

### 第2轮(`v02-recheck.md`,13H/16M/1L)— commit `699060d` 采纳关闭

| severity | 标题 | 位置 |
|---|---|---|
| 🟠 | F007 both forbids and requires persistence during recommendation | F007/spec.md:102 |
| 🟠 | `recommendation_id` collides for different goals, not claimed by PK | F007/design.md:20 |
| 🟠 | Confirmed graph execution plan absent from F006, cannot survive until synthesis | F007/design.md:184 |
| 🟠 | Confirmation and execution services have incompatible transaction ownership | F007/tasks.md:34 |
| 🟠 | Mandated `AdapterResolver` cannot enforce node capabilities | F006/tasks.md:39 |
| 🟠 | F008 exposes template fields whose edits have no defined runtime effect | F008/spec.md:33 |
| 🟠 | "one active graph per Issue" index excludes recoverable blocked graphs | F006/design.md:105 |
| 🟠 | Graph blockers do not all have a usable recovery transition | F006/design.md:238 |
| 🟠 | Queued cancellation has no lifecycle seam for documented NodeRun transition | F006/design.md:270 |
| 🟠 | F007 marked ready while required API design is explicitly unfinished | F007/design.md:217 |
| 🟠 | Synthesis NodeRun created both at graph start and again at join | F006/tasks.md:37 |
| 🟠 | Recovery cannot repair a swallowed failure of terminal transaction one | F006/design.md:324 |
| 🟠 | Graph success/failure finalization not defined as atomic transition | F006/design.md:228 |
| 🟡 | F008 does not structurally protect template version/active-version uniqueness | F008/design.md:38 |
| 🟡 | Template mutation and audit insertion not explicitly one transaction | F008/design.md:210 |
| 🟡 | Invalid current template prevents activating its valid repair | F008/design.md:158 |
| 🟡 | `intake_confirmations` lacks lifecycle/referential/retention rules | F007/design.md:20 |
| 🟡 | Recommendation staleness ignores capability changes | F007/design.md:89 |
| 🟡 | Node-result truncation timing and storage bounds ambiguous | F006/design.md:182 |
| 🟡 | Graph-wide cancellation specified but no API/command task | F006/design.md:274 |
| 🟡 | F007 spec still says a topology may require two executors | F007/spec.md:91 |
| 🟡 | `CLAUDE.md` still summarizes the disproved evidence design | CLAUDE.md:19 |
| 🟡 | F006 recovery wording only scans running graphs despite recoverable blocked reasons | F006/design.md:337 |
| 🟡 | Aggregate health loses workspace-specific adapter status | F008/design.md:123 |
| 🟡 | Schema health reports actual version without expected/mismatch diagnosis | F008/design.md:134 |
| 🟡 | Singular graph projection ambiguous when Issue has graph history | F006/design.md:355 |
| 🟡 | F008 blanket immutability conflicts with status activation/deactivation | F008/spec.md:94 |
| 🟡 | F008 relies on permissive parser for a strict activation gate | F008/design.md:154 |
| 🟡 | "Adjust each item" exceeds UI and confirmation contract | F007/spec.md:34 |
| 🟢 | Modified documents retain stale `updated` metadata | F006/design.md:7 |

**本轮来源构成**: 第1轮修复后新一轮复核,`origin: spec-drift` 明显占多数
(F007对F006既有契约的误用、F008与已定transaction边界冲突居多),约6-8条是单
文档内`original-coding`级别的遗留细节。

### 第3轮(`v02-recheck-2.md`,5H/11M)— commit `cd03f4c` 采纳关闭

| severity | 标题 | 位置 |
|---|---|---|
| 🟠 | Self-contained confirmation token has no integrity protection | F007/design.md:23 |
| 🟠 | Graph creation both rejects invalid plan and persists recoverable blocked graph | F006/design.md:315 |
| 🟠 | Capability failure downgrades to a sequential plan that is also incapable | F007/design.md:201 |
| 🟠 | `result_unparsable` leaves NodeRun both completed and failed | F006/design.md:231 |
| 🟠 | F008 tasks simultaneously allow and forbid repairing invalid active template | F008/tasks.md:33 |
| 🟡 | Confirmation state semantics unreachable/undefined inside one transaction | F007/design.md:37 |
| 🟡 | `recommendation_id` and server truth source have three incompatible definitions | F007/design.md:34 |
| 🟡 | Fresh issuance metadata contradicts "identical result" determinism tests | F007/tasks.md:23 |
| 🟡 | Confirm DTO does not couple topology to roster shape | F007/design.md:278 |
| 🟡 | Graph completion writes an undeclared sixth event type | F006/design.md:398 |
| 🟡 | Definition-unavailable recovery ordered after operations requiring the definition | F006/design.md:405 |
| 🟡 | Graph projection and executor-recovery responses remain incomplete | F006/design.md:492 |
| 🟡 | Join concurrency test asserts pre-created entity, not duplicated side effect | F006/tasks.md:61 |
| 🟡 | New template versions have no specified source to inherit from | F008/design.md:266 |
| 🟡 | Several corrected F006 contracts still retain old wording | F006/design.md:289 |
| 🟡 | `CLAUDE.md` still presents rejected evidence path as active F006 summary | CLAUDE.md:19 |

**本轮来源构成**: `CLAUDE.md`/schema摘要类条目明确是 `origin: spec-drift`
(文档没跟上已经改变的决策),其余多数是上一轮修复动作本身引入或暴露的新细节,
接近 `origin: fix-regression`(上一轮改了A,连带暴露了B此前被掩盖的问题)。

### 第4轮(`v02-recheck-3.md`,中文报告,6H/7M,用了H-01~M-07编号)— commit `502255a` 采纳关闭

| ID | severity | 标题 |
|---|---|---|
| H-01 | 🟠 | F007确认表只允许写"最终事实",但确认流程仍要求先写不完整的认领行 |
| H-02 | 🟠 | F006没有定义图节点的`Run.instructions`,节点职责和输出契约无法送入执行器 |
| H-03 | 🟠 | 已确认的adapter只在建图时校验,延迟创建Attempt时没有资格复核和blocker产生点 |
| H-04 | 🟠 | 新增的`assigned_adapter_config_id`外键没有接入现有adapter删除保护 |
| H-05 | 🟠 | F008把版本继承来源与当前active版本混称为source,可能绕过关闭验证的确认门 |
| H-06 | 🟠 | F006 blocker恢复矩阵仍保留被最终决策否定的状态转换 |
| M-01 | 🟡 | F007的HMAC密钥生命周期仍是二选一描述,没有可实现的配置契约 |
| M-02 | 🟡 | 整图取消没有定义数据库状态变更与外部进程取消的先后顺序 |
| M-03 | 🟡 | F006对graph事件类型数量仍同时写5类和6类 |
| M-04 | 🟡 | `resolve-executors`的幂等响应与blocker错误矩阵在running状态下冲突 |
| M-05 | 🟡 | F007的响应DTO漏掉已经定义的阻塞错误码 |
| M-06 | 🟡 | F007概览仍声称确认复用`RunDispatchService.dispatch()`,与已定的分流契约相反 |
| M-07 | 🟡 | `BACKLOG.md`仍把F007依赖写成旧的`start(issueId, plan)`签名 |

**本轮来源构成**: M-06/M-07 是典型 `origin: spec-drift`(接口签名已改,文档
未同步);H-01~H-04 多是本文档内部未想清楚的准入/校验时序问题,`origin:
original-coding`。

### 第5轮(`v02-recheck-4.md`,6H/10M)— commit `e91f980` 采纳关闭

| severity | 标题 |
|---|---|
| 🟠 | F007可针对非默认workspace推荐,但确认创建的Issue永远落到默认workspace |
| 🟠 | `resolve-executors`只改执行者和图状态,没有创建此前被刻意省略的Attempt |
| 🟠 | 新资格复核仍覆盖不到已经queued、尚未启动的前驱Attempt |
| 🟠 | 整图取消的DB-first协议与现有`cancelRun()` CAS/锁释放路径不兼容 |
| 🟠 | F007外层事务只禁止提前drain,没有禁止事务内broadcast phantom ThreadEvent |
| 🟠 | 图推进"事务二"仍要求创建下游NodeRun,与全部预建模型正面冲突 |
| 🟡 | 已确认token超期后重放究竟返回200还是409未定义 |
| 🟡 | F007仍残留已删除的status模型和旧密钥来源 |
| 🟡 | synthesis首次入队没有对应的`graph.node_queued`写入任务 |
| 🟡 | `graph.completed`是否覆盖cancelled/blocked没有统一,payload又要求成功态专属字段 |
| 🟡 | `graph.node_result`的256KB上限可被未受限的`not_reviewed`绕过 |
| 🟡 | 目标文件glob缺少稳定排序、去重、路径安全与事务外预计算规则 |
| 🟡 | `resolve-executors`所称"供审计"的reassigned只存在于HTTP响应 |
| 🟡 | `CLAUDE.md`与schema摘要仍称F007只新增一张表 |
| 🟡 | `stale_lock_suspected`的超时与宽限没有具体数值或配置来源 |
| 🟡 | Health UI任务仍写"三条派生判断",与DTO的九类diagnostics不一致 |

**本轮来源构成**: "`CLAUDE.md`/schema摘要仍称..."、"F007仍残留已删除的status
模型"两条是清楚的 `origin: spec-drift`;"图推进事务二仍要求创建下游NodeRun
与全部预建模型正面冲突"这类是上一轮"预建模型"决策落地后新暴露的连带问题,
`origin: fix-regression`。

### 第6轮(`v02-recheck-5.md`,7H/7M)— commit `03ac1fb` 采纳关闭,此后转入实现

| severity | 标题 |
|---|---|
| 🟠 | `cancelling`未贯穿迁移任务与重启恢复,重启后图可永久卡住 |
| 🟠 | "kill无返回"会绕过既有执行超时,当前验收无法由"不修改既有cancel路径"实现 |
| 🟠 | `graph.terminal`把可恢复的`blocked`声明成终态,事件语义与状态机相互矛盾 |
| 🟠 | 事务外预检未进入`createGraph`契约,F007也没有可执行的调用顺序 |
| 🟠 | 冻结的`TargetFileSet`没有结构化真相源,延迟synthesis与重启恢复无法确定性重建指令 |
| 🟠 | `resolve-executors`不知道究竟哪些节点被资格失败阻塞,且可能越过join提前创建下游Attempt |
| 🟠 | `cancelling`的API契约与并发守卫缺失,取消期间可能被retry/resolve反向恢复 |
| 🟡 | `result_too_large`已称为第8个blocker,却未加入枚举清单与恢复矩阵 |
| 🟡 | queued claim新增的`adapter_no_longer_eligible`没有进入共享`FailureReason`实施任务 |
| 🟡 | F007的提交后收尾只写drain,漏掉F006强制的pending event broadcast |
| 🟡 | F006 spec的Q3仍保留旧的6类事件和`completed`名称 |
| 🟡 | F008用默认超时诊断stale lock,与实际per-adapter timeout不同源 |
| 🟡 | 前端状态清单漏掉`cancelling`,无法呈现设计要求的卡住/健康诊断 |
| 🟡 | 取消恢复与无运行Attempt的直接取消缺少明确的原子性验收 |

**本轮来源构成**: 最后一轮,遗留的多是跨多次修复反复触碰同一处("`cancelling`
未贯穿迁移任务与重启恢复"这类)的结构性缺口,`origin: original-coding`(设计
从未覆盖过这个组合态)为主,`stale_lock_suspected`超时来源、Q3事件类型两条是
`spec-drift`。

---

## 循环 4: F006 实现代码检视(9轮)

- **周期**: 2026-08-02 → 2026-08-07(5天) · **状态**: 已闭环,`7799603` 是确认点
- **三条最有价值的可复用教训**,结构化记录如下(详见各轮明细叙事):

| ID | 严重度 | 来源 | 状态 | 首次出现 | 修复轮次 | 模式标签 |
|---|---|---|---|---|---|---|
| glob-zero-depth-not-matched | Medium | original-coding | fixed | 2 | 6 | partial-symmetric-fix |
| graph-blocked-event-half-broadcast | Medium | original-coding | fixed | 1 | ~5-6(见叙事) | partial-symmetric-fix |
| dropped-count-truncation-uncounted | High | original-coding | fixed(第七轮前) | 见F006全文 | 见F006全文 | partial-symmetric-fix |
| cancelling-finalizer-missing-transaction | Critical | fix-regression | fixed | 5(第5轮新引入) | 6 | partial-symmetric-fix |
| block-cancelled-precursor-test-vacuous | High | process-gap | fixed | 8 | 9 | test-simulates-itself |
| graph-recovery-retry-cancel-tests-vacuous | High | process-gap | fixed | 8 | 9 | test-simulates-itself |
| tasks-md-web-ui-checked-not-implemented | Medium | process-gap | fixed | 8 | 9 | marked-done-not-implemented |
| tasks-md-spec-md-contradict-each-other | Medium | process-gap | fixed | 4 且 8(复现2次) | 4且9 | marked-done-not-implemented |

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

| severity | 状态 | 标题 |
|---|---|---|
| 🟠 | ✅ FIXED | 约束错误mapper未接入任何生产调用链,T016的409仍不可达 |
| 🟡 | ✅ FIXED | duplicate NodeRun被错误映射成"节点不可重试" |
| 🟡 | ✅ FIXED | `target_files_dropped_count`接受小数,持久化的"数量"不一定是整数 |
| 🟡 | ⏸️ DEFERRED Phase2 | `RunCreateInput`仍未用判别联合表达GraphNode/`node_run_id`关联 |
| 🟡 | ✅ FIXED | 迁移测试仍未注入"DDL后、版本写入前"的失败 |
| 🟡 | ⏸️ DEFERRED Phase2 | Adapter删除修复只有repository查询测试,没有service/API回归 |

### 第1轮(`F006-implementation.md`,5C/6H/3M/1L)

首轮实现检视,全部15条 `origin` 均为 `original-coding`(F006第一次实现就带的
缺口,不是修复引入的)。`resolved_round`:同轮修复的直接标轮次;跨轮才修的,
因中间轮次措辞在改写、无法逐条精确倒查,标"见叙事"——第2-4轮以标题类似的
表述持续追踪同一批问题,最终在第7轮(补完第六轮复核指出的全部剩余缺口)一次性
清零,可信下界是"不晚于第7轮"。

| severity | 状态 | resolved_round | 标题 |
|---|---|---|---|
| 🔴 | ✅ FIXED | 1 | F006服务未进入生产composition root,系统没有可执行的建图/恢复入口 |
| 🔴 | ✅ FIXED | 1 | 前驱NodeRun以`pending`创建,queued Run启动时无法把它推进到`running` |
| 🔴 | ✅ FIXED | 1 | GraphNode完成钩子直接返回,所有图节点在Run终态后停止推进 |
| 🔴 | ✅ FIXED | 1 | 结果处理仍是skeleton:不读/解析payload、不写结果事件,join永远不执行 |
| 🔴 | ✅ FIXED | 1 | synthesis Attempt没有任何前驱payload,边traversal也明确记录空引用 |
| 🟠 | ✅ FIXED | 1 | 建图便利入口提交后不drain,queued Attempt不会主动开始 |
| 🟠 | 见叙事 | ≤7 | fan-in的CAS、资格复核、Attempt与事件写入不在事务中,任一步失败留下吸收态 |
| 🟠 | 见叙事 | ≤7 | 图失败、成功、取消与重启均无生命周期实现,非终态图会永久占用唯一索引 |
| 🟠 | ✅ FIXED | 1 | queued claim未复核GraphNode adapter资格,escalation仍会取消所有兄弟图节点 |
| 🟠 | ✅ FIXED | 1 | target glob实现没有匹配扩展名,symlink越界检查也可被同前缀兄弟目录绕过 |
| 🟠 | 见叙事 | ≤7 | `createGraph()`信任调用方提供的scope/preflight,未复核实体关系/workspace path/hash |
| 🟡 | 见叙事 | ≤7 | 结果envelope的上限统计不完整,部分可变字段仍无界 |
| 🟡 | 见叙事 | ≤7 | Graph projection返回伪history、空edges与占位文案,Web端没有任何图展示 |
| 🟡 | 见叙事 | ≤7 | 所谓端到端fan-in测试绕过production path,核心函数完全无测试 |
| 🟢 | 见叙事 | ≤7 | 已注入的instruction builder未使用,另有模块级重复实例 |

### 第2轮(`F006-final-recheck.md`,4C/6H/4M/2L)

| severity | 标题 |
|---|---|
| 🔴 | GraphRuntime仍无生产调用入口,注入到GET-only route后从未使用 |
| 🔴 | NodeRun先置completed、再写result event,hook异常被吞后留下不可恢复永久态 |
| 🔴 | fan-in对缺失前驱结果使用`continue`,会带半份甚至零份输入启动synthesis |
| 🔴 | Graph成功、失败、取消与重启仍没有终态化/恢复实现 |
| 🟠 | queued GraphNode未复核adapter/GraphRun资格,且NodeRun CAS失败也照样启动provider |
| 🟠 | queued Run取消仍不推进NodeRun/GraphRun,系统取消路径可制造孤儿ready节点 |
| 🟠 | fan-in绕过trusted payload resolver,edge refs写进payload而非`evidence_refs` |
| 🟠 | graph result/node lifecycle events没有完整broadcast/持久化 |
| 🟠 | createGraph scope/snapshot复核仍不完整,Issue状态CAS失败也会提交图 |
| 🟠 | F006测试仍手工驱动状态,1442个绿色测试没有一条走production graph path |
| 🟡 | Result parser的数量/字段边界仍不准确 |
| 🟡 | Graph API仍返回伪history、空edges和占位文案,Web没有F006展示 |
| 🟡 | `**/*.ts`的自制glob正则漏掉workspace根目录文件(即"0层目录"问题,第一次被记录) |
| 🟡 | constraint mapper的catch丢弃AppError,重新抛出原始GraphConstraintError |
| 🟢 | 存在两套completion实现与不安全的repository类型伪装 |
| 🟢 | 质量门禁仍有formatting failure |

**本轮来源构成**: 延续第1轮开放项的持续追踪,`origin: original-coding`。
"0层目录"glob问题首次被明确记录于此轮(`pattern_tag: partial-symmetric-fix`
系列的第一次现身)。

### 第3轮(`F006-final-recheck-2.md`,4C/6H/4M/2L)

| severity | 标题 |
|---|---|
| 🔴 | GraphRuntime仍没有任何生产启动入口 |
| 🔴 | queued GraphNode先把Run置running,NodeRun CAS失败后留下永久悬空Run |
| 🔴 | Graph成功、失败、取消与重启仍没有闭环 |
| 🔴 | completion hook不区分Attempt终态,且CAS失败仍提交孤儿result event |
| 🟠 | queued cancel只推进到NodeRun cancelled,GraphRun仍永久running |
| 🟠 | fan-in仍绕过可信payload resolver |
| 🟠 | fan-in在资格/结果校验前把synthesis置ready,失败后留下无Attempt的ready节点 |
| 🟠 | graph blocked/terminal生命周期事件仍不完整 |
| 🟠 | createGraph的thread/workspace scope仍未闭合 |
| 🟠 | 现有57条F006测试没有覆盖production graph path |
| 🟡 | Result parser仍未完全落实字段约束 |
| 🟡 | Graph projection仍是占位实现,Web没有F006展示或恢复入口 |
| 🟡 | projection对每个节点重复查询整个Issue的Runs |
| 🟡 | 建图调度用节点名称硬编码precursor,而不是使用定义拓扑 |
| 🟢 | workflow临时伪装ProjectRepository,且注入的builder/runtime service未实际使用 |
| 🟢 | 根format check未覆盖F006新文件 |

**本轮来源构成**: 仍是第1轮开放项的持续追踪,`origin: original-coding`。

### 第4轮(`F006-final-recheck-3.md`,2C/6H/4M/2L)

全部14条 `origin` 仍为 `original-coding`(第1轮遗留的持续追踪,4轮里表述
逐步变化但本质是同一批未解决问题)。第4轮起`tasks.md`已被发现全勾但代码只有
骨架(`marked-done-not-implemented`,见上方复用教训表),这是本轮叙事记录、
未在本表格单独列出的一条独立发现。

| severity | 状态 | 标题 |
|---|---|---|
| 🔴 | ✅ FIXED | Graph成功、失败、取消与重启仍没有完整生命周期 |
| 🔴 | open | Run与NodeRun启动仍非原子,当前会留下孤儿running NodeRun |
| 🟠 | open | queued/late terminal GraphNode没有GraphRun状态守卫 |
| 🟠 | open | queued GraphNode启动前没有重新校验assigned adapter |
| 🟠 | open | malformed result会形成GraphRun blocked、Issue Running的持久化矛盾 |
| 🟠 | open | queued cancel仍无法推进GraphRun |
| 🟠 | open | failure/block writes非原子且事件未广播 |
| 🟠 | open | fan-in仍绕过EvidenceService的可信payload/scope校验 |
| 🟡 | open | 新增graph start POST使用无效的TypeScript cast代替zod |
| 🟡 | open | GraphRuntimeService仍信任调用方分别提供thread/workspace/path |
| 🟡 | open | projection与Web仍未满足可追踪/可恢复验收 |
| 🟡 | open | 57条F006测试仍未覆盖新增production path |
| 🟢 | open | result parser和definition-driven调度仍有契约偏差 |
| 🟢 | open | composition仍含unsafe repository cast,format gate再次失败 |

### 第5轮修复(2026-08-03,`preflight.ts`等)— 6项全部修复,resolved_round=5,origin均为original-coding(第4轮遗留)

| severity | 标题 |
|---|---|
| 🔴 | `retry` Issue CAS用错期望值(`gr.status`大小写不匹配) |
| 🟠 | `cancel`实时路径无法收敛(新增`tryFinalizeCancellingGraph`共享函数) |
| 🟡 | `blocked_node_keys`过滤不完整 |
| 🟡 | `cancel`纯空终端流程缺失 |
| 🟡 | `handleCancellingGraph`缺`graph.terminal` |
| 🟡 | projection `blocked_node_keys`未暴露 |

**第5轮独立复核**新发现1项(自述未提及): 🟡 `tryFinalizeCancellingGraph()`本身
没有事务包裹(GraphRun CAS、Issue CAS、事件write、broadcast四步未包在
`db.transaction()`里)。同时纠正自述里一处不准确表述:"edges已从定义派生"被
错误标记为本轮已修复,实际从第一轮起就没变过。

### 第6轮修复(2026-08-03同天)— 2项代码bug清零

| severity | 标题 |
|---|---|
| 🔴 | `tryFinalizeCancellingGraph()`缺事务包裹(补第5轮遗漏) |
| 🟡 | `preflight.ts` 0层目录文件不匹配`**` glob(两步正则替换法,四阶段生命周期终于走完) |

**第6轮独立复核结论**:代码层面"挑不出新的具体代码错误",但对"缺陷清零"整体
定性有保留意见——`resolve-executors`端点缺失和`GraphRecoveryService`的join
重评估被重新归类为"Phase 7功能开发"从而排除在缺陷统计外,这个分类被指出
"值得商榷"(它们是design.md定稿范围内的正式AC对应功能,不是新范围)。

### 第7轮(2026-08-04,补完第六轮复核指出的全部剩余缺口)— 5项逐一实现

| 状态 | 标题 |
|---|---|
| ✅ | `projectRepo` null依赖伪造已去掉,正常注入 |
| ✅ | `edges`字段填充真实运行时状态(查`graph.edge_traversed`事件回填) |
| ✅ | `resolve-executors`端点已实现(按design.md第9节优先级判断顺序) |
| ✅ | `GraphRecoveryService.reconcile()`的join重评估(design §7 第0/3/4/5/6/7步)全部实现 |
| ✅ | 单节点取消死锁路径已修复(`blockGraphOnCancelledPrecursor`) |

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

- **周期**: 2026-08-08,同一文件内3轮 · **状态**: 已闭环,`3bc8d17`(R001-R005)+
  `cc57c72`(R006-R008)

| ID | severity | 标题 |
|---|---|---|
| F007-R001 | 🟠 High | `sequential`确认路径与F006实际接口不兼容 |
| F007-R002 | 🟠 High | 推荐响应缺少PRD要求的Issue Type推荐 |
| F007-R003 | 🟠 High | 通用`Recommendation<Record<string,string>>`无法清晰表达逐节点roster候选与排除原因 |
| F007-R004 | 🟡 Medium | `tasks.md`和部分design文本仍引用已废弃接口与身份语义 |
| F007-R005 | 🟡 Medium | 项目级真相源仍保留F006开发前及ADR初稿结论 |
| F007-R006 | 🟡 Medium | `createSequentialRun()`的instructions来源存在三处不一致 |
| F007-R007 | 🟡 Medium | sequential Run的provenance与`RunQueued`事件字段未完整定义 |
| F007-R008 | 🟢 Low | 两处旧术语及检视状态尚未收尾 |

---

## 循环 6: F007 实现代码检视(7轮)

- **周期**: 2026-08-08 → 2026-08-09 · **状态**: 已闭环(第7轮修复后)
- **⚠️ 收尾时发现的流程信号**: `BACKLOG.md`在第7轮问题仍开放时就已把F007标记
  为`done`,整个实现+检视周期直到闭环那一刻都还没有任何一次提交
- **可复用教训**: 第7轮问题是"只修对称结构的一半"模式(普通replay加了drain,
  唯一键冲突走的另一条replay分支没加)在F007的复现——与循环4(F006)的
  glob/事件广播/事务包裹三个案例同源,本项目至少4次独立复现同一根因类别

### 第1轮(`code-review-report.md`,2H/9M/2L)— ⚠️ 原文件已丢失,具体标题未保留,
经Resolution Addendum + Recheck Addendum两次回填关闭

### 第2-6轮 — ⚠️ 原文件已丢失,仅保留计数(均已在对应轮次关闭)

| 轮次 | 严重度分布 | 已知关键内容 |
|---|---|---|
| 2 | 0H/4M | — |
| 3 | 0H/3M/1L | — |
| 4 | 0H/4M | — |
| 5 | 0H/4M | UI topology切换初始化effect覆盖用户选择——全量测试里真实复现失败,非理论问题 |
| 6 | 0H/3M | 普通replay恢复、UI旧请求失效、逐尝试事件缓冲、证据文案均已实质修复 |

### 第7轮(2026-08-09,`code-review-report-recheck-6.md`)— 已闭环

| ID | severity | 来源 | 状态 | 首次出现 | 修复轮次 | 模式标签 |
|---|---|---|---|---|---|---|
| nonce-conflict-replay-skips-drain | 🟡 Medium | fix-regression | ✅ fixed | 7 | 7 | partial-symmetric-fix |

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
