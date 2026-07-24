# Decision Trees

Branching from a vague situation to the right next move. Tables answer "what does X mean"; trees answer "given my current state, what do I do."

| Tree | Use when |
|---|---|
| [something-broke.md](something-broke.md) | A symptom of failure, before you start fixing. Catches the phantom bugs (stale state, ABI drift, walked-into-rebase). |
| [before-publish.md](before-publish.md) | About to commit / push / deploy. Every gate in order, including stale-base detection and surface-specific extras. |
| [who-do-i-message.md](who-do-i-message.md) | You have a fact, blocker, or escalation. Picks the right durable surface (actor / channel / note / tuple / pheromone). |
| [should-i-fork-subagent.md](should-i-fork-subagent.md) | Considering delegating to a sub-agent. Picks the fork pattern, or skips it. |
| [skip-coordination-when.md](skip-coordination-when.md) | Tempted to skip `pd briefing`/`pd begin`/claims. Lists the genuine exceptions (small) and look-alikes that still require ceremony. |
| [guard-or-shim-refused-me.md](guard-or-shim-refused-me.md) | The Coordination Guard blocked your commit, or the pd-shim refused a destructive verb. Fix the guard INPUT or escalate — there is no agent-mintable bypass (ADR-0102). |

These trees are intentionally opinionated. They reflect the real decision points seen in this repo, not theoretical maximums.

## How to use

1. Read the tree from the top.
2. At each branch, answer based on observable state, not memory or assumption.
3. The trees DO route back to other trees (e.g., `something-broke.md` references `before-publish.md` for "what's safe to push"). Follow the redirects.
4. If you reach a leaf and the situation still doesn't fit, that's a signal the tree needs an entry — file a `pd note` with the gap and a suggested addition.

## Related

- `references/` — deeper context, reference material loaded on demand.
- `examples/` — concrete walkthroughs of past situations.
- `subagent-fork/` — when a tree resolves to "fork," the patterns live here.
