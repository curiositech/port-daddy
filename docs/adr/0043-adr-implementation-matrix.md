# 0043. ADRs Carry a Roadmap-Linked Implementation Matrix

## Status

Accepted

## Context

We have 42 ADRs. Most are marked `Accepted`, a few `Proposed`. **Nothing in the
repository tells you whether the decision an ADR records was ever *built*.** An
ADR is a Markdown file that captures a choice and then goes inert; the work it
implies lives in a prompt, a half-finished branch, or someone's memory, and dies
there. ADR-0033 itself names a gap ("claims have no TTL today… a follow-up ADR
can add a stale claim sweeper") and ADR-0041 was written to close it — but
*nothing links the two*, and nothing tells a reader of ADR-0033 that 0041 is the
follow-up, let alone whether 0041 shipped. The proposed ADRs 0039–0042 each
describe multi-phase work (the accounts arc alone is A0–A2 + W0–W6) with **zero
machine-readable tracking of which phase is done.**

This is the write-only-document failure mode. ADRs are *not code* — they are not
the source of truth for behavior — but they are also not sacred prose to be filed
and forgotten. They should *matter*: each one should be answerable, at any moment,
to the question **"how implemented is this, really?"**

Two primitives already in the repo make the fix nearly free:

- **`roadmap_items`** (`lib/roadmap-items.ts`; **ADR-0033** — *the SQLite table that
  is the single source of truth for planned work, statuses `now | backlog | parked
  | merge | done`*) is where "what we intend to build" already lives.
- **Cartographer** (**ADR-0023** — *the navigator/roadmap actor responsible for
  keeping the roadmap an honest map of reality*) is already the designated owner
  of roadmap truth.
- **Commitments** (`lib/commitments.ts`; **ADR-0041** — *a durable, violable
  obligation bound 1:1 to a non-forgeable actor, with a monitor that detects breach*)
  give us a way to *hold* an actor to a standing job instead of hoping a prompt
  remembers.

So the missing thing is not new machinery — it is a **link** and an **owner**.

## Decision Drivers

- An ADR's implementation status must be **derived from `roadmap_items`**, never
  hand-maintained in the prose (hand-maintained status is how docs lie).
- Every phase of every ADR must be a **real roadmap row**, and per the operator's
  directive, created at **high priority (`status: 'now'`)** so the work is visible,
  not buried in `backlog`.
- The linkage must be **bidirectional and machine-readable**: ADR → roadmap slug,
  and roadmap row → `adr:NNNN`.
- One actor — **Cartographer** — must hold a **durable commitment** to keep the
  linkage true, so drift is a *detected breach*, not a silent rot.

## Considered Options

- **A. Status field in ADR frontmatter only.** Rejected: hand-maintained, drifts
  the moment work starts, exactly today's failure.
- **B. A separate tracking spreadsheet / GitHub Projects board.** Rejected: a third
  source of truth off to the side; not dogfooded; not queryable by the daemon.
- **C. (chosen) An Implementation Matrix *in* the ADR whose statuses render from
  `roadmap_items`, with each phase a high-priority roadmap row, owned by a
  Cartographer commitment.** Reuses ADR-0023 + ADR-0033 + ADR-0041; one source of
  truth (the table); the ADR becomes a *view* of it.

## Decision

Every ADR that implies buildable work MUST carry an **Implementation Matrix**: a
Markdown table, one row per phase, with a stable `roadmap slug` join key. The
matrix is parsed by **`lib/adr-matrix.ts`** (*pure parser + transform: ADR text →
`UpsertRoadmapItemInput[]`*). Syncing an ADR upserts each phase into `roadmap_items`
at `status: 'now'`, harbor `port-daddy`, with `dependencies` wired between phases
and a note `adr:NNNN`. Rendering the matrix reads **live** status back from
`roadmap_items`, so the printed status cannot drift from reality.

Cartographer (ADR-0023) holds a durable **commitment** (ADR-0041) — *"every ADR
matrix stays synced to `roadmap_items`; flag any ADR whose phases lack rows or
whose claimed status contradicts code reality"* — whose monitor is the
`pd adr audit` drift check. ADRs thereby become answerable to reality on demand.

### The matrix format (canonical)

```
## Implementation Matrix

| Phase | Roadmap slug | Status | Depends on | Description |
|-------|--------------|--------|------------|-------------|
| 0 | adr-0043-phase-0-spec-and-parser | now | — | This ADR + lib/adr-matrix.ts + tests |
| 1 | adr-0043-phase-1-daemon-route-and-cli | now | adr-0043-phase-0-spec-and-parser | POST /adr/sync route + `pd adr sync/matrix` |
```

`Status` in the file is last-known; `pd adr matrix NNNN` overrides it from the
live table. The slug is the contract; keep it stable across edits.

## Implementation Matrix

| Phase | Roadmap slug | Status | Depends on | Description |
|-------|--------------|--------|------------|-------------|
| 0 | adr-0043-phase-0-spec-and-parser | now | — | This ADR, the matrix format, `lib/adr-matrix.ts` (parse + transform to roadmap upserts), unit tests |
| 1 | adr-0043-phase-1-daemon-route-and-cli | now | adr-0043-phase-0-spec-and-parser | `POST /adr/sync` + `GET /adr/:n/matrix` routes; `pd adr sync` / `pd adr matrix` CLI talking to the daemon |
| 2 | adr-0043-phase-2-cartographer-commitment | now | adr-0043-phase-1-daemon-route-and-cli | Register the Cartographer commitment (ADR-0041) that owns matrix↔roadmap sync; `pd adr audit` is its monitor |
| 3 | adr-0043-phase-3-drift-audit-cron | now | adr-0043-phase-2-cartographer-commitment | Scheduled Cartographer drift audit: ADR phase claims vs roadmap status vs code reality; emit `coordination:inconsistency` on breach |
| 4 | adr-0043-phase-4-dashboard-panel | now | adr-0043-phase-1-daemon-route-and-cli | Dashboard panel: every ADR with a live implementation-status bar sourced from `roadmap_items` |
| 5 | adr-0043-phase-5-retrofit-existing-adrs | now | adr-0043-phase-1-daemon-route-and-cli | Backfill matrices into ADRs 0001–0042 (priority: the proposed ones, 0039–0042) |

## Consequences

### Positive
- An ADR is now answerable to "how built is this?" from one query against the
  source of truth, not from trusting the prose.
- The proposed ADRs (0039–0042) get real, high-priority, trackable phases instead
  of paragraphs nobody acts on.
- Cartographer's roadmap-actor role (ADR-0023) gains teeth: an obligation it can
  *breach*, and a monitor that catches the breach.

### Negative
- Every new ADR carries a small authoring tax (write the matrix). Mitigated: the
  template makes it copy-paste, and an ADR with no buildable work omits it.
- Slugs are a contract; renaming one orphans its roadmap row (the audit catches it).

### Neutral
- The matrix is the dual of a feature flag for documents: it makes the *gap between
  decision and reality* a first-class, observable quantity.
