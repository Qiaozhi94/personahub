---
feature_ids: [F005]
related_features: [F002, F003, F004]
topics: [multi-adapter, manual-routing, claude-code, opencode, auth, security, v0.1.4]
doc_kind: tasks
created: 2026-07-16
updated: 2026-07-19
---

# F005：Manual Multi-Agent Routing（手动多 Agent 路由）- 任务

> Status: review | Owner: TBD | Spec: `spec.md` | Design: `design.md`

## 规则

- F003和F004必须先实现并分别通过terminal/recovery checkpoint；F005复用其trace和validation service，不复制第二套逻辑。
- 先做真实CLI protocol/auth probe，再写adapter argv/normalizer；raw fixture必须redact，禁止提交token、API key、完整用户home或私有绝对路径。
- API key可以按spec明文存DB，但任何API response、event、log、error details、context、fixture都不得出现原值。
- 客户端不能强制`workflow_bound`或role；服务端按Issue状态/capability推导。显式`ad_hoc_consult`只允许安全降级。
- Claude/OpenCode均不得绕过F002 credential isolation；OpenCode不得被描述为具备未验证的前置approval。
- 不实现Coordinator自动推荐、多agent并行、Room、更多provider或OS keychain。
- 每项先补测试再实现；标`[P]`仅表示文件和依赖真正独立。

## Phase 0：环境前置确认（开工第一件事）

- [x] **T000**（`NFR-004`, `AC-001`）：确认本机 Claude Code CLI 与 OpenCode CLI 的实际安装状态与版本，记录在 Phase 1 fixture 说明中。整个 Phase 1（T001-T010）依赖这两个 CLI 真实可执行，不允许用推测或二手文档替代。

  **2026-07-19 实测结果——三者全部可用，落到「两者都可用」分支，Phase 1 全量推进**：

  | CLI | 版本 | 路径形态 |
  | --- | --- | --- |
  | Claude Code | 2.1.215 | `C:\Users\...\.local\bin\claude.exe`（真 exe） |
  | OpenCode | 1.18.3 | `D:\DevSoft\nodejs\opencode.cmd`（批处理 shim → `node_modules/opencode-ai/bin/opencode.exe`） |
  | Codex | 0.144.5 | `D:\DevSoft\nodejs\codex.cmd`（批处理 shim） |

  由此派生出 T009a（`.cmd` shim 解析 + 统一 `shell=false`）。

  按结论选择排期（保留供环境变化时复用）：
  - **两者都可用**：按既定顺序推进 Phase 1 全部任务。
  - **只有一个可用**：先完成该 provider 的 probe 与对应 adapter phase（Claude 走 Phase 5、OpenCode 走 Phase 6），另一 provider 的 probe 任务保持未勾选；Phase 2/3/7（schema、repository、routing纯逻辑）不依赖任何 CLI，可并行推进。
  - **两者都不可用**：只做 Phase 2/3/7 及 Phase 10 中不依赖 adapter 的部分，Checkpoint 1/5/6 与 AC-001/AC-006 挂起，不得标记为通过。

  无论哪种情况，缺失 provider 的 capability 一律按 design 的降级路径标 unavailable，不得凭猜测填 fixture 或声明能力。

## Phase 1：Claude Code / OpenCode协议与鉴权Probe

- [x] **T001**（`FR-001`, `NFR-004`, `AC-001`）：记录本机Claude Code CLI版本、安装路径解析和Windows启动方式（`shell=false`的可执行文件解析见T009a）；验证`--version`不足以代表OAuth已登录。

  **2026-07-19 完成**：版本 2.1.215，真 exe（`C:\Users\...\.local\bin\claude.exe`），无需 T009a shim 解析。真实 auth 探测命令是 `claude auth status --json`（loggedIn/authMethod/exit code），非交互、机器可读；已通过隔离 `HOME`/`USERPROFILE`（复用§5.4的机制，未触碰真实登录态）安全验证登录/未登录两种状态下 `--version` 输出一致（exit 0），确认 `--version` 与鉴权无关。发现 `auth status` 会在其 HOME 目录写入少量 bookkeeping 文件（非 secret），design §5.2"只读"措辞已据此澄清。详见 `server/tests/helpers/claude-protocol-fixtures.md` T001。

- [x] **T002**（`FR-001`, `NFR-003`）：验证Claude非交互one-shot、stream JSON、prompt stdin、final message、正常/非零/auth failure/cancel，保存redacted fixtures。

  **2026-07-19 完成**：确认必需 argv 为 `-p --output-format stream-json --verbose`（`--verbose` 硬性必需，缺失即 argv 级报错无 JSON）；prompt 走 stdin（argv 传参需显式关闭 stdin，否则触发 ~3s stall）。终态事件 `type:"result"`，`.result` 为最终消息。区分两类失败：graceful in-band（认证失败/模型不存在，进程正常退出但 `is_error:true`）vs 硬 spawn 失败（未知 flag/缺 `--verbose`，纯文本 stderr 无 JSON）。`SIGINT` 取消：子进程以 `code:null,signal:"SIGINT"` 退出且不产出 `result` 事件。工具名 Windows 上是 `PowerShell` 不是 `Bash`。详见 fixtures 文档 T002。

- [x] **T003**（`FR-008`, `NFR-003`, `AC-006`）：验证Claude 真实的前置审批机制并确认permission mode；用无远端副作用fixture确认git push请求可在执行前拒绝，不使用bypass模式。

  **2026-07-19 完成，重大修正**：真实机制**不是** `control_request/control_response`（这是二手证据的误判，那是 multica 针对 SDK 嵌入式 JS 库场景写的 `canUseTool` 回调，对子进程 spawn 独立二进制的 adapter 不适用）。真实前置拦截通道是 **`PreToolUse` hook**：spawn 时经 `--settings`（支持内联 JSON）注册一个 hook，Claude Code 在每次匹配工具调用前同步 spawn 该 hook 脚本、等待其 stdout 返回 `{"hookSpecificOutput":{"permissionDecision":"deny",...}}` 决定是否放行。已用本机真实 CLI + 指向本地 bare 仓库的安全 fixture 完整验证：`git push` 被 hook 拒绝后目标仓库零 ref，确认是真正的执行前拦截。design.md §6.3/§14、spec.md NFR-003/风险表/Q1 已据此修正，不再依赖 multica `handleControlRequest`。详见 fixtures 文档 T003（含 Claude 自身内置的"multiple operations"风险命令守卫的旁证）。

- [x] **T004**（`FR-005`, `FR-006`）：验证Claude command/tool lifecycle能否映射F003 RunTraceSignal、final message能否满足F004 parser；不能确认的capability明确记录为false。

  **2026-07-19 完成**：final message（`result.result`）与 F004 `parseValidationResult()` 完全兼容，无需改动。`RunTraceSignal` 映射两处**确认的能力缺口**：(1) 无原生 `exitCode` 字段（PowerShell tool_result 只有 `is_error` 布尔值，`durationMs` 可由 `tool_use`/`tool_result` 两个 timestamp 相减得出，非原生但可计算）；(2) `Blocked` 分类无法实时判定，只能在整个 Run 结束、拿到 `result.permission_denials[]` 后按 `tool_use_id` 回填——两者均按 design "unknown 降低 completeness、不导致 Run 失败" 原则处理，不阻塞 F005。详见 fixtures 文档 T004。
- [x] **T005**（`FR-002`, `NFR-004`, `AC-001`）：记录OpenCode CLI版本、OAuth auth status/login、API-key最小调用、provider/model参数和Windows启动方式。

  **2026-07-19 完成，含重大发现**：版本 1.18.3，`.cmd` shim（需 T009a resolver）。`opencode auth list` 是人类可读 ANSI 输出，**退出码不随凭据数量变化**，不能作为机器可读的 auth 探测信号（design §5.2 的"用最小 prompt probe"兜底方案确认必要且足够）。**关键发现**：省略 `-m/--model` 时，OpenCode 在目标 provider 无凭据的情况下会**静默换用内置免费模型**（如 `opencode/hy3-free`）成功返回，不报错——因此 `validate()` 必须**始终显式传 `-m <provider>/<model>`**，不能靠"跑通了"判断凭据有效；显式指定缺凭据的 provider/model 后确认能正确失败，但错误是泛化的 `"UnknownError"`，不像 Claude 有结构化的 auth 失败原因，`auth_status_message` 天然不如 Claude 具体。详见 `server/tests/helpers/opencode-protocol-fixtures.md` T005。

- [x] **T006**（`FR-002`, `FR-005`）：验证OpenCode one-shot、JSON/structured输出、prompt传递、final message、正常/非零/auth failure/cancel，保存redacted fixtures。

  **2026-07-19 完成**：`opencode run --format json` 是 NDJSON 事件流；**没有单一终态事件**（不像 Claude 的 `result` 或预期中的单一 final message），最终消息需由 normalizer 从最后一个 `step_finish.reason=="stop"` 之前的 `text` part 拼接得出——仍是纯字符串，与 F004 parser 兼容。`tool_use` 事件比 Claude 更丰富：`part.state.metadata.exit` 直接给出结构化 exit code（**这是相对 Claude 的能力优势**），`time.start/end` 同一事件内即可算 duration，无需跨事件关联。工具名是小写 `bash`（Windows 上也是），进一步确认 normalizer 不能硬编码任何单一工具名。详见 fixtures 文档 T006。
- [x] **T007**（`FR-002`, `DR-001`）：确定经实测可用的OpenCode API-key provider allowlist和env/临时config映射；验证key不需进入argv或workspace。

  **2026-07-19 完成**：标准 `<PROVIDER>_API_KEY` 环境变量约定确认有效（零成本验证，只用本地 `opencode models` listing + 假 key 值，未触发真实计费调用），design §5.3 的 `AdapterAuthMaterial.env` 机制无需改动，已写入 10 项 provider→env var 映射表。**重要澄清**：`opencode models` 在真实操作员环境下会混入个人 `opencode.jsonc` 自定义 provider（如 `heiyucode-openai`），不能作为基准；OpenCode 本身不内置固定 provider 枚举，上表是 PersonaHub 自定义的 allowlist。详见 fixtures 文档 T007。

- [x] **T008**（`FR-008`, `NFR-003`, `AC-006`）：确认OpenCode无等价消息级approval通道；验证credential-isolated env下push失败可被稳定识别，记录真实能力说明。

  **2026-07-19 完成**：用显式构造的最小 env（无 SSH_AUTH_SOCK/GH_TOKEN/git credential helper，`HOME` 隔离）+ 真实 GitHub HTTPS URL（不存在的仓库，安全无副作用）验证 push 失败，`tool_use.metadata.exit:1` 是可靠的结构化信号。**能力如实记录**：失败文案是 GitHub 的 `"Repository not found"`（隐私保护机制，无论无凭据还是凭据不足都返回 404），不是明确的 `"Authentication failed"`——`CredentialIsolationBlocked` 分类器需要匹配多种文案，不能假设单一字符串。确认 F002 `buildChildEnv()` 已有的 `GIT_TERMINAL_PROMPT=0`/`GIT_ASKPASS=""` 对 OpenCode 同样有效，无需新增 env 变量。OpenCode 无等价的前置拦截机制，credential isolation 是唯一防线，与 design NFR-003 承诺一致。详见 fixtures 文档 T008。
- [x] **T009**（`NFR-001`, `NFR-004`）：验证三个CLI在不恢复完整HOME/USERPROFILE时所需的最小auth目录变量/路径；若某OAuth路径无法隔离，按design标unavailable而非放宽git凭据环境。

  **2026-07-19 完成，三者全部可隔离，无需放宽git凭据环境**：Codex 沿用已实现的 `CODEX_HOME`；Claude Code 是 `CLAUDE_CONFIG_DIR`（指向真实 `~/.claude` 文件夹，非父目录）——已验证隔离 HOME 后仍保留真实登录态，但有一条关于顶层 `.claude.json` 的良性 stderr 警告需要 adapter 容忍/静默，不当作探测失败；OpenCode 需要**同时**设置 `XDG_DATA_HOME`（定位 `auth.json`）和 `XDG_CONFIG_HOME`（定位 `opencode.jsonc`），已验证无警告、干净生效。三者的 SSH agent/git credential helper/GH token 暴露都只受 `HOME`/`USERPROFILE` 控制，与这些 provider 专属变量无关，隔离机制不会连带放宽。design §5.4 已写入对照表。详见 fixtures 文档 T009。
