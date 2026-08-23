# PersonaHub UI Reference

PersonaHub 前端设计参考库，随主仓库统一版本管理，但不属于生产 `web/` 实现。

## 内容

- `clowder/`、`dsh/`、`multica/`：浏览器渲染冻结页、样式真值与交互状态。
- `personahub-draft/`、`personahub-v2/`：基于参考材料生成的 PersonaHub 内部设计草案。
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

## 第三方许可

- Multica：冻结页和衍生草案必须保留 Multica Logo、产品名、版权署名及
  `multica/LICENSE`、`multica/NOTICE`。
- Clowder AI：许可见 `clowder/LICENSE`。
- DSH：仅保存本地渲染事实；加入新的第三方源码或资产前必须补齐其许可来源。

`node_modules/` 与 `.playwright-mcp/` 是本机依赖或运行缓存，不纳入 Git。
