# Roadmap Authority — one doc-authority, one registry-authority

*Declared 2026-07-15 (docdrift lane). This note fixes the "which roadmap is
real?" ambiguity that made every roadmap link contestable. It declares the two
authorities; it does not change roadmap code or data.*

## The problem this note closes

Every roadmap surface reported a different item count — snapshot JSON, `pd
roadmap list`, and the two narrative markdown roadmaps each disagreed. That is
a **DB-fragmentation symptom, not a content disagreement**: upserts scatter
across harbors and the CLI / snapshot / export read disjoint sets (see MEMORY:
`db-fragmentation-continuity-bug`; ADR-0044 / ADR-0090-db durable-home). The
fix is to **fix the counter, not the count** — and, first, to stop having two
things both called "the roadmap."

## The two authorities

| Authority | Source of truth | What it governs |
|-----------|-----------------|-----------------|
| **Registry-authority** (machine / gate truth) | the daemon `roadmap_items` table, projected **append-only** to [`roadmap.snapshot.json`](roadmap.snapshot.json) | the `roadmap-link` gate, `pd roadmap` output, every `link:<slug>` join key |
| **Doc-authority** (human narrative) | [`../recovery/UNIFIED-ROADMAP.md`](../recovery/UNIFIED-ROADMAP.md) + [`../V4-UNIFIED-ROADMAP.md`](../V4-UNIFIED-ROADMAP.md) | execution-order storytelling, phase framing, rationale |

There is exactly **one** of each. Narrative prose is not gate truth; the table
is not the story. A roadmap item is legible when it is a row in the table **and**
every narrative mention carries `link:<slug>` or a one-line `optout:<reason>`.

### One database. Documents are projections over it.

An earlier revision of this file said doc-authority is per domain and gave the
Grand Harbor ledger one of its own. That was wrong, and wrong in the direction
this repository keeps failing in. A Markdown file is not a planning database.
Work exists when it is a row the registry admitted; a document that names work
joins to that row by slug, or it is a note about a plan somebody hopes to make.
The ledger's own authority order says exactly this in its rule 4 -- maps,
programmes, UX documents and roadmaps are projections over records -- and the
earlier edit failed to carry it across.

So the two authorities above stand as the only two, and the domain documents
are projections:

| Document | What it is | What it is not |
|---|---|---|
| [`whitepaper-research-program.md`](whitepaper-research-program.md) | the Book's forward plan and its status | a place work becomes real |
| [`../grand-harbor/`](../grand-harbor/README.md) | what each architectural noun means, what each boundary guarantees, which questions are open | a schedule |

Each is single-writer, and neither schedules anything. A row does.

### Why the queue exists, and what it is not

That rule is currently observed in the breach, and pretending otherwise would
be the exact failure the rule is against. The runtime is halted after the
September spend failure, so no session can mutate the registry. Every programme
that needs to record work therefore writes prose: PR #10107 spawns ten
`drydock-*` packages and says in its own body that they are "proposed rather
than registered"; PR #10108 names `chartroom-grand-harbor-authority-cutover`
and states that it reuses Harbor authority rather than adding a parallel store;
the Grand Harbor ledger carries a programme cut of its own. Not one of those
slugs is in the committed 318-row projection -- including
`port-daddy-unified-product-hypertree`, which #10107 calls its prior verified
canonical parent.

The documents are not wrong to exist. The work is real and the authority is
down. What was missing is anyone counting how far the prose had drifted from
the register, which is how a repository ends up with four constitutions and no
database.

[`unregistered.json`](unregistered.json) counts it:
`scripts/roadmap/check_unregistered.py` reads every slug a document schedules,
diffs it against the projection, and writes what has no row. It is a **queue of
rows to write when the authority returns**, not a second registry -- nothing in
it is scheduled work until it is a row. `--check` fails when the queue is
stale, so it cannot quietly grow. It deliberately does not fail on the queue
being non-empty: that would only mean failing until the halt lifts, and a check
that cannot pass is a check nobody reads.

Two consequences worth stating for whoever reads this next. The queue covers
what is in the tree, so a slug living only in a pull-request body is invisible
to it until that branch lands -- the twelve above are in that state today. And
the first thing to do when the halt lifts is not to write more prose: it is to
drain this file into the registry, and delete the rows that turn out to have
been somebody thinking out loud.

## Rules

1. **`roadmap.snapshot.json` is an append-only projection of the table.** Never
   regenerate it via a full export — that is the fragmentation hazard that
   drops live upserts. Patch append-only through the daemon code path only.
2. **Fix the counter, not the count.** The count discrepancy resolves as a
   consequence of DB-consolidation (durable-home, ADR-0044 / ADR-0090-db), not
   by hand-reconciling numbers or standing up a rival table.
3. **Acceptance gate for "reconciled":** `pd roadmap list` count = snapshot
   count = export count (±0) against the table, and every narrative item links
   or opts out. Reconciliation cadence ≤ 14 days.

## Item shape extension (declared 2026-08-22, helmsman lane)

The pd-helmsman program (ADR-0131, `docs/proposals/pd-helmsman.md`) extends the
registry-authority item with **four additive, nullable fields**, delivered by the
`roadmap-schema-wiring` item:

| Field | Purpose |
|-------|---------|
| `body_md` | long-form rationale/evidence prose (ends the one-paragraph ceiling) |
| `evidence_json` | progress evidence: `{pr\|commit\|receipt, ref}` entries |
| `source_refs_json` | typed provenance: `doc:<path>#<anchor>`, `adr:NNNN`, `issue:#N`, `binder:chNN`, `binder:mN` |
| `execution_json` | the autonomous-execution contract: `acceptanceGate`, `budgetUsd`, `class` — required for Helmsman eligibility |

The same slice fixes two standing integrity defects in this doc's own rules: the
snapshot exporter's **full-overwrite** (violating rule 1's append-only projection)
and the **harbor-filter count divergence** (rule 2's counter bug), and stops the
projection dropping `dependencies`.

Status note: the `link:<slug>` / `optout:<reason>` at-rest mechanism described
above remains **unimplemented in code** — the only enforced join is still the
PR-body trailer gate (`lib/roadmap-link-core.ts`). At-rest linkage is tracked by
`roadmap-schema-wiring` (fields) + `roadmap-doc-harvest` (backfill); do not cite
this doc as evidence that narrative links are checked at rest today.

## Ownership boundary

This is a **doc-authority declaration** authored by the docdrift lane. The
enforcement mechanism it points at — the additive `roadmap_items` schema, the
write-time evidence gate, and the drift patrol over the live table — is owned
and implemented by the roadmapprog + migration lanes (it rides the migration
lane's schema epoch, `PRAGMA user_version`; it is not a competing source). This
note deliberately touches **no** roadmap code (`lib/roadmap-*.ts`,
`routes/roadmap.ts`) and does **not** regenerate the snapshot.
