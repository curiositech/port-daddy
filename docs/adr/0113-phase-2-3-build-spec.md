# 0113. TCB enforcement — phases 2 + 3 build spec (authorize-push orchestration + signed rent attestation)

## Status

Proposed (build spec — the next slice executes this once the kernel key-custody
slice has landed).

## Context

Slice 1 of the DOM DADDY enforcement program (ADR-0050 §teeth, ADR-0057
enforcement slices) landed in **PR #496**: the push-grant root and caveat keys,
and the issue-discharge *decision*, moved into Rust. The custody store and the
keyless FFI surface live in `core/kernel/pd-anchor/src/keystore.rs` and
`core/kernel/pd-anchor/src/ffi.rs`. Three exports route through the kernel store
and **never carry a key in a request or response**:

- `pd_keystore_issue_grant_json` — mint a push grant; keys retained internally.
- `pd_keystore_issue_discharge_json` — mint a discharge **only** when
  `verdict == "paid"`; the caveat key is read from the store, never supplied.
- `pd_keystore_authorize_json` — verify a presented grant + discharges against
  the kernel-held keys, looked up by the grant's own identifier.

The custody half is done, but two gaps in `keystore.rs`'s own module doc remain
open, and they are exactly phases 2 and 3:

> - the rent **verdict** is still supplied by the (in-process) daemon here;
>   making it a signed attestation the kernel verifies removes the daemon's
>   ability to simply assert `Paid`.
> - running the kernel as a **separate-UID process** removes the daemon's
>   ability to be compromised into calling `issue_discharge` at all.

Phase 2 wires the *decision-in-daemon* path: a daemon `authorize-push` route
that calls the keyless FFI, plus a pre-push git hook that blocks on a deny
verdict. This makes the daemon a **thin untrusted orchestrator** — it gathers
context and asks the kernel; it cannot forge an authorization because it holds no
keys. Phase 3 closes the verdict-trust gap: the daemon **signs** its rent verdict
with a daemon-held signing key, and the kernel **verifies** that signature before
it will mint a discharge. This is the load-bearing hinge of the whole program —
**decision-in-daemon, verification-in-TCB** — and it is the precondition for the
separate-UID kernel process (kernel slice 3 / ADR-0050 Layer 3), because once the
verdict is a signed artifact the kernel can sit behind a UID boundary and still
trust nothing the daemon merely asserts.

This document is the precise implementation spec, not the implementation. It is
written now, against the landed slice-1 surface, so the next slice can execute it
in one pass once **PR #496** is fully merged to `origin/main` and the dylib is
rebuilt. Building it on the unmerged branch would be fragile; the FFI signatures
and the rent-verdict enum are stable enough to specify against today.

### What exists today (read before building)

- `core/kernel/pd-anchor/src/keystore.rs` — the custody store (`issue_grant`,
  `issue_discharge`, `authorize`, `revoke`) and its Rust unit tests.
- `core/kernel/pd-anchor/src/ffi.rs` — the keyless C-ABI exports above, each
  wrapped in `catch_unwind`, fail-closed, JSON in / JSON out, freed via
  `pd_string_free`.
- `core/kernel/pd-anchor/src/macaroon.rs` — `RentVerdict` (`Paid` / `RentDue` /
  `Idle` / `Stale`), `mint_push_grant`, `discharge_rent_paid`, `verify`, and the
  `hmac` / `ct_eq` primitives. The discharge construction is machine-checked in
  `core/kernel/pd-anchor/formal/proverif/macaroon-discharge/macaroon_discharge_v1.pv`.
- `lib/coast-guard/compulsion.ts` — the **pure** rent evaluator
  (`evaluateLeaseRent` → `RentEvaluation { verdict, action, reason, rentDue }`).
  This is what phase 3 signs.
- `lib/coast-guard/compulsion-facts.ts` — the impure fact gatherer
  (`gatherLeaseFacts`), fails open.
- `lib/arbiter.ts` — the existing koffi loader pattern for the harbor-card dylib
  (`loadKoffi`, `candidateNativeEnforcerPaths`, `loadNativeEnforcer`). The
  pd-anchor binding mirrors this, against `libpd_anchor`.
- `routes/attest.ts` and `routes/index.ts` — the Fastify plugin + registration
  idiom every daemon route follows.
- `hooks/pre-push` and `scripts/install-pre-push-hook.sh` — the existing
  pre-push hook (website-v2 contracts) and its installer; the authorize-push
  gate is added here.
