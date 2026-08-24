# Fleet Transcripts

Every fleet ship execution (spawn) is recorded as a `fleet_transcripts` row
in the SQLite DB, with its full conversation in `fleet_transcript_messages`
and any concrete artifacts in `fleet_transcript_outputs`. The operator can
read the conversation back via:

- `pd transcripts list` — recent ship runs
- `pd transcripts show <id>` — full conversation rendered to the terminal
- `pd transcripts watch` — live tail of new transcripts (SSE)
- `pd transcripts cost --since 1d` — cost rollup by ship + day
- `pd transcripts delete <id>` — destructive CLI bridge (confirmation is not
  server-side authority)
- The "Fleet Transcripts" panel in the Port Daddy dashboard

The HTTP surface lives at `/transcripts*`. See `routes/transcripts.ts`.

## What this MVP ships

- Every spawn that runs through the daemon records:
  - The system prompt (when `spec.systemPrompt` is set)
  - The user task
  - The full assistant response
  - The status, ended_at, cost_usd, tokens_in/out at finalization
  - An "outputs" row summarizing the result (`message` for success, `noop` for failure)
- The dashboard panel polls + subscribes via SSE so new rows appear live.
- Costs are aggregated in the panel header and via `pd transcripts cost`.
- Storage cost is ~5KB per typical ship run (one system + user + assistant
  message averaging ~1KB each plus the header row). Indefinite retention.

## What's NOT in this MVP (deferred follow-ups)

- **Live token-by-token streaming** of an in-flight LLM call. Today we record
  one assistant message at the end of the run. To stream tokens we'd need to
  hook each backend's streaming API (Anthropic, OpenAI, Codex, Ollama) and
  publish per-token deltas. Anthropic and OpenAI support it cleanly; Ollama
  and the `claude-cli` subprocess are harder. A reasonable shape would be a
  new `fleet:transcript-token-stream` SSE channel that re-emits SSE events
  from the backend SDK directly.

- **Diff overlay** showing what the ship's output changed in the repo. This
  needs git integration: snapshot HEAD before the run, diff after, and link
  the patch to the transcript. Best implemented as a new
  `fleet_transcript_diffs` table with `(transcript_id, path, before_sha,
  after_sha, patch_blob)`.

- **Re-run / fork from a checkpoint** — "what would happen if I rephrased
  message 4". This is a big design: requires forking the conversation tree,
  threading new agent IDs, and reconciling outputs back into the original
  transcript's lineage. Defer.

- **Per-ship recorder for non-spawner paths** — actors that call LLMs through
  `lib/llm-call.ts` directly (not via the spawner) are NOT yet recorded.
  Adding a hook in `lib/llm-call.ts` to record into `fleet_transcripts` is a
  natural follow-up; for now those calls go to `lib/transcript-store.ts`
  (event-level log) but not the run-level table.

- **Pd-tube CLI capture** — when the spawner runs `claude-cli` or `codex`
  as a subprocess, we currently store the final stdout as the assistant
  message. We don't try to segment intermediate CLI output into per-turn
  messages because each CLI's output format is different (and changes
  between versions). Treating the subprocess as a single black-box
  assistant turn is the honest MVP.

## Security

- **Secret scrubbing.** Common patterns (`*_API_KEY=`, `Bearer <token>`,
  `gh[pousr]_`, `sk-`, `sk-ant-`, `(sk|pk|rk)_(live|test)_`, AWS `AKIA…`)
  are redacted from message content and tool-call args before storage.
- **Tool-arg truncation.** Any string field inside tool-call args larger
  than 10 KB is truncated to 1 KB plus a SHA-256 hash for later auditing.
- **DB perms.** The SQLite file is `chmod 0600` (set in `lib/db.ts`). The
  transcripts table inherits the same restriction — `fleet_transcripts`
  contents are operator-readable only.

### Durable archive

- Each finalized snapshot is serialized as one JSONL record and published as
  `<root>/YYYY-MM-DD/transcript-<sha256>.jsonl`.
