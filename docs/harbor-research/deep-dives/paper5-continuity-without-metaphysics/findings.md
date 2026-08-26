# Findings — paper 5, "Continuity Without Metaphysics"

**Dive run 2026-08-26.** Source read in full plus its three verification scripts
and two figure sources. No `.tex` file edited. Written up by the calling session;
the agent was blocked from writing report files.

## Verdict — `NARROW`

No prior work proves any of the four theorems, so nothing is SUBSUMED or
CONTRADICTED *by the literature*. But every claim needs a narrower scope stated
up front, two of those restatements are not optional, and **the falsification
pass found more than the literature search did** — ten internal defects, two of
them contradicted by the paper's own arithmetic.

## Answer to the question posed: Theorem 2a is **not** the unraveling result

It is Akerlof's lemons result, which the paper cites correctly elsewhere.

- **Grossman–Milgrom "unraveling" concludes _full disclosure_.** Milgrom 1981
  Proposition 6 (read in full, image-only PDF, page by page): "At every
  sequential equilibrium of the sales encounter game, the salesman uses a
  strategy of full disclosure."
- **Theorem 2a concludes _pooling and collapse_.**

Paper 5 has borrowed the name of a different theorem with the opposite
conclusion. A referee from information economics reads "Theorem 2a (unraveling)"
and expects full disclosure. The word for what 2a describes is *adverse
selection*.

**And the deeper finding: Grossman's §2/§3 pair _is_ Paper 5's Theorem 2b/2a
pair.** Grossman 1981 §3, verbatim: "the cost … of making ex post verifiable
statements is larger than the difference in value between the best and worst
possible commodity … we will have the usual 'lemons' problem … each high-quality
seller will want to be distinguished from those of average quality, but in this
case there is no way for him to do so." His §2 is the costless-verification end.
**The crossover variable is disclosure cost — which Paper 5 does not model**, so
it presents two endpoints of one continuum as two theorems.

Consequence for Theorem 2b: Grossman and Milgrom show voluntary attestation
unravels to full disclosure **without a mandate**. Paper 5's mandatory-attestation
premise is therefore stronger than its own economics requires — *unless* an
unraveling hypothesis fails here. Dranove & Jin's eight-assumption checklist
(read in full) makes this cheap to write, and the best candidate is the **Dye
1985 escape**: a buyer cannot tell an agent that *declines* to attest from one
whose runtime *cannot*. **Naming which hypothesis fails is the paper's real
contribution in this territory and is currently unwritten.** Done right it turns
a weakness into the sharpest paragraph in the paper.

## Internal defects

**D1 — `γ > 1/2` is false for the depth-3 chain the paper and figure both plot.**
The closure sum $\gamma+\gamma^2+\gamma^3$ crosses 1 at **γ ≈ 0.5437**, not 1/2.
γ=1/2 is the crossing for the *unbounded* chain $\sum\gamma^d=\gamma/(1-\gamma)$,
which is what the script's docstring says. **The figure's own plotted coordinates
prove it** — `(0.5, 0.875)` and `(0.5833, 1.1221)` bracket the crossing. Two
fixes: the prose clause and `fig-r12-regime.tex`'s caption.

| γ | γ+γ²+γ³ | mints? |
|---|---|---|
| 0.50 | 0.875 | no |
| 0.5437 | 1.000 | yes |
| 0.90 | 2.439 | yes |

**D2 — Theorem 4's optimum is infeasible under the paper's own definition.**
$g_t$ is "the amount by which a newcomer's economic ceiling is **reduced**" — a
reduction in a ceiling is bounded by the ceiling. The LP has no upper bound on
$g_t$. Add $g_t\le L$ and: the spike $g^*=(G_{\max},0,\dots,0)$ is **infeasible**
when $G_{\max}>L$; the optimum becomes a cliff of positive *width* (bang-bang),
killing the uniqueness claim; and **the LP is infeasible at any shape whenever
$G_{\max} > L/(1-\delta_f)$** — at the paper's own $\delta_f=0.6, G_{\max}=20$,
that means any per-period ceiling below **8**. The sweep can't see this because
`b6_probation.py` inherits the same missing constraint. Corroborating tell: the
sweep varies $T\in[6,16]$, but $T$ cannot matter to an optimum always at $t=0$ —
$T$ is in the model because the modeller expected the horizon to bind.

**D3 — Theorems 2 and 4 report algebraic identities as verification.** Every
"0 violations / 0 mismatches" is a rearrangement of the inequality it claims to
test: `(p−c_L)−(p−c_H) == c_H−c_L` (p cancels identically); the μ\* line, the qW
line and the attested-IC sign are each the boxed inequality rearranged; "pooling
survives in 0/4000" evaluates $c_H\le c_L$, false by the sweep's construction.
And **"76,000 schedules, 0 dominate the cliff"** is entailed by the inequality
chain printed three lines above it. The theorems are correct; the sweeps
establish nothing the boxes don't, which is why they could not catch D2.

Related: "mutants" A and B are not mutated implementations — `mutantB_catches`
counts draws where keeping the strong engine is the best response, and 1975/4000
is $P(\Delta\theta\ge\Delta c)\approx\frac12$ under the sweep's own uniform
draws. A binomial count reported as detection power. By contrast §resurrection's
four mutants *are* real configuration mutations with BFS-certified shortest
traces (1, 2, 2, 2, all reproduced) — that half is good.

**D4 — the "2-op shortest crime" isn't shortest.** At γ=0.9 the mutant needs
`witness` + **one** fork: $\Phi=1.9>1$. Either the trace is 3 ops or the 1-way
fork is strictly shorter. (The 8.2× figure is right.)

