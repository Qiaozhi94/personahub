---
topics: [frontend, v344, browser-checks, acceptance]
doc_kind: feature-contract
created: 2026-09-09
updated: 2026-09-09
---

# F009 对 V3.44 browser checks 的适用性清单

## 0. 分类规则与分母

- source: `ui-reference/personahub-draft/personahub-v3.1/browser-check.mjs`
- source_count: 125
- source_sha256: ebca2c9f43a86c0a22c3865698fe73d3022a5cb2dd4d22852977f980344be8f7
- classification: adapted 28 / deferred 96 / not-applicable 1
- classification_count: adapted: 28 · deferred: 96 · not-applicable: 1 · total: 125
- denominator: adapted 28 + deferred 96 + not-applicable 1 = 125

`adapted` 表示断言的生产语义已进入 F009，必须由表中指定的 F009 生产测试覆盖；`deferred` 表示
设计有效但领域或最终 surface 尚未交付，F009 不注册相关入口，由具名 Feature / 版本接管；
`not-applicable` 只用于静态原型机制本身不应进入生产代码的断言。新增共享交互形态需要同步增加
生产断言，并先做一次失败变异再实现；不能只增加分子而不更新 source_count 与分类分母。

adapted 28 / deferred 96 / not-applicable 1；总数固定为 125。adapted 必须落入 F009 生产浏览器门禁；
deferred 不得进入 F009 production registry，也不得以静态数据、空页面或可点击占位进入
`SurfaceRegistry`。

## 1. 逐条分类

