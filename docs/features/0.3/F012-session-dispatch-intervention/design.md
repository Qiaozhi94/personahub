---
kind: feature
id: F012
version: "0.3"
related_features: [F005, F006, F009, F010, F011, F013, F014]
topics: [session, dispatch, runtime, intervention]
doc_kind: design
created: 2026-08-09
updated: 2026-09-14
---

# F012：Session, Dispatch & Intervention - 设计

> Owner: unassigned | Spec: `spec.md` | Tasks: `tasks.md`

## 0. 输入与约束

- **行为契约**：本目录 `spec.md`。
- **产品与系统约束**：PRD §5.4、§5.5、§5.10、§7.2、§7.3、§8.3、§8.5、§8.7；V3.44 基线 `ui-reference/personahub-draft/personahub-v3.1/docs/design.md` §3.1、§3.2、§3.7、§5。
- **上游决策（本 Feature 是这四份 ADR 的落地 owner，条款逐条列出以免再次漏接）**：
  - **ADR 0009**（session 生命周期）：§2 resume key 四元组；§3 三档上下文范围与降级披露；§4 五条强制冷启动条件；§5 六类每次派工必须持久化的事实（含 provider session ID 按敏感运行元数据处理、诊断导出遮罩）；§6 `supportsSessionResume` 由 adapter 报告、恢复失败不改写上一 Attempt。
  - **ADR 0011**（关闭原生 memory）：每次执行用私有 config 关闭读写两侧，不改用户全局配置；关不掉或无法验证时该 adapter 标记为不支持上下文隔离，其验证结论不得显示为独立验证。
  - **ADR 0012**（对象模型简化）：§1 层级（Issue → Room ×N → Thread 一对一）；§2 取消 AI 成员 / primary Thread / Project Thread / Room 归档；§4 上下文范围由派工决定；「已知实施迁移项」把 `base_url` 八触点落地表与 `agent_configs` 语义变更明确并入 F012。
  - **ADR 0015**（daemon 分期）：§1 `AdapterConfig.runtime_id`；§2 `AdapterIdentitySnapshot.runtime_id` 冻结执行时实际值；§3 「旧进程已死」推断提成具名函数；§4 `api_key` 保持单一消费点。这四条的分界线是「历史数据不能回填」，v0.3 不做就永久缺失。
- **ADR 0017**（用量口径）：v0.3 不建 `run_usage`、不做聚合（v0.4 owner），但本 Feature 产出的 `attempts` / `dispatches` ID 与 `depth` / `context_scope` 字段必须满足 ADR 0017 §5 的引用形状；额度只作为 adapter 自报事实呈现，按 `authoritative` / `estimated` 分开标注，缺失存 `NULL` 不存 `0`。
- **F009 交接**：`migration-matrix.md` 中 `replacement_owner` 为 F012 的 **18 行**——P004、P006、P007、P010、A006、A007、A008、A009、A010、A011、A012、A013、A014、A015、A025、A026、A027、A028——各自的 `delete_when` 是本 Feature 的验收条件，里程碑 M3（§7.5 逐行给出退场判据）。F009 另已声明「F012 发布 Session ID 后才注册 `/sessions/:sessionId`」，该路由注册属本 Feature（§6.1）。
- **F010 只读契约**：`recordConsumption(dispatch_id, run_id, revision_ref, purpose)` 幂等公共 API；`artifact_consumptions.dispatch_id` 是 soft reference——**F012 接入 `recordConsumption` 时必须在同一事务内校验 Dispatch 存在且与 `run_id` 归属一致**，v0.3 不为补 FK 重建该表。`resolveForDispatch()` 拒绝无 revision 的 floating ref。
- **F013 只读契约**：`EffectiveRequirementsResolver`（按 Skill revision ref 计算能力要求与完成要求，同 ref 两次解析逐字节相同）与 `RepositoryRegistry.verifyAuthorization()`（真实 realpath 重读，取机器路径授权 ∩ 项目范围 ∩ 任务范围）。**Task scope 由 F012 以 `scope_json` 同形入参传入**；F013 不读 Dispatch。
- **F011 消费契约**：F011 按字段级依赖本 Feature 的持久 `DomainOutbox`、execution-state 只读查询与 independence snapshot（§4.5、§4.6）。F011 在这些契约验收后接入，**不形成反向依赖**：本 Feature 的 UI 只接 F009 稳定槽位与共享交互原语，不复用 F011 shell。
- **跨 Feature 不变量**（`docs/features/0.3/README.md` §4）：1（Run / Attempt 是唯一执行事实）、4（执行组合四维，不包装为 AI 成员）、7（配置 / 派工 / 执行各有唯一写入口，事务提交前不得启动进程或广播成功事件）、8（迁移不得破坏 v0.1–v0.2 历史 Run / Trace / Evidence refs）、12（consumption 同事务校验归属）、13（F012 是持久 `DomainOutbox` 唯一 owner）、14（acceptance 处于 `finalizing` / `completed` 时拒绝创建或确认新的 Dispatch / Attempt，**由 F012 实现侧断言**）。
- **实现约束**：不保留 AI 成员兼容抽象；不新建第二套 outbox；不在 v0.3 引入第二台执行机器、自动降级或自动续派。

## 1. 技术概要与影响面

执行路径从「Thread 上直接建 Run」改为「Room 承载会话 → Dispatch 固定派工意图 → Attempt 承载一次真实执行 → Run 记录进程事实」。实现顺序上，先用真实 CLI probe 建立 adapter capability evidence（无证据即 `unverified`，保守失败），再落 schema 与只读 evaluator，最后接管派工与介入写入口。

| 层 | 新增 / 变更 | 不做 |
|---|---|---|
| shared | `Room`、`Dispatch`、`Attempt`、`ExecutionIdentity`、`ContextSnapshot`、`EligibilityResult`、`CapabilityVerdict`、`OutboxEvent` 类型；`AdapterConfig` 加 `runtime_id` / `base_url`；`AdapterIdentitySnapshot` 加 `runtime_id` | 不复制 F010 / F011 / F013 类型 |
| server application | `SessionService`、`DispatchService`、`EligibilityEvaluator`、`ContextAssembler`、`RuntimeProjectionService`、`DomainOutbox`、`DispatchGateService` | 不写 Artifact / acceptance 状态 |
| server runtime | deadline worker、starting lease worker、outbox worker、`isRunOwnerDead()` 具名化 | 不做 daemon、不做多机租约 fencing |
| db | 7 张新表 + 3 处列扩展 + 历史回填（§3） | 不重建 `artifact_consumptions`、不改 F010 / F013 已发布表 |
| web | 派工选择器、撤销倒计时横幅、会话面、运行时面、全局闸门 | 不做任务面四视图（F011）、不做统计聚合（v0.4） |

