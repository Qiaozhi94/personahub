---
feature_ids: [F007]
related_features: [F005, F006]
topics: [coordinator, routing-recommendation, explainability]
doc_kind: tasks
created: 2026-08-01
updated: 2026-08-02
---

# F007：Coordinator Agent & Routing Recommendation - 任务

> Status: ready-for-development | Owner: TBD | Spec: `spec.md` | Design: `design.md`

## Phase 1：规则集与推荐服务（FR-001、FR-002、NFR-001）

- [ ] T010：`shared/src/types/` 新增 `Recommendation<T>`、`RoutingRecommendation`、`RecommendationPremise`、`IssueDraft`、`IntakeBlockReason` DTO。
- [ ] T011：`services/routing/rules.ts`——四条路由规则 + 三条 Issue 字段规则各自独立可测，统一返回 `{value, rule, candidates, excluded[]}`。
- [ ] T011b：`IssueDraft` 规则实现——`derive_title_from_first_line`（首个非空行、折叠空白、120 字符截断）、`preserve_goal_verbatim`（仅去首尾空白）、`default_priority`；目标文本 8000 字符上限只作用于关键词匹配，`goal` 存全文（`design.md` 第 3 节）。
- [ ] T011c：`IssueDraft` 边界样例测试——单行短文本、多行文本、纯空白、超长文本、首行为空后续有内容，逐个 Given/When/Then。
- [ ] T012：`RoutingRecommendationService.recommend(projectId, goalText)`——纯计算，禁止写库、禁止取锁、禁止建 Run。
- [ ] T012b：**目标 workspace 固定为 `project.default_workspace_id`**，`RecommendRequest` 不接受 `workspace_id`；服务端把它写进 token。理由：确认路径复用的 `IssueService.create()` 签名里没有 workspace，实现写死读默认值（`issue.ts:72`），允许指定别的 workspace 会让推荐依据与实际执行落在两个 workspace 上（`design.md` 第 9 节）。回归断言 token 中的 workspace 与最终 Issue/GraphRun/Run 全部一致。
- [ ] T013：roster 规则接 `effectiveAdapterStatus()`；断言 Project 级 Available 但 workspace 级 Unavailable 的 adapter 出现在 `excluded` 且 reason 指明 workspace 级来源（US2）。
- [ ] T013b：topology 规则按**逐节点能力覆盖**判定，允许同一 adapter 覆盖多个节点。回归测试：**只有一个 Available adapter 时，`orchestrator_subagent` 仍可被推荐**（`design.md` 第 7 节；初稿按 adapter 数量降级会让单 adapter 环境永不启用图）。
- [ ] T013c：无 adapter 具备 `Implementation` 时**直接返回阻塞** `NO_AVAILABLE_CAPABLE_ADAPTER`，**不降级为 `sequential`**——v0.2 三个节点与 sequential 要的是同一项能力，降级后的方案同样不可执行，只会让 recommend 返回一个 confirm 必然拒绝的方案（`design.md` 第 7 节）。
- [ ] T014：确定性测试——相同状态重复调用 N 次，**`RoutingRecommendation` + `RecommendationPremise` 完全一致**（FR-002）。确定性的比较对象**必须排除** `nonce`、`issued_at`、`signature` 以及包含它们的 `recommendation_id`：这些每次签发本就应当不同，拿整个 `RecommendResponse` 做全等比较必然失败。
- [ ] T015：无副作用测试——调用 recommend 后断言 issues / threads / runs / 锁状态零变化（AC-005）。

## Phase 2：前提快照与确认路径（FR-003、FR-004、FR-005）

