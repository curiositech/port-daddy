# Markdown-as-Database Audit

**Date:** 2026-05-31
**Branch:** `fix/roadmap-sql-source-of-truth`
**Author:** roadmap-sql fix session

## Why this audit exists

ADR-0033 and `lib/roadmap-items.ts` declare the SQLite `roadmap_items` table
the **source of truth** for the roadmap, with `docs/ROADMAP.md` as a downstream
*render*. But the CLI never actually read the table — it parsed the markdown
piles. So the table and the markdown could disagree, and curated entries could
be silently lost between them. This audit sweeps `lib/`, `cli/`, and `routes/`
for any feature that treats a flat file (`.md` / `.json` / `.yaml`) as a
**read** source of truth where a SQLite table exists or should.

**Scope of "offender":** a runtime read path that returns/derives state from a
flat file when an authoritative DB table (a) already exists, or (b) is the
documented intended source of truth. Declarative *config* files (which are
legitimately the source — e.g. `pd-fleet.yml`, `.cartographer/config.yml`) are
**not** offenders; config is supposed to live in files.

## Offenders

### 1. `pd roadmap` list read the markdown, not the table — FIXED

- **Where:** `cli/commands/roadmap.ts` `handleRoadmap()` (bare list path) →
  `fetchRoadmapProgress()` → `GET /cartographer/roadmap-progress`
  (`routes/cartographer.ts:61`) → `getRoadmapProgress()`
  (`lib/roadmap-progress.ts:348`, reading via `readSafe()` at line 369).
- **What it read:** `docs/ROADMAP.md` "Next Cuts", `docs/recovery/IDEAS-TROVE.md`
  `now` entries, `docs/recovery/DOGFOOD-FEEDBACK.md` curated entries — all by
  regex-parsing markdown.
- **DB source of truth that should be used:** `roadmap_items` table via
  `lib/roadmap-items.ts` `list()` (HTTP: `GET /roadmap/items`).
- **Severity:** HIGH — this is the bug the operator flagged. The CLI and the
  table could diverge; promoted items in the table were invisible to
  `pd roadmap`, and the ~41 markdown "next cuts" were never in the table.
- **Status:** **FIXED.** `pd roadmap` now lists from `GET /roadmap/items`
  (the table). An idempotent backfill folds the existing markdown piles into
  the table so nothing is lost: `pd roadmap import-markdown` is now an alias
  over the general document chomper in `lib/roadmap-chomp.ts`, which parses
  the three curated piles as content-detected formats. (The original
  fixed-three-source importer module was deleted when the chomper supplanted
  it — one ingestion path, no parallel parser.) `docs/ROADMAP.md` remains a
  render output of `pd roadmap render --write`.

### 2. `pd roadmap pop` chooses candidates from the markdown piles — FOLLOW-UP

- **Where:** `lib/roadmap-pop.ts:347` (`getRoadmapProgress(...)`), consumed by
  `cli/commands/roadmap.ts` `handleRoadmapPop()`.
- **What it reads:** the same four markdown piles, to build the candidate list
  for an atomic claim.
- **DB source of truth that should be used:** `roadmap_items` for the
  `next-cut` / `now` / `feedback` candidate kinds (live feedback is genuinely
  tuple-sourced and stays as-is).
- **Severity:** MEDIUM — same markdown-as-DB root cause, but pop also integrates
  with `roadmap_claims`, the dry-run preview, and the `--begin` chain, so
  re-pointing it at the table is a larger, separately-testable change. Now that
  the table is the populated source (offender 1 fixed + backfill), pop can be
  migrated to read `roadmap_items` candidates without losing entries.
- **Status:** FOLLOW-UP. Not changed in this PR to keep the diff focused and the
  claim/begin flow stable. Tracked as a roadmap item.

### 3. `GET /cartographer/roadmap-progress` is a markdown reader — RETAINED (by design, but no longer the roadmap SoT)

- **Where:** `routes/cartographer.ts:61` → `lib/roadmap-progress.ts`.
- **What it reads:** the four markdown files + live feedback tuples, producing a
  "FOMO" dashboard payload (current-work excerpt, cartographer status excerpt,
  freshness).
- **Assessment:** This endpoint is legitimately a *curation/freshness* view over
  the human-authored markdown surfaces (CURRENT-WORK.md excerpts, cartographer
  status). It is NOT the roadmap source of truth and should not be treated as
  one. The fix removes `pd roadmap`'s dependency on it for the roadmap list; the
  endpoint stays for the dashboard's freshness panel.
