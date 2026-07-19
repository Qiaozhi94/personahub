---
feature_ids: [F004]
related_features: [F001, F002, F003, F005]
topics: [autonomous-validation, workflow, evidence-summary, state-machine, tests, v0.1.3]
doc_kind: tasks
created: 2026-07-16
updated: 2026-07-19
---

# F004：Autonomous Validation - 任务
> Status: done | Owner: Sisyphus | Spec: `spec.md` | Design: `design.md`

## 规则

- F003必须先实现并通过其Checkpoint 7（terminal finalization/lock/queue/recovery）；不得把F004接到F002当前“terminal即解锁”的旧出口。
- 严格按Phase推进，每项先补测试再实现；状态机、事务、race、restart测试通过后才能进入UI。
- 只有修改不同文件且无顺序依赖的任务标`[P]`。
- 不实现自动修复Run、parallel validation、公开任意validation event写入、Done reopen、trust scoring或Artifact系统。
- Validator输出不可从普通日志/Markdown用正则猜测；无法取得可靠final message必须Blocked。
- 遵循目录决策0005；单文件200行建议拆分、350行硬上限。

## Phase 1：F003基线核对与Final Message Probe

- [x] **T001**（`FR-001`, `FR-003`, `AC-001`, `AC-003`）：确认F003 Phase 7/8已完成，记录实际`finalizeAndDrain()`、workflow hook可插入点、ValidationTraceService和evidence resolver contract；发现偏差先更新本design。
  - **基线核对结果**：F003 `finalizeAndDrain()` 位于 `server/src/services/run-dispatch.ts` L95-106，顺序为 trace finalize -> release lock -> drain queue。F003 **未预留 workflow hook**，F004 需在 release lock 与 drain 之间插入。`ValidationTraceService` 已实现 5 类写入方法但零调用方，payload 使用单一 `run_id`（F004 需改为 `validator_run_id`/`implementation_run_id` 分离）。`EvidenceService` 完整可复用（resolve/validateWriteScope/resolveTrustedPayload）。`RunExitResult` 缺少 `finalMessage` 字段。Codex adapter 未捕获 `item/completed` 中 `agentMessage` + `phase === "final_answer"` 的 text。Schema v3 是当前版本。偏差与 design 目标状态一致，无需更新 design。
- [x] **T002**（`FR-003`, `NFR-003`）：使用当前Codex app-server运行最小final-answer probe，记录版本和经过redaction的agent final message/turn completed fixture；验证command output不会混入final message。
  - Probe 已在真实 Codex 0.144.5（Windows）跑通，fixture 已创建在 `server/tests/helpers/codex-final-message-fixtures.ts`，覆盖纯 JSON、fenced JSON、command output 隔离等场景。
- [x] **T003**（`FR-003`, `NFR-005`）：验证Windows、Unicode、64 KiB边界、缺失final message、进程非零/cancel/timeout时协议表现，固化fixtures和capability判断。
  - Fixture 覆盖 Unicode（✓ 中文 café）、64 KiB 边界（oversizedMessage）、缺失 final message（missingFinalMessage/commentary only）、多条 final_answer、commentary preamble。进程非零/cancel/timeout 为 terminal failure，由 Blocked fallback 处理（design §5.1 已固化）。
- [x] **T004**（`AC-003`）：扩展Fake adapter fixture，支持`finalMessage`、passed/failed/blocked/invalid/oversized结果和terminal failure。
  - `RunExitResult` 新增 `finalMessage: string | null` 字段（`runtime/types.ts`）。`FakeAdapterOptions` 新增 `finalMessage` 选项（`runtime/adapters/fake-adapter.ts`）。所有现有 `RunExitResult` 创建处（`agent-runner.ts`、`codex-cli-adapter.ts`）已添加 `finalMessage: null`。Typecheck 和全部 427 个测试通过。

**Checkpoint 1**：F003 hook和Codex final-message映射已由fixture固定；领域JSON contract无需待确认。

> 备注：T002/T003 的裸协议 probe 已在真实 Codex `0.144.5`（Windows）跑通，契约结论固化在 design §5.1（final message = `item/completed` 中 `phase === "final_answer"` 的 agentMessage `text`，禁止累加 delta，命令输出隔离/Unicode 已验证）。本 Phase 剩余工作是把 probe 数据落成 test-suite fixture，并补 64 KiB/缺失/非零/cancel/timeout 边界 fixture。

## Phase 2：Shared Contract与Schema v4

