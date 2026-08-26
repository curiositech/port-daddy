# Exposition + Figure Review: From Spawn to Person

*From Spawn to Person: Identity, Continuity, and the Substrate of Agentic Reputation* is Chapter III of VII in the Port Daddy Coordination Papers whitepaper series (`website-v2/public/whitepaper/spawn-to-person.tex`, 1,940 lines, 13 TikZ figures, ~40-minute stated reading time). It is the popular-audience bridge chapter between the single-operator tool (Chapters I–II) and the cross-operator market (Chapter IV), and it is unusual among the seven volumes in popularizing **two** formal papers at once: the reputation/audit-economics chapters draw on `docs/harbor-research/tex/paper3.tex` (*Reputation is Amortized Verification*), and the identity/continuity chapters draw on `docs/harbor-research/tex/paper5.tex` (*Continuity Without Metaphysics*). The mechanical linter (`skills/research-paper-submission/scripts/submission_lint.py`) ran clean against the target file and figures directory: 0 errors, 3 warnings (all three unused bibliography entries, matched independently below), and 8 "claims to confirm." Of those 8, 7 are false positives typical of the linter's academic-paper tuning applied to expository whitepaper prose — rhetorical "in every trade," a definitional "iff" inside `Definition~\ref{def:oracle}`, and citation paraphrases of "optimal" that are scoped by the cited paper (Liu–Skrzypacz), not by this paper's own claim — and are not repeated below. One flag is genuine and is folded into Part A (the "optimal" inside Theorem 6.3's own proof sketch). Figure-level analysis below is manual, using the Cleveland–McGill ranking, the worked-example effect, and Mensh–Kording caption discipline (`skills/research-paper-submission/references/figures-and-examples.md`), and every render-dependent judgment is flagged `[needs render]` since no LaTeX toolchain is available in this checkout.

The document is, overall, unusually well-disciplined for a "popularization" — it carries real theorems with real proofs, an honest maturity ledger, and (mostly) tight numeric synchronization with its two source papers. The problems found are concentrated, not diffuse: one figure breaks the shared visual grammar, one late passage breaks the paper's own honesty discipline in a way its sibling paper explicitly contradicts, and the exercise/open-problem cross-referencing has drifted out of sync with itself.

## Part A — Text/exposition changes

1. **Location:** §5 (Organs), Organ 2 pitfall box, line 758.
   **Issue:** Honesty-discipline violation / claim overclaim, and it contradicts the paper's own maturity label two sentences earlier and the Appendix status table.
   **Current text:** *"Strong continuity --- the kind that lets a successor \emph{resume} rather than \emph{inherit a summary} --- is now solved via \textbf{Event-Sourced Neural Rehydration} (OP-4). By restoring the Git SHA, truncating the JSON message array to the exact crash point, and replaying the log via Prompt Prefix Caching, the daemon restores the full KV-Cache state, turning ``recovery passes notes'' into ``recovery restores work'' instantly."*
   This sits inside a `\pitfall{}` box whose own opening sentence invokes the system's "honest-attestation discipline: only report 'all good' when you have actually verified it" — and then the box itself violates that discipline. It also contradicts Appendix Table `tab:app-status` (line 1763–1764), which still lists the restart organ as `\BUILTWEAK` — "forwards a summary, not execution state." Cross-checked against `paper5.tex` (§Resurrection with teeth, its Honest Boundary, line ~263): *"Continuity witnesses attest lineage, not welfare: nothing here says the checkpoint restored the agent's 'experience,' only that the ledger followed the right body."* The formal sibling paper explicitly disclaims the exact class of claim this pitfall box makes.
   **Proposed rewrite:** *"Selling a summary-forwarding restart organ as real checkpointing would violate the system's own honest-attestation discipline: only report ``all good'' when you have actually verified it --- absence of error is not attestation. A specified candidate for strong continuity, \textbf{Event-Sourced Neural Rehydration} (OP-4), restores the Git SHA, truncates the message log to the exact crash point, and replays it through prompt-prefix caching to reconstruct the KV-cache; it is \DESIGNED, not \BUILT. If it ships as designed it turns ``recovery passes notes'' into ``recovery restores work.'' Until then --- and this paper's own maturity ledger (Fig.~\ref{fig:honest-state}) is where to check whether that has changed --- the restart organ still forwards a summary."*
   **Priority:** High.

2. **Location:** §10 (Open problems), item 2, line 1689.
   **Issue:** Self-contradictory placement — the same overclaim as Item 1, but now listed under a section literally titled "Open problems," which asserts it is closed.
   **Current text:** *"\textbf{Agent-death taxonomy (\S\ref{sec:organs}).} What is recoverable vs.\ fundamentally lost when an LLM agent dies mid-thought? Solved via \textbf{Event-Sourced Neural Rehydration} (OP-4)."*
   **Proposed rewrite:** *"\textbf{Agent-death taxonomy (\S\ref{sec:organs}).} What is recoverable vs.\ fundamentally lost when an LLM agent dies mid-thought? Event-Sourced Neural Rehydration (OP-4) is a specified candidate answer (restore Git SHA, truncate to the crash point, replay through prompt-prefix caching) but is \DESIGNED, not shipped; the taxonomy itself --- record vs.\ claims vs.\ execution state vs.\ latent ``intent'' --- remains open until it ships and is measured."*
   **Priority:** High.

3. **Location:** §9 (Oracle), "Algorithmic Mode Collapse and the VRF Honeypot Solution," lines 1482–1505 (paragraph, Conjecture 3.1, and the `\keyidea{}` following it).
   **Issue:** Internal inconsistency across three adjacent statements of the *same* result, and a missed opportunity — the sibling formal paper has actually **closed** this as a theorem, which the whitepaper doesn't say. The prose ("We cure this... mathematically certain... the recursion collapses") reads as settled; the boxed statement is a `Conjecture`, not a theorem; the exercise two pages later asks the reader to "Prove or refute Conjecture~\ref{conj:contract}"; and the figure's own caption (`fig-stp-rate-the-raters.tex`) says "Neither obligation is depicted as established." Four different confidence levels for one claim, in one section. Cross-checked against `paper3.tex` §"The tower" / §"Conjecture III.11.1, parameterized" (lines 108–173): the source volume's original open Conjecture III.11.1 (this exact grading-oracle recursion) **is** closed there, as a parameterized theorem with a named implementation and reproducible numbers — sealed $C$-clique sampling from heterogeneous judge pools, contraction rate $(1-\rho d)$ per level, and at the program's worked parameters ($G{=}10,d{=}0.8,B{=}50$) a homogeneous pool needs roughly double the tower depth and bond capital of a heterogeneous one (53 levels / \$2,650 vs. 27 levels / \$1,350). None of those numbers, or the closed status, made it into this chapter.
   **Current text (paragraph):** *"...raters'' introduced a severe \emph{Algorithmic Mode Collapse} vulnerability, where a monoculture of model architectures could form a cartel of mutual validation. We cure this via two mandated mechanisms that force the recursion to terminate."*
   **Current text (keyidea):** *"By bounding the dishonesty payoff with a mathematically certain VRF slash, the rate-the-raters recursion collapses: the market enforces its own honesty without relying on infinite re-audits."*
   **Proposed rewrite (paragraph):** *"...raters'' introduced a severe \emph{correlated mode collapse} vulnerability, where a monoculture of model architectures could form a cartel of mutual validation. The companion paper, \emph{Reputation is Amortized Verification}, closes exactly this recursion as a theorem, not a conjecture: a sealed, $C$-clique-sampled audit tower with VRF-selected honeypot tasks contracts geometrically, and at the program's worked parameters a homogeneous judge pool needs roughly double the tower depth and bond capital of a heterogeneous one (53 levels / \$2{,}650 vs.\ 27 levels / \$1{,}350) to reach the same corruption ceiling. We restate the mechanism here for the popular reader; Conjecture~\ref{conj:contract} below is a looser, hand-workable version of that closed result, kept as an exercise because deriving it is instructive --- not because the underlying question is still open."*
   **Proposed rewrite (keyidea):** *"The grading oracle is the load-bearing assumption hidden under every IC claim in the economy. The companion paper closes the rate-the-raters recursion as a theorem (sealed, multi-clique audit towers contract geometrically); this chapter keeps a conjecture-shaped version so the mechanism can be worked by hand."*
   **Priority:** High.

4. **Location:** §10 (Open problems), item 4, line 1693.
   **Issue:** Same status drift as Item 3 — lists a closed result as an open problem.
   **Current text:** *"\textbf{The grading-oracle / rate-the-raters recursion (\S\ref{sec:oracle}, Conj.~\ref{conj:contract}).} Prove the re-audit tower contracts, or accept the core IC theorem is conditional."*
   **Proposed rewrite:** *"\textbf{The grading-oracle / rate-the-raters recursion (\S\ref{sec:oracle}, Conj.~\ref{conj:contract}).} Closed by the companion paper as a parameterized theorem (sealed $C$-clique sampling, geometric contraction, reproducible numbers); restated here as a hand-worked exercise, not a live research question."*
   **Priority:** High.

5. **Location:** §3 (Role/person distinction), lines 543–566, immediately before Definitions 3.1–3.2.
   **Issue:** Definitions-First anti-pattern (harbor-exposition). Two formal `\begin{definition}` boxes land after a single generic paragraph, with no concrete instance walked through first — a departure from the Move-1/Move-3 (scene, then structural mapping) discipline the paper otherwise follows well (see the S1–S4 device).
   **Current text:** *"The word ``agent'' is overloaded. In a swarm it can mean a job description (``the cartographer''), a running process (``PID~48213''), or a persistent character with a history... The economy needs all three kept apart, because reputation attaches to exactly one of them."* [Definition~Role follows immediately.]
   **Proposed rewrite (insert before the Definition box):** *"Go back to Alice's swarm (\S\ref{sec:intro}): ``cartographer'' is a role --- an obligation to map the repo, the capability to read and write files, the authority to open a PR. Tonight it was filled by a process that called itself \emph{Wren}; tomorrow the same role will be filled by a different process, and nothing about the role changes. What \emph{does} persist, if anything does, is the thing on the other side of the fill --- and that is what the next two definitions pin down."*
   **Priority:** High.

6. **Location:** §6 (Identity), immediately after the proof of Theorem 6.1 (necessity), before the pitfall box at line 871.
   **Issue:** Missing worked example (harbor-exposition Move 5). The section runs Definition → Theorem → full formal proof cold, with no hand-checkable numbers anywhere near the theorem that is the paper's single most load-bearing result — a notable gap given how disciplined the numeric-provenance habit is elsewhere (S1–S4 scenes, the no-mint and probation-cliff footnotes).
   **Current text:** *(none — the proof is followed directly by the `\pitfall{}` box.)*
   **Proposed rewrite (insert):** *"\paragraph{Numbers by hand.} Say a clean newcomer starts at $r_0=50$ and a dishonest outcome should cost $\Delta=30$. Under free identity minting, the actor's accessible score after the sanction is $\max(r(i)-\Delta,\,r_0)=\max(20,\,50)=50$ --- the sanction never bites, because the actor simply reappears at the newcomer score it would have gotten anyway. \emph{Now you try:} if $r(i)=90$ before the sanction, does the same free-identity actor still escape it? ($r(i)-\Delta=60>r_0=50$ --- no: an actor with a strong-enough record has nothing to gain from whitewashing a single bad outcome, which is exactly the boundary Theorem~\ref{thm:whitewash-cost} formalizes next.)"*
   **Priority:** High.

7. **Location:** Throughout — exercise numbering inconsistency across at least five blocks.
   **Issue:** The starred `\textit{Open.}` exercise numbers appear to index into the collected Open-Problems list (§10), but have drifted: only 2 of 9 checkable instances actually match that list's position, and several blocks skip numbers even within themselves (Check/Trace/Open should read 1,2,3 locally but jump). Concretely: §5 organs exercises (lines 811–820) run `(1)…(2)…$\star$(4)` — skipping 3. §7 adr0049 exercises (lines 1433–1446) run `(1)(2)(3)…$\star$(5)` — skipping 4. §9 oracle exercises (lines 1507–1517) run `(1)(2)…$\star$(4)…$\star$(10)` — skipping 3, and (10) doesn't match Open Problem #9 (Arbitration capacity) or #4. §11 revoke exercises (lines 1615–1624) run `(1)(2)…$\star$(8)` — but Open Problem #7 (Reputation-claim revocation) is the actual match, not #8. §6 identity exercises (lines 1010–1021) use `$\star$(3)` for bond-farming, which is Open Problem #8, not #3.
   **Current text (example, line 811–819):** *"\textit{Check.} (1) Which organ is \BUILTWEAK... \\ \textit{Trace.} (2) An agent claims a file... \\ $\star$ \textit{Open.} (4) When an LLM agent dies mid-thought..."*
   **Proposed rewrite:** Drop the literal numeral from starred items and cross-reference the Open Problems list directly, e.g. *"$\star$ \textit{Open (see Open Problem 2, \S\ref{sec:open}).} When an LLM agent dies mid-thought..."* — or, if the numbers must stay, renumber every block sequentially (1, 2, 3…) and update §10's list order to match reading order so the correspondence is checkable rather than accidental.
   **Priority:** Medium.

8. **Location:** §1 vs. §6/§7/§9 — heading-level inconsistency for the S-scene device.
   **Issue:** S1 ("the spawn that cannot be paid," line 335) is a `\paragraph{}`; S2 (line 897), S3 (line 1357), and S4 (line 1574) are `\subsection{}`. Because only `\subsection` and above populate the table of contents, S2–S4 are TOC-navigable and S1 is not, breaking the parallelism of a device the paper uses precisely to give the reader four load-bearing checkpoints.
   **Current text:** `\paragraph{S1 --- the spawn that cannot be paid.}` vs. `\subsection{S2 --- whitewashing in action}`.
   **Proposed rewrite:** Promote S1 to `\subsection{S1 --- the spawn that cannot be paid}` (it already opens §1 as a natural first subsection, alongside "What this paper claims, and what it refuses to claim").
   **Priority:** Medium.

9. **Location:** §6.5 (Keystone split), "The second stone's envelope has been standardized" paragraph, lines 1071–1090.
   **Issue:** Unglossed acronym wall for a whitepaper aimed at a smart-but-non-specialist reader — SD-JWT+kb, ES256, JWS, JCS, `/.well-known`, JWK all appear with zero explanation in one paragraph, a sharp density spike relative to the rest of the chapter.
   **Current text:** *"...expresses principal authorization as W3C Verifiable Credentials in SD-JWT form --- SD-JWT+kb with hardware-bindable ES256 keys for the principal, JWS detached-content signatures over JCS-canonicalized payloads for the counterparty, keys published as JWK sets under a \texttt{/.well-known} profile."*
   **Proposed rewrite:** *"...expresses principal authorization as a signed, tamper-evident credential format (the same family the web already uses for verifiable digital IDs), with the principal's key hardware-bindable and the counterparty's signature checkable against a public key the operator publishes at a fixed, fetchable web address."* (Move the acronym string itself into a footnote for the reader who wants the exact standard names.)
   **Priority:** Medium.

10. **Location:** §6 (Identity) and §9 (Oracle), section openings, lines 823–830 and 1449–1456.
    **Issue:** Missing "express lane" one-breath opener. Both sibling formal papers (`paper3.tex`, `paper5.tex`) open every section with an explicit `\onebreath{}` sentence before any formalism (Rail A discipline). This whitepaper uses `\keyidea{}`/`\pullquote{}` inconsistently and sometimes only *after* the formal box, so a reader skimming for the one-sentence version of §6 or §9 has to read a paragraph and a Definition first.
    **Current text (§6 opening):** *"Before any organ of continuity matters, the identity it attaches to must be one the agent cannot freely re-pick. This is the most under-appreciated claim in the paper. We first state the central claim of the section as a theorem and prove it..."*
    **Proposed rewrite (insert as the section's first line):** *"\emph{Express lane: a reputation that a bad actor can escape for free by minting a new identity isn't a reputation --- formal statement in Theorem~\ref{thm:necessity} below.}"*
    **Priority:** Medium.

11. **Location:** Bibliography, three entries never cited in the body: `ostrom1990` (line 1918), `hobbes1651` (line 1923), `rochettirole2003` (line 1908).
    **Issue:** Dead bibliography entries — confirmed both by grep and by `submission_lint.py`, which independently flags all three with "is never cited - padding, or a lost `\cite`?". Harmless to compile but a lint-level cleanliness issue, and Ostrom in particular (*Governing the Commons*) is a natural fit for §11's bounded-memory-as-a-commons-parameter argument and is currently wasted.
    **Current text:** *(bibliography entries with no `\cite` anywhere in the document body)*
    **Proposed rewrite:** Either cite `ostrom1990` in §11's "Bounded memory is a design parameter, not a virtue" subsection (bounded-memory governance is exactly Ostrom's territory), or delete all three entries.
    **Priority:** Low.

