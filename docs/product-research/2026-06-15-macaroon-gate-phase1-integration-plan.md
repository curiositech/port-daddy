# ADR-0053 Phase 1 — macaroon-discharge gate: integration plan

> **Diátaxis mode:** explanation. This is the build map for wiring the
> already-shipped macaroon crypto into Port Daddy's live push path. It is not a
> tutorial (no step-by-step you can paste) and not a reference (no exhaustive API
> list) — it explains *what remains*, *in what order*, and *why each step is
> shaped the way it is*, so the next session does not re-derive the sequence.

## Where Phase 1 stands (2026-06-15)

The gate is being built bottom-up. Two layers are done:

1. **The pure crypto** — `lib/macaroon/` (PR **#384**, merged). A **macaroon**
   (Birgisson et al., 2014 — a bearer credential whose authority can only ever
   *narrow*, never broaden, because each caveat folds into a chained HMAC) with
   the Appendix A first-party grammar and one third-party "rent-paid for session
   S" caveat. Verification is **per-hop**. The discharge construction's
   unforgeability + request-binding is machine-checked in
   `core/kernel/pd-anchor/formal/proverif/macaroon-discharge/macaroon_discharge_v1.pv` (**ProVerif** — an automated cryptographic-
   protocol verifier — Q1 `true`); the analogous "naive final-vs-root is unsound"
   result on the Ed25519 *card* construction lives on
   `defense/anchor-attenuation-soundness`. The per-hop-vs-naive regression (Q2) is
   `core/kernel/pd-anchor/formal/proverif/macaroon-discharge/macaroon_discharge_v2_naive_unsound.pv` (the naive verifier is unsound
   under cross-grant replay). 46 tests.

2. **The daemon-side store** — `lib/macaroon/store.ts` (PR **#385**). Mints
   grants, keeps their root + caveat keys in the **OS keychain**
   (`lib/keychain.ts` — never plaintext SQLite), gates discharge against live
   lease facts via the shipped `evaluateLeaseRent()`
   (`lib/coast-guard/compulsion.ts`), and hard-revokes by deleting keys. The
   secret backend is injected (`SecretStore`) so tests use an in-memory map. 9
   tests.

What remains is **wiring** — making the gate reachable by the agent and by the
two enforcement points (the daemon push broker and the Relay), then the final
operator-gated flip that makes it mandatory.

## The remaining steps, in dependency order

### Step A — `pd discharge` CLI + daemon route

The agent-facing surface. `pd discharge --session S` POSTs to a new daemon route
(Fastify plugin, the `FastifyPluginAsync<{ deps }>` convention in `routes/`)
that:

1. gathers lease facts with `gatherLeaseFacts()`
   (`lib/coast-guard/compulsion-facts.ts`) — the impure half that shells to git +
   queries the daemon;
2. calls `store.discharge({ grantId, session, facts, nowMs })`;
3. returns the serialized discharge macaroon, or the **corrective** refusal
   reason (which, per [[feedback_guardrails_never_advertise_bypass]], names only
   the fix — publish a note, rebase — never a bypass).

Wiring touches `routes/index.ts` → `server.ts` (route registration + a
`createMacaroonStore` instance in the daemon deps) and `cli/commands/`. No
enforcement yet — this only lets an agent *obtain* a discharge.

### Step B — the Relay verify path (the cross-machine wall) — PORTABILITY WRINKLE

**The Relay does not run on Node.** `apps/relay` is a **Cloudflare Worker**; its
crypto (`apps/relay/src/crypto.ts`) is **`@noble/ed25519` + `@noble/hashes` over
Web Crypto**, not `node:crypto`. The `lib/macaroon` core uses `node:crypto`
(`createHmac`, `createCipheriv` for AES-256-GCM). Those do not exist in the
Workers runtime.

**Implication:** the Relay cannot import `lib/macaroon/macaroon.ts` as-is. Two
options, in preference order:

- **B1 (preferred): a runtime-agnostic core.** Refactor the macaroon primitives
  to take an injected crypto provider (`hmacSha256`, `aesGcmSeal/Open`) with two
  bindings — a `node:crypto` binding for the daemon and a `@noble/hashes` +
  `crypto.subtle` (Web Crypto AES-GCM) binding for the Worker. The chained-MAC
  and verify logic stay shared; only the primitive calls differ. This keeps one
  source of truth for the (security-critical, ProVerif-shaped) verification
  order.
- **B2 (avoid): a second hand-ported verifier in the Worker.** Duplicates the
  per-hop logic — exactly the drift risk the soundness proof warns against. Only
  if B1's abstraction proves too costly.

This is the single largest remaining design decision and the reason Step B is
not a quick wire-up. It should land as its own PR with its own tests run **in a
Workers-like environment** (per [[feedback_regression_test_under_real_runtime]]
— a bug that only appears under the real runtime is the failure mode here).

### Step C — `pd guard --git-verb push` broker

The local enforcement point. The git shim already calls
`pd guard check --git-verb push` (`cli/utils/git-shim.ts`). Today that consults
the advisory rent check; Step C makes it require a valid grant + discharge:
`store.verify(grant, discharges, ctx)` must return `authorized` or the push is
refused. The grant + discharge travel via the session's local context
(`.portdaddy/`), not the agent's argv.

### Step D — the enforcement flip (OPERATOR-GATED)

Until D, every prior step is **additive and safe**: the gate exists, can be
exercised, and logs, but a push still works without it. D removes the fallback —
no valid discharge, no push. This is an **outward-facing behavior change** that
can strand in-flight agents and the auto-merge bots, so it is **operator-gated**
(same class as the Phase 1-bp branch-protection flip). It ships behind a flag,
defaulting off, flipped per-fleet low-trust-first.

## The honesty boundary (carry into every PR description)

Phases A–D make the gate **unforgeable** and the audit a **verifiable
transcript**. They do **not confine** a malicious same-UID holder: between
fetching a 20-minute discharge and using it, the agent holds a live capability it
could copy. Only **Layer 3** (separate-UID / VM, ADR-0050 phase 4) confines the
holder. Never describe the macaroon gate as the vault.

## Test posture

Each step adds tests under the runtime where it actually runs: daemon steps under
Jest with `createTestDb` + `InMemorySecretStore` (matching
`coast-guard-compulsion.test.js`); the Relay step under a Workers-like harness.
CI must exercise the discharge → verify round-trip end-to-end, not just the unit
pieces.