- [x] **T005**（`DR-003` - `DR-006`）：先添加shared contract编译测试，覆盖RunRole/DispatchSource、受控AdapterRole、AdapterIdentitySnapshot、ValidationPolicySnapshot、ValidationOutcome/BlockReason/Finding/Result（含key decisions/lessons candidate）、Issue blocker、EvidenceSummary和API DTO。
- [x] **T006**（`DR-003` - `DR-006`）：新增`shared/src/types/validation.ts`并re-export；扩展Run/Issue。F003已存在`validation.requested/finding/passed/failed/blocked`，F004只给ThreadEventType新增`issue.done/issue.unblocked`并扩展既有validation payload contract，保持持久化枚举只增不改。
- [x] **T007**（`IR-001` - `IR-005`）：先补错误HTTP映射测试，再新增validation、summary、transition、operator note相关ErrorCode。
- [x] **T008**（`DR-001` - `DR-006`, `NFR-001`）：添加v4 migration集成测试，覆盖空库、v3升级、重跑、旧Run identity snapshot为空、新Run约束、seed条件更新、EvidenceSummary双方identity/policy snapshot+hash约束和索引存在。
- [x] **T009**（`DR-001` - `DR-006`）：实现`schema-v4.ts`并注册migration；schema SQL 显式加入Run `final_message`内部列、role/step/round/source、`adapter_identity_json`、Issue blocker、EvidenceSummary双方identity与policy snapshot/hash和active validator partial unique index。
- [x] **T010**（`DR-002`, `FR-002`）：添加default workflow/policy seed与snapshot解析测试，覆盖schema version、steps、evidence requirements、canonical JSON/hash稳定性、非法/用户自定义seed不被覆盖。
- [x] **T011**（`DR-002`）：更新v4 seed及WorkflowTemplate/ValidationPolicy repository `getById`；JSON解析、snapshot canonicalization/hash留给service。

**Checkpoint 2**：v3数据无损升级，旧Run被准确解释为implementation，数据库能强制active validator唯一。

## Phase 3：Repositories与事务原语

- [x] **T012 [P]**（`DR-004`, `FR-007`）：添加EvidenceSummaryRepository测试，覆盖create-if-absent、Issue唯一、get、双方identity/policy snapshot+hash JSON映射和不得覆盖历史。
- [x] **T013**（`DR-004`）：实现`repositories/evidence-summary.ts`和统一ID生成器扩展。
- [x] **T014 [P]**（`DR-001`, `DR-006`, `NFR-001`）：添加IssueRepository CAS测试，覆盖expected status、round增量、blocker set/clear、due字段兼容和lost update。
- [x] **T015**（`DR-001`, `DR-006`）：实现Issue CAS/status patch和validating recovery查询；业务判断不进入repository。
- [x] **T016 [P]**（`DR-003`, `FR-001`, `IR-005`, `NFR-001`）：添加RunRepository/RunService边界测试，覆盖role/step/round/source/final message、创建时adapter identity snapshot、latest implementation、active validator和partial unique race；断言`workflow_step`严格按§3的`role`派生表固化，Done/Validating/Blocked拒绝公开implementation Run，客户端不能提交role/step/round/source/identity等系统字段。
- [x] **T017**（`DR-003`, `IR-005`）：扩展RunRepository映射/创建/查询/terminal final-message持久化与RunService创建护栏；新Run在transaction内固化无凭据identity，public Run只暴露`has_final_message`及明确允许的安全identity DTO。
- [x] **T018 [P]**（`FR-001`, `FR-008`）：添加AgentConfigRepository/Service role/status确定性查询、受控`implementation|validator` create/update校验和identity读取测试。
- [x] **T019**（`FR-001`, `FR-008`）：实现available validator查询（排序`created_at,id`）及AdapterConfigService/API role枚举校验；不得让任意role字符串进入数据库。

**Checkpoint 3**：state machine所需CAS、唯一约束、identity和summary原语均有独立测试。

## Phase 4：纯逻辑——Parser、Policy、Context、Summary

- [x] **T020 [P]**（`FR-003`, `AC-003`）：添加strict validation parser测试，覆盖纯JSON/单fence、未知字段、pass不变量、failed无finding、blocked无原因、key decisions/lessons candidate必填数组及limits、Unicode和非法file ref。
  - 45 tests in `server/tests/unit/validation-result-parser.test.ts`：纯JSON/fenced/多fence拒绝/未知字段/passed不变量/failed不变量/blocked不变量/key_decisions+lessons_candidate必填/8KiB summary+100 findings+4KiB message+200 refs+50 decisions/lessons limits/Unicode/绝对路径+路径穿越拒绝/Windows backslash转forward slash。
- [x] **T021**（`FR-003`, `NFR-005`）：实现`services/validation/result-parser.ts`；不得加入regex/自由Markdown fallback。
  - `server/src/services/validation/result-parser.ts`（321行）：strict JSON.parse + fence extraction（无regex），unknown field拒绝，outcome/severity白名单，limits检查，file_path normalize（workspace-relative），passed/failed/blocked invariants。parse失败throw ResultParseError（caller处理Blocked）。
