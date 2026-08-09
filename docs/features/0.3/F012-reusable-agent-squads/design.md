---
kind: feature
id: F012
version: "0.3"
related_features: [F005, F007, F011]
topics: [squad, agent-group, roster, reuse]
doc_kind: design
created: 2026-08-09
updated: 2026-08-09
---

# F012：Reusable Agent Squads - 设计

> Owner: TBD | Spec: `spec.md` | Tasks: `tasks.md`

## 0. 输入与约束

- **行为契约**：`spec.md`。
- **PRD / Architecture / System Design**：`docs/personahub-prd.md` 第 5、15 节；`docs/personahub-architecture.md` Adapter/Agent；`docs/personahub-system-design.md` Squad 草案。
- **ADR / 上游 Contract**：F005 capability_tags、F007 intake roster、F011 Room member snapshot/reassign contract。
- **实现约束**：F008 = schema v10、F009 = v11、F010 = v12、F011 = v13、F012 固定 schema v14；已应用 migration 永不修改或追加。F007/F011 只调用映射与 DB-only snapshot primitive，不把 Squad 变成新执行入口。

## 1. 技术概要与影响面

F012 固定使用 schema v14（F008=v10、F009=v11、F010=v12、F011=v13）。新增 `AgentSquadRepository/Service` 与纯函数 `mapSquadToGraphRoster()`；F007/F011 只调用映射与 DB-only snapshot primitive，不把 Squad 变成新执行入口。若 migration 落地前实施顺序改变，整体重新编号；已应用版本永不修改或追加。

- 前端：Settings Squad 管理、intake/Room Squad selector。
- 后端 / API：schema v14、squad service、routes、mapping pure function。
- 存储 / Migration：agent_squads/agent_squad_members 表与索引。
- Runtime / Agent Adapter：无新执行入口；应用 Squad 走 F011 DB-only snapshot primitive。
- Event / Evidence：squad.* audit/ThreadEvent。
- 文档 / 配置：无新外部配置。

## 2. 架构与模块边界

- `AgentSquadRepository/Service`：create/list/detail/CAS edit/archive；编辑成员在一个事务内 CAS `revision`、替换 current rows、写事件。
- `mapSquadToGraphRoster()`：纯函数，输入 Squad current members、Graph definition、workspace id、可选用户 overrides；复用 `resolveEligibleAdapter()`，不写库。
- `applySquadToRoom(tx, squad, mapping)`：DB-only snapshot primitive，只把 source_squad_id/revision/hash 和 adapter identity 写入 F011 room_members/Room created event；后续 Squad 编辑不传播。
- `AdapterConfigService.delete()`：active Squad 引用 adapter 时返回 `ADAPTER_IN_ACTIVE_SQUAD` 并列出 squad ids；归档后允许删除，FK SET NULL，identity snapshot 仍展示。
- 唯一真相源：capability_tags 是 F005 真相源；Squad 只存成员与说明；历史通过 Room snapshot 与 event snapshot hash 保存，不为 Squad 自建完整版本表。

## 3. 数据模型与 Migration

```sql
CREATE TABLE agent_squads (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL,
  revision INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_squads_active_name
  ON agent_squads(project_id, normalized_name) WHERE status='active';
CREATE TABLE agent_squad_members (
  squad_id TEXT NOT NULL REFERENCES agent_squads(id),
  adapter_config_id TEXT REFERENCES agent_configs(id) ON DELETE SET NULL,
  adapter_identity_json TEXT NOT NULL,
  position INTEGER NOT NULL,
  added_at TEXT NOT NULL,
  PRIMARY KEY (squad_id, position),
  UNIQUE (squad_id, adapter_config_id)
);
```

编辑成员在一个事务内 CAS `revision`、替换 current rows、写事件；历史通过 Room snapshot 与 event snapshot hash 保存，不为 Squad 自建完整版本表。归档后不可编辑/应用。

## 4. 接口、Contract 与 Event

### API / CLI / Adapter Contract

| Route                                      | 行为                        |
| ------------------------------------------ | --------------------------- |
| `GET/POST /api/projects/:projectId/squads` | list/create                 |
| `GET/PATCH /api/squads/:id`                | detail/CAS edit             |
| `POST /api/squads/:id/archive`             | 幂等归档                    |
| `POST /api/squads/:id/preview-roster`      | 对 graph/workspace 只读映射 |

PATCH body 必含 `expected_revision`，members 是完整有序集合；不接受 role/capability 副本。preview 不 probe、不写库。

Mapping contract 输入：Squad current members、Graph definition、workspace id、可选用户 overrides。对每个 node：

1. 以 position 稳定排序。
2. 调 `resolveEligibleAdapter()` 验证 Project/workspace/required capabilities。
3. override 存在则只验证该 id，不自动换回 Squad 候选。
4. 无 override 时若仅一个 eligible 直接建议；多个返回全部并用 position 第一项作 recommended，但确认 UI 必须显示；零个 blocked。
5. 同 adapter 可映射多个节点；不按 adapter 数量降级 topology。

返回沿用 F007 `AgentRosterRecommendation.by_node` 形状并增加 `{squad_id,squad_revision,snapshot_hash}`。confirm token 签名保护三字段与 chosen mapping；确认事务内重读 revision/status/成员与 effective status，不一致返回 `RECOMMENDATION_STALE`。

