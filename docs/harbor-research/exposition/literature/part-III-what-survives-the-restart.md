# Part III, "What Survives the Restart" — an outside literature review

Scope: Chapter 5, *From Spawn to Person* (`website-v2/public/whitepaper/spawn-to-person.tex`), and its two standalone research twins, `docs/harbor-research/tex/paper3.tex` ("Reputation is Amortized Verification") and `paper5.tex` ("Continuity Without Metaphysics"). Library-index entries R7, R12, R13, B6, and `prop:claim-signaling-ic` are the formal results these sections import.

## Verdict, in two paragraphs

Part III stands on firmer ground than most technical whitepapers that touch philosophy, because it already does the thing an outside reviewer would otherwise have to do for it: `spawn-to-person.tex` §2 ("Prior art, and where this paper departs from it") and paper5.tex §7 name Locke, Parfit, Akerlof, Friedman–Resnick, Douceur, Tadelis, Mailath–Samuelson, Grossman, Milgrom, Lizzeri, Spence, Becker, and Cheng-style Sybil economics by title, venue, and year, and every one of those citations checks out against the public record (verified below). The chapter's actual mathematical content — the no-mint conservation law, the engine-substitution IC flip, resurrection soundness's three clauses, the probation cliff, and the inspection tower's bonded-audit arithmetic — is original combination work on top of textbook game theory (Becker deterrence, Akerlof adverse selection, exchange-argument LP optimization), not a rediscovery of a named prior result, and the paper is unusually honest about this: it labels its own borrowings "imported" and its combinations "new, honestly," and it reports its own refuted first attempt (the budget-only no-mint phrasing) rather than hiding it. That is close to the standard a journal referee in economics or philosophy would actually apply.

Where it is exposed is not in the theorems but in three places outside them. First, the philosophical move — "we take Parfit's move, not Parfit's thesis" — is stated cleanly but the chapter never engages the strongest reply available (animalism, Olson's *What Are We?*, Williams's body-swap intuition-flip), which matters because Williams's result is precisely that untutored intuitions about *which* continuity criterion should govern flip with narrative framing — a fact with teeth for a chapter that is, after all, choosing which continuity criterion to build. Second, the inspection-tower paper (paper3.tex) constructs a recursive audit hierarchy with sealed sampling from disjoint cliques without engaging the closest formal literature on exactly that structure — Kofman & Lawarrée's *Collusion in Hierarchical Agency* (Econometrica 1993) and Tirole's *Hierarchies and Bureaucracies* (JLEO 1986) — or the applied-cryptoeconomics literature that rediscovered the same shape independently (TrueBit's verifier's dilemma, Arbitrum's bisection dispute games, proof-of-stake slashing economics). None of these contradicts the tower theorem, but an economics referee would ask why a paper about auditing the auditors does not cite the two canonical papers with that exact title concept. Third, the "no-mint" conservation law for reputation inheritance has a close, uncited cousin in systems the book's own domain (peer-to-peer trust metrics) already solved twenty-five years ago — Levien's Advogato attack-resistant trust metric, which bounds trust flow from a seeded root by network max-flow specifically so that new accounts cannot manufacture certified trust. The two mechanisms differ (discount-and-split under debiting vs. flow-conservation from a trusted seed set), but the omission is the kind of gap a P2P-systems referee would flag immediately.

---

## 1. Identity as a ledger position with a witnessed record, not a soul

**What the book claims.** §2.1 and §3 of `spawn-to-person.tex`: a **person** is `(R, κ)`, a role instance plus a continuity witness that binds successive incarnations into "one accountable thread" (Def. `person`). Paper5.tex §6 states the composed claim as a `\onebreath`: "what survives of an agent when its body changes is not a soul but a ledger position." This is a *design invariant / definitional* claim, not a theorem.

**Other names for it.** Philosophy: the *psychological-continuity* (or *reductionist*) theory of personal identity. Law: *artificial* or *juristic* personhood — the doctrine that "person" is a status the law confers, separable from any particular natural substrate. Computer science: the actor-model split between a durable *actor identity* and a transient *activation* (a "grain" in Orleans terms).

