---
feature_ids: [F012]
related_features: [F005, F007, F011]
topics: [squad, agent-group, roster, reuse]
doc_kind: design
created: 2026-08-09
updated: 2026-08-09
---

# F012：Reusable Agent Squads - 设计

> Status: draft | Owner: TBD | Spec: `spec.md`

## 1. 技术概要与数据模型

F012 固定使用 schema v14（F008=v10、F009=v11、F010=v12、F011=v13）。新增 `AgentSquadRepository/Service` 与纯函数 `mapSquadToGraphRoster()`；F007/F011 只调用映射与 DB-only snapshot primitive，不把 Squad 变成新执行入口。若 migration 落地前实施顺序改变，整体重新编号；已应用版本永不修改或追加。

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

## 2. Mapping contract

输入：Squad current members、Graph definition、workspace id、可选用户 overrides。对每个 node：

1. 以 position 稳定排序。
2. 调 `resolveEligibleAdapter()` 验证 Project/workspace/required capabilities。
3. override 存在则只验证该 id，不自动换回 Squad 候选。
4. 无 override 时若仅一个 eligible 直接建议；多个返回全部并用 position 第一项作 recommended，但确认 UI 必须显示；零个 blocked。
5. 同 adapter 可映射多个节点；不按 adapter 数量降级 topology。

返回沿用 F007 `AgentRosterRecommendation.by_node` 形状并增加 `{squad_id,squad_revision,snapshot_hash}`。confirm token 签名保护三字段与 chosen mapping；确认事务内重读 revision/status/成员与 effective status，不一致返回 `RECOMMENDATION_STALE`。

## 3. Room 应用与历史

`applySquadToRoom(tx, squad, mapping)` 只把 source_squad_id/revision/hash 和 adapter identity 写入 F011 room_members/Room created event。后续 Squad 编辑不传播。Room 中再次“应用 Squad”是显式成员变更，走 F011 control revision/reassign guards。

active Squad 引用 adapter 时，`AdapterConfigService.delete()` 返回 `ADAPTER_IN_ACTIVE_SQUAD` 并列出 squad ids；先移除或归档。归档后允许删除，FK SET NULL，identity snapshot 仍展示 provider/model/name。

## 4. API/UI/Event

| Route                                      | 行为                        |
| ------------------------------------------ | --------------------------- |
| `GET/POST /api/projects/:projectId/squads` | list/create                 |
| `GET/PATCH /api/squads/:id`                | detail/CAS edit             |
| `POST /api/squads/:id/archive`             | 幂等归档                    |
| `POST /api/squads/:id/preview-roster`      | 对 graph/workspace 只读映射 |

PATCH body 必含 expected_revision，members 是完整有序集合；不接受 role/capability 副本。preview 不 probe、不写库。

事件写 Project 级审计载体：若 F008 `admin_audit_events` 已存在，扩展 target_type=`agent_squad` 与 actions；Room applied 同时写 room ThreadEvent。事件保存成员 snapshot hash 与 ids，不保存 credential/auth 字段。

Settings 管理 Squad；intake/Room selector 显示 revision、成员 availability 与逐节点 mapping。错误包括 `SQUAD_NOT_FOUND/ARCHIVED/REVISION_CONFLICT/NO_ELIGIBLE_MEMBER/MEMBER_PROJECT_MISMATCH/ADAPTER_IN_ACTIVE_SQUAD`。

## 5. 测试与决策

- migration/name normalization、CAS、32 上限、跨 Project、delete SET NULL。
- mapping property tests：单 adapter 多节点、多候选、override、状态翻转、capability 缺口。
- F007 token stale/confirm 原子性、F011 apply/reapply/reassign、UI 全状态。

| 决策                                 | 理由                               |
| ------------------------------------ | ---------------------------------- |
| Squad 只存成员，不存 role            | capability_tags 是 F005 真相源     |
| current Squad 可变，Room 存 snapshot | 复用易用且历史稳定                 |
| preview 只读、confirm 复核           | 与 F007 零副作用/防 stale 契约一致 |

## 6. 待确认设计问题

全部关闭。F011 Room member snapshot 和 reassign contract 未冻结前，本 Feature 不得进入实现。
