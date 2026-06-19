# External Agent Transcript Ingestion — PD-Side Design

Status: design only, no code written. Companion to whatever the reconnaissance
agent ships about external transcript formats.

The headline finding before the design: **PD already has a `transcript_events`
table and a `createTranscriptStore()` module**, defined at
`lib/transcript-store.ts:158-179`. It is currently *defined but not wired into
`server.ts`* — `grep` for `createTranscriptStore` returns only the definition
and references from `lib/cost-ledger.ts` that read the table. Cost-ledger
treats it as already-canonical. This design therefore is not "build a new
transcript store"; it is "wire up the existing one, plus the external tailer
that feeds it, plus the projections that make it visible."

---

## 1. Existing PD Surface (cite-and-read)

### 1.1 Transcript store — already exists, not wired

- `lib/transcript-store.ts:35-58` defines `TranscriptRole` (`system | user |
  assistant | tool | thinking | audit`) and `TranscriptEventType`
  (`turn_complete | token | tool_call | tool_result | error | awaiting_input
  | input_received | cli_call | mcp_call`). Schema at lines 158-179. Indexes
  on `(actor_id, ts)`, `(session_id, ts)`, `(event_type, ts)`, `(turn_id, ts)`.
- Content cap: 1 MB per row, truncation flag in metadata
  (`lib/transcript-store.ts:130-132,153`).
- Cost-ledger (`lib/cost-ledger.ts:117-118`) already `SELECT`s from
  `transcript_events`; aggregator view at line 173. So the store has a
  downstream consumer waiting on writes.
- Header comment (`lib/transcript-store.ts:1-28`) explicitly anticipates
  external-process ingest: *"the spawner runs Claude/Codex/Gemini/Cloudflare/
  Ollama as subprocesses, the `pd` CLI shells out... none of those streams
  land anywhere durable."*

**Design implication:** we extend `TranscriptEventType` (or just *use*
`turn_complete`) and add a `source` discriminator in `metadata` rather than
inventing a parallel `agent_transcripts` table. Rejected alternative below.

### 1.2 Sessions, sugar, and `.portdaddy/current.json`

- `lib/sessions.ts:180-222` — sessions table: `id`, `purpose`, `status`,
  `phase`, `agent_id`, `worktree_id`, `identity_project`, `metadata`. Notes
  table at `:213-221`.
- `lib/sugar.ts:122-257` `begin()` registers agent + starts session
  atomically; logs activity event `sugar_begin` (`:243-254`). `done()` at
  `:263-362` ends session + unregisters agent. This is what writes
  `.portdaddy/current.json`.
- `cli/utils/current-context.ts:4-13` defines `CurrentContext`:
  `{ agentId, sessionId, agentName?, sessionName?, purpose?, identity?,
  startedAt?, contextSlot? }`.
- Key wrinkle for attribution: contexts are **slot-keyed**
  (`current-context.ts:19-38`): slot = `CODEX_THREAD_ID` ?? TTY basename ??
  `TERM_SESSION_ID` ?? `ppid`. Stored under
  `.portdaddy/contexts/<slot>.json` with a legacy mirror at
  `.portdaddy/current.json`. This is the seam we use for "which PD session
  does this Claude Code transcript turn belong to?"

### 1.3 Salvage / resurrection

- `lib/resurrection.ts:75-110` — `resurrection_queue` table; pending agents
  surface in `pd salvage`.
- `routes/resurrection.ts:182-200` — `/salvage/*` routes plus deprecated
  `/resurrection/*` aliases.
- `cli/commands/resurrection.ts:217-260` — `triageSalvageAgents()` buckets
  agents into `resume-now | verify-dismiss | test-noise | no-evidence |
  archive-later` using purpose + notes. Currently *blind to transcript
  content* — that's the visibility gap this design closes.

### 1.4 Tube — envelope, threading, blob references

- `lib/tube.ts:43-55` — wire format `{ v:1, kind:'tube.msg', body, inReplyTo? }`,
  posted to `/msg/:channel`. Threading is via `inReplyTo`.
- `lib/tube.ts:478-518` — `send()` and `reply()` helpers. Daemon-side
  messages table at `lib/db.ts:88-96` (untyped JSON `payload`).
- Roadmap (`docs/plans/TUBE-AS-COORDINATION-SUBSTRATE-ROADMAP.md:34-43`)
  names three patterns Tube unlocks. Performatives (`request | inform |
  propose | accept | refuse | cfp | failure`) arrive in Phase 4
  (`:109-116`), drawn from `fipa-00037-communicative-act-library`. Phase 0
  blob store mandate (`:53-54`) is *already implemented* at `lib/blob.ts`.
