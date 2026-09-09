---
kind: feature
id: F009
version: "0.3"
status: draft
gate_version: 1
related_features: [F001, F002, F003, F004, F005, F006, F007, F008, F010, F011, F012, F013, F014]
topics: [frontend, v344, migration, app-shell, accessibility]
doc_kind: spec
created: 2026-09-08
updated: 2026-09-08
---

# F009：V3.44 Frontend Foundation & Migration

> Owner: unassigned | Target: v0.3

## 0. 来源与意图

- PRD：第 6、7、10、11 节。
- 设计基线：`ui-reference/personahub-draft/personahub-v3.1/`（V3.44）。
- 已交付基线：F001–F008 及 v0.1 / v0.2 release contract。
- 意图：先把生产前端迁移到 V3.44 的全局结构和交互语言，让既有能力在新界面中连续可用，再承接 v0.3 新领域能力。

## 1. 问题、目标与非目标

现有生产前端按 Workspace / Issue / Thread、右侧 Inspector 和若干管理弹窗组织，与最终设计的信息架构、对象表达和交互契约不一致。如果先继续增加 Artifact、Dispatch 或 Skills，新增能力仍会落在即将废弃的壳层中并产生二次返工。

本 Feature 的目标是建立 V3.44 生产 App Shell、导航、路由、设计基础和兼容视图，把 v0.1–v0.2 已交付的用户能力迁入新结构。非目标是提前实现 Artifact、Dispatch、Skills、Memory、自动化、完整统计或多机运行时等后续领域能力，也不把静态设计稿数据复制到生产。

## 2. 用户场景

### US-001：在新界面继续使用既有能力（Priority: P1）

升级用户进入产品后，能在 V3.44 壳层中找到项目、任务、执行、轨迹和证据，并继续完成迁移矩阵标为 migrated 的 v0.1–v0.2 操作；被最终对象模型明确取代的管理动作按 retired 处理。

**独立测试**：使用 v0.2 最新 schema fixture，从打开项目到创建任务、选择执行方式、启动、查看执行事实和验收结果，全程不进入旧 App Shell。

1. Given 用户已有项目和任务，when 从已发布历史根入口 `/` 进入，then 到达保留原 ID 的项目列表且不猜选某个项目；when 用户明确选择对象或复制 F009 新 canonical deep link 后刷新，then 回到同一对象。
2. Given 某项最终设计能力尚未交付，when 用户浏览导航或页面动作，then 不出现可点击死入口或伪造数据。

### US-002：使用一致且可访问的交互（Priority: P1）

用户在不同工作面获得一致的导航、弹层、页签、表格、反馈与键盘行为。

**独立测试**：对生产 App Shell 和本 Feature 引入的每类交互原语执行键盘、焦点、语义和窄视口浏览器测试。

1. Given 用户只使用键盘，when 切换导航、打开弹层或操作页签，then 焦点顺序、关闭和归还行为符合 V3.44 全局契约。
2. Given 页面处于 loading、empty、error 或 partial 状态，when 状态变化，then 页面保留上下文并给出唯一可执行的恢复动作。

### US-003：确认旧界面已退出主路径（Priority: P1）

维护者能用一份逐页迁移矩阵确认每项既有能力已迁移、明确后移或退役，不存在两套可写入口。

**独立测试**：扫描生产导航和路由，旧 App Shell、Inspector、Dock、旧管理弹窗入口与新入口不会同时可写。

## 3. 范围与边界

### 范围内

- V3.44 全局 App Shell、一级导航稳定槽位、路由、布局、设计令牌和共享交互原语。
- Project / Issue / Thread / Run / Trace / Evidence 等现有事实到新页面结构的兼容读取投影。
- v0.1–v0.2 已交付项目 / 任务创建、选择、派工、介入与事实查看动作的新界面入口；迁移矩阵中明确 retired 的旧对象管理动作除外。
- adapter 配置与 runtime health 入口使用最小 transitional-host；Workflow Template 编辑动作标为 retired，旧数据只读，等待 F013 转为 Skill revision。
- 已发布 URL inventory、canonical deep links、页面迁移矩阵、旧组件隔离与可删除清单。
- loading、empty、error、partial、legacy 状态和全局可访问性契约。

### 范围外