12. **Location:** §7 (multi-dimensional reputation protocol) and §8 (not-a-bandit-problem) generally.
    **Issue:** No visible grounding in either named source paper (see Part D) — `paper3.tex` contains zero occurrences of "quality vector," "multi-dimensional," "aesthetic," "bandit," or "EigenTrust." The whitepaper presents the accuracy/aesthetics/efficiency vector and the bandit-vs-reputation argument with the same confident, theorem-adjacent register as the rest of the paper, but there is no numbered formal result backing them the way there is for the identity theorems (§6) or the no-mint theorem (§4). This isn't necessarily wrong — it may be original program-level design synthesis, or it may belong to an unfetched paper (the market paper, Chapter IV) — but the paper's own honesty discipline (the maturity scale, the honest-state figure) doesn't currently flag it.
    **Current text:** *(the multi-dimensional reputation protocol is stated as "\DESIGNED-to-\VISION" via the maturity scale, which is honest about implementation status, but silent about which paper, if any, formally proves the design is sound)*
    **Proposed rewrite:** Add one sentence to §7's opening: *"Unlike the identity theorems of \S\ref{sec:identity} and the no-mint theorem of \S\ref{sec:continuity}, the multi-dimensional vector and the bandit-vs-reputation argument in this section are program-level design, not yet a numbered formal result in a companion paper; treat the claims here as motivated, not proved."*
    **Priority:** Medium.

