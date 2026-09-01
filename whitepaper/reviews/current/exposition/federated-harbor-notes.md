# Exposition + Figure Review: The Federated Harbor

*The Federated Harbor: Identity, Coordination, and Settlement Across Administrative Domains* is Chapter VII of VII in the Port Daddy Coordination Papers, the shortest of the seven public-facing whitepapers (1,061 lines / ~13 sections + 3 appendices). It popularizes the cross-harbor extensions to the Anchor Protocol (Ch. V) and the Bonded Commons (Ch. VI): a four-message capability-transfer ceremony, a federated revocation/gossip mesh (including a sheaf-cohomology equivocation-detection argument), a conditionally-bounded settlement escrow, and a bonded-sponsor admission ceremony for new harbors. Structurally it is one of the strongest documents in the corpus — an explicit Reader's Map, a worked Alice/Bob/Acme/Beta narrative example, an honest five-item open-problems list, and a threat-band figure that is reused as the paper's own self-audit device. The review below is correspondingly focused: most of the highest-value findings are not "add more hedging" (the paper already over-delivers on honesty almost everywhere) but two clusters — (1) two sections whose register, vocabulary, and confidence level do not match the rest of the paper and read as unintegrated inserts, and (2) the absence of any hand-checkable numbers or a true regime diagram for the paper's central honesty claim (no partition bound). Part D's cross-reference audit against the formal sibling paper (`paper7.tex`, "The Cohomology of Equivocation") found the terminology match unusually tight — better than expected — with one specific, well-evidenced overclaim as the exception.

**Note on inputs (superseded — see update below):** at review time, `skills/research-paper-submission/references/figures-and-examples.md` did not exist in this checkout and only a `submission_lint.py` script was present under that skill. Figure/caption craft below is therefore assessed against Cleveland–McGill ranking, the worked-example effect, and Mensh–Kording caption norms as general literature, cross-checked with `harbor-exposition`'s Rail B and `high-quality-latex-whitepaper`'s seven cheap tells — not against that specific reference file. **Update 2026-08-27:** the skill landed fully vendored in a later commit (`a8b520948`) — `skills/research-paper-submission/references/figures-and-examples.md` and `skills/research-paper-submission/scripts/submission_lint.py` both now exist and are tracked; this caveat no longer applies, left here only as the record of what this review pass actually had available.

---

## Part A — Text/exposition changes

1. **Location:** `federated-harbor-whitepaper.tex:502` (end of §5.5, "Sheaf Laplacian Dynamics").
   **Issue:** Unhedged claim in a paper built on hedging discipline — this is the one sentence in the document that violates the paper's own stated rule ("We will not claim a result we do not have," line 265). No `\Partial`/`\Open` tag, no citation for the specific claim, and it does not appear in the Appendix A verification-status table (which lists the revocation-dissemination bound as resting on the classical epidemic model, not on spectral graph theory). Cross-checked against `paper7.tex`: Hansen–Ghrist is cited there only as *imported background* ("the sheaf Laplacian and its harmonic/spectral reading are Hansen–Ghrist," paper7:343) — paper7 never uses the spectral gap to bound gossip relaxation time. The claim has no support in either document.
   **Current text:** "The spectral gap $\lambda_2(\Delta_{\mathcal{F}})$ (the smallest non-zero eigenvalue of the sheaf Laplacian) governs the diffusion rate of anti-entropy gossip, establishing a rigorous bound on the relaxation time required for the federation to reach global consensus."
   **Proposed rewrite:** "The spectral gap $\lambda_2(\Delta_{\mathcal{F}})$ of the sheaf Laplacian is the natural quantity to relate to anti-entropy convergence speed — a small gap means slow mixing, by analogy with the graph-Laplacian case. We have not derived or checked a bound connecting $\lambda_2$ to the $\Theta(\log m)$ dissemination expectation of Property~\ref{thm:fh-conv}; the two convergence stories (classical epidemic gossip and sheaf-Laplacian diffusion) are not yet reconciled. This is open work, not a second proof of the same bound." — and add a row to Appendix A's status table: "Sheaf-Laplacian relaxation-time bound — Open — no construction or citation."
   **Priority:** High.

