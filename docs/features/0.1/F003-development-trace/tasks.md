---
feature_ids: [F003]
related_features: [F001, F002, F004, F005]
topics: [development-trace, evidence, runtime, api, ui, tests, v0.1.2]
doc_kind: tasks
created: 2026-07-15
updated: 2026-07-15
---

# F003：Development Trace - 任务

> Status: ready-for-development | Owner: TBD | Spec: `spec.md` | Design: `design.md`

## 规则

- 严格按 Phase 和任务顺序推进；完成一项立即勾选。若顺序或 contract 需要改变，先更新 `spec.md` / `design.md` / 本文件。
- 每项实现先添加或更新相应测试，再标完成；测试名称应能映射到 requirement/acceptance ID。
- 只有修改不同文件且没有顺序依赖的任务标 `[P]`。
- 不引入 stdout/stderr command inference、完整 diff viewer、Artifact/HandoffPacket 独立表、公开 validation write API 或 F004 Issue 状态流转。
- Run terminal finalization、workspace unlock、queue drain 是高风险路径；四种终态、escalation、重复回调、restart 都必须有测试后才能继续 UI。
- 遵循 `docs/decisions/0005-code-directory-structure.md`；单文件 200 行建议拆分、350 行硬上限。

## Phase 1：协议 Probe 与 Contract 固化

- [ ] **T001**（`FR-001`, `AC-001`）：运行当前本机 Codex CLI app-server probe，记录版本，并捕获经过 redaction 的 command started/completed/output/failed/approval notification 样例；不得提交凭据、绝对私有路径或完整用户输出。
- [ ] **T002**（`FR-001`, `NFR-007`）：验证 PowerShell/cmd 命令在 Codex notification 中的 command、cwd、item id、exit code、duration 字段；把结果写入测试 fixture 说明。
- [ ] **T003**（`FR-001`, `NFR-005`）：根据 probe 确认 `RunTraceSignal` normalizer 的输入映射；若真实字段不同，只更新 `design.md` 第 7.1 节的协议映射，不改变领域 event contract。
- [ ] **T004**（`AC-001`）：扩展 `server/tests/helpers/fake-codex.mjs` fixture，覆盖 command success、command failure、approval blocked 和 malformed/unknown notification。

**Checkpoint 1**：已有可提交、无敏感信息、能重放的协议 fixture；`design.md` 无待确认问题。

## Phase 2：共享类型、错误与 Schema v3

- [ ] **T005**（`DR-001`, `DR-003` - `DR-006`）：先添加 shared 类型编译测试/使用点，覆盖新增 ThreadEvent types、trace enums、RunFileChange、TraceCompleteness 和 API response。
- [ ] **T006**（`DR-001`, `DR-003` - `DR-006`, `NFR-008`）：新增 `shared/src/types/trace.ts` 并从 `types/index.ts` re-export；扩展 `ThreadEventType`，避免现有 index 超过文件上限。
- [ ] **T007**（`IR-004`）：先添加错误映射测试，再新增 `INVALID_QUERY`、`EVIDENCE_REF_INVALID`、`EVIDENCE_SCOPE_MISMATCH` 及 HTTP status 映射。
- [ ] **T008**（`DR-002`, `DR-003`）：添加 v3 migration 集成测试，覆盖空库、v2 升级、重复启动、既有 F001/F002 数据不变和索引存在。
- [ ] **T009**（`DR-002`, `DR-003`）：新增 `schema-v3.ts` 的 `run_trace_states` / `run_file_changes`，在 `migrations.ts` 注册 version 3。
- [ ] **T010**（`DR-002`, `NFR-001`）：添加 RunTraceRepository 单元/集成测试，覆盖当次 command trace capability 固化、pending、baseline captured/failed、terminal unfinalized 查询和 finalized CAS。
- [ ] **T011**（`DR-002`）：实现 `repositories/run-trace.ts`。
- [ ] **T012**（`DR-003`, `NFR-003`）：添加 FileChangeRepository 测试，覆盖排序插入、同 Run/path 唯一、replace、cursor 分页、cursor scope 和 count。
- [ ] **T013**（`DR-003`）：实现 `repositories/file-change.ts`，所有 ID 使用项目统一 generator。
- [ ] **T014**（`FR-004`, `IR-001`, `IR-002`）：添加 ThreadEventRepository 的 event-by-id、按 type/cursor/limit 查询测试。
- [ ] **T015**（`FR-004`, `IR-001`, `IR-002`）：实现 ThreadEventRepository 查询扩展，不在 repository 解析 ref 或判断业务 scope。

