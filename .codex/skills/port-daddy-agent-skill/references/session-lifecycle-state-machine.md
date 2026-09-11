# Session Lifecycle State Machine

A Port Daddy session is a durable record of an agent's intent + scope + claims + notes. Understanding its states matters because Coordination Guard, salvage, and rejoin all depend on accurate state.

See `diagrams/03_stateDiagram-v2_agent_lifecycle.md` for the visual.

## States

### CREATED

`pd begin "<purpose>" --lifecycle durable --roadmap <slug>` writes a session row + writes `.portdaddy/contexts/<slot>.json` for the calling shell.

- **Has:** session ID, agent ID, purpose, identity, startedAt timestamp.
- **Has not yet:** file claims, notes, validation evidence.
- **Daemon view:** `active: true`.

Transitions to ACTIVE on first claim, note, or interaction.

### ACTIVE

The session has been observed via heartbeat or interaction within the activity window (~5 min).

- **Has:** claims, notes, possibly intermediate work.
- **Daemon view:** `active: true`, `lastSeen` recent.
- **Coordination Guard view:** ✅ valid for staged commits.

Transitions:
- → IDLE if no heartbeat within window.
- → COMPLETED on `pd done`.
- → ABANDONED if process dies.

### IDLE

No interaction in N minutes but session not formally closed.

- **Daemon view:** `active: true` but `lastSeen` stale.
- **Coordination Guard view:** ⚠️ may warn.
- **Implication:** another agent might think this session is finished even though it's just slow.

A heartbeat (any `pd` call) returns it to ACTIVE.

### ABANDONED

Process that owned the session died. Explicit detection by daemon (heartbeat timeout) or manual (`pd salvage`).

- **Has:** all the state from ACTIVE — claims, notes, intent.
- **Daemon view:** `active: false`, `abandoned: true`.
- **Salvage queue:** present.
- **Coordination Guard view:** ❌ commits in the abandoned session are blocked.

Transitions:
- → SALVAGED if another agent claims it via `pd salvage claim <id>`.
- → DISMISSED if explicitly dismissed (or expires after retention).

### SALVAGED

Another agent has claimed an abandoned session and is continuing it.

- **Has:** the original notes (preserved as context) + new notes from the salvaging agent.
- **Daemon view:** `active: true`, `salvaged_from: <original-agent-id>`.
- **Implication:** the original intent is honored; the new agent must keep `pd note` references to the original.

### COMPLETED

`pd done "<outcome>"` was called.

- **Has:** final note, outcome, finishedAt timestamp.
- **Daemon view:** `active: false`, `completed: true`.
- **File claims:** released.
- **Coordination Guard view:** N/A (session no longer eligible for commits).

Terminal state.

### DISMISSED

Abandoned session was explicitly NOT picked up (e.g., scope no longer relevant, work duplicated upstream).

- **Reason:** required (note the reason in the dismissal command).
- **Terminal state.**

## Critical transitions

### CREATED → ACTIVE

Don't sit on a created session. Drop a scope note within 30 seconds:

```bash
pd begin "..." --lifecycle durable --roadmap <slug>
pd note "Scope: <files>. Assumptions: <truth>. Validation: <commands>."
```

This triggers ACTIVE and gives other agents visibility.

### ACTIVE → IDLE → ABANDONED

If you're going to walk away (lunch, debugging in another window), explicitly close:

```bash
pd done "<paused>: <state>. Resume by reading note <X>."
```

Don't leave ACTIVE sessions hanging — they accumulate as IDLE then ABANDONED, polluting the salvage queue.

### ABANDONED → SALVAGED

The salvager must:

1. Read the original session's notes carefully — preserve intent.
2. `pd salvage claim <id>` — formal handoff.
3. Drop a `pd note` referencing the salvage source: `"Salvaged from session <orig-id>. Original scope: ...; continuing with: ..."`
4. Honor the original scope; don't expand it without explicit permission.

### Any → ABANDONED (forced)

The daemon detects abandonment via:
- Heartbeat timeout (default ~5 min).
- Explicit signal from `pd salvage` invocation.
- Process detection (the registered agent process is no longer running).

Once ABANDONED, the session can't be reopened by its original owner. It MUST be salvaged or dismissed.

## Coordination Guard behavior by state

| State | `pd guard check --staged` |
|---|---|
| CREATED | ⚠️ no claims yet; warns if files are staged |
| ACTIVE | ✅ valid (assuming all staged files are claimed) |
| IDLE | ⚠️ valid but warns about staleness |
| ABANDONED | ❌ blocks commit |
| SALVAGED (by you) | ✅ valid (you're now the active owner) |
| COMPLETED | ❌ blocks commit (session no longer eligible) |

## Per-shell context vs daemon state

The session record lives in the daemon. The `.portdaddy/contexts/<slot>.json` file is per-shell (per-cwd, per-process). They can diverge:

- Daemon says session is COMPLETED, but your shell's context still references it → `pd whoami` reports "Session is abandoned/completed."
- Daemon says session is ACTIVE, but your shell's context is missing → Coordination Guard says "no active session attached to this shell."

Always trust the DAEMON state as source of truth. Re-run `pd begin` in the shell if context is stale.

## Forced transitions (admin operations)

Avoid unless necessary:

- **Force-complete:** `pd session done <id>` — closes a session you don't own. Use only when the original owner is verified dead.
- **Force-release claims:** `pd session files release <id> <file>` — releases without owner consent. Use only for stuck claims.
- **Dismiss salvage entry:** `pd salvage dismiss <id>` — declares the work moot. Always include a reason in `pd note`.

## Related

- `references/coordination-theory.md` — the theory behind sessions, claims, locks.
- `references/recovery-and-salvage.md` — full salvage workflow.
- `decisions/who-do-i-message.md` — Coxswain owns stale-session escalations.
- `diagrams/03_stateDiagram-v2_agent_lifecycle.md` — visual.
- `lib/sessions.ts`, `lib/sugar.ts` — implementation.
