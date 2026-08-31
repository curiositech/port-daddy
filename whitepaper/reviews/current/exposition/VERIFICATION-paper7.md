# Falsification pass — paper7.tex, "The Cohomology of Equivocation"

Independent verification of three claim-level flags raised by the editorial review. Method: read the
primary source (`whitepaper/research/tex/paper7.tex`), verify every quote against it, then attempt to
*refute* each flag — first by hunting for a saving clause elsewhere in the paper, then by re-deriving the
linear algebra, then by running the paper's own reference scripts and purpose-built counterexamples.

Artifacts consulted:

- `/home/user/port-daddy/whitepaper/research/tex/paper7.tex`
- `/home/user/port-daddy/skills/harbor-results/scripts/sheaf_harness_v2.py`
- `/home/user/port-daddy/skills/harbor-results/scripts/sheaf_consistency_radius.py`
- `/home/user/port-daddy/skills/harbor-results/scripts/sheaf_mechanism_proof.py`

Both harness scripts were executed end to end (`python3`, numpy 2.4.6, networkx 3.6.1). Every `[internal]`
number quoted in the flags reproduces exactly: expander arm `113/200` cohomology-only with `87` dark;
cut-edge max residual `1.50e-13`; kernel lie `r = 2.0e-14` at `‖o‖ = 5`; coalition `max r = 5.96e-15`
against solo `min r = 0.3540`; `σ⁺_min = 0.4082`; `1.224745 = 3√(1−5/6)`; verdict COMMIT.

Summary of verdicts:

| Flag | Verdict |
|---|---|
| A3 — Theorem 1's "iff" | **PARTIALLY CONFIRMED** — one sub-claim refuted, one is a missing hypothesis, one is a real defect but the review names the wrong witness |
| A4 — the projection formula | **CONFIRMED** — the paper's own reference implementation contradicts the printed formula, and the implementation is the correct one |
| A5 — effective-resistance intuition | **CONFIRMED** for §2; §6 does *not* repeat the error |

---

## A3 — Theorem 1's "iff" (L188–190, echoed L25–26, L54–56, L359–360)

**Verdict: PARTIALLY CONFIRMED.** The quote is accurate. Of the three claimed contradictions:
(1) the kernel lie is **REFUTED** as a counterexample — the paper (and its own script) is entitled to
exclude it, and I proved the exclusion is exact rather than hand-waved; (2) the coalition **CONFIRMED**
as a literal counterexample to the box as written, but it is a *missing hypothesis* the paper declares
loudly in four other places, not a false claim; (3) the `G_c` vs `K_c` defect is **CONFIRMED and is real**,
but the review's designated witness (the 87 dark expander trials) is **REFUTED** — only 8 of those 87
are the counterexample, and Theorem 1 correctly predicts darkness for the other 79.

### Evidence

