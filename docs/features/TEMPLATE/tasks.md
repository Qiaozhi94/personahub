---
kind: feature
id: Fxxx
version: "0.x"
related_features: []
topics: []
doc_kind: tasks
created: YYYY-MM-DD
updated: YYYY-MM-DD
---

# Fxxx：功能名称 - 任务

> Owner: TBD | Spec: `spec.md` | Design: `design.md`

## 0. 来源与执行规则

- 行为与验收真相源：`spec.md`。
- 技术方案与边界：`design.md`。
- 每项任务只描述一个可验证动作，并引用合法的 US/需求/AC ID。
- 完成且验证后立即把 `[ ]` 改为 `[x]`，不得最后统一补勾。
- `[P]` 只用于修改不同文件、没有显式前置依赖且不会争用同一状态的任务。
- 实现中若任务顺序或契约失效，先修订三件套，再继续编码。

统一任务格式：

```markdown
- [ ] T001 [P] (`US-001`, `FR-001`, `AC-001`): <一个可验证动作> — verify: `path/to/test.ts`
```

## 1. 前置条件

- [ ] T001 (`DQ-001`): 关闭所有阻塞性 spec/design 问题 — verify: `spec.md`、`design.md`
- [ ] T002 (`FR-001`): 验证上游 Contract、依赖版本或真实环境假设 — verify: <证据路径/命令>

没有实现前置时写：`不适用：<理由>`，并从后续任务开始连续编号。

## 2. 实现任务

### Phase 1：<基础能力或最小用户切片>

- [ ] T003 (`FR-001`, `AC-001`): ... — verify: `path/to/test.ts`
- [ ] T004 [P] (`FR-002`, `AC-002`): ... — verify: `path/to/test.ts`

### Phase 2：<下一个独立切片>

- [ ] T005 (`US-002`, `FR-003`): ... — verify: `path/to/test.ts`

按需要增删 Phase；Phase 只能是本节的三级标题，任务 ID 必须全文件连续且唯一。

## 3. 验证与验收任务

- [ ] T006 (`AC-001`): 运行对应单元/集成测试 — verify: `path/to/test.ts`
- [ ] T007 (`AC-002`): 运行 UI/E2E 或真实环境验证 — verify: <命令或证据路径>
- [ ] T008 (`AC-001`, `AC-002`): 运行项目统一质量门 — verify: `<project verify command>`
- [ ] T009: 回写 spec 验收证据、活跃索引和状态 — verify: `<feature gate command>`

仅保留与本 Feature 适用的验证层级；客观无法执行的真实环境验证必须记录原因与补跑方式。

## 4. 依赖与并行关系

- `T001 -> T003`：...
- `T003 -> T005`：...
- `T004 [P]`：与 ... 可并行，原因是修改不同文件且无共享状态。

没有依赖时写：`无`。`[P]` 任务不得同时声明前置边。

## 5. 明确后移

- `<事项>` → `Fxxx` / `v0.x`：<为什么不属于当前范围>。

没有后移项时写：`无`。不得把当前 spec 范围内未完成的任务放入本节。
