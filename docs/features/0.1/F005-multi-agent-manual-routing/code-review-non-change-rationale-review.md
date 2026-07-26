# F005 “不改动”理由复核

**复核日期**：2026-07-24  
**复核对象**：`code-review-report-final-recheck-3.md` 中两条“有意保留 / 有意未处理”说明  
**结论**：两条理由都可以解释“为什么暂缓”，但都不能据此关闭 finding 或认定 F005 已满足 AC-001。第一条理由不足以支持长期不改；第二条属于合理的架构延期，但必须保留未完成状态，或明确收窄本期产品范围。

> **二次追加（2026-07-24，同日）**：本复核指出的两个 finding 均已按各自 Suggested Fix 实施完成，可以关闭。① create/update 语义：不再凭命令可解析即写 `Available`，统一先落 `Unknown`，异步真实 provider `validate()` 收敛后才置 `Available`（并按需应用 default-adapter 分配）。② workspace-aware availability：已引入完整的 `(adapter, workspace)` 状态模型——schema v7 `adapter_workspace_status` 表作为例外覆盖，`effectiveAdapterStatus()` 统一合并入口，`AdapterResolver`/`ValidationWorkflowService.claimValidatorSlot()`/`RunDispatchService.reprobeAdapterOnFailure()`/`AdapterConfigService.validate(id, workspaceId)` 全部切换。新增单元/集成测试覆盖两者的收敛路径、覆盖表增删查、跨 workspace 不互相影响；server 全量测试（1361 通过）、web 全量测试（162 通过）、typecheck、生产构建均通过。AC-001 现已满足，详见 `spec.md` 第 8 节。

---

## 1. 决策摘要

| 项目 | 对“不改动”理由的判断 | 可否关闭 finding | 对 F005 状态的影响 |
| --- | --- | --- | --- |
| create/update 仅凭命令可解析即写 `Available` | **不充分**。默认 adapter 和测试受影响属于改动成本，不是保持错误可用性语义的技术依据 | **否** | AC-001 继续未满足，F005 保持 `review` |
| workspace-aware availability 未引入 `(adapter, workspace)` 状态模型 | **有条件合理**。确实涉及 schema、repository、resolver、validator selector、API/UI 和收敛逻辑 | **否，只能延期** | 必须继续标记限制；若本期要完成，则需收窄能力或补齐模型 |
| proxy URL 中可能携带凭据 | 已实际修复，不属于“不改动”项 | **可以关闭** | 针对性 37 tests 通过 |

---

## 2. Finding：第一条“不改动”理由不足以成立

### 结论

`code-review-report-final-recheck-3.md:93` 所述“会牵连自动默认逻辑和大量测试”可以作为排期影响说明，但不能作为接受当前行为的理由。

### 证据

- `server/src/services/adapter-config.ts:56-64` 明确知道 `resolveExecutable()` 只证明文件可解析，却仍返回 `available: true`。
- `server/src/services/adapter-config.ts:181-205` 将该结果直接持久化为 `Available`，并可能自动设为 Project default。
- `server/src/services/adapter-config.ts:260-269` 在修改 command 后采用相同判定。
- `server/src/services/adapter-config.ts:320-345` 修改 auth type、provider、API key 或 model 时，除清空 API key 的特例外，没有让旧的 `Available` 失效。
- `design.md:252-259` 要求以真实 auth/provider probe 决定可用性，并明确规定不得用 version 成功误判登录成功。
- `design.md:694-701` 再次规定 OAuth 未登录或过期时必须 unavailable。

现有测试依赖“创建后立即可用”，只能说明修改时需要同步更新测试，不能证明该行为正确。自动设置 default 也不要求 adapter 必须未经 probe 即可 dispatch：可以保留默认选择关系，同时在真实 validate 成功前阻止运行；或者在首次 validate 成功后再自动设为 default。这是需要产品选择的 UX 细节，不是必须维持错误状态语义的架构阻碍。

### 建议判定

- 允许作为**临时延期**，前提是 AC-001 保持未勾选、F005 保持 `review`。
- 不应标成“无需修改”“风险已接受”或关闭 finding。
- 若计划把 F005 标为 `done`，本项应先修复：
  1. command 可解析时初始状态写 `Unknown`；
  2. 只有显式真实 probe 成功后写 `Available`；
  3. command/auth/provider/key/model 改动使旧验证结论失效；
  4. 明确 default 的创建时机，并更新相应测试。

### 建议替换原说明