### Event / Trace Contract

事件写 Project 级审计载体：若 F008 `admin_audit_events` 已存在，扩展 target_type=`agent_squad` 与 actions；Room applied 同时写 room ThreadEvent。事件保存成员 snapshot hash 与 ids，不保存 credential/auth 字段。

## 5. Runtime、Workflow 与并发

`applySquadToRoom(tx, squad, mapping)` 只把 source_squad_id/revision/hash 和 adapter identity 写入 F011 room_members/Room created event。后续 Squad 编辑不传播。Room 中再次“应用 Squad”是显式成员变更，走 F011 control revision/reassign guards。

active Squad 引用 adapter 时，`AdapterConfigService.delete()` 返回 `ADAPTER_IN_ACTIVE_SQUAD` 并列出 squad ids；先移除或归档。归档后允许删除，FK SET NULL，identity snapshot 仍展示 provider/model/name。编辑成员事务与 Room 应用事务分离，Squad CAS 由 `revision` 保护；confirm 事务内重读 revision/status/成员复核，stale 返回 `RECOMMENDATION_STALE`。

## 6. UI 与可观测性

Settings 管理 Squad（列表/编辑/archive、availability/capability 投影）；intake/Room selector 显示 revision、成员 availability 与逐节点 mapping。错误包括 `SQUAD_NOT_FOUND/ARCHIVED/REVISION_CONFLICT/NO_ELIGIBLE_MEMBER/MEMBER_PROJECT_MISMATCH/ADAPTER_IN_ACTIVE_SQUAD`，并展示阻塞说明与替换候选。

## 7. 失败、恢复、安全与兼容

- 校验与失败映射：`SQUAD_NOT_FOUND/ARCHIVED/REVISION_CONFLICT/NO_ELIGIBLE_MEMBER/MEMBER_PROJECT_MISMATCH/ADAPTER_IN_ACTIVE_SQUAD`；映射缺口返回逐节点 candidates/excluded，必须用户确认。
- 重启与恢复：Squad 状态持久化；历史 Room snapshot 不依赖 Squad current 状态，重启后仍可解释。
- 权限 / escalation / 凭据边界：跨 Project adapter 一律 404/拒绝；事件不保存 credential/auth 字段。
- Windows / POSIX / 版本兼容：无新平台相关行为；name normalization 跨平台一致。

## 8. 测试策略与验收映射

| 验收项 | 测试层级 | 计划文件 / 场景 | 关键断言 |
|---|---|---|---|
| `AC-001` | integration | `server/tests/integration/squad-crud-cas.test.ts`（计划） | 创建/编辑/归档与 revision conflict 正确 |
| `AC-002` | unit + integration | `server/tests/unit/squad-roster-mapping.test.ts`、`server/tests/integration/squad-apply-room.test.ts`（计划） | 逐节点能力映射，一个 adapter 可覆盖多节点 |
| `AC-003` | integration | `server/tests/integration/squad-failure-candidates.test.ts`（计划） | 失效/缺能力不被静默使用，响应含 candidates/excluded |
| `AC-004` | integration | `server/tests/integration/squad-history-snapshot.test.ts`（计划） | 更新/归档/改名不改变历史 Room snapshot |
| `AC-005` | integration | `server/tests/integration/squad-adapter-delete-guard.test.ts`（计划） | active 删除守卫与 archived SET NULL 均保留可解释历史 |
| `AC-006` | integration + manual | `server/tests/integration/squad-apply-room.test.ts`、真实 CLI | 选择 Squad 创建 Room 后实际 NodeRun 执行者与确认映射一致 |

覆盖 migration/name normalization、CAS、32 上限、跨 Project、delete SET NULL、mapping property tests（单 adapter 多节点、多候选、override、状态翻转、capability 缺口）、F007 token stale/confirm 原子性、F011 apply/reapply/reassign、UI 全状态。

## 9. 已确认决策与残余风险

| 决策 / 风险 | 结论或缓解 | 理由 | 替代方案 / 后续 |
|---|---|---|---|
| Squad 只存成员，不存 role | capability_tags 是 F005 真相源 | 能力在使用时判断 | 固定 role（未采用） |
| current Squad 可变，Room 存 snapshot | 复用易用且历史稳定 | 历史 Room 不漂移 | 自建完整版本表（未采用） |
| preview 只读、confirm 复核 | 与 F007 零副作用/防 stale 契约一致 | 防 stale | 无 |
| F011 契约未冻结则 F012 阻塞（风险） | 在 F011 member/reassign contract 冻结后实施 | 避免契约漂移 | 无 |

## 10. 待确认设计问题

- [x] DQ-001: Squad 是否自建完整版本表？ - 决策：不为 Squad 自建完整版本表；历史通过 Room snapshot 与 event snapshot hash 保存。
- [x] DQ-002: 能力判断时机？ - 决策：capability_tags 是 F005 真相源，Squad 只存成员与说明，能力在使用时通过 `resolveEligibleAdapter()` 判断。
- [x] DQ-003: F011 契约依赖？ - 决策：F011 Room member snapshot 和 reassign contract 未冻结前，本 Feature 不得进入实现。
