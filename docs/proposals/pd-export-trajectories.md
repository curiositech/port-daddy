# Spec: `pd export trajectories`

Status: Proposed (companion to ADR-0052; this document is the normative spec
for phase 0–2 of its Implementation Matrix).

One command that turns the daemon's canonical SQLite into **Episode JSONL** —
session-rooted, time-ordered coordination trajectories with honest outcome
labels and versioned reward annotations. Read-only over the DB. Every consumer
in ADR-0052 (bench, prompt optimization, SFT/DPO, RLVR) treats this format as
its contract.

## 1. Command surface

```
pd export trajectories [options]

Selection
  --project <name>         Filter by sessions.identity_project
  --session <id>           Export exactly one session (repeatable)
  --since <ts|dur>         Window start: epoch ms, ISO date, or duration (e.g. 30d)
  --until <ts|dur>         Window end (default: now)
  --status <s>             completed | abandoned | active | all  (default: completed,abandoned)
  --actor <agent-id>       Filter by sessions.agent_id

Content
  --include-transcripts    Inline sortie/fleet transcript messages into steps
                           (default: off — summaries only; transcripts are huge)
  --label-outcomes         Run outcome labelers (default: on)
  --annotate-rewards       Attach coordination-reward rubric scores (default: on)
  --no-redact              Disable redaction (local use only; refused if the
                           output path is outside the user home)

Output
  --out <file|->           Output path or stdout (default: stdout)
  --format jsonl|json      jsonl = one episode per line (default); json = array
  --cursor <token>         Resume an incremental export
  --limit <n>              Max episodes this invocation (default: unbounded)
  -q                       Suppress progress on stderr
```

Exit codes: `0` success (including zero episodes), `1` daemon unreachable or DB
error, `2` invalid flags, `3` refused `--no-redact` destination.

Examples:

```bash
# Everything completed in the last 30 days for this repo, redacted, to a file
pd export trajectories --project port-daddy --since 30d --out episodes.jsonl

# One session, full transcripts, for replay debugging
pd export trajectories --session session-abc123 --include-transcripts --format json

# Incremental nightly export (cursor persisted by the caller)
pd export trajectories --since 24h --cursor "$(cat .cursor)" --out - >> corpus.jsonl
```

## 2. Daemon route and MCP tool

- **Route**: `GET /export/trajectories` (Fastify plugin `routes/export.ts`, <!-- cite-exempt -->
  registered in `routes/index.ts` per the existing plugin pattern). Query
  params mirror the CLI flags. Response is `application/x-ndjson`, streamed.
  Pagination: `limit` + opaque `cursor` (see §6). The CLI is a thin client
  over this route — no direct DB access from the CLI process, matching every
  other command.
- **MCP tool**: `export_trajectories` in `mcp/server.ts`. Same params; returns
  `{ episodes: [...], next_cursor }` with a hard server-side `limit` ceiling
  of 50 episodes per call (MCP responses are not a bulk channel; agents page).
  No exemption — agents are first-class consumers of their own history.
- **Manifest**: new feature row in `features.manifest.json` with CLI + route +
  MCP surfaces, so parity tests enforce all three.

## 3. Episode schema (v1)

Top-level envelope, one per session:

```jsonc
{
  "schema_version": "trajectory/1.0.0",
  "episode_id": "ep_<sessions.id>",
  "exported_at": 1781000000000,
  "redaction": { "applied": true, "ruleset": "redact/1" },

  "session": {
    "id": "...",                      // sessions.id
    "purpose": "...",                 // sessions.purpose
    "status": "completed",            // sessions.status
    "phase": "...",                   // sessions.phase
    "identity_project": "port-daddy", // sessions.identity_project
    "worktree_id": "...",             // sessions.worktree_id (nullable)
    "agent_id": "...",                // sessions.agent_id (nullable)
    "created_at": 0, "completed_at": 0, "duration_ms": 0,
    "metadata": { }                   // sessions.metadata, JSON-parsed, redacted
  },

  "actor": {                          // joined from agents + sorties when linkable
    "agent_id": "...",
    "backend": "claude-cli",          // sorties.backend when session born of a sortie
    "model": "...", "model_tier": "...",
    "via_sortie": "sortie-id-or-null"
  },

  "steps": [ /* §4 — merged, time-ordered */ ],

  "claims": [                         // session_files, final state summary
    { "file_path": "...", "start_line": null, "end_line": null,
      "symbol": null, "claimed_at": 0, "released_at": 0,
      "edited": true }                // see §5.3 — evidence-based, else null
  ],

  "outcome": { /* §5 */ },

  "rewards": {                        // present iff --annotate-rewards
    "rubric": "coordination-reward/1",
    "terminal": 1.0,
    "components": { "task_completed": 1.0, "claim_hygiene": -0.2, /* ... */ },
    "notes": [ "claim_hygiene: 3 files claimed, 1 edited, 4.2h hold" ]
  },

  "costs": {                          // aggregated from cost_events by identity/spawn_id
    "usd": 1.83, "input_tokens": 412000, "cached_input_tokens": 250000,
    "output_tokens": 38000, "events": 14, "is_estimate_any": false
  }
}
```

