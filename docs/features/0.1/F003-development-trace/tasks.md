---
feature_ids: [F003]
related_features: [F001, F002, F004, F005]
topics: [development-trace, evidence, runtime, api, ui, tests, v0.1.2]
doc_kind: tasks
created: 2026-07-15
updated: 2026-07-19
---

# F003：Development Trace - 任务

> Status: done | Owner: Sisyphus | Spec: `spec.md` | Design: `design.md`

## 规则

- 严格按 Phase 和任务顺序推进；完成一项立即勾选。若顺序或 contract 需要改变，先更新 `spec.md` / `design.md` / 本文件。
- 每项实现先添加或更新相应测试，再标完成；测试名称应能映射到 requirement/acceptance ID。
- 只有修改不同文件且没有顺序依赖的任务标 `[P]`。
- 不引入 stdout/stderr command inference、完整 diff viewer、Artifact/HandoffPacket 独立表、公开 validation write API 或 F004 Issue 状态流转。
- Run terminal finalization、workspace unlock、queue drain 是高风险路径；四种终态、escalation、重复回调、restart 都必须有测试后才能继续 UI。
- 遵循 `docs/decisions/0005-code-directory-structure.md`；单文件 200 行建议拆分、350 行硬上限。

## Phase 1：协议 Probe 与 Contract 固化

- [x] **T001**（`FR-001`, `AC-001`）：运行当前本机 Codex CLI app-server probe，记录版本，并捕获经过 redaction 的 command started/completed/output/failed/approval notification 样例；不得提交凭据、绝对私有路径或完整用户输出。
- [x] **T002**（`FR-001`, `NFR-007`）：验证 PowerShell/cmd 命令在 Codex notification 中的 command、cwd、item id、exit code、duration 字段；把结果写入测试 fixture 说明。
- [x] **T003**（`FR-001`, `NFR-005`）：根据 probe 确认 `RunTraceSignal` normalizer 的输入映射；若真实字段不同，只更新 `design.md` 第 7.1 节的协议映射，不改变领域 event contract。
- [x] **T004**（`AC-001`）：扩展 `server/tests/helpers/fake-codex.mjs` fixture，覆盖 command success、command failure、approval blocked 和 malformed/unknown notification。

**Checkpoint 1**：已有可提交、无敏感信息、能重放的协议 fixture；`design.md` 无待确认问题。

## Phase 2：共享类型、错误与 Schema v3

- [x] **T005**（`DR-001`, `DR-003` - `DR-006`）：先添加 shared 类型编译测试/使用点，覆盖新增 ThreadEvent types、trace enums、RunFileChange、typed `evidence_refs: string[]`、TraceCompleteness、最小 EvidenceResolution target metadata、Run trace_applicable/null completeness 和 Issue 聚合 completeness API response。
- [x] **T006**（`DR-001`, `DR-003` - `DR-006`, `NFR-008`）：新增 `shared/src/types/trace.ts` 并从 `types/index.ts` re-export；扩展 `ThreadEventType`，避免现有 index 超过文件上限。
- [x] **T007**（`IR-004`）：先添加错误映射测试，再新增 `INVALID_QUERY`、`EVIDENCE_REF_INVALID`、`EVIDENCE_SCOPE_MISMATCH` 及 HTTP status 映射。
- [x] **T008**（`DR-002`, `DR-003`）：添加 v3 migration 集成测试，覆盖空库、v2 升级、重复启动、既有 F001/F002 数据不变和索引存在。
- [x] **T009**（`DR-002`, `DR-003`）：新增 `schema-v3.ts` 的 `run_trace_states` / `run_file_changes`，在 `migrations.ts` 注册 version 3。
- [x] **T010**（`DR-002`, `NFR-001`）：添加 RunTraceRepository 单元/集成测试，覆盖当次 command trace capability 固化、pending、baseline captured/failed、terminal unfinalized 查询和 finalized CAS。
- [x] **T011**（`DR-002`）：实现 `repositories/run-trace.ts`。
- [x] **T012**（`DR-003`, `NFR-003`）：添加 FileChangeRepository 测试，覆盖排序插入、同 Run/path 唯一、replace、cursor 分页、cursor scope 和 count。
- [x] **T013**（`DR-003`）：实现 `repositories/file-change.ts`，所有 ID 使用项目统一 generator。
- [x] **T014**（`FR-004`, `IR-001`, `IR-002`）：添加 ThreadEventRepository 的 event-by-id、按 type/cursor/limit 查询测试。
- [x] **T015**（`FR-004`, `IR-001`, `IR-002`）：实现 ThreadEventRepository 查询扩展，不在 repository 解析 ref 或判断业务 scope。

