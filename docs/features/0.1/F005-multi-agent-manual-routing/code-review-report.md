---
feature_ids: [F005]
topics: [pre-development-review, requirements-review, manual-routing, validation]
doc_kind: review
created: 2026-07-19
updated: 2026-07-19
---

# F005 代码开发前最终审视报告

**Reviewed**: `spec.md`、`design.md`、`tasks.md`，并对照 F002/F004 当前实现、PRD、SOP 与 BACKLOG
**Language(s)**: Markdown、TypeScript、SQL
**Review Date**: 2026-07-19
**Severity Legend**: 🔴 Critical | 🟠 High | 🟡 Medium | 🟢 Low | 🔵 Info

---

## Executive Summary

F005 已覆盖多 provider、鉴权、handoff、validator race、secret boundary、queue eligibility 和真实 CLI probe 等主要实现面，整体设计已接近可开发状态。但当前仍有 1 个阻塞级事件契约矛盾、4 个高优先级数据/路由语义缺口，以及若干需要在开工前消除的文档不一致。特别是 grace window 开始时尚无 validator Run，却要求立即写入绑定 validator Run 的 `validation.requested`，按现有 F004 contract 无法实现；该问题关闭前不应开始 Phase 9 或依赖该 contract 的实现。

## Findings

### Correctness / Workflow Contract

#### 🔴 Grace window 与 `validation.requested` 事件契约无法同时成立 — `design.md:434, 444-451, 556`

**Severity**: Critical

**Problem**: `design.md` 要求 implementation 完成时立即进入 `Validating`、写入 `validation.requested`，但暂不创建 validator Run。F004 当前的 `validation.requested` 已绑定 `validator_run_id` 和 validator config，后续结果处理也通过 `validator_run_id` 查找该事件。grace 开始时实际 validator 尚未产生，因此无法写出符合现有 contract 的事件；如果先写空 ID，F004 查询、recovery、result submission 和 Evidence Summary 都会失去关联依据。

**Current Design**:

```text
implementation completed
  -> Issue = Validating
  -> write validation.requested
  -> set validation_dispatch_due_at
  -> do not create validator Run yet
```

**Suggested Fix**:

```text
Phase A — pending dispatch transaction
  -> Issue = Validating
  -> freeze round / implementation_run_id / policy snapshot + hash
  -> persist validation dispatch pending state + due_at

Phase B — winner claim transaction
  -> create actual validator Run
  -> clear due_at
  -> write canonical validation.requested with actual validator identity
  -> write run.queued
```

待明确的设计选择：

- 新增 `validation.dispatch_pending` 事件；或
- 新增专门的 pending dispatch 持久化记录；或
- 重新定义 `validation.requested` 为 pending 事件，并增加单独的 validator-selected 事件。

无论选择哪种方案，都必须同步修改 shared payload contract、`findRequestedEvent()`、validation query、result processing、startup recovery、SSE replay 和相应 tasks。不能只增加 `validation_dispatch_due_at` 后沿用原事件查询。

---

#### 🟠 Project default 与自动 validator default 语义混用 — `design.md:361-369, 440, 523-530`; `tasks.md:T053,T067,T093`

**Severity**: High

**Problem**: `AdapterResolver` 定义的 Project default 是 composer 未选择 adapter 时的通用默认值；grace UI 和 validation endpoint 又使用 “Use default validator now” 表述。Project default 可能只有 implementation capability，而 F004 自动路径本来通过 `ValidatorSelector` 选择 validator。若实现者把两种 default 合并，项目即使存在可用 validator，也可能因为通用 default 不具备 validator capability 而错误 Blocked。

**Suggested Fix**:

```text
Project default
  -> only used by ordinary/manual Run creation when adapter_id is omitted

Automatic validator selection
  -> always uses ValidatorSelector
  -> status=available AND capability_tags contains validator
  -> deterministic ordering / workflow constraints remain in effect
```

UI 建议改为 “Start automatic validator now”，避免暗示使用 Project default。若产品确实决定用 Project default 做自动验证，则必须新增“default 必须具备 validator capability”的约束，但这会削弱其作为普通 implementation default 的用途，不推荐。

---