影响面最大的三处既有代码：`server/src/services/issue.ts`（Run 创建改为 Dispatch 的副作用）、`server/src/services/manual-routing-service.ts` 与 F006 `resolveEligibleAdapter()`（被 `EligibilityEvaluator` 取代）、`server/src/services/runtime-health.ts`（workspace 维度的健康读数改挂机器维度投影）。

## 2. 架构与模块边界

```text
web (F009 槽位)
  ├─ 派工选择器 / 撤销横幅 ──> DispatchService        (唯一派工写入口)
  ├─ 会话面 ─────────────────> SessionService          (唯一 Room / 消息写入口)
  ├─ 介入动作 ───────────────> DispatchGateService / DispatchService.cancelAttempt()
  └─ 运行时面 ───────────────> RuntimeProjectionService (只读)

DispatchService
  ├─ EligibilityEvaluator     只读：runtime facts + F013 effective requirements + capability evidence
  ├─ ContextAssembler         只读组装 + F010 recordConsumption + F013 verifyAuthorization
  ├─ DomainOutbox.enqueue(tx) 与领域事务原子提交
  └─ RunService               只执行已提交 Dispatch；不再对外暴露创建入口

DomainOutbox worker ──> 注册消费者：dispatch.* 广播 / F011 IssueService.consumeAcceptanceCompleted()
```

- `SessionService` 是 Room 创建、结束、消息写入与「转成任务」的唯一写入口；Thread 作为 Room 的内部一对一事件流，不对外暴露 ID。
- `DispatchService` 是派工唯一写入口——UI、F006 graph scheduler、F011 的执行动作全部经它，不存在第二条建 Run 的路径（不变量 7）。
- `EligibilityEvaluator` **只读**，不写库、不自动降级：输入是运行时事实、F013 `EffectiveRequirementsResolver` 的 versioned 输出与 capability evidence，输出是三档候选 + 逐项理由 + 要求来源。
- `ContextAssembler` 只在 starting 阶段运行；它是 `recordConsumption` 的唯一调用点，也是 `verifyAuthorization()` 的唯一调用点。
- `RuntimeProjectionService` 只读聚合一台机器的 adapter / 锁 / 队列 / 后台任务事实，不提供任务停止动作（PRD §5.10）。
- `DomainOutbox` 是基础设施，不感知业务语义：topic + payload + dedupe key，消费者自注册。
- 依赖方向固定为 API → Service → Repository；Repository 不对 route 暴露。`DispatchService` 不反向调用 F011 / F013。

### 2.1 与 F006 graph 的关系（图执行不是第二条派工路径）

图执行的每个节点执行 = 一次 Dispatch。`dispatches.graph_node_run_id` 可空外键指向 `node_runs(id)`；graph scheduler 调 `DispatchService.confirm()` 而不是自行建 Run，因此：

- 节点派工同样写 drafted / dispatched 事件，同样进 Attempt / Run，同样受 gate 约束；
- 图内节点的 grace window 固定为 `0`（整图启动已有一次用户确认，不再逐节点弹倒计时），走同一条 `draft → starting → dispatched` 路径，不新增状态；
- F006 的 `resolveEligibleAdapter()` 退役，由 `EligibilityEvaluator` 提供同名能力并附理由；`createGraph()` 契约不变；
- 迁移矩阵 A010 / A013 / A014 / A015 的写入口按 §7.5 退场。

## 3. 数据模型与 Migration

实施时读取 `CURRENT_SCHEMA_VERSION` 并顺延，不预占版本号（F010 / F013 先合入者先取号）。所有新表在同一个 migration 内创建，回填与列扩展在同一事务完成。

### 3.1 会话：新建 `rooms`，`threads` 升为其内部事件流

```sql
CREATE TABLE rooms (
  id          TEXT PRIMARY KEY,
  space_id    TEXT NOT NULL REFERENCES spaces(id),
  issue_id    TEXT     REFERENCES issues(id),   -- NULL = 独立会话
  title       TEXT NOT NULL,
  state       TEXT NOT NULL CHECK (state IN ('active','ended')),
  created_at  TEXT NOT NULL,
  ended_at    TEXT
);
ALTER TABLE threads ADD COLUMN room_id TEXT REFERENCES rooms(id);
CREATE UNIQUE INDEX idx_threads_room ON threads(room_id) WHERE room_id IS NOT NULL;
CREATE INDEX idx_rooms_issue ON rooms(issue_id);
```

**选新建 `rooms` 而不是把 `threads` 升格**：`threads` 已被 v0.1–v0.2 的 `thread_events`、Run、Trace、Evidence 按 ID 引用（不变量 8），升格要同时改语义和外键含义；新建表 + 一对一索引可以把历史 thread 原样保留，只补一个 room 行。回填规则：每个现存 thread 生成一个 room（`issue_id` 取 `threads.issue_id`，`space_id` 取该 Issue 的 space，`title` 取 Issue 标题，`state='active'`），并写回 `threads.room_id`；**不改任何 thread ID**。Room 永不物理删除，结束只写 `state='ended'`（ADR 0012 §2）。

### 3.2 派工：`dispatches`