- 改写 F001–F008 canonical service、状态机或数据库含义。
- 后续 Feature 拥有的 Artifact、claim、Dispatch、Skill、repository registry 与完整运行时数据。
- Memory、自动化、完整统计、插件 surface 和多执行机器。
- 为了视觉完整而展示不可执行的静态页面或假数据。

### 边界场景

- 设计稿存在但领域能力未交付的工作面不进入生产导航；必须保留稳定槽位时只能显示不可误解的未开放状态。M1 没有必须提前占位的槽位，因此没有 visible-disabled 一级入口。
- 旧字段无法表达最终语义时标为 compatibility / legacy，不猜成新对象。
- 同一个写动作只有一个生产入口；迁移期间不得让旧页面与新页面并行修改同一对象。
- F009 的兼容投影是过渡层，后续 canonical projection 接管后必须可删除。

## 4. 需求

### 功能需求

- **FR-001**：生产应用使用 V3.44 App Shell、导航层级和稳定路由承载所有已开放工作面；M1 `SurfaceRegistry` 必须逐项声明九个 V3.44 一级槽位的 enabled / visible-disabled / not-registered 状态，只有具有真实数据、可达页面和允许动作的 enabled surface 才进入生产导航。
- **FR-002**：以开发前已冻结的 `migration-matrix.md` 覆盖 v0.1–v0.2 所有生产页面、入口和动作；每项记录 migrated / deferred / retired 结论，以及 stable-shell / final-surface / transitional-host 生命周期分类。transitional-host 必填 replacement_owner、delete_when 与 latest_milestone；实现阶段只能维护、校验和按既定结论迁移，不得首次发现范围。
- **FR-003**：`migration-matrix.md` A001–A029 标为 migrated 的既有项目选择、任务创建、执行启动、人工介入、轨迹 / 文件变化查看、证据验收，以及 adapter 配置与 runtime health 能力在新界面中保持可用；其中 validation 的 findings / summary 是只读事实，但 trigger、unblock 与 reset rounds 仍是必须迁移的写动作。Workflow Template 编辑 A030 按最终对象裁决 retired，只保留只读迁移证据。
- **FR-004**：以仓库与 release 证据建立已发布 URL inventory；当前已发布历史 URL inventory 只有根入口 `/`，因此只迁移有证据的历史 URL。F009 M1 新增 `/tasks`、`/tasks/:taskId`、`/projects`、`/projects/:projectId` canonical routes，支持直达、刷新恢复、History 前进 / 后退、未知 ID 和非法子路径的确定结果。`taskId` 在 M1 中严格等于既有 Issue ID，`projectId` 严格等于既有 Project ID；M1 不发布 `/sessions/:sessionId`，也不把尚未交付的 task view / project tab 伪装为可用。不得把新 deep link 写成旧收藏链接迁移。
- **FR-005**：未交付工作面和动作不得伪装为可用；隐藏与置灰遵守 V3.44 对“没有页面”和“暂不可执行”的区分。
- **FR-006**：新页面只经既有 canonical API 写入；兼容投影不得复制业务状态或引入第二套状态机。
- **FR-007**：旧 App Shell 和旧写入口退出生产路径，并形成供 F014 最终删除的可追踪清单。

### UX 需求

- **UX-001**：颜色、排版、间距、层级、表单、反馈、高风险动作和缺省状态遵守 V3.44 全局契约。
- **UX-002**：弹层、页签、表格、导航与焦点行为由共享原语统一实现，并满足键盘和语义要求。
- **UX-003**：迁移不得改变用户对既有历史事实的理解；兼容标签解释限制和下一步，不暴露内部迁移术语。
- **UX-004**：Task composer 的未提交文本与当前选择在同一浏览器 tab 内切换 task、project、surface 或后续 task view 时保留；提交失败可重试，提交成功只清除对应版本。刷新 / 关闭不持久化敏感草稿，但离开前必须提示。

### 非功能需求