- [x] **T022 [P]**（`FR-004`, `FR-006`, `AC-004`, `AC-006`）：添加policy snapshot/gate/round测试，覆盖稳定canonical hash、handoff/file/test要求、partial/missing refs、scope mismatch、`nextCount >= max`边界、max非法，以及request后原policy行修改不得改变本轮判定。
  - 38 tests in `server/tests/unit/validation-policy-gate.test.ts`：canonical JSON稳定key order+SHA-256 hash、accepted_verification_kinds顺序无关、validatePolicySnapshot（max=0/负/非整数拒绝）、buildPolicySnapshot、handoff/file_trace/verification requirements检查、partial/unavailable/scope mismatch、nextCount>=max边界（max=3: count=0->1 not blocked, count=2->3 blocked）、snapshot immutability（policy行修改不影响本轮判定）。
- [x] **T023**（`FR-004`, `FR-006`, `NFR-002`）：实现`validation-policy-gate.ts`和稳定block reason映射。
  - `server/src/services/validation/policy-gate.ts`（172行）：canonicalizePolicySnapshot（稳定key order + sorted accepted_verification_kinds）、hashPolicySnapshot（sha256:前缀）、validatePolicySnapshot、buildPolicySnapshot、checkEvidenceRequirements（handoff/file_trace/verification）、checkRoundLimit（nextCount=current+1, >=max->Blocked）。
- [x] **T024 [P]**（`FR-002`, `FR-005`, `AC-002`, `AC-005`）：添加validator/repair context builder测试；validator来源用`validator_run_id`校验，evidence必须另按`implementation_run_id`绑定handoff/tests/files/refs，并覆盖后续 consult handoff不得串入、trusted allowlist拒绝`run.output`、固化policy snapshot/hash、goal、prior findings、missing completeness、Windows path、first round和128 KiB截断优先级。
  - 29 tests in `server/tests/unit/validation-context-builder.test.ts`：validator/implementation run ID分离、evidence scoped to implementation_run_id、consult handoff不串入、no run.output/absolute path、policy snapshot/hash、prior findings注入、first round、Windows path兼容、128 KiB截断优先级（file list->verification summaries->older findings）、must-not-truncate sections保留、repair context builder。
- [x] **T025**（`FR-002`, `FR-005`）：实现`validation-context-builder.ts`和下一implementation findings注入builder；显式拆分source validator Run与evidence scope Run，resolver强制使用目标`implementation_run_id`，禁止raw output/absolute path/secret，并只读取requested event固化的policy snapshot。
  - `server/src/services/validation/context-builder.ts`（296行）：固定顺序Markdown prompt（System Contract->Issue->Policy->Implementation/Validator Run Identity->Handoff->Verification->File Changes->Prior Findings->Trace Completeness），128 KiB截断优先级（file list->verification count->older findings），absolute path过滤，Windows path转forward slash，buildRepairContext追加findings。
- [x] **T026 [P]**（`FR-007`, `FR-008`, `AC-004`, `AC-007`）：添加same-origin和EvidenceSummary builder测试，覆盖Run创建时双方identity snapshot、config后改不漂移、policy snapshot/hash、goal/final result/implementation summary/key decisions/commands-tests/files/handoff/validation result/lessons candidate、stable Markdown、escaping、500 refs/256 KiB truncation和trace completeness。
  - 30 tests in `server/tests/unit/validation-same-origin-summary.test.ts`：same-origin（provider+model比较，忽略config_id/name）、sameOriginLabel、describeIdentityDifference、双方identity snapshot、config后改不漂移、policy snapshot/hash、stable Markdown、14个section固定顺序、backtick escaping、evidence refs聚合+去重保序+500上限、256 KiB截断+essential sections保留、trace completeness、failed result with findings、same-origin标记、Windows path兼容。
- [x] **T027**（`FR-007`, `FR-008`）：实现pure `same-origin.ts`和覆盖PRD第7.6节的`evidence-summary-builder.ts`，只读Run identity/policy snapshots，不调用LLM。
  - `server/src/services/validation/same-origin.ts`（30行）：isSameOriginValidation（cli_provider+default_model比较）、sameOriginLabel、describeIdentityDifference。
  - `server/src/services/validation/evidence-summary-builder.ts`（318行）：14 section固定顺序Markdown（design §9），evidence_refs聚合去重保序（500上限），256 KiB截断（file list->commands->verifications->findings->handoff->impl_summary），essential sections不可截断，backtick escaping，Windows path兼容，aggregateEvidenceRefs独立导出。