- [ ] T019：新建 `server/src/db/schema-v9.ts`——`intake_confirmations`（`nonce` 主键，**无 `status` 列**，结果字段全 NOT NULL，`target_kind` 带 CHECK）+ `app_secrets` 表 + `migrations.ts` 分支 + 迁移测试。版本号按实际落地顺序取，**不得追加进已应用版本**。
- [ ] T019b：HMAC 密钥生命周期（`design.md` 第 1 节）——首次启动生成 32 字节 CSPRNG 并写 `app_secrets`，后续启动读回、**跨重启不变**；值损坏/为空则启动失败并给出明确信息，**不静默重新生成**（静默重生成会让在途 token 变成无法解释的"签名无效"）。不做轮换。测试：跨重启验签通过、损坏值启动失败、首次启动只生成一次。
- [ ] T020：`ConfirmationToken` 签发——`nonce` 每次全新、`premise` 采集、规范化序列化（键升序 + 稳定编码，签发与验签共用同一函数）、`recommendation_id` 作内容摘要（**不作身份、不作校验依据**）。**签发不写任何库**，与 T012 的零副作用要求一致（`design.md` 第 1、5 节）。
- [ ] T020a：**HMAC 签名与验签**——密钥来源唯一为 `app_secrets` 表（见 T019b，不再有"本地配置或首次生成"的二选一）。confirm 的事务外顺序固定：验签失败 → 400 `CONFIRMATION_TOKEN_INVALID`；再校验路由 `:projectId` 与 payload 一致；**再按 `nonce` 查已确认事实，命中即返回 200**；未命中才判 `issued_at` 是否超 30 分钟。
- [ ] T020a3：过期重放测试——已成功确认的 token 在 31 分钟后重放，断言返回 **200 与既有结果**而非 `RECOMMENDATION_STALE`；未确认过的过期 token 才返回 stale。
- [ ] T020a2：篡改测试五种——改 `issued_at`（绕过期）、改 `issue_draft`（绕只读）、改 `project_id`（跨 Project）、改 `premise`（污染审计）、伪造/缺失 `signature`。零写入模型下 token 的唯一副本在客户端手里，**没有签名服务端就无法执行自己的契约**（`design.md` 第 1 节）。
- [ ] T020b：premise 必须包含 `capability_tags` 与 `updated_at`——`capability_tags` 的修改不进 `availabilityRelevantFieldsTouched`（`adapter-config-updater.ts:113-119`），只比可用性会漏掉能力被摘除的情况。回归测试：改能力不改可用性后 confirm，断言 `RECOMMENDATION_STALE`。
- [ ] T020c：两个不同目标在同一系统状态下各拿到不同 `nonce`、可各自独立确认——防止用哈希作身份导致第二个目标拿到第一个的结果。
- [ ] T021：`IntakeService.confirm()`——**事务外**先验签/结构校验/过期/projectId 一致；**单外层事务**：复核前提与用户改选 → 创建 Issue → 写事件 → 建首个执行单元 → **最后一步** INSERT `intake_confirmations` 完整行；**commit 之后**先把 coordinator 事件与 `DbOnlyResult.pendingEvents` 聚合后**逐一 broadcast**，再对去重后的 `affectedWorkspaceIds` drain。只写 drain 会让 Graph/Run/Coordinator 事件入库却不实时推送，SSE/UI 要刷新才可见。认领之所以在最后：表内全部列 NOT NULL，`issue_id`/`target_id` 要等实体建完才有值，开头 INSERT 插不进去。
- [ ] T021b：topology 分流——`sequential` → `enqueueSequential(tx, ...)`；`orchestrator_subagent` → **先在事务外调 `prepareGraph()`**（遍历文件系统，不能占写锁），再 `createGraph(tx, issueId, plan, preflight)`。顺序固定为：验签 → 幂等命中检查 → 过期判断 → `prepareGraph()` → 开写事务。空文件集或越界 symlink 在 preflight 阶段就失败，此时**尚未写入任何 Issue**。两者**只写库不拉进程**（F006 `design.md` 第 8.2 节）。F006 未落地时该分支返回 409 `TOPOLOGY_NOT_EXECUTABLE`，**禁止静默回退为 `sequential`**。
- [ ] T021c：幂等测试——同一 token 重复 confirm（含并发双击）只产生一个 Issue。测试要断言具体事务序列：后到者在最后一步撞 `nonce` 主键 → 整个事务回滚 → 另起读操作取胜者已提交的行 → 返回 200 与既有 `issue_id`/`target_id`。`intake_confirmations` **无 `status` 列**，也**不存在 `CONFIRMATION_IN_PROGRESS`**（单事务下不可观察）。
- [ ] T021e：token 过期测试——超过 30 分钟的 token 返回 `RECOMMENDATION_STALE`。
- [ ] T021f：失败后重试测试——事务回滚后表中无残留行，同一未过期 token 可再次成功确认。
- [ ] T021d：失败原子性测试——在事件写入、adapter 复核、图启动三处各注入一次失败，断言事务回滚、**不留孤儿 Issue/Thread**，且客户端可安全重试。
- [ ] T022：`RECOMMENDATION_STALE` 错误码与变化项返回；测试覆盖 adapter 状态翻转、workspace 解绑、模板版本变更三种失效。
- [ ] T022b：**用户改选值的独立校验**——用户把推荐的 adapter 换成另一个后，若新选的 adapter 当前不可用，必须返回 `RECOMMENDATION_STALE` 并指明是哪一项；断言该校验不依赖原始快照是否包含它（`design.md` 第 5 节）。
- [ ] T023：断言确认路径经**共享的 `resolveEligibleAdapter()`**（F006 第 8.3 节）且传入显式 adapter id（两条 topology 分支各测一次）；回归断言推荐服务从不写 `default_adapter_config_id`（FR-005）。
- [ ] T023b：图分支断言——`nodeAssignments` 覆盖 definition 全部节点（含 synthesis），在 `createGraph` 事务内逐项复核；任一不通过则整体拒绝，**不部分启动、不自行替换执行者**（US3 对 `orchestrator_subagent` 同样成立）。
- [ ] T023c：外层回滚测试——`createGraph`/`enqueueSequential` 返回后外层事务回滚，断言无进程被拉起、库中无残留 Issue/GraphRun/Run。
- [ ] T024：新增 `coordinator.recommendation_applied` ThreadEvent，payload 含 `rules[]`、`recommended`、`chosen`、`diff[]`（TR-001）。
- [ ] T025：无关 adapter 的后台 probe 收敛**不得**使推荐失效——针对性回归测试。

