---
feature_ids: [F004]
related_features: [F001, F002, F003, F005]
topics: [autonomous-validation, workflow, evidence-summary, state-machine, tests, v0.1.3]
doc_kind: tasks
created: 2026-07-16
updated: 2026-07-18
---

# F004：Autonomous Validation - 任务

> Status: ready-for-development | Owner: TBD | Spec: `spec.md` | Design: `design.md`

## 规则

- F003必须先实现并通过其Checkpoint 7（terminal finalization/lock/queue/recovery）；不得把F004接到F002当前“terminal即解锁”的旧出口。
- 严格按Phase推进，每项先补测试再实现；状态机、事务、race、restart测试通过后才能进入UI。
- 只有修改不同文件且无顺序依赖的任务标`[P]`。
- 不实现自动修复Run、parallel validation、公开任意validation event写入、Done reopen、trust scoring或Artifact系统。
- Validator输出不可从普通日志/Markdown用正则猜测；无法取得可靠final message必须Blocked。
- 遵循目录决策0005；单文件200行建议拆分、350行硬上限。

## Phase 1：F003基线核对与Final Message Probe

- [ ] **T001**（`FR-001`, `FR-003`, `AC-001`, `AC-003`）：确认F003 Phase 7/8已完成，记录实际`finalizeAndDrain()`、workflow hook可插入点、ValidationTraceService和evidence resolver contract；发现偏差先更新本design。
- [ ] **T002**（`FR-003`, `NFR-003`）：使用当前Codex app-server运行最小final-answer probe，记录版本和经过redaction的agent final message/turn completed fixture；验证command output不会混入final message。
- [ ] **T003**（`FR-003`, `NFR-005`）：验证Windows、Unicode、64 KiB边界、缺失final message、进程非零/cancel/timeout时协议表现，固化fixtures和capability判断。
- [ ] **T004**（`AC-003`）：扩展Fake adapter fixture，支持`finalMessage`、passed/failed/blocked/invalid/oversized结果和terminal failure。

**Checkpoint 1**：F003 hook和Codex final-message映射已由fixture固定；领域JSON contract无需待确认。

> 备注：T002/T003 的裸协议 probe 已在真实 Codex `0.144.5`（Windows）跑通，契约结论固化在 design §5.1（final message = `item/completed` 中 `phase === "final_answer"` 的 agentMessage `text`，禁止累加 delta，命令输出隔离/Unicode 已验证）。本 Phase 剩余工作是把 probe 数据落成 test-suite fixture，并补 64 KiB/缺失/非零/cancel/timeout 边界 fixture。

## Phase 2：Shared Contract与Schema v4

- [ ] **T005**（`DR-003` - `DR-006`）：先添加shared contract编译测试，覆盖RunRole/DispatchSource、受控AdapterRole、AdapterIdentitySnapshot、ValidationPolicySnapshot、ValidationOutcome/BlockReason/Finding/Result（含key decisions/lessons candidate）、Issue blocker、EvidenceSummary和API DTO。
- [ ] **T006**（`DR-003` - `DR-006`）：新增`shared/src/types/validation.ts`并re-export；扩展Run/Issue。F003已存在`validation.requested/finding/passed/failed/blocked`，F004只给ThreadEventType新增`issue.done/issue.unblocked`并扩展既有validation payload contract，保持持久化枚举只增不改。
- [ ] **T007**（`IR-001` - `IR-005`）：先补错误HTTP映射测试，再新增validation、summary、transition、operator note相关ErrorCode。
- [ ] **T008**（`DR-001` - `DR-006`, `NFR-001`）：添加v4 migration集成测试，覆盖空库、v3升级、重跑、旧Run identity snapshot为空、新Run约束、seed条件更新、EvidenceSummary双方identity/policy snapshot+hash约束和索引存在。
- [ ] **T009**（`DR-001` - `DR-006`）：实现`schema-v4.ts`并注册migration；schema SQL 显式加入Run `final_message`内部列、role/step/round/source、`adapter_identity_json`、Issue blocker、EvidenceSummary双方identity与policy snapshot/hash和active validator partial unique index。
- [ ] **T010**（`DR-002`, `FR-002`）：添加default workflow/policy seed与snapshot解析测试，覆盖schema version、steps、evidence requirements、canonical JSON/hash稳定性、非法/用户自定义seed不被覆盖。
- [ ] **T011**（`DR-002`）：更新v4 seed及WorkflowTemplate/ValidationPolicy repository `getById`；JSON解析、snapshot canonicalization/hash留给service。

