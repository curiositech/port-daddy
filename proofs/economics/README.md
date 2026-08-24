# `proofs/economics/` — claim-signaling mechanization

Mechanization artifacts for the repeated claim-signaling game described in
§sec:economic of `agent-transactions-whitepaper.tex` and the v2.6 expository
page `website-v2/src/pages/whitepaper/HowWeProveGameTheory.tsx`.

Closes the credibility loan the expository page takes on Apalache + Z3.
Two artifacts, three checkers (Z3, TLC, Apalache), one closed-form threshold.

## Files

| File                            | What it is                                             | How to run                                  |
| ------------------------------- | ------------------------------------------------------ | ------------------------------------------- |
| `claim_signaling.tla`           | TLA+ model of the repeated game + graduated trigger    | `tlc -config claim_signaling.cfg claim_signaling.tla` (or Apalache, see below) |
| `claim_signaling.cfg`           | TLC / Apalache config; defaults to δ = 0.35, Horizon=4 | (consumed by the model checker)             |
| `sweep-delta.sh`                | Sweeps δ ∈ {0.30, …, 0.40}; reports crossover          | `./sweep-delta.sh`                          |
| `delta-threshold.z3`            | SMT-LIB script: the IC cubic + uniqueness in (0, 1)    | `z3 delta-threshold.z3`                     |
| `delta-threshold.expected.txt`  | Expected Z3 output (3 `(check-sat)` results)           | (reference; CI greps it)                    |

## The claim being mechanized

In the repeated claim-signaling game (§sec:economic, payoff matrix in Fig. 2),
the daemon publishes a correlating recommendation each round. A **graduated
trigger** strategy starts cooperative and, on observed deviation, plays
mutual-claim for the next three rounds before returning to cooperation.

The stage-game payoffs in the TLA+ model (the corrected prisoner's-dilemma
bimatrix — the earlier (−2, 4)/(0, 0) calibration was voided by the
treatise correction):

|                | B: follow | B: claim |
|----------------|-----------|----------|
| **A: follow**  | (3, 3)    | (0, 4)   |
| **A: claim**   | (4, 0)    | (1, 1)   |

One-shot deviation gain *g* = 4 − 3 = 1. Per-round punishment loss
*L* = 3 − 1 = 2. The IC condition is *g* ≤ *L*·(δ + δ² + δ³), which
rearranges to the cubic below.

**Proposition 7.1 (informal).** The graduated trigger supports truthful
claim signaling — i.e. no agent has a one-shot deviation with positive
discounted future payoff — for all discount factors δ > δ\*, where δ\* is
the unique real root of

```text
2·δ³ + 2·δ² + 2·δ − 1 = 0
```

in (0, 1). Numerically δ\* ≈ 0.3425.

A spot-check (Python, δ = 0.35, Horizon = 4, PunishmentRounds = 3):
follow-only A-score = 4.5461, deviate-once A-score = 4.5154 — IC holds by
0.0307. At δ = 0.34 the gap reverses: deviation gains 0.0102. The crossover
is at δ = 0.35 on the integer grid, matching the closed-form root δ\*
within rounding.

The two artifacts close this proposition from two angles:

- **`delta-threshold.z3`** (closed-form): proves the cubic has a unique
  real root in (0, 1), and that the root lies in [0.34, 0.35]. This is
  the threshold itself.
- **`claim_signaling.tla`** (model-check): rebuilds the discounted
  one-shot-deviation comparison as a state machine and shows the IC
  invariant `NoUnilateralDeviationPositive` holds at δ = 0.35 and fails
  below the threshold. `sweep-delta.sh` finds the empirical crossover
  and asserts it matches the closed-form root to integer-grid rounding.

## Horizon = 4, why

The cfg sets `Horizon = 4`. This is the *minimal* horizon that exercises
the IC argument: one round of deviation (the +4 grab) followed by the
3-round graduated trigger (three mutual-claim rounds of 1). At this
horizon

- follow-path A-score = 3 + 3δ + 3δ² + 3δ³ (cooperate every round),
- deviate-then-punished A-score = 4 + δ + δ² + δ³ (defect, eat 3 rounds of 1),

