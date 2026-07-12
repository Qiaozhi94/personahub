---
feature_ids: [Fxxx]
related_features: []
topics: []
doc_kind: tasks
created: YYYY-MM-DD
updated: YYYY-MM-DD
---

# Fxxx：功能名称 - 任务

> Status: draft | Owner: TBD | Spec: `spec.md` | Design: `design.md`

## 规则

- 任务应当能追踪到 `spec.md` 中的需求 ID。
- 任务应足够小，便于独立完成和验证。
- 只有当任务修改不同文件且没有顺序依赖时，才标记 `[P]`。
- 标记需求完成前，应先添加或更新对应测试。

## Phase 1：基础设施

- [ ] T001（`FR-...`）：...

## Phase 2：用户场景 1

- [ ] T002（`US1`, `FR-...`）：...
- [ ] T003 [P]（`US1`, `FR-...`）：...

## Phase 3：用户场景 2

- [ ] T004（`US2`, `FR-...`）：...

## Phase 4：验证

- [ ] T005（`AC-...`）：运行 ... 的自动化测试。
- [ ] T006（`AC-...`）：手动验证 ...

## 依赖关系

- T001 阻塞 ...

## 备注

- ...