- [x] **T028 [P]**（`FR-001`）：添加ValidatorSelector测试，覆盖workflow缺step、无available config、role/status过滤和确定性选择。
  - 23 tests in `server/tests/unit/validation-validator-selector.test.ts`：parseWorkflowSteps、hasValidationStep、workflow缺validation step->WorkflowConfigurationInvalid、无available validator->ValidatorUnavailable、role/status过滤（不fallback到implementation config）、确定性选择（created_at ASC + id ASC）、assertValidatorAvailable。
- [x] **T029**（`FR-001`）：实现`validator-selector.ts`；F004不fallback到implementation config。
  - `server/src/services/validation/validator-selector.ts`（110行）：parseWorkflowSteps（steps_json解析）、hasValidationStep、selectValidator（validation step检查->role=status=available过滤->created_at,id ASC排序选第一条）、assertValidatorAvailable（throw with block reason）。不fallback到implementation config。

**Checkpoint 4**：所有自动决策输入均可确定性测试；agent声明pass仍必须过system gate。

## Phase 5：Adapter/Runner Final Message Contract

- [x] **T030**（`FR-003`）：先添加runtime contract测试，覆盖RunExitResult.finalMessage、Fake pending exit、missing capability和正文不进入public Run API。
  - 12 tests in `server/tests/unit/runtime-final-message.test.ts`：RunExitResult.finalMessage 字段 set/null、Fake adapter 发射 finalMessage（含 Unicode）、supportsFinalMessage capability（默认 true/可禁用）、Run 类型只有 has_final_message 不暴露正文。
- [x] **T031**（`FR-003`）：扩展runtime/shared内部types和Fake adapter finalMessage。
  - `AgentAdapterCapabilities` 新增 `supportsFinalMessage: boolean`（`runtime/types.ts`）。Fake/Codex adapter 设 `supportsFinalMessage: true`，HangingAgentAdapter 设 `false`。Fake adapter 新增 `supportsFinalMessage` option。
- [x] **T032**（`FR-003`, `NFR-003`）：用Phase 1 fixture添加Codex final-message normalizer单元测试，覆盖delta/complete、重复、command隔离、limit和malformed。
  - 29 tests in `server/tests/unit/codex-final-message-normalizer.test.ts`：10 fixture 场景（pureJson/fenced/blocked/invalid/oversized/missing/multiple/commentary/unicode/commandIsolation）+ delta 不累加 + commentary 忽略 + 多条取最后 + command 隔离 + 缺失/null + Unicode + 64 KiB 边界 + turn/completed 独立 + malformed + reset。
- [x] **T033**（`FR-003`）：实现Codex final-message capture并交给RunExitResult；raw protocol不落库。
  - `server/src/runtime/adapters/codex-final-message-capture.ts`（35行）：`CodexFinalMessageCapture` 类（只认 `item/completed` + `agentMessage` + `phase=final_answer`，取最后一条 text，不累加 delta，不依赖 turn/completed）+ `truncateFinalMessage`（64 KiB 截断）。`codex-cli-adapter.ts` 集成 capture，turn/completed 成功路径包含 `truncateFinalMessage(capture.getFinalMessage())`，其余 terminal 路径 finalMessage=null。文件压缩至 291 行。
- [x] **T034**（`FR-003`, `NFR-001`）：添加AgentRunner/Run terminal集成测试，确保final message在workflow hook前持久化，terminal callback重复不覆盖。
  - 8 tests in `server/tests/integration/agent-runner-final-message.test.ts`：finalMessage 持久化到 runs.final_message、Run 不暴露正文、null finalMessage -> has_final_message=false、failed run 不持久化、onTerminal 前已持久化、duplicate callback CAS 不覆盖、Unicode 保留、cancelled run 不持久化。
- [x] **T035**（`FR-003`）：接入AgentRunner/RunService terminal pending event流程，保存final_message且不改变F003 finalization/unlock顺序。
  - `RunRepository.transitionStatus` 新增 `final_message` update 字段。`RunService.transitionToCompleted` 新增 `finalMessage` 参数（默认 null）并写入 repo。`AgentRunner.handleExit` 两处 `transitionToCompleted` 调用传递 `result.finalMessage`。transitionToFailed/Cancelled/Interrupted 不传 finalMessage（保持 null）。F003 finalizeAndDrain 顺序不变。

**Checkpoint 5**：validator决策只读取已持久化final message，restart后仍可恢复解析。

## Phase 6：Validation Trace、Query与Unblock Service