| ID | V3.44 断言摘要 | 分类 | F009 判断 | 接管 owner | 生产测试路径 / 门槛 |
|---|---|---|---|---|---|
| BC-001 | 任务舞台占主导、左栏收窄 | adapted | App Shell 的全局布局契约 | F009 | `e2e/tests/f009-shell.spec.ts` |
| BC-002 | 删除底部面板、状态栏和图标活动栏 | adapted | 旧壳层退出生产路径 | F009 | `e2e/tests/f009-shell.spec.ts` |
| BC-003 | 任务标识行与视图导航分层 | deferred | M1 尚无任务四视图 | F011 | F011::T010 Playwright |
| BC-004 | 子文档就地打开并可返回 | deferred | 依赖资源 / 验收视图 | F011 | F011::T012 Playwright |
| BC-005 | 任务左栏按稳定组织维度分类 | adapted | F009 任务列表骨架承担；内容可先来自既有 API | F009 | `e2e/tests/f009-shell.spec.ts` |
| BC-006 | 标签使用下拉而非横排 chip | adapted | F009 任务列表共享交互 | F009 | `e2e/tests/f009-shell.spec.ts` |
| BC-007 | 一级竖栏分日常与低频入口 | adapted | 只对 M1 已注册槽位断言相对分组 | F009 | `e2e/tests/f009-shell.spec.ts` |
| BC-008 | 会话面复用任务消息骨架 | deferred | Session identity 尚未交付 | F012 | F012::T012 browser journey |
| BC-009 | 成果首屏表达结果与可信度 | deferred | 依赖 Acceptance / Artifact projection | F011 | F011::T011 Playwright |
| BC-010 | 机器事实与 Agent 主张分信源 | deferred | 依赖 claim / evidence contract | F011 | F011::T002 integration + browser |
| BC-011 | 主张与证据间显式论证 | deferred | 依赖 AcceptanceService | F011 | F011::T002 integration + browser |
| BC-012 | 三种状态符号且同源不冒充独立 | deferred | 依赖 claim 独立性 | F011 | F011::T011 Playwright |
| BC-013 | 证据使用仓库天然标识 | deferred | 依赖 Artifact ref | F010/F011 | F011::T012 browser |
| BC-014 | 状态卡可筛选主张树 | deferred | 依赖验收视图 | F011 | F011::T011 browser |
| BC-015 | 基线变更事前阻塞 | deferred | 依赖 AcceptanceService 写链 | F011 | F011::T004 fault tests |
| BC-016 | 决定形成状态变化而非消息气泡 | deferred | 依赖 TaskProjection / Acceptance event | F011 | F011::T001/T004 |
| BC-017 | 范围血统默认收起 | deferred | 依赖 Artifact / acceptance scope | F011 | F011::T011 browser |
| BC-018 | 实现回归与端到端验收分段 | deferred | 依赖验收视图 | F011 | F011::T011 browser |
| BC-019 | 单例舞台中文件可返回或预览 | deferred | 依赖资源 / 验收文件 surface | F011 | F011::T012 browser |
| BC-020 | 任务固定四视图与可折叠副栏 | deferred | 四视图由 F011 拥有 | F011 | F011::T010–T013 |
| BC-021 | 概览副栏显示任务级活动 | deferred | 依赖 TaskProjection | F011 | F011::T010 browser |
| BC-022 | 验收副栏显示主张大纲 | deferred | 依赖 Acceptance projection | F011 | F011::T011 browser |
| BC-023 | 资源清单与就地预览 | deferred | 依赖 Artifact / file projection | F011 | F011::T012 browser |
| BC-024 | tab 数字只计人工介入 | deferred | 依赖 attention count contract | F011 | F011::T001/T010 |
| BC-025 | 概览与验收零重叠 | deferred | 依赖四视图 projection | F011 | F011::T010/T011 |
| BC-026 | 一个输入框且切 view 保留草稿 | deferred | F009 提供 draft store，但 view 验收在 F011 | F011 | F011::T010 Playwright |
| BC-027 | 执行组合为模型与深度 | deferred | execution identity 由 F012 定义 | F012 | F012::T001/T010 |
| BC-028 | 上下文范围选择及独立性提示 | deferred | Dispatch snapshot 由 F012 定义 | F012 | F012::T003/T012 |
| BC-029 | 会话是视图且 Room 在内切换 | deferred | Session / Room contract 未交付 | F012 | F012::T001/T012 |
| BC-030 | 命令面板可开关 | adapted | V3.44 全局导航原语 | F009 | `e2e/tests/f009-command-palette.spec.ts` |
| BC-031 | 七个任务态共享数据骨架 | deferred | 最终为十一态矩阵，归 TaskProjection | F011 | F011::AC-001 fixtures |
| BC-032 | 任务首屏顺序随状态变化 | deferred | 依赖十一态 projection | F011 | F011::AC-001 fixtures |
| BC-033 | 非代码任务复用骨架 | deferred | 依赖 TaskProjection / evidence ref | F011 | F011::T001/T011 |
| BC-034 | 轨迹并入会话且可放大 | deferred | 依赖任务会话视图 | F011 | F011::T013 browser |
| BC-035 | 轨迹概览按耗时分段 | deferred | 依赖 trace projection | F011 | F011::T013 browser |
| BC-036 | 轨迹呈现 adapter 详细交互 | deferred | 依赖 trace projection | F011 | F011::T013 browser |
| BC-037 | 每次调用展示执行组合与血统 | deferred | 组合身份由 F012、展示由 F011 | F012/F011 | F011::T013 after F012 contract |
| BC-038 | 详情分页随事件类型变化 | deferred | 依赖 trace projection | F011 | F011::T013 browser |
| BC-039 | 轨迹支持折叠与搜索 | deferred | 依赖 trace view | F011 | F011::T013 browser |
| BC-040 | 执行组合选择器解释判断依据 | deferred | eligibility 由 F012 定义 | F012 | F012::T003/T012 |
| BC-041 | Skill 与 step 要求取并集并标来源 | deferred | F013 发布要求，F012 消费 | F013/F012 | F012::T003 integration |
| BC-042 | 实现与验证不能同源 | deferred | Dispatch eligibility 由 F012 拥有 | F012 | F012::T003 integration |
| BC-043 | 新任务仅描述与属性，标题后生成 | deferred | 最终创建流依赖 Space / Dispatch | F013/F012 | F013::T004 + F012 browser |
| BC-044 | 说明文字长度上限 | adapted | 作为 F009 可达文案静态门禁 | F009 | `web/src/f009-content-contract.test.ts` |
| BC-045 | 原型 data-demo 与 data-unbuilt 分流 | not-applicable | 生产代码不得保留原型占位属性；未交付入口直接不注册 | F009 | `web/src/f009-no-prototype-placeholders.test.ts` |
| BC-046 | loading / empty / error / partial 有恢复 | adapted | F009 共享 page-state 原语 | F009 | `e2e/tests/f009-page-states.spec.ts` |
| BC-047 | interrupted / cancelled 不冒充成功 / 失败 | adapted | 兼容 Run 状态显示必须守恒 | F009 | `e2e/tests/f009-page-states.spec.ts` |
| BC-048 | dialog 语义与可访问标题 | adapted | F009 共享 dialog 原语 | F009 | `e2e/tests/f009-a11y.spec.ts` |
| BC-049 | dialog 焦点陷阱、Esc 与焦点归还 | adapted | F009 共享 dialog 原语 | F009 | `e2e/tests/f009-a11y.spec.ts` |
| BC-050 | 每个 dialog 都支持 Esc | adapted | 对矩阵中所有 dialog 批量测试 | F009 | `e2e/tests/f009-a11y.spec.ts` |
| BC-051 | 数据表列头 / 单元格语义 | adapted | F009 共享 table 原语 | F009 | `e2e/tests/f009-a11y.spec.ts` |
| BC-052 | tabs 的选择、tab stop 与键盘 | adapted | F009 共享 tabs 原语；仅测 M1 真实 tabs | F009 | `e2e/tests/f009-a11y.spec.ts` |
| BC-053 | 凭据默认遮罩并显式查看 | adapted | adapter transitional-host 保留安全行为 | F009 | `e2e/tests/f009-runtime-adapters.spec.ts` |
| BC-054 | 暂停全部派工有影响预览与恢复 | deferred | 新 runtime control 尚未交付 | F012 | F012 runtime acceptance |
| BC-055 | 首次设置旅程连续且可重试 | deferred | Space / setup 由 F013 拥有 | F013 | F013::T004/T021 |
| BC-056 | 新任务原文守恒、确认前零写、重复幂等 | adapted | 迁移既有 Intake 的现有保证；最终 Dispatch 由 F012 替换 | F009 | `e2e/tests/f009-create-task.spec.ts` |
| BC-057 | 空目标不推荐也不创建 | adapted | 迁移既有 Intake 边界 | F009 | `e2e/tests/f009-create-task.spec.ts` |
| BC-058 | 指派具有撤销窗口 | deferred | draft Dispatch 生命周期由 F012 拥有 | F012 | F012::T002/T010 |
| BC-059 | 成果与资料统一为资源 | deferred | 资源视图由 F011 拥有 | F011 | F011::T012 browser |
| BC-060 | 项目固定四个 tab | deferred | v0.3 实际只上线文件 / Skills / 设置 | F013 | F013::T012/T021 |
| BC-061 | 记忆只含待办 / 知识库 / 知识图谱 | deferred | Memory 不在 v0.3 | v0.4 Memory candidate | future feature AC |
| BC-062 | 知识库三轴与召回禁用态 | deferred | Memory 不在 v0.3 | v0.4 Memory candidate | future feature AC |
| BC-063 | 记忆配置只在设置且硬规则不可改 | deferred | Memory 不在 v0.3 | v0.4 Memory candidate | future feature AC |
| BC-064 | 系统诊断覆盖应用与记忆通路 | deferred | F009 只迁移现有应用诊断，无 Memory 通路 | v0.4 Memory candidate | future diagnostics AC |
| BC-065 | 记忆效用四层不合成分数 | deferred | Memory 效用不在 v0.3 | v0.4 Memory candidate | future eval AC |
| BC-066 | 知识图谱浏览 / 筛选 / 下钻 | deferred | 知识图谱不在 v0.3 | v0.4 Memory candidate | future browser AC |
| BC-067 | 能力面无成员卡与执行组合 | deferred | F009 不注册能力面 | F013 | F013::T013 browser |
| BC-068 | 执行组合是运行时检查结果 | deferred | runtime projection 由 F012 拥有 | F012 | F012 runtime acceptance |
| BC-069 | 自动化规则 / 触发 / 运行 / 投递分层 | deferred | 自动化不在 v0.3 | v0.4 Automation candidate | future feature AC |
| BC-070 | 竖栏是唯一一级导航 | adapted | ApplicationShell 核心不变量 | F009 | `e2e/tests/f009-shell.spec.ts` |
| BC-071 | 四个任务视图宽度与左边界一致 | deferred | 四视图由 F011 拥有 | F011 | F011::T010–T013 browser |
| BC-072 | 顶栏没有布局三档 | adapted | 旧 Dock / layout control 退出 | F009 | `e2e/tests/f009-shell.spec.ts` |
| BC-073 | 项目工具条与目录状态排版 | deferred | 最终项目文件面由 F013 拥有 | F013 | F013::T012 browser |
| BC-074 | 项目记忆筛选与统一样式 | deferred | 项目记忆不在 v0.3 | v0.4 Memory candidate | future project-memory AC |
| BC-075 | 工作面挂在 surface-host 且不盖竖栏 | adapted | 调整为所有 M1 registered surfaces | F009 | `e2e/tests/f009-shell.spec.ts` |
| BC-076 | hidden 视图不叠加 | adapted | 共享 surface-host 可见性不变量 | F009 | `e2e/tests/f009-shell.spec.ts` |
| BC-077 | 统计三 tab 且无左列表 | deferred | 统计不在 v0.3 | v0.4 Usage candidate | future browser AC |
| BC-078 | 趋势图由周期决定 | deferred | 统计不在 v0.3 | v0.4 Usage candidate | future browser AC |
| BC-079 | 调用明细回任务轨迹 | deferred | 统计与任务轨迹接缝未交付 | v0.4 Usage + F011 | future integration AC |
| BC-080 | 详情表分页且合计固定 | deferred | 统计不在 v0.3 | v0.4 Usage candidate | future browser AC |
| BC-081 | 失败率只计真实故障 | deferred | 监控统计不在 v0.3 | v0.4 Monitoring candidate | future metric AC |
| BC-082 | 额度只在运行时配置 | deferred | F009 无 quota contract | F012 | F012 adapter/runtime AC |
| BC-083 | 前缀 / 标签设置及确认 | deferred | Space 设置由 F013 拥有 | F013 | F013 settings browser AC |
| BC-084 | 能力与记忆共用列表排版 | deferred | 依赖尚未交付的 Memory 面 | v0.4 Memory candidate | future shared-list AC |
| BC-085 | 记忆与能力使用铺满列表 | deferred | 依赖尚未交付的 Memory 面 | v0.4 Memory candidate | future layout AC |
| BC-086 | 凭据在 runtime adapter 配置 | deferred | F009 仅兼容入口；最终归属由 F012 验收 | F012 | F012 runtime browser AC |
| BC-087 | 机器左栏、adapter tabs、概览第一 | deferred | 多 execution identity / machine projection 未交付 | F012 | F012 runtime browser AC |
| BC-088 | 能力位写后果而非独立矩阵 | deferred | adapter capability projection 由 F012 拥有 | F012 | F012 capability browser AC |
| BC-089 | 同模型不同通路是不同组合 | deferred | execution identity 由 F012 拥有 | F012 | F012 identity tests |
| BC-090 | 数据位置与日志导出只在系统诊断 | deferred | 当前 API 未提供完整数据位置 / 日志导出 | future System Diagnostics feature | future feature AC |
| BC-091 | 页面无横向溢出 | adapted | 所有 M1 route 的视口门禁 | F009 | `e2e/tests/f009-shell.spec.ts` |
| BC-092 | 能力 tab 可由插件贡献 | deferred | 插件 surface 不在 v0.3 | v0.8 Plugin candidate | future plugin-host AC |
| BC-093 | Skills 使用表格与 tag 筛选 | deferred | Skills 面由 F013 拥有 | F013 | F013::T013 browser |
| BC-094 | 插件声明贡献点且动作白名单 | deferred | 插件运行不在 v0.3 | v0.8 Plugin candidate | future security AC |
| BC-095 | Skill 详情整页下钻 | deferred | Skill 详情由 F013 拥有 | F013 | F013::T013/T021 |
| BC-096 | Skill 行尾菜单且无编辑 | deferred | Skill 列表由 F013 拥有 | F013 | F013::T013 browser |
| BC-097 | 设置目录只含有真实页面的类别 | adapted | M1 设置只注册 diagnostics 与 legacy workflows | F009 | `e2e/tests/f009-shell.spec.ts` |
| BC-098 | 执行监控归统计、额度告警全局 | deferred | 统计 / 全局告警不在 v0.3 | v0.4 Monitoring candidate | future integration AC |
| BC-099 | MCP 同时有意图与结果落点 | deferred | MCP injection contract 未交付 | future MCP feature | future MCP AC |
| BC-100 | 通知渠道可全关且类型简短 | deferred | 通知不在 v0.3 | future Notifications feature | future feature AC |
| BC-101 | 机器点灯由 adapter 健康汇总 | deferred | runtime machine projection 由 F012 拥有 | F012 | F012 runtime browser AC |
| BC-102 | 本地仓库识别远端且按机器授权 | deferred | RepositoryRegistry 由 F013 拥有 | F013 | F013::T001/T021 |
| BC-103 | runtime 概览与 adapter 独立成屏 | deferred | 最终 runtime surface 由 F012 拥有 | F012 | F012 runtime browser AC |
| BC-104 | 已安装插件有配置入口 | deferred | 插件不在 v0.3 | v0.8 Plugin candidate | future plugin-settings AC |
| BC-105 | 界面不出现“权限档”双命名 | deferred | 路径授权最终 UI 由 F013 拥有 | F013 | F013::T012 browser |
| BC-106 | 生效组合区分硬规则与覆盖项 | deferred | eligibility projection 由 F012 拥有 | F012 | F012::T003/T012 |
| BC-107 | 项目直接引用 Skills | deferred | Project / Skill refs 由 F013 拥有 | F013 | F013::T012/T021 |
| BC-108 | adapter 详情只显示可决策事实 | deferred | 最终 adapter detail 由 F012 拥有 | F012 | F012 runtime browser AC |
| BC-109 | adapter 详情四块固定顺序 | deferred | 最终 adapter detail 由 F012 拥有 | F012 | F012 runtime browser AC |
| BC-110 | 配置对象具备完整 CRUD | deferred | 跨 Feature 配置面完成度检查 | F014 | F014 final journey / inventory AC |
| BC-111 | 设置按作用域分组 | deferred | Space / workspace settings 由 F013 拥有 | F013 | F013::T012 browser |
| BC-112 | 主仓可写、参考仓只读、机器路径归 runtime | deferred | repository authorization 由 F013 拥有 | F013 | F013::T001/T012 |
| BC-113 | runtime 是组合盘点面 | deferred | 最终 runtime projection 由 F012 拥有 | F012 | F012 runtime browser AC |
| BC-114 | 监控只收执行层、基础设施归诊断 | deferred | 监控面不在 v0.3 | v0.4 Monitoring candidate | future integration AC |
| BC-115 | 工具分内置与 MCP 并表格展示 | deferred | tool inventory 由 F012 runtime contract 接管 | F012 | F012 runtime browser AC |
| BC-116 | runtime 不控制具体任务 | deferred | 最终 runtime / intervention 分界由 F012 拥有 | F012 | F012 intervention browser AC |
| BC-117 | 自动化启用是开关 | deferred | 自动化不在 v0.3 | v0.4 Automation candidate | future browser AC |
| BC-118 | 知识库显示召回与采纳计数 | deferred | Memory 不在 v0.3 | v0.4 Memory candidate | future metric AC |
| BC-119 | 用户界面只留事实与动作 | adapted | 所有 M1 production copy 的静态门禁 | F009 | `web/src/f009-content-contract.test.ts` |
| BC-120 | 偏好含个人资料与提交身份 | deferred | commit identity / settings 由 F013 接管 | F013 | F013 settings browser AC |
| BC-121 | 能力面只有 Skills 与 MCP | deferred | F013 只交付 Skills，MCP 等真实 contract | F013 + future MCP | F013 能力面门禁 + future MCP AC |
| BC-122 | UI 不暴露单用户 / 本机形态限定 | adapted | M1 production copy 的静态门禁 | F009 | `web/src/f009-content-contract.test.ts` |
| BC-123 | 用户界面不出现“弹层”一词 | adapted | M1 production copy 的静态门禁 | F009 | `web/src/f009-content-contract.test.ts` |
| BC-124 | 用户文案不包含设计 / 原型说明 | adapted | M1 production copy 的静态门禁 | F009 | `web/src/f009-content-contract.test.ts` |
| BC-125 | 所有数据表使用正式字段与内容 | adapted | 只验证 F009 已注册 surface 的真实表格 | F009 | `e2e/tests/f009-a11y.spec.ts` |

## 2. 维护与验收纪律

1. `browser-check.mjs` 的 `await check(...)` 数量变化时，本文件的 source_count、分母和逐行表必须
   同步变化，`tools/check-v03-plan-contracts.test.mjs` 会校验连续 ID 与总数。
2. 新增或改变共享交互形态时必须先更新本清单，同步扩展 adapted 集合及生产测试；先删除必需语义或绕过共享原语，
   对应测试必须变红，才能接受门禁证据。
3. deferred 行在 owner 接管前不得进入 F009 导航或路由；owner 实施时从本表复制契约到自身真实
   测试，并在 F014 最终旅程中核对，而不是把本表状态静默改成 adapted。
4. not-applicable 不等于忽略：BC-045 由生产代码禁止 `data-demo` / `data-unbuilt` 属性的反向门禁
   取代，确保原型占位机制不会泄漏进应用。