```sql
CREATE TABLE dispatches (
  id                        TEXT PRIMARY KEY,
  room_id                   TEXT NOT NULL REFERENCES rooms(id),
  issue_id                  TEXT     REFERENCES issues(id),  -- 冗余列，必须与 room 一致
  client_request_id         TEXT NOT NULL,
  state                     TEXT NOT NULL CHECK (state IN ('draft','cancelled','starting','dispatched','start_failed')),
  purpose                   TEXT NOT NULL CHECK (purpose IN ('execute','validate','design_cases')),
  -- 执行组合四维 + 执行位置（ADR 0012 §2 / ADR 0015 §1-2）
  runtime_id                TEXT NOT NULL DEFAULT 'local' REFERENCES runtime_machines(id),
  adapter_config_id         TEXT NOT NULL REFERENCES agent_configs(id),
  access_ref                TEXT,                            -- 仅多接入方式 adapter 有值
  model                     TEXT NOT NULL,
  depth_raw                 TEXT NOT NULL,                   -- adapter 原生档位原文
  depth_normalized          TEXT NOT NULL CHECK (depth_normalized IN ('high','medium','low')),
  identity_snapshot_json    TEXT NOT NULL,                   -- AdapterIdentitySnapshot + runtime_id，冻结当时值
  -- 上下文与要求
  context_scope             TEXT NOT NULL CHECK (context_scope IN ('all','result_only','goal_only')),
  skill_revision_refs_json  TEXT NOT NULL,                   -- 排序后的 skill@version 列表
  effective_requirements_json TEXT NOT NULL,                 -- F013 resolver 的逐字输出
  effective_requirements_hash TEXT NOT NULL,
  handoff_refs_json         TEXT NOT NULL,
  task_scope_json           TEXT,                            -- 任务级路径收紧，形状同 F013 scope_json
  requirement_override_json TEXT,                            -- 软要求偏离留痕，结构性缺失不可 override
  -- 撤销窗口与租约
  grace_deadline_at         TEXT NOT NULL,
  lease_owner               TEXT,
  lease_expires_at          TEXT,
  -- 图集成
  graph_node_run_id         TEXT     REFERENCES node_runs(id),
  -- 终态诊断
  failed_reason_code        TEXT,
  failed_diagnostics_json   TEXT,
  created_at                TEXT NOT NULL,
  started_at                TEXT,
  ended_at                  TEXT
);
CREATE UNIQUE INDEX idx_dispatch_idem ON dispatches(room_id, client_request_id);
CREATE INDEX idx_dispatch_open ON dispatches(state, grace_deadline_at) WHERE state IN ('draft','starting');
CREATE INDEX idx_dispatch_issue ON dispatches(issue_id, created_at);
```

**幂等键是 `(room_id, client_request_id)`，不含 `task_id`**：独立会话没有 Issue，任何含可空 `task_id` 的唯一键在 SQLite 下都因 `NULL != NULL` 而失效，重复确认会产生多个 draft，直接破坏 FR-004。`room_id` 永远非空（独立会话也有 Room），是唯一安全的幂等载体。`issue_id` 只作为查询冗余列，由 §3.8 的 trigger 保证与 `rooms.issue_id` 一致。

### 3.3 执行：`attempts`

```sql
CREATE TABLE attempts (
  id                      TEXT PRIMARY KEY,
  dispatch_id             TEXT NOT NULL REFERENCES dispatches(id),
  seq                     INTEGER NOT NULL,                  -- 1-based
  run_id                  TEXT NOT NULL REFERENCES runs(id), -- 1:1
  state                   TEXT NOT NULL CHECK (state IN ('queued','running','succeeded','failed','cancelled','interrupted')),
  start_mode              TEXT NOT NULL CHECK (start_mode IN ('cold','resumed')),
  resumed_from_attempt_id TEXT     REFERENCES attempts(id),
  provider_session_id     TEXT,                              -- 敏感运行元数据，§6.3 遮罩
  cold_start_reason       TEXT,                              -- ADR 0009 §4 的五条之一
  created_at              TEXT NOT NULL,
  ended_at                TEXT
);
CREATE UNIQUE INDEX idx_attempt_seq ON attempts(dispatch_id, seq);
CREATE UNIQUE INDEX idx_attempt_run ON attempts(run_id);
```

**Attempt 是一等对象，与既有 `runs.validation_attempt` 是两件事**：后者（`server/src/db/schema-v11.ts:16`）是「某轮验证的第几次尝试」，语义不变、不复用、不交叉解释；本文档及代码中凡指派工重试一律写 `attempts.seq`。基数固定为 Dispatch 1:N Attempt、Attempt 1:1 Run——一次派工可因基础设施重试产生多个 Attempt（PRD §5.5），每个 Attempt 恰有一个 Run 承载命令、原始输出、文件变化与终态（不变量 1）。

### 3.4 快照：上下文与能力

```sql
CREATE TABLE dispatch_context_snapshots (
  dispatch_id  TEXT PRIMARY KEY REFERENCES dispatches(id),
  scope        TEXT NOT NULL,
  items_json   TEXT NOT NULL,   -- [{source_ref, kind, decision:'included'|'filtered', reason}]
  content_hash TEXT NOT NULL,
  assembled_at TEXT NOT NULL
);

CREATE TABLE dispatch_capability_snapshots (
  dispatch_id    TEXT NOT NULL REFERENCES dispatches(id),
  capability_key TEXT NOT NULL,  -- model_enumeration | depth | session_resume | native_memory_isolation | tools | quota
  verdict        TEXT NOT NULL CHECK (verdict IN ('supported','unsupported','unverified')),
  evidence_id    TEXT NOT NULL REFERENCES adapter_capability_evidence(id),
  consequence    TEXT NOT NULL,  -- 该裁决对本次派工的后果原文
  PRIMARY KEY (dispatch_id, capability_key)
);
```

`items_json` **只存 ref 不存正文**，满足 NFR-002「agent 可见上下文可从事件和 refs 完整重建」；过滤项必须带 reason，UI 据此披露（ADR 0009 §3）。

### 3.5 能力证据：`adapter_capability_evidence`

```sql
CREATE TABLE adapter_capability_evidence (
  id              TEXT PRIMARY KEY,
  cli_provider    TEXT NOT NULL,
  cli_version     TEXT NOT NULL,
  capability_key  TEXT NOT NULL,
  verdict         TEXT NOT NULL CHECK (verdict IN ('supported','unsupported','unverified')),
  probe_command   TEXT NOT NULL,
  probe_result    TEXT NOT NULL,   -- 脱敏后的机器可读结果
  probed_at       TEXT NOT NULL,
  missing_reason  TEXT             -- unverified 时必填：缺什么、怎么重跑
);
CREATE UNIQUE INDEX idx_capability_current ON adapter_capability_evidence(cli_provider, cli_version, capability_key);
```

每项能力只允许 **supported / unsupported / unverified** 三态并附证据时间与 CLI 版本。表内容由 Phase 0 probe 写入，人读摘要同步维护在本目录 `adapter-capability-evidence.md`，原始结果存测试 fixture。缺记录一律按 `unverified` 处理，不得回退为 supported（NFR-003）。

### 3.6 闸门：`dispatch_gates`

```sql
CREATE TABLE dispatch_gates (
  scope_type TEXT NOT NULL CHECK (scope_type IN ('runtime','issue','graph')),
  scope_id   TEXT NOT NULL,
  state      TEXT NOT NULL CHECK (state IN ('open','paused')),
  revision   INTEGER NOT NULL,
  reason     TEXT,
  actor      TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (scope_type, scope_id)
);
```

