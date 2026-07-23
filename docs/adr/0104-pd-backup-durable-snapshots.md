# 0104. pd backup / pd restore — durable snapshots of port-registry.db

## Status

Proposed

## Context

The coordination substrate is one file: `port-registry.db`. On 2026-05-19
that file held ~720MB of accumulated state — sessions, notes, claims, tuples,
roadmap_items, wallet ledger, message history — months of operational truth.
A near-miss during a `~/port-daddy-stable` directory cleanup nearly `rm`'d
it. Recovery was incidental (the stable worktree still had the original).

The roadmap pop that triggered this ADR named the failure mode bluntly:
> 720MB DB with months of session/note/claim history was within one `rm` of
> being gone, only saved because `~/port-daddy-stable` still had the original.
> Severity: HIGH (single-point-of-failure on the durable coordination substrate).

There is no `pd backup`. There is no `pd restore`. The daemon writes to
`/opt/homebrew/var/port-daddy/port-registry.db` continuously, with no
rotation, no offsite copy, no encrypted archive, no point-in-time snapshot.

Adjacent prior art in this repo:
- ADR-0028 (signed-binary-distribution) — established the keychain-resident
  signing-key pattern; backup encryption can reuse the same shape.
- ADR-0029 (user-accounts-and-merkle-audit) — established that the DB is
  the authoritative log; backups must preserve that integrity guarantee.
- `lib/db.ts` already runs WAL mode + integrity checks on open; the SQLite
  online Backup API works against the same handle without blocking writes.
- `pd snapshots` (in `cli/commands/snapshots.ts`) **already exists** but is
  a different concept entirely: per-file pre-stomp byte snapshots written
  by the claim watcher when an agent tries to overwrite a file another
  agent owns. Those live under `~/.port-daddy/snapshots/<sessionId>/` and
  are about source-file rollback, not DB durability. To avoid namespace
  collision, the verbs here are `pd backup` / `pd restore` and artifacts
  live under `~/.port-daddy/backups/`. The internal term "snapshot ID"
  for a backup manifest is reused but never shares a directory or routes
  with claim-watcher snapshots.

## Decision

Ship `pd backup` and `pd restore` as first-class verbs with a URI-addressed
backend interface. Land in three slices so the file:// path is reviewable
without dragging cloud SDKs into the first PR.

### Snapshot artifact

A snapshot is two files under one ID:

```
<snapshot-id>/
  manifest.json         # plaintext; integrity + provenance metadata
  port-registry.db.gz   # gzipped SQLite copy (encrypted if a key is set)
```

`<snapshot-id>` is `YYYY-MM-DDTHH-MM-SS-<sha256-prefix-8>`, e.g.
`2026-05-19T14-32-01-a8f3b2c4`. ISO-8601 with `:` swapped to `-` so the ID
is filesystem-safe across darwin/linux/s3.

Manifest shape:

```json
{
  "snapshot_id": "2026-05-19T14-32-01-a8f3b2c4",
  "created_at": 1716130321000,
  "pd_version": "3.14.1",
  "schema_version": 87,
  "db_bytes_uncompressed": 720123456,
  "db_bytes_compressed":   118456789,
  "sha256_uncompressed": "<hex>",
  "sha256_compressed":   "<hex>",
  "encryption": { "scheme": "age" | "none", "recipient": "<age-pubkey>" },
  "source_host": "<hostname>",
  "source_path": "/opt/homebrew/var/port-daddy/port-registry.db",
  "agent_id": "<who ran pd backup>",
  "session_id": "<optional>"
}
```

### Online snapshot, not file copy

The daemon is always-on. Naïve `cp port-registry.db` can capture a write
mid-transaction and, worse, a WAL database splits committed state across the
main `.db` file and the `-wal` sidecar — copying just the `.db` loses any
committed pages still living in the WAL.

The snapshot mechanism is **`VACUUM INTO '<scratch>'`**. This is plain SQL
that runs identically on both runtimes the codebase supports — better-sqlite3
(jest/dev) and **bun:sqlite (the shipped `bun build --compile` daemon)**.
`VACUUM INTO` takes a read transaction over the live DB, folds in the WAL,
and writes a fresh, fully-checkpointed, defragmented copy. It is SQLite's
recommended online-backup primitive for WAL databases and does **not** depend
on `better-sqlite3.Database.backup()` (Node-only) or `bun:sqlite.serialize()`
(fragile on a live WAL DB, and the original bun path was never exercised —
the classic "green-in-jest, broken-in-bun" trap). better-sqlite3's
page-incremental `.backup()` remains available as an **opt-in fast path**
(`createBackup({ fastBackup: true })`); it is not the default.