13. **Location:** §6 (Identity), Property 6.2 (`prop:reality`), lines 882–884.
    **Issue:** Structural inconsistency — every other formal environment in the paper (Definitions, Theorems, the sanction-respecting Definition just above it) is either tightly scoped to one claim or cleanly itemized. Property 6.2 crams two distinct attacks (whitewashing and Sybil) into one unbroken, comma-heavy sentence, which is harder to parse than the itemized version of the *same* two attacks that appears two pages later at §6.2 ("The classic attacks this forecloses," lines 917–926).
    **Current text:** *"A reputation system carries economic force only to the extent that the accountable principal cannot costlessly discard or multiply the liability-bearing identity. If an actor can freely obtain a fresh identity whose accessible economic utility... matches or exceeds its sanctioned utility, identity-local sanctions are evadable (\textbf{whitewashing}). If an actor can costlessly multiply identities to inflate votes or aggregate unreserved credit, quorum mechanisms collapse (\textbf{Sybil})..."*
    **Proposed rewrite:** Split into two `itemize` bullets matching the later section's structure: *"A reputation system carries economic force only to the extent that the accountable principal cannot costlessly discard or multiply the liability-bearing identity: \begin{itemize}\item if an actor can freely obtain a fresh identity whose accessible economic utility matches or exceeds its sanctioned utility, identity-local sanctions are evadable (\textbf{whitewashing}); \item if an actor can costlessly multiply identities to inflate votes or aggregate credit, quorum mechanisms collapse (\textbf{Sybil}~\cite{douceur2002}).\end{itemize} Effective deterrence requires binding all spawned actors to a durable principal with aggregated exposure limits."*
    **Priority:** Low.