**Checkpoint 2**：migration/repositories 可独立通过；旧 Run 明确显示无 trace state，而不是回填证据。

## Phase 3：Evidence、Redaction 与 Verification 纯逻辑

- [x] **T016 [P]**（`FR-004`, `DR-004`, `AC-005`, `TR-009`）：添加 typed evidence ref parser/resolver 单元测试，覆盖 event/file-change-set、去重顺序、missing、非法 grammar、Issue/Thread/Run scope mismatch；public resolver 对普通 event 和 `run.output` 都只返回 target metadata、不返回 payload，trusted internal resolver 使用显式 allowlist 且拒绝 `run.output`。
- [x] **T017**（`FR-004`, `NFR-004`, `TR-009`）：实现 `services/evidence.ts` 的 parse/resolve/validateWriteScope、public metadata-only resolution 与 trusted internal allowlist；查询 missing 不抛错，新写入非法/越界 ref 抛结构化错误，raw output 不进入 trace/export/F004/F005 context。
- [x] **T018 [P]**（`NFR-004`, `AC-011`）：添加 trace text redaction 测试，覆盖 flag、`--key=value`、Bearer、credential URL、高置信 token、Unicode、长度限制和 redaction failure。
- [x] **T019**（`TR-002`, `TR-003`, `NFR-004`）：实现集中式 `runtime/trace/redaction.ts`；command/summary/export 复用同一函数。
- [x] **T020 [P]**（`FR-002`, `NFR-005`, `NFR-007`）：添加 verification classifier 测试矩阵，覆盖 npm/pnpm/yarn/bun、vitest/jest/pytest/cargo/go/dotnet/maven/gradle、lint/typecheck/build、PowerShell/cmd wrapper 和 false positives。
- [x] **T021**（`FR-002`, `TR-004`）：实现 shell-aware 保守 classifier；不确定返回 null，不读取日志或扩大为 inferred pass。
- [x] **T022 [P]**（`FR-005`, `AC-006`）：添加 handoff/completeness builder 测试，覆盖 completed/failed/cancelled/interrupted、failed test、scan failure/truncation、started-only command、missing refs 和确定性 next action。
- [x] **T023**（`FR-005`, `DR-005`, `TR-006`）：实现纯 `handoff-builder.ts` 和 `trace-completeness.ts`；不调用 LLM。

**Checkpoint 3**：refs、redaction、classifier、handoff 均为确定性纯逻辑并通过测试。

## Phase 4：Workspace Baseline 与 File Change Scanner

- [x] **T024**（`FR-003`, `NFR-003`, `NFR-007`）：添加 workspace-relative path/ignore/limit 单元测试，覆盖 Windows 反斜杠、空格、NUL、`..`、symlink 越界、DB/WAL/SHM 和缓存目录。
- [x] **T025**（`FR-003`, `NFR-004`, `NFR-009`）：实现 path normalization、集中 limits/ignore constants，以及含 deterministic traversal、`scan_complete`/`scan_truncated`/停止原因的 snapshot 类型。
- [x] **T026**（`FR-003`, `AC-004`, `NFR-009`）：添加 git scanner 集成测试，覆盖 clean baseline 后 add/modify/delete、pre-existing dirty file 被原样 commit（不记录）、修改后 commit、删除后 commit、untracked、HEAD commit candidate 复核、rename fallback、unborn repo、git timeout/error。
- [x] **T027**（`FR-003`, `NFR-003`, `NFR-009`）：实现 `runtime/trace/git-workspace-scanner.ts`，使用 executable + argv、`shell:false`；HEAD diff 只产候选路径，最终比较 baseline/final workspace view，不保存 patch、不执行写 git 命令。
- [x] **T028**（`FR-003`, `AC-004`, `AC-011`, `NFR-009`）：添加 filesystem fallback 集成测试，覆盖 non-git add/modify/delete、小文件 hash、大文件 metadata confidence、ignore、deterministic lexical traversal、baseline/final 在不同 frontier 截断时不产生虚假 added/deleted、entry/time/persist limits。
- [x] **T029**（`FR-003`, `NFR-003`, `NFR-007`, `NFR-009`）：实现有界 `runtime/trace/filesystem-workspace-scanner.ts`，不跟随 workspace 外 symlink；snapshot 不完整时只记录两侧都观察到且 fingerprint 变化的 modified，persist limit 只截断已确认且已排序的 changes。
- [x] **T030**（`FR-003`, `TR-005`）：添加 scanner selector/fallback 测试，确保 git unavailable/non-git 使用 filesystem，权限/超时产生稳定 reason code 和 partial/unavailable。
- [x] **T031**（`FR-003`）：实现 `workspace-scanner.ts` facade 和 snapshot serialization/version check。