**Checkpoint 2**：v3数据无损升级，旧Run被准确解释为implementation，数据库能强制active validator唯一。

## Phase 3：Repositories与事务原语

- [ ] **T012 [P]**（`DR-004`, `FR-007`）：添加EvidenceSummaryRepository测试，覆盖create-if-absent、Issue唯一、get、双方identity/policy snapshot+hash JSON映射和不得覆盖历史。
- [ ] **T013**（`DR-004`）：实现`repositories/evidence-summary.ts`和统一ID生成器扩展。
- [ ] **T014 [P]**（`DR-001`, `DR-006`, `NFR-001`）：添加IssueRepository CAS测试，覆盖expected status、round增量、blocker set/clear、due字段兼容和lost update。
- [ ] **T015**（`DR-001`, `DR-006`）：实现Issue CAS/status patch和validating recovery查询；业务判断不进入repository。
- [ ] **T016 [P]**（`DR-003`, `FR-001`, `IR-005`, `NFR-001`）：添加RunRepository/RunService边界测试，覆盖role/step/round/source/final message、创建时adapter identity snapshot、latest implementation、active validator和partial unique race；断言`workflow_step`严格按§3的`role`派生表固化，Done/Validating/Blocked拒绝公开implementation Run，客户端不能提交role/step/round/source/identity等系统字段。
- [ ] **T017**（`DR-003`, `IR-005`）：扩展RunRepository映射/创建/查询/terminal final-message持久化与RunService创建护栏；新Run在transaction内固化无凭据identity，public Run只暴露`has_final_message`及明确允许的安全identity DTO。
- [ ] **T018 [P]**（`FR-001`, `FR-008`）：添加AgentConfigRepository/Service role/status确定性查询、受控`implementation|validator` create/update校验和identity读取测试。
- [ ] **T019**（`FR-001`, `FR-008`）：实现available validator查询（排序`created_at,id`）及AdapterConfigService/API role枚举校验；不得让任意role字符串进入数据库。

**Checkpoint 3**：state machine所需CAS、唯一约束、identity和summary原语均有独立测试。

## Phase 4：纯逻辑——Parser、Policy、Context、Summary

