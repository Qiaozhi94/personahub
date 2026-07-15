---
feature_ids: [F005]
related_features: [F002, F003, F004]
topics: [multi-adapter, manual-routing, claude-code, opencode, auth, security, v0.1.4]
doc_kind: tasks
created: 2026-07-16
updated: 2026-07-16
---

# F005：Manual Multi-Agent Routing（手动多 Agent 路由）- 任务

> Status: ready-for-development | Owner: TBD | Spec: `spec.md` | Design: `design.md`

## 规则

- F003和F004必须先实现并分别通过terminal/recovery checkpoint；F005复用其trace和validation service，不复制第二套逻辑。
- 先做真实CLI protocol/auth probe，再写adapter argv/normalizer；raw fixture必须redact，禁止提交token、API key、完整用户home或私有绝对路径。
- API key可以按spec明文存DB，但任何API response、event、log、error details、context、fixture都不得出现原值。
- 客户端不能强制`workflow_bound`或role；服务端按Issue状态/capability推导。显式`ad_hoc_consult`只允许安全降级。
- Claude/OpenCode均不得绕过F002 credential isolation；OpenCode不得被描述为具备未验证的前置approval。
- 不实现Coordinator自动推荐、多agent并行、Room、更多provider或OS keychain。
- 每项先补测试再实现；标`[P]`仅表示文件和依赖真正独立。

## Phase 1：Claude Code / OpenCode协议与鉴权Probe

- [ ] **T001**（`FR-001`, `NFR-004`, `AC-001`）：记录本机Claude Code CLI版本、安装路径解析和Windows shell=false启动方式；验证`--version`不足以代表OAuth已登录。
- [ ] **T002**（`FR-001`, `NFR-003`）：验证Claude非交互one-shot、stream JSON、prompt stdin、final message、正常/非零/auth failure/cancel，保存redacted fixtures。
- [ ] **T003**（`FR-008`, `NFR-003`, `AC-006`）：验证Claude `control_request/control_response`真实字段和permission mode；用无远端副作用fixture确认git push请求可在执行前拒绝，不使用bypass模式。
- [ ] **T004**（`FR-005`, `FR-006`）：验证Claude command/tool lifecycle能否映射F003 RunTraceSignal、final message能否满足F004 parser；不能确认的capability明确记录为false。
- [ ] **T005**（`FR-002`, `NFR-004`, `AC-001`）：记录OpenCode CLI版本、OAuth auth status/login、API-key最小调用、provider/model参数和Windows启动方式。
- [ ] **T006**（`FR-002`, `FR-005`）：验证OpenCode one-shot、JSON/structured输出、prompt传递、final message、正常/非零/auth failure/cancel，保存redacted fixtures。
- [ ] **T007**（`FR-002`, `DR-001`）：确定经实测可用的OpenCode API-key provider allowlist和env/临时config映射；验证key不需进入argv或workspace。
- [ ] **T008**（`FR-008`, `NFR-003`, `AC-006`）：确认OpenCode无等价消息级approval通道；验证credential-isolated env下push失败可被稳定识别，记录真实能力说明。
- [ ] **T009**（`NFR-001`, `NFR-004`）：验证三个CLI在不恢复完整HOME/USERPROFILE时所需的最小auth目录变量/路径；若某OAuth路径无法隔离，按design标unavailable而非放宽git凭据环境。
- [ ] **T010**（`AC-001`, `AC-006`）：把所有fixtures加入test helpers并附CLI版本/字段说明；运行secret扫描确保无token/key/private path。

**Checkpoint 1**：三个provider的argv、auth probe、final message、trace、cancel、approval能力均由可重放fixture固定；无法支持的能力已有明确降级。

## Phase 2：Shared Contract与Schema v5