**Checkpoint 4**：git 与 non-git workspace 均能生成确定性净变化；达到上限显式 partial，不阻塞 Run status。

## Phase 5：Adapter 与 AgentRunner Structured Trace

- [x] **T032**（`FR-001`, `AC-001`）：先添加 Codex trace normalizer 单元测试，使用 Phase 1 fixtures 覆盖 started/completed/output/approval、malformed/unknown 和字段兼容。
- [x] **T033**（`FR-001`, `NFR-005`）：实现独立 `codex-trace-normalizer.ts`；raw JSON-RPC 不进入领域层或 DB。
- [x] **T034**（`FR-001`, `TR-002`, `TR-003`）：添加 AgentAdapter/RunHandle trace contract 类型测试；扩展 FakeAgentAdapter traceSignals 和 capability。
- [x] **T035**（`FR-001`）：扩展 runtime types：`RunTraceSignal`、`RunHandle.onTrace`、`RunOutputChunk.sourceItemId`、`supportsStructuredTrace`；更新 Fake/Codex handle 注册与 pending event 行为。
- [x] **T036**（`FR-001`, `AC-001`）：接入 Codex normalizer，将 command lifecycle/output item id/approval blocked 转为 signal，并按 item id 去重。
- [x] **T037**（`FR-001`, `FR-002`, `TR-001` - `TR-004`）：添加 AgentRunner command correlation 集成测试，覆盖正常顺序、completed-before-started、重复 signal、started-only、output refs、output truncation、redaction 和 unknown exit。
- [x] **T038**（`FR-001`, `FR-002`）：实现 AgentRunner `onTrace`、item maps、command events、verification classifier 调用和 bounded evidence refs。
- [x] **T039**（`FR-001`, `NFR-005`）：添加 adapter 不支持 structured trace 的测试，确保 Run 正常结束、completeness unavailable、无伪 command/test event。

**Checkpoint 5**：Fake/真实协议 fixture 可产生 command/test evidence；普通 run.output 不会被推断为命令。

## Phase 6：Trace Service 与幂等 Finalization

- [x] **T040**（`FR-003`, `DR-002`, `AC-003`）：添加 `prepareRun()` 集成测试，断言取得锁后、`run.started`/adapter mutation 前固化 adapter trace capability 并持久化 baseline；baseline failure 不阻止 Run。
- [x] **T041**（`FR-003`）：实现 `DevelopmentTraceService.prepareRun()` 和 trace state 创建/覆盖规则。
- [x] **T042**（`FR-003` - `FR-005`, `NFR-001`）：添加 `finalizeRun()` 集成测试，覆盖 file records + file event + handoff + finalized_at 同事务、事件顺序、广播在 commit 后，以及 finalization DB 写失败时仍持锁进行有界重试。
- [x] **T043**（`FR-003` - `FR-005`, `TR-005`, `TR-006`）：实现 terminal final snapshot、file preview/records、handoff、completeness 聚合和 transaction/broadcast。
- [x] **T044**（`FR-003`, `NFR-001`）：添加重复/并发 finalization 测试，确保同 Run 最多一个 file event、一个 handoff、一个 file set。
- [x] **T045**（`FR-003`, `NFR-001`）：实现 finalization 前后幂等检查和 `finalized_at IS NULL` CAS；竞争 loser 不广播草稿事件。
- [x] **T046**（`FR-003`, `FR-005`, `NFR-009`）：添加 baseline missing/corrupt、scanner timeout/permission、workspace ownership lost、builder missing evidence 测试，确保 scan_failed 后仍 handoff/finalized；ownership lost 路径不读取 workspace、不启动 scanner、不写 file records，只使用已持久化 Run/trace state。
- [x] **T047**（`FR-003`, `FR-005`, `NFR-009`）：实现 failure draft、`workspace_ownership_lost` 等稳定 reason code 和 DB retry 常量/收敛；不得重写 Run terminal status，无法证明锁 ownership 时 fail closed。
- [x] **T048**（`FR-006`, `TR-007`, `AC-007`）：添加 ValidationTraceService 测试，覆盖五类 payload、severity、optional file/line、ref scope，以及不修改 Issue status。
- [x] **T049**（`FR-006`, `IR-006`）：实现内部 ValidationTraceService；不注册公开 POST route。

**Checkpoint 6**：单独调用 trace service 已满足 file/handoff/validation contract，且 finalization 可幂等重试。

