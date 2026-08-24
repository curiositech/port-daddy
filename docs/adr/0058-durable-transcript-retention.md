# 0058. Durable transcript retention — every agent transcript survives DB loss

## Status

Accepted

## Context

Every Port Daddy agent spawn records its full conversation to the
`fleet_transcripts` / `fleet_transcript_messages` / `fleet_transcript_outputs`
tables (`lib/transcripts.ts`) in the live daemon SQLite DB
(`port-registry.db`). An investigation on 2026-06-15 found that **this is the only
durable copy**, and it has real loss holes:

- **Backups are opt-in.** `pd backup` exists with GFS retention, but the launchd
  schedule is not installed on daemon start (`lib/backup-schedule.ts`). An operator
  who never runs `pd backup schedule` has zero backups.
- **No external/warehouse export.** A grep for `warehouse`/`export`/`s3`/`bigquery`/
  `jsonl` against the transcript path returned nothing. The only "export" is the
  binary gzipped DB snapshot a backup produces.
- **DB loss = total loss.** If `port-registry.db` is deleted, corrupted, or reset,
  every transcript is gone with no independent copy.

The operator's directive was unambiguous: *"WE MUST LOG ALL OF OUR PORT DADDY AGENT
TRANSCRIPTS TO OUR DATA WAREHOUSING SOLUTION. IT'S OK IF NOT OUR SQL TABLE BUT WE
MUST RETAIN."* The live SQL table is not the retention guarantee; durability is.

## Decision

**Add an always-on, immutable durable archive outside the live DB, written on
every transcript finalization.** It is the retention floor and the on-ramp to an
external warehouse.

- **`lib/transcript-archive.ts`** — `createJsonlTranscriptArchive({ dir })` returns
  a `TranscriptArchiveSink` that writes each finalized transcript, in full (header +
  messages + outputs), as one immutable JSONL artifact at
  `<root>/YYYY-MM-DD/transcript-<sha256>.jsonl` under
  `~/.port-daddy/transcripts/` (overridable via
  `PD_TRANSCRIPT_ARCHIVE_DIR`). Each writer creates its own unpredictable
  `O_EXCL`/`O_NOFOLLOW` private temp, completes every byte, fsyncs the temp,
  atomically publishes the content-addressed target, verifies the exact bytes,
  and fsyncs the partition and root directories before success. A failed or
  concurrent writer removes only its own unpublished temp; it never truncates
  or unlinks another writer's retained artifact. Roots and day partitions are
  created or clamped to `0700`; temps and final artifacts are `0600`.
  Every existing component from the filesystem anchor through the configured
  root and partition is checked with `lstat`; static symlink ancestors,
  non-regular files, owner mismatches, and multiply-linked targets fail closed.
  The approved archive root remains configurable but must resolve to that
  symlink-free anchored directory chain.
- **The hook and lifecycle race.** `lib/transcripts.ts` accepts an
  `archiveSink`, called from terminal `finalize()` and from `recordTranscript()`
  only when the imported snapshot is terminal. Message and output appends are
  single status-conditional writes, so once any terminal snapshot is committed
  its header and child content are immutable. The first `finalize()`/spawner
  terminal transition wins, so a late backend completion cannot rewrite an
  operator kill, emit a second terminal event, or archive that transition twice.
  Finalize/import archive the canonical snapshot freshly read from the private
  DB before any synchronous listener receives a mutable event object.
  `recordTranscript()` is a trusted in-process full-snapshot importer: while a
  row is running it atomically replaces the complete message/output child sets,
  making retries and running-to-terminal import idempotent; it cannot reopen or
  rewrite an already terminal row and has no HTTP route. Both lifecycle entry
  points stamp the reserved `port-daddy:spawner-transcript` producer,
  `INTERNAL` trust tier, and daemon clock themselves. Caller-shaped producer
  fields are ignored; migrated rows remain explicitly `null` rather than being
  retroactively laundered into trusted evidence. A sink/receipt failure
  never rewrites a completed spawn into failure, but is logged loudly and
  remains internally retryable.