三层闸门语义相同、作用域不同：`runtime`（PRD §5.10 的「暂停全部派工」全局准入闸门，v0.3 的 `scope_id` 恒为 `'local'`）、`issue`（任务级）、`graph`（图级）。claim 时三层任一 `paused` 即不推进。`revision` 单调递增，用于与 claim 线性化（§5.4）并作为事件载荷，使「重启后 pause 意图保留」可断言。

### 3.7 基础设施：`domain_outbox`（FR-009，不变量 13）

```sql
CREATE TABLE domain_outbox (
  id               TEXT PRIMARY KEY,
  topic            TEXT NOT NULL,
  payload_json     TEXT NOT NULL,
  dedupe_key       TEXT NOT NULL,
  status           TEXT NOT NULL CHECK (status IN ('pending','in_flight','delivered','poison')),
  attempts         INTEGER NOT NULL DEFAULT 0,
  available_at     TEXT NOT NULL,
  claimed_by       TEXT,
  claim_expires_at TEXT,
  last_error_code  TEXT,
  last_error_detail TEXT,
  created_at       TEXT NOT NULL,
  delivered_at     TEXT
);
CREATE UNIQUE INDEX idx_outbox_dedupe ON domain_outbox(topic, dedupe_key);
CREATE INDEX idx_outbox_ready ON domain_outbox(status, available_at);

CREATE TABLE domain_outbox_acks (
  event_id  TEXT NOT NULL REFERENCES domain_outbox(id),
  consumer  TEXT NOT NULL,
  acked_at  TEXT NOT NULL,
  PRIMARY KEY (event_id, consumer)
);
```

`dedupe_key` 让「同一领域事实重复 enqueue」在唯一索引层被吸收（例如 `dispatch:<id>:dispatched`、`acceptance:<summary_id>`）。ack 按 (event, consumer) 记录，多消费者各自幂等。

### 3.8 既有表的列扩展与迁移

| 触点 | 变更 | 依据 |
|---|---|---|
| `runtime_machines`（新表，单行 `'local'`：id / label / kind / created_at） | 建立执行位置的归属根 | ADR 0015 修订note：v0.3 建立单台本机的 RuntimeMachine 基础 |
| `agent_configs` + `runtime_id TEXT NOT NULL DEFAULT 'local'` | adapter 从「类型层面只能指向本机」变成显式绑定 | ADR 0015 §1；不留「未绑定」第三态 |
| `agent_configs` + `base_url TEXT`（可空） | 官方端点真会缺席，不用假字符串代替 | ADR 0012 落地表第 1 项 |
| `agent_configs` 语义迁移 | `name` 改为执行组合可读名（如 `codex-gpt5.6-high`），`role` 停用并在兼容视图中只读保留；`capability_tags` 迁往 F013 Skill 侧，本表不再解释能力 | ADR 0012「`agent_configs` 表语义变更未迁移」 |
| `AdapterIdentitySnapshot` + `runtime_id` | 派工时冻结**执行时实际值**，不回查配置 | ADR 0015 §2；`base_url` **不加**进快照（ADR 0012 落地表第 8 项） |
| `evidence_summaries.*_identity_json` | 随快照结构扩展，历史行读取时缺字段按 `'local'` 解释并标记 `legacy_inferred` | 不变量 8 |

`base_url` 的其余七个触点（`shared/src/types/index.ts` 的 `AdapterConfig`、`server/src/repositories/agent-config.ts` 四处、`agent-config-dto.ts`、`adapter-config-contract.ts` 的形状校验——非空必须 `https://`，`http://` 仅允许 loopback，且不校验可达性、`adapter-config-updater.ts` 与 `api/routes/adapters.ts` 透传、`web/src/components/adapter/AdapterAuthFields.tsx` 仅 API Key 分支出现输入框）按 ADR 0012 落地表逐条实现，由 tasks 的迁移任务拆分承载。

**历史数据规则**：不丢任何历史 ID；无法判定归属的旧记录不猜测，按 §7.4 的具名 legacy 状态标记。

## 4. 接口、Contract 与 Event

### 4.1 会话

| Method + Path | 入参要点 | 返回 | 错误码 |
|---|---|---|---|
| `POST /api/rooms` | `space_id`、可选 `issue_id`、`title` | Room | `SPACE_NOT_FOUND` 404 |
| `GET /api/rooms/:roomId` | — | Room + 消息分页游标 | `ROOM_NOT_FOUND` 404 |
| `POST /api/rooms/:roomId/messages` | `body`、`Idempotency-Key` | 追加的消息事件 | `ROOM_ENDED` 409 |
| `POST /api/rooms/:roomId/end` | — | Room（`ended`） | — |
| `POST /api/rooms/:roomId/convert-to-task` | `project_id?`、`goal` | Issue + 迁移后的 Room | `ROOM_ALREADY_TASK_BOUND` 409 |

会话消息与派工共用任务面唯一输入框（V3.44 §3.1）：不带执行组合的发送落到 `messages`，带执行组合的发送落到 `dispatches`；两者写同一 Thread 事件流，前端按事件类型渲染，不存在第二个草稿或第二个输入框。

**转成任务**（FR-007）：在同一事务内创建 Issue、把 `rooms.issue_id` 从 NULL 改为新 Issue、写 `session.converted` 事件。转换前该 Room 的 Dispatch / Attempt / Run 事实全部保留并挂到新 Issue 下；转换前不写 Artifact / Evidence / Memory（由 F010 / F011 各自的写入口拒绝无 Issue 的调用来保证，本 Feature 只保证 `issue_id` 为 NULL 这一事实可查）。

### 4.2 Eligibility（只读）

`GET /api/rooms/:roomId/eligibility?purpose=&skill_refs=&context_scope=`

```jsonc
{
  "candidates": [
    {
      "identity": { "runtime_id": "local", "adapter_config_id": "...", "access_ref": null,
                    "model": "...", "depth_raw": "...", "depth_normalized": "high" },
      "tier": "recommended | selectable | blocked",
      "reasons": [
        { "code": "NATIVE_MEMORY_UNVERIFIED", "source": "capability_evidence",
          "strength": "structural", "consequence": "不可承担要求独立性的验证",
          "evidence_id": "...", "cli_version": "...", "probed_at": "..." },
        { "code": "SKILL_REQUIREMENT_UNMET", "source": "skill@3/step-2",
          "strength": "soft", "consequence": "可派工，偏离将持久留痕" }
      ]
    }
  ],
  "requirements": { "ref": "skill@3", "hash": "...", "items": [ /* F013 逐字输出 */ ] }
}
```

三档定义（FR-003，不自动替用户降级）：

