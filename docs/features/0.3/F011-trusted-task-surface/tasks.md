---
related_features: [F006, F009, F010, F012, F013, F014]
topics: [task-surface, projection, acceptance, implementation]
doc_kind: tasks
created: 2026-08-09
updated: 2026-09-13
---

# F011：Trusted Task Surface - 任务

## 0. 来源与执行规则

行为与验收以 `spec.md` 为准，结构、schema、并发和失败协议以 `design.md` 为准。严格按任务编号推进；完成一项立即勾选并记录实际 verify 结果。标记 `[P]` 的任务只允许在修改文件不重叠、共享 contract 已冻结且没有数据依赖时并行。

实现不得复制 V3.44 原型 HTML / mock 数据，不得给 TaskProjection、UI 或 migration adapter 增加 Issue / Dispatch / Attempt / Artifact 旁路写入。发现 F012 / F013 实际导出与设计引用不一致时，先修改三件套并重新过文档门禁，再写代码。

## 1. 前置条件

- F010 Artifact revision / resolver / provenance / `recordConsumption` 已收口，schema v12 及之后 migration 不再修改。
- F013 versioned effective completion requirements、legacy combo map 与授权文件读取 contract 已通过验收。
- F012 Session / Dispatch / Attempt、context snapshot、independence capability evidence、intervention API 与持久 outbox 公共 contract 已通过验收。
- F009 `migration-matrix.md` 中 F011 owner 的 P005、P008、A004、A005、A016–A024 仍有完整 completion evidence 基线。
- ADR 0009 / 0010 / 0011 / 0012 均为 accepted；`design.md` 第 10 节无开放 DQ。

## 2. 实现任务

### Phase 0：上游契约核对与红灯夹具

- [ ] T000 (`FR-002`, `FR-004`, `FR-006`, `FR-010`): 对照 F012 / F013 实际共享类型，冻结 TaskProjection 所需的 Session、Dispatch、Attempt、requirement snapshot、outbox 和 independence facts；差异先回写 `spec.md` / `design.md`。 — verify: `npm run check:features`
- [ ] T001 (`AC-001`, `AC-002`): 先建立 11 个 active state、archived、legacy_unknown 与独立性负例的纯 fixture；确认 projection / evaluator 尚未实现时测试为红。 — verify: `npm test --workspace server -- task-presentation-state acceptance-verdict`
- [ ] T002 (`AC-005`, `AC-006`): 先建立真实旧 schema、baseline CAS、summary / outbox crash seam 与 reopen fixture；确认 migration / service 尚未实现时测试为红。 — verify: `npm test --workspace server -- migration-acceptance acceptance-completion acceptance-outbox-recovery`
- [ ] T004 (`FR-007`, `FR-008`, `NFR-002`): 建立跨服务写链集成夹具，覆盖冻结完成要求基线、写入主张 / 论证 / 证据链接、接受剩余风险、生成完成摘要，并证明完成摘要失败不得推进 Issue done。 — verify: `npm test --workspace server -- acceptance-write-chain`

### Phase 1：共享契约与 Acceptance 写模型

- [ ] T010 (`FR-002`, `FR-005`, `FR-006`, `FR-007`, `DR-003`, `NFR-004`): 在 `shared/` 定义 TaskView、projection envelope / detail、presentation state、attention、action、claim verdict、resource ref 与分页 cursor contract；只引用 F010 / F012 类型，不复制。 — verify: `npm run typecheck`
- [ ] T011 (`FR-008`, `FR-009`, `DR-001`, `NFR-002`): 从实施时真实 `CURRENT_SCHEMA_VERSION` 顺延 migration，新增 acceptance tables / indexes / immutable triggers 与 repository；覆盖重复 migration、foreign key、trigger 和 query plan。 — verify: `npm test --workspace server -- migration-acceptance`
- [ ] T012 (`FR-008`, `FR-009`, `AC-005`): 实现 AcceptanceService 的 initial baseline transaction port、baseline preview / confirm、canonical fingerprint、requirement identity 复用和 case-level expected version / idempotency。 — verify: `npm test --workspace server -- acceptance-baseline`
- [ ] T013 (`FR-005`, `FR-008`, `DR-001`): 实现 claim revision、argument、evidence attach / detach 与 requirement decision append-only commands；actor 由 server context 注入，所有 refs 走公共 parser / resolver。 — verify: `npm test --workspace server -- acceptance-claims`
- [ ] T014 (`FR-006`, `AC-002`): 实现纯 IndependenceEvaluator 与三态投影，逐项消费 F012 的 identity / context / cold-start / memory isolation evidence 和 F013 status map；未知字段 fail closed。 — verify: `npm test --workspace server -- acceptance-verdict`
- [ ] T015 (`FR-010`, `FR-011`, `DR-002`, `NFR-002`): 实现 complete gate、deterministic snapshot / Markdown renderer、summary + `acceptance.completed` outbox 同事务，以及 IssueService 幂等 consumer / finalizing 恢复。 — verify: `npm test --workspace server -- acceptance-completion acceptance-outbox-recovery`
- [ ] T016 (`FR-009`, `FR-012`, `AC-005`): 实现 legacy active baseline backfill 与 Done EvidenceSummary 只读 adapter；无可靠 snapshot 写 `legacy_unresolved`，不倒推 normalized claims。 — verify: `npm test --workspace server -- migration-acceptance task-acceptance-projection`

