# Exposition + Figure Review: The Cohomology of Equivocation — Detecting Split-View Lies in Federated Witness-Log Gossip by Sheaf Consistency

`whitepaper/research/tex/paper7.tex`, 435 lines, Paper 7 of the Harbor program: the R6 mechanism (detection beyond pairwise comparison iff the uncompared edge closes a relayed cycle), its pre-registered statistical harness (verdict COMMIT, seed 20260816), and the three consistency-radius theorems CR-1/2/3 (soundness + achievability with the $R_{\mathrm{eff}}$ closed form, localization, and the Laplacian complexity bound). It is the most mathematically exotic paper in the corpus — it imports cellular sheaf cohomology from applied algebraic topology into a distributed-systems detection mechanism — and therefore the one where the house style's "structural analogy" and "definitions just-in-time" moves carry the most load. Structurally the paper is in very good shape: `check_style.py` passes 7/7, `submission_lint.py` reports 0 errors and 0 warnings, all four figures are native-vector TikZ per `figures/CONVENTION.md`, the wristwatch analogy (§1) is one of the best structural analogies in the program, and the honest-boundary section (§8) is genuinely theorem-grade. The problems are concentrated in three places: the one-breath sentence and the vocabulary section assume sheaf fluency the paper elsewhere works hard not to assume; two `iff` statements are stated more strongly than the paper's own boundary section supports; and the paper carries zero tables and no hand-checkable *cochain*, so the reader never once sees the actual object — a vector of edge disagreements — that the whole apparatus operates on.

**Tooling note (superseded — see update below).** At review time `skills/research-paper-submission/` contained only a compiled `submission_lint.cpython-311.pyc` in an untracked `__pycache__` directory — the `.py` source and the figures-and-examples reference named in the task were not present in the repo (`git ls-files skills/research-paper-submission` was empty). I ran the linter by executing the `.pyc` directly under Python 3.11.15, which worked; the figure-craft criteria below are applied from the standard sources (Cleveland–McGill ranking, Mensh–Kording caption rules, greyscale survival) rather than from that missing file. No LaTeX toolchain exists here, so every claim about rendered output is marked **[needs render]**. **Update 2026-08-27:** the skill landed fully vendored in a later commit (`a8b520948`) — `skills/research-paper-submission/scripts/submission_lint.py` and `skills/research-paper-submission/references/figures-and-examples.md` both now exist and are tracked; this caveat no longer applies, left here only as the record of what this review pass actually had available.

**Mechanical linter output (STEP 2), verbatim:**

```
CLAIMS TO CONFIRM - not defects, questions to answer
  [info ] paper7.tex:242: 'in every' x1 at lines 242 - quantified over what domain?
  [info ] paper7.tex:25: 'iff' x6 at lines 25, 55, 181, 189, 285, 360 - both directions proved? check the degenerate cases (empty, zero, singleton)
0 error(s), 0 warning(s), 2 claim(s) to confirm
```

Both info items turn out to be real findings, not false positives — see A4, A5, A16 below.

---

## Part A — Text/exposition changes

### A1. The one-breath sentence is written in the vocabulary it exists to avoid

**Location:** lines 61–63 (§1, the `\onebreath` line, which is also the Move-2 sentence and the seed of the express lane).

**Issue:** *Definitions First*, in its most damaging position. The house style's novice done-test is "a smart outsider can restate the one-breath sentence in their own words after one read." This sentence uses **global section** and **coboundary** — twice — and both terms are defined 40 lines *later*, in §2. A distributed-systems reader who has never opened a sheaf book cannot restate it; they can only re-copy it. Every other move in §1 (the six-relay scene, the wristwatch analogy) is scrupulously jargon-free, which makes this the one sentence in the paper that breaks its own contract.

**Current text:**

> The idea in one breath: honest gossip is a global section, so the disagreement data of an honest world is a coboundary --- and around every cycle a coboundary must sum to zero, which lets relayed-but-never-compared reports convict an equivocator exactly when the missing comparison closes a loop, and provably never otherwise.

**Proposed rewrite:**

> The idea in one breath: if everyone is honest there is one true history behind every report, and then the disagreements the relays report must cancel around every loop of the gossip graph --- so a loop that fails to cancel convicts an equivocator across a link nobody ever checked, and where no loop closes, nothing can be seen at all.

Then add, immediately after the analogy in §2's opening (or as the last line of the Move-3 paragraph), the one sentence that binds the plain words to the imported names, so the vocabulary is *earned* rather than assumed:

> Those three phrases have technical names, and §2 supplies them: "one true history" is a *global section*, "the disagreements it would produce" is a *coboundary*, and "cancels around every loop" is the *cocycle condition*.

**Priority:** high. This is the single highest-leverage edit in the paper.

---

### A2. §2 "The vocabulary, defined" is a dictionary with no running instance attached

**Location:** §2, lines 76–132 (56 lines, ~13% of the paper).

**Issue:** *Definitions First*, softened but not cured. The section is self-aware and well-written — "that field's vocabulary is forbidding out of proportion to what it actually asks of the reader" (line 78) is exactly right, and defining each term "the sentence after it is named" is the correct discipline. But the promise on line 81, "each defined the sentence after it is named **and then used immediately**," is not kept: no definition in §2 is exercised on the six-relay federation the reader just met in §1. Ten terms arrive back-to-back (cellular sheaf, stalk, restriction map, coboundary, global section, cycle space, $\beta_1$, cokernel/$H^1$, completion residual, effective resistance, graph Laplacian) with the running example nowhere in sight. The house rule is "never more than ~5 new symbols per piece"; §2 introduces $\mathbb{R}^{d_v}$, $\delta$, $x$, $g$, $\beta_1$, $\operatorname{coker}$, $H^1$, $r$, $R_{\mathrm{eff}}(e)$, $\delta^{\!\top}\delta$ — ten, before a single one has done any work.

**Current text (representative, lines 90–93):**

> The vertex space $\mathbb{R}^{d_v}$ is the \emph{stalk} at $v$ --- the set of values that vertex could locally hold, with no reference to what its neighbours hold. The maps out of it are the \emph{restriction maps}: restriction, because they cut a vertex's full state down to the part an edge can see.

**Proposed rewrite (same paragraph, instantiated on the §1 scene):**

> The vertex space $\mathbb{R}^{d_v}$ is the \emph{stalk} at $v$ --- the set of values that vertex could locally hold, with no reference to what its neighbours hold. Relay 3 of the scene has a stalk: the five log-head entries it could report, one real number each, so $d_3=5$ (the harness runs $\mathbb{R}^5$ stalks throughout). The maps out of it are the \emph{restriction maps}: restriction, because they cut a vertex's full state down to the part an edge can see. On the link between relays 3 and 4, which reconcile only their first two entries, the restriction map is the two-row matrix that keeps entries 1 and 2 and drops the rest --- ``report the first $k$ entries of your log,'' as a matrix.

Do the same for `coboundary` (lines 95–100: give the four-number disagreement vector from the C4 example proposed in Part C1), `cycle space` (lines 106–110: state $\beta_1=1$ for the six-relay ring, $\beta_1=0$ for the six-relay chain), and `global section` (lines 102–104: "the six numbers, one per relay, that the auditor would have to be able to write down for the green table to be honest").