so the IC inequality is *exactly* 1 ≤ 2·(δ + δ² + δ³), the same cubic
Z3 analyses. Larger horizons do not change the IC inequality (after the
3-round punishment both agents return to cooperation, contributing
equally to follow and actual scores), and they cost a lot of integer
range in TLC: at `Horizon = 8` the discount weight `DeltaDen^Horizon =
100^8 = 10^16` overflows TLC's 32-bit signed integers (max 2.1·10⁹).
At `Horizon = 4` the largest weight is `100^4 = 10⁸`, comfortably in
range. The `.tla` `ASSUME Horizon = 4` enforces this; if you want to
re-run at a different horizon you'll need to update the `DiscountWeight`
function literal in the spec to match (it is unrolled by hand because
Apalache rejects user-defined `RECURSIVE` operators).

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
    (root-obj (+ (* 2 (^ x 3)) (* 2 (^ x 2)) (* 2 x) (- 1)) 1))
)
sat
(
  (define-fun delta () Real
    (root-obj (+ (* 2 (^ x 3)) (* 2 (^ x 2)) (* 2 x) (- 1)) 1))
)
unsat
```

The three results are: (i) a root of the cubic exists in [0, 1], (ii)
that root is in [0.34, 0.35], (iii) no SECOND distinct root exists in
[0, 1] (uniqueness). Full annotated copy in `delta-threshold.expected.txt`.

### TLA+ (TLC)

```bash
# Homebrew: brew install tla-tools (or download tla2tools.jar)
tlc -config claim_signaling.cfg claim_signaling.tla
```

If you have a local `tla2tools.jar` (e.g. under `tools/tla2tools.jar`):

```bash
java -cp tools/tla2tools.jar tlc2.TLC \
  -config claim_signaling.cfg claim_signaling.tla
```

At the default constants (δ = 35/100, Horizon = 4, PunishmentRounds = 3)
TLC explores 13 states (11 distinct) and reports

```text
Model checking completed. No error has been found.
```

Wall-clock on M4 Max: under one second.

### TLA+ (Apalache)

```bash
# Install: https://apalache.informal.systems/docs/apalache/installation/jvm.html
# (or download the v0.57.0 release tarball — used here)
apalache-mc check \
  --inv=NoUnilateralDeviationPositive \
  --length=10 \
  --config=claim_signaling.cfg \
  claim_signaling.tla
```

Expected output ends with

```text
The outcome is: NoError
Checker reports no error up to computation length 10
EXITCODE: OK
```

Apalache uses SMT/Z3 (bundled in the release tarball) and arbitrary
precision integer arithmetic, so it has no overflow concern. The model
was massaged to be Apalache-compatible: `DiscountWeight` is an unrolled
function literal (Apalache rejects user-defined `RECURSIVE` operators
and dynamic ranges in folds) and every state variable carries a
`@type:` annotation.

### Sweep across δ

```bash
./sweep-delta.sh
# or, with Apalache:
TLA_CHECKER=apalache ./sweep-delta.sh
```

Generates per-δ cfg files under `.sweep/` and prints a table. The
crossover (smallest δ for which the invariant HOLDS) should land at
0.34 or 0.35, matching the closed-form root δ\* ≈ 0.3425.

Sample output (Horizon = 4):

```text
sweep-delta.sh — sweeping delta over {0.30, 0.31, ..., 0.40}
checker      = tlc
horizon      = 4 rounds (minimal IC-exercising horizon)
punishment   = 3 rounds (graduated trigger)
----
delta   status
0.30   VIOLATED
0.31   VIOLATED
0.32   VIOLATED
0.33   VIOLATED
0.34   VIOLATED
0.35   HOLDS
0.36   HOLDS
0.37   HOLDS
0.38   HOLDS
0.39   HOLDS
0.40   HOLDS
----
crossover (smallest delta where invariant HOLDS) = 0.35
closed-form root (delta-threshold.z3)            = 0.3425
PASS: crossover matches closed-form within integer-grid rounding.
```

## CI

`.github/workflows/proofs.yml` runs five jobs on every PR touching
`proofs/**`:

- **z3-delta-threshold** — installs Z3 via `apt-get`, runs
  `z3 delta-threshold.z3`, greps for the expected `sat … sat … unsat` triple.
- **tla-claim-signaling** — sets up JDK 17, downloads
  `tla2tools.jar v1.8.0`, runs TLC on `claim_signaling.{tla,cfg}` and
  then the sweep script.
- **tla-claim-signaling-apalache** — sets up JDK 17, downloads Apalache
  v0.57.0 (~130 MB) and runs the same model under SMT. Greps for
  `The outcome is: NoError`.
- **tla-conservation** — runs TLC on `proofs/bonded/conservation/Conservation.tla`
  (the bonded-commons conservation invariant).
- **monte-carlo-threat-bands** — runs `proofs/bonded/pareto/threat-bands.mjs`
  with 1000 samples and asserts zero matched-band failures.

Failing any check fails the PR.

## Why this isn't aspirational

The expository page used to say "[planned, v2.6]" next to these
artifacts. As of the commit that adds this directory, the artifacts:

1. **exist** (this directory),
2. **run unattended** (CI workflow),
3. **agree with the closed-form root** (the sweep script asserts this),
4. **pass under both checkers** (TLC and Apalache).

If the page or the whitepaper ever re-introduces an "[planned]" marker
next to an artifact in this directory, that is a bug. The artifact
either runs in CI or the marker is wrong.