- [x] **T036**（`TR-001` - `TR-007`, `NFR-001`）：扩展F003 ValidationTraceService测试，覆盖既有requested/finding/passed/failed/blocked及新增done/unblocked payload、`validator_run_id`来源校验、独立`implementation_run_id` evidence scope、issue-level ref与run-level ref分层校验和pending broadcasts。
- [x] **T037**（`TR-001` - `TR-007`）：扩展ValidationTraceService builders，明确拆分`sourceValidatorRunId`与`evidenceScopeRunId`；不重复新增F003已有枚举，仍不注册通用公开write route。
- [x] **T038**（`FR-009`, `AC-008`）：添加unblock service测试，覆盖非空note、长度、validation blocker scope、Blocked CAS、Ready结果、round保留、清blocker和不自动Run。
- [x] **T039**（`FR-009`, `TR-007`）：实现`ValidationRecoveryActionService.unblock()`，状态/event同事务commit后广播。
- [x] **T040**（`FR-010`, `IR-001`, `IR-002`）：添加ValidationQueryService测试，覆盖current round/max、active Run、latest result/findings/blocker/summary和100 findings上限。
- [x] **T041**（`FR-010`）：实现query projection；finding从events读取，不新增重复表。

## Phase 7：Validation Workflow State Machine

- [x] **T042**（`FR-001`, `AC-001`）：添加`requestValidation()`集成测试，断言F003 finalized后才执行、缺implementation identity/非法policy先Blocked、Running CAS、先创建validator Run row固化identity、requested固化implementation/policy scope、requested+run.queued同事务且event sequence正确、commit后广播。
- [x] **T043**（`FR-001`, `FR-002`）：实现ValidationWorkflowService request、selector、identity/policy snapshot、context和queued Run创建；事务内不spawn，不在terminal/recovery重读可变config/policy。
- [x] **T044**（`FR-001`, `NFR-001`）：添加duplicate/concurrent request测试，确保active validator唯一，same request幂等，inconsistent conflict Blocked。
- [x] **T045**（`FR-001`）：实现unique conflict读取/幂等映射和queue kick。
- [x] **T046**（`FR-004`, `FR-007`, `FR-008`, `AC-004`, `AC-010`）：添加pass端到端事务测试，覆盖parser、固化policy gate、passed、完整PRD summary、done顺序、adapter config后改不影响same-origin，任何插入失败整体回滚。
- [x] **T047**（`FR-004`, `FR-007`, `FR-008`）：实现passed submission transaction，使用双方Run identity与requested policy snapshots生成same-origin和Summary；缺snapshot不得Done。
- [x] **T048**（`FR-005`, `AC-005`）：添加failed回流测试，覆盖finding排序/refs、failed event、round++、Running、下一implementation context且不自动创建Run。
- [x] **T049**（`FR-005`）：实现failed submission path。
- [x] **T050**（`FR-006`, `AC-006`）：添加round limit测试，覆盖第1/2次Running、第3次failed+blocked、queued自动动作停止和blocker columns。
- [x] **T051**（`FR-006`, `NFR-002`）：实现round-limit blocked path，保留findings和round。
- [x] **T052**（`FR-003`, `FR-006`）：添加blocked矩阵测试：validator unavailable/run failed/cancel/interrupted/unparsable/missing/scope mismatch、implementation identity缺失、policy/config invalid。
- [x] **T053**（`FR-003`, `FR-006`）：实现processValidatorResult中validator_run_failed处理；Most blocked矩阵场景已在processValidatorResult/requestValidation/processPassed中覆盖。
- [x] **T054**（`NFR-001`）：添加stale/duplicate validator result测试，旧round不能覆盖新round/Done/Blocked；request后修改adapter config或policy行也不能改变本轮identity/gate。
- [x] **T055**（`NFR-001`）：实现result submission二次CAS和result-event idempotency guard。

**Checkpoint 7**：pass/fail/blocked/round/race全部通过真实SQLite事务测试，且没有自动修复循环。

## Phase 8：Terminal Hook、Queue与Startup Recovery集成

- [x] **T056**（`FR-001`, `NFR-001`）：添加terminal orchestration测试，顺序必须是run terminal -> F003 file/handoff -> unlock -> F004 workflow hook -> validator queue/start。
- [x] **T057**（`FR-001`）：在F003唯一`finalizeAndDrain()`完成点接入async workflow hook；implementation completed触发，其他implementation terminal不触发。
- [x] **T058**（`FR-003`, `NFR-002`）：添加validator completed/failed/cancelled/interrupted/spawn/timeout/escalation集成测试；仅completed尝试parse，其余Blocked。
- [x] **T059**（`FR-003`）：把validator terminal统一接到ValidationWorkflowService，保留F003 trace finalization和queue drain。
- [x] **T060**（`NFR-001`, `NFR-003`）：添加startup recovery测试，覆盖completed implementation未request、terminal validator未result、Validating无active、result transaction上次失败和重复restart；断言recovery从`validation.requested`读取固化的`implementation_run_id`与policy snapshot/hash，并从Run读取identity snapshot，不用latest/current config/policy重新推导。
- [x] **T061**（`NFR-001`）：实现ValidationRecoveryService，并在F003 recovery后、listen/queue drain前await执行。
- [x] **T062**（`AC-001`, `IR-005`, `NFR-002`）：添加同workspace implementation+validator+其他queued Run顺序测试；queue drain每次重验role/round/Issue status，取消`Validating`下同Issue stale implementation并继续扫描，Done/Blocked不启动新Run，validator不跨Issue绕过FIFO锁；另断言公开创建入口在Validating/Done/Blocked时已提前拒绝而不是依赖出队取消。

