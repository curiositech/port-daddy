# WS-0 DB Consolidation Verification Summary

**Date:** 2026-06-30
**Verification status:** PR-ready after script hardening and focused tests
**Readiness:** Safe for dry-run review; real apply still requires stopping the
affected daemon/berth first.

## What Changed

This slice turns the first WS-0 consolidation draft into a landable patch:

- `scripts/db-consolidate.ts` now defaults to dry-run. `--apply` is required
  for mutation; `--force`/`--yes` only skip the confirmation prompt.
- Candidate discovery now covers the current path reality: `PORT_DADDY_DB`,
  canonical `~/.port-daddy/port-registry.db`, daemon-profile DBs,
  repo/dist DBs, Homebrew var/opt/libexec/Cellar paths, and DBs the live daemon
  actually has open.
- Live daemon detection uses `lsof` machine output (`-Fp`, `-Fn`) instead of
  shell pipelines and grep/awk parsing.
- Source scanning uses read-only SQLite handles. The apply path writes a staged
  DB beside the canonical path, verifies it, archives the previous canonical DB
  family, then renames the staged DB into place.
- If staging or canonical install fails, the script rolls back the previous
  canonical DB automatically.
- Non-canonical fragments and `-wal`/`-shm` sidecars are archived with
  path-derived names plus hashes, avoiding basename collisions.
- `install-daemon.ts` and `lib/backup-schedule.ts` pin `PORT_DADDY_DB` to
  `~/.port-daddy/port-registry.db` for their generated launchd surfaces.
- The WS-0 checklist was rewritten to match the dry-run/apply/rollback contract.

## Tests Added

`tests/unit/db-consolidate.test.js` covers:

- Candidate discovery for canonical, env, profile, Homebrew, repo, and live-open
  paths.
- `lsof` machine-output parsing without shell pipelines.
- Source selection preferring the live daemon DB over a fresher timestamp.
- Apply behavior that stages into canonical, archives the old canonical, and
  archives the non-canonical source.
- The live-daemon blocker that refuses mutation while a candidate DB is open.

Focused validation run:

```text
node --experimental-vm-modules /Users/erichowens/coding/port-daddy/node_modules/jest/bin/jest.js --runTestsByPath tests/unit/db-consolidate.test.js
PASS unit tests/unit/db-consolidate.test.js
Tests: 5 passed, 5 total
```

The branch worktree does not have its own `node_modules`, so the validation used
the main checkout's installed Jest binary while keeping `cwd` in this worktree.

## Current Safety Model

Default command:

```bash
npx tsx scripts/db-consolidate.ts
```

This is dry-run only. It prints inventory, source choice, row-count comparison,
blockers, and the planned staged/archive operations.

Real apply:

```bash
npx tsx scripts/db-consolidate.ts --apply --source /absolute/path/to/source.db
```

The script refuses to apply when a daemon has any candidate DB open. This is
intentional: `VACUUM INTO` is safe for snapshotting, but archive/rename of a live
SQLite file is not.

## Remaining Risks

- Runtime truth still depends on which daemon lane is actually running. Source
  changes and generated launchd plists do not prove the Homebrew stable daemon
  has been released, upgraded, and restarted.
- The archive is local plaintext under `~/.port-daddy/backups`; keep it private
  and retain it until a fresh `pd backup` exists and the daemon has stayed stable.
- Rollback is automatic only before/during canonical install. If the daemon
  later rejects the newly installed DB, use the archived canonical DB manually.
- The script validates integrity and row counts, not full schema compatibility.
- No FleetBar/dashboard workflow exists yet; this remains an agent-run CLI tool.

## WS-1 Follow-Ups

- Add an operator-facing FleetBar/dashboard consolidation flow with status,
  source selection, and rollback visibility.
- Add a schema compatibility report before apply.
- Add encrypted pre-consolidation archives or reuse the `pd backup` backend for
  encrypted/off-host retention.
- Verify release/brew integration once the stable lane consumes this patch.
- Continue ADR-0090 phases for shared board data and cross-machine sync.
