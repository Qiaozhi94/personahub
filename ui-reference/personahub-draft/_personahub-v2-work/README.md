# PersonaHub V2 设计草案

本目录用静态 HTML 表达“项目优先”的 PersonaHub 工作台，并沿用上一版前端设计稿的视觉语言与主会话结构。

## 打开方式

双击 `index.html` 即可浏览，无需安装依赖或启动服务。

## 页面

- `index.html`：项目文档预览 + 进行中的 Room。
- `code.html`：代码文件预览 + 同一 Room 上下文。
- `task.html`：任务说明 + 等待指派的 Room。
- `artifact.html`：交付物预览 + 已完成的 Room。

## 布局

```text
全局导航 | 项目资源管理器 | 主预览（1fr） | Room（1fr）
```

项目资源管理器可在资源、工作、产出、知识之间切换；目录项和页内按钮可跳转到对应静态页面。主预览和 Room 等宽，强调“项目对象是主体，协作是并列工作面”。

## 设计与来源

- `docs/design.md`：页面结构、对象关系和交互原则。
- `build.mjs`：从冻结的旧设计稿生成当前页面。
- `SOURCE-DRAFT-README.md`：旧设计稿的冻结说明。
- `LICENSE.multica`、`NOTICE.multica`：视觉参考来源的许可与声明。

本目录是内部设计参考，不是生产实现。