- `recommended`：满足全部 hard 与 soft 要求；
- `selectable`：**soft** 要求不满足，或**结论会降级但执行本身成立**（同源、原生记忆 `unsupported` / `unverified` 等）。用户坚持选择时允许派工，`requirement_override_json` 持久留痕；
- `blocked`：**结构性**不可用——adapter 离线、登录未知、额度不足、`verifyAuthorization()` 不授权、模型不在该 adapter 的可用集合、depth 无法映射。blocked 项仍然可见并给出理由与替代路径（PRD §9「不能做的操作置灰并说明原因」），不静默隐藏。

**同源模型不是 blocked，而是 selectable + 结论降级**：PRD §5.8 与 ADR 0009 §3 约束的是「结论不得显示为独立验证」，不是「不允许执行」；F011 的回归夹具要求「实现者自产自验、证据本身通过、状态仍为有证据待验证」这一状态可达。真正 blocked 的只有结构性能力缺失（ADR 0011 §2：原生记忆关不掉时不得承担独立验证——该组合在 `purpose='validate'` 下为 blocked，在 `purpose='execute'` 下为 selectable 并附后果说明）。

### 4.3 派工与介入

| Method + Path | 语义 | 关键错误码 |
|---|---|---|
| `POST /api/rooms/:roomId/dispatches` | 确认派工。`Idempotency-Key` → `client_request_id`；重复确认返回同一 draft | `DISPATCH_GATE_PAUSED` 409、`DISPATCH_ACCEPTANCE_LOCKED` 409、`ELIGIBILITY_STRUCTURAL_BLOCK` 422、`REPO_PATH_UNAUTHORIZED` 403 |
| `POST /api/dispatches/:id/cancel` | 撤销窗口内取消 | `DISPATCH_NOT_CANCELLABLE` 409（已 `starting` / 终态） |
| `POST /api/dispatches/:id/start-now` | 放弃剩余撤销窗口立即 claim | `DISPATCH_NOT_CANCELLABLE` 409 |
| `GET /api/dispatches/:id` | Dispatch + 快照 + Attempt 列表 | — |
| `POST /api/attempts/:id/cancel` | 只终止目标 Attempt | `ATTEMPT_NOT_ACTIVE` 409 |
| `PUT /api/gates/:scopeType/:scopeId` | `{state, reason}`；pause / resume | `GATE_SCOPE_UNKNOWN` 404 |
| `GET /api/runtime/machines/local` | 运行时概览投影 | — |
| `GET /api/runtime/adapters/:adapterConfigId` | 单 adapter 事实 | — |

**不变量 14 的实现侧断言**：`POST /dispatches`（confirm）与 deadline claim 两处都要查询该 Issue 的 acceptance case；处于 `finalizing` / `completed` 时返回 / 记录 `DISPATCH_ACCEPTANCE_LOCKED`，claim 路径写 `start_failed` 而非创建 Attempt。v0.3 不支持重开已完成验收，替代路径是新建任务。

### 4.4 事件与 commit 点

| 事件 | commit 点 | payload 关键字段 |
|---|---|---|
| `dispatch.drafted` | 确认事务 | `dispatch_id`、`room_id`、`issue_id?`、`identity`、`context_scope`、`grace_deadline_at`、`requirements_hash` |
| `dispatch.cancelled` | 撤销 CAS 事务 | `dispatch_id`、`actor`、`cancelled_at` |
| `dispatch.starting` | deadline claim 事务 | `dispatch_id`、`lease_owner`、`lease_expires_at` |
| `dispatch.context_filtered` | 启动事务 | `dispatch_id`、`scope`、`filtered:[{source_ref, reason}]`、`content_hash` |
| `dispatch.dispatched` | 启动事务 | `dispatch_id`、`attempt_id`、`run_id`、`start_mode`、`cold_start_reason?` |
| `dispatch.start_failed` | 启动失败事务 | `dispatch_id`、`reason_code`、`diagnostics` |
| `dispatch.requirement_overridden` | 确认事务 | `dispatch_id`、`requirement_id`、`strength`、`actor` |
| `gate.paused` / `gate.resumed` | gate 事务 | `scope_type`、`scope_id`、`revision`、`reason`、`actor` |
| `attempt.cancelled` | 取消事务 | `attempt_id`、`dispatch_id`、`preserved`、`voided` |
| `session.converted` | 转任务事务 | `room_id`、`issue_id` |

所有广播统一消费 commit 后的 outbox，**事务提交前不得启动进程或广播成功事件**（不变量 7）。事件正文只放 ref 与稳定码，不放 prompt 正文与密钥。

### 4.5 DomainOutbox 公共 contract（F011 按此依赖）

```ts
enqueue(tx: Tx, e: { topic: string; payload: unknown; dedupeKey: string }): string;   // 与领域事务同一 tx
claimBatch(worker: string, n: number, leaseMs: number): OutboxEvent[];               // pending/available 且未被租用
ack(eventId: string, consumer: string): void;                                        // 幂等
fail(eventId: string, code: string, detail: string): void;                           // 退避重投或转 poison
```

- **原子性**：`enqueue` 必须接收调用方事务句柄；没有事务句柄的 enqueue 在类型层不可调用。
- **重试**：`available_at = now + min(base * 2^attempts, cap)`；预算用尽转 `poison`，**不自动跳过**，保留 `last_error_code` / `last_error_detail` 与完整 payload 供人工恢复。
- **幂等**：消费者按 `event.id` 去重；重复投递不得产生第二次业务效果。
- **消费者**：`dispatch.*` 广播（本 Feature）与 `acceptance.completed`（F011 的 `IssueService.consumeAcceptanceCompleted()`）。F011 只在其完成事务内调用 `enqueue`，不复制 schema、不新建第二套 outbox、不退回内存广播。

### 4.6 供 F011 的只读契约

```ts
// 执行态查询：F011 complete 门与 presentation state 用它，不直读本 Feature 的表
getExecutionState(issueId): {
  open_dispatches: { id: string; state: 'draft' | 'starting' }[];
  active_attempts: { id: string; dispatch_id: string; state: 'queued' | 'running' }[];
  pending_permissions: { id: string; kind: string }[];
}

// 独立性快照：F011 IndependenceEvaluator 的唯一输入，不持久化为可编辑状态
getIndependenceSnapshot(dispatchId): {
  purpose: 'execute' | 'validate' | 'design_cases';
  context_scope: 'all' | 'result_only' | 'goal_only';
  start_mode: 'cold' | 'resumed';
  includes_implementer_narrative: boolean;
  native_memory_isolation: 'supported' | 'unsupported' | 'unverified';
  execution_identity: { runtime_id: string; adapter_config_id: string; model: string; depth_normalized: string };
  producer_identity: { runtime_id: string; adapter_config_id: string; model: string } | null;
  same_source: boolean;   // 与 producer 在 (adapter_config_id, model) 上相同
}
```