**Quote check.** L188–190 reads verbatim: "In gossip of signed logs with prefix restrictions and the
three-tier visibility model, the completion residual detects equivocation beyond pairwise comparison iff
the unchecked edge lies on a cycle of its coordinate subgraph \emph{and} its endpoints' reports are
relayed to the analyst: then $r>0$ proves no global explanation exists." The review's quote is faithful
(it truncates the trailing "then $r>0$…" clause, which does not change the reading). The echoes are real:
L25–26, L54–56, L359–360. Note that the abstract's echo, L25–26, is phrased *differently* — "a cycle whose
endpoint reports are relayed" — and is, read charitably, closer to the correct condition than the box is.
The §8 quotes are also accurate: kernel lie at L385–387 ("uniform (kernel) lies move every neighbor's view
identically and are invisible in principle ($\|o\|=5$, $r=2\times10^{-14}$ [internal])"); coalition at
L377–379; expander at L245–246.

**(1) Kernel lie — REFUTED as a counterexample.** The paper has a saving clause, and it is stronger than
a definitional dodge. Three layers:

- *Framing.* The subtitle is "Detecting Split-View Lies"; the scene at L41–43 defines the offence as
  showing "one head to its clockwise neighbor and a different head to its counterclockwise neighbor";
  §8's own wording concedes the uniform lie "move[s] every neighbor's view identically" — i.e. it is not
  a split view. It is a *consistent* false report, observationally identical to `q` having a different
  true state, and therefore not the thing Theorem 1 quantifies over.
- *The paper's own script agrees, in as many words.* `sheaf_consistency_radius.py:684–687` emits the
  assertion label `"kernel offset ||o|| = 5 (uniform lie = consistent alternative state): r = 2.0e-14 —
  invisible in principle, correctly NOT an equivocation"`. The artifact of record already classifies this
  case as out of scope.
- *And the exclusion is exact, not approximate.* I checked the harder question the flag implies: are there
  **non-uniform** (genuinely split-view) single-equivocator offsets that are also invisible on a relayed
  cycle? Derivation: the visible lie is a vector ε supported on `q`'s incident visible edges, and
  `r = ‖Proj_cycle(K_c) ε‖ = 0` iff ε lies in the cut space, i.e. `ε = Bz` for some vertex potential `z`.
  For `Bz` to vanish off `q`'s star, `z` must be constant on each component of `K_c − q`; so the invisible
  offsets are exactly "one constant per component of `K_c − q`". When `q` sits on a cycle of `K_c` that
  star is not separating, so there is exactly one such constant — the offsets are **uniform**. Numerically
  (`liar_matrix` = `Π_K A_q`, prefix size 3, D=5):

  ```
  two_path q=0 all visible    singvals=[0.4082 0.4082 0.4082 0 0 0]  ker dim=3  = #coordinates
  C6      q=0 all visible     singvals=[0.5774 0.5774 0.5774 0 0 0]  ker dim=3  = #coordinates
    max component of any kernel direction outside the uniform span: 4.7e-16 / 2.9e-16
  P5      q=2 (cut vertex)    M ≡ 0 (‖M‖_max = 8.9e-16)  -> everything invisible, as the theorem says
  ```

  So on precisely the topologies where Theorem 1 asserts detection, `ker(Π_K A_q)` **is** the uniform
  subspace and nothing more. The theorem's sufficiency is not defeated by the kernel case; the box merely
  omits the word "split-view" that the rest of the paper supplies.

**(2) Coalition — CONFIRMED as a literal counterexample, but a missing hypothesis, not a false claim.**
Reproduced from `sheaf_consistency_radius.py:689–719`: `C_8`, edges `(1,2)` and `(5,6)` both relayed, liar
`1` offsets `+s` toward `2` and liar `5` offsets `−s` toward `6`. Both lie edges satisfy Theorem 1's stated
hypothesis in full (on a cycle of the coordinate subgraph, endpoints relayed). Measured over 200 trials:
each liar alone `min r = 0.3540 = |s|/√8`; the coalition `max r = 5.96e-15`. So the box's "iff … then
`r>0`" is literally false as stated. But the paper is not making a false claim anywhere else: the abstract
(L31) says "single equivocator (coalitions on a cycle cancel to zero, measured at $6\times10^{-15}$)";
§6's one-breath (L271–272) says "with the single-equivocator condition proved to be the honest scope";
§8 clause 1 (L376–380) states it as a boundary; §7 (L364–365) claims it as contribution (4). The defect is
that the *box* — which the paper's own express-lane promise ("a reader in a hurry needs nothing else",
L34–35) presents as essential a standalone object — carries no hypothesis at all.

**(3) `G_c` vs `K_c` — CONFIRMED on the substance; the review's witness REFUTED.**

