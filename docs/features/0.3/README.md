---
topics: [v0.3, trusted-task-workbench, planning]
doc_kind: plan
created: 2026-08-09
updated: 2026-09-08
---

# v0.3 Trusted Task Workbench

> V3.44 交互设计已于 2026-09-08 完成最终检视，产品体验重置的设计冻结解除。F009 已于 2026-09-12 收口为 `done`（实现代码检视循环 20 六轮收敛，`npm run verify:release` 与 Windows CI 全绿）；F010–F014 仍为 `draft`，必须逐个完成影响面核对和三件套评审后才能推进。

## 1. 版本判断

v0.3 的第一步是把 v0.1–v0.2 已交付能力迁入 V3.44 生产前端，停止在旧壳层上继续叠加功能；随后迁移到最终对象模型，并跑通“目标 → 派工 → 执行 → Artifact → 主张 / 证据 → 完成”的可信任务闭环。旧规划中“新增独立 Room 协作现场”和“新增独立 Squad 对象”已被最终设计推翻，不进入实现。

最终设计完整覆盖九个一级工作面，但 v0.3 不一次实现全部页面。一个工作面只有在具有真实数据、完整状态和可用动作后才进入生产导航；Memory、自动化与完整统计延至 v0.4，声明式插件 surface 延至 v0.8。

## 2. Feature 依赖顺序

可执行的无环顺序是 `F009 → (F010 ∥ F013) → F012 → F011 → F014`。Feature 编号保留产品追踪身份，不表示实现先后；F010 与 F013 在 F009 壳层边界冻结后可以并行。

| ID | Feature | 单一 intent | 依赖 |
|---|---|---|---|
| [F009](F009-v344-frontend-foundation-migration/spec.md) | V3.44 Frontend Foundation & Migration | 先用最终壳层重建 v0.1–v0.2 生产前端 | F001–F008 |
| [F010](F010-artifact-foundation-provenance/spec.md) | Artifact & Provenance Foundation | 建立不可漂移的阶段成果和统一引用 | F003、F004、F006、F009 |
| [F013](F013-project-skills-foundation/spec.md) | Space, Project & Skills Foundation | 建立归属根并统一项目文件边界与 Skill / 编组 | F009 |
| [F012](F012-session-dispatch-intervention/spec.md) | Session, Dispatch & Intervention | 将会话、执行选择、上下文与控制拆成可追溯对象 | F005、F006、F009、F010、F013 |
| [F011](F011-trusted-task-surface/spec.md) | Trusted Task Surface | 用四视图表达决策、会话、验收和资源 | F009、F010、F012 |
| [F014](F014-trusted-task-journey-closure/spec.md) | Trusted Task Journey Closure | 对整条旅程、迁移和发布验收负责 | F009–F013 |

F009 先完成生产前端换壳和既有能力迁移。F010 与 F013 互不依赖：F010 只拥有 Artifact core 与 `recordConsumption` 公共契约，不等待上下文组装器；F013 只验收 versioned effective-requirements 输出与路径授权 contract，不读取 Dispatch。F012 是上下文组装调用 `recordConsumption` 的最终集成 owner，并消费 F013 contract 冻结 Dispatch snapshot；F012 最终验收 Skill 升级 / 禁用不改已提交 Dispatch。F011 随后在已提交的 Dispatch / 会话契约上建立任务投影和验收写链。F009–F013 是 linked contracts，只有 F014 可以声明 v0.3 整体旅程完成。任何局部 Feature 完成不能替代端到端证据。

## 3. 范围边界

### 本版本交付

- V3.44 生产 App Shell、导航、路由、共享交互原语，以及 v0.1–v0.2 既有能力的兼容迁移。
- 旧页面 / 路由 / 动作迁移矩阵；旧壳层和重复写入口退出生产路径。
- Artifact 实体、不可变 revision、typed ref、消费记录和来源回放。
- 任务四视图：概览、会话、验收、资源；轨迹作为会话副栏。
- 主张—论证—证据与独立性状态，不使用信任分。
- Room 在界面统一为会话；Thread 不单独暴露。
- 派工记录、四维执行组合、三档上下文范围和可撤销启动。
- 一台执行机器的运行时基础、adapter 状态、模型 / 深度和工具事实。
- 项目主目录 / 只读参考仓库、项目文件范围、Skills / 编组最小闭环。
- 持久化 Space 根对象、默认 Space 升级和首次设置；Issue 必属 Space、可不属 Project。
- 从首次配置到真实 coding 任务可信完成的迁移与发布验收。

### 明确后移

