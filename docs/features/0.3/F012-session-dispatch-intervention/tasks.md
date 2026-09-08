---
topics: [session, dispatch, runtime, implementation]
doc_kind: tasks
created: 2026-08-09
updated: 2026-09-08
---

# F012：Session, Dispatch & Intervention - 任务

## 0. 来源与执行规则

行为以 `spec.md`、实现边界以 `design.md` 为准；旧字段迁移必须先写 fixture 再改 schema。

## 1. 前置条件

F009 新壳层与相关兼容入口已可替换；F010 ref / `recordConsumption` contract 冻结；F013 发布 effective requirements 与路径授权 contract。adapter probe 由本 Feature 的具名 Phase 0 任务负责，不作为无 owner 的外部前置事实。

## 2. 实现任务

### Phase 0：Adapter capability readiness

- [ ] T000 (`FR-003`, `FR-008`, `NFR-003`): 对 Codex / Claude Code / OpenCode 的模型枚举、深度、session resume / 冷启动和原生 memory 关闭效果运行真实 CLI probe；将 CLI 版本、时间、命令、脱敏结果与 supported / unsupported / unverified 裁决写入 `adapter-capability-evidence.md` 和机器可读 fixture，并用缺字段 / 过期版本变异证明 eligibility 保守失败。 — verify: `npm test`

Phase 0 probe 是进入 schema / eligibility 实现的门槛。客观无法执行的 probe 必须标 unverified、记录缺失项和重跑命令；不得把缺失 probe 当作 supported，也不得因此静默跳过独立性要求。

### Phase 1：模型与 eligibility

- [ ] T001 (`FR-001`, `FR-002`): 定义 Session / Dispatch / execution identity / context snapshot 类型。 — verify: `npm run typecheck`
- [ ] T002 (`FR-002`, `NFR-001`): 新增 migration、兼容映射与历史 fixture。 — verify: `npm test --workspace server`
- [ ] T003 (`FR-002`, `FR-003`, `FR-008`): 实现 runtime projection 与三档 eligibility evaluator，将 F013 versioned effective requirements 固定到 Dispatch snapshot；本任务覆盖 Skill 升级 / 禁用后的历史不漂移。 — verify: `npm test --workspace server`

### Phase 2：派工与介入

- [ ] T010 (`FR-004`, `NFR-001`): 实现确认即建 draft、draft 撤销、deadline CAS / starting lease，以及 context + consumption + Attempt / Run + dispatched 单事务提交；逐点故障注入并断言 commit 前零 spawn。 — verify: `npm test --workspace server`
- [ ] T011 (`FR-005`, `NFR-002`): 实现 context assembler、过滤事件与 resume key，并通过 F010 公共 API 幂等记录实际 Artifact consumption；本任务是该集成的最终 owner。 — verify: `npm test --workspace server`
- [ ] T012 (`FR-006`, `NFR-001`): 实现 pause / claim barrier、cancel / reassign 与 restart recovery。 — verify: `npm test --workspace server`
- [ ] T013 [P] (`FR-001`, `FR-007`): 实现独立会话与转任务。 — verify: `npm test`
- [ ] T014 (`FR-003`, `FR-004`, `FR-008`): 接入选择器、撤销横幅、会话与运行时基础 UI。 — verify: `npm test --workspace web`

## 3. 验证与验收任务

- [ ] T020 (`AC-001`, `AC-002`, `AC-003`, `AC-006`): 复跑 adapter evidence fixture、真实 CLI resume / 冷启动与原生 memory 隔离验证，并核对 unsupported / unverified eligibility 后果。 — verify: `npm test`
- [ ] T021 (`AC-002`, `AC-004`): 完成 cancel / claim、pause / claim 并发，过期 starting lease、kill/restart 与恢复集成测试。 — verify: `npm test --workspace server`
- [ ] T022 (`AC-005`): 完成 Playwright 派工、撤销、独立会话、介入和运行时旅程。 — verify: `npm run test:e2e`
- [ ] T023 (`AC-001`, `AC-002`, `AC-003`, `AC-004`, `AC-005`, `AC-006`): 运行发布质量门。 — verify: `npm run verify:release`

## 4. 依赖与并行关系

F013 contract 与本 Feature Phase 0 probe 完成后，T001→T002/T003→T010/T011/T012→T014；T013 可在 T002 后并行。T000 的证据缺口只能产生 unverified，不允许以口头假设解锁 T003。F011 在 Dispatch / Session / consumption integration 验收后接入，不形成反向依赖。

## 5. 明确后移

多机 daemon 移交 v0.7；自动续派与智能推荐移交 v0.6；用量聚合移交 v0.4。