*The definition.* "Coordinate subgraph" is defined only at L143–145: `coker(δ)` "for prefix restrictions
decomposes per shared coordinate $c$ into the cycle spaces of the coordinate subgraphs $G_c$." There is
no visibility restriction in that definition; `G_c` is the subgraph of the **whole** gossip graph `G`
carrying coordinate `c`. (L174 confirms: `⊕_c H¹(G_c)`.) So the review's reading is correct: the theorem
says "cycle of `G_c`", and its second clause only requires the *unchecked edge's own* endpoints to be
relayed — it does not require the rest of the cycle to be visible. That is a genuine gap, because the
severed blocks are free variables and a cycle that uses one imposes no constraint at all.

*Minimal counterexample (hand-checkable, 6 nodes).* `C_6`, lie of 3.0 on relayed edge `(2,3)`, one other
cycle edge severed:

```
severed=none         r=1.224745e+00   on cycle of G=True   on cycle of K=True    beta1(K)=1
severed=[(0,5)]      r=1.137207e-14   on cycle of G=True   on cycle of K=False   beta1(K)=0
severed=[(4,5)]      r=1.870981e-15   on cycle of G=True   on cycle of K=False   beta1(K)=0
```

Every clause of Theorem 1's stated hypothesis holds in rows 2 and 3; `r` is float zero. The operator-level
version of the same fact: for `C_6` with `(0,5)` severed and `q=0`, `Π_K A_q ≡ 0` (`‖M‖_max = 1.5e-15`) —
*no* lie by `q` is visible, uniform or not.

*And the condition is not "β₁(K_c) > 0" either.* On the theta graph (`C_6` plus chord `(0,2)`), lie on
relayed `(1,2)`: severing `(0,1)` leaves `β₁(K) = 1` but kills detection (`r = 1.3e-15`) because the
surviving cycle does not pass through `(1,2)`; severing `(0,2)` leaves detection intact at `r = 1.224745`.
The correct condition is "the unchecked edge lies on a cycle **of the visible subgraph** `K_c`".

*The review's witness is wrong.* I re-ran the expander arm (`scenario_expander_partial`, arm d2) with the
same seeds and classified all 87 dark trials:

```
detected: 113   dark: 87
   79  no relayed lie edge (all lies land on SEVERED edges) -> Thm 1 clause 2 fails, darkness predicted
    8  relayed lie edge on a cycle of G but NOT of K        -> the G_c vs K_c counterexample
```

The d2 arm picks a partition-straddling `q` and lies across *all* its non-compared incident edges, severed
and relayed alike. In 79 of 87 dark trials `q` has no relayed incident edge at all, so the theorem's
"endpoints' reports are relayed" clause fails and it correctly predicts darkness. The review's assertion
that Theorem 1 "would predict 200/200 detected" is therefore false — it predicts detection only on trials
whose lie edge is relayed. The counterexample count in this arm is 8/200, not 87/200. The defect is real;
this particular piece of evidence for it is not.

*Unflagged instance of the same confusion, in a second box.* CR-1's closed form at L292 reads
`r = |s|√(1 − R^{G_c}_eff(e))` — same `G_c`. It has the same defect. Theta graph, lie 3.0 on relayed
`(1,2)`, chord `(0,2)` severed: measured `r = 1.224745 = 3√(1 − 5/6)`, i.e. `R_eff` computed on the
**visible** subgraph (a 6-cycle). `R_eff` on `G_c` (the theta graph) would give `r = 1.792843`. The
harness never catches this because *every* validation of the closed form (`section0`, `section1b`) is run
with all edges visible except the lie edge, so `K = G` and the distinction is invisible to the test.

### What this means for the fix

Theorem 1's substance survives; its *statement* is under-hypothesised and names the wrong graph. A minimal
repair to the box:

> …the completion residual detects a **single equivocator's split-view** lie beyond pairwise comparison
> iff the unchecked edge lies on a cycle **of the visible coordinate subgraph `K_c` (compared plus
> relayed)**…