- Critical roadmap blocker (`:50-51`): **harbor-token capability enforcement
  is verified-but-toothless**. Anyone on the daemon socket can post any
  tube performative. We design around this — see §3.4.

### 1.5 Episodic memory

- `lib/episodic-memory.ts:146-174` — `episodic_memory` table with
  `(source_type, source_id, episode_type)` unique key. Already
  upsert-idempotent (`:177-192`). `remember()` projects into tuples and
  graph edges (`:266-339`). This is where *summarized* transcript context
  belongs, not raw turns.

### 1.6 Blob store — already in place

- `lib/blob.ts:1-23` — Phase 0 of the tube roadmap landed. Content-addressed
  filesystem store at `~/.port-daddy/blobs/<sha>`. Crash-safe via
  tmp+rename. Default 50 MB cap. We use this for the spill path described
  in §3.3.

---

## 2. Constraints and Non-Goals

- **Read-only on the source.** PD must never `unlink` or rotate a
  `~/.claude/projects/.../*.jsonl` file. The source-of-truth lives in
  Claude Code / Codex.
- **No keyword-based NLP** (user-level rule). Attribution and turn-classification
  must use cwd + slot + timestamp joins, never substring matching on content.
- **No `/tmp`.** Tailer state lives under `~/.port-daddy/` (PD_HOME).
- **Existing schema first.** Reuse `transcript_events`, sessions, episodic
  memory, blobs. Don't open a parallel `agent_transcripts` table — see §3.3.
- **Idempotent ingest.** A turn may be re-read because the JSONL grew, the
  tailer restarted, or the file was rotated. Same turn ID must produce one
  row.

---

## 3. Proposed Architecture

### 3.1 Tailer location: **in-daemon background task**

Picked over the four candidates:

| Option | Verdict | One-line "why not" |
|---|---|---|
| **In-daemon background task** | **Picked** | Lives with the DB and current-context resolver; no cross-process auth dance. |
| Separate worker spawned by daemon | Rejected | Adds an IPC hop for what is fundamentally a `fs.watch` + SQLite insert loop. |
| `pd watch transcripts` foreground command | Rejected | Requires the user to keep a terminal open; tailer must run while VS Code Claude Code is open and zsh is closed. |
| Standalone launchd service | Rejected | Doubles the always-on surface area; user already runs `com.portdaddy.daemon`. Re-using it is simpler. |

**Module shape.** New file `lib/transcript-tailer.ts`. Factory
`createTranscriptTailer({ db, transcriptStore, sessions, episodicMemory,
blob, tube, logger })` returns `{ start(), stop(), status() }`. Wired in
`server.ts` after `transcriptStore` is constructed, before routes mount.

**Inside the tailer.**

1. **Source registry.** Hard-coded sources V1: `claude-code` (Claude Code
   JSONL) and `codex-cli` (format TBD by recon agent). Source defines:
   - root dir (`~/.claude/projects/`)
   - file-glob and parser (`parseClaudeJsonl(line) → TranscriptEventInput[]`)
   - cwd-encoding rule (Claude encodes cwd in the *directory name* —
     `-Users-erichowens-coding-port-daddy/`)
2. **Discovery sweep** on start: walk root, decode each `<encoded-cwd>/`
   into an absolute cwd, build `Map<cwd, sessionFile[]>`.
3. **Watcher per source.** Single `chokidar`-style watcher per root
   (recursive). On `add`/`change`, schedule a debounced (250 ms) parse pass
   for that file.
4. **Per-file cursor.** Persist `{ inode, dev, lastOffset, lastTurnId,
   updatedAt }` in a new table `transcript_source_cursors` (schema in
   §3.3). Parse from `lastOffset` forward; partial trailing lines are
   buffered until next change.
5. **Per-turn dedup.** Compose external turn id with the source:
   `turnId = "claude-code:<session-uuid>:<n>"` (n = ordinal within file).
   Insert is gated by `INSERT OR IGNORE` on a `UNIQUE(source, turn_id)`
   index — see §3.3.
6. **Backpressure.** If `transcript_events` is more than ~50k rows behind
   the file (tailer was down for a long time), batch-insert in chunks of
   500 inside a transaction and skip projection (tube/episodic) for the
   backfilled rows — just stamp them with `metadata.backfilled=true`.

