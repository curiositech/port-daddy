# 0089. Durable security-forensics journal — security events survive the 7-day prune

## Status

Accepted

## Context

The loss-critical-records audit (the same pass that produced the transcript archive,
ADR-0058) found the most acute hole is in **security forensics**. Every Arbiter
security event — `PID_SQUATTING`, `CAP_ESCALATION`, `NOTE_MONOTONICITY`, escrow and
lock-owner violations, `system.man_overboard` — is recorded by
`lib/arbiter.ts` `recordViolation()` into the `activity_log` table. And
`lib/activity.ts` **prunes `activity_log` after 7 days** (`LOG_RETENTION_MS`) and
caps it at 10k rows, with a sweep running every 5 minutes (`server.ts` cleanup).

So a security incident discovered on day 9 has **zero forensic trail** — the
detections that would prove an agent escaped its capabilities, or that the daemon
was hijacked, are gone *by design*. The in-memory `violations[]` array in the
Arbiter is not durable either (lost on restart). This is the one class of log the
operator most cannot lose, and it was being deleted on a timer.

The investigation confirmed `recordViolation()` is the **universal chokepoint** —
every security event flows through it (rule checks, cap-attenuation monitor,
resurrection's `agent:dead`, man-overboard); the Arbiter has no side channels.

## Decision

**Add a durable, always-on forensics journal, written at the `recordViolation()`
chokepoint, independent of the live DB and its prune.** It mirrors the transcript
archive (ADR-0058):

- `lib/forensics-archive.ts` — `createJsonlForensicsArchive({ dir })` returns a
  `ForensicsSink` that writes each security event, in full, as one **fsync'd** JSON
  line to a UTC-day-partitioned file `forensics-YYYY-MM-DD.jsonl` under
  `~/.port-daddy/forensics/` (overridable via `PD_FORENSICS_ARCHIVE_DIR`).
  Append-only, never deleted, independent of `activity_log`'s 7-day prune.
- `lib/arbiter.ts` — `ArbiterDeps` gains an optional `forensicsSink`, called
  **fire-and-forget at the top of `recordViolation()`** (before the `activity_log`
  write, so the durable copy exists even if the in-DB one is later pruned or the
  activity write fails). A sink failure never blocks violation recording; the sink
  reports its own failures **loudly** (a silent forensics loss is the forbidden
  outcome).
- `server.ts` wires the journal **by default**; opt out with
  `PD_FORENSICS_ARCHIVE=off`. The Arbiter's startup log now reports
  `forensicsJournal=on`.

### Why sink-at-write, not archive-before-prune

Archiving the about-to-be-deleted rows inside the 5-minute cleanup sweep would (a)
risk a gap for events created and pruned between sweeps, (b) put synchronous batch
I/O on the cleanup path, and (c) require new machinery. Writing at
`recordViolation()` catches every event the instant it happens, reuses the proven
fire-and-forget sink pattern, and keeps the journal completely decoupled from the
`activity_log` lifecycle.

## Consequences

- **Positive.** Every security detection is durably retained the moment it fires,
  outside the live DB, regardless of the 7-day prune or a DB loss. The JSONL is
  greppable for incident response (`grep PID_SQUATTING ~/.port-daddy/forensics/*`)
  and ships to an external SIEM/warehouse behind the same `ForensicsSink` interface.
- **Cost.** One fsync'd append per violation — violations are rare, so this is not a
  hot loop. Modest disk growth under `~/.port-daddy/forensics/`.
- **Reversible.** `PD_FORENSICS_ARCHIVE=off` disables it; the files are plain JSONL.
- **Follow-up (tracked, not silent).** `lib/forensics-archive.ts` and
  `lib/transcript-archive.ts` (ADR-0058 — not yet shipped to main, in PR #433) are
  the same append-only-JSONL shape; once both are on main, extract a shared
  `lib/jsonl-archive.ts` primitive (proposed, not yet shipped). A retention/
  rotation policy for the forensics files (the bias is deliberately "keep everything")
  is a separate follow-up.

## Related

- ADR-0058 — durable transcript retention (the sibling archive this mirrors).
- ADR-0045 — loud-fail invariants (the journal reports retention failures loudly).
- `lib/arbiter.ts` `recordViolation()` — the security-event chokepoint.
- Operator directive 2026-06-15 ("things whose logs we cannot lose") + 2026-06-16
  ("security-forensics first").