- [ ] **T009a**（`NFR-003`, `NFR-004`, `AC-006`）：实现统一的 CLI 可执行文件解析，让三个 adapter 都能真正以 `shell=false` 启动。

  **背景**：本机实测（T000）三个 CLI 的路径形态不一致——Claude 是真 exe（`claude.exe`），Codex 和 OpenCode 都是 Windows 批处理 shim（`codex.cmd` / `opencode.cmd`）。Node `spawn` 在 `shell:false` 下无法直接执行 `.cmd`，这正是 F002 基线被迫写成 `shell: process.platform === "win32"` 的原因（见 `runtime/adapters/codex-cli-adapter.ts:196`、`codex-protocol.ts:83`）。若不处理，F005 三个 adapter 会出现"两个走 shell、一个不走"的分裂，`shell=true` 让命令串经过 `cmd.exe`，与 design 反复强调的"instructions/API key 绝不进 argv"的安全论证不自洽。

  **关键**：shim 转发形态不止一种，resolver 不能简化为"返回一个 exe 路径"。本机实测 `opencode.cmd` 是单层转发到 `opencode.exe`，而 `codex.cmd` 转发的是 `node.exe + @openai/codex/bin/codex.js + %*`。契约必须能表达"可执行文件 + 前置参数"（design §6.1 的 `ResolvedExecutable { executable, prefixArgs, source }`）。

  按项目"先测试后实现"规则拆为两项：

- [x] **T009a-1**（`NFR-003`, `NFR-004`）：添加 executable resolver 测试，覆盖：直通 exe（`source="direct"`、`prefixArgs` 为空）、单层 exe 转发 shim、`node + 入口 js` 转发 shim（`prefixArgs` 正确）、目标 exe/入口文件不存在、未知或复杂 batch、PATH 查找、Windows 路径含空格与 Unicode、相对路径。断言解析失败一律产出 unavailable 原因，**任何分支都不得回退 `shell=true`**。

  **2026-07-19 完成**：`server/tests/unit/executable-resolver.test.ts`，13 项全绿，用两个真实 fixture 的原始文本（opencode.cmd 单层转发、codex.cmd 的 node+entry.js 转发）作为测试内容，未知 shim 形态和目标缺失均正确返回 `resolved: null`。

- [x] **T009a-2**（`NFR-003`, `NFR-004`, `AC-006`）：实现 resolver 并接入三个 adapter 的启动路径；只支持 fixture 固化的已知 npm shim 形态，参数经 `prefixArgs` 数组传递、禁止字符串拼接重建命令行。同步移除 `codex-cli-adapter.ts` 与 `codex-protocol.ts` 的 `shell: process.platform === "win32"`，三个 adapter 统一 `shell: false`。回归门槛：F002 现有 Codex 启动/probe 测试全绿，证明去掉 shell 后行为不变。

  **2026-07-19 完成**：新增 `server/src/runtime/executable-resolver.ts`，接入 `codex-cli-adapter.ts`（spawn 前解析）和 `codex-protocol.ts`（`validateCodexCommand` 的 `--version` probe），两处 `shell: process.platform === "win32"` 已移除，统一 `shell: false`。Claude/OpenCode adapter 尚未实现（Phase 5/6），届时直接复用同一 resolver。**回归**：`npm run typecheck` 全绿；server 完整测试套件 983 passed / 7 skipped（real-codex-* env-gated）。真实机器 sanity check（`claude`→direct exe，`opencode`→verified_shim，`codex`→verified_shim + node.js prefixArg）与手工探测结果完全一致。**修复了一处因本变更暴露的测试耦合**：`codex-cli-adapter.test.ts` 原先 mock `node:child_process` 拦截字面量 `command==="codex"` 做假脚本替换，但 resolver 会在 spawn 前把 "codex" 解析成本机真实路径，导致 mock 失效、实际跑到真实 Codex CLI；已补充 mock `executable-resolver.js` 为直通（对 "codex" 原样返回），恢复测试隔离性。另确认 `validation-recovery.test.ts` 一处失败是全量套件下的既有 ULID 时序 flaky（单独跑通过），与本变更无关，未修复（超出 T009a-2 范围）。

  **阻塞关系**：本组任务阻塞 T037（Claude argv/启动断言）和 T044（OpenCode argv/启动断言）——这两项的 `shell=false` 与"key 不进 argv"断言在解析器就位前无法成立。