### Phase 2：TaskProjection 与 API

- [ ] T020 (`FR-002`, `FR-003`, `UX-003`, `UX-004`, `AC-001`): 实现 ProjectionFacts assembler、固定优先级 presentation state、唯一 primary action / owner / impact 和 attention stable-key 去重。 — verify: `npm test --workspace server -- task-presentation-state task-projection`
- [ ] T021 (`FR-005`, `FR-006`, `FR-010`, `AC-002`): 实现 acceptance reader，把当前 baseline、claims、arguments、evidence、decisions、completion / legacy facts 投影为三态 + exact reasons。 — verify: `npm test --workspace server -- task-acceptance-projection`
- [ ] T022 [P] (`FR-004`, `NFR-004`): 实现 conversation / trace detail reader，按 Room 读取消息与执行组合 / context lineage，支持搜索、事件类型 cursor 分页和 timing summary。 — verify: `npm test --workspace server -- task-conversation-projection`
- [ ] T023 [P] (`FR-007`, `NFR-003`, `NFR-004`): 实现 resources detail reader，以 F010 revision / consumption / provenance 和 F012 context items 生成 input / output；文件读取走 F013 authorization，六态失败不 fallback。 — verify: `npm test --workspace server -- task-resource-projection`
- [ ] T024 (`FR-001`, `FR-009`, `AC-005`): 实现 task list、create preview / confirm application API；Issue、首个 Session / Thread 与 initial baseline 原子创建，确认幂等且目标原文保真。 — verify: `npm test --workspace server -- task-create-confirmation`
- [ ] T025 (`DR-003`, `NFR-001`, `NFR-004`): 实现按 view TaskProjection HTTP API、opaque composite cursor 与 task SSE replay；覆盖 source-key 去重、stale response、invalid cursor full snapshot 和索引计划。 — verify: `npm test --workspace server -- task-projection-replay`
- [ ] T026 (`FR-008`, `FR-009`, `FR-010`, `FR-011`): 实现 acceptance command routes、`If-Match` / `Idempotency-Key`、稳定 error code 与 API client / hooks。 — verify: `npm test --workspace server && npm test --workspace web -- f011-api-contract`

### Phase 3：四视图生产 UI

- [ ] T030 (`FR-001`, `UX-001`, `UX-002`): 接管 `/tasks` list / create / open；注册 `/tasks/:taskId/{overview,conversation,acceptance,resources}`，base route replace 到 overview；实现 task shell、四 tabs、唯一 composer 与 draft generation 保留。 — verify: `npm test --workspace web -- f011-task-shell`
- [ ] T031 (`FR-003`, `UX-003`, `UX-004`, `AC-001`): 实现概览与活动副栏，11 个 state 按 priority 重排并显示唯一 action / 影响；跨 view attention 只链接不重复计数。 — verify: `npm test --workspace web -- f011-task-state-matrix`
- [ ] T032 [P] (`FR-004`, `UX-002`, `AC-003`): 实现会话 + 轨迹副栏、Room 联动、搜索 / 折叠 / 类型分页 / 全宽复盘、execution identity 与 context lineage。 — verify: `npm test --workspace web -- f011-conversation-resources`
- [ ] T033 [P] (`FR-005`, `FR-006`, `UX-005`, `AC-002`): 实现验收 + 大纲、三态卡筛选、未支撑项、claim / argument / evidence、精确 reason、实现回归分段、baseline diff / risk / complete dialogs。 — verify: `npm test --workspace web -- f011-acceptance-view`
- [ ] T034 [P] (`FR-007`, `UX-005`, `NFR-003`, `AC-003`): 实现资源清单 + 同屏预览、input / output 双方向、Artifact 六态、文件变化导航，以及验收长文档的全文 / 返回 anchor。 — verify: `npm test --workspace web -- f011-conversation-resources`
- [ ] T035 (`UX-001`, `UX-004`, `UX-005`, `AC-004`): 完成 tabs / dialog / table / focus / keyboard / sanitizer / persistent feedback 的可访问性与安全测试；结构事实全部自动化。 — verify: `npm test --workspace web -- f011-accessibility`

