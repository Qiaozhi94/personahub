# PersonaHub UI Reference

PersonaHub 前端设计参考库，随主仓库统一版本管理，但不属于生产 `web/` 实现。

## 内容

- `clowder/`、`dsh/`、`multica/`：浏览器渲染冻结页、样式真值与交互状态。
- `personahub-draft/personahub-v2.0/`、`personahub-draft/personahub-v2.1/`：可独立评审的 PersonaHub V2 版本化设计稿。
- `personahub-draft/personahub-v3.0/`：V3 首版，历史冻结。
- `personahub-draft/personahub-v3.1/`：**当前设计基线**。在 V3.0 之上恢复任务 tab、把左栏扁平为
  单一可折叠列表，并补齐四个任务态的成果面；设计判断见其 `docs/design.md`，
  验收入口 `node browser-check.mjs`（25 条断言直接对应设计判断）。
  版本索引见 `personahub-draft/VERSIONS.md`。
- `scripts/`：提取、静态化、交互捕获和自动验收脚本。

## 使用

从 PersonaHub 仓库根目录运行：

```bash
node ui-reference/scripts/diff-dom.mjs <project> <page>
node ui-reference/scripts/diff-style.mjs <project> <page>
node ui-reference/scripts/verify-nav.mjs <project>
node ui-reference/scripts/verify-interactions.mjs <project>
```

静态页可直接打开各项目的 `pages/*.html`。运行脚本使用主仓库已经安装的
`playwright` 与 `jsdom` 依赖。

`truth/` 中的 DOM、computed styles、CSS 变量与元数据使用无损 gzip 保存；流水线会
透明读取 `*.gz`。重新提取时也会直接写入压缩格式。已有未压缩真值可运行：

```bash
node ui-reference/scripts/compress-truth.mjs
```

## 第三方许可

- Multica：冻结页和衍生草案必须保留 Multica Logo、产品名、版权署名及
  `multica/LICENSE`、`multica/NOTICE`。
- Clowder AI：许可见 `clowder/LICENSE`。
- DSH：仅保存本地渲染事实；加入新的第三方源码或资产前必须补齐其许可来源。

`node_modules/` 与 `.playwright-mcp/` 是本机依赖或运行缓存，不纳入 Git。