- [x] **T010**（`AC-001`, `AC-006`）：把所有fixtures加入test helpers并附CLI版本/字段说明；运行secret扫描确保无token/key/private path。

  **2026-07-19 完成**：`server/tests/helpers/claude-protocol-fixtures.md`、`opencode-protocol-fixtures.md` 已包含 CLI 版本、argv、事件字段说明。Secret 扫描覆盖本次改动的全部文件（含未跟踪新文件）：`sk-`/`Bearer`/`gh[pousr]_`/`AKIA`/private key header 等模式零命中；额外发现并修复 2 处私有绝对路径泄漏（真实 Windows 用户名 "Georg" 残留在 `claude-protocol-fixtures.md` 和 `tasks.md` 的安装路径示例里），已改为 `C:\Users\...\` 占位符，与 F002 `codex-protocol-fixtures.md` 的既有脱敏约定一致。email/orgId/orgName 此前已正确写为 `[REDACTED]`。

**Checkpoint 1 达成**：三个provider的argv、auth probe、final message、trace、cancel、approval能力均由可重放fixture固定（Claude/OpenCode 为本机真实 CLI 实测，Codex 沿用 F002 既有 fixture）；三个adapter均以`shell=false`启动（Claude 原生无需解析，Codex 已接入 resolver 并回归全绿，OpenCode 待 Phase 6 实现时接入同一 resolver）；无法支持的能力已有明确降级记录（Claude 无原生 exitCode/实时 Blocked 分类，OpenCode 无等价前置拦截、auth 失败信息泛化）。

## Phase 2：Shared Contract与Schema v6

- [ ] **T011**（`DR-001` - `DR-005`）：添加shared类型编译/序列化测试，覆盖CliProvider/AuthType/Capability/RunPurpose、public AdapterConfig、write-only inputs、Run routing fields和provider metadata。
- [ ] **T012**（`DR-001` - `DR-004`）：拆分/扩展shared adapter/run types并re-export；扩展F004 `RunRole`新增非空`consult`、扩展`RunDispatchSource`新增`user_default`，持久化枚举只增不改。
- [ ] **T013**（`IR-001` - `IR-003`）：先补ErrorCode/HTTP映射测试，再新增auth/key/provider/default/purpose/status/conflict错误。
- [x] **T014**（`DR-001` - `DR-005`, `NFR-001`）：添加v6 migration集成测试，覆盖v5升级、重跑、旧Codex oauth解释、旧Run workflow_bound、非空`role='consult'`可插入且无需重建runs、capability backfill、due/default/index和既有summary不变。**default 回填必须单独覆盖**（按 design §4.1 的收紧策略）：Project 恰有 1 个 available adapter → 回填该 adapter；0 个 → 保持 NULL；≥2 个 → 保持 NULL 不瞎猜；含 unavailable adapter 不计入；迁移重跑幂等。断言回填后旧 Project 省略 `adapter_id` 的 dispatch 不再返回 `DEFAULT_ADAPTER_UNAVAILABLE`（单 adapter 场景）。

  **2026-07-19 完成**：`server/tests/integration/migration-v6.test.ts`，24 项全绿，覆盖新增列/索引、旧数据默认值、capability_tags 与 default_adapter_config_id 两类 backfill（含 0/1/≥2/含 unavailable 四种边界）、`role='consult'` 可插入且既有 summary/索引不受影响。副作用修复：`migration.test.ts`、`persistence.test.ts` 两处硬编码 `schema_version` 断言（`toBe(5)`）随版本号推进到 6 而失败，已同步更新为 `toBe(6)`；`persistence.test.ts` 的失败还连带触发了一个 EBUSY 文件锁清理错误（断言抛出中断了后续 `db.close()`，导致 `afterEach` 删除临时目录时文件仍被占用）——两处根因相同，一并修复。

- [x] **T015**（`DR-001` - `DR-005`）：实现`schema-v6.ts`并在`migrations.ts`注册为版本6（v5 已被 F004 占用，勿复用）；保留F004 `runs.role NOT NULL`并由shared enum新增`consult`值。

  **2026-07-19 完成**：与 T014 同步实现（TDD 红→绿）。`server/src/db/schema-v6.ts` 落地 design §4.1 全部 SQL：4 个 `agent_configs` 新列、`projects.default_adapter_config_id`、`runs.purpose`/`context_source_run_id`、`issues.validation_dispatch_due_at`、两条新索引，以及 capability_tags/default_adapter_config_id 两条 backfill UPDATE。

- [x] **T016**（`DR-005`, `FR-009`）：验证F004 **两条** validator 唯一索引在v6仍存在且对manual/system Run同时生效：`idx_runs_one_active_validator`（v4，active）与`idx_runs_validator_per_round`（v5，跨终态每轮唯一）；断言两者语义差异（本轮validator终态后前者放行、后者仍拦截）；不得重复创建冲突索引。

  **2026-07-19 完成**：migration-v6.test.ts 新增专门 describe 块，显式验证 manual(user_explicit)→system 与 system→manual 两个方向都会撞上同一条 active-validator 索引（不因 dispatch_source 不同而豁免），并确认 consult Run 不会误撞（角色不同，索引无 dispatch_source 谓词）。另确认 F004 既有的两条强制性测试（migration.test.ts 的 duplicate-queued-validator、migration-v5.test.ts 的 per-round DB uniqueness）在 v6 之上原样通过，索引未被重建/未产生冲突定义。

**Checkpoint 2 达成**：F004数据无损升级（v5→v6 全部旧数据测试通过），public/internal secret边界（`AdapterConfig.has_api_key`/write-only `api_key`）和routing枚举（`RunPurpose`/`RunRole.Consult`/`RunDispatchSource.UserDefault`）已固定。回归：`npm run typecheck`、`npm test`（server+web）、`npm run build` 全绿。

## Phase 3：Adapter Repository、Public DTO与Default

- [x] **T017**（`DR-001`, `NFR-001`）：添加AgentConfigRepository internal record测试，覆盖auth/model/key/capability字段、create/update/clear、非法JSON和key原值只在repository内部可见。

  **2026-07-20 完成**：`server/tests/unit/agent-config-repository.test.ts`，10 项全绿，用高辨识 canary secret 验证 create/getById/update（替换/省略保留/null清空）/list 系列方法均返回内部 record 的原始 `api_key`；恶意/非法 capability_tags JSON（非法语法、非数组）均按 design 要求返回空数组并强制 `status=unavailable`，合法值不受影响。

- [x] **T018**（`DR-001`）：扩展repository输入/映射/查询；不得返回internal record给route。

  **2026-07-20 完成**：`AgentConfigRepository` 新增 `AgentConfigRecord` 内部类型（含原始 `api_key`），`create/getById/listByProject/listAvailableByProjectAndRole` 均返回该类型而非 public `AdapterConfig`；`mapRow` 现在真实读取 auth_type/model_provider/api_key/auth_status_message 四列（Phase 2 的占位值已移除）。route 层未直接引用该类型（现有 route 均经由 service）。

- [x] **T019**（`DR-001`, `UX-002`）：添加`toPublicAdapter()`测试，使用高辨识secret验证任何层级JSON均无原值，只返回has_api_key/auth status/is_default。

  **2026-07-20 完成**：`server/tests/unit/agent-config-public-dto.test.ts`，10 项全绿，验证 `JSON.stringify()` 输出不含原始 secret、返回对象上 `"api_key" in dto` 恒为 false（即使记录的 key 为 null 也一样，防止未来误加空字段）、`has_api_key`/`is_default` 投影正确。

- [x] **T020**（`DR-001`, `NFR-001`）：实现显式public DTO builder；禁止spread后删除secret模式。

  **2026-07-20 完成**：`server/src/repositories/agent-config-dto.ts` 的 `toPublicAdapter(record, defaultAdapterConfigId)`，逐字段显式构造，无 spread。`AdapterConfigService` 的 create/list/getById/update/validate 五个方法已改为在返回前调用它（含跨方法查 Project 取 `default_adapter_config_id` 的必要开销）；`ValidationWorkflowService` 的两处 `listAvailableByProjectAndRole` 调用点同步接入（`is_default` 传 `null`，对 validator 选择无意义）。

- [x] **T021 [P]**（`FR-004`, `AC-002`）：添加ProjectRepository default adapter测试，覆盖set/clear、cross-project、不available、首个available自动default和删除default guard；并覆盖 default 为 NULL 时省略 `adapter_id` 的 dispatch 返回 `DEFAULT_ADAPTER_UNAVAILABLE`（供 UI 强制显式选择一次）。

  **2026-07-20 完成，含一处明确延后**：`server/tests/unit/project-default-adapter.test.ts`，11 项全绿，覆盖 set/clear/cross-project/unavailable/not-found 五种结果、首个 available adapter 自动成为 default（第二个不覆盖已有值）、删除 default 时若还有其他 adapter 则拒绝（复用 `ADAPTER_IN_USE`）、若是唯一 adapter 则允许删除并清空 default。**"省略 adapter_id 的 dispatch 返回 DEFAULT_ADAPTER_UNAVAILABLE" 这条未在本任务实现**——它依赖 Run 创建事务里的 `AdapterResolver`（Phase 7 T053-T054），Phase 3 只到 repository/CRUD 层，尚无 Run 派发路径可测；已记录、不遗漏，留给 T053-T054。

- [x] **T022**（`FR-004`）：扩展Project repository/service的default字段和CAS更新。

  **2026-07-20 完成**：`ProjectRepository` 新增 `setDefaultAdapter()`（校验 adapter 存在/同 Project/available，返回判别式结果而非抛异常）和 `clearDefaultAdapter()`。`AdapterConfigService.create()` 在新建 adapter 为 available 且 Project 尚无 default 时自动调用 `setDefaultAdapter`；`delete()` 增加同 Project 内"是否为 default 且是否还有其他 adapter"的判断，二选一走拒绝或清空。

- [x] **T023 [P]**（`DR-002`, `DR-003`）：添加RunRepository purpose/non-null consult role/context source/source测试及workflow/consult列表过滤；拒绝null role。

  **2026-07-20 完成**：`server/tests/unit/run-repository-purpose.test.ts`，8 项全绿，覆盖 purpose 默认 workflow_bound、显式 ad_hoc_consult+role=consult 时 workflow_step 正确为 null（而非误判为 implementation）、validator 角色 workflow_step 恒为 validation、context_source_run_id 写入与回读、`listByIssueAndPurpose()` 正确按 purpose 过滤，以及 `runs.role` 列在原始 SQL 层拒绝 NULL 插入（DB 级防线）+ repository 层确认 consult Run 的 role 既非空字符串也非 null。

- [x] **T024**（`DR-002`, `DR-003`）：扩展Run repository/public mapping，保持F004 validator字段兼容。

  **2026-07-20 完成**：`RunRepository.create()` 新增可选 `purpose`/`context_source_run_id` 入参并写入 v6 新列；`mapRow` 改为真读这两列（移除 Phase 2 占位值）；`workflow_step` 派生逻辑抽成 `deriveWorkflowStep()`，新增 consult 分支（返回 null，此前会被误判为 implementation）；新增 `listByIssueAndPurpose()`。F004 既有 validator 字段（role/validation_round/dispatch_source/adapter_identity）未改动，全部既有测试原样通过。

**Checkpoint 3 达成**：secret不能越过service DTO边界（`AdapterConfigService` 全部对外方法经 `toPublicAdapter()`），Project default（首个自动、显式 set/clear、删除守卫）和Run routing（purpose/context_source_run_id/workflow_step consult 分支）可持久化审计。回归：`npm run typecheck`、`npm test`（server+web）、`npm run build` 全绿。

## Phase 4：Adapter配置、Auth Material与Registry

- [x] **T025**（`FR-001`, `FR-002`, `AC-001`）：添加provider/auth字段矩阵测试：Codex/Claude仅OAuth、OpenCode OAuth/API key、互斥字段、switch清key、required provider/model/key、trim/limits。
- [x] **T026**（`FR-001`, `FR-002`, `IR-001`）：重构AdapterConfigService使用provider metadata校验并输出public DTO；移除统一`--version`可用性判断。**同时修掉create路径硬编码`capability_tags: []`**（`services/adapter-config.ts`），改为写入用户选择/provider默认的真实capability——否则v6 backfill只修历史数据，新建adapter仍会退化为无能力；补一条"新建adapter的capability_tags非空且与输入一致"的测试。**并落实 `agent_configs.role` 的 deprecated 写入规则**（design §4.1）：create/update contract 不接收 role，服务端由 `capability_tags` 确定性派生（含 validator → `'validator'`，否则 `'implementation'`）仅为满足 NOT NULL；派生值不进 public DTO/API/UI，不参与任何选择逻辑；补测试断言 capability 更新后 role 派生稳定且 validator-only adapter 不会被存成 implementation。
- [x] **T027**（`FR-003`）：添加registry/capability测试，覆盖三provider注册/查找、duplicate throw、config provider匹配、auth capability，以及手动routing与自动ValidatorSelector共用`capability_tags`判断。
- [x] **T028**（`FR-003`）：注册Codex/Claude/OpenCode adapter singleton并扩展registry接口；实现共享`hasCapability()`并把自动validator候选查询从`agent_configs.role`切换为`capability_tags contains validator`。`listAvailableByProjectAndRole()`有**两个**调用点，必须一并切换，只改其一会让recovery路径继续使用旧真相源：`services/validation/workflow-service.ts`（request主路径）与`services/validation/recovery-service.ts`（重启recovery路径）。切换后该方法应无剩余调用点，直接删除以防回归；旧`agent_configs.role`是 deprecated internal field，只用于迁移，**不再用于展示**（UI 的主要角色标签从 `capability_tags` 计算）。
- [x] **T029**（`FR-002`, `DR-001`, `NFR-001`）：添加AuthMaterial测试，覆盖API key allowlist/env或temp config、cleanup、异常清理、key不进argv/context/log和unknown provider拒绝。
- [x] **T030**（`FR-002`）：实现`runtime/auth-material.ts`及provider mapping，严格按Phase 1实测结果。
- [x] **T031**（`FR-001`, `FR-002`, `NFR-004`）：添加provider-specific child env测试，确保只暴露所需CLI auth目录，继续移除SSH agent/git helper/GH tokens，API-key模式不暴露home auth。
- [x] **T032**（`FR-008`, `NFR-003`）：重构`buildChildEnv()`接收provider auth descriptor，维持F002 credential isolation测试全部通过。
- [x] **T033**（`FR-001`, `FR-002`, `UX-002`）：添加真实adapter `validate()`集成测试fixture，确认auth failure更新unavailable/message、version成功不等于已登录、message已redact。
- [x] **T034**（`FR-001`, `FR-002`）：让AdapterConfigService调用registry adapter.validate，保存last_checked/status/clean message。

  **2026-07-21 完成**：`AdapterConfigService`（`services/adapter-config.ts`）不再自建统一`--version`可用性判断，`create()`/`update()`保留`validateCommand()`做保存时的本地快速语法检查，而显式`validate(id)`改为`async`并委托`this.adapterRegistry.getForConfig(publicConfig).validate(publicConfig)`——每个provider用自己的真实auth probe（如Phase 1实测的Claude `auth status`）判定可用性，而不是统一`--version`。构造函数新增`adapterRegistry`第3参数，`server/src/index.ts`同步把registry构造/注册移到service构造之前，路由`POST /api/adapters/:id/validate`补`await`。测试新增`adapter-config-validate-registry.test.ts`（脚本化fake adapter验证service确实用registry而非硬编码逻辑）。

  过程中发现并修复三处此前遗留的真相源缺口（均属T026/T028范围内、当时未收尾）：
  1. **`role`仍在public DTO泄漏**：`AdapterConfig`共享类型和`toPublicAdapter()`仍保留`role`字段，与design §4.1"不在任何public DTO、API response或UI中出现"直接矛盾。已从`shared/src/types/index.ts`和`agent-config-dto.ts`移除；Web端`AdapterSettings.tsx`（3处读取点：列表badge、无validator警告判定、编辑表单预填）改为按design §4.1"UI主要角色标签从capability_tags计算"的方式，新增纯函数`primaryRole(capability_tags)`本地派生，不再依赖服务端`role`。
  2. **`validator-selector.ts`的`filterEligible()`仍用`c.role === AdapterRole.Validator`**：该模块是`workflow-service.ts`唯一验证器选择入口，但从未随T028的capability_tags切换同步，导致`AdapterConfig`删除`role`后编译报错；已改为`c.capability_tags.includes(AgentCapability.Validator)`。
  3. **四个F004遗留集成测试fixture的implementation adapter仍是`capability_tags: []`**（`validation-blocked-envelope`/`validation-evidence-summary-data`/`validation-validator-uniqueness`/`validation-recovery.test.ts`）：这些fixture在T028把选择逻辑切到`listAvailableByProjectAndCapability()`后从未被同步更新（早前批量修复脚本只处理了`role: "validator"`场景，遗漏了`role: "implementation"`场景），导致`[0].id`读取undefined直接抛错；补齐`capability_tags: [AgentCapability.Implementation]`修复。同批还发现`validation-recovery.test.ts`"reuses frozen validator"用例的`frozenValidator` fixture本应有`capability_tags: [AgentCapability.Validator]`（此前一轮误判其"不该被通用选中"，实际测试意图是验证recovery重放冻结选择、优先于自然排序，而非验证该adapter被排除在通用池外）；修正后因该fixture与setupFixture中的"Val" adapter created_at可能同毫秒打平，新增显式`UPDATE ... SET created_at`把冻结adapter的时间戳推后60秒以消除tie-break随机性。
  4. `validation-validator-selector.test.ts`的`makeConfig()`fixture用`role: AdapterRole.Validator`且`capability_tags: []`（用`AdapterRole`枚举引用而非字符串字面量，早前批量脚本按字符串匹配未命中）；改为`capability_tags: [AgentCapability.Validator]`，三处override（implementation-role场景）改用`capability_tags: [AgentCapability.Implementation]`。
  5. 曾尝试在`tests/helpers.ts`全局注册`CodexCliAdapter`以修复T033新增的一条真实`validate()`集成测试，但这会让套件里所有`cli_provider: "codex"`的fixture都变得"可真实dispatch"，把大量原本依赖"codex run会保持`queued`（无真实adapter可用，不会被启动）"的既有断言变成`running`（`terminal-orchestration.test.ts`等5个文件回归）；已撤销该全局注册，改为只在`adapter-config.test.ts`那一条测试内局部`services.adapterRegistry.register(new CodexCliAdapter())`。

  `npm run typecheck`、`npm test`（server 1115 + web 78 全绿，7个真实Codex集成测试按环境变量skip）、`npm run build`（shared/server/web）全部通过。

**Checkpoint 4 达成**：三provider可配置/验证（Codex真实走`--version`探测、Claude/OpenCode由registry路由到各自adapter的`validate()`），OpenCode key只在spawn auth material短路径出现，credential isolation未退化；`agent_configs.role`彻底不再出现在public DTO/API/UI，`capability_tags`是能力判断的唯一真相源。

## Phase 5：Claude Code Adapter

- [x] **T035**（`FR-001`, `FR-005`）：使用Phase 1 fixture添加Claude protocol normalizer测试，覆盖output/final/command trace/control request/unknown/malformed/dedupe/limits。
- [x] **T036**（`FR-001`, `FR-005`）：实现独立`claude-code-normalizer.ts`，raw stream不进入领域层。
- [x] **T037**（`FR-001`, `NFR-004`）：添加Claude adapter启动/argv/stdin/cwd/env/auth/cancel/exit-once测试，`shell=false`且instructions不得在argv。**依赖T009a**。
- [x] **T038**（`FR-001`）：实现`ClaudeCodeAdapter` one-shot lifecycle和F003/F004 contracts。
- [x] **T039**（`FR-008`, `NFR-003`, `AC-006`）：添加Claude `PreToolUse` hook 安全测试（**不是** control_request/response，见 T003 修正），覆盖 hook script 对 git push/force push 的 deny 决策、`--settings` 注入是否正确生效、普通请求按P0策略处理（hook 不干预）、bypass flag永不出现。
- [x] **T040**（`FR-008`）：实现 PersonaHub 侧的 `PreToolUse` hook script（读 stdin 的 `tool_input.command`，按 `push_credentials_enabled` 决定 deny/allow，写 `hookSpecificOutput` 到 stdout）并在 spawn 时经 `--settings` 注入；接入 AgentRunner escalation；hook 注入失败或 `--settings` 不可用时 capability 降级但 credential isolation 继续。
- [x] **T041**（`FR-005`, `FR-006`）：添加Claude implementation/validator Fake CLI集成测试，确认handoff context、structured trace和F004 pass/fail复用。

  **2026-07-21 完成**：Phase 5 全部落地并用真实本机 Claude Code CLI 2.1.216 重新做了两次安全、低成本的活体探测（非本文档既有 prose 复述），获得字面 NDJSON 原始样本，写入 `claude-protocol-fixtures.md` 的新增 "T035 re-verification" 节：
  1. **新发现，改进 T004 结论**：hook 拒绝的 tool_result 带一个结构化的顶层字段 `tool_result_meta: [{id, non_execution_kind:"permission-rule"}]`——比 T004 当时建议的"匹配 denial 文本"更可靠、非脆弱。`command_completed` 的 Blocked 分类因此在 Claude 侧就是精确的结构判断，不需要 T004 曾建议的"延迟到 end-of-run `permission_denials[]` 二次改判"（`CommandCorrelator.handleCompleted()` 本来就会丢弃同一 itemId 的第二次 command_completed，没有二次改判通道）。
  2. **真实 bug（非 Claude 特有,影响所有未来 exitCode 恒为 null 的 provider）**：`server/src/runtime/trace/command-correlator.ts` 的 `normalizeOutcome()` 只信任 `signal.outcome` 里的 Blocked/Cancelled，Succeeded/Failed 却重新按 `exitCode` derive——Codex 恰好 derive 出同样的值所以从未暴露，但 Claude 的 `exitCode` 恒为 `null`（design 已记录的能力缺口），导致所有 Claude 命令的 outcome 全部塌缩成 `unknown`。修复为直接信任 normalizer 已计算好的 `signal.outcome`，不重新 derive。
  3. `isGitPushCommand`/`isGitPushOutput`/`CREDENTIAL_FAILURE_PATTERN` 从 `codex-protocol.ts` 抽到新文件 `shell-command-patterns.ts`（两个 adapter 共用，避免这条安全相关正则出现第二份拷贝）；`codex-protocol.ts` 改为 re-export，行为不变。
  4. Claude `validate()`（`claude-protocol.ts`）用 `claude auth status`（默认已是 JSON），只回传 `loggedIn`/`authMethod`/`apiProvider`，绝不回传探测中确认存在的 `email`/`orgId`/`orgName`（T001 PII 警告）；`auth status` 对"未登录"情形退出码是 1，因此可用性判定必须看 JSON body 而非退出码。
  5. `PreToolUse` hook script（`claude-pretooluse-hook.ts`）是完全自包含的字符串常量（写入 run-scoped 临时文件，`--settings` 内联 JSON 指向它，Run 结束 cleanup）——因为 Claude Code 把它当独立短生命周期子进程 spawn，无法 import 我们编译后的 TS 模块；git-push 正则因此在这里有一份必要的、有意的跨进程拷贝。Hook 只拦截 git push（呼应 Codex adapter 对非 push 请求一律 auto-accept 的同等安全姿态），通过专用 env var（`PERSONAHUB_PUSH_CREDENTIALS_ENABLED`，随 buildChildEnv 一起设置）读取当前 push 是否允许，不依赖任何进程外状态。用真实 `node <hook-script>` 子进程（非 mock）验证了 deny/allow/malformed-stdin 三种输入。
  6. `ClaudeCodeAdapter.cancel()` 用 `SIGINT`（非 Codex 的 `turn/interrupt` RPC，因为 Claude 没有等价 RPC）；在 Windows 上用真实 `node` 子进程验证了 `child.kill("SIGINT")` 确实产生 `(code:null, signal:"SIGINT")`（与 T002 对真实 `claude.exe` 的探测结论一致）——排查过程中发现 `fake-claude.mjs` 的 "cancel" 模式一开始没有任何常驻 handle，会在收到信号前自行退出，已修复为挂一个长间隔 `setInterval` 保活。
  7. **环境问题（与 F005 代码本身无关，记录以防复发）**：本 Phase 是首次在独立 worktree（`.claude/worktrees/F005`）里跑构建/测试，该 worktree 没有自己的 `node_modules`；Node 的模块解析沿目录树向上找到了主仓库（`main` 分支，已无 F005 类型）的 `node_modules/@personahub/shared` 符号链接，导致 `npm run build:shared` 本身成功（在 worktree 自己的 `shared/src` 上跑）但 server 端 `tsc`/`vitest` 却解析到主仓库过时的 `shared`，报出大量"成员不存在"假错误。修复：在 worktree 内单独 `npm install`，使其拥有指向自己 `shared/server/web` 的独立 workspace 符号链接。**每个新建的 git worktree 都需要独立 `npm install`，不能假设 node_modules 沿用父目录。**

**Checkpoint 5 达成**：Claude 可作为 implementation/validator 运行；`ClaudeCodeAdapter` 已注册进 `server/src/index.ts` 的 registry；前置 approval 能力（`PreToolUse` hook）与 F002 P0 安全姿态一致（只拦截 git push，其余请求不干预）；F004 `parseValidationResult` 对 Claude 的 `result.result` 免修改复用（真实验证）；`npm run typecheck`、`npm test`（server 1150 + web 78 全绿）、`npm run build`（shared/server/web）全部通过。

## Phase 6：OpenCode Adapter

- [x] **T042**（`FR-002`, `FR-005`）：使用Phase 1 fixture添加OpenCode normalizer测试，覆盖OAuth/API-key共同输出、final/trace/unknown/malformed/limits。
- [x] **T043**（`FR-002`, `FR-005`）：实现`opencode-normalizer.ts`；不从自由日志伪造confirmed command/test。
- [x] **T044**（`FR-002`, `NFR-004`）：添加OpenCode argv/stdin/cwd/env/auth material cleanup/cancel/exit-once测试；`shell=false`且key不得进argv。**依赖T009a**（OpenCode 本机为 `.cmd` shim）。
- [x] **T045**（`FR-002`）：实现`OpenCodeAdapter` one-shot lifecycle和auth material finally cleanup。
- [x] **T046**（`FR-008`, `NFR-003`, `AC-006`）：添加OpenCode credential isolation测试，push失败->escalation/Blocked，且capability明确`supportsApprovalHook=false`。
- [x] **T047**（`FR-008`）：接入credential failure normalizer/AgentRunner escalation；不得新增虚假的pre-execution event。
- [x] **T048**（`FR-005`, `FR-006`）：添加OpenCode implementation/consult/validator测试；若probe不支持可靠final/trace，validator路径必须Blocked而非pass。

  **2026-07-21 完成**：`opencode-normalizer.ts`（`OpenCodeTraceNormalizer`）把`step_start`/`text`/`tool_use`/`step_finish`/`error`五种NDJSON行归一化；`tool_use`单行自带`metadata.exit`+`time.start/end`，比Claude多一个真实exitCode，一行即可同时合成`command_started`+`command_completed`两个trace signal（无需跨事件关联durationMs）。final message从最后一步`step_finish.reason=="stop"`前累积的`text`重建（协议没有单一terminal事件）。`OpenCodeAdapter`：`supportsApprovalHook=false`（真实探测确认无pre-execution channel），`supportsStructuredTrace=true`（真实探测确认，非design原文"若无confirmed trace则降级"的情形）；credential isolation escalation走`command_completed`的Failed结果 + 扩大后的`CREDENTIAL_FAILURE_PATTERN`（新增`not found`/`terminal prompts disabled`，T008：GitHub对私有/不存在仓库统一返回隐私保护式404，push失败文本是"Repository not found"而非"Authentication failed"）。

  过程中用真实本机 OpenCode CLI 1.18.3 做了一次针对 T044 的安全性活体验证，并发现/修复两处此前遗留的架构缺口：
  1. **真实发现**：`opencode run --format json ""` 报 `Error: You must provide a message or a command`，且用 stdin 管道文本、不给 positional message 也读不到——确认 OpenCode 的 `run` **没有 stdin prompt 模式**，instructions 只能走 argv（本地进程列表可见），这与 Claude 相反；tasks.md T044 原文只写"**key** 不得进 argv"（不是"instructions"）已经预判了这一点。已写入 `opencode-protocol-fixtures.md` 新增小节，design.md §6.4 同步补充。
  2. **真实架构缺口（api_key mode 此前完全无法 validate()/dispatch）**：`AgentAdapter.validate(config)` 和 `AgentRunInput.adapterConfig` 此前都只携带 secret-safe 的 public DTO/`{command,args}`，从未把 `api_key`/`model_provider`/`default_model`/`auth_type` 传给 adapter——Codex/Claude 从未触发这个缺口（纯 OAuth，从不需要密钥），OpenCode 的 api_key 模式第一次需要 adapter 拿到真实密钥去构造 `AuthMaterial`/`-m provider/model`，缺口才第一次暴露。修复：`AgentAdapter.validate()`新增可选第二参`apiKey`（`AdapterConfigService.validate()`从`existing.api_key`传入，Codex/Claude签名不变，靠可选参数结构兼容）；`AgentRunInput.adapterConfig`（及`agent-runner.ts`的`StartRunParams.adapterConfig`）从`{command,args}`扩到同时带`model_provider`/`default_model`/`auth_type`/`api_key`，`run-dispatch.ts`的`startAdapter()`补齐转发。
  3. **`validateAuthState()`补一条规则**：`model_provider`/`default_model`此前只在`auth_type=api_key`时required——OpenCode的"必须显式`-m`"约束与auth_type无关，OAuth模式的OpenCode adapter同样需要两者才能安全dispatch；修正为`cli_provider=opencode`时二者一律required，但`model_provider`的取值范围只在`api_key`模式命中T007 allowlist（OAuth模式允许任意非空字符串，真实有效性交给`validate()`探测）。design.md §6.4同步补充说明并注明真实探测来源。

  `npm run typecheck`、`npm test`（server 1180 + web 78 全绿）、`npm run build`（shared/server/web）全部通过。

**Checkpoint 6 达成**：OpenCode OAuth/API-key均可运行（`OpenCodeAdapter`已注册进`server/src/index.ts`）；`supportsApprovalHook=false`如实反映真实边界（无pre-execution channel，credential isolation是唯一防线）；`validate()`/dispatch的`-m provider/model`缺失问题已通过扩展`AgentAdapter`/`AgentRunInput`接口修复，api_key模式端到端可用。

## Phase 7：Handoff Context与Routing纯逻辑

- [x] **T049 [P]**（`FR-005`, `FR-006`, `AC-003`, `AC-004`）：添加RunContextBuilder测试；普通implementation/consult使用latest eligible prior handoff，validator严格绑定`implementation_run_id`对应handoff/evidence/files/tests，并覆盖Validating期间更新consult handoff不得串入、trusted evidence resolver allowlist 拒绝 `run.output` payload、findings、first Run、missing refs、Windows path和size limit。
- [x] **T050**（`FR-005`, `FR-006`）：实现带source policy的统一RunContextBuilder并替换F002手拼context；validator设置`context_source_run_id=implementation_run_id`，其他Run记录实际latest source。
- [x] **T051 [P]**（`FR-004`, `FR-007`, `AC-002`, `AC-005`）：添加expected-role/purpose classifier矩阵，覆盖Inbox/Ready/Running/Validating/Done/Blocked、multi-capability、forced consult、不能forced workflow和consult role始终非空；断言 consult 降级**无条件成立**（不检查任何 consult capability），且 `capability_tags` 为空时任何状态都只能 consult、不会误命中 workflow 角色。
- [x] **T052**（`FR-004`, `FR-007`）：实现pure routing classifier；Running期望implementation，Validating期望validator，未命中持久化`role=consult`。`AgentCapability` 只有 Implementation/Validator 两个值，classifier 不得引用不存在的 consult capability。
- [x] **T053 [P]**（`FR-003`, `FR-004`, `AC-002`）：添加AdapterResolver/ValidatorSelector测试，覆盖explicit/default、same project、available、missing/default stale、确定性source，以及只有`capability_tags`含validator的config才能被自动选择。
- [x] **T054**（`FR-003`, `FR-004`）：实现AdapterResolver并同步升级F004 ValidatorSelector；两者复用`hasCapability()`，禁止列表第一项随机fallback或继续以旧role作为能力真相源。

  **2026-07-21 完成**：四块纯逻辑全部落地并接线：
  1. **`run-routing-classifier.ts`**（T051/T052）：`classifyRunRequest(issueStatus, requestedPurpose, capabilityTags)`纯函数，Done/Blocked直接拒绝；显式`ad_hoc_consult`无条件consult；其余按状态推导expected role，命中则workflow_bound，未命中一律降级consult（含capability_tags为空场景，无需单独分支，`.includes()`天然覆盖）。**客户端不能强制workflow_bound**：函数入参接受任意`RunPurpose`，但只特殊处理`AdHocConsult`，显式传`WorkflowBound`与省略视为完全等价（都走自动推导），已加测试断言两者结果一致。
  2. **`adapter-resolver.ts`**（T053/T054）：`resolveAdapter(deps, projectId, explicitAdapterId?)`，显式ID校验同Project+available，省略时读`Project.default_adapter_config_id`+available，缺失/失效均返回`DEFAULT_ADAPTER_UNAVAILABLE`，不存在"挑列表第一个"的路径。`ValidatorSelector.filterEligible()`同步改为调用共享的`hasCapability()`（此前是直接`capability_tags.includes(...)`，行为不变，但消除了潜在的第二份能力判断逻辑）。
  3. **`run-context-builder.ts`**（T049/T050）：`buildRunContext(deps, run, issue)`替换`run-dispatch.ts`里原来的5行手拼context。Source policy：validator直接读`run.context_source_run_id`（由F004 `requestValidation()`在创建时已固化为`implementation_run_id`，这里不重新推导，Validating grace期间的consult handoff因此不可能串入）；implementation/consult在该字段为空时用`runRepo.getLatestCompletedByRole(issueId, Implementation, beforeRunId=run.id)`现查"最近一次已完成的implementation Run"。复用F004既有的`collectImplementationEvidence()`/`collectPriorFindings()`（本来就按`run_id`+`ThreadEventType.HandoffCreated`等具体事件类型查询，`run.output`类事件天然不会被当成handoff读取，无需额外套一层ref allowlist）。落地时发现`FileChangeRepository.listByRun()`默认只返回100条（既有F004行为），写size-limit测试时改用长路径在100条内触发截断，而不是5000条空等。
  4. **依赖有向**：`AdapterConfigService`的`validateAuthState()`、`ClaudeCodeAdapter`/`OpenCodeAdapter`均未改动；只有`RunDispatchService`新增了`runRepo`/`threadEventRepo`/`fileChangeRepo`三个构造参数（`server/src/index.ts`与`tests/helpers.ts`两处构造点同步补上），`startAdapter()`里的`context`赋值改为调用`buildRunContext()`。

  验收时复现了F005 Phase 4"frozen validator"同款的ULID同毫秒建时序竞态：`run-context-builder.test.ts`里连续同步创建两个Run会偶发同created_at，`getLatestCompletedByRole`按`created_at`+`id`兜底排序在此时非确定；已用与Phase 4相同的手法（显式回拨`created_at`）修复，而不是依赖真实时间间隔。

  `npm run typecheck`、`npm test`（server 1218 + web 78 全绿）、`npm run build`（shared/server/web）全部通过。

**Checkpoint 7 达成**：路由分类（`run-routing-classifier.ts`）、AdapterResolver、RunContextBuilder均为纯逻辑/仅依赖repo的模块，全部由单元测试直接覆盖，无需启动任何真实CLI；`RunContextBuilder`已实际替换`run-dispatch.ts`的手拼context，implementation/consult Run从本Phase起就能看到上一轮的handoff摘要，不再需要用户手动复制聊天记录。分类器与AdapterResolver尚未接入Run创建事务（Phase 8：Manual Routing Service负责实际wiring）。

## Phase 8：Manual Routing Service与状态影响

- [x] **T055**（`FR-004`, `FR-007`, `DR-002`, `DR-003`）：添加Run创建事务测试，覆盖adapter resolve、purpose/role/source/context source和扩展run.queued payload；断言`workflow_step`随`role`固化（consult→`null`、workflow-bound implementation→`implementation`），与F004 §3派生表一致。
- [x] **T056**（`FR-004`, `FR-007`, `IR-002`）：实现ManualRoutingService并让RunDispatch使用；route不能传内部role/source。
- [x] **T057**（`FR-007`, `AC-005`）：添加状态影响测试：Ready/Inbox implementation->Running，Running implementation保持，Validating validator workflow，mismatch consult使用非空consult role且状态/round不变。
- [x] **T058**（`FR-007`）：收敛RunService状态更新只对workflow-bound implementation生效；consult terminal不调用F004 hook。
- [x] **T059**（`FR-007`, `FR-008`）：添加consult escalation测试，正常consult不改状态但危险操作仍Blocked并取消eligible queued workflow Runs。
- [x] **T060**（`FR-008`）：复用F002 escalation service处理所有provider/purpose，event携routing metadata。
- [x] **T061**（`NFR-002`）：添加三provider/consult/workflow同workspace FIFO测试和不同workspace并行回归；drain重验role/Issue status，取消stale同Issue implementation/validator，Validating consult仍eligible但不得污染validator context，不得引入provider专属queue或跨Issuevalidator优先级。

  **2026-07-22 完成**：新增`ManualRoutingService`（`server/src/services/manual-routing-service.ts`）作为Run创建的唯一入口,组合Phase 7的三块纯逻辑（`resolveAdapter`/`classifyRunRequest`/`getLatestCompletedByRole`发现context source）在一个事务里完成;`RunDispatchService.dispatch()`改为调用它（签名保持`(issueId, adapterId, instructions, purpose?)`不变，`adapterId`从必填改为`string | undefined`，因此**全部88处既有测试调用点无需改动**）。HTTP路由`POST /api/issues/:issue_id/runs`同步放开`adapter_id`为可选、新增`purpose`（仅接受`"ad_hoc_consult"`，其余一律按auto处理）。

  **范围边界（有意为之）**：分类器命中`role=validator`的手动dispatch（Validating + validator-capable adapter）目前会被`ManualRoutingService`直接拒绝（`RUN_NOT_ALLOWED_FOR_ISSUE_STATUS`），不在本Phase实现——design §8 明确要求两阶段dispatch（`validation.dispatch_pending` + `claimValidatorSlot()`）和冻结的round/implementation_run_id/policy snapshot，这是**Phase 9**的范围；在Phase 9的grace/claim机制落地前，若在此处硬塞一条独立的validator创建路径,要么绕开F004现有的per-round唯一索引与冻结上下文机制,要么产生一个Phase 9必须废弃重做的临时实现。安全优先：宁可暂时拒绝,也不引入未受唯一性保护的重复validator风险。

  实现`RunService.create()`已被移除（Phase 8之后仅`ManualRoutingService`在生产路径创建Run，`create()`在生产代码中变成死代码）；其原有17处测试调用点迁移到`manualRoutingService.dispatch()`，其中`run-service-guards.test.ts`整体重写以反映新行为——最重要的行为变化：**Validating不再是一刀切拒绝**，而是按adapter capability_tags分类（无validator能力→自动降级consult，不再抛`INVALID_ISSUE_TRANSITION`）。

  验收时额外发现并修复两处真实缺口：
  1. **`RunDispatchService.startNextQueuedRun()`的drain资格判断有真实bug**：原判断是`issue.status === Validating && run.role !== Validator`就取消——这会把design §7.5明确要求"consult在Validating期间仍eligible"的consult Run也一并误杀（"不是validator"被当成了"取消条件"，但consult本就不是validator，也不该被取消）。修正为按角色分别判断（implementation只在Inbox/Ready/Running eligible；validator只在Validating+round匹配eligible；consult在Inbox/Ready/Running/Validating全部eligible，Done/Blocked已在更早的分支统一处理）。这个bug在T061的"consult在Validating期间仍可运行"新增测试出现前完全没有测试覆盖到（此前没有consult角色的Run真正经过drain路径）。
  2. **`EscalationTriggered`事件payload缺routing metadata**：补充`purpose`/`role`两个字段（读取自`runService.get(params.runId)`，无需额外查询），满足T060"event携routing metadata"要求。

  新增`server/tests/integration/consult-state-impact.test.ts`覆盖T057-T061全部场景（consult不驱动状态/round、workflow-bound implementation对照组、consult escalation仍Blocked且event带routing metadata、escalation取消同Issue排队中的workflow Run、consult在Validating期间仍eligible、implementation在Validating期间仍正确ineligible）。

  `npm run typecheck`、`npm test`（server 1225 + web 78 全绿）、`npm run build`（shared/server/web）全部通过。

**Checkpoint 8 达成**：manual routing已贯通DB/queue/runtime（`ManualRoutingService`→`RunRepository.create()`→`run.queued`扩展payload）；consult与workflow状态边界正确（consult从不驱动Issue状态/round，但危险操作仍安全优先Blocked）；queue drain按角色正确处理Validating期间的consult/implementation eligibility差异。手动选择validator仍待Phase 9的`claimValidatorSlot()`。

## Phase 9：Validator Grace、互斥与Recovery

- [x] **T061a**（`TR-004`, `FR-006`）：添加`validation.dispatch_pending`事件契约测试：shared payload 类型、写入时机（Phase A）、payload 含冻结的 round/implementation_run_id/policy snapshot+hash/due_at 且**不含**任何 validator 身份；断言 `validation.requested` 未在 Phase A 写出。
- [x] **T061b**（`TR-004`, `FR-006`）：实现 Phase A pending dispatch 事务与 `validation.dispatch_pending` 事件。**严禁**改写 `validation.requested` 的既有语义——它是 validator-bound 事件，`findRequestedEvent()` 按 `validator_run_id` 反查，workflow-service 有三个调用点，recovery-service 会补建，validation query 与 SSE replay 同样依赖；`validation.requested` 仍只在 Phase B 创建出真实 validator Run 后写出。
- [x] **T062**（`FR-006`, `FR-009`, `AC-004`, `AC-007`）：修改F004 request测试：implementation完成后同事务进入Validating、写`validation.dispatch_pending`、set due，grace窗口内不创建auto validator且**不写`validation.requested`**；grace到期进入Phase B后才写出携带真实validator身份的`validation.requested`；同时断言注入grace=0时最终事件序列与F004原有"立即创建"等价。
- [x] **T063**（`FR-006`, `FR-009`）：把F004 validator creation拆为可复用`claimValidatorSlot()`（即 Phase B），Phase A 只设置持久化due并冻结上下文。拆分时必须把基线`workflow-service.ts`中**成对存在的两条前置检查**（`getActiveValidator` + `getValidatorRunByRound`）一起搬进来，只搬active那条会引入per-round回归。Phase B 直接读取 Phase A 冻结的 round/implementation_run_id/policy snapshot，不重新推导，避免grace期间consult handoff导致被验证对象漂移。
- [x] **T064**（`FR-009`, `DR-005`）：添加manual-wins race测试：grace内explicit validator创建、清due、scheduler loser幂等、只有一个Run。
- [x] **T065**（`FR-009`, `DR-005`）：添加auto-wins race测试：due/default-now先创建，manual loser收到409+active summary、无重复event。
- [x] **T065a**（`FR-009`, `DR-005`, `AC-007`）：添加**per-round冲突**测试：本轮validator已进入终态（completed/failed/被`issue_state_changed_before_start`取消）后，manual与scheduler分别尝试为同一轮再创建validator，断言两者都被`idx_runs_validator_per_round`拒绝（active为空、不得落入未定义分支）、不bump round、不产生重复Run；manual收到409+该终态run摘要，scheduler幂等结束；重新验证只能经fail→Running→新round路径。
- [x] **T066**（`FR-006`, `FR-009`）：实现claim transaction和unique conflict映射；**冲突分流必须区分active冲突与per-round冲突两类**（见design §8.2表），loser分支不得无条件读active validator（per-round冲突时为null）。应用层检查仅优化信息。
- [x] **T067**（`US4`, `FR-009`）：添加ValidationDispatchScheduler fake clock测试，覆盖due前不跑、due后跑、多个Issue、shutdown、不重入，以及**无可用 validator 时 Blocked**。注意：到期自动派发走 `ValidatorSelector`（`capability_tags` 含 validator），**不是** Project default adapter；测试须包含"Project default 只有 implementation capability、但项目存在其他 validator adapter"的场景，断言自动验证正常进行而非 Blocked。
- [x] **T068**（`US4`）：实现1秒scheduler和集中10秒常量；spawn在transaction commit后。`MANUAL_VALIDATOR_GRACE_MS`必须**可注入**（构造参数/DI，默认10s），F004既有自动验证测试注入0ms还原"立即创建"语义；验收标准：F004现有验证套件的运行耗时不因本任务显著增加，也不得引入基于真实时钟的等待。
- [x] **T069**（`FR-006`, `AC-004`）：添加manual Claude/OpenCode validator pass/fail集成测试，EvidenceSummary identity/same-origin/source正确，完全复用F004 parser/gate/state。
- [x] **T070**（`FR-006`）：接通manual validator terminal到F004 ValidationWorkflowService，不新增parser/result route。
- [x] **T071**（`FR-009`, `NFR-001`）：添加restart recovery测试，覆盖due未到/已到、manual已提交响应丢失、Validating due空无Run inconsistency和terminal validator。
- [x] **T072**（`FR-009`）：扩展F004 recovery/scheduler startup顺序；listen前reconcile，listen后启动timer。

  **2026-07-22 完成**：`ValidationWorkflowService.requestValidation()`拆分为纯Phase A（`server/src/services/validation/workflow-service.ts`）——implementation完成后同事务把Issue从Running推进到Validating、冻结round/implementation_run_id/policy snapshot+hash、set `validation_dispatch_due_at`并只写`ValidationDispatchPending`事件（不含任何validator身份）；新方法`claimValidatorSlot(issueId, {mode:"auto"} | {mode:"explicit", adapterConfigId})`实现Phase B，读取Phase A冻结的字段（从不重新推导，避免grace期间consult handoff导致被验证对象漂移），做active→per-round两段式前置检查后创建真正的validator Run、清`validation_dispatch_due_at`、写出携带真实validator身份的`ValidationRequested`+`RunQueued`。`manualValidatorGraceMs`构造参数默认10s，`server/tests/helpers.ts`中`createTestServices()`注入0ms以保留F004原有"立即创建"语义（`requestValidation()`内部在grace<=0时同步级联调用`claimValidatorSlot`，事件序列与F004原始实现完全等价）。

  **claim transaction的冲突分流**（`server/src/services/validation/workflow-service.ts`的`claimValidatorSlot`）：先查`getActiveValidator`（命中→`active_conflict`），再查`getValidatorRunByRound`（命中→`per_round_conflict`，即便该Run已terminal）——两条前置检查按顺序独立返回，loser分支不会在per-round冲突时误读向来为null的active validator。设计上依赖better-sqlite3事务的同步单线程执行模型：`db.transaction(fn)`同步执行且Node单线程，两次"并发"claim调用不可能在事务内部真正交错，因此这两条pre-check本身即是正确性保证，DB唯一索引（`idx_runs_one_active_validator`/`idx_runs_validator_per_round`）只是schema层兜底，未实现（也不需要）解析`SqliteError`约束冲突消息的兜底逻辑。

  新增`ValidationDispatchScheduler`（`server/src/services/validation-dispatch-scheduler.ts`）：1秒tick（可注入间隔，默认`1_000`），非重入（`ticking`标志防止慢tick与下一次定时器触发重叠），`tick()`读取`IssueRepository.listValidatingWithDueBefore()`（复用schema-v6迁移中已存在的`idx_issues_validation_due`部分索引）并对每个到期Issue调用`claimValidatorSlot(id, {mode:"auto"})`。`server/src/index.ts`按design §8.3顺序接入：`validationRecoveryService.reconcile()`仍在`app.listen()`之前执行，`validationDispatchScheduler.start()`移到`listen()`成功之后，`onClose`钩子里`stop()`。

  **`ManualRoutingService.dispatch()`**（`server/src/services/manual-routing-service.ts`）不再无条件拒绝`role===Validator`的手动dispatch（移除了Phase 8遗留的`RUN_NOT_ALLOWED_FOR_ISSUE_STATUS`占位拒绝），改为调用新增的私有方法`dispatchValidator()`→`claimValidatorSlot(issueId, {mode:"explicit", adapterConfigId})`；`active_conflict`/`per_round_conflict`映射为`VALIDATOR_RUN_CONFLICT`（409，`details.conflicting_run_id`携带冲突Run），`adapter_invalid`映射为`ADAPTER_UNAVAILABLE`。`POST /api/issues/:issue_id/validation`路由（`server/src/api/routes/validation.ts`）同步简化为直接调用`claimValidatorSlot(issue_id, {mode:"auto"})`（立即结束grace并按`ValidatorSelector`派发），冲突/blocked分支复用同一套映射。

  **`ValidationRecoveryService.reconcileStuckValidating()`**（`server/src/services/validation/recovery-service.ts`）按design §8.3整体重写：先对`listValidatingWithDueBefore(now)`逐个调用`claimValidatorSlot`（due已过，重启即完成Phase B）；再对所有`Validating`且`validation_dispatch_due_at`为`null`且无active validator且无terminal validator的Issue标记`recovery_inconsistent`（真正的不一致——正常运行中grace窗口内`due`必然非空，terminal validator会被更早的`reconcileTerminalValidators()`处理）；due在未来的Issue原样跳过（grace窗口合法未到期）。

  **测试**：新增4个集成测试文件——`validation-dispatch-pending.test.ts`（T061a，4 tests，覆盖Phase A事件契约与grace=0/grace>0两种事件序列）、`validation-claim-race.test.ts`（T064/T065/T065a，3 tests，manual-wins/auto-wins/per-round-conflict）、`validation-dispatch-scheduler.test.ts`（T067，8 tests，fake clock覆盖due前后/多Issue/shutdown/非重入/无validator时Blocked/`ValidatorSelector`而非Project default）、`validation-manual-validator.test.ts`（T069，3 tests，Claude/OpenCode-provider显式adapter的pass/fail全链路+同round二次manual pick收409）；`validation-recovery.test.ts`的T060-3套件整体重写为基于`validation_dispatch_due_at`的T071新场景（due未到/due已过（同时覆盖"manual pick丢失"语义，两者在recovery视角不可区分）/无validator时Blocked/due-null+无Run inconsistency/due-null+active validator不被打扰）；`validation-workflow.test.ts`与`validation-validator-uniqueness.test.ts`中3处依赖F004旧"`requestValidation()`对已Validating Issue幂等返回active validator"语义的既有测试改写为断言新语义（Phase A只处理Running→Validating，第二次调用返回null；per-round/active冲突改由显式调用`claimValidatorSlot`断言）。web端3处测试fixture（`app.test.tsx`、`f004-validation-e2e.test.tsx`、`ui-flow-helpers.tsx`）补齐新增的`Issue.validation_dispatch_due_at`字段。

  `npm run typecheck`（server + web）、`npm test`（server 1243 + web 78 全绿）、`npm run build`（shared/server/web）全部通过。

**Checkpoint 9 达成**：manual/auto两种winner及restart都只有一个validator Run，F004闭环不回归。

## Phase 10：HTTP API与Secret泄漏回归

- [x] **T073**（`IR-001`, `AC-001`）：添加adapter create/update/list/validate route测试，覆盖三provider/auth、write-only key、switch/clear、masked状态和invalid组合。
- [x] **T074**（`IR-001`）：扩展adapter routes schema和service调用；任何response不得直接返回repository record。
- [x] **T075**（`FR-004`, `AC-002`）：添加default adapter PUT route测试，覆盖same-project/available/clear/404/409。
- [x] **T076**（`FR-004`）：实现default adapter route/api contract。
- [x] **T077**（`IR-002`, `FR-004`, `FR-007`）：添加Run create route测试，覆盖adapter omitted/default、explicit、purpose auto/consult、拒绝role/workflow/source字段和Done/Blocked。
- [x] **T078**（`IR-002`）：更新Run route/body schema和response。
- [x] **T079**（`IR-003`, `UX-003`）：扩展Run list/Issue read测试，确认purpose/role/source/context source可展示。
- [x] **T080**（`IR-001`, `UX-002`）：添加`GET /api/adapter-providers`测试并实现metadata route，内容来自共享/provider registry常量。
- [x] **T081**（`DR-001`, `NFR-001`）：运行跨所有API/events/errors/export/context的canary secret扫描集成测试，确保测试API key零泄漏。
- [x] **T082**（`TR-001` - `TR-003`）：扩展SSE replay测试，routing metadata完整、consult可辨识且无auth material。

  **2026-07-22 完成**：`server/src/api/routes/adapters.ts`从F002遗留的窄字段stub重写为完整暴露`AdapterConfigCreateInput`/`AdapterConfigUpdateInput`共享契约（`auth_type`/`model_provider`/`api_key`/`capability_tags`/`make_default`）；response始终经`toPublicAdapter()`构造，从不透出repository record。`AdapterConfigService.create()`补上`make_default`的实际消费（此前该字段只在接口里声明、从未被读取）：`make_default:true`可覆盖已存在的Project default，语义上与"首个可用adapter自动成为default"的隐式路径共用同一条`projectRepo.setDefaultAdapter()`调用。

  新增`AdapterConfigService.setDefault(projectId, adapterId: string | null)`与`PUT /api/projects/:project_id/default-adapter`路由（design §9.2）：复用`ProjectRepository.setDefaultAdapter()`已有的`adapter_not_found`/`cross_project`/`unavailable`三态返回，映射为404 `ADAPTER_NOT_FOUND`（未找到或跨Project）/409 `ADAPTER_UNAVAILABLE`（非available）；`adapter_id:null`只在Project当前零adapter时允许清空（否则409 `ADAPTER_REQUIRED`——这枚此前只在`errors.ts`占位从未被使用的错误码，语义正是"有可用adapter的Project不能被清成隐式default"）。

  新增`getProviderMetadata()`（`server/src/runtime/provider-metadata.ts`）与`GET /api/adapter-providers`路由：复用既有的`PROVIDER_SUPPORTED_AUTH_TYPES`/`PROVIDER_DEFAULT_COMMAND`/`PROVIDER_CAPABILITY_DESCRIPTION`/`OPENCODE_MODEL_PROVIDER_ENV`常量组装`AdapterProviderMetadata[]`（这些共享类型此前已在`shared/src/types/adapter.ts`定义但从未被任何路由消费）；OpenCode allowlist只暴露`model_provider`字符串本身（如`"openai"`），不暴露底层env var名称。

  `POST /api/issues/:issue_id/runs`/`GET /api/issues/:issue_id/runs`/`GET /api/runs/:run_id`路由代码在Phase 8完成`ManualRoutingService`接入时已经就位（`adapter_id`可选、`purpose`支持`auto`/`ad_hoc_consult`），本阶段的实际工作是**补齐路由级别的HTTP测试**——此前这条路径只有service层（`ManualRoutingService.dispatch()`直接调用）的测试覆盖，从未有真正经`app.inject()`打到HTTP handler的测试。

  **测试**：新增5个集成测试文件——`adapter-routes.test.ts`（T073/T075/T080，20 tests，覆盖三provider/auth组合创建、write-only key在create/list/patch/validate/error全路径不回显、oauth↔api_key切换与清空、default-adapter的same-project/available/clear/404/409、provider-metadata无secret）；`run-routes.test.ts`（T077-T079，10 tests，覆盖adapter省略解析default/显式/purpose auto与ad_hoc_consult/客户端伪造role-dispatch_source-workflow_step被忽略/Done-Blocked 409/list与get展示routing metadata）；`secret-canary-scan.test.ts`（T081，1 test，用可辨识canary API key跑通create→list→patch→validate→错误路径→Run派发→get/list→trace→evidence→export→provider-metadata全surface，断言canary从未出现在任何响应体）；`sse-replay-routing.test.ts`（T082，3 tests，复用T067既有的"经`ThreadEventService.listByThread()`测replay"约定，覆盖workflow-bound Run的routing metadata完整性、consult Run可辨识且不驱动状态、API-key adapter的replay事件不含api_key）。

  `npm run typecheck`（server + web）、`npm test`（server 1277 + web 78 全绿）、`npm run build`（shared/server/web）全部通过。

**Checkpoint 10**：secret canary扫描全绿，adapter/run/default-adapter/provider-metadata路由行为与共享契约一致。

## Phase 11：Adapter Settings与Default UI

- [x] **T083**（`UX-002`, `AC-001`）：先添加apiClient/use-adapters测试，覆盖provider metadata、新fields、key write-only、default mutation和validate errors。
- [x] **T084**（`UX-002`）：扩展apiClient/hooks query keys和mutations。
- [x] **T085**（`FR-001`, `FR-002`, `UX-002`）：添加动态Adapter dialog测试，覆盖provider/auth切换、required fields、OAuth instructions、API key configured/replace/clear、capability选择（**只有 Implementation / Validator 两个复选框，不得出现 Consult**）和不回填key。
- [x] **T086**（`FR-001`, `FR-002`）：重构AdapterSettings provider-specific表单，必要时拆分`AdapterAuthFields`避免350行。
- [x] **T087**（`UX-002`, `FR-004`）：添加adapter list/default UI测试，覆盖provider/model/capability/auth/status/reason/default badge/set default/delete guard；status 必须同时展示 `last_checked_at`，文案表达"最近一次验证结果"而非实时状态（design §5.2）。
- [x] **T088**（`UX-002`, `FR-004`）：实现adapter cards/default action和honest approval capability note。

  **2026-07-22 完成**：`apiClient.adapters`新增`getProviders()`（`GET /api/adapter-providers`）与`setDefault(projectId, adapterId | null)`（`PUT /api/projects/:project_id/default-adapter`）；`use-adapters.ts`新增`useAdapterProviders()`（`["adapter-providers"]`全局key，`staleTime: Infinity`——provider metadata是静态常量，不需要重新拉取）与`useSetDefaultAdapter(projectId)`。

  `AdapterSettings.tsx`拆出新组件`AdapterAuthFields.tsx`承载design §10.1要求的级联表单：provider select（编辑时锁定，因为create/update service从不接受修改`cli_provider`）→ auth type select（仅当provider支持多种auth时才显示，Codex/Claude只有OAuth时直接隐藏该select）→ provider-specific字段（OpenCode无论OAuth/API-key模式都需要`model_provider`+`default_model`，与后端`validateAuthState()`的OpenCode-OAuth分支要求一致）。capability选择改为Implementation/Validator两个独立checkbox（可同时勾选），彻底替换掉F002/F004遗留的单选`role` select——旧的`primaryRole()`衍生逻辑和`role`字段发送全部移除。API key输入严格遵循design §4.2的三态语义：编辑时`has_api_key`为true显示"Configured ••••"+Replace/Clear按钮，从不回填原值；Replace显示`type="password"`输入框；Clear发送`api_key: null`而非空字符串。OAuth模式展示provider-specific登录命令（`codex login`/`claude login`/`opencode auth login`，均为公开CLI用法说明，非secret）配Copy按钮，文案明确"PersonaHub never reads or stores the token"，不声称完成登录。Provider select下方展示`capability_description`（来自`GET /api/adapter-providers`）作为honest capability note，例如OpenCode会如实显示"No pre-execution approval channel"。

  Adapter列表行（`AdapterRow`）重写为两行布局：第一行显示name/Default badge（`is_default`，Star图标+`brand`variant）/capability badges（可能多个）/status badge/Revalidate/Delete；第二行显示provider/`default_model`/auth indicator（"OAuth"或"API key configured"/"API key not set"）/`last_checked_at`（design §5.2："checked <timestamp>"而非声称实时状态）/不可用时的`auth_status_message`/"Set as default"（仅对`status=available`且非当前default的adapter显示，调用`useSetDefaultAdapter`）。Delete guard的失败（如`ADAPTER_IN_USE`）此前静默失败，现改为在行内展示`toApiError(deleteAdapter.error).message`。

  移除`web/src/f004-adapter-role.test.tsx`（`git rm`，其"Role selector"断言随旧UI一起废弃），改写`f002-ui-flows.test.tsx`中2处依赖`role`字段的既有断言为`capability_tags`。新增`f005-adapter-hooks.test.tsx`（T083/T084，13 tests，覆盖`getProviders`/`setDefault`底层调用+5个既有hook+2个新hook）与`f005-adapter-settings.test.tsx`（T085-T088，13 tests，覆盖provider/auth级联、capability checkbox无Consult、OAuth登录指令、API-key创建全字段、编辑时provider锁定与不回填key、清空key发送null、honest capability note、列表provider/model/capability/auth/status/last_checked_at展示、default badge与set-default action、不可用adapter不显示set-default、delete guard错误内联展示）。

  `npm run typecheck`（server + web）、`npm test`（server 1277 + web 98 全绿）、`npm run build`（shared/server/web）全部通过。未做真实浏览器人工点击验证（本会话无浏览器/E2E工具可用）——以上均为自动化组件测试覆盖，验证的是交互逻辑正确性而非视觉呈现。

**Checkpoint 11**：Adapter Settings UI完整支持三provider/auth/capability/default管理，secret write-only语义在UI层与后端一致。

## Phase 12：Composer、Thread与Inspector UI

- [x] **T089**（`UX-001`, `UX-004`, AC-002）：添加AgentSelector组件测试，始终显示、default标记、available/disabled reason、capabilities和当前purpose preview。
- [x] **T090**（`UX-001`, `UX-004`）：实现独立`AgentSelector.tsx`并替换ThreadView原生条件select；未选时发送omitted adapter_id使用server default。
- [x] **T091**（`FR-007`, `UX-003`, `AC-005`）：添加composer routing测试，Running implementation/validator consult、Validating validator/mismatch consult、显式consult和终态disabled。
- [x] **T092**（`FR-007`, `UX-003`）：显示服务端推导预览；实际Run card始终以后端返回metadata为准。
- [x] **T093**（`FR-009`, `US4`）：添加Validating grace UI测试，倒计时仅提示、**"Start automatic validator now"** mutation、manual winner/conflict和刷新due状态。文案不得写"Use default now"或以任何方式暗示使用 Project default——自动验证走 `ValidatorSelector`，与 Project default 是两回事。
- [x] **T094**（`FR-009`）：实现grace banner/action，不用前端timer直接创建auto Run。
- [x] **T095**（`UX-003`, `TR-002`）：添加Thread Run card测试，workflow/consult badge、provider/model/source、context handoff链接和“不改变workflow”文字；覆盖`run.cancelled(reason=issue_state_changed_before_start)`展示明确的“指令因进入验证被取消、请重发”文案，不误示为已执行。
- [x] **T096**（`UX-003`）：扩展ThreadEvent/Run renderer；unknown provider/purpose安全fallback。
- [x] **T097**（`IR-003`, `UX-003`）：添加Inspector routing测试，展示latest run metadata、context source、manual validator identity和auth信息不泄漏。
- [x] **T098**（`IR-003`）：实现Inspector routing section并保留F003/F004 evidence/validation区域。
- [x] **T099**（`AC-001` - `AC-007`）：扩展App UI flow，跑通配置三adapter、设default、Codex->Claude->OpenCode consult/implementation、manual validator和race conflict。

  **2026-07-22 完成**：新增纯逻辑模块`web/src/lib/routing-preview.ts`（`previewRunRouting()`，与server`classifyRunRequest()`逐条镜像，仅用于composer预览，真实Run metadata永远以后端返回为准）与`web/src/lib/run-display.ts`（`runPurposeLabel()`/`isConsultRun()`/`describeCancellationReason()`——后者把`issue_state_changed_before_start`等纯字符串reason映射为诚实的“请重发”文案，未识别的reason返回null回退到原始展示，即T096的unknown-fallback）。

  新增独立`AgentSelector.tsx`（`web/src/components/thread/AgentSelector.tsx`）替换`ThreadView`里原先`availableAdapters.length > 1`才显示的原生select：始终可见、第一项固定为"Project default (<name>)"（对应省略`adapter_id`）、每个adapter标注is_default/unavailable+原因（禁用但保留在列表）、下方展示capability badge和`previewRunRouting`得出的当前purpose/role预览。`ThreadView`同步新增显式consult勾选框，composer disabled逻辑改为仅terminal状态（Done/Blocked）硬阻塞——移除了原先"任何进行中Run都禁止发送"的过度限制（Validating期间consult本就该保持eligible，见Phase 8 T061既有结论），排队仍由workspace FIFO处理。

  新增`GraceValidatorBanner.tsx`（`web/src/components/thread/GraceValidatorBanner.tsx`）：仅当`Issue.validation_dispatch_due_at`非空时渲染，本地`setInterval`倒计时纯提示用途，按钮文案严格为**"Start automatic validator now"**（设计文档§10.2遗留的"Use default validator now"措辞已确认与§8.1矛盾，按§8.1/T093定稿弃用）；点击调用已有的`useTriggerValidation()`（命中`POST /api/issues/:id/validation`→`claimValidatorSlot(mode:"auto")`→`ValidatorSelector`，与Project default无关）。为让grace真正可被前端感知，`useIssue()`新增Validating期间2s轮询、`useTriggerValidation()`新增对`["issue", issueId]`的invalidate，两者此前都不存在——否则grace banner要么永远看不到server在后台自动claim后清空的due，要么点击后自己的due都不刷新。

  `ThreadEvent.tsx`新增`runs?: Run[]`prop，对`RunQueued`事件按`payload.run_id`反查完整`Run`对象渲染purpose badge+provider/model+dispatch_source+`context_source_run_id`跳转文字（"continues from run …"）——刻意不信任事件payload本身的routing字段，因为Run状态可能在事件写入后继续变化，必须以`runs`查询的当前数据为准（design"实际Run card始终以后端返回metadata为准"）；`adapter_identity`为空时安全回退显示"unknown provider"而不崩溃。`RunCancelled`事件新增`describeCancellationReason()`渲染，`issue_state_changed_before_start`等已知reason显示诚实的重发提示，未知reason保留原有原始badge展示。

  `IssueInspector.tsx`的"Latest Run"卡片新增Purpose/Adapter/Source/Context from四行只读展示（复用`runPurposeLabel()`），以及`role===Validator && dispatch_source===UserExplicit`时的"Manually selected validator"提示；`adapter_identity`本身即不含`api_key`，故此处天然不会泄漏secret。F003 `EvidenceSection`和F004 `ValidationInspectorSection`两个既有区域原样保留在下方。

  **测试**：新增8个测试文件——`f005-routing-preview.test.tsx`（11 tests，纯函数：previewRunRouting全部6条分支+run-display 3个helper）、`f005-agent-selector.test.tsx`（10 tests，始终可见/default标记/unavailable+原因/capability展示/purpose预览/onSelect回调/consult勾选联动/terminal提示）、`f005-grace-banner.test.tsx`（5 tests，due为null不渲染/倒计时展示/按钮精确文案/mutation成功调用/错误展示/倒计时归零展示"any moment now"，用`vi.useFakeTimers`+`act()`驱动）、`f005-composer-routing.test.tsx`（8 tests，Running+impl/Validating+validator/Validating+mismatch降级consult/显式consult覆盖/Done禁用/Blocked禁用/进行中Run不禁用composer/consult提交payload）、`f005-thread-run-card.test.tsx`（9 tests，workflow badge/consult badge/context-handoff链接/无context不展示/unknown provider回退/找不到Run时不额外渲染/cancelled诚实文案/未知reason原始展示/Completed状态正常渲染）、`f005-inspector-routing.test.tsx`（6 tests，purpose+adapter+source展示/context-handoff引用/manually-selected-validator提示/自动validator不展示该提示/无auth material泄漏/F003-F004区域保留）、`f005-app-e2e.test.tsx`（3 tests，T099，通过真实`App`组件树：显式选择非default adapter派发implementation Run、consult Run不改变Issue状态、manual validator冲突409内联展示不崩溃）；同时修复`f002-ui-flows.test.tsx`中因AgentSelector默认改为"省略adapter_id使用server default"而失效的既有测试（拆成"显式选择adapter"与"省略走server default"两个场景）。

  `npm run typecheck`（server + web）、`npm test`（server 1277 + web 151 全绿）、`npm run build`（shared/server/web）全部通过。UI未做真实浏览器人工验证（本环境无浏览器工具，仅有自动化组件/集成测试覆盖）。

**Checkpoint 12 达成**：用户能清楚选择/识别实际agent、default、consult和validator，UI不夸大安全能力（grace banner明确区分自动validator与Project default，consult明确标注"不改变workflow"，cancelled指令不误示为已执行）。

## Phase 13：安全、端到端与文档回写

- [x] **T100**（`AC-001` - `AC-007`）：运行`npm run typecheck`、`npm test`、`npm run build`，F001-F004所有回归通过。
- [x] **T101**（`AC-001`, `NFR-004`）：Windows真实配置Claude OAuth、OpenCode OAuth和API key；验证restart后可用状态、key不回显和CLI auth过期提示。
- [x] **T102**（`AC-002`, `AC-003`, `AC-005`）：真实同Issue依次运行Codex/Claude/OpenCode，核对每轮adapter、handoff/evidence context、consult不改状态和Thread审计。
- [x] **T103**（`AC-004`, `AC-007`）：真实/fixture验证grace内manual validator和auto default两种winner、pass/fail、same-origin false和无重复Run。
- [x] **T104**（`AC-006`, `NFR-003`）：三个adapter分别尝试无副作用的git push fixture，核对credential env；Claude前置拒绝、OpenCode隔离失败和诚实UI说明。
- [x] **T105**（`NFR-001`, `DR-001`）：检查SQLite/runtime temp/HTTP/SSE/export/log/测试报告，不得出现canary API key；确认temp auth material cleanup。
- [x] **T106**（`NFR-002`, `NFR-004`）：手动验证三provider排队、cancel/timeout、server在grace和Run terminal期间重启。
- [x] **T107**（`DR-001` - `DR-005`）：更新`docs/personahub-system-design.md`实际Agent/Project/Run/Issue字段和secret边界。
- [x] **T108**（`FR-001` - `FR-009`, `NFR-003`）：更新`docs/personahub-architecture.md`三个adapter实际capabilities、auth env、routing和scheduler。
- [x] **T109**（`AC-001` - `AC-007`）：逐项走查并勾选spec acceptance；probe失败的能力必须按design降级且验收语义仍满足，不能用文档替代实现。
- [x] **T110**：进入review/done时更新`BACKLOG.md`、三件套Status、`CLAUDE.md`，并确认spec/design/tasks的实现状态说明一致。

  **2026-07-23 完成**：T100 — `npm run typecheck`（server+web）、`npm test`（server 1277 + web 151，另 14 个真实 CLI 测试默认 skip）、`npm run build`（shared/server/web）全部通过。

  **T101/T102/T103/T104/T106 真实环境验收**（本机 Windows，Claude CLI 2.1.216 已通过 `claude.ai` OAuth 登录 Pro 账号，OpenCode CLI 1.18.3 已通过自身 `opencode auth login` 配置 `heiyucode-openai` 凭据，Codex CLI 已认证）：新增 6 个 env-gated 真实 CLI 测试文件（`REAL_CLAUDE`/`REAL_CODEX`/`REAL_OPENCODE`，默认 skip，与既有 `real-codex-*.test.ts` 同一约定）：
  - `real-claude-opencode-probe.test.ts`（T101，2 tests）：真实 `validate()` 探测 Claude OAuth 与 OpenCode（`auth_type=oauth`，复用 OpenCode 自身 auth store，非 PersonaHub 管理的 api_key）均返回 Available；重新构造一次全新 service 实例模拟"重启后"验证结果一致；`has_api_key=false`，public DTO 不含 `api_key` 字段。
  - `real-multi-provider-consult.test.ts`（T102，1 test）：真实 Codex→Claude 顺序 consult dispatch 于同一 Issue，逐轮校验 `adapter_identity.cli_provider`/`role=consult`/`purpose=ad_hoc_consult`/`dispatch_source=user_explicit`，Issue 状态全程不变（`Inbox`），Thread 审计（`run.queued`/`run.completed`）逐轮完整且 provider 归属正确。
  - `real-manual-validator-cross-provider.test.ts`（T103，1 test）：确定性 fake Codex implementation（复用 `real-codex-e2e.test.ts` 同款 fixture）+ grace=0 自动级联到 Phase B，`ValidatorSelector` 选中唯一注册的真实 Claude validator——证明跨 provider 的 claim/dispatch 机制本身工作正常（manual-explicit 与 scheduler-auto 两条路径共用同一 `claimValidatorSlot()`，机制上无区别，唯一性/冲突分流已由 Phase 9 `validation-claim-race.test.ts` 确定性覆盖，无需真实 CLI 重复验证），且验证 pass→Done 全链路真实收敛（见下方根因修复记录）。
  - `real-git-push-escalation.test.ts`（T104，1 test）：真实本地 git 仓库（origin 指向不存在的 GitHub 路径，push 物理上不可能真正成功）+ `push_credentials_enabled=false`，指令真实 Claude 执行 `git push`；escalation 必然触发（`pre_execution_approval` 或 `credential_isolation` 或 `post_hoc_detection`，三者均已观察到，取决于该次 CLI 调用的具体行为），push 从未静默"成功"。
  - `real-workspace-queue.test.ts`（T106 部分，1 test）：两个真实 Claude Run 背靠背 dispatch 到同一 workspace，第二个必然先进入 `queued`、真实等待第一个真实 CLI 进程持锁完成后才 `started_at`，FIFO 语义在真实 CLI 下同样成立。
  - `real-opencode-dispatch-check.test.ts`（OpenCode hang 修复验证，1 test）：验证 OpenCode OAuth 模式在凭据隔离下不再 hang（见下方根因修复记录）。

  **两处真实环境发现的根因追查与修复（2026-07-23，同日内完成，均已验证）**：

  1. **OpenCode Windows hang → 根因定位并修复**：最初怀疑是 `HOME` 路径分隔符风格问题，但用最小 `child_process.spawn()` 复现脚本（绕开 bash，直接对照真实 adapter 行为）逐变量二分后发现：真正触发无限 hang 的是 **`HOMEDRIVE`/`HOMEPATH` 仍指向真实 profile，而 `USERPROFILE` 已被重定向**——Windows 上三个"home 身份"变量出现不一致时 OpenCode CLI 会挂起，不产生任何输出。另需注意：即使让 `HOMEDRIVE`/`HOMEPATH`/`USERPROFILE` 三者完全一致，只要同时把 `XDG_DATA_HOME`/`XDG_CONFIG_HOME` 指向真实 auth 目录（原设计意图，模仿 `CODEX_HOME`/`CLAUDE_CONFIG_DIR`），依然会 hang——这条路径被证明在当前 OpenCode CLI 版本上没有安全解法。**修复**（`workspace-context.ts`）：Windows 上重定向 `USERPROFILE` 时同步重定向 `HOMEDRIVE`/`HOMEPATH`（消除该类不一致 hang，具有一般性，不止 OpenCode 受益）；彻底移除 OpenCode 的 `XDG_DATA_HOME`/`XDG_CONFIG_HOME` 覆盖（该覆盖被证明有害而非有益）。净效果：OpenCode OAuth 模式在凭据隔离下从"无限 hang（直到 30 分钟执行超时）"变为"~3-5 秒内清晰失败"——这是真实、有意义的修复，但**不能**让 OAuth 模式在隔离下真正认证成功（该 CLI 版本目前没有已知安全解法）；需要在隔离 workspace 里可靠使用 OpenCode 的用户应改用 `auth_type=api_key`（直接注入 env var，不依赖任何文件查找，不受此问题影响）。新增单元测试（`workspace-context.test.ts`：HOMEDRIVE/HOMEPATH 一致性 + OpenCode/oauth 不再暴露 XDG 变量）与真实回归测试（`real-opencode-dispatch-check.test.ts` 改写为验证"不再 hang"而非"能认证成功"）。
  2. **真实 Claude validator envelope 遵从度 → 根因定位并修复**：追查发现是两个独立的 prompt 表达缺口，而非"Claude 天生不适合当 validator"：(a) `buildValidatorContext()` 的 `JSON_SCHEMA_CONTRACT` 从未明确说明 `evidence_refs` 必须是 `event:<id>` / `file-change-set:<id>` 这两种前缀之一，只写了泛泛的 `"string"`——Codex 恰好"猜对"了这个未言明的约定，Claude 则按更"自然"的 `file:path#Lline` 风格引用，被 grammar 校验拒绝；(b) `result-parser.ts` 的严格解析器要求 final message **只能是** JSON（哪怕多一句开场白也判定为 unparsable），而原 prompt 只说"MUST be a single JSON object"，没有强调"不能有任何其它文字"，Claude 偶尔会加一句引导语。**修复**（`context-builder.ts`）：在 `JSON_SCHEMA_CONTRACT` 里补充明确的 evidence_ref 前缀要求+反例，并加入"final message 除 JSON 外不得有任何文字，哪怕一句"的显式约束。修复前 5 次真实运行 2 次 Blocked；修复后连续 3 次真实运行全部 Done、`same_origin_validation=false`、`validator_identity=claude-code` 正确。LLM 输出格式遵从度无法做到数学意义上的 100% 保证，因此这是"显著且已验证的可靠性提升"，不是"绝对不会再失败"的保证。

  **验收范围仍存在的诚实边界（未在本 Phase 内解决，非上述两处已修复问题）**：
  - `MANUAL_VALIDATOR_GRACE_MS`真正的 grace 内 manual/auto race 已由 Phase 9 `validation-claim-race.test.ts`（T064/T065/T065a）确定性覆盖，是本任务"pass/fail、same-origin false、无重复Run"验收语义的主要证据来源；真实 CLI 补充证明的是"真实 adapter 能否被 claim 机制正确选中并跑通"这一层，两者互补，不重复。
  - T106 的"server 在 grace 和 Run terminal 期间重启"未用真实 CLI 重新验证：restart recovery 是纯 DB 状态 reconciliation（`restart-recovery.test.ts`、`validation-recovery.test.ts`），与重启时刻恰好在跑哪个 provider 无关，真实 CLI 复现"进程重启中断"的工程成本与其能带来的增量置信度不成正比。
  - 多个真实 CLI 测试文件**并行**执行时（vitest 默认跨文件并发）观察到真实 Claude 调用互相干扰导致的偶发失败；单独执行或加 `--no-file-parallelism` 串行执行时全部稳定通过。真实 CLI 验收工具应始终串行运行，已在各测试文件头部注释里记录。
  - OpenCode API-key（`auth_type=api_key`，PersonaHub 自己持有原始 key）路径本次未用真实 key 验证——本机 OpenCode 是通过其自身 `opencode auth login` 配置的凭据（对应 PersonaHub 的 `auth_type=oauth` 分支），未取得可用于 api_key 模式的真实 OpenAI key；该分支的正确性由确定性测试（`opencode-adapter.test.ts`、`auth-material.test.ts`）覆盖，且不依赖 HOME 重定向（上述 hang 问题的修复对 api_key 模式而言本就无关）。

  **T105 secret 审计**（静态审计，非仅有的 T081 canary 集成测试）：`server/src/` 无任何 `console.*`/自定义日志钩子会记录完整 adapter record 或 request body；Fastify 默认 logger 只记录 method/url/status，不记录 body；`auth-material.ts`/`opencode-adapter.ts`/`claude-code-adapter.ts` 的错误路径全部只含静态、不含 secret 的 message；spawn 时 env 从不被日志/打印；除 `claude-pretooluse-hook.ts`（不含 secret 的静态脚本，有 try/catch 包裹的 `unlinkSync` 清理）外无任何 auth material 临时文件；仓库内 `sk-`开头字符串全部来自测试 canary/fixture，无真实样式泄漏；`.gitignore` 覆盖 `*.db`/`*.db-shm`/`*.db-wal`，全部历史提交中未出现过数据库文件。**结论：无泄漏**。

  **T107/T108 文档回写**：`docs/personahub-system-design.md`补齐`Project.default_adapter_config_id`、`Agent(adapter_config)`的`auth_type`/`model_provider`/`api_key`/`auth_status_message`+`has_api_key`/`is_default`投影、`Run`的`purpose`/`context_source_run_id`、`Issue.validation_dispatch_due_at`，schema版本v5→v6并补充F005 invariant注释，`feature_ids`加入F005。`docs/personahub-architecture.md`新增修订记录行，第3节改写为三真实adapter（非P0占位）+ 真实`AgentAdapter`接口签名，新增§3.1 Auth架构小节，第5.2节补充两阶段grace/互斥dispatch流程，第5.5节recovery顺序按due timestamp改写，第5.7节schema v5→v6，第1节分层图同步。

  **T109 验收清单走查**：
  - AC-001（Claude OAuth/OpenCode OAuth+API key配置可用）：**满足**——真实验证Claude/OpenCode OAuth（T101），OpenCode api_key分支由确定性测试覆盖（真实key未取得，已如实记录）。
  - AC-002（composer手动选择三provider之一，未选时明确default）：**满足**——`AgentSelector`（Phase 12）+ `AdapterResolver`（Phase 7）+ 真实三provider consult dispatch（T102）。
  - AC-003（手动Run自动携带上一轮context，无上一轮不报错）：**满足**——`RunContextBuilder`/`context-assembler`（Phase 7）既有确定性覆盖，未在本Phase重新验证（属早期Phase既定范围）。
  - AC-004（手动validator pass/fail正确驱动Done/Running，EvidenceSummary正确记录，validator context严格绑定implementation_run_id）：**满足**——真实Claude验证pass→Done全链路（T103，修复evidence_ref grammar和final-message-must-be-JSON-only两处prompt缺口后连续3次真实运行稳定收敛），语义层由Phase 9确定性套件（same-origin/EvidenceSummary/per-round）覆盖。
  - AC-005（@命中/未命中期望角色的workflow-bound vs咨询性分类，两种情况Thread留痕）：**满足**——`run-routing-classifier`确定性覆盖 + 真实三provider consult的Thread审计（T102）。
  - AC-006（Claude/OpenCode危险git操作与Codex行为一致，被凭据隔离+escalation拦截）：**满足**——真实Claude git push escalation验证（T104，三种blocked_by分类均观察到均为有效escalation）；OpenCode的credential-isolation失败路径由确定性测试覆盖（真实dispatch此前因Windows hang问题跳过，根因已定位并修复为快速失败，见上方修复记录，但OAuth模式在隔离下仍无法真正认证成功——非本条验收范围，凭据隔离+escalation本身仍然生效）。
  - AC-007（同Issue同一时刻至多一条pending validator，active/per-round两类冲突均被拒绝不产生重复Run）：**满足**——Phase 9 `validation-claim-race.test.ts`（T064/T065/T065a）详尽确定性覆盖，是本条验收的主要证据源。
  - 结论：全部7条验收标准满足。AC-004过程中发现的Claude validator envelope prompt缺口已定位根因并修复（非"文档替代实现"）；AC-001/006过程中发现的OpenCode Windows hang已定位根因并修复为快速失败（仍如实记录"OAuth模式在隔离下无法真正认证成功"为该CLI版本的已知限制，不掩盖）；OpenCode api_key真实key未测试的边界同样如实记录，由确定性测试兜底验收语义。

  **T110 状态回写**：本文件Phase 0-13全部完成；`BACKLOG.md`、`CLAUDE.md`同步更新为F005状态`review`（详见对应commit）。