Three edits fall out: (a) add "single equivocator" to the box — the paper already proves and states this
four times elsewhere, so this costs nothing but a clause; (b) add "split-view" or the explicit
`o ∉ ker(Π_K A_q)` qualifier that CR-1 already carries via `o_⊥`, with the newly-verified sharpening that
on a visible cycle that kernel *is exactly* the uniform lies; (c) replace `G_c` with `K_c` here, at L292
in CR-1, and check L143–145 defines `K_c` when it defines `G_c`. Echoes at L54–56 and L359–360 need the
same `K_c` correction; the abstract's L25–26 phrasing is already closer and may only need tightening.
Recommend also adding a severed-edge-on-the-cycle validation case to `sheaf_consistency_radius.py`
section 1b, which currently cannot see the `G`/`K` distinction at all.

---

## A4 — the projection formula (L164–165)

**Verdict: CONFIRMED.** Both halves of the flag are correct, and the strongest evidence is that the
paper's own reference implementation does it the *other* way — the way the flag says is right.

### Evidence

**Quote check.** L164–165 reads verbatim: "Equivalently $r=\|\Pi_K\,g_K\|$, the projection of the visible
disagreement data onto the per-coordinate cycle spaces:
$r^2=\sum_c\|\mathrm{Proj}_{\mathrm{cycle}(G_c)}\,g^c\|^2$". The minimization at L157–162 reads
$r = \min_{x,\;g_{\mathrm{sev}}} \| g_K - (\delta x)|_K \|_2$, "the minimum over global sections $x$ and
free severed blocks $g_{\mathrm{sev}}$, where $K$ is the compared-plus-relayed edge set."

**Re-derivation.** Note first that `g_sev` does not occur in the objective at all — the objective is a
function of `g_K` and `(δx)|_K` only, so `min over g_sev` is vacuous as printed. That is itself a (minor)
statement defect, but it is harmless because the intended content is exactly what the code comment says
(`sheaf_harness_v2.py:218–222`): "each severed block is wholly unconstrained, minimizing over it is exactly
dropping its rows." So the honest reading is

  `r = dist( g_K , im(δ_K) )`,  where `δ_K = P_K ∘ δ` and `x` ranges over all vertex assignments.

Now decompose by coordinate. Prefix restrictions are coordinate selections, so `(δx)_e` in coordinate `c`
is `x^c_u − x^c_v` whenever `c ∈ S_e`, and each `x^c_v` is an independent free scalar. Hence `δ_K` block-
diagonalises: for each `c`, the map is `B_c : ℝ^V → ℝ^{K_c}`, `(B_c z)_e = z_u − z_v`, the signed incidence
operator **of the subgraph `(V, K_c)`** — the visible edges carrying coordinate `c`. Severed edges
contribute no rows, so they are simply absent from `K_c`. Standard orthogonal decomposition of edge space:
`ℝ^{K_c} = im(B_c) ⊕ ker(B_cᵀ)`, where `im(B_c)` is the cut space and `ker(B_cᵀ)` — divergence-free edge
flows — is the **cycle space of `(V, K_c)`**. Therefore

  `r² = Σ_c dist(g^c, im B_c)² = Σ_c ‖Proj_cycle(K_c) g^c‖²`.

So the orthogonal complement is the cycle space of the **visible** subgraph. `cycle(G_c)` is wrong. The
flag's second point is also correct and independent: `g^c` lives in `ℝ^{K_c}` while `cycle(G_c) ⊆ ℝ^{G_c}`,
so the printed expression is not even type-correct without an unstated zero-extension convention — and
`Π_K` in the immediately preceding clause (L164), which is the notation used consistently at L289, L299
and L392, already means the projector on *visible* data. The sentence contradicts itself between its two
halves.

