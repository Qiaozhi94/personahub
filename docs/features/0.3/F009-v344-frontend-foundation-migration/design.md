---
topics: [frontend, v344, migration, app-shell, accessibility]
doc_kind: design
created: 2026-09-08
updated: 2026-09-08
---

# F009：V3.44 Frontend Foundation & Migration - 设计

## 0. 输入与约束

输入为本目录 `spec.md`、开发前冻结的 `migration-matrix.md`、V3.44 `design.md` / `implementation-notes.md`、F001–F008 release contract 和当前 `web/src` 实现。设计稿决定交互结构，PRD / Feature 决定生产范围；不得复制原型静态数据。

## 1. 技术概要与影响面

以新的 application shell、route registry、共享交互原语和 legacy view adapter 替换当前单页三栏拼装。既有 hooks / API client 和领域命令优先复用；迁移矩阵把 surface 分为 stable-shell / final-surface / transitional-host，旧视觉容器直接退役。transitional-host 只包装既有事实读取或保持 v0.2 旅程所必需的最小动作，不接受最终视觉重做。

## 2. 架构与模块边界

`ApplicationShell` 只负责全局导航、路由出口、页面层级和全局反馈；`SurfaceRegistry` 只注册达到生产条件的工作面；`LegacyViewAdapter` 把现有 API DTO 转成过渡 view model，不反向写数据库。写动作继续调用 F001–F008 canonical API。共享 dialog / tabs / table / feedback primitives 统一承载可访问性契约。

### M1 SurfaceRegistry manifest

Registry state 只有 `enabled`、`visible-disabled`、`not-registered`。`enabled` 必须同时有真实 route、
真实数据来源与至少一个可完成的用户目的；`not-registered` 不渲染导航控件、不可聚焦，也不接受
deep link。M1 没有 `visible-disabled` 槽位：当前没有任何未交付一级面必须提前占位，提前显示只会
形成无法完成的承诺。

| 一级槽位 | Registry state | 默认 route | 真实数据来源 | M1 允许动作 | 生命周期 / 接管者 | URL 保持 |
|---|---|---|---|---|---|---|
| 任务 | `enabled` | `/tasks` | projects、issues、threads、runs、graph、trace、evidence、validation | 迁移矩阵 A004–A024 | stable shell + F011/F012 transitional hosts | `/tasks/:taskId` 保持；F011 只扩展 view |
| 会话 | `not-registered` | — | 当前只有内部 Thread，无 Session identity | 无 | F012 注册 | 不保留未发布 URL |
| 项目 | `enabled` | `/projects` | projects、workspace | 迁移矩阵 A001–A003 | stable shell + F013 transitional host | `/projects/:projectId` 保持；F013 只扩展 tab |
| 自动化 | `not-registered` | — | 未交付 | 无 | v0.4 候选 Feature | 不保留未发布 URL |
| 记忆 | `not-registered` | — | 未交付 | 无 | v0.4 候选 Feature | 不保留未发布 URL |
| 能力 | `not-registered` | — | F009 无 Skill / MCP canonical API | 无 | F013 先注册 Skills；MCP 等后续 contract | 不保留未发布 URL |
| 运行时 | `enabled` | `/runtime` | adapters、workspace lock、queue、background probe | 查看执行资源；在 `/runtime/adapters` 执行 A025–A027 | F012 transitional host | `/runtime` 保持，内部 projection 可替换 |
| 统计 | `not-registered` | — | 未交付 | 无 | v0.4 Usage / Monitoring 候选 Feature | 不保留未发布 URL |
| 设置 | `enabled` | `/settings/system-diagnostics` | runtime-health 中的 schema / app diagnostics、legacy workflow 读取 | 查看系统诊断；查看 legacy workflow 列表 / 详情 | stable shell + F013 legacy workflow host | 设置 base 保持；子页只在真实页面存在时注册 |

数据与动作分置规则：adapter 配置和执行资源读数只在 `/runtime`；schema / 应用基础设施只在
`/settings/system-diagnostics`；代码目录绑定只在 `/projects/:projectId` 的兼容区；legacy Workflow
Template 只在 `/settings/legacy-workflows` 只读。相同事实可以来自同一 runtime-health response，
但 registry projection 必须按上述归属裁剪，不在两个 surface 重复解释或提供动作。