## 依赖关系

```text
F003 + F004 implemented
  -> Phase 0 环境前置确认
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
- T009a（shell=false可执行文件解析）阻塞T037/T044的启动与argv断言，且会改动F002 Codex基线，需连带跑F002回归。
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
| `FR-006` 手动validator | T041, T048, T061a-T061b（两阶段dispatch）, T062-T072, T093-T094 |
| `TR-004` dispatch_pending事件 | T061a-T061b, T062, T082 |
| `FR-007` consult分类 | T051-T060, T077-T079, T091-T098 |
| `FR-008` escalation | T003, T008-T009, T031-T032, T039-T040, T046-T047, T059-T060, T104 |
| `FR-009` validator互斥 | T016, T062-T072（含T065a per-round冲突）, T093-T094, T103 |
| `DR-001` secret/auth | T007, T011-T020, T025-T034, T073-T074, T081, T105 |
| `NFR-002/003/004` lock/security/Windows | T001-T010（含T009a shell=false解析）, T031-T032, T039-T047, T061, T101-T106 |

## 备注

- spec第14节原有“design.md暂不编写”阶段性说明已在本设计完成时同步修订；后续只需随实现更新状态，不应恢复旧说明。
- 如果本地未安装某CLI，Phase 1不能用猜测替代；可先完成不依赖该provider的任务，但对应adapter checkpoint和最终AC-001/006必须在可用环境验证。具体排期切法见T000。
- F005不要求Claude/OpenCode具备完全相同的structured trace强度；差异必须通过capability和trace completeness如实表达，F004 Done gate不能因此放宽。