- [ ] **T011**（`DR-001` - `DR-005`）：添加shared类型编译/序列化测试，覆盖CliProvider/AuthType/Capability/RunPurpose、public AdapterConfig、write-only inputs、Run routing fields和provider metadata。
- [ ] **T012**（`DR-001` - `DR-004`）：拆分/扩展shared adapter/run types并re-export；扩展F004 `RunRole`新增非空`consult`、扩展`RunDispatchSource`新增`user_default`，持久化枚举只增不改。
- [ ] **T013**（`IR-001` - `IR-003`）：先补ErrorCode/HTTP映射测试，再新增auth/key/provider/default/purpose/status/conflict错误。
- [ ] **T014**（`DR-001` - `DR-005`, `NFR-001`）：添加v5 migration集成测试，覆盖v4升级、重跑、旧Codex oauth解释、旧Run workflow_bound、非空`role='consult'`可插入且无需重建runs、capability backfill、due/default/index和既有summary不变。
- [ ] **T015**（`DR-001` - `DR-005`）：实现`schema-v5.ts`并注册migration；保留F004 `runs.role NOT NULL`并由shared enum新增`consult`值，版本号若因实际前序迁移变化只顺延编号。
- [ ] **T016**（`DR-005`, `FR-009`）：验证F004 active validator partial unique index在v5仍存在且对manual/system Run同时生效；不得重复创建冲突索引。

**Checkpoint 2**：F004数据无损升级，public/internal secret边界和routing枚举已固定。

## Phase 3：Adapter Repository、Public DTO与Default

- [ ] **T017**（`DR-001`, `NFR-001`）：添加AgentConfigRepository internal record测试，覆盖auth/model/key/capability字段、create/update/clear、非法JSON和key原值只在repository内部可见。
- [ ] **T018**（`DR-001`）：扩展repository输入/映射/查询；不得返回internal record给route。
- [ ] **T019**（`DR-001`, `UX-002`）：添加`toPublicAdapter()`测试，使用高辨识secret验证任何层级JSON均无原值，只返回has_api_key/auth status/is_default。
- [ ] **T020**（`DR-001`, `NFR-001`）：实现显式public DTO builder；禁止spread后删除secret模式。
- [ ] **T021 [P]**（`FR-004`, `AC-002`）：添加ProjectRepository default adapter测试，覆盖set/clear、cross-project、不available、首个available自动default和删除default guard。
- [ ] **T022**（`FR-004`）：扩展Project repository/service的default字段和CAS更新。
- [ ] **T023 [P]**（`DR-002`, `DR-003`）：添加RunRepository purpose/non-null consult role/context source/source测试及workflow/consult列表过滤；拒绝null role。
- [ ] **T024**（`DR-002`, `DR-003`）：扩展Run repository/public mapping，保持F004 validator字段兼容。

**Checkpoint 3**：secret不能越过service DTO边界，Project default和Run routing可持久化审计。

## Phase 4：Adapter配置、Auth Material与Registry

- [ ] **T025**（`FR-001`, `FR-002`, `AC-001`）：添加provider/auth字段矩阵测试：Codex/Claude仅OAuth、OpenCode OAuth/API key、互斥字段、switch清key、required provider/model/key、trim/limits。
- [ ] **T026**（`FR-001`, `FR-002`, `IR-001`）：重构AdapterConfigService使用provider metadata校验并输出public DTO；移除统一`--version`可用性判断。
- [ ] **T027**（`FR-003`）：添加registry/capability测试，覆盖三provider注册/查找、duplicate throw、config provider匹配、auth capability，以及手动routing与自动ValidatorSelector共用`capability_tags`判断。
- [ ] **T028**（`FR-003`）：注册Codex/Claude/OpenCode adapter singleton并扩展registry接口；实现共享`hasCapability()`并把F004 ValidatorSelector从`agent_configs.role`查询切换为`capability_tags contains validator`，旧role仅作迁移/展示兼容。
- [ ] **T029**（`FR-002`, `DR-001`, `NFR-001`）：添加AuthMaterial测试，覆盖API key allowlist/env或temp config、cleanup、异常清理、key不进argv/context/log和unknown provider拒绝。
- [ ] **T030**（`FR-002`）：实现`runtime/auth-material.ts`及provider mapping，严格按Phase 1实测结果。
- [ ] **T031**（`FR-001`, `FR-002`, `NFR-004`）：添加provider-specific child env测试，确保只暴露所需CLI auth目录，继续移除SSH agent/git helper/GH tokens，API-key模式不暴露home auth。
- [ ] **T032**（`FR-008`, `NFR-003`）：重构`buildChildEnv()`接收provider auth descriptor，维持F002 credential isolation测试全部通过。
- [ ] **T033**（`FR-001`, `FR-002`, `UX-002`）：添加真实adapter `validate()`集成测试fixture，确认auth failure更新unavailable/message、version成功不等于已登录、message已redact。
- [ ] **T034**（`FR-001`, `FR-002`）：让AdapterConfigService调用registry adapter.validate，保存last_checked/status/clean message。

