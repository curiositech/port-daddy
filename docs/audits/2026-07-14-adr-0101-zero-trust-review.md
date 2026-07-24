# Zero-Trust Review — ADR-0101 Accounts Wedge + Relay Substrate

Reviewed 2026-07-14 with the `agentic-zero-trust-security` skill against the
shipped Phase 0 (capability-URL run pages, PR #2200/#2336) and the designed
Phases 1–3 (GitHub login, BYOK, credits). Companion to the tenancy-boundary
audit (`docs/audits/tenancy-boundary.spec.json`): that one asks *where data
may go*; this one asks *who can be impersonated and what a stolen credential
buys*.

## Threat-level placement

| Surface | Skill tier | Notes |
|---------|-----------|-------|
| Run page (`/fleet/runs/:id?t=`) | PUBLIC | internet-reachable, bearer token in URL |
| Relay control plane (`/v1/fleet/*`) | PUBLIC ingress, operator-only | single bearer gate |
| Relay↔executor (queue, shared D1/KV) | INTERNAL | same Cloudflare account, no cross-tenant hop |
| Local daemon | DEV/TEST-equivalent | loopback + 0600 socket, by design (ADR-0003 lineage) |

## What already meets the bar (keep, and converge on)

- **Harbor cards are real ocaps**: EdDSA-signed, capability-scoped, TTL'd,
  JTI-revocable, and the OIDC→card exchange **attenuates server-side and
  rejects `admin`** (`handlers.ts` S8, `attenuateOidcCaps`). This is the
  substrate every new credential in ADR-0101 should converge on, not a
  parallel invention.
- **OIDC exchange replay protection**: `jti` single-use dedup
  (`oidc_exchanges`), exact-audience match, JWKS cache with bounded fail-soft.
- **Webhook path**: HMAC-verified body + `deliveryId` idempotency absorbs
  replayed deliveries end-to-end (check-run reuse, INSERT OR REPLACE
  transcript).
- **Executor zero-trust invariant**: config/contracts read from the trusted
  default branch only, never `pull_request.head`.
- **Run-page gate**: timing-safe compares, fail-closed on short/absent
  secrets, identical 404s (no existence oracle), no-JS CSP against
  model-output XSS — matches the skill's request-processing flow except for
  TTL (Z1).

## Findings (severity-ranked)

### Z1 — HIGH: run-page token is an eternal, unversioned bearer capability

`t = HMAC(RUN_PAGE_SECRET, runId)` has no TTL, no key id, no audience. The
no-TTL choice is deliberate and documented (check-run links must not rot), but
**unversioned** means rotation is all-or-nothing: a leaked secret forces
breaking every details_url ever stamped. Fix in Phase 1, cheap and
backward-compatible: token format `v1.<hmac>` with the relay accepting the
current and previous key for a grace window (`RUN_PAGE_SECRET`,
`RUN_PAGE_SECRET_PREV`). PUBLIC-tier discipline says a bearer that cannot
expire must at least be rotatable without collateral damage.

### Z2 — HIGH: `RELAY_OPERATOR_TOKEN` is an ambient god-credential

One static bearer gates the entire control plane (pause, save-to-PR, config,
revocation, audit) with no TTL, no scoping, no attenuation, no per-holder
identity — the exact "ambient authority" anti-pattern, and it's shared by
every surface that operates the fleet (pd-console, scripts, this session).
Phase 1's `user_tokens` + operator role starts the fix; finish it by making
operator actions **harbor-card `admin` capabilities** (the mechanism already
exists and is currently *rejected* at the exchange — mint them deliberately
instead) and demoting `RELAY_OPERATOR_TOKEN` to break-glass with a rotation
calendar. Every operator action should carry *whose* credential did it (feeds
Z3).

### Z3 — MEDIUM: audit trail is honest-writer only

`audit_log` and `fleet_runs`/`fleet_run_steps` are plain D1 tables: any writer
(compromised worker, D1 console) can silently rewrite history. Fine as
operational telemetry; not evidence. ADR-0029's Merkle forest is the designed
fix — when accounts ship (Phase 1), fold run/audit rows into leaf material so
the run page can eventually display an inclusion proof (this is also ADR-0039
Surface 1, receipts). Until then, don't present the transcript page as
tamper-evident anywhere in copy.

### Z4 — MEDIUM (Phase 2 gate): BYOK keys must never enter model-visible context

Ships process attacker-influenced text (PR diffs) — the classic exfiltration
channel is a prompt-injected instruction that coaxes secret material into
model input or output. The envelope-encryption design covers storage; add the
runtime invariant to ADR-0101 Phase 2 acceptance: **decrypt at the fetch call
site only; the plaintext key may appear in an Authorization header and
nowhere else — never in prompts, transcripts, `fleet_run_steps.detail`, logs,
or error messages.** Enforce with a redaction wrapper around the provider
client plus a CI grep-gate on the executor for key-bearing log/transcript
writes, mirroring `lib/secret-env.ts`'s scrub-then-getter pattern locally.

### Z5 — LOW: queue messages between relay and executor are unsigned

`FleetRunJob`s carry no JWS envelope. INTERNAL tier + same-account Cloudflare
queue makes this acceptable today; it stops being acceptable the moment a
second producer or cross-account harbor can enqueue (ADR-0092 federation). Add
a signed-envelope requirement to any federation design that touches
`fleet-runs`.

### Z6 — LOW: Phase 1 session/token design — small tightenings

The design already hashes tokens and requires re-auth for sensitive ops. Add:
session TTL ≤ 7d with idle timeout, `pdu_` tokens default-expiring (90d) with
`expires_at` required rather than optional, and per-token last-used surfacing
(the `user_provider_keys.last_used_at` idea, applied to credentials too).

## Delegation-chain note (Phase 3 anchor caveats)

The planned spend-cap macaroons must preserve the attenuation invariant the
skill demands: a repo-scoped, USD-capped caveat chain may only ever narrow
(`fleet:spend max_usd=20 repo=X` → `max_usd=5 repo=X expiry=+1h`), and the
executor verifies the *whole chain* before each ship. The `pd-anchor` kernel
already models this; the review point is to keep verification in the executor
(spend site), not the relay (issue site).

## Quality-gate scorecard (skill checklist, applied)

| Gate | Status |
|------|--------|
| Unique cryptographic identity per actor | daemons yes (Ed25519); human operators no until Phase 1; operator token is anonymous (Z2) |
| Signed messages + TTL + replay protection | OIDC/webhook yes; queue no (Z5); run-page token no TTL (Z1) |
| Ocap, no ambient authority | harbor cards yes; operator token violates (Z2) |
| Attenuation invariant on delegation | exchange attenuates + rejects admin: yes; Phase 3 caveats must inherit |
| Append-only Merkle audit | no — plain tables (Z3, ADR-0029 is the plan) |
| Sandboxed execution | Workers V8 isolates + Workers AI: yes for cloud; local fleet inherits OS user (by design) |
| Content-addressed, signed skills | out of scope here (ship contracts come from trusted branch — commit-SHA addressed) |

## Disposition

Z1 and Z4 become Phase 1/Phase 2 acceptance criteria alongside the
tenancy-boundary gates; Z2 is a standing item to retire the operator token in
favor of admin-scoped harbor cards; Z3 waits on ADR-0029; Z5 blocks
federation, not accounts; Z6 folds into the Phase 1 schema when built.
