# Exposition + Figure Review: The Bonded Commons

`whitepaper/source/agent-transactions-whitepaper.tex` is Chapter VI of VII in the Port Daddy Coordination Papers — the public-facing "whitepaper" popularization of the Bonded Commons trust architecture (capability attenuation, Merkle-chained evidence, and collateralized work contracts), co-authored with Thomas Youle for the competitive-insurance mechanism. It runs 1,708 lines / roughly 50 minutes of stated reading time, carries ten TikZ/PDF figures and five tables, a full TLA⁺ model, an appendix worked example, and nine instructor exercises. Unlike the other six whitepapers in the series, it does **not** have a clean 1:1 counterpart among the seven formal papers in `whitepaper/research/tex/` — Part D below confirms this rather than assuming it, and the absence turns out to be a real finding, not a formality: this chapter's game-theoretic core (correlated equilibrium, Sen's warning, claim-signaling incentive-compatibility, the competitive-insurance auction, the cartel folk-theorem) appears to exist *only* at the whitepaper level, with no formal-paper source to point a reader toward.

## Part A — Text/exposition changes

1. **Location**: Abstract, lines 182–183.
   **Issue**: Definitions-first / audience mismatch. The abstract opens with a proper Move-1 scene ("Two autonomous agents working on the same project corrupt each other's state...") but pivots into full formalism (`candidate correlating device`, `obedience inequalities`) within two sentences, with no plain-English gloss.
   **Current text**: *"We model a daemon as a \emph{candidate correlating device} in the sense of Aumann~\cite{aumann1974subjectivity}: it can send private recommendations to agents, but those recommendations constitute a correlated equilibrium only when the explicit obedience inequalities in \S\ref{sec:correlating-device} hold."*
   **Proposed rewrite**: *"We model the daemon the way game theory models a referee who never forces anyone's hand: it whispers a private recommendation to each agent --- \emph{you go, you wait} --- and Aumann's theory of \emph{correlated equilibrium}~\cite{aumann1974subjectivity} tells us exactly when agents have no reason to ignore it (the obedience inequalities of \S\ref{sec:correlating-device})."*
   **Priority**: high.

2. **Location**: §2, lines 302–306 (`\section{The Commons Authority}` immediately followed by `\begin{definition}[Commons Authority]`).
   **Issue**: Definitions First — the clearest instance in the document. There is zero prose between the section header and the formal definition box; a reader arrives at "A commons authority $\mathcal{D}$ for a multi-agent system is a persistent service that provides..." with no scene, no motivation, nothing bridging from §1's narrative close.
   **Current text**: *"\section{The Commons Authority}\label{sec:commons}" [followed directly by] "\begin{definition}[Commons Authority]\label{def:commons} A commons authority $\mathcal{D}$ for a multi-agent system is a persistent service that provides: ..."*
   **Proposed rewrite**: Insert before the definition box: *"Before any interaction happens, the commons needs a referee whose job is settled in advance --- not improvised transaction by transaction. We call that referee the \emph{commons authority}: a single always-on service that every agent already trusts, precisely because it was there before any of them showed up."*
   **Priority**: high.

3. **Location**: §2.1 "The Daemon as Correlating Device," lines 323–333.
   **Issue**: Definitions First again, at the section's most consequential formal move. The section drops straight into Aumann's obedience-inequality summation with no intuitive picture of what a "correlating device" does before the reader is asked to parse $\sum_{r_{-i}} \mu(r_i,r_{-i})[\ldots]$.
   **Current text**: *"The daemon's role admits a precise game-theoretic test. Aumann~\cite{aumann1974subjectivity} introduced the \emph{correlated equilibrium}: a mediator draws a recommendation tuple $r=(r_1,\ldots,r_n)$ from a joint distribution $\mu$ over action profiles and privately reveals $r_i$ to player $i$. [equation follows immediately]"*
   **Proposed rewrite**: Insert one paragraph before the equation: *"Picture a good crossing guard rather than a traffic light. A traffic light gives everyone the same instruction regardless of what's actually happening; a crossing guard watches the specific cars and pedestrians and privately waves each one through or holds it back. The daemon plays crossing guard, not traffic light: it sees the whole intersection (the claim graph) and issues one private recommendation per agent. Aumann's test for whether such private recommendations actually help, rather than being safely ignored, is the obedience condition below."*
   **Priority**: high.

4. **Location**: Conclusion, lines 1230–1231, versus Theorem 3.1's own proof at lines 396–398 and the exfiltration gap at lines 869–874 / same-user-adversary exclusion at line 1339.
   **Issue**: Boundary Burial. The conclusion restates two claims at full strength — exactly the section a skimming reader is most likely to read in isolation — after the body has already, carefully, hedged both of them.
   **Current text**: *"\textbf{Structural prevention}: Capability-attenuated tokens make scope escalation physically impossible. [...] \textbf{Immutable attribution}: A Merkle forest of evidence trails (\S\ref{sec:merkle-forest}) makes anonymous harm impossible \emph{across daemons}, not just within one."*
   **Proposed rewrite**: *"\textbf{Structural prevention}: for any operation routed through the verifier, capability-attenuated tokens make scope escalation physically impossible (Theorem~\ref{thm:scope}) --- the guarantee holds once the Anchor model's own assumptions and the runtime's interception coverage are granted. [...] \textbf{Immutable attribution}: a Merkle forest of evidence trails (\S\ref{sec:merkle-forest}) makes anonymous harm impossible \emph{across daemons for damage to shared state}; it says nothing about disclosure to outsiders (\S\ref{sec:pricing:threats}) or a same-user adversary (\S\ref{sec:federated-sovereign})."*
   **Priority**: high.