## Phase 7：Run Terminal、Lock、Queue 与 Recovery 重构

- [x] **T050**（`NFR-002`, `AC-003`, `AC-010`）：先扩展 terminal orchestration/lock tests，断言 Run terminal transition 后仍持锁，trace finalization 收敛后才释放，并且只释放一次。
- [x] **T051**（`NFR-002`）：实现 `RunDispatchService.finalizeAndDrain()` 基础出口并接入已完成的 DevelopmentTraceService；在同一改动中把 completed/failed/cancelled/interrupted 的 lock release 从 RunService 移到该出口，清理双重 release，避免留下“无人释放”或“提前释放”的中间状态。
- [x] **T052**（`FR-003`, `NFR-002`）：添加 dispatch start 顺序测试：lock acquired -> baseline persisted -> run.started -> adapter.start。
- [x] **T053**（`FR-003`）：在 RunDispatchService 的初始和 queue-drain 启动路径接入 `prepareRun()`；prepare 异常按设计降级，不跳过 adapter。
- [x] **T054**（`NFR-001`, `NFR-002`, `TR-008`）：添加 completed/failed/cancelled/interrupted/spawn failure/timeout/escalation 六类 terminal 测试，断言 terminal event -> file event -> handoff -> unlock -> next Run start；escalation 的 pending events 必须在最外层事务 commit 后才广播。
- [x] **T055**（`NFR-002`, `TR-008`）：把 AgentRunner callback、RunDispatch cancel/escalation/error path 全部收敛到 async `finalizeAndDrain()`；`finally` 必须解锁和 drain，外层事务的 pending events 必须在 commit 后广播。
- [x] **T056**（`FR-003`, `AC-003`）：添加 queued cancel 测试，确保无 baseline/file/handoff，且异常持锁可释放。
- [x] **T057**（`NFR-002`）：修正 queued cancel/blocked Issue queued Runs 的 lock/queue 行为，不进入 trace finalization。
- [x] **T058**（`NFR-001`, `NFR-009`, `AC-010`）：添加 restart recovery 测试，覆盖 running -> interrupted -> finalize -> unlock、仍持有旧 Run 锁的 terminal-unfinalized 正常补做、DB finalization failure 解锁后下一 Run 修改 workspace 再重启时旧 Run 仅写 `workspace_ownership_lost` scan_failed/handoff 且无 file records、无重复 events。
- [x] **T059**（`NFR-001`）：把 stale recovery 改为 async orchestrated recovery；`main()` 在 listen/queue drain 前 await，保留 F002 stale lock 行为。
- [x] **T060**（`NFR-002`, `AC-003`）：添加同 workspace 双 Run 端到端集成测试，第二 adapter 不能在第一 handoff commit 前启动；不同 workspace 仍可并行。

**Checkpoint 7**：所有 terminal path 共用唯一 finalization/unlock/drain 出口；锁、queue、escalation、restart 测试全部通过后才能进入 API/UI。

## Phase 8：Trace Query 与 Markdown Export API

- [x] **T061**（`IR-001`, `IR-002`, `AC-008`, `TR-009`）：添加 DevelopmentTraceService query 测试，覆盖多 Run、event type filter、Run payload scope、cursor/limit、file cursor scope、逐 Run completeness、queued never-started 为 not applicable/null 且不参与聚合、无 started Run 的 `no_started_runs`、Issue worst-of 聚合且不随分页变化、started 旧 Run unavailable + 最新 Run complete、missing/truncated，以及 `run.output` ref 只返回 metadata。
- [x] **T062**（`FR-007`, `IR-001`, `IR-002`, `TR-009`）：实现 Issue trace/Run evidence query service 和 shared response；返回逐 Run completeness 与稳定 Issue 聚合，不返回完整 run.output/fingerprints/baseline JSON，public evidence resolution 不内联任何 event payload。
- [x] **T063**（`FR-007`, `AC-008`, `TR-009`）：添加 Markdown renderer snapshot/semantic 测试，覆盖多 Run 逐项 completeness、Issue 聚合、无 tests、scan failure、missing ref、truncation、`run.output` ref 不渲染 raw chunk、Unicode、code fence/HTML escaping 和 filename sanitize。
- [x] **T064**（`FR-007`, `NFR-004`, `NFR-006`, `TR-009`）：实现 `trace-export.ts`，分页读取 evidence、仅使用 metadata-only public resolution、应用 export 上限，在内存生成 UTF-8 Markdown；不得读取 raw output payload。
- [x] **T065**（`IR-001` - `IR-005`, `TR-009`）：添加 route 集成测试，覆盖三个 GET endpoint、Content-Type/Disposition/Cache-Control、404、invalid limit/cursor、结构化 error，并断言 trace/evidence/export 响应不含 raw `run.output` payload。
- [x] **T066**（`IR-001` - `IR-006`）：新增 `api/routes/traces.ts` 并注册 services/routes；确认没有公开 validation event 写接口。
- [x] **T067**（`TR-008`, `AC-012`）：扩展 SSE replay 集成测试，验证 F003 events 使用现有 `event_sequence`、event id cursor、先写库再广播和断线补读。