**Failure modes the tailer must survive.**
- File rotated or replaced (different inode) → start from offset 0.
- File truncated (offset > size) → reset offset to 0, log warning.
- Parse error on a single line → record an `event_type='error'` row with
  the raw line in `metadata.rawLine`, advance cursor past it. Never block
  the file.
- DB locked → exponential backoff, retry. Mirror PD's existing
  `busy_timeout=5000` posture (`lib/db.ts:244`).

### 3.2 Attribution algorithm: cwd + slot + timestamp join

Goal: given an external turn arriving from `~/.claude/projects/<encoded-cwd>/
<sid>.jsonl` at time `ts`, decide which PD `session_id` (if any) it belongs
to.

**Step 1 — decode cwd.** Claude Code's encoding scheme is a straight
slash→hyphen swap; `parseClaudeProjectDir('-Users-erichowens-coding-port-daddy')
→ '/Users/erichowens/coding/port-daddy'`. (Recon agent will confirm.)

**Step 2 — look up `.portdaddy/contexts/`.** Read every
`<cwd>/.portdaddy/contexts/*.json` (slot-keyed, see §1.2) and the legacy
`current.json`. Each yields a `{ agentId, sessionId, startedAt }`.

**Step 3 — overlap test.** A candidate slot wins if:
- the slot file's mtime is before `ts`, AND
- `startedAt <= ts`, AND
- the session is still `status='active'` in DB at `ts`, AND
- (when multiple match) tie-break by *most-recent slot mtime*.

**Step 4 — fallbacks.**
- *Multiple active sessions in cwd, none distinguishable.* Attribute to a
  synthetic "ambient" session `cwd:<cwd>:ambient` and log a
  `transcript_attribution_ambiguous` activity row. The operator can
  re-attribute later via `pd transcripts attribute --turn <id> --session
  <id>`.
- *No active session.* Two options — see §4 Tradeoff 4. Recommend opt-in
  "phantom session" auto-creation gated by a config flag, default OFF.
  V1: drop the turn into `transcript_events` with
  `session_id=NULL, actor_id='external:claude-code:<sid>',
  metadata.unattributed=true`. Salvage panel surfaces unattributed turns
  separately.

**Step 5 — caching.** Tailer caches `cwd → activeSessions[]` for 5 seconds
to avoid hitting the sessions table once per turn.

**This algorithm is structural, not semantic.** No content inspection,
which is critical for performance and the no-keyword-NLP rule.

### 3.3 Storage: extend `transcript_events`, add cursor table, blob spill

**Reuse, don't replace.** `transcript_events` already has the right shape
(role, eventType, content, turnId, tokens, model, metadata). What's
missing is two things:

1. **A `source` column.** Today the table tacitly assumes every writer is
   PD-internal. We add a column to discriminate:

```sql
ALTER TABLE transcript_events ADD COLUMN source TEXT NOT NULL DEFAULT 'internal';
CREATE INDEX idx_transcript_source_ts ON transcript_events(source, ts DESC);
CREATE UNIQUE INDEX idx_transcript_source_turn
  ON transcript_events(source, turn_id) WHERE source != 'internal';
```

`source` enum: `internal | claude-code | codex-cli | gemini | aider |
external`. The partial unique index gives us idempotent ingest without
constraining internal writers that may reuse turn-ids.

2. **A cursor table** for the tailer:

```sql
CREATE TABLE transcript_source_cursors (
  source TEXT NOT NULL,
  source_path TEXT NOT NULL,
  inode INTEGER NOT NULL,
  dev INTEGER NOT NULL,
  last_offset INTEGER NOT NULL DEFAULT 0,
  last_turn_id TEXT,
  last_seen_ts INTEGER NOT NULL,
  PRIMARY KEY (source, source_path)
);
```

**Field-by-field on the existing `transcript_events`, mapped from a Claude
JSONL turn:**

| Column | Source |
|---|---|
| `actor_id` | `claude-code:<session-uuid>` |
| `session_id` | resolved PD session id (or NULL) |
| `turn_id` | `claude-code:<session-uuid>:<n>` |
| `role` | message.role (`user`/`assistant`/`tool` → existing enum) |
| `event_type` | `turn_complete` for completed assistant turns; `tool_call`/`tool_result` for tool turns |
| `content` | text content or stringified tool call; spilled to blob if > threshold |
| `tokens_in`/`tokens_out` | usage block if present |
| `model` | message.model |
| `backend` | derived from source (`claude-code-cli`) |
| `cost_usd` | computed from tokens × pricing (already done by cost-ledger) |
| `metadata` | `{ source, sourcePath, sourceLineNum, blobId?, blobSize?, redactions?, parentTurnId? }` |
| `source` | `claude-code` |
| `ts` | message.timestamp (ms) |