**Checkpoint 4**：三provider可配置/验证，OpenCode key只在spawn auth material短路径出现，credential isolation未退化。

## Phase 5：Claude Code Adapter

- [ ] **T035**（`FR-001`, `FR-005`）：使用Phase 1 fixture添加Claude protocol normalizer测试，覆盖output/final/command trace/control request/unknown/malformed/dedupe/limits。
- [ ] **T036**（`FR-001`, `FR-005`）：实现独立`claude-code-normalizer.ts`，raw stream不进入领域层。
- [ ] **T037**（`FR-001`, `NFR-004`）：添加Claude adapter启动/argv/stdin/cwd/env/auth/cancel/exit-once测试，instructions不得在argv。
- [ ] **T038**（`FR-001`）：实现`ClaudeCodeAdapter` one-shot lifecycle和F003/F004 contracts。
- [ ] **T039**（`FR-008`, `NFR-003`, `AC-006`）：添加Claude control request安全测试，git push拒绝->pre-execution escalation，普通请求按P0策略处理，bypass flag永不出现。
- [ ] **T040**（`FR-008`）：接入approval response和AgentRunner escalation；hook缺失时capability降级但credential isolation继续。
- [ ] **T041**（`FR-005`, `FR-006`）：添加Claude implementation/validator Fake CLI集成测试，确认handoff context、structured trace和F004 pass/fail复用。

**Checkpoint 5**：Claude可作为implementation/consult/validator运行，前置approval能力与实际fixture一致。

## Phase 6：OpenCode Adapter

- [ ] **T042**（`FR-002`, `FR-005`）：使用Phase 1 fixture添加OpenCode normalizer测试，覆盖OAuth/API-key共同输出、final/trace/unknown/malformed/limits。
- [ ] **T043**（`FR-002`, `FR-005`）：实现`opencode-normalizer.ts`；不从自由日志伪造confirmed command/test。
- [ ] **T044**（`FR-002`, `NFR-004`）：添加OpenCode argv/stdin/cwd/env/auth material cleanup/cancel/exit-once测试；key不得进argv。
- [ ] **T045**（`FR-002`）：实现`OpenCodeAdapter` one-shot lifecycle和auth material finally cleanup。
- [ ] **T046**（`FR-008`, `NFR-003`, `AC-006`）：添加OpenCode credential isolation测试，push失败->escalation/Blocked，且capability明确`supportsApprovalHook=false`。
- [ ] **T047**（`FR-008`）：接入credential failure normalizer/AgentRunner escalation；不得新增虚假的pre-execution event。
- [ ] **T048**（`FR-005`, `FR-006`）：添加OpenCode implementation/consult/validator测试；若probe不支持可靠final/trace，validator路径必须Blocked而非pass。

**Checkpoint 6**：OpenCode OAuth/API-key均可运行；安全能力展示与真实边界一致。

## Phase 7：Handoff Context与Routing纯逻辑

- [ ] **T049 [P]**（`FR-005`, `FR-006`, `AC-003`, `AC-004`）：添加RunContextBuilder测试；普通implementation/consult使用latest eligible prior handoff，validator严格绑定`implementation_run_id`对应handoff/evidence/files/tests，并覆盖Validating期间更新consult handoff不得串入、findings、first Run、missing refs、Windows path和size limit。
- [ ] **T050**（`FR-005`, `FR-006`）：实现带source policy的统一RunContextBuilder并替换F002手拼context；validator设置`context_source_run_id=implementation_run_id`，其他Run记录实际latest source。
- [ ] **T051 [P]**（`FR-004`, `FR-007`, `AC-002`, `AC-005`）：添加expected-role/purpose classifier矩阵，覆盖Inbox/Ready/Running/Validating/Done/Blocked、multi-capability、forced consult、不能forced workflow和consult role始终非空。
- [ ] **T052**（`FR-004`, `FR-007`）：实现pure routing classifier；Running期望implementation，Validating期望validator，未命中持久化`role=consult`。
- [ ] **T053 [P]**（`FR-003`, `FR-004`, `AC-002`）：添加AdapterResolver/ValidatorSelector测试，覆盖explicit/default、same project、available、missing/default stale、确定性source，以及只有`capability_tags`含validator的config才能被自动选择。
- [ ] **T054**（`FR-003`, `FR-004`）：实现AdapterResolver并同步升级F004 ValidatorSelector；两者复用`hasCapability()`，禁止列表第一项随机fallback或继续以旧role作为能力真相源。