> **暂缓，finding 保持 open**：当前 create/update 的可用性语义与 AC-001、design §5.2/§12 不一致。修复会影响首次 default 的交互时机及现有测试，因此需补充产品决策并单独实施；在完成前 F005 保持 `review`，不得据此标记 AC-001 或 F005 完成。

---

## 3. Finding：第二条理由属于合理延期，但不是问题关闭

### 结论

`code-review-report-final-recheck-3.md:147` 对改动规模的判断基本合理。当前 probe 维度已经包含 workspace，而持久化和消费维度仍只有 adapter，完整修复确实不是一个局部补丁。

### 证据

- `server/src/services/adapter-config.ts:430-467` 按 workspace 的 `push_credentials_enabled` 探测，但仍写唯一的 adapter 全局 status。
- permissive workspace 探测成功时写 `Unknown`（`:454-456`），而 `server/src/services/adapter-resolver.ts:22-48` 只接受全局 `Available`，因此该 workspace 自己也无法消费成功结果。
- `server/src/services/run-dispatch.ts:189-222` 将某个 workspace 的 re-probe 失败写成 adapter 全局 `Unavailable`，可能影响其他 workspace。
- API 已接受可选 `workspace_id`，但 `web/src/components/adapter/AdapterSettings.tsx:205` 的 Validate 操作只传 adapter id，当前 UI 无法选择或表达 workspace 维度。

因此，新增 `(adapter_config_id, workspace_id)` 状态表、读写仓储、resolver/selector 输入、API/UI 表达和迁移测试，确实应作为独立架构工作规划。

### 可以接受延期的条件

以下两种路径二选一：

1. **保留现有目标范围**：创建明确的后续任务，补齐 workspace 级状态模型；AC-001 和 F005 在任务完成前保持未完成。
2. **收窄本期范围**：不宣称 workspace-aware availability 已交付，禁用或移除当前无法被路由消费的半成品路径；明确 Windows credential-isolated OpenCode OAuth 不支持，只支持可在隔离环境工作的认证方式。完成收窄后的验收与文档一致性检查后，再重新判断 F005 状态。

仅写“后续排期”但没有任务标识、目标范围或完成条件，容易让该问题永久悬空。建议至少记录负责人、后续 issue/task ID、验收标准和它是否阻塞 F005。

### 建议替换原说明

> **架构延期，finding 保持 open**：完整修复需要新增 `(adapter, workspace)` 持久化与查询模型，并贯穿 validate、resolver、ValidatorSelector、dispatch failure convergence 及 UI。该工作另行排期；在完成或正式收窄 Windows OpenCode OAuth 能力范围前，AC-001 保持未勾选，F005 保持 `review`，现有后端路径不得描述为可被路由完整消费的已交付能力。

---

## 4. 检视文档自身需要更新

最新代码已经修复 proxy URL 凭据继承问题：

- `server/src/runtime/workspace-context.ts:59-70,125-130` 对 `HTTP_PROXY`、`HTTPS_PROXY`、`ALL_PROXY` 解析 URL，并丢弃带 username/password 或格式非法的值；
- `NO_PROXY` 不经过 URL 解析，仍可正常继承；
- 相关针对性测试通过。

但 `code-review-report-final-recheck-3.md:21-23,45,153` 仍把 proxy finding 描述为未关闭。建议在原报告中追加“已修复”处理结果，并同步更新 Executive Summary、状态矩阵和 finding 状态，否则该报告内部会同时存在旧结论与新代码事实。

另有一处很小的文档卫生问题：`tasks.md:34` 存在行尾空格，导致 `git diff --check` 失败。

---

## 5. 验证记录

- `npm run test --workspace=server -- --run tests/integration/credential-isolation.test.ts tests/unit/workspace-context.test.ts`
  - 2 files passed
  - 37 tests passed
- `npm run typecheck`
  - Server passed
  - Web passed
- `git diff --check`
  - 未通过：`tasks.md:34` trailing whitespace

---

## 6. 推荐解决方案

### 6.1 问题一：分离“命令存在”“默认选择”和“真实可用”

#### 推荐状态规则

```text
command 无法解析                  -> Unavailable
command 可解析、尚未执行真实 probe -> Unknown
目标环境真实 auth/provider probe 成功 -> Available
真实 probe 失败                   -> Unavailable
```

`resolveExecutable()` 只能决定前两种状态，不得再直接产生 `Available`。只有 `AdapterConfigService.validate()` 的真实、非交互 probe 成功后才能写入 `Available`。

#### default 与 availability 解耦

推荐允许 `Unknown` adapter 被用户设置为 Project default，但 resolver 在它验证成功前拒绝 dispatch。两者分别表达：