**Size budget.** The existing 1 MB row cap (`lib/transcript-store.ts:153`)
is the floor. Anything larger spills:

- `content` ≤ 16 KB → store inline.
- 16 KB < `content` ≤ 1 MB → store inline (existing behavior).
- `content` > 1 MB → `blob.put(content)`, store
  `metadata.blobId = <sha256>`, set `content = '[blob:<sha8>]'`.
- The tailer also spills any `tool_result` containing a base64 payload
  regardless of size, by sniffing for the data-URL prefix (structural, not
  content-keyword).

**Defended default**: inline up to 1 MB, blob above. Reason: 95% of turns
will be under 16 KB; the average user generates 50-200 turns/day; even
storing every turn full-text at 4 KB average is ~30 MB/year/cwd — fine for
SQLite. The cliff for blob spill is only hit by big tool results
(screenshots, file reads), which are exactly what the blob store exists
for.

**Rejected alternative:** *path+offset only, lazy-read on query.* Why not:
breaks `pd salvage` rendering when the source file is rotated or deleted,
breaks portability (the operator's tarball of `~/.port-daddy/` should
contain everything needed to reconstruct context), and the cost-ledger
view already assumes content is present.

**Rejected alternative:** *new `agent_transcripts` table.* Why not: forces
us to fork the cost-ledger view, duplicates the indexing surface area, and
the existing role/eventType enum is already correct for external sources.

### 3.4 Tube projection: opt-in `inform` performative, per-turn

**Default: do not project to Tube.** Tube messages persist in the
`messages` table and broadcast over SSE. Projecting every Claude Code turn
would flood subscribers and bloat the SSE buffer.

**Opt-in path.** A session can be marked `tube_project=true` in
`sessions.metadata`. When set, the tailer posts an `inform` performative
to `<project>:agent:transcript` on every `turn_complete` row:

```json
{
  "v": 1,
  "kind": "tube.msg",
  "act": "inform",
  "body": "<first 280 chars of turn content>...",
  "metadata": {
    "transcriptEventId": 12345,
    "actorId": "claude-code:abc-123",
    "sessionId": "<pd-session-id>",
    "source": "claude-code",
    "blobId": "<sha if spilled>"
  }
}
```

(The roadmap's Phase 4 introduces a top-level `act` field; we anticipate
it here as a metadata key on the envelope. Honest: this is a small
forward bet on the open spec.)

**Three opt-in modes**, all controlled by `sessions.metadata.tube_project`:

- `'off'` (default) — no projection.
- `'tool_calls'` — project only `event_type IN ('tool_call', 'tool_result',
  'error')`. Best for "what is the agent actually doing right now"
  dashboards.
- `'all'` — project every `turn_complete`. Spammy but full-fidelity.

**Per-session-burst alternative.** Considered batching a 30-second window
of turns into a single `inform` summarizing "agent did X, Y, Z." Rejected
for V1: requires a summarizer (Haiku call), which the user doesn't want
on every burst. Revisit when episodic-memory v2 lands.

**Capability gap.** Per the roadmap blocker (`:51`), anyone on the daemon
socket can post performatives. Until harbor-token capability binding
ships, we restrict `inform.transcript` posts to the daemon itself
(in-process call, not via HTTP). External writers cannot impersonate the
tailer.

### 3.5 Salvage surfacing — what the operator sees

Current `pd salvage` output (from `cli/commands/resurrection.ts:317-349`)
lists stale agents bucketed into `resume-now | verify-dismiss | ...`. The
classifier reads `purpose` and `notes` only — never transcript content.

**Proposed addition:** a new field on each salvage entry, populated by a
join into `transcript_events`:

