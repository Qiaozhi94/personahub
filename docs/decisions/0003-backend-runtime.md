---
topics: [decision, tech-stack, backend]
doc_kind: decision
status: accepted
created: 2026-07-12
---

# 0003: 本地 API 后端运行时选择 Node.js + TypeScript

## 背景

`docs/decisions/0001-frontend-stack.md` 定了前端 Vite + React + "本地 API"，但"本地 API"用什么语言/运行时实现一直是 TBD（`CLAUDE.md` Backend 项）。整体软件架构设计（`docs/personahub-architecture.md`）需要先确定这一项，才能落地进程模型、agent adapter 子进程管理、SQLite 访问方式和事件流实现。

## 决策

本地 API 后端采用 Node.js + TypeScript。

## 理由

- 与前端 Vite + React 同语言、共享类型定义（例如 ThreadEvent、Issue 等实体类型可在 frontend/backend 间直接复用），减少个人开发的上下文切换成本。
- Node.js 的 `child_process` 管理本地 CLI 子进程（P0 是 Codex CLI）、SSE/WebSocket 事件推送、`better-sqlite3` 访问本地 SQLite，都是生态成熟、文档充分的路径，适合 P0 阶段快速迭代。
- 不影响后续 v0.7 daemon 化或打包成 Tauri/Electron 桌面应用的方向（`0001` 决策已提到）：Node 进程可以作为 Tauri 的 sidecar 进程继续存在，也可以被 systemd/Windows Service 一类的 supervisor 接管，无需替换实现语言。
- 排除 Python：会引入前后端类型不共享的第二语言，且子进程管理、打包分发相对 Node 更繁琐，个人项目早期不需要 Python 生态里 AI/Agent 专属库带来的优势。
- 排除 Rust：与未来 Tauri 打包方向最贴合，性能和二进制分发也最优，但 v0.1 阶段开发速度慢、生态不如 Node 成熟，个人项目早期迭代不友好，留作 v0.7 daemon 化如有需要时的重写候选，而非现在的默认选择。

## 影响

- `CLAUDE.md` 技术栈 Backend 项由 TBD 更新为 Node.js + TypeScript。
- `docs/personahub-architecture.md` 的进程模型、agent adapter 抽象、存储层设计均以此为前提展开。