- default：用户希望未显式选择时使用哪个 adapter；
- availability：这个 adapter 在目标 workspace 最近是否经过真实验证。

这样可以保留用户的默认选择意图，同时避免未经认证验证的 adapter 获得运行权限。错误应明确返回“默认 adapter 尚未验证 / 当前 workspace 不可用”，不得随机 fallback 到其他 adapter。

首次创建 adapter 时可以继续记录 `make_default`，也可以保留“Project 尚无 default 时自动选中首个配置”的 UX；但“被选为 default”本身不能将状态提升为 `Available`。

#### create/update 改造

建议修改 `server/src/services/adapter-config.ts`：

```ts
function getInitialCommandStatus(command: string): AdapterStatus {
  const { resolved } = resolveExecutable(command);
  return resolved ? AdapterStatus.Unknown : AdapterStatus.Unavailable;
}
```

create 时：

```ts
const status = getInitialCommandStatus(trimmedCommand);
```

update 时按字段分类：

| 变化字段 | 新状态 |
| --- | --- |
| `name`、role、`capability_tags` 等不影响执行的字段 | 保留原状态 |
| `command` 可解析 | `Unknown` |
| `command` 不可解析 | `Unavailable` |
| `auth_type`、`api_key`、`model_provider`、`default_model`、影响启动/认证的 `args` | `Unknown` |
| API-key 模式下 key 被清空 | `Unavailable` |

状态变为 `Unknown` 或 `Unavailable` 时，应同步清除过期的成功验证信息：

```ts
updates.last_checked_at = null;
updates.auth_status_message = null;
```

如果当前 repository/type 不允许 `last_checked_at = null`，应先补齐 nullable update 类型，而不是保留一个与新配置无关的旧时间。

#### UI 行为

- 新建成功后展示“未验证”，不要展示“可用”。
- 提供明确的 `Validate` 操作；可以在创建成功后引导用户点击，但不建议悄悄执行可能较慢的 probe。
- default 为 `Unknown` 时展示“默认，但尚未验证”。
- dispatch 被阻止时提示验证目标 workspace，而不是只显示笼统的 `ADAPTER_UNAVAILABLE`。

#### 必测场景

1. command 存在但 OAuth 未登录：create 返回 `Unknown`，不能 dispatch。
2. command 不存在：create/update 返回 `Unavailable`。
3. validate 成功：`Unknown -> Available`。
4. validate 失败：`Unknown/Available -> Unavailable`。
5. 已验证 adapter 修改 key/provider/model/command：旧 `Available -> Unknown`。
6. API-key adapter 清空 key：`Available -> Unavailable`。
7. `Unknown` adapter 可以成为 default，但 resolver 拒绝执行并返回准确错误。
8. 只修改名称或 capability：不使验证状态失效。

### 6.2 问题二：建立真正的 workspace 级 availability

#### 数据模型

新增 workspace 级验证结果表，不再用一个 adapter 全局 status 表示所有 workspace：

```sql
CREATE TABLE adapter_workspace_status (
  adapter_config_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  status TEXT NOT NULL,
  last_checked_at TEXT,
  auth_status_message TEXT,
  adapter_revision INTEGER NOT NULL,
  PRIMARY KEY (adapter_config_id, workspace_id),
  FOREIGN KEY (adapter_config_id) REFERENCES agent_configs(id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);
```

建议同时在 adapter 配置上增加单调递增的 `revision`。command、args、auth、provider、model 等影响验证结论的字段变化时递增 revision。workspace 状态的 `adapter_revision` 与当前 revision 不一致时，一律按 `Unknown` 处理，从而避免旧 probe 结果和并发写覆盖新配置。

如果暂不增加 revision，也可以在配置变化的同一事务中删除该 adapter 的全部 workspace 状态记录；但 revision 对并发 probe 和问题追踪更稳健。

#### 状态职责

推荐将两种状态彻底分开：

```text
adapter config 状态      -> 配置是否合法、是否禁用
adapter workspace 状态   -> 在指定 workspace 是否真实可运行
```

长期方案是不再让 `agent_configs.status` 承担运行可用性。若为了 API 兼容暂时保留全局 status，它只能作为 UI 汇总值，不能再参与 resolver 或 dispatch 决策。

#### Validate API

将 workspace 从可选上下文收紧为有效性判断的必需输入：

```http
POST /api/adapters/:adapter_id/validate
Content-Type: application/json

{
  "workspace_id": "workspace-id"
}
```

服务端必须校验 adapter 和 workspace 属于同一 Project。probe 结果只写对应的：

```text
(adapter_config_id, workspace_id)
```

