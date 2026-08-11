# PersonaHub 使用体验记录（dogfooding notes）

> 记录使用过程中**不算 bug 但影响体验**的发现（不直觉的交互、缺失的能力、术语不一致、文档跟不上实现等）。
> 是 bug 就进 [`docs/reviews/dogfooding-bugs.md`](dogfooding-bugs.md)，不要记两份。
> 存放于 `docs/reviews/dogfooding-notes.md`（纳入 git）。
> 主表是**唯一事实源**（状态/发现时间/类型/去向以主表为准；时间统一本地时区 Asia/Singapore，UTC+8），详情块只补「现象/期望/影响范围/备注」这类不适合塞进表格的内容。
> 状态流转：`open`（待处理）→ `adopted`（已采纳，去向填 BACKLOG 条目或 Feature ID）→ `dismissed`（决定不做，详情块写理由）。

## 主表

| ID | 状态 | 发现时间 | 类型 | 问题（一句话） | 关联模块 | 去向 |
|---|---|---|---|---|---|---|
| NOTE-001 | open | 2026-08-12 00:41 | 交互 | 点 adapter 名字可编辑，但点击无任何反馈/提示，第一次用完全不知道能点 | web/adapter | — |
| NOTE-002 | open | 2026-08-12 00:41 | 交互 | 新建 adapter 要点"Configure adapter"按钮，无 + 号之类的新建入口，第一次用猜不到 | web/adapter | — |

## 详情

### NOTE-001：点击 adapter 名字进入编辑，无可发现性

- **现象**：左侧 adapter 管理列表里，名字是可点击的编辑入口，但没有 hover 态、下划线、图标或任何视觉提示，看起来就是纯文本。
- **期望**：名字可点击应该有明显的可交互提示（hover 高亮/光标变化/编辑图标），或者干脆给每行加一个显式的"编辑"按钮，别让"点名字"是隐藏操作。
- **影响范围**：每个第一次用 adapter 管理面板的人都会踩，属于核心操作的可发现性问题。
- **根因**（已定位，暂不修）：`AdapterRow.tsx` 名字用的是裸 `<button>`，没走项目自己的 `Button` 组件；同文件里紧挨着的 Revalidate/Delete 按钮都用 `variant="ghost"` + `title`，唯独名字漏套。
- **备注**：暂不单独修，并入后续「前端体验提升」专项统一处理，届时参考本机 `D:\Projects\clowder-ai`、`D:\Projects\multica` 的页面设计。

### NOTE-002：新建 adapter 的入口是"Configure adapter"按钮，缺少直觉的新建入口

- **现象**：新建 adapter 靠点击"Configure adapter"按钮触发，按钮文案读起来像"配置某个已有 adapter"，不像"新建"。
- **期望**：预期是列表旁边有个 `+` 之类的新建按钮；如果保留现有按钮，至少文案要能读出"新建"的意思（比如"Add adapter"/"新建 adapter"）。
- **影响范围**：同 NOTE-001，第一次用会卡在"怎么创建"上。
- **根因**（已定位，暂不修）：`AdapterDialog.tsx:119` 新建态 DialogTitle 和 `AdapterSettings.tsx:93` 按钮文案都硬编码复用了 `"Configure adapter"`，没有像提交按钮那样用 `isEdit` 区分成 "Add"/"Edit"。
- **备注**：暂不单独修，并入后续「前端体验提升」专项统一处理，届时参考本机 `D:\Projects\clowder-ai`、`D:\Projects\multica` 的页面设计。

<!-- 每条 NOTE-xxx 一个三级标题，只在需要展开时写；能一句话说清楚的不必展开。
### NOTE-001：标题
- **现象**：实际观察到的行为/交互。
- **期望**：设想中更顺手的样子（不是需求文档，一两句话即可）。
- **影响范围**：多大概率遇到 / 影响哪类操作。
- **备注**：dismissed 时写理由；adopted 时写落地位置（BACKLOG 条目、Feature ID 等）。
-->
