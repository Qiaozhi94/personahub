---
topics: [frontend, v344, migration, app-shell, accessibility]
doc_kind: design
created: 2026-09-08
updated: 2026-09-11
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

### 命令面板（全局导航原语，BC-030）

命令面板是 `ApplicationShell` 拥有的全局导航原语，不是独立工作面。入口为竖栏「跳转」按钮与
`Ctrl+K` 快捷键，二者等价；打开后是由共享 dialog 原语承载的「跳转」弹层（combobox 语义，遵守
BC-048/049 的可访问标题、焦点陷阱与焦点归还契约）。候选目标只来自 SurfaceRegistry 中
`enabled` 槽位及其列表中的真实对象；`not-registered` 槽位（会话、自动化、记忆、能力、统计）
不得作为候选出现。Enter 携带选择导航并关闭弹层；Escape 关闭且不改变当前 route。BC-030
「命令面板可开可关」的生产断言对象即此原语：打开可见 → Esc 关闭隐藏，且候选集合满足上述
注册边界。

## 3. 数据模型与 Migration

不新增或改写业务表。需要保留的前端偏好仅限非领域 UI 状态；路由 alias 和页面迁移矩阵以代码 / 文档常量维护。F009 不拥有新 migration，但必须按 `v02-fixture-contract.md` 从 v0.2 release v10 原始 SQL 数据启动，执行既有 v10 → v11 → current head migration 后验证新壳层可读可操作；F014 负责覆盖更多发布 schema 与跨 Feature 最终 migration report，不能替代 F009 的 v10 基线。

## 4. 接口、Contract 与 Event

当前生产 App 只通过 React local state 选对象，已发布 URL inventory 只有 `/`；legacy resolver 只接受 inventory 中有 release 证据的条目，不猜历史对象 ID。M1 route manifest 如下：

| Pattern | Route identity | M1 结果 | Canonicalization / failure |
|---|---|---|---|
| `/` | 已发布 legacy entry | `replace` 到 `/projects`，有无数据都不猜选对象 | 不生成历史对象 alias；首次 replace 不增加 History 项 |
| `/tasks` | Task list | 未指定 `project` query 时显示项目选择；指定有效 project 才加载其既有 Issue 列表 | 无项目时显示可恢复 empty state；未知 project 保留诊断；`not_found` / `from` query 不参与对象身份 |
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

URL 是选择状态的唯一真相源。`/` 和 `/tasks` 不得默认选择列表第一项；用户明确选择 Project 后才 `push`
到 `/tasks?project=<projectId>` 或 `/projects/:projectId`。刷新先解析 route 再加载对象；History 前进 / 后退必须重放 URL、
取消上一对象未完成的 loader，并且只在新对象解析成功后建立一份 SSE cursor 订阅。程序性默认跳转
与 canonicalization 使用 `replace`，用户选择不同对象或 surface 使用 `push`。not-found 和非法子路径
不得静默落到另一个对象，诊断 query 在用户明确选择有效对象后清除。兼容 projection 只组合现有
projects、issues、threads、runs、trace、evidence、adapters、workflow templates 和 runtime-health
API；route 切换不得重复订阅或制造事件。

## 5. Runtime、Workflow 与并发

不改变 graph、run、validation 和 adapter runtime。重复提交、SSE replay 和写后读一致性沿用现有 service contract。旧入口一旦从生产 registry 移除，不再接受新写入。

`TaskDraftStore` 由 `ApplicationShell` 持有，位于 route outlet 之上，不由会被路由卸载的
`ThreadView` / view component 持有。M1 唯一 key 是 `task:${taskId}:composer`；记录至少包含
`text`、`adapterId`、`explicitConsult`、`generation` 与 `revision`。`generation` 是同一 key 的 shell
生命周期代际：创建一份新草稿记录时从该 key 的 high-water 分配更大值；high-water 独立于记录
保存，清除记录不得重置 generation high-water。`revision` 只在同一 generation 内单调递增，
可以从 1 开始，不能脱离 generation 单独比较。Thread ID 不进入 key，因为 M1 不公开 Session /
Thread 身份；F012 增加独立 Session composer 时使用新的 `session:${sessionId}:composer` namespace，
不能复用 task key。

草稿生命周期如下：

