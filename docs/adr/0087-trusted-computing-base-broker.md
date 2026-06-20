# 0087. Trusted Computing Base — the credential broker (Phase 4)

## Status

Proposed (2026-06-20)

> Note: this ADR takes the next free number after 0086 (two ADRs share 0086:
> `docs/adr/0086-operator-console-rendering-stack.md` and
> `docs/adr/0086-parley-protocol.md`). A row is added to `docs/adr/README.md`.

## Context

ADR-0053 (`docs/adr/0053-out-of-band-enforcement.md`) established that in-band
enforcement is advisory **by construction**: a same-UID process can out-trick any
guard that runs inside it. Its companion concession — *"a secret a process can
use, it can copy"* — means the macaroon discharge gate
(`core/kernel/pd-anchor/src/macaroon.rs`, ADR-0054) only **bites** if the agent
never holds the raw credential in the first place. The gate decides *whether* a
request is authorized; something else must decide *what crosses the wire*.

The **Trusted Computing Base (TCB)** is the smallest set of components that must
be correct for the security property to hold. For credential confinement, the
TCB is a separate **credential-broker process** that is the *only* holder of the
secret. The agent asks the broker to act; it never receives the secret.

## Decision

Ship `core/pd-broker` — an isolated Rust process and library that:

1. **Holds one secret internally**, loaded at startup from `PD_BROKER_SECRET`
   (env) or `PD_BROKER_SECRET_FILE` (a file the broker refuses unless it is
   `0600`). The secret bytes are held in a `SecretVault` whose `Debug` redacts
   them and which exposes no getter reachable from any response-building path.

2. **Listens on a Unix domain socket** with newline-delimited JSON framing
   (`core/pd-broker/src/transport.rs`), following the
   `skills/ipc-communication-patterns/SKILL.md` idioms: partial messages are
   buffered until a `\n`; a stale socket file from a crashed predecessor is
   unlinked on startup; the socket is `chmod 0600`; `SIGPIPE` is ignored so a
   client hanging up mid-write cannot kill the broker; `SIGTERM`/`SIGINT` flip an
   atomic flag and the accept loop unlinks the socket and exits.

3. **Authorizes via the kernel.** On a `broker-credential` request carrying
   `{grant, discharges, ctx}`, the broker calls
   `pd_anchor::macaroon::verify` with the kernel caveat checker
   (`pd_anchor::macaroon::check_caveat`) and its own discharge-key store. It
   injects **its own clock**, so a client cannot rewind time to revive an expired
   grant.

4. **Issues a scoped ticket, never the secret.** Only on an authorized verdict
   does the broker mint a `CapabilityTicket` (`core/pd-broker/src/ticket.rs`): an
   HMAC-SHA256-signed handle naming `{op, repo, branch, session}`, a hard expiry,
   and a per-ticket nonce, keyed by an internal ticket-signing key that never
   crosses the wire. The ticket is derived from the request scope and the signing
   key — never from the secret — so a leaked ticket reveals nothing about the
   secret. On any other verdict the broker returns a refusal whose reason points
   only at the correct action (coordinate / pay rent), never a bypass.

### The invariant, asserted by tests

The raw secret string **never** appears in any socket response, authorized or
not; an unauthorized, expired, or revoked grant yields no usable credential. This
is covered by `core/pd-broker/tests/broker_behavior.rs` (authorize→ticket with
no secret in payload; unauthorized→refusal; the secret-never-leaks invariant
across every outcome; expired-grant and protected-branch refusals; unknown
caveat key revokes authorization) and `core/pd-broker/tests/socket_framing.rs`
(0600 perms, stale-socket cleanup, partial-message reassembly, bad-request does
not poison the connection nor leak the secret).

## Honest scope — what this does NOT do (deferred)

* **Real ephemeral GitHub token minting** needs the GitHub App (ADR-0050 phase
  0a, `docs/adr/0050-coast-guard.md`), which is not built. The ticket here is a
  signed scope handle, not a live token. This ADR does **not** fake token
  minting.
* **Binding the ticket to actual git egress** needs the operator-owned `pf`
  forced-egress layer (ADR-0053 phases 5–6). A redemption layer that swaps a
  valid, unexpired ticket for the live credential at the egress boundary is the
  remaining work; this slice stops at issuing the scoped ticket and proving the
  secret never leaks.
* The broker's **discharge-key store** is empty at boot; the daemon will populate
  `rent caveat id -> discharge key` in the wiring phase. Until then, grants with
  a third-party rent caveat refuse with "no discharge key" — the correct
  fail-closed default.

## Consequences

The macaroon gate now has teeth: an agent that cannot present a paid-rent
discharge gets no ticket, and a ticket alone is not the credential. The TCB is
small (one process, the `pd-anchor` library, an HMAC ticket) and unit-testable
without sockets. The residual confinement gap (a malicious same-UID holder
copying a live ticket inside its window) is closed only by the separate-UID/VM
wall (ADR-0053 Layer 3), exactly as the macaroon module's own honesty note
records.