### Data Model / Migration

#### 🟠 v6 没有定义旧 Project 的 default adapter 回填 — `design.md:179, 202`; `tasks.md:T014,T021-T022`

**Severity**: High

**Problem**: v6 新增 `projects.default_adapter_config_id`，但只定义“新建首个 available adapter 时自动设为 default”。升级前的 Project 已经有 Codex adapter；迁移后字段为 `NULL`，新的 omitted-adapter dispatch 将返回 `DEFAULT_ADAPTER_UNAVAILABLE`，造成既有 F002 使用路径回归。

**Suggested Fix**:

```sql
-- 语义示例，实际 SQL 按 SQLite 版本和 repository 约定实现
-- 每个 Project 从 available configs 中按 created_at, id 选择确定性的第一条。
UPDATE projects
SET default_adapter_config_id = (
  SELECT ac.id
  FROM agent_configs ac
  WHERE ac.project_id = projects.id
    AND ac.status = 'available'
  ORDER BY ac.created_at ASC, ac.id ASC
  LIMIT 1
)
WHERE default_adapter_config_id IS NULL;
```

T014 必须增加以下迁移测试：已有一个 available adapter、已有多个 adapter、只有 unavailable adapter、没有 adapter、迁移重跑。

---

#### 🟠 `agent_configs.role` 继续非空，但新 create/update contract 没有写入规则 — `design.md:128-145, 200, 204`; `tasks.md:T026,T028`

**Severity**: High

**Problem**: 新公开 contract 只接收 `capability_tags`，不再接收 adapter `role`；数据库的 `agent_configs.role` 仍然非空，并被称为“兼容/主要展示角色”。文档没有定义多 capability、consult-only 或 capability 更新时该列写什么。如果依赖旧默认值 `implementation`，validator-only 或 consult-only adapter 会持久化误导性角色，形成新的双真相源。

**Suggested Fix**: 在开工前选择并固化一种方案：

1. 推荐：把 `role` 明确标为 deprecated internal field，不再展示；定义确定性的兼容写入规则，并覆盖 consult-only 情形。
2. 或新增显式 `primary_capability` 字段，由 UI/DTO 使用，旧 `role` 只为迁移兼容。
3. 若继续使用 `role` 展示，则 create/update contract 必须接收并校验 primary role，且说明它绝不参与 routing。

对应 repository、service 和 migration 测试需要断言 role/capability 更新后的稳定语义。

---

### Routing / Capability Model

#### 🟠 `Consult` capability 已公开配置但不参与路由判定 — `design.md:88-92, 137, 381-385, 519`; `tasks.md:T026,T051-T052`

**Severity**: High

**Problem**: 设计定义并让用户配置 `AgentCapability.Consult`，但 routing classifier 在 adapter 未命中 expected role 时无条件创建 consult Run，并不检查 `Consult` capability。因此用户取消 Consult 勾选不会产生任何行为变化，capability 配置和 UI 文案是假的。

**Suggested Fix**: 二选一并同步 spec/design/tasks：

- 如果所有已接入 CLI 天生都能 consult：删除 `Consult` capability 和相关复选框，把 consult 定义为 routing purpose，而非 adapter capability。
- 如果 consult 可以被禁用：显式 consult 和 mismatch fallback 都必须检查该 capability；缺失时返回 `ADAPTER_CAPABILITY_UNAVAILABLE`，不得创建 Run。

---

### Security / Runtime

#### 🟡 Executable resolver contract 无法完整表达 Codex npm shim — `design.md:291-312`; `tasks.md:T009a`

**Severity**: Medium

**Problem**: 文档把 `.cmd` shim 解析描述为“解析出真实 exe 路径”，但本机 `codex.cmd` 实际转发为 `node.exe + codex.js + 用户参数`，不是单一目标 exe。若 resolver 只返回路径，Codex 无法在 `shell=false` 下保持原行为。尝试通用解释任意 `.cmd/.bat` 还会扩大命令注入和错误解析风险。

**Suggested Fix**:

```ts
interface ResolvedExecutable {
  executable: string;
  prefixArgs: string[];
  source: "direct" | "verified_shim";
}
```