5. **Location**: Table `tab:consent`, line 353.
   **Issue**: Caption under 8 words (flagged by the linter); names the table instead of stating its finding, violating Mensh-Kording caption discipline.
   **Current text**: *"\caption{With and Without the Commons Authority}"*
   **Proposed rewrite**: *"\caption{The commons authority converts six failure modes from ad hoc and manual to deterministic and automatic --- without forbidding anything an agent could already do.}"*
   **Priority**: medium.

6. **Location**: Table `tab:moral`, line 646.
   **Issue**: Same anti-pattern — caption names the table, not the finding.
   **Current text**: *"\caption{Moral Hierarchy of Agent Harm}"*
   **Proposed rewrite**: *"\caption{The only catastrophic event in this hierarchy is the loss of information, not the loss of an agent --- severity climbs from a crash (none) to a daemon failure (catastrophic), with dismissal-from-salvage as the one irreversible step an agent can cause alone.}"*
   **Priority**: medium.

7. **Location**: Lines 712 and 715 (pull-quote immediately followed by a near-identical sentence).
   **Issue**: The pull-quote is supposed to distill or preview an insight; here it is restated almost verbatim three lines later, which reads as padding rather than emphasis.
   **Current text**: Pull-quote (712): *"The Sybil attack is priced: 100 disposable identities means 100 bonds."* Body (715): *"One-shot defectors must post collateral \emph{before} receiving capabilities. The Sybil attack is priced: creating 100 disposable identities means posting 100 bonds."*
   **Proposed rewrite**: Keep the pull-quote as the teaser; replace the duplicated clause in the body with new information: *"One-shot defectors must post collateral \emph{before} receiving capabilities. Because the bond is posted, not the identity, disposability doesn't help the attacker --- cheap identity, expensive lie."*
   **Priority**: low.

8. **Location**: Line 1365.
   **Issue**: Typo — sentence begins with a lowercase term after a period.
   **Current text**: *"...because uniform pricing collapses the market to its highest-stakes class. semantic cadence and replay (\S\ref{sec:vibe}) give the substrate the empirical grounding to iterate on all of the above."*
   **Proposed rewrite**: *"...because uniform pricing collapses the market to its highest-stakes class. Semantic cadence and replay (\S\ref{sec:vibe}) give the substrate the empirical grounding to iterate on all of the above."*
   **Priority**: low (trivial fix, ship it regardless of anything else).

9. **Location**: §3.1 Capability Attenuation — the "walls, not laws" Remark at lines 400–402, placed *after* Theorem 3.1 and its proof (383–398).
   **Issue**: Analogy-after-formalism ordering. The single best intuition-builder in the whole section ("A law says you shall not write to the production database. A wall means your token is not valid...") arrives only after the reader has already parsed the subset-relation theorem and its proof.
   **Current text**: Theorem 3.1 and proof (383–398), *then* *"\begin{remark} This is the layer where the metaphor of ``walls, not laws'' applies..."*
   **Proposed rewrite**: Move a one-sentence preview ahead of Definition `def:cap-txn` (383): *"The guarantee below is what security engineers mean by a \emph{wall} rather than a \emph{law}: not an instruction an agent could disobey, but a bound on which operations are even representable."* Keep the fuller Remark where it is as reinforcement, or shorten it now that the idea has already landed once.
   **Priority**: medium.

10. **Location**: §8 "Semantic Cadence" formula, lines 1071–1085.
    **Issue**: Move 5 (numbers by hand) is entirely absent. The causal-density integral is defined, the Asylum Protocol and Inception Canaries are described at length, but no concrete numbers ever appear — a reader cannot hand-check what "causal density approaching zero" means in practice.
    **Current text**: *"$t_{\text{cadence}} = \int_0^t \mathrm{causal\_density}(\tau)\,d\tau$ where $\mathrm{causal\_density}$ aggregates token-emission rates strictly weighted by verified evidence-trail growth..."* [no example follows]
    **Proposed rewrite**: Add after the formula: *"\paragraph{Numbers by hand.} An agent burning 40 tokens/sec for 30 seconds (1{,}200 tokens) with zero AST diffs and zero test runs in that window integrates to causal density $\approx 0$ --- Asylum triggers. An agent burning 15 tokens/sec over the same window while landing three verified diffs keeps causal density high even though its raw token rate is a third of the first agent's, which is exactly the point of metering by evidence growth rather than token spend."*
    **Priority**: medium.