- [ ] **T020 [P]**（`FR-003`, `AC-003`）：添加strict validation parser测试，覆盖纯JSON/单fence、未知字段、pass不变量、failed无finding、blocked无原因、key decisions/lessons candidate必填数组及limits、Unicode和非法file ref。
- [ ] **T021**（`FR-003`, `NFR-005`）：实现`services/validation/result-parser.ts`；不得加入regex/自由Markdown fallback。
- [ ] **T022 [P]**（`FR-004`, `FR-006`, `AC-004`, `AC-006`）：添加policy snapshot/gate/round测试，覆盖稳定canonical hash、handoff/file/test要求、partial/missing refs、scope mismatch、`nextCount >= max`边界、max非法，以及request后原policy行修改不得改变本轮判定。
- [ ] **T023**（`FR-004`, `FR-006`, `NFR-002`）：实现`validation-policy-gate.ts`和稳定block reason映射。
- [ ] **T024 [P]**（`FR-002`, `FR-005`, `AC-002`, `AC-005`）：添加validator/repair context builder测试；validator来源用`validator_run_id`校验，evidence必须另按`implementation_run_id`绑定handoff/tests/files/refs，并覆盖后续 consult handoff不得串入、trusted allowlist拒绝`run.output`、固化policy snapshot/hash、goal、prior findings、missing completeness、Windows path、first round和128 KiB截断优先级。
- [ ] **T025**（`FR-002`, `FR-005`）：实现`validation-context-builder.ts`和下一implementation findings注入builder；显式拆分source validator Run与evidence scope Run，resolver强制使用目标`implementation_run_id`，禁止raw output/absolute path/secret，并只读取requested event固化的policy snapshot。
- [ ] **T026 [P]**（`FR-007`, `FR-008`, `AC-004`, `AC-007`）：添加same-origin和EvidenceSummary builder测试，覆盖Run创建时双方identity snapshot、config后改不漂移、policy snapshot/hash、goal/final result/implementation summary/key decisions/commands-tests/files/handoff/validation result/lessons candidate、stable Markdown、escaping、500 refs/256 KiB truncation和trace completeness。
- [ ] **T027**（`FR-007`, `FR-008`）：实现pure `same-origin.ts`和覆盖PRD第7.6节的`evidence-summary-builder.ts`，只读Run identity/policy snapshots，不调用LLM。
- [ ] **T028 [P]**（`FR-001`）：添加ValidatorSelector测试，覆盖workflow缺step、无available config、role/status过滤和确定性选择。
- [ ] **T029**（`FR-001`）：实现`validator-selector.ts`；F004不fallback到implementation config。

**Checkpoint 4**：所有自动决策输入均可确定性测试；agent声明pass仍必须过system gate。

## Phase 5：Adapter/Runner Final Message Contract

- [ ] **T030**（`FR-003`）：先添加runtime contract测试，覆盖RunExitResult.finalMessage、Fake pending exit、missing capability和正文不进入public Run API。
- [ ] **T031**（`FR-003`）：扩展runtime/shared内部types和Fake adapter finalMessage。
- [ ] **T032**（`FR-003`, `NFR-003`）：用Phase 1 fixture添加Codex final-message normalizer单元测试，覆盖delta/complete、重复、command隔离、limit和malformed。
- [ ] **T033**（`FR-003`）：实现Codex final-message capture并交给RunExitResult；raw protocol不落库。
- [ ] **T034**（`FR-003`, `NFR-001`）：添加AgentRunner/Run terminal集成测试，确保final message在workflow hook前持久化，terminal callback重复不覆盖。
- [ ] **T035**（`FR-003`）：接入AgentRunner/RunService terminal pending event流程，保存final_message且不改变F003 finalization/unlock顺序。

**Checkpoint 5**：validator决策只读取已持久化final message，restart后仍可恢复解析。

## Phase 6：Validation Trace、Query与Unblock Service

- [ ] **T036**（`TR-001` - `TR-007`, `NFR-001`）：扩展F003 ValidationTraceService测试，覆盖既有requested/finding/passed/failed/blocked及新增done/unblocked payload、`validator_run_id`来源校验、独立`implementation_run_id` evidence scope、issue-level ref与run-level ref分层校验和pending broadcasts。
- [ ] **T037**（`TR-001` - `TR-007`）：扩展ValidationTraceService builders，明确拆分`sourceValidatorRunId`与`evidenceScopeRunId`；不重复新增F003已有枚举，仍不注册通用公开write route。
- [ ] **T038**（`FR-009`, `AC-008`）：添加unblock service测试，覆盖非空note、长度、validation blocker scope、Blocked CAS、Ready结果、round保留、清blocker和不自动Run。
- [ ] **T039**（`FR-009`, `TR-007`）：实现`ValidationRecoveryActionService.unblock()`，状态/event同事务commit后广播。
- [ ] **T040**（`FR-010`, `IR-001`, `IR-002`）：添加ValidationQueryService测试，覆盖current round/max、active Run、latest result/findings/blocker/summary和100 findings上限。
- [ ] **T041**（`FR-010`）：实现query projection；finding从events读取，不新增重复表。