14. **Location:** §6 (Identity), Theorem 6.2 (`thm:whitewash-cost`), lines 933–966.
    **Issue:** Missing worked numeric example — the theorem states $W=\sum_t(\pi(\kappa^\star)-\pi(\kappa_t))$ entirely in the abstract and is never instantiated, unlike the companion paper's disciplined "Numbers by hand" convention (e.g. `paper3.tex` line 104: "$\rho^\star = 10/(0.8\cdot 50) = 0.25$... \emph{Now you try:} double the bond...").
    **Current text:** *(theorem and proof sketch only; no numeric instantiation anywhere nearby)*
    **Proposed rewrite:** See Part C, item 2, for a full worked-example proposal to insert here.
    **Priority:** Medium.

15. **Location:** Abstract, lines 213–246.
    **Issue:** Single unbroken ~350-word, 9-sentence paragraph — denser and less skimmable than the "one-breath" ethos the paper itself teaches (Move 2), and noticeably harder to skim than `paper5.tex`'s abstract, which numbers its three claims (1)(2)(3) as separate sentences.
    **Current text:** *(one continuous paragraph running from "A coding-agent swarm produces work..." through "...bound the cost a whitewashing attacker must pay.")*
    **Proposed rewrite:** Break into two paragraphs at *"We ground the philosophy..."* (roughly the abstract's midpoint) — claims-and-definitions first, then methodology-and-boundary — so a skimming reader can stop after paragraph one with the load-bearing distinction intact.
    **Priority:** Low.

16. **Location:** §6 (Identity), the `\pitfall{}` box on capability-based security terminology, lines 605–611. *(Reviewed for quality, not a defect.)*
    **Issue:** None — flagged here as an example of the anti-pattern done *right*: it preempts exactly the misread a reader would make (conflating Dennis–Van Horn capability tokens with deontic "may"), which is precisely harbor-exposition's Move-3 "misread to preempt" requirement, executed cleanly.
    **Current text:** *(no change needed)*
    **Proposed rewrite:** *(none — cite as a positive exemplar if the series ever writes an internal style guide from examples)*
    **Priority:** Low (informational).

17. **Location:** §7.3 (S3 — a graded job, end to end), lines 1357–1386. *(Reviewed for quality, not a defect.)*
    **Issue:** None — the Heron/Mara/Bob worked scene is the paper's best passage: it walks the full judge-hiring ceremony through concrete numbers ($\mathbf{q}=(1.0,0.7,0.9)$), shows the buyer's decision changing because of the vector rather than a collapsed scalar, and sets up S4's tombstone payoff two sections later. No fix needed.
    **Current text:** *(no change needed)*
    **Proposed rewrite:** *(none)*
    **Priority:** Low (informational).

18a. **Location:** §6 (Identity), Theorem 6.3 (`thm:probation-dominance`) proof sketch, line 981.
    **Issue:** Flagged by `submission_lint.py` ("'optimal' - optimal over what class, under what constraint set?") and worth keeping, unlike the linter's other "optimal" hits (which are citation paraphrases of Liu–Skrzypacz, already scoped by the source paper). This one is inside the paper's *own* proof sketch, and the theorem statement two paragraphs above *does* precisely scope the optimization ("minimizes the lifetime friction on honest newcomers... subject to the deterrence constraint"), but the proof's closing sentence drops the qualifier, so a reader who jumps straight to the proof (a real reading pattern for a starred/boxed result) sees an unqualified "optimal."
    **Current text:** *"Hence, the optimal newcomer screening schedule is a sharp initial probation cliff followed by immediate graduation to full capacity."*
    **Proposed rewrite:** *"Hence, among all schedules meeting the deterrence constraint, the one that minimizes honest newcomers' lifetime friction is a sharp initial probation cliff followed by immediate graduation to full capacity."*
    **Priority:** Low.

18. **Location:** §3.1 (Capability is not permission), the force-merge example, lines 594–603.
    **Issue:** Minor polish only — the "delete the production database" comparison is relegated to a parenthetical aside when it is at least as vivid as the force-merge example that precedes it and could stand as its own sentence for a reader skimming.
    **Current text:** *"...it is the canonical capable-but-forbidden state, an available action a guardrail exists specifically to forbid. (A ``delete the production database'' command is the same shape.)"*
    **Proposed rewrite:** *"...it is the canonical capable-but-forbidden state, an available action a guardrail exists specifically to forbid. A ``delete the production database'' command has the same shape: the runtime can execute it, and that is exactly why the permission layer, not the absence of the tool, has to be the thing standing in the way."*
    **Priority:** Low.

## Part B — Existing figures/tables: clarity audit

All 13 figures live in `website-v2/public/whitepaper/figures/fig-stp-*.tex` and share the preamble's `stp box` / `stp accent box` / `stp arrow` TikZ styles (defined once, lines 41–54 of the main `.tex`) — with one significant exception (item 6 below). `[needs render]` applies to every verdict below since no LaTeX toolchain is available in this checkout; source-level analysis is used throughout.

1. **Figure 1 — `fig-stp-stack-map.tex`** (Fig.~\ref{fig:stack}, §1, line 380).
   **Shows:** The L0–L3 stack (daemon → protocol → legibility → this chapter → economy), each rung labeled with its honest-state tag.
   **Takeaway:** This chapter is the bridge between a legible person (L2) and a tradeable reputation (L3).
   **Will they get it?** Yes — position-on-a-common-scale encoding (Cleveland–McGill's top-ranked channel), one accent box for "you are here," caption states the finding rather than just naming the rungs. Maturity words ("implemented"/"specified"/"proposed") are typed literally rather than via the `\BUILT`/`\DESIGNED`/`\VISION` macros — cosmetically identical today but a maintenance smell if the macros' styling changes later.
   **Verdict:** Good. **Fix:** Low-priority — replace the three literal `{\scriptsize\scshape proposed}`-style strings with the actual maturity macros so future palette/weight changes propagate automatically. `[needs render]`

2. **Figure 2 — `fig-stp-role-vs-person.tex`** (Fig.~\ref{fig:role-person}, §3, line 573).
   **Shows:** Role (org-chart, history-free) on the left; a person as one identity threading through role-instances (navigator → cartographer → cartographer → lookout) with outcomes marked pass/fail, accumulating into "continuity" on the right.
   **Takeaway:** Reputation attaches to the thread, not the role, not the process.
   **Will they get it?** Yes — this is a clean, correctly-executed relation-map (harbor-exposition Rail B): base structure (role) ∥ target structure (person-thread) ∥ arrows are the mapped relation (identity persisting across role changes). Position + connected-line encoding survives greyscale.
   **Verdict:** Excellent — no fix needed. `[needs render]` to confirm final spacing only.

3. **Figure 3 — `fig-stp-parfit-chain.tex`** (Fig.~\ref{fig:parfit}, §4, line 676).
   **Shows:** Three incarnations (boy/officer/general) with solid "remembers" arcs between adjacent pairs and a dashed "no direct memory required" arc from the first to the last, braced as "continuity is the transitive overlapping chain."
   **Takeaway:** Continuity (transitive) survives where connectedness (direct, non-transitive) fails — Reid's objection, resolved.
   **Will they get it?** Yes — the dashed-vs-solid line distinction is a length/line-type encoding (Cleveland–McGill mid-tier but adequate here since the caption also states the finding in words), and the brace is a good use of a low-cost annotation. Survives greyscale since dashed/solid remains distinguishable without color.
   **Verdict:** Good. `[needs render]`

4. **Figure 4 — `fig-stp-three-organs.tex`** (Fig.~\ref{fig:organs}, §5, line 727).
   **Shows:** Three continuity organs (memory, checkpoint, outcome ledger) in a row, flowing into a "Multi-Dim Reputation" box below the third.
   **Takeaway (intended):** Organ 3 (outcome ledger) is the one reputation keys on; organs 1–3 have different maturity.
   **Will they get it?** **No — this figure has the most serious defect in the set, on two independent grounds.** (a) *Visual-craft:* it does not reuse the shared `stp box`/`stp accent box` styles at all — it defines a fully local style block (`organ`, `accentorgan`, `repbox`, `flowarr`, `accentarr`) with its own fill (`fill=hhcobalt!7`, a cobalt-tinted fill used nowhere else in the 12 other figures) and its own border box for the reputation node (`fill=hhpaper` with a cobalt border — a third, distinct treatment). This is precisely the house style's named anti-pattern: "the lonely figure... a figure that looks like a different author than its siblings." (b) *Factual/consistency:* the maturity labels inside the boxes — `[Implemented]`, `[Partial / Structured]`, `[Core Implemented]` — do not match the paper's actual four-point maturity vocabulary (`implemented`/`partial`/`specified`/`proposed`, rendered via `\BUILT`/`\BUILTWEAK`/`\DESIGNED`/`\VISION`) used everywhere else, including this same figure's own caption ("Episodic memory (\BUILT)... The checkpoint (\BUILTWEAK)... The witnessed-outcome ledger (\BUILTWEAK)"). Worse, the outcome-ledger node is labeled `[Core Implemented]` inside the figure while the caption directly beneath it — and the entire rest of the paper — grades that same organ `\BUILTWEAK`/partial. A reader who only looks at the picture (which is what most readers do) comes away thinking the ledger is fully built; a reader who reads the caption gets the opposite, correct answer.
   **Verdict:** Needs fix — high priority. **Concrete fix:** Rewrite the figure to use the shared `stp box`/`stp accent box`/`stp arrow` styles from the main preamble (delete the local style block entirely), and replace the three bracketed labels with the actual `\BUILT`/`\BUILTWEAK` macros so the in-figure label and the caption can never drift apart again. `[needs render]`

5. **Figure 5 — `fig-stp-honest-state.tex`** (Fig.~\ref{fig:honest-state}, §5, line 809).
   **Shows:** Table-as-figure: every major claim, its maturity grade, and where it's argued.
   **Takeaway:** "The score is cheap; the trustworthy substrate remains the gate" — stated explicitly in the caption.
   **Will they get it?** Yes — this is the paper's honesty anchor and it is well executed: consistent use of the maturity macros (correctly matching body text, unlike Figure 4), muted-ink/small-caps status differentiation (no rainbow), caption states the finding.
   **Verdict:** Excellent — exemplary use of the "status by weight/small-caps" house rule. No fix needed. `[needs render]`

6. **Figure 6 — `fig-stp-sybil-whitewash.tex`** (Fig.~\ref{fig:sybil}, §6, line 990).
   **Shows:** Top row — self-asserted label enables free reset (whitewash) and free replication (Sybil). Bottom row — daemon-minted identity → non-re-pickable credential → principal, closing both attacks.
   **Takeaway:** A non-forgeable root forecloses both classic attacks; stated explicitly in the caption with theorem cross-references.
   **Will they get it?** Yes — this is the cleanest relation-map in the document: two parallel structures (free-identity world vs. bound-identity world) with arrows encoding the *process* (dashed = attack progression, solid = defense mechanism), exactly matching harbor-exposition's Rail B template.
   **Verdict:** Excellent — could serve as the house style's canonical example of "how to draw a relation-map." No fix needed. `[needs render]`

7. **Figure 7 — `fig-stp-keystone-split.tex`** (Fig.~\ref{fig:keystone}, §6.5, line 1062).
   **Shows:** Two harbors (Alice's, Bob's), each with a partial local-identity box, separated by a dashed trust boundary, with an unbuilt "cross-operator attestation" accent box below bridging both.
   **Takeaway:** The keystone is two stones; only the local one is built.
   **Will they get it?** Yes — spatial separation (two distinct regions) plus the accent box correctly marks the single most important (unbuilt) element. Caption states the finding and correctly hedges ("has laid part of the local stone... but full write-boundary enforcement remains").
   **Verdict:** Good. `[needs render]`

8. **Figure 8 — `fig-stp-estimator-family.tex`** (Fig.~\ref{fig:estimators}, §7, line 1156).
   **Shows:** Three signal types (pairwise/tournament, trust-propagation, marketplace feedback) mapped to their matching estimator family.
   **Takeaway:** Choosing the wrong estimator for the signal type is the real error; caption states this plus the paper's substrate argument.
   **Will they get it?** Yes — simple position-encoded correspondence table, one accent box for the Bradley–Terry row (correctly the one the reference system's SQLite harbor actually uses, per the caption).
   **Verdict:** Good. `[needs render]`

9. **Figure 9 — `fig-stp-not-bandit.tex`** (Fig.~\ref{fig:not-bandit}, §8, line 1200).
   **Shows:** Table of four bandit assumptions vs. reputation reality vs. the right tool, plus an accent-box callout on what survives the bandit framing (exploration).
   **Takeaway:** All four bandit assumptions are false for public reputation; stated in the caption.
   **Will they get it?** Yes — table is the correct chart form for this categorical comparison (no unnecessary chartjunk), and the accent box correctly marks the one genuinely-surviving exception rather than drowning it in the table.
   **Verdict:** Good. `[needs render]`

10. **Figure 10 — `fig-stp-multidim-reputation.tex`** (Fig.~\ref{fig:multidim}, §7.1, line 1298).
    **Shows:** Witnessed outcome → quality vector (accent box) → buyer applies weights; vector fans out into three judged axes below.
    **Takeaway:** Different axes, different judges; buyer reads the vector, not a collapsed scalar.
    **Will they get it?** Yes — clean fan-out, accent correctly on the single most important node (the vector itself).
    **Verdict:** Good. `[needs render]`

11. **Figure 11 — `fig-stp-judge-market.tex`** (Fig.~\ref{fig:judge-market}, §7.2, line 1355).
    **Shows:** Work → eligibility screen → neutral judge (accent, posts bond) → outcome ledger, with a dashed "overturn ⇒ slash" loop back from re-audit to the judge's bond.
    **Takeaway:** Neutrality is a checklist enforced by a bonded ceremony with a slashing loop, not a vibe.
    **Will they get it?** Yes — the dashed feedback arrow labeled "overturn ⇒ slash" is exactly the kind of relation-labeled arrow the house style calls for (label the *relation*, not a noun).
    **Verdict:** Good. `[needs render]`

12. **Figure 12 — `fig-stp-rate-the-raters.tex`** (Fig.~\ref{fig:rate-raters}, §9, line 1488).
    **Shows:** A vertical audit-level chain (work → judge → re-auditor → next level) beside a boxed statement of Conjecture 3.1's two candidate contraction conditions, explicitly marked "unproved obligation."
    **Takeaway:** Two distinct proof obligations (deterrence, contraction) that a recursive audit design must establish — and the caption is careful to say "Neither obligation is depicted as established."
    **Will they get it?** Yes, and notably: **this figure is more honest than the surrounding prose.** Its caption's hedging directly contradicts the "cured"/"mathematically certain" language in the body text around it (Part A, item 3) — worth noting because it shows the drift is a prose problem, not a figure problem; the figure doesn't need to change once the prose is fixed (see item 3's proposed rewrite for updating the conjecture's status to match the companion paper's closed theorem).
    **Verdict:** Good as-is; will need a one-line caption update *only if* Part A item 3/4's prose fix is adopted (to say the underlying question is closed even though this restatement remains a hand exercise). `[needs render]`

13. **Figure 13 — `fig-stp-tombstone.tex`** (Fig.~\ref{fig:tombstone}, §11, line 1572).
    **Shows:** A chain of four outcomes ($o_1$ honest, $o_2$ honest, $o_3$ fraudulent, $o_4$ honest) with a tombstone appended at the end, curving back to nullify $o_3$ without removing it from the chain.
    **Takeaway:** Append-only compensation, never in-place mutation — caption states this and the monotone-but-revocable correction to "reputation never ends."
    **Will they get it?** Yes — the curved dashed arrow from tombstone back to $o_3$ is a clear, uncommon-enough-to-be-memorable visual metaphor for "nullifies without erasing," and it correctly avoids implying deletion (no strikethrough, no removal).
    **Verdict:** Good. `[needs render]`

## Part C — New figures/examples proposed

1. **Where:** §6 (Identity), immediately after Theorem 6.1's proof (paired with Part A item 6).
   **What it would show:** A two-row numeric table: row 1 an honest actor whose sanction bites ($r(i)=90$, $\Delta=30$ → post-sanction $60 > r_0=50$); row 2 a whitewasher for whom it doesn't ($r(i)=50$, $\Delta=30$ → $20 < r_0=50$, so effective score floors at $r_0$).
   **Why it helps:** Turns the abstract $\max(r(i)-\Delta,\,r_0)$ expression in the proof into something a reader can check on one line, per harbor-exposition Move 5, and sets up the newcomer-ceiling intuition Theorem 6.2 needs next.
   **Kind:** Worked-numeric-example.

2. **Where:** §6 (Identity), after Theorem 6.2 (whitewash-cost), before the `\keyidea{}` at line 968.
   **What it would show:** A small table instantiating $W=\sum_t(\pi(\kappa^\star)-\pi(\kappa_t))$ with concrete numbers — e.g. $\kappa_0=10$, $\kappa^\star=100$, a 5-period linear climb, $\pi(\kappa)=0.1\kappa$ — computing $W$ and comparing it to a stated single-outcome fraud gain $G$, showing numerically when honesty becomes dominant.
   **Why it helps:** The theorem is currently stated and proved with zero numeric instantiation anywhere nearby, unlike every comparable theorem in the two source papers (which follow "state it, then compute it" religiously — see `paper3.tex` line 104). This is the single largest "numbers by hand" gap in the document.
   **Kind:** Worked-numeric-example.

3. **Where:** §9 (Oracle), replacing or supplementing Figure 12's abstract Conjecture-condition box.
   **What it would show:** A regime diagram with axes (re-audit probability $\rho$) × (bond size $B$), shading the region where $\rho d B > G$ (deterrence holds), with the program's actual worked point marked ($G=10, d=0.8, B=50 \Rightarrow \rho^\star=0.25$, taken directly from `paper3.tex`'s reproducible numbers) — the classic Rail-B "regime diagram" the house style mandates for a Move-7 boundary, which this section currently lacks entirely (it has a relation-diagram in Fig. 12 but no boundary/regime figure).
   **Why it helps:** Gives the reader an actual visual boundary for when the mechanism holds, rather than only a prose inequality — and, done alongside Part A items 3–4, replaces the currently-unresolved-looking Conjecture with a picture of an already-closed result.
   **Kind:** Regime-diagram.

4. **Where:** §11 (Revocation, tombstones, bounded memory), after "Bounded memory is a design parameter" (line 1607).
   **What it would show:** A regime diagram with axes (memory window length $\tau$) × (population non-stationarity / type-drift rate), shading where bounded memory is welfare-improving (Liu–Skrzypacz's finding) versus where it isn't — giving visual form to the paper's own claim that "$\infty$-memory is rarely optimal."
   **Why it helps:** This is the one substantive design-parameter argument in the paper with no accompanying figure at all — every other major claim gets a figure; this one is prose-only.
   **Kind:** Regime-diagram.

5. **Where:** §7.1 (Multi-dimensional quality), right after Definition 7.1 (quality vector) and before the S3 scene.
   **What it would show:** A tiny worked dot-product: Bob's stated weight vector $\mathbf{w}=(0.2, 0.6, 0.2)$ (heavy on aesthetics for security-critical code, matching the prose two pages later) applied to $\mathbf{q}=(1.0, 0.7, 0.9)$ from S3, giving a weighted score of $0.78$ — then "now you try" with a different buyer's weights.
   **Why it helps:** Concretizes "the buyer applies their own weighting" (currently asserted, never computed) and pre-seeds the S3 scene's numbers so the reader already recognizes $\mathbf{q}=(1.0,0.7,0.9)$ when it reappears.
   **Kind:** Worked-numeric-example.

6. **Where:** Reader's Map (§0, table `tab:readers-map`) or a new short subsection right after it.
   **What it would show:** A compact table: chapter section → which companion formal paper (paper3 / paper5 / neither, program-level only) it draws its formal backing from, mirroring what Part D of this review had to reconstruct by grepping both files.
   **Why it helps:** The paper is explicit that it bridges *two* formal papers (stated once, in the framing given to this review, but not spelled out for the reader anywhere in the document itself) — a reader trying to go deeper on any one claim currently has to guess which of the two source papers to open. This single table would remove that guesswork and, done honestly, would also surface Part A item 12's gap (the sections with no formal backing in either paper) directly to the reader instead of leaving it implicit.
   **Kind:** Table.

## Part D — Cross-reference notes

**Chapter-to-paper mapping** (established by grepping, not fully reading, both `paper3.tex` and `paper5.tex`):

- **§4 Continuity is a personal-identity problem** (Locke/Parfit, the no-mint theorem status note at lines 695–710) → **paper5**, §"Forks and distillation: reputation you cannot photocopy" (`sec:nomint`). Tight, verified match: the whitepaper's numbers (4,000 fork DAGs, 0 violations, the refuted budget-only chain $0.9+0.81+0.729=2.44>1$, the 2-op mint crime, the 8.2× multiplier from an 8-way copy-fork) are identical to paper5's Theorem 1 and its "wrong turn, reported" box, down to the seed and script name (`a6_no_mint.py`). No drift.
- **§5 The three organs of continuity** → **paper5**, §"Resurrection with teeth" (`sec:resurrection`), *for the reputation-correctness half only*. Paper5's Theorem 3 (resurrection soundness) is genuinely about whether sanctions/scores survive provider migration — a ledger-correctness property — and its own Honest Boundary explicitly refuses the claim that a checkpoint "restored the agent's experience." The whitepaper's Organ 2 discussion conflates this proven ledger-correctness result with an unrelated, ungrounded engineering claim ("Event-Sourced Neural Rehydration... restores the full KV-Cache state... instantly," line 758) that appears nowhere in paper5 (confirmed by grep: zero hits for "rehydrat," "KV-cache," "prompt prefix," "OP-4" in either source paper). **This is the most significant claim drift found in this review** — see Part A items 1–2.
- **§6 Identity: the root the whole chain hangs from** → **paper5**, §"The front gate: the newcomer ramp is a cliff" (`sec:cliff`) and, directly, paper5's own citations of *this whitepaper*. Paper5 line 55 literally cites *"whitepaper Def.~III.6.1 and its necessity theorem"* — "III.6.1" being Chapter III (this document), Section 6 (Identity), Definition 1 (sanction-respecting reputation, `def:sanction-respecting`) — confirming the two documents share a live, correctly-synchronized numbering scheme. Paper5's Theorem 4 (the probation cliff) matches the whitepaper's Theorem 6.3 (front-loaded probation dominance) with identical verification numbers (76,000 candidate schedules, 0 dominating, script `b6_probation.py`, seed 20260816). This is the tightest, best-executed cross-reference in the document — worth calling out as a positive exemplar.
- **§6.5 The keystone split** → correctly scoped to *neither* paper. The whitepaper explicitly hands cross-operator attestation to the (unfetched) market paper, Chapter IV, and paper5's own scope is confirmed single-provider/single-identity (forks, engine swaps, one-provider-to-another migration) — consistent, no drift.
- **§7 The multi-dimensional reputation protocol** and **§8 Why reputation is not a bandit problem** → **no confirmed match in paper3** (or paper5). Grepping paper3 for "quality vector," "multi-dimensional," "aesthetic," "efficiency axis," "bandit," and "EigenTrust" returns zero hits; paper3's actual scope is narrowly the bonded-judge / audit-tower / amortization economics (see next bullet). This does not mean the claims are wrong, but the whitepaper currently gives them the same confident register as its fully-proven sections without flagging the gap — see Part A item 12.
- **§9 The grading oracle's incentive-compatibility** → **paper3**, §"The tower: bribing sealed juries from $C$ cliques" and §"Conjecture III.11.1, parameterized." Strong terminological match (bond $B$, slash, audit probability $\rho$, detection $d$, gain $G$ all used identically in both documents). However: paper3 has **closed** the exact recursion the whitepaper still presents as an open Conjecture (see Part A items 3–4) — the drift here runs in the direction of the whitepaper understating what's proven, not overstating it, which is the opposite failure mode from the checkpoint/rehydration issue in §5 but equally worth fixing, since it leaves both the honest-status ledger and the reader's sense of the frontier stale.
- **§11 Revocation, tombstones, and bounded memory** → terminologically closer to **paper3** than to paper5, despite sitting in the continuity-adjacent back half of the chapter: paper3's Model B (line 144) names "tombstoned provenance" as one of the channels by which cheats "surface without audits," which is the same vocabulary the whitepaper's tombstone protocol uses. Liu–Skrzypacz (bounded-memory reputation bubbles) is cited by the whitepaper but does not appear to be a load-bearing citation in either formal paper as grepped — likely an independently-imported piece of prior art rather than a companion-paper result, which is consistent with how §2 (Prior art) frames it.

**Summary of the mapping:** the identity/continuity spine (§4, §6) is the tightest, most reliable cross-reference in the whitepaper — genuinely well-engineered, two-way-consistent, numerically synchronized. The reputation/audit spine (§9) is well-grounded in vocabulary but stale in status (understates what paper3 proves). The checkpoint/organ claim in §5 and the multi-dimensional-vector/bandit material in §7–§8 are the two places where the whitepaper's confident tone runs ahead of (§5) or beside (§7–§8) what either named formal paper actually establishes.

## Summary

1. **Highest priority:** §5's "Event-Sourced Neural Rehydration (OP-4)... solved... instantly" claim (lines 758, 1689) directly contradicts the paper's own maturity ledger and is explicitly disclaimed by paper5's own Honest Boundary ("nothing here says the checkpoint restored the agent's experience"). Fix per Part A items 1–2 before anything else ships.
2. **High priority, same root cause:** §9's VRF-honeypot/Model-Heterogeneity passage claims a "mathematically certain" cure for a result it also boxes as an unproven Conjecture and lists as an open problem — three inconsistent confidence levels for one claim. Worse, paper3 has actually *closed* this as a theorem with reproducible numbers the whitepaper never imports. Fix per Part A items 3–4 and Part C item 3; this is a rare case where the honest fix is to claim *more*, not less.
3. **High priority, visual craft:** `fig-stp-three-organs.tex` is the one figure in the set that breaks the shared TikZ style (its own local box/fill styles) and mislabels the outcome ledger `[Core Implemented]` against the caption's own `\BUILTWEAK` two lines below — the house style's "lonely figure" and "off-label maturity" defects in one figure. Rebuild it from the shared `stp box` styles (Part B item 4).
4. Two structural craft gaps worth fixing together: the Definitions-First opening of §3 (Part A item 5) and the missing worked numbers around Theorems 6.1–6.2 (Part A items 6, 14; Part C items 1–2) — both are places where the paper's otherwise-strong concrete-before-abstract discipline (the S1–S4 device) lapses exactly where the reader most needs it, on the paper's two central theorems.
5. The exercise/open-problem numbering has drifted out of sync with itself across at least five blocks (Part A item 7) — low-cost, high-visibility fix: either cross-reference by name instead of number, or renumber once, consistently.
6. The identity/continuity cross-reference between this whitepaper and paper5 is genuinely excellent — live, bidirectional, numerically synchronized (Def. III.6.1, the no-mint numbers, the probation-cliff numbers all match exactly). Worth preserving as the standard the rest of the series should be held to.
7. Two content areas (§7 multi-dimensional reputation, §8 bandit argument) currently read with full theorem-grade confidence but have no confirmed grounding in either named companion paper — not necessarily wrong, but the paper's own honesty apparatus should say so (Part A item 12, Part C item 6).
