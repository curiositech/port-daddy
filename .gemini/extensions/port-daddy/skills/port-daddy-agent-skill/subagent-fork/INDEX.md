# Sub-Agent Fork

Patterns for forking sub-agents — when, how, what to hand off, how to re-join. The skill teaches PEER coordination by default; this dir covers the PARENT→CHILD pattern explicitly.

| File | Use when |
|---|---|
| [when-to-fork.md](when-to-fork.md) | Deciding whether to fork at all. Lists the 5 fork patterns and when each pulls weight. |
| [partition-by-symbol.md](partition-by-symbol.md) | About to spawn N sub-agents and need a clean partition. Covers file/symbol/baseline-delta strategies. |
| [handoff-checklist.md](handoff-checklist.md) | Parent's obligations: what state to hand off, what to verify before fork, what NOT to do during the fork. |
| [rejoin-protocol.md](rejoin-protocol.md) | Sub-agent has returned. How to verify, integrate, recover from incomplete forks. |

## Companion persona

`agents/subagent-fork-template.yaml` is the canonical fork persona. Copy it, fill the `task_specific:` block, spawn.

## Companion decision tree

`decisions/should-i-fork-subagent.md` is the full branching tree from "considering forking" to a concrete action.

## Why it's a separate dir

Peer coordination (most of the skill) is symmetric: every agent is the same shape. Fork coordination is asymmetric: parent has obligations the child doesn't, and vice-versa. Separating the patterns prevents the asymmetry from leaking into peer coordination.

## Quick reference

```
Parent thinks "fork" →
  decisions/should-i-fork-subagent.md → YES, pattern X
  → subagent-fork/when-to-fork.md (refine pattern)
  → subagent-fork/partition-by-symbol.md (if parallel-edit)
  → subagent-fork/handoff-checklist.md (prep handoff)
  → spawn from agents/subagent-fork-template.yaml
  → (sub-agent runs)
  → subagent-fork/rejoin-protocol.md (integrate result)
```
