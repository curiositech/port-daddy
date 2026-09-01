# Cross-Document Synthesis

This file is the missing synthesis pass over the fourteen independent exposition reviews in `docs/harbor-research/exposition-review/` — seven formal papers (`docs/harbor-research/tex/paper1.tex`–`paper7.tex`) and seven public-facing whitepaper volumes (`whitepaper/legible-swarm.tex`, `whitepaper/single-writer-kernel.tex`, and the five in `website-v2/public/whitepaper/`). Each of those fourteen reviewers read exactly one document and compared it against exactly one assigned thematic sibling; none of them saw the other thirteen findings. This pass reads all fourteen at once and reports what only becomes visible from there: the claim-level defects that need a domain expert before any edit lands (§A), the patterns that recur in three or more documents and should be fixed once as a house sweep rather than fourteen times (§B), the contradictions and unexploited connections that fall in the gaps between the assigned pairings (§C), and a single ordered work list (§D). It draws on roughly 4,700 lines of review notes covering about 340 individual findings, plus four targeted spot-checks against the `.tex` sources where a claim was load-bearing enough to verify. **Two findings in §A and several in §C are new — they were not visible to any single reviewer and are the specific reason this pass was worth running.**

---

## A. Needs a domain-expert check before any fix lands

Every item here is a *claim-level* problem, not an exposition defect: a theorem that does not survive its own degenerate case, a security claim that contradicts its own threat model, a number that contradicts its own figure, or a verification sweep that may be incapable of failing. Reviewers were instructed to flag rather than fix these, and they did. **Nothing in §B, §C or §D should be edited into these passages until the items below are resolved as facts.** A wrong theorem is worse than every exposition defect in this corpus combined.

### Tier 1 — a stated result appears to be wrong, or is refuted elsewhere in the corpus

**A1. `legible-swarm.tex` ships a threshold that `paper6.tex` has already falsified in both directions. [NEW — no single reviewer could see this.]**

- **Documents:** `whitepaper/legible-swarm.tex` §4.3 Theorem `thm:specialization` vs. `docs/harbor-research/tex/paper6.tex` §6–7.
- **The whitepaper states** (verified in source, legible-swarm.tex ~L868–877): "Sole ownership strictly dominates pooled generalist service in mean response time if and only if the specialist efficiency ratio exceeds the queueing congestion threshold: $\frac{\mu_{\mathrm{spec}}}{\mu_{\mathrm{pool}}} > 1 + \frac{(c-1)\lambda_F}{c\mu_{\mathrm{pool}} - \lambda_F}$," followed by "*Status: proposed.*"
- **paper6 states** (verified in source, paper6.tex L238–239, L249–253): "The whitepaper proposed the threshold $\tilde g = 1+(c-1)\rho/(1-\rho)$ and marked it *status: proposed*. The sweep ran before the belief formed --- and falsified $\tilde g$ in both directions." And: "The proposed threshold $\tilde g = 1+(c-1)\rho/(1-\rho)$ is **falsified in both directions**: at $c{=}2,\rho{=}0.1,r{=}1.15$ it certifies a … the thresholds cross at $\rho=(3-\sqrt5)/2$ … where $g$ saturates $\tilde g$ diverges ($\rho{=}0.9, c{=}8$: $g=7.73$ vs $\tilde g=64$)."
- Substituting $\rho = \lambda_F/(c\mu_{\mathrm{pool}})$ into the whitepaper's form gives $\tilde g$ exactly. These are the same formula. The exact replacement is paper6's $g_A(\rho,c)$.
- **Why it matters, and why it is the top item on this list.** This is not stale prose — it is a *refuted* result still shipping in the series' lead outward-facing volume, and paper6 names it as such by number and by status tag. Worse, the legible-swarm reviewer, having no knowledge of paper6, proposed in Part A item 2 and Part C item 2 to *add* a worked numeric example computing "$1 + \frac{2\cdot 2}{3.6-2} = 3.5$" from the refuted formula, plus a regime diagram plotting it. Acting on that review as written would propagate a known-false threshold into a new worked example and a new figure. **The legible-swarm §4.3 fix is not "add numbers"; it is "import paper6's $g_A(\rho,c)$ and delete $\tilde g$."**
- **Sources:** legible-swarm notes A2, C2 (which must be rewritten before use); paper6 notes intro, §6–7 discussion, Summary.

**A2. paper6 Theorem 3's `iff` is false at its own boundary point and has no domain condition.**

- **Document:** `paper6.tex` L289–291 (Theorem 3 box), with knock-on at L34–35 (abstract), L44 (express lane), L308–311, L337 (inventory table).
- **Verbatim:** "decreasing in $\mu_s$ with infimum $W_\infty$: *no amount of skill buys back residual downtime*. Consequently, with $K = A/(w\lambda) + W_{\mathrm{pool}}$ the pool's cost line, pooling dominates at *every* skill premium iff $\frac{\xi}{\eta} > D^\star = \frac{\eta K}{1-\eta K}$."
- **Two defects.** (i) *Strictness:* $W_\infty$ is an infimum **not attained** — the box says so one line earlier — so at exactly $\xi/\eta = D^\star$ every finite $\mu_s$ still gives $W_{\mathrm{bd}} > W_\infty = K$ and pooling still dominates. The correct sign is $\ge$, not $>$. (ii) *Missing domain condition:* $D^\star = \eta K/(1-\eta K)$ is a threshold only when $\eta K < 1$. For $\eta K > 1$ the closed form returns a **negative** number and the boxed criterion "$\xi/\eta > D^\star$" then holds for every positive $\xi/\eta$ — "i.e. as literally stated the box says pooling always dominates, which is the exact inverse of what the paper means."
- Compounded by three inequality conventions for one fact across four places: the box writes $>$, the inventory table (L337) writes "viable only while $\xi/\eta \le D^\star$", the abstract writes "stays below $D^\star$", the express lane writes $\le$. "The boundary point is claimed for both sides."
- The mechanical linter flagged exactly this line and asked exactly this question. The answer is no.
- **Source:** paper6 notes A1 / F1.

**A3. paper7 Theorem 1's `iff` is contradicted by paper7's own §8, in two independent ways, and names the wrong subgraph.**

- **Document:** `paper7.tex` L188–191 (Theorem 1), echoed at L25–26 (abstract), L54–56 (express lane), L360 (§7).
- **Verbatim:** "**Theorem 1 (mechanism).** In gossip of signed logs with prefix restrictions and the three-tier visibility model, the completion residual detects equivocation beyond pairwise comparison **iff** the unchecked edge lies on a cycle of its coordinate subgraph *and* its endpoints' reports are relayed to the analyst."
- **Three problems, all in the sufficiency direction.** (1) *Kernel lies:* §8 states at theorem prominence that "uniform (kernel) lies move every neighbor's view identically and are invisible in principle ($\|o\|=5$, $r=2\times10^{-14}$)" — such a lie satisfies Theorem 1's condition in full and is not detected. (2) *Coalitions:* §8 likewise, "two coordinated liars on a common cycle, each alone certified at $r\ge|s|/\sqrt8$, jointly cancel to $r=6\times10^{-15}$." (3) *Wrong subgraph:* the condition must be a cycle of the **visible** (compared-plus-relayed) subgraph $K_c$, not of $G_c$. "The expander arm's own numbers are the witness: 'partition-straddling equivocator $113/200$ cohomology-only, $87$ dark' — those 87 dark trials are trials where a cycle of $G_c$ exists but no cycle of $K_c$ does. As literally stated, Theorem 1 predicts $200/200$ there."
- **Why it matters:** this is the paper's headline claim and its most quotable sentence, and the paper's own experimental harness contains the counterexample.
- **Source:** paper7 notes A4.

**A4. paper7's projection formula names the wrong cycle space — same root cause as A3, and dimensionally odd.**

- **Document:** `paper7.tex` L164–166.
- **Verbatim:** "Equivalently $r=\|\Pi_K\,g_K\|$, the projection of the visible disagreement data onto the per-coordinate cycle spaces: $r^2=\sum_c\|\mathrm{Proj}_{\mathrm{cycle}(G_c)}\,g^c\|^2$."
- **Issue:** "the minimization at line 160 ranges over free severed blocks $g_{\mathrm{sev}}$, so the residual is the distance from $g_K$ to $\{(\delta x)|_K\}$, whose orthogonal complement is the cycle space of the subgraph $(V,K_c)$… Writing $\mathrm{cycle}(G_c)$ … would attribute residual to loops the analyst has no evidence around. Note also that $g^c$ is only *defined* on visible edges, so the expression as written projects a vector onto a space of larger ambient dimension."
- **Source:** paper7 notes A5.

**A5. paper7's effective-resistance intuition is stated backwards in §2 and correctly in §6.**

- **Document:** `paper7.tex` L122–126 vs. L277–281.
- **Verbatim (§2):** "a lie on an edge is hard to detect exactly when the rest of the graph could have produced the same disagreement pattern by itself, which is the same condition as **current finding an easy alternative path**. On a bridge, $R_{\mathrm{eff}}=1$ and the lie hides completely."
- **Issue:** "the emphasized clause inverts the physics, and contradicts the sentence that immediately follows it. Current finding an easy alternative path is *low* effective resistance. Hiding happens at *high* $R_{\mathrm{eff}}$ — the paper's own next clause says so … and a bridge is precisely the edge with *no* alternative path. The closed form $r=|s|\sqrt{1-R_{\mathrm{eff}}(e)}$ agrees."
- §6's restatement gets it right, so the defect is localized — but "a reader who builds the wrong mental model here will read the entire CR-1 figure backwards for the rest of the paper." Confirm the direction against `sheaf_consistency_radius.py` before editing.
- **Source:** paper7 notes A3.

### Tier 2 — a claim contradicts the same document's (or a sibling's) own stated boundary

**A6. `single-writer-kernel.tex`'s `SO_PEERCRED` claim directly contradicts its own Threat Model table. Security-relevant.**