### Phase 4：兼容入口退出

- [ ] T040 (`FR-012`, `AC-007`): 按 migration matrix 逐行接管 P005、P008、A004、A005、A016–A024，回填每行新 route / API / browser completion evidence；未满足 `delete_when` 的行不得删除旧宿主。 — verify: `npm test -- tools/check-v03-plan-contracts.test.mjs`
- [ ] T041 (`FR-012`, `AC-007`): completion evidence 全部通过后，从 production route / registry 删除 `IssueList`、`CreateIssueDialog`、`IssueInspector`、旧 Evidence / validation UI 与 handlers；保留必要 legacy read adapter 和历史 contract tests。 — verify: `npm test && npm run test:e2e`
- [ ] T042 (`DR-001`, `DR-002`): 按实际 migration / API / transaction 落点同步 `docs/personahub-system-design.md` 与 `docs/personahub-architecture.md`，明确 claims 由 F011 实现、F010 只拥有 Artifact core。 — verify: `npm run check:doc-links && npm run check:doc-ownership`

## 3. 验证与验收任务

- [ ] T050 (`AC-001`): 跑 11 个具名 active state + archived / legacy_unknown 矩阵；逐行断言首屏、唯一 action、owner、impact、恢复和保留事实，禁止以数量断言替代语义。 — verify: `npm test --workspace server -- task-presentation-state && npm test --workspace web -- f011-task-state-matrix`
- [ ] T051 (`AC-002`, `AC-005`, `AC-006`): 跑 claim / independence、baseline CAS、complete gate、summary / outbox crash-reopen 与重复 delivery 全套负例。 — verify: `npm test --workspace server -- acceptance-verdict acceptance-baseline acceptance-completion acceptance-outbox-recovery`
- [ ] T052 (`AC-003`, `AC-004`): 跑多 Room、trace pagination、input / output provenance、Artifact 六态、授权拒绝、SSE replay、draft / anchor 与 accessibility tests。 — verify: `npm test`
- [ ] T053 (`AC-001`, `AC-002`, `AC-003`, `AC-004`, `AC-007`): 运行真实浏览器四视图旅程，覆盖 BC-003/004、009–026、031–039、046–052、059、071；0 console error，结构 / 行为项不得改为 manual。 — verify: `npm run test:e2e`
- [ ] T054 (`AC-007`): 逐行核对迁移矩阵 14 个 F011 owner 条目，确认 production route / registry 不可达旧宿主且历史数据仍可读；保存矩阵 completion evidence。 — verify: `npm test -- tools/check-v03-plan-contracts.test.mjs && npm run test:e2e`
- [ ] T055 (`AC-001`, `AC-002`, `AC-003`, `AC-004`, `AC-005`, `AC-006`, `AC-007`): 运行发布质量门并记录耗时 / 结果；失败先修当前问题，不带红进入 review。 — verify: `npm run verify:release`
- [ ] T056 (`UX-004`, `UX-005`): 只对布局层级、异常文案是否自然、四视图切换是否易理解做人工浏览器体验复核；元素存在、动作、键盘、路由和状态变化不得放入本项。 — verify: 在 `docs/reviews/dogfooding-notes.md` 记录真实 task ID、浏览器、结论或问题编号

## 4. 依赖与并行关系

`T000 → T001/T002 → T010 → T011 → T012 → T013/T014 → T015/T016 → T020/T021`。T022 与 T023 只在 T010 的共享 projection contract 冻结后并行；T024 依赖 T012 的 initial baseline transaction port；T025 依赖 T020–T023；T026 依赖 T012–T015。

UI 的 T032 / T033 / T034 只在 T030 shell 与对应 server detail reader 通过后并行；T035 汇总三者。T040 必须等新旅程通过，T041 必须等 T040 每行 completion evidence 完整；T042 在实际 schema / API 定型后执行。T050–T056 是收口门，不能用局部 workspace test 替代 `verify:release`。

F011 文档设计可以与 F010 检视尾声重叠，但代码实现不与未收口的 F012 / F013 contract 并行。F014 只消费 F011 公共 API 与矩阵结果，不替 F011 补首次写链或页面。

## 5. 明确后移

- Memory 候选、验收事件到 Memory 的写入与效用统计移交 v0.4。
- Usage / monitoring 到 task trace 的第三级跳转由 v0.4 Usage Feature 集成，F011 只保留 task trace 入口。
- 首个非 coding Evidence Adapter、领域结论状态与真实旅程移交 v0.5；F011 只保证骨架无 coding-only 分支。
- 自动修复循环、自动续派与智能编组推荐移交 v0.6。
- 跨版本 migration report、首次配置到可信完成的真实 CLI 全旅程与 v0.3 release evidence 移交 F014。
