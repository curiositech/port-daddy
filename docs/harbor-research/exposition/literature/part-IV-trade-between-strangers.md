# Literature review: Part IV, "Trade Between Strangers"

*Chapters 6–8 of "The Harbor, the Person, and the Economy" — The Harbor Economy, The Bonded Commons, The Federated Harbor. Reviewed against mechanism design, market design, cryptoeconomics, repeated-game theory, commons governance, deontic logic and compliance checking, temporal constraint networks, queueing theory, Byzantine accountability, gossip protocols, applied topology, and federation protocols.*

## Verdict, in two paragraphs

Part IV stands on unusually firm ground for a self-published research program, and it earns that footing the hard way: by naming the field that already owns each claim and stating exactly what corner of it the harbor design gives up. The three whitepapers and the two standalone research papers behind them (`paper6.tex`, `paper7.tex`) already carry "Related work" sections citing Myerson–Satterthwaite, Rochet–Tirole, Ostrom, Sen, Aumann, Akerlof, Grossman–Hart, Fischer–Lynch–Paterson, Dechter–Meiri–Pearl, Herlihy–Kozlov–Rajsbaum, Hansen–Ghrist, Robinson, Abramsky–Brandenburger, PeerReview, Certificate Transparency, Demers's epidemic gossip, Sagas, and the current agentic-commerce protocol stack (UCP, ACP, AP2, Macaroons, UCAN, OpenID Federation) — and every one of those citations checked out against a live search. Where the book has a real result — bond-ledger conservation, the deontic-fragment/NP-complete frontier, the succession-price closed form, the claim-signaling discount threshold, the sheaf consistency radius — it states the result's exact boundary at the same prominence as the claim, discipline an external reviewer usually has to force out of a paper by objection. The book does not need to be told most of what a literature review would tell it; it already tells itself.

Where it is exposed is not in the theorems it states but in the gaps it has flagged as unsearched and the comparisons it has not made. The book's own paper6 admits "we have not run a systematic pass" against the computational normative-multi-agent-systems conflict-detection literature — and that search, run here, finds a tractable/NP-hard frontier for regulatory-compliance checking (Colombo Tosatto, Governatori, van Beest) close enough to the book's $\mathcal{L}_c$ fragment/NP-complete pair that the novelty claim needs re-scoping, not abandonment. Three headline mechanisms — Myerson–Satterthwaite budget balance, the repeated-game claim-signaling threshold, and the folk-theorem monitoring requirement — rest on textbook results correctly cited but applied to a market whose own incentive compatibility has not itself been proven; the book concedes this ("has not proved truthfulness"), which is honest but does not shrink the exposure. And the federation chapter, despite naming OpenID Federation, UCAN, and Macaroons as its nearest neighbors, never engages ActivityPub, Matrix, or SPKI/SDSI — federation protocols with decades of production deployment solving exactly the trust-boundary problem the chapter targets. That is a real gap, not a fatal one; the rest of this review works through each idea in turn.

## Idea 1 — A three-sided market on one conserving ledger

**What the book claims.** Chapter 6, §"What a 'side' is, and why there are three": the harbor economy has three distinct incentive constraints — operator-for-hire (labor), agent-as-rentable-asset (capital), skill-as-licensed-good (IP) — not the two a naive requester/worker reading would suggest, and "the operational test is: how many distinct, privately-informed parties must the platform individually rationalize into participating." Stated as a **theorem-adjacent design claim** (C1 in the thesis section), not a proof.

**Other names for it.** Economics: *multi-sided platform*, *N-sided market*. Mechanism design: counting by *incentive constraints* rather than UI roles.