2. **Location:** `federated-harbor-whitepaper.tex:539–547` (§6.2, "The 2-of-3 Multisig Clearinghouse").
   **Issue:** Voice/content inconsistency — the entire subsection reads as pasted in from a different document. Evidence: (a) it uses notation found nowhere else in the paper (`$\text{Harbor}_A$` instead of the paper's own `$A$` / `$D_A$`); (b) it introduces three terms used nowhere else in the file — "Float Plan," "agentsd Federation Arbiter," "commercial chancery court" — none of which are defined, and none of which appear in `paper7.tex` either; (c) it asserts, in confident unhedged prose ("provides the legal and regulatory safety of..."), exactly the thing §6.1's Property~\ref{thm:fh-escrow-bound} states as *conditional* two paragraphs earlier, and exactly the thing §12.2 and Appendix A both list as fully **Open** ("Trustless settlement for non-fungible bonds — no construction or impossibility proof"). A reader going straight through would hit a settled-sounding "2-of-3 Multisig Clearinghouse" and then, four pages later, be told the same problem is unsolved.
   **Current text:** "To resolve the regulatory and security liabilities of centralized financial custody (such as Money Services Business / FinCEN registration and honeypot risk) while preserving subjective dispute arbitration, the federation synthesizes non-custodial cryptography with judicial oversight via the \textbf{2-of-3 Multisig Clearinghouse}: ... This architecture provides the legal and regulatory safety of decentralized, non-custodial settlement while retaining the subjective dispute-resolution authority of a commercial chancery court."
   **Proposed rewrite:** Fold this into §6.1 as one *candidate instantiation* of assumption (iv), in the section's existing hedged voice: "One concrete way to satisfy assumption (iv) is a 2-of-3 threshold-signature scheme: Alice's harbor, Bob's harbor, and a federation arbiter each hold one key, and any transfer needs two of the three signatures. When Alice and Bob agree on the outcome, they can clear the bond themselves without the arbiter; the arbiter's key exists only to break a dispute. This removes the escrow operator's unilateral ability to redirect funds — exactly what assumption (iv) requires — but it does not by itself close what Property~\ref{thm:fh-escrow-bound} calls conditional: the arbiter is still a trusted third opinion, and we have not analyzed an arbiter colluding with one principal. We list this as a candidate design, not a closed result (\S\ref{sec:fh-lim-trustless})." Delete the FinCEN/MSB/"chancery court" framing entirely — it is legal-marketing register, not this paper's register, and is not supported by any analysis in the document.
   **Priority:** High.

3. **Location:** `federated-harbor-whitepaper.tex:1047–1059` (trailing §14, "Limitations & Boundaries," placed *after* both appendices, immediately before `\end{document}`).
   **Issue:** Duplicate, unintegrated section. It restates content already covered — more precisely, and with proper status tags — by §12 ("Limitations and Open Questions") and Appendix A. It introduces a *third* status vocabulary (`\text{\textsc{implemented}}`, `\text{\textsc{partial}}`, `\text{\textsc{designed}}`) that matches neither the paper's own `\Closed`/`\Partial`/`\Open` commands nor Appendix A's table. It names components — "the logging daemon, the arbitrator," "decentralized judge markets," "SQLite single-writer," "POSIX primitives" — that appear nowhere else in this chapter (several belong to Bonded Commons or product docs, not the Federated Harbor). Most seriously, "the core protocols (Anchor, SQLite single-writer) are \text{\textsc{implemented}} and running in production" is an unqualified production claim that, taken at face value about *this paper's* subject, directly contradicts the Conclusion four pages earlier ("the Federated Harbor is closer to a research agenda than to a deployed product," line 828) and the paper's title framing. Its placement after the appendices is also structurally unusual — nothing else in the document sits there.
   **Current text:** (full section, lines 1051–1057) "The formal mechanisms presented in this chapter are mathematically sound within their defined scopes... While the core protocols (Anchor, SQLite single-writer) are \text{\textsc{implemented}} and running in production, surrounding ecosystem components (like the decentralized judge markets or fully federated multi-sig routing) remain in \text{\textsc{partial}} or \text{\textsc{designed}} phases."
   **Proposed rewrite:** Delete the section. If the WAL-checkpointing/performance-overhead point (the one sentence with genuinely new content) is worth keeping, fold it as a bullet into §12 using the paper's existing `\Closed`/`\Partial`/`\Open` vocabulary, e.g. add to §12: "\subsection{Performance overhead of per-write durability} Cryptographic assertions and per-write durability checkpoints (inherited from Anchor) add measurable I/O cost; this paper does not evaluate whether that cost is acceptable for high-frequency, non-high-stakes coordination. \Open." Remove the collusion-of-all-organs sentence, which duplicates the Dolev–Yao threat model already stated precisely in §3.
   **Priority:** High.

4. **Location:** `federated-harbor-whitepaper.tex:486–490` (opening of §5.4, "Sheaf Laplacian and Abramsky–Brandenburger Contextuality").
   **Issue:** Definitions First (named anti-pattern, `harbor-exposition`). The section opens directly with poset/presheaf/restriction-map formalism, with no scene, no one-breath sentence, and no structural analogy — a hard reset in register from the rest of the paper, which otherwise consistently leads with a concrete situation before formalizing (see §1's Alice/Bob demo, §8's worked example). This is exactly the section where the house style's own analogy repertoire already has the right entry: `style-template-v2.md` line 20 lists "watch-offsets around a loop → cocycle condition" as an approved base analogy for exactly this mechanism, and it is unused here.
   **Current text:** "The global consistency of federated witness logs can be modeled category-theoretically. Let $(X, \le)$ be the poset of administrative domains with morphisms given by scoped visibility. A presheaf $\mathcal{F}$ over $X$ assigns to each domain $U$ the semilattice of prefix-compatible append-only logs $\mathcal{F}(U)$, with restriction maps given by prefix projection."
   **Proposed rewrite:** Insert before the current opening: "Picture three harbors arranged in a ring, $A$, $B$, and $C$, each one gossiping only with its two neighbors. $A$ never talks directly to $C$. If $A$ tells $B$ one version of its epoch root and $C$ a different, contradictory one, no single comparison catches it — $B$ never checks against $C$'s copy, $C$ never checks against $A$'s. But if $B$ and $C$ eventually compare notes, the two stories fail to agree, the way a surveyor re-closing a loop of bearings discovers an error without knowing which single leg was wrong. \emph{A contradiction between two harbors becomes visible the moment some cycle of witnesses relays it, even when no single witness ever compared it directly} — that closing-the-loop check is what the cohomological machinery below formalizes." Follow this with the existing poset/presheaf paragraph, now motivated rather than cold.
   **Priority:** High.

5. **Location:** `federated-harbor-whitepaper.tex:490–496` (Theorem~\ref{thm:sheaf-equivocation}).
   **Issue:** The boxed Theorem states the generic textbook fact ($H^1(\mathcal{U};\mathcal{F})=0$ iff local sections glue) rather than the paper's actual, harness-verified result. The very next paragraph ("Scope") has to spend four sentences walking this back — "the detector is the observed disagreement cochain's failure to be a coboundary... not $\dim H^1$ of the abstract sheaf... which is blind to any particular lie." Per `paper7.tex`'s own Theorem 1 (paper7:187–200), the real, checked claim is sharper: detection beyond pairwise comparison holds *iff the missing edge lies on a cycle and its endpoints' reports are relayed*; on a cut edge the residual is exactly zero; on a severed edge equivocation is provably dark. Leading with the weaker generic statement and then disclaiming it is confusing pedagogically (over-claim, then retract), and it is also the less accurate of the two theorems available.
   **Current text:** boxed Theorem as quoted above (lines 490–496).
   **Proposed rewrite:** Replace the box with paper7's actual result, stated in the same style: "\begin{theorem}[Detection iff Cycle and Relay]\label{thm:sheaf-equivocation} Under the three-tier visibility model of \S\ref{sec:fh-sheaf-status} (compared / relayed / severed), the completion residual detects an equivocation beyond what pairwise comparison already catches if and only if the un-compared edge lies on a cycle whose endpoints' reports both reach the auditor. On a cut edge the residual is zero by construction — a tree's coboundary map is surjective onto the visible data, so any single lie there is absorbable. Across a severed edge, no evidence reaches the auditor and the lie is provably undetectable.\end{theorem}" Keep the $H^1=0$-iff-gluing fact as one motivating sentence in the analogy paragraph (item 4 above), not as the boxed claim.
   **Priority:** High.

6. **Location:** `federated-harbor-whitepaper.tex:498–500` (Scope paragraph, item (iii), and Status paragraph).
   **Issue:** Missing worked-example / Move-5 gap — the entire §5.4–5.5 is 100% prose and abstract claims with not one hand-checkable number, despite citing exact harness figures (200 trials, $1.5\times10^{-13}$ over 400 trials, seed 20260816). `paper7.tex` already has the ideal small worked example sitting right next to this material and unused: a $C_6$ ring with a lie of size 3 on the one un-compared cycle edge gives residual $3/\sqrt6 = 1.2247$ [verified]; the identical lie on a bridge (no cycle) gives residual $0$ exactly. This is exactly the kind of "numbers by hand, then fade" the house style requires and would make the whole section's claims checkable rather than asserted.
   **Current text:** none — no numeric example is given in this whitepaper's sheaf material.
   **Proposed rewrite (new paragraph, insert after the Status paragraph, before §5.5):** "\paragraph{Numbers by hand.} On a six-harbor ring, plant a lie of size 3 on the one link that is relayed but never directly compared: every pairwise check between neighbors still passes, but the residual left over after the best-fit global explanation is $3/\sqrt6 = 1.2247$ [verified] — not zero, so no consistent story exists. Move the identical lie onto a bridge (a link with no ring around it) and the residual drops to exactly $0$: the same-size lie is now invisible to this method, because there is no loop to force a contradiction. \emph{Now you try:} an eight-harbor ring, lie of size 2 on a relayed edge (answer: $2/\sqrt8 = 0.7071$)." Cite the source as `sheaf_mechanism_proof.py` per paper7's own provenance tagging.
   **Priority:** High.

7. **Location:** `federated-harbor-whitepaper.tex:484` (§5.3, cuckoo-filter paragraph, opening clause).
   **Issue:** Cold jargon opener with no scene — "resolving the bitwise merging impossibility of probabilistic structures" assumes the reader already knows why cuckoo filters can't be merged (unlike Bloom filters, which support bitwise-OR union). This is the one sentence in an otherwise plain-spoken paragraph that a non-specialist reader will bounce off.
   **Current text:** "By resolving the bitwise merging impossibility of probabilistic structures, the cuckoo filter is now purely a local, ephemeral read-path index derived from the authoritative Append-Only Event Log."
   **Proposed rewrite:** "Cuckoo filters, unlike Bloom filters, cannot be merged directly — you cannot bitwise-OR two cuckoo filters and get a filter that behaves like their union. That rules out using the filter itself as the thing two harbors reconcile against each other. Instead, the filter is demoted: it is a local, disposable read-time cache that each daemon rebuilds from the authoritative Append-Only Event Log, never the source of truth."
   **Priority:** Medium.

8. **Location:** Figures 1, 2, and 4 (`fig-fh-federation-topology.tex`, `fig-fh-xfer-ceremony.tex`, `fig-fh-settlement.tex`) and their surrounding prose — cross-referenced content issue, listed here because the fix is textual.
   **Issue:** All three figures label the settlement escrow "2-of-3 Multisig ... Non-Custodial: Can Refuse, Cannot Redirect" / "Authority Invariant: Neither harbor can bypass..." as settled fact. Figure 1 appears in §2, *before* §6 even introduces the escrow or its conditional Property. This compounds finding #2 above: even after §6.2 is fixed in prose, the figures need the same softening or the paper will still visually assert as closed what the text calls open.
   **Current text (fig-fh-settlement.tex guardbox):** "\textbf{\scshape Authority Invariant:}\\ Neither harbor can bypass recipient whitelist, fee cap, or atomic 2-of-3 multisig transition."
   **Proposed rewrite:** "\textbf{\scshape Custody Assumption (conditional):}\\ If the recipient whitelist, fee cap, and terminal-transition rule are non-bypassable (Property~\ref{thm:fh-escrow-bound}), neither harbor can redirect funds. This paper does not establish that condition for a deployed system." Apply the analogous softening to the escrow node labels in Figures 1 and 2 (see Part B items 1, 2, 4 for the exact node text to change).
   **Priority:** High.

9. **Location:** `federated-harbor-whitepaper.tex:451` vs. lines 349, 456–459, 666 (asymptotic-notation consistency).
   **Issue:** Minor but easy-to-fix inconsistency: the introductory sentence to §5.1 uses big-$O$ ("gives an expected $O(\Delta \log m)$ completion time"), while Property~\ref{thm:fh-conv}, the Threat Model, and the Worked Example all correctly use $\Theta$ for the same quantity. Since the paper is explicit elsewhere about being careful with asymptotic claims (declining to repeat the classical $1+\ln m$ constant, line 462), the stray $O$ reads as a typo rather than a deliberate looser bound.
   **Current text:** "Standard epidemic dissemination gives an expected $O(\Delta \log m)$ completion time only under an appropriate connected, reliable-round model."
   **Proposed rewrite:** "Standard epidemic dissemination gives an expected $\Theta(\Delta \log m)$ completion time only under an appropriate connected, reliable-round model."
   **Priority:** Low.

10. **Location:** `federated-harbor-whitepaper.tex:976` (bibliography) vs. entire document.
    **Issue:** Confirmed by the linter — `\bibitem{blanchet2016modeling}` (Blanchet's ProVerif foundations paper) is defined but never `\cite`d, despite ProVerif being used extensively (§4.5, §9.1, Appendix B). This is the kind of loose end a formal-methods reviewer (one of the paper's five named reader types) will notice immediately.
    **Current text:** n/a (missing citation).
    **Proposed rewrite:** Add the citation at first mention of ProVerif, e.g. in §9.1: "The formal substrate of this paper is two-layer: ProVerif models~\cite{blanchet2016modeling} for the cryptographic protocols..."
    **Priority:** Medium.

11. **Location:** `federated-harbor-whitepaper.tex:830` (second pull-quote, §12.6).
    **Issue:** Redundant pull-quote — it restates, almost verbatim, the prose sentence four lines above it ("The point of the paper is to draw the new boundary cleanly so the open problems are visible," line 828). Compare to the first pull-quote (line 237), which adds a genuinely new, punchier formulation of the surrounding idea rather than repeating it. A pull-quote that just echoes its neighboring sentence reads as padding rather than emphasis.
    **Current text:** "\pullquote{The point of the paper is to draw the new boundary cleanly so that the unsolved problems are visible rather than hidden.}"
    **Proposed rewrite:** "\pullquote{Five named open questions is not an admission of failure. It is what an honest boundary looks like when a real one is being drawn.}"
    **Priority:** Low.

12. **Location:** `federated-harbor-whitepaper.tex:373` (§3.3) vs. §12 (Limitations).
    **Issue:** Small promise/delivery gap: §3.3 says "We will refer back to this figure when discussing limitations," but the explicit back-reference to Figure~\ref{fig:fh-threat-bands} actually lands in the Conclusion (line 838), not in §12 itself. A reader following the promise into §12 won't find the pointer there.
    **Current text (§12 opening, line 797):** "We close with the honest open frontier. These are not throwaway caveats..."
    **Proposed rewrite:** "We close with the honest open frontier — the cobalt band of Figure~\ref{fig:fh-threat-bands}. These are not throwaway caveats..."
    **Priority:** Low.

13. **Location:** `federated-harbor-whitepaper.tex:553–561` (Property~\ref{prop:fh-cross-cons}, "Cross-Harbor Bucket Partition").
    **Issue:** Four new symbols ($P_b, E_b, C_b, R_b$) are introduced inside the box itself with no numeric anchor anywhere nearby — acceptable for the box (self-containment is mandatory there), but the surrounding prose never grounds it with even one concrete instance, unlike most of the paper's other formal claims.
    **Current text:** (Property as stated, no accompanying example).
    **Proposed rewrite (add after the Property):** "For a single \$100 bond: at post time $P_b=100,\,E_b=C_b=R_b=0$; once locked in escrow, $E_b=100$ and the rest are zero; once cleared, $C_b=100$. At every step exactly one bucket is nonzero and the total is always \$100 — that arithmetic, repeated per bond, is the whole content of Property~\ref{prop:fh-cross-cons}."
    **Priority:** Medium.

14. **Location:** `federated-harbor-whitepaper.tex:220–239` (§1, Introduction) — noted as a strength, not a defect.
    **Issue:** None — flagging as a positive control. The three-failure list (card rejected / revocation doesn't cross the boundary / bond can't route to the damage) is concrete, jargon-free, and exactly matches Move 1's "could a smart engineer outside the field nod along?" test. No change needed.
    **Priority:** n/a (strength).

15. **Location:** `federated-harbor-whitepaper.tex:281–290` (Definition~\ref{def:fh-sovereignty}, "Harbor Sovereignty") — noted as a strength.
    **Issue:** None. The five-property characterization (issuance / attenuation / revocation / acceptance / evidence-binding) is precise, self-contained, and explicitly checked against later in the paper ("we will use Definition~\ref{def:fh-sovereignty} as the discipline against which subsequent protocols are checked," line 294) — a genuinely good instance of Move 4's "quotable without edits" bar.
    **Priority:** n/a (strength).

16. **Location:** §8 (Worked Example, lines 614–681) — noted as a strength.
    **Issue:** None. This is the best-executed section in the paper relative to house style: concrete scene (Acme/Beta, three machines, a real destructive migration), each of the four primitives shown doing exactly one job, and an explicit "what did not happen" list (lines 672–679) that doubles as an implicit boundary/misread-preempt. The only gap (see item 6, and Part C item 2) is that it never runs actual numbers through Property~\ref{thm:fh-conv} even though it is the natural place to do so.
    **Priority:** n/a (strength, with one adjacent gap already covered).

17. **Location:** `federated-harbor-whitepaper.tex:343–369` (§3.1–3.2, in-scope / out-of-scope attack list) — noted as a strength.
    **Issue:** None. The "attack → closed-by → reduces-to" pattern is consistently applied across all seven in-scope attacks and is one of the clearest instances of Move 4 self-containment in the document; the out-of-scope list is equally disciplined. No changes recommended.
    **Priority:** n/a (strength).

18. **Location:** `federated-harbor-whitepaper.tex:296–304` (Definition~\ref{def:fh-interscope}, "Inter-Harbor Scope").
    **Issue:** Minor — the definition is introduced immediately after Harbor Sovereignty with no transitional sentence explaining *why* the reader needs a second, dual definition right here (the "why" only becomes clear two sentences later). A one-clause bridge would help the "definitions earn their keep through use" principle land more smoothly.
    **Current text:** "The dual notion is also essential. \emph{Inter-harbor scope} is the scope of operations whose effects cross the trust boundary between sovereign harbors."
    **Proposed rewrite:** "Sovereignty says what each harbor controls on its own side. The complementary question — which operations *reach across* that boundary at all — needs its own name, because every protocol in the rest of this paper lives exactly there. \emph{Inter-harbor scope} is the scope of operations whose effects cross the trust boundary between sovereign harbors."
    **Priority:** Low.

---

## Part B — Existing figures/tables: clarity audit

For all figures below, `figures-and-examples.md` (Cleveland–McGill / Mensh–Kording specifics) was unavailable in this checkout; assessment uses the ranking and caption norms from general knowledge plus `high-quality-latex-whitepaper`'s seven cheap tells.

### 1. `figures/fig-fh-federation-topology.tex` — Figure 1, `\label{fig:fh-topology}`, referenced §2 line 275

**What it currently shows:** The "four-element gestalt" — two sovereign harbors ($A$, $B$) side by side, a witness log above receiving published epoch roots from both, and a "2-of-3 Multisig Settlement Escrow" below connected to both via bond/damage arrows; a solid cobalt arrow for capability transfer and a dashed arrow for revocation gossip between the harbors.

**What the reader should take away:** Neither harbor is a root of authority for the other; the witness log and escrow are the two shared elements that make federation possible without either harbor controlling the other.

**Will they get it?**
- *Cleveland–McGill:* Position + explicit connection (arrows) is a high-accuracy encoding choice — good.
- *Greyscale survival:* Passes. Gossip (dashed, muted ink) is distinguished from transfer/bond flows (solid, cobalt) by dash pattern and line weight, not color alone.
- *Caption states the finding:* Yes, well — it explains *why* the witness log and escrow matter, not just what they're labeled.
- *Seven cheap tells:* Clean — body serif throughout, one accent (cobalt) reserved for the essential arrows and the escrow border, muted single fill (`hhsand!25`/`hhpaper`), no labels riding on lines.
- *Content accuracy (not a craft issue, a correctness issue):* The escrow node's own label — "2-of-3 Multisig Settlement Escrow" / "Non-Custodial: Can Refuse, Cannot Redirect" — asserts as fact, in the paper's very first figure, exactly what §6.1 four sections later calls conditional and unresolved. See Part A item 8.

**Verdict:** Excellent craft; content overclaims relative to the prose.
**Concrete fix:** Change the escrow node text to "Settlement Escrow \\ {\footnotesize Custody bounded only if Property~\ref{thm:fh-escrow-bound}'s assumptions hold}" and soften the caption clause "structurally bounded (non-custodial 2-of-3 multisig: it cannot redirect funds...)" to "structurally bounded *conditional on* a non-bypassable custody mechanism (\S\ref{sec:fh-escrow}); one candidate is 2-of-3 multisig."

### 2. `figures/fig-fh-xfer-ceremony.tex` — Figure 2, `\label{fig:fh-xfer}`, referenced §4 line 383

**What it currently shows:** A four-lane sequence diagram (Alice's agent → Harbor $A$ → Harbor $B$ → Bob's agent) with the four numbered messages, plus two callout boxes ("Invariants Foreclosed" / "Deferred Properties") underneath.

**What the reader should take away:** After message 3, no further round-trip to Harbor $A$ is needed; the epoch-root binding is what lets a later revocation at $A$ eventually invalidate the transferred card at $B$.

**Will they get it?**
- *Cleveland–McGill:* Sequence diagrams are near-optimal for this content (position along a shared timeline + explicit ordered arrows).
- *Greyscale survival:* Trivially passes — one message color throughout, no categorical color coding needed.
- *Caption states the finding:* Yes — the best caption in the set; it explicitly explains *why* the hot path is non-synchronous and *why* the epoch root matters, not just what happened.
- *Seven cheap tells:* Clean.
- *Minor content note:* The "Deferred Properties" box lists "2-of-3 non-custodial settlement" using the same premature-certainty phrasing flagged in Figure 1.

**Verdict:** Best-executed figure in the paper.
**Concrete fix:** Change the deferred-properties bullet to "Conditional custody settlement (\S\ref{sec:fh-settlement})" — otherwise ship as-is.

### 3. `figures/fig-fh-revocation-gossip.tex` — Figure 3, `\label{fig:fh-revocation}`, referenced §5 line 447

**What it currently shows:** Three harbors ($A$, $B$, $C$) at three epochs ($t=0, \Delta, 2\Delta$), each with a filter node showing revoked/stale/synchronized state, gossip hops $A\to B\to C$, and per-epoch publication arrows to a shared witness log; a text box at the bottom states the epidemic-convergence invariant.

**What the reader should take away:** Revocation spreads epoch by epoch through gossip and reaches full convergence (all three harbors synchronized) by $t=2\Delta$.

**Will they get it?**
- *Cleveland–McGill:* Grid/position encoding is clear and this is genuinely the most "numbers by hand"-like visual in the paper (a small, concrete, countable case).
- *Greyscale survival:* Passes — state is doubly coded by fill *and* text label ("Stale"/"Synchronized"/"Revoked").
- *Caption:* States what it shows, mostly by naming parts, less by stating the take-away number (e.g., it never says "converges in 2 hops for m=3").
- *Seven cheap tells:* Clean — one accent, consistent serif, consistent scale with Figures 1–2 and 4.
- **Gap:** This is the only place in the paper that visualizes Property~\ref{thm:fh-conv}, and it shows *only* the connected happy path. It never draws the partition case that the Property's own item 3, Corollary~\ref{cor:fh-window}, and the Threat Model all call the essential caveat ("no finite worst-case bound survives an unbounded partition"). Because the Reader's Map explicitly tells beginners to "look at the five figures in order... skip the proofs on the first pass," a figures-only reader can walk away believing gossip always converges in $2\Delta$ — the opposite of the paper's central honesty claim about this primitive.

**Verdict:** Well-crafted but incomplete relative to the claim it illustrates — the single largest figure gap in the paper.
**Concrete fix:** Either add a fourth "Epoch $t=\infty$, partitioned" column showing Harbor $C$ never receiving the gossip hop (broken/dashed arrow with an explicit "×"), or — the stronger fix — build the regime diagram proposed in Part C item 1 as an explicit companion to this figure, and cross-reference it from this caption.

### 4. `figures/fig-fh-settlement.tex` — Figure 4, `\label{fig:fh-settlement}`, referenced §6 line 516

**What it currently shows:** Three parties (Alice, "2-of-3 Multisig Escrow," Bob) at top; three numbered steps below (bond posting, damage claim, oracle verification), echoing the prose's own numbered list; two outcome boxes (Clear/Refuse) at the bottom; a guardbox labeled "Authority Invariant."

**What the reader should take away:** The settlement outcome space is exactly two terminal states, and the escrow cannot produce any third outcome.

**Will they get it?**
- *Cleveland–McGill / redundant coding:* Good — the figure's step numbering matches the prose's numbered steps 1–3 exactly, a genuinely helpful redundancy rather than a mismatch.
- *Greyscale survival:* Passes.
- *Caption states the finding:* Yes.
- *Seven cheap tells:* Clean.
- **Content accuracy:** This is the most overclaiming of the three escrow-related figures — the box literally titled "Authority Invariant" states as settled fact ("Neither harbor can bypass...") what §6.1's Property explicitly conditions on four unverified assumptions (i)–(iv), and which the prose calls "a design and bounded model, not a deployed custody mechanism." Calling it an "Invariant" in a figure is stronger language than the paper uses anywhere in its own text for this claim.

**Verdict:** Well-crafted, most in need of the wording fix among the three escrow figures.
**Concrete fix:** See Part A item 8's proposed rewrite for this exact box.

### 5. `figures/fig-fh-threat-bands.tex` — Figure 5, `\label{fig:fh-threat-bands}`, referenced §3.3 line 375, and again in the Conclusion as "the most concentrated summary of where each claim lives"

**What it currently shows:** Three side-by-side category bands — Stopped/mechanized (teal), Bounded/named-threat (amber), Open/acknowledged (cobalt) — each with a bulleted claim list, connected left-to-right by arrows.

**What the reader should take away:** Every claim in the paper lives in exactly one of three honesty tiers, and the paper is disciplined about which.

**Will they get it?**
- *Cleveland–McGill / redundant coding:* Good — position (left-right) + fill color + header text all agree, which is genuinely accessible even with heavier color use than the house style otherwise wants.
- *Greyscale survival:* Passes via header text and left-right ordering, not hue alone.
- *Caption:* Strong — explicitly states the reading direction and what shifts over time.
- **Seven cheap tells — two real defects, one is the worst in the paper:**
  1. **Sans-serif in a serif figure (cheap tell #2).** Lines 16, 19, 23 set `font=\sffamily\small` / `\sffamily\bfseries\small` / `\sffamily\footnotesize` for the entire diagram. This is the *only* one of the five whitepaper figures that does this — Figures 1–4 all correctly inherit the body serif. It is exactly the "#1 'a script assembled this' signal" the visual-craft skill names, and it is on the paper's single most consequential, most-referenced figure.
  2. **Three-hue status coding (cheap tell #3, "a rainbow status key").** The house style is explicit: "Status labels: muted ink/gray, differentiated by weight or small-caps, not by hue." This figure uses three separate fill hues (teal/amber/cobalt at two intensities each) as the *primary* coding channel for a three-way status — which is precisely what the prose's own `\Closed`/`\Partial`/`\Open` commands deliberately avoid (they encode status by weight and italic/small-caps, in ink and gray only). This is a real, named tension within the document's own conventions, though it is clearly a *documented, cross-paper convention* (§3.3's prose explicitly narrates "teal... amber... cobalt," and the Appendix A caption also names the cobalt band) rather than a one-off mistake — flagging it here as a defect against the stated house rule, while noting it may be an intentional, established exception carried over from the Anchor/Bonded chapters.

**Verdict:** Most important figure in the paper for its honesty function; also has the paper's most concrete, one-line-fix visual defect.
**Concrete fix:** Remove `\sffamily` from all three `font=` declarations (lines 16, 19, 23) so the figure inherits the body serif like its four siblings — a mechanical, unambiguous fix. On the color question, either (a) keep the three-hue convention but document it explicitly as a deliberate program-wide exception to the one-accent rule (in `high-quality-latex-whitepaper` or a house-style note), or (b) reduce to ink/gray + weight for the bands and reserve the single accent (cobalt) for only the "Open" band, the one status that most needs the reader's eye.

---

## Part C — New figures/examples proposed

1. **Where:** New figure after §5.1 (Property~\ref{thm:fh-conv}), as a companion to Figure 3.
   **What it would show:** A true regime diagram — axes = partition duration $T_p$ (x) vs. bond service-level window $T_g$ (y) — shaded region where the paper's $\Theta(\log m)$ expectation applies (connected overlay, $T_p \to 0$) fading to an unshaded/hatched region where exposure is structurally unbounded (per Corollary~\ref{cor:fh-window}, $T_p+T_g$). Mark a worked point (e.g., $m=8$, expected $\approx 3$ rounds) on the shaded region.
   **Why it helps:** This is exactly the Rail-B-mandated regime diagram for the paper's central honest-boundary claim about revocation, and the paper currently has zero true two-axis regime diagrams (the threat-bands figure is categorical, not parametric). It also directly fixes Part B item 3's gap — the happy-path-only gossip figure would finally have its boundary made visible, not just asserted in prose.
   **Kind:** regime-diagram.

2. **Where:** New short paragraph in §5.1, immediately after Property~\ref{thm:fh-conv}, or folded into §8.4 (Worked Example, Step 4: Revocation propagation).
   **What it would show:** A one-line hand-checkable computation: for $m=8$ harbors, expected dissemination $\approx \log_2(8) = 3$ rounds; then a "now you try" for $m=32$ (answer: $\approx 5$ rounds).
   **Why it helps:** Currently the paper's single most-repeated asymptotic claim ($\Theta(\log m)$, referenced at lines 256, 349, 456, 468, 666, 733) never gets a concrete number attached to it anywhere in the document — the Worked Example specifically declines to compute one (line 666: "dissemination completes in expected $\Theta(\Delta\log m)$ time" with no number given even though the example has already fixed a concrete cast of harbors). This is the paper's clearest Move-5 gap.
   **Kind:** worked-numeric-example.

3. **Where:** New subsection at the end of §5.4 ("A Minimal Worked Example"), immediately after the Status paragraph and before §5.5.
   **What it would show:** The exact minimal pair from `paper7.tex`'s own Theorem 1 verification (paper7:195–207), translated to plain language: a six-harbor ring, a planted lie of "size 3" on the one relayed-but-never-directly-compared link — every pairwise check between neighboring harbors still passes, but the leftover discrepancy after fitting the best consistent global story is $3/\sqrt6 = 1.2247$ [verified], which cannot be explained away, so the auditor can prove *something* is wrong on that loop even though no single harbor caught it directly. Contrast panel: move the identical lie to a bridge edge (no ring around it) — the residual is exactly $0$, i.e., invisible to this method, illustrating the Scope paragraph's own claim that "across a cut edge the method provably sees nothing."
   **Why it helps:** This is the single figure/example this whitepaper is missing most, given the task's framing — the sheaf-cohomology section is presently 100% abstract prose plus a boxed theorem, with real, hand-checkable, already-published numbers ($3/\sqrt6$, seed 20260816, cut-edge residual $1.5\times10^{-13}$) cited by figure only, never shown as an example a reader could redo. It would make this whitepaper and `paper7.tex` genuinely legible as a matched pair — a non-specialist reading the whitepaper's version would be equipped to recognize the identical example if they later opened paper7 itself.
   **Kind:** worked-numeric-example (directly consistent with, and reusing the numbers from, `paper7.tex`).

4. **Where:** New relation-map figure in §2 (Federated Authority), alongside or replacing part of Figure 1.
   **What it would show:** A base-structure/target-structure/arrows relation-map in the harbor-exposition Rail-B grammar — base: "single daemon as correlation device" (Bonded Commons, one machine); target: "witness log as correlation device" (Federated Harbor, many machines); arrows labeled with the actual mapped relations (e.g., "turns mutually-suspicious agents into a correlated equilibrium" :: "turns mutually-suspicious harbors into an auditable mesh"; "sovereign over one machine's issuance/attenuation/revocation" :: "sovereign over one harbor's issuance/attenuation/revocation").
   **Why it helps:** This is the paper's actual central structural analogy — it is stated explicitly in prose at the top of §2 ("the daemon is the unique correlation device... We now drop it") and again in the Contributions — but it is never drawn. Per Move 3's own test ("if you cannot draw the arrows, the analogy is surface-level"), drawing it would either strengthen the paper's best analogy or expose where it stops holding (which the paper is honest about anyway in §12.1's open multi-principal-equilibrium question).
   **Kind:** relation-map.

5. **Where:** New small table, either at the end of §5.5 or as a short addition to Appendix A.
   **What it would show:** A two-column notation crosswalk between this whitepaper's vocabulary and `paper7.tex`'s formal vocabulary: witness log ↔ site/cover; epoch root $R_X^{(e)}$ ↔ local section/stalk value; cross-witness signature comparison ↔ compared / relayed / severed visibility tiers; "auditor detects a contradiction once co-located" ↔ completion residual $r>0$.
   **Why it helps:** Part D below finds the correspondence between the two documents unusually tight already — this table would make that correspondence explicit and checkable for a reader who wants to move between the popularization and the formal paper, which is exactly what a companion-volume pairing should offer and currently leaves implicit.
   **Kind:** table.

---

## Part D — Cross-reference notes (vs. `whitepaper/research/tex/paper7.tex`)

This is the tightest whitepaper/paper pairing checked in the series so far, and the terminology match is better than the brief's framing anticipated — most of what follows is confirmation, not drift, with one clear exception (already covered as Part A item 1).

**Confirmed matches (verbatim or near-verbatim), all correct:**
- Three-tier visibility model — "compared / relayed / severed" (whitepaper:499–500) matches paper7:150–153 exactly, including the specific claim that cohomology "earns its keep" only on the relayed tier.
- "Completion residual" as the detector's name — matches paper7's `sec:model` term of art exactly (paper7:157–166).
- Cycle-vs-cut-vs-severed behavior — whitepaper's "the method provably sees nothing" (across a cut) and "equivocation is provably dark" (across a severed edge) are near-verbatim matches of paper7's Theorem 1 language ("across a severed edge, equivocation is provably dark," paper7:192).
- Numeric harness provenance — seed `20260816`, 200 trials per arm, cut-edge maximum residual $1.5\times10^{-13}$ over 400 trials, verdict COMMIT: all four numbers match paper7's harness section (paper7:212, 235, 241–243) exactly. `sheaf_harness_v2.py` as the script name also matches.
- D1/D2 mutant descriptions — the whitepaper's plain-language glosses ("D1, non-subset restriction maps that collapse the obstruction space"; "D2, detection scored on hidden-edge data") are accurate simplifications of paper7's technical descriptions (random-orthonormal-projection restriction maps that collapse $\operatorname{coker}(\delta)$; scoring detections using hidden-edge data the analyst wasn't entitled to). No drift.
- Abramsky–Brandenburger contextuality framing, Hansen–Ghrist sheaf-Laplacian citation, and the Carù "abelianization gap" boundary claim — all three citations and their claims match paper7's own Related Work section (paper7:340–349) precisely.

**Drift found:**
1. **The boxed Theorem itself (already Part A item 5).** The whitepaper's Theorem~\ref{thm:sheaf-equivocation} states the generic $H^1=0 \iff$ gluing fact rather than paper7's actual, harness-verified Theorem 1 (detection iff cycle-and-relayed). The whitepaper's own Scope paragraph has to spend four sentences correcting the reader's likely misreading of its own boxed theorem. Recommend swapping in paper7's real theorem statement directly (see Part A item 5's proposed rewrite).
2. **Unsupported rigor claim (Part A item 1, most severe finding overall).** §5.5's closing sentence claims the sheaf-Laplacian spectral gap "governs the diffusion rate of anti-entropy gossip, establishing a rigorous bound on the relaxation time required for the federation to reach global consensus." Paper7 cites Hansen–Ghrist only as imported background for the Laplacian's harmonic/spectral reading (paper7:343) and never connects it to a gossip-convergence bound; the whitepaper's actual gossip-convergence claim (Property~\ref{thm:fh-conv}) is proven via the classical Demers et al. epidemic-algorithm citation instead, a different and unrelated argument. No such spectral-gap-to-relaxation-time bound exists in either document. This is the one place in the whitepaper where the pairing with paper7 actively fails to support a claim the whitepaper makes.
3. **Word-choice softening.** The whitepaper's "cohomology triages under partial visibility" (line 498) replaces paper7's specific term of art "cohomology localizes" (paper7:354, in explicit contrast with "signatures attribute"). Paper7 uses "localizes" precisely — it means "identifies which cycle," not the vaguer "prioritizes among many things," which "triages" suggests. Recommend swapping to "localizes" for exact cross-document terminology consistency, since a reader moving from the whitepaper into paper7 would otherwise wonder whether "triage" names a weaker or different claim than "localize."
4. **No drift found on the actual detection mechanism, the honest-boundary claims, or the harness numbers** — these are the parts that matter most for the pairing's credibility, and they hold up under close checking.

---

## Summary

1. **Highest-priority fix:** §5.5's closing sentence claims the sheaf-Laplacian spectral gap gives "a rigorous bound" on gossip relaxation time — unhedged, uncited, absent from Appendix A's status table, and unsupported by `paper7.tex` itself. This is the one sentence in the whole document that breaks the paper's own "we will not claim a result we do not have" discipline. Cut or hedge it (Part A #1, Part D #2).
2. **Two sections read as unintegrated inserts** and should be fixed or removed: §6.2 "The 2-of-3 Multisig Clearinghouse" (undefined terms — Float Plan, agentsd, chancery court — off-notation, and a confidence level contradicting §6.1/§12/Appendix A four pages later) and the trailing §14 "Limitations & Boundaries" after the appendices (a third, inconsistent status vocabulary, duplicate of §12, and an unqualified production claim). Both should be folded into their proper, already-hedged sections or deleted (Part A #2, #3).
3. **The three escrow-related figures overclaim the settlement mechanism** — all three label the escrow "2-of-3 Multisig ... Non-Custodial" / "Authority Invariant" as settled fact, while the prose consistently (and correctly) calls this conditional and open. Fix the node/caption text in all three (Part A #8, Part B #1/#2/#4).
4. **`fig-fh-threat-bands.tex` uses `\sffamily`** — the only one of five figures with a sans-serif/serif-body clash, on the paper's single most consequential figure. One-line, unambiguous fix (Part B #5).
5. **The paper's cross-reference with `paper7.tex` is genuinely excellent** — three-tier visibility, completion residual, cycle/cut/severed behavior, and every harness number (seed, trial counts, cut-edge epsilon) match exactly. The one boxed Theorem statement should be swapped for paper7's actual, sharper result rather than the generic textbook fact it currently states (Part A #5, Part D #1).
6. **The sheaf-cohomology section has zero hand-checkable numbers** despite citing exact figures by reference — and paper7 already has the ideal minimal worked example ($C_6$ ring, lie of size 3, residual $3/\sqrt6=1.2247$) sitting unused next door. Import it (Part A #6, Part C #3).
7. **Structural strengths worth preserving as-is:** the Reader's Map, the Harbor Sovereignty definition, the threat-model attack list, and the Worked Example (§8) are all genuinely well-executed instances of the house style and should not be touched beyond the small numeric addition noted above.