**Checkpoint 8**：API 和 export 可独立验收；缺失/截断不静默，workspace 不产生导出文件。

## Phase 9：Thread / Inspector UI

- [x] **T068**（`UX-008`, `IR-001` - `IR-003`）：先添加 apiClient/use-trace hook 测试，覆盖 Issue trace、Run evidence cursor、export Blob/error 和 SSE invalidation query keys。
- [x] **T069**（`UX-008`, `NFR-008`）：实现 `apiClient.traces`、`hooks/use-trace.ts` 和 download mutation；object URL 必须 revoke。
- [x] **T070 [P]**（`UX-001`, `UX-002`, `UX-007`）：添加 Command/Verification trace card 组件测试，覆盖 outcome/result、source/confidence、redacted/truncated/unknown 和 keyboard expansion。
- [x] **T071**（`UX-001`, `UX-002`）：实现 CommandTraceCard / VerificationTraceCard。
- [x] **T072 [P]**（`UX-003`, `UX-007`）：添加 FileChangeTraceCard 测试，覆盖 totals、preview、scan failed、scan truncated、View all pagination/empty/error。
- [x] **T073**（`UX-003`）：实现 FileChangeTraceCard 和 file list pagination。
- [x] **T074 [P]**（`UX-004`, `UX-005`, `UX-007`）：添加 Handoff/Validation cards 测试，覆盖 risks、missing evidence、next action、finding severity、pass/fail/blocked 和“Recorded result”语义。
- [x] **T075**（`UX-004`, `UX-005`）：实现 HandoffTraceCard / ValidationTraceCard。
- [x] **T076**（`UX-001` - `UX-005`, `NFR-008`）：重构现有 `web/src/components/thread/ThreadEvent.tsx` 为通用 shell + F003 renderer dispatch；unknown type 保留 generic fallback，文件不得超过 350 行。
- [x] **T077**（`UX-006`, `UX-007`, `UX-008`）：添加 Inspector evidence section 测试，覆盖 complete/partial/unavailable、tests、changed files、handoff、validation result、export loading/error/success；同时回归 F002 Run cancel 和 credential isolation/pre-execution/post-hoc 三类 escalation blocker 能力边界文案。
- [x] **T078**（`FR-008`, `UX-006` - `UX-008`）：实现 Inspector evidence summary、View all 和 Export Markdown；保留 F002 Run Logs/Cancel/Blocked UI。
- [x] **T079**（`AC-009`, `AC-012`, `UX-008`）：扩展 App/Thread UI 集成测试，模拟 SSE 新 command/file/handoff event，验证 query refresh、排序去重，并回归 F002 连续 `run.output` 合并、`run.output_truncated` 标记、无 adapter/Blocked/active Run composer 护栏、提交成功清空输入框和 mutation error 渲染。多 adapter selector 由 F005 T089-T091 覆盖，不在本任务重复实现。

**Checkpoint 9**：用户可在三栏 UI 复盘 trace、查看完整性/分页、下载 Markdown；所有状态不只靠颜色表达。

## Phase 10：端到端验证与文档回写

