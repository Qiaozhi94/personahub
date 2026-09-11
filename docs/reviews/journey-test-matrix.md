---
topics: [frontend, v344, migration, testing, e2e, journey-matrix]
doc_kind: plan
created: 2026-09-09
updated: 2026-09-11
---

# F009 需求级旅程—测试映射矩阵

> **定位**：本矩阵是 F009 需求级测试设计轨的产出，由独立于实现者的测试设计师编写，推导自且仅推导自下列规格侧文档（未读取任何实现代码）：
>
> 1. `docs/features/0.3/README.md`（§5 版本验收旅程九步）
> 2. `docs/features/0.3/F009-v344-frontend-foundation-migration/spec.md`（FR/UX/NFR、US-001~003、AC-001~005、§7 测试策略）
> 3. `docs/features/0.3/F009-v344-frontend-foundation-migration/design.md`
> 4. `docs/features/0.3/F009-v344-frontend-foundation-migration/migration-matrix.md`（A001–A031、P001–P011）
> 5. `docs/features/0.3/F009-v344-frontend-foundation-migration/tasks.md`（T000–T032，Phase 3 退出门禁 T020/T021/T022/T030/T031）
> 6. `docs/features/0.3/F009-v344-frontend-foundation-migration/v02-fixture-contract.md`
> 7. `docs/features/0.3/F009-v344-frontend-foundation-migration/v344-browser-check-applicability.md`
> 8. `ui-reference/personahub-draft/personahub-v3.1/docs/design.md`（V3.44 交互设计基线）
> 9. `ui-reference/personahub-draft/personahub-v3.1/docs/implementation-notes.md`
> 10. `ui-reference/personahub-draft/personahub-v3.1/browser-check.json`（125 条 checks 原始数据，用于分母核对）
> 11. `docs/reviews/self-test-system-plan.md`（§3.2、§3.2.1、§5.2、§7.2）
>
> 用途：作为 T021（黄金旅程 Playwright）与 T022（28 条 adapted 生产断言）的实现设计稿，以及 T031 人工浏览器检查的对照清单。矩阵要素满足 `self-test-system-plan.md` §5.2 的必填五项（用户动作、预期可见反馈、前置数据与环境、失败恢复、自动化落点与证据保存）。

## 0. 全局约束（对第一节所有行生效）

- **数据策略（feature 级覆盖）**：全旅程只使用 T000 builder 从 v10 原始 fixture 经真实 v10 → v11 → current head 升级后的同一个临时数据库；不重复造 seed、不做 HTTP 播种、不建第二套 E2E 数据库、不驱动真实 CLI。旅程内经界面触发的 canonical 写是被测行为而非播种；不使用 `support/mock-run.ts` 造 Run 或事件（口径见 design.md §8）。这是对 `self-test-system-plan.md` §3.2 默认播种策略的 feature 级覆盖，理由是 AC-001 验证的是历史事实守恒（NFR-001、`v02-fixture-contract.md` §3 第 5 步）。
- **路线冻结**：M1 不发布 `/sessions/:sessionId`；F011/F013 接管前不发布 task view（`/tasks/:taskId/:view`）与 project tab（`/projects/:projectId/:tab`）。旅程任何一步不得出现这些入口；反向断言（它们不可达）属于 S1 补充行。
- **入口纪律（§3.2.1 第①段）**：旅程起点是唯一允许的 `page.goto("/")`；此后每一步的用户动作都必须从当前页面的可见导航、列表行或按钮点击出发，禁止 goto 跳过入口。唯一的例外是 S1 的 canonical deep link 用例——地址栏直达本身就是被测行为，不属于跳过入口。
- **M1 子旅程裁剪**：README §5 的九步是 v0.3 版本级验收旅程（由 F014 收口）；F009 的 AC-001 只覆盖其中可由「v0.2 已交付能力 + v10 fixture 事实」承担的 M1 投影。每行用「M1 冻结边界」标注该步中归 F010–F014 的部分：这些内容不进入 T021 断言，旅程中也不得出现其控件或入口。投影表已固化于 design.md §8「黄金旅程的 M1 投影（README §5 九步）」，本节行注与其一致。
- **断言语言**：断言用用户可见的文本、角色与状态（§3.2.1 技术约束），不用 CSS 选择器、内部 test-id 链，也不使用界面禁止出现的迁移/设计术语（UX-003、BC-119/123/124）。
- **证据保存位置**：自动化证据 = Playwright report（失败 trace/截图）+ CI `e2e` job 工件（self-test §3 需求级行）；人工证据 = T031 检查记录，缺陷与观察分别落 `dogfooding-bugs.md` / `dogfooding-notes.md`，其「旅程步骤」列使用本矩阵的步骤编号（J1–J9、S1）。
- **步骤编号约定**：J1–J9 对应 README §5 的九步；S1 是 spec US-001 / AC-003 补充行（非 README 九步内容，不发明新旅程）。

