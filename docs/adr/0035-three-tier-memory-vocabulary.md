# 0035. Three-Tier Memory Vocabulary — Core, Recall, Archival

## Status

Accepted

## Context

Port Daddy already stores every coordination fact an agent could want — active
sessions, file claims, notes, blobs, the skill index, the Merkle-chained ledger,
the salvage queue. What it does not give an agent is a way to ask *where does
this live, and how long will it last?* The substrates are present; the
vocabulary that tells an agent how to reason about them is missing.

The always-on-agent-architecture audit (the Letta-style hierarchy in the
literature) calls these three tiers:

- **Core** — small (~4KB), in working scope for the agent's current turn,
  evicts when the scope ends. Identity, intent, the few facts that *must* be
  fresh.
- **Recall** — conversation/event log within a retention window. Searchable,
  priority-ordered, display-compactable.
- **Archival** — curated long-term store. Indexed for semantic search, never
  silently destroyed.

Port Daddy implements every one of these. It just doesn't say so. The result
shows up in the seams:

- File claims are *used* as Core (the daemon refuses your edit if you don't own
  the path) but *stored* as Recall (`session_files` is a row table, queried
  by listing). An agent that asks "is my claim still hot?" has to scan instead
  of read a working set.
- Notes are *used* as Recall — `pd briefing` wants the last few notes — but
  they are *stored* in an immortal Merkle ledger. The compaction work in
  flight is trying to reconcile that without rewriting the substrate;
  vocabulary makes the compaction's job explicit ("we are compacting the
  Recall *display*; the Archival ledger keeps every line").
- A salvageable session sits in a quiet third place: its body of file claims
  and notes is durable, but the *agent* is gone. Today it is a session row
  with a "salvageable" flag. The honest framing is that it has transitioned
  out of Core (no live heartbeat) into Recall-still-searchable, with its
  notes already in Archival.

So `pd briefing` and `pd whoami` over-include or under-include depending on
which substrate you happen to ask. The fix is not new storage. The fix is
calling each construct by its tier name and making `pd memory tiers` show
the table.

## Decision

Adopt Core / Recall / Archival as the official storage vocabulary. Document
the mapping; expose `pd memory tiers`, `pd memory tier <construct>`, and
`pd memory summary` so agents can read it without grepping the source.

### The mapping

| PD construct                                | Tier             | Eviction                                                 | Access                          |
|---------------------------------------------|------------------|----------------------------------------------------------|---------------------------------|
| Active session state                        | Core             | Session end OR heartbeat loss                            | `pd whoami`, `pd briefing`      |
| Active file claims                          | Core             | Release OR heartbeat loss                                | `pd sessions`, claim resolution |
| Active notes (current session, last ~1h)    | Recall           | Display-layer TTL (compaction work in flight)            | `pd notes`, `pd briefing`       |
| Older notes (Merkle-chained, durable)       | Archival         | Never destroyed; display-only compaction                 | `pd notes --since`, search      |
| Blob storage                                | Archival         | Configurable GC                                          | `pd blob`                       |
| Skill index                                 | Archival         | Re-embed on edit                                         | `pd skill find`                 |
| Salvageable sessions                        | Recall→Archival  | Transition on heartbeat loss; salvage-queue compaction   | `pd salvage`                    |

The transition column matters as much as the storage column. A salvageable
session is the canonical example: it is born in Core, drops to Recall when
the heartbeat goes, and its body lives in Archival the entire time.

### Implications for `pd briefing`

The briefing assembler should be tier-aware:

1. **Core fully included.** Identity, purpose, active session, every live
   claim. If it doesn't fit, the briefing was wrong, not the budget.
2. **Recall priority-ordered with TTL.** Last hour of notes for the current
   session and adjacent sessions in the same project. Compaction is allowed
   here and only here.