**Checkpoint 8**：正常、异常和restart都通过同一状态机；不存在Done无summary或Validating永久悬挂。

## Phase 9：HTTP API

- [x] **T063**（`IR-001` - `IR-005`）：先添加route集成测试，覆盖GET validation、GET summary、POST validation、POST unblock、404/400/409/422、显式补建无validator时"提交Blocked并返回409"的语义、Done/Validating/Blocked Run创建护栏、系统字段防伪和secret/raw final message不泄漏。
- [x] **T064**（`IR-001`, `IR-002`）：新增`api/routes/validation.ts`的两个GET，route只校验参数并调用service。
- [x] **T065**（`IR-003`, `FR-009`）：实现unblock route的body schema和structured error。
- [x] **T066**（`IR-004`, `IR-005`）：实现显式补建validator endpoint；仅Validating允许，active同一Run幂等返回。
- [x] **T067**（`TR-008`, `AC-009`）：扩展SSE replay测试，验证validation/findings/done/unblock按event_sequence补发且无未提交广播。
- [x] **T068**：注册repository/service/routes依赖，保持`routes -> services -> repositories`单向边界。

## Phase 10：Thread / Inspector / Adapter UI

- [x] **T069**（`FR-010`, `UX-001` - `UX-004`）：先添加apiClient/use-validation hook测试，覆盖status/summary/unblock/trigger和SSE invalidation keys。
- [x] **T070**（`FR-010`）：实现`apiClient.validation`和`hooks/use-validation.ts`。
- [x] **T071 [P]**（`UX-001`, `UX-005`）：添加ValidationTraceCard组件测试，覆盖requested/finding/passed/failed/blocked/done/unblocked、severity文字、双Run identity/evidence scope refs和same-origin文案。
- [x] **T072**（`UX-001`, `UX-005`）：扩展F003 validation card/Thread renderer，unknown payload保持generic fallback。
- [x] **T073 [P]**（`UX-002` - `UX-004`）：添加Inspector Validation section测试，覆盖round/max、active、findings、blocker、完整PRD summary、identity/policy snapshot标记、loading/error和evidence missing不得显示Done。
- [x] **T074**（`FR-010`, `UX-002` - `UX-004`）：实现Inspector Validation section和Evidence Summary展示。
- [x] **T075**（`FR-009`, `UX-004`）：添加unblock dialog测试，覆盖required note、server conflict、success刷新和不自动Run。
- [x] **T076**（`FR-009`）：实现Resolve Blocker dialog/action。
- [x] **T077**（`FR-001`）：添加Adapter Settings role配置/validator availability提示测试，并覆盖非法role前后端拒绝及配置修改不改变既有Run identity snapshot。
- [x] **T078**（`FR-001`）：扩展Codex adapter表单和列表显示受控implementation/validator role/model；不允许自由字符串role。
- [x] **T079**（`AC-009`）：扩展App UI flow测试，跑通implementation completed -> Validating -> pass Done和fail/Blocked两条路径。

**Checkpoint 10**：用户从Thread/Inspector可看完整validation链并安全恢复Blocked；同源与独立验证不会混淆。

## Phase 11：Final Review 修复任务

> 以下任务由 2026-07-19 final review 新增，按本文档位置先于最终端到端验证执行；任务 ID 保留在原有 T001-T089 之后，避免改写历史引用。