## 1. 黄金旅程逐步映射（对应 AC-001；T021 Playwright spec 的设计稿）

### 1.0 §3.2.1 五段必备覆盖总览

| 段落 | 在哪一步被断言 |
|---|---|
| ①入口可发现 | J1（根入口 `/` 起点、竖栏四个已注册槽位）；J2–J9、S1 的用户动作全部从可见导航/列表点击出发（见 §0 入口纪律） |
| ②主路径逐步反馈 | J2–J7、J9 的「预期可见反馈」列，每个动作对应可见的文本/状态/列表变化 |
| ③失败与恢复 | J8（主：取消/失败/阻塞的守恒显示 + 重启恢复）；J3（次：确认失败保留草稿可重试）；S1（次：not-found 可恢复） |
| ④空态与首次使用 | S1（未选项目的项目选择态、未知 ID not-found、非法子路径、未绑定项目指引）；「干净数据库首屏」的结构性部分已由独立配置 `e2e/playwright.empty-db.config.ts` + `f009-empty-database.spec.ts` 自动覆盖（不违反 §0：这是一个不含 J1–J9 的独立 spec，J1–J9 本身仍只用 T000 builder 库）；文案措辞质量仍是人工判断，见 §5.1 |
| ⑤刷新/重连后一致 | J9（主：deep link 直达/刷新/History 重放）；J1（根入口 replace 与不猜选）；J5（事实刷新守恒）。SSE 断线重连补读在 M1 无活跃事件源，处理见 J9 行注 |

### 1.1 步骤矩阵