**Checkpoint 7**：路由分类与context无需启动CLI即可完全测试，跨agent不再依赖复制聊天记录。

## Phase 8：Manual Routing Service与状态影响

- [ ] **T055**（`FR-004`, `FR-007`, `DR-002`, `DR-003`）：添加Run创建事务测试，覆盖adapter resolve、purpose/role/source/context source和扩展run.queued payload；断言`workflow_step`随`role`固化（consult→`null`、workflow-bound implementation→`implementation`），与F004 §3派生表一致。
- [ ] **T056**（`FR-004`, `FR-007`, `IR-002`）：实现ManualRoutingService并让RunDispatch使用；route不能传内部role/source。
- [ ] **T057**（`FR-007`, `AC-005`）：添加状态影响测试：Ready/Inbox implementation->Running，Running implementation保持，Validating validator workflow，mismatch consult使用非空consult role且状态/round不变。
- [ ] **T058**（`FR-007`）：收敛RunService状态更新只对workflow-bound implementation生效；consult terminal不调用F004 hook。
- [ ] **T059**（`FR-007`, `FR-008`）：添加consult escalation测试，正常consult不改状态但危险操作仍Blocked并取消eligible queued workflow Runs。
- [ ] **T060**（`FR-008`）：复用F002 escalation service处理所有provider/purpose，event携routing metadata。
- [ ] **T061**（`NFR-002`）：添加三provider/consult/workflow同workspace FIFO测试和不同workspace并行回归；drain重验role/Issue status，取消stale同Issue implementation/validator，Validating consult仍eligible但不得污染validator context，不得引入provider专属queue或跨Issuevalidator优先级。

**Checkpoint 8**：manual routing已贯通DB/queue/runtime，consult与workflow状态边界正确且安全优先。

## Phase 9：Validator Grace、互斥与Recovery

- [ ] **T062**（`FR-006`, `FR-009`, `AC-004`, `AC-007`）：修改F004 request测试，implementation完成后同事务进入Validating/requested/set due，但10秒内不创建auto validator。
- [ ] **T063**（`FR-006`, `FR-009`）：把F004 validator creation拆为可复用`claimValidatorSlot()`；request path设置持久化due。
- [ ] **T064**（`FR-009`, `DR-005`）：添加manual-wins race测试：grace内explicit validator创建、清due、scheduler loser幂等、只有一个Run。
- [ ] **T065**（`FR-009`, `DR-005`）：添加auto-wins race测试：due/default-now先创建，manual loser收到409+active summary、无重复event。
- [ ] **T066**（`FR-006`, `FR-009`）：实现claim transaction和unique conflict映射；应用层检查仅优化信息。
- [ ] **T067**（`US4`, `FR-009`）：添加ValidationDispatchScheduler fake clock测试，覆盖due前不跑、due后跑、多个Issue、shutdown、不重入和default unavailable Blocked。
- [ ] **T068**（`US4`）：实现1秒scheduler和集中10秒常量；spawn在transaction commit后。
- [ ] **T069**（`FR-006`, `AC-004`）：添加manual Claude/OpenCode validator pass/fail集成测试，EvidenceSummary identity/same-origin/source正确，完全复用F004 parser/gate/state。
- [ ] **T070**（`FR-006`）：接通manual validator terminal到F004 ValidationWorkflowService，不新增parser/result route。
- [ ] **T071**（`FR-009`, `NFR-001`）：添加restart recovery测试，覆盖due未到/已到、manual已提交响应丢失、Validating due空无Run inconsistency和terminal validator。
- [ ] **T072**（`FR-009`）：扩展F004 recovery/scheduler startup顺序；listen前reconcile，listen后启动timer。

**Checkpoint 9**：manual/auto两种winner及restart都只有一个validator Run，F004闭环不回归。

## Phase 10：HTTP API与Secret泄漏回归