判定口径由本 Feature 拥有并冻结：`same_source === true`、`context_scope === 'all'`、`start_mode === 'resumed'`、`native_memory_isolation !== 'supported'` 四者任一成立即**不满足独立性**；**unsupported 与 unverified 都不能承担依赖该能力的独立验证**。F011 只读取结果并投影为用户可见三态，无权手写或提升。

## 5. Runtime、Workflow 与并发

### 5.1 三条合法路径与撤销窗口

Dispatch 只有三条合法路径：`draft → cancelled`、`draft → starting → dispatched`，以及确定性启动失败时的 `draft → starting → start_failed`。

**撤销窗口默认 10 秒**，由设置项 `dispatch.grace_window_ms` 控制（合法范围 0–60000，默认 10000）；取 `0` 表示不设窗口、确认即 claim。图内节点派工固定取 `0`（§2.1）。用户可用 `start-now` 放弃剩余窗口。deadline worker 扫描周期固定 1 秒，时间基准统一取数据库事务时间，不依赖进程本地时钟差。

### 5.2 确认事务（commit 点 1）

一个事务内：按 `(room_id, client_request_id)` 幂等插入 `draft` Dispatch（命中既有行则直接返回同一 draft，不写第二条事件）、写 eligibility 与要求快照、写 `dispatch.drafted` outbox、必要时写 `dispatch.requirement_overridden`。确认前查三层 gate 与 acceptance 锁；此时**不组装上下文、不创建 Attempt / Run、不 spawn**。

### 5.3 claim 与启动事务（commit 点 2–3）

1. deadline worker 对到期 draft 做 CAS：`state='draft' → 'starting'` 并同时写入 `lease_owner` 与 `lease_expires_at`（租约默认 120 秒）。撤销与该 CAS 竞争时**只有一个能成功**；`starting 不再接受撤销`，用户此后只能取消 Attempt。commit 点 2 写 `dispatch.starting`。
2. 取得租约的 worker 组装上下文：按 `context_scope` 三档收集 refs → 调 F013 `verifyAuthorization()`（机器路径授权 ∩ 项目范围 ∩ `task_scope_json`，真实 realpath 重读）→ 计算 resume 可行性（§5.5）。
3. 启动事务（commit 点 3）在**同一个数据库事务**内写入：context snapshot、Artifact consumption、首个 Attempt / queued Run、`dispatched` 状态、`dispatch.dispatched` 与 `dispatch.context_filtered` outbox。其中 consumption 经 F010 公共 API 写入，并在同一事务内校验 Dispatch 存在且与 `run_id` 归属一致（不变量 12）。
4. **commit 后才 spawn**。commit 与 spawn 之间崩溃留下的是一条 `queued` Run，由 §5.6 的重启恢复接管，不会产生幽灵进程。

组装阶段的确定性失败（ref 不可解析、`ARTIFACT_REF_INVALID`、`REPO_PATH_UNAUTHORIZED`、`DISPATCH_ACCEPTANCE_LOCKED`、模型已从 adapter 消失）写 `start_failed` + 诊断，**不创建 Run、不伪造 Attempt**；瞬时失败（IO、临时锁）不写终态，留给租约到期后由新 owner 重做。

### 5.4 pause / claim 线性化

`dispatch_gates` 的读与 claim 的 CAS 必须在同一数据库临界区完成：claim 语句的 WHERE 条件同时包含 `state='draft'` 与「三层 gate 的 `state='open'` 且 `revision` 未变」。因此不存在「pause 已提交但仍漏启动一个 Run」的窗口。pause 只阻止新 Attempt 的产生，**running Attempt 继续执行**（PRD §5.10 / §7.3）；恢复只需把 gate 置回 `open`，已错过窗口的 draft 由下一轮扫描继续 claim。

取消 Attempt 只终止目标 Attempt 与其 Run，不改 Dispatch 的 `dispatched` 事实，也不影响同 Issue 的其他 Attempt。改派 = 新建 Dispatch，历史 Dispatch 与快照一律不改写（PRD §7.3）。

### 5.5 resume key 与强制冷启动

resume key = `(执行组合, Issue, Room, 上下文范围)`，四项全等且上一 session 可恢复时才 resume；执行组合含 `runtime_id`，v0.3 恒为 `'local'`，多机落地前不得跨机器假定原生 session 可用。

下列任一成立即**强制冷启动**，并把原因写入 `attempts.cold_start_reason`（ADR 0009 §4 五条，逐条落地）：

| `cold_start_reason` | 触发条件 |
|---|---|
| `user_restart` | 用户明确选择重新开始 |
| `session_unusable` | 上下文溢出、session 损坏或上游拒绝恢复 |
| `poisoned_predecessor` | 上一次执行因中毒 / 不可信输入终止 |
| `independence_required` | `purpose` 为 `validate` 或 `design_cases` |
| `memory_isolation_unavailable` | 该 adapter 的原生记忆无法关闭或关闭效果无法验证 |

resume 失败只影响本次启动方式：**不改写上一个 Attempt**，新建 Attempt 并记录「请求续跑但已冷启动」，轨迹据此显示降级（ADR 0009 §6）。`supportsSessionResume` 一律取 capability evidence 的裁决，不按 provider 名推断。

每个 Attempt 落库的持久事实固定为：context scope 与每项 included / filtered / reason、`start_mode`、`provider_session_id`（如有）、`resumed_from_attempt_id`、执行组合 + `runtime_id` + Skill revisions + Handoff refs、`cold_start_reason`（ADR 0009 §5）。历史记录不回查当前 adapter 配置。

### 5.6 重启恢复

启动时按固定顺序扫描四类残留：

1. **到期 draft**：正常进入 claim 流程；
2. **过期 starting lease**：由新 owner 复用同一 Dispatch 与同一幂等键续做，**不得新建第二个 Attempt**——续做前先查该 Dispatch 是否已有 `seq=1` 的 Attempt，有则跳到 spawn 阶段；
3. **queued Run**：重新 spawn（这是 commit 后崩溃留下的正常状态）；
4. **running Run**：沿用既有 `StaleRecoveryService`，但把「新进程启动说明旧进程已不存在」这条推断提成具名函数 `isRunOwnerDead(run): boolean`，v0.3 实现体为 `return true` 并在注释中写明依据是单进程假设（ADR 0015 §3）。多机落地时只改这一个函数体。