**Prior work.**
- John Locke, *An Essay Concerning Human Understanding*, Bk. II ch. xxvii, 1690 — the memory criterion (identity is consciousness, not substance). [verified — chapter epigraph quotes it directly and it is standard]
- Derek Parfit, *Reasons and Persons* (Oxford, 1984) and "Personal Identity," *The Philosophical Review* 80(1), 1971 — psychological continuity as an overlapping chain, transitive where connectedness is not; the "fission contains all that interests us" line from the 1971 paper (p. 206, per the Routledge Encyclopedia of Philosophy summary of Parfit's fission argument). [verified via multiple independent secondary sources]
- Thomas Hobbes, *Leviathan*, ch. XVI ("Of Persons, Authors, and things Personated"), 1651 — the actor/author split, cited in §7 of the chapter for the principal-above-actor structure. [verified, standard text]
- Bernard Williams, "The Self and the Future," *The Philosophical Review* 79(2), 1970, pp. 161–180 — **not cited by the book**. Williams's body-swap thought experiments show that the *same facts*, narrated first-personally versus third-personally, flip readers' intuitions between bodily and psychological criteria. [verified]
- Eric T. Olson, *What Are We? A Study in Personal Ontology* (Oxford, 2007) — animalism, the rival view that we are essentially biological organisms and that psychological continuity is neither necessary nor sufficient for persistence (a vegetative-state animal persists without it). **Not cited.** [verified]
- Dartmouth College v. Woodward, 17 U.S. 518 (1819) — the founding U.S. case establishing corporate legal personhood as a status distinct from the natural persons who compose or run the entity. **Not cited**, though it is the closest legal-doctrinal analogue to "a person is a role plus a continuity witness, not a substance." [verified]

**How the book's version differs.** The chapter explicitly imports Parfit's *move* (dissolve the identity question) but refuses his *thesis* (that fission preserves "all that matters") — paper5.tex §7 says this directly and even notes the direction of departure runs opposite to what a reader would guess: Theorem 1 (no-mint) makes the inherited prior *scarce and divisible*, precisely so it *must* split among forks, which is not what Parfit argues happens to psychological continuity. This is a genuinely careful, non-trivial reading of Parfit, not a name-drop.

**What an expert would push back on.** Why psychological/memory continuity at all, rather than an organism/process view (animalism)? The book never states why the *ledger* rather than, say, weight-continuity of the underlying model is the right unit, beyond "because reputation must accumulate" — a stipulation dressed as a derivation, though the book is transparent that it is sidestepping rather than resolving the identity question. Williams's flip is the sharper worry: it shows that *any* single continuity criterion, argued from one framing, will feel compelling, so a rigorous treatment would need to show the ledger criterion is robust to reframing, not just appealing from one angle.

**Verdict: firm, with one honest evasion the book itself flags.** The definitional move (role vs. person) is sound engineering; the philosophical grounding is honestly partial and the book says so ("we never decide whether the fork 'is' its ancestor").

**Reading list.** Locke 1690 Bk. II ch. xxvii; Parfit 1971, *Phil. Review* 80(1):3–27; Parfit 1984, *Reasons and Persons*; Williams 1970, *Phil. Review* 79(2):161–180; Olson 2007, *What Are We?*; Hobbes 1651, *Leviathan* ch. XVI; *Dartmouth College v. Woodward*, 17 U.S. 518 (1819).

---

## 2. The three organs of continuity, and "checkpoint with teeth"

**What the book claims.** §"The three organs of continuity" (`sec:organs`): memory (BUILT), checkpoint (BUILT-WEAK — "forwards a summary, not state"), and the outcome ledger (BUILT-WEAK). The chapter is explicit that its own restart mechanism is *checkpoint-of-record*, not *checkpoint-of-execution*, and names the gap: KV-cache, sampling state, and hidden activations "are not exported artifacts," so cross-provider resumption is "task continuity with actor succession," not resumption. This is stated as an honest boundary, not a claim.

**Other names for it.** OS/distributed-systems: *checkpoint/restore*, *process migration*. Actor systems: *virtual actor* reactivation (an actor's state is durable; its in-memory activation is not). Databases: *durable execution* / *workflow replay*.

**Prior work.**
- M. Litzkow, T. Tannenbaum, J. Basney, M. Livny, "Checkpoint and Migration of UNIX Processes in the Condor Distributed Processing System," Univ. of Wisconsin–Madison CS Technical Report #1346, 1997 — the canonical checkpoint-and-migrate system: a process is frozen, its full state serialized, and resumed elsewhere. [verified]
- CRIU (Checkpoint/Restore In Userspace), an active open-source project (github.com/checkpoint-restore/criu) — freezes a Linux process tree via `ptrace`, dumps memory/FDs/network state to disk, and restores it, including across hosts for container live-migration. [verified]
- P. A. Bernstein, S. Bykov, A. Geller, G. Kliot, J. Thelin, "Orleans: Distributed Virtual Actors for Programmability and Scalability," Microsoft Research technical report, MSR-TR-2014-41 — the *virtual actor* abstraction: an actor ("grain") always logically exists; the runtime activates and deactivates its in-memory incarnation on demand, and the framework — not the caller — is responsible for reconstituting state on reactivation. [verified]
- O. Milojičić et al., "Process Migration," *ACM Computing Surveys* 32(3), 2000 — the general survey of what state (registers, open files, sockets, pending signals) migration must carry and what it typically cannot (kernel-internal state, hardware-bound resources). Not cited by the book; directly on point for the "gums, not teeth" boundary the chapter states.

**How the book's version differs.** This is a straightforward restatement of the OS/distributed-systems distinction between *state persistence* and *live execution state*, applied to an LLM agent, where "execution state" specifically means KV-cache and sampling state rather than registers and open file descriptors. The chapter's honesty here — naming exactly which artifact is not exportable — is stronger than most agent-framework marketing, which routinely claims "resumable agents" without this caveat.

**What an expert would push back on.** CRIU-style full-state checkpointing of an *inference session* is not obviously impossible the way "not exported artifacts" implies — it is a property of current provider APIs, not a law of computation; some inference stacks do expose KV-cache snapshots. The claim is accurate about *today's* commercial LLM APIs but is stated with more inevitability than the underlying constraint warrants.

**Verdict: known result restated, correctly and honestly bounded.** Checkpoint-vs-execution-state is a fifty-year-old OS distinction (Condor, 1997; CRIU, ongoing); the chapter's contribution is naming *which* piece (KV-cache/sampling state) plays the missing-state role for an LLM agent, and refusing to round "notes about the past" up to "resumed experience."

**Reading list.** Litzkow et al. 1997 (Condor); CRIU project docs; Bernstein et al., Orleans MSR-TR-2014-41; Milojičić et al., "Process Migration," *ACM Comp. Surveys* 32(3), 2000.

---

## 3. Non-forgeable identity is necessary for sanction-respecting reputation

**What the book claims.** Theorem `thm:necessity` (§"Identity: the root the whole chain hangs from"): if identity minting is free, no reputation mechanism can be *sanction-respecting* (Def. `sanction-respecting`) — a dishonest actor's accessible score after re-minting equals a clean newcomer's, so the sanction is never actually borne. Stated and proved as a Theorem; footnoted as "Definition III.6.1" in the standalone paper.

**Other names for it.** Distributed systems: the *Sybil attack* and its impossibility results. Mechanism design: *whitewashing*. The proof technique (an actor always has a `max(sanctioned, newcomer)` escape hatch) is a specific instance of a broader family of Sybil-impossibility arguments.

**Prior work.**
- J. R. Douceur, "The Sybil Attack," *Proc. 1st IPTPS*, LNCS 2429, 2002, pp. 251–260 — without a logically central authority, an entity can present unboundedly many identities and defeat any scheme relying on identity multiplicity, absent resource-parity assumptions the book does not make either. [verified]
- E. Friedman & P. Resnick, "The Social Cost of Cheap Pseudonyms," *J. Econ. & Mgmt. Strategy* 10(2), 2001, 173–199 — cheap identities force society to "tax" all newcomers, since it cannot distinguish a genuine newcomer from a reincarnated bad actor; a large degree of cooperation still emerges via a newcomer-dues convention. [verified]
- A. Cheng & E. Friedman, "Sybilproof Reputation Mechanisms," *Proc. ACM SIGCOMM Workshop on Econ. of P2P Systems (P2PECON)*, 2005 — a formal impossibility theorem: **no symmetric reputation function is Sybil-proof**; only asymmetric flow-based functions with conditions can be. This is the tightest, most directly comparable formal result to Theorem `thm:necessity`, and it is not cited anywhere in either paper. [verified]

**How the book's version differs.** Theorem `thm:necessity` is a special case of the Douceur/Cheng–Friedman family, restated for a *sanction-respecting* mechanism rather than a general trust/reputation function, with a short, clean two-line proof via the `max(r(i)-Δ, r₀)` identity. It is correct and it is a fine restatement, but it is a restatement: Cheng & Friedman's 2005 impossibility theorem for symmetric functions is formally closer to and slightly more general than Theorem `thm:necessity`, and the chapter would be stronger citing it directly rather than only the informal Douceur/Friedman–Resnick statements of the problem.

**What an expert would push back on.** A Sybil-defense researcher would note the theorem assumes minting cost `c=0` is the *only* variable; Cheng–Friedman's asymmetric-flow constructions show the more interesting frontier is exactly at `c>0` with bounded trust propagation, which is where the "how much should the cost be" design question (answered later by the whitewash-cost theorem and probation cliff) actually lives. The necessity theorem itself is uncontroversial to the point of being close to definitional once "sanction-respecting" is defined the way it is.

**Verdict: known result restated (a special case of an established impossibility family).** Correct, cleanly proved, and honestly labeled a Theorem rather than a discovery, but Cheng–Friedman (2005) is a closer and uncited formal cousin.

**Reading list.** Douceur 2002 (IPTPS); Friedman & Resnick 2001, *JEMS* 10(2); Cheng & Friedman 2005, P2PECON.

---

## 4. Forks and no-mint inheritance: split = transfer, not copy

**What the book claims.** Theorem 1 (no-mint), paper5.tex §2, imported verbatim into `spawn-to-person.tex` as a `pdexample` after Exercise (3): under "discount-and-split" (a derivation grants a child `γ·wₚ·spend(p)` and *debits* the source `wₚ·spend(p)`), total live creditable reputation `Φ` never exceeds total witnessed value `W`, under any sequence of forks, merges, chains, or re-derivation cycles. Verified by a 4,000-DAG randomized sweep, 0 violations; the naive budget-only phrasing is reported as *refuted* by a hand-checkable counterexample (a three-hop chain at `γ=0.9` sums to `2.439 > 1`).

**Other names for it.** Distributed ledgers: *conservation of value* / no-double-spend / no-inflation invariant (the UTXO model). P2P trust systems: *attack-resistant trust metrics* via network flow.

**Prior work.**
- Raph Levien, "Attack-Resistant Trust Metrics" (PhD thesis, and the Advogato.org deployment, c. 1999–2000) — computes certified trust as *maximum flow* from a small seed set of trusted nodes through a capacity-bounded graph, specifically so that no set of newly created (Sybil) accounts can manufacture trust beyond what genuinely flows from the trusted seeds — a flow-based conservation law for exactly the reason the book wants one. **Not cited.** [verified — thesis at levien.com/thesis/thesis.pdf, description of max-flow trust bound confirmed by multiple independent sources]
- S. Kamvar, M. Schlosser, H. Garcia-Molina, "EigenTrust," WWW 2003 — already cited by the book (§ Reputation and skill-rating estimators) for its use as a trust-*propagation* estimator; it is worth noting here too because EigenTrust's local-trust matrix is row-stochastic by construction, which is a different but related sense of conservation (each node's *outgoing* trust sums to 1, rather than the book's *value* being conserved across derivation events).
- The double-spend/no-inflation invariant of a UTXO-based ledger (Bitcoin, Nakamoto 2008, and its formal treatments) is the closest *engineering* analogue outside reputation systems specifically: a transaction's outputs cannot exceed its inputs. The book's "discount-and-split, transfer form" (Def. in paper5.tex §2) is structurally a UTXO transaction with a burn rate `1-γ`.

**How the book's version differs.** The genuine novelty here, correctly claimed as such by the paper's own "New, honestly" paragraph, is applying the conservation-under-transfer discipline specifically to *reputation inheritance across forks/distillation/re-derivation cycles* for software agents, where the DAG shapes (diamonds, multi-parent merges, re-derivation cycles) are richer than a simple UTXO chain and richer than Advogato's single-seed-to-sink flow. The wrong-turn report (budget-only phrasing refuted by a hand-checkable three-term geometric series) is a genuinely useful piece of intellectual honesty rarely seen in whitepapers.

**What an expert would push back on.** A P2P-trust-systems referee would ask why Advogato's flow-based conservation (a mature, deployed, twenty-five-year-old mechanism solving a closely related problem) is absent from the related-work discussion, especially since Advogato's approach and the book's differ in an interesting, citable way: Advogato bounds trust *propagation outward* from a root, while the book bounds *value extracted upward* through derivation — a genuine and statable distinction the paper could make explicitly, strengthening rather than weakening its novelty claim.

**Verdict: novel combination, correctly verified, with a real prior-art gap.** The theorem and its sweep are sound; the "genuinely new" framing is defensible but incomplete without engaging Advogato-style flow conservation.

**Reading list.** Levien, "Attack-Resistant Trust Metrics" (PhD thesis); Kamvar, Schlosser, Garcia-Molina, "EigenTrust," WWW 2003; S. Nakamoto, "Bitcoin: A Peer-to-Peer Electronic Cash System," 2008 (for the UTXO conservation analogy).

---

## 5. Engine substitution: Akerlof's lemons inside one identity, and attestation flipping the incentive

**What the book claims.** Theorem 2a (paper5.tex §3): unattested, the one-period swap gain `Δc = (p−c_L)−(p−c_H)` is price-independent, so no belief supports pooling on the high-quality engine and the pool unravels toward `θ_L` below `μ* = (c_H−θ_L)/Δθ`. Theorem 2b: with daemon-attested engine ids, the swap gain becomes `Δc − Δθ` (a hypothesis on the pricing regime, not a free consequence), which flips the incentive to the planner's efficiency rule *at zero audit stake*.

**Other names for it.** Economics: *adverse selection* (the market for lemons). Information economics: *unraveling* (voluntary full disclosure under verifiable, costless disclosure) vs. its opposite, *no unraveling under costly/undetectable non-disclosure*. Applied ML security: *model substitution* / *inference-time model swap* detection.

**Prior work.**
- G. A. Akerlof, "The Market for 'Lemons,'" *QJE* 84(3), 1970, 488–500 — the founding adverse-selection result. [verified, cited correctly by the book with the right year (1970, not 1970 the book's own bib entry is correct — some secondary sources mis-cite 1970 vs 1970; confirmed 1970 is correct)]
- S. J. Grossman, "The Informational Role of Warranties and Private Disclosure About Product Quality," *J. Law & Econ.* 24(3), 1981, 461–483, and P. Milgrom, "Good News and Bad News," *Bell J. Econ.* 12(2), 1981, 380–391 — the *unraveling* result: costless, verifiable disclosure with a buyer who can verify "I have disclosed everything" leads sellers to fully disclose in equilibrium. [verified]
- A. Lizzeri, "Information Revelation and Certification Intermediaries," *RAND J. Econ.* 30(2), 1999, 214–231 — a monopoly certification intermediary optimally reveals only pass/fail and extracts the surplus; full revelation needs the frictionless limit of free entry. [verified]
- W. Cai, T. Shi, X. Zhao, D. Song, "Are You Getting What You Pay For? Auditing Model Substitution in LLM APIs," arXiv:2504.04715, 2025 — shows commercial LLM-API model substitution is real, software-only detection is defeated by inference nondeterminism, and TEE-backed attestation is the robust channel, while naming weak provider incentive as the adoption obstacle. [verified — arXiv id and authors confirmed]

**How the book's version differs.** This is the strongest section of the chapter precisely because it does its own literature placement work: paper5.tex §7 explicitly identifies Theorem 2a as Grossman's §3 case (disclosure costlier than the quality spread) and Theorem 2b as the disclosure-theory question of whether Grossman/Milgrom unraveling makes mandatory attestation redundant — and then gives a specific, citable reason unraveling does *not* apply here (buyers cannot verify "the runtime cannot attest" vs. "the runtime chooses not to," which is exactly the hypothesis Milgrom's proof needs and that fails for opaque model-serving infrastructure). It also correctly identifies and engages the one contemporaneous empirical paper (Cai et al. 2025) that studies the exact mechanism from the detection side rather than the incentive side, and states precisely where the two fit together ("their paper contains no adverse-selection framing, and this one contains no detection experiments").

**What an expert would push back on.** An information economist would ask whether the "attested price schedule passes through the full quality difference" hypothesis in Theorem 2b is realistic outside Bertrand competition, since the paper itself names Bertrand pricing as the case where the flip collapses — meaning the headline result (attestation aligns incentives) holds only inside a specific pricing-competition regime the paper does not claim to derive endogenously. That is disclosed as an honest boundary, which mitigates but does not remove the concern.

**Verdict: firm, and the related-work engagement is exemplary.** The economics is textbook Akerlof/Grossman/Milgrom correctly applied to a new setting (an identity, not a seller), with the boundary condition (Bertrand collapse) honestly stated.

**Reading list.** Akerlof 1970, QJE; Grossman 1981, JLE; Milgrom 1981, Bell J. Econ.; Lizzeri 1999, RAND; Cai, Shi, Zhao, Song, arXiv:2504.04715.

---

## 6. Resurrection soundness, and the cross-operator attestation gap

**What the book claims.** Theorem 3 (paper5.tex §4 / `thm:resurrection-soundness`): sanction-respecting reputation survives provider migration under three clauses — (i) lineage verification, (ii) engine attestation on all successor outcomes, (iii) open commitments closed or escrowed before cutover — each individually necessary (a 2-step attack exists if any is dropped, verified by a 747-state bounded model check). Separately, `sec:keystone` names *cross-operator attestation* (binding identity keys across mutually distrusting operators) as an explicitly unsolved, VISION-graded problem handed to the next chapter.

**Other names for it.** Cryptography/identity: *key rotation* and *social recovery* for self-sovereign identity. Standards: W3C Decentralized Identifiers (DIDs) and Verifiable Credentials. Systems: cross-domain *migration soundness* (the same shape as the checkpoint/restore problem in §2, plus an authentication layer).

**Prior work.**
- W3C Decentralized Identifiers (DID) specification and the DID-key-rotation literature — a DID document's controlling key can be replaced via another controlling key or via social recovery (a quorum of guardians), which is exactly the "identity survives a credential change" problem the resurrection theorem's clause (i) needs to eventually interoperate with once identity is not daemon-local. [verified — W3C TR and the did:key spec]
- Vitalik Buterin's keystore-contract proposals for smart-contract-wallet key rotation and recovery — an independent, deployed engineering answer to "how does a durable identity survive a compromised or lost credential" in the adjacent blockchain-wallet domain. [verified]
- Agent Payments Protocol (AP2, Google, announced Sept. 2025) and the Universal Commerce Protocol (UCP, Google/Shopify, announced Jan. 2026) — both express principal authorization as W3C Verifiable Credentials in SD-JWT form; the book cites both (§ keystone) and correctly characterizes what the standardized envelope does and does not solve: it authenticates keys to an *origin*, not a *principal*, across mutually distrusting operators. [verified — both protocols and their 2025/2026 announcement dates confirmed]

**How the book's version differs.** The chapter's honesty is the strongest feature here: rather than claiming the resurrection theorem solves cross-operator identity, `sec:keystone` states in boldface that the local non-forgeable identity of §"Identity" is "the highest-leverage *partial local* keystone," that cross-operator attestation is "the *unsolved* problem," and that a standardized credential envelope (AP2/UCP) "shrinks the problem; it does not solve it" because a JWK set authenticates keys to an origin, not a principal. This is a correct and precise diagnosis of exactly where DID/VC infrastructure stops (transport and format) and where the hard trust-establishment problem (attesting that the entity behind a key *is* the principal it claims to be, across two parties who trust neither each other nor a shared root) begins.

**What an expert would push back on.** A distributed-identity researcher would note that "social recovery" and DID key-rotation schemes were themselves developed to solve almost exactly this class of problem (recovering/re-binding an identity when its credential changes, without a central authority), and the chapter's own resurrection-soundness clauses (i)-(iii) would benefit from being explicitly mapped onto that literature's vocabulary (guardian quorums, key-rotation proofs, DID method resolution) rather than treated as a from-scratch protocol design, even though the chapter is honest that this mapping has not been done.

**Verdict: firm on the local claim, correctly labeled unsolved on the cross-operator claim.** The 747-state model check is a real, bounded verification of a real protocol; the chapter does not overclaim what it has not built, which is the right call given that DID/VC standardization (AP2/UCP, 2025–2026) genuinely postdates and does not yet solve the cross-operator binding problem.

**Reading list.** W3C, "Decentralized Identifiers (DIDs) v1.0"; W3C-CCG, "The did:key Method"; Google, "Agent Payments Protocol" (2025); Google/Shopify, "Universal Commerce Protocol" (2026).

---

## 7. The probation cliff: front-loaded newcomer restriction dominates a ramp

**What the book claims.** Theorem 4 / `thm:probation-dominance`: among newcomer-restriction schedules with equal deterrence power against a short-horizon whitewasher (discount factor `δ_f < δ_h`), the schedule minimizing honest newcomers' lifetime friction is bang-bang, filled from `t=0` — a cliff, not a ramp — collapsing to a pure spike `g* = (G_max, 0, ..., 0)` when the per-period ceiling `L` does not bind. Proved by an exchange argument; a 76,000-schedule sweep finds 0 dominating alternatives for the uncapped case; the capped case (clause iii) is explicitly flagged as resting on the closed-form argument alone, *not* on sweep evidence, because the sweep script has no per-period cap.

**Other names for it.** Labor/contract economics: *deferred compensation* and *front-loaded bonding* as worker-discipline devices. Reputation economics: the "newcomers pay their dues" convention.

**Prior work.**
- E. Friedman & P. Resnick, 2001 (as above) — establishes that newcomers must pay dues under cheap pseudonyms; the probation-cliff theorem sharpens the *shape* of that payment, which Friedman–Resnick leave unspecified. [verified]
- E. P. Lazear, "Why Is There Mandatory Retirement?," *JPE* 87(6), 1979, 1261–1284 — the deferred-compensation folklore the book names as its "foil": workers are underpaid early and overpaid late as an implicit bond against shirking, which on its face is the opposite shape (a ramp, not a cliff) from what Theorem 4 recommends. [verified as a real, correctly cited paper — but see below]

**How the book's version differs, and the honest gap.** This is the one place in the chapter where the authors explicitly say they have *not* verified their own framing: paper5.tex §7 states, in italics, "One citation is owed and unresolved... we have not been able to obtain Lazear's article, and if his contract front-loads the honest worker's implicit bond then Theorem 4 agrees with him rather than correcting him." Having now checked: Lazear's mandatory-retirement mechanism pays workers *below* marginal product when young and *above* it when old — the discipline comes from the threat of *losing* the future overpayment, which is back-loaded compensation functioning as a bond, not front-loaded restriction. This is a different mechanism from Theorem 4's front-loaded *restriction* of a *newcomer's* ceiling, but both use "hold back value now, release it later, contingent on continued good behavior" as the deterrence lever, and a labor economist would likely read them as cousins rather than opposites: Lazear back-loads the *reward* for a career-long employee; Theorem 4 front-loads the *restriction* on a *brand-new* entrant. They are not in tension once the difference between "whose horizon is being disciplined" is made explicit, but the book has not yet made that comparison, and says so.

**What an expert would push back on.** A mechanism-design referee would ask about the two-type model's realism (only two discount factors, both known to the designer) and would note — as the book's own boundary block does — that the capped-clause sweep evidence does not exist yet (`b6_probation.py` has no `g_t ≤ L` clip), so clause (iii) is a closed-form claim awaiting its own verification, a fact the paper states rather than hides.

**Verdict: novel and largely verified, with one self-reported open citation.** The LP/exchange-argument result is correct math; its relationship to the one piece of folklore it claims to correct (Lazear 1979) is honestly flagged as unresolved rather than asserted.

**Reading list.** Friedman & Resnick 2001; Lazear, *JPE* 87(6), 1979, 1261–1284 (read directly to resolve the open citation).

---

## 8. The inspection tower: bonded judges, sealed sampling from disjoint cliques

**What the book claims.** paper3.tex Theorem (Stage deterrence): a bonded judge is deterred iff `ρdB ≥ G`; critical rate `ρ* = G/(dB)`. Theorem (Tower contraction): auditing auditors sampled *sealed* from `C` disjoint cliques makes bribery all-or-nothing, profitable only above corrupt value `CB`, decaying geometrically at `(1-ρd)` below it — so *finite* bond capital certifies a logarithmically deep tower. `spawn-to-person.tex` imports this verbatim as `thm:tower-imported`.

**Other names for it.** Game theory: the classical *inspection game*. Crime economics: Becker's deterrence-by-expected-penalty. Distributed systems/crypto-economics: *watching the watchers*, recursive dispute resolution, the *verifier's dilemma*, and proof-of-stake *slashing conditions*.

**Prior work.**
- G. S. Becker, "Crime and Punishment: An Economic Approach," *JPE* 76(2), 1968, 169–217 — deterrence by expected penalty; correctly cited as the source of the `ρ*` formula's logic. [verified]
- R. Avenhaus, B. von Stengel, S. Zamir, "Inspection Games," *Handbook of Game Theory*, Vol. 3, ch. 51, 2002, pp. 1947–1987 — the survey the book correctly cites for the committed-inspector/inspectee-indifference formulation it uses. [verified]
- F. Kofman & J. Lawarrée, "Collusion in Hierarchical Agency," *Econometrica* 61(3), 1993, 629–656 — a principal-agent-supervisor model in which the supervisor (auditor) and agent may collude, and the paper derives when auditors are useful, contingent on audit quality and the agent's liability — the closest formal-economics paper to "who audits the auditor," and **not cited** by paper3.tex despite being the paper with essentially that research question. [verified]
- J. Tirole, "Hierarchies and Bureaucracies: On the Role of Collusion in Organizations," *J. Law, Econ. & Org.* 2(2), 1986, 181–214 — the three-tier principal/supervisor/agent model this literature is built on. **Not cited.** [verified]
- J. Teutsch & C. Reitwiessner, "A Scalable Verification Solution for Blockchains" (TrueBit), 2017 (arXiv:1908.04756) — solves the *verifier's dilemma* (why would anyone actually verify, if verification is costly and rare) with forced-error injection and a bonded challenge-response game; structurally a two-party version of the same audit-incentive problem the tower theorem solves for many levels. **Not cited.**
- Arbitrum's interactive fraud proofs / bisection dispute protocol (Offchain Labs docs, ongoing) — a recursive, bonded, bisecting dispute-resolution hierarchy that narrows a disagreement level by level until a single verifiable step remains, structurally analogous to the tower's level-by-level contraction, independently arrived at in the rollup-security literature. **Not cited.**
- Proof-of-stake slashing economics (Buterin & Griffith, "Casper the Friendly Finality Gadget," arXiv:1710.09437, 2017; and the broader cryptoeconomic-security literature, e.g. a16z crypto's "The Cryptoeconomics of Slashing") — the same `cost of corruption ≥ gain from corruption` deterrence arithmetic, expressed as a fraction of total stake (the 1/3 and 2/3 thresholds) rather than a per-judge bond. **Not cited.**

**How the book's version differs.** The stage game and the amortization result are the paper's real, disclosed contribution (§ Related work: "the amortized-verification framing... is new; the contraction theorem for a stackable audit tower whose auditors are themselves corruptible LLM judges... is new; everything else is imported"). This claim is fair for the *stage game* (Becker) and the *reputation-as-continuation-value* connection (Kreps-Wilson, Fudenberg-Levine, both correctly cited), but the specific recursive-hierarchy-of-auditors structure with disjoint-clique sampling is not compared to the two economics papers (Kofman-Lawarrée, Tirole) whose entire subject is collusion in exactly such hierarchies, nor to the applied crypto-economic mechanisms (TrueBit, Arbitrum, PoS slashing) that solve a materially similar problem — bonded, recursive, incentive-compatible verification — with different but comparable tools (forced errors, bisection, stake-weighted thresholds instead of clique-diversity thresholds).

**What an expert would push back on.** A mechanism-design or crypto-economics referee reading only paper3.tex would ask: how does "sealed sampling from `C` disjoint cliques" compare to TrueBit's forced-error injection or Arbitrum's economic bonding as a way to solve the same "who verifies the verifier" problem, and does the clique-independence assumption survive the same critique Kofman-Lawarrée levels at naive hierarchical auditing (that supervisors and agents can renegotiate side contracts unless the model explicitly forbids it)? The paper's own honest-boundary section already flags that "disjoint cliques" is a monitored, falsifiable assumption and that two nominally rival benches "fine-tuned from the same base model may fail disjointness in exactly the correlated-error cases that matter" — which is, in fact, close to Kofman-Lawarrée's own worry about correlated interests between hierarchy levels, arrived at independently.

**Verdict: contested only in its related-work completeness, not its mathematics.** The stage-game and amortization theorems are correctly derived and verified by script; the omission of the two nearest economics papers on hierarchical auditor collusion, and of the independently-converged crypto-economic verification literature, is a real related-work gap that does not affect correctness but would draw referee comment.

**Reading list.** Becker 1968; Avenhaus, von Stengel & Zamir 2002; Kofman & Lawarrée, *Econometrica* 61(3), 1993; Tirole, *JLEO* 2(2), 1986; Teutsch & Reitwiessner, arXiv:1908.04756; Arbitrum docs, "Interactive Fraud Proofs"; Buterin & Griffith, arXiv:1710.09437.

---

## 9. Reputation is amortized verification: audit spend Θ(T) → Θ(log T) → O(1)

**What the book claims.** Theorem (Amortization), paper3.tex §6: as a judge's verified history length `t` grows, an incentive-compatible audit schedule `ρ_t` can shrink because accumulated reputation-at-stake `vt` substitutes for audit-and-bond deterrence; flat auditing costs `Θ(T)` lifetime; a "loss only if audited" schedule costs `Θ(log T)`; independent revelation (cheats surfacing without audits, rate `r`) drives lifetime cost to `O(1) = aG²/(2dBrv)`. Explicitly labeled: "the fork is empirical" — whether a deployment lives in the log or constant regime depends on measuring `r`.

**Other names for it.** Repeated-game economics: *reputation as continuation value* funding deterrence. This is the paper's most explicitly *derivative* result, and it says so.

**Prior work.**
- D. M. Kreps & R. Wilson, "Reputation and Imperfect Information," *J. Econ. Theory* 27(2), 1982, 253–279 — reputation as equilibrium behavior sustained by a long-lived player's continuation value. [verified, canonical]
- D. Fudenberg & D. K. Levine, "Reputation and Equilibrium Selection in Games with a Patient Player," *Econometrica* 57(4), 1989, 759–778 — extends the reputation-effects result. [verified, canonical]
- R. Dorfman, "The Detection of Defective Members of Large Populations," *Annals of Math. Stat.* 14(4), 1943, 436–440 — the founding group-testing/pooled-audit result, cited by the book as "the right lineage for pooled audit sampling, though we do not use pooling here" — an honest non-use disclosure. [verified]

**How the book's version differs.** paper3.tex §7 states the connection to Kreps-Wilson/Fudenberg-Levine is "exact, not analogical": the inspection game funds deterrence with `bond + stake`, `d(B+vt)`, while the repeated-game literature funds it with pure continuation value; the discount-factor thresholds (`δ ≥ 1/3`, `δ* = 0.3425...`) are named as "the limiting case B=0, ρ=0." This is a correct and precise statement of how a bonded-audit model degenerates into a folk-theorem model, not a claim of new economics.

**What an expert would push back on.** A repeated-games economist would recognize this immediately as "the bond is a substitute for continuation value" and would want the two models unified analytically (one Bellman equation with `B` and `v` as parameters that can be set to zero), rather than presented as two separate theorems with a paragraph connecting them; the paper acknowledges this is possible but does not do it.

**Verdict: firm and correctly self-labeled as a known result restated in a new currency.** The "reputation is amortized verification" framing is a genuine and useful compression of an established idea (Kreps-Wilson/Fudenberg-Levine reputation effects), not a new economic mechanism; the paper's own related-work section says exactly this.

**Reading list.** Kreps & Wilson 1982; Fudenberg & Levine 1989; Dorfman 1943.

---

## 10. Reputation is not a bandit problem; multi-dimensional reputation

**What the book claims.** §"Why reputation is not a bandit problem": four bandit assumptions (stationarity, scalar reward, non-strategic environment, trusted reward signal) are all false for a public reputation substrate, though correct for one operator's *private* routing. Explicitly labeled a "design argument, not a theorem — it has no numbered formal counterpart in any companion paper."

**Other names for it.** Online learning: *multi-armed bandits*, Thompson sampling, UCB. Multi-agent trust: *vector/multi-dimensional trust models*.

**Prior work.**
- T. Lattimore & C. Szepesvári, *Bandit Algorithms*, Cambridge, 2020 — the standard bandit reference, correctly cited. [verified, canonical]
- W. R. Thompson, "On the Likelihood that One Unknown Probability Exceeds Another," *Biometrika* 25(3/4), 1933 — Thompson sampling's origin, correctly cited. [verified, canonical]
- Q. Liu & A. Skrzypacz, "Limited Records and Reputation Bubbles," *J. Econ. Theory* 151, 2014, 2–29 — **note a citation-precision issue**: an earlier edition's bibliography listed this in the *Review of Economic Studies*; the confirmed published venue is the *Journal of Economic Theory*, volume 151 (a working-paper/SSRN version circulated as a Stanford GSB paper). The current chapter sources already carry the correct venue (ledger row LR-312). [verified via the paper's own posted PDF and IDEAS/RePEc record]
- W. T. L. Teacy, G. Chalkiadakis, A. Rogers, N. R. Jennings, "Rumours and Reputation: Evaluating Multi-Dimensional Trust within a Decentralised Reputation System," AAMAS 2008 — a per-dimension trust-vector model for agent contracts, directly on point for the "multi-dimensional quality vector" claim of §"The multi-dimensional reputation protocol," and flagged by the book's own inline reviewer comment (visible in the source `.tex`) as a likely-missed citation that the vector-over-scalar move is probably not novel to this paper. The chapter's own margin note recommends narrowing the contribution claim — a rare and useful piece of built-in self-audit, and the correct call: this is prior art the chapter should cite. [verified as a real AAMAS paper on that exact topic]

**How the book's version differs.** The four-assumption argument is a clean, defensible pedagogical framing, but it is explicitly *not* a theorem and does not claim to be — the chapter is unusually careful to flag its own confidence level here ("stated in the confident register because we believe it... not because it has been proved").

**What an expert would push back on.** A multi-agent-trust researcher would flag exactly what the book's own inline comment flags: multi-dimensional/vector reputation is an established idea (Teacy et al. 2008 for agent trust specifically; more broadly, any reputation system with per-category ratings, e.g. eBay's detailed seller ratings), so the contribution-table cell claiming this as new needs narrowing to the specific *judge-per-axis, bonded, neutral-market* mechanism, which the book's own margin note already recommends.

**Verdict: design argument (unproven, honestly labeled) for the bandit critique; known result under-cited for the multi-dimensional vector.** The chapter's self-correction is worth preserving in any revision.

**Reading list.** Lattimore & Szepesvári 2020; Thompson 1933; Liu & Skrzypacz 2014, *J. Econ. Theory* 151 (correct the venue); Teacy, Chalkiadakis, Rogers, Jennings, AAMAS 2008.

---

## 11. Bounded memory and tombstone revocation as a commons problem

**What the book claims. ** Property `prop:tombstone`: reputation is monotone in *honest* outcomes but individually revocable via a propagating, append-only tombstone (a saga-style compensation, not in-place mutation); bounded memory is framed as "a design parameter, not a virtue to assert away," with the memory window explicitly cast as a *commons* problem.

**Other names for it.** Distributed transactions: the *saga* pattern (compensating transactions for long-lived operations). Institutional economics: *common-pool resource* governance. Reputation economics: *reputation bubbles* under limited records.

**Prior work.**
- H. Garcia-Molina & K. Salem, "Sagas," *ACM SIGMOD Record* 16(3), 1987, 249–259 — long-lived transactions decomposed into steps with compensating actions instead of rollback; correctly cited and correctly applied (append a tombstone, never mutate). [verified]
- Q. Liu & A. Skrzypacz 2014 (as above) — bounded memory can be *welfare-improving* relative to infinite memory, because infinite memory freezes types and removes the incentive to keep performing; correctly cited for exactly this point.
- E. Ostrom, *Governing the Commons*, Cambridge, 1990 — durable common-pool institutions succeed via participant-set boundaries, graduated sanctions, and cheap local conflict resolution, not open access or an imposed global constant; correctly cited and thoughtfully applied to argue the memory window should be participant-governed rather than either "each agent sets its own" or "infinity, imposed."

**How the book's version differs.** This section does the rare thing of applying Ostrom's institutional-design principles (usually invoked for physical commons — fisheries, grazing land, irrigation) to a *data-retention window* in a reputation system, correctly identifying the rivalrous-preference structure (everyone wants their own bad outcomes to age out fast and everyone else's to persist). This is a genuine, well-targeted cross-domain application, not a name-drop; the analogy holds up because the parties really do have the misaligned unilateral incentive Ostrom's framework requires.

**What an expert would push back on.** An institutional economist would ask whether "graduated sanctions" and "cheap local conflict resolution" (Ostrom's design principles 5 and 6) have been operationalized anywhere in the chapter beyond the tombstone protocol, or whether the analogy is asserted at the level of principle without a corresponding mechanism for *who* sets the window (the chapter defers this to the federation chapter).

**Verdict: firm application of established results, correctly scoped.** Both Liu-Skrzypacz and Ostrom are used for exactly the claim they support, and the chapter does not overclaim beyond what either result establishes.

**Reading list.** Garcia-Molina & Salem 1987; Liu & Skrzypacz 2014; Ostrom 1990, *Governing the Commons*.

---

## Table: every idea and its verdict

| # | Idea | Verdict | One-line reason |
|---|------|---------|------------------|
| 1 | Identity as ledger position, not soul (role/person; Locke/Parfit) | Firm, with honest evasion | Correct Parfit reading; Williams's intuition-flip and Olson's animalism are the un-engaged counterweight |
| 2 | Three organs of continuity; "checkpoint with teeth" | Known result restated | Condor (1997) and CRIU already distinguish state-persistence from live execution state; the chapter names the LLM-specific missing artifact (KV-cache) honestly |
| 3 | Non-forgeable identity necessity (sanction-respecting reputation) | Known result restated | A special case of Douceur 2002 / Cheng-Friedman 2005's Sybil-impossibility family; correct but Cheng-Friedman's tighter formal result is uncited |
| 4 | No-mint reputation inheritance (fork = transfer, not copy) | Novel combination, real gap | Sound conservation theorem; Levien's Advogato max-flow trust metric (1999-2000) solves an adjacent conservation problem and is not cited |
| 5 | Engine substitution / Akerlof inside one identity; attestation IC flip | Firm | Textbook Akerlof/Grossman/Milgrom correctly extended, with an exemplary, self-aware related-work section |
| 6 | Resurrection soundness (3 clauses); cross-operator attestation | Firm on local claim; honestly unsolved on cross-operator | 747-state model check is real; DID/social-recovery literature is the natural next citation once cross-operator work begins |
| 7 | Probation cliff (front-loaded newcomer restriction) | Novel, largely verified | LP/exchange argument is correct; relationship to Lazear 1979 is explicitly and honestly left open by the authors themselves |
| 8 | Inspection tower (bonded judges, sealed sampling, disjoint cliques) | Contested in completeness, not correctness | Correct game theory; misses Kofman-Lawarrée 1993 and Tirole 1986 (the two canonical hierarchical-collusion papers) and the independently-converged crypto-economic verification literature (TrueBit, Arbitrum, PoS slashing) |
| 9 | Reputation is amortized verification (Θ(T)→Θ(log T)→O(1)) | Known result restated | Kreps-Wilson/Fudenberg-Levine reputation-as-continuation-value, correctly and explicitly identified by the paper itself as the underlying mechanism |
| 10 | Reputation is not a bandit; multi-dimensional vector | Design argument (unproven) / under-cited | Bandit critique is explicitly unproven by the authors' own admission; vector reputation is prior art (Teacy et al. 2008), flagged by the chapter's own inline reviewer note |
| 11 | Bounded memory / tombstone revocation as a commons problem | Firm | Correct, well-targeted use of Garcia-Molina-Salem sagas and Ostrom's commons-governance principles |

## Terms the book coins privately that already have public names

- **"Checkpoint with teeth"** → public/prior term: *checkpoint/restore of execution state*, or process-migration's distinction between *state persistence* and *live execution context* (Condor 1997, CRIU).
- **"Actor-soul / body-lease"** → public/prior term: *actor identity vs. activation* (Orleans "virtual actor" / grain terminology); more generally, *durable identity vs. ephemeral incarnation* in any actor system.
- **"Sanction-respecting reputation" (the necessity theorem)** → closely overlaps *Sybil-proofness* / *whitewash-resistance* as defined in Cheng & Friedman (2005) and Friedman & Resnick (2001); not a wrong name, but not a new category either.
- **"No-mint inheritance"** → conceptually the same conservation discipline as a *no-double-spend / no-inflation invariant* on a ledger, and functionally close to Levien's *attack-resistant (flow-conserving) trust metric*.
- **"The tower" (recursive bonded audit hierarchy)** → the applied-cryptoeconomics literature already has names for structurally similar mechanisms: *interactive dispute games* / *bisection protocols* (Arbitrum), and the *verifier's dilemma* solved by forced-error injection (TrueBit); economics already has *hierarchical agency with collusion* (Tirole 1986, Kofman & Lawarrée 1993) for the "who audits the auditor" question specifically.
- **"Cross-operator attestation" (named as an unsolved gap)** → the book itself flags (in an inline reviewer comment in the source) an IETF draft, "Bilateral Attestation of Cross-Organization Agent Actions," addressing essentially the same named gap — correctly left uncited as a solution, since the chapter does not claim to solve it, but worth tracking as the term stabilizes elsewhere.
