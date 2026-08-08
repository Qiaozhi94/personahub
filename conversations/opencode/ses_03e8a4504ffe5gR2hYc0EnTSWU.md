---
tool: "opencode"
tool_name: "OpenCode"
session_id: "ses_03e8a4504ffe5gR2hYc0EnTSWU"
title: "Explore adapter resolution patterns (@explore subagent)"
project: "D:/Projects/personahub"
model: "minimax-m2.7"
created_at: "2026-08-02T07:52:26Z"
updated_at: "2026-08-02T07:52:32Z"
tokens_input: 0
tokens_output: 0
cost: 0.0
parent_id: "ses_03ef5d0faffej5Zj3DPo6UYZHA"
---

# Explore adapter resolution patterns (@explore subagent)

## user · 2026-08-02T07:52:26Z

[CONTEXT] I'm implementing Phase 2 of F006 which needs resolveEligibleAdapter() — a new shared primitive combining resolveAdapter() + hasCapability(). I need to understand the existing adapter resolution pipeline.

[GOAL] Find the exact signatures and implementation patterns for resolveAdapter(), hasCapability(), and any related adapter resolution logic.

[REQUEST] Find and read:
1. server/src/services/adapter-resolver.ts — resolveAdapter() function signature and implementation
2. server/src/repositories/agent-config.ts — hasCapability() function and hasRuns()
3. shared/src/types/adapter.ts — AgentCapability enum
4. How RunDispatchSource is used in the resolution pipeline

Return the full function signatures, parameter types, and return types so I can build resolveEligibleAdapter() correctly.
<!-- OMO_INTERNAL_INITIATOR -->
