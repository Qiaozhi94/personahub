---
tool: "opencode"
tool_name: "OpenCode"
session_id: "ses_03e8a257dffeb2AweKpCZa4Jyi"
title: "Explore run-dispatch and workflow hook (@explore subagent)"
project: "D:/Projects/personahub"
model: "gpt-5.4-mini-fast"
created_at: "2026-08-02T07:52:34Z"
updated_at: "2026-08-02T07:52:34Z"
tokens_input: 0
tokens_output: 0
cost: 0.0
parent_id: "ses_03ef5d0faffej5Zj3DPo6UYZHA"
---

# Explore run-dispatch and workflow hook (@explore subagent)

## user · 2026-08-02T07:52:34Z

[CONTEXT] I'm implementing Phase 2 of F006 which needs to wire GraphNode into RunDispatchService.workflowHook(), startNextQueuedRun(), and transitionToRunning().

[GOAL] Find the exact code patterns for these three functions so I can add GraphNode branches without breaking existing logic.

[REQUEST] Find and read:
1. server/src/services/run-dispatch.ts — especially workflowHook(), startNextQueuedRun(), transitionToRunning(), and cancel() functions
2. How RunRole is used in dispatch decisions
3. The drainWorkspace / finalizeAndDrain pattern

Return the full function bodies and show where new GraphNode branches should be inserted.
<!-- OMO_INTERNAL_INITIATOR -->
