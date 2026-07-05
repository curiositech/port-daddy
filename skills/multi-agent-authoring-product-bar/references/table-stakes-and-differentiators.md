# Table Stakes And Differentiators

Use this when rating a multi-agent authoring product's axes or deciding whether a claimed differentiator is real or Potemkin.

## The Two-Bar Model

A multi-agent authoring tool does not win by being a worse single-agent clone with a swarm button bolted on. It wins by clearing two separate bars:

1. **MATCH** — table stakes. The single-agent inner loop (the thing used in 95% of turns) must be at par with the incumbent the makers already trust: Claude Code, Codex, or whatever they'd otherwise reach for. This is a gate, not a score to average in — one below-par axis sinks the whole audit, because a user who bounces off a slow or clunky loop never sticks around to see the swarm feature.
2. **EXCEED** — differentiators. The coordination/visibility/recovery control plane that incumbents don't expose at all: worktree isolation with advisory claims, a live swarm board with ownership and merge points, durable transcripts with salvage of dead agents, artifact-backed receipts, and spend/budget visibility. These are the actual reason to switch.

Harbor's own stated aim — "beat Zed" — is instructive precisely because it names a *single-agent* editor as the bar, not another multi-agent tool. If Harbor's read/edit loop isn't at least as good as Zed's before multi-agent features land on top, the multi-agent story is premature. As of the last cartographer pass, Harbor has the P0 read-only surface and a Layer B daemon symbol graph, but P1 (Loro CRDT buffer) and P2–P5 (the differentiating claims/salvage layer) are unbuilt — that is a textbook table-stakes gap: don't grade the differentiators yet.

## Table-Stakes Axes And The Par Rubric

| Axis | below-par | par | above-par |
| --- | --- | --- | --- |
| `singleAgentLoop` | Plan/diff/review steps are missing, hidden, or require leaving the tool (e.g. reading a raw JSONL transcript to see what changed). | Prompt → plan → diff → review matches the incumbent's shape: visible intent, inline diff, accept/reject. | Fewer clicks or keystrokes than the incumbent to go from prompt to reviewed diff; context surfaces itself. |
| `latency` | Time-to-first-token or time-to-plan is noticeably slower than the incumbent on the same task; users narrate waiting. | Comparable p50/p95 turn latency; the delay doesn't change how the user works. | Faster due to real architecture wins (local model routing, warm daemon, incremental symbol index) — not benchmarked once and never re-measured. |
| `contextAttach` | User must manually copy-paste terminal output, file contents, or error text into the prompt. | Selected code, open file, or terminal block attaches with one action, matching the incumbent. | Failed test, PR thread, or screenshot becomes agent input automatically, with no manual step. |
| `recoverableEdits` | Undo means `git diff` archaeology or hoping `git reflog` still has it. | Checkpoint/revert exists and matches the incumbent's granularity (per-turn or per-file). | Named snapshots, per-agent worktree isolation, and one-click revert to any checkpoint, verified — not just asserted. |

**Rating discipline:** rate against the incumbent the makers *actually use today* for real work, not a hypothetical worst-case tool. If nobody on the team has used Claude Code or Codex for the equivalent task recently, the rating is a guess — say so in `findings`, don't silently round up to `par`.

## Differentiator Axes And What "Real" Means

Each differentiator only counts if it clears three independent checks: `present` (shipped, not roadmapped), `hasRealBehavior` (a real state machine backs it, not a UI affordance with no wiring), and `leavesReceipt` (it produces a durable, inspectable artifact after the fact). Missing any one makes it Potemkin.

| Axis | Present but Potemkin looks like... | Real looks like... | Port Daddy anchor |
| --- | --- | --- | --- |
| `isolationClaims` | A "new worktree" button that creates a git worktree but two agents can still edit the same file with no warning. | Per-file/symbol advisory claims announced before edits, worktree-per-writer by default, a visible conflict when two agents target the same surface. | `pd session files add <path>`, `coordination_preflight`, `.claude/worktrees/*`. |
| `swarmVisibility` | Agent names appear in a list with a spinner; no ownership, no merge point. | A live board showing role, files claimed, current step, and who owns the merge — matching the sequence in `swarm-invocation-designer`'s Core Model. | FleetBar / Fleet Control Center, `pd sessions --all-worktrees`, `swarm_awareness`. |
| `transcriptsSalvage` | "View logs" opens an ephemeral terminal buffer that's gone when the pane closes. | Durable, replayable transcripts per session plus a `salvage` path that recovers a dead agent's partial work instead of losing it. | `pd salvage --project <project>`, `check_salvage`, `pd catch-me-up`. |
| `receipts` | A commit message or PR description written by the agent, asserting "tests pass." | A structured, artifact-backed record (see `agent-work-receipt-designer`) with real exit codes, not self-reported claims. | `.port-daddy/receipts/`, the `work-receipt.schema.json` shape. |
| `spendVisibility` | A token counter that updates but has no budget, no cap, no alert. | Live cost/turn meter tied to a budget, with a stop condition enforced before overrun, and a durable spend record per session. | Cost-accrual and spend fields in a receipt's `spend` block. |

## Sequencing Rule

Earn table-stakes parity first. Every hour spent polishing a differentiator while a table-stakes axis is `below-par` is an hour the team could have spent making the loop people actually live in not worse than the thing they already trust. Once parity holds, ship differentiators one at a time, each with real behavior and a receipt, rather than five buttons that all point at nothing.
