# Cartel Resilience and Sybil Deterrence — A5 / A6 (§8.4.4 extension)

This note records the analytical setup and empirical findings of the A5
(Sybil attack) and A6 (repeated-game cartel) extensions to the
Pareto-dominance Monte Carlo for the Bonded Commons / Anchor Protocol
auction mechanism.

Driving artifacts:

- `whitepaper/research/program/simulations/pareto/simulation-sybil.mjs` + `simulation-sybil.run.log`
- `whitepaper/research/program/simulations/pareto/simulation-cartel.mjs` + `simulation-cartel.run.log`

## A5 — Sybil-attack regime

### Setup

An adversary spins up `K` Sybil insurer identities. Each Sybil posts the
protocol-mandated deposit `B_dep`, then bids aggressively (1 − ε below
honest cost) to win auctions. On loss, the Sybil defaults — pays
nothing, forfeits its deposit. The protocol slashes `B_dep` to the
commons, capped at the coverage amount.

### Closed-form intuition

Naive per-transaction expected attacker profit:

```
E[π_sybil_per_txn] = q* − B_dep · P_loss
breakeven:           B_dep* = q* / P_loss
```

For the mixed risk-class distribution (uniform over low/med/high):

```
q* ≈ 37,  P_loss ≈ 0.117  →  B_dep* ≈ 316 USD/identity
```

### Empirical finding (the surprise)

The sweep shows mean_sybil_net stays positive across the entire deposit
range tested (0.5 → 1000 USD). Closer inspection reveals **why** —
and it is a real protocol concern:

> **Deposit forfeiture is bounded by coverage.** The slash amount
> equals `min(B_dep, coverage)` where `coverage = μ · (1 + s)`. For a
> low-risk transaction with μ = 1, the protocol can only confiscate
> at most 1.5 USD of the Sybil's deposit per default, even if the
> Sybil posted 1000 USD. The cap exists because the protocol can only
> route slashes back to actual loss-coverage.

This means **deposit-based Sybil deterrence has a hard ceiling at the
coverage amount.** Past that point, additional deposit sits idle and
provides no further deterrence.

### What does deter Sybils

Three mechanisms compose to close A5:

1. **Per-identity onboarding cost C_kyc.** A non-recoverable cost
   (KYC fee, NFT mint, proof-of-personhood) imposed at identity
   creation. This is the only deterrent that scales independent of
   coverage.
2. **Reputation gating.** New identities cap out at low-coverage
   transactions until they accumulate a track record. Sybils cannot
   shortcut to high-stake auctions.
3. **Deposit per coverage class.** B_dep set per risk class to
   saturate the coverage cap exactly. Combined with reputation
   gating, this forces the Sybil to either (a) accept tiny per-txn
   profits or (b) pay C_kyc per identity to escalate.

The single-instrument deposit policy (B_dep only) is **insufficient**.
This is a real revision to the §8.4.4 mechanism design — recorded
honestly rather than waved away.

### Status

A5 is **partially closed**: the Sybil simulation is in place; the
finding that deposit alone is insufficient is empirically established.
The recommended composite mechanism (C_kyc + reputation + per-class
B_dep) is documented but not yet simulated. Future work in
`simulation-sybil-v2.mjs`.

## A6 — Repeated-game cartel folk-theorem

### Setup

A `K`-member cartel plays a repeated Vickrey auction. Each round:

- members may **collude** (charge floor `q_floor`) or **defect**
  (undercut floor by ε)
- the protocol detects collusion with probability `p_d` per round
- on detection, the slashed member pays `5 · (q_floor − μ)`
- players discount future payoffs by `δ ∈ (0, 1)`

Members follow the grim-trigger strategy *"collude until detected,
then revert to competitive."*

### Folk-theorem condition

Let `L = 5 · (q_floor − μ)` be the detection penalty. Every active cartel round
credits `π_C`; if detection occurs in that round, the simulation then subtracts
`L` and terminates future cartel payoffs. The collusion value therefore obeys:

```
  V_C = π_C − p_d L + δ(1 − p_d)V_C
```

With `π_N ≈ 0` after a deviation, the one-shot-deviation condition is:

```
  (π_C − p_d L) / [1 − δ(1 − p_d)]  ≥  π_D
```

Solving for the threshold detection rate `p_d*`:

```
  p_d* = [π_C − (1 − δ)π_D] / [L + δπ_D]
```

### Empirical findings

The sweep over `(p_d ∈ {0.01..0.50}) × (δ ∈ {0.80, 0.90, 0.95, 0.99})`
yields the following p_d* thresholds (smallest p_d where sustainable
flips NO):

| δ    | p_d* | mean_lifespan@p_d* | reading |
|------|------|-------|---------|
| 0.80 | 0.03 | 33 rounds | impatient players — cartel breaks even on a 3% detector |
| 0.90 | 0.05 | 20 rounds | one-month discount horizon — 5% detection breaks it |
| 0.95 | 0.05 | 20 rounds | grid crossing; closed form is 0.0478 |
| 0.99 | 0.10 | 10 rounds | very patient players — 10% still breaks cartels |

### Headline

> **In this payoff and timing model, detection above approximately 4.8% per
> round breaks cartel sustainability** at the illustrative discount factor
> δ = 0.95. The tested grid first flips at 5%. This is a calibration target,
> not a transferable protocol constant.

The paper does not establish that any deployed detector attains this rate.
That requires a separately measured bid-pattern signal and an explicit false-
positive tradeoff.

### Status

A6 is **partially closed**: the finite payoff model is executable, the expected-
value calculation matches the grid crossing, and the target is falsifiable.
Transfer to production monitoring remains open.

## Implications for §8.4.4

The original Pareto-dominance theorem (competitive auction dominates
static escrow) holds under four conditions:

1. **CC** — Capacity adequate (always assumed)
2. **NC** — No cartel
3. **RP** — Reputation precise (σ_r small)
4. **NS** — No Sybil

A5 / A6 quantify the cost of breaking NS / NC:

- **Breaking NC**: in the supplied payoff model, `p_d > 0.0478` at
  `δ = 0.95` makes immediate defection preferable in expectation. This does
  not itself prove welfare recovery or detector performance.
- **Breaking NS**: pure deposit-based deterrence fails because of
  the coverage cap. Closing A5 requires composite mechanisms (C_kyc
  + reputation gating + per-class deposits). The §8.4.4 theorem
  should be re-stated to require this composite as part of NS.

These are concrete revisions to the published §8.4.4 narrative, not
asterisks. The dominance result is robust; the assumptions list needs
strengthening.