| 步骤 | 用户动作（入口方式） | 预期可见反馈（用户可见文本/状态/列表变化） | 前置数据与环境 | 失败恢复动作及预期状态 | 自动化落点与证据保存 | 五段 |
|---|---|---|---|---|---|---|
| J1 | webServer 以 T000 builder 升级库启动；浏览器打开已发布根入口 `/`（全旅程唯一 goto）；浏览竖栏一级导航（点击） | `/` 被 replace 到 `/projects` 且不新增 History 项；项目列表显示 fixture 的 2 个项目（原 ID 守恒）且不预选任何项；竖栏只有「任务 / 项目 / 运行时 / 设置」四个已注册一级入口，无会话/自动化/记忆/能力/统计占位；页面无旧三栏壳层、底部面板与布局三档 | 同一临时库：FX-PROJECT（2 项目，1 已绑定 / 1 未绑定）、FX-ADAPTER、FX-WORKFLOW、FX-HEALTH | 列表加载失败时 PageState error 给出唯一可执行恢复动作（重试），保留页面上下文，不白屏、不静默落到另一个对象 | T021：旅程主 spec（本矩阵建议名 `e2e/tests/f009-golden-journey.spec.ts`，以 T021 实现为准）+ `f009-shell.spec.ts`（BC-001/002/007/070/072/091）；证据 = Playwright report + CI e2e 工件；T031 人工复核竖栏分组与设置目录（BC-097） | ①⑤ |
| J2 | 从 `/projects` 点击已绑定项目行进入 `/projects/:projectId`（push）；在「代码目录（兼容）」区查看绑定（A003）；点竖栏「运行时」→ `/runtime/adapters`，对一个 adapter 执行验证（A026）并设为项目默认（A027） | 项目页显示代码目录绑定状态；adapter 验证后该行出现可用/验证通过事实（README 步骤2「可派工组合」在 M1 的承担物；「执行组合」一词归 F012，断言不使用）；默认标记移动到该 adapter；每个动作都有可见状态或列表变化 | FX-PROJECT（已绑定项目）、FX-ADAPTER（implementation / validator 各 1，available 与 unavailable 均有） | 验证失败显示可读原因并可重试；凭据默认遮罩，显式「查看」才可见（BC-053）；unavailable adapter 不得伪装可用 | T021 旅程步；T022 `f009-runtime-adapters.spec.ts`（BC-053）；任务级 T010 / T013 组件与 API 命中用例 | ② |
| S1（US-001 / AC-003 补充） | 点竖栏「任务」进入 `/tasks`（不选项目）；点选未绑定项目；地址栏直达 `/tasks/<未知ID>`、`/tasks/<任意ID>/<view>`、`/projects/<未知ID>`、`/projects/<任意ID>/<tab>`（深链 goto 是被测行为，见 §0） | `/tasks` 显示项目选择且不猜第一项；未绑定项目显示绑定指引（partial，不是空白）；未知 ID replace 到 `/tasks?not_found=<id>&from=…` / `/projects?not_found=…`，页面可读且唯一动作是回列表；非法子路径 replace 回 base route 并带 `route_issue=unsupported-view` / `unsupported-tab` 诊断；无 task view / project tab / `/sessions/*` 入口或页面 | 同一临时库；未知 ID 取 fixture 中不存在的 ID；深链与诊断 query 不参与对象身份 | not-found 页回列表后可继续；诊断 query 在用户明确选择有效对象后清除（design manifest） | T021 deep link 覆盖（AC-003）；配合任务级 T014 route manifest 全分支用例 | ④ |
| J3 | 在 `/tasks` 点选已绑定项目（push `/tasks?project=<id>`）；点「新建任务」（A006）只输入目标；观察推荐后确认（A007）；立刻重复确认一次 | 输入与推荐阶段任务列表计数不变（确认前零写入）；确认后列表新增且仅新增 1 条、显示目标原文（守恒）；重复确认计数不变（幂等）；随后进入 `/tasks/:taskId` | FX-TASK（≥2 个 Issue，覆盖 running / blocked / done；先记录基线计数） | 确认失败 → 错误可读、草稿与选择保留、可原样重试（UX-004 / design 草稿生命周期）；目标清空 → 不推荐也不创建（BC-057） | T021 旅程步；T022 `f009-create-task.spec.ts`（BC-056/057）；任务级 T010 | ②③ |
| J4 | 从 J3 任务（或 FX-TASK 既有 running Issue）进入 `/tasks/:taskId`，在「执行与会话（兼容）」区（A008）选择 adapter、输入指令并启动（A009；多节点场景走 A010 graph 启动） | 新 Run / Graph 记录出现并以可见状态（排队/执行中）显示；指令原文出现在会话事件中；启动动作有即时可见反馈。M1 冻结边界：模型/思考深度/上下文范围与撤销窗口归 F012（BC-027/028/058 deferred），本步不断言、旅程不出现对应控件 | FX-ADAPTER（available）、FX-TASK、FX-GRAPH；不驱动真实 CLI，断言止于排队/已受理状态 | 启动失败可读报错并可重试；启动后可取消（A011/A013，流程见 J8） | T021；任务级 T011（A006–A015 唯一 host 的 API 命中与状态用例） | ② |
| J5 | 在 `/tasks/:taskId` 查看 fixture 既有 completed Run 的事实（A012/A016/A017）：graph node/edge、命令事件、文件变化与分页；沿文件变化 / trace 行查看其归属 Run | 命令 / 文件变化条目、顺序、分页 cursor、partial 与截断标记与 fixture 一致；每条事实可读到所属 Run（trace 级追溯）；刷新后同一事实。M1 冻结边界：「资源视图从成果追到 Attempt」与 Artifact revision 归 F011/F010（README 步骤5 版本级；BC-023/059 deferred） | FX-TRACE（同一 Run ≥2 命令事件、2 文件变化、1 分页边界）、FX-RUN（≥3 Run，含 completed / queued / failed）、FX-GRAPH（完成 fan-out/fan-in） | 分页与截断提供明确标记和继续加载动作（BC-046 partial 有恢复） | T021；T022 `f009-page-states.spec.ts`（BC-047）；任务级 T011 / T012 | ②⑤ |
| J6 | 对 FX-VALIDATION 所在 Issue 在验收兼容区手动触发 validation（A021），validator 选择与实现不同的 adapter；随后查看 rounds 列表 | 新 round 出现且计数 +1、状态可见（排队）；既有「2 失败 round + 1 通过 round」原样保留、不合并；新 round 的 validator Run 身份可读。M1 冻结边界：「换模型、冷启动、只给结果」与同源独立性降级归 F012/F011（README 步骤6 版本级；BC-028/042 deferred） | FX-VALIDATION（同一 Issue ≥2 失败 round 后通过；v11 回填 `validation_attempt=1`）、FX-ADAPTER（validator 可用） | 触发失败可重试；blocked Issue 提供 unblock 入口（A022，动作存在性在此断言，流程见 J8） | T021；任务级 T012（A021 写动作调用矩阵指定 API） | ② |
| J7 | 查看既有 Issue 的证据与 validation 兼容详情（A018/A020）：complete 与 partial 两组 evidence、rounds / findings / summary；执行摘要复制/下载（A024）与 trace 导出（A019）；对 FX-VALIDATION Issue 执行 reset rounds（A023） | complete / partial 标记如实显示；rounds / findings / summary 内容与 fixture 一致，机器事实与摘要不混写；复制/下载与导出产出引用原 Run；reset 有确认说明与结果反馈。M1 冻结边界：主张 / 论证 / 未覆盖项 / 独立性状态归 F011（BC-009~018 deferred）；「同源负例明确降级」为 README 步骤7 版本级内容 | FX-EVIDENCE（complete 与 partial 各 1 组）、FX-VALIDATION、FX-TRACE | reset 为高风险动作：确认说明「会动什么 / 不动什么 / 如何恢复」（V3.44 全局契约）；partial evidence 显示缺什么与下一步（BC-046） | T021；T031 人工抽检导出 / 摘要内容与文案术语（UX-003、BC-119）；任务级 T012 | ② |
| J8 | 取消 J4 产生的 queued Run（A011）与一个 graph（A013）；查看 FX-RUN 既有 failed Run 的失败原因；对 FX-GRAPH blocked node 执行重试（A014）与 resolve-executors（A015）；对 blocked Issue 提交 operator note 解除阻塞（A022）；重启 webServer（同一数据库二次启动）并刷新页面 | 被取消 Run / Graph 显示「已取消」，不冒充成功或失败（BC-047）；failed Run 显示可读失败原因；重试 / resolve / unblock 各自产生可见状态变化；重启后记录计数与 schema 不变（T000 幂等），刷新后所有事实与重启前一致。M1 冻结边界：「运行中 Attempt 标中断、从该步恢复」的完整语义依赖 F012 介入模型（README 步骤8 版本级）；M1 断言取消/失败/阻塞的守恒显示与恢复动作可达 | FX-RUN（queued + failed）、FX-GRAPH（blocked，含可重试 node）、FX-TASK（blocked）；重启复用同一临时库 | 即本步主体：每个异常状态给唯一主操作（V3.44 §5），操作后回到可继续状态 | T021；T022 `f009-page-states.spec.ts`（BC-047）；数据库幂等由 T000 任务级用例兜底 | ③（主） |
| J9 | 从列表点选既有对象并复制 / 进入 canonical deep link（`/tasks/:taskId`、`/projects/:projectId`），刷新；浏览器 History 前进/后退往返两个对象；再次从 `/` 进入 | 直达与刷新后回到同一对象、同一事实；History 前进/后退重放正确对象，上一对象未完成的加载被取消；`/` 再次 replace 到列表且不猜选；全程未出现旧写入口。M1 冻结边界：「生成完成摘要并回放派工 / 上下文 / Artifact revision / 验证者结论」为版本级闭环（README 步骤9；F010/F011/F012/F014），M1 以 J7 的既有摘要只读事实与导出守恒承担可承担部分。行注：SSE 断线重连按 `event_sequence` 补读在 M1 无活跃事件源（fixture 全为终态、不驱动 CLI），本旅程不断言（豁免已明文化于 spec §7 / design.md §8），归 F011/F012 旅程与 T031 裁定 | J3–J8 的写入与本库既有事实共存；「既有事实守恒」以 T000 基线计数核对 | 刷新后对象不存在 → not-found 恢复态（S1 同款）；加载失败 → PageState 唯一恢复动作 | T021（AC-003 的直达 / 刷新 / History 浏览器断言）；T031 人工复核 History 与诊断清除细节 | ⑤（主） |