- **NFR-001**：F001–F008 的 API / 领域回归测试保持通过；前端替换不改变持久化事实。历史升级验收使用 `v02-fixture-contract.md` 固定的 release v10 原始 SQL fixture，经真实 v10 → v11 → current head migration 后进入同一浏览器旅程；回归报告按迁移矩阵解释 retired 项，不把退役管理动作算作能力回归。
- **NFR-002**：关键生产路由具备浏览器 smoke、可访问性和控制台零错误门禁。
- **NFR-003**：兼容 adapter 集中、可计数且无反向依赖，后续 Feature 可以逐项替换并删除。
- **NFR-004**：不得为 transitional-host 重做最终视觉或新增领域逻辑；它只调用既有 canonical API，并在 owning Feature 验收时删除。

## 5. 生命周期与不变量

页面迁移项按 inventoried → migrated / deferred / retired 推进，并标为 stable-shell、final-surface 或 transitional-host；只有 migrated 项通过真实数据与浏览器旅程后才能进入生产导航。兼容投影不拥有领域生命周期，Project、Issue、Thread、Run、Trace 与 Evidence 的状态仍由 F001–F008 canonical service 决定。F009 完成后允许存在受控兼容宿主，但不允许旧页面形成并行写入口；临时宿主必须由 F011 / F012 / F013 验收时删除，最晚不得越过矩阵声明的 milestone。

## 6. 成功与验收

### 成功标准

- **SC-001**：用户无需进入旧 App Shell 即可完成 v0.2 已支持的代表性 coding 旅程。
- **SC-002**：后续 v0.3 Feature 直接落在稳定的新壳层和共享交互原语上，不再为旧页面实现新能力。
- **SC-003**：每个旧页面和动作都有可核对去向，生产环境没有死入口或双写入口。

### 验收清单

- [ ] **AC-001** (`FR-001`, `FR-003`, `NFR-001`): v0.2 schema fixture 在新 App Shell 中完成项目 → 任务 → 执行 → 轨迹 → 验收代表旅程，既有事实与终态守恒。
- [ ] **AC-002** (`FR-002`, `FR-005`, `FR-007`, `NFR-004`): 页面 / 路由 / 动作迁移矩阵 100% 有结论和生命周期分类；每个 transitional-host 有 replacement_owner、delete_when、latest_milestone，生产扫描无旧 Shell、死导航和并行写入口。
- [ ] **AC-003** (`FR-004`, `UX-003`): 已发布 URL inventory 的来源逐项可核对；根入口升级、M1 route manifest 中每条 canonical route 的直达 / 刷新 / History、未知 ID 和非法子路径均有浏览器测试，不存在无证据的历史对象 URL 映射或提前发布的 Session / view / tab。
- [ ] **AC-004** (`UX-001`, `UX-002`, `UX-004`, `NFR-002`): 共享弹层、页签、表格、导航、草稿生命周期和关键状态通过浏览器键盘、语义、跨 route、错误重试、窄视口及控制台检查。
- [ ] **AC-005** (`FR-006`, `NFR-003`): 新前端写操作全部命中既有 canonical API，兼容 adapter 有独立清单、替换 owner 和删除条件。

## 7. 测试、依赖与决策

### 测试策略

保留 F001–F008 server / API 回归；以开发前冻结的 `migration-matrix.md` 为范围与处置真相源，为 App Shell、共享原语与兼容 projection 建组件状态矩阵；按 `v02-fixture-contract.md` 建 release v10 raw SQL fixture，通过真实升级后的同一个临时数据库运行 Playwright 黄金旅程、已发布根入口升级、canonical deep link 直达 / 刷新 / 未知 ID、键盘与可访问性测试；按 `v344-browser-check-applicability.md` 对 V3.44 的 125 条 browser checks 逐条执行 adapted / deferred / not-applicable 分类，分类分母必须等于 125，F009 的 adapted 行必须有生产门禁。

### 依赖

依赖已完成的 F001–F008、V3.44 冻结设计和既有前端技术栈。F010–F013 在本 Feature 的壳层和共享原语上接入新领域能力；F014 接管跨 schema 迁移、最终兼容清零和发布证据。

### 决策与风险

选择“新壳层 + 既有能力兼容投影”作为第一步，而不是等待全部新领域模型完成后一次性重写。主要风险是兼容层长期化，因此每个 adapter 必须登记替换 owner 和删除条件；另一个风险是把静态设计稿误当产品范围，生产入口仍只由本 Feature 和后续 Feature 的真实 AC 决定。

## 8. 待确认问题

无。