Two integrity gates are mandatory, not advisory:

1. **Post-snapshot:** `createBackup` runs `PRAGMA integrity_check` on the
   staged snapshot file and *fails the backup* if it is not `ok`. A corrupt
   backup is worse than none — it manufactures false confidence.
2. **Post-restore:** `restoreBackup` re-checks the restored file and rolls
   back to the `pre-restore-<ts>` copy if the check fails.

Scratch files (the VACUUM-INTO target, the schema-version probe copy) are
written under `$PORT_DADDY_PREFIX/.backup-scratch` or
`~/.port-daddy/.backup-scratch` — **never `os.tmpdir()` / `/tmp`**, which
macOS purges on a timer and on reboot. A backup that briefly stages in `/tmp`
can vanish mid-flight. See `lib/backup.ts` `resolveScratchDir()`.

Gzip + (optionally, PR-β) encrypt the resulting file.

### Backend interface

```ts
interface BackupBackend {
  uri: string;                                  // 'file://...', 's3://...', 'gs://...'
  put(snapshotId: string, manifest: Manifest, dbStream: Readable): Promise<void>;
  get(snapshotId: string): Promise<{ manifest: Manifest, dbStream: Readable }>;
  list(): Promise<SnapshotSummary[]>;
  delete(snapshotId: string): Promise<void>;
}
```

PR-α implements only `FileBackend` (writes under
`~/.port-daddy/backups/<snapshot-id>/`). PR-β adds `S3Backend` +
`GcsBackend` against the same interface — no `lib/backup.ts` changes.

### Encryption at rest (deferred to PR-β)

