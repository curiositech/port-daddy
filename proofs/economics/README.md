# `proofs/economics/` — claim-signaling mechanization

Mechanization artifacts for the repeated claim-signaling game described in
§sec:economic of `agent-transactions-whitepaper.tex` and the v2.6 expository
page `website-v2/src/pages/whitepaper/HowWeProveGameTheory.tsx`.

Closes the credibility loan the expository page takes on Apalache + Z3.
Two artifacts, two checkers, one closed-form threshold.

## Files

| File                            | What it is                                             | How to run                                  |
| ------------------------------- | ------------------------------------------------------ | ------------------------------------------- |
| `claim-signaling.tla`           | TLA+ model of the repeated game + graduated trigger    | `tlc -config claim-signaling.cfg claim-signaling.tla` (or Apalache, see below) |
| `claim-signaling.cfg`           | TLC / Apalache config; defaults to δ = 0.26            | (consumed by the model checker)             |
| `sweep-delta.sh`                | Sweeps δ ∈ {0.20, …, 0.30}; reports crossover          | `./sweep-delta.sh`                          |
| `delta-threshold.z3`            | SMT-LIB script: the IC cubic + uniqueness in (0, 1)    | `z3 delta-threshold.z3`                     |
| `delta-threshold.expected.txt`  | Expected Z3 output (3 `(check-sat)` results)           | (reference; CI greps it)                    |

## The claim being mechanized

In the repeated claim-signaling game (§sec:economic, payoff matrix in Fig. 2),
the daemon publishes a correlating recommendation each round. A **graduated
trigger** strategy starts cooperative and, on observed deviation, plays
mutual-claim for the next three rounds before returning to cooperation.

The stage-game payoffs in the TLA+ model:

|                | B: follow | B: claim |
|----------------|-----------|----------|
| **A: follow**  | (3, 3)    | (-2, 4)  |
| **A: claim**   | (4, -2)   | (0, 0)   |

One-shot deviation gain *g* = 4 − 3 = 1. Per-round punishment loss *L* = 3.
The IC condition is *g* ≤ *L*·(δ + δ² + δ³), which rearranges to the cubic
below.

**Proposition 7.1 (informal).** The graduated trigger supports truthful
claim signaling — i.e. no agent has a one-shot deviation with positive
discounted future payoff — for all discount factors δ > δ\*, where δ\* is
the unique real root of

```text
3·δ³ + 3·δ² + 3·δ − 1 = 0
```

in (0, 1). Numerically δ\* ≈ 0.2531.

A spot-check (Python, δ = 0.26, Horizon = 8, PunishmentRounds = 3):
follow-only A-score = 4.0540, deviate-once A-score = 4.0184 — IC holds by
0.036. At δ = 0.25 the gap reverses: deviation gains 0.016. The crossover
is at δ = 0.26 on the integer grid, matching the closed-form root δ\*
within rounding.

The two artifacts close this proposition from two angles:

- **`delta-threshold.z3`** (closed-form): proves the cubic has a unique
  real root in (0, 1), and that the root lies in [0.25, 0.26]. This is
  the threshold itself.
- **`claim-signaling.tla`** (model-check): rebuilds the discounted
  one-shot-deviation comparison as a state machine and shows the IC
  invariant `NoUnilateralDeviationPositive` holds at δ = 0.26 and fails
  below the threshold. `sweep-delta.sh` finds the empirical crossover
  and asserts it matches the closed-form root to integer-grid rounding.

## Running locally

### Z3

```bash
z3 delta-threshold.z3
```

Tested with Z3 **4.13** and **4.15**. On a 2024 M4 Max Z3 returns in
under 100 ms. The expected output is:

```text
sat
(
  (define-fun delta () Real
    (root-obj (+ (* 3 (^ x 3)) (* 3 (^ x 2)) (* 3 x) (- 1)) 1))
)
sat
(
  (define-fun delta () Real
    (root-obj (+ (* 3 (^ x 3)) (* 3 (^ x 2)) (* 3 x) (- 1)) 1))
)
unsat
```

The three results are: (i) a root of the cubic exists in [0, 1], (ii)
that root is in [0.25, 0.26], (iii) no SECOND distinct root exists in
[0, 1] (uniqueness). Full annotated copy in `delta-threshold.expected.txt`.

### TLA+ (TLC)

```bash
# Homebrew: brew install tla-tools
tlc -config claim-signaling.cfg claim-signaling.tla
```

At the default constants (δ = 26/100, Horizon = 8, PunishmentRounds = 3)
TLC explores a bounded state space and reports

```text
Model checking completed. No error has been found.
```

Wall-clock on M4 Max: a few seconds. The state space is small because
the model is parameterised over a fixed horizon and the discount weights
are precomputed integer powers.

### TLA+ (Apalache)

```bash
# Install: https://apalache.informal.systems/docs/apalache/installation/jvm.html
apalache-mc check \
  --inv=NoUnilateralDeviationPositive \
  --config=claim-signaling.cfg \
  claim-signaling.tla
```

Apalache works on the same module thanks to the `@type:` annotations.
Expected output ends with

```text
The outcome is: NoError
```

> **If you don't have Apalache installed**, the TLC path is sufficient
> for CI. The expository page can honestly say "TLA+ model, checked with
> TLC; Apalache port available". Apalache scales to higher horizons; TLC
> is fine at the horizon this model uses.

### Sweep across δ

```bash
./sweep-delta.sh
# or, with Apalache:
TLA_CHECKER=apalache ./sweep-delta.sh
```

Generates per-δ cfg files under `.sweep/` and prints a table. The
crossover (smallest δ for which the invariant HOLDS) should land at
0.25 or 0.26, matching the closed-form root δ\* ≈ 0.2531.

## CI

`.github/workflows/proofs.yml` runs both checks on every PR:

- Installs Z3 via `apt-get install z3` and runs `z3 delta-threshold.z3`,
  grepping for the expected `sat … sat … unsat` triple.
- Installs TLA+ tools (`tla-tools` package on Ubuntu) and runs
  `tlc -config claim-signaling.cfg claim-signaling.tla`, grepping for
  the "No error has been found" line.

Failing either grep fails the PR. There is no manual sign-off; the
artifacts run unattended.

## Why this isn't aspirational

The expository page used to say "[planned, v2.6]" next to these
artifacts. As of the commit that adds this directory, the artifacts:

1. **exist** (this directory),
2. **run unattended** (CI workflow),
3. **agree with the closed-form root** (the sweep script asserts this).

If the page or the whitepaper ever re-introduces an "[planned]" marker
next to an artifact in this directory, that is a bug. The artifact
either runs in CI or the marker is wrong.