- 输入变化同步写 shell 内存；切换 task、project、surface 或后续四个 task view 均不清除，回到同一
  task 时按 key 恢复。
- 提交开始时捕获 key + generation + revision；提交失败保留原记录和用户选择。只有匹配 key、generation
  与 revision 的成功响应可以清除；旧 task 的迟到响应或提交期间继续输入产生的新 revision 不得清掉
  新草稿。
- 显式丢弃在 pending 期间仍然允许：立即删除当前记录与刷新提示，但不取消已经发出的请求，也不回退
  该 key 的 generation high-water。随后 retype 必须创建更大的 generation；旧请求迟到的成功或失败响应
  都只能成为 no-op，既不能清除新草稿，也不能恢复已丢弃记录。对象 not-found / deleted 时同样清除记录
  但保留 high-water 并给出诊断；terminal / blocked 只禁用提交，不自动删除草稿。
- 浏览器刷新不恢复草稿，也不写 localStorage / sessionStorage / 服务端；存在非空草稿时注册
  `beforeunload` 原生提示，全部清空后立即移除。这样页面内导航连续，但敏感指令不会持久化到浏览器。

Draft store 是 UI 临时状态，不得进入 API DTO、SSE payload 或 compatibility projection。组件测试覆盖
reducer/key/generation/revision，浏览器测试覆盖跨 task/project/surface 往返、提交成功、提交失败重试、
迟到成功响应、显式丢弃、`submit N → discard while pending → retype → old success`、not-found 和刷新提示。

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

AC-001 使用 v0.2 fixture 黄金旅程；AC-002 由迁移矩阵静态校验、route registry 扫描和旧组件入口断言覆盖；AC-003 用 release / source inventory 锁定历史根入口，并覆盖每类新 canonical route 的直达、刷新、未知 ID、非法子视图；AC-004 以 `v344-browser-check-applicability.md` 为完整分母，只执行其中 adapted 的生产契约，并覆盖共享原语的 axe / 键盘 / viewport / console；AC-005 以 API mock 调用断言和 adapter dependency test 验证无第二写入口。分类总数和连续 ID 由文档测试校验；新增共享原语必须先做失败变异再实现。

### 黄金旅程的 M1 投影（README §5 九步）

README §5 的九步是 v0.3 版本级验收旅程（F014 收口）；F009 的 AC-001 / T021 只断言其中可由
「v0.2 已交付能力 + v10 fixture 事实」承担的 M1 投影。逐步断言设计稿见
`docs/reviews/journey-test-matrix.md` §1（J1–J9、S1）。

| 版本级步骤 | 归属 | M1 投影（T021 断言） |
|---|---|---|
| 1 fixture 升级启动 + canonical deep link | F009 | 全量投影：J1 / S1 / J9（升级链启动、根入口 replace、deep link 直达 / 刷新 / History） |
| 2 配置主目录、检查 adapter 得可派工组合 | 组合语义归 F012 | J2：绑定查看（A003）、adapter 验证 + 设默认（A026/A027）；「可派工组合」断言为验证通过事实 + 默认标记 |
| 3 只输入目标创建、确认前零写、重复幂等 | Dispatch 语义归 F012 | J3 全量（A006/A007 + BC-056/057） |
| 4 模型 / 深度 / 上下文 + 撤销窗口 | F012（BC-027/028/058 deferred） | 不投影；J4 只断言既有 adapter 选择与启动（A008/A009），无撤销窗口控件 |
| 5 Artifact revision、资源视图追到 Attempt | F010/F011（BC-023/059 deferred） | 不投影；J5 断言既有 Run 事实（命令事件 / 文件变化 / trace 归属）只读守恒 |
| 6 换模型冷启动、只给结果验证 | F012/F011（BC-028/042 deferred） | 不投影；J6 断言既有手动 trigger validation（A021）与 rounds 守恒 |
| 7 主张 / 论证 / 证据 / 未覆盖项、同源降级 | F011（BC-009~018 deferred） | 不投影；J7 断言 complete/partial evidence、rounds / findings / summary 只读 + A022–A024 动作 |
| 8 中断重启、不重跑、可恢复 | 完整语义归 F012 介入模型 | J8：取消 / 失败 / 阻塞守恒显示 + 重试 / resolve / unblock 可达 + 重启幂等；不断言 Attempt 中断恢复 |
| 9 完成摘要回放派工 / 上下文 / revision | F010/F011/F012/F014 | 不投影；J9 以既有摘要只读 + 导出守恒（A019/A024）与 deep link / History 承担 AC-003 |

