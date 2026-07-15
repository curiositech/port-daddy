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

## Ownership boundary

This is a **doc-authority declaration** authored by the docdrift lane. The
enforcement mechanism it points at — the additive `roadmap_items` schema, the
write-time evidence gate, and the drift patrol over the live table — is owned
and implemented by the roadmapprog + migration lanes (it rides the migration
lane's schema epoch, `PRAGMA user_version`; it is not a competing source). This
note deliberately touches **no** roadmap code (`lib/roadmap-*.ts`,
`routes/roadmap.ts`) and does **not** regenerate the snapshot.
