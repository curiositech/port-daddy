# ADR-0136: Exact operator admission grant

- **Status:** Proposed (2026-08-30)
- **Roadmap:** `exact-operator-admission-grant`
- **Unblocks:** `workintent-dispatch-isolation`
- **Builds on:** ADR-0040 (daemon-minted actor souls), ADR-0096 (operator authority), ADR-0122 (single harbor authority), ADR-0134 (one consent transport)

## Context

ADR-0040 intentionally caps first-time actor admission per project and day. That
bounded floor works until a legitimate clean worker is created after the daily
newcomer budget is exhausted. The only current escape hatch is the advisory
`operatorToken`; its own source comments say a same-UID process can read it. A
quota edit, copied context, copied credential, alias takeover, or direct SQLite
change would make the coordination boundary untrustworthy precisely when it is
needed for recovery.

The operator needs one narrow actuator: authorize one exact requested identity
to begin once in one exact clean linked worktree for one roadmap item, without
changing ordinary admission policy or transferring a bearer.

## Decision

The owning daemon stores an `OperatorAdmissionGrant` bound to:

- requested identity;
- canonical absolute linked-worktree root;
- branch;
- normalized `origin` remote;
- exact HEAD and merge-base commit;
- roadmap slug;
- server-derived local operator identity;
- issued-at and short expiry.

The issue command is accepted only over the owner-only Unix socket and requires
an explicit confirmation bit. The daemon probes Git itself; request bytes never
assert branch, remote, head, or base. The returned grant id is a public receipt
reference, not a bearer: consumption still requires every bound field and the
live Git probe to match.

`pd begin --admission-grant <id>` is the only consumer in this slice. Grant
consumption, actor minting, and session admission share one SQLite transaction.
A downstream begin refusal rolls the principal mint and grant consume back,
leaves the grant active, and records a rejection receipt after rollback. A
successful consume marks the grant used and records the minted actor id. Replay,
expiry, tuple mismatch, dirty worktree, detached HEAD, main-worktree use, and
store failure all fail closed.
Issue, consume, expiry, and rejection are append-only receipts queryable by grant
id. Receipt payloads never contain actor credentials.

The grant path does not read, insert, update, or delete `newcomer_pool`. It does
not alter the daily cap, transfer a credential/context, infer identity from a
session or alias, take over a session, or mint an operator-trusted soul. It mints
one ordinary newcomer soul and returns that new soul's credential once through
the existing begin response. The CLI persists that response through its existing
context mechanism, detaches the bearer before all JSON/human/shell-export output,
and emits only public agent/session selectors under `PD_EMIT_EXPORTS=1`.

## Authority boundary

This is the solo-local authority posture already made explicit by ADR-0096 and
the Fleet approval route: the owner-only Unix socket represents the local
operator. Team and remote harbors may not reuse it. They require the attenuated
operator authority reference and unified consent transport from ADR-0134.

The CLI is an agent/emergency projection over the same daemon command. FleetBar
and pd-console may later render the proposal and receipt, but they do not own a
second grant store or bypass the daemon command.

## Rejected alternatives

- **Raise or clear the newcomer cap.** Broad policy mutation; authorizes more
  identities than the operator selected.
- **Copy a working actor credential or context.** Impersonation and bearer
  transfer; destroys identity continuity.
- **Treat an alias or abandoned session as authority.** Display and history are
  evidence, not a verifier.
- **Reuse `operatorToken`.** Advisory-above-floor compatibility, not the exact
  one-shot consent object required here.
- **Let the UI write SQLite.** Violates the single-writer daemon boundary.

## Acceptance

Tests must prove one-shot atomicity, short TTL, exact tuple matching, live Git
revalidation, conflict/idempotency behavior, durable receipts, no secret fields,
server-derived operator identity, Unix-socket-only issuance, and byte-for-byte
preservation of `newcomer_pool` across successful and failed grant use.
