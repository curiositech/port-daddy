# Runtime Conformance — Bridging ProVerif/TLA+ to `lib/`

**Status:** strategy + first artifact landed v2.5; ongoing.
**Lead:** secops:lead.

> "How are you ensuring the ProVerif-proven algorithms are also in our
> runtime?"
>
> *— the user, 2026-05-04*

This is the right question. A `.pv` file proves an *abstract protocol*.
The TypeScript code in `lib/` is a *separate artifact*. Without an
explicit bridge, nothing prevents `lib/foo.ts` from drifting away from
the protocol the .pv file proves sound.

This document fixes the strategy and is the index for the conformance
artifacts.

---

## 1. The space of options

Five candidate strategies, evaluated honestly:

### 1.1 Property tests against the real code (already doing)

`tests/unit/bonds-conservation-property.test.js` and
`tests/unit/merkle-binding-property.test.js` test the real `lib/bonds.ts`
and `lib/merkle-tree.ts` with fast-check. 100 random adversarial cases
per property; soundness/binding/conservation verified empirically.

  - **Pros:** lightweight, runs in CI, catches regression. Already
    a habit.
  - **Cons:** not exhaustive; doesn't *prove* abstract↔concrete
    equivalence; only catches what the property generators happen
    to find.

### 1.2 Rust + Kani for hot paths (rejected for now)

