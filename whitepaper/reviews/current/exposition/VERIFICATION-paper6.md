# VERIFICATION — paper6.tex ("What Needs an Authority")

Falsification-first verification pass on the 8 claim-level items raised by the editorial review.
Method: every quote re-read against `whitepaper/research/tex/paper6.tex` at the line numbers given;
every script claim re-derived by hand *and* re-executed; for the two implementation questions (A15, A22)
a deliberately mutated variant was run to test whether the check is capable of failing at all.

Scripts executed on this branch (`claude/white-paper-pr-review-uncpxg`), both exit 0:

- `skills/harbor-results/scripts/b4_deontic_fragment.py` — ALL CHECKS PASSED (exit 0)
- `skills/harbor-results/scripts/b8_specialization.py` — ALL CHECKS PASSED

Every `[internal]` number quoted in paper6 reproduced exactly. No number in the paper was found to be wrong.

**Verdict summary**

| Item | Verdict |
|---|---|
| A2 — Theorem 3 boxed "iff" | **CONFIRMED** (both defects real; site count refined) |
| A14 — "definite Horn rules … head may be ⊥" | **PARTIALLY-CONFIRMED** (terminology defect real; incoherence claim refuted) |
| A15 — Bellman–Ford / super-source | **REFUTED** (implementation correct and documented; prose textbook-standard) |
| A16 — NP-completeness definition | **PARTIALLY-CONFIRMED** (loose gloss; hardness *is* supplied two sentences later) |
| A22 — specialization sweep circularity | **REFUTED** (the essential sweep is simulation-grounded and demonstrably can fail) |
| A23 — verification census arithmetic | **PARTIALLY-CONFIRMED** (numbers correct; prose framing wrong) |
| A24 — Halfin–Whitt citation | **PARTIALLY-CONFIRMED** (defensible but mis-aimed; Smith & Whitt is the right ancestor) |
| A26 — NP vs coNP direction | **REFUTED** (paper proves and uses the same direction) |

---

## A2 — Theorem 3's boxed "iff"

**Verdict: CONFIRMED.** Both defects are real. One sub-claim (the site count) is wrong in the review's
favour — there are six sites, not four, and two conventions, not three.

### Evidence

Quote verified verbatim at **L289–291**:

> decreasing in $\mu_s$ with infimum $W_\infty$: \emph{no amount of skill buys back residual downtime}. Consequently, with
> $K = A/(w\lambda) + W_{\mathrm{pool}}$ the pool's cost line, pooling dominates at \emph{every} skill premium iff
> \[ \frac{\xi}{\eta} \;>\; D^\star \;=\; \frac{\eta K}{1-\eta K}, \]

**(i) The infimum is genuinely unattained — so the sign must be `≥`.** From the box's own identity (L286–288),

$$W_{\mathrm{bd}}(\mu_s) = \frac{1}{\mu_{\mathrm{eff}}-\lambda} + \frac{\mu_{\mathrm{eff}}}{\mu_{\mathrm{eff}}-\lambda}\,W_\infty .$$

For every finite $\mu_s$ we have $1/(\mu_{\mathrm{eff}}-\lambda) > 0$ and $\mu_{\mathrm{eff}}/(\mu_{\mathrm{eff}}-\lambda) > 1$,
so $W_{\mathrm{bd}}(\mu_s) > W_\infty$ **strictly**; the limit $W_\infty$ is approached only as $\mu_s \to \infty$.
`b8_specialization.py` L318–320 confirms this numerically (monotone decreasing; $W_{\mathrm{bd}}(10^9) \to W_\infty$ to $10^{-4}$) —
`[PASS] W_bd decreasing in mu_s with infimum Winf`.

Therefore "pooling dominates at *every* (finite) skill premium" $\iff W_{\mathrm{bd}}(\mu_s) > K$ for all finite $\mu_s$
$\iff \inf_{\mu_s} W_{\mathrm{bd}} = W_\infty \ge K$ — the weak inequality, because at $W_\infty = K$ exactly, every
finite specialist still sits strictly above the pool cost line. Writing $d = \xi/\eta$ and $W_\infty = d/(\eta(d+1))$:

