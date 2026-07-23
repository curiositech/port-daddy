# ADR-0102: Salvage Envelope and Resume Contract

> **Note (2026-05-06):** Renumbered from 0027 → 0028 because 0027 is reserved for "V4 Remote Harbor Redefinition" (referenced from ADR-0025 and `docs/plans/PHONE-INTEGRATION-MASTER-PLAN.md`; template at `templates/ADR-V4-Remote-Harbor-Redefinition.md`).

**Status:** Draft (2026-05-05)
**Owner:** salvage-operator (proposed)
**Adjacent work:** `codex/salvage-triage` branch (Apr 28, unmerged) — adds `pd salvage triage` and `pd salvage next` queue primitives. This ADR depends on and extends that branch.

## Context

As of 2026-05-05, port-daddy has **342 pending salvage entries**, of which 312 are >24h old and 293 are scoped to the port-daddy project. The yard is unhealthy: agents die, leave entries, and no one resumes them because the entries don't carry enough context to resume from.

A handed-off agent should be able to read a salvage entry, run **one command**, and continue the dead agent's work without guessing.

## Problem

The salvage endpoint (`GET /resurrection/pending`) returns 11 fields per agent:

```
id, identityProject, identityStack, identityContext,
lastHeartbeat, name, notes, purpose, sessionId, staleSince, status
```

`purpose` is null on every salvage row in production despite the session row carrying a real telos. `notes` is a flat `string[]` with no timestamps. There is no diff, no stash ref, no claimed-files list, no worktree pointer, no cause of death, no transcript.

### Empirical gap analysis (342 entries, scripts/salvage-envelope.mjs --gap-report)

| Field | Missing | Source |
|---|---:|---|
| Symbol-granularity file claims | 342/342 (100%) | `session_files.startLine/endLine/symbol` exists in schema, never populated |
| Git ref at death | 342/342 (100%) | not captured anywhere |
| Stash/diff snapshot at death | 342/342 (100%) | not captured anywhere |
| Transcript / conversation log | 342/342 (100%) | harness-side, outside PD |
| Adjacency at death | 342/342 (100%) | not captured |
| Cause of death | 342/342 (100%) | not captured |
| Breadcrumb (note within 30s of death) | 339/342 (99%) | death is silent |
| Any claimed files | 167/342 (49%) | session.files |
| Any timestamped notes | 154/342 (45%) | session_notes |
| **Telos (session.purpose)** | **17/342 (5%)** | session.purpose |
| **Worktree ID** | **18/342 (5%)** | session.worktreeId |

Insight: telos and worktree are present 95% of the time **in the session row**. The salvage endpoint just doesn't project them. The genuinely-missing-everywhere fields are all clustered around the moment of death.

## Decision

Two-layer fix:

### Layer 1 — Salvage envelope (projection)

`GET /resurrection/pending/:agentId/envelope` returns a self-contained packet that joins the salvage entry with the session row, claimed files, and timestamped notes. Already prototyped at `scripts/salvage-envelope.mjs`.

```jsonc
{
  "agentId": "agent-...",
  "capturedAt": 1714900000000,
  "identity": { "project": "...", "stack": "...", "context": null },
  "telos": "Fix daemon Codex env for Cartographer body",
  "sessionId": "session-...",
  "sessionPhase": "in_progress",
  "sessionStatus": "abandoned",
  "worktreeId": "/Users/.../port-daddy-...",
  "lastHeartbeat": 1714000000000,
  "staleSince": 1714000000000,
  "secondsSinceDeath": 518400,
  "claims": [
    { "file": "lib/spawner.ts", "startLine": null, "endLine": null,
      "symbol": null, "claimedAt": ..., "releasedAt": null }
  ],
  "notes": [{ "ts": ..., "kind": "note", "content": "..." }],
  "inferredBreadcrumb": "(most recent note, by ts)",
  "deathContext": {
    "gitHead": null,
    "gitBranch": null,
    "stashRef": null,
    "cause": null,
    "adjacencyAtDeath": []
  },
  "resumeContract": {
    "telosNonNull": true,
    "breadcrumbExists": true,
    "diffReplayable": false,
    "adjacencyKnown": false
  },
  "contractCompliant": false
}
```

`deathContext` is null-filled until Layer 2 lands. Even null, the envelope is strictly more useful than today's salvage row because it surfaces telos + claimed files + timestamped notes.

### Layer 2 — Death hook (capture)

When a session transitions to `abandoned` or `crashed` (heartbeat staleness, displaced pid file, explicit crash signal), capture:

1. `git_head` — `git rev-parse HEAD` in the session's worktree (cheap)
2. `git_branch` — `git rev-parse --abbrev-ref HEAD`
3. `stash_ref` — `git stash create` (creates ref without applying), stored as a SHA. Reapply via `git stash apply <sha>`.
4. `cause` — enum: `timeout` | `crashed` | `displaced` | `manual` | `unknown`
5. `adjacency_at_death` — snapshot of `pd sessions --active` at the moment of death, scoped to live sessions touching ≥1 file in the dying session's claims

Stored in a new `session_death_context` table (1:1 with sessions, NULL until death). Schema migration ships with this ADR.

### Resume contract

A salvage envelope is **contract-compliant** (i.e. resumable without HITL) iff:

- `telos` is non-null (95% of entries already pass)
- `inferredBreadcrumb` exists OR last note is within 60s of `staleSince` (currently 1% pass — needs Layer 2)
- `deathContext.gitHead` is set and the SHA is reachable (needs Layer 2)
- `deathContext.stashRef` is null OR is reachable (needs Layer 2)
- `deathContext.adjacencyAtDeath` is captured, even if empty (needs Layer 2)

