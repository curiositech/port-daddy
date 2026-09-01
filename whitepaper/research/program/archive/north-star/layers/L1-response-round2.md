# L1 — Round-2 response to reviewers

The graft delivered exactly what I need. The Contract-Net skill body is actually about epistemic reasoning (common knowledge / mutual knowledge masquerade), which is the single most-cited gap across the critiques. Both skills change my answer materially. I have everything I need to respond.

---

## Grafted skills (what I pulled + the one idea from each that changed my answer)

**`decker-lesser-1995-gpgp-taems`** — GPGP/TÆMS coordination. The idea that changed my answer: the skill's own failure-mode catalog lists **"Commitment Cascade Failures"** and **"Premature Coordination Termination"** as *distinct* named failures with detection rules, and its quality gates demand commitment-lifecycle states *and* "no conflicting protocols." This confirms the distsys reviewer's wait-for-cycle critique is a first-class GPGP concern (commitment cascade ≠ delegation loop), and it tells me the q-accumulation/power-factor objection from the FIPA reviewer is right: the skill treats power factor as something *derived from relationship strength analysis*, not a hand-stored primitive. I concede both.

**`smith-1980-contract-net-protocol`** — but the grafted body is actually **epistemic reasoning for MAS** (Big Brother Logic / Kripke models). The one idea that changed my answer: the **"Mutual Knowledge Masquerade"** failure mode — "system assumes coordination after broadcasting… check if agents know that others received the message" — with the fix being a **public-announcement-with-confirmation protocol**, not a broadcast. This is the FIPA reviewer's P0 common-knowledge critique, *independently surfaced by the canon I grafted*. It also names **"Centralization Denial"** ("system uses central knowledge computation but claims to be distributed") — which is verbatim the distsys reviewer's P0. When two independent reviewers and the grafted canon all converge on the same two holes, those are not debatable. I concede both as the headline fixes.

---

## Point-by-point responses

### Critique A — multi-agent-systems / FIPA reviewer

**A1. Contract-Net is not a market; calling bonded CNP "the auction" papers over a mechanism-design discontinuity.**
*Restate:* Smith-1980 CNP has no prices/utility/equilibrium; bolting bonds+reputation on makes it a sealed-bid auction with Vickrey/Myerson incentive constraints, which is a regime change.
**CONCEDE.** Fix: in §4 ("provides toward L3") and the prior-art table, stop writing "Contract-Net *becomes* the auction." Replace with: *"CNP supplies the **message choreography** (announce→bid→award→result); the L3 market replaces CNP's **bid semantics** (a capability/suitability claim) with a **valuation/willingness-to-pay** claim, which is a different mechanism — a sealed-bid auction — governed by auction theory, not CNP."* Add Nisan et al. 2007 (already in registry) and Vickrey 1961 to the citations. Rewrite open-problem 7 to lead with **strategic mis-bidding by honest-identity agents** (the prior threat) and treat Sybil as the second-order threat.