版本级词汇与 M1 界面对应物的对照（断言文本按右列推导，界面不出现左列最终术语，遵守 UX-003）：

| 版本级词汇 | M1 界面对应物 |
|---|---|
| 可派工组合 | adapter 验证通过事实 + 项目默认标记（「执行组合」四维语义归 F012） |
| 派工 | 启动执行（A009/A010），沿用既有 v0.2 界面词汇 |
| Attempt / 执行单位 | Run / Graph Run（既有执行事实） |
| 主张—论证—证据、未覆盖项 | 验收兼容区 rounds / findings / summary 与 complete/partial evidence（F011 接管后替换） |
| 完成摘要 | 执行摘要只读事实 + 复制 / 下载（A024）；版本级回放归 F014 |
| 撤销窗口 | 无对应控件（F012 交付前不出现） |

### 需求级豁免与 E2E 数据口径

对 self-test §3.2.1 的一条显式豁免：第⑤段「SSE 断线重连按 `event_sequence` 补读」在 M1
无活跃事件源（fixture 全为终态、旅程不驱动真实 CLI），本 Feature 不断言，归 F011/F012 的
任务旅程，残余由 T031 裁定。

第④段「干净数据首屏」最初也按「T021 黄金旅程只能用 T000 v10 fixture 升级库、不存在干净库」
的理由整体豁免为不可自动化，自动化替代断言对象为未绑定项目绑定指引、not-found 与非法子路径
恢复态（S1），首屏指引整体归 T031 人工确认。DQ-008（见 §10）裁定这条豁免范围过宽：数据策略
约束的是 T021 黄金旅程内部不得出现第二套数据库，不禁止另建一个完全独立、不共用 T021
webServer 配置的空库测试。`e2e/playwright.empty-db.config.ts` + `f009-empty-database.spec.ts`
即是这样一个独立配置——DB_PATH 指向不存在的文件，真实 server 从零迁移，断言 `/`、`/tasks`、
`/runtime`、`/settings/legacy-workflows` 在零数据时渲染正确的空态组件与唯一可执行恢复动作；
S1 的未绑定项目 / not-found / 非法子路径恢复态仍由 T021 旅程本身覆盖，不重复。首屏文案措辞
是否读起来舒服，仍是 T031 的人工判断范围。

E2E 数据口径：T000 builder 升级后的临时数据库是唯一 seed；旅程内通过界面触发的 canonical 写
（A006/A007/A009/A021/A022/A023 等）是被测行为而非播种；不使用 `support/mock-run.ts` 造 Run
或事件。T021 的旅程 spec 为 `e2e/tests/f009-golden-journey.spec.ts`；applicability「生产测试
路径」列指定的其余 `f009-*.spec.ts` 属 T022 门禁，可承载对应旅程步骤的复证，但与 T021 共用
同一临时库与同一 webServer 配置，不得另建数据路径。

### adapted 行断言对象集合

adapted 行的断言对象是该共享交互形态在已注册 surface 中的实际实例集合。T022 实现时逐行清点
实例并回填 applicability 对应行；某行在 M1 暂无实例时，断言对象降为该原语在任一已注册 surface
的最小可达使用，不得静默跳过；T031 复核实例清点完整性。BC-005 的分组维度、BC-006 的标签域、
BC-052 的 tabs 实例均按此口径执行——fixture 中 Issue 携带非空 labels，标签域有真实数据。

### T031 人工检查记录

T031 按 `docs/reviews/journey-test-matrix.md` §1 逐步、§2 逐条对照真实浏览器执行；发现以
J*/S* 步骤编号回流 `dogfooding-bugs.md`（缺陷）与 `dogfooding-notes.md`（观察），分母核对
结果与逐条结论随 F009 收口文档归档，不把「未执行」写成「通过」——这条原则本身没有改变。
DQ-008（见 §10）改变的是 T031 的**范围**，不是这条原则：T031 里能被结构/行为事实表达的部分
（125 条分母核对、干净数据库首屏结构）已经转成门禁和 e2e 断言，`tasks.md` 的 T031 勾选仅代表
这部分范围通过；真正主观的审美 / 语感判断（黄金旅程逐步走查的视觉合理性、导出文案措辞）
从 T031 的完成条件里拆出，作为独立于开发流程、持续进行的人工体验复核，不写成某一轮的
「通过」或「未执行」，因为它本来就不是一次性可关闭的任务，而是常态化维护活动。