11. **Location**: Line 640, the Krakoa/Hickman analogy.
    **Issue**: Vibe-anomaly risk — the analogy ("Like Hickman's Krakoa~\cite{hickman2019krakoa}, where mutant minds are backed up to Cerebro and restored in new bodies") maps relations reasonably well (mind/body separation, restoration in a new vessel), but assumes Marvel-comics familiarity a "smart-but-non-specialist" reader may not have, and gives no bridging clause.
    **Current text**: *"Like Hickman's Krakoa~\cite{hickman2019krakoa}, where mutant minds are backed up to Cerebro and restored in new bodies, the information survives the vessel."*
    **Proposed rewrite**: *"Like Hickman's Krakoa~\cite{hickman2019krakoa} --- the *House of X* storyline where mutant minds are literally backed up to a database (Cerebro) and restored into new bodies on death --- the information survives the vessel."*
    **Priority**: low.

12. **Location**: Bibliography, `\bibitem{blanchet2016modeling}` (line 1469) and `\bibitem{gray1993transaction}` (line 1404).
    **Issue**: Both entries are defined but never `\cite`'d anywhere in the document (confirmed by the mechanical linter and by grep) — dead weight a referee will notice.
    **Current text**: N/A (absence of citation).
    **Proposed rewrite**: Either cite them where they belong — `blanchet2016modeling` (Blanchet's ProVerif methodology paper) alongside the first ProVerif mention in §3 ("statically by the Anchor Protocol's ProVerif-verified token exchange"), and `gray1993transaction` (Gray & Reuter, the classical transaction-processing text) alongside the ARIES citation in §Crash Recovery or the Sagas citation in Related Work — or delete both entries.
    **Priority**: low.

13. **Location**: §7 "Formal Model," lines 1091–1112, first TLA⁺ `\lstlisting`.
    **Issue**: The section states its purpose in one sentence and then drops a 17-line state-variable block with no English gloss, unlike most of the rest of the paper which translates formalism as it introduces it.
    **Current text**: *"We specify the coordination lifecycle in TLA$^{+}$~\cite{lamport2002specifying} to verify that the three layers compose correctly."* [followed immediately by the `MODULE BondedCommons` listing]
    **Proposed rewrite**: Add before the listing: *"Read the state machine as five English sentences before the syntax: an agent may not \texttt{Begin} without posting positive escrow; a file \texttt{Claim} always succeeds and only ever informs, never blocks; \texttt{Commit} clears a session's claims and locks; a \texttt{Reap} demotes an unresponsive agent to abandoned and queues it for \texttt{Salvage}; and nothing ever deletes a note. The TLA$^{+}$ below is that same machine, made checkable."*
    **Priority**: medium.

14. **Location**: "Volume Context" paragraph, line 242, versus the series-locator box row for Chapter V, line 200.
    **Issue**: Minor redundancy — the two are complementary rather than duplicate, but the paragraph re-covers ground the box already established one screen earlier.
    **Current text**: *"\noindent\textbf{Volume Context.} Chapter~V (\emph{The Anchor Protocol}) provides the cryptographic-token foundation for this work: self-contained ProVerif models of the Harbor Card phases, cuckoo-filter revocation, and bounded multi-hop delegation. This chapter carries the economic and governance argument, while Chapter~V carries the cryptographic protocol detail."*
    **Proposed rewrite**: *"\noindent\textbf{Volume Context.} Chapter~V supplies the ProVerif-verified cryptographic-token foundation this chapter assumes throughout; this chapter supplies the economic and governance argument built on top of it."*
    **Priority**: low.

15. **Location**: §8, lines 1068–1085 ("Agentic Psychosis," "The Asylum Protocol," "Inception Canaries," "God Mode").
    **Issue**: Tonal whiplash. The rest of the document runs a consistent Hobbesian/legal register (sovereign, covenant, walls not laws); §8 shifts abruptly into gamer/meme vocabulary with no signal that the shift is deliberate, which risks reading as a drop in seriousness right after the paper's most rigorous game-theory section (§6.4).
    **Current text**: *"\paragraph{Agentic Psychosis \& The Asylum Protocol.} Unbounded LLMs inevitably enter \emph{Agentic Psychosis}: hallucination loops characterized by extremely high token-generation rates but zero functional AST change..."*
    **Proposed rewrite**: Add one bridging sentence at the section open: *"The names below are playful, but the failure mode is not: treat `Agentic Psychosis' and `the Asylum Protocol' as essential engineering terms for the rest of this section, not jokes."*
    **Priority**: medium.

16. **Location**: Reader's Map, lines 231–239.
    **Issue**: Minor audience-ordering issue. Five of six listed reader paths target other researchers or protocol designers (formal-methods reviewer, cryptoeconomic designer, AI safety researcher, distributed-systems engineer, policy analyst); the one path closest to this whitepaper's stated "smart-but-non-specialist" audience — the engineering manager — is listed fifth of six.
    **Current text**: Order is: formal-methods reviewer; cryptoeconomic designer; AI safety researcher; distributed systems engineer; engineering manager; policy analyst.
    **Proposed rewrite**: Reorder so the engineering-manager path is second, immediately after the formal-methods reviewer, since it is the path a lay-but-technical reader is most likely to self-select into.
    **Priority**: low.

17. **Location**: §Pricing the Bond, lines 807–814 (the four $\pi$ requirements), versus the full worked numbers in Appendix D.
    **Issue**: The four abstract requirements (deterrence, accessibility, risk sensitivity, history adjustment) are stated with no forward pointer to the one place in the paper where they are actually worked through with real numbers (the \$5-cleanup-cost, \$6-bond worked example in Appendix D).
    **Current text**: List of four requirements ending *"We do not close this problem. We tighten the lower bound, propose a scope multiplier, suggest a reputation discount, and describe two concrete mechanisms..."*
    **Proposed rewrite**: Append: *"See Appendix~\ref{app:worked} for these four requirements worked through a single \$5 task end to end."*
    **Priority**: low.

18. **Location**: §Governance, "Advisory Claims Paradox" paragraph, line 596.
    **Issue**: The escalation trigger — "$k$ turns without resolution" — is never given a concrete default, unlike every other timeout in the paper (24-hour appeal window, 30-minute TTL in the worked example, 90-second heartbeat threshold), which makes this one rule impossible for a reader to hand-check.
    **Current text**: *"if advisory conflicts on a resource exceed $k$ turns without resolution, the daemon escalates the advisory claim into an enforced POSIX file-level lock..."*
    **Proposed rewrite**: *"if advisory conflicts on a resource exceed $k$ turns without resolution (default $k=5$), the daemon escalates the advisory claim into an enforced POSIX file-level lock..."*
    **Priority**: medium.

19. **Location**: §Federated Security theorem, lines 1331–1337.
    **Issue**: The paper's single most concrete "who can do what to whom" claim (four-part negative security guarantee: cannot forge, cannot read plaintext, cannot impersonate, cannot roll back) is stated entirely in prose, with no accompanying actor/key diagram — unlike almost every other major claim in the paper, which gets an inline figure. See Part C, item 1.
    **Current text**: N/A — see theorem text at lines 1332–1337.
    **Proposed rewrite**: N/A — figure fix, not text fix (Part C, item 1).
    **Priority**: high (cross-referenced with Part C).

20. **Location**: §Sen's theorem section overall, lines 518–618 (§§5–5.3).
    **Issue**: This is the paper's headline theoretical pivot (why claims are advisory, not enforced) and it runs for roughly three pages with zero accompanying figure — unusual for this document, where almost every comparably-weighted section (auction mechanism, Sybil attack, cartel game, magic-link protocol, worked example) gets an inline TikZ diagram. See Part C, item 2.
    **Current text**: N/A.
    **Proposed rewrite**: N/A — figure fix (Part C, item 2).
    **Priority**: high (cross-referenced with Part C).

**Passages that are already excellent, no fix needed:**
- The introduction's opening scene (lines 252–260) is a textbook Move-1: concrete, present-tense, zero jargon, immediately recognizable pain, before any apparatus appears.
- §6.3 "Truthful Claim Signaling as Nash Equilibrium" (lines 726–804) is the best-executed section in the document by house-style standards: stage game with a real payoff table, a hand-worked deviation calculation with actual numbers ($1 - 2\cdot2.439 = -3.878$), a general critical-$\delta$ derivation, and an explicit "what breaks when each condition is removed" boundary paragraph. This is the model other sections (items 2, 3, 10 above) should be edited toward.
- Table `tab:claim-stage-game` (line 741) and the Monte Carlo figure captions (`fig:pareto-mc-inline`, `fig:sybil-mc-inline`) all state their findings in the caption itself, exactly per Mensh-Kording — a real contrast with items 5–6 above.

## Part B — Existing figures/tables: clarity audit

1. **`fig:bonded-three-layer`** — `figures/fig-bonded-three-layer.tex`, inline after §1.5 (line 299).
   **What it shows**: Three nested rings (Layer 1 capability scope inside Layer 2 evidence chain inside Layer 3 collateral pool), with actor boxes for an agent posting a bond and receiving settlement, and two contrasted bottom paths — an unauthorized action refused at the L1 boundary (red dashed, stopped) versus an authorized-but-harmful action admitted by L1 and charged at L3 (amber dashed exit).
   **What the reader should take away**: no single layer is sufficient; prevention, recording, and pricing are three independent failure-mode closures, and the diagram should let you read off which layer handles which kind of bad action.
   **Will they get it?**: The containment/nesting encoding is a strong choice (Cleveland-McGill ranks position/containment highly, and "layers inside layers" is the correct visual metaphor for "layers of defense"). The bottom legend explicitly ties each of three colors to one specific claim, so the multi-color use is functional, not decorative — but it does mean four non-ink hues appear (maydayred, hhteal, hhamber, hhcobalt) against a house style that names one accent (`accent` = hhteal in the preamble), which edges past the "one accent color" rule. Uses `\sffamily` throughout (cheap tell #2, see item 1 below). Caption is long and states the finding well (Mensh-Kording pass).
   **Verdict**: Good bones, needs a font fix and a light color-count trim. **[needs render]** — the tikzpicture has enough coordinate math (bend controls, `xshift`/`yshift` chains) that label collisions are plausible and cannot be ruled out from source alone; the file's own header comment records a prior visual audit pass (2026-05-19), so re-render after any edit.
   **Concrete fix**: Strip `\sffamily` from the `font=` key (use the body serif); consider converting the L1-refusal / L1-admits-L3-charges distinction to solid-vs-dashed line style as the primary channel and reserve color for one emphasis (e.g., keep amber for "priced," drop the separate red for "refused" in favor of a dotted stop mark, which is already present).

2. **`fig:governance-flow`** — `figures/fig-governance-flow.tex`, inline in §Governance (line 591).
   **What it shows**: Four-stage escalation (direct release → time-out → bonded preemption → human escalation) as a horizontal flow with a cost label under each stage, collecting into a single terminal "resolution recorded on the evidence chain" box.
   **What the reader should take away**: most disputes resolve at stage 1–2 for free; escalation cost climbs monotonically; every outcome, however reached, lands in the same auditable place.
   **Will they get it?**: Yes — linear left-to-right flow with monotonically increasing cost labels is an easy, low-risk encoding (position + text, no color-dependent channel, survives greyscale fine). Caption states the finding. Uses `\sffamily` (cheap tell #2).
   **Verdict**: Good, minor fix only.
   **Concrete fix**: Strip `\sffamily`. **[needs render]** to confirm the trigger labels ("claimant unresponsive," "wait $>$ preempt bond," "stakes $>$ ceiling") don't collide with the escalation arrows given the `\coordinate`-based positioning.

3. **`fig:auction-inline`** — `figures/fig-auction-inline.tex`, inline in §6.3.4 (line 971).
   **What it shows**: Side-by-side (a) static escrow vs (b) competitive Vickrey financing, both underwriting the same coverage $B_T$, ending in a boxed "principal cost" formula for each.
   **What the reader should take away**: only the financing mechanism differs; the competitive auction removes the idle-capital cost.
   **Will they get it?**: This is functionally a relation-map (base structure ‖ target structure, side by side) even though it wasn't built against that explicit template — a genuine strength. The `arr` channel (position + short cost boxes) is greyscale-safe. Caption states the finding directly. Uses `\sffamily`.
   **Verdict**: Good; the clearest "relation-map"-shaped figure in the document even without being labeled as one.
   **Concrete fix**: Strip `\sffamily`; otherwise no change needed.

4. **`fig:pareto-mc-inline`** — `figures/fig-pareto-dominance.pdf` (matplotlib), inline at line 977.
   **What it shows**: (a) Pareto-dominance rate vs. reputation noise $\sigma_r$, split by cartel size (no cartel / 1 colluder / 3 colluders); (b) dominance rate vs. number of insurers $n$.
   **What the reader should take away**: the auction mechanism beats the static baseline only below roughly $\sigma_r \approx 0.1$–0.2, and dominance falls as insurer count rises past 3.
   **Will they get it?**: Yes, and this is a genuinely well-built figure — three series distinguished by **both** color and marker shape (circle/square/triangle), which survives greyscale and colorblind rendering; a labeled 0.5 threshold line gives a fixed reference; panel (b) numbers each bar directly (0.91/0.86/0.74) so the reader never has to eyeball bar height. Font is explicitly set to serif (`Palatino/Charter/Georgia/DejaVu Serif`) matching the body — correctly avoids the sans-serif tell the TikZ figures fall into. Caption states three specific numbered findings, exemplary per Mensh-Kording.
   **Verdict**: Excellent, no fix needed. Use as the internal reference standard for the TikZ figures' font fix.

5. **`fig:sybil-inline`** — `figures/fig-sybil-inline.tex`, inline near §6.4.1 (line 991).
   **What it shows**: An attacker spawning three Sybil identities that underbid honest bidders in a Vickrey auction, win, and default; a loss box showing the protocol only slashes $\min(B_{\mathrm{dep}}, B_T)$; a boxed "A5 finding" summarizing the coverage-bounded ceiling.
   **What the reader should take away**: the deposit slash is capped at coverage, so past $B_{\mathrm{dep}} \geq B_T$ extra deposit buys nothing.
   **Will they get it?**: Good use of dashed-vs-solid line style to distinguish Sybil bids from honest bids (a non-color-dependent channel, survives greyscale) layered on top of the maydayred/hhink color distinction — genuine redundant coding, a real strength. Uses `\sffamily`.
   **Verdict**: Good; minor font fix only.
   **Concrete fix**: Strip `\sffamily`.

6. **`fig:sybil-mc-inline`** — `figures/fig-sybil-deposit-floor.pdf` (matplotlib), inline at line 1000.
   **What it shows**: (a) attacker net profit vs. deposit, staying positive across the full sweep; (b) commons deficit vs. deposit, converging to zero around $B_{\mathrm{dep}} \approx 200$.
   **What the reader should take away**: the commons gets made whole around \$200, but the attacker keeps profiting regardless — the two lines tell opposite stories and the reader needs to hold both at once.
   **Will they get it?**: Yes — again color + marker shape redundancy (circle=K=1, square=K=3), serif font matching the body, a shaded "commons fully reimbursed" band that anchors panel (b)'s convergence claim visually rather than requiring the reader to read the y-axis precisely. Caption states the finding with the specific number.
   **Verdict**: Excellent, no fix needed.

7. **`fig:cartel-game-inline`** — `figures/fig-cartel-game-inline.tex`, inline in §6.4.2 (line 1015).
   **What it shows**: A per-round decision-tree node: collude (floor price) vs. defect, with collusion branching into detected/survived outcomes and their payoffs, plus a boxed sustainability inequality.
   **What the reader should take away**: the closed-form condition under which cartel behavior is sustainable given detection probability $p_d$ and discount $\delta$.
   **Will they get it?**: Decision-tree layout (position + branching) is a clear, well-ranked encoding. The payoff boxes use color (teal=good outcome, cobalt=bad outcome for the cartel) consistently with the rest of the paper's semantics. Uses `\sffamily`.
   **Verdict**: Good; font fix only.

8. **`fig:cartel-folk`** — `figures/fig-cartel-folk-theorem.pdf` (matplotlib), inline at line 1027.
   **What it shows**: (a) a $(p_d, \delta)$ grid, blue cells (marked "Y") where the cartel is sustainable, cream cells (marked "—") where it collapses, with the analytical threshold crossing marked; (b) mean cartel lifespan vs. detection probability on a log-x axis.
   **What the reader should take away**: the sustainability boundary sits near $p_d \approx 0.05$ at $\delta = 0.95$, matching the closed-form $p_d^\star \approx 0.0478$; lifespan collapses fast above that.
   **Will they get it?**: Panel (a) is the strongest greyscale-survival choice in the whole figure set — sustainability is marked with a **letter** ("Y" vs "—") inside each cell, not just color, so the finding survives even if color reproduction fails entirely (grayscale photocopy, colorblind viewer, black-and-white print of the whitepaper). Serif font matches body. One cosmetic nit: "Y" as a stand-in for a checkmark is slightly informal typographically (a proper ✓/✗ pair, or filled/hollow circles, would read more polished) but this is a nit, not a defect.
   **Verdict**: Excellent structurally; optional cosmetic polish only.
   **Concrete fix (optional, low priority)**: Swap "Y"/"—" for ✓/✗ glyphs if the font supports them cleanly at render time; otherwise ship as-is.

9. **`fig:magic-link-inline`** — `figures/fig-magic-link-inline.tex`, inline in §Federated Sovereign (line 1329).
   **What it shows**: A Dolev-Yao-style sequence diagram — issuer emits a token over a private channel and a public link over `pub`; consumer drains the private-channel "cap" via an atomic SQL `UPDATE ... RETURNING`; a second consumer's attempt is shown failing (dashed cobalt) because the cap is already drained.
   **What the reader should take away**: the ProVerif private-channel model and the runtime SQL statement are the *same* mechanism, side by side, and a second redemption attempt is structurally rejected, not just "unlikely."
   **Will they get it?**: This is the document's clearest formal-model-to-runtime-code figure — putting the ProVerif abstraction and the literal SQL statement in one diagram, connected by the same arrows, is exactly the kind of "relation map between two structures" the house style rewards, even though it wasn't drawn against that explicit template. Uses `\sffamily`.
   **Verdict**: Good; font fix only.

10. **`fig:worked-example`** — `figures/fig-worked-example.tex`, inline in Appendix D (line 1629).
    **What it shows**: A three-swimlane timeline (Layer 1 structural / Layer 2 attribution / Layer 3 economic) tracking one agent through capability issuance, bond posting, claim, crash, salvage by a successor, and settlement, with an explicit "salvage parent" edge linking the dead agent's evidence chain to the successor's.
    **What the reader should take away**: all three layers are active simultaneously across the same timeline, and attribution survives the crash via an explicit graph edge, not by assertion.
    **Will they get it?**: The swimlane + time-axis structure directly mirrors the prose narrative it accompanies (Phase A–D), and its fill colors (sand/sanddeep/amber) are the *same* colors used for L1/L2/L3 in `fig:bonded-three-layer` earlier in the paper — genuine cross-figure grammar reuse, which is exactly what the house style asks for ("reuse the same drawing conventions in every piece"). This is a real strength worth calling out. Uses `\sffamily`.
    **Verdict**: Good, and a model for cross-figure consistency; font fix only.

11. **Table `tab:consent`** (line 351) — see Part A item 5 for the caption fix. Structurally the table itself (six capability rows, "without authority" vs. "with authority" columns) is a clean, greyscale-safe two-column comparison; no visual defect beyond the caption.

12. **Table `tab:moral`** (line 644) — see Part A item 6 for the caption fix. The three-column severity table (event / severity / consequence) is legible and correctly ordered by escalating severity; no other defect.

13. **Table `tab:claim-stage-game`** (line 739) — the 2×2 payoff matrix for the claim-signaling stage game. Caption already states the finding in full ("Mutual truth (3,3) is Pareto-optimal, but F strictly dominates T... unique one-shot Nash equilibrium is (F,F)") — exemplary, no fix needed.

14. **Table `tab:threat-bonds`** (line 858) — four-row threat-class bond table (careless / abandonment / sabotage / exfiltration), with the exfiltration row explicitly marked `\SpecOnly` (out of economic scope). Caption states scope and status correctly ("Bands are starting points for calibration, not protocol constants"). Status shown via small-caps/italic weight differences (`\Closed`/`\Partial`/`\SpecOnly` macros), not color — correctly follows the house rule against a colored status key. No fix needed.

15. **Table `tab:verification-status`** (Appendix A, line 1579) — the master verification-status registry. Same status-macro discipline as item 14 (weight/small-caps, not color); caption explains the three-tier status system in full. This is the single most "expensive-looking" table in the document by house-style standards — dense, precise, and honestly hedged. No fix needed.

## Part C — New figures/examples proposed

1. **Where**: §Federated Sovereign (after Definition `def:kms`, around line 1319, or replacing/supplementing the existing prose-only Trust Boundary paragraph at lines 1323–1325).
   **What it would show**: A key-custody relation-map — four actor columns (Daemon, Agent, Principal, KMS) × what each one holds, sees, and cannot do. E.g.: Daemon holds its own Ed25519 signing key and signs harbor roots, but never sees the unwrapped user master; KMS stores Argon2id-wrapped blobs and witnesses harbor roots, but cannot decrypt; the user's email is the recovery root (and the documented weakest link); the user's passphrase wraps the master. Arrows labeled with the actual relations from the Federated Security theorem (forge / read plaintext / impersonate / roll back), each arrow marked with which combination of compromises is required to break it.
   **Why it helps**: This is the paper's single densest "who can do what to whom" claim (the four-part theorem at lines 1331–1337) and it is currently carried entirely in prose across two paragraphs plus a five-property definition. A reader has to hold four actors, five KMS properties, and four attacker-cannot clauses in their head simultaneously with no visual scaffold. This is exactly the chapter title's own framing ("Who holds your keys, when several machines hold them") and currently has zero diagram to match it — the only figure in this whole section (`fig:magic-link-inline`) covers one narrow sub-protocol (single-use token redemption), not the custody model as a whole.
   **Kind**: relation-map.

2. **Where**: §The Limits of Decisive Allocation (§5, somewhere between the Sen-inspired design warning at line 538 and the Advisory Conflict Completeness theorem at line 567).
   **What it would show**: A regime diagram with axes = (x) how much private information an agent has about its own future file needs, (y) coordination overhead / cost of negotiation, shaded to show where advisory claims dominate enforced locking versus where the two are roughly equivalent (e.g., when tasks are fully predictable up front, locking loses nothing and gains determinism; when tasks are exploratory, advisory wins by avoiding the over-claim/under-claim dilemma of lines 549–553).
   **Why it helps**: Sen's theorem is this chapter's headline theoretical result, argued over roughly three pages (§5.1–5.3) with real intellectual weight, and it is the one comparably-sized section in the paper with no accompanying figure at all — every other section of similar weight (the auction, the Sybil attack, the cartel game, the magic-link protocol) gets an inline diagram. A regime diagram here is also exactly the Rail-B grammar the house exposition style calls for at a section's honest-boundary move, and this section currently has no boundary figure despite explicitly limiting its own claim ("This property is a counterexample to the universal claim that exclusive locks always improve team welfare; it is not a derivation of Sen's theorem").
   **Kind**: regime-diagram.

3. **Where**: §8 Semantic Cadence, immediately after the proposed worked-numbers paragraph from Part A item 10.
   **What it would show**: A small 3-row table: token rate, AST/test evidence in the window, resulting causal density, and daemon verdict (nominal / Asylum-triggered), covering a "healthy agent," a "psychotic agent," and a borderline case.
   **Why it helps**: Turns the section's most testable claim into something a reader can hand-check in ten seconds, the same way the claim-signaling section's $\delta = 0.9$ calculation lets a reader verify $-3.878$ by hand. Currently this section has zero numbers of any kind.
   **Kind**: worked-numeric-example (table).

4. **Where**: §1.4 Related Work in Crypto-Economic Bonding (lines 285–297), replacing or supplementing the four `\paragraph` blocks.
   **What it would show**: A compact table — rows = the four prior bodies of work (bonded participation / capability-based security / commons governance / cryptoeconomic mechanism design), columns = "what we borrow" / "what we depart from" / "why." E.g., row 1: borrow = slashing-on-equivocation soundness proofs; depart = adversary is co-located on one machine, not Byzantine-networked; why = consensus reduces to a daemon write, not a global commit.
   **Why it helps**: The current four paragraphs each do a real compare-and-contrast, but it is easy for a reader to lose the throughline across four dense paragraphs of continuous prose. A table lets the "what's genuinely novel" argument (stated explicitly at line 297) be scanned rather than read start to finish, and gives program-committee-type readers (the Reader's Map's first audience) a one-glance related-work summary.
   **Kind**: table.

## Part D — Cross-reference notes

**`whitepaper/research/tex/paper6.tex`** ("What Needs an Authority") — grepped for authority/ownership/control/delegation/capability themes, then separately for bond/commons/Sen/advisory/Aumann/correlated-equilibrium/Float-Plan/insurance/slashing terminology. The first grep returns substantial hits: paper6 is centrally about *when* a designated authority is needed at all (its two theorems: conflict detection needs no authority inside a tractable deontic fragment, but discharge choice among conflicting obligations is NP-complete and needs one; sole ownership of a role is a priced purchase, justified only above an Erlang-C-derived skill-premium threshold). That is philosophically a close cousin of §5's Sen argument — both ask "where does a decisive authority actually earn its keep, versus merely feeling necessary." But the second grep returns **zero matches** for bond, commons, Sen, advisory, Aumann, or correlated equilibrium anywhere in paper6.tex. The two documents share a research question, not a shared formal apparatus, notation, citation, or result — paper6's machinery is Ramadge-Wonham supervisory control and Erlang-C queueing theory, entirely disjoint from this chapter's Aumann/Sen/repeated-game toolkit. **Verdict: not a 1:1 counterpart.** At most, a single forward/backward pointer between §5 of this chapter and paper6's "authority is needed exactly where the algorithm ends" framing would be a fair, honest cross-reference — but it would be a "see also," not a "this chapter formalizes that paper" relationship.

**`whitepaper/source/anchor-protocol-whitepaper.tex`** (Chapter V, "The Anchor Protocol") — grepped for bond/Sen/advisory-claim/correlated-equilibrium/commons-authority/Float-Plan/Youle/insurance/slashing/Aumann terminology; found only the two expected mentions of "Bonded Commons" in its own series-locator box and one `ESCROW_POSITIVE` invariant reference — i.e., Chapter V knows about this chapter's existence and one shared invariant name, but carries none of its game-theoretic content. This *is* the real backing document for roughly half of this chapter's material: every capability-attenuation claim (Theorem `thm:scope`, the Harbor Card model, the delegation-chain proof), every Layer-1 structural-prevention claim, and — most relevantly to Part C item 1 — the entire cryptographic substrate the "who holds your keys" section assumes (passkey device pairing, magic-link atomicity, the Anchor model's authentication correspondence) is proved or specified over there, not here. The relationship is genuine and essential, cited explicitly (`\cite{owens2026anchor}`) more than a dozen times throughout this chapter.

**Honest synthesis.** Anchor-protocol-whitepaper.tex backs this chapter's *structural/cryptographic* half (Layer 1, key custody) but is itself a whitepaper, not one of the seven formal papers — so even granting it full credit, this chapter still has no formal-paper source for its *economic/game-theoretic* half: the daemon-as-correlating-device reading (§2.1), the Sen-inspired design warning and advisory-completeness theorem (§5), the claim-signaling Nash-equilibrium argument (§6.3), the competitive-insurance mechanism and its welfare comparison (§6.3.4–6.3.6), and the cartel folk-theorem analysis (§6.4.2) are argued here, from scratch, with no pointer to — and, as far as a targeted grep across the entire `whitepaper/research/tex/` corpus for Aumann/correlated-equilibrium/bond/commons terminology confirms, no match anywhere in — the seven formal papers. That absence is itself the useful finding the task anticipated: this chapter's most original theoretical content currently exists in exactly one place in the whole research program, and if it is meant to eventually graduate into a formal paper, none of the seven existing ones is a draft of it.

## Summary

1. **Systemic sans-serif-in-figures cheap tell.** All seven custom TikZ figures set `font=\sffamily\small` against a serif (Latin Modern) body — cheap tell #2 from the house LaTeX-craft standard, and the single highest-leverage fix in this review (one line changed, seven times). The three matplotlib figures get this right (`"font.family": "serif"`, matching the LaTeX hh-palette hex-for-hex) — use them as the in-document reference standard.
2. **Two "Definitions First" instances at the paper's most consequential formal moves.** §2 opens directly on a Definition box with zero lead-in prose (Part A #2), and §2.1 opens directly on Aumann's obedience inequality before any intuitive picture (Part A #3) — both are easy, high-value fixes (one paragraph each) at exactly the places a non-specialist reader is most likely to bounce off.
3. **Boundary Burial in the Conclusion.** The two "impossible" claims restated in the closing summary (Part A #4) are stronger than the body's own hedged versions of the same claims — exactly the section a skimming reader reads in isolation, and exactly where an overclaim does the most damage to credibility.
4. **No formal-paper backing for this chapter's economic core.** Neither `paper6.tex` (thematically adjacent, formally disjoint) nor `anchor-protocol-whitepaper.tex` (a real but partial match, covering only the structural/crypto half, and itself a whitepaper not a formal paper) backs the correlated-equilibrium, Sen, claim-signaling, competitive-insurance, or cartel-folk-theorem material — this appears to be original theory living only at the whitepaper level (Part D).
5. **The "who holds your keys" chapter needs a key-custody figure.** §Federated Sovereign carries its densest claim (the four-part Federated Security theorem) in pure prose with only one narrowly-scoped figure; a key-custody relation-map (Part C #1) is the single most valuable new figure this document could add, and it's the one the task brief specifically anticipated.
6. **Two table captions name the table instead of stating the finding** (`tab:consent`, `tab:moral`) — quick fixes, made more visible by contrast with `tab:claim-stage-game` and the Monte Carlo figure captions elsewhere in the same document, which do this correctly.
7. **Genuine strengths worth preserving as the template for fixes elsewhere**: the introduction's Move-1 scene, the Truthful Claim Signaling section's fully worked deviation analysis (§6.3), the cross-figure color-grammar reuse between `fig:bonded-three-layer` and `fig:worked-example`, and all three matplotlib Monte Carlo figures (redundant color+shape coding, serif font, findings-first captions) are already at or above the house bar and should not be touched beyond the systemic font fix in item 1.