- **Document:** `whitepaper/single-writer-kernel.tex` L1393 (§OP-9) vs. L819–823 and Table `tab:threat-model` L1298.
- **The threat-model table says:** "the socket peer-credential check is a software handshake, not the kernel-enforced socket credential (`SO_PEERCRED`) --- a real authentication caveat."
- **L1393 says:** "IPC sockets strictly enforce `SO_PEERCRED` validation, guaranteeing that the daemon can cryptographically bind incoming requests to a specific, sandboxed spawn instance, making same-user filesystem bypasses impossible."
- **Why it matters:** "this is the most serious individual finding in the review, because it is not an exposition problem — it is two mutually exclusive claims about the same security mechanism, one of which a reader relying on the threat-model table for a go/no-go decision would trust and be wrong to." Also note both `SO_PEERCRED` sections and the CSMA section are "the only technical mechanisms in the paper introduced with zero maturity grade" — the reviewer observes this is not a coincidence: "the ungraded sections are exactly the ones whose claims don't survive cross-checking."
- **Source:** single-writer-kernel notes A6, A14.

**A7. "Event-Sourced Neural Rehydration … solved … instantly" appears near-verbatim in TWO whitepaper chapters and is explicitly disclaimed by paper5's Honest Boundary. [Three documents; no single reviewer saw more than one.]**

- **Documents:** `spawn-to-person.tex` L758 and L1689; `single-writer-kernel.tex` L1597 and its §7 pull-quote/figure caption; disclaimed by `paper5.tex` §Resurrection Honest Boundary.
- **spawn-to-person L758:** "Strong continuity … is now solved via **Event-Sourced Neural Rehydration** (OP-4). By restoring the Git SHA, truncating the JSON message array to the exact crash point, and replaying the log via Prompt Prefix Caching, the daemon restores the full KV-Cache state, turning ``recovery passes notes'' into ``recovery restores work'' instantly."
- **single-writer-kernel L1597:** "OP-4 --- Checkpoint with teeth. Realized via **Event-Sourced Neural Rehydration**. By restoring the Git SHA, truncating the JSON message array, and replaying via Prompt Prefix Caching, the daemon restores the full KV-Cache state, turning ``recovery passes notes'' into ``recovery restores work.''"
- **paper5's Honest Boundary:** "Continuity witnesses attest lineage, not welfare: nothing here says the checkpoint restored the agent's 'experience,' only that the ledger followed the right body."
- **Both reviewers independently found it and both flagged the same technical objection:** the SWK reviewer calls it "the single least-hedged, least-graded, and technically shakiest sentence in the paper: no maturity grade, no citation, and 'restores the full KV-Cache state' glosses over the fact that a KV cache is bound to a specific model/inference session, not a portable artifact a restarted process can simply 'replay' back into existence." The spawn-to-person reviewer notes it sits *inside* a `\pitfall{}` box whose own opening sentence invokes the honest-attestation discipline it then violates, and that it contradicts that chapter's own Appendix status table (`\BUILTWEAK`) and its own "Open problems" section, which lists it as solved.
- **Verdict this pass adds:** this is one claim in three documents, not two independent lapses. Whatever is decided about the mechanism must be applied at all four sites plus paper5's boundary, in one edit. Grep confirms "rehydrat," "KV-cache," "prompt prefix," "OP-4" return **zero hits in either formal paper**.
- **Sources:** spawn-to-person notes A1, A2, D (§5 bullet), Summary #1; single-writer-kernel notes A3, A14, Summary #1.

**A8. spawn-to-person's "mathematically certain" cure is boxed as an unproven Conjecture and listed as an open problem — three confidence levels for one claim, in one section.**

- **Document:** `spawn-to-person.tex` L1482–1505 (§9, "Algorithmic Mode Collapse and the VRF Honeypot Solution"), L1693 (Open Problems item 4), and `fig-stp-rate-the-raters.tex` caption.
- **Prose:** "We cure this via two mandated mechanisms that force the recursion to terminate." **Key-idea box:** "By bounding the dishonesty payoff with a mathematically certain VRF slash, the rate-the-raters recursion collapses." **Boxed statement:** a `Conjecture`, not a theorem. **Exercise two pages later:** "Prove or refute Conjecture~\ref{conj:contract}." **Figure caption:** "Neither obligation is depicted as established."
- **And the honest fix is to claim *more*, not less:** paper3 has closed exactly this recursion as a parameterized theorem with reproducible numbers (sealed $C$-clique sampling, contraction rate $(1-\rho d)$, 53 levels / \$2,650 at $C{=}1$ vs. 27 / \$1,350 at $C{=}8$). None of it made it into the chapter. See §C2.
- **Source:** spawn-to-person notes A3, A4, D (§9 bullet), Summary #2.

**A9. `federated-harbor`'s sheaf-Laplacian claim has no support in either document — and paper7's reviewer independently flagged it from the other side.**

- **Documents:** `federated-harbor-whitepaper.tex` L502 (§5.5) and `paper7.tex` §7/§8.
- **Verbatim:** "The spectral gap $\lambda_2(\Delta_{\mathcal{F}})$ (the smallest non-zero eigenvalue of the sheaf Laplacian) governs the diffusion rate of anti-entropy gossip, establishing a rigorous bound on the relaxation time required for the federation to reach global consensus."
- **Federated-harbor's reviewer:** "No `\Partial`/`\Open` tag, no citation for the specific claim, and it does not appear in the Appendix A verification-status table… Hansen–Ghrist is cited [in paper7] only as *imported background* … paper7 never uses the spectral gap to bound gossip relaxation time. The claim has no support in either document." The whitepaper's actual gossip bound (Property `thm:fh-conv`) is proved from the classical Demers et al. epidemic argument — a different and unrelated result.
- **paper7's reviewer, independently, from the other side (D5):** "The sibling reads it *spectrally* … which is an unhedged claim with no harness behind it in either document. Paper 7 is right to stay out of it; consider adding half a sentence to §8 or §7 explicitly declining the spectral reading."
- Two reviewers, opposite directions, same conclusion — high confidence. This is "the one sentence in the whole document that breaks the paper's own 'we will not claim a result we do not have' discipline."
- **Source:** federated-harbor notes A1, D2, Summary #1; paper7 notes D5.

**A10. `federated-harbor`'s boxed Theorem makes the exact error paper7 spends a paragraph preempting.**

- **Documents:** `federated-harbor-whitepaper.tex` L490–496 vs. `paper7.tex` L213–216.
- The sibling's displayed equation: $[\delta s]_{ij}=s_i|_{U_i\cap U_j}-s_j|_{U_i\cap U_j}=0 \iff H^1(\mathcal{U};\mathcal{F})=0$. Per paper7's reviewer: "That conflates *this cochain being zero* (a statement about the data) with *the cohomology group vanishing* (a statement about the sheaf and cover, blind to any particular lie). Paper 7 warns against precisely this at lines 213–216: 'the detection statistic is the *data* residual, never $\dim H^1$.'" The whitepaper's own scope rider then contradicts its own displayed equation two lines above.
- Both reviewers converge on the same fix: replace the generic textbook `iff` with paper7's actual, harness-verified Theorem 1. Note this interacts with **A3** — do not import paper7's Theorem 1 into the whitepaper until A3 is resolved, or the corrected error will be replaced by the uncorrected one.
- **Source:** federated-harbor notes A5, D1; paper7 notes D2.

**A11. paper1's "[verified] super-additivity $1.05$–$1.08$ across regimes" is contradicted by its own figure's plotted data.**

- **Document:** `paper1.tex` §2 L88–91, abstract L21, contribution 2 L34, and `figures/fig-r2-regime.tex` caption.
- "`figures/fig-r2-regime.tex` carries an explicit `CROSS-CHECK NOTE` at its head saying so, and its own plotted panel (b) reaches 1.122 at $k{=}3$, 1.224 at $k{=}4$ ($m{=}8$) and 1.392 at $k{=}10$ ($m{=}20$). Only the single $k{=}2$ point (1.067) sits inside the stated band."
- The `[verified]` tag "asserts external recomputability for a range the recomputation does not produce." The correction is *stronger* for the paper's thesis. A header comment nobody has acted on already flags this.
- **Source:** paper1 notes A1, B3.

**A12. paper1 §4's two halves are calibrated at incompatible densities, and the joining paragraph steps over the gap.**

- **Document:** `paper1.tex` §4 L190 vs. L192.
- "The flagged set has $F=fN$ items of which $(p-\delta)N$ are real, so its density is $k/F=(p-\delta)/f$ — at the paragraph's own numbers ($p{=}0.05$, $\delta{=}0$, $f{=}2p$) that is **0.5**, and at $(\delta,f)=(0.01,0.10)$ it is **0.4**. Both sit deep in the dense regime the *next* paragraph says inverts the advantage. The Corollary's $(F,k)=(2500,10)$ example is density $0.004$, which under this model requires $f\approx 250(p-\delta)$ — unreachable at $p{=}0.05$."
- The composition pays only when $f \ge 12(p-\delta)$. "Saying so converts an internal contradiction into the paper's sharpest practical result." Paired with **A13**.
- **Source:** paper1 notes A2, Summary #2.

**A13. paper1's R4 Panel B regime diagram argues *against* the paper's own honest boundary — and its caption admits it in a subordinate clause.**

- **Document:** `figures/fig-r4-regime.tex`, `\input` at paper1.tex L196.
- "It plots the *ideal* $k\log_2(F/k)$, which never crosses parity anywhere in the plotted range, so the shaded 'zoom wins' band covers the entire chart — and the honest boundary the section spends a paragraph on (L192: at $F{=}100,k{=}90$ adaptive halving costs $199$ opens against $100$ flat) is off the right edge and invisible. The caption *admits* this in a subordinate clause… A regime diagram whose shaded region contradicts the result's stated boundary is the single most consequential figure defect in the paper."
- Listed in §A rather than §B because a figure that argues the opposite of the stated theorem is a claim defect, not a craft defect.
- **Source:** paper1 notes B7, C1, Summary #1.

**A14. paper6's fragment definition is not a coherent object, and it undermines the least-model justification of Theorem 1a.**

- **Document:** `paper6.tex` L145–146, with knock-on at L99–103 and L162–165.
- **Verbatim:** "**facts** (ground atoms) and **definite Horn rules** $a_1\wedge\dots\wedge a_k \to b$, where the head $b$ may be the contradiction symbol $\bot$."
- "A definite clause *is* one with a positive atomic head; a $\bot$-headed rule is a goal/integrity clause, and a Horn program containing one may have **no model at all** … That collides with L101–103 ('this process is guaranteed to terminate at one canonical answer. That answer is the *least model*') and with L102's 'it contains precisely the facts forced in *every* consistent world': when $\bot$ fires there are no consistent worlds and the sentence has no referent."
- Likely benign in implementation (the natural implementation computes the least model of the definite part then checks constraints) — "but the paper as written justifies Theorem 1a with a property the fragment does not have."
- **Source:** paper6 notes A2 / F2.