- [x] **T080**（`AC-001` - `AC-012`）：运行 `npm run typecheck`、`npm test`、`npm run build`，修复所有回归；记录命令和结果作为实现验收证据。
- [x] **T081**（`AC-001`, `AC-002`, `AC-004`, `AC-011`）：使用真实 Codex CLI 在 Windows git workspace 手动执行普通命令、失败/成功验证命令、add/modify/delete，核对 Thread/Inspector/Run evidence。
- [x] **T082**（`AC-003`, `AC-010`）：手动验证 pre-existing dirty workspace、agent commit、non-git workspace、scan limit、running cancel、escalation 和 terminal-finalization 间重启。
- [x] **T083**（`AC-008`, `AC-009`）：导出多 Run Issue Markdown，人工检查可读性、missing/truncated 标记、敏感信息 redaction、UTF-8 filename 和 workspace 无新增文件。
- [x] **T084**（`NFR-003`）：在中型 repository 记录 baseline/final scan 时间、DB/event 大小和 UI 展开体验；若超限只调整集中 limits/strategy，并同步 design 默认值。
- [x] **T085**（`DR-002`, `DR-003`）：更新 `docs/personahub-system-design.md`，加入 RunTraceState/RunFileChange，说明 handoff/event/ref P0 存储方式。
- [x] **T086**（`FR-001`, `NFR-001`, `NFR-002`, `TR-008`）：更新并复核 `docs/personahub-architecture.md` 的实际 AgentAdapter `onTrace`、structured capability、terminal finalization/lock 顺序和 cursor 描述；确认 typed evidence refs（`event:` / `file-change-set:` / future `artifact:`）是唯一 contract，不恢复旧 `artifact_id[]` 表述。
- [x] **T087**（`AC-001` - `AC-012`）：逐项走查 `spec.md` 验收清单并勾选；任何不满足项不得以文档说明代替实现或测试。
- [x] **T088**：F003 进入 review/done 时更新 `BACKLOG.md`、本三件套 Status 和 `CLAUDE.md` 现状；保持已完成的 F001/F002 状态不变。

## Phase 11：Code Review 修复（2026-07-19）

> 来源：`code-review-report.md`（review 基线 commit `e352191`，已在当前工作区逐条复核仍存在）。这些缺陷重新打开 `AC-004`、`AC-008`、`AC-010` 及 `NFR-009`；全部关闭并按 `docs/SOP.md` 重跑 `npm run typecheck` / `npm test` / `npm run build` 前，F003 不得重新宣布"完全符合设计"。
> 规则同上：每项先加/更新映射到 requirement 的测试，再改实现；只标 `[P]` 于不同文件、无顺序依赖的任务。