pause intent 随 `dispatch_gates` 持久化，重启后自动生效，不需要用户重新点一次。

### 5.7 原生 memory 关闭（ADR 0011）

每次执行在私有 home / 私有 config 中关闭原生 memory 的**读与写两侧**，绝不修改用户全局配置文件。关闭动作的结果作为 `native_memory_isolation` 能力证据回写；关闭失败或无法验证时该能力记 `unsupported` / `unverified`，并按 §4.2 影响 eligibility 与 §4.6 的独立性判定。

## 6. UI 与可观测性

### 6.1 路由与槽位

在 F009 已冻结的 SurfaceRegistry 中注册 `/sessions/:sessionId`（`sessionId` = `rooms.id`）——这是 F009 显式移交给本 Feature 的路由（「F012 发布 Session ID 后才注册 `/sessions/:sessionId`」）。deep link 必须可刷新恢复，History 前进 / 后退重放 URL。其余派工 UI 直接接入 F009 稳定槽位与共享交互原语，**不复用 F011 shell**（依赖序是 F012 → F011）。

### 6.2 派工选择器与撤销横幅

任务面 / 会话面底部唯一输入框打开选择器：模型、思考深度、上下文范围各自独立选择（不合并成预设），右侧列三档候选与逐条理由 + 要求来源。`blocked` 项置灰但可见，写明原因与替代路径。

- 验证类派工默认「只给结果 + 冷启动」，生成验收用例默认「只给目标 + 冷启动」；改回「全部」时必须提示并在结论侧降级为「有证据待验证」（ADR 0009 §3）。
- 确认后**立即**出现撤销倒计时横幅（draft 期），提供「撤销」与「立即开始」两个动作；进入 `starting` 后横幅改为启动进度，只保留「取消 Attempt」——撤销入口此时消失，与「starting 不再接受撤销」一致。
- 只有真实创建派工记录后才显示「已指派」；窗口内撤销不产生任何执行记录（V3.44 §5）。

### 6.3 会话面与运行时面

会话面复用 F009 的消息骨架：用户消息靠右、执行组合消息靠左、工具事件折叠在对应消息内；tab 区分独立会话与任务会话。Room 切换保留草稿（以 Room ID 为 key）。Thread ID 不出现在任何用户可见位置。

运行时面（PRD §5.10 / V3.44 §3.7）：左栏一台执行机器一行，v0.3 恒为一行；右侧先概览、之后每个 adapter 一个 tab。

| 区域 | 内容 | 来源 |
|---|---|---|
| 机器概览 | adapter 列表、执行组合表、工作区锁、队列深度与当前 running、后台任务 | `RuntimeProjectionService`（接管 `runtime-health.ts` 的 workspace 维度读数） |
| adapter tab | 状态（仅在线 / 离线）、接入方式、额度、可用模型卡片、只读运行中清单、完整工具表（CLI 内置 + MCP） | adapter facts + capability evidence |
| 全局闸门 | 「暂停全部派工」= `runtime` 层 gate，确认前后持续展示影响与恢复入口 | `dispatch_gates('runtime','local')` |

运行时**不提供停止具体任务的按钮**；停止执行在任务面。额度按 ADR 0017 §4 分别标注 `authoritative`（adapter / provider 自报）与 `estimated`（本地价表），缺失显示 `—` 并说明未覆盖范围，不用 `0` 冒充。

**遮罩**（PRD §8.3）：`api_key` 与 `provider_session_id` 默认遮罩，显式操作才能查看，保存后不回显；`provider_session_id` 不进入普通导出、插件与 Memory，诊断导出必须遮罩（ADR 0009 §5）。

### 6.4 可观测性

每次执行都能回答「由什么组合、在哪台机器、看过什么、为何可选」（SC-001）：组合与 `runtime_id` 来自 `identity_snapshot_json`，「看过什么」来自 context snapshot 的 included / filtered 逐项，「为何可选」来自 capability snapshot 的三态裁决 + 证据时间 + CLI 版本。异常必须区分失败、中断、取消、排队、权限阻塞与验证未收敛，并在动作前说明保留什么、作废什么、不动什么（PRD §7.3）。

## 7. 失败、恢复、安全与兼容

### 7.1 失败分类

| 类别 | 表现 | 处理 |
|---|---|---|
| 确定性启动失败 | ref 不可解析、路径未授权、acceptance 已锁、模型消失 | `start_failed` + 诊断，零 Run |
| 瞬时启动失败 | IO / 锁竞争 | 不写终态，租约到期后重做 |
| 执行失败 | Run 非零退出 | Attempt `failed`，Dispatch 保持 `dispatched` |
| 中断 | 进程消失 / 服务重启 | Attempt `interrupted`，可从该步恢复 |
| 取消 | 用户动作 | Attempt `cancelled`，保留已产出事实 |
| 投递失败 | outbox 重试预算用尽 | `poison` 保留稳定错误与诊断，不自动跳过 |

### 7.2 安全边界

- **路径授权是应用层过滤，不是 OS 级隔离**——同用户的 agent 进程仍可用绝对路径绕过；按 SOP「结构性隔离与安全边界声明纪律」如实声明，不写成结构性保证。容器 / 受限账户在 v0.7 评估。
- 结构性能力不足**不可 override**；软要求偏离可 override 但持久留痕。
- `api_key` 保持单一消费点：不允许出现第二处读 `AgentRunInput.adapterConfig.api_key` 的代码，新增 adapter 走同一路径取值（ADR 0015 §4）。
- 配置删除或修改不改写历史快照（`identity_snapshot_json` 已冻结当时值）。

### 7.3 兼容与迁移

旧 `AgentConfig` 数据迁移为 adapter 接入事实（§3.8），保留全部历史 ID；v0.1–v0.2 的 Run / Trace / Evidence refs 继续可解析（不变量 8）。F013 在其兼容投影中继续写 `workspace_id` / `workflow_template_id` / `validation_policy_id` 三列，**由本 Feature 接管派工后按 §7.5 删除**对应写入口。

### 7.4 legacy 具名状态

无法判定归属的旧记录不猜测，落到三个具名值之一，并对下游有确定后果：