**A15. paper6's Bellman–Ford `iff` is false on disconnected deadline graphs without a super-source — check the script.**

- **Document:** `paper6.tex` L108–110, L165–166.
- "Bellman–Ford from a single arbitrary source detects only negative cycles *reachable from that source*… without it the 'iff' fails on any policy set whose deadline variables split into disconnected components — which is the common case, since unrelated commitments do not share deadline variables. The complexity term also changes" ($O(V\cdot E) \to O(V\cdot(E+V))$).
- **This one is not cosmetic:** "if `b4_deontic_fragment.py` runs Bellman–Ford from a single arbitrary vertex, the detector genuinely misses negative cycles in other components… the oracle is a different algorithm, so it probably *would* have caught it, which is evidence the implementation is fine and only the write-up is loose. **Check the script.**"
- **Source:** paper6 notes A7 / F3.

**A16. paper6's NP-completeness definition omits hardness — the half the 3-SAT reduction supplies.**

- **Document:** `paper6.tex` L113–115.
- **Verbatim:** "It is **NP-complete** when a proposed solution can be *checked* in polynomial time but no polynomial algorithm for *finding* one is known, and finding one would settle the P versus NP question."
- "That defines 'in NP and not known to be in P'. Hardness — the half that makes Theorem 1b's 3-SAT reduction do any work — is absent, so a reader who takes this definition literally cannot see why the reduction is needed at all." A wrong definition of the paper's central complexity concept, in the section whose job is to install it.
- **Source:** paper6 notes A3.

**A17. paper5's Theorem 4 uniqueness is retracted in the box and still asserted in four other places, including a figure caption.**

- **Document:** `paper5.tex` abstract L31–33, §5 one-breath L268–270, §7 L410–411, and `fig-b6-probation.tex` caption. The box (L292–302) correctly retracts.
- The box says in terms: "the *uniqueness* claim and the closed form $H(g^\star)=G_{\max}$ do not [survive]." The abstract still says "the maximally front-loaded one **uniquely** minimizes the tax on honest newcomers." The figure caption still says "the cliff at $t=0$ is the **unique minimum**" — "the worst kind, because captions are what readers quote."
- Same shape at A18. Together these are the paper5 cluster: "a Rail-A reader who reads only the express lane and the box gets a claim the box does not support, which inverts the purpose of the express lane."
- **Source:** paper5 notes A2, B5, Summary #1.

**A18. paper5's Theorem 2b pricing hypothesis is honest in the box and dropped in four advertising sites; and its γ threshold is stated wrongly at L105 and repaired eight lines deep inside a parenthesis.**

- **Document:** `paper5.tex` L28–31 (abstract), L151–153, L353, L407–409; and separately L105 vs. L126–129.
- L105 currently: "Budgets without debiting conserve nothing for $\gamma>\tfrac12$" — the true threshold for *this three-hop chain* is $\gamma\approx0.5437$ (root of $\gamma+\gamma^2+\gamma^3=1$); what is true at $\gamma>1/2$ is that *some* chain of sufficient depth mints. The correction is currently delivered "as an eight-line aside inside the parentheses of a 'Now you try' answer, immediately after the prose has already told the reader the wrong thing."
- **Source:** paper5 notes A1, A3.

**A19. `spawn-to-person`'s probation theorem is now stale relative to paper5's amended Theorem 4 — and the drift runs toward the whitepaper.**

- **Documents:** `spawn-to-person.tex` `thm:probation-dominance` L974–984 vs. `paper5.tex` Theorem 4.
- "The sibling states the pure cliff $g_0=G_{\max}$, $g_{t>0}=0$ as *the* minimizer with no ceiling hypothesis … Paper 5's amended Theorem 4 adds exactly the hypothesis that breaks this: with a per-period cap $L$, the pure spike is infeasible whenever $G_{\max}>L$, and the whole programme is infeasible when $G_{\max}>L/(1-\delta_f)$."
- Worth noting **because this is the corpus's *best*-synchronized pair** (see §C7): even here a correction landed on one side only.
- **Source:** paper5 notes D1.

**A20. paper2's two most quotable governance claims are pre-contradicted by paper2's own boundary box.**

- **Document:** `paper2.tex` L283–284 and L402–410.
- (i) "Widening $\Sigma_c$ (owning more channels) is the *only* way to grow the regimentable set" — false: shrinking $\overline{L}$ (making the event physically impossible rather than merely refusable) satisfies the criterion just as well, and "the paper elsewhere relies on exactly this lever (the 'sealed room' of §6 is a plant restriction, not only an alphabet widening), so the sentence contradicts its own neighbor."
- (ii) Boundary items (iii) and (vi) contradict each other: (iii) licenses moving `model_emit_token` into $\Sigma_c$, "at which point 'never emit a false token' *is* a controllable prohibition and (vi) is false. The real obstruction in (vi) is not controllability at all — it is that 'confident falsehood' is not a decidable predicate over the event alphabet."
- **Source:** paper2 notes A3, A4.

**A21. paper4's two central claims are stated at strengths the paper elsewhere refutes.**

- **Document:** `paper4.tex` L152–155 and L275.
- (i) The voting-booth analogy asserts a poll-watcher "learns exactly the declared aggregate and nothing about any ballot" — but the analogy's *own figure caption* already states the correct residual ("a per-precinct board with one voter is a leaky $g$"). "Here the reader derives a false [fact]."
- (ii) "**The scene, resumed.** Derek's data never leaves the room" — §8 states "'zero' is available only at $b=0$" and §7 prices q·b bits of egress. "Overclaim by imprecision — and specifically the *kind* of imprecision the paper exists to eradicate."
- (iii) Related: paper4 A3 — token-level taint unsoundness is "asserted as fact in §1 and called 'a stated unsoundness result' in §10, with nothing in between," in a paper whose L111–112 promises to "label every important statement as theorem, design invariant, model-checked property, or empirical hypothesis, and never let one impersonate another." Whole-worker taint, Theorem 2's consequence, and the novelty claim all rest on it.
- **Source:** paper4 notes A1, A2, A3.

### Tier 3 — verification-integrity questions to settle against the scripts

**A22. paper6's 60-instance specialization sweep may be structurally incapable of failing.**

- "$g_A(\rho,c)$ is *derived* by rearranging the inequality $w\lambda(W_{\mathrm{solo}}-W_{\mathrm{pool}}) \le A$… If the sweep's assertion computes the sign of $r - g_A(\rho,c)$ and compares it to the sign of that same net-cost difference evaluated from the same closed forms, then the assertion is algebraically entailed by the theorem statement printed above it and would report zero violations on a false theorem." Detection test: *can you algebraically derive the assertion from the theorem statement?* Apparently yes. **Check `b8_specialization.py`: does the sign check evaluate net cost from simulation, or from the same algebra?**
- The reviewer is careful to note the paper's *other three* checks are genuinely independent and could have failed. "The likely finding is that the 60-instance sweep is the one weak link in an otherwise strong stack, and the fix is either to re-run it against simulated net cost or to describe it honestly as an algebraic consistency check rather than as validation."
- **Given A1** — this is the same script backing the result that falsifies legible-swarm's shipped threshold. Settle A22 before A1's replacement is imported.
- **Source:** paper6 notes F7.

**A23. paper6's verification census does not add up two different ways.**

- "885 conflicts found --- 121 derivable $\bot$, 195 $\Ob$/$\Fb$ clashes, 484 claim overlaps, 213 negative temporal cycles --- of which 149 are reachable *only* through Horn propagation" vs. "Mutation: deleting Horn propagation … misses 100 of the 885 sweep conflicts."
- "If 149 conflicts are reachable only through propagation, deleting propagation should miss at least 149 of them, not 100. (Also: $121+195+484+213 = 1013 \ne 885$…)" The likely reconciliation (149 counts conflicts, 100 counts policy sets whose verdict flips) "must be confirmed against the script, not assumed."
- **Source:** paper6 notes A18 / F4.

**A24. paper6 may mis-cite Halfin–Whitt for a claim it does not make.**

- L352–353: "the economies of pooling in many-server queues are classical folklore sharpened by Halfin--Whitt~\cite{hw81}". "Halfin–Whitt 1981 is the square-root-staffing heavy-traffic limit; it is about *how many servers you need*, not about pooled-vs-dedicated. The pooling-economies result usually attributed here is Smith & Whitt (BSTJ 1981). Possible mis-attribution of a classical result — cheap to check, embarrassing if left."
- **Source:** paper6 notes F5.

**A25. paper1's `0/16` result carries two different provenance tags in two places.**

- Text (L33, L53) tags it `[internal, a7_experiment.py]`; `figures/fig-r1-relation.tex` row 3 tags the same number `[verified, a7_experiment.py]`. "A simulated 0/16 count is not externally recomputable from a closed form; `[internal]` is correct and the figure is wrong." Cheap, and "it is the one place the paper's own audit discipline visibly slips."
- **Source:** paper1 notes A6, B1.

**A26. paper6's direction-of-complexity question: the guard needs coNP, the theorem proves NP.**

- "Theorem 1b states that *conflict-freedom* … is NP-complete. But the runtime guard of §5 needs to **reject** — i.e. to certify that *no* selection is conflict-free — which is the complement, and coNP-complete… past the frontier the harbor loses not just the polynomial check but the short witness with it." Not a wrong statement, but confirm the intended reading before a referee does.
- **Source:** paper6 notes A14 / F6.

### Also flag for a factual pass, lower urgency

