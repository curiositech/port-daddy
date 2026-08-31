# Roadmap Legibility Mechanics

Use this when you need the exact link-or-opt-out mechanic, how it maps to a
CI gate, and why "legible" means evidence-backed, not merely tracked.

## The single source of truth

A product roadmap earns the name "canonical" only if there is exactly one of
it. Port Daddy's V4 unified roadmap lives as phased, slugged items behind a
daemon (`/roadmap/items`), mirrored into a committed snapshot
(`docs/roadmap/roadmap.snapshot.json`) because CI runners can't reach the
local daemon's SQLite. The daemon is the only writer; the snapshot is a read
replica. Everything downstream — the CI gate, `pd roadmap` commands, this
skill's audit — reads that one mirror. The moment a second "roadmap" appears
(a stale Notion doc, a parallel markdown file, a forgotten GitHub Projects
board), two things become simultaneously true and irreconcilable, and nobody
can say which is current. `auditRoadmapLegibility` treats `canonicalRoadmaps
!== 1` as a critical finding for exactly this reason — not pedantry, but
because "linked" becomes meaningless once "to what" has two answers.

## Link-or-opt-out, not gate-or-block

The mechanic is not "every change must be pre-planned." It is: **every
change must declare its relationship to the plan, honestly, in one line.**
Two trailers, mutually exclusive:

```
Roadmap-Item: <slug>             # this PR advances a live roadmap item
Roadmap-Item: none — <reason>    # explicit, honest opt-out
```

`lib/roadmap-link-core.ts::classify()` is the real decision function this
skill's model is built on. Its verdict ladder, in order:

| Situation | Verdict | Loud? | Human approval? |
| --- | --- | --- | --- |
| Snapshot missing/empty | `broken` | yes | yes |
| `Roadmap-Item: none — reason` given | `pass` (unless snapshot stale) | no | no |
| No trailer at all | `needs-approval` | no | yes |
| Trailer present, slug unknown | `needs-approval` (or `broken` if snapshot stale too) | conditional | yes |
| Trailer present, slug known | `pass` (unless snapshot stale) | no | no |

Two failure shapes are structurally different and must be told apart:

- **Author-fixable**: no trailer, or a typo'd slug. The author adds one line
  and re-pushes. Cheap, fast, no drama.
- **System-broken**: the snapshot itself is missing, empty, or stale beyond
  `staleAfterDays` (21 by default in the real gate). This is a `loud`
  finding — a silent "all clear" here would be worse than a false block,
  because it means the mirror can no longer prove anything.

`auditRoadmapLegibility` collapses both failure classes into the `pass`
boolean's `critical` bucket for a *state* snapshot, but keep them separate in
your own remediation: fix the roadmap plumbing before chasing individual
missing links.

## Spawn-capture: work generates more work

A planning document — an ADR, a `PLAN.md`, a `docs/*-roadmap.md` proposal —
exists specifically to create downstream work. The real gate detects this
by **file path**, never by reading prose for keywords (`isPlanningDoc()` in
`lib/roadmap-link-core.ts` matches `docs/adr/NNN-*.md`, top-level
`PLAN.md`/`ROADMAP.md`, and `docs/*proposal|rfc*.md` — structured signals,
not a keyword list). When a PR touches one of those, it must also carry:

```
Roadmap-Spawns: slug-a, slug-b, slug-c
Roadmap-Spawns: none — <reason>    # e.g. supersedes-only, no new work
```

This skill generalizes the same idea to sidequests: any burst-energy unit of
work that surfaces N new, durable follow-on tasks must fold at least those N
back into the roadmap (as items, or as explicit opt-outs) — not zero, not
"I'll remember." `spawnedItems > 0 && spawnedItemsCaptured === 0` is the
`spawn-not-captured` finding (high severity); a partial capture is `medium`.
The number that matters is the gap, not the existence of any capture at all —
capturing 1 of 4 spawned items is still leaking 3.

## Evidence over optimism

`status-without-evidence` is the single most critical check in the
audit, mirroring the `agent-work-receipt-designer` skill's stance that a
`passed: true` claim with no exit code is not proof. A work unit reporting
`in-progress`, `done`, `shipped`, or `merged` with an empty
`progressEvidence[]` is status theater — it says something happened without
attaching anything a skeptic could check. Evidence means:

- `commit:<sha>` — a real, resolvable commit.
- `pr:<number>` — a real pull request, ideally itself carrying a
  `Roadmap-Item:` trailer that closes the loop.
- `receipt:<id>` — a work receipt from `agent-work-receipt-designer`, which
  in turn should be artifact-backed at the test level.

`todo`/`planned`/`backlog`/`parked`/`blocked` are exempt from this check —
nothing has happened yet, so there is nothing to prove. The moment a unit's
status crosses into "something happened," the audit expects a receipt for
that claim.

## Staleness cuts both ways

The real gate treats a >21-day-old snapshot as broken even for a perfectly
linked PR (`snapshot-stale` verdict) — a valid link against stale data is not
actually verified, it just looks verified. This skill's reconciliation
cadence check (see `sidequest-reconciliation-playbook.md`) is the sidequest
analogue: a roadmap that hasn't been reconciled against recent burst work in
too long isn't wrong yet, but it's unverifiable, which the audit treats the
same way — as a finding to fix before trusting the green checkmark.