```
⚓ Salvage Triage
────────────────────────────────────────────────────────────
Triage: 3 non-live queue entries
  status: 2 stale, 1 dead
  age:    1 <2h, 2 >24h

Resume now (2)
  Pick the most recent and run the suggested command.
  - claude-code:port-daddy-tube-design (stale, 47m ago) port-daddy:tube
    Reason: agent stopped mid-turn; last tool_call timed out
    Last turn: "Reading lib/transcript-store.ts to understand existing schema..."
    [12 turns, 4 tool_calls, last activity 47m ago]
    Evidence: session-note "Designing tailer module, need cursor table"
    Next: pd salvage claim claude-code:port-daddy-tube-design

  - codex-cli:website-redesign (dead, 26h ago) port-daddy:website
    Reason: codex usage-limit hit at 2026-05-18T18:00Z
    Last turn: error event_type='error', metadata.code='usage_limit'
    [3 turns, 0 tool_calls]
    Next: pd salvage dismiss codex-cli:website-redesign
```

The `[N turns, M tool_calls, last activity Xm ago]` summary line is a
**pure structural rollup** — count rows by `event_type` for the session,
no content inspection. The "Last turn" preview is the most recent
`turn_complete` row's first ~80 chars.

**Why this is a win.** Operator currently sees `purpose` ("Designing
tailer module") which is what *they typed* into `pd begin`. After this
lands, they see what the agent *actually did last*. That's the signal
that distinguishes `resume-now` from `archive-later`.

**Two new commands:**
- `pd transcripts tail <session-id>` — pretty-print the last N turns of a
  PD session. Live-follow with `--follow`.
- `pd transcripts attribute --turn <event-id> --session <session-id>` —
  reattribute an unattributed turn. Writes activity row.

### 3.6 Privacy / redaction

**Where redaction lives.** Per-turn, inside the tailer, *before* SQLite
insert. Three layers:

1. **Source-side trust.** Claude Code itself does not redact secrets in
   its JSONL. PD must not assume the source is clean.
2. **Structural redaction.** The tailer runs the same regex pack as
   `note-encryption.ts` redacts (see `lib/note-encryption.ts` if it
   exposes one — TBD reconfirm) on the content of every turn before
   insert. Matches are replaced with `[redacted:type]` and the count is
   stamped in `metadata.redactions = { count: N, types: ['aws-key'] }`.
   Original is never stored in cleartext; if the operator needs to see
   it, they can reread the source JSONL.
3. **Note-encryption parity.** If the resolved PD session has
   `wrapped_session_key` (note encryption enabled), the
   `transcript_events.content` field is encrypted with that key the same
   way `session_notes` is. Tailer must check `sessions.wrapped_session_key`
   on attribution and encrypt accordingly.

**Default redaction policy.** Aggressive — secrets > content. Match list:
- AWS keys (`AKIA...`, `aws_secret_access_key`)
- Generic OAuth tokens (`Bearer eyJ...`)
- Common API key prefixes (`sk-`, `ghp_`, `gho_`, `xox[bp]-`)
- Private key headers (`-----BEGIN ... PRIVATE KEY-----`)
- File paths under `~/.ssh/`, `~/.aws/`, `~/.config/gh/`

This is a fixed *structured pattern* list, not keyword-based topic
detection — it matches the user-level rule.

**Operator opt-out.** `pd config set transcripts.redact off` for users
who explicitly want full-fidelity capture. Stamped with a one-time
warning into activity log.

---

## 4. Tradeoffs the User Should Decide

Concrete two-option calls, with a recommendation and one-line "why." These
are explicitly not the designer's call.

1. **Inline content vs. path+offset link.**
   - A. Store turn content inline in `transcript_events.content` (recommended).
   - B. Store only `source_path + offset + length`, lazy-read at query time.
   - Recommendation: A. Why: portability + cost-ledger already assumes
     content is present; lazy-read breaks if the source JSONL is rotated.

2. **Auto-redact secrets vs. trust the source.**
   - A. Aggressive default-on redaction with opt-out (recommended).
   - B. No redaction; operator trusts their own setup.
   - Recommendation: A. Why: the user has explicitly worried about secret
     leakage; `note-encryption.ts` exists precisely because notes are
     sensitive — transcripts are at least as sensitive.

3. **Tube `inform` per turn vs. per session-burst summary.**
   - A. Opt-in per turn, three modes off/tool_calls/all (recommended).
   - B. Always project a 30s rolling summary per session.
   - Recommendation: A. Why: per-burst requires a summarizer call PD
     doesn't want to make automatically; per-turn off-by-default keeps
     Tube uncluttered for users who don't subscribe.

4. **Opt-in vs. opt-out attribution when no PD session is active.**
   - A. Drop unattributed turns into `transcript_events` with
     `session_id=NULL` and surface separately (recommended).
   - B. Auto-create a "phantom session" on first turn under a cwd with no
     active session.
   - Recommendation: A. Why: phantom sessions break the `pd begin`
     contract (the user signals intent by *starting* a session); auto-creation
     would flood the sessions table with one row per ad-hoc Claude Code
     conversation.

5. **Tailer scope: all cwds under `~/.claude/projects/` vs. only cwds with
   `.portdaddy/`.**
   - A. Only project cwds that contain a `.portdaddy/` directory
     (recommended).
   - B. Every cwd Claude Code knows about.
   - Recommendation: A. Why: respects the user's mental model — PD is
     opt-in per project. Capturing transcripts from arbitrary one-off cwds
     would surprise the user and inflate the DB.

6. **Token-stream events (`event_type='token'`) on or off.**
   - A. Off — only `turn_complete` rows (recommended).
   - B. On — capture every streaming token event.
   - Recommendation: A. Why: token events explode row count by ~100x with
     no salvage-time benefit; Claude Code's JSONL gives whole turns
     anyway.

7. **Codex CLI symmetry with Claude Code.**
   - A. Same module, swap parsers (recommended).
   - B. Two distinct ingestion modules with different schemas.
   - Recommendation: A. Why: the `source` column plus pluggable parser
     keeps the daemon code one path; per-source quirks belong in the
     parser, not the storage layer.

8. **Backfill on first install (historical JSONL files).**
   - A. Walk the full history on first start; insert all rows with
     `metadata.backfilled=true`; skip tube/episodic projection.
   - B. Only tail forward from install time; ignore history.
   - Recommendation: A. Why: the cost-ledger gains a year of free data,
     the user gets retroactive salvage signals, and the backfill flag
     keeps Tube clean.

---

## 5. Open Questions for the Operator

1. **Codex CLI format.** Awaiting the recon agent. Does Codex write JSONL,
   SQLite, both? Do its turn boundaries align with Claude Code's
   "assistant message complete"? Plan assumes JSONL with a per-turn line;
   if it's SQLite, the cursor table grows a `db_path + last_rowid` shape.

2. **Slot resolution in headless contexts.** `resolveContextSlot()` falls
   back to `ppid` (`current-context.ts:37`). When Claude Code runs in a
   GUI app (no TTY, no `TERM_SESSION_ID`, parent ppid is the Electron
   process), is there a stable slot signal we can read? Without it, two
   simultaneous Claude Code windows in the same cwd collide.

3. **Cost double-counting.** Cost-ledger reads from `transcript_events`
   already; if Claude Code's JSONL exposes cost (`usage` block), the
   tailer writing those rows will start showing actual costs in
   `pd usage`. Does the operator want that *added* to PD-internal LLM
   call costs, or kept in a separate "external" bucket?

4. **Retention.** No retention policy is proposed in V1 — `transcript_events`
   grows monotonically. At ~100 turns/day × 4 KB average = ~150 MB/year.
   Fine. But should there be a `pd transcripts gc --older-than 90d` command
   from day one, or do we wait for the table to grow?

5. **Encryption boundary.** If session note encryption is on, we encrypt
   `transcript_events.content`. But the metadata column (with `model`,
   `tokens`, `tool_call` names) is *not* encrypted in `session_notes`
   either — confirm that's the desired posture, or do we encrypt metadata
   too?

6. **Tube channel naming.** `<project>:agent:transcript` is the proposal.
   Alternatives: `<project>:agent:<actorId>:transcript`,
   `external:claude-code:<sid>`. The proposal flattens; the alternatives
   thread by actor. Which fits the dashboard?

7. **Worker isolation when ingesting.** The tailer reads and parses on the
   daemon's main thread. At 100 turns/sec sustained (paste-heavy
   sessions), parsing JSONL plus regex redaction could stutter the event
   loop. Do we want a worker_threads escape hatch from day one, or wait
   for symptoms?

8. **CLI surface.** Proposed two commands: `pd transcripts tail` and `pd
   transcripts attribute`. Operator may want others: `pd transcripts
   recent` (cross-session), `pd transcripts grep <pattern>` (full-text,
   would need FTS5 — out of scope for V1?). Confirm the V1 cut.

9. **Whose recon trumps whose design.** If the recon agent finds the
   Claude Code format is materially different from "JSONL one message per
   line" (e.g., multi-line JSON, binary headers, file-mode quirks), parts
   of §3.1 step 4 (per-file cursor) need revisiting. Flagging now so we
   merge sequentially, not in parallel.
