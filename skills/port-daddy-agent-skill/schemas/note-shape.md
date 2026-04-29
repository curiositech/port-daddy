# Note Shape

Authoritative source: `lib/sessions.ts`, `routes/sessions.ts`.

Notes are **immutable, append-only, encrypted at rest**. Once written, never edited or deleted. Treat them as the audit trail.

## Stored fields

```ts
interface SessionNote {
  id: number
  session_id: string | null   // null = quick-note (no active session)
  agent_id: string | null
  body: string                // free-form text — encrypted with daemon master key
  type?: string               // optional tag: progress | decision | blocker | finding | ...
  created_at: number          // epoch ms
}
```

## Conventions for `type`

The daemon doesn't enforce a vocabulary. These tags are conventional and what other agents and the dashboard look for:

| Tag | Use for |
|---|---|
| `progress` | "Built X. Moved to Y." Routine status. |
| `decision` | "Chose JWT over sessions because …" High-signal. |
| `blocker` | "Stuck on Z. Need …" Surface to humans. |
| `finding` | Bug, smell, suspicious code. From QA agents. |
| `intent` | Forward-looking: "About to refactor …" |
| `handoff` | Specifically targeted at the next agent picking up the work (esp. salvage). |

## Content shape (recommended template)

For non-trivial notes, structure helps the next agent and the cartographer:

```
<one-line summary>

Why: <motivation / constraint>
What: <what was done or decided>
Next: <next concrete step, or BLOCKED>
```

`assets/session-note.template.md` ships a fillable version.

## CLI

```bash
pd note "JWT validation working, moving to refresh tokens"               # type defaults to progress
pd note --type decision "Switched to JWT because sessions need Redis"
pd note --type blocker "Hit Supabase rate limit on /signup"
pd note --type handoff "QA spotted the refresh-token bug; see line 42"
```

## Read API

```bash
pd notes                     # last N notes from current session
pd notes --session <id>      # specific session
pd notes --type blocker      # filter
pd notes --since 1h          # last hour
```

## Encryption

Notes are encrypted with AES-256-GCM. The master key lives at `~/.port-daddy/master.key` (auto-generated, mode 0600). If the key file is deleted, existing notes become unreadable. Back it up if losing notes is unacceptable.

## Anti-patterns

| Wrong | Right |
|---|---|
| Treating notes as scratch ("test test, ignore"). | Notes are durable. Use a different scratchpad. |
| Editing — or asking to edit — a note. | Write a new note that supersedes it: `note --type decision "Reverting earlier decision because …"`. |
| Stuffing entire diffs/logs into a note body. | Write a path or a commit hash; reference, don't embed. |
| Skipping notes on a multi-step session. | At minimum, one progress note per primitive milestone — that's what `catch_me_up` and salvage rely on. |