## Phase 3：HTTP API（FR-006）

- [ ] T030：`POST /api/projects/:id/intake/recommend`，zod 边界校验（沿用 F005 统一做法）。
- [ ] T031：`POST /api/projects/:id/intake/confirm`。
- [ ] T032：阻塞响应——`no_available_adapter`、`project_workspace_required` 等结构化原因 + 建议动作（FR-006）。
- [ ] T033：边界用例——空/纯空白/超长目标文本，按 `design.md` 第 8 节表格逐项断言。

## Phase 4：Intake UI（US1、US3）

- [ ] T040：Intake 入口与目标输入框；保留既有 `CreateIssueDialog` 手工路径不动。
- [ ] T041：推荐结果面板——四个维度分别展示 `value` / `rule` / `candidates` / `excluded`。
- [ ] T042：调整控件——**仅 `collaboration_topology` 与 `agent_roster` 可改**，按服务端返回的 `editable[]` 渲染；`issue_draft` 与 `workflow_template` 展示规则与候选集但控件禁用并注明"v0.2 不可调整"（`design.md` 第 9 节）。
- [ ] T043：确认 / 取消；取消后断言无任何持久化写入（US3）。
- [ ] T044：阻塞态展示原因与建议动作；`RECOMMENDATION_STALE` 引导重新推荐。
- [ ] T045：文案检查——不得出现"系统理解到"这类语义理解暗示，统一为"命中规则 X"（`design.md` 第 3 节、ADR 0007）。

## Phase 5：验收

- [ ] T050：US1-US4 四条独立测试全部通过。
- [ ] T051：topology 判定测试——断言"仅有一个可用 adapter"**不触发**降级；断言无 `Implementation` 能力时返回 `NO_AVAILABLE_CAPABLE_ADAPTER` 阻塞而非 `sequential` 方案。**v0.2 不存在可触发的能力降级路径**，不要为它写一条测不出来的分支（`design.md` 第 7 节）。
- [ ] T052：F001-F006 全量回归。
- [ ] T053：门禁——`npm run lint && npm run format:check && npm run typecheck && npm test && npm run build`；新增文件纳入 Prettier format targets。
- [ ] T054：回写 `spec.md` 验收清单与 `BACKLOG.md` 状态。

## 依赖关系

- Phase 1 → Phase 2 → Phase 3 → Phase 4 顺序执行。API 契约已在 `design.md` 第 9 节定稿，无额外准入条件。
- T051 依赖 F006 的 definition 已存在（只读取 `definition_id`/`version` 与逐节点 `required_capabilities`，不依赖其运行时完成）。
- **T021b / T023b / T023c 依赖 F006 的 `createGraph(deps, ...)`（自由函数）/ `enqueueSequential(...)`（`GraphRuntimeService` 实例方法）与 `resolveEligibleAdapter()` 落地**（均不接收 `tx` 参数；跨 feature 契约由 F006 `design.md` 第 8 节拥有，2026-08-08 已核对与实现一致）。F006 已于 2026-08-08 完成（`spec.md` Status: done），此依赖已满足。其余任务不依赖 F006 实现完成即可开发。

## 备注

- 不引入 LLM、不自动派工、不新建执行路径（ADR 0007）。
- `coordinator_agent_id` 两列在 v0.2 保持 NULL，不写入（`design.md` 第 4 节）。
- PRD v0.2 范围中的 Structured Handoff Packet 已由 v0.1.4 交付，不重复实现。