$$\frac{d}{\eta(d+1)} \ge K \iff d(1-\eta K) \ge \eta K .$$

For $\eta K < 1$ this is exactly $d \ge \eta K/(1-\eta K) = D^\star$. **`≥`, not `>`.**
The paper's own supporting line agrees with the equality boundary: L293 says "$W_\infty(\xi^\star)=K$ at $\xi^\star=D^\star\eta$",
and the script asserts it exactly (`[PASS] D* solves Winf(xi*) = K exactly  Winf(xi*)=1.036234`).
So the boxed strict `>` excludes precisely the point the rest of the paper identifies as the boundary.

**(ii) $\eta K < 1$ is nowhere stated as a hypothesis.** Grepping every `\eta K` occurrence in paper6.tex returns
**L35, L291, L300, L309, L337** — and none of them is a domain condition on the box. From the inequality above,
when $\eta K \ge 1$ the left side $d(1-\eta K) \le 0 < \eta K$ for all $d>0$: no $\xi/\eta$ makes pooling dominate at
every premium, i.e. the cap does not exist. The closed form returns a *negative* number there, and the literal boxed
criterion "$\xi/\eta > D^\star$" then holds for **every** $\xi/\eta > 0$ — i.e. it inverts to assert that pooling always
dominates, the exact opposite of the truth. This is not a hypothetical regime: the paper's own "Now you try" at
**L308–311** lands in it ($\eta = 2$, $\eta K = 2.07 > 1$) and states the correct conclusion —
"$\eta K \ge 1$ makes $D^\star=\infty$" — which the boxed closed form does not produce.

The script has the guard the paper dropped. `b8_specialization.py` **L38** (docstring) and **L305**:

```python
Dstar = eta * K / (1 - eta * K) if eta * K < 1 else np.inf
```

and the docstring L38 reads `(D* = +inf if eta*K >= 1)`. So this is a write-up regression against a correct implementation,
not a modelling error.

**(iii) Site count — the review undercounts.** Six sites reference the $D^\star$ inequality, in two semantics:

| Line | Text | Reads as | Correct? |
|---|---|---|---|
| L34–35 (abstract) | "viable … only while … stays **below** $D^\star$" | $\xi/\eta < D^\star$ | ✅ |
| L44 (express lane) | "viability capped at $\xi/\eta \le D^\star$" | $\xi/\eta \le D^\star$ | ❌ |
| L68 (one-breath) | "payable only while … stays **below** $D^\star$" | $\xi/\eta < D^\star$ | ✅ |
| L291 (box) | "pooling dominates … iff $\xi/\eta > D^\star$" | viable at $=D^\star$ | ❌ |
| L292–293 (gloss) | "viable only while … stays **below** $D^\star$" | $\xi/\eta < D^\star$ | ✅ |
| L337 (table) | "viable only while $\xi/\eta \le D^\star$" | $\xi/\eta \le D^\star$ | ❌ |

Not "four sites, three conventions" — **six sites, two semantics, three of each**, and the three "below" sites are the
ones that are already correct. The script's own prose (L308) also prints the correct strict form:
`sole role viable only while xi/eta < D*`.

### What this means for the fix

The correct fix is smaller than "restate the theorem" and larger than "flip one sign":

1. **Box (L290–291).** Restate as: *pooling dominates at every skill premium iff $W_\infty \ge K$; equivalently, when
   $\eta K < 1$, iff $\xi/\eta \ge D^\star = \eta K/(1-\eta K)$, and when $\eta K \ge 1$ no such cap exists ($D^\star = +\infty$).*
   Anchoring on $W_\infty \ge K$ first is what makes both defects disappear at once — the $\eta K<1$ condition is exactly
   the condition for $K < 1/\eta = \sup_d W_\infty$, i.e. for the cap to be reachable at all.
2. **L44 and L337** must change `≤` to `<` to agree with L34–35, L68 and L292–293. Do **not** "fix" the three `below`
   sites — they are the correct ones.
3. Nothing in §7's numbers, Figure 2 Panel B, or the reference instance changes: $\eta K = 0.2591 < 1$ there, so
   $D^\star = 0.3496$ and every quoted number stands.