**Checkpoint 2**：migration/repositories 可独立通过；旧 Run 明确显示无 trace state，而不是回填证据。

## Phase 3：Evidence、Redaction 与 Verification 纯逻辑

- [ ] **T016 [P]**（`FR-004`, `AC-005`）：添加 typed evidence ref parser/resolver 单元测试，覆盖 event/file-change-set、去重顺序、missing、非法 grammar、Issue/Thread/Run scope mismatch。
- [ ] **T017**（`FR-004`, `NFR-004`）：实现 `services/evidence.ts` 的 parse/resolve/validateWriteScope；查询 missing 不抛错，新写入非法/越界 ref 抛结构化错误。
- [ ] **T018 [P]**（`NFR-004`, `AC-011`）：添加 trace text redaction 测试，覆盖 flag、`--key=value`、Bearer、credential URL、高置信 token、Unicode、长度限制和 redaction failure。
- [ ] **T019**（`TR-002`, `TR-003`, `NFR-004`）：实现集中式 `runtime/trace/redaction.ts`；command/summary/export 复用同一函数。
- [ ] **T020 [P]**（`FR-002`, `NFR-005`, `NFR-007`）：添加 verification classifier 测试矩阵，覆盖 npm/pnpm/yarn/bun、vitest/jest/pytest/cargo/go/dotnet/maven/gradle、lint/typecheck/build、PowerShell/cmd wrapper 和 false positives。
- [ ] **T021**（`FR-002`, `TR-004`）：实现 shell-aware 保守 classifier；不确定返回 null，不读取日志或扩大为 inferred pass。
- [ ] **T022 [P]**（`FR-005`, `AC-006`）：添加 handoff/completeness builder 测试，覆盖 completed/failed/cancelled/interrupted、failed test、scan failure/truncation、started-only command、missing refs 和确定性 next action。
- [ ] **T023**（`FR-005`, `DR-005`, `TR-006`）：实现纯 `handoff-builder.ts` 和 `trace-completeness.ts`；不调用 LLM。

**Checkpoint 3**：refs、redaction、classifier、handoff 均为确定性纯逻辑并通过测试。

## Phase 4：Workspace Baseline 与 File Change Scanner

- [ ] **T024**（`FR-003`, `NFR-003`, `NFR-007`）：添加 workspace-relative path/ignore/limit 单元测试，覆盖 Windows 反斜杠、空格、NUL、`..`、symlink 越界、DB/WAL/SHM 和缓存目录。
- [ ] **T025**（`FR-003`, `NFR-004`）：实现 path normalization、集中 limits/ignore constants 和 snapshot 类型。
- [ ] **T026**（`FR-003`, `AC-004`）：添加 git scanner 集成测试，覆盖 clean baseline 后 add/modify/delete、pre-existing dirty file 再修改、untracked、HEAD commit change、rename fallback、unborn repo、git timeout/error。
- [ ] **T027**（`FR-003`, `NFR-003`）：实现 `runtime/trace/git-workspace-scanner.ts`，使用 executable + argv、`shell:false`，不保存 patch、不执行写 git 命令。
- [ ] **T028**（`FR-003`, `AC-004`, `AC-011`）：添加 filesystem fallback 集成测试，覆盖 non-git add/modify/delete、小文件 hash、大文件 metadata confidence、ignore、entry/time/persist limits。
- [ ] **T029**（`FR-003`, `NFR-003`, `NFR-007`）：实现有界 `runtime/trace/filesystem-workspace-scanner.ts`，不跟随 workspace 外 symlink。
- [ ] **T030**（`FR-003`, `TR-005`）：添加 scanner selector/fallback 测试，确保 git unavailable/non-git 使用 filesystem，权限/超时产生稳定 reason code 和 partial/unavailable。
- [ ] **T031**（`FR-003`）：实现 `workspace-scanner.ts` facade 和 snapshot serialization/version check。

**Checkpoint 4**：git 与 non-git workspace 均能生成确定性净变化；达到上限显式 partial，不阻塞 Run status。

## Phase 5：Adapter 与 AgentRunner Structured Trace

