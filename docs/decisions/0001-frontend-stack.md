---
topics: [decision, tech-stack]
doc_kind: decision
status: accepted
created: 2026-07-12
---

# 0001: 第一版默认技术栈选择 Vite + React + 本地 API

## 背景

PersonaHub PRD 第 14 节曾把"第一版默认技术栈选择 Next.js 还是 Vite + React + 本地 API"列为阻塞项：不拍板，v0.1.0 无法真正开始排期。

## 决策

第一版采用 Vite + React + 本地 API，不采用 Next.js。

## 理由

PersonaHub 第一阶段是本地优先工作台，不是 Web SaaS。Vite + React 更轻，更适合后续接 Tauri / Electron、本地 runner、SQLite、本地文件系统和长连接事件流。Next.js 的 SSR、部署和服务端路由能力目前不是 P0 核心价值，反而容易增加早期复杂度。

## 影响

- `CLAUDE.md` 技术栈 Frontend 项由 TBD 更新为 Vite + React + 本地 API。
- 后续 local runner、事件流、SQLite 访问等实现应围绕这一选型展开。