**The implementation sides with the flag.** `sheaf_consistency_radius.py:364–381`
(`residual_by_coordinate`, labelled "Lemma 1 route") builds `Ec = [e for e in known if sizes[e] > c]` —
known = compared + relayed only — and least-squares against the incidence matrix of that subgraph. Section
3a validates it against the full completion residual on expander topologies **with 3 severed edges per
trial**, and passes to `1e-9` (dense) and `1e-6` (CG). So `K_c` is what the validated artifact computes;
`G_c` is a transcription error into the paper.

**What the printed formula would do if taken literally.** `C_6`, lie 3.0 on relayed `(2,3)`, `(0,5)`
severed, `g^c` zero-extended to `G_c`:

```
zero honest states     r(definition)=1.137207e-14  ||Proj_cycle(K_c) g_K||=1.137207e-14  ||Proj_cycle(G_c) g^c||=1.224745
random honest states   r(definition)=9.506518e-15  ||Proj_cycle(K_c) g_K||=9.506518e-15  ||Proj_cycle(G_c) g^c||=0.717217
```

The `K_c` form agrees with the defining minimization to all printed digits. The `G_c` form manufactures a
detection out of nothing — and note the two rows differ, so the fabricated value is a function of the
honest global section, i.e. it is not even a well-defined statistic. Taken literally, the formula would
destroy the paper's severed-arm `0/200` and its cut-edge float-epsilon silence, which are the results the
harness was built to certify.

### What this means for the fix

One-symbol change with a real consequence: `\mathrm{Proj}_{\mathrm{cycle}(G_c)} \to
\mathrm{Proj}_{\mathrm{cycle}(K_c)}`, with `K_c := (V, \{e \in K : c \in S_e\})` defined where `G_c` is
defined (L143–145), and `g^c` explicitly stated to be indexed by `K_c`. Worth one added sentence of
justification, since the derivation is three lines and is the entire bridge between the minimization and
the theorem: *the severed rows drop out, so the image is the cut space of the visible subgraph and the
residual lives in its cycle space.* Consider also deleting the vacuous `g_sev` from the `min` at L160 (or
keeping it but saying explicitly that it drops out, which is the pedagogically useful version). The same
`K_c` correction is needed at L292 (see A3).

---

## A5 — effective-resistance intuition, §2 (L122–126) vs §6 (L277–281)

**Verdict: CONFIRMED for §2.** The clause does invert the physics, and the very next sentence in the same
paragraph contradicts it. §6 is **clean** — it does not repeat the error; its quantitative statement is
correct and correctly anchored.

### Evidence

**Quote check.** L122–126 verbatim: "*Effective resistance* $R_{\mathrm{eff}}(e)$ is the resistance
measured across edge $e$ when the graph is treated as a circuit of unit resistors. It appears in
\S\ref{sec:radius} for a reason that is physical rather than formal: a lie on an edge is hard to detect
exactly when the rest of the graph could have produced the same disagreement pattern by itself, which is
the same condition as current finding an easy alternative path. On a bridge, $R_{\mathrm{eff}}=1$ and the
lie hides completely; around a long cycle it approaches $1$ and conviction weakens like $1/\sqrt{n}$."

**The physics.** For unit resistors, the edge `e` (resistance 1) sits in parallel with the rest of the
network between its endpoints (resistance `R_rest`), so `R_eff(e) = R_rest / (1 + R_rest)`. An *easy*
alternative path means small `R_rest`, hence **small** `R_eff`. No alternative path at all (a bridge)
means `R_rest = ∞`, hence `R_eff = 1`, the maximum. So "current finding an easy alternative path" is the
**low**-`R_eff` regime. Since `r = |s|√(1 − R_eff)`, low `R_eff` is the regime of *maximal* detection —
the opposite of hiding. The clause is inverted.

The first half of the same sentence is correct ("hard to detect exactly when the rest of the graph could
have produced the same disagreement pattern by itself" = the observation admits an honest explanation =
high `R_eff`), which is what makes the "which is the same condition as" join a true error rather than a
loose analogy: it equates a high-`R_eff` condition with a low-`R_eff` one. And the next sentence supplies
the refutation in place — a bridge is exactly the case with *no* alternative path, and it is the case where
the lie hides completely. A reader who takes the emphasized clause at face value will predict bridge
detection and long-cycle silence, i.e. both of the paper's headline regimes backwards.

