---
topics: [decision, tech-stack, ui, styling]
doc_kind: decision
status: accepted
created: 2026-07-12
---

# 0004: 前端样式/组件技术栈参考 multica

## 背景

决策 0001 定了前端用 Vite + React，但组件库、样式方案、视觉 token 一直没有拍板。用户希望 PersonaHub 的视觉效果"简约高效"，参考对象是本机开源项目 multica（`D:\Projects\multica`）。调研 multica 前端实际依赖（`apps/web/package.json`、`packages/ui/styles/tokens.css`）后确认其"简约高效"观感来自一套具体、可复用的组合，而不是笼统的风格描述。

## 决策

PersonaHub 前端采用以下组合（在 multica 的基础上，针对"减少实现阶段返工"和"未来多端"两个诉求做了两处明确调整，不是逐项照抄）：

- **Tailwind CSS v4**：CSS-first 配置（不用单独 `tailwind.config.js`），做 utility 样式。
- **shadcn/ui CLI 生成组件代码，底层交互原语用 Radix，不用 Base UI**：不手写 Base UI 封装（那是 multica 因为要给 web/desktop/mobile 三端共享组件才做的投入，PersonaHub v0.1 只有一个前端应用，没有对应收益）；底层选 Radix 而不是 multica 用的 Base UI，因为 shadcn/ui 生态里 Radix 的集成最成熟稳定，Base UI 支持还在发展中——目标是"效果像 multica"，不是"依赖跟 multica 一样的库"，视觉效果由 Tailwind + token 层保证，跟选哪个底层原语库无关。组件代码直接生成到当前前端项目的 `src/components/ui/`，不建独立的 `@personahub/ui` monorepo 包。
- **class-variance-authority + clsx + tailwind-merge**：组件变体（variant）样式的标准写法。
- **lucide-react**：图标库。
- **主题切换**（对应 multica 的 `next-themes`）：Vite + React 项目可用等价的轻量方案（例如手写 `data-theme` 属性 + CSS variable，不需要 Next.js 专用库）。
- **OKLCH 语义化 design token**：参照 multica `packages/ui/styles/tokens.css` 的结构（`background`/`foreground`/`card`/`popover`/`primary`/`secondary`/`muted`/`accent`/`destructive`/`border`/`input`/`ring`/`sidebar-*`/`chart-1..5`，配 `--radius` 基准值推导出各级圆角），light/dark 两套变量，品牌色相换成 PersonaHub 自己的颜色。
- **业务逻辑与 UI 组件目录分离**：`src/lib`（API client）、`src/hooks`（数据获取/状态逻辑）、`src/types`（领域类型）与 `src/components` 分开存放，组件文件不直接内嵌 API 调用。这是为未来多端（尤其是 v0.8 方向性设想里的 mobile/remote access）预留的低成本保险，详见"理由"一节的分析。

## 理由

- 用户明确要求"简约高效，效果接近 multica"，而这套组合正是 multica 视觉效果的直接来源，不是抽象模仿。
- 这套技术组合（Tailwind + shadcn/ui 生态）目前是全球最主流的 React UI 方案（2026 年 3 月 shadcn/ui GitHub star 超 11.5 万，是 2024 年 JavaScript Rising Stars 报告 #1 项目），且是 v0.dev、Cursor、Claude Code 等 AI 编码工具默认生成的风格——PersonaHub 本身是 AI 辅助编码项目，顺着这个默认路径阻力最小。
- 认知度在中文开发者社区不如 Ant Design/Arco Design/TDesign，但这是"资料多寡"问题，不是技术选型本身的问题；用户确认接受这个取舍。
- 不采用 Ant Design 等国内主流企业级组件库：默认视觉风格偏"中后台密度高"，要做出 multica 那种大量留白、极简边框的效果需要较重的主题改造，性价比不如直接用已经是这个风格的技术栈。
- **关于未来多端支持是否需要现在就建共享组件包**：分析后判断不需要。桌面端（Tauri/Electron）打包的是同一份 Web 前端构建产物，不需要重写或共享 UI 组件，现在的单应用结构对它没有额外成本。真正的原生移动端（React Native 之类）无法运行任何基于 DOM 的组件库（shadcn/ui、Radix、Base UI 都不行，multica 自己的 `apps/mobile` 也有独立的 `tailwind.config.js`，证明它的移动端组件本来就是分开做的），所以就算现在搭一个共享 UI 包，等真做原生移动端时组件还是要重写，现在的投入换不来那份"保险"。真正会在多端场景下产生改造成本的是业务逻辑和 UI 代码有没有分离——这个分离现在做几乎零成本，因此单独定为一条约定，而不是去建共享组件包。

## 影响

- `CLAUDE.md` 技术栈 Frontend 项补充样式技术栈说明，指向本决策。
- 具体 token 取值（颜色、圆角等）记录在 F001 `design.md`"UI 设计说明"一节；不逐字复制 multica 的 `tokens.css`，中性灰阶结构保留，品牌色相（brand hue）改用 PersonaHub 自己的颜色，形成独立视觉身份，同时也避免逐字复制 multica 源码文件本身（multica 的 Modified Apache 2.0 许可对其前端有版权信息保留等要求，改值重建比逐字复制更干净）。
- 组件库结构和底层原语库已经确定（shadcn/ui CLI + Radix，无独立 package），不再是待实现阶段决定的开放问题。
- 业务逻辑/UI 分离的目录约定同步写入 `docs/personahub-architecture.md` 第 8 节"前端"，作为项目级、不随 feature 变化的架构约束，并在 F001 `design.md` 中落地为具体目录结构。