- [ ] **T032**（`FR-001`, `AC-001`）：先添加 Codex trace normalizer 单元测试，使用 Phase 1 fixtures 覆盖 started/completed/output/approval、malformed/unknown 和字段兼容。
- [ ] **T033**（`FR-001`, `NFR-005`）：实现独立 `codex-trace-normalizer.ts`；raw JSON-RPC 不进入领域层或 DB。
- [ ] **T034**（`FR-001`, `TR-002`, `TR-003`）：添加 AgentAdapter/RunHandle trace contract 类型测试；扩展 FakeAgentAdapter traceSignals 和 capability。
- [ ] **T035**（`FR-001`）：扩展 runtime types：`RunTraceSignal`、`RunHandle.onTrace`、`RunOutputChunk.sourceItemId`、`supportsStructuredTrace`；更新 Fake/Codex handle 注册与 pending event 行为。
- [ ] **T036**（`FR-001`, `AC-001`）：接入 Codex normalizer，将 command lifecycle/output item id/approval blocked 转为 signal，并按 item id 去重。
- [ ] **T037**（`FR-001`, `FR-002`, `TR-001` - `TR-004`）：添加 AgentRunner command correlation 集成测试，覆盖正常顺序、completed-before-started、重复 signal、started-only、output refs、output truncation、redaction 和 unknown exit。
- [ ] **T038**（`FR-001`, `FR-002`）：实现 AgentRunner `onTrace`、item maps、command events、verification classifier 调用和 bounded evidence refs。
- [ ] **T039**（`FR-001`, `NFR-005`）：添加 adapter 不支持 structured trace 的测试，确保 Run 正常结束、completeness unavailable、无伪 command/test event。

**Checkpoint 5**：Fake/真实协议 fixture 可产生 command/test evidence；普通 run.output 不会被推断为命令。

## Phase 6：Trace Service 与幂等 Finalization

- [ ] **T040**（`FR-003`, `DR-002`, `AC-003`）：添加 `prepareRun()` 集成测试，断言取得锁后、`run.started`/adapter mutation 前固化 adapter trace capability 并持久化 baseline；baseline failure 不阻止 Run。
- [ ] **T041**（`FR-003`）：实现 `DevelopmentTraceService.prepareRun()` 和 trace state 创建/覆盖规则。
- [ ] **T042**（`FR-003` - `FR-005`, `NFR-001`）：添加 `finalizeRun()` 集成测试，覆盖 file records + file event + handoff + finalized_at 同事务、事件顺序和广播在 commit 后。
- [ ] **T043**（`FR-003` - `FR-005`, `TR-005`, `TR-006`）：实现 terminal final snapshot、file preview/records、handoff、completeness 聚合和 transaction/broadcast。
- [ ] **T044**（`FR-003`, `NFR-001`）：添加重复/并发 finalization 测试，确保同 Run 最多一个 file event、一个 handoff、一个 file set。
- [ ] **T045**（`FR-003`, `NFR-001`）：实现 finalization 前后幂等检查和 `finalized_at IS NULL` CAS；竞争 loser 不广播草稿事件。
- [ ] **T046**（`FR-003`, `FR-005`）：添加 baseline missing/corrupt、scanner timeout/permission、builder missing evidence 测试，确保 scan_failed 后仍 handoff/finalized。
- [ ] **T047**（`FR-003`, `FR-005`）：实现 failure draft 和稳定 reason code 收敛；不得重写 Run terminal status。
- [ ] **T048**（`FR-006`, `AC-007`）：添加 ValidationTraceService 测试，覆盖五类 payload、severity、optional file/line、ref scope，以及不修改 Issue status。
- [ ] **T049**（`FR-006`, `IR-006`）：实现内部 ValidationTraceService；不注册公开 POST route。

**Checkpoint 6**：单独调用 trace service 已满足 file/handoff/validation contract，且 finalization 可幂等重试。

## Phase 7：Run Terminal、Lock、Queue 与 Recovery 重构

