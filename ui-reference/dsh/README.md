# DeepSeek Harness — 静态页面存档

`http://127.0.0.1:3080`（本地 DeepSeek Harness）的页面级静态复制，位于
`D:\Projects\personahub\ui-reference\dsh`。双击 `pages/index.html` 即可浏览，无需启动原应用、
无需联网。

## 页面

| 文件 | 内容 |
|---|---|
| `index.html` / `home.html` | 新会话空状态（工作区选择 + 创作区 + 模型/权限选择） |
| `conversation.html` | 会话「拉取项目最新代码」— 对话视图 |
| `trajectory.html` | 同一会话的轨迹视图 |
| `settings.html` | 设置弹窗（通用设置） |

## 页面间跳转

- 侧边栏会话行「拉取项目最新代码」→ `conversation.html`；「新会话」/ 顶部 logo → `home.html`
- 会话页头部 **对话 / 轨迹** 标签 → 对应页面
- 侧边栏 **设置** → `settings.html`；设置弹窗的 **关闭** 按钮或遮罩点击 → `home.html`
- Session log 按钮 → `trajectory.html`（存档中最接近日志抽屉的视图）
- 详情抽屉（工具行详情）静止时在画布外，与真实应用一致

## 实现说明

- **真值提取**：`scripts/extract.mjs dsh` — 渲染后 DOM + computed style + 编译后 CSS
  原样保存到 `truth/`（light + dark 两套）；`assets/` 存编译 CSS 与本地化字体。
- **静态化**：`scripts/staticize.mjs dsh` — 只做减法，不重写样式。编译 CSS 以
  data: URI 内联（Chromium 对 file:// 的 `<link rel=stylesheet>` 有 CORS 限制），
  页面可双击打开。
- **交互层**：`assets/replica.js`（通用运行时，来自 `scripts/runtime/`）+
  `assets/replica-dsh.js`（DSH 补充：按文本匹配的会话行/标签跳转）。配置见
  `scripts/config.mjs` 的 `dsh` 项目段（`routes.clickNav`）。
- **验收**：`diff-dom.mjs dsh <page>` 与 `diff-style.mjs dsh <page>` 全部为空；
  `verify-nav.mjs` 回归 8 项跳转检查。重新提取后需重跑 `staticize`（favicon 与
  modulepreload 的本地化已内置于静态化流程，幂等）。

## 未覆盖

- 工作区 / 模型 / 权限下拉、会话搜索、Session log 抽屉（交互弹层未单独采集，
  点击无响应属预期——存档诚实反映未采集状态）
- 设置弹窗的 模型 / 插件 / Agent 预设 标签页（仅采集了默认的通用设置）
- 页面为浅色主题；暗色真值在 `truth/*__dark__desktop/`，需要暗色静态页时可再生成

## 重新生成

```bash
cd D:\Projects\personahub
node ui-reference/scripts/extract.mjs dsh     # 需先启动 :3080
node ui-reference/scripts/staticize.mjs dsh
node ui-reference/scripts/diff-dom.mjs dsh <page>
node ui-reference/scripts/diff-style.mjs dsh <page>
```
