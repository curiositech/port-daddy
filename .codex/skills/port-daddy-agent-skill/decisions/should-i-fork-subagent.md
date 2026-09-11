---
title: "Decision tree: should I fork a sub-agent?"
purpose: "Decide whether to delegate to a sub-agent or do the work yourself, and what kind of sub-agent fits."
last_verified: 2026-04-30
---

# Should I Fork a Sub-Agent?

Forking is not free. Each sub-agent costs context, coordination, and review effort. Use this tree to decide.

```
START: I'm considering forking work to a sub-agent
│
├─ Can I do the task myself in <5 minutes?
│   → just do it. Forking has fixed overhead.
│
├─ Is the task PURELY READ / EXPLORATION / RESEARCH?
│   ├─ YES + scope spans many files / unknown locations
│   │       → fork an Explore-style sub-agent (read-only, returns structured findings).
│   │         Saves your context window from full file reads.
│   ├─ YES + scope is one or two known files
│   │       → just read them yourself. Faster, no handoff.
│   └─ NO  → continue.
│
├─ Is the task PARALLELIZABLE across files or symbols?
│   ├─ YES + files don't share symbols / state
│   │       → fork N sub-agents, partition by file or symbol-range.
│   │         Use claim regions so they don't collide.
│   │         See subagent-fork/partition-by-symbol.md.
│   ├─ YES + files DO share symbols
│   │       → don't fork. Sequential edit by you, OR delegate to one sub-agent
│   │         with full context. Parallel = guaranteed merge conflict.
│   └─ NO  → continue.
│
├─ Is the task a DOMAIN that has a specialized sub-agent type?
│   (code-reviewer, debugger, ui-ux-designer, ml-production-engineer, etc.)
│   ├─ YES + your task matches the description
│   │       → fork that specialized sub-agent.
│   │         Their training is sharper than yours on that surface.
│   └─ NO  → continue with general-purpose.
│
├─ Will the sub-agent need WRITE access to files I'm currently editing?
│   ├─ YES → they need claims handed off properly. See handoff-checklist.md.
│   └─ NO  → easier; read-only fork.
│
├─ Is this a LONG-RUNNING task (>5 min) that I can do work alongside?
│   ├─ YES → fork in BACKGROUND mode, continue your own work, rejoin later.
│   └─ NO  → foreground; wait for result.
│
├─ Am I about to write the SAME prompt for the 3rd time this session?
│   → that's a sign the task should be a sub-agent type or even a script,
│     not a re-invoked prompt. Consider promoting it.
│
└─ Special: am I forking to AVOID coordinating?
    → red flag. Sub-agents inherit coordination obligations.
      They MUST run pd briefing themselves. Forking doesn't bypass guard rules.
      If you're forking because YOU don't want to coordinate, fix that first.
```

## When NOT to fork

- Trivial edits (1-3 file touches, well-scoped)
- Tasks where the sub-agent would need 80% of your context (just do it yourself)
- Coordination work itself — pd notes, claims, messages — these are fast and serial
- Anything inside a transaction (mid-rebase, mid-merge, mid-promotion lock)
- When the user asked YOU specifically — don't dilute their feedback signal

## Fork patterns

| Pattern | Use when | Returns |
|---|---|---|
| **Research fork** | Scope spans unknown files | Summary, citations, no edits |
| **Parallel-edit fork** | N independent files, partitionable | N sets of edits, you merge order |
| **Specialist fork** | Task matches an agent type's domain | Domain-quality output |
| **Background fork** | Long task, you can work in parallel | Async result, rejoin later |
| **Verification fork** | Need a second opinion on your work | Independent assessment |

## Coordination obligations a forked sub-agent inherits

Every sub-agent MUST:

1. Run `pd briefing` and `pd sessions --all-worktrees` before any work.
2. Have its own `pd begin` session with inherited roadmap rent if it edits files
   (or be passed an explicit `--session`).
3. Claim the files it intends to touch.
4. Drop a scope note before mutation.
5. Drop a result note before returning.

If your fork prompt doesn't pass these obligations forward, you've created a coordination hole.

See: subagent-fork/handoff-checklist.md, subagent-fork/rejoin-protocol.md.