- [ ] **T073**（`IR-001`, `AC-001`）：添加adapter create/update/list/validate route测试，覆盖三provider/auth、write-only key、switch/clear、masked状态和invalid组合。
- [ ] **T074**（`IR-001`）：扩展adapter routes schema和service调用；任何response不得直接返回repository record。
- [ ] **T075**（`FR-004`, `AC-002`）：添加default adapter PUT route测试，覆盖same-project/available/clear/404/409。
- [ ] **T076**（`FR-004`）：实现default adapter route/api contract。
- [ ] **T077**（`IR-002`, `FR-004`, `FR-007`）：添加Run create route测试，覆盖adapter omitted/default、explicit、purpose auto/consult、拒绝role/workflow/source字段和Done/Blocked。
- [ ] **T078**（`IR-002`）：更新Run route/body schema和response。
- [ ] **T079**（`IR-003`, `UX-003`）：扩展Run list/Issue read测试，确认purpose/role/source/context source可展示。
- [ ] **T080**（`IR-001`, `UX-002`）：添加`GET /api/adapter-providers`测试并实现metadata route，内容来自共享/provider registry常量。
- [ ] **T081**（`DR-001`, `NFR-001`）：运行跨所有API/events/errors/export/context的canary secret扫描集成测试，确保测试API key零泄漏。
- [ ] **T082**（`TR-001` - `TR-003`）：扩展SSE replay测试，routing metadata完整、consult可辨识且无auth material。

## Phase 11：Adapter Settings与Default UI

- [ ] **T083**（`UX-002`, `AC-001`）：先添加apiClient/use-adapters测试，覆盖provider metadata、新fields、key write-only、default mutation和validate errors。
- [ ] **T084**（`UX-002`）：扩展apiClient/hooks query keys和mutations。
- [ ] **T085**（`FR-001`, `FR-002`, `UX-002`）：添加动态Adapter dialog测试，覆盖provider/auth切换、required fields、OAuth instructions、API key configured/replace/clear、capability选择和不回填key。
- [ ] **T086**（`FR-001`, `FR-002`）：重构AdapterSettings provider-specific表单，必要时拆分`AdapterAuthFields`避免350行。
- [ ] **T087**（`UX-002`, `FR-004`）：添加adapter list/default UI测试，覆盖provider/model/capability/auth/status/reason/default badge/set default/delete guard。
- [ ] **T088**（`UX-002`, `FR-004`）：实现adapter cards/default action和honest approval capability note。

## Phase 12：Composer、Thread与Inspector UI

- [ ] **T089**（`UX-001`, `UX-004`, AC-002）：添加AgentSelector组件测试，始终显示、default标记、available/disabled reason、capabilities和当前purpose preview。
- [ ] **T090**（`UX-001`, `UX-004`）：实现独立`AgentSelector.tsx`并替换ThreadView原生条件select；未选时发送omitted adapter_id使用server default。
- [ ] **T091**（`FR-007`, `UX-003`, `AC-005`）：添加composer routing测试，Running implementation/validator consult、Validating validator/mismatch consult、显式consult和终态disabled。
- [ ] **T092**（`FR-007`, `UX-003`）：显示服务端推导预览；实际Run card始终以后端返回metadata为准。
- [ ] **T093**（`FR-009`, `US4`）：添加Validating grace UI测试，倒计时仅提示、Use default now mutation、manual winner/conflict和刷新due状态。
- [ ] **T094**（`FR-009`）：实现grace banner/action，不用前端timer直接创建auto Run。
- [ ] **T095**（`UX-003`, `TR-002`）：添加Thread Run card测试，workflow/consult badge、provider/model/source、context handoff链接和“不改变workflow”文字；覆盖`run.cancelled(reason=issue_state_changed_before_start)`展示明确的“指令因进入验证被取消、请重发”文案，不误示为已执行。
- [ ] **T096**（`UX-003`）：扩展ThreadEvent/Run renderer；unknown provider/purpose安全fallback。
- [ ] **T097**（`IR-003`, `UX-003`）：添加Inspector routing测试，展示latest run metadata、context source、manual validator identity和auth信息不泄漏。
- [ ] **T098**（`IR-003`）：实现Inspector routing section并保留F003/F004 evidence/validation区域。
- [ ] **T099**（`AC-001` - `AC-007`）：扩展App UI flow，跑通配置三adapter、设default、Codex->Claude->OpenCode consult/implementation、manual validator和race conflict。

**Checkpoint 12**：用户能清楚选择/识别实际agent、default、consult和validator，UI不夸大安全能力。

## Phase 13：安全、端到端与文档回写

