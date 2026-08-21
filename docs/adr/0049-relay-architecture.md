# ADR-0049. Relay v0 Architecture

## Status

Accepted — 2026-06-10.

Deliberation: four voices ran in parallel (proponent, pragmatic, antagonist, acme-specialist).
All three deliberators: `accept-with-conditions`. No ship blockers. Conditions are listed under
[Operational Readiness Acceptance Criteria](#operational-readiness-acceptance-criteria).

## Context

Port Daddy daemons coordinate locally today. The missing piece is a cloud-side fabric that lets
local daemons, CI runners, browsers, and bots publish and subscribe to harbor-scoped event streams
without opening inbound firewall holes and without trusting the relay with payload content.

### What already ships
- `lib/merkle-chain.ts` — pure-function per-publisher Merkle event chains (tamper-evidence,
  non-equivocation, external anchorability)
- `lib/event-envelope.ts` — typed wire envelope with per-publisher monotonic `seq` and replay guard
  (closes the replay gap found in `analyses/relay_e2e_secrecy.pv`, PR #252)
- `lib/harbor-tokens.ts` — Phase 2 Ed25519 harbor card issuance (1h TTL, JTI audit, revocation)
- ADR-0025 (Accepted) — PKI decision: OIDC-first hybrid, GitHub Actions OIDC primary, WoT
  escape hatch for self-hosted, ACME v1 for daemon name-binding

### What does not yet exist
- `apps/relay/` — Cloudflare Worker + Durable Objects relay service
- `lib/relay-client.ts` — daemon-side relay connection manager
- `cli/commands/relay.ts` — `pd config relay <url>` wiring

### Why not the daemon mesh (Part XVII)
`docs/DAEMON-MESH-ARCHITECTURE.md` describes a heavier approach: mDNS discovery, Raft consensus,
multi-writer SQLite replication, bidirectional state sync. That design is ~1,500 LOE and couples
the relay to the specific database model. The user-facing win (events flow across machines) does
not require state replication. It requires event federation, which is pub/sub over a cloud relay.
ADR-0027 (Accepted) formalized this pivot.

## Decision

Build **Relay v0** as a Cloudflare Workers service at `relay.portdaddy.dev`.

### Transport
HTTPS + Server-Sent Events. TLS 1.3. Outbound-only from daemon (no inbound holes through NAT).
SSE chosen over WebSockets: works through corporate proxies, native browser support,
auto-reconnect with Last-Event-ID, one-direction-per-stream matches the model.

### Identity and Auth
Per ADR-0025: Ed25519 harbor cards (Phase 2) for runtime credentials.
OIDC bootstrap for external publishers (GitHub Actions OIDC primary in v0).
Admin-approved WoT allowlist for self-hosted/harbor-local deployments.
Operator-provisioned identities are a narrow later extension for managed
service actors such as Fleet Executor: an operator-authenticated endpoint
registers only the actor's public key, and Relay issues a capability-limited
card whose private key never reaches Relay.

### Namespacing
`<harbor_fingerprint>:<channel>` where `harbor_fingerprint = SHA256(harbor_pub_key)` (hex).
Two daemons sharing a harbor keypair share the namespace. Different harbors cannot collide.

Reserved prefixes (relay-managed):
- `_relay:status` — relay heartbeat per harbor
- `_relay:revocations` — revocation broadcast
- `_relay:keys` — published Ed25519 pubkeys

### End-to-End Payload Encryption
AES-256-GCM per event, channel key wrapped under harbor X25519 via HPKE (RFC 9180).
Relay stores and routes ciphertext only. Invariant I1 (relay never sees plaintext) is
unconditionally preserved — the relay cannot decrypt events even if it wants to.

### Integrity
Per-publisher Merkle chains (lib/merkle-chain.ts). Each chain entry commits:
`this_hash = SHA256(prev_hash || sender || channel || seq || iat || ciphertext || sig)`.
Subscribers verify the chain. A2 (malicious relay equivocation) is detected, not prevented.
Optional external anchoring (DNS TXT, git commit, transparency log) upgrades I2 from
"relay-honesty-dependent" to "externally verifiable".

### Storage
```
Managed (v0): Cloudflare D1 (identity, events, chain heads, revocations, audit log)
              + Durable Objects (per-harbor fan-out, ordering, DO alarms)
              + Workers KV (JWKS cache, pinned relay key)
Self-hosted:  Single Node/Bun server, SQLite, behind any TLS terminator
```

D1 schema:
```sql
CREATE TABLE identities (
  daemon_fingerprint TEXT PRIMARY KEY,
  pub_key            TEXT NOT NULL,
  proof_method       TEXT NOT NULL CHECK (proof_method IN ('oidc','acme','wot','operator-provisioned')),
  proof_metadata     TEXT NOT NULL,   -- JSON: issuer/jti/iat for oidc or operator-provisioned; cert/acme-account for acme; pairing-receipt for wot
  expires_at         INTEGER,
  revoked            INTEGER NOT NULL DEFAULT 0,
  revoked_reason     TEXT,
  created_at         INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE harbor_members (
  harbor_fingerprint TEXT NOT NULL,
  daemon_fingerprint TEXT NOT NULL,
  admitted_at        INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (harbor_fingerprint, daemon_fingerprint)
);

CREATE TABLE sessions (
  session_id   TEXT PRIMARY KEY,
  fingerprint  TEXT NOT NULL,
  nonce_c      TEXT NOT NULL,
  nonce_s      TEXT NOT NULL,
  subs_json    TEXT NOT NULL,  -- accepted subscriptions as JSON array
  created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  expires_at   INTEGER NOT NULL
);

CREATE TABLE events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  sender       TEXT NOT NULL,
  channel      TEXT NOT NULL,
  seq          INTEGER NOT NULL,
  prev_hash    TEXT NOT NULL,
  this_hash    TEXT NOT NULL,
  iat          INTEGER NOT NULL,
  arrived_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  ciphertext   TEXT NOT NULL,
  sig          TEXT NOT NULL,
  UNIQUE (sender, channel, seq)
);
CREATE INDEX events_channel_idx ON events (channel, arrived_at);

CREATE TABLE chain_heads (
  sender       TEXT NOT NULL,
  channel      TEXT NOT NULL,
  tip_seq      INTEGER NOT NULL,
  tip_hash     TEXT NOT NULL,
  issued_at    INTEGER NOT NULL,
  signed_head  TEXT NOT NULL,
  anchors_json TEXT,
  PRIMARY KEY (sender, channel)
);

CREATE TABLE revocations (
  jti             TEXT PRIMARY KEY,
  revoked_at      INTEGER NOT NULL DEFAULT (unixepoch()),
  revoking_daemon TEXT NOT NULL,
  reason          TEXT
);

CREATE TABLE issuers (
  issuer_id   TEXT PRIMARY KEY,
  jwks_uri    TEXT NOT NULL,
  disabled    INTEGER NOT NULL DEFAULT 0,
  disabled_at INTEGER,
  last_fetch  INTEGER
);

CREATE TABLE audit_log (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  at               INTEGER NOT NULL DEFAULT (unixepoch()),
  daemon_fingerprint TEXT,
  action           TEXT NOT NULL,
  target           TEXT,
  ip               TEXT,
  detail           TEXT
) STRICT;
```

### HTTP Surface (full surface in `skills/pd-relay-zero-trust/openapi.yaml`)

| Method | Path | Description |
|--------|------|-------------|
| POST | /v1/handshake | Daemon-to-relay handshake; returns session_id |
| GET  | /v1/subscribe/:session_id | SSE stream; long-lived |
| POST | /v1/publish | Publish one event (harbor card in Authorization header) |
| POST | /v1/exchange | OIDC token → PD card exchange |
| POST | /v1/fleet/executor-identity | Register Fleet Executor public key and mint its relay-scoped card (operator-only) |
| POST | /v1/revoke | Revoke a JTI; triggers broadcast on _relay:revocations |
| POST | /v1/revoke-by-issuer | Bulk revoke all cards from an issuer in a time window (A8 recovery) |
| GET  | /v1/chain-head/:sender/:channel | Latest signed chain head |
| GET  | /v1/keys/:harbor_fingerprint | Published public keys for harbor members |
| PUT  | /v1/config/issuers/:issuer_id | Enable/disable an OIDC issuer (operator-only) |
| DELETE | /v1/cache/jwks/:issuer_id | Invalidate cached JWKS for issuer (operator-only) |
| GET  | /health | Health check |

### Capability Enforcement at Publish

1. Decode harbor card (or attenuated chain) from `Authorization: Bearer <card>` header.
2. Verify Ed25519 signature against identity registry.
3. Verify JTI is not in revocations table.
4. Check card is not expired.
5. Check `card.cap` includes `{op: "pub", channel: <match>}`.
6. Check rate limit per `cap.rate_per_min` (atomic counter in DO).
7. Check `len(ciphertext) ≤ cap.max_payload_bytes`.
8. Verify chain continuity: load last `(sender, seq)` from D1; reject if `prev_hash` doesn't match
   or `seq` is not `last + 1`.
9. Verify Ed25519 sig over `this_hash`.
10. Persist event to D1.
11. Fan-out to DO subscribers of `(harbor_fingerprint, channel)`.

### Revocation
Daemon POSTs `/v1/revoke { jti, sig }`. Relay inserts JTI into revocations table and broadcasts
on `_relay:revocations` per harbor. SLO: ≤ 5 seconds from revoke call to subscriber receipt.
DO alarm wired to fan-out revocation events.

## Operational Readiness Acceptance Criteria

The antagonist deliberation identified five acceptance conditions that **must** be implemented
before v0 is considered shippable. These are not ADR-level commitments; they are implementation
checklist items:

1. **OIDC issuer disablement** — `PUT /v1/config/issuers/:issuer_id { disabled: true }` with
   immediate effect. Relay rejects all token exchanges from a disabled issuer without awaiting
   JWKS expiry. Covers A8 recovery.

2. **Bulk revocation by issuer + time window** — `POST /v1/revoke-by-issuer { issuer, iat_min,
   iat_max }` revokes all JTIs whose `proof_issuer` matches and whose `proof_iat` is in the
   window. Same ≤5s broadcast SLO as single revocation. Covers A8 recovery.

3. **JWKS cache invalidation** — `DELETE /v1/cache/jwks/:issuer_id` evicts the cached JWKS from
   Workers KV. Relay fetches fresh JWKS on next token exchange. Covers A8 recovery.

4. **Audit log searchability** — `audit_log` must be queryable by `daemon_fingerprint` and
   `at` range. Operator can pull all actions by a fingerprint in a time window for incident
   response. Required for A8 post-mortem.

5. **Runbook: OIDC issuer compromise** — `docs/operations/relay-runbook-oidc-compromise.md` must
   exist before GA, documenting the four-step recovery (disable issuer, invalidate JWKS, bulk
   revoke, notify affected channels). Required for operational readiness.

## Non-Goals (v0)

- State replication between daemons (Part XVII trap — see `docs/DAEMON-MESH-ARCHITECTURE.md`)
- Multi-region active-active
- Federation between relay instances
- Float Plan economic settlement (see `skills/pd-relay-zero-trust/references/float-plans-deferred.md`)
- WebSockets / gRPC / custom binary transport
- Phase 3 capability attenuation (defer to post-v0)
- ProVerif extension for daemon↔relay↔daemon (defer — see `analyses/proverif-relay-extension/`)
- ACME daemon enrollment (defer to v1)
- Phone UI / mobile client

## Threat Model Summary

Full catalog: `skills/pd-relay-zero-trust/references/threat-model.md`.

| Adversary | New Surface in v0 | Mitigation |
|-----------|-------------------|------------|
| A1 honest-but-curious relay | Metadata (fingerprints, channels, timestamps, IPs) | Minimal headers; documented retention (90d); no payload log |
| A2 malicious relay | Can equivocate; can drop | Per-publisher Merkle chain detects; external anchor verifies |
| A3 network on-path | Traffic analysis (sizes, timing) | Out of scope v0; TLS 1.3 baseline |
| A4 compromised publisher | Spam under stolen card | Rate limits + revocation ≤5s |
| A5 compromised subscriber | Replay (detected by seq), exfiltrate plaintext | Seq dedup; E2E is app-layer concern |
| A6 compromised daemon | Mints cards within daemon's own scope | Short card TTL; harbor revocation |
| A7 compromised harbor key | Decrypts past channel traffic | Channel key rotation on membership change |
| A8 compromised PKI authority | Mints identities for adversary keys | Acceptance criteria 1–4 above + runbook |

Invariants preserved unconditionally: I1 (E2E), I3 (card scoping), I7 (auth/authz decoupled).
Invariants conditionally preserved: I2 (equivocation detection requires external anchor), I5
(evidence preservation requires anchor or D1 backup), I6 (≤5s revocation requires DO alarms).

## Operational Targets (v0)

- Publish-to-subscriber p50 latency: < 200 ms intra-region
- Publish throughput: 1,000 events/sec/harbor
- Revocation propagation: ≤ 5 seconds
- Event retention: 7 days (archived to R2 after expiry)
- Chain head retention: indefinite
- Relay availability SLO: 99.9%

## Delivery Plan (per pragmatic deliberation)

Estimated 5 weeks for a solo operator with Cloudflare Worker experience.

| Week | Deliverable |
|------|-------------|
| 1 | D1 schema + identity registry; GitHub OIDC verifier (JWKS fetch, cache, sig verify, fail-closed cap mapping) validated against real GH Actions token |
| 2 | Worker handshake endpoint; session allocation; Durable Object factory per (harbor, channel) |
| 3 | D1 events table; Merkle chain verify at publish; SSE fan-out in DO; Last-Event-ID replay |
| 4 | Revocation broadcast (≤5s DO alarm); card expiry refresh; rate limits; audit logging; acceptance criteria 1–4 |
| 5 | Integration test with real GH Actions runner; CLI wiring (`pd config relay`); docs + runbook; deploy to `relay.portdaddy.dev` |

## Consequences

**Positive**:
- Daemons gain cross-machine federation without inbound network surface
- External publishers (CI, bots, browsers) gain a single integration point
- Existing crypto primitives (Ed25519, AES-GCM, HPKE) reused; no new dependencies
- Local-only daemon mode is completely unchanged
- Self-hosted path preserved (single Worker-like server + SQLite)

**Negative**:
- New operational dependency: relay availability for federation
- Trusted-but-minimized relay — equivocation is detected, not prevented, without external anchor
- Solo-operator pager load increases: GitHub OIDC outage, D1 contention, subscriber chain break
- D1/DO Cloudflare cost for events at scale

**Reversibility**:
- Daemons work without the relay (local-only mode unchanged)
- Wire format versioned (`v: 1`); future deprecation possible
- OIDC bootstrap is replaceable: switch issuer config, re-enroll daemons
- Harbor-fingerprint namespace is permanent once clients encode it; changing it requires
  coordinated redeployment (high cost at 2+ years)

## Related ADRs / References

- ADR-0013 (Unified Harbor Model)
- ADR-0014 (Anchor Protocol — daemon Ed25519 identity)
- ADR-0025 (PKI Decision — depends on, Accepted)
- ADR-0027 (Relay Harbor Mesh — depends on this, Proposed → Accepted after this lands)
- `skills/pd-relay-zero-trust/references/relay-architecture.md`
- `skills/pd-relay-zero-trust/references/threat-model.md`
- `skills/pd-relay-zero-trust/references/merkle-chain-design.md`
- `skills/pd-relay-zero-trust/references/e2e-payload-encryption.md`
- `lib/merkle-chain.ts`
- `lib/event-envelope.ts`
- `lib/harbor-tokens.ts`
- `apps/relay/` (implementation)