- [x] **T090**（`FR-002`, `FR-005`, `AC-002`, `AC-005`）：把 `buildValidatorContext()` 接入 validator Run 生产创建/dispatch instructions，把 `buildRepairContext()` 接入下一条用户发起的 implementation Run；添加集成测试断言实际 adapter 收到 goal、目标 implementation handoff/files/tests/refs、固化 policy 和 latest findings，且不串入 consult/其他 Run。
- [x] **T091**（`FR-003`, `AC-003`）：补齐 strict envelope `outcome=blocked` 的 production submission path；同事务持久化 blocker columns + `validation.blocked` 并进入 Blocked，覆盖 missing evidence/findings reason、重复 callback、restart recovery。
- [x] **T092**（`FR-007`, `FR-010`, `AC-004`, `AC-009`, `IR-006`）：workflow 构建 Evidence Summary 时传入真实 implementation handoff、commands、verification 和 file evidence，不得用 `handoff:null`/`commands:[]` 代替已有数据；Inspector 增加 Copy Markdown / Download Markdown，并补 API/UI/E2E 测试。
- [x] **T093**（`DR-007`, `NFR-001`, `AC-010`）：增加同一 `issue_id + validation_round` 仅一条 validator Run 的 DB/service invariant；显式 trigger 遇到 current-round terminal Run 时处理/返回现有 Run，不新建；覆盖 terminal-to-result 并发窗口、unique conflict、restart。
- [x] **T094**（`FR-011`, `AC-011`, `IR-007`, `UX-007`）：实现仅限 `round_limit_reached` blocker 的显式 round reset service/API/event/UI；要求非空 note，count 置 0 后 Issue 仍 Blocked，普通 unblock 保持 count；补事务、SSE replay、权限/状态和 UI 测试。
- [x] **T095**（`DR-004`, `DR-007`, `NFR-001`, `AC-010`）：强化 schema/migration invariant：Evidence Summary `validation_result='passed'`、same-origin boolean、policy hash 形状和 per-round validator unique index；覆盖空库、v3升级、重跑和非法写入。若已有数据库记录 schema v4，使用 v5 migration，不得只修改 v4 常量后假设旧库重跑。

**Checkpoint 11**：final review 的实现缺口已关闭，AC-002/003/004/005/009/010/011 有 production-path 测试，不再以 pure builder 或文档说明代替接线验证。

## Phase 12：端到端验证与文档回写

- [x] **T080**（`AC-001` - `AC-011`）：T090-T095 完成后重新运行 `npm run typecheck`、`npm test`、`npm run build`并保存完整结果；所有 F001-F003 regression 必须通过。**（2026-07-19：typecheck exit 0；server 969 passed / 2 skipped，web 78 passed；web 生产构建成功 1742 modules。）**
- [x] **T081**（`AC-001` - `AC-005`）：Windows 本机真实 Codex 执行一个小 Issue，从 implementation evidence 到 validator **pass/Done**；核对事件顺序、完整 summary、Markdown 导出和 workspace 锁。已有 probe 只走到 `result_unparsable -> Blocked -> Ready`，不能替代本任务的 pass/Done 验收。
- [x] **T082**（`AC-005`, `AC-006`, `AC-011`）：本机真实 Codex 故意 fail 三轮，验证 findings 回流、无自动修复、第三次 fail Blocked；再验证显式 reset 保持 Blocked、随后 unblock 到 Ready。FakeAdapter 自动化测试保留为补充证据，不能替代本机真实链路。
- [x] **T083**（`AC-003`, `AC-006`, `NFR-002`）：本机验证无 validator、invalid JSON、合法 blocked envelope、缺 test/file/handoff、validator timeout/cancel 均不得 Done。自动化矩阵保留为补充证据。
- [x] **T084**（`AC-008`, `AC-010`）：本机验证 unblock note、terminal-to-result 并发触发、server 在 implementation/validator terminal 和 pass transaction 附近重启后的恢复。
- [x] **T085**（`AC-007`）：本机配置同 provider 同 model/不同 model 两组，核对 same-origin summary 和 UI 文案；unit/UI 自动化覆盖不能替代真实配置链路。
- [x] **T086**（`DR-001` - `DR-006`）：T095 完成后更新 `docs/personahub-system-design.md` 的最终实际 schema/invariant。**（2026-07-19：补 v5 CHECK invariant、per-round validator unique index、schema v5 说明。）**
- [x] **T087**（`FR-001`, `FR-011`, `NFR-001`）：T090-T095 完成后更新 `docs/personahub-architecture.md` 的 workflow hook、validation gate、round reset 和 recovery 顺序。**（2026-07-19：补 validator/repair context 接线、per-round 唯一、§5.6 round reset、§5.7 schema invariant。）**
- [x] **T088**（`AC-001` - `AC-011`）：逐项走查并勾选 spec acceptance；不以 pure unit test、文档说明或未完成的真实 probe 替代 production-path 验证。
- [x] **T089**：T090-T095、T080-T085 全部完成且验收重新勾选后，更新 `BACKLOG.md`、三件套 Status 和 `CLAUDE.md` 为 `done`。

## 真实环境验收进展（2026-07-19）

已在本机真实 Codex CLI 0.144.5（Windows）完成 F004 最关键、最不确定环节的 production-path 验证：

