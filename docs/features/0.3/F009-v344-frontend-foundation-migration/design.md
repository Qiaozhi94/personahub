---
topics: [frontend, v344, migration, app-shell, accessibility]
doc_kind: design
created: 2026-09-08
updated: 2026-09-08
---

# F009：V3.44 Frontend Foundation & Migration - 设计

## 0. 输入与约束

输入为本目录 `spec.md`、V3.44 `design.md` / `implementation-notes.md`、F001–F008 release contract 和当前 `web/src` 实现。设计稿决定交互结构，PRD / Feature 决定生产范围；不得复制原型静态数据。

## 1. 技术概要与影响面

以新的 application shell、route registry、共享交互原语和 legacy view adapter 替换当前单页三栏拼装。既有 hooks / API client 和领域命令优先复用；迁移矩阵把 surface 分为 stable-shell / final-surface / transitional-host，旧视觉容器直接退役。transitional-host 只包装既有事实读取或保持 v0.2 旅程所必需的最小动作，不接受最终视觉重做。

## 2. 架构与模块边界

`ApplicationShell` 只负责全局导航、路由出口、页面层级和全局反馈；`SurfaceRegistry` 只注册达到生产条件的工作面；`LegacyViewAdapter` 把现有 API DTO 转成过渡 view model，不反向写数据库。写动作继续调用 F001–F008 canonical API。共享 dialog / tabs / table / feedback primitives 统一承载可访问性契约。

## 3. 数据模型与 Migration

不新增或改写业务表。需要保留的前端偏好仅限非领域 UI 状态；路由 alias 和页面迁移矩阵以代码 / 文档常量维护。旧 schema 的数据库升级不在本 Feature，F014 负责跨版本 migration；本 Feature 只保证 v0.2 当前 schema 数据可读可操作。

## 4. 接口、Contract 与 Event

Route contract 为稳定的一级 surface + 对象 ID + 可选子视图；旧 URL resolver 纯函数映射，不查询或改写对象。兼容 projection 只组合现有 projects、issues、threads、runs、trace、evidence、adapters、workflow templates 和 runtime-health API。事件订阅继续使用现有 SSE cursor，route 切换不得重复订阅或制造事件。

## 5. Runtime、Workflow 与并发

不改变 graph、run、validation 和 adapter runtime。页面切换保留当前对象与未提交输入；重复提交、SSE replay 和写后读一致性沿用现有 service contract。旧入口一旦从生产 registry 移除，不再接受新写入。

## 6. UI 与可观测性

先落全局 token、字体层级、导航、主栏 / 副栏框架和 loading / empty / error / partial 组件，再迁移项目、任务与既有事实。执行 / validation 写入口以最小 transitional-host 保住 v0.2 旅程；Trace / Evidence 使用只读宿主；adapter / runtime health 只做设置或运行时的最小读取与既有配置入口；旧 Workflow Template 只保留只读列表 / 详情，不重做编辑器，由 F013 Skill 面替换。未交付工作面不注册。开发态提供 route / surface 清单和 legacy adapter 计数，生产界面不出现设计过程术语。

## 7. 失败、恢复、安全与兼容

路由解析失败回到可恢复的对象列表并保留原 URL 诊断信息；兼容字段缺失显示 unknown / legacy，不从当前配置猜历史值。Markdown、文件预览、凭据和真实路径继续遵守既有安全边界。高风险动作统一显示影响、不影响和恢复路径。

## 8. 测试策略与验收映射

AC-001 使用 v0.2 fixture 黄金旅程；AC-002 由迁移矩阵静态校验、route registry 扫描和旧组件入口断言覆盖；AC-003 覆盖每类旧 URL；AC-004 覆盖共享原语的 axe / 键盘 / viewport / console；AC-005 以 API mock 调用断言和 adapter dependency test 验证无第二写入口。

## 9. 已确认决策与残余风险

确认 F009 是 v0.3 首个实施 Feature；它迁移现有能力，不等待 F010–F013 的新模型，也不承诺设计稿九个工作面全部上线。迁移矩阵每个 transitional-host 必须记录 `replacement_owner`、`delete_when`、`latest_milestone`，并由 F011 / F012 / F013 验收时删除。残余风险是视觉迁移扩大为业务重写，以“数据库零变更、canonical API 不变”“不得为 transitional-host 重做最终视觉或新增领域逻辑”和迁移矩阵作为硬边界。

## 10. 待确认设计问题

无。
