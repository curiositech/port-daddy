# ADR-0120: The Rust kernel boundary — what Rust is for, once and for all

- **Status:** Accepted
- **Date:** 2026-08-04
- **Supersedes:** the stale "four crates, no single kernel" guidance in
  `AGENTS.md` and `skills/port-daddy-internal-dev` (rewritten alongside this ADR)
- **Builds on:** ADR-0054 (release cadence + Rust surface alignment),
  ADR-0087 (trusted computing base broker), ADR-0049 (relay), ADR-0101 (login)

## The question

Should the crypto live in Rust? What is the Rust kernel *for*? Should Rust
fully replace TypeScript?

This has been answered piecemeal (ADR-0054's kernel-canonical macaroon ruling,
ADR-0087's TCB analysis), but never in one place, and two agent-facing
documents still describe a pre-kernel world. This ADR is the consolidation.
Every agent working in this repo reads the rule here and follows it.

## The verdict

**No, Rust does not replace TypeScript. Yes, every security primitive gets
exactly one canonical implementation, and that implementation is Rust.**

The repo runs on a three-plane model:

### Plane 1 — the security kernel: Rust, canonical, small

`core/kernel/pd-anchor` (Ed25519 cards, capability envelopes, Merkle evidence,
the macaroon discharge gate, keystore), `core/pd-broker` (the ADR-0087
separate-UID credential broker), and `core/harbor-card-rs` (FFI: constant-time
compare, capability-subset check). Anything that signs, verifies, compares
secrets, or holds keys belongs here, ONCE. Native surfaces (the daemon) reach
it over FFI (`lib/arbiter.ts`, `lib/macaroon-ffi.ts`).

Two things justify Rust here, and ADR-0087 is explicit that they are not the
same thing:

1. **Memory-safe key handling + one canonical implementation** — a property of
   the language.
2. **Isolation** — a property of the *process boundary* (separate UID, dropped
   capabilities), which Rust does not provide. "Code written in Rust but
   running in the same process and UID as an agent-reachable daemon is exactly
   as forgeable as TypeScript."

So the kernel stays small: it is a TCB, and every line added to it is a line
someone must trust. ADR-0087 already rejected moving the rent evaluator into
the kernel — "expands the TCB by a large, fast-changing surface for no gain."

### Plane 2 — the product planes: TypeScript, on purpose

The daemon's control plane, fleet logic, dispatch, the CLI, the website, and
BOTH Cloudflare Workers (`apps/relay`, `apps/fleet-executor`). These stay
TypeScript for two independent reasons:

- **Doctrine:** they are outside the TCB. Rewriting untrusted code in Rust
  buys zero security and slows product iteration (ADR-0087 §alternatives).
- **Physics:** the Workers runtime cannot `dlopen` a native library. There is
  NO mechanism today by which a line of relay TypeScript can call the Rust
  kernel. The only path would be a wasm32 build of the kernel crates
  (`ed25519-dalek`/`sha2`/`hmac` are wasm-capable; `getrandom` needs the
  Workers entropy shim; `rusqlite` is not and must stay out of any wasm
  target). That is a deliberate, separate decision — see "Deferred" below —
  not something to drift into.

Workers therefore carry their own primitive layer (`apps/relay/src/crypto.ts`,
`@noble/*` because WebCrypto Ed25519 is not universal in Workers). That is an
ACCEPTED duplication at the primitive level — noble and dalek both implement
RFC 8032; we are not maintaining the math twice. What is NOT accepted is
duplicating *protocol logic* (formats, chain rules, capability grammars)
without a parity gate — see the inventory below.

### Plane 3 — the console: Rust because GPU, not because crypto

`core/pd-console` (~40k LOC, 74% of all Rust in the repo) is Rust for
GPUI/Metal, not for security. It touches no crypto and never should — it reads
what the daemon serves. GPU prototypes (`pd-*-proto`) are excluded from the
workspace on purpose. Do not cite the console as precedent for "we should
write X in Rust."

## The rule for every agent going forward

1. **New security primitive** (sign/verify/compare/derive/wrap): implement in
   the Rust kernel first. TS surfaces that can reach FFI use FFI. TS surfaces
   that cannot (Workers) implement a byte-parity twin AND land a shared test
   vector fixture in `tests/fixtures/*-parity-vectors.json` in the same PR —
   generated from the Rust impl, asserted by both suites. No fixture, no
   second implementation. The macaroon and CPM-scheduler fixtures are the
   model (`core/kernel/pd-anchor/tests/parity_vectors.rs` ⇄
   `tests/unit/macaroon-parity.test.js`).
2. **New product logic**: TypeScript. Do not put it in the kernel. Do not
   scaffold new Rust crates for non-kernel, non-GPU work.
3. **Never a third implementation.** Two is the ceiling (canonical Rust +
   one gated TS twin where FFI can't reach). If you find yourself writing a
   third, you are fixing the wrong problem.
4. **Fixture regeneration is a security-relevant diff.** The fixtures are
   generated from the canonical Rust impl; regenerating one to make a TS
   change pass reclassifies a behavior change as expected. Reviewers treat a
   fixture diff exactly like a change to the verifier itself.
5. **Cross-Worker shared secrets get a shared vector.** Two separately
   deployed Workers implementing one HMAC contract (e.g. the run-page token)
   must both assert the same fixture (`tests/fixtures/run-page-token-parity-vectors.json`).

## Honest inventory at time of writing (the debt this ADR names)

- **Constant-time compare exists 4 times** (`harbor-card-rs`,
  `pd-anchor::macaroon::ct_eq`, `apps/relay/src/crypto.ts:timingSafeEqual`,
  `lib/macaroon/macaroon.ts`). Primitive-level, each correct, each ~8 lines;
  tolerated under the primitive-duplication carve-out. Do not add a fifth.
- **Harbor cards have THREE implementations and two incompatible formats.**
  The LIVE wire format is hv:2 — minted by `lib/harbor-tokens.ts` (jose,
  EdDSA JWT, structured `cap: {op, channel, rate, bytes}[]`), verified by
  `apps/relay/src/auth.ts` (which adds the D1 JTI revocation check).
  `core/harbor-card-rs::verify()` verifies a DIFFERENT, legacy format: it
  signs raw `header.payload` bytes where hv:2 signs the SHA-256 hex digest,
  and its `cap: Vec<String>` cannot express structured capabilities. **Ruling:
  hv:2 is the canonical wire format. `harbor-card-rs::verify()` is NOT a
  verifier of the wire format and must not be presented as one; its canonical
  exports are `constant_time_compare` and `verify_capability_subset` (the FFI
  the Arbiter loads).** Porting hv:2 verification into `harbor-card-rs` behind
  a shared fixture is the top NEXT item below.
- **`lib/macaroon` is deprecated byte-parity fallback** (ADR-0054): kernel
  Rust is canonical, FFI preferred, fixture-gated. Correct end-state; keep.
- **Chain-of-events parity partner is Python**, not Rust
  (`lib/merkle-chain.ts` ⇄ `skills/pd-relay-zero-trust/scripts/`). Acceptable:
  the relay and daemon share the TS impl and the format has a reference
  implementation. If the kernel's `pd-mesh` ever carries the event chain for
  real, it gets a fixture like everything else.

## Build/test gates (changed by this ADR's PR)

- `rust-kernel` and `rust-harbor-card` CI jobs: already always-run.
- **`rust-broker` job added**: `core/pd-broker` — the ADR-0087 TCB with three
  test files — was in the workspace but no CI job ever executed
  `cargo test` at `core/`, so the broker's tests had never run in CI.
- **Run-page-token parity fixture added** with tests in both Workers, closing
  the byte-identical-but-ungated duplicate
  (`apps/relay/src/fleet-run-page.ts` ⇄ `apps/fleet-executor/src/run-page.ts`).
- `cargo fmt`/`clippy` gate only `harbor-card-rs` today. Widening to the
  kernel workspace is desirable but is a mechanical cleanup PR, not doctrine.

## Deferred, explicitly (so nobody re-litigates by accident)

- **WASM kernel for Workers.** The only honest route to "relay crypto runs the
  canonical Rust." Worth doing when (a) the hv:2 port lands in
  `harbor-card-rs` and (b) a real divergence or audit finding shows the noble
  layer + fixtures are insufficient. Until then the fixture regime is the
  gate. Anyone starting this work: wasm32 target on `harbor-card-rs` only
  (never crates with `rusqlite`), `getrandom` with the `js`/workers feature,
  `[[rules]] CompiledWasm` in wrangler.
- **Full TS→Rust rewrite.** Rejected. The load-bearing runtime is the Bun/TS
  daemon plus two TS Workers; the TCB is deliberately small; rewriting
  untrusted planes buys nothing (ADR-0087) and the Workers can't run native
  code anyway. This ADR is the standing answer; a future proposal must
  supersede this ADR explicitly rather than starting the debate fresh.