**Additionally:** move `effective resistance` (lines 122–126) and `graph Laplacian` (lines 128–129) out of §2 entirely. Neither is used until §6, four pages later; defining them here is definitions-ahead-of-need and it is where the section starts to feel like a preliminaries dump. §6 already re-motivates $R_{\mathrm{eff}}$ from scratch at lines 277–281, so the §2 copy is pure redundancy — delete it and let §6's version carry the definition (see also A3, which is a defect in the §2 copy specifically).

**Priority:** high.

---

### A3. **Possible factual issue, not just wording** — the effective-resistance intuition is stated backwards in §2

**Location:** lines 122–126 (§2, the `effective resistance` entry).

**Current text:**

> \emph{Effective resistance} $R_{\mathrm{eff}}(e)$ is the resistance measured across edge $e$ when the graph is treated as a circuit of unit resistors. It appears in \S\ref{sec:radius} for a reason that is physical rather than formal: a lie on an edge is hard to detect exactly when the rest of the graph could have produced the same disagreement pattern by itself, which is the same condition as **current finding an easy alternative path**. On a bridge, $R_{\mathrm{eff}}=1$ and the lie hides completely; around a long cycle it approaches $1$ and conviction weakens like $1/\sqrt{n}$.

**Why this looks wrong:** the emphasized clause inverts the physics, and contradicts the sentence that immediately follows it. Current finding an easy alternative path is *low* effective resistance. Hiding happens at *high* $R_{\mathrm{eff}}$ — the paper's own next clause says so ("On a bridge, $R_{\mathrm{eff}}=1$ and the lie hides completely"), and a bridge is precisely the edge with *no* alternative path. The closed form $r=|s|\sqrt{1-R_{\mathrm{eff}}(e)}$ agrees: conviction is strongest when $R_{\mathrm{eff}}$ is *small*, i.e. when many parallel paths exist. The §6 restatement (lines 277–280) gets it right — "a lie on edge $e$ hides in proportion to how well the rest of the graph can imitate it, which is the effective resistance" — so the defect is localized to this one clause in §2. Flagging rather than resolving: someone should confirm the direction against `sheaf_consistency_radius.py` before editing, since the correct physical gloss ("high $R_{\mathrm{eff}}$ = few parallel paths = the honest coboundary can absorb the whole offset") is the one that should replace it.

**Proposed rewrite (contingent on that confirmation):**

> ...a lie on an edge is hard to detect exactly when the rest of the graph could have produced the same disagreement pattern by itself, which is the same condition as the edge having no parallel path to share its current --- high effective resistance. On a bridge, $R_{\mathrm{eff}}=1$, no parallel path exists, and the lie hides completely; around a long cycle the single return path is a long series chain, $R_{\mathrm{eff}}$ climbs toward $1$, and conviction weakens like $1/\sqrt{n}$.

**Priority:** high (a reader who builds the wrong mental model here will read the entire CR-1 figure backwards).

---

### A4. **Possible factual issue, not just wording** — Theorem 1's `iff` is contradicted by the paper's own §8

**Location:** lines 188–191 (§4, Theorem 1); echoed at lines 25–26 (abstract), 54–56 (express lane), 360 (§7).

**Current text:**

> \textbf{Theorem 1 (mechanism).} In gossip of signed logs with prefix restrictions and the three-tier visibility model, the completion residual detects equivocation beyond pairwise comparison **iff** the unchecked edge lies on a cycle of its coordinate subgraph \emph{and} its endpoints' reports are relayed to the analyst: then $r>0$ proves no global explanation exists.

**Two problems, both in the sufficiency ("if") direction, exactly what the linter's `iff` prompt asks about:**

1. **Kernel lies.** §8 states, at theorem prominence, that "uniform (kernel) lies move every neighbor's view identically and are invisible in principle ($\|o\|=5$, $r=2\times10^{-14}$)" (lines 385–387). A uniform lie on a relayed cycle edge satisfies Theorem 1's stated condition in full and is *not* detected. The topological condition is therefore necessary, not sufficient.
2. **Coalitions.** §8 likewise: "two coordinated liars on a common cycle, each alone certified at $r\ge|s|/\sqrt8$, jointly cancel to $r=6\times10^{-15}$" (lines 377–379). Same structure: condition satisfied, detection absent.
3. **Separately, the cycle must be visible.** "a cycle of its coordinate subgraph" is the wrong subgraph. The completion minimizes over free severed blocks, which annihilates every cycle passing through a severed edge; the constraint that survives is the cycle space of the *compared-plus-relayed* subgraph $K_c$, not of $G_c$. The expander arm's own numbers are the witness: "partition-straddling equivocator $113/200$ cohomology-only, $87$ dark" (line 245) — those 87 dark trials are trials where a cycle of $G_c$ exists but no cycle of $K_c$ does. As literally stated, Theorem 1 predicts $200/200$ there.

**Proposed rewrite:**

> \textbf{Theorem 1 (mechanism).} In gossip of signed logs with prefix restrictions and the three-tier visibility model, the completion residual can detect equivocation beyond pairwise comparison \emph{only if} the unchecked edge lies on a cycle of the \emph{visible} (compared-plus-relayed) subgraph $K_c$ of its coordinate $c$; and when it does, detection occurs for every offset outside $\ker A_q$ --- in particular for every single-equivocator single-edge lie, at the certified strength of CR-1. The two exceptions to the converse are named and priced in \S\ref{sec:boundary}: offsets inside the kernel, and coalitions whose combined lie is itself a coboundary. On a cut edge $r=0$ identically --- the coboundary map of a tree (or forest) is surjective onto the visible data, so the free completion absorbs any lie. Across a severed edge, equivocation is provably dark: the severed block is unconstrained, and a consistent counterfactual world always exists.

Propagate the same softening to the abstract (line 25: "detection beyond pairwise comparison occurs iff the unchecked edge lies on a cycle whose endpoint reports are relayed to the analyst" → "...occurs only if the unchecked edge lies on a cycle all of whose edges are visible to the analyst, and then occurs for every non-kernel single-equivocator lie") and to the express lane (lines 54–56).

**Priority:** high. This is the paper's headline claim and its most quotable sentence; it should not be refutable by its own §8.

---

### A5. **Possible factual issue** — the projection formula names the wrong cycle space

**Location:** lines 164–166 (§3, "The detector").

**Current text:**

> Equivalently $r=\|\Pi_K\,g_K\|$, the projection of the visible disagreement data onto the per-coordinate cycle spaces: $r^2=\sum_c\|\mathrm{Proj}_{\mathrm{cycle}(G_c)}\,g^c\|^2$ [internal, \texttt{sheaf\_harness\_v2.py}].

**Why this looks wrong:** same root cause as A4(3). The minimization at line 160 ranges over free severed blocks $g_{\mathrm{sev}}$, so the residual is the distance from $g_K$ to $\{(\delta x)|_K\}$, whose orthogonal complement is the cycle space of the subgraph $(V,K_c)$ — cycles built only from visible edges. Writing $\mathrm{cycle}(G_c)$ (the full coordinate subgraph, severed edges included) makes the formula over-count: it would attribute residual to loops the analyst has no evidence around, which is precisely the D2 defect the paper elsewhere guards against. Note also that $g^c$ is only *defined* on visible edges, so the expression as written projects a vector onto a space of larger ambient dimension.