## 3. 数据模型与 Migration

不新增或改写业务表。需要保留的前端偏好仅限非领域 UI 状态；路由 alias 和页面迁移矩阵以代码 / 文档常量维护。旧 schema 的数据库升级不在本 Feature，F014 负责跨版本 migration；本 Feature 只保证 v0.2 当前 schema 数据可读可操作。

## 4. 接口、Contract 与 Event

当前生产 App 只通过 React local state 选对象，已发布 URL inventory 只有 `/`；legacy resolver 只接受 inventory 中有 release 证据的条目，不猜历史对象 ID。M1 route manifest 如下：

| Pattern | Route identity | M1 结果 | Canonicalization / failure |
|---|---|---|---|
| `/` | 已发布 legacy entry | 先加载 Project 列表；有数据时 `replace` 到 `/projects/:projectId`（API 稳定顺序的第一项），无数据时保留 `/` 并显示项目创建入口 | 不生成历史对象 alias；首次 replace 不增加 History 项 |
| `/tasks` | Task list | 以选定 project query 或 Project 列表第一项加载既有 Issue 列表 | 无项目时显示可恢复 empty state；`not_found` / `from` query 只作诊断，不参与对象身份 |
| `/tasks/:taskId` | Task object | `taskId` 在 M1 中严格等于既有 Issue ID；加载该 Issue 及内部 `primary_thread` | 未知 ID `replace` 到 `/tasks?not_found=<id>&from=<encoded-path>`；Thread ID 不进入公开 URL |
| `/projects` | Project list | 加载既有 Project 列表 | 空列表显示创建入口 |
| `/projects/:projectId` | Project object | `projectId` 严格等于既有 Project ID；显示项目兼容页 | 未知 ID `replace` 到 `/projects?not_found=<id>&from=<encoded-path>` |
| `/runtime` | Runtime summary | 执行资源只读摘要 | 未知子路径进入统一非法子路径处理 |
| `/runtime/adapters` | Adapter compatibility settings | 既有 adapter 配置唯一入口 | 写入仍走既有 canonical adapter API |
| `/settings/system-diagnostics` | System diagnostics | schema / app infrastructure 只读诊断 | 不复制 runtime 状态 |
| `/settings/legacy-workflows` | Legacy Workflow evidence | 只读列表 / 详情 | 所有模板写动作不可达 |

M1 不发布 `/sessions/:sessionId`：当前 Thread ID 不是未来 Session ID，禁止生成 Thread→Session
猜测 alias。F012 发布 Session ID 后才注册 `/sessions/:sessionId`，并拥有旧 Thread ID 的显式 alias /
迁移契约。`/tasks/:taskId/:view` 在 F011 前、`/projects/:projectId/:tab` 在 F013 前都不注册；M1 收到
这些路径时分别 `replace` 到对象 base route，并附加 `route_issue=unsupported-view` 或
`route_issue=unsupported-tab` 与 `from=<encoded-path>`。F011 可在保持 base route 表示默认概览的
前提下注册 `overview / conversation / acceptance / resources`；F013 可注册当时真实上线的 project
tabs，未上线的项目记忆仍不进白名单。

URL 是选择状态的唯一真相源。刷新先解析 route 再加载对象；History 前进 / 后退必须重放 URL、
取消上一对象未完成的 loader，并且只在新对象解析成功后建立一份 SSE cursor 订阅。程序性默认跳转
与 canonicalization 使用 `replace`，用户选择不同对象或 surface 使用 `push`。not-found 和非法子路径
不得静默落到另一个对象，诊断 query 在用户明确选择有效对象后清除。兼容 projection 只组合现有
projects、issues、threads、runs、trace、evidence、adapters、workflow templates 和 runtime-health
API；route 切换不得重复订阅或制造事件。

## 5. Runtime、Workflow 与并发