Plan: use [age](https://age-encryption.org/) — recipient-based, pure-JS
bind available, designed for exactly this. PR-β provisions a keypair on
first use (`pd backup init`), writes the private key to
`~/.port-daddy/backup-identity.txt` (chmod 600), and encrypts the gzipped
DB before handing it to the backend. macOS keychain hardening lands in a
follow-up; the file approach keeps encryption meaningfully on without
native deps.

PR-α writes `encryption: { scheme: "none" }` to every manifest and warns
on stdout whenever it does so. After PR-β, `--no-encryption` flips from
default to explicit opt-in.

### Retention policy

Default: GFS (grandfather-father-son) +N most recent.
- Last 7 daily snapshots
- Last 4 weekly snapshots (one per ISO week, the Sunday snapshot)
- Last 12 monthly snapshots (one per month, the 1st-of-month snapshot)

Override via `--retention "<spec>"` (e.g. `--retention "daily=14,weekly=8"`).

Retention runs after every successful `pd backup` — the new snapshot lands
first, then `prune()` walks the backend's `list()` and deletes anything
outside the retention window. Prune is per-backend; deletes use `delete()`.

### CLI surface

```
pd backup init                          # provision age keypair → keychain
pd backup [--to URI] [--no-encryption] [--retention SPEC]
                                        # default URI = file://~/.port-daddy/backups
pd backup list [--to URI]
pd backup show <snapshot-id>            # print manifest
pd backup prune [--to URI] [--retention SPEC]
                                        # manual retention sweep

pd restore <snapshot-id> [--from URI] [--to DB_PATH] [--force]
                                        # default --to = current daemon DB path
                                        # without --force: prompts + stops daemon first
```

`pd restore` stops the daemon (`launchctl unload`), atomically renames the
current DB to `port-registry.db.pre-restore-<timestamp>`, writes the
restored bytes, runs `PRAGMA integrity_check`, and restarts the daemon. If
integrity check fails, it rolls back.

### Scheduled backups (implemented)

A one-shot `pd backup` is only as durable as the operator's memory. The
758 MB live coordination DB needs the snapshot on a timer. `lib/backup-schedule.ts`
installs a per-user **launchd** agent (label `com.portdaddy.backup`) that runs
`pd backup` once a day:

```
pd backup schedule install            # install + load the launchd agent
pd backup --install-schedule          # flag form, identical effect
pd backup schedule install --retention "daily=14,keep=5"   # bake retention
pd backup schedule install --to file://~/backups           # bake backend
pd backup schedule uninstall          # bootout + delete the plist
pd backup schedule cron               # print a crontab line (Linux/non-launchd)
```

- The agent uses launchd `StartCalendarInterval` (default 03:17 local), which
  — unlike a bare cron line — catches up a run missed while the machine was
  asleep at the scheduled minute.
- The plist is written to `~/Library/LaunchAgents/com.portdaddy.backup.plist`
  and bootstrapped with `launchctl bootstrap gui/<uid>`.
- It invokes the same `pd` binary the operator runs (resolved via `command -v pd`,
  falling back to the launching binary), so Homebrew and dev checkouts each
  schedule against their own binary.
- Retention is the existing GFS default (`daily=7,weekly=4,monthly=12,keep=3`)
  unless `--retention` was passed at install time; prune runs automatically
  after each snapshot.
- On Linux (no launchd), `schedule install` does not fail — it prints the
  exact crontab line to paste into `crontab -e` (or a systemd timer).

A future `pd-fleet.yml` `backup-keeper` agent can supersede this for fleet
hosts; the launchd path is the zero-dependency default for the single-operator
machine.

### Slice plan

- **PR-α** (this branch, `feat/pd-backup-durable`): `lib/backup.ts`,
  `lib/backup-backends/file.ts`, `cli/commands/backup.ts`,
  `cli/commands/restore.ts`, retention engine, comprehensive tests. **No
  encryption** in this slice — `encryption: { scheme: "none" }` is the only
  value written, and the `--no-encryption` flag is silently the default.
  This keeps PR-α free of native deps (`age-encryption` is pure JS but
  keychain libs like `keytar` are native).
- **PR-β** (proposed): `lib/backup-encryption.ts` adds age-based encryption-at-rest
  via [`age-encryption`](https://www.npmjs.com/package/age-encryption) (pure
  JS, no native bind). `pd backup init` provisions a keypair. The age
  **private** key lives in `~/.port-daddy/backup-identity.txt` with
  `chmod 600`; macOS keychain integration ships in a follow-up (the file
  approach is the lowest-friction default that still keeps encryption
  meaningfully on). After PR-β lands, `--no-encryption` flips from default
  to opt-in.
- **PR-γ** (proposed): `lib/backup-backends/s3.ts` + `gs.ts` against the same
  interface. Credentials via standard env vars; no new config surface.
- **PR-δ**: `pd-fleet.yml` `backup-keeper` agent + dashboard panel
  surfacing last-N backups + restore button (with double-confirm).

## Consequences

**Positive:**
- Single-point-of-failure on the coordination substrate becomes recoverable.
- Snapshots are integrity-verifiable (sha256 in manifest, page-level Backup API atomicity).
- URI-addressed backends keep cloud SDKs out of the core install; offline-first users get file:// without dragging in aws-sdk.
- Encryption-at-rest is on by default; the only way to opt out is the explicit `--no-encryption` flag.
- GFS retention prevents snapshot directories from growing without bound.

**Negative:**
- New surface area: 2 CLI verbs, 6 subcommands, 3 backends eventually, plus keychain dependency.
- Restore is destructive and must stop the daemon — adds operational risk if the restored DB is corrupt. Mitigated by the `pre-restore-*` rollback file.
- Age dependency adds an npm package. The bind is pure JS (no native deps), so install cost is small, but it is one more thing to keep current.

**Migration:**
- None. New verbs, no existing schema changes. First `pd backup` creates the snapshot directory + keychain entry on demand.

## Alternatives considered

1. **`cp` + cron** — naïve file copy can capture mid-transaction state. Rejected because SQLite's online Backup API is the same effort and gives atomicity for free.
2. **`sqlite3 .dump`** — produces SQL text, 3-5× larger than the binary file, very slow to restore on a 720MB DB. Rejected on size + restore time.
3. **LiteStream-style streaming replication** — continuous shipping of WAL frames to S3. Strictly better for RPO than discrete snapshots, but ~10× the implementation complexity and brings a daemon-in-the-daemon problem. Listed as a future direction, not the v1.
4. **No encryption** — port-registry.db contains note bodies that include session-private context (and eventually user wallets / org data). Plaintext snapshots in S3 are a leak waiting to happen. Rejected on the same grounds the wallet was already encrypted in ADR-0028.
5. **GPG instead of age** — GPG works but the UX is awful and the keyring story is fragile. Age was built specifically to be "the file-encryption equivalent of `ssh-keygen` + `chmod 600`" and that is exactly the shape we want.