- `tests/bun/backup-bun-sqlite.test.ts` — the canonical `bun test` +
  `bun:sqlite` regression-test harness the phase-2/3 daemon tests follow.

---

## Decision — Phase 2: daemon `authorize-push` route + pre-push hook

### 2.1 The TypeScript pd-anchor FFI binding (new)

Create `lib/anchor/keystore-ffi.ts` (proposed — not yet shipped). It mirrors the
koffi-loader structure in `lib/arbiter.ts` (`loadKoffi`, candidate-path
resolution, embedded-asset fallback, fail-closed on load error), but binds the
three keyless exports plus `pd_string_free`:

```
bool/string pd_keystore_issue_grant_json(const char *req, size_t len) -> *mut c_char
bool/string pd_keystore_issue_discharge_json(const char *req, size_t len) -> *mut c_char
bool/string pd_keystore_authorize_json(const char *req, size_t len) -> *mut c_char
void        pd_string_free(char *ptr)
```

Module surface (TypeScript):

- `issueGrant(opts: { repo; session; expiresMs; protectedBranch }): { ok; grantId; macaroon } | { ok:false; reason }`
- `issueDischarge(opts: { grantId; verdict: RentVerdict; nowMs; ttlMs? }): { ok; discharge|null; reason }`
- `authorize(opts: { macaroon; discharges; ctx }): { ok; reason }`

Rules, enforced in the binding:

1. **Every call frees the returned pointer** (`pd_string_free`) exactly once,
   wrapped in `try/finally` around the `JSON.parse`. This matches the
   `verify_via_ffi` / `call_export` test helpers in `ffi.rs`.
2. **No key field is ever placed in a request object.** The binding's request
   types do not have `rootKey` / `caveatKey` fields; this is asserted by a unit
   test (`JSON.stringify(req)` must contain neither `"root_key"` nor
   `"caveat_key"`), mirroring `keystore_custody_roundtrip_carries_no_keys` in
   `ffi.rs`.
3. **Fail closed when the dylib is absent.** If `libpd_anchor` cannot be loaded,
   the binding returns `{ ok:false, reason:'pd-anchor native gate unavailable' }`
   for `authorize` and `issueDischarge` — never a silent allow. (The deprecated
   key-taking byte-parity path in `pd_macaroon_verify_json` is **not** re-exposed
   here; slice 2 is the migration *onto* the keyless surface, per the `ffi.rs`
   custody-surface comment.)

The dylib name and candidate paths reuse the helpers from `lib/arbiter.ts`
(`nativeLibName`, `candidateNativeEnforcerPaths`) generalized to accept a base
name, so `libpd_anchor.{dylib,so,dll}` resolves the same way the harbor-card
dylib does (next to `dist/core`, under `PORT_DADDY_RESOURCE_DIR`, beside
`process.execPath`).

### 2.2 The grant lifecycle store (daemon side)

The kernel holds the keys but is in-memory and grant-id-keyed; the daemon needs
to remember **which grant belongs to which session/worktree** so the pre-push
hook can find it. Add a small table via a new migration
`migrations/0NNN-push-grants.sql` (proposed — not yet shipped):

```
push_grants(
  grant_id TEXT PRIMARY KEY,   -- the kernel's grant id (opaque)
  session_id TEXT NOT NULL,
  repo TEXT NOT NULL,
  worktree_path TEXT NOT NULL,
  protected_branch TEXT NOT NULL,
  macaroon_json TEXT NOT NULL, -- the grant macaroon (no keys)
  expires_ms INTEGER NOT NULL,
  created_ms INTEGER NOT NULL
)
```

The grant macaroon stored here carries **no forging material** — the keys stay in
the kernel (`keystore.rs`). A row is just a lookup index from a worktree back to
its kernel grant id. Grants are short-lived (20 min, `DISCHARGE_TTL_MS`), so a
daemon restart simply forces re-issuance, matching the kernel store's own
volatility.

### 2.3 The daemon route (new)

Create `routes/authorize-push.ts` (proposed — not yet shipped), a Fastify plugin
registered in `routes/index.ts` exactly like `attestPlugin`
(`await fastify.register(authorizePushPlugin, { deps } as any)`).

Three endpoints:

- **`POST /push-grants`** — issue a grant for a session+worktree. Body:
  `{ sessionId, repo, worktreePath, protectedBranch }`. Calls
  `issueGrant` (FFI), persists the row from §2.2, returns `{ grantId }`.
  Idempotent per (session, worktree): if a live, unexpired grant exists, return
  it instead of minting a second.

- **`POST /authorize-push`** — the gate. Body:
  `{ sessionId, worktreePath, branch }`. Steps:
  1. Look up the grant row for (session, worktree). No row / expired →
     `{ ok:false, reason:'no live push grant; run pd begin in this worktree' }`.
  2. Gather rent facts: `gatherLeaseFacts(sessionId, worktreePath)` from
     `lib/coast-guard/compulsion-facts.ts`.
  3. Evaluate: `evaluateLeaseRent(facts)` from `lib/coast-guard/compulsion.ts` →
     `{ verdict }`.
  4. **Phase 2 (this slice):** call `issueDischarge({ grantId, verdict, nowMs })`
     over the FFI. The *kernel* decides whether a discharge is minted — it only
     mints for `Paid`. (Phase 3 wraps the verdict in a signature; see §3.)
  5. If a discharge came back: `prepare_for_request`-bind it to the grant
     macaroon (done in the binding or a tiny Rust helper — see §2.5), then call
     `authorize({ macaroon, discharges:[bound], ctx:{ op:'push', repo, branch,
     session, now_ms } })`. Return `{ ok, reason }` from the kernel verdict.
  6. If no discharge: return `{ ok:false, reason }` carrying the rent evaluator's
     `reason` string (which points only at the corrective action — never names a
     bypass, per the guardrails-never-advertise-bypass rule already honored in
     `compulsion.ts`).

- **`DELETE /push-grants/:grantId`** — revoke. Calls a new
  `pd_keystore_revoke_json` export (see §2.4) and deletes the row. Wired to
  session end and to reclaim.

**The daemon never makes the allow/deny decision itself.** It gathers facts,
asks the kernel to issue a discharge, asks the kernel to authorize. Every
trust-bearing step is a kernel call. That is what "thin untrusted orchestrator"
means concretely: strip the daemon of keys and of the final verdict, leave it the
plumbing.

### 2.4 One new FFI export (revoke)

`keystore.rs` already has `revoke(grant_id) -> bool`, but `ffi.rs` does not
export it. Add `pd_keystore_revoke_json` to `core/kernel/pd-anchor/src/ffi.rs`
(in: `{grant_id}`, out: `{ok, revoked}`), following the exact shape of
`pd_keystore_issue_discharge_json` (read_request → parse → call `keystore::`
→ `respond_value`, all under `catch_unwind`). Add it to the `lib.rs` re-export
list. This is the only Rust change phase 2 requires.

### 2.5 Request binding

The kernel's `authorize` expects discharges already bound via
`Macaroon::prepare_for_request` (see `keystore.rs::authorize` and its
`paid_rent_authorizes_a_push` test). Two options, pick the simpler:

- **(preferred)** Have `pd_keystore_issue_discharge_json` optionally return the
  discharge **already bound** to its grant (it knows the grant id, so it can read
  the grant macaroon from the store and bind). This keeps all macaroon
  cryptography in Rust and the TS binding never touches `prepare_for_request`.
  Add an optional `bind: true` field to the discharge request; default false
  preserves the existing test.
- (fallback) Expose a `pd_macaroon_bind_json` helper. Avoid if the first option
  lands — fewer TS-side crypto seams is the whole point.

### 2.6 The pre-push hook (new behavior)

Extend `hooks/pre-push` (proposed change — the file exists; this adds a block)
and its installer `scripts/install-pre-push-hook.sh`. Before the existing
website-v2 checks, the hook:

1. Resolves the pushed branch and the current worktree path (`git rev-parse
   --show-toplevel`, `git symbolic-ref --short HEAD`).
2. Resolves the session id for this worktree (the daemon already maps
   worktree → session; read it via `pd whoami --json` or a small
   `/sessions/by-worktree` lookup).
3. `POST /authorize-push { sessionId, worktreePath, branch }` to the daemon.
4. **Blocks on a deny verdict** (`ok:false`): prints the daemon's `reason` to
   stderr and `exit 1`. The agent sees only the corrective action.
5. **Fails closed on a daemon error** *only for protected pushes*: if the daemon
   is unreachable, the hook must not silently allow a push to a protected branch.
   For non-protected branches, a daemon-unreachable state degrades to the
   existing website-v2 checks (the hook is advisory-by-construction here — see
   §Honest scope). The protected-branch deny is the hard floor.

