# Dialogue: Bonded Commons / Anchor Protocol v2.4 → v2.5

**Round:** v2.5
**Sealed at:** 2026-05-03
**Lead:** secops:lead
**Status:** complete; three audit-promoted smells closed in one round; Pareto partial-closed independently of Youle.

The v2.4 audit promoted six smells from "paper text only" into the
explicit carry list. v2.5 closes three of them with real ProVerif
artifacts (A1, A2, A4) and partial-closes the Pareto carry-over with
an independent theorization plus a Monte Carlo. Two audit-promoted
smells (A3 cuckoo, A5 sybil) and the cartel formal analysis (A6 full)
remain on the carry list.

---

## Closed this round

### A1 — Algorithm confusion in token verify (Anchor §3)

**Class:** crypto
**Severity:** high

**Counter:** ProVerif at `proofs/anchor/token-verify/algconfusion.pv`.

The model has two algorithms (AlgA = Ed25519-shaped, AlgB = HMAC) and
two verifiers: a pinned verifier that accepts only AlgA tokens, and
a naive verifier that trusts the alg header. The Dolev-Yao adversary
controls the public channel AND knows the AlgB key (worst case for
the pinned verifier).

```
Query event(accepted_pinned(m_4)) ==> event(issued_A(m_4)) is true.
Query event(accepted_naive(m_4)) ==> event(issued_A(m_4)) is false.
```

The pinned verifier authenticity holds. The naive verifier query is
intentionally false — ProVerif produces a counter-trace where the
attacker publishes `tokenB(ALG_B, m, hmacB(kB, m))` for any `m`,
demonstrating the JWT-style algorithm confusion attack on the
implementation pattern we explicitly do *not* ship.

### A2 — Delegation chain replay (Anchor §3)

**Class:** crypto
**Severity:** high

**Counter:** ProVerif at `proofs/anchor/delegation/chain-replay.pv`.

A 3-hop delegation chain (Principal → A → B → C). Each hop signature
binds a freshly-generated `nonce` together with `(prev_id, next_id,
message)`. The verifier at C requires every nonce to have been
issued and not previously consumed.

```
Query event(chain_accepted(idP, idA, idB, idC, m))
  ==> event(chain_authorized(idP, idA, idB, idC, m)) is true.
```

Splice attacks (lifting an intermediate hop signature into a
different chain) and message substitution attacks both fail because
the binding ties each signature to its position and message.

### A4 — Email magic-link race (Bonded §7.x)

**Class:** recovery
**Severity:** high

**Counter:** ProVerif at `proofs/bonded/recovery/magic-link.pv`.

Defense pattern: per-token PRIVATE CHANNEL carrying exactly one
consume-capability message. The first consumer takes the cap; any
second consume blocks forever. This models the real implementation
where the server enforces single-use via an atomic
`UPDATE WHERE consumed = 0 RETURNING` — atomicity provided by the
database, modeled here by ProVerif's private-channel linearity.

```
Query inj-event(consumed_for(a, tk)) ==> inj-event(issued_for(a, tk)) is true.
Query event(consumed_for(a, tk))     ==> event(issued_for(a, tk))     is true.
```

The `inj-event` correspondence is the strong single-use guarantee:
every consume corresponds to a *unique* issue. An earlier modeling
attempt using a `consumed` table failed because ProVerif's table
semantics don't enforce atomicity on `get; insert`, so the channel
pattern is what makes the proof go through. This is a useful
modeling lesson: SQL atomicity must be modeled with linear-channel
primitives, not with monotone tables.

### #7 — Pareto dominance, partial closure (Bonded §8.4.4)

**Class:** econ
**Severity:** high
**Carried from:** v2.0 → v2.1 (originally external, deferred to Youle)

**Counter:** independent theorization at
`proofs/bonded/pareto/dominance.md` plus Monte Carlo at
`proofs/bonded/pareto/simulation.mjs`.

This is the v2.4-staged work landed in v2.5 as a partial closure.
The §8.4.4 patch text said "to be proven by Youle in appendix" —
treating that as an indefinite carry was an honest tag in v2.0–v2.4
but it left the core economic claim of §8.4 unverified. v2.5 does
the work independently.

The honest restatement makes the assumptions explicit:

> Under (i) public agent reputation (§4.2), (ii) no insurer
> collusion, (iii) insurer solvency, (iv) at least one insurer with
> capital cost α_min < safety_factor s, the competitive Vickrey
> auction Pareto-dominates the static authority-set bond.

