# Cartel Resilience and Sybil Deterrence — A5 / A6 (§8.4.4 extension)

This note records the analytical setup and empirical findings of the A5
(Sybil attack) and A6 (repeated-game cartel) extensions to the
Pareto-dominance Monte Carlo for the Bonded Commons / Anchor Protocol
auction mechanism.

Driving artifacts:

- `proofs/bonded/pareto/simulation-sybil.mjs` + `simulation-sybil.run.log`
- `proofs/bonded/pareto/simulation-cartel.mjs` + `simulation-cartel.run.log`

## A5 — The analyzed coverage-capped contract

The simulation creates one or three insurer identities, credits the premium
on every winning transaction (including default), and slashes
`min(B_dep, coverage)` when loss occurs. Capital is replenished between
transactions; funding and entry costs are zero. The quoted bid uses the
conditional loss-size parameter `mu`, not an actuarially fair expected
payout. This is a stipulated attack scenario, not a computed competitive
insurance equilibrium.

For a fixed premium `q`, loss probability `p > 0`, and coverage `C`:

```
E[profit] = q - p * min(B_dep, C)
```

When `q > p*C`, increasing a coverage-capped deposit cannot deter the attack.
When `q <= p*C`, any `B_dep >= q/p` does deter it weakly. The seeded sweep
keeps positive mean profit throughout its tested deposit range 0.5 to 1000;
its numerical result is specific to that contract and its selected inputs.

Full forfeiture is a different contract with `E[profit] = q - p*B_dep`.
For `q=10, p=.1, C=20, B_dep=110`, capped profit is `8`, full-forfeiture
profit is `-1`. If premium is also clawed back, the formulas change again.
This counterexample rules out a universal impossibility claim for deposits.

### Candidate additional controls

A non-refundable entry fee, principal-bound aggregate exposure reservations,
and probationary coverage ceilings can change the attacker's incentives.
None alone establishes Sybil resistance, and their composite is not yet
proved or simulated here. Its deterrence, solvency, funding costs, and
false-sanction effects require an explicit model. Full forfeiture also
requires a credible collection and adjudication rule.

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
- **Breaking NS**: the capped contract fails for the selected inputs when
  expected premiums exceed expected capped forfeitures. Alternative capital
  and admission policies require their own analysis. The Pareto result
  remains conditional on its no-Sybil assumption; this attack simulation
  does not discharge that assumption.
