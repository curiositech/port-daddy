# Whitepaper maturity-badge audit vs. the proof artifacts

**Date:** 2026-06-23. **Scope:** the three "prove" papers whose badges assert
machine-checking — `anchor-protocol`, `bonded-commons`, `federated-harbor` in
`whitePapers.ts`, plus the crypto-paper checker labels in `manifestoContent.ts`.
**Method:** enumerate every artifact under `proofs/` and `analyses/`, read each
artifact + its `.run.log`, and map the *mechanically established* property to the
badge claim. No claim of machine-checking is allowed to stand without an executed
artifact behind it.

## Artifact ground truth

| Artifact | Tool | Executed? | What it actually establishes | Paper |
|---|---|---|---|---|
| `proofs/anchor/token-verify/algconfusion.pv` | ProVerif | ✅ run.log | alg-pinned verifier authenticates; naive (header-trusting) verifier is forgeable | anchor |
| `proofs/anchor/delegation/chain-replay.pv` | ProVerif | ✅ | a signed 4-party delegation chain accepted ⇒ authorized (replay-free) | anchor |
| `analyses/harbor_card_v5_attenuation.pv` | ProVerif | ✅ (non-vacuous) | single-hop attenuation: no capability escalation | anchor |
| `analyses/harbor_card_v6_multihop_attack.pv` | ProVerif | ✅ (attack, flaw expected) | naive final⊆root verifier *accepts* a multi-hop escalation | anchor |
| `analyses/harbor_card_v7_multihop_fixed.pv` | ProVerif | ✅ (fixed) | per-hop each⊆parent verifier rejects the same escalation | anchor |
| `core/harbor-card-rs/src/lib.rs` (3× `#[kani::proof]`) | Kani | source only | decode-robustness, constant-time compare, and a 2-case subset assertion | anchor |
| `proofs/bonded/conservation/Conservation.tla` | TLA+ (TLC) | ✅ run.log "no error", 1716 states | `TotalFree + TotalEscrow + burned = minted` — value conserved | bonded |
| `proofs/bonded/{pairing,recovery,merkle}` | ProVerif/EasyCrypt | ✅ | passkey pairing, magic-link recovery, Merkle binding | bonded |
| `proofs/economics/delta-threshold.z3` | Z3 | ✅ expected.txt | unique discount-factor root δ*∈[0.34,0.35] (δ*≈0.3425; see `proofs/economics/delta-threshold.z3` and `proofs/economics/README.md`) | bonded econ |
| `proofs/bonded/federated/federated.pv` | ProVerif | ✅ | **Shamir 4-share escrow recovery secrecy** (`not attacker(account_root)`) — the *optional* §7.5 recovery mechanism | bonded (NOT federation) |

## Verdicts

### `anchor-protocol` — `verified · ProVerif + Kani` → **SUPPORTED (kept)**
Attenuation is proven non-vacuously in ProVerif (`v5`/`v7`), alg-confusion and
chain-replay are proven, and Kani contributes (decode-robustness, constant-time,
subset logic). Caveat worth knowing: the strongest attenuation evidence lives in
`analyses/` (`v5`/`v7`), and the Kani attenuation harness checks two hard-coded
cases rather than arbitrary inputs. Badge stands.

### `bonded-commons` — `verified · TLA⁺ + ProVerif` → **SUPPORTED (kept)**
The headline conservation invariant is genuinely model-checked in TLA+
(`Conservation.tla`, executed), and ProVerif covers pairing/recovery/binding.
Bounded model (3 agents, small balances) but structurally valid. Badge stands.

### `federated-harbor` — whitePapers badge already honest on main; manifesto label OVERCLAIMED → FIXED
None of the three federated properties in the paper's claim sentence —
cross-machine capability transfer, a revocation convergence bound, an escrow that
"cannot steal" — has a machine-checked artifact:
- **No federated TLA+ exists.** The only two `.tla` files are bonded
  (`Conservation.tla`, `claim_signaling.tla`); `grep "converg|revoc|gossip"` over
  all `.tla` returns nothing.
- **The convergence bound** Δ(1 + ln m) is an **analytical** bound argued in the
  paper, not a model-checked one.
- **The settlement escrow "cannot redirect"** (Theorem 6.1) is **named in prose
  only** — no artifact models a two-harbor settlement.
- The one ProVerif file in the `federated/` directory proves the **optional Shamir
  escrow recovery secrecy** — a bonded §7.5 artifact, unrelated to federation.

The `whitePapers.ts` `federated-harbor` `maturity`/`claim` on **origin/main are
already honest** ("ProVerif secrecy proven · convergence bound + escrow theorem
named, not yet machine-checked") — corrected in an earlier PR. The remaining
overclaim was on the **manifesto's** crypto-paper card, whose blurb said it
"Proves trust can cross between machines … and a deposit … cannot be stolen."

> Note on method: the first-pass artifact audit was run against a local working
> checkout that happened to sit on a stale branch (`cartographer-state`) carrying
> a reverted, overclaiming `whitePapers.ts`. Re-checked against origin/main, the
> whitePapers badges are correct; only `manifestoContent.ts` needed fixing.

## Fixes applied in this PR

Only `manifestoContent.ts` changed — the `whitePapers.ts` badges on main are
already accurate and were left untouched:

1. **Bonded `checker` was "Kani"** — a category error (the only Kani harness is
   Anchor's `harbor-card-rs`; Bonded's conservation is TLA+). Corrected to
   **"TLA⁺ + ProVerif"**, and the blurb notes the conservation proof is TLA⁺.
2. **Federated `checker`/blurb overclaimed** ("Proves trust can cross … a deposit
   … cannot be stolen"). Changed `checker` to **"ProVerif (escrow only)"** and the
   blurb to say it *specifies* cross-machine trust, ProVerif proves only the
   optional escrow-recovery secrecy, and the convergence bound + settlement escrow
   are named, not machine-checked — matching the (already honest) whitePapers badge.

Anchor (`verified · ProVerif + Kani`) and Bonded (`verified · TLA⁺ + ProVerif`)
whitePapers badges were checked against the artifacts and are backed — left as-is.