只支持经过 fixture 固化的 npm shim 形态；解析结果的目标和入口文件必须存在，参数边界不得通过字符串拼接重建。未知/复杂 batch 文件直接标 unavailable，不执行也不回退 `shell=true`。另外将 T009a 拆为 resolver tests 与 implementation 两项，以符合“先测试后实现”的项目规则。

---

### Specification Consistency

#### 🟡 spec 对 Validating 路由和 `adapter_id` 的描述仍互相冲突 — `spec.md:103, 243, 262-276, 333`; `design.md:160-164`

**Severity**: Medium

**Problem**:

- US4/FR-006 表述为 Validating 时手动指定任意 adapter 都成为 validator；FR-007 和 design 实际要求只有具备 validator capability 才命中，否则为 consult。
- IR-002 仍写“`adapter_id` 已必填”，但 F005 contract 已改为 optional，省略时使用 Project default。

**Suggested Fix**:

```text
Validating + selected adapter has validator capability
  -> workflow-bound validator

Validating + selected adapter lacks validator capability
  -> consult（或 capability error，取决于 Consult finding 的最终决定）

adapter_id omitted
  -> resolve Project default
```

同时删除“留到 design 阶段细化”等已经过期的阶段性措辞。

---

#### 🟡 Adapter availability 的实时承诺与 validate-on-demand 设计不一致 — `spec.md:64, 158`; `design.md:232-241, 475-480`

**Severity**: Medium

**Problem**: spec 承诺用户查看 Agents 列表时，过期/失效登录态会显示 unavailable；design 实际只在用户执行 “Validate login” 后更新状态。若 OAuth 在上次验证后过期，列表会继续显示旧的 available 状态。

**Suggested Fix**: 明确 P0 的一致语义：

- list 展示“最近一次验证结果”及 `last_checked_at`，不声称实时状态；
- dispatch/auth failure 必须将 adapter 更新为 unavailable，并保存清洗后的原因；
- 若需要周期性 probe，应明确 scheduler、频率和资源边界；否则标为后续增强。

---

### Process / Traceability

#### 🟡 Feature 状态与当前实现基线尚未统一 — `BACKLOG.md:16`; F005 三件套状态行

**Severity**: Medium

**Problem**: F005 三件套标为 `ready-for-development`，BACKLOG 仍为 `spec`。同时当前工作树存在未提交的 F004 代码改动和 F005 共享文档改动，尚未形成稳定、可追溯的开发基线。

**Suggested Fix**:

1. 先关闭本报告的 Critical/High findings，并更新三件套。
2. 确认当前 F004 改动归属、完成测试并提交。
3. 提交 F005 文档修订后，将 BACKLOG 与三件套统一为同一状态。
4. 再按 SOP 建立隔离分支/worktree 开始实现。

## Positive Observations

- 已正确区分 active validator 与 per-round validator 两条唯一索引，并覆盖终态 Run 冲突。
- validator context 强绑定 `implementation_run_id`，避免 Validating 期间 consult handoff 污染验证对象。
- API key 使用 internal record/public DTO 隔离，且规划了跨 HTTP、event、context、fixture 的 canary 扫描。
- grace window 使用持久化 due time并要求时长可注入，避免 F004 测试等待真实 10 秒。
- queue drain 对 implementation/validator/consult 分角色重验 eligibility，保留 workspace FIFO 与跨 Issue 公平性。
- Claude/OpenCode 对 approval 能力差异的描述诚实，没有把 credential isolation 伪装成统一的前置审批保证。
- `shell=false` 和 shim 解析的安全方向正确，只需进一步收紧 resolver contract。
- tasks 已覆盖真实 CLI probe、secret cleanup、restart recovery、race、SSE replay、UI 与端到端验证，整体可追踪性良好。

## Summary

| Severity | Count |
|----------|-------|
| 🔴 Critical | 1 |
| 🟠 High | 4 |
| 🟡 Medium | 4 |
| 🟢 Low | 0 |
| 🔵 Info | 0 |

**Bottom Line**: 暂不满足代码开发前置条件；先关闭 `validation.requested` 两阶段契约，并明确 default、migration、legacy role 和 Consult capability 四项语义后，再进入实现。
