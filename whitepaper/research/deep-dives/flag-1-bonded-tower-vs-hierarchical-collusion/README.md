# Flag 1 — the bonded tower against hierarchical-collusion economics

**Paper**: 3, *Reputation is Amortized Verification: Inspection Games for Agent
Economies* (`whitepaper/research/tex/paper3.tex`)

**Risk**: highest of the four. This is the only dive where CONTRADICTED — the
prior work proves something incompatible — is a live outcome rather than a
formality.

## The claim under test

Theorem 2 (`\label{thm:tower}`, `paper3.tex:65–72`), verbatim in substance:

> Let level $k{+}1$ audit level-$k$ auditors, each audit sampled sealed (the
> draw unknown to the briber) from a pool spanning $C$ disjoint cliques, each
> auditor bonded at $B$ with audit parameters $(\rho, d)$ and bribe floor
> $\beta = \rho d B$. […] Bribing all $C$ is profitable iff
> $G_k \rho d > C\beta \iff G_k > C\,B$. Below that threshold bribery stops and
> corrupt value decays geometrically: $G_{k+1} = (1-\rho d)G_k$. Consequently a
> tower of unbounded depth is certified by *finite* bond capital.

The mechanism is: sealing forces the briber to pay before learning which pool
the auditor is drawn from, so buying safety means buying all $C$ pools; the
expected-value calculation is affine in the number of pools bought, so bribery
is all-or-nothing; and the all-in price $C\beta$ exceeds the protected value
whenever $G_k \le CB$.

## The competing result

Kofman & Lawarrée (*Econometrica* 61(3), 1993) analyse a principal–supervisor–
agent hierarchy where the supervisor can be bribed by the agent. The scout's
report characterised it as showing that naive monitor-stacking requires
unbounded collateral — i.e. that adding levels of monitoring does *not* converge
on finite capital, which is the exact negation of Paper 3's conclusion.

**That characterisation is itself unverified.** It came from a sweep that never
read the paper. The first job of this dive is to find out what Kofman &
Lawarrée actually prove, because the apparent contradiction may be an artifact
of the summary rather than of the economics.

## Where the resolution probably lives

Two structural differences are visible without reading anything, and either
could dissolve the conflict:

1. **Sealing.** Paper 3's threshold carries the factor $C$ *only* because the
   briber cannot observe the draw. The paper is explicit that a leaked draw
   collapses the threshold to $G_k > B$ and the clique multiplier vanishes
   (`paper3.tex:78`, "Why sealing is load-bearing, not hygienic"). If Kofman &
   Lawarrée's supervisor is a single identified party — no randomisation over
   independent pools — then their model is Paper 3's $C=1$ case, where Paper 3
   *agrees* that corruption persists on linear life support. That would make the
   two results compatible and the contribution real but narrower than stated.

2. **What "unbounded depth" means.** Paper 3's own proof gives
   $\lceil \log G_0 / \log\frac{1}{1-\rho d} \rceil$ levels — 27 at the running
   parameters — which is finite and logarithmic. The prose says "unbounded
   depth." If Kofman & Lawarrée's unbounded-collateral result is about
   sustaining monitoring at *arbitrary* depth rather than at depth sufficient to
   drive corruption below a threshold, the two are answering different
   questions. This wording issue needs fixing regardless of how the dive
   resolves; see the renaming register in `../BIBLIOGRAPHY.md`.

The dive's job is to determine which of these applies, or whether neither does
and there is a genuine conflict.

## What a resolution looks like

`findings.md` opens with one of CLEAR / NARROW / SUBSUMED / CONTRADICTED, then:

- Kofman & Lawarrée's central result quoted verbatim with its hypotheses.
- A hypothesis-by-hypothesis table against Theorem 2: what each model assumes
  about monitor identity, collusion side-payments, randomisation, observability
  of the audit draw, and what is bonded or collateralised.
- A named, specific answer to: is Paper 3's $C$-pool sealed sampling a mechanism
  Kofman & Lawarrée's framework excludes by assumption, or one it covers and
  prices differently?
- If CLEAR or NARROW: the exact "how we differ" sentence to add to
  `paper3.tex`'s Related Work, drafted and ready.
- If SUBSUMED or CONTRADICTED: what specifically breaks, and whether the
  amortization results (Theorem 3, independent of the tower) are affected. They
  probably are not — flag that explicitly either way, because Theorem 3 is the
  paper's title claim and it should not be collateral damage.