- Writers use unique `O_EXCL`/`O_NOFOLLOW` private temps, complete every byte,
  fsync before atomic publication, verify the final bytes, and fsync the
  partition/root directories. A failed writer removes only its own temp, so it
  cannot truncate or erase a concurrent writer's retained record.
- Archive roots and partitions are created or clamped to `0700`; temp and final
  files are `0600`. Symlink, non-regular, wrong-owner, and multiply-linked
  targets fail closed.
- `fleet_transcript_archive_receipts` records exact snapshot and artifact
  digests, locator, byte count, format, attempts, and success/failure. A generic
  success bit or mismatched evidence is failure. Replays skip only an exact
  matching success.
- Message/output appends are status-conditional writes. Once a transcript is
  terminal, its header and child content are immutable, so the receipt digest
  cannot be invalidated by a late append.
- The first terminal `finalize()` transition wins. An asynchronous backend
  completion cannot rewrite a prior kill or produce a second archive receipt.
- `recordTranscript()` emits an `end` event and archives only when its imported
  snapshot is terminal. Its header and children commit atomically and it cannot
  reopen a terminal row, but it remains the CAP0/BOOT0-blocked legacy full-entry
  bridge rather than trusted producer authority.
- The current manual backfill examines only the 50 newest terminal rows and has
  no automatic failed-receipt retry. Older failures are not self-healing until a
  cursor-driven repair action lands.
- Archive publication still uses Node pathname operations rather than an
  `openat`/dirfd-bound chain. Existing no-follow, mode, owner, link-count, and
  descriptor checks do not fully stop a hostile same-UID parent/name swap; a
  native dirfd-relative publisher is required for that stronger threat model.

### Write-authority blocker

The current `POST`/`DELETE` routes in `routes/transcripts.ts` are a legacy,
self-asserted bridge. They are not authenticated operator authority, including
on real loopback or Unix transport. Do not treat CLI confirmation, peer/process
metadata, `Host`, forwarding headers, reusable actor credentials, or a
caller-supplied redemption receipt as permission to mutate transcripts.

CAP0/BOOT0 must land before Q1 can supplant these endpoints. Delete/backfill
must redeem a one-use action/resource/actor-scoped capability directly in the
route/action service, and delete must also prove an exact durable archive
receipt for the current terminal snapshot. The storage slice does not activate
automatic Parley or make these mutation routes final.

## Schema (DDL)

See `lib/transcripts.ts` `SCHEMA_STATEMENTS` for the source of truth.
Summary:

```sql
CREATE TABLE fleet_transcripts (
  id TEXT PRIMARY KEY,
  ship TEXT NOT NULL,
  session_id TEXT,
  spawned_agent_id TEXT NOT NULL,
  pr_number INTEGER,
  issue_number INTEGER,
  trigger TEXT NOT NULL,
  backend TEXT NOT NULL,
  model TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  cost_usd REAL,
  tokens_in INTEGER,
  tokens_out INTEGER,
  error TEXT,
  project TEXT,
  identity TEXT
);

CREATE TABLE fleet_transcript_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transcript_id TEXT NOT NULL REFERENCES fleet_transcripts(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  tool_calls_json TEXT
);

CREATE TABLE fleet_transcript_outputs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transcript_id TEXT NOT NULL REFERENCES fleet_transcripts(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  type TEXT NOT NULL,
  url TEXT,
  summary TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE fleet_transcript_archive_receipts (
  transcript_id TEXT PRIMARY KEY,
  content_sha256 TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('succeeded', 'failed')),
  attempted_at INTEGER NOT NULL,
  succeeded_at INTEGER,
  last_error TEXT,
  artifact_locator TEXT,
  artifact_sha256 TEXT,
  artifact_bytes INTEGER,
  artifact_format TEXT,
  attempts INTEGER NOT NULL DEFAULT 1
);
```

## Hooking a fleet ship into transcripts

Spawner-owned in-process calls are the canonical producer path. The current
`POST /transcripts/:id/outputs` bridge can still append an output, but it is
unauthenticated and therefore cannot establish trusted producer provenance.
Do not add callers to that bridge while Q1 is blocked on CAP0/BOOT0; the
authority lane must supplant it rather than preserve a downgrade.
