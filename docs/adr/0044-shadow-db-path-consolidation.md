# 0044. Shadow-Mode DB Path Consolidation

## Status

Accepted

## Context

Port Daddy's database path is resolved in more than one place, and the three
installs (Homebrew daemon, repo dev checkout, `~/.port-daddy`) can land on
**different `.db` files**. PR #220 proposed collapsing this to one canonical path
(`<pd-home>/port-registry.db`, honoring `PORT_DADDY_HOME`) with detect-and-adopt
of the largest non-empty legacy DB. The code was verified green (6523 tests, the
bun fail-closed guard from ADR/PR #214 holds) and read-only inspection showed it
selects the live 758 MB registry in every realistic env config.

The residual risk is **not normal operation** — it is the *path-resolution
decision the first time an upgraded daemon restarts.* A hard cutover finds out
whether the new resolver is right only *after* it is already authoritative over
the 758 MB registry. That is the one move that could orphan real data, and it
cannot be fully exercised from a test harness — only by restarting the live
compiled daemon.

The operator's instinct (correct): **don't cut over — run the new resolver as a
duplicative *slave* of the existing one, observe shadow traffic, and compare
before it ever counts.** This is dark-launch / shadow-replica migration: the
classic safe path for a change whose only real risk is a one-time switchover.

## Decision Drivers

- The 758 MB live registry must be **untouched** until the new resolver is *proven*
  identical to the old one on the real machine.
- The proof must come from **observation under real restarts/traffic**, not only
  unit tests.
- There must be a **one-env-var rollback** at every stage.
- Promotion to the new resolver must be **gated on observed zero divergence**, not
  on a calendar date or a hope.

## Considered Options

- **A. Hard cutover (PR #220 as-is).** Rejected: the risky restart decision becomes
  authoritative before it is observed.
- **B. File-level WAL shipping / Litestream replica.** Rejected: bun:sqlite lacks
  the online-backup API; `VACUUM INTO` (ADR/PR #215) is our only cross-runtime
  primitive; full streaming replication is overkill for a path decision.
- **C. (chosen) Staged shadow: dark-launch the resolver (observe-only), optional
  best-effort shadow data replica + comparator, then divergence-gated promotion.**

## Decision

Reshape #220 into stages controlled by `PD_DB_RESOLVER=v1|v2|shadow` (default `v1`):

- **Dark-launch resolver (observe-only).** On every boot, run *both*
  `resolveDbPath()` (authoritative — serves all traffic) and `resolveDbPathV2()`
  (the #220 logic, **decides nothing**). Log `{ v1_path, v2_path, identical,
  v2_target_bytes }`. Collect across real restarts and `brew upgrade`s. If
  `identical` is always true and `v2_target_bytes` is always ~the live size, #220
  is a proven no-op adoption *on this machine*.
- **Shadow data replica (optional, deeper).** Seed a shadow DB at the v2 path via
  `VACUUM INTO` (ADR/PR #215, bun-safe), then **best-effort mirror writes** to it
  inside `try/catch` so a shadow failure can *never* block or fail the primary.
  Reads stay primary-only; the shadow is never user-visible. A comparator diffs
  primary vs shadow (per-table row counts + checksum + recent-row sample) and logs
  divergence.
- **Divergence-gated promotion.** Flip the default to `v2` only after *K
  consecutive clean boots* (and, if used, *N clean comparator days*). Because the
  two have been provably identical, the flip moves no bytes. Rollback at any time:
  set `PD_DB_RESOLVER=v1`, drop the shadow file; the primary was never touched.

This supersedes the "merge #220 then gate the brew-upgrade behind a backup"
guidance: the data-touching decision rides a *later* stage that is observable
before it counts.

## Implementation Matrix

| Phase | Roadmap slug | Status | Depends on | Description |
|-------|--------------|--------|------------|-------------|
| 0 | adr-0044-phase-0-dark-launch-resolver | now | — | `resolveDbPathV2()` runs alongside v1 on boot, observe-only; structured log `{v1_path,v2_path,identical,v2_target_bytes}`; `PD_DB_RESOLVER` flag (default v1). Zero risk. |
| 1 | adr-0044-phase-1-boot-divergence-report | now | adr-0044-phase-0-dark-launch-resolver | Persist per-boot resolver-comparison rows; `pd db resolver-report` shows identical-streak across restarts/upgrades |
| 2 | adr-0044-phase-2-shadow-replica-and-comparator | now | adr-0044-phase-1-boot-divergence-report | Seed shadow via VACUUM INTO; best-effort mirror writes (never block primary); comparator diff (counts+checksum+sample) with divergence log |
| 3 | adr-0044-phase-3-divergence-gated-promotion | now | adr-0044-phase-2-shadow-replica-and-comparator | Promote default to v2 only after K clean boots + N clean comparator days; one-env-var rollback throughout |

## Consequences

### Positive
- The only risky moment in #220 (the restart path decision) becomes **observable
  for as long as we want before it counts**, on the real machine and real 758 MB DB.
- One-env-var undo at every stage; the live registry is never touched until proven.

### Negative
- Phase 2's mirror writes add a write path; mitigated by best-effort `try/catch`
  isolation, off by default, behind the flag.
- More moving parts than a one-shot cutover — but each part is independently
  reversible and observable.

### Neutral
- #220 is **held** (not merged as-is); its resolver logic is reused as
  `resolveDbPathV2()` in Phase 0.