不得再因为一个 workspace 成功或失败而修改其他 workspace 的运行可用性。

#### Resolver 与 dispatch

将 resolver 签名调整为包含目标 workspace：

```ts
resolveAdapter(
  deps,
  projectId,
  workspaceId,
  explicitAdapterId,
)
```

显式 adapter、Project default 和 ValidatorSelector 都必须按同一规则查询：

```text
config 合法且未禁用
AND workspace status = Available
AND workspace status.adapter_revision = adapter.revision
```

未找到 workspace 状态、状态为 `Unknown`、revision 过期时都不得 dispatch，并返回可区分的错误，例如：

- `ADAPTER_NOT_VALIDATED_FOR_WORKSPACE`
- `ADAPTER_UNAVAILABLE_FOR_WORKSPACE`

#### 失败收敛

Run 因认证、provider、spawn 或隔离环境问题失败后，re-probe 只更新失败 Run 对应 workspace：

```ts
workspaceStatusRepo.update(
  run.adapter_config_id,
  run.workspace_id,
  {
    status: AdapterStatus.Unavailable,
    last_checked_at: now,
    auth_status_message: sanitizedMessage,
    adapter_revision: currentAdapter.revision,
  },
);
```

如果 probe 开始后 adapter revision 已变化，必须丢弃旧结果。

`push_credentials_enabled` 等影响运行环境的 workspace 设置发生变化时，只使该 workspace 的全部 adapter 验证结果失效，不影响同 Project 的其他 workspace。

#### UI

Adapter Settings 的 Validate 操作必须让用户选择 workspace，或者在已有 workspace 上下文的页面自动带入。推荐展示每个 adapter 的 workspace 状态：

```text
OpenCode
  Workspace A  Available       checked 10:32
  Workspace B  Unavailable     OAuth credentials unavailable
  Workspace C  Not validated
```

列表顶部可以展示汇总信息，但汇总值不得替代逐 workspace 状态，也不得用于路由。

#### 迁移策略

现有全局 `Available` 没有可靠的 workspace 来源，不能安全复制到所有 workspace。推荐迁移为：

1. 保留 adapter 配置和 default 关系；
2. 不生成任何 `Available` workspace 记录；
3. 所有 workspace 初始按 `Unknown` 处理；
4. UI 提示用户逐 workspace 重新 Validate。

这是一次保守的短期可用性降级，但不会把某个环境下的历史成功错误扩散成其他 workspace 的运行授权。

#### 必测场景

1. 同一 adapter 在 workspace A 可用、B 不可用，两个状态互不覆盖。
2. A validate 成功后只能在 A dispatch。
3. B validate/re-probe 失败不会禁用 A。
4. default adapter 在 A 可用、B 未验证时，A 成功路由，B 返回未验证错误。
5. validator selector 使用 Issue 的 workspace 状态。
6. adapter 配置改变后，全部旧 workspace 结果因 revision 不匹配而失效。
7. workspace 隔离设置改变后，仅该 workspace 的状态失效。
8. 不同 Project 的 workspace_id 被 validate API 拒绝。
9. 并发 validate 与 adapter update 时，旧 revision 的 probe 结果不能落库生效。
10. 迁移后的旧 adapter 保留 default，但在重新验证前不能 dispatch。

### 6.3 推荐实施顺序

1. 先完成问题一，将 create/update 初始状态改成 `Unknown`，并解耦 default。
2. 新增 adapter revision 和 `adapter_workspace_status` migration/repository。
3. 将 validate 改为强制按 workspace 写入。
4. 改造 explicit/default resolver 和 ValidatorSelector，统一按 workspace 查询。
5. 改造 dispatch failure convergence，只更新失败 workspace。
6. 完成 Adapter Settings 的 workspace 选择与状态展示。
7. 执行保守迁移，并补充上述单元、集成和 UI 测试。
8. 重新核对 AC-001；只有两个问题都关闭，或产品正式收窄并重新定义 AC 后，F005 才可进入 `done`。

---

## 最终意见

当前“不改动”的表述是诚实的，`spec.md:393-395` 和 `CLAUDE.md` 也没有掩盖遗留项；因此作为阶段性交付记录是合理的。但从验收角度：

- 第一条只能视为尚未解决的高优先级产品正确性问题；
- 第二条可以合理延期，但必须继续作为架构欠账和范围限制；
- 两条都不能用于支持 AC-001 勾选或 F005 进入 `done`。

若团队接受 F005 继续保持 `review`，现有延期决策可以保留；若目标是本轮结束后进入 `done`，则至少必须解决第一条，并对第二条做“完整实现”或“正式收窄范围”的明确选择。