Non-compliant entries are not abandoned — they go through `pd salvage triage` (already implemented on `codex/salvage-triage`) into one of:
- **resume-now**: enough evidence, claim and continue
- **verify-dismiss**: notes claim completion, verify against git log, then dismiss
- **test-noise**: residue from test fixtures, dismiss
- **no-evidence**: telos null AND no notes — inspect manually or archive
- **archive-later**: ambiguous, queue behind compliant ones

### Continuation handoff capsule (2026-07-15 amendment)

Salvage resumes Port Daddy-owned work after a body disappears. Cross-harness continuation is the live counterpart: a Claude, Codex, Gemini, local-model, API, or remote agent may need to continue in another runtime while the source session still exists. That boundary does not replay a provider transcript. It carries a versioned, backend-neutral `pd.agent-harbor.handoff-capsule.v0` defined by `schemas/agent-harbor/v0/handoff-capsule.schema.json`.

The capsule preserves:

1. Source adapter, source session, agent/workflow provenance, and transcript pointer.
2. Telos, project/harbor identity, cwd, repo root, branch, worktree, git head, and dirty-file paths.
3. Every operator turn, explicit decision, and structured Port Daddy coordination note.
4. Interesting artifact references and a bounded recent transcript tail.
5. A deterministic token-budget receipt, redaction receipt, and SHA-256 integrity receipt.

Budget reduction is ordered and fail-closed. Oldest transcript-tail items are removed first, then lowest-priority artifact summaries. Operator turns, decisions, coordination notes, telos, and workspace provenance are never silently removed. If that mandatory context cannot fit, the handoff is rejected with the minimum required estimate instead of producing a misleading partial continuation.

`POST /memory/handoffs` is the ingress boundary. It reconstructs the canonical shape from allowlisted fields, recursively applies Port Daddy's structured credential redactor, scans the resulting JSON with the vendored Gitleaks rule corpus, and requires an external `gitleaks stdin` verdict. A missing scanner, scanner execution error, timeout, or residual finding quarantines the handoff before any memory write. Scanner errors expose finding counts only; raw matched values are never returned or logged. Homebrew installs the external scanner as a formula dependency; other distributions must provide `gitleaks` on `PATH` or set `PD_GITLEAKS_BIN`.

After a clean verdict, the daemon upserts one `handoff` episode keyed by source agent and source session. The full sanitized capsule lives in episode metadata; its telos, operator turns, decisions, and coordination notes form the searchable episode summary. Ingress is capped at 2 MiB and every retained string/collection has an explicit bound so budgeting and scanning cannot become an unbounded control-plane workload. When the caller supplies a Port Daddy coordination session id, its append-only notes are harvested through the existing session-harvest path only after the handoff episode is durable. Harvest is enrichment, not an egress gate: a missing database or transient harvest failure returns a structured warning while preserving the already-clean capsule.

### CLI surface

Building on `codex/salvage-triage`:

- `pd salvage envelope <agentId>` — print the envelope JSON
- `pd salvage envelope <agentId> --resume` — write to `.scratch/resume-<agentId>/`, apply stash if present, claim files in current session, post resume note. Idempotent.
- `pd salvage triage` (already on branch)
- `pd salvage next [--bucket <id>]` (already on branch) — agents pull one bounded item

### GC

`pd salvage gc` evicts entries that:

- Are >30 days old AND non-compliant AND in `archive-later` or `no-evidence` buckets
- Have a verified completion note where the referenced commit/PR is in main
- Are duplicates (same telos + sessionId across multiple entries)

Eviction writes a tarball to `~/.port-daddy/archive/salvage-<date>.tar.zst` first. Never lossy without a backup.

## Implementation order

1. **Land `codex/salvage-triage`** to main (no conflicts with origin/main 7aec5d09; clean diff)
2. **Add `session_death_context` table** + `onSessionDeath()` capture hook
3. **Add `/resurrection/pending/:agentId/envelope` endpoint** (projection, no new data)
4. **Add `pd salvage envelope` CLI verb**
5. **Backfill envelope on existing 342 entries** where session row has data (telos, claims, notes); leave deathContext null
6. **Brief salvage-operator fleet agent** with envelope + triage + the directory-ownership rule
7. **Operator drains yard** to <20 entries; archive the rest

## Consequences

**Positive:**
- 95% of existing entries become resumable from telos + notes alone (envelope projection only, no data migration)
- New deaths capture a replayable diff; resumption becomes mechanical
- Triage buckets give the operator a queue, not a 342-deep list
- GC bounds the yard size

**Negative:**
- New SQLite table; one more thing to schema-migrate
- `git stash create` at death-time requires the daemon to know the worktree path (already in `session.worktreeId`)
- Envelope endpoint is one more thing to keep parity-tested in MCP/CLI/dashboard
- "Adjacency at death" snapshot is best-effort if the daemon is also ill at death-time

**Open questions:**
- Should transcripts be in scope for PD or stay harness-side? Recommend harness-side; envelope just stores a pointer (path + harness-id).
- Encrypted notes (already in production via `keychain.ts`) — envelope must round-trip them as opaque ciphertext, not decrypt at the API boundary.

## References

- `scripts/salvage-envelope.mjs` — Layer 1 prototype (projection only)
- `.scratch/salvage-envelope-agent-5e66471b/` — sample envelope from cartographer-codex-env entry
- `codex/salvage-triage` — existing unmerged work that this ADR extends
- `docs/adr/0022-durable-actor-souls-and-body-leases.md` — adjacent (souls/leases overlap with telos/death context)