- v0.4：Memory 内容 / 策略 / 诊断 / 效用闭环，自动化，完整统计，Provenance Gate 和 Skill 候选。
- v0.5：首个非 coding 垂直切片。
- v0.6：自动续派、智能编组推荐和受控修复回路。
- v0.7：多执行机器、daemon 化、隔离和后台队列。
- v0.8：声明式插件 surface、MCP 注入和外部协议。

## 4. 跨 Feature 不变量

1. Run / Attempt 是执行事实；Room / 会话、Task 页面和统计都不得复制第二套执行状态。
2. 被消费的 Artifact 始终指向确定 revision；更新不能改变历史输入。
3. agent 可见的内容必须能从持久事件重建。
4. 执行组合是 `adapter + 接入方式 + 模型 + 深度`，不再包装为 AI 成员。
5. 验证要求属于 Skill / 步骤的完成要求，不保留独立 Validation Policy。
6. 同源或上下文受污染的验证不能获得独立验证状态。
7. 配置、派工和执行分别有唯一写入口；事务提交前不得启动进程或广播成功事件。
8. v0.3 的迁移不得破坏 v0.1–v0.2 历史 Run、Trace、Evidence refs。
9. 新功能只进入 V3.44 壳层；旧界面不得与新界面并存第二个可写入口。
10. AcceptanceService 唯一写完成要求、主张链、风险接受与完成摘要；IssueService 只消费 `acceptance.completed` 推进 done，F014 只调用公开 API。
11. F013 是 Space schema、默认数据迁移与首次设置的唯一 owner；`issues.space_id` 非空，`issues.project_id` 可空，游离任务仍有明确归属根。
12. `artifact_consumptions.dispatch_id` 在 F010 是 soft reference；F012 接入 `recordConsumption` 时必须在同一事务内校验 Dispatch 存在且与 `run_id` 归属一致，v0.3 不为补 FK 重建该表。

## 5. 版本验收旅程

使用 PersonaHub 自身仓库完成一个真实 coding 任务：

1. 从 F009 `v02-fixture-contract.md` 固定的 source commit `5ef5055`、release schema v10 原始 fixture
   启动，执行 v10 → v11 → current head 的真实升级链，再从已发布根入口 `/` 进入 V3.44 App Shell；
   随后创建的 canonical Project / Task deep link 可刷新恢复且没有旧写入口。
2. 配置项目主目录，检查一个 adapter 并得到至少一个可派工组合。
3. 只输入目标创建任务；确认前零写入，重复确认不重复创建。
4. 选择模型、思考深度和上下文范围；在撤销窗口结束后开始执行。
5. 执行产出文件变化与 Artifact revision，资源视图能从成果追到 Attempt。
6. 阶段结束后改用另一个模型、冷启动且只给结果进行验证。
7. 验收按完成要求展示主张、论证、证据与未覆盖项；同源负例明确降级。
8. 模拟一次中断并重启：已完成步骤不重跑，运行中 Attempt 标中断，可从该步恢复。
9. 生成完成摘要；从摘要可回放派工、上下文、Artifact revision、测试与验证者结论。

版本收口要求 `npm run verify:release`、真实 CLI 旅程和人工浏览器检查全部通过。

## 6. 里程碑

| 里程碑 | 包含 | 退出条件 |
|---|---|---|
| M1 前端迁移 | F009 | 新壳层承载 v0.1–v0.2 代表旅程，旧壳层和双写入口退出生产路径 |
| M2 核心契约 | F010、F013 | Artifact / ref、Space / Project / Skill requirements 与迁移策略关闭 |
| M3 可追溯派工 | F012 | 组合、上下文、Artifact consumption、撤销、介入与恢复可回放 |
| M4 可信任务面 | F011 | 验收写链与四视图读取同一 projection，11 个具名 Task state fixture 全部可达 |
| M6 旅程收口 | F014 | 真实 CLI 全旅程、迁移、E2E 和发布证据通过 |

不在设计稿定稿后沿用旧的 25–40 日估算。每个 Feature 完成影响面分析后单独估算，F014 只汇总已经有证据的估算。

## 7. 已采用决策

- 最终交互基线：`ui-reference/personahub-draft/personahub-v3.1/`（V3.44）。
- 实施顺序：先用 F009 替换生产前端骨架并迁移既有能力，再由 F010–F013 接管新的领域语义；F014 只做最终收口。
- 对象简化：ADR 0012；执行单位、会话、Skills / 编组和验证归属按其 2026-09-08 定稿修订。
- 主张—论证—证据：ADR 0010。
- Agent session 与上下文范围：ADR 0009 / 0011。
- Capability 与插件边界：ADR 0014 / 0018。
- 用量与统计口径：ADR 0017；完整聚合不在 v0.3。

## 8. 待确认问题

无版本级产品问题。Feature 级实现问题必须在各自 `design.md` 进入开发前关闭。