## 2. 28 条 adapted 生产断言映射（对应 T022）

**分母核对**：`browser-check.json` 的 checks 数组逐条点数为 125；applicability 表 BC-001–BC-125 连续无缺；分类 adapted 28 / deferred 96 / not-applicable 1，总数 125，与 spec §7 / DQ-005 一致。**未发现分母或分类不一致**。唯一 not-applicable 为 BC-045（不计入下表），由「生产代码禁止 `data-demo` / `data-unbuilt` 属性」的反向门禁取代。applicability 引用的 source 是 `browser-check.mjs`（附 sha256）；集成人已复算 `.mjs` 的 sha256 与 applicability 记录一致（`ebca2c9f…be8f7`），`browser-check.json` 的 125 条亦逐条点数一致。

落点缩写：T022 各 spec 文件名均指 `e2e/tests/` 下 applicability「生产测试路径」列所指文件；「静态门禁」指 `web/src/f009-content-contract.test.ts` 等生产文案/占位反向门禁（T022 建立，随 `npm run verify` 常驻）。

| BC | 断言（简写） | 覆盖 AC | 迁移矩阵入口 | 落点 |
|---|---|---|---|---|
| BC-001 | 任务舞台占主导、左栏收窄 | AC-001、AC-002 | P001 | T022 `f009-shell.spec.ts`；任务级 T002/T003 已有 jsdom 铺底 |
| BC-002 | 删除底部面板、状态栏、图标活动栏 | AC-002 | P001（旧壳层退出） | T022 `f009-shell.spec.ts` |
| BC-005 | 任务左栏按稳定组织维度分类 | AC-001、AC-003 | A004 | T022 `f009-shell.spec.ts`；M1 只断言列表骨架（分组维度的最终语义归 F011，行注见报告） |
| BC-006 | 标签用下拉而非横排 chip | AC-004、AC-001 | A004 | T022 `f009-shell.spec.ts`；M1 断言共享交互形态，标签域数据由 fixture Issue labels 提供（design.md §8） |
| BC-007 | 一级竖栏分日常与低频入口 | AC-002、AC-003 | P001 | T022 `f009-shell.spec.ts`（只对 M1 已注册四槽位断言相对分组） |
| BC-030 | 命令面板可开关 | AC-004 | P001（全局导航原语） | T022 `f009-command-palette.spec.ts`；入口（竖栏「跳转」按钮 + Ctrl+K）与语义已定义于 design.md「命令面板（全局导航原语，BC-030）」小节 |
| BC-044 | 说明文字长度上限（单段 ≤150 字） | AC-004（UX-001） | 全部迁移文案 | T022 静态门禁 `web/src/f009-content-contract.test.ts` |
| BC-046 | loading / empty / error / partial 有恢复 | AC-004（US-002.2） | 全部 M1 route；PageState 原语 | T022 `f009-page-states.spec.ts`；任务级 T002 已覆盖原语行为，本行补生产证据 |
| BC-047 | interrupted / cancelled 不冒充成功 / 失败 | AC-001、AC-004 | A008/A012/A016（Run 状态显示） | T022 `f009-page-states.spec.ts`；fixture 终态守恒由 T000 兜底 |
| BC-048 | dialog 语义与可访问标题 | AC-004 | A002/A005/A006/A007/A022/A023（弹层集合） | T022 `f009-a11y.spec.ts`；任务级 T002 已覆盖原语 |
| BC-049 | dialog 焦点陷阱、Esc、焦点归还 | AC-004 | 同上弹层集合 | T022 `f009-a11y.spec.ts` |
| BC-050 | 每个 dialog 都支持 Esc（批量） | AC-004 | 同上弹层集合 | T022 `f009-a11y.spec.ts`（对矩阵全部 dialog 批量） |
| BC-051 | 数据表列头 / 单元格语义 | AC-004 | A001/A004/A025/A029（列表表格） | T022 `f009-a11y.spec.ts` |
| BC-052 | tabs 选择、tab stop 与键盘 | AC-004 | M1 真实 tabs（集合按 design.md §8 规则清点） | T022 `f009-a11y.spec.ts`；「仅测 M1 真实 tabs」，实例集合由 T022 清点回填 applicability，零实例时降为原语最小可达使用，T031 复核 |
| BC-053 | 凭据默认遮罩并显式查看 | AC-004、AC-005 | A026 | T022 `f009-runtime-adapters.spec.ts` |
| BC-056 | 新任务原文守恒、确认前零写、重复幂等 | AC-001、AC-005 | A006/A007 | T022 `f009-create-task.spec.ts`；与 T021 旅程 J3 共用同一临时库复证 |
| BC-057 | 空目标不推荐也不创建 | AC-001 | A006 | T022 `f009-create-task.spec.ts` |
| BC-070 | 竖栏是唯一一级导航 | AC-002、AC-003 | P001 | T022 `f009-shell.spec.ts` |
| BC-072 | 顶栏没有布局三档 | AC-002 | P001（旧 Dock 退出） | T022 `f009-shell.spec.ts` |
| BC-075 | 工作面挂 surface-host 且不盖竖栏 | AC-002、AC-004 | P001 | T022 `f009-shell.spec.ts`（断言所有 M1 registered surfaces） |
| BC-076 | hidden 视图不叠加 | AC-004 | P001 | T022 `f009-shell.spec.ts` |
| BC-091 | 页面无横向溢出 | AC-004（NFR-002 窄视口） | 全部 M1 route | T022 `f009-shell.spec.ts` |
| BC-097 | 设置目录只含有真实页面的类别 | AC-003（FR-004/FR-005） | P010/A028/A029（diagnostics 与 legacy-workflows 两个真实子页） | T022 `f009-shell.spec.ts` |
| BC-119 | 界面只留事实与动作 | AC-004（UX-003） | 全部迁移文案 | T022 静态门禁 `web/src/f009-content-contract.test.ts` |
| BC-122 | UI 不暴露单用户 / 本机形态限定 | AC-004（UX-003） | 全部迁移文案 | T022 静态门禁（同上） |
| BC-123 | 界面不出现「弹层」一词 | AC-004（UX-003） | 全部迁移文案 | T022 静态门禁（同上） |
| BC-124 | 文案不含设计 / 原型说明 | AC-004（UX-003） | 全部迁移文案 | T022 静态门禁（同上） |
| BC-125 | 所有数据表用正式字段与内容 | AC-004 | A001/A004/A025/A029（已注册 surface 的真实表格） | T022 `f009-a11y.spec.ts` |