## Phase 7：Validation Workflow State Machine

- [ ] **T042**（`FR-001`, `AC-001`）：添加`requestValidation()`集成测试，断言F003 finalized后才执行、缺implementation identity/非法policy先Blocked、Running CAS、先创建validator Run row固化identity、requested固化implementation/policy scope、requested+run.queued同事务且event sequence正确、commit后广播。
- [ ] **T043**（`FR-001`, `FR-002`）：实现ValidationWorkflowService request、selector、identity/policy snapshot、context和queued Run创建；事务内不spawn，不在terminal/recovery重读可变config/policy。
- [ ] **T044**（`FR-001`, `NFR-001`）：添加duplicate/concurrent request测试，确保active validator唯一，same request幂等，inconsistent conflict Blocked。
- [ ] **T045**（`FR-001`）：实现unique conflict读取/幂等映射和queue kick。
- [ ] **T046**（`FR-004`, `FR-007`, `FR-008`, `AC-004`, `AC-010`）：添加pass端到端事务测试，覆盖parser、固化policy gate、passed、完整PRD summary、done顺序、adapter config后改不影响same-origin，任何插入失败整体回滚。
- [ ] **T047**（`FR-004`, `FR-007`, `FR-008`）：实现passed submission transaction，使用双方Run identity与requested policy snapshots生成same-origin和Summary；缺snapshot不得Done。
- [ ] **T048**（`FR-005`, `AC-005`）：添加failed回流测试，覆盖finding排序/refs、failed event、round++、Running、下一implementation context且不自动创建Run。
- [ ] **T049**（`FR-005`）：实现failed submission path。
- [ ] **T050**（`FR-006`, `AC-006`）：添加round limit测试，覆盖第1/2次Running、第3次failed+blocked、queued自动动作停止和blocker columns。
- [ ] **T051**（`FR-006`, `NFR-002`）：实现round-limit blocked path，保留findings和round。
- [ ] **T052**（`FR-003`, `FR-006`）：添加blocked矩阵测试：validator unavailable/run failed/cancel/interrupted/unparsable/missing/scope mismatch、implementation identity缺失、policy/config invalid。
- [ ] **T053**（`FR-003`, `FR-006`）：实现统一`blockValidation()`事务和stable messages；不得把这些情况写成Done或普通fail后继续。
- [ ] **T054**（`NFR-001`）：添加stale/duplicate validator result测试，旧round不能覆盖新round/Done/Blocked；request后修改adapter config或policy行也不能改变本轮identity/gate。
- [ ] **T055**（`NFR-001`）：实现result submission二次CAS和result-event idempotency guard。

**Checkpoint 7**：pass/fail/blocked/round/race全部通过真实SQLite事务测试，且没有自动修复循环。

## Phase 8：Terminal Hook、Queue与Startup Recovery集成

- [ ] **T056**（`FR-001`, `NFR-001`）：添加terminal orchestration测试，顺序必须是run terminal -> F003 file/handoff -> unlock -> F004 workflow hook -> validator queue/start。
- [ ] **T057**（`FR-001`）：在F003唯一`finalizeAndDrain()`完成点接入async workflow hook；implementation completed触发，其他implementation terminal不触发。
- [ ] **T058**（`FR-003`, `NFR-002`）：添加validator completed/failed/cancelled/interrupted/spawn/timeout/escalation集成测试；仅completed尝试parse，其余Blocked。
- [ ] **T059**（`FR-003`）：把validator terminal统一接到ValidationWorkflowService，保留F003 trace finalization和queue drain。
- [ ] **T060**（`NFR-001`, `NFR-003`）：添加startup recovery测试，覆盖completed implementation未request、terminal validator未result、Validating无active、result transaction上次失败和重复restart；断言recovery从`validation.requested`读取固化的`implementation_run_id`与policy snapshot/hash，并从Run读取identity snapshot，不用latest/current config/policy重新推导。
- [ ] **T061**（`NFR-001`）：实现ValidationRecoveryService，并在F003 recovery后、listen/queue drain前await执行。
- [ ] **T062**（`AC-001`, `IR-005`, `NFR-002`）：添加同workspace implementation+validator+其他queued Run顺序测试；queue drain每次重验role/round/Issue status，取消`Validating`下同Issue stale implementation并继续扫描，Done/Blocked不启动新Run，validator不跨Issue绕过FIFO锁；另断言公开创建入口在Validating/Done/Blocked时已提前拒绝而不是依赖出队取消。