Schema versioning: semver string; **additive changes bump minor**, breaking
changes bump major and keep the old writer available behind
`--schema-version`. The JSON Schema file lives at
`docs/proposals/schemas/trajectory-v1.schema.json` and is the artifact tests <!-- cite-exempt -->
validate against (same discipline as the jury_rig schemas).

## 4. Steps: the merged timeline

Each step is `{ "ts": <ms>, "seq": <int>, "kind": <string>, ...payload }`.
`seq` is a monotonic tiebreaker assigned at export time for stable ordering
when timestamps collide (§6). Kinds and their sources:

| kind | Source table | Payload |
|---|---|---|
| `note` | `session_notes` | `content` (redacted), `note_type` (the `type` column — `note`, structured prefixes like `feat` from the changelog bridge) |
| `claim` / `release` | `session_files` (`claimed_at` / `released_at`) | `file_path`, `start_line`, `end_line`, `symbol` |
| `activity` | `activity_log` (rows where `agent_id` or `target_id` matches the session/agent) | `activity_type` (the `type` column, e.g. `claim_violation`), `details`, `metadata` |
| `sortie_event` | `sortie_events` via linked sortie | `event_type`, `summary` (metadata inlined only with `--include-transcripts`) |
| `inbox_in` / `inbox_out` | `agent_inbox` | counterpart actor, `subject`/summary, redacted body |
| `message` | `messages` (channels the agent published to) | `channel`, redacted content |
| `commitment_open` / `commitment_close` | `commitments` | `object_text`, `state`, `due_at`, kept-vs-breached |
| `lock` / `unlock` | `locks` | resource, ttl |
| `guard_verdict` | guard verdict store (phase 1, §5.2) | `decision` (`allow`/`block`), `rule`, `context` |
| `transcript` | `fleet_transcript_messages` / `transcript_events` | only with `--include-transcripts`; role + redacted content |

Inclusion rule: a row joins the episode if it references the session id
directly, or references the session's `agent_id` within
`[created_at, completed_at + 5min]`. The 5-minute tail catches
post-completion bookkeeping (final notes, releases) without absorbing the
agent's next session.

## 5. Outcome labeling (phase 1)

The `outcome` object. **Honesty rule (ADR-0045 discipline): every field is
`VERIFIED`, `UNKNOWN`, or absent — the labeler never guesses.** A label is
`VERIFIED` only when the full evidence chain exists and each link is named in
`evidence`.

```jsonc
"outcome": {
  "label": "VERIFIED_GOOD" | "VERIFIED_BAD" | "MIXED" | "UNKNOWN",
  "closure": { "kind": "done" | "abandoned" | "active",
               "result_note": true },          // a Result: note exists
  "pr": { "status": "VERIFIED" | "UNKNOWN",
          "number": 123, "merged": true, "ci_green": true, "reverted": false,
          "evidence": ["note#841 structured prefix", "branch worktree-...", "gh#123 mergedAt"] },
  "guard": { "status": "VERIFIED" | "UNKNOWN",
             "checks": 4, "blocks": 1,
             "block_rules": ["note-rent"] },
  "collisions": { "caused": 0, "absorbed": 1 },   // claim_violation attribution
  "salvage": { "adopted_from": "agent-... | null",  // resurrection_queue claim
               "left_behind": false },              // session itself ended in the queue
  "commitments": { "kept": 2, "breached": 0 }
}
```

### 5.1 PR linkage

The weakest join in the system today, so the chain is explicit, in declining
confidence:

1. **Structured note prefix** — the ADR-0050 changelog bridge already parses
   `pd note --type feat`-style notes; a `pr:#N` token in any session note is
   authoritative.
2. **Worktree branch** — `sessions.worktree_id` → branch name → `gh pr list
   --head <branch>` (network call, only with `--label-outcomes`, cached in a
   `pr_links` side table so repeat exports are offline).
3. **No chain** → `"status": "UNKNOWN"`. Never matched by commit-message
   similarity or timing heuristics.

Forward-fix (cheaper than archaeology): `pd done` learns an optional
`--pr <n>` and the PR-creating flows record the link at creation time, so
future episodes label themselves.

### 5.2 Guard verdict persistence (new write path)

Coast Guard commit-path decisions (`lib/coast-guard/compulsion.ts`,
`evaluateLeaseRent()`) are currently computed and returned, not stored. Phase 1
adds a `guard_verdicts` table — `(id, session_id, agent_id, ts, decision,
rule, context_json)` — written **fire-and-forget** from the check path: a
failed insert logs and never blocks or delays the commit decision. This is the
single new live-state surface the whole spec introduces.