T031 对本节的职责：核对 125 条分母未漂移；全部 adapted 行逐条执行通过；deferred 行只验证「无入口」；BC-030 / BC-052 / BC-006 的断言对象集合按现场实现裁定并回填规格缺口。

## 3. AC → 测试映射骨架

- **AC-001**（`FR-001`, `FR-003`, `NFR-001`）：
  - [任务级]：`server/tests/integration/f009-v02-fixture.test.ts`「F009 v0.2 schema-v10 fixture」（T000：来源指纹、v10 → v11 → head 升级链、幂等与变异）。
  - [需求级] 已回填（见 §5）：`e2e/tests/f009-golden-journey.spec.ts` 连续执行 J1–J9、S1；applicability 指定的各 `f009-*.spec.ts` 承担对应步骤。
  - 人工：无单独人工条目。「真实 CLI 旅程」部分按 self-test §3.3 属发布级（T030 / 版本收口），不计入本 AC 的浏览器旅程。残余人工项：「干净数据库首屏指引」（§3.2.1 第④段）受 §0 数据策略限制无法自动化（豁免已明文化于 spec §7），归 T031 在真实升级场景人工确认。
- **AC-002**（`FR-002`, `FR-005`, `FR-007`, `NFR-004`）：
  - [任务级]：`tools/check-v03-plan-contracts.test.mjs`「V03-PLAN 合同套件」（T001 随迁移持续维护）。
  - [需求级] 待 T020 追加：单写入口 / 死入口静态扫描（每个 migrated action ID 唯一 host、retired 无可达写入口、transitional-host 三项非空）；T022 的 BC-001/002/007/070/072/097 从浏览器侧复证。
  - 只能人工验证：「已发布 URL inventory 的来源逐项可核对」与矩阵逐行 completion_evidence 复核——inventory 证据散在 release 文档与制品中，无单一自动化真相源，归 T031。
