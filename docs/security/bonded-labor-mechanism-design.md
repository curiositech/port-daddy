# Mechanism design — Port Daddy Bonded Commons / Float Plan settlement

Constructive capstone to `relay-ingress-cryptoeconomics.md` (attack surface) and
`advisory-claims-game-theory.md` (do incentives hold). Those found the bond layer is
*priced but not enforced* and that advisory coordination needs *costly identity*. This
designs the rules that close those gaps, grounded in what already exists.

**Honest scope:** the **pricing** half is built (`lib/bond-pricing.ts`, pure +
unit-testable). The **settlement** half is the Float Plan layer — deliberately
deferred until the relay + identity land. This is a design spec for that layer, not a
claim it exists.

## What is already built — `lib/bond-pricing.ts` (the §2c pricing function)

| Element | Value in code | Maps to skill |
|---|---|---|
| `SCOPE_MULTIPLIER` | read 1 · write 3 · critical 10 · full 25 | complexity scoring (§2b) |
| `FLOOR_MULTIPLE` | read 1 · write 3 · critical 10 · full 25 | per-tier IC floor (π ≥ c) |
| `durationMultiplier(ttlMs)` | 1.0 – 3.0× | duration scaling (§2b) |
| `reputationFactor` | `R_MAX = 0.5` (≤50% discount); >1 surcharge for unknown | reputation-adjusted bond (§2c) |
| `belowFloor` | undercollateralization signal | Failure Mode "Undercollateralization Spiral" |
| ceiling clamp | bounds the bond | "Over-Pricing Death Spiral" guard |

It **prices** scope × duration × reputation with IC floors and a ceiling. Per the
cryptoeconomic finding it does **not enforce** (no slash/escrow), and `reputationFactor`
is **stubbed at 1.0×** (no reputation ledger yet — keyed, by design, on the *Anchor
principal* not the agent id, which is the Sybil-Bond-Farming fix already anticipated).

## Quality-gate scorecard (the skill's 12)

| # | Gate | Status | Grounding / gap |
|---|---|---|---|
| 1 | Pricing takes scope+duration+reputation | **Built** | bond-pricing.ts |
| 2 | Deterrence: bond > reconstruction per tier | **Designed, unenforced** | FLOOR_MULTIPLE encodes π≥c, but no slash ⇒ effective deterrence $0 (cryptoeconomic Class 1). Gap: the unbuilt bond↔Coast-Guard write-gate |
| 3 | Accessibility: 10+ clean completions afford routine bonds | **Designed, inert** | R_MAX=0.5 ⇒ critical floor $50→$25 for a proven principal, but reputation stubbed ⇒ no discount today. Gap: reputation ledger (needs identity) |
| 4 | IC: truthful capability + cost weakly dominant | **Half** | capability IC = FLOOR_MULTIPLE (bond > P(fail\|incapable)·cost) ✓; truthful **cost** needs Vickrey/2nd-price settlement — not built |
| 5 | Settlement handles success/partial/sabotage/dispute | **Not built** | design below |
| 6 | Multi-oracle 2-of-3 | **Substrate exists** | automated (fleet CI) + evidence (the **Merkle event chains** proven in ProVerif/relay) + human audit. The evidence oracle is a ready asset |
| 7 | Adverse selection: graduated access / portfolio | **Partial** | tier unlock designed; portfolio = the anchored Merkle work-trail |
| 8 | Collusion resistance: listing fee + detection | **Not built** | burned listing fee > reputation-gain value; claim-to-edit-ratio detection; ADR-0039 overlap broker as random verifier assignment |
| 9 | Cold start with metrics | **Implicit** | single-operator reality *is* Phase-1 subsidized seeding (Erich's own fleets seed reputation). Phases below |
| 10 | Revenue model | **Designed** | hosted relay/marketplace: transaction fee 2–5% + listing fee + bond spread 1–2% |
| 11 | Economist review | **Engaged** | Thomas Youle (competitive insurance / bond pricing as market equilibrium) — prior collaboration on record |
| 12 | Implementation path | **Designed** | macaroon/anchor credential + relay settlement; Stripe vs crypto vs hybrid (deferred) |

## Settlement / escrow lifecycle to build (gate 5)

Four terminal states, with fund routing:
- **Success:** oracle confirms criteria → bond 100% returned; poster→agent payment; `completions++`.
- **Partial:** evidence shows `f = done/total`. If `f > 0.5`: return `f·bond`, route remainder → salvage fund (funds the successor's bond — this is the existing **resurrection/salvage queue**, already in the daemon). Else hold for the salvage agent; `salvages++`.
- **Sabotage:** oracle detects destruction/zero-progress → bond 100% → reconstruction fund; poster gets priority rematch; ban if `failure_rate > threshold`.
- **Dispute:** lock in arbitration hold → 2-of-3 multi-oracle → settle with majority.

Manifest (acceptance criteria) is **immutable after bond posting** — and Port Daddy
already has immutable notes + the Merkle chain to make that cryptographically real.

## The load-bearing dependencies (why this is correctly deferred)

1. **Enforcement gap** (gate 2): priced-not-slashed ⇒ the cryptoeconomic Class-1 hole.
   Fix = the unbuilt Layer-1 bond↔Coast-Guard write-gate.
2. **Identity gap** (gates 3, 7, 8): reputation stubbed + Sybil-free ⇒ the game-theory
   collapse (δ→0). Fix = **Anchor** (costly principal identity). bond-pricing.ts already
   keys reputation on the principal, so the design is Anchor-ready; it's *blocked* on Anchor.
3. **Oracle substrate** (gate 6): the per-publisher **Merkle event chains** (ProVerif-verified
   this session) are the evidence-based oracle — the one piece that's already real.

## Concrete IC numbers (grounded)

- Base ≈ $5 (one operator-hour). Critical floor = `10×base = $50`; full = `25×base = $125`.
- **IC-sabotage** (`bond > max sabotage gain`): the skill's threat table wants 100–200% of
  task value for sabotage; the per-tier floors must be sized to *reconstruction* cost, and
  `belowFloor` fires when a caller underposts. Enforcement (slash) is what turns this from a
  signal into a deterrent.
- **Accessibility:** R_MAX=0.5 ⇒ a 50-completion principal pays 0.5× (critical $50→$25) —
  affordable, *once reputation is live*.
- **Bond-to-damage today:** unenforced ⇒ ratio ≈ 0. The mechanism is sound in *design*;
  the deficit is enforcement + identity, not pricing.

## Build order (headline)

Port Daddy has the **pricing** half done and paper-grounded; it lacks the **settlement**
half, and both missing legs depend on the two upstream fixes the prior analyses isolated:

```
Anchor (costly principal identity)
  → reputation ledger + bond↔Coast-Guard write-gate (enforcement)
    → escrow/settlement (4 states, reuse the salvage queue)
      → multi-oracle (fleet CI + Merkle evidence + human audit)
        → marketplace dynamics (listing fee, dynamic pricing, revenue)
```

This *is* the Float Plan layer — correctly deferred until the relay (this PR's work)
and Anchor land. The Merkle chains proven this session are its evidence oracle, ready
to wire in when settlement is built.