### 5.3 The `edited` bit on claims

`claims[].edited` requires knowing which claimed files the session actually
touched. Evidence source: the linked PR's changed-file list when PR linkage is
`VERIFIED`; otherwise `null` (not `false`). The claim-hygiene reward term
treats `null` as "term skipped", consistent with the honesty rule.

## 6. Determinism, ordering, incremental export

- **Ordering**: episodes ordered by `(sessions.completed_at, sessions.id)`;
  steps by `(ts, source_table_rank, source_row_id)` with `seq` assigned from
  that order. Two exports over the same DB state are byte-identical
  (`exported_at` excluded from any hashing; a `--stable` flag zeroes it for
  golden-file tests).
- **Cursor**: opaque base64 of `(completed_at, session_id)` of the last
  emitted episode. Sessions are immutable after completion, so cursor resume
  is exact; `active` sessions are only exported with `--status active` and
  are never cursor-tracked.
- **Streaming**: the route streams NDJSON with prepared statements and a
  per-episode working set; no full-corpus buffering. Budget: 1k episodes with
  default content in under 10s on the reference machine.

## 7. Redaction (`redact/1`)

Applied to all free-text fields (`note.content`, `details`, message bodies,
transcript content, `metadata` values) **before** anything leaves the daemon:

1. **Structured secret formats** — known token shapes (`ghp_`, `gho_`,
   `sk-ant-`, `AKIA…`, JWT triple-dot, PEM blocks, `Bearer` headers) →
   `«redacted:token»`. Pattern-matching on structured formats we control the
   list of — this is the allowed kind of exact matching.
2. **High-entropy literals** — base64/hex runs ≥ 32 chars with Shannon
   entropy above threshold → `«redacted:entropy»`.
3. **Path normalization** — `/Users/<name>/` → `~/` everywhere.
4. **Env-value sweep** — exact values of `*_KEY`, `*_TOKEN`, `*_SECRET`,
   `*_PASSWORD` variables present in the daemon's environment are replaced
   wherever they appear verbatim.

`--no-redact` exists for local debugging, is refused when `--out` resolves
outside `$HOME`, and stamps `"redaction": {"applied": false}` so downstream
tooling can refuse unredacted corpora.

## 8. Reward annotation (phase 2)

`lib/coordination-reward.ts` exports `scoreEpisode(episode) → <!-- cite-exempt -->
{rubric, terminal, components, notes}` — a pure function over the Episode
object (not the DB), so the bench, the exporter, and offline re-scoring all
share one implementation. Rubric terms and weights per ADR-0052 §"reward
rubric"; weights live in a versioned constant, never config, so a score is
always reproducible from `(episode, rubric_version)`. Terms whose evidence is
`UNKNOWN` are skipped and listed in `notes`, never imputed as zero-bad.

## 9. Module layout

Following the factory + plugin house pattern:

```
lib/trajectory-export.ts     createTrajectoryExport(db) — joins, steps merge,
                             cursoring, redaction hooks
lib/outcome-labeler.ts       createOutcomeLabeler(db, {gh}) — §5 chains,
                             pr_links cache, guard_verdicts reader
lib/coordination-reward.ts   scoreEpisode() — pure, versioned rubric
lib/redact.ts                redact/1 ruleset, shared with any future export
routes/export.ts             GET /export/trajectories (streaming NDJSON)
cli/commands/export.ts       thin client; registered in cli/commands/index.ts
mcp/server.ts                export_trajectories tool (paged)
```

## 10. Testing

- **Unit** (`tests/unit/trajectory-export.test.js`, `createTestDb()`): <!-- cite-exempt -->
  fixture session with notes/claims/activity/inbox/commitments → golden-file
  episode (with `--stable`); cursor resume equivalence (full export ==
  concatenated paged exports); redaction unit table (each rule, plus a
  no-false-positive corpus of ordinary base64-ish strings like git SHAs).
- **Labeler honesty**: fixtures asserting `UNKNOWN` where the chain is broken
  (note with no PR token, worktree with no branch match) — the test that
  fabricated labels fail.
- **Rubric**: `scoreEpisode` table-driven cases including the Goodhart
  fixtures: note-spam episode scores no higher than capped; over-claiming
  scores below negotiated-claim twin.
- **Real-runtime smoke** (per the regression rule): CI boots the bun daemon
  and curls `/export/trajectories?limit=1` against a seeded DB — the route
  must produce a schema-valid episode under bun, not just jest.
- **Guard hot-path**: a test that `guard_verdicts` insert failure (locked DB)
  does not change the commit decision or add measurable latency.

## 11. Out of scope (this spec)

- The synthetic harbor / bench runner (ADR-0052 phase 3) — consumes this
  format, lives in its own spec.
- Training pipelines (phases 4–6) — external to the daemon by design.
- Cross-harbor or shared/public corpora — separate operator decision
  (ADR-0052 §Data governance).