---

## A14 — the fragment definition ("definite Horn rules … head may be ⊥")

**Verdict: PARTIALLY-CONFIRMED.** The terminology defect is real and worth a fix. The review's *stronger* claim —
that this is "not a coherent object", that the program "may have NO model", and that this contradicts the guaranteed
termination at a least model — is **refuted**: the paper has a saving reading, and the implementation uses it and
validates it against a classical oracle that handles the no-model case explicitly.

### Evidence

Quote verified at **L145–146**; the least-model justification at **L99–104** and **L162–165**.

**The terminology claim is correct.** Under the standard definition (a Horn clause is *definite* iff it has exactly one
positive literal), a clause with head $\bot$ is a *negative* clause / integrity constraint, not a definite clause.
Calling the whole thing "definite Horn rules" is nonstandard, and a logic-programming referee will say so.
Notably, `b4_deontic_fragment.py` L11–12 uses the same nonstandard phrasing *while naming the standard concept in the
same breath*: `h = BOT (an integrity constraint). Definite Horn, no disjunction, no negation.`

**But the incoherence / no-model claim does not survive.** The paper's operational reading treats $\bot$ as a
distinguished *atom*, and under that reading everything the paper asserts is true:

- The program over the vocabulary $\mathcal{A} \cup \{\bot\}$ **is** definite in the standard sense, so unit propagation
  terminates at a unique least model — exactly the L100–101 claim. `least_model()` (script L100–125) adds `BOT` to `M`
  like any other atom; there is no special case and no failure branch.
- "Derivable $\bot$" is then simply $\bot \in M$, which is precisely the conflict test the paper gives at **L152**
  ("A *conflict* is any of four things: derivable $\bot$; …"). Under this reading the fragment *never* fails to have a
  least model; it fails to be conflict-free.
- The oracle uses the *other*, classical reading and the two agree. `oracle()` (script L226–233) rejects any candidate
  model satisfying a $\bot$-headed rule body, and has an explicit `if not models:` branch returning
  `conflict=True, bot=True` — the "no model" case the review worries about is implemented, exercised, and matched.
  The 3000-instance sweep reports `checker/oracle disagreements: 0` and
  `least-model vs intersection-of-all-models mismatches: 0`. The sweep generator emits $\bot$-headed rules at 10%
  (script L334), and 121 of the 885 conflicting instances are derivable-$\bot$ ones, so this path is heavily exercised.

The one sentence that is genuinely imprecise is **L102**: the least model "contains precisely the facts forced in
*every* consistent world". When $\bot$ *is* derivable there are no consistent worlds, so "precisely" is vacuously false
in exactly the case the fragment is built to detect. The sweep code is careful about this where the paper is not — it
`continue`s past the intersection comparison when `r["bot"]` is true (script L363–367), because the intersection is
undefined there.

### What this means for the fix

The originally proposed fix (restructure the least-model justification) is too large. The correct fix is two clauses:

1. **L145–146** — name the two clause kinds correctly: *"facts (ground atoms), definite Horn rules
   $a_1 \wedge \dots \wedge a_k \to b$, and integrity constraints $a_1 \wedge \dots \wedge a_k \to \bot$; operationally
   $\bot$ is carried as a distinguished atom, so the program is definite over $\mathcal{A}\cup\{\bot\}$ and the
   least-model machinery below applies unchanged."*
2. **L102** — qualify: *"…precisely the facts forced in every model; when $\bot \in M$ there are no consistent worlds,
   and that is the conflict Theorem 1a reports."*

No theorem, no complexity bound, and no number changes.

---

## A15 — Bellman–Ford and the super-source

**Verdict: REFUTED.** Not a write-up bug and emphatically not an implementation bug. The implementation uses the
super-source construction, documents it in two places, and I confirmed by direct experiment that the omission the
review feared would have been caught by the existing sweep.

### Evidence