Rust crate exposing the verified primitives via NAPI; Kani model-checks
each Rust function up to a bounded depth.

  - **Pros:** closest to formal verification with a runtime that ships;
    Kani harnesses generalize fast-check to bounded-model-checked.
  - **Cons:** massive cost. We are a TypeScript codebase. NAPI for
    every verified primitive = 10× the engineering for ≤ 2× the
    confidence of property tests for protocols where the .pv is
    already simple. **Recommend deferring until a concrete crypto
    primitive is identified that genuinely needs it** (e.g., a new
    Ed25519-shaped curve we add ourselves). The standard library
    primitives we use (Node's `crypto`, `jose`, `better-sqlite3`)
    are already battle-tested by larger ecosystems.

### 1.3 Code extraction from formal models (rejected)

ProVerif → ML, EasyCrypt → OCaml, F* → Rust. Single source of truth.

  - **Pros:** gold standard. The verified code IS the deployed code.
  - **Cons:** extraction tooling is rough; binding to TS hostile;
    forces our codebase into an OCaml/Rust shape that doesn't match
    Port Daddy's actual architecture. Cost-benefit is wrong here.
    **Recommend revisiting only if a future project is greenfield.**

### 1.4 Spec-conformance probes (chosen)

Per-`.pv` file, write a small TS test (`tests/unit/runtime-conformance/`)
that exercises the real `lib/` code in *exactly* the way the .pv
abstracts. Each probe targets one of:

  - The pinning check (e.g., does `verify_*` reject `alg=HS256`
    when expecting `alg=EdDSA`?)
  - The atomic state transition (e.g., does a magic-link consumer
    use `UPDATE WHERE consumed=0 RETURNING`, not `SELECT then INSERT`?)
  - The injective-binding (e.g., can two distinct openings of the
    same Merkle root verify? — already covered by B2/B3 in
    `merkle-binding-property.test.js`)

Each probe MUST:
  - Reference the `.pv` file by path in a header comment
  - Have a doc-block explaining which abstract property it
    operationalizes
  - Run in < 1s (single test, deterministic seeds, no I/O beyond
    in-memory SQLite)

**Why this wins:** the cost is low (one test per .pv; ~50 LOC each).
The signal is high — divergence between `.pv` and `lib/` shows up as
a red CI immediately. It does not pretend to formal equivalence
(it isn't), but it makes the gap *visible and measurable*.

### 1.5 Process / hygiene gate (complement)

Generalize V3 from `V2.5-TODO.md`: every `.pv` file MUST have a
matching `tests/unit/runtime-conformance/<name>.test.{js,ts}` OR an
explicit `// SPEC-ONLY: no runtime exists yet` marker. CI gate
checks this. Prevents `.pv` files from drifting away from runtime
binding silently.

---

## 2. The honest map of `.pv` → runtime status

As of v2.5 close (2026-05-04):

| .pv file | Runtime location | Conformance status |
|---|---|---|
| `whitepaper/formal/proverif/coordination/isolation.pv` | `lib/coordination-crypto.ts` + `routes/sessions.ts` + `routes/tuples.ts` + `routes/messaging.ts` | `tests/unit/coordination-routes.test.js` covers route ACL; envelope crypto has its own unit suite |
| `whitepaper/formal/proverif/bonded/pairing/passkey-pair.pv` | **SPEC-ONLY** — passkey device pairing not yet implemented | flag explicitly |
| `whitepaper/formal/proverif/bonded/federated/federated.pv` | **PARTIAL** — federated KMS shape exists in `USER-ACCOUNTS-KMS.md` design doc; no code yet | flag explicitly |
| `whitepaper/formal/proverif/anchor/token-verify/algconfusion.pv` | `lib/harbor-tokens.ts:201–267` | **NEW v2.5: `tests/unit/runtime-conformance/algorithm-pinning.test.js`** |
| `whitepaper/formal/proverif/anchor/delegation/chain-replay.pv` | `lib/delegation-chain.ts` | **NEW v2.6: `tests/unit/runtime-conformance/delegation-chain-replay.test.js`** |
| `whitepaper/formal/proverif/bonded/recovery/magic-link.pv` | **SPEC-ONLY** — magic-link recovery route not yet implemented | flag explicitly |
| `whitepaper/formal/tla/bonded-conservation/Conservation.tla` | `lib/bonds.ts` | `tests/unit/bonds-conservation-property.test.js` |
| `whitepaper/formal/easycrypt/bonded-merkle/binding.md` (game spec) | `lib/merkle-tree.ts` | `tests/unit/merkle-binding-property.test.js` |
| `whitepaper/research/program/simulations/pareto/dominance.md` (theorem) | N/A — economic mechanism, not a code artifact | simulation is the conformance |

### Surfacing the SPEC-ONLY entries

Two `.pv` files have no runtime yet: passkey pairing, magic-link. Those proofs are *aspirational* — they describe
the protocol the runtime will follow once the runtime exists. That
is honest formal-methods practice: prove the design before writing
the code. But it must be tagged.

For each SPEC-ONLY entry, the implementation effort is:

  - **Magic-link recovery:** ~300 LOC (route + SQL migration + UI).
    Implementer should re-read `magic-link.pv` and bind the route's
    SQL to the private-channel cap pattern: `UPDATE recovery_tokens
    SET consumed_at = ? WHERE token = ? AND consumed_at IS NULL`
    (atomic single-use).
  - **Passkey pairing:** ~500 LOC (mobile-side QR, daemon-side WS,
    state machine). Implementer should re-read `passkey-pair.pv`
    and bind the pairing handshake to the verified
    `pairing_secret` derivation.
### Adding the CI gate

`scripts/runtime-conformance-check.mjs` (deferred to v2.6) walks
`whitepaper/formal/**/*.pv`, looks for either a matching test file at
`tests/unit/runtime-conformance/<name>.test.{js,ts}` or a
`# SPEC-ONLY: <reason>` marker in the .pv header. Fails CI if
neither.

---

## 3. The "really need formal-extracted code?" decision tree

When does Rust+Kani / F\* extraction become worth it?

```
Is this a hot crypto primitive (≥ 10⁵ ops/sec)?
├── No  → property tests + spec probes are sufficient.
└── Yes → Are we using a battle-tested library (jose, libsodium,
          Node crypto, OpenSSL, etc.)?
          ├── Yes → trust the library. Spec probes verify our USE
          │         is correct (algorithm pinning, key handling).
          └── No  → Did we invent a new primitive?
                    ├── No  → why not? Audit our protocol for
                    │         hand-rolled crypto and replace.
                    └── Yes → THIS is when Rust+Kani earns the
                              cost. Build the primitive in Rust,
                              expose via NAPI, Kani-prove the
                              hot path. Example: a new commitment
                              scheme not in any standard lib.
```

As of v2.5, Port Daddy has **zero** hand-rolled crypto primitives.
Every cryptographic operation reduces to Node `crypto` (Ed25519,
AES-256-GCM, SHA-256), `jose` (JWT verify/sign), or
`better-sqlite3` (transactional state). The Rust+Kani branch of the
tree is empty for now.

If we ever invent a primitive — say a custom commitment scheme or
threshold signature — that is when we cross over. The .pv files
then become the inputs to a Rust implementation, with Kani as the
bridge. Until then the spec-probe pattern is the right level of
investment.

---

## 4. Pareto / mechanism-design conformance

The Pareto theorem and the §8.4 insurance market are *economic*
properties, not code properties. Their "runtime" is the simulation
itself. For these, the conformance is:

  - The simulation code matches the §8.4 mechanism description
    (Vickrey 2nd-price, public reputation, capital-cost α).
  - The empirical findings are robust to seed perturbation
    (already deterministic via `mulberry32`).
  - When a real insurer-auction module is built (`lib/insurer-
    auction.ts`), it will need a *separate* conformance test
    showing the implementation matches the simulation's
    mechanism.

---

## 5. What ships in v2.5 alongside this doc

  - `tests/unit/runtime-conformance/algorithm-pinning.test.js` —
    binds `algconfusion.pv` to `lib/harbor-tokens.ts`. Tests:
      (1) phase2 token with tampered alg=HS256 rejected;
      (2) phase1 token with tampered alg=EdDSA rejected;
      (3) phase1 HS256-signed token with header rewritten to
          alg=EdDSA AND kid=PHASE2_KEY_ID rejected (cross-tier
          confusion);
      (4) phase2 EdDSA-signed token with header rewritten to
          alg=HS256 AND kid=undefined rejected.
    All four are the exact attack patterns ProVerif's naive-verifier
    counter-trace exhibited.

  - `tests/unit/runtime-conformance/merkle-tree-binding.test.js` —
    binds `whitepaper/formal/easycrypt/bonded-merkle/binding.md` to `lib/merkle-tree.ts`.
    Already provided by `tests/unit/merkle-binding-property.test.js`;
    the new file is a thin alias / pointer for the registry.

---

## 6. What ships in v2.6 alongside this update

  - `lib/delegation-chain.ts` — multi-hop delegation chain walker.
    Implements `hopBind(nonce, prev_id, next_id, message_hash)` binding,
    `NonceTable` (issued/consumed), `signHop()`, and `verifyDelegationChain()`.
    Rejects splices, replays, message substitution, and principal spoofing.

  - `tests/unit/runtime-conformance/delegation-chain-replay.test.js` —
    binds `chain-replay.pv` to `lib/delegation-chain.ts`. Tests (17):
      (H)   3-hop happy path accepted;
      (R1)  nonce replay rejected after first acceptance;
      (R1b) partial replay (one reused nonce) rejected;
      (S1)  splice with wrong messageHash rejected;
      (S2)  id splice (broken chain connectivity) rejected;
      (M1)  message substitution at verify time rejected;
      (P1)  wrong principalId rejected;
      (F1)  flipped byte in hop sig rejected;
      (N1)  forged nonce (never issued) rejected;
      (D1)  depth-1 (direct) chain accepted;
      (D5)  depth-5 chain accepted;
      (D5-R) depth-5 replay rejected;
      plus determinism and id-derivation sanity checks.

Future conformance tests will follow as the remaining SPEC-ONLY
implementations (passkey pairing, magic-link) land.