- **AC-003**（`FR-004`, `UX-003`）：
  - [任务级]：`web/src/f009-shell.test.tsx`「M1 SurfaceRegistry manifest」「ApplicationShell rail」（T003，route 槽位与未注册 surface）。
  - [需求级] 待 T014 追加（route manifest 全分支任务级用例）与 T021 回填（浏览器直达 / 刷新 / History / 未知 ID / 非法子路径，见 J1/S1/J9）。
  - 只能人工验证：同 AC-002 的 inventory 来源核对（T031）。
- **AC-004**（`UX-001`, `UX-002`, `UX-004`, `NFR-002`）：
  - [任务级]：`web/src/f009-primitives.test.tsx`（T002：AppDialog / AppTabs / DataTable / PageState / Feedback）、`web/src/f009-task-draft-store.test.ts`（T004：generation / revision 契约与三个清理路径变异）。
  - [需求级] 已回填（见 §5）：§2 中各 BC 行随 `f009-shell` / `f009-a11y` / `f009-page-states` / `f009-create-task` / `f009-runtime-adapters` / `f009-command-palette` spec 与静态门禁落地，含键盘 / 语义 / 窄视口 / console 零错误门禁；草稿跨 route 往返随 J3/J4 断言。
  - 只能人工验证：反馈与状态在真实浏览器中的可读性、一致性（US-002 整体观感）归 T031。BC-030 入口与语义已定义于 design.md「命令面板（全局导航原语，BC-030）」小节；BC-052 / BC-006 断言对象按 design.md §8「adapted 行断言对象集合」规则处理（BC-006 标签域由 fixture Issue labels 提供），T031 复核实例清点完整性。
- **AC-005**（`FR-006`, `NFR-003`）：
  - [任务级]：`web/src/f009-pages.test.tsx`（T010，A001–A005 写入命中既有 API）。
  - [需求级] 待 T011–T013 追加（各迁移 host 的 API 命中用例）与 T020 追加（canonical API 静态断言）；T022 的 BC-053/056 从浏览器侧复证唯一写入口。
  - 人工：无。F001–F008 全量回归由 T030 `npm run verify` 覆盖（「由门禁覆盖」口径）。

## 4. 矩阵使用说明

- **T021**：以 §1 为用例顺序骨架，一行至少一个 test；断言遵守 §0 断言语言与入口纪律；各行「M1 冻结边界」不得实现为断言、其控件不得出现在旅程里。实现完成后按 self-test §5.1 格式回填 spec §6 各 AC 行的 `[需求级]` 引用（spec 文件 + 用例名）。
- **T022**：以 §2 为分母清单逐行落地，落点文件名以 applicability「生产测试路径」列为准；完成后在本文件与 applicability 对应行回写实际用例名。新增共享交互形态时先更新 applicability 分母与本矩阵，再做失败变异。
- **T031**：按 §1 逐步、§2 逐条对照真实浏览器；deferred 项只验证「无入口」；发现分母漂移先修 applicability 再继续检查。检查记录的「旅程步骤」列填 J*/S* 编号。
- **升级规则（self-test §7.2 重复即升级）**：同一旅程步骤（以 J*/S* 计）第二次出现在 `dogfooding-bugs.md` 或 `dogfooding-notes.md`（任一表），即强制把该步骤补强为独立的需求级断言（在对应 spec 步骤加显式断言），不接受只修单点；`npm run bug:log` 的重复步骤清单是触发器。
- **变更纪律**：旅程、迁移矩阵或 adapted 分母变化时，先改规格侧文档与本矩阵，再改测试；矩阵与现实的漂移由 `tools/check-v03-plan-contracts.test.mjs` 与文档门禁把关。

## 5. 执行证据回填（T031 / R1-011 闭环）