3. **Archival only on explicit reference.** The briefing does not splat the
   skill index or the full note ledger into the prompt. It surfaces them as
   *pointers* — "8412 notes in archival; search with `pd notes --since`" —
   and lets the agent decide to pull more.

This is an authoring rule for the briefing path, not a wire-format change.
The existing briefing endpoint stays where it is; subsequent work on the
briefing assembler can cite this ADR.

### What this changes (today vs proposed)

**Today.** Operators and agents speak in primitive nouns — "session",
"note", "claim", "blob" — and have to remember each one's retention rule
independently. The briefing path treats all notes alike. The compaction
work in flight has to invent its own naming.

**Proposed.** Every construct carries a tier label. `pd memory tiers`
prints the table. The briefing assembler can be written as "Core first,
Recall by TTL, Archival by pointer" instead of "ad hoc, see the code."

**Not changed by this ADR.** No schema migration, no wire-format change,
no new substrate. This is vocabulary plus introspection.

### What this does NOT do

- **Does not destroy anything Archival.** The Merkle ledger keeps every
  note line ever written. Archival is "display-compactable, never
  destroyed" — that is the load-bearing invariant the user has called out
  more than once and it stays load-bearing.
- **Does not rewrite the CLI surface.** Existing verbs (`pd notes`,
  `pd sessions`, `pd blob`, `pd memory episodes`) keep working unchanged.
  The new `pd memory tiers` / `tier <construct>` / `summary` subcommands
  sit alongside the existing `pd memory episodes` / `stats`.
- **Does not move file claims into a new table.** The Core-ness of an
  active file claim is a *semantic* property of the row, not a different
  row. The vocabulary says "treat these rows as Core"; the storage stays
  in `session_files` where the symbol-index work already lives.
- **Does not couple to the briefing assembler.** The briefing path is on
  another agent's branch in the same wave. The implications section is
  guidance; the assembler change is its own commit.

## Rationale

Three designs were considered.

1. **Rename the tables to match the tiers.** Rejected: it forces a schema
   touch, breaks every existing tool, and forces the Wave 4 agents working
   on `lib/sessions.ts`, `lib/blob.ts`, `lib/notes.ts`, and `lib/spawner.ts`
   to merge against a moving target. The whole point is *vocabulary* — the
   storage is already correct.

2. **Document the tiers in a skill file and stop there.** Rejected: a
   skill file is read by skill consumers, not by agents debugging at the
   shell. Operator truth lives in the CLI. If `pd memory tiers` doesn't
   print the table, nobody will trust the skill file to be current.

3. **Document + introspection (this ADR).** Accepted. The ADR locks the
   mapping; the CLI command lets any agent verify the mapping is what the
   running daemon thinks it is. If they diverge, the divergence is the
   bug.

## Consequences

### Positive

- Agents have one phrase ("Core / Recall / Archival") that names every
  storage tier in the system. Onboarding stops repeating "but the notes
  are immortal even though they look like a log."
- The compaction work in flight gains explicit language: "we compact the
  Recall display; the Archival ledger is untouched."
- `pd briefing` gains a structural rule it can be measured against.
- The coordination cookbook (separate branch, may or may not be merged
  alongside this one) can cite the tiers directly. TODO: when the
  cookbook lands, cross-reference this ADR from the cookbook's storage
  section.

### Negative

- One more thing to keep current. If we add a new substrate (e.g., the
  bond ledger, the tuple space, harbor mesh state), the table here must
  grow. Drift between the daemon and this table is the failure mode to
  watch.
- The Recall→Archival transition for salvageable sessions is the
  hardest cell in the table to defend in isolation; reviewers will want
  to see the heartbeat-loss event hook that does the transition. That
  hook already exists in `lib/sessions.ts` (`markStale` / salvage flag);
  the ADR points at it without rewriting it.

### Neutral

- This ADR explicitly does not change the briefing wire format. A later
  ADR can do the tier-aware assembler if the implications section proves
  out in practice.
