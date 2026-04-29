# Dogfood Feedback — Curated Harvest

Last updated: 2026-04-28

This file is the curated harvest of agent dogfooding feedback for Port Daddy.

## Authority and status

- Raw drops live in `.spark/feedback/` (one file per session-level observation).
- This file is the **deduped, curated** index. It is the surface that feeds
  `docs/ROADMAP.md` and `docs/recovery/CURRENT-WORK.md`.
- `IDEAS-TROVE.md` is the parallel surface for Spark/Spider exhaust. The two
  feed the same roadmap; they should not duplicate each other.

Status meanings:

- `now` — worth a roadmap slot in the immediate next slices
- `backlog` — valid, preserved, not the next cut
- `parked` — speculative or downstream of other work
- `merge` — duplicate family; do not mint new entries

## Owner

**Cartographer.** Declared in `pd-fleet.yml` (agent `cartographer`),
triggered on `git:committed`. Cartographer's prompt explicitly lists
`.spark/feedback/` as a read source and this file as the curation
surface. Spark/Spider do not touch this lane — they own
`IDEAS-TROVE.md`.

## How Cartographer harvests

1. Read every new file in `.spark/feedback/` since the last pass.
2. For each one, decide:
   - is it already represented here or in `IDEAS-TROVE.md`?
     - if yes: append a one-line provenance pointer to the existing entry
     - if no: mint a new entry using the template below
3. Promote `now` items into `docs/ROADMAP.md` "Next Cuts (From Curated
   Trove)" and add a `roadmap:` backref to the curated entry here.
4. Leave the raw `.spark/feedback/*.md` files in place as provenance.
   Never edit another agent's raw drop.

## Entry template

```markdown
### `<short-slug>`

- status: `now` | `backlog` | `parked` | `merge`
- surface: cli | sdk | mcp | dashboard | daemon | fleet | docs | other
- friction:
  - one-line summary of what hurt or what worked
- next cut:
  - the smallest concrete change that would resolve the friction
- provenance:
  - `.spark/feedback/<file>.md`
  - `.spark/feedback/<other-file>.md`
```

## Curated entries

_No curated entries yet. Spark fleet (`fleet/spark.sh`) and the human in
the chair will populate this on the next harvest pass over
`.spark/feedback/`._

_2026-04-28 harvest note: no new raw files were present in `.spark/feedback/`
in this checkout, so there was nothing to dedupe or promote._

## Cross-refs into the roadmap

When an entry here is promoted into `docs/ROADMAP.md`, add a `roadmap:`
line to the entry pointing at the section it landed in. That is how we
keep the trail honest:

```
- roadmap: `docs/ROADMAP.md#<section-anchor>`
```