- [ ] **T050**（`NFR-002`, `AC-003`, `AC-010`）：先扩展 terminal orchestration/lock tests，断言 Run terminal transition 后仍持锁，trace finalization 收敛后才释放，并且只释放一次。
- [ ] **T051**（`NFR-002`）：实现 `RunDispatchService.finalizeAndDrain()` 基础出口并接入已完成的 DevelopmentTraceService；在同一改动中把 completed/failed/cancelled/interrupted 的 lock release 从 RunService 移到该出口，清理双重 release，避免留下“无人释放”或“提前释放”的中间状态。
- [ ] **T052**（`FR-003`, `NFR-002`）：添加 dispatch start 顺序测试：lock acquired -> baseline persisted -> run.started -> adapter.start。
- [ ] **T053**（`FR-003`）：在 RunDispatchService 的初始和 queue-drain 启动路径接入 `prepareRun()`；prepare 异常按设计降级，不跳过 adapter。
- [ ] **T054**（`NFR-001`, `NFR-002`, `TR-008`）：添加 completed/failed/cancelled/interrupted/spawn failure/timeout/escalation 六类 terminal 测试，断言 terminal event -> file event -> handoff -> unlock -> next Run start；escalation 的 pending events 必须在最外层事务 commit 后才广播。
- [ ] **T055**（`NFR-002`, `TR-008`）：把 AgentRunner callback、RunDispatch cancel/escalation/error path 全部收敛到 async `finalizeAndDrain()`；`finally` 必须解锁和 drain，外层事务的 pending events 必须在 commit 后广播。
- [ ] **T056**（`FR-003`, `AC-003`）：添加 queued cancel 测试，确保无 baseline/file/handoff，且异常持锁可释放。
- [ ] **T057**（`NFR-002`）：修正 queued cancel/blocked Issue queued Runs 的 lock/queue 行为，不进入 trace finalization。
- [ ] **T058**（`NFR-001`, `AC-010`）：添加 restart recovery 测试，覆盖 running -> interrupted -> finalize -> unlock、terminal-unfinalized 补做、DB finalization failure 后下次恢复、无重复 events。
- [ ] **T059**（`NFR-001`）：把 stale recovery 改为 async orchestrated recovery；`main()` 在 listen/queue drain 前 await，保留 F002 stale lock 行为。
- [ ] **T060**（`NFR-002`, `AC-003`）：添加同 workspace 双 Run 端到端集成测试，第二 adapter 不能在第一 handoff commit 前启动；不同 workspace 仍可并行。

**Checkpoint 7**：所有 terminal path 共用唯一 finalization/unlock/drain 出口；锁、queue、escalation、restart 测试全部通过后才能进入 API/UI。

## Phase 8：Trace Query 与 Markdown Export API

- [ ] **T061**（`IR-001`, `IR-002`, `AC-008`）：添加 DevelopmentTraceService query 测试，覆盖多 Run、event type filter、Run payload scope、cursor/limit、file cursor scope、missing/truncated completeness。
- [ ] **T062**（`FR-007`, `IR-001`, `IR-002`）：实现 Issue trace/Run evidence query service 和 shared response；不返回完整 run.output/fingerprints/baseline JSON。
- [ ] **T063**（`FR-007`, `AC-008`）：添加 Markdown renderer snapshot/semantic 测试，覆盖多 Run、无 tests、scan failure、missing ref、truncation、Unicode、code fence/HTML escaping 和 filename sanitize。
- [ ] **T064**（`FR-007`, `NFR-004`, `NFR-006`）：实现 `trace-export.ts`，分页读取 evidence、应用 export 上限，在内存生成 UTF-8 Markdown。
- [ ] **T065**（`IR-001` - `IR-005`）：添加 route 集成测试，覆盖三个 GET endpoint、Content-Type/Disposition/Cache-Control、404、invalid limit/cursor 和结构化 error。
- [ ] **T066**（`IR-001` - `IR-006`）：新增 `api/routes/traces.ts` 并注册 services/routes；确认没有公开 validation event 写接口。
- [ ] **T067**（`TR-008`, `AC-012`）：扩展 SSE replay 集成测试，验证 F003 events 使用现有 `event_sequence`、event id cursor、先写库再广播和断线补读。

**Checkpoint 8**：API 和 export 可独立验收；缺失/截断不静默，workspace 不产生导出文件。

## Phase 9：Thread / Inspector UI