**A2. The common-knowledge problem is entirely absent (P0).**
*Restate:* `agree`/fan-in-barrier/mutual-commitment silently assume broadcast→common knowledge; coordinated-attack proves common knowledge is unattainable over a lossy channel, and this bites before FLP.
**CONCEDE — this is the headline fix.** Both this reviewer *and* my grafted epistemic-CNP skill ("Mutual Knowledge Masquerade") name it. Fix: add a new family **A0 — the epistemic floor** and a starred open problem **★ Agreement attainability under lossy channels (coordinated-attack / two-generals)**. State the partition explicitly: performatives that need only **mutual knowledge** (fire-and-forget `inform`, `cfp`) vs. those that *appear* to need **common knowledge** (synchronized barrier, mutual commitment "X iff you do Y", debate→simultaneous-decide). Then state the engineering escape the grafted skill supplies: **PD never needs true common knowledge because it is daemon-mediated** — the daemon is a trusted third party that converts "B accepted" into an *institutional fact* via a public-announcement-with-confirmation primitive (the daemon records the `agree` and both parties read the daemon's record). This dissolves coordinated-attack the way a notary dissolves it: not by beating the impossibility, but by routing around it through a shared trusted oracle. This also pre-answers distsys-A2 (it makes the centralization a *feature*, deliberately claimed).

**A3. Coordination is by identity, not roles — contradicts FIPA-00025 and breaks composition (P1).**
*Restate:* Envelope carries `sender`/`receiver`; protocols never specified as roles (Initiator/Responder/Auctioneer/Bidder); nested CNP-in-supervisor needs the *same agent* to be Responder-outer + Initiator-inner, impossible without roles.
**CONCEDE.** Fix: rewrite §B so every pattern is `{roles, role→legal-transition table, terminal states, exception edges, timeout policy}`. Add a `role` binding to the conversation, separate from the envelope's `sender` identity (identity authenticates; role authorizes the transition). Composition (B2) becomes **role re-binding across nested `conversationId`s**. Add the explicit invariant: *one identity may hold many roles; a role may change hands mid-conversation; any conformant backend that can satisfy a role's transition table may fill it.*

**A4. GPGP import is shallow: power factor is a free-floating number, not derived from a TÆMS task structure with quality/cost/duration distributions (P1).**
*Restate:* TÆMS relationships are *consequences of* a task structure; the dossier stores relationship+power as primitives — the same "headline only" sin it accuses the seed of.
**CONCEDE** (the grafted GPGP skill confirms power is an analysis output, and its quality gates demand "power factors *quantified for each relationship*" from a relationship analysis, not assigned). Fix: add an explicit L0/L1 dependency — **"the task structure (subtask hierarchy + per-method quality/cost/duration estimates) must live somewhere; PD does not yet have it."** Then *honestly downgrade*: relabel power factor as **"operator-assigned heuristic weight, NOT GPGP-derived"** until a task-structure store exists, and file "derive power factor from a TÆMS structure" as future work. This is the ADR-0045 honest-label discipline applied to our own borrowing.

**A5. BDI is cited but idle — commitment *strategies* (blind/single-minded/open-minded; Cohen-Levesque persistent goal) are the formal answer to "when may an agent drop a commitment," and the dossier's 4-enum lifecycle is an under-theorized shadow (P1).**
*Restate:* Negotiability/decommitment/renegotiation *is* the commitment-strategy question, solved 35 years ago; the citations are decoration.
**CONCEDE.** Fix: add a **commitment-strategy column** to §C mapping the shipped lifecycle (`open/done/abandoned/superseded`) and the GPGP names (`pending/active/satisfied/broken`) to Cohen-Levesque's persistent-goal drop conditions (achieved | believed-unachievable | motivation-gone) and Rao-Georgeff blind/single-minded/open-minded. State that **negotiability index = which commitment strategy the agent runs**, not a free scalar. Let the four cited papers do work.

**A6. Quiescence/FLP picks the wrong half of the canon; the real composition hazard is termination-detection × compensation (snapshot-then-compensate can un-terminate a branch) (P2).**
*Restate:* Dijkstra-Scholten/Chandy-Lamport assume reliable channels + no crashes; the setting has crashes → Chandra-Toueg ◇W; and a Saga compensation issued after a snapshot resurrects a "terminated" branch — the genuinely novel hard problem.
**CONCEDE.** Fix: add Chandra-Toueg 1996 (◇W) as the correct frame and add a starred open problem **★ Termination-detection × compensation composition** ("a compensating action after a quiescence snapshot can resurrect a terminated conversation; what is the safe ordering?"). (This dovetails with distsys-A1's idempotency point — a compensation must be a *new, ordered* event, not a replay.)

**A7. No deadlock / circular-wait treatment — `enables`+counterparty-commitments create commitment deadlock, a different graph from delegation loops (P2).**
*Restate:* F2 detects ping-pong on the delegation chain; nothing detects wait-for cycles in the commitment graph.
**CONCEDE** (my grafted GPGP skill names this exactly: "Commitment Cascade Failures… single commitment break causes >5 secondary breaks OR system cannot reach quiescence"). Fix: add a distinct mechanism **"commitment wait-for-graph deadlock detector"** alongside the delegation loop detector, with the GPGP "circuit breaker / commitment prioritization / graceful degradation" remedy. Two graphs, two cycle detectors.

**A8. `not-understood` is FIPA's canonical loud-fail act; gap-14 reinvents it (P3).**
*Restate:* Use FIPA-00037's `not-understood` instead of presenting loud-fail-on-the-wire as novel.
**CONCEDE.** Fix: add `not-understood` to the performative vocabulary (A1) and re-anchor gap-14's "loud-fail protocol surface" on it. Cheap, correct, removes a false-novelty claim.

### Critique B — deontic-logic / BDI reviewer

**B1. Names a deontic layer but specifies no deontic *logic*; cites Chisholm/CTD as a gap while using monotonic obligation-stacking; no conflict resolution (Critical).**
*Restate:* SDL is paradox-ridden (Ross, Good Samaritan, gentle-murderer, Chisholm CTD); you need defeasible/dyadic/input-output logic to even write "ought not breach; given breach, ought file salvage note," and there's zero O/F conflict machinery.
**CONCEDE.** Fix: commit to a named, bounded logic — **input/output logic (Makinson & van der Torre 2000)** as the best fit ("given these conditional norms + these facts, what is obligatory?"), with **dyadic O(A/B)** for the CTD cases. State the consequence relation and a conflict-resolution rule (specificity + consequence-ranking, mirroring the normative-BDI minimax). Add the explicit note that the norm layer was previously **a label, now a logic.**

**B2. "Permission → capability" collapses the regimentation/enforcement distinction the doc elsewhere gets right; makes "able-but-forbidden" inexpressible — and the project's own `--allow-main-worktree` guardrail is exactly that case (Critical).**
*Restate:* Permission is a normative status (P(a)≡¬O(¬a)); capability is an ability; conflating them means "you *can* force-push to main; you *may not*" cannot be represented, an internal D-vs-E inconsistency.
**CONCEDE — and it's sharp because it lands on our own canon** (guardrails-never-advertise-bypass is precisely capability-present/permission-absent). Fix: **decouple permission from capability.** Permission is a deontic status checked at the protocol/Arbiter layer; capability is the jail's hard boundary. Most actions are *capable-and-permitted*; the dangerous middle (`--allow-main-worktree`, `--no-verify`) is *capable-but-forbidden* — representable only if the two are separate. Add the **ought-implies-can** bridge: an obligation may not require an action outside the agent's capability set.

**B3. Default-closure raised and abandoned; two implicit, possibly-contradictory closure rules at two layers (High).**
*Restate:* Tool layer drifts default-deny (jail), deontic/speech-act layer drifts default-permit; never reconciled or proven to compose.
**CONCEDE.** Fix: state both explicitly and prove composition — **closed-on-capabilities (default-deny tools: nothing runnable unless allowlisted), open-on-speech-acts (default-permit performatives: any well-formed act not Arbiter-forbidden is legal).** State the composition theorem to prove: a forbidden *effect* is unreachable regardless of which *speech act* requests it, because the capability closure dominates.

**B4. Felicity conditions reintroduce FIPA's unverifiable-mental-state dead-end; the escape is Singh-style commitment-based social semantics — and families A and C should be *unified* but aren't (High).**
*Restate:* You can't loud-fail on a sincerity precondition you can't observe; Singh 1998 / Fornara-Colombetti ground semantics in observable social commitments; the dossier has a commitment substrate (C) and never connects it to performatives (A).
**REBUT in part, CONCEDE in part.** *Concede the synthesis:* the dossier *should* unify A and C — give performatives a **commitment-based operational semantics** (an `agree` *is* the creation of a social commitment; a `cfp`-`award` *is* a conditional commitment) rather than FIPA mentalism. This is the most valuable single edit and I'll make it the spine of §A/§C. *Rebut the framing that mentalism was load-bearing:* the dossier already located dishonesty in the *rational-effect vs. perlocution* gap — which is **already the move away from mental states toward recordable effect**; I was 80% of the way to Singh and didn't name him. So: not a reversal, a completion. Fix: cite Singh 1998 and Fornara-Colombetti, merge families A+C, and restate felicity conditions as **commitment preconditions over observable daemon state** (does B already hold a conflicting commitment?) rather than beliefs.

**B5. Protocols asserted as FSMs but no safety/liveness properties; no deadlock treatment; no model-checking despite the repo shipping ProVerif (High).**
*Restate:* Need safety (no agent believes it won an un-made award) + liveness (every conversation terminates; deadlock-freedom), and a model-checked nested composition is the expected bar.
**CONCEDE.** Fix: for each protocol state **safety** ("no inconsistent local state") and **liveness** ("reaches a terminal state; deadlock-free"), cite van der Aalst workflow-net soundness (in registry) as the formal "can always complete" notion, and commit to a **TLA+ model of nested Contract-Net + supervisor-worker proving deadlock-freedom + termination** as the deliverable that matches the repo's ProVerif bar. Pairs with A7 (the deadlock the model must rule out).

**B6. "F2 inside F1" is a slogan; signed task-shape (F) contradicts semantic task-equivalence (open-problem 2) — embeddings aren't deterministically signable (Medium).**
*Restate:* Loop detection needs task-shape equivalence; crypto chain signs hops not semantics; two semantically-equal tasks hash differently, so you can't both sign the shape and match it semantically.
**CONCEDE the tension; REBUT that it's unresolvable.** Fix: split the field. Sign a **canonical structural descriptor** (deterministic: the task's typed inputs/operation/target-surface — a structural hash, signable) at each hop for *authenticated provenance*. Run **semantic equivalence (embeddings) over the unsigned descriptors** for *loop suspicion*, which only ever *raises a `not-understood`/`escalate`*, never silently terminates. So: structural hash is signed and authoritative for provenance; semantic similarity is advisory and human/Arbiter-gated for loop *suspicion*. The two threads stop contradicting once you stop asking the signature to carry semantics.

**B7. CTD (gap 11) and decommitment-penalty (C5) are the same enforcement-quadrant phenomenon, treated as unrelated (Medium).**
*Restate:* Priced decommitment converts "must" → "may at a price" = Jones-Sergot enforcement quadrant = a CTD-conditional (¬breach ought; given breach, pay-penalty ought).
**CONCEDE.** Fix: collapse gap 11 and C5 into one §D treatment: **"enforcement-with-sanction = a CTD structure; the decommitment penalty is the sanction; the salvage-note is the secondary obligation."** One phenomenon, one dyadic-deontic formula.

**B8. Loud-fail needs a runtime-verification frame (LTL monitor synthesis; three-valued verdict) it never invokes (Medium).**
*Restate:* Detecting unanswered-`request`-past-`reply-by` / malformed / gone-silent against an FSM *is* monitor synthesis from temporal properties.
**CONCEDE.** Fix: reframe gap-14 as **runtime verification** — cite Bauer/Leucker/Schallhart three-valued LTL and Havelund; note the hard part is the **anticipatory true/false/unknown verdict** for liveness you can't yet refute (an unanswered `request` is *unknown* until `reply-by`, then *false*). This is also the seam where the at-least-once-redelivery problem (distsys-A6) gets handled: the monitor dedups before it judges.

### Critique C — distributed-systems reviewer

**C1. No consistency model; at-least-once delivery means every performative handler must be idempotent, and idempotency is never named (Foundational).**
*Restate:* `inform` re-delivery, double-processed `award`, replayed `cancel` are routine under at-least-once; this is more fundamental than felicity conditions.
**CONCEDE.** Fix: add a new substrate section between A and B: **the wire-contract requires all performative effects to be idempotent**, keyed by a content-addressed message ID, with a stated dedup window. Cite Helland 2007/2012 (idempotence) and Lamport 1978. This is the cheapest highest-leverage fix and I'll mark it BUILT/DESIGNED honestly (the envelope does *not* have an idempotency key today → DESIGNED).

**C2. The single daemon is a SPOF and a hidden consistency oracle; the dossier wants the credit of leaderless-distributed while shipping centralized (P0 contradiction).**
*Restate:* Either the daemon is linearizable (quiescence is a trivial SQLite query and FLP/Chandy-Lamport is theater) or agents are truly distributed (daemon is a partition-prone participant owing a crash story). Can't have both.
**CONCEDE — this is the second headline fix, and the grafted CNP skill names it verbatim ("Centralization Denial").** Fix: **declare PD a CP system with a central coordinator (the daemon) and distributed clients.** In the common case, **quiescence is a local SQLite query** — say so plainly. Re-scope FLP/Chandy-Lamport/Dijkstra-Scholten to the *only* place they bite: **agent↔daemon partition and daemon crash/restart mid-conversation.** This is not a retreat — it is what makes the A2 common-knowledge escape work (the daemon is the trusted notary). Add the explicit honest line: *"the distributed-termination theory applies to the partition edge; in the connected case the coordinator observes termination directly."*

**C3. No idempotency key / dedup / delivery-receipt in the envelope (follows C1).**
**CONCEDE** — same fix as C1: idempotency key + dedup window + the rule that claim/award/commitment-open are idempotent by construction.

**C4. Causal ordering missing — `conversationId`+`inReplyTo` is a reply tree, not a causal order; q-accumulation may aggregate over an inconsistent cut (Medium).**
*Restate:* Nested protocols produce concurrent `inform`s whose order matters; cites Chandy-Lamport (snapshots) but not Lamport happened-before (the prerequisite).
**CONCEDE.** Fix: add **Lamport happened-before** and an optional **causal-delivery** envelope mode (default FIFO-per-channel; causal for fan-in barriers and q-accumulation). State that a snapshot is meaningless without a causal order to be consistent with.

**C5. Failure detector named in passing, never specified — it's the crux; G3 ("when is silence a failure") is the FD spec filed as a sub-bullet (P1).**
*Restate:* Too-aggressive suspicion → spurious re-`cfp`+duplicate work; too-lax → distress starvation; commit to a Chandra-Toueg class.
**CONCEDE.** Fix: promote G3 to a first-class **failure-detector spec at the L0/L1 seam**: heartbeat interval, suspicion timeout, suspect→`failure` promotion rule, **target class ◇W (eventually weak)** — the weakest class sufficient for the eventually-correct quiescence the dossier already claims. Tie false-positive rate directly to spurious-re-`cfp` cost.

**C6. Loud-fail (ADR-0045) collides with at-least-once: routine redelivery/reorder/timeout-then-succeed would drown the operator; silent dedup of a redelivery is *mandatory, not a sin* (P1, two canon ADRs contradict).**
*Restate:* The dossier treats "silent drop = bad" as axiomatic but at-least-once *requires* silent dedup.
**CONCEDE.** Fix: draw the line explicitly — **benign transport non-determinism (duplicate, reorder, retry-then-succeed) → dedup silently; genuine protocol violation (malformed act, unanswered `request` past `reply-by`, contradicted commitment) → fail loud.** The runtime monitor (B8) sits *after* the dedup layer (C1), so it only ever judges deduplicated, causally-ordered events. This reconciles ADR-0045 with the tube's semantics and removes the false-alarm flood.

**C7. Capability attenuation needs a monotonicity proof, not prose; ProVerif proves crypto secrecy/authenticity, not lattice-monotonicity-under-composition (Medium).**
*Restate:* "B's caps ⊆ A's" across delegate+nest is a separate theorem from the anchor-protocol crypto proof.
**CONCEDE.** Fix: split the proof obligation. Keep the ProVerif crypto-attenuation proof; add a **separate TLA+/Alloy model of the capability lattice under `delegate` + `spawn-sub-protocol`** proving monotonicity, OR an explicit reduction showing coordination-attenuation is entailed by crypto-attenuation. State they are two theorems.

**C8. Backpressure under-theorized; it's multi-class priority scheduling with a strict non-starving distress class, and naive priority queues livelock under redelivery (P2).**
*Restate:* "Coalesce inform, never delay distress" is priority-inversion-free scheduling — cite the actual discipline.
**CONCEDE.** Fix: cite priority-inheritance + credit-based flow control (LMAX/Disruptor-style backpressure); state the property: **distress is strict-priority and non-blocking, lower classes are non-starving, and the scheduler operates on deduplicated events** (so redelivery can't livelock it). Pairs with C1/C6.

**C9 (additive). No daemon-crash recovery story.**
**CONCEDE.** Fix: add the actual fault-tolerance question for *this* architecture — across a daemon restart (SQLite WAL gives durability), are `conversationId`s recovered? Are pending `award`s re-driven? State this as the load-bearing fault-tolerance work, ranking it *above* the distributed-quiescence theory the dossier foregrounded.

---

## Revised layer position (load-bearing claims, now corrected)

1. **PD is a CP system: a central coordinator (daemon) + distributed clients.** This is now *claimed, not hidden*. It makes quiescence a local SQLite query in the connected case, and it is the deliberate mechanism that routes around the coordinated-attack impossibility — the daemon is a trusted notary that turns "B agreed" into an institutional fact. FLP/Chandy-Lamport/Dijkstra-Scholten/Chandra-Toueg apply **only at the partition and daemon-crash edges**, which is where the honest distributed-systems work lives (idempotency, failure detector ◇W, crash recovery).

2. **The epistemic floor (new family A0) precedes the message layer.** Performatives are partitioned into *mutual-knowledge-sufficient* (`inform`, `cfp`) and *common-knowledge-requiring* (synchronized barrier, mutual commitment, simultaneous decide); the latter are made attainable only through daemon-mediated public-announcement-with-confirmation. Agreement-attainability is a starred open problem.

3. **Performatives have a commitment-based operational semantics (families A and C unified).** An `agree` *is* the creation of an observable social commitment; felicity conditions are commitment preconditions over daemon state, not unverifiable beliefs (Singh 1998). This makes loud-fail-on-insincerity *possible*.

4. **The norm layer is a logic, not a label.** Input/output logic (Makinson–van der Torre) + dyadic deontic O(A/B) for CTD; explicit O/F conflict resolution; permission ≠ capability; ought-implies-can bridges D and E; closed-on-capabilities + open-on-speech-acts with a stated composition theorem. CTD and decommitment-penalty are one enforcement-with-sanction phenomenon.

5. **Protocols are role-parameterized FSMs with stated safety + liveness, model-checked.** Roles not identities; composition is role-rebinding across nested conversations; a TLA+ model of nested CNP+supervisor proves deadlock-freedom and termination (matching the repo's proof bar). Two cycle detectors: delegation-loop and commitment-wait-for-graph.

6. **The wire is sound under at-least-once:** idempotent effects keyed by content-addressed message ID + dedup window; Lamport happened-before + optional causal delivery; ◇W failure detector at the L0/L1 seam; loud-fail sits *after* dedup so it never cries wolf on a redelivery.

7. **Contract-Net supplies choreography, not a market.** Bonded bidding is a *different mechanism* (sealed-bid auction) with its own incentive-compatibility burden; the prior threat is strategic mis-bidding, Sybil is second-order.

8. **Two delegation-chain theorems, not one slogan.** Crypto-attenuation (ProVerif, BUILT) authenticates hops via a signed canonical structural descriptor; semantic loop-suspicion (embeddings, advisory, human/Arbiter-gated) runs over the unsigned descriptors and only escalates, never silently terminates.

9. **Honest-state correction:** the envelope's missing idempotency key, causal-order field, and failure-detector spec are now explicitly **DESIGNED, not implied-BUILT**; power factor is downgraded to **operator-assigned heuristic, not GPGP-derived**, pending a task-structure store. Everything remains conditional on the unbuilt non-forgeable identity (ADR-0040).

---

## Change-list for the paper author

1. **Add family A0 (epistemic floor)** + starred open problem **★ agreement-attainability (coordinated-attack)**; partition performatives by mutual- vs common-knowledge need; document the daemon-as-notary escape. *(A2, C2)*
2. **Declare PD a CP system; re-scope FLP/Chandy-Lamport/Dijkstra-Scholten to the partition/crash edge; add Chandra-Toueg ◇W; state quiescence is a local SQLite query in the connected case.** Add a **daemon-crash recovery** subsection. *(A6, C2, C5, C9)*
3. **Insert a wire-soundness substrate between §A and §B:** idempotency key (content-addressed) + dedup window + idempotent-effects rule; Lamport happened-before + optional causal delivery. Cite Lamport 1978, Helland 2007/2012. *(C1, C3, C4)*
4. **Unify families A and C with a commitment-based operational semantics** (Singh 1998, Fornara-Colombetti); restate felicity conditions as observable commitment preconditions; add `not-understood`. *(A8, B4)*
5. **Replace §B with role-parameterized FSMs** `{roles, transition table, terminal, exception, timeout}`; composition = role-rebinding; state safety + liveness per protocol; commit to a **TLA+ model of nested CNP+supervisor (deadlock-freedom + termination)**; cite van der Aalst soundness. *(A3, B5)*
6. **Give §D an actual deontic logic:** input/output logic + dyadic O(A/B); O/F conflict resolution; **permission ≠ capability**; ought-implies-can bridge to §E; closed-on-capabilities/open-on-speech-acts composition theorem; collapse CTD + decommitment-penalty into one enforcement-with-sanction treatment. *(B1, B2, B3, B7)*
7. **Add a commitment-strategy column to §C** (Cohen-Levesque persistent goal; Rao-Georgeff blind/single/open-minded); restate negotiability as "which strategy." Add **commitment wait-for-graph deadlock detector** distinct from delegation-loop detector. *(A5, A7)*
8. **Reframe gap-14 as runtime monitor synthesis** (Bauer/Leucker three-valued LTL, Havelund); place the monitor *after* dedup; define the benign-non-determinism vs. protocol-violation line. *(B8, C6)*
9. **Fix the Contract-Net→market framing:** CNP = choreography only; bonded bidding = sealed-bid auction; cite Nisan 2007 + Vickrey 1961; rewrite open-problem 7 to lead with strategic mis-bidding. *(A1)*
10. **Split the delegation-chain into two theorems:** signed canonical structural descriptor (provenance) vs. advisory embedding-based loop-suspicion (escalation-only); add a **TLA+/Alloy capability-lattice monotonicity proof** separate from the ProVerif crypto proof. *(B6, C7)*
11. **Add §C8 backpressure discipline:** strict non-blocking distress class + non-starving lower classes + credit-based flow control, operating on deduplicated events; cite priority-inheritance / Disruptor. *(C8)*
12. **Downgrade power factor** to "operator-assigned heuristic, not GPGP-derived" with a stated dependency on an absent TÆMS task-structure store. *(A4)*
13. **Citations to add:** Singh 1998; Fornara & Colombetti; Makinson & van der Torre 2000; Hansson (dyadic deontic); Chandra & Toueg 1996; Lamport 1978; Helland 2007 & 2012; Nisan et al. 2007; Vickrey 1961; Bauer/Leucker/Schallhart; van der Aalst workflow-net soundness; Cohen & Levesque 1990 and Rao & Georgeff 1991 (promote from idle to load-bearing). Birman virtual-synchrony as the optional group-membership analogue for §G. Explicitly *do not* cite Paxos/Raft (no state is replicated — single SQLite — citing consensus would over-claim)."
      },
      {
        "key": "L2",
        "title": "the Leviathan (legibility & authority)