- **paper6 A11/A11b/A11c** — the bibliography stops in 2000 (all 11 refs 1917–2000, median 1978), and the reviewer matched it *verbatim* to failure #4 in the program's own `references/finding-prior-art.md`: "A paper cited deontic logic's philosophical origins and nothing from the computational side of the same field — where the complexity results live." Additionally "regimentable" is introduced in italics as a coinage with no citation, matching that document's failure #2. "A single missed literature is generating two independent defects." One hour of checking either buys a free citation or averts a reviewer's opening sentence.
- **paper2 A5** — Related Work *closes* on "we have not been able to obtain" Dastani, Sardina & Yazdanpanah's *"Norm Enforcement as Supervisory Control"* (PRIMA 2017) — the paper's exact thesis in its exact vocabulary — and the work is named in prose with no `\bibitem`. The honesty is right; the placement "converts it from integrity into a reject."
- **paper5 A12** — §5's rhetorical spine leans on Lazear, which §7 concedes the authors have not obtained: "if his contract front-loads the honest worker's implicit bond then Theorem 4 agrees with him rather than correcting him."
- **harbor-economy A3** — the Becker condition $\rho d B > G$ is asserted with $\rho$, $B$, $G$ undefined and no citation. See §C6 — paper3 *proves* this and could supply both.

---

## B. Systemic patterns across the corpus

Everything below appears in **three or more** of the fourteen documents. Each is cheaper to name once and sweep than to fix per-document, and several have a single shared root file.