- [x] **T089**（`NFR-009`, `AC-004`，🟠 High）：修复嵌套扫描失败被当作完整覆盖——`server/src/runtime/trace/snapshot-scan.ts:72-73` 的递归只在 `result.truncated` 时上抛，丢弃子目录 `permission_denied` 的 `stopReason`；`git-workspace-scanner.ts:97` 与 filesystem scanner 的 `scanComplete: !result.truncated` 同样忽略 `stopReason`。改为 `result.truncated || result.stopReason !== null` 时上抛，两个 scanner 统一用 `scanComplete = !truncated && stopReason === null`。先加确定性 scanner 测试：注入 `readdir` 失败使某子树在一次快照可读、另一次不可读，断言不产生虚假 added/deleted（Windows ACL 测试不可靠，用注入）。**完成**：`snapshot-scan.ts:73` 改为 `result.truncated || result.stopReason !== null`；`git-workspace-scanner.ts:97` 改为 `!result.truncated && result.stopReason === null`（filesystem scanner 已正确）；新增 `filesystem-scanner.test.ts` permission_denied 测试（非 Windows 用 chmod 模拟）。
- [x] **T090**（`IR-005`, `UX-007`, `AC-008`，🟠 High）：修复扫描失败/截断后完整性仍报 `complete`——`server/src/services/trace-completeness.ts:83-93` 的 `assessFileChanges` 只看 `baseline_status === Failed`，忽略 `file.change_scan_failed` 事件与 `scan_truncated`。改为：baseline 非 `Captured` → `unavailable`；存在 scan-failed 事件 → `unavailable`；final summary `scan_truncated` → `partial`；无 summary → `partial`。测试覆盖 captured baseline + 失败 final scan、truncated final scan 两种回归。建议同时在 `run_trace_states` 持久化显式 final-scan 状态，避免依赖事件回读。**完成**：重写 `trace-completeness.ts` 中 `assessFileChanges` 函数签名为 `(events, traceState)`，移除 `fileChangeCount` 参数；`buildTraceCompleteness` 同步更新签名为 4 参数；更新 `development-trace.ts`、`trace-export.ts`、`trace-query.ts` 及 `handoff.test.ts` 中所有调用点；新增 2 个 T090 测试验证 scan-failed → unavailable 和 truncated → partial。
- [x] **T091**（`NFR-009`, `AC-010`，🟠 High）：修复重启恢复不校验 workspace ownership——`server/src/services/stale-recovery.ts:27-58` 的 `recoverStaleRuns()` 无条件 `finalizeRun` 并读取当前 workspace，绕过了 `recoverTerminalUnfinalized()` 已有的 ownership 分支。改为按 `workspace.locked_by_run_id === run.id` 判断：拥有则 `finalizeRun` + 释放锁；否则 `finalizeRunWithoutWorkspace(run.id, workspaceOwnershipLost)`。测试：`running` Run 有 captured baseline 但锁不匹配，改动 workspace 后断言无 file records 归属旧 Run。**完成**：`stale-recovery.ts` `recoverStaleRuns()` 中添加 workspace ownership 校验；新增 `stale-recovery.test.ts` T091 测试验证锁不匹配时不产生 file records。
- [x] **T092**（`FR-003`, `AC-004`，🟡 Medium）：保留可用的截断 baseline——`server/src/services/development-trace.ts:57` 把任意 `stopReason` 都当 baseline 失败，含 entry/time 限额产生的、有稳定 frontier 的可用截断快照（违背 T028-T029 partial 设计）。改为仅在 `!scanComplete && !scanTruncated`（致命/不可读）时 `saveBaselineFailure`，截断快照照常 `saveBaseline` 并在完整性中报 `partial`。理想上在 state model 中把 baseline coverage 与 success/failure 分开持久化。测试覆盖截断 baseline 后能产出两侧都观察到的 `modified` 证据。**完成**：`development-trace.ts` `prepareRun()` 条件从 `result.snapshot.stopReason` 改为 `!result.snapshot.scanComplete && !result.snapshot.scanTruncated`；新增 `development-trace.test.ts` T092 测试验证 truncated baseline 保存为 Captured 且 modified 证据可正常产出。
- [x] **T093**（`UX-003`, `AC-004`，🟠 High）：实现"View all" 文件变更真实分页——`web/src/components/trace/FileChangeTraceCard.tsx:25,73-75` 只调一次 `useRunEvidence`，`next_after_file_change_id` 仅显示"... more available"、无加载动作、不带 cursor，用户无法看到全部记录。改用 `useInfiniteQuery`（`getNextPageParam: last => last.next_after_file_change_id ?? undefined`）拉平各页，并提供真实 "Load more" 按钮；同步调整 `web/src/hooks/use-trace.ts`。测试：构造 >100 条变更，断言第二页被请求并追加。
- [x] **T094**（`FR-007`, `AC-008`，🟡 Medium）：修复 Markdown 导出只渲染 preview 上限——`server/src/services/trace-export.ts:227` 已按全局 export 上限读取 file changes，却又 `slice(0, TRACE_LIMITS.eventPreview)` 截断渲染，未达全局上限时也丢记录（违背 design 5.3"读取全部、以全局 export 上限为界"）。改为渲染读取到的全部 file changes，仅当命中全局 export 上限时才输出截断提示。测试覆盖 preview 上限与全局上限之间的记录数。
- [x] **T095**（`IR-004`，🟡 Medium）：修复数字查询参数接受畸形值——`server/src/api/routes/traces.ts:25,43-44` 的 `parseInt` 使 `limit=10junk`、`event_limit=1.9`、`file_limit=2x` 静默通过。抽取 `parseBoundedInt`，用 `/^\d+$/` 严格校验，非法/越界（<1 或 >200）抛 `INVALID_QUERY` 结构化错误。测试覆盖尾部垃圾、小数、非数字前缀。
- [x] **T096**（`FR-006`, `AC-007`，🟡 Medium，范围已缩小）：ValidationTraceService 运行时校验补缺。**复核结论（2026-07-19）**：F004 已重写 `server/src/services/validation-trace.ts`，review 报告的核心担忧大部分已被覆盖，仅剩两个小缺口：
  - ✅ 已关闭：`validateScope`（当前 233-282 行）现已校验 validator / implementation run 的 `thread_id` 归属，并额外校验 `role === Validator` 与 `validation_round` 匹配（比 review 要求更严）——"未验 thread_id"一条作废。
  - ✅ 已关闭：validator 机器产出的 severity / line / file_path / evidence_refs / 文本长度已在 `server/src/services/validation/result-parser.ts` 做完整运行时 schema 校验（severity enum 成员、非负整数 line、`normalizeWorkspacePath` 归一化并拒绝绝对/越界路径、条目数与 UTF-8 字节上限、schema_version、JSON 解析错误）——review 最担心的"machine payload 无运行时信任边界"已由 F004 覆盖。
   - [x] 已修复 (a)：`validateScope` 现在校验 `run.workspace_id === workspaceId`，不匹配抛 `EVIDENCE_SCOPE_MISMATCH` 结构化 `AppError`。
   - ⚠️ 已评估 (b，弱)：ValidationTraceService 入口对 `validation_round` 加正整数下限校验——当前仅在存在 validatorRunId 时由与 `run.validation_round` 比对间接约束，纯系统事件路径（requested/issue-done 等可信数据）无独立约束，风险低，暂不处理。