| 值 | 含义 | 后果 |
|---|---|---|
| `legacy_no_dispatch` | v0.2 及以前直接建 Run，没有 Dispatch | 只读展示；不参与 resume、不计入独立性判定（`producer_identity` 为 null） |
| `legacy_identity_inferred` | 快照缺 `runtime_id`，按 `'local'` 解释 | 可读，标注「推断值」；不得作为多机迁移依据 |
| `legacy_unknown` | 归属无法判定 | 只读，不可作为任何新派工的 resume 来源或证据来源 |

命名与 F011 的 `legacy_unknown` / `legacy_unresolved` 对齐，UI 侧统一显示为只读旧记录。

### 7.5 迁移矩阵 18 行的退场判据（M3）

| 行 | 退场条件 |
|---|---|
| P004 / A025 / A026 / A027 | adapter 列表、CRUD、默认项全部改走本 Feature 的 adapter 接入契约（含 `runtime_id` / `base_url`），旧 `AdapterSettings` 写入口不可达 |
| P006 / A006 / A007 | Dispatch 确认 + 撤销窗口接管创建后派工，旧 intake recommend / confirm 写入口移除，重复提交幂等 |
| P007 / A008 / A009 | Session projection 接管会话读取，`DispatchService` 成为唯一派工写入口，`POST /api/issues/:id/runs` 不可达，Thread 不再外露 |
| A010 / A013 / A014 / A015 | graph 启动、取消、节点重试、executor 重选全部经 `DispatchService` / `EligibilityEvaluator`（§2.1） |
| A011 / A012 | 取消 Run 与 graph 投影读取改走 Intervention API 与 Session / Dispatch projection |
| P010 / A028 | `RuntimeProjectionService` 接管 adapter / 锁 / 队列 / 后台任务读数，`/settings/system-diagnostics` 只保留 schema 事实且无重复入口 |

每行按 `delete_when` 逐条核对后才算 M3 退出；实现中发现遗漏必须先更新矩阵与门禁，再继续迁移。

## 8. 测试策略与验收映射

| AC | 层次 | 关键断言 |
|---|---|---|
| AC-001 | unit + fixture | 四维组合、要求来源、三档 eligibility 在派工前可核对；Dispatch 冻结 Skill revision 与 effective requirements，Skill 升级 / 禁用后按旧 ref 解析逐字节不变 |
| AC-002 | integration + 故障注入 | 撤销期取消保留一个 `cancelled` 且零 Run；超时、重复确认、cancel / claim 竞态、重启只产生一个 Dispatch 与首个 Attempt；逐个 transaction seam 注入失败并断言 commit 前零 spawn；每个事件恰好对应其 commit 点 |
| AC-003 | integration + 真实 CLI | resume / 冷启动五条触发条件各一例；三档上下文组装与过滤披露正确；`content_hash` 可从 refs 重建 |
| AC-004 | concurrency + restart | pause / claim 线性化（并发下不漏启动）、取消只影响目标 Attempt、改派不改写历史、重启保留 pause intent 与过期 lease 续做不产生第二个 Attempt |
| AC-005 | browser + migration fixture | 独立会话与任务会话旅程、转任务、单机运行时基础；`/sessions/:sessionId` 刷新恢复；历史 fixture 迁移后 ID 与 refs 不变 |
| AC-006 | fixture 变异 | 三个 adapter 各自的 supported / unsupported / unverified fixture 做变异（删字段、改 CLI 版本、过期证据），证明缺证据不能进入依赖该能力的独立验证，且不可被 override 旁路 |
| AC-007 | integration + restart | `enqueue` 与领域事务原子提交；worker 崩溃 / 重启后重投递不丢不重；consumer ack 幂等；预算用尽转 poison 且保留稳定错误与诊断；F011 `acceptance.completed` 与 Dispatch 广播走同一实例 |

真实环境测试按 SOP「真实环境测试纪律」在本机直接执行，不得标记为待用户验证；客观不可执行时显式记录缺失项与重跑命令，并按 `unverified` 处理。

## 9. 已确认决策与残余风险

### 9.1 本轮拍板的设计假设（原为检视中的开放冲突，依据已列，如需改变请在开工前提出）

1. **同源模型 = 可派工但结论降级**，只有结构性能力缺失才 `blocked`（§4.2）。依据：PRD §5.8 约束的是结论显示、ADR 0009 §3 的降级机制、F011 回归夹具要求「同源验证降级」状态可达。
2. **独立会话可以派工**，产物在转任务前不进 Artifact / Evidence / Memory 链；幂等键改为 `(room_id, client_request_id)`（§3.2、§4.1）。依据：V3.44 §3.2 独立会话用于讨论，讨论本身需要执行组合参与；可空 `task_id` 无法承载唯一约束。
3. **撤销窗口默认 10 秒、可配置 0–60000ms，并提供「立即开始」**（§5.1）。依据：AC-002 与 E2E 需要确定时长才能断言；`0` 同时满足图内节点不弹窗的需要。
4. **PRD §5.10 的「暂停全部派工」纳入 v0.3**，实现为 `dispatch_gates` 的 `runtime` 层（§3.6、§6.3）。依据：v0.3 只有一台机器，三层闸门共用一套机制，额外成本仅一行数据，后移反而要在 v0.7 重做语义。

### 9.2 已确认决策

Room 不拥有执行状态，Thread 不露出；Dispatch 与 Run 分离，Attempt 是两者之间的一等对象。每项能力只允许 supported / unsupported / unverified；**unsupported 与 unverified 都不能承担依赖该能力的独立验证**，普通执行若不依赖该能力则可保留为带后果说明的候选。原生记忆无法关闭的 adapter 不能承担独立验证。深度能力必须从 adapter 探测，不硬编码三档都可用：probe 产出 `depth_raw`（原生档位原文）与 `depth_normalized`（三档映射），映射关系由 capability evidence 固化；无法映射的档位不进入候选，并在运行时面写明原因。不保留 AI 成员兼容抽象。

### 9.3 残余风险

| 风险 | 处置 |
|---|---|
| 三个 CLI 的 resume / 原生 memory 行为可能随版本变化 | 证据带 CLI 版本，版本不匹配即降级为 `unverified` 并要求重跑 probe |
| 路径授权是应用层过滤 | 已如实声明（§7.2），容器 / 受限账户在 v0.7 评估 |
| `run_usage`（ADR 0017 §5）在 v0.4 才建表 | 本 Feature 保证 `attempts` / `dispatches` 的 ID 与维度字段满足其引用形状，避免 v0.4 回填 |
| F011 / F013 尚未实现，字段名可能微调 | §4.5 / §4.6 的契约形状冻结，字段名调整不得改变原子 enqueue、未知不独立、poison 不跳过三个不变量 |

## 10. 待确认设计问题

无。
