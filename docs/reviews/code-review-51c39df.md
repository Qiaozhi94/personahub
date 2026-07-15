# 代码检视：commit `51c39df`

> Update specs, tasks, and add F003 design/tasks and UI flow tests
> 检视人：Claude（Opus 4.8）｜日期：2026-07-16

## 一、检视范围

该提交共改动 13 个文件、+1917/-323 行，其中**绝大部分是文档**（BACKLOG、CLAUDE.md、F001/F002/F003 的 spec/design/tasks）。真正的**代码只有两个新增测试文件**：

- `web/src/f001-ui-flows.test.tsx`（+194，4 个用例）
- `web/src/f002-ui-flows.test.tsx`（+224，5 个用例）

本文聚焦这两份测试代码。文档变更不在代码检视范畴，仅在末尾附一句提示。

## 二、总体结论

**质量良好，可以合入。** 已实测验证：

- 两个文件 9 个用例**全部通过**（`vitest run`）。
- `tsc --noEmit` **通过**。
- 逐一比对了被测组件（`IssueInspector` / `ThreadView` / `AdapterSettings` / `WorkspaceBinding` / `CreateIssueDialog` / `CreateProjectDialog`）与对应 hook 的调用签名，**断言与实现一致，未发现功能性 bug**。

用例覆盖了 F001（建 Project / 绑 Workspace / 建 Issue / Inspector 展示 Primary Thread）与 F002（建/改 adapter、Thread 下发指令、Run 状态与日志、取消 Run、升级阻断展示）的主干链路，是有价值的 UI 行为回归网。

下面是若干**改进建议**，均非阻塞项，按优先级排列。

## 三、发现项

### 1.〔可维护性 · 建议优先处理〕mock 与测试脚手架重复，且已出现漂移

`vi.mock("@/lib/api-client", …)`、`renderWithQuery` 助手、以及各类 fixture 在 `f001`、`f002` 中**逐字重复**，且与既有的 `app.test.tsx` 构成第三份拷贝。

**这不是纯洁癖问题——漂移已经发生：** `app.test.tsx` 的 mock `apiClient` 里**没有 `adapters` 和 `runs`**，而新文件里有。随着 F003/F004… 继续新增 `f00X-ui-flows.test.tsx`，每份都要各自维护一遍与真实 `api-client` 同构的 mock，极易再次跑偏。

**建议：** 抽到共享测试助手（项目已有 `src/test/setup.ts`，可新增 `src/test/ui-flow-helpers.tsx`），集中提供：
- 单一 `renderWithQuery`；
- 一个与 `api-client` 单一来源同步的 mock 工厂；
- 见下条第 4 项的 fixture 工厂。

### 2.〔死代码〕`f001` 未使用的导入 `ActorType`

`web/src/f001-ui-flows.test.tsx:5` 导入了 `ActorType`，全文件未使用（已 grep 确认；`f002` 中确有使用）。因当前 tsconfig **未开启 `noUnusedLocals`**，typecheck 不会报错，故逃过了检查。建议删除。

> 附带建议：可考虑开启 `noUnusedLocals` / `noUnusedParameters`，这类死导入就能在 CI 自动拦截。

### 3.〔健壮性〕`scrollIntoView` 直接改写全局原型且未还原

`f002` 的 `beforeEach` 里用 `Object.defineProperty(Element.prototype, "scrollIntoView", …)` 打桩，但**没有 `afterEach` 还原**。单文件内无害，但作为模式会污染同一 worker 内的其他测试。既有 `src/test/setup.ts` 已经统一处理了 `matchMedia`，`scrollIntoView` 更适合放到同处（或改用 `vi.spyOn` + 自动 restore）。

### 4.〔测试卫生〕workspace 绑定用例中重复 rerender 新建了第二个 QueryClient

`f001` 的绑定用例里 `view.rerender(...)` 另起了一个 `new QueryClient()` 并包了一层新的 `QueryClientProvider`，与 `renderWithQuery` 助手用的 client 不是同一个。功能上能过，但一个测试里同时存在两个 client 略显脆弱且不一致，建议复用同一 client。

### 5.〔覆盖缺口〕仅覆盖 happy-path 的出站调用，分支逻辑未测

现有断言主要验证"点了按钮 → 用对参数调了 apiClient + 渲染了个别文案"，以下**带有真实产品/安全语义的分支**尚未覆盖，建议后续补齐（对 UI-flow 验收非阻塞，但价值高）：

- **发送护栏**：`ThreadView` 的 `disabledMessage` 三条分支（无 adapter / Issue 被 blocked / 已有 run 在跑）与多 adapter 的 `<select>` 选择路径（`availableAdapters.length > 1`）。
- **升级/隔离文案**：`IssueInspector` 只测了 `pre_execution_approval`，`credential_isolation` 与 `post_hoc_detection` 两种解释文案未测——这几条是凭证隔离的安全相关措辞，值得各钉一个用例。
- **成功副作用**：提交成功后输入框清空 / 对话框关闭（`onSuccess` 回调）未断言。
- **错误渲染**：mutation 失败时 `toApiError` → destructive 文案未测。
- **输出合并与截断**：`mergeConsecutiveOutputEvents` 的连续 RunOutput 合并、以及 `[output truncated]` 标记未测。

### 6.〔可维护性〕fixture 内联手写，随类型演进有多点同步成本

两份文件各自内联手写完整的 `Workspace`/`Issue`/`Run`/`AdapterConfig`。shared 类型一旦变动，需在多处同时更新。建议随第 1 项一起提供带默认值 + 覆盖项的 typed fixture 工厂。

## 四、文档变更（附注，非代码检视范畴）

本次同时新增/改写了 F003 的 design(948 行)/tasks(202 行)/spec 及 F001/F002 收尾更新。这些属规格文档，建议由产品/规格视角另行 review，不在本次代码检视结论内。

另：工作区当前还有两个**未跟踪**的设计文档（`docs/features/0.1/F004-.../design.md`、`F005-.../design.md`）未随本提交纳入，请确认是遗漏 commit 还是有意暂留。

## 五、建议动作清单

| 优先级 | 动作 |
| --- | --- |
| P1 | 抽取共享 mock/`renderWithQuery`/fixture 工厂，消除三处重复与已发生的漂移（发现项 1、6） |
| P2 | 删除 `f001` 未使用的 `ActorType` 导入；考虑开启 `noUnusedLocals`（发现项 2） |
| P2 | `scrollIntoView` 桩移入 `setup.ts` 或加还原（发现项 3） |
| P3 | 补齐护栏/升级文案/错误态/输出合并等分支用例（发现项 5） |
| P3 | 绑定用例复用同一 QueryClient（发现项 4） |