**Checkpoint 8**：正常、异常和restart都通过同一状态机；不存在Done无summary或Validating永久悬挂。

## Phase 9：HTTP API

- [ ] **T063**（`IR-001` - `IR-005`）：先添加route集成测试，覆盖GET validation、GET summary、POST validation、POST unblock、404/400/409/422、显式补建无validator时“提交Blocked并返回409”的语义、Done/Validating/Blocked Run创建护栏、系统字段防伪和secret/raw final message不泄漏。
- [ ] **T064**（`IR-001`, `IR-002`）：新增`api/routes/validation.ts`的两个GET，route只校验参数并调用service。
- [ ] **T065**（`IR-003`, `FR-009`）：实现unblock route的body schema和structured error。
- [ ] **T066**（`IR-004`, `IR-005`）：实现显式补建validator endpoint；仅Validating允许，active同一Run幂等返回。
- [ ] **T067**（`TR-008`, `AC-009`）：扩展SSE replay测试，验证validation/findings/done/unblock按event_sequence补发且无未提交广播。
- [ ] **T068**：注册repository/service/routes依赖，保持`routes -> services -> repositories`单向边界。

## Phase 10：Thread / Inspector / Adapter UI

- [ ] **T069**（`FR-010`, `UX-001` - `UX-004`）：先添加apiClient/use-validation hook测试，覆盖status/summary/unblock/trigger和SSE invalidation keys。
- [ ] **T070**（`FR-010`）：实现`apiClient.validation`和`hooks/use-validation.ts`。
- [ ] **T071 [P]**（`UX-001`, `UX-005`）：添加ValidationTraceCard组件测试，覆盖requested/finding/passed/failed/blocked/done/unblocked、severity文字、双Run identity/evidence scope refs和same-origin文案。
- [ ] **T072**（`UX-001`, `UX-005`）：扩展F003 validation card/Thread renderer，unknown payload保持generic fallback。
- [ ] **T073 [P]**（`UX-002` - `UX-004`）：添加Inspector Validation section测试，覆盖round/max、active、findings、blocker、完整PRD summary、identity/policy snapshot标记、loading/error和evidence missing不得显示Done。
- [ ] **T074**（`FR-010`, `UX-002` - `UX-004`）：实现Inspector Validation section和Evidence Summary展示。
- [ ] **T075**（`FR-009`, `UX-004`）：添加unblock dialog测试，覆盖required note、server conflict、success刷新和不自动Run。
- [ ] **T076**（`FR-009`）：实现Resolve Blocker dialog/action。
- [ ] **T077**（`FR-001`）：添加Adapter Settings role配置/validator availability提示测试，并覆盖非法role前后端拒绝及配置修改不改变既有Run identity snapshot。
- [ ] **T078**（`FR-001`）：扩展Codex adapter表单和列表显示受控implementation/validator role/model；不允许自由字符串role。
- [ ] **T079**（`AC-009`）：扩展App UI flow测试，跑通implementation completed -> Validating -> pass Done和fail/Blocked两条路径。

**Checkpoint 10**：用户从Thread/Inspector可看完整validation链并安全恢复Blocked；同源与独立验证不会混淆。

## Phase 11：端到端验证与文档回写