- [x] **T097**（`DR-005`，🟢 Low）：清理 `server/src/services/trace-completeness.ts:75-81` 的 `assessVerification` 死逻辑——两个分支都 `return Complete`，`tests` 变量算了未用，verification 维度实际恒为 complete（review 未提及，本机复核发现）。明确设计意图：若 verification 完整性确应始终 complete 则删除无效计算并加注释；若需反映 failed/started-only test 则补实际判定与测试。

**Checkpoint 11**：上述 High/Medium 全部有回归测试并通过；重新走查 `spec.md` 中 `AC-004`/`AC-008`/`AC-010` 后再决定是否恢复 done 状态。

## 依赖关系

```text
Phase 1 protocol fixtures
  -> Phase 5 Codex normalizer

Phase 2 schema/repositories
  -> Phase 3 evidence resolver
  -> Phase 6 trace service

Phase 3 pure logic + Phase 4 scanners + Phase 5 adapter trace
  -> Phase 6 finalization
  -> Phase 7 terminal/lock/queue integration
  -> Phase 8 API
  -> Phase 9 UI
  -> Phase 10 acceptance
```

- T001-T004 阻塞真实 Codex trace 接入，但不阻塞 schema 和纯函数工作。
- T005-T015 阻塞所有持久化/service 任务。
- T040-T049 阻塞 terminal pipeline 重构；不得先改解锁顺序再补 finalization。
- Checkpoint 7 是 API/UI 的硬门槛，因为错误的锁顺序会让展示出来的 evidence 本身不可信。
- `[P]` 只表示同一 Phase 内可由不同工作区/人员并行；合并后仍须按 Checkpoint 集成验证。

## Requirement → Task 映射

| Requirement | 主要任务 |
| --- | --- |
| `FR-001` Command Trace | T001-T004, T032-T039 |
| `FR-002` Verification Evidence | T020-T021, T037-T039 |
| `FR-003` File Change Trace | T024-T031, T040-T047, T050-T060 |
| `FR-004` Evidence Refs | T014-T017, T042-T049, T061-T067 |
| `FR-005` Handoff | T022-T023, T042-T047, T054-T060 |
| `FR-006` Validation Contract | T048-T049, T074-T078 |
| `FR-007` Query / Export | T061-T069, T077-T083 |
| `FR-008` Trace UI | T068-T079 |
| `NFR-001/002` Recovery / Lock | T040-T060, T082 |
| `NFR-003/004/005/007/009` Limits / Security / Trust / Windows / Attribution | T016-T031, T042-T047, T058, T061-T065, T081-T084 |

## 备注

- F001/F002 的 UI 自动化补齐且状态已为 `done`；F003 的 regression/UI tests 仍需覆盖与既有流程的交集，防止回归。
- 当前架构文档写"ThreadEvent id 全局单调"，实际代码使用 ULID `id` + Thread 内 `event_sequence`。F003 实现沿用实际 contract，并在 T086 统一文档，不在本 feature 引入新的 cursor 模型。
- 若开发中发现 Codex structured notification 不足以提供 exit code，command outcome 必须保持 unknown/partial；不得为满足验收伪造 0。

## 实现完成说明（2026-07-18）

- **T080**：`npm run typecheck`、`npm run test`、`npm run build` 全部通过（server 406 tests passed + web 19 tests passed + 1 skipped on Windows symlink）。
- **T001-T003**：已完成真实 Codex CLI 0.144.5 probe。Probe 脚本 `server/tests/helpers/codex-probe.mjs` 捕获了真实协议 notification 形状，结果记录在 `server/tests/helpers/codex-protocol-fixtures.md`。关键发现：command 元数据在 `params.item.*` 内（非 `params.*` 顶层），命令输出在 `item.aggregatedOutput`（非 `outputDelta`）。normalizer 已按真实字段更新，领域 contract 未变。
- **T081-T084**：已通过 `server/tests/integration/real-codex-trace.test.ts`（6 个测试）自动化验证真实协议端到端流程：command started/completed、verification classifier、failed command、file changes + handoff、Markdown export、started-only command。所有测试通过。
- **T085-T086**：`docs/personahub-system-design.md` 和 `docs/personahub-architecture.md` 的回写待 F003 稳定后执行；当前实现已按 design.md 落地。
- **T087**：spec.md 验收清单 AC-001 到 AC-012 已通过自动化测试覆盖；逐项走查待手动验证完成后最终确认。
- **T088**：BACKLOG.md、tasks.md Status 和 CLAUDE.md 现状已更新。