Paper text at **L108–110** and **L165–166**. Note what it actually says: *"A system of them is satisfiable exactly when
its constraint graph contains no negative cycle … Bellman–Ford finds such a cycle if one exists"* and *"Bellman–Ford
returns a negative cycle iff the deadline system is infeasible, in $O(V\!\cdot\!E)$."* Neither sentence says
"single-source", and the characterisation "no negative cycle **in its constraint graph**" is the correct, component-blind
one. This is verbatim CLRS §24.4's treatment of difference constraints, which is exactly the super-source construction.

The implementation is explicit. `b4_deontic_fragment.py` **L56–58** (docstring):

> `- (C4): Bellman-Ford on the constraint graph (edge i->j of weight c per x_j - x_i <= c, all potentials initialized 0 = implicit super-source)`

and `temporal_infeasible()` at **L175–202**:

```python
d = [0] * nvars; pred = [None] * nvars      # L177 — all potentials start at 0
for _ in range(nvars + 1):                  # L180 — V+1 passes over E edges
```

Zero-initialising **every** potential is exactly equivalent to adding a super-source with 0-weight edges to all
vertices, and it reaches every component. It is also why the stated complexity is exactly right: $V+1$ passes over $E$
edges is $O(V\!\cdot\!E)$ with no super-source edges materialised, so the review's collateral worry (in the notes' F3)
that "the complexity term changes with it" is also refuted.

**Adversarial test.** I re-ran the sweep's exact policy generator (same seed 20260816, 3000 instances) with two
detectors: the shipped zero-initialised one, and the naive single-source-from-vertex-0 variant the review feared.

```
infeasible (zero-init / implicit super-source): 213
cases where naive single-source-from-vertex-0 DISAGREES: 42
   example cons: [(2, 1, -2), (1, 0, 0), (1, 2, -1)]
   example cons: [(1, 2, -2), (1, 0, -1), (2, 1, -1)]
   example cons: [(2, 1, -1), (1, 2, -2)]
```

Two conclusions. (1) 213 matches the paper's reported "213 negative temporal cycles" exactly — the shipped detector is
the super-source one. (2) The naive variant would have disagreed on 42 of 3000 instances, so had the implementation
been wrong, the brute-force oracle (independent exhaustive integer search over the potential box, script L251–258)
would have reported ~42 disagreements instead of 0. The sweep had the power to catch this and did not fire.

The cycle extraction is also sound: the walk at L193–202 asserts `pred[v] is not None` and asserts `w < 0` on the
recovered cycle, so the returned witness is verified to be a genuine negative cycle.

### What this means for the fix

Nothing is required. If the owner wants belt-and-braces against a pedantic referee, a five-word parenthetical at L109
— *"(all potentials initialised to zero — the standard implicit super-source, so disconnected components are covered)"* —
closes it. That is optional polish, not a correction.

---

## A16 — the NP-completeness definition

**Verdict: PARTIALLY-CONFIRMED.** The gloss is materially loose and should be tightened. But the review's framing —
that hardness is "omitted", and that the 3-SAT reduction elsewhere is the only place it appears — overstates: hardness
is defined in the *next sentence of the same paragraph* and is invoked explicitly in Theorem 1b.

### Evidence

Quote verified at **L113–114**:

> It is \textbf{NP-complete} when a proposed solution can be \emph{checked} in polynomial time but no
> polynomial algorithm for \emph{finding} one is known, and finding one would settle the P versus NP question.

Two genuine problems:

1. **The "not known to be in P" clause is epistemic and does not belong in a definition.** NP-completeness is a
   structural property, not a statement about the state of the art. As written, the sentence's first two clauses
   describe "in NP and not known to be in P" — a class that contains integer factoring and graph isomorphism, neither
   of which is known to be NP-complete.