| # | Pattern | Documents affected | Count |
|---|---|---|---|
| B1 | Un-propagated correction (fix lands in one place, stale everywhere else) | paper1, paper3, paper4, paper5, paper6, legible-swarm, single-writer-kernel, spawn-to-person, federated-harbor | **9 of 14** |
| B2 | Definitions-first (formalism before scene/analogy/instance) | all except paper6*, legible-swarm figures | **13 of 14** |
| B3 | Missing Move 5 (no hand-checkable numbers on a load-bearing result) | paper1, paper4, paper5, paper6, paper7, legible-swarm, single-writer-kernel, spawn-to-person, harbor-economy, bonded-commons, federated-harbor | **11 of 14** |
| B4 | Greyscale / colour-blind failure, or hue as the only channel | paper1, paper3, paper4, paper6, legible-swarm, single-writer-kernel, spawn-to-person, harbor-economy, federated-harbor | **9 of 14** |
| B5 | `\sffamily` inside TikZ against a serif body (cheap tell #2) | anchor-protocol (7 figs), bonded-commons (7 figs), harbor-economy (3 figs), federated-harbor (1 fig) | **4 docs, ~15 figures, ~13 unique files** |
| B6 | Unnumbered / uncaptioned / unlabelled table in a bare `center`+`tabular` | paper1, paper2 (×2), paper4, paper5, paper6 | **5 docs, 6 tables** (+ paper7 has *no* table at all) |
| B7 | `iff` stated without both directions or without its degenerate case | paper1, paper5, paper6 (×2), paper7 (×2), federated-harbor | **5 of 14** |
| B8 | Caption describes a different figure than the one drawn, or names a different script | paper1 (×2), paper3, paper4 (×2), paper6 | **4 of 14** |
| B9 | Dead / uncited `\bibitem`, or a work cited in prose with no entry | paper2, paper6, single-writer-kernel, spawn-to-person (×3), bonded-commons (×2), federated-harbor | **6 of 14** |
| B10 | Abstract is one undifferentiated dense block with no plain entry point | paper6, legible-swarm, single-writer-kernel, spawn-to-person, harbor-economy, anchor-protocol | **6 of 14** |
| B11 | Notation collision — one letter, two-plus roles inside one document | paper1↔ws, paper4 (`b`,`K`,`s`), paper5 (`W`), paper6 (`C`×3, `c`×2), legible-swarm (`φ`) | **5 of 14** |
| B12 | Missing modern citations / no prior-art search trail | paper1, paper2, paper6, paper7 | **4 of 14** |
| B13 | Material presented at theorem-grade confidence with **no formal-paper backing anywhere in the seven** | bonded-commons (economic core), spawn-to-person (§7–§8), harbor-economy (Mechanism 9) | **3 of 14** |
| B14 | Internal ledger codes (R5/R9/R10/R11/R12/R13/B6) printed as on-page figure titles | paper4 (4 figs), paper5 (2 figs) | **2 docs, 6 figures** |
| B15 | Assigned sibling pairing did not hold (reciprocally confirmed) | paper4↔anchor-protocol, paper6↔harbor-economy, bonded-commons↔paper6 | **5 of 14** |
| B16 | Missing tooling: `submission_lint.py` source and `references/figures-and-examples.md` absent from the tree | all 14 reviewers hit it | **14 of 14** |

\* paper6 has the pattern in a different form: its queueing dictionary is placed 110 lines before first use.

### B1 — Un-propagated corrections. The single largest pattern in the corpus.

Nine of fourteen documents contain a correction that landed in exactly one place and was never carried to the four-to-seven other places that advertise the same claim. The shape is identical every time: **the box/body is right, the shop window is wrong.**

- **paper3:** "The clique overclaim was removed from the prose body but survives in five places" — the one-breath sentence (L29), the express lane (L23), the misread-to-preempt (L31), the theorem box's depth formula (L117), and *verbatim as the literal string "unbounded depth"* in `fig-r7-relation.tex`, plus implicitly in `fig-r7-regime.tex`'s inset. The corrective paragraph at L131 has to open by telling the reader "the natural reading of the previous paragraph overstates the case."
- **paper5:** "The corrections landed in the boxes and not in the shop window" — seven sites (see A17, A18).
- **single-writer-kernel:** the largest instance in the corpus — **eight open problems** (OP-1, 2, 3, 4, 5, 7, 9, 10) declared solved in the master list and/or their originating section while "their own exercises boxes, the invariants table, the adjacency contract, and three figure captions still describe them as open or partial," running through "roughly a third of the document." Four artifacts about invariant I11 disagree *simultaneously*. In one case (OP-5/CSMA) the pseudocode itself was never updated: `alg:close` still enumerates the full oracle kind set without the two kinds CSMA is said to add.
- **paper1:** the super-additivity band (A11) and the `0/16` tag (A25).
- **paper6:** three inequality conventions for $D^\star$ across four sites (A2).
- **paper4:** "three structural regressions from the recent factual rewrites" — the Pillar III box grew to 44 lines swallowing three paragraphs of discussion and broke the express lane; `b` acquired a second meaning two pages from the paper's headline quantity $q\cdot b$; §7 silently discharges three debts three other sections promised it would name.
- **legible-swarm:** the SLM Sidecar described in built-present-tense with no Appendix A row and no `\Vision` tag; two parallel, inconsistent honesty-signalling systems (macros in the appendix, ad hoc `\emph{Status: proposed.}` prose near theorems).
- **spawn-to-person, federated-harbor:** see A7, A8, and the escrow figures (below).

**Recommended sweep, one pass, all nine documents:** for every corrected claim, grep for the claim's distinctive numbers and phrases across the *whole* document *and its figure fragments*, and fix all sites at once. The figure `.tex` fragments are where this pattern hides — three separate documents had a retracted claim surviving only inside a TikZ node or a caption. `single-writer-kernel` notes C2 proposes the durable fix: a reconciliation table with one row per OP and one column per artifact that echoes it, so any disagreement is visible at a glance. **That table should be built once for the whole corpus, not once per chapter.**

### B5 — `\sffamily` in TikZ figures. Exact tally, and the shared-file discount.

Four documents, roughly fifteen figure instances. The important structural fact no single reviewer could see: **`website-v2/public/whitepaper/figures/` is one directory shared by three chapters, and three reviewers independently flagged the same files.**

| File | Flagged by | Note |
|---|---|---|
| `fig-anchor-four-phases`, `-capability-attenuation`, `-alg-confusion`, `-delegation-inline`, `-cuckoo-inline`, `-revocation-gossip`, `-verification-stack` (7) | anchor-protocol B1–B7 | all seven live figures in that chapter |
| `fig-bonded-three-layer`, `fig-governance-flow`, `fig-sybil-inline`, `fig-magic-link-inline`, `fig-worked-example` (5) | bonded-commons B1,2,5,9,10 | |
| `fig-auction-inline` | bonded-commons B3 **and** harbor-economy B1–B3 | **same file, two chapters** |
| `fig-cartel-game-inline` | bonded-commons B7 **and** harbor-economy B1–B3 | **same file, two chapters** |
| `fig-fh-threat-bands` | harbor-economy B1–B3 **and** federated-harbor B5 | **same file, two chapters** |

So ~13 unique files, and three of them are double-counted across chapters — **fixing three files closes five reported findings**. anchor-protocol also flags `\sffamily` in *running text* (the series-locator box, L167), which the same sweep should catch.

Note the contrast the reviewers themselves drew: the seven formal papers do **not** have this defect (they use `figures/CONVENTION.md`'s native-TikZ house grammar), and bonded-commons' three matplotlib figures get it right (`"font.family": "serif"`, hh-palette hex-for-hex). "Use them as the in-document reference standard."

### B4 — Colour discipline. Same root, four different symptoms.

The corpus has no single palette rule that holds across all fourteen documents, and the failures are of four distinct kinds:

1. **Hue as the only channel, failing greyscale.** paper4 `fig:r9reg` is the sharpest: "computing Rec.709 luminance on the preamble RGB values at the fragment's `fill opacity=0.75` over white gives harborblue → ~112, shipred → ~104… **Harborblue and shipred differ by ~3% luminance**, and those two are precisely the 'holds' and 'caught' cells that sit side by side in row 2" — with a legend keying on colour *names*. Also paper3 B3 (three solid lines, hue only), paper6 B2 (two shaded lenses, hue only), legible-swarm 7 (`fig:sdt`'s two curves).
2. **Inverted valence across figures within one document.** single-writer-kernel: "In `fig-swk-reference-monitor` and `fig-swk-deontic-split`, cobalt marks the *stronger* guarantee… In `fig-swk-durability-faultclass`, the mapping flips… In `fig-swk-dual-runtime`, the same pair means 'test' vs. 'production,' a third, unrelated dimension." legible-swarm: "`maydayred` (an off-palette color, not defined in the main preamble) is used for 'danger/problem' in two figures while `hhcobalt` carries the identical meaning in two other figures."
3. **Rainbow status keys that contradict the document's own stated rule.** harbor-economy's three sans-serif figures also code status by hue "the exact 'rainbow status key' the document's own maturity-key box explicitly disclaims" (its preamble, L51: status labels "differ by WEIGHT and SMALL-CAPS/italic, never by hue"). single-writer-kernel `fig-swk-continuity-organs` is the sharpest: "three different hues for what is really a two-value status set, with the *same* word 'partial' rendered in two *different* colors in the same figure" — against the main file's own preamble comment at L48–49 saying exactly the opposite.
4. **The corpus-level red/green question.** paper6's reviewer raises it properly: "the primary contrast in both of paper 6's figures is the **red–green pair**… Protanopia/deuteranopia affect ~8% of men; with three male reviewers the chance at least one is red–green colourblind is ~22%… since the palette is program-wide this is a `CONVENTION.md` conversation, not a paper 6 edit."

**The house already has three worked exemplars to copy from, named independently by three reviewers:** `fig-swk-comm-organ.tex` (status by *border style*, not hue), anchor-protocol's `tab:anchor-status` and bonded-commons' `tab:verification-status` (status by weight/small-caps in ink and gray), and bonded-commons' matplotlib figures (redundant colour + marker shape). Standardise on those and the four symptoms collapse to one rule.

### B13 — Three documents carry theorem-grade material with no formal-paper backing.

The brief asked whether bonded-commons was alone. **It is not — there are three, and together they define the corpus's real coverage hole.**

- **bonded-commons** (the flagged case): "this chapter's game-theoretic core (correlated equilibrium, Sen's warning, claim-signaling incentive-compatibility, the competitive-insurance auction, the cartel folk-theorem) appears to exist *only* at the whitepaper level, with no formal-paper source to point a reader toward." A targeted grep across all of `docs/harbor-research/tex/` for Aumann / correlated-equilibrium / bond / commons vocabulary returns no match. Its structural/crypto half *is* backed — but by `anchor-protocol-whitepaper.tex`, which is itself a whitepaper, not one of the seven.
- **spawn-to-person §7 (multi-dimensional reputation) and §8 (why reputation is not a bandit problem):** "Grepping paper3 for 'quality vector,' 'multi-dimensional,' 'aesthetic,' 'efficiency axis,' 'bandit,' and 'EigenTrust' returns zero hits… the whitepaper currently gives them the same confident register as its fully-proven sections without flagging the gap."
- **harbor-economy "Mechanism 9" / the Purchased Assurance Bound:** the *only* mechanism in that chapter with no maturity tag, "the only theorem in the document with none [no figure]," missing from `tab:honest-state` (all 21 rows checked), and with three undefined symbols in its own theorem statement. Orphan numbering too — "`grep -n "Mechanism [0-9]"` over the whole file returns exactly one hit."

The pattern is the same in all three: **the honesty apparatus each document is proudest of has a hole exactly where the formal backing runs out.** The minimum fix is one sentence per site saying so, in the document's own maturity vocabulary. The larger question — whether bonded-commons' economic core should graduate to an eighth formal paper — belongs to the owner.

### B15 — Two of the seven assigned pairings do not exist. Both were confirmed from both sides.

| Assigned pairing | Verdict | Evidence |
|---|---|---|
| paper1 ↔ legible-swarm | **Holds, strongly** | verbatim theorem match; both sides confirm |
| paper2 ↔ single-writer-kernel | **Holds, strongly** | "no drift found"; SWK's theorem is paper2's special case |
| paper3 ↔ spawn-to-person | **Holds** | shared $B$, $\rho$, $d$, $G$; the conjecture/theorem seam |
| paper5 ↔ spawn-to-person | **Holds, best in corpus** | bidirectional citation, numerically synchronised |
| paper7 ↔ federated-harbor | **Holds, tightly** | seed, trial counts, cut-edge epsilon all match exactly |
| **paper4 ↔ anchor-protocol** | **Fails — reciprocally confirmed** | paper4's reviewer: "the pairing is weaker than the titles suggest… no shared theorem, no shared model." anchor's reviewer: "zero matches… **Not actually related — skip.**" |
| **paper6 ↔ harbor-economy** | **Fails — reciprocally confirmed** | paper6's reviewer: "The pairing is mostly wrong." harbor-economy's reviewer: "**Not actually related — skip.**" |
| bonded-commons ↔ paper6 | **Fails** | "share a research question, not a shared formal apparatus, notation, citation, or result" |

**What this means structurally, and it is the finding no reviewer could reach:** the corpus is not seven-to-seven. It is:

- paper1 → legible-swarm
- paper2 → single-writer-kernel
- paper3 **and** paper5 → spawn-to-person (one whitepaper carrying two formal papers)
- paper7 → federated-harbor
- **paper4 (Sealed Harbor) and paper6 (What Needs an Authority) have no whitepaper volume at all**
- **anchor-protocol, harbor-economy and bonded-commons have no formal paper at all**

Two orphaned formal papers, three orphaned whitepapers, one over-loaded bridge chapter. That imbalance is worth the owner's attention independently of any editorial fix, and it explains B13: the three orphaned whitepapers are exactly the three carrying unbacked theorem-grade material. **Except — see §C1: paper6 *does* have a whitepaper counterpart, and it is legible-swarm, not harbor-economy. The pairing sheet had the wrong document.**

### B16 — Tooling, reported by all fourteen reviewers.

`skills/research-paper-submission/scripts/submission_lint.py` exists in this tree only as a stale `__pycache__/submission_lint.cpython-311.pyc` (the legible-swarm reviewer confirms it is "genuinely missing, not just stale" and absent from git history on that path), and `skills/research-paper-submission/references/figures-and-examples.md` does not exist anywhere in the repo. Thirteen reviewers ran the bytecode directly; one could not and hand-checked instead. **Flag to whoever owns the skill packaging.** Also: no LaTeX toolchain exists in the container, so every geometry-dependent judgement across all fourteen reviews is tagged `[needs render]` and unverified. A render pass is a prerequisite for closing the figure items.

---

## C. Cross-document contradictions and unexploited connections

These are things no single reviewer could see, because each compared against exactly one sibling. Ordered by consequence.

**C1. legible-swarm ships a threshold paper6 falsified — which also means the pairing sheet assigned paper6 to the wrong whitepaper.**

Fully developed as **A1**. The additional structural point belongs here: paper6's abstract (L33) and §1 (L61) both refer to "the whitepaper's proposed threshold" and "the whitepaper's own proposed threshold," and §6 (L233) refers to "The whitepaper's sole-responsibility roles (roadmap owner, test-suite curator, release avatar)" — which are, verbatim, legible-swarm §4.3's three bulleted roles. **paper6's whitepaper counterpart is `legible-swarm.tex`, not `harbor-economy.tex`.** The assigned pairing sent paper6's reviewer to harbor-economy (a genuine mismatch, correctly reported from both sides) and sent legible-swarm's reviewer to paper1 (a genuine match, but only for §6–7). The result is that the one live falsification in the corpus went unreported by both reviews. Any future review round should pair paper6 §6–7 with legible-swarm §4.3.

**C2. paper3 proves the theorem spawn-to-person still poses as an open conjecture — and the drift runs toward *understating* what is proven.** *(the confirmed instance from the brief)*

spawn-to-person's `conj:contract` and its Open Problems item 4 ("Prove the re-audit tower contracts, or accept the core IC theorem is conditional") are closed by paper3's `thm:tower` — with a derived contraction factor, not an assumed one. paper3's own reviewer sharpens this from the other side: "Sibling Conjecture `conj:contract` takes '$G_{k+1} \le \lambda G_k$ with $\lambda \in [0,1)$' as a **hypothesis**. Theorem `thm:tower` derives $\lambda = (1 - \rho d)$ from the audit parameters. That is the actual advance, and paper 3 under-sells it." Both sides lose: the whitepaper leaves a closed result looking open, and the paper never says it closed a named conjecture. The importable numbers already exist (53 levels / \$2,650 at $C{=}1$ vs. 27 / \$1,350 at $C{=}8$). **This is one edit that improves both documents, and it is the corpus's clearest "claim more, not less" opportunity.**

**C3. paper1's real results would strengthen four separate hedged claims in legible-swarm, and none of them is cited.** *(answers the brief's question directly — yes, in four places)*

`grep`-confirmed by the legible-swarm reviewer: **no `\cite` or textual pointer to paper1 exists anywhere in `legible-swarm.tex`.**

| legible-swarm claim | paper1's stronger version | What the citation buys |
|---|---|---|
| Thm 6.1 `thm:lowerbound`, a bare proof sketch, no numbers | paper1 Theorem 1 — *verbatim the same formula*, same $N,k,m$ | A pre-registered falsification sweep, 0/16 violations incl. an adversarial oracle encoder, plus a worked $N{=}1000$ consistency check |
| Thm `thm:split-ranker` (fit vs. regret) | paper1 Theorem 2, comonotone characterization | Characterises *when sharing works*, not only that this instance fails |
| Thm `thm:split-digest` (successor vs. operator) | paper1 Theorem 2 again + the super-additive joint floor | Reveals the two whitepaper theorems are one result, and prices it ($2.13\times$, not $2\times$) |
| "Decision-theoretic derivation of the regret head" — the paper's densest, least-scaffolded paragraph | paper1 §`sec:regret`, "The regret head is derived, not designed" | Converts an apparently-fresh derivation into a correctly-attributed popularization, and gives the reader somewhere to go |
| (absent entirely) | paper1 §`sec:frontier`'s zoom theorem, $2k\lceil\log_2(F/k)\rceil+4k$ opens | "literally the algorithm that makes 'zoom' cheap at scale" — the missing companion to legible-swarm's whole digest-with-zoom chapter |

Note the second-order finding: legible-swarm's §8 Related Work "discusses five external literatures but never mentions the paper's own formal sibling."

**C4. paper2 already contains the analogy single-writer-kernel's reviewer had to invent, and single-writer-kernel already contains the theorem paper2 should claim to have generalised — and SWK's own exercise still calls it open.** *(answers the brief's second question — the analogy is ignored, in both directions)*

Three-way, and each reviewer saw only one leg:

- **SWK's reviewer (A10)** flagged `rem:controllability-scope` as "the single densest paragraph in the whitepaper and the one furthest from 'a smart-but-non-specialist reader'," and proposed importing paper2's bouncer/nightclub analogy: "A door policy ('no entry after 2am') is enforceable by prevention. A thought policy ('no ill intent inside') is enforceable only by observation and ejection." So the whitepaper — the document whose job is popularizing — is written in the *formal paper's* register while the formal paper carries the accessible analogy.
- **paper2's reviewer (D1)** found the reverse gap: paper2 §6 attributes the criterion to "product reviews of agent governance converged on the slogan…" when in fact "that is not a slogan from product reviews — it is `single-writer-kernel.tex`'s **Theorem** … a numbered result with an open-problem tag (OP-2)… paper2 *resolves* a sibling's named open problem, and currently doesn't say so."
- **SWK's own reviewer (A8)**, third leg: SWK proves the theorem in the body (`thm:decidability` + `rem:controllability-scope`) and *then* its exercises box "still asks: '(open, ★ OP-2) Formalize the regimentation-vs-enforcement boundary… A clean theorem here is the deontic heart of the layer.' The theorem the exercise asks for already exists two pages earlier."

**Net: OP-2 is proved twice and marked open twice, across two documents, and the analogy that would make either readable sits unused in the third place.** One coordinated edit fixes all of it.

**C5. The event-alphabet counts disagree across three documents, and the canonical source settles it. [Verified in source this pass.]**

- `paper2.tex` §3 (L117–119) defines $\Sigma_c$ = {fs_write, net_egress, exec_tool, git_push, spawn_child, **api_call**} (6) and $\Sigma_u$ = {model_emit_token, in_context_read, internal_plan, **hidden_activation**} (4). But paper2's own §1, abstract, and `fig-r5-relation.tex` say 5 and 3 — "a factual-presentation inconsistency that a referee will find in the first pass," and §7's "all eight (state, event) pairs" is only right at 4.
- `single-writer-kernel.tex`'s `rem:controllability-scope` gives $\Sigma_u$ = 3 events.
- `paper4.tex`'s Pillar II enumeration lists 5 controllable and 3 uncontrollable (per its reviewer's C2 proposed table: egress/push/write/exec/spawn, and emit-token/context-read/internal-plan).
- **`grep` this pass confirms `api_call` and `hidden_activation` appear only in `paper2.tex` and `docs/harbor-research/tex/exec2.tex`** — the execution report, which states the alphabet at 6/4. exec2.tex is the canonical source and settles paper2's A2 in favour of 6/4.
- **Consequence:** paper2 A2's fix must be propagated to `paper4.tex` §4 *and* `single-writer-kernel.tex` L942, neither of which either reviewer knew about. paper2's own reviewer half-saw it ("This is the same inconsistency as A2, and it now spans two documents") but had no visibility into paper4.

**C6. The same deterrence inequality appears in four documents under three names, proven in only one of them.**

- **paper3** proves it: $\rho^\star = G/(dB)$, with a settlement-convention fork ($\rho^\star_c = G/(d(G{+}B))$), worked numbers ($G{=}10$, $d{=}0.8$, $B{=}50 \Rightarrow \rho^\star = 0.25$), and a failure-mode analysis of quoting the wrong convention (over-auditing by 17% one way, under-deterring the other).
- **spawn-to-person** states it as $P(\text{Honeypot}) > G_k / B_k$ — "the $d = 1$ special case — perfect detection — and at the running $d = 0.8$ it under-quotes the required injection rate by 20%. It also uses strict $>$ where paper 3 uses $\ge$."
- **harbor-economy** states it as "the Becker condition $\rho d B > G$" with $\rho$, $B$, $G$ **undefined at point of use** and no citation (its reviewer proposes adding a `becker1968` bibitem).
- **bonded-commons** builds its claim-signaling and competitive-insurance sections on the same deterrence logic with no formal-paper pointer at all (B13).

**Nobody cross-references anybody.** The single highest-leverage corpus edit here: make paper3's $\rho^\star = G/(dB)$ the canonical statement, cite it from the other three, and let harbor-economy's undefined-symbols problem (A3) be solved by importing paper3's definitions rather than inventing new ones.

**C7. The corpus's best-synchronised pair, and what it proves.**

spawn-to-person ↔ paper5 is the standard. Its reviewer: "paper5 line 55 literally cites *'whitepaper Def.~III.6.1 and its necessity theorem'* — 'III.6.1' being Chapter III (this document), Section 6 (Identity), Definition 1 … confirming the two documents share a live, correctly-synchronized numbering scheme. Paper5's Theorem 4 matches the whitepaper's Theorem 6.3 with identical verification numbers (76,000 candidate schedules, 0 dominating, script `b6_probation.py`, seed 20260816). This is the tightest, best-executed cross-reference in the document — worth calling out as a positive exemplar," and in the Summary: "Worth preserving as the standard the rest of the series should be held to."

paper7 ↔ federated-harbor is a close second: "seed `20260816`, 200 trials per arm, cut-edge maximum residual $1.5\times10^{-13}$ over 400 trials, verdict COMMIT: all four numbers match paper7's harness section exactly."

**But — and this is the synthesis point — even the best pair has a live staleness (A19) and a live overclaim (A9, A10).** Bidirectional numeric sync is necessary and not sufficient; it does not survive a one-sided amendment. Whatever mechanism is adopted for B1 has to cover the cross-document case, not only the intra-document one.

**C8. Symbol collisions that only exist across documents. These matter because `coordination-papers-mega-volume.tex` exists.**

Two reviewers (paper4 D, paper7 D4) independently flag the mega-volume as the place these will bite.

| Symbol / term | Meanings, by document |
|---|---|
| `a` | paper1: the calibrated posterior (load-bearing, in a boxed theorem). legible-swarm `def:sdt`: the per-decision attention cost. paper1 uses $c_{\mathrm{att}}$ for the latter. "Same letter, adjacent results, opposite roles." |
| `ε` | paper4: differential-privacy loss ($\varepsilon_i$, $\varepsilon_{\max}$, $\sigma$). anchor-protocol: cuckoo-filter false-positive rate. "Both small positive numbers where smaller-is-better, both inside a $\log_2(\cdot)$ bit-count formula, visually near-identical (`\varepsilon` vs `\epsilon`)." |
| `W` | paper5 Thm 1: total witnessed value. paper5 Thm 2a: slashable stake. spawn-to-person `thm:whitewash-cost`: the whitewasher's forgone ability. **Three roles**, and paper5 §6 composes two of them in one paragraph. |
| `C` | paper3: number of independent cliques. paper6: exclusive-claim count *and* Erlang-C *and* a cost difference. harbor-economy: ledger state and `C_A` cards. |
| `epoch` | paper4: attestation freshness / rollback detection. anchor-protocol: a TTL window. anchor-protocol again: a revocation counter. federated-harbor: gossip epoch and epoch roots. **Four unrelated clocks.** |
| "zoom" | paper1 §4.2: adaptive group search over a flagged set. legible-swarm: the digest-to-artifact verifiability relation $\zeta$. **Both documents carry `\label{sec:zoom}`.** |
| "clique" | paper3: a benign structural asset ("the asset, not the attack"). spawn-to-person: the adversarial EigenTrust sense ("resists collusive cliques"). Opposite valence. |
| "specialist" | paper6: the fast $M/M/1$ server. harbor-economy: a rentable agent asset with a reputation. "the near-miss makes it worse, not better." |
| "authority" | paper6: chartered discretion, a mind with standing. harbor-economy: a capability token's permission set ("authority only ever narrowed"). bonded-commons: `\begin{definition}[Commons Authority]`, a persistent service. **Three senses; paper6's title is literally "What Needs an Authority."** |
| "enforced" | paper2: the umbrella genus covering both mechanisms. single-writer-kernel glossary: the narrow, weaker species. "Across the two documents, *enforced* and *detect-and-compensate* denote the same thing in SWK and different things in paper2." |
| "Harbor" | anchor-protocol: a zero-trust namespace-isolated execution environment. paper4: "Sealed Harbor," a confidentiality architecture. |
| citation keys | paper7: `abramsky-brandenburger`, `hansen-ghrist`. federated-harbor: `abramsky2011operational`, `hansengrist2019`. paper5: `parfit`/`parfit1971`. spawn-to-person: `parfit1984`. "Harmless while the bibliographies are separate" — not harmless in a mega-volume. |

**C9. Two positive connections nobody drew.**

- **A shared design principle, unnamed.** paper4's reviewer (D3): paper4's label monotonicity ("ordinary computation can only *add* restrictions… no label weakens without a declassification witness") and anchor's capability attenuation ("a delegated token never carries more authority than its parent, and TTL only shrinks") "are the *same* design principle — authority only shrinks, and any widening requires an explicit, witnessed exception — applied to labels in one paper and to capabilities in the other." bonded-commons' capability-attenuation theorem and federated-harbor's "capability only ever narrows" are the same principle a third and fourth time. One clause per document buys corpus coherence.
- **A convention that exists and is unused.** anchor-protocol's reviewer found that no figure in that chapter marks a trust boundary — "for a paper whose entire premise is a Dolev-Yao adversary who 'controls the entire network'" — and then found the convention sitting in the same directory, in an orphaned file: "`diag-magic-link.tex` … **is the one figure in the entire `figures/` directory that actually marks a trust boundary** … This proves the house convention is already known and practiced elsewhere in the same figures directory — it just was not applied to any of the seven figures actually shipped in this chapter." bonded-commons' `fig-magic-link-inline.tex` is the live version of the same figure.

**C10. Three reviewers independently recommend the same structural device, arrived at separately.** single-writer-kernel C2 (open-problems reconciliation table), spawn-to-person C6 (section → which companion paper backs it), and federated-harbor C5 (notation crosswalk to paper7) are three instances of one artifact: **a corpus-level concordance mapping every claim to its formal source, its maturity grade, and every place it is echoed.** Built once, it closes B1, B13, C5, C6 and C8 at the same time and prevents their recurrence. This is the highest-leverage *new* artifact this synthesis can recommend.

---

## D. Master priority-ranked action list

Strict order: §A items first (a wrong claim outranks everything), then §B systemic sweeps weighted by how many documents and figures they touch, then the highest-priority per-document items. Item references point into the named document's notes file.

### Tier 1 — resolve as facts before any editing (§A)

| # | Doc | Action | Ref |
|---|---|---|---|
| 1 | legible-swarm / paper6 | **Stop shipping a falsified threshold.** legible-swarm `thm:specialization` is paper6's refuted $\tilde g$; replace with $g_A(\rho,c)$. Do **not** execute legible-swarm A2/C2 as written — they would propagate it into a new example and a new figure. | §A1; legible-swarm A2, C2; paper6 §6–7 |
| 2 | paper6 | Fix Theorem 3's `iff`: $\ge$ not $>$ (infimum unattained), add the $\eta K<1$ domain condition, unify three inequality conventions across box/abstract/express lane/table. | paper6 A1/F1 |
| 3 | paper7 | Restate Theorem 1 as necessary + generically sufficient; name $K_c$ (visible subgraph) not $G_c$; propagate to abstract and express lane. The 87 dark expander trials are the counterexample. | paper7 A4 |
| 4 | paper7 | Fix the projection formula to $\mathrm{cycle}(K_c)$ — same substitution, and it makes severed-tier darkness fall out of the algebra. | paper7 A5 |
| 5 | paper7 | §2's effective-resistance gloss is inverted; §6's is correct. Confirm against `sheaf_consistency_radius.py`, then fix §2. | paper7 A3 |
| 6 | single-writer-kernel | Resolve the `SO_PEERCRED` claim as a **fact**, then reconcile L1393 with §5.4 and `tab:threat-model`. Security-relevant; do not leave both standing. | SWK A6, A14 |
| 7 | spawn-to-person + SWK + paper5 | Settle "Event-Sourced Neural Rehydration" once and apply at **four sites in two chapters** plus paper5's Honest Boundary. Grep confirms zero support in either formal paper. | §A7; s2p A1/A2; SWK A3/A4 |
| 8 | spawn-to-person | Collapse three confidence levels for the VRF/mode-collapse claim into one — and import paper3's closed theorem. The honest fix claims *more*. | s2p A3, A4 |
| 9 | federated-harbor | Cut or hedge the sheaf-Laplacian "rigorous bound"; add an Appendix A row. Confirmed unsupported from both sides. | FH A1/D2; paper7 D5 |
| 10 | federated-harbor | Replace the boxed generic $H^1=0$ theorem with paper7's real result — **after** item 3 lands, not before. | FH A5/D1; paper7 D2 |
| 11 | paper1 | Correct "super-additivity 1.05–1.08 [verified]" — own figure reaches 1.39. Fix text, abstract, contribution 2, and the figure caption. Correction is stronger. | paper1 A1, B3 |
| 12 | paper1 | State the composition window $f \ge 12(p-\delta)$; §4's two halves are calibrated two orders of magnitude apart. | paper1 A2 |
| 13 | paper1 | Replot R4 Panel B with the **deployed** bound out to $d{=}0.95$ — the current panel argues against the paper's own boundary. | paper1 B7, C1 |
| 14 | paper6 | Split "definite Horn rules … head may be $\bot$" into definite rules + integrity constraints; repair the least-model justification at L102 and L163. | paper6 A2/F2 |
| 15 | paper6 | Bellman–Ford `iff` needs the super-source; complexity term changes to $O(V(E{+}V))$. **Check `b4_deontic_fragment.py` first.** | paper6 A7/F3 |
| 16 | paper6 | NP-complete definition omits hardness — rewrite. | paper6 A3 |
| 17 | paper5 | Propagate Theorem 4's retracted uniqueness to abstract, express lane, "New, honestly," and `fig-b6-probation`'s caption. | paper5 A2, B5 |
| 18 | paper5 | Propagate Theorem 2b's pricing hypothesis to four advertising sites; fix the γ threshold at source (L105) so the fade shrinks to one line. | paper5 A1, A3 |
| 19 | spawn-to-person | Inherit paper5's feasibility ceiling into `thm:probation-dominance` and its status note. | paper5 D1 |
| 20 | paper2 | "Widening $\Sigma_c$ … is the *only* way" — false; narrowing $L$ works too, and §6 relies on it. Fix boundary (vi) with the decidability argument, not the controllability one. | paper2 A3, A4 |
| 21 | paper4 | Label the token-taint unsoundness as a **design premise**; correct the voting-booth overclaim and "Derek's data never leaves the room." | paper4 A1, A2, A3 |
| 22 | paper6 | **Check `b8_specialization.py`:** does the 60-instance sweep's assertion derive from the same algebra as the theorem? If yes, re-run against simulation or relabel it an algebraic consistency check. Blocks item 1's replacement. | paper6 F7 |
| 23 | paper6 | Reconcile 149-vs-100 and 1013-vs-885 against the script before rewording. | paper6 A18/F4 |
| 24 | paper6 | Check Halfin–Whitt attribution; likely Smith & Whitt (BSTJ 1981). | paper6 F5 |
| 25 | paper6 | Confirm the coNP reading is intended for the guard direction, and say so. | paper6 A14/F6 |
| 26 | paper1 | `0/16` tagged `[internal]` in text, `[verified]` in figure — fix the figure. | paper1 A6 |

### Tier 2 — systemic sweeps (§B), weighted by breadth

| # | Scope | Action | Ref |
|---|---|---|---|
| 27 | 9 docs | **Un-propagated-correction sweep.** For every corrected claim, grep its distinctive numbers/phrases across the document **and its figure fragments**, and fix all sites at once. Figure `.tex` nodes and captions are where this hides. | §B1 |
| 28 | 9 docs | **Build the corpus concordance** (claim → formal source → maturity grade → every echoing artifact). Closes B1, B13, C5, C6, C8 at once; three reviewers proposed local versions of it independently. | §C10; SWK C2, s2p C6, FH C5 |
| 29 | 4 docs, ~13 files | **Strip `\sffamily` from every TikZ figure.** Three files are shared across chapters — fixing three closes five findings. Also the anchor series-locator box. Use bonded-commons' matplotlib figures as the reference. | §B5 |
| 30 | 9 docs | **One colour rule, corpus-wide.** Status by weight/small-caps/border-style, never hue; add a redundant non-colour channel wherever hue is load-bearing. Exemplars already exist: `fig-swk-comm-organ` (border style), `tab:anchor-status` / `tab:verification-status` (weight), bonded-commons matplotlib (colour+shape). Settle the red/green question in `CONVENTION.md`, not per-paper. | §B4 |
| 31 | 5 docs, 6 tables | **Float, caption, label every bare `center`+`tabular`**, with captions that state the finding. Six tables, all currently unreferenceable. | §B6; p1 B8, p2 B3/B4, p4 B1, p5 B1, p6 A6/B4 |
| 32 | 3 docs | **Tag the unbacked material.** One sentence per site, in each document's own maturity vocabulary, saying no formal paper backs it. Then decide whether bonded-commons' economic core graduates. | §B13 |
| 33 | 5 docs | **`iff` audit.** Every biconditional in the corpus: both directions, and the degenerate case (empty, zero, singleton). The linter asks this and it has been wrong three times. | §B7 |
| 34 | 6 docs | **Bibliography hygiene pass:** dead entries (spawn-to-person ×3, bonded-commons ×2, federated-harbor ×1 — note `blanchet2016modeling` is uncited in **both** bonded-commons and federated-harbor), works cited in prose with no entry (paper2/Dastani, paper6/Ross, SWK/Ramadge–Wonham), and key unification before any mega-volume build. | §B9; §C8 |
| 35 | 2 docs, 6 figs | **Retire internal ledger codes from figure titles** (R5/R9/R10/R11 in paper4, R12/R13/B6 in paper5). paper4's reviewer thought paper4 was the outlier; paper5 has it too. | §B14; p4 B3–B6, p5 B2/B5 |
| 36 | 4 docs | **Prior-art pass** on paper6 (normative-MAS conflict detection + OM's "server flexibility"/"skill-based routing"; DMP 1991; the "regimentable" naming check), paper7 (RFC 9162 / CT gossip / Sigstore / A2M / TrInc / Hansen–Ghrist 2021), paper2 (obtain Dastani), paper1 (post-2018 oversight). Write the PRISMA-lite search trail — "the missing artifact in all six [documented] failures." | §B12; p6 A11/A11b/A11c, p7 A10 |
| 37 | 3 docs | **Fix the cross-document contradictions in C5, C6 and C8** as single coordinated edits: settle the alphabet at 6/4 (canonical: `exec2.tex`) across paper2 + paper4 + SWK; make paper3's $\rho^\star=G/(dB)$ canonical and cite it from spawn-to-person, harbor-economy and bonded-commons; resolve `a`, `ε`, `W`, `C`, `epoch`, "zoom," "clique," "specialist," "authority," "enforced." | §C5, C6, C8 |
| 38 | 4 docs | **Add the missing cross-citations** (§C3): paper1 → legible-swarm (four places); paper3 ↔ spawn-to-person (§C2); paper2 ↔ SWK, incl. closing OP-2's double-open status (§C4); anchor ↔ paper4/bonded/FH on the shrink-only principle (§C9). | §C2, C3, C4, C9 |
| 39 | corpus | **Run a render pass and re-check every `[needs render]` item.** Nothing in the figure work can be closed without it. Also restore `submission_lint.py` source and `figures-and-examples.md`. | §B16 |

### Tier 3 — highest-value per-document items

| # | Doc | Action | Ref |
|---|---|---|---|
| 40 | paper4 | Adopt one name per pillar (Noninterference / Enforceability / Conservation / Detection) across the table, composition paragraph, four section titles and four figure labels. "Cheapest high-value edit in the paper" — four schemes currently in play. | paper4 A4 |
| 41 | paper4 | `fig:r9rel`'s caption describes a voting booth; the drawing is an airlock. Pick one and make figure, caption and prose agree. | paper4 B3 |
| 42 | paper4 | Add the Ryoan forward pointer in §1 and the seven-row comparison table in §10 — "the highest-value new artifact proposed." | paper4 A12, C1 |
| 43 | paper4 | Rename the SPRT Type-II target off `b`; the paper's headline quantity is $q\cdot b$. Re-open the 44-line Pillar III box. Name §7's three debts. | paper4 A9, A8, A11 |
| 44 | paper3 | Rebuild `fig-r7-relation.tex`: its caption describes a traffic-enforcement figure that does not exist, one arrow states a false relation, and it carries the removed "unbounded depth" claim twice. | paper3 B1, C1 |
| 45 | paper3 | Fix the theorem box's depth formula first (both regimes), then the two patch paragraphs stop reading as retractions. | paper3 A2, A3 |
| 46 | paper3 | Add the $T{=}1500$ saturation panel — on $[0,200]$ the $O(1)$ curve is the second-steepest. | paper3 B3, C3 |
| 47 | paper7 | Rewrite the one-breath sentence out of sheaf vocabulary and hang §2's dictionary on the six-relay scene. "The single highest-leverage edit in the paper." | paper7 A1, A2, C2 |
| 48 | paper7 | Add the four-relay hand-checkable cochain (exact quarters, ~15 lines, no TikZ) — "does more teaching work than the general theory and than any of the four existing figures." | paper7 C1 |
| 49 | paper7 | Unify the figure encoding: dashed means "relayed" in `fig:vis` and "cut" in `fig:r6reg`, two adjacent figures teaching the same contract. Fix `fig:radius`'s unit collision ($1.2247$ labelled against an ordinate of $0.408$). | paper7 B2, B3, B4 |
| 50 | paper1 | Give §2 and §3 their analogies and relation-maps (the repertoire already assigns thermometer and smoke detector); §3 also needs a fade and an inline boundary. | paper1 A3, A4, C3–C6 |
| 51 | paper2 | Merge §2 and §3 (five definitions stated twice in sixty lines; "uncontrollable ≠ invisible" three times in thirty-two). ~20 lines recovered. | paper2 A6, A7 |
| 52 | paper2 | Move the Dastani admission from Related Work's closing sentence into the boundary box as item (vii); reorder so the boundary is the terminal content move. | paper2 A5, A12 |
| 53 | paper2 | Cut Figure 1's row 3 (spoils §6 190 lines early, duplicates Figure 2's right panel, forces the `\resizebox`/`[p]` hack). Build the controllability × observability 2×2 — it gives §9 and boundary items (iii)/(iv) their first picture. | paper2 B1, C1 |
| 54 | paper5 | Add the worked lineage DAG — "a paper whose central theorem is about fork/merge/cycle DAG shapes … currently draws zero DAGs," and the $8.2\times$ exhibit is quoted four times and never drawn. | paper5 C1 |
| 55 | paper5 | Rebuild `fig-r13-regime` Panel B's layout: the paper's headline result sits in a ~2cm-wide plot whose legend and half its annotations were deleted to stop collisions. Stacked full-width axes, direct line labels — not a sixth round of legend patching. Also `fig-r12-regime` plots two lines at identical coordinates. | paper5 B4, B3 |
| 56 | paper5 | Cut §1's decorative Parfit passage to one sentence, keep §7's checked disanalogy, and draw the four-row correspondence with its one broken arrow. | paper5 A6, C4 |
| 57 | paper6 | Move the queueing dictionary 110 lines down to §6 where it is first used; float/caption/label the inventory table the express lane points at. | paper6 A5, A6 |
| 58 | paper6 | Part I has no figure of its own. Add C1 (expressiveness→complexity strip), C2 (conflict kind × detector × cost × witness — currently one un-zippable run-on sentence inside the box), C3 (the witness drawn). | paper6 C1–C3 |
| 59 | legible-swarm | Tag the SLM Sidecar `\Vision`, add its Appendix A row, and standardise on **one** honesty-signalling mechanism (macros or inline notes, not both). | legible-swarm A1, A6 |
| 60 | legible-swarm | Add the missing Move-5 numbers to `eq:sdt` and `thm:lowerbound` — the second can be imported wholesale from paper1. | legible-swarm A3, A4, C1 |
| 61 | single-writer-kernel | Move §8.5's Compute-to-Data Airlock out — it is cross-operator content in a chapter whose abstract promises that material "lives" elsewhere. | SWK A9 |
| 62 | single-writer-kernel | Import paper2's bouncer analogy into `rem:controllability-scope`; add the missing `rw87`/`rw89` bibitems. | SWK A10, D |
| 63 | spawn-to-person | Rebuild `fig-stp-three-organs.tex` from the shared `stp box` styles — it is the one "lonely figure" in the set and labels the outcome ledger `[Core Implemented]` against its own caption's `\BUILTWEAK` two lines below. | s2p B4 |
| 64 | spawn-to-person | Fix the exercise/open-problem numbering drift (only 2 of 9 checkable instances match) — and note the OP-N namespace is shared with single-writer-kernel. | s2p A7 |
| 65 | harbor-economy | Fix Mechanism 9 as one coherent story: drop the orphan numbering, add the maturity tag and the `tab:honest-state` row, define $\rho$/$B$/$G$ (import from paper3), add a dramatization and a figure. | HE A1–A4, C3 |
| 66 | harbor-economy | Add the single worked settlement that closes across all three market sides at once — the chapter's own thesis, never shown worked. | HE C1 |
| 67 | harbor-economy | Define "grim-trigger" and $\delta$ before the exercise that tests them (zero prior occurrences in the body). | HE A7 |
| 68 | bonded-commons | Add the key-custody relation-map for the four-part Federated Security theorem — the chapter's densest claim, currently pure prose. | BC C1, A19 |
| 69 | bonded-commons | Add lead-in prose before §2's and §2.1's definition boxes (zero prose between header and formalism); soften the Conclusion's two restated "impossible" claims back to the body's own hedged versions. | BC A2, A3, A4 |
| 70 | federated-harbor | Fold §6.2 (2-of-3 Multisig Clearinghouse) into §6.1's hedged voice and delete the trailing §14 — two unintegrated inserts with a third status vocabulary and an unqualified production claim contradicting the Conclusion. Soften the escrow labels in all three figures. | FH A2, A3, A8, B1/B2/B4 |
| 71 | federated-harbor | Import paper7's $C_6$ worked example ($3/\sqrt6 = 1.2247$ on a cycle, $0$ on a bridge) — the sheaf section has zero hand-checkable numbers while citing exact harness figures. | FH A6, C3 |
| 72 | anchor-protocol | Add a trust-boundary band to `fig:anchor-alg-confusion` and reuse it — no figure in the compiled chapter marks a trust boundary, in a paper premised on a Dolev-Yao adversary. The convention already exists, unused, in `diag-magic-link.tex`. | AP B3, B15, C2 |
| 73 | anchor-protocol | Retitle the eight sections toward reader-facing questions; add a scene and a one-breath sentence. paper4 already demonstrates the register in the same series. | AP A1, A2, A3 |
| 74 | anchor-protocol | Expand the two thin Limitations bullets (PID binding, local transport) to the delegation-depth bullet's concreteness; clean up eight orphaned figure files, four of which belong to bonded-commons. | AP A7, B11–B16 |

---

## What worked well across the corpus

Reported so the edit pass does not damage it. Each was named independently by at least one reviewer as at or above the house bar.

- **spawn-to-person ↔ paper5 is the corpus's synchronization standard, and it should be enforced as one.** Live bidirectional citation (paper5 cites "whitepaper Def. III.6.1" by chapter-section-definition number), identical verification numbers on both sides (76,000 schedules, 0 dominating, the $8.2\times$ multiplier, the 4,000-DAG sweep), same script names, same seed `20260816`. Its reviewer: "Worth preserving as the standard the rest of the series should be held to." paper7 ↔ federated-harbor is a close second (four harness numbers matching exactly, including a cut-edge epsilon of $1.5\times10^{-13}$). The caveat from §C7 stands — sync does not survive a one-sided amendment — but the pattern is right and is reproducible.

- **The falsification-first discipline is doing visible, load-bearing work, and it is unusual.** paper1's "A wrong turn, reported" is called "the best 80 words in the corpus"; paper1 reports a *second* wrong turn (a formula evaluated outside its domain of validity) rather than deleting it, and keeps the spurious $8/14$ count in the same table as its results. paper6 prices two wrong turns in-line ($4.17$ vs $8.17$; $\tilde g$ falsified by the program's own sweep) and its reviewer notes "the correction, not the original, is what ships." paper3 reports a pre-saturation shortfall as pre-asymptotic rather than defending it. Three reviewers independently flagged this as the corpus's signature strength.

- **Honest-boundary sections are consistently the best-written material in the corpus.** paper4's §8 ("What cannot honestly be promised") — "the best-executed section in the paper and possibly in the corpus: seven boundaries at full prominence, each naming the *structural* reason rather than an engineering gap." paper6's eight-item boundary — "the best boundary section in the corpus." paper2's §9 on partial observation, which "does the hardest thing correctly: it states a *sharper* boundary than the paper's own result, gives the concrete failing policy, and refuses to claim the corollary." harbor-economy's impossibility scoping: 37 occurrences of impossible/cannot/never checked in context, "no unscoped sweeping claim was found." Whatever produced these should be the template for the sections that lack them.

- **Several figures are genuinely excellent and should be reused as house exemplars rather than touched.** `fig:pillars` (paper4) — "the pillars are links in one pipeline… the 'if absent' annotations are the non-redundancy argument rendered visually." `fig:r6rel` (paper7) — "the caption ends on the falsifiable half: 'The map predicts, correctly, where the mechanism dies.'" `fig:stack-map` and `fig:split-ranker` (legible-swarm) — "close to the platonic form of a Rail-B relation-map." `fig-swk-reference-monitor` and `fig-swk-durability-faultclass` — "the physical position of the monitor node relative to the dashed commit-line *is* the argument." `fig-stp-sybil-whitewash` — "could serve as the house style's canonical example of how to draw a relation-map." `fig-he-three-sided` and `fig-he-keystone-split` — the latter "puts the unbuilt piece spatially between two built pieces," making an absence visible. bonded-commons' three matplotlib figures (redundant colour + marker shape, serif font, findings-first captions).

- **The worked-dramatization device works, and the documents that use it are the ones readers will finish.** paper4's Derek and Erin; single-writer-kernel's Alice/Bob port race; spawn-to-person's S1–S4 device and the Heron/Mara/Bob graded-job scene ("the paper's best passage"); bonded-commons' §6.3 truthful-claim-signaling section, which carries a real payoff table, a hand-worked deviation ($1 - 2\cdot2.439 = -3.878$), a general critical-$\delta$ derivation *and* an explicit "what breaks when each condition is removed" paragraph — "the model other sections should be edited toward"; federated-harbor's §8 Acme/Beta worked example with its explicit "what did not happen" list. Every one of these was flagged by its reviewer as needing no changes.

- **The `[verified]` / `[internal, script, seed]` provenance convention, where it is applied consistently, is the thing that made this whole review possible.** paper6's reviewer: "it never once left me unable to tell which kind of number I was reading." The three places it slipped (paper1's `0/16`, paper3's two-script mismatch, paper7's undefined third tag) were each caught precisely *because* the convention is otherwise tight.