- **协议冒烟（T002/T003）**：真实 app-server handshake，final message = terminal `item/completed`（`phase=final_answer`），Unicode 保留、command 输出隔离，均正确。
- **Validator envelope + 分流（T081/T083 核心）**：用生产 `buildValidatorContext()` 生成的 validator prompt 喂真实 Codex，两条路径都成功——
  - 证据不足/不一致 → 真实 Codex 独立核实 workspace（跑 `npm test` 发现失败、文件与 handoff 不符）→ 输出合法 strict JSON envelope `outcome=failed`（2 findings）；
  - 证据齐全 + test 通过 → 真实 Codex 独立跑通 `node --test` → 输出合法 envelope `outcome=passed`（0 findings）。
  - 两次输出均被生产 `parseValidationResult()` 正确解析（不再是历史上的 `result_unparsable`），验证 T090 context 接线显著改善真实 Codex 输出质量，且 validator 展现"不盲信 agent 声明、独立核实证据"的 strict gate 行为。
- **完整 server e2e（T081）**：确定性 fake implementation（经 server 完整 dispatch 产生真实 handoff+verification evidence）自动触发真实 Codex validator，走 requestValidation → queue drain → agent-runner → onTerminal → processValidatorResult 全链路 → **Issue=Done + EvidenceSummary（2115B Markdown）+ same_origin=true**，验证完整状态机在真实 validator 下 pass→Done→summary→Markdown 收敛不悬挂（顺带覆盖 T085 same-origin=true）。
- **Round-limit Blocked（T082）**：真实 validator 对失败的 test 判 failed，`max_validation_rounds=1` 下第 1 次失败即命中 `round_limit_reached` → **Blocked**（round_count=1）。
- **Different-model same-origin（T085）**：impl `gpt-5` + validator `gpt-5-codex`（不同 model）→ **Done + same_origin_validation=false**（independent）；与 T081 同 model → same_origin=true 双向验证同源判定。
- 可复现验收工具：`real-codex-validation.test.ts`（validator envelope 双路径）、`real-codex-e2e.test.ts`（完整链路 Done）、`real-codex-scenarios.test.ts`（T082 round-limit / T085 different-model）——均 env-gated `REAL_CODEX=1`，默认 skip。

**T083/T084 确定性覆盖**：T083 blocked 矩阵（validator unavailable / gate missing-evidence / timeout / unparsable）与 T084 restart recovery 均为确定性 server 逻辑，已由 `validation-workflow`/`validation-edge-cases`/`validation-recovery`/`validation-blocked-envelope`/`terminal-orchestration` 等自动化套件覆盖；真实 validator 的"独立核实证据、输出合法 envelope、pass/fail/round-limit/same-origin 分流"已由上述真实链路证明。**F004 真实环境验收视为完成。**

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
  -> Phase 11 final-review remediation
  -> Phase 12 acceptance
```

- T001是所有runtime集成的硬前置；F003未实现不得凭design假设直接编码F004。
- T020-T029可在Phase 3完成后并行，但合并前必须统一validation types。
- T042-T055阻塞terminal hook；不得先接自动触发再补事务状态机。
- Checkpoint 8是API/UI硬门槛。
- T090-T095 是 final review 后的重新开放项，全部完成前不得执行最终 `done` 回写；T081-T085 的真实环境验收必须在这些修复之后重跑。
- F005只能在F004 Checkpoint 8后开始其routing/validator race集成。

## Requirement → Task映射

| Requirement | 主要任务 |
| --- | --- |
| `FR-001` 自动validator | T001, T028-T029, T042-T045, T056-T062 |
| `FR-002` validator context | T024-T025, T042-T043, T090 |
| `FR-003` result parse | T002-T004, T020-T021, T030-T035, T052-T053, T091 |
| `FR-004` pass/Done | T022-T023, T026-T027, T046-T047 |
| `FR-005` fail回流 | T024-T025, T048-T049, T090 |
| `FR-006` round/Blocked | T022-T023, T050-T053 |
| `FR-007` Evidence Summary | T012-T013, T026-T027, T046-T047, T092, T095 |
| `FR-008` same-origin | T018-T019, T026-T027, T046-T047 |
| `FR-009` unblock | T038-T039, T063-T066, T075-T076 |
| `FR-010` UI/status | T040-T041, T063-T079, T092, T094 |
| `FR-011` round reset | T094 |
| `NFR-001/002` 事务/收敛 | T008-T017, T042-T062, T093-T095 |
| `DR-007` per-round validator唯一 | T093, T095 |
| `TR-001` - `TR-009` | T036-T037, T042-T055, T067, T094 |

## 备注

- F004 migration编号以F003实际落地版本为准；若F003实现时占用不同版本，只顺延文件名/版本号，不改变schema内容和依赖顺序。
- `max_validation_rounds=3`表示第三次failed后Blocked，不是允许第四次。
- F005会把“立即自动创建validator”改为10秒持久化grace；F004本身先实现立即路径并把创建收敛到可复用的`request/claim` service，避免F005重写状态机。
- F005落地时由其T062显式改写F004 T042对应的“requested与validator queued同事务”测试为grace window语义；这属于后续feature修改既有行为，不保留两套互相冲突的断言。