2. **Hardness is present only as a consequence, not as the definition.** The third clause ("finding one would settle
   the P versus NP question") is the *downstream implication* of NP-hardness, not the reduction-closure property itself.

**But the saving context is real and adjacent.** Two sentences later, at **L116–118**, the paper writes:
*"a \emph{reduction} from it is the standard way to prove a new problem at least as hard: encode any 3-SAT instance as
an instance of yours, so that solving yours would solve 3-SAT."* And Theorem 1b at **L170–171** splits the two halves
correctly and by name: *"membership by the selection certificate; hardness from 3-SAT"*. The reduction itself is stated
in full at **L171–175** (per-variable $\mathrm{sel}_x^{+} \to \Ob(\mathrm{assert}_x)$ / $\mathrm{sel}_x^{-} \to
\Fb(\mathrm{assert}_x)$ on identical scope and interval; per-clause disjunctive obligation over selector literals), is
implemented at `b4_deontic_fragment.py` L405–430, and was verified both directions 16/16:

```
  conflict-freedom <=> satisfiability on all 16 instances  [OK]
```

So the paper is not missing hardness; it is a vocabulary section that gives a lossy one-sentence gloss of a term the
paper subsequently uses correctly.

### What this means for the fix

One sentence, in place at L113–114. Suggested: *"It is **NP-complete** when it is in NP — a proposed solution can be
checked in polynomial time — and every problem in NP reduces to it in polynomial time, so a polynomial algorithm for
it would put all of NP in P and settle the P versus NP question."* This costs no length and makes L116–118's reduction
sentence land as the natural follow-on rather than as a patch.

---

## A22 — the specialization sweep (circularity)

**Verdict: REFUTED.** This is the item the review flagged as most consequential, and the finding is the opposite of the
one feared. `b8_specialization.py` contains **both** an algebraic consistency check *and* an independent
simulation-grounded check, they are separate sections, and the 60-instance sweep the paper cites as validation is the
simulation-grounded one. I confirmed it is capable of failing by mutating the closed form and watching it fire.

### Evidence

**The circular check exists, is clearly labelled, and is not the one the paper cites as validation.**
Script sections (1a) and (1b), **L176–196**, are pure algebra: `lhs` from `W_mmc`/`W_mm1`, `rhs` from `g_exact`/`g_shift`.
The script itself labels L176 `# (1a) pure-arithmetic reduction check`. These are 20 000-instance transcription checks
on the rearrangement — useful, but they cannot catch a wrong queueing model.

**The sweep paper6 actually cites is section (4), L265–299, and it is simulation-grounded.** Quote verified at
**L271–273**: *"the 60-instance random sweep over $(\lambda,\mu_s,\mu_g,c,A,w,\xi,\eta)$ gave 55 decisive instances and
**0** sign violations of the boundary"*. In that section:

```python
dC  = delta_cost(A, w, lam, W_p, W_s)        # L281 — closed form
...
Whp, sep = sim_mgc(lam, mu_g, c, 60000, ...)  # L282 — discrete-event simulation
Whs, ses = sim_breakdown(...) / sim_mgc(...)  # L285/L287 — DES / Gillespie
dCh = delta_cost(A, w, lam, Whp, Whs)         # L288 — simulated net cost
...
if np.sign(dCh) != np.sign(dC): n_bad += 1    # L292–293
```

`dCh` comes from an FCFS discrete-event simulator (`sim_mgc`, L135–149) and a Gillespie CTMC simulator
(`sim_breakdown`, L151–171). Nothing about the closed forms enters `dCh`. Actual output:

```
=== (4) FULL SWEEP: closed-form decision vs simulated cost difference ===
  60 instances (30 with breakdowns): 55 decisive, 5 near-boundary/indecisive
  [PASS] closed-form boundary vs simulated cost sign: 0 violations  0 violations
```

**Adversarial test 1 — can section (4) fail?** I re-ran section (4) verbatim (same seed, same 60 instances) with one
change: `W_mmc` replaced by a mutant that drops the Erlang-C waiting term.

```
REAL W_pool                                   -> 55 decisive, 5 indecisive, 0 SIGN VIOLATIONS
MUTANT W_pool (Erlang-C term deleted)         -> 55 decisive, 5 indecisive, 2 SIGN VIOLATIONS
```

The sweep fires on a wrong closed form. It is **not** structurally incapable of failing.

**Adversarial test 2 — is (1b) sensitive?** I re-ran (1b) with `g_shift` perturbed (accountability term scaled 0.9×):

```
  (1b) with real g_A       : 0 sign mismatches / 20000
  (1b) with perturbed g_A  : 45 sign mismatches / 20000
```

So (1b) is a real algebra check, not a tautology in the trivial sense — it would catch a mis-rearranged $g_A$.

**Adversarial test 3 — direct simulation validation of $g_A$ itself.** The chain (1b) + (4) is sound but indirect, so I
tested $g_A$ against simulation directly: 24 instances with $r$ placed deliberately just either side of
$g_A(\rho,c)$ (offsets ±0.10 to ±0.45), comparing $\mathrm{sign}(r - g_A)$ to simulated $\Delta C$ at $|{\Delta C}| > 3\,\mathrm{se}$:

```
  24 decisive simulated instances straddling g_A, 0 sign violations
```

**Supporting meter audit (already in the script, section 2, L223–250).** Erlang-C means vs DES ($|z| \le 1.76$);
$W_{\mathrm{bd}}$ closed form vs matrix-geometric (`max|diff|=1.95e-13`), vs truncated CTMC (`1.38e-14`), vs Gillespie
($|z| \le 0.80$). And the two named falsification counterexamples are confirmed by simulation with $z = -15.7$ and
$z = +32.0$ — reproduced exactly.

### What this means for the fix

**Gate result for `legible-swarm.tex`: importing $g_A(\rho,c)$ is safe.** The formula is validated independently of the
algebra that produced it — by discrete-event simulation directly across the boundary, by an Erlang-C meter audit
against DES, and by two simulation-confirmed counterexamples to its predecessor. No caveat about circularity attaches.

The import must, however, carry the model hypotheses, which are essential and are the honest boundary at
paper6 **L375–376**: mean costs only (no tail/SLA quantiles), FCFS, exponential inter-arrival and service, an $M/M/1$
solo server against an $M/M/c$ pool, and $A$/$w$ as exogenous policy prices. If legible-swarm's setting violates any of
these, $g_A$ is the wrong import regardless of how well it is verified here.

One optional exposition nit, and it is the review's only surviving grain: L271–273 describes the sweep without saying
that the 20 000-instance checks in section (1) are algebraic and the 60-instance check is the simulated one. A
half-clause — *"the 60-instance random sweep … comparing the closed-form decision against **simulated** net cost"* —
removes any reader's doubt on exactly the point the review raised.

---

## A23 — verification census arithmetic

**Verdict: PARTIALLY-CONFIRMED.** Every number in the paper is correct and reproduces exactly. Both alleged
arithmetic contradictions dissolve once the script's counting semantics are known — but the prose does not disclose
those semantics, and as written it invites precisely the reading the reviewer had. This is an exposition defect, not
an arithmetic error.

### Evidence

Quotes verified at **L187–188** and **L191–192**. Actual script output, reproduced:

```
  conflicts found: 885  (BOT 121, O/F 195, claims 484, temporal 213)
  Horn-INDIRECT conflicts (invisible without propagation): 149
  ...
  in the sweep above, the same mutant missed 100 of the 885 conflicting instances
```

**(b) 121+195+484+213 = 1013 ≠ 885 — real, and expected.** The counters are per-*policy-set* booleans, not per-conflict
tallies. Script L373–375:

```python
counts["conflict"] += r["conflict"]; counts["bot"] += r["bot"]
counts["of"] += bool(r["of"]); counts["claims"] += bool(r["claims"])
counts["temporal"] += r["temporal"]
```

A single policy set can carry several *kinds* of conflict at once, so the categories overlap. I instrumented the sweep
to measure the overlap directly:

```
policy sets with >=1 conflict: 885
distribution over number of distinct conflict CATEGORIES present: {1: 764, 2: 114, 3: 7}
sum of per-category instance counts: 1013
exactly-one-category counts: {'claims': 387, 'temporal': 154, 'of': 145, 'bot': 78}
```

$764 + 2(114) + 3(7) = 764 + 228 + 21 = 1013$. Exact reconciliation. The paper's numbers are right; the prose's
em-dash list reads as a partition of 885 and is not one.

**(a) 149 propagation-only vs 100 missed — real, and structurally *required* to be ≥.** The two counters measure
different events:

- `counts["indirect"]` (script L379–380) fires when `(r["bot"] and not m["bot"]) or (r["of"] - m["of"])` — i.e. the
  instance contains at least one $\bot$ or O/F conflict that propagation was needed to see.
- `mutant_misses` (script L376–378) fires when `r["conflict"] and not m["conflict"]` — i.e. the mutant's **overall
  verdict** flips to conflict-free.

Crucially, `propagate=False` affects only the Horn/deontic stages; claim overlaps and negative temporal cycles are
computed identically by the mutant. So an instance can be propagation-dependent for its O/F clash yet still be caught
by the mutant via an unrelated claim overlap — no verdict flip. Hence `mutant_misses ≤ indirect` is a theorem about the
code, not a discrepancy. Measured directly:

```
propagation-dependent instances (indirect): 149
mutant verdict flips (misses): 100  of which not flagged indirect: 0
```

The 100 are a strict subset of the 149. Zero anomalies.

### What this means for the fix

The fix is prose only — do not touch a number.

1. **L187–188** — say what is counted: *"885 of the 3000 policy sets contained at least one conflict — 121 with a
   derivable $\bot$, 195 with an $\Ob/\Fb$ clash, 484 with a claim overlap, 213 with a negative temporal cycle; the
   categories overlap, 121 sets carrying more than one kind."* (764 single-category, 114 two, 7 three.)
2. **L188–189 / L191–192** — distinguish the two propagation numbers: *"149 of those sets contain a conflict reachable
   only through Horn propagation; in 100 of them that is the sets' **only** conflict, so deleting propagation flips the
   verdict outright (the other 49 are still caught by an unrelated claim or deadline conflict)."*

That second sentence is strictly stronger evidence for the paper's own thesis than the current phrasing, because it
explains *why* the numbers differ instead of leaving a gap.

---

## A24 — the Halfin–Whitt citation

**Verdict: PARTIALLY-CONFIRMED.** The review's diagnosis is right on the substance. I would call it a mis-aimed rather
than a false citation: Halfin–Whitt is defensible for "economies of scale in many-server queues" but is not the
ancestor of the pooled-vs-dedicated comparison paper6 actually makes, and Smith & Whitt is.

### Evidence

Quote verified at **L352–353**: *"the economies of pooling in many-server queues are classical folklore sharpened by
Halfin--Whitt~\cite{hw81}"*. The bibliography entry at **L405–406** is bibliographically accurate:
S. Halfin and W. Whitt, "Heavy-traffic limits for queues with many exponential servers", *Operations Research*
29(3):567–588, 1981.

What that paper is about, to the best of my knowledge: it establishes the heavy-traffic limit for $M/M/c$ as
$c \to \infty$ with $\sqrt{c}\,(1-\rho) \to \beta > 0$ — the QED / Halfin–Whitt regime — showing the delay probability
converges to a non-degenerate constant $\alpha(\beta)$ and the queue-length process to a diffusion. It is the
theoretical foundation of square-root safety staffing: *how many servers you need to hold a service level as scale
grows.* It is not a comparison of one pooled multi-server queue against dedicated single-server queues.

The result usually cited for *that* claim is D. R. Smith and W. Whitt, "Resource sharing for efficiency in traffic
systems", *Bell System Technical Journal* 60(1):39–55, 1981 — which addresses combining separate queues into one shared
multi-server queue, and is also the standard source for the caveat that sharing can *hurt* under heterogeneous service
requirements. I am confident about the content of both papers; I am confident but not certain of Smith & Whitt's exact
volume/page numbers, so those should be re-checked against the BSTJ archive before they go into a bibliography.

**The defensible reading, stated fairly.** Halfin–Whitt does quantify an economy of scale — larger server pools can be
run at higher utilisation for the same delay probability — so "sharpened by Halfin–Whitt" is not absurd. But paper6's
Theorem 2 is a finite-$c$, exact-Erlang-C, pooled-vs-dedicated comparison, and its headline structural finding
(**L247–248**: $g \to c$ as $\rho \to 1$ — "the boundary *saturates* at the capacity ratio, never diverges") is a
resource-sharing statement, not a QED-regime statement. Nothing in the theorem or its verification depends on
$\cite{hw81}$; this is a related-work attribution only, so the blast radius is a footnote's worth.

### What this means for the fix

Add Smith & Whitt to `thebibliography` and split the sentence at L352–353, e.g.: *"the economies of pooling are
classical — Smith & Whitt~\cite{sw81} for resource sharing, with the many-server scaling regime sharpened by
Halfin--Whitt~\cite{hw81}"*. Keeping `hw81` is fine; the fix is that it should no longer be the *sole* support for a
pooling-economics claim. Verify Smith & Whitt's volume/pages against BSTJ before committing.

---

## A26 — NP vs coNP direction

**Verdict: REFUTED.** The paper proves the existential form and applies it to the existential form. The complexity
consequence it draws is direction-agnostic, and it never claims the short refusal certificate whose absence the review
is worried about. (The review's own notes hedge here too — F6 concedes "Not a wrong statement".)

### Evidence

**Theorem 1b, L169–171**, verbatim: *"Conflict-freedom of a policy set becomes NP-complete: membership by the selection
certificate; hardness from 3-SAT."* The decision problem is: given an extended policy set, is it conflict-free — i.e.
does **some** discharge selection yield a conflict-free $\mathcal{L}_c$ set? YES-instances are the conflict-free sets;
the selection is the certificate; NP-complete is the correct classification. The implementation matches:
`extended_conflict_free()` (script L419–430) returns `(True, S)` with the witnessing selection.

**The §5 guard, L211–216**, states the policy as: *"never accept a proposal whose union with the accepted set conflicts
in-fragment"* — so the guard **accepts iff the union is conflict-free**. That predicate is exactly membership in the
NP-complete language of Theorem 1b. The guard is not solving a different problem; it is deciding this one, and a
decision procedure necessarily answers in both directions. There is no direction mismatch to confirm.

**The consequence the paper draws is direction-agnostic.** L115: *"The working consequence, which is all Theorem 1b
needs: an NP-complete check cannot be run on every proposal at commit time as the policy set grows."* L224–226:
*"no proposal-time check scales there unless P$=$NP."* Both hold identically whether you frame the guard's task as the
NP side or its coNP complement — an NP-complete language and its coNP-complete complement are both outside P unless
P = NP. Nothing in the paper's argument turns on which side you name.

**The paper does not claim a short refusal witness past the frontier.** The witness language at L215–216
(*"the daemon refuses the write, with the theorem's witness attached to the refusal"*) sits in the **in-fragment**
paragraph, where Theorem 1a is polynomial and refusal witnesses genuinely exist (the clashing rule pair with its
overlap interval, the negative cycle, the derivation chain). Every extended-fragment statement in the paper — L169–175,
L221–226, the table row at L334 (*"NP-complete check, or a judge who chooses the discharge"*) — is about the *check*
not scaling, never about a refusal certificate. There is no false claim to correct.

### What this means for the fix

Nothing is required. There *is* a legitimate sharpening available, which is what I suspect the reviewer was reaching
for: past the frontier the witness property becomes **asymmetric** — an accept has a short certificate (hand the guard
the discharge selection and Theorem 1a re-checks it in polynomial time), while a reject does not, absent NP = coNP.
Since "witness-producing" is a headline property of Part I, one sentence noting that it survives only on the accept
side outside $\mathcal{L}_c$ would strengthen §5 and would pre-empt a referee raising the same point. That is
authorial judgment, not a defect: file it as optional, not as a fix.

---

## Reproduction

All of the above regenerates from the repo at seed 20260816:

```
python3 skills/harbor-results/scripts/b4_deontic_fragment.py      # exit 0, ALL CHECKS PASSED
python3 skills/harbor-results/scripts/b8_specialization.py        # exit 0, ALL CHECKS PASSED
```

The three adversarial experiments (naive-Bellman–Ford differential for A15; mutated-`W_mmc` and perturbed-`g_A`
sensitivity plus direct straddle-the-boundary simulation for A22; category-overlap instrumentation for A23) were run
as throwaway scripts against the shipped generators and checkers with the same seed; their outputs are quoted inline
above. No file in the repository was modified by this pass except this one.
