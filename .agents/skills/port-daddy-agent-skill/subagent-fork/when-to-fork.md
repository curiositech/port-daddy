---
title: "When to fork a sub-agent"
purpose: "Match a task's shape to the right fork pattern, or recognize when not to fork at all."
---

# When To Fork

Forking has fixed overhead: prompt construction, model context warm-up, coordination handoff, result rehydration. For small tasks the overhead exceeds the benefit.

## The fork patterns

### Research / Explore fork

**Symptoms:** "I need to find every place X is referenced, or how Y was implemented across the codebase, before I can plan."

**Pattern:**
- Sub-agent reads, never writes.
- Sub-agent returns structured findings (a list, a citation map, a summary).
- Parent rehydrates findings into its own context.

**Use the `Explore` subagent type** if available, or general-purpose with explicit `read-only` constraints.

**Cost:** saves your context window from full file reads. Good ROI when scope is unknown.

**Anti-pattern:** forking research when you already know the answer is in 1-2 known files. Just read them yourself.

### Parallel-edit fork

**Symptoms:** "I have N independent files / N independent symbols to change with the same pattern."

**Pattern:**
- Partition by FILE or SYMBOL — never by "phase" or "concern."
- Each fork claims its partition before editing.
- Forks complete in parallel; parent merges in deterministic order.

**Critical rule:** Files cannot share symbols or transitive dependencies, or you'll get merge conflicts. See `partition-by-symbol.md`.

**Cost:** wall-clock time saved if N is large. Coordination cost if partitions are messy.

**Anti-pattern:** forking 3 sub-agents to "each touch a different aspect" of the same file. That's a guaranteed conflict.

### Specialist fork

**Symptoms:** "This task lands squarely in a specialized domain (UI/UX, ML, security, debugging)."

**Pattern:**
- Use the matching subagent type (`code-reviewer`, `debugger`, `ui-ux-designer`, `ml-production-engineer`, etc.).
- Their training is sharper than general-purpose for their domain.
- Pass them the task + relevant context, get back domain-quality output.

**Cost:** model invocation. Worth it when the task is non-trivial and domain matters.

**Anti-pattern:** spawning a specialist for a task that's actually general (e.g., spawning `ui-ux-designer` to add a button — that's a code edit, not a design problem).

### Background fork

**Symptoms:** "This will take 5+ minutes, and I have other unrelated work I can do meanwhile."

**Pattern:**
- Launch with a receipt-backed Port Daddy surface and detach the observer; for
  raw spawn this is `pd spawn "<task>" --backend <id> --identity <id>
  --budget <usd> --detach`.
- Continue your own foreground work on independent surfaces.
- Rejoin from the durable receipt/event when notified. Do not tight-poll.

**Cost:** loss of immediate result. Risk of context drift if background result invalidates your foreground work.

**Anti-pattern:** backgrounding a task whose result blocks your next step. That's just hiding latency from yourself.

### Verification fork

**Symptoms:** "I've done the work, but I want a second opinion before publishing."

**Pattern:**
- Spawn a code-reviewer or auditor agent with NO context from your decision.
- They re-derive an opinion from the diff and the task description.
- If they agree, you ship; if they disagree, the disagreement is the new question.

**Cost:** double-spending model invocation. Worth it for high-stakes changes.

**Anti-pattern:** "verification" forks that you've pre-conditioned with your conclusion. If the prompt says "verify that X is correct," you've biased the outcome. Frame as "is there any reason X is wrong?"

## When NOT to fork (the don't list)

| Don't | Reason |
|---|---|
| Trivial edits (1-3 file touches) | Fork overhead > task |
| Mid-transaction (rebase, merge, lock) | Forks inherit broken state |
| The user asked YOU specifically | Dilutes their feedback signal |
| You're forking to avoid coordination | Forks inherit coordination |
| The task needs 80% of your context | Just do it yourself |
| Research scope is 1-2 known files | Just read them |
| You'd write the same prompt for the 3rd time | Promote it to a skill or persona, not yet-another-fork |

## How to decide quickly

Ask: "What does the sub-agent know that I don't, or what can it do that I can't?"

- Specialized training (specialist fork)
- Fresh context not yet polluted (verification fork)
- Read bandwidth across many files (research fork)
- Wall-clock parallelism (parallel-edit fork)
- Async patience (background fork)

If you can't answer that question with one of those, the fork won't pull weight.

## Related

- `decisions/should-i-fork-subagent.md` — full decision tree.
- `partition-by-symbol.md` — how to partition for parallel edits.
- `handoff-checklist.md` — what the parent must hand off.
- `rejoin-protocol.md` — how to re-integrate sub-agent results.
- `agents/INDEX.md` — supported receipt-backed helper launch surfaces.