- [ ] **T080**（`AC-001` - `AC-010`）：运行`npm run typecheck`、`npm test`、`npm run build`并保存结果；所有F001-F003 regression必须通过。
- [ ] **T081**（`AC-001` - `AC-005`）：Windows真实Codex执行一个小Issue，从implementation evidence到validator pass/Done；核对事件顺序、summary和workspace锁。
- [ ] **T082**（`AC-005`, `AC-006`）：真实/fixture故意fail三轮，验证findings回流、无自动修复、round limit Blocked。
- [ ] **T083**（`AC-003`, `AC-006`, `NFR-002`）：手动验证无validator、invalid JSON、缺test/file/handoff、validator timeout/cancel均不得Done。
- [ ] **T084**（`AC-008`, `AC-010`）：手动验证unblock note、server在implementation/validator terminal和pass transaction附近重启后的恢复。
- [ ] **T085**（`AC-007`）：配置同provider同model/不同model两组，核对same-origin summary和UI文案。
- [ ] **T086**（`DR-001` - `DR-006`）：更新`docs/personahub-system-design.md`实际schema。
- [ ] **T087**（`FR-001`, `NFR-001`）：更新`docs/personahub-architecture.md`workflow hook、validation gate、recovery顺序。
- [ ] **T088**（`AC-001` - `AC-010`）：逐项走查并勾选spec acceptance；不以文档说明替代实现。
- [ ] **T089**：进入review/done时更新`BACKLOG.md`、三件套Status和`CLAUDE.md`。

## 依赖关系

```text
F003 Checkpoint 7/8 + Phase 1 final-message probe
  -> Phase 2 schema/contracts
  -> Phase 3 repositories
  -> Phase 4 pure logic + Phase 5 runtime contract
  -> Phase 6 trace/query
  -> Phase 7 state machine
  -> Phase 8 terminal/recovery integration
  -> Phase 9 API
  -> Phase 10 UI
  -> Phase 11 acceptance
```

- T001是所有runtime集成的硬前置；F003未实现不得凭design假设直接编码F004。
- T020-T029可在Phase 3完成后并行，但合并前必须统一validation types。
- T042-T055阻塞terminal hook；不得先接自动触发再补事务状态机。
- Checkpoint 8是API/UI硬门槛。
- F005只能在F004 Checkpoint 8后开始其routing/validator race集成。

## Requirement → Task映射

| Requirement | 主要任务 |
| --- | --- |
| `FR-001` 自动validator | T001, T028-T029, T042-T045, T056-T062 |
| `FR-002` validator context | T024-T025, T042-T043 |
| `FR-003` result parse | T002-T004, T020-T021, T030-T035, T052-T053 |
| `FR-004` pass/Done | T022-T023, T026-T027, T046-T047 |
| `FR-005` fail回流 | T024-T025, T048-T049 |
| `FR-006` round/Blocked | T022-T023, T050-T053 |
| `FR-007` Evidence Summary | T012-T013, T026-T027, T046-T047 |
| `FR-008` same-origin | T018-T019, T026-T027, T046-T047 |
| `FR-009` unblock | T038-T039, T063-T066, T075-T076 |
| `FR-010` UI/status | T040-T041, T063-T079 |
| `NFR-001/002` 事务/收敛 | T008-T017, T042-T062 |
| `TR-001` - `TR-008` | T036-T037, T042-T055, T067 |

## 备注

- F004 migration编号以F003实际落地版本为准；若F003实现时占用不同版本，只顺延文件名/版本号，不改变schema内容和依赖顺序。
- `max_validation_rounds=3`表示第三次failed后Blocked，不是允许第四次。
- F005会把“立即自动创建validator”改为10秒持久化grace；F004本身先实现立即路径并把创建收敛到可复用的`request/claim` service，避免F005重写状态机。
- F005落地时由其T062显式改写F004 T042对应的“requested与validator queued同事务”测试为grace window语义；这属于后续feature修改既有行为，不保留两套互相冲突的断言。
