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

**Add an always-on, append-only durable archive outside the live DB, written on
every transcript finalization.** It is the retention floor and the on-ramp to an
external warehouse.

- **`lib/transcript-archive.ts`** — `createJsonlTranscriptArchive({ dir })` returns
  a `TranscriptArchiveSink` that writes each finalized transcript, in full (header +
  messages + outputs), as one **fsync'd** JSON line to a UTC-day-partitioned file
  `transcripts-YYYY-MM-DD.jsonl` under `~/.port-daddy/transcripts/` (overridable via
  `PD_TRANSCRIPT_ARCHIVE_DIR`). Append-only, durable, independent of the DB — it
  survives a dropped/corrupted/reset `port-registry.db`.
- **The hook.** `lib/transcripts.ts` gains an `archiveSink` option, called
  fire-and-forget from both terminal paths (`finalize()` and `recordTranscript()`).
  A sink failure NEVER blocks a spawn or the DB write — but it is logged **loudly**,
  because a silent retention failure is the one outcome the directive forbids.
- **Default on.** `server.ts` wires the JSONL archive by default. Opt out only via
  `PD_TRANSCRIPT_ARCHIVE=off`. Retention is no longer something an operator can
  forget to enable.
- **Backfill.** `transcripts.backfillArchive()` (exposed at
  `POST /transcripts/archive/backfill`) re-archives every transcript already in the
  DB, so "log ALL transcripts" covers history, not just runs since the archive was
  switched on.
- **Pluggable warehouse.** External sinks (S3/R2/BigQuery) implement the same
  `TranscriptArchiveSink` interface and are wired in place of (or alongside) the
  JSONL archive. The directive's "data-warehousing solution" is satisfied by the
  local archive today and any cloud sink tomorrow, with no change to the hot path.

## Consequences

- **Positive.** Every agent transcript is durably retained the moment it finalizes,
  outside the live DB, regardless of whether the operator ever configures a backup.
  The JSONL format is greppable, streamable, and trivially shipped to a cloud
  warehouse. DB loss no longer means transcript loss.
- **Cost.** One fsync'd append per finalized run (finalize fires once per run, so
  this is not a hot loop) and modest disk growth under `~/.port-daddy/transcripts/`.
  A retention/rotation policy for the archive files is a follow-up; until then the
  bias is deliberately toward keeping everything (the directive is "retain").
- **Reversible.** `PD_TRANSCRIPT_ARCHIVE=off` disables it; the archive files are
  plain JSONL on disk.

## Related

- `lib/backup.ts` / `lib/backup-schedule.ts` — the DB-snapshot backup path this
  complements (backups protect the DB; the archive protects transcripts even when
  the DB itself is gone).
- ADR-0045 — loud-fail invariants (the archive reports retention failures loudly).
- Operator directive 2026-06-15: "WE MUST RETAIN."
