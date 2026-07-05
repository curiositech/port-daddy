# Compliance Ladder And Transcript Fidelity Ladder

Use this when you need the canonical level definitions to compare a doc, schema, UI, or probe surface against, or when you need to know which ladder a claim actually belongs to (compliance vs. transcript fidelity are two different things, frequently conflated).

## Why two ladders, not one

The product grades an agent backend on two independent axes:

- **Compliance ladder (C0-C6)** — how much the daemon can actually *govern* the body: preflight tools, deliver interrupts, inject suggestions, cooperate on claims.
- **Transcript fidelity ladder (T0-T5)** — how much daemon-verifiable *evidence* exists about what the body did: from "nothing" to a hash-chained, resumable transcript.

A body can be highly governed with a thin transcript (rare, and a red flag), or richly transcripted with no governance (an "observed" import — see contradiction #7 below). Conflating the two ladders is itself a drift bug: a claim like "C4" means nothing if you can't say which ladder it's on.

## Canonical compliance ladder (C0-C6)

Source: `docs/architecture/agent-harbor-technical-binder/work-packets/official-agent-control-plane-synthesis.md`, "Compliance Ladder Freeze."

| id | order | name | required predicates (representative) |
| --- | --- | --- | --- |
| C0 | 0 | Registered | Agent Node/body/session identity exists; no transcript or governance implied. |
| C1 | 1 | Transcripted | T4 verified transcript is active or replayable. |
| C2 | 2 | Governed | Tool preflight, denials, approvals, destructive-action gates are daemon-witnessed. |
| C3 | 3 | Suggestible | Skills, memory, inbox, repo updates, parley suggestions injectable with visible provenance. |
| C4 | 4 | Controllable | Steer/interrupt/pause/kill/checkpoint individually probed and truthfully rendered. |
| C5 | 5 | Cooperative | Claims, worktree/sandbox, tube/parley, file heat, conflict signals active. |
| C6 | 6 | Resumable | T5 continuation packet can launch a successor after daemon restart with explicit missing-state limits. |

## Canonical transcript fidelity ladder (T0-T5)

Same source, "Transcript Fidelity Ladder."

| id | order | name | required predicates (representative) |
| --- | --- | --- | --- |
| T0 | 0 | Inventory only | Agent/session exists, no transcript. |
| T1 | 1 | Run log | Structured steps/status, no visible conversation. |
| T2 | 2 | Visible chat | Operator and assistant messages, weak tool proof. |
| T3 | 3 | Tool-backed transcript | Chat, tool calls/results, shell, stdout/stderr refs, file touches, approvals/denials, costs. |
| T4 | 4 | Verified transcript | T3 plus Agent Node/body/session/worktree joins, sequence, hash chain, redaction, retention policy, replay, JSONL archive. |
| T5 | 5 | Resumable transcript | T4 plus checkpoints, compaction packets, memory/source citations, claims, active commitments, successor metadata, rollback point. |

Rule: **T4 is the floor for official C1 (Transcripted) status.** No transcript means no official agent, regardless of what any surface claims.

## Contradiction #1: names disagree across docs

The red-team review (`work-packets/redteam-agent-harbor-control-plane.md`, "Contradictions To Resolve Before F0 Freezes," item 1) found two binder documents defining C3 differently:

- `03-agent-contract-and-extension-api.md`: C3 = **Suggestible**
- `official-port-daddy-agent-compliance-plan.md`: C3 = **Controllable** (with Controllable actually meaning what the other doc calls C4)

This is not cosmetic — the UI, docs, compliance probe, doctor output, receipt, and site copy will lie to each other if C3 means two different things depending on which surface rendered it. This is exactly what `ladder-name-order-drift` exists to catch: it diffs id, order, name, *and* `requiredPredicates` for every level across every declared surface, not just the id.

**Until F0 freezes one ladder, prefer capability predicates in UI copy** (`transcripted`, `governed`, `controllable`, `resumable`, `cooperative`) over numeric C badges — a predicate can't silently mean two things the way a bare number can.

## Where a ladder gets declared (the four surfaces)

A ladder is not "frozen" just because one file says so. It has to agree across:

1. **doc** — narrative prose (binder chapters, the compliance plan, ADRs).
2. **schema** — the JSON/type schema code actually validates against.
3. **ui** — what pd-console, FleetBar, or the dashboard renders as the badge/label.
4. **probe** — what `pd spawn --probe` / `pd agent compliance probe` actually measures and returns.

`incomplete-surface-coverage` fires when a ladder has zero declaration in one of these four forms — not a drift bug yet, but a freeze that hasn't actually rolled out everywhere it needs to.
