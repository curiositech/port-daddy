# WS-0 Database Consolidation Verification Checklist

**Status:** PR-ready verification runbook for `scripts/db-consolidate.ts`
**Last updated:** 2026-06-30
**Scope:** Safe same-host consolidation of scattered Port Daddy SQLite fragments

## Current Contract

WS-0 is the local safety slice for the database-fragmentation problem described
in ADR-0044 and ADR-0090. It does not implement cross-machine sync. It makes the
one-host consolidation script reviewable, testable, and rollback-aware.

Canonical destination:

```text
~/.port-daddy/port-registry.db
```

The script scans these candidate classes:

- `PORT_DADDY_DB`, when set.
- `~/.port-daddy/port-registry.db`.
- `~/.port-daddy/instances/<profile>/port-daddy.db`.
- Repo/dev paths such as `<repo>/port-registry.db` and `<repo>/dist/port-registry.db`.
- Homebrew stable paths such as `/opt/homebrew/var/port-daddy/port-registry.db`,
  `/opt/homebrew/opt/port-daddy/libexec/port-registry.db`, and matching
  `/usr/local/...` paths.
- Any `.db` file the live daemon is actually holding open, discovered through
  `~/.port-daddy/daemon.port` plus `lsof`.

Mutation is opt-in:

```bash
bunx tsx scripts/db-consolidate.ts              # dry-run only, default
bunx tsx scripts/db-consolidate.ts --apply      # mutate after confirmation
bunx tsx scripts/db-consolidate.ts --apply --yes --source /path/to/source.db
```

`--force` is accepted only as a confirmation alias for `--apply`; it does not
turn a dry-run into a mutation.

## Safety Guarantees

- Source databases are opened read-only for scan and `VACUUM INTO`.
- The default run is dry-run and only prints inventory, source choice, row-count
  comparison, blockers, and planned mutations.
- `--apply` refuses to run when a daemon has any candidate DB open. Stop the
  stable daemon or dev berth first, then re-run.
- The canonical DB is never overwritten in place. The script writes a staged DB
  beside the canonical path, verifies `PRAGMA integrity_check`, archives the old
  canonical DB family, then renames the staged DB into place.
- If staging or canonical install fails, the previous canonical DB is moved back
  automatically.
- Non-canonical fragments, empty DBs, corrupted DBs, and `-wal`/`-shm` sidecars
  are archived under `~/.port-daddy/backups/_pre-consolidation-<timestamp>/`
  using path-derived names plus a hash, so duplicate basenames cannot collide.
- Archive contents are plaintext local files. Keep `~/.port-daddy` private and
  retain the archive for at least 7 days.

## Pre-Apply Checklist

Run these before any `--apply` attempt:

- [ ] Branch/worktree is clean except for the intended PR patch:

  ```bash
  git status --short --branch
  ```

- [ ] Coordination is anchored and claims are current:

  ```bash
  pd status
  pd briefing
  pd whoami
  pd guard status
  pd sessions --all-worktrees
  ```

- [ ] Dry-run has been reviewed:

  ```bash
bunx tsx scripts/db-consolidate.ts
  ```

- [ ] The selected source is explicit or obviously correct from the table counts.
  If not, re-run dry-run with the intended source:

  ```bash
bunx tsx scripts/db-consolidate.ts --source /absolute/path/to/source.db
  ```

- [ ] No daemon/berth is holding a candidate DB open. The script enforces this on
  `--apply`; this check makes the failure unsurprising:

  ```bash
  lsof -nP ~/.port-daddy/port-registry.db 2>/dev/null || true
  find ~/.port-daddy/instances -name 'port-daddy.db' -maxdepth 2 -print 2>/dev/null \
    | xargs -r lsof -nP 2>/dev/null || true
  ```

- [ ] Backup/archive root is writable:

  ```bash
  mkdir -p ~/.port-daddy/backups
  touch ~/.port-daddy/backups/.write-test && rm ~/.port-daddy/backups/.write-test
  ```

For human review, surface the result in FleetBar or open the selected daemon's
dashboard with `pd dashboard` after the agent completes the terminal-side checks.

## Apply Flow

```bash
bunx tsx scripts/db-consolidate.ts --apply --source /absolute/path/to/source.db
```

Expected output:

1. Candidate inventory with valid/empty/corrupted/missing counts.
2. Source-of-truth path and size.
3. Row-count comparison across valid DBs.
4. Planned staged path and archive path.
5. Confirmation prompt.
6. Staged `VACUUM INTO`.
7. Integrity check on the staged DB.
8. Archive of the previous canonical DB family.
9. Atomic rename of staged DB to `~/.port-daddy/port-registry.db`.
10. Archive of non-canonical fragments and sidecars.

For unattended rehearsal on a scratch home:

```bash
SCRATCH="$(mktemp -d ~/.port-daddy/ws0-dry-run-home.XXXXXX)"
bunx tsx scripts/db-consolidate.ts --home "$SCRATCH"
```

The `--home`, `--canonical`, and `--backups-dir` flags are for test/dev
rehearsal. Do not use them for the real canonical migration unless the PR is
intentionally testing a scratch path.

## Post-Apply Checklist

Run immediately after a successful `--apply`:

- [ ] Canonical DB exists, is non-empty, and passes integrity:

  ```bash
  ls -lh ~/.port-daddy/port-registry.db
  sqlite3 ~/.port-daddy/port-registry.db 'PRAGMA integrity_check;'
  ```

- [ ] Archive directory exists and contains the old canonical/source fragments:

  ```bash
  ls -la ~/.port-daddy/backups/_pre-consolidation-*/
  ```

- [ ] Restart the affected daemon/berth through the agent/operator surface for
  that lane. For the stable Homebrew daemon, verify the launchd service after
  restart:

  ```bash
  launchctl print gui/$(id -u)/homebrew.mxcl.port-daddy
  pd status
  ```

- [ ] Verify the process now holds the canonical DB:

  ```bash
  PORT="$(cat ~/.port-daddy/daemon.port)"
  lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -Fp \
    | sed -n 's/^p//p' \
    | xargs -I{} lsof -nP -p {} -Fn \
    | sed -n 's/^n//p' \
    | grep 'port-registry.db'
  ```

- [ ] Coordination read paths still work:

  ```bash
  pd doctor
  pd guard status
  pd sessions --all-worktrees
  pd notes --limit 5
  ```

- [ ] Take a normal `pd backup` after the daemon has reopened the canonical DB:

  ```bash
  pd backup
  pd backup list
  ```

## Rollback Notes

The script automatically rolls back only failures that happen before the
canonical install completes or during the install itself.

After a successful install, rollback is manual and should use the archive:

```bash
# Stop the daemon/berth first.
ARCHIVE=~/.port-daddy/backups/_pre-consolidation-<timestamp>
sqlite3 "$ARCHIVE/<archived-canonical-name>" 'PRAGMA integrity_check;'
mv ~/.port-daddy/port-registry.db ~/.port-daddy/port-registry.db.failed-rollback
cp "$ARCHIVE/<archived-canonical-name>" ~/.port-daddy/port-registry.db
chmod 600 ~/.port-daddy/port-registry.db
# Restart and verify with pd status + lsof.
```

Do not delete the `_pre-consolidation-*` archive until the daemon has been
stable for at least 7 days and a fresh `pd backup` exists.

## PR Validation

Minimum local validation for this slice:

```bash
node --experimental-vm-modules /Users/erichowens/coding/port-daddy/node_modules/jest/bin/jest.js \
  --runTestsByPath tests/unit/db-consolidate.test.js
bunx tsx scripts/db-consolidate.ts --home "$(mktemp -d ~/.port-daddy/ws0-plan.XXXXXX)"
npm run typecheck
```

If the worktree has no local `node_modules`, use the main checkout's installed
Jest binary as shown above while keeping `cwd` in this branch.

## Remaining WS-1 Gaps

- Stable Homebrew service rollout still depends on the release/brew lane; verify
  live daemon provenance after merge instead of assuming source truth is runtime
  truth.
- No FleetBar/dashboard button owns this consolidation yet. The CLI is agent
  tooling; operator-facing consolidation should become a FleetBar/dashboard
  workflow before it is routine.
- No schema compatibility report beyond `integrity_check` and row counts.
- No encrypted archive for `_pre-consolidation-*`; this remains local plaintext.
- No cross-machine sync; ADR-0090 phases 4-9 remain future work.