- execution_evidence_commit: 5d1f08c3dc82d2ae1a481afe4b629aa25693c368
- 自动化：`e2e/tests/f009-golden-journey.spec.ts` 以单次 `goto("/")` 连续执行 J1–J9（test.step 显式编号），S1 为独立深链用例；`npm run verify:release`（含全量 e2e 套件 25/25）在修复后提交上全绿。
- 原「现场裁定」（依 §4「断言对象集合按现场实现裁定」）已被 review R1-005 判定为「测试模拟自身」而推翻：A010/A021/A023/A015 当时都以「M1 fixture 无可达状态」为由，把写动作让给任务级单元测试断言入口存在性，旅程本身从未真正执行这些写动作。round-3/4 修复补齐了可达 fixture 和一个确定性、不驱动真实 CLI 的 fixture adapter（`adp_v02_fake` / `FakeAgentAdapter`，见 `server/src/runtime/adapters/fake-adapter.ts`）。round 4（review R3-016）之后，这个 fixture-only adapter 不再随生产启动无条件注册：`server/src/runtime/register-adapters.ts::buildProductionAdapterRegistry(env)` 只在 `ENABLE_FAKE_ADAPTER=1` 时注册它，只有 E2E Playwright config 设置这个环境变量；`server/src/index.ts` 调用该函数时传入未经修改的 `process.env`，这一调用点本身由 `register-adapters.test.ts` 的源码扫描锁定。四个动作现在都由旅程本身真实执行：
  - A010 graph 启动：新增 `ws_v02_graphok` 与 `iss_v02_graphok`，专门承担 graph 成功路径——其余 issue 仍共用 `/repo/alpha`（故意不存在，供 J8 的真实 CLI spawn 失败半段使用）。`ws_v02_graphok` 的 workspace 目录不是固定路径：round 4（review R3-017）后，`e2e/tests/support/invocation-dir.ts::createInvocationDir()` 为每次调用（Playwright config 及其可能派生的 worker 进程）派发一个 `mkdtemp` 出的唯一目录，`server/tests/fixtures/build-v02-fixture.ts` 在这个目录下创建 `graphok-workspace/`（含一个匹配 dual_review targetGlob 的文件），fixture SQL 里的占位符 `__GRAPHOK_WORKSPACE_PATH__` 在构建时替换成实际路径；`globalTeardown` 结束时删除整个 invocation 目录，两次并发的真实 Playwright 调用不会共享或互删对方的目录（`server/tests/integration/f009-v02-fixture.test.ts::keeps two concurrent fixture builds fully isolated` 用两个真实子进程调用 `createInvocationDir()` 本身验证这一点）。J4 在这个新 issue 上选择 Fixture CLI 启动 graph：`FakeAgentAdapter` 按 `## Node: <key>` 标记识别节点、回传 `{node_key, findings: []}`，graph 真实跑到 completed，而不是断言一个脚本化 500。
  - A021 触发验证：`iss_v02_validating` 的 grace 窗口打开（`validation_dispatch_due_at` 设到 2099），J6 真实点击「Start automatic validator now」，`adp_v02_fake` 作为唯一 eligible validator 派工执行、回传一个非空 findings 的失败 verdict（"failed" 结局按 `result-parser.ts` 的不变量要求至少一条 finding），断言 round 计数从 0 变 1、Issue 回到 Running、`Validation failed` 事实出现——不再是「非 Validating 任务上不存在入口」的边界断言。
  - A023 reset rounds：`iss_v02_roundlimit` 保持 RoundLimitReached 阻塞，J7 真实点击 Reset Rounds、提交 operator note，断言 `validation.round_reset` 事件与 Issue 仍保持 Blocked（reset ≠ unblock）。
  - A015 resolve-executors：新增 `iss_v02_nocapable` / `grun_v02_g3`（修正了原有 `review_contracts`/`synthesize` 与真实图定义 key 不符的 fixture bug，改为 `review_contract`/`synthesize_findings`），J8 真实为三个受阻节点选择 Fixture CLI 并提交，断言 202 响应与「Reassign executors」面板让位。
  - A011/A013 取消：J8 真实执行（确认对话框 → cancelled），连带排队 Run 取消的事实已断言，行为未变。
  - 上述四项不再有对应的任务级单元测试依赖（`web/src/f004-validation-hooks.test.tsx`、`f004-round-reset-dialog.test.tsx`、`f006-graph-run-card.test.tsx` 这三个文件名引用已过时，不代表这些写动作唯一的执行证据仍在那里）。