不改变 graph、run、validation 和 adapter runtime。页面切换保留当前对象与未提交输入；重复提交、SSE replay 和写后读一致性沿用现有 service contract。旧入口一旦从生产 registry 移除，不再接受新写入。

动作所有权以 `migration-matrix.md` 的 action ID 为准：T010 迁移 A001–A005；T011 的执行 / 派工
host 迁移 A006–A015；T012 的任务事实与验收 host 迁移 A016–A024，其中 A016–A020 是只读事实，
A021–A024 是保留的用户动作（trigger validation、unblock、reset rounds、复制 / 下载摘要），不得因
“Trace / Evidence 只读”而省略。T013 迁移 A025–A029；旧 Workflow Template 的 A030 保持 retired，
前端不得调用其 create-version / activate / deactivate API。

同一个 action ID 在生产 registry 中只能挂到一个 host。迁移顺序是：新 host 的目标回归测试先红，
接入同一个 canonical API 后变绿，再从旧 registry 移除原入口；不得先删除旧入口，也不得在新旧
host 同时保留写按钮。切换期间若新 host 不满足可用条件，保持旧 host 为唯一入口并阻止切流，
不能以“双入口方便回退”作为恢复方案。

## 6. UI 与可观测性

先落全局 token、字体层级、导航、主栏 / 副栏框架和 loading / empty / error / partial 组件，再迁移项目、任务与既有事实。执行 / validation 写入口以最小 transitional-host 保住 v0.2 旅程；Trace / Evidence 使用只读宿主；adapter / runtime health 只做设置或运行时的最小读取与既有配置入口；旧 Workflow Template 只保留只读列表 / 详情，不重做编辑器，由 F013 Skill 面替换。未交付工作面不注册。开发态提供 route / surface 清单和 legacy adapter 计数，生产界面不出现设计过程术语。

## 7. 失败、恢复、安全与兼容

路由解析失败回到可恢复的对象列表并保留原 URL 诊断信息；兼容字段缺失显示 unknown / legacy，不从当前配置猜历史值。Markdown、文件预览、凭据和真实路径继续遵守既有安全边界。高风险动作统一显示影响、不影响和恢复路径。

## 8. 测试策略与验收映射

AC-001 使用 v0.2 fixture 黄金旅程；AC-002 由迁移矩阵静态校验、route registry 扫描和旧组件入口断言覆盖；AC-003 用 release / source inventory 锁定历史根入口，并覆盖每类新 canonical route 的直达、刷新、未知 ID、非法子视图；AC-004 覆盖共享原语的 axe / 键盘 / viewport / console；AC-005 以 API mock 调用断言和 adapter dependency test 验证无第二写入口。

## 9. 已确认决策与残余风险

确认 F009 是 v0.3 首个实施 Feature；它迁移现有能力，不等待 F010–F013 的新模型，也不承诺设计稿九个工作面全部上线。迁移矩阵每个 transitional-host 必须记录 `replacement_owner`、`delete_when`、`latest_milestone`，并由 F011 / F012 / F013 验收时删除。残余风险是视觉迁移扩大为业务重写，以“数据库零变更、canonical API 不变”“不得为 transitional-host 重做最终视觉或新增领域逻辑”和迁移矩阵作为硬边界。

## 10. 待确认设计问题

- [x] DQ-001: M1 是否提前发布 Task view、Project tab 与 Session deep link？ — 决策：不提前发布；M1 只注册 route manifest 中已有稳定身份和真实页面的 base route，F011 / F013 / F012 分别在自身契约可用后扩展，非法子路径按 manifest 确定恢复。
- [x] DQ-002: 九个 V3.44 一级槽位在 M1 是上线、占位还是隐藏？ — 决策：按 M1 SurfaceRegistry manifest 逐项注册；任务、项目、运行时、设置 enabled，其余 not-registered，M1 不设置 visible-disabled 一级槽位。
- [x] DQ-003: Trace / Evidence 的只读宿主是否可以省略 validation trigger、unblock 与 reset rounds？ — 决策：不可以；只读只限定 A016–A020 的事实投影，A021–A024 作为独立用户动作迁移并继续调用既有 canonical API。