**D5 — the worked instance and the spiral exhibit are different instances.** The
box states μ\*=1/6 at homogeneous $c_H=0.5$, then reports spiral results run at
**heterogeneous $c\sim U[0.45,0.75]$** without saying so. Read as one instance the
numbers refute the theorem ($0.2>\mu^*=1/6$ yet the market collapses). Both are
correct for their own parameters. And **at the worked homogeneous instance there
is no spiral at all** — everyone exits at once or nobody does. The genuine
Akerlof dynamic needs the cost heterogeneity only the script has.

**D6 — Theorem 2b's flip rests on an unstated pricing hypothesis.** The gain is
$\Delta c-(p_H-p_L)$; the paper writes $\Delta c-\Delta\theta$, which requires
$p_H-p_L=\Delta\theta$ **exactly** — attested prices must capture quality at full
social value. Under Bertrand on attested keys the gain is 0. That conjunct is the
theorem's load-bearing hypothesis and appears nowhere.

**D7 — "no signal exists" is now empirically contestable.** Cai et al. 2025 show
software detection is query-intensive and unreliable, not impossible. Restate as
"no *costless* signal" — the machinery is already in the box via $qW\ge\Delta c$.

**D8** — Theorem 3's intact-protocol check verifies an invariant that holds by
construction; the mutant half is the real content. **D9** — Theorem 1 is a
definition with a one-line corollary; "supermartingale" describes a deterministic
nonincreasing sequence. **D10** — Theorem 4's LP cannot see newcomers who decline
to enter; the cliff concentrates the burden exactly when a newcomer has least
surplus to absorb it.

## Existing-citation audit: clean

All eight bibliographic records verify **exactly** against Crossref — Akerlof,
Spence, Friedman–Resnick, Tadelis, Mailath–Samuelson, Douceur, Lazear, Parfit.
No fabrications, no wrong volumes. **Better than papers 2, 3 and 7.**

Two *usage* problems:
- **Spence** is about *sorting*, not deterrence. The citation survives (Theorem 4
  has Spencian single crossing in δ) but the sentence should say sorting. The
  true ancestor of the instrument is **Becker & Stigler 1974**, and 2a's
  $qW\ge\Delta c$ is **Becker 1968**. Neither appears (`grep -Eic "becker|stigler"
  paper5.tex` → 0), though paper 3 cites Becker — a cross-paper inconsistency.
- **Parfit is inverted.** Paper 5 says it "takes the same exit." Parfit 1971
  (read in full): "the relation of the original person to each of the resulting
  people contains **all that interests us — all that matters**." His positive
  claim is that fission does **not divide** what matters. Theorem 1 makes the
  prior scarce, conserved and divisible precisely so it *must* split. Paper 5
  borrows the dissolution *move* while inverting the *thesis*. The honest
  sentence is better: a reputation ledger is exactly the kind of thing Parfit
  argues Relation R is not, which is why a ledger can be conserved where a stream
  of experience cannot. (Also: Parfit's fission case is **Wiggins' case**, brain
  division, not the teletransporter.)

## Cai et al. 2025 — closest work in existence, in the paper's own domain, uncited

arXiv:2504.04715 (control test passed; `2504.99999` → 404). "Are You Getting What
You Pay For? Auditing Model Substitution in LLM APIs." Same problem,
contemporaneous, Berkeley. They conclude software-only auditing fails and TEEs
are the answer, while naming **"weak provider incentives"** as the adoption
obstacle. Theorem 2b is the reply: attestation doesn't merely detect
substitution, it *re-prices* it, so the incentive to attest is price, not
civic-mindedness. Their paper has zero Akerlof/lemons framing — the economics is
genuinely Paper 5's. A referee finds this in one search.

## Open items

1. **Lizzeri 1999** (RAND 30(2)) — `UNRESOLVED`, not OA by any route. Potentially
   **adverse** to Theorem 2b: a monopoly certifier may optimally publish coarse
   pass/fail rather than the full engine id, which would collapse the
   (principal, engine) price keys the theorem depends on. Highest-priority pull.
2. **Lazear 1979** — `UNRESOLVED`, blocks a verb. Secondary sources suggest
   Lazear *front-loads* the honest worker's burden, in which case Theorem 4
   **agrees** with him and the paper is knocking down a foil it attributes to
   someone who doesn't hold it. **Do not ship "the instinct is exactly wrong"
   until read.**
3. Which unraveling hypothesis fails here (Dye 1985 the best candidate).
4. Costly attestation: Grossman–Hart 1980, Jovanovic 1982 — the regime a real
   daemon occupies, with no parameter in the paper.
5. Nozick's *closest-continuer* view belongs to **Theorem 3**, not Theorem 1 —
   and the eight-way fork is Nozick's tie case. `probable`, book not obtained.
6. Re-run `b6_probation.py` with the box constraint after D2's repair.

## Retrieval notes

- **Image-only PDFs are readable** — Milgrom 1981 has no text layer, but the Read
  tool renders pages as images and Proposition 6 was read that way. Don't mark a
  scanned source UNRESOLVED without trying this.
- **Author home pages beat every aggregator for pre-1990 economics.** Milgrom and
  Grossman are both `CLOSED`/`is_oa: false` yet freely available. Third instance
  of the OA-flags-lie finding.
- **Never guess a JSTOR DOI.** Two guesses returned *different papers*. Use
  Crossref bibliographic query and read the returned title.
- **A 200 with `content-type: text/html` on a `.pdf` URL is a bot block**, not a
  success. Always check.