- **Exact artifact receipts.** `fleet_transcript_archive_receipts` binds the
  canonical snapshot digest to the exact artifact locator, SHA-256, byte length,
  format, attempt count, and success/failure timestamps. A generic success bit,
  malformed locator, stale snapshot digest, or mismatched artifact evidence is
  persisted as failure, never as retained content. Receipt writes are
  conditional: the first exact success is immutable. Same-digest races skip or
  increment attempt accounting; an interleaved late failure or
  different-digest success cannot replace the retained receipt.
- **Default on.** `server.ts` wires the JSONL archive by default. Opt out only via
  `PD_TRANSCRIPT_ARCHIVE=off`. Retention is no longer something an operator can
  forget to enable.
- **Backfill.** The trusted in-process `transcripts.backfillArchive()` helper
  currently retries up to the 50 most recent terminal snapshots. It has no
  public HTTP or CLI action. Exact successes skip without another sink write;
  failures and incomplete legacy receipts retry; `archived` counts only exact
  durable successes. There is no automatic failed-receipt retry, and failures
  older than that newest-first window are not self-healing. This bounded helper
  is not yet the complete cursor-driven operator repair action.
- **Residual pathname race.** The Node implementation uses pathname operations
  plus `O_NOFOLLOW`, ownership/link-count checks, exact file-descriptor identity,
  and private modes, but it does not use an `openat`/dirfd-bound publication
  chain. A hostile same-UID process able to rename or swap an approved root or
  partition component during publication can still redirect a name-based
  operation. Closing that local-adversary gap requires a dirfd-relative native
  publication primitive; this PR does not claim that stronger guarantee.
- **Pluggable warehouse.** External sinks (S3/R2/BigQuery) implement the same
  `TranscriptArchiveSink` interface and are wired in place of (or alongside) the
  JSONL archive. Replacement sinks must return the same exact-artifact evidence;
  `{ ok: true }` alone is not retention.

### Mutation-authority boundary

`routes/transcripts.ts` is read-only. The credentialless full upsert,
message/output append, delete, and archive-backfill handlers are not registered,
the transcript module exports no delete primitive, and the public CLI exposes
only list/show/watch/cost. Loopback or Unix socket
possession, actual-peer metadata, process identity, `Host`, `X-Forwarded-For`,
automation-marker omission, reusable actor credentials, and caller-supplied
redemption receipts therefore cannot reach transcript mutation through this
surface. Daemon-owned spawner/import code uses the in-process API directly.

Any future delete or operator backfill is a new action surface, not a legacy
downgrade. It must redeem a one-use actor/action/resource-scoped capability
directly with the broker. Delete must additionally fail closed unless the exact
current terminal snapshot already has, or synchronously obtains, a matching
durable success receipt. That future delete is live-DB pruning, not privacy
erasure.

## Consequences

- **Positive.** Each finalized agent transcript makes an immediate durable
  archive attempt with exact success/failure accounting outside the live DB.
  Successful immutable artifacts survive loss of the live database, and failed
  attempts stay explicitly retryable instead of masquerading as retention.
- **Cost.** One immutable artifact publication per finalized run, including file
  and directory fsyncs, plus modest disk growth under
  `~/.port-daddy/transcripts/`. A retention/rotation policy is a follow-up;
  until then the bias is deliberately toward keeping everything.
- **Reversible.** `PD_TRANSCRIPT_ARCHIVE=off` disables it; the archive files are
  plain one-record JSONL artifacts on disk. Disabling the sink does not grant
  permission to prune the live copy.

## Related

- `lib/backup.ts` / `lib/backup-schedule.ts` — the DB-snapshot backup path this
  complements (backups protect the DB; the archive protects transcripts even when
  the DB itself is gone).
- ADR-0045 — loud-fail invariants (the archive reports retention failures loudly).
- Operator directive 2026-06-15: "WE MUST RETAIN."