- [ ] **T100**（`AC-001` - `AC-007`）：运行`npm run typecheck`、`npm test`、`npm run build`，F001-F004所有回归通过。
- [ ] **T101**（`AC-001`, `NFR-004`）：Windows真实配置Claude OAuth、OpenCode OAuth和API key；验证restart后可用状态、key不回显和CLI auth过期提示。
- [ ] **T102**（`AC-002`, `AC-003`, `AC-005`）：真实同Issue依次运行Codex/Claude/OpenCode，核对每轮adapter、handoff/evidence context、consult不改状态和Thread审计。
- [ ] **T103**（`AC-004`, `AC-007`）：真实/fixture验证grace内manual validator和auto default两种winner、pass/fail、same-origin false和无重复Run。
- [ ] **T104**（`AC-006`, `NFR-003`）：三个adapter分别尝试无副作用的git push fixture，核对credential env；Claude前置拒绝、OpenCode隔离失败和诚实UI说明。
- [ ] **T105**（`NFR-001`, `DR-001`）：检查SQLite/runtime temp/HTTP/SSE/export/log/测试报告，不得出现canary API key；确认temp auth material cleanup。
- [ ] **T106**（`NFR-002`, `NFR-004`）：手动验证三provider排队、cancel/timeout、server在grace和Run terminal期间重启。
- [ ] **T107**（`DR-001` - `DR-005`）：更新`docs/personahub-system-design.md`实际Agent/Project/Run/Issue字段和secret边界。
- [ ] **T108**（`FR-001` - `FR-009`, `NFR-003`）：更新`docs/personahub-architecture.md`三个adapter实际capabilities、auth env、routing和scheduler。
- [ ] **T109**（`AC-001` - `AC-007`）：逐项走查并勾选spec acceptance；probe失败的能力必须按design降级且验收语义仍满足，不能用文档替代实现。
- [ ] **T110**：进入review/done时更新`BACKLOG.md`、三件套Status、`CLAUDE.md`，并确认spec/design/tasks的实现状态说明一致。

## 依赖关系

```text
F003 + F004 implemented
  -> Phase 1 real CLI probes
  -> Phase 2 contracts/schema
  -> Phase 3 repositories
  -> Phase 4 config/auth/registry
  -> Phase 5 Claude + Phase 6 OpenCode
  -> Phase 7 context/routing pure logic
  -> Phase 8 dispatch/state
  -> Phase 9 validator grace/race/recovery
  -> Phase 10 API
  -> Phase 11/12 UI
  -> Phase 13 acceptance
```

- T001-T010阻塞对应adapter实现，但不阻塞schema/public DTO和routing纯逻辑。
- Claude Phase 5和OpenCode Phase 6可在共享auth/registry完成后并行。
- T049-T054阻塞ManualRoutingService；不得在route/UI复制分类规则。
- T062-T072只能在F004状态机测试通过后修改，Checkpoint 9是API/UI的硬门槛。
- T081和T105是secret安全硬门槛，失败不得进入review。

## Requirement → Task映射

| Requirement | 主要任务 |
| --- | --- |
| `FR-001` Claude配置/adapter | T001-T004, T025-T040, T073-T074, T083-T088 |
| `FR-002` OpenCode配置/adapter | T005-T009, T025-T034, T042-T048, T073-T088 |
| `FR-003` Registry / capability真相源 | T027-T028, T053-T054 |
| `FR-004` 手动选择/default | T021-T022, T051-T058, T075-T080, T089-T092 |
| `FR-005` Handoff context | T004, T006, T035-T050, T095-T098 |
| `FR-006` 手动validator | T041, T048, T062-T072, T093-T094 |
| `FR-007` consult分类 | T051-T060, T077-T079, T091-T098 |
| `FR-008` escalation | T003, T008-T009, T031-T032, T039-T040, T046-T047, T059-T060, T104 |
| `FR-009` validator互斥 | T016, T062-T072, T093-T094, T103 |
| `DR-001` secret/auth | T007, T011-T020, T025-T034, T073-T074, T081, T105 |
| `NFR-002/003/004` lock/security/Windows | T001-T010, T031-T032, T039-T047, T061, T101-T106 |

## 备注

- spec第14节原有“design.md暂不编写”阶段性说明已在本设计完成时同步修订；后续只需随实现更新状态，不应恢复旧说明。
- 如果本地未安装某CLI，Phase 1不能用猜测替代；可先完成不依赖该provider的任务，但对应adapter checkpoint和最终AC-001/006必须在可用环境验证。
- F005不要求Claude/OpenCode具备完全相同的structured trace强度；差异必须通过capability和trace completeness如实表达，F004 Done gate不能因此放宽。