- **Severity:** LOW (informational). No change required, but it should never
  again be the read path for "what is on the roadmap."

### 4. DOGFOOD-FEEDBACK.md is a stale mirror of feedback tuples — FOLLOW-UP

- **Where:** parsed by `parseFeedbackEntries()` in `lib/roadmap-progress.ts`
  (and now also as an ingestion input in `lib/roadmap-chomp.ts`, the single
  document chomper that replaced the earlier fixed-source importer module).
- **What it is:** `docs/recovery/DOGFOOD-FEEDBACK.md` is a human-curated markdown
  mirror of feedback, while the actual feedback source of truth is the
  `feedback:dropped` / `feedback:harvested` **tuples** (`lib/feedback.ts`).
  Reading the markdown can surface entries that diverge from the tuple state.
- **Severity:** LOW–MEDIUM. The backfill folds curated dogfood entries into
  `roadmap_items` (so they are preserved), and live feedback is already read
  from tuples in the progress payload. The remaining cleanup is to stop treating
  the markdown mirror as authoritative for feedback at all and read from tuples.
- **Status:** FOLLOW-UP.

### 5. `pd ideas list|search|show` reads IDEAS-TROVE.md / `.spark` markdown — NOT AN OFFENDER (no table exists yet)

- **Where:** `lib/ideas-trove.ts:271,313`, `lib/ideas-search.ts:342`.
- **Assessment:** There is **no `ideas` SQLite table** today; `IDEAS-TROVE.md` is
  the documented canonical ideation index (per its own "Authority And Status"
  section), and raw `.spark`/`.spider` markdown is research exhaust. So markdown
  *is* the current source of truth for ideas — this is not a violation of "use
  the table where one exists." A future `ideas-trove-queryable-surface` roadmap
  item proposes building such a table; until then, reading the markdown is
  correct, not a bug.
- **Severity:** N/A (documented as future work, not a regression).

### 6. Fleet config (`pd-fleet.yml`) reads — NOT AN OFFENDER (config, by design)

- **Where:** `lib/fleet-engine.ts`, `lib/fleet-bootstrap.ts`, `lib/fleet-ast.ts`,
  `lib/projects.ts`, `lib/project-locator.ts`, `cli/commands/init.ts`, etc.
- **Assessment:** `pd-fleet.yml` is declarative *configuration* — ADR-0019
  explicitly makes the YAML the source ("agents should be declared, not coded").
  There is no `fleet_*` table that the YAML mirrors. Reading config from a file
  is the intended design, not a markdown-as-DB violation.
- **Severity:** N/A.

## Summary

| # | Feature | File:line | Reads | Should source from | Severity | Disposition |
|---|---------|-----------|-------|---------------------|----------|-------------|
| 1 | `pd roadmap` list | `cli/commands/roadmap.ts` `handleRoadmap` → `routes/cartographer.ts:61` → `lib/roadmap-progress.ts:369` | ROADMAP.md / IDEAS-TROVE.md / DOGFOOD-FEEDBACK.md | `roadmap_items` (`GET /roadmap/items`) | HIGH | **FIXED** |
| 2 | `pd roadmap pop` | `lib/roadmap-pop.ts:347` | same four piles | `roadmap_items` (non-live kinds) | MEDIUM | Follow-up |
| 3 | `/cartographer/roadmap-progress` | `routes/cartographer.ts:61` | four markdown files + tuples | n/a (freshness view, not roadmap SoT) | LOW | Retained by design |
| 4 | DOGFOOD-FEEDBACK.md mirror | `lib/roadmap-progress.ts` `parseFeedbackEntries` | DOGFOOD-FEEDBACK.md | feedback tuples (`lib/feedback.ts`) | LOW–MED | Follow-up |
| 5 | `pd ideas *` | `lib/ideas-trove.ts:271,313`, `lib/ideas-search.ts:342` | IDEAS-TROVE.md / `.spark` | (no table exists yet) | N/A | Not an offender |
| 6 | Fleet config | `lib/fleet-*.ts` | `pd-fleet.yml` | (config is the SoT) | N/A | Not an offender |

**Fixed in this PR:** #1 (the operator-flagged bug) plus the idempotent
markdown backfill so the ~41 next-cuts + curated entries are preserved in the
table. **Follow-ups:** #2 (`pd roadmap pop` candidate source) and #4 (feedback
markdown mirror) — both have the same root cause and are now safe to migrate
because the table is populated and authoritative.