**Proposed rewrite:**

> Equivalently $r=\|\Pi_K\,g_K\|$, the projection of the visible disagreement data onto the cycle space of the \emph{visible} subgraph, coordinate by coordinate: $r^2=\sum_c\|\mathrm{Proj}_{\mathrm{cycle}(K_c)}\,g^c\|^2$, where $K_c=(V,K\cap E_c)$ is the compared-plus-relayed part of coordinate $c$'s subgraph. Severed edges contribute no constraint --- they are free variables of the completion, which is the algebraic content of ``provably dark'' [internal, \texttt{sheaf\_harness\_v2.py}].

**Priority:** high (it is a two-symbol fix, and it makes the severed tier's darkness fall out of the formula instead of being asserted alongside it).

---

### A6. The abstract promises an express lane the paper only half delivers

**Location:** lines 34–35 (abstract), against §§2, 3, 7, 8.

**Issue:** *One Path For All Readers*, in reverse — the paper advertises a reading protocol it does not keep, which costs an expert reader more than never advertising it. `\onebreath` appears in §1, §4, §5, §6. It does not appear in §2, §3, §7, or §8.

**Current text:**

> \emph{Express lane: the one-breath sentence opens each section; the formal statement is in the box below it; a reader in a hurry needs nothing else.}

**Proposed rewrite (fix the promise, and add the one line §8 most wants):**

> \emph{Express lane: each result section opens with its one-breath sentence and closes with the boxed formal statement; a reader in a hurry needs nothing but those. \S\ref{sec:vocab} is a dictionary, safe to skip if ``project the disagreements onto the cycle space'' already means something to you.}

And add to §8 (before line 369), giving the boundary — the section the paper itself calls essential — the same express-lane treatment as the theorems:

> \onebreath{Three things can make $r$ vanish on a guilty federation --- a coalition whose combined lie is itself a coboundary, a uniform lie that moves every neighbour's view alike, and a severed link that carries no report --- so $r=0$ means ``no conviction from this evidence,'' never ``honest.''}

**Priority:** medium.

---

### A7. One quantity, three names

**Location:** "harmonic signal" at lines 196, 202 (and `fig-r6-relation.tex` line 44 / `fig-r6-regime.tex` captions use "residual"); "completion residual" at lines 24, 118, 157, 269, 284; "the residual" passim; "signal $0.000$" at line 196.

**Issue:** Notation discipline ("one alphabet discipline per piece: don't reuse a letter for two roles" — and, symmetrically, don't give one role three names). A reader hitting "harmonic signal $1.225\ne0$" inside the Theorem 1 verification box has to decide whether this is the same $r$ the box just defined. It is (noise-free, single coordinate), but the paper never says so.

**Current text (lines 195–197):**

> \textbf{Verification (minimal pair).} $C_6$ with scalar stalks, lie of size $3$ on the one uncompared cycle edge: every pairwise check passes, harmonic signal $1.225\ne 0$. The same lie on a bridge of the path $P_6$: signal $0.000$

**Proposed rewrite:**

> \textbf{Verification (minimal pair).} $C_6$ with scalar stalks, lie of size $3$ on the one uncompared cycle edge: every pairwise check passes, completion residual $r=1.225\ne 0$. The same lie on a bridge of the path $P_6$: $r=0.000$

and use "completion residual $r$" everywhere, retiring "harmonic signal" (the harmonic reading is worth one sentence in §2's cycle-space entry, not a second name in the results).

**Priority:** medium.

---

### A8. The one closed-form identity is stated six times; a second worked topology zero times

**Location:** $1.2247 = 3\sqrt{1-5/6}$ at lines 29 (abstract), 203–204 (§4 numbers-by-hand), 293 (CR-1 box), 321–322 (§6 numbers-by-hand), plus `fig-paper7-radius.tex` lines 48 and 56.

**Issue:** Redundancy crowding out coverage. Six restatements of one number on one topology ($C_6$, scalar stalks, single-edge lie) is more repetition than the fade principle asks for, and the space it consumes is exactly the space a *second* hand-checkable case would occupy — one where the stalks are not scalar, or where the shared prefix is genuinely a prefix and the reader gets to see the per-coordinate decomposition do something. Both "Now you try" fades ($C_8$ at line 206, the 12-relay ring at line 324) are also single-edge scalar lies on a cycle, so the reader practises the same arithmetic three times and never once exercises the coordinate index $c$ that carries half the model's machinery.

**Proposed change:** keep the identity in the abstract and in the CR-1 box; cut it from §4's numbers-by-hand (line 204: delete "and, in the closed form of \S\ref{sec:radius}, $3\sqrt{1-5/6}$ [verified]" — §4 has not yet met $R_{\mathrm{eff}}$, so it is a forward reference that buys nothing there); and rewrite one of the two fades to exercise a second coordinate. Suggested replacement for the §6 fade at lines 324–327:

> \emph{Now you try:} the same 12-relay ring, but the equivocator lies in two shared coordinates at once --- $0.5$ in coordinate 1 (whose subgraph is the full ring) and $0.5$ in coordinate 2 (whose subgraph is the ring minus one link, hence a tree). The residual adds in quadrature over coordinates and the tree coordinate contributes nothing, so $r=\sqrt{(0.5/\sqrt{12})^2+0^2}=0.144$ [verified]: doubling the lie across coordinates bought the adversary nothing, because only the coordinates whose subgraph still closes a loop can convict.

**Priority:** medium.

---

### A9. $\beta_1=7$ and $\operatorname{coker}=2$ arrive with no referent

**Location:** lines 215–216 (§4, second misread) and lines 248–250 (§5 harness box).

**Issue:** Two structural numbers are printed as evidence with nothing to attach them to. Line 216 gives "the two-path split-view topology: $\beta_1=1$, $\operatorname{coker}=2$" — a reader who has just been told cokernel decomposes as $\bigoplus_c H^1(G_c)$ will try to reconcile $1$ with $2$ and stall, because the resolution (two shared coordinates each carrying one independent loop) is never stated. Line 249's "$\operatorname{coker}=0$ against $\beta_1=7$" names no topology at all.

**Current text (lines 214–216):**

> a loopy topology has $\beta_1>0$ for purely topological reasons on honest data too, so any counting claim must net $\beta_1$ out; the harness prints the structural cokernel separately (e.g.\ the two-path split-view topology: $\beta_1=1$, $\operatorname{coker}=2$) and scores only the residual, which is identically zero for honest worlds.

**Proposed rewrite:**

> a loopy topology has $\beta_1>0$ for purely topological reasons on honest data too, so any counting claim must net $\beta_1$ out; the harness prints the structural cokernel separately and scores only the residual, which is identically zero for honest worlds. The two numbers are not the same number and must not be compared: on the two-path split-view topology the graph carries one independent loop ($\beta_1=1$) but two shared coordinates whose subgraphs each retain it, so $\operatorname{coker}=\sum_c\beta_1(G_c)=2$ --- twice the graph's loop count, on honest data, with $r=0$ throughout.

and at line 249, name the graph: "($\operatorname{coker}=0$ against $\beta_1=7$ on the expander arm)" (or whichever topology it is — worth checking against `sheaf_harness_v2.py`).

**Priority:** medium.

---

### A10. Missing modern citations — the distributed-systems half of the related work is thirty years thin

**Location:** §7 (lines 338–365) and the bibliography (lines 417–433).

**Issue:** The applied-topology side is well covered and correctly positioned (Abramsky–Brandenburger 2011, Curry 2014, Hansen–Ghrist 2019, Robinson 2017, Carù 2017, Bach 1999). The distributed-systems side has exactly one entry (Sheng et al. 2021). For a paper whose scene is *federated witness-log gossip*, three literatures are conspicuously absent, and the program's own sibling whitepaper already cites two of them (see Part D):

- **Transparency logs and log gossip** — the paper's setting *is* this literature. RFC 9162 (Certificate Transparency v2.0, 2021); Laurie's CACM 2014 CT overview; the CT gossip line (Chuat et al., CNS 2015, "Efficient gossip protocols for verifying the consistency of certificate logs"; Nordberg et al.'s gossip draft); and the modern witness/cosigning ecosystem — Sigstore/Rekor (Newman et al., CCS 2022) and the Sigsum witness protocol. "Split-view attack" is *the* term of art in that literature for what this paper calls split-view equivocation, and the standard defence there (gossip until two views meet at one auditor) is exactly the pairwise baseline this paper claims to improve on. Not citing it makes the contribution harder to place, not larger.
- **Equivocation prevention** — Chun et al., "Attested Append-Only Memory" (SOSP 2007) and Levin et al., "TrInc: Small Trusted Hardware for Large Distributed Systems" (NSDI 2009). These are the canonical "make equivocation impossible" results; one sentence positioning this detector as the *no-trusted-hardware* complement would sharpen §7's "New, honestly" list.
- **Accountable BFT beyond Sheng et al.** — Civit et al., "Polygraph: Accountable Byzantine Agreement" (ICDCS 2021) and the accountability line following it.
- **Post-2019 applied sheaf work** — most importantly **Hansen & Ghrist, "Opinion Dynamics on Discourse Sheaves" (SIAM J. Applied Mathematics, 2021)**, which models agents that express different views to different neighbours on a cellular sheaf — the closest existing formalization of this paper's object, and its absence is the one gap a topology referee will notice immediately. Also worth a line: Riess & Ghrist on the Tarski Laplacian for lattice-valued sheaves (2022), relevant because §8's Carù clause is really an argument that $\mathbb{R}$ coefficients are the wrong coefficient system, and lattice-valued cellular sheaves are the obvious next coefficient system to name.

**Proposed insertion (new paragraph in §7, after "Adjacent, and honestly positioned," line 356):**

> \textbf{The transparency-log line.} The operational form of this problem is old and has a name: a log server that shows different append-only views to different clients mounts a \emph{split-view attack}, and the deployed defence is gossip --- clients exchange signed tree heads until two contradictory views meet at one auditor, at which point signatures settle it (Certificate Transparency, RFC 9162; the CT gossip protocols; and the witness-cosigning ecosystem of Sigstore/Rekor and Sigsum). That defence is exactly the pairwise baseline this paper starts from, and its known weakness is exactly ours: it convicts only where two views actually meet. The complementary hardware line makes equivocation impossible rather than detectable, by giving each node a trusted append-only counter (A2M; TrInc); we assume no such hardware and buy detection from topology instead. What cohomology adds to the gossip line is a verdict on links where the two views \emph{never} meet, at the cost of never naming the author --- and, per \S\ref{sec:boundary}, only on visible cycles.

**Priority:** medium-high (cheap to add; materially changes how a systems reviewer places the paper).

---

### A11. Unhedged universals: "never," "everywhere else," "always"

**Location:** lines 52, 104, 115, 353, 381, 384.

**Issue:** `submission_lint.py` returned no overclaim warnings, but its dictionary does not cover these forms. Four are essential:

1. **Line 52:** "and we prove darkness everywhere else" — the paper proves darkness for *severed* edges and silence for *cut* edges. It does not prove darkness for the other two dark regimes it later names (kernel lies, coalitions); those are exhibited by witness, which is not the same as a proof of darkness for all such lies. Suggested: "and we prove silence or darkness on each of the tiers where the residual cannot help, rather than letting the word ``cohomology'' imply more."
2. **Line 353:** "and can never name the liar" — this rests on the identical-data twin construction (line 381), which is a genuine observational-equivalence argument, but "never" is a universal over all topologies and all analyst-side side information. Suggested: "and cannot name the liar from residual data alone --- the twin construction below shows the two candidates are observationally identical."
3. **Line 384:** "must never be marketed as replacing" — fine as an ethical instruction to the program, out of register as a claim in a related-work section. Suggested: "which this detector complements rather than replaces."
4. **Line 115:** "will never be wrong in this paper" — charming and, as a claim about the paper, checkable. Keep.

**Priority:** medium (1 and 2), low (3).

---

### A12. Symbol flood in §3's opening paragraph

**Location:** lines 136–145.

**Issue:** Eleven symbols in one paragraph: $G=(V,E)$, $x_v$, $\mathbb{R}^{d_v}$, $e=\{u,v\}$, $S_e$, $L$, $\rho_{v,e}$, $g_e$, $\delta$, $\varepsilon$, $H^1$, $\operatorname{coker}$, $G_c$, $c$. Against the house rule of ~5 per piece, this is the paper's densest spot, and two of them ($\varepsilon$, and $G_c$) are used nowhere else in the section.

**Proposed change:** defer $\varepsilon$ to §6, where CR-1's bound $\|\varepsilon_K\|\ge r$ actually needs it. Give $G_c$ a one-line concrete gloss at its first appearance (line 144), because it is the symbol carrying the per-coordinate decomposition that A5, A8 and A9 all lean on:

> ...decomposes per shared coordinate $c$ into the cycle spaces of the coordinate subgraphs $G_c$ --- where $G_c$ is the subgraph of links whose shared prefix reaches coordinate $c$ at all. Coordinate 1 is reconciled on every link, so $G_1$ is the whole ring; coordinate 4 is reconciled only by the pairs with the longest shared prefix, so $G_4$ may be a forest, and lies in coordinate 4 are then dark by Theorem 1 even though the ring itself has a cycle.

**Priority:** medium (that last clause is the most useful sentence about $G_c$ the paper could contain, and it is currently absent).

---

### A13. The analogy's misread line changes the base object mid-sentence

**Location:** lines 70–72.

**Current text:**

> and --- the misread to preempt --- a watch at the end of a \emph{line} of tables can lie freely, because no loop passes through it: the telescoping argument needs the loop, and so does the theorem.

**Issue:** *Uncalibrated Analogy*, in miniature. The base was established as watches around **one** table (line 65). "A line of tables" is a new object introduced in the misread line itself, so the reader has to re-picture the base at the exact moment they are being warned about it.

**Proposed rewrite:**

> and --- the misread to preempt --- if the watches are seated in a \emph{row} rather than around the table, so that each compares only with the neighbour to its left, the one at the end can lie freely: no loop passes through it, and the telescoping argument needs the loop. So does the theorem.

**Priority:** low (one-line fix, but it is the analogy's punchline).

---

### A14. "known-graph cycle" is a hyphenation bug that lands on the paper's own vocabulary caution

**Location:** line 247; against the convention set at lines 131–132.

**Current text:**

> Localization: the max-residual edge lies on a known-graph cycle $200/200$

**Issue:** §2 promises "where the distinction matters we write ``graph cycle''" (line 132). The paper honours that promise exactly once, and in that one instance the hyphen binds to the wrong pair, so it parses as "a cycle of the known graph" rather than "a known graph-cycle." Either reading is defensible, which is precisely the ambiguity §2 set out to prevent.

**Proposed rewrite:**

> Localization: the max-residual edge lies on a graph cycle of the analyst's known topology, $200/200$

**Priority:** low.

---

### A15. A third provenance tag exists that the policy does not define

**Location:** lines 145, 198: `[verified framework, \cite{curry,hansen-ghrist}]` and `[verified framework, \cite{abramsky-brandenburger}]`.

**Issue:** The provenance policy admits two tags, `[verified]` (externally recomputable) and `[internal, script]`. `[verified framework, cite]` is a third, and it means something different again — "this construction is standard in the cited literature," which is what a plain citation already says. The exposition audit's finding was that outside readers cannot distinguish tag types unaided; adding an undefined third makes that worse.

**Proposed change:** drop the tag and keep the citation: line 145 becomes "...into the cycle spaces of the coordinate subgraphs $G_c$ \cite{curry,hansen-ghrist}." Line 198 becomes "...is Abramsky--Brandenburger contextuality \cite{abramsky-brandenburger}."

**Priority:** low.

---

### A16. Linter item: "pairwise blind in every trial"

**Location:** line 242.

**Current text:**

> Partition-on-a-cycle split view (\texttt{two\_path}): $200/200$ cohomology-only --- pairwise blind in every trial.

**Proposed rewrite (answers the linter's "quantified over what domain?"):**

> Partition-on-a-cycle split view (\texttt{two\_path}): $200/200$ cohomology-only --- in all 200 trials of this arm, every pairwise comparison passed and the residual still fired.

**Priority:** low.

---

### A17. Abstract/theorem drift in the complexity bound

**Location:** line 30 (abstract) vs. line 303 (CR-3).

Abstract: "computes in $\widetilde{O}(|E|\cdot L)$". CR-3: "$\widetilde{O}(|E|\cdot L\log(1/\epsilon))$ with SDD solvers." The $\widetilde{O}$ absorbs the solver's polylogs, but not the accuracy parameter $\epsilon$, which is a different kind of thing and which CR-3 deliberately writes out. Make the abstract match: "computes in $\widetilde{O}(|E|\cdot L\log(1/\epsilon))$".

**Priority:** low.

---

## Part B — Existing figures/tables: clarity audit

The paper has **four figures and zero tables**. Note for context: `preamble.tex` loads `booktabs` and `longtable`, and papers 1, 2, 4, 5 and 6 all use `tabular`; paper 7 is the only paper in the corpus with no table, despite carrying the corpus's densest numeric payload (the §5 harness box alone reports ten distinct measured quantities in running prose). That is Part C5.

All four figures are native-vector TikZ/pgfplots per `figures/CONVENTION.md`, all four carry the `[verified: script …]` provenance comment the convention requires, and all four have real labels that resolve (linter: 0 dangling references). **There are no Hasse diagrams and no commutative diagrams in this paper** — see Part C3, where I argue one commutative diagram would earn its place, on the condition that it is used for an actual chase.

---

### B1. `fig:r6rel` — the wristwatch relation-map (`fig-r6-relation.tex`, `\input` at line 74, §1)

**What it currently shows.** A three-row relation-map in the mandated program grammar: left column "Base: watches around a table," right column "Target: gossip logs on a graph," with double-headed red arrows carrying the mapped *relations* — "loop-sum ⇔ cocycle condition"; "cycle ⇒ relay substitutes / bridge ⇒ silent by construction"; "nonzero $r$ convicts — beyond pairwise comparison." A closing italic line restates the mechanism.

**What the reader should take away.** That the analogy transfers *relations*, not surface features — and specifically that the mapping predicts where the mechanism dies.

**Will they get it?** Yes. This is the strongest figure in the paper and one of the better relation-maps in the corpus. Cleveland–McGill does not apply (no encoded quantities). Greyscale: survives — the base/target distinction is carried by position and by the frame labels, not only by the blue/green fills; the arrows are the only red element and are also the only double-headed ones. Caption states the finding (Mensh–Kording rule 1) and ends on the falsifiable half — "The map predicts, correctly, where the mechanism dies: no loop, no telescoping, no detection." Arrow labels are relations, not nouns, which is the specific thing the house grammar checks for.

**Verdict.** Keep as is.

**One small fix.** Row 2's target cell packs two regimes into one box: "Uncompared edge ON a cycle: relayed reports substitute; uncompared edge is a BRIDGE (tree-$\delta$ surjective): nothing loops back to catch it" (`fig-r6-relation.tex` line 36). That cell is doing the work of two rows, and it is the only cell in the figure where the base column has no matching split — base row 2 describes only the loop case. Either split it into rows 2a/2b with the base side split to match ("one handshake skipped on the loop" / "one handshake skipped at the end of the row"), or move the bridge clause to row 3 where the $0.000$ number already lives. **[needs render]** to confirm the cell isn't overset at `text width=4.7cm`.

---

### B2. `fig:vis` — the three-tier observability contract (`fig-paper7-visibility.tex`, `\input` at line 168, §3)

**What it currently shows.** Left: one graph — a hexagon $C_6$ plus a pendant node 6 and a chord $1$–$3$ — with edges styled by tier (harborblue solid = compared, seagreen dashed = relayed, gray dotted = severed) and three tiny in-figure annotations. Right: a three-row legend table giving, per tier, what the residual can prove, with the harness numbers inline.

**What the reader should take away.** That the three tiers are properties of *the analyst's evidence*, not of the graph, and that they can coexist on one topology; and that the relayed tier is the only one that splits by topology.

**Will they get it?** Mostly, with two real obstacles.

- **Encoding collision with B3 (the important one).** In this figure, **dashed = relayed** (both the cycle edge $0$–$1$ and the cut edge $0$–$6$). Fifty lines later, in `fig:r6reg`, **dashed = the uncompared/cut edge** and solid = everything else, with node fills identical in both figures. So the same visual token means "relayed" in one figure and "cut" in the next, and the two figures are teaching the same three-tier contract. A reader who builds the legend from B2 will misread B3's panel (b) as "relayed," which is exactly the distinction the paper spends §3 establishing. **Fix:** adopt B2's three-tier encoding verbatim in B3 (solid harborblue = compared, seagreen dashed = relayed, gray dotted = severed) and mark the lied-on edge in B3 with a red $\times$ or a `shipred` halo rather than by dashing it. That single change makes the two figures one system.
- **The chord $1$–$3$ is unexplained.** The severed edge is drawn as a chord across the hexagon interior, so the graph is $C_6$ + chord + pendant, i.e. $\beta_1=2$ — but the text's running example is the plain 6-ring, $\beta_1=1$. A reader counting loops in the figure gets a different number than the text. Either drop the chord and sever a ring edge instead (keeping the figure's graph identical to §1's scene), or add one clause to the caption: "the severed link $1$–$3$ is a chord, so this graph carries two independent loops; the text's running example is the plain ring."

Cleveland–McGill: not applicable (structural diagram). Greyscale: survives — tiers are distinguished by dash pattern as well as hue, and the legend column repeats the line sample, which is the right belt-and-braces choice. Caption states the finding and ends with the tier-splitting claim. Provenance: numbers tagged `[internal, sheaf_harness_v2.py]` in caption. **[needs render]** for the 0.40/0.56 minipage split and whether the tiny in-graph labels ("relayed, cut edge" at $(1.75,0.42)$) collide with the pendant edge.

**Verdict.** Keep, with the encoding unification and the chord clause.

---

### B3. `fig:r6reg` — the regime diagram (`fig-r6-regime.tex`, `\input` at line 218, §4)

**What it currently shows.** Three side-by-side small graphs: (a) $C_6$ with one dashed edge → "residual 1.225 / detected (200/200 cohomology-only)"; (b) $P_6$ with one dashed terminal edge → "cut edge: residual 0.000 / provably silent"; (c) $C_6$ with one gray dotted edge → "severed: provably dark (0/200)."

**What the reader should take away.** Detection needs the cycle **and** the relayed reports; each panel is one clause of the contract.

**Will they get it?** Partly. Three issues, in descending order:

- **It is not a regime diagram.** Rail B specifies the regime figure as "axes = the two parameters that most control validity; shaded = where the result holds; marked = the session's measured points." This is a three-panel case gallery, not a parameterized regime. It works — the three cases *are* the contract — but it means the paper has no figure showing a *continuum*, and the boundary section (§8), which is where the regime figure is supposed to live, has no figure at all. See Part C4.
- **Encoding collision with B2** (see B2 above). Dashed means "cut" here and "relayed" there.
- **Panel (b) undersells its own point.** $P_6$'s dashed edge is the *terminal* edge $4$–$5$. Every edge of a path is a bridge, so the reader cannot tell whether "cut edge" means "terminal edge" or "bridge" — and the theorem is about bridges. The source file even carries a comment about widening node spacing so the dash on $4$–$5$ would show at all, which suggests the panel has been fought with. **Fix:** move the dashed edge to $2$–$3$, the middle of the path, so it is visibly a *bridge between two nontrivial halves* rather than a dangling end, and change the label to "cut edge (bridge): residual 0.000, provably silent."
- **Panel (a)'s $1.225$ and panel (c)'s $0/200$ are different kinds of number** (one is a per-trial residual, one is a detection rate) printed in the same slot and typography. Add the unit to each: "residual $r=1.225$ → detected in 200/200 trials" vs. "no cycle of visible edges → 0/200 detections."

Cleveland–McGill: not applicable. Greyscale: survives — panel captions (a)/(b)/(c) and the verdict text carry the meaning independently of the seagreen/shipred/gray coloring. Caption states the finding: yes, and well.

**Verdict.** Keep, with the four fixes; and add the true regime diagram of Part C4 rather than trying to convert this one.

---

### B4. `fig:radius` — the CR-1 closed form (`fig-paper7-radius.tex`, `\input` at line 329, §6)

**What it currently shows.** A pgfplots panel of $r/|s|=\sqrt{1-R_{\mathrm{eff}}(e)}$ over $R_{\mathrm{eff}}\in[0,1]$, with the cycle family $C_4,C_6,C_8,C_{12}$ as four green dots at $R_{\mathrm{eff}}=(n-1)/n$, the cut-edge corner $(1,0)$ as a red square, and two annotation callouts.

**What the reader should take away.** Conviction strength is a function of topology alone, and it goes to zero exactly at the bridge.

**Will they get it?** The encoding is right — position along a common scale, top of the Cleveland–McGill ranking, for both variables — but the figure has three problems that a render would make obvious:

- **Three quarters of the plot is empty.** Every real point in the figure lives in $R_{\mathrm{eff}}\in[0.75,1.0]$; the domain $[0,0.75]$ contains only the curve. The four cycle labels are consequently crammed into a 0.17-wide strip, and the source file already carries a comment recording one label collision that had to be hand-fixed ($C_{12}$ moved from $(0.878,0.335)$). That is the signature of a plot fighting its own axis range. **Fix:** either clip to $x\in[0.7,1.02]$ (the honest data range, and the range every federation-design decision lives in), or — better — make it two panels: left, the closed form on its full domain with the *200 random graphs* scattered on it; right, $r/|s|$ against cycle length $n$ on a log-$x$ axis, which is the panel that actually supports the paper's policy claim at lines 326–327 ("long cycles dilute conviction, which is an argument for short reconciliation loops").
- **The 200 random graphs are verified but not plotted.** The CR-1 box says the closed form is "exact on $C_4$–$C_{12}$ and 200 random graphs" (line 308). Those 200 points are the figure's strongest available evidence and they are absent, which leaves the figure illustrative when it could be evidential. Scattering them on the curve costs one `\addplot` and turns "we checked" into "look."
- **Unit collision in the annotation (concrete, checkable).** The y-axis is *certified residual per unit lie*, $r/|s|$. The green callout at `axis cs:(0.20,0.75)` reads "$C_6$, lie $s=3$: $r=3\sqrt{1-5/6}=1.2247$" and its arrow points at the $C_6$ marker, which sits at $y=0.408$. So the callout labels a point on a per-unit-lie axis with an absolute residual three times its height. Every number is correct; the placement invites the reader to think $1.2247$ is the plotted ordinate. **Fix:** "$C_6$: $r/|s|=\sqrt{1-5/6}=0.4082$, so a lie of $s=3$ certifies $r=1.2247$."

Greyscale: marginal. The three series are distinguished by hue (harborblue line, seagreen dots, shipred square) *and* by mark shape (none / `*` / `square*`), so the marks survive; the two text callouts are colored to match their series and would become ambiguous in greyscale, though their content disambiguates them. Acceptable. Caption states the finding, though descriptively — consider leading with the claim: "Conviction strength is set by topology alone."

**Verdict.** Keep; apply the three fixes. The unit-collision fix is the one that matters most. **[needs render]** to confirm the label positions after any axis-range change, since this figure's source shows a history of manual collision-fixing.

---

## Part C — New figures/examples proposed

### C1. The hand-checkable cochain: four relays, one lie, six numbers — **highest value item in this review**

**Where.** §4, immediately after the Theorem 1 box, opening the "Numbers by hand" paragraph (line 202) — before the $C_6$ arithmetic, not after it.

**What it would show.** A four-row `booktabs` table plus three lines of prose, working the smallest possible complete instance end to end. Concretely: four relays $0,1,2,3$ in a ring, scalar stalks, all honest reports agreeing except that relay 0 shows a head differing by $3$ to relay 3. The analyst's cochain — the actual vector of edge disagreements, which the reader has been hearing about since line 61 and has never seen — is $g=(0,0,0,3)$. The best honest world is *not* "all agree": least squares picks potentials $x=(0,\,0.75,\,1.5,\,2.25)$, whose coboundary is $\delta x=(-0.75,-0.75,-0.75,+2.25)$, and the miss is $0.75$ on **every** edge:

| edge | reported disagreement $g_e$ | best honest world $(\delta x)_e$ | miss |
|---|---|---|---|
| $0\!-\!1$ | $0$ | $-0.75$ | $0.75$ |
| $1\!-\!2$ | $0$ | $-0.75$ | $0.75$ |
| $2\!-\!3$ | $0$ | $-0.75$ | $0.75$ |
| $3\!-\!0$ (never compared) | $3$ | $+2.25$ | $0.75$ |

$r=\sqrt{4\times0.75^2}=1.5$, which is $|s|/\sqrt{n}=3/\sqrt4$ and $|s|\sqrt{1-R_{\mathrm{eff}}}=3\sqrt{1-3/4}$ — all three agree [verified]. Then the same lie of $3$ on the path $0\!-\!1\!-\!2\!-\!3$, edge $2\!-\!3$: the honest world $x=(0,0,0,-3)$ reproduces $g=(0,0,3)$ **exactly**, $r=0$ — not small, zero.

**Why it helps.** Four reasons, and they compound:
1. It makes "cochain" and "coboundary" concrete in the only way that works — as a column of four numbers the reader adds up themselves. Right now the paper defines coboundary abstractly (lines 95–100) and then never exhibits one.
2. It shows the *mechanism*, not just the verdict: the honest best-fit **spreads the lie evenly around the loop** and still misses every edge by the same amount. That is the sentence a reader will remember, and no current figure or number conveys it.
3. It makes the cut-edge case visceral: on the path there is a global assignment that fits *perfectly*, which is why nothing can be seen — the reader constructs the adversary's alibi with their own hands.
4. All arithmetic is exact quarters; nothing needs a calculator. This is the hand-checkable-number principle at full strength, and $C_4$ (unlike $C_6$) has no irrational anywhere.

**Kind.** Worked-numeric-example (table + three sentences). Costs perhaps 15 lines of LaTeX and no TikZ.

---

### C2. The dictionary table at the end of §2

**Where.** End of §2, at line 130 (before the "cycle vs. round" caution).

**What it would show.** Four columns: *sheaf term* | *symbol* | *what it is here* | *on the six-relay ring of §1*. One row per term, e.g.: stalk | $\mathbb{R}^{d_v}$ | the log states a relay could report | relay 3's five head entries; restriction map | $\rho_{v,e}$ | which entries a link reconciles | "first two entries," a $2\times5$ selection matrix; coboundary | $\delta$ | the disagreements a given world would produce | the six differences around the ring; global section | $x$ | one history explaining every report | six numbers, one per relay; cycle space | $\mathrm{cycle}(K_c)$ | the directions honesty forbids | one loop, so one direction, $\beta_1=1$; completion residual | $r$ | how far the evidence is from any honest world | $1.225$ on the ring, $0$ on the chain.

**Why it helps.** It serves both rails at once. The novice gets every abstract term anchored to the same concrete object (fixing A2 structurally rather than sentence by sentence); the expert gets a skimmable dictionary and can skip §2's prose entirely, which is what the express lane should let them do. It is also the natural home for the "you may read $H^1$ as 'project onto the cycle space'" permission the paper grants at lines 113–116.

**Kind.** Table (`booktabs`, matching the house pattern in `paper6.tex` line 328).

---

### C3. The restriction square, used for a chase

**Where.** §3, next to "The sheaf" paragraph (lines 136–145).

**What it would show.** A single edge as a genuine commutative diagram — $\mathbb{R}^{d_u}$ and $\mathbb{R}^{d_v}$ at the top corners, the edge stalk $\mathbb{R}^{|S_e|}$ at the bottom, $\rho_{u,e}$ and $\rho_{v,e}$ as the two down-arrows, and $g_e$ as the *difference* at the bottom — annotated with actual numbers: $u$ reports $(7,2,9,1,4)$, $v$ reports $(4,2,6,0,8)$, $S_e=\{1,2\}$, so $\rho_u x_u=(7,2)$, $\rho_v x_v=(4,2)$, and $g_e=(3,0)$: the lie is in coordinate 1 and coordinate 2 is clean.

**Why it helps, and the condition on it.** A commutative diagram must be used for a chase, not drawn for formality — the standard is that the reader can *follow the arrows and compute something*. This one qualifies: the reader traces two vectors down two arrows, subtracts, and lands on the per-coordinate split ($c=1$ dirty, $c=2$ clean) that the whole $\bigoplus_c$ decomposition rests on and that no current figure shows. It also silently answers the question a systems reader has been carrying since line 137 — "what does a stalk actually contain?" — which the prose answers only in the abstract. If it cannot be drawn so that the numbers work through it, it should not be drawn at all; a decorative square would be worse than nothing in a paper this careful about not letting "cohomology" imply more than it delivers.

**Kind.** Relation-map / commutative diagram with a worked numeric instance (plain `tikzpicture` per `CONVENTION.md`).

---

### C4. A real regime diagram for §8 — the boundary section currently has no figure

**Where.** §8, inside or immediately after the four-clause boundary box (line 396).

**What it would show.** Axes: $x$ = noise-to-lie ratio $\sigma_\eta/\sigma_{\mathrm{eq}}$; $y$ = $\sqrt{1-R_{\mathrm{eff}}}$ (certified conviction per unit lie), with the cycle family $C_4$–$C_{24}$ ticked on the $y$-axis so "ring length" is directly readable. Shade the region where the certificate holds; mark the two measured points from line 310 ($\ge95\%$ localization at $0.1$, $76.5\%$ at $0.2$); draw the $y=0$ line as the bridge/cut-edge floor. Then overlay, as hatched bands rather than curves, the three regimes where the certificate is silent regardless of position on these axes: severed edges, kernel lies ($r=2\times10^{-14}$ at $\|o\|=5$), and coalitions on a common cycle ($r=6\times10^{-15}$).

**Why it helps.** Rail B pairs the regime diagram with Move 7, and §8 is the paper's self-declared necessary section with zero visual support. It is also the only place the paper's *four* dark regimes appear together — right now they are four bullets, and a reader cannot see that three of them are orthogonal to topology entirely (which is the actual insight: shortening your reconciliation loops buys you nothing against a coalition). And it gives the two noise measurements a home; at present they are two percentages buried mid-box at line 310 and repeated at line 393.

**Kind.** Regime diagram (pgfplots, `harbor curve` style).

---

### C5. The harness arms as a table

**Where.** §5, replacing the prose interior of the `thebox` at lines 240–251.

**What it would show.** Columns: *arm* | *topology* | *visibility mix* | *result* | *what it is evidence of*. Rows: `two_path` split view | 6-node, one relayed cycle edge | relayed | $200/200$ cohomology-only | detection where pairwise is blind; severed cycle | $C_6$, one severed | severed | $0/200$ | the honest boundary, measured; `single_bridge` | $P_6$ | relayed cut edge | max $r=1.5\times10^{-13}$ / 400 trials | silence at float epsilon; full visibility | $C_6$ | all compared | $0$ cohomology-only, $200/200$ redundant | pairwise dominates where it applies; expander | 3 severed + 3 relayed | mixed | $113/200$ detected, $87$ dark | both clauses in one topology; no-equivocator control | — | — | $0/200$ | false-positive floor; D1 mutant | — | — | refused ($\operatorname{coker}=0$ vs $\beta_1=7$) | guard regression; D2 mutant | — | — | flagged (bit-identical residuals) | guard regression.

**Why it helps.** Ten quantities currently arrive as running prose inside one box, in three different units (rates, maxima, counts) with no alignment between them, and the reader is expected to hold the arm↔claim mapping in their head. A table makes the arm structure — which the paper itself calls the experiment's central design achievement ("The three-tier contract stopped being prose and became the experiment's arm structure," line 258) — actually visible as a structure. It also creates the natural slot for A9's missing topology labels, and for the pairwise-blind $313/1101$ rival-refutation number, which currently trails the box as an afterthought.

**Kind.** Table.

---

## Part D — Cross-reference notes

**Related — strongly.** `whitepaper/source/federated-harbor-whitepaper.tex` (1061 lines) is the public-facing counterpart, and §"Sheaf Laplacian and Abramsky–Brandenburger Contextuality" (lines 486–498) is a compressed restatement of paper 7's exact result, down to the same harness, the same seed, and the same numbers ("200 trials per arm, seed 20260816", "max $1.5\times10^{-13}$ over 400 trials", the D1/D2 mutants, the Carù clause). Its scope rider (i)/(ii)/(iii) is essentially paper 7's boundary in miniature and is well done. Five drift items:

1. **Two different formalisms wearing the same symbols — the important one.** The sibling models the federation as a **presheaf over a poset of administrative domains** with an **open cover** $\mathcal{U}=\{U_i\}$ and **Čech** cohomology $H^1(\mathcal{U};\mathcal{F})$. Paper 7 models it as a **cellular sheaf on the gossip graph** with $H^1=\operatorname{coker}(\delta)$ and an explicit cycle-space reading. Both write $\delta$; both write $H^1$; neither mentions the other's construction. A reader of both will assume one object. They are reconcilable — the nerve of the pairwise-overlap cover *is* the gossip graph, which is exactly why paper 7's graph-level treatment is legitimate — but somebody has to say so. **Recommendation:** one sentence in paper 7 §3, e.g. "Readers coming from the Čech formulation over a cover of administrative domains (Federated Harbor, §Sheaf Laplacian) can substitute freely: the nerve of the pairwise-overlap cover is the gossip graph, and its Čech $H^1$ is the $\operatorname{coker}(\delta)$ used here." Cheaper than harmonizing the two documents, and it prevents the misreading in both directions.

2. **The sibling's displayed theorem makes the exact error paper 7 preempts.** Sibling, Theorem "Equivocation as Cohomological Obstruction," displayed equation: $[\delta s]_{ij}=s_i|_{U_i\cap U_j}-s_j|_{U_i\cap U_j}=0 \iff H^1(\mathcal{U};\mathcal{F})=0$. That conflates *this cochain being zero* (a statement about the data) with *the cohomology group vanishing* (a statement about the sheaf and cover, blind to any particular lie). Paper 7 warns against precisely this at lines 213–216: "the detection statistic is the \emph{data} residual, never $\dim H^1$." The sibling's own scope rider (i) then says the right thing — "the obstruction lives in the data, not the sheaf" — and thereby contradicts its own displayed equation two lines above. Out of scope to edit here, but it is a live defect in a published-PDF whitepaper and paper 7's §4 misread paragraph is the ready-made fix.

3. **Statistic naming.** Sibling: "harmonic residual" (scope rider (i)) and "completion residual $r$" (status paragraph). Paper 7: "completion residual," "harmonic signal," and "the residual." Three names across two documents for one quantity — see A7; standardize on **completion residual $r$** program-wide, mentioning "harmonic" once as the geometric reading.

4. **Citation keys and the missing systems line.** Sibling uses `abramsky2011operational` and `hansengrist2019`; paper 7 uses `abramsky-brandenburger` and `hansen-ghrist`. Harmless while the bibliographies are separate, but worth unifying before any mega-volume build (`coordination-papers-mega-volume.tex` exists and would collide). More substantively: **the sibling already cites `laurie2013ct` (Certificate Transparency) and `newman2022sigstore` (Sigstore/Rekor), and paper 7 cites neither** — even though paper 7 is the document actually *about* witness logs. This independently confirms A10: the program knows this literature; the formal paper just does not cite it.

5. **Two different uses of "sheaf Laplacian."** The sibling reads it *spectrally* — "$\lambda_2(\Delta_{\mathcal{F}})$ governs the diffusion rate of anti-entropy gossip, establishing a rigorous bound on the relaxation time required for the federation to reach global consensus" — which is an unhedged claim with no harness behind it in either document. Paper 7 uses $\delta^{\!\top}\delta$ purely as the thing an SDD solver inverts (CR-3) and makes no spectral claim at all. Paper 7 is right to stay out of it; consider adding half a sentence to §8 or §7 explicitly declining the spectral reading ("the spectral theory of the sheaf Laplacian --- relaxation times, consensus rates \cite{hansen-ghrist} --- is a different result about a different question, and nothing here bounds it"), which both protects paper 7 and quietly flags the sibling's overclaim for a later pass.

---

## Summary

1. **Fix the two `iff` statements before anything else (A4, A5).** Theorem 1's "iff" is falsified by the paper's own §8 in two independent ways (kernel lies, coalitions), and its cycle condition names $G_c$ where it should name the *visible* subgraph $K_c$ — the same substitution error appears in the projection formula at line 165, where it also makes the expression dimensionally odd. The harness's own $87$ dark expander trials are the counterexample to the theorem as printed. This is the paper's headline claim; state it as necessary + generically sufficient and it becomes both true and stronger-sounding.
2. **Rewrite the one-breath sentence out of sheaf vocabulary (A1), and hang §2's dictionary on the six-relay scene (A2, C2).** For a paper whose whole exposition problem is "the reader knows distributed systems, not sheaves," the single sentence designed to be restatable by a novice currently contains *global section* and *coboundary*, both defined 40 lines later. Everything else in §1 is exemplary; this one line breaks the contract the rest of the paper honours.
3. **Add the four-relay hand-checkable cochain (C1).** Six numbers, exact quarters, no calculator: the reader sees the actual disagreement vector, watches the best honest world spread the lie evenly around the loop and still miss every edge by $0.75$, gets $r=1.5$ three ways, and then constructs the adversary's perfect alibi on the path. This does more teaching work than the general theory and than any of the four existing figures, and it costs ~15 lines with no TikZ.
4. **Unify the figure encoding and give §8 a figure (B2, B3, C4, C5).** Dashed currently means "relayed" in `fig:vis` and "cut" in `fig:r6reg` — two adjacent figures teaching the same contract with contradictory legends. Separately, `fig:radius` labels a per-unit-lie axis with an absolute residual ($1.2247$ against an ordinate of $0.408$) and leaves three quarters of its domain empty while its 200 verified random graphs go unplotted. And the boundary section, which the paper itself calls essential, has no figure at all — nor does the paper have a single table, alone in a corpus where five of seven papers use them.
5. **Two flagged for factual review, not wording (A3, plus A4/A5 above).** The §2 effective-resistance gloss says a lie hides "when current finds an easy alternative path," which is inverted — easy alternative paths mean *low* $R_{\mathrm{eff}}$ and *strong* conviction, as the very next clause and the closed form both confirm. §6's version of the same explanation is correct, so this is a localized defect, but a reader who builds their intuition in §2 will read `fig:radius` backwards for the rest of the paper. Adjacent, cheap, and worth doing in the same pass: the modern-citation gap (A10) — the transparency-log/split-view literature (RFC 9162, CT gossip, Sigstore/Sigsum), the equivocation-prevention line (A2M, TrInc), and Hansen–Ghrist's 2021 discourse sheaves, the closest existing formalization of this paper's object.