- 28 条 adapted 行落点复核：§2 表所列 spec 文件全部存在并随 `npm run verify:release` 执行，且现在有机器可读门禁锁定（`tools/check-v03-plan-contracts.test.mjs::F009-CODE-R1-006`：解析全部 28 行、按登记文件分组、断言每个 BC id 在其文件里仍有引用，删行/删引用/文件缺失三种变异均可验证会变红）。BC-049（dialog 焦点归还）修的是一个真实无障碍性缺陷——多数对话框用普通 `<button>` 触发而非 Radix `DialogTrigger`，导致 `context.triggerRef` 恒为 null，关闭时 Radix 自身默认恢复被无条件 `preventDefault()` 取消却又没有替代目标，焦点落回 `<body>`（Start Graph 与命令面板是例外：前者本就用了真实 `DialogTrigger`，后者走的是 `AppDialog` 自带的通用焦点恢复，两者无需 `restoreFocusRef`）。round 4 把 BC-048/049/050 的验证方式改成了单一的可执行清单（`f009-a11y.spec.ts` 的 `DIALOG_INSTANCES` 数组）：每个生产 dialog、每个不同的打开方式各占一行，一个参数化的测试体逐行断言语义、焦点进入、Esc 关闭、焦点归还——此前三轮各自补一个遗漏实例的散点修复方式（一度遗漏 Adapter 的 Edit 分支，只测了 Create 分支）到此结束，新增第二个触发方式意味着必须新增一行，不存在可以绕开清单的入口。BC-056 新增服务端幂等的真实第二次请求重放证明（原 dblclick 断言只证明了客户端防连点）。BC-052 的 M1 真实 tabs 实例为 /settings/legacy-workflows 的列表/详情对（R1-006 后补的生产实例，且已修复 R2-014：选中面板此前不随 tab 切换）；BC-006 的标签域来自 fixture Issue labels（下拉筛选，无 chip 行）；console/pageerror 零错误门禁覆盖全部 M1 路由（`f009-a11y.spec.ts`）。
- T031 的可验证范围（125 条分母核对 + 干净数据库首屏结构性部分）已全部转为门禁 / e2e 断言，见下方「人工走查清单」的自动化拆分记录。按「自动化与人工判断边界纪律」（`docs/SOP.md`），本任务到此为止；剩余的真实浏览器观感、导出/摘要文案措辞等审美/语感判断，是独立于开发流程、可持续进行的人工体验复核，不作为 T031 的完成条件，也不阻塞 F009 的 review 状态——发现的缺陷/观察随时记入 `dogfooding-bugs.md` / `dogfooding-notes.md`，「旅程步骤」列使用 J*/S1 编号。

### 5.1 人工走查清单（结构性部分已自动化；剩余为独立于开发流程的持续性体验复核）

按「自动化与人工判断边界纪律」（`docs/SOP.md`）复核后，本清单里原本整体标为人工的两项已经拆出了可自动化的部分——结构/行为事实转成了门禁，只把真正的审美/措辞判断留在人工：

1. **125 条分母核对**：
   - 28 条 adapted：机器可读 inventory 已锁定（`tools/check-v03-plan-contracts.test.mjs::F009-CODE-R1-006`），但「体验是否合理」仍是人工判断——逐条打开界面肉眼核对。
   - 96 条 deferred：`tools/check-v03-plan-contracts.test.mjs::F009-CODE-DEFERRED-INVENTORY` 已把全部 96 条归类完毕——85 条被 BC-070 导航缺失断言、S1 路由不可达断言、BC-097 设置目录 closed-count 断言或新增的 `e2e/tests/f009-deferred-boundary.spec.ts`（composer/`/runtime`/`/runtime/adapters`/WorkspaceBinding/CreateIssueDialog 五组页面级元素缺失断言）证明无入口；11 条（BC-031/032/042/043/068/086/089/103/106/110/113）是数据模型/业务规则/跨 Feature 完成度声明，没有可断言"不存在"的具体 UI 元素，已在门禁里显式标注 NOT_APPLICABLE 并写明原因，不需要也不应该人工去找一个不存在的入口来验证。residual 现在锁定为 0——人工在这一项上**没有剩余工作**。
   - 1 条 not-applicable：确认未被误植入生产代码。
   - 过程中发现分类该变先改 applicability 文档再继续。
2. **黄金旅程 J1–J9 + S1 逐步走一遍真实浏览器**，按 §1「预期可见反馈」列核对，重点是自动化结构性测不到、真正需要审美/语感判断的部分：J1 竖栏日常/低频分组的**视觉合理性**与设置目录条目**清晰度**；J7 导出 Markdown / 复制摘要的**文案措辞**是否读起来顺（禁用词表已由 `f009-content-contract.test.ts` 门禁锁定，这里核对的是措辞质量本身，不是词表命中）。
   - **干净数据库首屏的结构性部分已自动化**（`e2e/playwright.empty-db.config.ts` + `f009-empty-database.spec.ts`：零 seed 库首次打开 `/`、`/tasks`、`/runtime`、`/settings/legacy-workflows` 时正确的空态组件与唯一恢复动作都有断言，过程中还发现并修了 ProjectsPage 空态下两个「新建项目」按钮同时出现的真实 bug）；人工只需要看一眼这几个空态文案**读起来是否舒服**，不用再验证组件对不对。
3. 走查时逐步写下人工结论（J1–J9、S1 各一条），缺陷记 `dogfooding-bugs.md`、体验观察记 `dogfooding-notes.md`，两边「旅程步骤」列用本矩阵的编号——这是持续性活动，不设完成时限，也不是 `tasks.md` T031 勾选的前提（T031 的门禁范围已在上方全部自动化闭环）。