**Prior work.** Rochet & Tirole (2003), *Platform Competition in Two-Sided Markets*, JEEA 1(4):990–1029 [verified, cited 1800+ times, a basis of Tirole's 2014 Nobel]: a market is two-sided when the *allocation* of price across groups, not just its level, moves volume. Armstrong (2006) extends the frame. Chiu, Zhang & van der Schaar, *When AI Agents Compete for Jobs*, arXiv:2512.04988 [verified, van der Schaar Lab, Cambridge]: a simulated gig economy ("AI-Work") where agents bid, build reputation, and choose earning vs. upskilling. The book cites it as "a formal model of a three-sided agent labor market"; its actual emphasis is adverse selection, moral hazard, and reputation dynamics — directionally right (agents, employers, and a reputation mechanism are all present) but a slight overstatement of it as confirmation of the specific three-side structure.

**How the book's version differs.** The novel move is not the two-sided frame (textbook) but locating a *third* side inside what looks like one counterparty — separating the agent (capability) from the operator (liability) from the skill (competence) — and then showing all three settle on one escrow object rather than three separate rails.

**What an expert would push back on.** A platform-markets economist would ask for the cross-side network-effect elasticities the Rochet–Tirole frame is built around, which the chapter does not supply (it states subsidy discipline qualitatively in the cold-start section but has no estimated demand system). They would also ask whether "capital" and "IP" are genuinely separate sides or two instances of a single "principal is not the same as the working unit" side — the book itself concedes "if the asset owner is always the task poster, side 2 collapses into side 1," which is the honest form of this objection.

**Verdict: firm, with an unquantified subsidy structure.** The three-way decomposition is a reasonable and cited application of standard platform theory; what remains unverified is the platform-design prescription (who to subsidize) that the theory exists to produce.

**Reading list.** Rochet & Tirole (2003); Armstrong (2006), *Competition in Two-Sided Markets*, RAND J. Econ.; Chiu, Zhang & van der Schaar, arXiv:2512.04988.

## Idea 2 — Renting trust between strangers once records cannot be minted

**What the book claims.** "The score is cheap; the substrate it scores over — witnessed outcomes on a non-forgeable identity — is the gate" (pullquote, §"The through-line"). Reputation requires an identity that cannot be costlessly forked, i.e. Sybil resistance is upstream of any reputation mechanism. **Design invariant / stated dependency**, not a theorem.

**Other names for it.** Distributed systems: *Sybil resistance*. Reputation-systems literature: the *identity-persistence precondition* for any reputation mechanism. Economics: the "hosted trust" framing is close to *certification intermediary* theory.

**Prior work.** Douceur, *The Sybil Attack*, IPTPS 2002 [verified]: without a logically central authority, an attacker can always mint identities except under unrealistic resource-parity assumptions — the theorem the book's dependency chain rests on but correctly treats as settled background rather than re-proving. Resnick, Zeckhauser et al. and Tadelis (cited by the book, not independently re-verified here) supply the empirical value-of-reputation literature. Liu & Skrzypacz, *Limited Records and Reputation Bubbles*, J. Econ. Theory 151:2–29 (2014) [verified]: unbounded reputation records produce *bubbles*, not stability — the argument the book uses to justify a bounded reputation horizon rather than "never decays."

**How the book's version differs.** Restatement, correctly attributed. The book's own contribution is narrow and explicit: reconciling "reputation never decays" with "a fraudulent outcome must be retractable" via a monotone-but-tombstoneable design (Theorem, "Compensation does not erase reliance") — a genuinely new synthesis of Sagas-style compensation (Garcia-Molina & Salem, *Sagas*, SIGMOD 1987 [verified, 608+ citations]) against reputation semantics, showing the analogy *fails*: a ledger balance can be restored by a compensating transaction, but counterparties who already relied on a false outcome cannot be un-relied-upon.

**What an expert would push back on.** A reputation-systems economist would want the tombstone-propagation delay quantified against the value at stake during that delay — the book supplies this only as an open conjecture (the Equivocation Lower Bound, §"Revocation gossip"), not a proof.

**Verdict: firm — a correct, well-cited restatement plus one genuinely new negative result** (Sagas compensation does not restore reliance), stated as a theorem with an honest scope.

**Reading list.** Douceur (2002); Liu & Skrzypacz (2014); Garcia-Molina & Salem (1987); Resnick, Kuwabara, Zeckhauser & Friedman, *Reputation Systems*, CACM 43(12), 2000.

## Idea 3 — The bond ledger's conservation law

**What the book claims. ** "$\text{wallet} + \text{escrow} + \text{commons} = \text{supply}$, always... verified across ten thousand random operation traces by a property test." Labeled **Design invariant**, graded **Built** — the one claim in Chapter 6 the book itself flags as actually running code, not a model.

**Other names for it.** Distributed systems: a *safety invariant*. Accounting: *double-entry conservation*. Formal methods: a *property-based test* (à la QuickCheck) standing in for, but not equal to, a proof.

**Prior work.** This is closest to conservation invariants in payment-channel and escrow systems generally — no single canonical paper, but standard practice in smart-contract auditing (the "total supply invariant" pattern used throughout DeFi security review); the book cites no specific source for this and none better is found here. The composition claim borrows vocabulary from Fong & Spivak, *An Invitation to Applied Category Theory* (Cambridge UP, 2019) [consistent with well-established published work], though the book is explicit that "category language can describe trace composition, but it does not add a currency-conversion theorem" — an unusually disciplined refusal to let notation imply more than it proves.

**How the book's version differs.** Not a restatement of a named theorem so much as an application of a well-understood accounting discipline (ten-thousand-trace property testing) to a specific escrow schema, extended (as a **Designed**, not **Built**, claim) to cross-harbor and multi-side settlement.

**What an expert would push back on.** Ten thousand random traces is a strong regression signal but not a proof; the invariant's *design*-time correctness (does the escrow row capture every code path that moves value) is not established by the property test, only its behavior on paths the generator reaches. A TLA+ practitioner would ask why the code is only property-tested rather than model-checked against the same TLA+ spec that covers the neighboring claim-signaling and cross-harbor conservation properties (`EscrowInvariant`) — the asymmetry is real.

**Verdict: firm.** This is the one claim in the whole part that is graded **Built** rather than modeled, and the grading is honest about what a property test does and does not establish.

**Reading list.** Fong & Spivak (2019); general reference: Hughes, *QuickCheck: A Lightweight Tool for Random Testing of Haskell Programs*, ICFP 2000, for the property-testing method the ledger check exemplifies.

## Idea 4 — Two-of-three settlement among customer, provider, and witness

**What the book claims.** Cross-harbor settlement uses "a 2-of-3 Multisig Clearinghouse (Harbor A, Harbor B, Federation Arbiter)"; under the happy path both harbors sign and the arbiter is unnecessary, and "Bounded Custody Loss" (Design Invariant, conditional) holds a counterparty's worst-case loss to a pre-agreed fee $\varphi$ *if* the custody ledger is non-bypassable.

**Other names for it.** Cryptography/systems: *threshold signing*, *m-of-n multisig escrow*. Distributed transactions: *witness-based settlement*, close to a *trusted third party / watchtower* pattern (the book's own term).

**Prior work.** Herlihy, *Atomic Cross-Chain Swaps*, PODC 2018 [verified, standard HTLC reference]: trustless swaps via hash-timelock contracts for fungible assets with a shared hash preimage. Herlihy, Liskov & Shrira, *Cross-Chain Deals and Adversarial Commerce*, VLDB Journal 31:1291–1309 (2022; originally VLDB 2019, arXiv:1905.09743) [verified]: multi-party cross-chain deals with safety/liveness properties for independent ledgers — the correct comparison class the book names for itself, and honestly: it locates its own escrow as "a trusted third party / watchtower point," not trustless in Herlihy's sense.

**How the book's version differs.** HTLCs and cross-chain-deals machinery assume fungible, hash-lockable assets; the harbor's bonds are non-fungible and reputation-priced, so a shared-preimage construction does not transfer. The book states this as an **open problem** rather than claiming to have solved it — correct and modest.

**What an expert would push back on.** Why 2-of-3 rather than a threshold scheme with an explicit adversary model — 2-of-3 tolerates one dishonest party by construction, but the arbiter-collusion case is not walked through explicitly in the sections read here. They would also want the "non-bypassable" custody-ledger hypothesis discharged by a runtime conformance check, which the book concedes does not exist.

**Verdict: honest open problem, correctly scoped — not "solved," and the book says so.** The self-comparison to Herlihy's line is accurate and the non-triviality of extending HTLCs to non-fungible bonds is real.

**Reading list.** Herlihy (2018); Herlihy, Liskov & Shrira (2022); Goes, *The Interblockchain Communication Protocol*, arXiv:2006.17532 (cited by the federation chapter as a channel/connection comparison, not independently re-verified here but a well-known standard reference).

## Idea 5 — The Myerson–Satterthwaite boundary applied to a bilateral rental slice

**What the book claims.** "For any bilateral slice of this market satisfying the Myerson–Satterthwaite assumptions... no mechanism is also ex-post efficient everywhere" (Theorem, "Conditional bilateral-trade boundary"), worked out numerically: on Bob-rents-$a_2$ with values uniform on $[0,90]$, about 21.9% of realizations that would be efficient to trade go untraded under the incentive-compatible, budget-balanced, individually-rational mechanism (the Chatterjee–Samuelson double auction).

**Other names for it.** Mechanism design: the *Myerson–Satterthwaite impossibility theorem*, one of the most cited results in the field.

**Prior work.** Myerson & Satterthwaite, *Efficient Mechanisms for Bilateral Trading*, J. Econ. Theory 29(2):265–281 (1983) [verified, 2700+ citations]: no mechanism is simultaneously Bayesian incentive compatible, interim individually rational, budget balanced, and ex-post efficient for independent private values on overlapping continuous supports. Chatterjee & Samuelson, *Bargaining Under Incomplete Information*, Operations Research 31(5):835–851 (1983) [verified]: the linear double-auction equilibrium the book instantiates numerically on $[0,M]$, consistent with the standard form modulo normalization of $M$ (not independently re-derived bit-for-bit here).

**How the book's version differs.** This is a textbook impossibility theorem applied to a new domain (agent-rental markets), not a new theorem. The book's contribution is entirely the numerical instantiation — showing the abstract impossibility as a concrete 21.9%-of-trades-refused number on the chapter's own running example — which is good pedagogy and an honest way to make an abstract result "hand-checkable," but it is not a novel mechanism-design result.

**What an expert would push back on.** The AGV (d'Aspremont–Gérard-Varet) mechanism achieves ex-post efficiency and budget balance at the cost of only expected (not interim) individual rationality — the book names this alternative and correctly declines to compare it rigorously, the right caution, but it leaves the market's actual mechanism unclassified relative to the full space of budget-balanced mechanisms.

**Verdict: known result, correctly restated and instantiated — firm as an application, silent on whether the harbor's own mechanism is even Bayesian incentive compatible**, which the book itself flags ("has not proved truthfulness").

**Reading list.** Myerson & Satterthwaite (1983); Chatterjee & Samuelson (1983); Myerson & Satterthwaite's own citation of d'Aspremont & Gérard-Varet (1979) for the AGV alternative.

## Idea 6 — Claim-signaling incentive compatibility: the discount-factor threshold

**What the book claims.** File-claim signaling is a one-shot Prisoner's Dilemma (mutual truth $(3,3)$ dominated by $(F,F)$); with observable history, persistent identity, and a discount factor $\delta$, a graduated-trigger strategy sustains truthful signaling above $\delta^\star_{k=3} \approx 0.342$ (root of $2\delta^3+2\delta^2+2\delta-1=0$), close to the grim-trigger folk-theorem bound $\delta \ge 1/3$. **Theorem**, mechanically checked (`claim_signaling.tla`, `delta-threshold.z3`).

**Other names for it.** Game theory: the *folk theorem for repeated games*, *grim trigger* / *tit-for-tat with graduated punishment*. This is a direct, textbook application, not a new theorem.

**Prior work.** The folk theorem itself (Friedman 1971 for the basic form; Abreu, Pearce & Stacchetti (1990) [matches a well-known imperfect-public-monitoring folk-theorem paper] for the extension the book needs elsewhere). The $1/3$ grim-trigger threshold for a $(3,4,1)$-payoff Prisoner's Dilemma is standard graduate-textbook material (Fudenberg & Tirole, *Game Theory*; Mailath & Samuelson, *Repeated Games and Reputations*), not a contested result.

**How the book's version differs.** The three-round graduated trigger in place of grim trigger, motivated explicitly by the crash-vs-defection indistinguishability problem (a dead agent looks like a defecting agent to a third-party observer) — this is a reasonable and clearly-motivated engineering variant of the standard construction, and the book correctly computes that it costs "barely 0.009" over the grim-trigger bound. This is good applied game theory, not new game theory.

**What an expert would push back on.** Two things. First, the folk theorem requires *public* monitoring of the relevant history; the book's own grading-oracle theorem (Idea 13) requires the signal be mechanically constrained or the grader bonded, but that caveat is worked through for settlement, not explicitly for the claim signal itself — it is not fully clear the claim-signal's own no-noise observability assumption gets the same rigor. Second, $\delta \approx 0.9$ is asserted as "a working operating point" with no empirical basis for how patient real deployed agents actually are — plausible, not measured.

**Verdict: firm as mechanized mathematics, calibration is an assumption not a measurement.** The cubic root and the TLA+/Z3 check are real and hand-verified in the text; the economic inputs ($\delta \approx 0.9$, the payoff table $(3,4,1)$) are stipulated, not estimated from data.

**Reading list.** Abreu, Pearce & Stacchetti (1990); Fudenberg & Maskin, *The Folk Theorem in Repeated Games with Discounting or with Incomplete Information*, Econometrica 1986; Mailath & Samuelson, *Repeated Games and Reputations*, Oxford UP 2006.

## Idea 7 — The sole-specialist vs. pool boundary: the succession price

**What the book claims.** Renting a single reputable specialist beats a pool only while the specialist's mortality-to-succession ratio $\xi/\eta$ stays below a **succession price** $D^\star = \eta K/(1-\eta K)$; past that, "no amount of skill buys back a mortality-to-succession ratio worse than $D^\star$." **Theorem**, cross-validated by matrix-geometric solution, truncated chain, and simulation; a "wrong turn" is reported (a naive decomposition predicts $4.17$ where the correct answer is $8.17$).

**Other names for it.** Operations research / queueing theory: this is a *many-server pooling vs. dedicated-server* comparison under an *M/M/1 queue with breakdowns* — call-center literature calls the underlying question *server flexibility* or *skill-based routing*.

**Prior work.** Erlang's C formula (1917, cited by the book) for the pool's baseline wait. Smith & Whitt (1981) [matches a well-known resource-pooling paper on when sharing servers helps or, under heterogeneity, hurts]. Halfin & Whitt, *Heavy-Traffic Limits for Queues with Many Exponential Servers*, Operations Research 29(3):567–588 (1981) [verified]: the many-server heavy-traffic (QED) regime in which pooling economies are usually quantified. Mitrany & Avi-Itzhak, *A Many-Server Queue with Service Interruptions*, Operations Research 16:628–638 (1968) [verified]: the breakdown-queue ancestor line the book's $W_{\mathrm{bd}}$ descends from. Gans, Koole & Mandelbaum (2003) is named by the book's own paper6 as the entry point for call-center *skill-based-routing* vocabulary — and paper6 flags that this literature has not been searched systematically, which this review's time budget did not fully discharge either; a real, self-declared open item.

**How the book's version differs.** The specific closed form for $W_{\mathrm{bd}}$ under *death-at-all-times with preemptive resume* breakdowns, and its exact crossing condition $D^\star$ against a pool's Erlang-C-plus-overhead cost line, appears to be a genuine (if modest) new derivation in the Mitrany–Avi-Itzhak lineage rather than a restatement of an existing closed form — the book reports its own falsification of an earlier internal approximation ($\tilde g$) as evidence the derivation was actually checked rather than assumed.

**What an expert would push back on.** A queueing theorist would ask about tail behavior: the theorem explicitly compares *mean* costs only, under FCFS and exponential-everything, and the book states this itself as a boundary condition rather than hiding it. They would also ask whether "skill-based routing" — the closer real-world term for exactly this specialist/pool tradeoff — has already produced a closed form matching $D^\star$; the book's own related-work section names this as an undischarged search obligation.

**Verdict: firm derivation, positioned inside a named prior lineage, with one self-declared literature gap (skill-based routing) not yet closed.**

**Reading list.** Halfin & Whitt (1981); Mitrany & Avi-Itzhak (1968); Gans, Koole & Mandelbaum (2003); Whitt, *Understanding the Efficiency of Multi-Server Service Systems*, Management Science 1992, for the classical pooling-economy intuition.

## Idea 8 — The tractable deontic-conflict fragment, its NP-complete frontier, and "an authority is needed where the algorithm ends"

**What the book claims.** A restricted deontic-commitment fragment $\mathcal{L}_c$ (ground, no nested modalities, no negation-as-failure, monotone Horn bodies) admits conflict detection in $O(H + T\log T + X\log X + V\cdot E)$ with a polynomial witness (Theorem 1, "In-fragment conflict detection is polynomial and witness-producing"); one step outside the fragment — disjunctive obligations under discharge-choice semantics — conflict-freedom becomes NP-complete (Theorem 2, reduction from 3-SAT). The organizing slogan, from paper6: an authority (a human, a "chartered resolver") is needed exactly where the checkable algorithm runs out — i.e., past the tractable fragment's boundary.

**Other names for it.** AI/knowledge representation: *deontic logic*, *normative conflict detection*. Constraint satisfaction: the *tractable/NP-hard dichotomy* for temporal and Boolean constraint languages (Schaefer's dichotomy theorem is the classical ancestor of this style of result, though the book does not cite Schaefer directly). Business-process compliance: *regulatory compliance checking*.

**Prior work.** Dechter, Meiri & Pearl, *Temporal constraint networks*, Artificial Intelligence 49:61–95 (1991) [verified, 570+ citations]: establishes exactly the polynomial simple-temporal-problem / NP-hard disjunctive-temporal-problem dichotomy the book's deadline-graph half of $\mathcal{L}_c$ inherits — correctly cited and essential to the proof. Stergiou & Koubarakis (2000), the algorithmic successor, also cited. Dowling & Gallier (1984) for linear-time Horn satisfiability, correctly imported unchanged. **The gap the book names and this review partly closes:** Colombo Tosatto, Governatori & van Beest, *Business Process Full Compliance with Respect to a Set of Conditional Obligations in Polynomial Time*, arXiv:2001.10148 [verified] and *Proving Regulatory Compliance: Full Compliance Against an Expressive Unconditional Obligation is coNP-Complete*, arXiv:2105.05431 [verified]. This is a directly adjacent tractable/intractable dichotomy for norm-compliance checking — the exact shape of result ($\mathcal{L}_c$-style fragment tractable, one natural extension intractable) that the book's own honest boundary says it has not searched for. It does not subsume Theorems 1/2 (different formal object — structured business processes vs. Horn-triggered ground deontic tokens with interval exclusivity — and a different complexity class, coNP vs. NP), but the *shape* of "tractable fragment, one extension from hardness" in normative-conflict checking is not new, and a reviewer familiar with Governatori's group (publishing under the Regorous name since roughly 2013) would likely raise it.

**How the book's version differs.** The fragment is scoped around scheduling/coordination primitives (interval exclusivity, a difference-constraint deadline graph) rather than business-process control-flow, and the hardness reduction is from 3-SAT via disjunctive obligations rather than an unconditional-obligation extension — genuinely different formal objects in the same complexity-theoretic neighborhood, not a duplicate.

**What an expert would push back on.** A knowledge-representation reviewer would ask for a direct reduction or equivalence argument between $\mathcal{L}_c$-conflict-freedom and the compliance-checking fragment above, to establish whether the book's result is strictly novel, a special case, or a generalization. The book's own text (paper6, "Where the prior-art search is not yet discharged, said plainly") anticipates and concedes exactly this.

**Verdict: contested — likely a novel formalization of an already-known dichotomy shape, not yet checked against the nearest neighbor.** The individual theorems are internally sound and mechanically validated (3000-instance oracle sweep, 16/16 reduction verification), but "no prior work found" (paper6's own August-2026 survey claim) does not survive this review's search: the Colombo Tosatto/Governatori/van Beest line is close enough to warrant explicit comparison before the novelty claim is finalized.

**Reading list.** Dechter, Meiri & Pearl (1991); Colombo Tosatto, Governatori & van Beest, arXiv:2001.10148, arXiv:2105.05431; Schaefer, STOC 1978, for the general dichotomy pattern (not cited by the book).

## Idea 9 — Federation refuses consensus: relaying evidence, not sovereignty

**What the book claims.** "A system that needs agreement on a global event order across operators it does not control is dead on arrival, by Fischer–Lynch–Paterson." Federation instead requires only append-only per-harbor logs, gossip-bounded propagation, and *detectable* (not prevented) equivocation — a Certificate-Transparency posture. **Design invariant / architectural stance**, explicitly grounded in a named impossibility result rather than routing around it.

**Other names for it.** Distributed systems: the *FLP impossibility*, *partial synchrony*, *detect-don't-prevent* (Certificate Transparency's own framing).

**Prior work.** Fischer, Lynch & Paterson, JACM 32(2):374–382 (1985) [verified, Dijkstra Prize-winning]. Dwork, Lynch & Stockmeyer, *Consensus in the Presence of Partial Synchrony*, JACM 1988 [matches the standard "escape from FLP" reference]. Laurie, Langley & Kasper, RFC 6962 (2013) [verified]. Demers et al. (1987) [verified].

**How the book's version differs.** A correct, well-cited application of a 40-year-old impossibility result to justify *not* attempting a design (global consensus across mutually distrustful harbors), not a new result. The value is architectural discipline, correctly attributed.

**What an expert would push back on.** The book already states outright that "gossip every $\Delta$" smuggles in a partial-synchrony assumption, forestalling that objection. A reviewer might still ask for a Byzantine-specific partial-synchrony result (e.g. PBFT-style view-change bounds) rather than only the crash-fault DLS line, since Chapter 8's threat model includes malicious harbors, not just crashes — this refinement is absent.

**Verdict: firm.** A textbook impossibility result applied honestly to justify an architectural choice; no overclaim detected.

**Reading list.** Fischer, Lynch & Paterson (1985); Dwork, Lynch & Stockmeyer (1988); Castro & Liskov, *Practical Byzantine Fault Tolerance*, OSDI 1999, for the Byzantine-specific partial-synchrony refinement not cited by the book.

## Idea 10 — Revocation gossip and the equivocation race window

**What the book claims.** Federated revocation propagates by anti-entropy gossip with a cuckoo filter, giving expected $\Theta(\Delta \log m)$ dissemination under a connected reliable-round model; a **conjectured** Equivocation Lower Bound requires the witness bond to dominate the value spendable during the detection window, or the system must fail closed. Adversarial peer-selection (eclipse attacks) breaks the expectation.

**Other names for it.** Distributed systems: *anti-entropy*, *epidemic protocols*. Security: *eclipse attacks*. PKI: *revocation-list propagation delay*, a decades-old problem in its own right (OCSP/CRL staleness).

**Prior work.** Demers et al. (1987) [verified, above]. Heilman, Kendler, Zohar & Goldberg, *Eclipse Attacks on Bitcoin's Peer-to-Peer Network*, USENIX Security 2015 [matches a well-known, widely cited eclipse-attack paper]. Certificate Transparency (Laurie et al., verified above) for the detect-after-the-fact posture.

**How the book's version differs.** The specific pairing of a slashable bond against a *conjectured* (not proven) lower bound on the value extractable during the propagation window is the book's own contribution, and it is honestly labeled a conjecture rather than a theorem — this is exactly the right epistemic status for an unproven claim, and the book does not attempt to dress it up.

**What an expert would push back on.** A security researcher would want the "eventual connectivity and a known post-stabilization delivery bound" assumption stress-tested against a concrete adversarial network model (e.g., an adaptive adversary that specifically targets the gossip topology, not just eclipses a victim) before the bond-sizing conjecture could be trusted operationally. The book agrees this is open.

**Verdict: novel and explicitly unverified — the book's own conjecture label is correct and should be taken at face value.**

**Reading list.** Demers et al. (1987); Heilman et al. (2015); Laurie, Langley & Kasper (2013).

## Idea 11 — The consistency radius: sheaf-based equivocation detection on cycles, blind on cut edges

**What the book claims (paper7, "The Cohomology of Equivocation," R6 in the library index).** For a single equivocator gossiping signed log heads, detection of a split-view lie *beyond* pairwise comparison is possible **iff** the unchecked edge lies on a cycle of the visible (compared-plus-relayed) coordinate subgraph; on a cut edge the completion residual $r=0$ by algebra, and across a severed edge equivocation is *provably dark*. The residual has closed form $r = |s|\sqrt{1 - R^{K_c}_{\mathrm{eff}}(e)}$ and computes via per-coordinate graph Laplacians in $\widetilde{O}(|E|\cdot L)$. **Theorem**, backed by a pre-registered statistical harness (verdict COMMIT).

**Other names for it.** Applied topology: *cellular sheaves*, *sheaf cohomology*, *consistency radius*. Physics/foundations: *contextuality* (the same local-consistent-but-globally-unglueable structure as a Bell-inequality violation). Distributed computing: the topological line founded by the 2004 Gödel Prize work; systems security: *fork detection* / *equivocation detection*.

**Prior work — imported, correctly and precisely.** Abramsky & Brandenburger, *The Sheaf-Theoretic Structure of Non-Locality and Contextuality*, New J. Phys. 13, 113036 (2011; arXiv:1102.0264) [verified]: the local-consistency-without-a-global-section structure the book imports "exactly as that program fixed it." Curry (cellular sheaves on graphs, standard coboundary-calculus reference). Hansen & Ghrist, *Toward a Spectral Theory of Cellular Sheaves*, J. Applied and Computational Topology 3:315–358 (2019; arXiv:1808.01513) [verified]: the sheaf Laplacian the mechanism relies on. Robinson, *Sheaves are the canonical data structure for sensor integration*, Information Fusion (2017; arXiv:1603.01446) [verified]: the consistency-radius concept itself, of which the book's $r$ is "its least-squares completion form." Spielman & Teng, nearly-linear Laplacian solvers [standard, well-established line]. **Adjacent, correctly distinguished.** Herlihy & Shavit and Saks & Zaharoglou (2004 Gödel Prize, verified) founded topological distributed computing by asking which *tasks* are wait-free solvable; Herlihy, Kozlov & Rajsbaum, *Distributed Computing Through Combinatorial Topology* (2014) [verified] is the standard text — that program studies simplicial complexes of *possible process views before execution*, while paper7 studies cellular sheaves of *actual reported data after one execution*, a genuinely different object. Haeberlen, Kuznetsov & Druschel, *PeerReview* (SOSP 2007) [verified]: correctly identified as the systems ancestor whose witness-set assumption (some correct node eventually sees both sides of any comparison) is exactly what paper7's "relayed tier" describes the failure of.

**How the book's version differs.** This is the strongest and most original result in Part IV. It is not a restatement: it answers a question (can cohomology convict equivocation across a link that direct comparison never checked, using only cycle-relayed evidence) that the adjacent literatures do not ask in this form — PeerReview assumes the comparison point exists; the topological-distributed-computing line asks about tasks, not post-hoc forensics on real coefficient data.

**What an expert would push back on.** The four points the book's own "Honest boundary" section already states as theorem-grade limitations: (1) single-equivocator scope only — a coordinated coalition on a shared cycle cancels to a measured residual of $6\times10^{-15}$; (2) the detector never attributes, only localizes — it cannot say which of two endpoints lied; (3) $r=0$ is never an all-clear (uniform/kernel lies are invisible in principle, severed edges admit consistent counterfactuals, and the Carù gap means a vanishing real-coefficient signal does not certify gluability in richer coefficient systems); (4) severing one link darkens the entire loop it sat on. An expert would also probe the book's own citation of Bach's #P-hardness of coherent-sheaf cohomology, which it discloses resting on a secondary source it could not verify against the primary text — a disclosed, not hidden, gap.

**Verdict: firm, and the most original contribution in Part IV.** The scope discipline — proving darkness outside the theorem's boundary rather than only proving detection inside it — is exactly what distinguishes a defensible result from an overclaimed one, and the related-work section is more careful about the difference between "imported," "adjacent," and "new" than most published papers in this space.

**Reading list.** Abramsky & Brandenburger (2011); Hansen & Ghrist (2019); Robinson (2017, arXiv:1603.01446); Herlihy, Kozlov & Rajsbaum (2014); Haeberlen, Kuznetsov & Druschel (2007).

## Idea 12 — Coalition cancellation: the limit of the sheaf method

**What the book claims.** Within paper7's own honest boundary: two coordinated equivocators on a common cycle, each independently certified with residual $r \ge |s|/\sqrt{8}$, jointly cancel to $r = 6\times10^{-15}$ when acting together — a measured, not merely argued, demonstration that the detector's soundness ($r>0$ implies a real lie) is unconditional but its *detection* is conditional on a single-equivocator scope.

**Other names for it.** This is structurally the same phenomenon as a *coboundary of a joint deviation* canceling in any cohomological detection scheme — the general principle that a linear (here: least-squares/cohomological) detector can be blinded by a coordinated, structured attack even when it is sound against an unstructured one. The closest named analogue outside this specific literature is *collusion-resistance* in mechanism design and *Byzantine coalition* results in fault-tolerant systems (e.g., the standard $n \ge 3f+1$ threshold results), though the book does not draw this connection explicitly.

**Prior work.** No prior work was found, in the time available, that names this exact cancellation phenomenon for cellular-sheaf equivocation detection — unsurprising, since paper7's whole mechanism is itself new; the cancellation is a boundary of the book's *own* method, not an application of someone else's. The general pattern (coordinated deviations canceling in a linear detector) is well known in signal-processing collusion literature (e.g. watermark-collusion attacks in digital fingerprinting), but no paper stating the identical construction was found.

**How the book's version differs; what an expert would push back on.** N/A in the ordinary sense — this is the book's own stated limitation, not a borrowed claim. A security reviewer would ask how large a coalition needs to be, structurally, to cancel a given lie — always exactly two, or do larger coalitions on longer cycles cancel more or less easily? The book supplies one measured instance, not a general characterization.

**Verdict: honestly stated open boundary — not a claim to evaluate against prior art, but a self-identified gap that should be tracked as future work** (a natural next theorem: characterize detectable vs. undetectable coalitions by cycle structure).

**Reading list.** No close external match found; adjacent: Boneh & Shaw, *Collusion-Secure Fingerprinting for Digital Data*, CRYPTO 1995, for the general "structured collusion defeats a linear detector" pattern in an unrelated domain.

## Idea 13 — Reputation is monotone in honest outcomes but revocable, and the grading oracle must be modeled

**What the book claims.** "Reputation is monotone in honest witnessed outcomes, but a witnessed outcome is itself revocable via a propagating tombstone." Separately: "an imperfect-public-monitoring equilibrium result requires a specified conditional distribution of public signals given modeled actions and strategies. If a strategic grader chooses the signal but is omitted from the game, that distribution is not fixed by the model and the claimed equilibrium result is unsupported" (Theorem, "The monitoring model must include the evaluator").

**Other names for it.** Repeated-game theory: *imperfect public monitoring*, the *folk theorem with imperfect monitoring* (Green & Porter's cartel model is the classical ancestor; Abreu–Pearce–Stacchetti the general theory). Mechanism design: the *judge/verifier-as-strategic-agent* problem, closely related to *delegated monitoring* and to *rater incentive-compatibility* in reputation-system design generally.

**Prior work.** Abreu, Pearce & Stacchetti (1990) [matches the standard imperfect-public-monitoring reference]. Green & Porter's cartel-monitoring model (the classical source of "public signals may not perfectly reveal actions," foundational and undisputed in the field though not independently re-verified here). Zheng et al. (2023), LLM-as-judge debiasing — cited by the book's Fix B for order-swap/pairwise/family-exclude techniques, a live applied-ML reference rather than classical game theory.

**How the book's version differs.** The book's genuine contribution here is a *meta*-theorem: pointing out that every folk-theorem-style incentive-compatibility argument in the whole market ultimately depends on an evidentiary signal (the settlement grade) that someone produces, and that someone can be captured — and formalizing this as a gap in the standard application of monitoring theory to any market design that outsources grading. This is a correct and useful observation, not usually stated this explicitly in applied mechanism-design writing, though the underlying principle (the monitoring technology itself needs to be inside the game, not exogenous) is implicit in the imperfect-public-monitoring literature generally.

**What an expert would push back on.** Fix B's "rate-the-raters" recursion terminating at a machine-checkable base is asserted, not proven to always terminate — the book's dramatized example (Judy the captured judge) shows one instance where a second panel resolves the capture, but not that the recursion cannot loop indefinitely under adversarial pressure at scale, precisely the "Incentive-compatible arbitration capacity" gap the book lists among its own open items.

**Verdict: firm as a critique of naive incentive-compatibility claims, open as a mechanism** for the arbitration-capacity problem it identifies but does not close.

**Reading list.** Green & Porter, Econometrica 1984 (classical monitoring-imperfection source); Abreu, Pearce & Stacchetti (1990); Zheng et al., NeurIPS 2023.

## Idea 14 — The commons authority as Hobbesian sovereign, advisory claims, and Sen's impossibility

**What the book claims.** A "commons authority" providing identity, capability bounding, shared knowledge, immutable history, and economic settlement is a *Hobbesian sovereign, not an omniscient coordinator*: it establishes conditions for trust and "gets out of the way." File-claim coordination is deliberately *advisory* rather than enforced-lock, motivated by a design warning drawn from Sen's impossibility theorem: enforced locks grant each agent a "personal domain" (minimal liberalism) that can veto a Pareto-superior team outcome. Separately, the daemon is read as a candidate Aumann *correlating device*, conditional on an explicit obedience inequality.

**Other names for it.** Political philosophy: *social contract theory* (Hobbes, Locke). Social choice theory: *Sen's Liberal Paradox* / *the impossibility of a Paretian liberal*. Commons governance: Ostrom's design principles. Game theory: *correlated equilibrium*.

**Prior work.** Sen, *The Impossibility of a Paretian Liberal*, J. Political Economy 78(1):152–157 (1970) [verified, 800+ citations]: no social welfare function can simultaneously satisfy Pareto efficiency and minimal liberalism (each agent decisive over at least one personal-domain pair). Ostrom, *Governing the Commons* (1990) [verified]: the design-principles literature on commons governance (boundaries, monitoring, graduated sanctions, dispute resolution) the book maps onto its own escalation ladder, correctly noting the departure that "the four functions ship as daemon services, not as norms an agent must internalize." Aumann, *Subjectivity and Correlation in Randomized Strategies* (1974) [verified]: the correlated-equilibrium framework and obedience inequality, stated precisely then correctly caveated ("a mediator does not create an equilibrium merely by issuing recommendations").

**How the book's version differs.** The book is explicit and unusually careful that it is *not* deriving Sen's theorem for its own setting — "this property is a counterexample to the universal claim that exclusive locks always improve team welfare; it is not a derivation of Sen's theorem" — which is the correct scholarly move: Sen's theorem needs an unrestricted preference domain and a social-choice rule with decisive personal pairs, neither of which the file-locking scenario formally has. The Hobbes/Ostrom framing is an explanatory analogy for design motivation, not a formal claim, and the book is careful to say so.

**What an expert would push back on.** A social-choice theorist would flag that invoking Sen's theorem by name for a scenario explicitly *not* an instance of it risks reading, on a skim, as a stronger formal claim than intended — the hedge is right but easy to miss from a section header alone. An Ostrom scholar would ask whether the daemon's centralization (a single point of failure, acknowledged: "if the daemon crashes, the Leviathan falls") is compatible with Ostrom's own finding that durable commons institutions are typically *polycentric* rather than singly sovereign — the book's model is closer to a unitary Hobbesian sovereign, and it names this tension without reconciling it.

**Verdict: firm as analogy, correctly hedged as non-derivation; one unreconciled tension (Hobbesian centralization vs. Ostromian polycentricity) worth naming explicitly rather than leaving implicit.**

**Reading list.** Sen (1970); Ostrom (1990); Aumann (1974); Hobbes, *Leviathan* (1651); for the polycentricity point, Ostrom, *Beyond Markets and States: Polycentric Governance of Complex Economic Systems*, Nobel Prize Lecture, American Economic Review 2010.

## A note on the federation-protocol comparison the book does not make

Chapter 8's Related Work section is careful and correctly cited for OpenID Federation 1.0 (Hedberg et al., 2024), UCAN, Macaroons (Birgisson et al., NDSS 2014 [verified above]), Sigstore/Rekor, in-toto, SLSA, the Crosby–Wallach history tree, and IBC. It does not mention **SPKI/SDSI** (Rivest & Lampson, mid-1990s [verified real]: the foundational local-names, decentralized-authorization design that macaroons and UCAN both descend from conceptually), **ActivityPub** (W3C Recommendation, 2018 [verified]: the deployed federation protocol behind Mastodon and the fediverse, solving exactly the "independent servers relay signed activity without a shared database or global ruler" problem the book states as its own goal), or **Matrix** (an open, currently deployed federation specification [verified] where homeservers replicate room state with eventual consistency across administrative boundaries with no single point of control — arguably the closest production analogue to the book's "no consensus, gossip-bounded, detectable equivocation" model of any system running today). None of these three overturns any specific theorem, but an expert reading Chapter 8 would very likely ask "why not ActivityPub or Matrix?" before asking about OpenID Federation, and the chapter has no answer on the page.

## Terms the book coins privately that already have public names

| Book's term | Public name | Field |
|---|---|---|
| "float plan" | escrowed order / conditional payment instruction | smart-contract and escrow design generally |
| "the succession price $D^\star$" | pooling-vs-dedication crossover threshold | queueing theory (server flexibility / skill-based routing) |
| "commons authority" | trusted third party / correlation device (when read game-theoretically) | mechanism design, correlated equilibrium |
| "the keystone" (missing cross-operator attestation) | the trust-anchor problem | federated identity (OpenID Federation, SPKI/SDSI) |
| "hosted trust" | reputation-as-a-service / certification intermediary | platform economics |
| "consistency radius" | (already named — the book correctly attributes this to Robinson; listed here only to note it is *not* a private coinage, unlike the others above) | applied topology |
| "the equivocation race" | revocation-propagation window / CRL staleness | PKI |

## Summary table

| # | Idea | Verdict | One-line reason |
|---|---|---|---|
| 1 | Three-sided market on one ledger | Firm, unquantified subsidy structure | Correct application of Rochet–Tirole; no estimated demand system |
| 2 | Renting trust once records can't be minted | Firm | Correct Sybil/reputation-bubble lineage; one new negative result (Sagas ≠ reputation repair) |
| 3 | Bond ledger conservation law | Firm | The one **Built** claim; property-tested, not model-checked, and the book says so |
| 4 | Two-of-three cross-harbor settlement | Honest open problem | Correctly self-located against Herlihy's atomic-swap/cross-chain-deals line; explicitly not solved |
| 5 | Myerson–Satterthwaite boundary | Known result, restated | Textbook impossibility theorem correctly instantiated numerically, not a new theorem |
| 6 | Claim-signaling δ threshold | Firm as math, unverified as calibration | Mechanized folk-theorem application; δ≈0.9 and payoffs are stipulated |
| 7 | Sole-specialist vs. pool (succession price) | Firm, one open literature gap | Sound derivation in the Mitrany–Avi-Itzhak line; "skill-based routing" search not yet closed |
| 8 | Deontic fragment / NP-complete frontier | Contested | A closely-shaped tractable/hard dichotomy already exists in regulatory-compliance checking (Colombo Tosatto et al.) |
| 9 | Federation refuses consensus | Firm | Correct, honestly-scoped application of FLP/partial synchrony |
| 10 | Revocation gossip / equivocation race | Novel, explicitly unverified | Stated as a conjecture, not a theorem — correctly so |
| 11 | Sheaf consistency radius for equivocation | Firm — most original result | Genuinely new question (post-hoc cohomological detection) correctly distinguished from adjacent topological-distributed-computing and PeerReview lines |
| 12 | Coalition cancellation | Honest open boundary | Self-identified limitation of the book's own new method; no prior art expected or found |
| 13 | Reputation monotone-but-revocable / grading oracle | Firm as critique, open as mechanism | Correct meta-point about imperfect monitoring; arbitration-capacity gap admitted, not closed |
| 14 | Commons authority, advisory claims, Sen | Firm as analogy, correctly hedged | Explicitly not a derivation of Sen's theorem; Hobbes/Ostrom tension (centralized vs. polycentric) named but not resolved |