- [ ] **T068**（`UX-008`, `IR-001` - `IR-003`）：先添加 apiClient/use-trace hook 测试，覆盖 Issue trace、Run evidence cursor、export Blob/error 和 SSE invalidation query keys。
- [ ] **T069**（`UX-008`, `NFR-008`）：实现 `apiClient.traces`、`hooks/use-trace.ts` 和 download mutation；object URL 必须 revoke。
- [ ] **T070 [P]**（`UX-001`, `UX-002`, `UX-007`）：添加 Command/Verification trace card 组件测试，覆盖 outcome/result、source/confidence、redacted/truncated/unknown 和 keyboard expansion。
- [ ] **T071**（`UX-001`, `UX-002`）：实现 CommandTraceCard / VerificationTraceCard。
- [ ] **T072 [P]**（`UX-003`, `UX-007`）：添加 FileChangeTraceCard 测试，覆盖 totals、preview、scan failed、scan truncated、View all pagination/empty/error。
- [ ] **T073**（`UX-003`）：实现 FileChangeTraceCard 和 file list pagination。
- [ ] **T074 [P]**（`UX-004`, `UX-005`, `UX-007`）：添加 Handoff/Validation cards 测试，覆盖 risks、missing evidence、next action、finding severity、pass/fail/blocked 和“Recorded result”语义。
- [ ] **T075**（`UX-004`, `UX-005`）：实现 HandoffTraceCard / ValidationTraceCard。
- [ ] **T076**（`UX-001` - `UX-005`, `NFR-008`）：重构现有 `ThreadEvent.tsx` 为通用 shell + F003 renderer dispatch；unknown type 保留 generic fallback，文件不得超过 350 行。
- [ ] **T077**（`UX-006`, `UX-007`）：添加 Inspector evidence section 测试，覆盖 complete/partial/unavailable、tests、changed files、handoff、validation result、export loading/error/success。
- [ ] **T078**（`FR-008`, `UX-006` - `UX-008`）：实现 Inspector evidence summary、View all 和 Export Markdown；保留 F002 Run Logs/Cancel/Blocked UI。
- [ ] **T079**（`AC-009`, `AC-012`）：扩展 App/Thread UI 集成测试，模拟 SSE 新 command/file/handoff event，验证 query refresh、排序去重和现有日志不回归。

**Checkpoint 9**：用户可在三栏 UI 复盘 trace、查看完整性/分页、下载 Markdown；所有状态不只靠颜色表达。

## Phase 10：端到端验证与文档回写

- [ ] **T080**（`AC-001` - `AC-012`）：运行 `npm run typecheck`、`npm test`、`npm run build`，修复所有回归；记录命令和结果作为实现验收证据。
- [ ] **T081**（`AC-001`, `AC-002`, `AC-004`, `AC-011`）：使用真实 Codex CLI 在 Windows git workspace 手动执行普通命令、失败/成功验证命令、add/modify/delete，核对 Thread/Inspector/Run evidence。
- [ ] **T082**（`AC-003`, `AC-010`）：手动验证 pre-existing dirty workspace、agent commit、non-git workspace、scan limit、running cancel、escalation 和 terminal-finalization 间重启。
- [ ] **T083**（`AC-008`, `AC-009`）：导出多 Run Issue Markdown，人工检查可读性、missing/truncated 标记、敏感信息 redaction、UTF-8 filename 和 workspace 无新增文件。
- [ ] **T084**（`NFR-003`）：在中型 repository 记录 baseline/final scan 时间、DB/event 大小和 UI 展开体验；若超限只调整集中 limits/strategy，并同步 design 默认值。
- [ ] **T085**（`DR-002`, `DR-003`）：更新 `docs/personahub-system-design.md`，加入 RunTraceState/RunFileChange，说明 handoff/event/ref P0 存储方式。
- [ ] **T086**（`FR-001`, `NFR-001`, `NFR-002`, `TR-008`）：更新 `docs/personahub-architecture.md` 的实际 AgentAdapter `onTrace`、structured capability、terminal finalization/lock 顺序，并修正 cursor 描述与 `event_sequence` 实现一致。
- [ ] **T087**（`AC-001` - `AC-012`）：逐项走查 `spec.md` 验收清单并勾选；任何不满足项不得以文档说明代替实现或测试。
- [ ] **T088**：F003 进入 review/done 时更新 `BACKLOG.md`、本三件套 Status 和 `CLAUDE.md` 现状；保持已完成的 F001/F002 状态不变。

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
| `NFR-003/004/005/007` Limits / Security / Trust / Windows | T018-T031, T063-T064, T081-T084 |

## 备注

- F001/F002 的 UI 自动化补齐且状态已为 `done`；F003 的 regression/UI tests 仍需覆盖与既有流程的交集，防止回归。
- 当前架构文档写“ThreadEvent id 全局单调”，实际代码使用 ULID `id` + Thread 内 `event_sequence`。F003 实现沿用实际 contract，并在 T086 统一文档，不在本 feature 引入新的 cursor 模型。
- 若开发中发现 Codex structured notification 不足以提供 exit code，command outcome 必须保持 unknown/partial；不得为满足验收伪造 0。