The hook is **in-band and advisory** — an agent that removes the hook bypasses
it. That is acknowledged and is precisely why phase 3 + kernel slice 3 exist: the
real wall is out-of-band (branch protection + separate-UID kernel + a push broker
the agent's UID cannot reach), per ADR-0050 Layer 3 and the DOM-DADDY-enforcement
canon. Phase 2's value is making the **honest** path correct and making every
trust decision a kernel call, so that when the out-of-band wall lands, the
decision logic is already where it belongs.

---

## Decision — Phase 3: signed rent attestation (decision-in-daemon, verification-in-TCB)

### 3.1 The trust gap phase 3 closes

In phase 2, `POST /authorize-push` calls `issueDischarge({ grantId, verdict })`
and the kernel mints a discharge for `verdict == "paid"`. But the daemon supplies
the verdict string. A compromised daemon can simply pass `"paid"`. The kernel's
own module doc names this: *"making it a signed attestation the kernel verifies
removes the daemon's ability to simply assert `Paid`."*

Phase 3 makes the verdict an unforgeable artifact: the daemon **signs** the
`RentEvaluation` it computed from `compulsion.ts`, and the kernel **verifies**
that signature against a key it trusts before it mints a discharge.

### 3.2 Key management — the hinge

This is the load-bearing design choice, stated explicitly to avoid the easy error
of putting the verify key in the wrong place:

- **The SIGNING key is the daemon's.** The rent *decision* is the daemon's job —
  it has the git facts and the session state (`compulsion-facts.ts`). The daemon
  holds an Ed25519 signing key and signs each verdict. This key may be a daemon
  process secret today; under kernel slice 3 it becomes a key the daemon UID
  holds and the kernel UID does not.
- **The VERIFY happens in the kernel/TCB.** The kernel holds the daemon's
  **public** verification key and checks the signature before `issue_discharge`
  mints anything. The kernel trusts *the math*, not the daemon's word.
- **Why this asymmetry is the whole point.** The daemon decides; the kernel
  verifies a signed decision. A compromised daemon can still *decide* (that was
  never the security boundary — the daemon is the policy engine), but it cannot
  forge a *different* decision than the one it signed, and — critically once
  kernel slice 3 lands — a process that is **not** the daemon (an agent sharing a
  box, a compromised tool) cannot produce a verdict the kernel will accept,
  because it does not hold the daemon's signing key. The discharge gate stops
  being "the daemon asserted paid" and becomes "a verdict signed by the daemon's
  key says paid, and the kernel checked the signature."

The trust ordering, made concrete:

```
agent/tool  →  (no signing key)            → cannot mint a valid verdict
daemon      →  signs RentEvaluation        → DECISION (untrusted process, trusted key)
kernel/TCB  →  verifies signature, then     → mints discharge ONLY on a
               issue_discharge                valid signature + verdict==Paid
```

### 3.3 The attestation envelope

Define a canonical, deterministic serialization of the signed verdict. Add to
`lib/coast-guard/compulsion.ts` (it already owns `RentEvaluation`):

```
RentAttestation {
  grantId: string          // binds the verdict to ONE grant (anti-replay across grants)
  verdict: RentVerdict      // 'paid' | 'rent-due' | 'idle' | 'stale'
  nonce: string             // the grant's rent_nonce, echoed (anti-replay)
  issuedMs: number          // signing time
  expiresMs: number         // issuedMs + a short window (<= DISCHARGE_TTL_MS)
}
RentAttestationEnvelope {
  attestation: RentAttestation
  signatureHex: string      // Ed25519 over the canonical JSON of `attestation`
  keyId: string             // which daemon key signed (rotation)
}
```

Canonicalization rule: sorted keys, no whitespace, integers not floats — a single
shared encoder used by both the TS signer and the Rust verifier so the bytes
match. This is the same discipline the macaroon HMAC chain already relies on in
`macaroon.rs`.

The `grantId` + `nonce` binding is what stops a captured `paid` attestation from
being replayed against a *different* grant — the same defense the macaroon
discharge binding gives, carried up one level to the verdict.

### 3.4 The signer (daemon side, new)

Create `lib/coast-guard/rent-attestation.ts` (proposed — not yet shipped):

- `signRentVerdict(evaluation: RentEvaluation, grant: { grantId; nonce }, keypair): RentAttestationEnvelope`
- Uses `node:crypto` Ed25519 (`crypto.sign(null, canonicalBytes, privateKey)`).
- The daemon's keypair is generated on first run and stored under
  `~/.port-daddy/keys/rent-attestation.{pub,key}` with `0600` perms; the
  **public** key is registered with the kernel at daemon startup via a new FFI
  call (§3.5). Key rotation = new `keyId`, re-register, keep verifying the old
  one for one TTL window.

`POST /authorize-push` (from §2.3) changes one step: instead of passing a bare
`verdict` string to `issueDischarge`, it passes the **signed envelope**.

### 3.5 The kernel verifier (Rust, new)

Two changes in `core/kernel/pd-anchor`:

- **Register the daemon's public key.** New FFI export
  `pd_keystore_set_attestation_key_json` (in: `{keyId, publicKeyHex}`; out:
  `{ok}`) stores the Ed25519 public key(s) in the keystore module
  (`keystore.rs`). Multiple key ids allowed (rotation). Add `ed25519-dalek` (or
  reuse a vetted Ed25519 crate already in `core/kernel/Cargo.toml` if present;
  otherwise add it) to `core/kernel/pd-anchor/Cargo.toml`.

- **Verify before issuing.** Change `keystore::issue_discharge` so its FFI entry
  `pd_keystore_issue_discharge_json` accepts the **envelope** instead of a bare
  verdict string, and:
  1. Look up the registered public key by `keyId`. Unknown key → no discharge.
  2. Verify the Ed25519 signature over the canonical bytes. Bad signature → no
     discharge.
  3. Check `attestation.grantId == grant_id` and `attestation.nonce` matches the
     grant's stored `rent_nonce`. Mismatch → no discharge (anti-replay).
  4. Check `now_ms <= attestation.expiresMs`. Expired → no discharge.
  5. Only then, and only if `attestation.verdict == Paid`, call the existing
     `discharge_rent_paid` path.

The pure decision (`discharge_rent_paid` in `macaroon.rs`) is unchanged — it
still only mints for `Paid`. Phase 3 adds a **signature gate in front of it**, so
the `Paid` it sees is one the kernel cryptographically confirmed the daemon
actually decided. Keep a backward-compatible bare-verdict path **behind a
build/feature flag for the parity tests only**; the shipped daemon path always
sends the envelope.

### 3.6 Why this unlocks the separate-UID kernel (kernel slice 3)

Once the verdict is a signed artifact the kernel verifies, the kernel no longer
needs to share a process with the daemon to trust it. It can run as a
separate-UID process (ADR-0050 Layer 3): the daemon hands it (a) the keyless
issue/authorize calls and (b) the signed verdict, over a pipe/socket, and the
kernel trusts neither the channel nor the daemon — only the signature and its own
keys. Phase 3 is therefore the precondition, not an independent feature: you
cannot move the kernel behind a UID wall while it still trusts an in-process
`verdict` string. This spec stops at the signature gate; the UID-boundary process
split is the next slice and gets its own spec.

---

## Test plan

All daemon-side regression tests run under **`bun test` on `bun:sqlite`** — the
shipped daemon runtime — following `tests/bun/backup-bun-sqlite.test.ts`. A green
jest run is not sufficient evidence for any of these; the bug class this program
guards against (a forged or absent discharge authorizing a push) only manifests
under the real engine + the real dylib.

### Rust unit tests (in `core/kernel/pd-anchor`, `cargo test`)

Extend the `#[cfg(test)]` modules already in `keystore.rs` / `ffi.rs`:

- `revoke_export_kills_the_grant_over_ffi` — `pd_keystore_revoke_json` then
  `pd_keystore_authorize_json` fails (parallels
  `keys_never_leave_the_kernel_and_revoke_kills_the_grant`).
- `issue_discharge_with_bind_returns_a_request_bound_discharge` — §2.5 option 1;
  the returned discharge authorizes directly without a TS-side bind step.
- **Phase 3 signature gate:**
  - `signed_paid_attestation_yields_a_discharge` — register a public key, sign a
    `Paid` envelope with the matching private key, assert a discharge is minted.
  - `forged_verdict_is_refused` — daemon sends `verdict:Paid` but signs a
    *different* (`RentDue`) attestation, or tampers a byte → signature fails →
    **no discharge** (this is the test that proves the trust gap is closed).
  - `attestation_for_another_grant_is_refused` — valid signature but
    `grantId`/`nonce` belongs to a different grant → no discharge (anti-replay).
  - `expired_attestation_is_refused` — `now_ms > expiresMs` → no discharge.
  - `unknown_key_id_is_refused` — signature from an unregistered key → no
    discharge.
  - `malformed_envelope_fails_closed_not_panics` — extend
    `ffi_malformed_input_fails_closed_not_panics` to the discharge envelope.

### Bun + bun:sqlite daemon regression tests (new files under `tests/bun/`)

- `tests/bun/authorize-push-bun-sqlite.test.ts` (proposed — not yet shipped):
  - boots a daemon test harness with a real on-disk WAL `bun:sqlite` DB and the
    `push_grants` migration applied;
  - `POST /push-grants`, then drives `POST /authorize-push` across the four rent
    states by seeding `LeaseFacts` (a commit-without-note → `rent-due`; a clean
    lease → `paid`):
    - **paid → `{ ok:true }`** and a push is authorized end-to-end;
    - **rent-due → `{ ok:false }`** and the `reason` names "publish a note", never
      a bypass flag (asserts the guardrails-never-advertise-bypass invariant on
      the live wire);
    - **idle / stale → `{ ok:false }`**;
  - asserts the request/response JSON over the FFI **never contains** `"root_key"`
    or `"caveat_key"` (the custody invariant, on the TS side this time);
  - asserts that with the dylib forced absent, `authorize-push` returns
    `{ ok:false }` (fail-closed), never a silent allow.
- `tests/bun/rent-attestation-bun-sqlite.test.ts` (proposed — not yet shipped):
  - signs a verdict with the daemon keypair, registers the public key with the
    kernel via the FFI, drives `authorize-push`, asserts paid authorizes;
  - flips one byte of the signature → asserts deny (the forged-verdict defense at
    the daemon↔kernel seam, under the real runtime).

### CI wiring

- The bun tests join the existing `test:bun` script (`bun test tests/bun/`) and
  the CI job that boots the bun daemon and smokes routes (the
  regression-under-real-runtime rule — a jest-green / bun-500 split is the exact
  failure mode this program must not reintroduce).
- The Rust tests run under the existing `cargo test` job for `core/kernel`.
- `node scripts/check-doc-citations.mjs docs/adr/0087-phase-2-3-build-spec.md`
  must stay green (every proposed path above carries a proposal marker).

### ProVerif (carry-over, not blocking this slice)

The discharge construction is already modelled in
`core/kernel/pd-anchor/formal/proverif/macaroon-discharge/macaroon_discharge_v1.pv`. Phase 3 adds a signature gate *in front of*
the discharge; an extension modelling "no discharge without a daemon-signed
`Paid` attestation bound to that grant" belongs in a follow-on
`core/kernel/pd-anchor/formal/proverif/rent_attestation_v1.pv` (proposed — not yet shipped). It is **not** a
gate on shipping phases 2/3 — the Rust `forged_verdict_is_refused` test is the
shipping evidence; the proof is the durability follow-up.

---

## Sequencing and blockers

1. **Blocker:** PR #496 fully merged to `origin/main` and the `libpd_anchor`
   dylib rebuilt + embedded (the daemon binding in §2.1 dlopens it). This spec is
   written against the landed slice-1 FFI surface so the build is a single pass
   once that holds.
2. **Phase 2 first, phase 3 second.** Phase 2 stands alone (honest path correct,
   every decision a kernel call) and is independently testable. Phase 3 layers the
   signature gate onto the same `authorize-push` route without changing its shape.
3. **Kernel slice 3 (separate-UID process) is out of scope here** and gets its
   own spec; it consumes phase 3's signed verdict as its precondition.

## Consequences

- The daemon becomes a genuinely thin orchestrator: no keys (slice 1), no final
  authorize decision (phase 2), no forgeable verdict (phase 3). Each phase
  removes a capability rather than adding a check an agent can route around.
- The in-band pre-push hook remains advisory by construction; the spec is honest
  that the real wall is the out-of-band separate-UID + branch-protection layer.
  Phase 2/3's job is to put the decision logic where the wall will need it.
- One new Rust dependency (Ed25519) and two small migrations/tables; everything
  else reuses the landed FFI surface, the koffi loader pattern, the Fastify route
  idiom, and the pure rent evaluator already in the tree.
