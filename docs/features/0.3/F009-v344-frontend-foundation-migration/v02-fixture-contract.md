---
topics: [frontend, migration, fixture, schema-v10]
doc_kind: feature-contract
created: 2026-09-09
updated: 2026-09-09
---

# F009 v0.2 历史数据库夹具契约

## 0. 冻结来源

- source_release: `docs/features/releases/0.2.md`
- source_commit: `5ef5055`
- source_schema: `v10`
- target_schema_at_review: `v11`
- fixture_owner: `F009::T000`
- review_baseline: `main@f9af144`

“v0.2 fixture”固定指 v0.2 收口时的 schema v10，不指当前 HEAD。commit `5ef5055` 是 F008
交付 v10 schema、Workflow Template 与 runtime health 的源码边界；后续 BUG-003 的 v11 属于
发布后修复，必须作为升级步骤接受验证，不能反向改名为“v0.2 latest”。

## 1. 产物与生成方式

T000 建立以下可复用测试资产：

- `server/tests/fixtures/v02-schema-v10.sql`：从 source commit 的 v1–v10 migration 生成并审核的
  文本 schema snapshot；保留 `schema_version=10`。
- `server/tests/fixtures/v02-representative-seed.sql`：固定 ID / 时间戳的 raw SQL 数据集。
- `server/tests/fixtures/build-v02-fixture.ts`：在测试临时目录生成 SQLite 文件，启用 foreign keys，
  执行两份 SQL 并运行 `foreign_key_check` / `integrity_check`。
- `server/tests/integration/f009-v02-fixture.test.ts`：校验来源指纹、代表数据、v10 → v11 → current head
  升级与二次启动幂等。

builder 和 seed 不得调用当前 public API 造数，也不得先运行 current `applyMigrations()` 再删除字段来
伪装历史库；这两种做法只证明当前代码能读自己写的数据。schema snapshot 的规范化 SHA-256 写入
测试，任何变化都必须回到 source commit 重新生成并人工核对。生成的 `.sqlite` 只存在于测试临时
目录，不提交二进制数据库。

## 2. 代表数据最小集

夹具必须至少包含以下相互关联的历史事实；所有集合都使用多记录场景，避免单记录测试掩盖排序、
关联或分页错误。至少两个 Issue 与多个 Run 同时存在。

| Fixture ID | v10 事实 | 最小数量 / 形态 | F009 必须证明 |
|---|---|---|---|
| FX-PROJECT | Project / Workspace | 2 Projects；1 个已绑定 workspace、1 个未绑定 | 列表顺序、选择、原 ID 与 empty/partial 状态不漂移 |
| FX-TASK | Issue / primary Thread | 2 个以上 Issue，覆盖 running、blocked、done；每项 1 个 primary Thread | Task route 使用 Issue ID；状态与 Thread 归属不猜测 |
| FX-RUN | 顺序 Run / queue | 同一 workspace 至少 3 个 Run，含 completed、queued、failed | 多 Run 顺序、终态、失败原因与队列事实守恒 |
| FX-GRAPH | Graph / Node / Edge | 1 个完成 fan-out/fan-in graph；1 个 blocked graph 含可重试 node | node/edge/result ref、cancel/retry/resolve 的目标身份守恒 |
| FX-TRACE | ThreadEvent / Trace / FileChange | 同一 Run 至少 2 个命令事件、2 个文件变化和 1 个分页边界 | 时间序、分页 cursor、截断 / partial 标记不漂移 |
| FX-EVIDENCE | Evidence / summary | complete 与 partial 各 1 组，包含 handoff、test result、summary | 机器事实与摘要不混写，导出仍引用原 Run |
| FX-VALIDATION | validation 多轮 | 同一 Issue 至少 2 个失败 round 后通过；v10 每轮 1 个 validator Run | v11 将既有 validator Run 回填 `validation_attempt=1`，round 不合并 |
| FX-ADAPTER | adapter / workspace status | implementation、validator 各 1；available 与 unavailable 均有 | default、capability、workspace override 与诊断守恒 |
| FX-WORKFLOW | Workflow Template | 同 issue type 含 active 与 inactive version | 列表 / 详情只读；F009 无旧模板写入口 |
| FX-HEALTH | runtime health inputs | schema v10、workspace lock、queued Runs、pending probe 均有 | 启动前后 schema 诊断与 runtime projection 分置正确 |

## 3. 升级与验收顺序

1. 用文本 snapshot + seed 生成 schema v10 数据库并断言 `MAX(schema_version)=10`。
2. 首次以当前 server 启动，必须执行 v10 → v11 → current head 的真实 migration 链；不得跳过 v11
   或直接覆写版本号。
3. 验证 v11 BUG-003：每个历史 validator Run 的 `validation_attempt=1`，原 run / issue / thread ID、
   round、timestamp 与 evidence ref 不变。
4. 再次启动同一数据库，schema 与代表记录计数不变，证明 migration 和 F009 读取均幂等。
5. 将升级后的同一个临时数据库交给 Playwright webServer，完成 Project → Task → Run / Graph →
   Trace / Evidence → validation 黄金旅程；禁止另建一份由当前 API seed 的 E2E 数据库。

T000 的 AC：上述五步自动化测试全绿，并做一次变异验证——把 snapshot 的 schema version 改成 11
或删去一个关联 Issue，测试必须分别因来源版本或 foreign key / 代表数据断言失败。Phase 0 fixture
通过前不得执行 T001；T021 只消费该 builder，不自行维护第二套 seed。