The Monte Carlo (36 parameter configs × 2000 trials × 50 txns each)
empirically validates the theorem in the assumption-region and
characterizes the boundary. **Three findings beyond the patch text:**

1. **Reputation noise ceiling.** Pareto dominance requires
   `sigma_r ≤ 0.1`. The §4.2 Merkle Forest binding is rate-limiting
   for §8.4 welfare — not just attribution. This couples §4.2 and
   §8.4 quantitatively.
2. **Winner's curse failure mode.** Under noisy reputation and many
   insurers (n=10), the most-optimistic insurer systematically wins
   and under-prices: principal saves money but insurers lose ≈$900
   per trial → market exit. Strictly stronger than adverse selection
   — quantitative threshold, not qualitative warning.
3. **n=3 optimum.** Larger insurer pools exacerbate winner's curse
   via the order-statistic effect. Counter-intuitive but robust
   across noise levels in the simulation.

The simulation also confirms qualitative §8.4 claims: partial cartel
resilience via Vickrey (a single colluder among 5 doesn't move the
price); full-cartel collapse (cartel size = n produces monopoly
pricing); cartel detection at p_d = 0.3 is insufficient against full
cartel.

These findings *strengthen* §8.4.4 rather than contradict it. They
give the paper three quantitative boundaries to adopt.

**What's still deferred:** formal Coq/Lean mechanization of the
strategic game (~1000 LOC + months). Carry indefinitely behind the
empirical artifact, mirroring v2.4's Merkle binding pattern.

---

## Still carried into v2.6

| # | Theorem                                         | Reason              |
|---|-------------------------------------------------|---------------------|
| 3 | Merkle Forest binding — full EasyCrypt          | Skeleton landed v2.4; full work paid only on audit ask |
| 7 | Pareto — formal Coq/Lean strategic-game proof   | Empirical landed v2.5; formal work indefinitely carried |
| A3 | Cuckoo filter pollution (Anchor §2.4)          | Awaits `lib/cuckoo-filter.ts` impl |
| A5 | Sybil insurers (Bonded §8.4)                   | v2.6: extend simulation.mjs with Sybil attack regime |
| A6 | Insurer cartel — formal repeated-game analysis | v2.5 simulation covers qualitatively; formal work carried |

---

## Paper changes in v2.5

- **§3 Anchor token verify:** cite `algconfusion.pv`. Document that
  algorithm pinning at the verifier is load-bearing; the naive
  verifier counter-trace in the run log shows the failure mode.
- **§3 Anchor delegation:** cite `chain-replay.pv`. The nonce +
  (prev_id, next_id, message_hash) binding is load-bearing.
- **§7.x Bonded recovery:** cite `magic-link.pv`. The per-token
  private-channel cap pattern (modeling SQL `UPDATE WHERE
  consumed = 0` atomicity) is the correct primitive for single-use.
- **§8.4 Pricing mechanism:** cite `dominance.md` + `simulation.run.log`.
  ADD three quantitative boundaries to §8.4.4:
  (1) `sigma_r ≤ 0.1` reputation-noise ceiling,
  (2) partial-cartel resilience via Vickrey vs full-cartel collapse,
  (3) `n = 3` insurer optimum due to winner's-curse order-statistic
  effect at larger n.
- **§A.3 Mechanization registry:** A1, A2, A4 closed; A3 awaits
  impl; A5/A6 carried; #3 and #7 partial-closed.

---

## Reputation deltas at round close

| Persona              | Delta                                                            |
|----------------------|------------------------------------------------------------------|
| proof-completer      | +3 closed (A1, A2, A4) + 1 partial (Pareto)                      |
| defense-crypto       | +2 co-signed (A1, A2)                                             |
| defense-recovery     | +1 co-signed (A4)                                                 |
| defense-econ         | +1 co-signed (Pareto theorization + simulation)                  |
| secops:lead          | +1 (round lead) + independent-theorization credit on Pareto      |
| proof-gap-auditor    | +1 vindicated (v2.4 audit promotions converted to closures in 1 round) |

No bonds slashed. The audit-to-closure cycle from v2.4 to v2.5 is the
shortest in the apparatus history (one round) and demonstrates that
honestly surfacing hand-waved smells produces faster real-artifact
closure than letting them stay tagged "staged."