**Empirical check** (`sheaf_consistency_radius.py` primitives, single-edge lie `s = 3`, all edges visible,
`r` from `completion_residual`, `R_eff` from `eff_resistance`):

```
topology                             R_eff(e)   1-R_eff   residual r   detection
P6 bridge (no alternative path)        1.0000    0.0000     0.000000   DARK
C12 (one long alt. path)               0.9167    0.0833     0.866025   detected
C6  (one medium alt. path)             0.8333    0.1667     1.224745   detected
C3  (one short alt. path)              0.6667    0.3333     1.732051   detected
K4  (many easy alt. paths)             0.5000    0.5000     2.121320   detected
K6  (many easy alt. paths)             0.3333    0.6667     2.449490   detected
K8  (many easy alt. paths)             0.2500    0.7500     2.598076   detected
```

Monotone and unambiguous: the easier the alternative paths, the **lower** `R_eff` and the **larger** the
residual. Hiding is the high-`R_eff` end of this table, where alternative paths are absent or long.

**§6 is not guilty.** L277–281 verbatim: "The topology enters through electrical network theory: a lie on
edge $e$ hides in proportion to how well the rest of the graph can imitate it, which is the effective
resistance $R_{\mathrm{eff}}(e)$ --- on a bridge $R_{\mathrm{eff}}=1$ and the lie hides completely; on a
long cycle $R_{\mathrm{eff}}\to1$ and the certified fraction $\sqrt{1-R_{\mathrm{eff}}}$ decays like
$1/\sqrt{n}$." Every quantitative clause is correct: hiding ∝ `R_eff`; bridge `R_eff = 1` hides; long
cycle `R_eff → 1` with `√(1−R_eff) ~ 1/√n`. It makes no claim about current or alternative paths, so it
does not repeat §2's inversion. Its verbal gloss "how well the rest of the graph can imitate it" is loose
in the same neighbourhood — "imitate" could be misheard as "route around" — but it is bound to the
correct quantity and the correct example, so it misleads no one who reads the rest of the sentence.

### What this means for the fix

§2 needs one clause replaced, not a rewrite. The sentence is otherwise right, and its bridge example is
already the correct illustration; the repair is to make the electrical gloss agree with it:

> …a lie on an edge is hard to detect exactly when the rest of the graph could have produced the same
> disagreement pattern by itself — which is the condition that current finds **no** easy alternative path
> around the edge, i.e. **high** effective resistance. On a bridge, $R_{\mathrm{eff}}=1$…

An extra half-sentence naming the other end of the scale ("a well-connected edge has many cheap
alternative paths, `R_eff` near 0, and the lie is convicted at nearly its full size") would make the
paragraph carry the whole `r = |s|√(1 − R_eff)` intuition rather than only its silent end, and would match
§6 and the table above. §6 needs no correction; optionally swap "imitate" for "absorb" or "explain away"
for consistency with the repaired §2.

---

## Notes on scope of this pass

Nothing outside the three flags was audited systematically, but two adjacent observations surfaced while
checking them and are recorded here because they bear on the same fix:

1. **CR-1's closed form (L292) carries the same `G_c`/`K_c` defect as A4** and is not covered by any
   flag. It should be `R^{K_c}_eff(e)`. Witness in the A3 evidence above.
2. **The harness cannot currently see that defect.** Every closed-form validation in
   `sheaf_consistency_radius.py` sets `status = {e: "C" for e in edges}` with a single relayed lie edge,
   so `K = G` in all of them. A regression case with a severed edge *on the lie edge's cycle* would have
   caught both the L165 and L292 errors and is worth adding alongside the prose fix.

No document was edited. This file is the only write.