## 9. 已确认决策与残余风险

确认 F009 是 v0.3 首个实施 Feature；它迁移现有能力，不等待 F010–F013 的新模型，也不承诺设计稿九个工作面全部上线。迁移矩阵每个 transitional-host 必须记录 `replacement_owner`、`delete_when`、`latest_milestone`，并由 F011 / F012 / F013 验收时删除。残余风险是视觉迁移扩大为业务重写，以“数据库零变更、canonical API 不变”“不得为 transitional-host 重做最终视觉或新增领域逻辑”和迁移矩阵作为硬边界。

## 10. 待确认设计问题

- [x] DQ-001: M1 是否提前发布 Task view、Project tab 与 Session deep link？ — 决策：不提前发布；M1 只注册 route manifest 中已有稳定身份和真实页面的 base route，F011 / F013 / F012 分别在自身契约可用后扩展，非法子路径按 manifest 确定恢复。
- [x] DQ-002: 九个 V3.44 一级槽位在 M1 是上线、占位还是隐藏？ — 决策：按 M1 SurfaceRegistry manifest 逐项注册；任务、项目、运行时、设置 enabled，其余 not-registered，M1 不设置 visible-disabled 一级槽位。
- [x] DQ-003: Trace / Evidence 的只读宿主是否可以省略 validation trigger、unblock 与 reset rounds？ — 决策：不可以；只读只限定 A016–A020 的事实投影，A021–A024 作为独立用户动作迁移并继续调用既有 canonical API。
- [x] DQ-004: “v0.2 schema fixture”应取 release v10 还是当前 v11？ — 决策：来源固定为 F008 收口 commit `5ef5055` 的 v10；启动时必须走既有 v10 → v11 → current head migration，且 fixture 用 raw SQL snapshot / seed 生成，不调用当前 public API 自证。
- [x] DQ-005: V3.44 的 125 条 browser checks 哪些属于 F009？ — 决策：以 `v344-browser-check-applicability.md` 逐条分类，当前分母为 adapted 28 / deferred 96 / not-applicable 1；F009 只为 adapted 行提供生产证据，deferred 行不得提前暴露入口。
- [x] DQ-006: 未提交 composer 草稿由谁持有、何时保留或清除？ — 决策：由 ApplicationShell 上层的内存 TaskDraftStore 按 Task ID + composer 分键；页面内切换保留，匹配 revision 的成功提交 / 显式丢弃 / 对象消失才清除，刷新不持久化并用 beforeunload 提示。
- [x] DQ-007: legacy 根入口与无 project query 的任务列表是否自动选择第一项？ — 决策：不选择；`/` 只 replace 到项目列表，`/tasks` 显示项目选择，用户明确选择后才 push 带身份的 URL，避免 Project 更新时间改变默认对象。
- [x] DQ-008（review R1-011，2026-09-11）: 「干净数据库首屏」与 T031 其余可结构化验证的部分，是否必须整体留给人工、不可拆分自动化？ — 决策：不必须。原豁免把「T021 黄金旅程不能有第二套数据库」误推广成了「不存在任何空库测试」；两者不等价——一个不共用 T021 webServer 配置的独立 Playwright config 不违反前者。按新确立的「自动化与人工判断边界纪律」（`docs/SOP.md`）拆分：结构/行为事实（干净库首屏的空态组件与恢复动作是否正确、125 条适用性分母是否漂移）必须转成门禁或 e2e 断言，成为 T031 勾选的前提；只有真正的审美/语感判断（首屏文案措辞、黄金旅程视觉分组的舒适度）留给人工，且明确为独立于开发流程的持续性活动，不是 T031 一次性完成条件的一部分，也不阻塞 F009 的 review 状态。落地：`e2e/playwright.empty-db.config.ts` + `e2e/tests/f009-empty-database.spec.ts`（干净库首屏结构）、`tools/check-v03-plan-contracts.test.mjs::F009-CODE-DEFERRED-INVENTORY`（125 条分母核对，residual 0）。
