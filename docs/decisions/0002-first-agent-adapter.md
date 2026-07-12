---
topics: [decision, tech-stack, agent-adapter]
doc_kind: decision
status: accepted
created: 2026-07-12
---

# 0002: P0 首个 agent adapter 选择 Codex CLI

## 背景

PersonaHub PRD 第 14 节曾把"P0 首个 agent adapter 先做 Codex CLI、Claude Code 还是 OpenCode"列为阻塞项：不拍板，v0.1.0 无法真正开始排期。

## 决策

P0 首个接入的本地 coding CLI adapter 是 Codex CLI。Coding agent adapter registry 预留 Claude Code、OpenCode 等多 adapter 扩展点，但 P0 不要求同时支持三个。

## 理由

当前 PersonaHub 的产品打磨和真实使用场景就发生在 Codex 工作流中，dogfooding 反馈回路最短。P0 最重要的不是同时适配多个 agent，而是验证 PersonaHub 能否管住一个真实 agent 的执行、事件、证据和验证闭环。

## 影响

- `docs/personahub-prd.md` 第 8 节 P0 功能列表中 "Coding agent adapter registry" 一项已更新为直接指向本决策。
- `CLAUDE.md` 技术栈 Agent adapters 项由"待定/三选一"更新为"P0 = Codex CLI，其余为后续扩展"。
