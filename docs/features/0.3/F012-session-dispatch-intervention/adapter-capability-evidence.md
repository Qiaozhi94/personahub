---
topics: [session, dispatch, runtime, adapter-capability, evidence]
doc_kind: note
created: 2026-09-14
updated: 2026-09-14
---

# F012 Adapter Capability Evidence（T000）

> 原始机器可读结果：`server/tests/fixtures/f012/capability-evidence.json`（由
> `server/scripts/f012-capability-probe.mjs` 生成，含 CLI 版本、时间、命令与脱敏
> 结果）。缺记录一律按 `unverified` 处理（NFR-003）；supported / unsupported /
> unverified 三态裁决由 `server/src/services/capability-evidence.ts`
> 的 `verdictForAdapterCapability()` 统一推导——证据缺失、格式损坏、CLI 版本不
> 匹配或超过保留期（30 天）都会降级为 `unverified`，不会反向升级。

## 探测环境

- 探测日期：2026-09-14（本机 = 真实执行环境，按 SOP「真实环境测试纪律」直接执行）
- codex-cli **0.154.0** / Claude Code **2.1.268** / opencode **1.18.30**
- 变异证明：`server/tests/unit/capability-evidence.test.ts`（删字段 →
  EVIDENCE_MALFORMED；改 CLI 版本 → EVIDENCE_STALE；过期 → EVIDENCE_EXPIRED；
  缺行 → EVIDENCE_MISSING，全部降级为 unverified 且不可进入独立性验证）

## Codex（codex-cli 0.154.0）— 四项全部 supported

| 能力 | 裁决 | 证据 |
|---|---|---|
| model_enumeration | supported | app-server JSON-RPC `initialize` → `model/list` 返回可见模型目录（gpt-6-astra、gpt-5.6-sol/terra/luna、gpt-5.5）及每个模型各自的 `supportedReasoningEfforts` |
| depth | supported | 对 `model_reasoning_effort=__bogus_level__`，API 请求期返回 400：`Supported values are: 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', and 'max'`。三档映射：{low}→low、{medium}→medium、{high, xhigh, max, ultra}→high；`none`/`minimal` 不映射（关闭/极弱推理，不进候选） |
| session_resume | supported | `codex exec` 输出 session id（UUID），`codex exec resume <id> "…"` 成功召回首轮 token（PONG-CODEX-*) |
| native_memory_isolation | supported | `codex features list` 无任何已启用的 memory 特性（仅 `external_agent_memory_import = under development/false`）；CODEX_HOME 无 memory 目录。注意：`~/.codex/AGENTS.md`（用户手写配置，794B）会作为全局指引注入——这是用户配置不是模型自写记忆；私有 CODEX_HOME 隔离会丢 auth.json（见残余） |

残余：CLI 接受非法 effort 值直到请求期才报 400——adapter 下发前必须按 evidence 固化的档位表预校验。

## Claude Code（2.1.268）— enumeration 与 memory 隔离 unverified

| 能力 | 裁决 | 证据 |
|---|---|---|
| model_enumeration | **unverified** | 全部子命令清单中无 models 枚举命令（`claude --help` 完整捕获）；单个模型可用性只能用 `claude -p --model <id>` 实测。后果：无法核对"模型在该 adapter 可用集合"，依赖该能力的要求按 unverified 处理。重跑：升级 CLI 后重新检查 `claude --help` 是否新增 models 子命令 |
| depth | supported | `--effort __bogus_level__` 触发 CLI 警告：`Valid values: low, medium, high, xhigh, max`。映射：low→low、medium→medium、{high, xhigh, max}→high |
| session_resume | supported | `-p --output-format json` 返回 `session_id`；`--resume <id>` 成功召回首轮 token（PONG-CLAUDE-*），session id 保持不变 |
| native_memory_isolation | **unverified** | auto-memory 默认开启（`--bare` 的帮助文本列明它会跳过 auto-memory 与 CLAUDE.md 自动发现）；但 `--bare` 同时强制 API-key-only（永不读 OAuth），且实测 `CLAUDE_CONFIG_DIR=<私有目录>` 后 CLI 报 `Not logged in`——memory 与 OAuth 凭证同目录，逐次执行级隔离无法在不破坏登录的情况下演示。后果：不能承担要求独立性的验证；普通执行可选并附后果说明。重跑路径：在私有 CLAUDE_CONFIG_DIR 中播种凭证并验证 auto-memory 读写均落在私有目录 |

## OpenCode（1.18.30）— enumeration/memory 隔离 supported，depth unverified

| 能力 | 裁决 | 证据 |
|---|---|---|
| model_enumeration | supported | `opencode models` 返回 49 个 provider/model id（models.dev 目录，`--refresh` 可刷） |
| depth | **unverified** | `--variant` 存在（帮助文本："provider-specific reasoning effort, e.g., high, max, minimal"）但任意非法值被静默接受（实测 `--variant __bogus_level__` 正常完成），合法值集因 provider/模型而异且无枚举命令。无法建立可信的 depth_raw → 三档映射。重跑：`opencode models --verbose` 检查按模型的 variant 元数据 |
| session_resume | supported | `--format json` 事件流携带 `sessionID`（`ses_*`）；`--session <id>` 成功召回首轮 token（PONG-OC） |
| native_memory_isolation | supported | 布局实测：auth 在数据目录（`~/.local/share/opencode/auth.json`），全局 AGENTS.md 指引在配置目录（`~/.config/opencode/AGENTS.md`）；实测 `XDG_CONFIG_HOME=<私有目录>` 后执行成功（凭证不受影响），全局指引通道被结构性移出配置路径。项目内 AGENTS.md 属仓库内容，由路径授权/上下文范围控制，不属于 CLI 原生记忆 |

## 对 eligibility 的直接影响（T007 输入）

- codex 是唯一四项全 supported 的 adapter，可承担要求独立性的验证（在非同源、
  冷启动、上下文范围受控的前提下）。
- claude-code 的 enumeration / memory 隔离 unverified → `purpose=validate` 的候选
  必须标 blocked（结构性能力未知不可承担独立验证），`purpose=execute` 保持
  selectable 并附后果说明。
- opencode 的 depth unverified → 深度选择无法映射，深度维度按 unverified 后果
  处理；其余能力可用。

## 重跑

```
node server/scripts/f012-capability-probe.mjs                # 全部（含真实 API 调用）
node server/scripts/f012-capability-probe.mjs --only codex   # 单 adapter
node server/scripts/f012-capability-probe.mjs --import <db>  # 结果 upsert 进 adapter_capability_evidence
```
