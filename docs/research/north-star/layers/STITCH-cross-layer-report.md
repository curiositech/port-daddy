# Cross-Layer Stitch Editor's Report — Port Daddy Harbor Volume

The spine confirms the four-layer L0→L3 split, the through-line (memory + checkpoint → continuity → person → reputation → market), and the legibility-with-zoom rule. ADR-0048 names ADRs 0040 (identity), 0041 (commitments), 0045 (Arbiter/attest), 0046 (GUI=L2), 0047 (protocol=L1) as the children that hang off it. Everything below is reconciled against that frame.

---

## 1. Consistency Report — where two layers disagree, and the canonical resolution

The four dossiers were written in isolation. They agree remarkably often on the *shape* of the stack, but they collide in twelve places where the same word means different things, an adjacency contract is asymmetric, or the through-line gets a different load-bearing premise at each rung. Each conflict gets a canonical resolution that all four papers must adopt.

### C1 — "The Arbiter makes forbidden states unreachable" (regimentation vs. detection)
**The conflict.** L0 §1.5/I8 calls the Arbiter a "runtime reference monitor" that makes forbidden states "physically unreachable" (then honestly hedges to "BUILT-WEAK, detect-not-prevent"). L1 §D1 lifts this verbatim ("Arbiter regimentation… forbidden coordination states unreachable"). L2 §1.B.6 calls the Arbiter "the enforcement arm… makes irreversible-on-stale-premise acts *unreachable*." L3 §4 assumes "the Arbiter as the enforcement arm." All four inherit the same overclaim. The L0 security critique (Critique 2, gap 1) is decisive: `arbiter.ts:328` is `activityLog.subscribe(...)` — a **post-commit log subscriber**; by Schneider's own theorem (which all dossiers cite) a monitor downstream of commit enforces *no* safety property, only detection + compensation.

**Canonical resolution.** Adopt one vocabulary across all four papers, with a per-rule split:
- **Regimented (inline, pre-commit, truly unreachable):** *only* what a SQLite constraint or a fail-closed boot gate enforces — PK-backed mutual exclusion (double-claim, PID-squat-as-PK), the prod-DB-in-test guard, `attest` refuse-to-serve. Credit these to the **PK constraint / boot gate**, NOT the Arbiter.
- **Enforced (post-commit, detected-and-compensated, bounded window):** every Arbiter *subscription* rule — `HEARTBEAT_FRESHNESS`, `NOTE_MONOTONICITY`, `CAP_ESCALATION` (even FFI-backed, because the check runs after the activity-log write), etc.
The phrase "physically unreachable" is **banned** except for the regimented set. Everywhere else: "detected within a bounded window, then halted/compensated." This is the single most important wording fix in the volume; it appears in all four papers and is currently false in all four.

### C2 — Non-forgeable identity (ADR-0040): keystone, but its threat model does not reach L3
**The conflict.** All four name ADR-0040 as "the highest-leverage unbuilt keystone." L0 (I12), L1 ("every L1 honesty claim is conditional on it"), L2 (the continuity→reputation precondition), and L3 ("the score is cheap; the substrate it scores over… is the gate") agree it is load-bearing. But the L3 crypto critique (Critique 2, gap 1, BLOCKING) found that ADR-0040's *own* threat model is **intra-fleet, single-operator, explicitly "not a PKI," explicitly no defense against a hostile operator** — exactly the adversary L3 is *defined* by (mutually-distrusting operators across a boundary "neither controls").

**Canonical resolution.** Split the keystone into two:
- **ADR-0040 (identity-local):** non-forgeable actor identity *within one trusted daemon*. This is what L0/L1/L2 actually need and assume. Keep calling it the keystone for Papers 1–3.
- **A NEW, named gap — call it the *cross-operator attestation* problem (ADR-0040b, unwritten):** binding `actor_id` keys across harbors you don't own, i.e. an actual key-distribution/attestation story. This is what L3/Paper 4 needs and does **not** yet have. The witness log gives log-integrity, not identity-binding.
Every paper must state which of the two it depends on. Papers 1–3 lean on 0040; Paper 4 must declare 0040b as DESIGNED-to-VISION and stop describing the boundary as one "neither controls" while resting on a single-trusted-operator root. **This is the keystone-load-bearing-beyond-rated-capacity finding and it must be reconciled before Paper 4 ships.**

### C3 — The single daemon: centralized authority vs. leaderless-distributed framing
**The conflict.** L0 is emphatic and correct: one writer, one machine, one file, no consensus; FLP is *deliberately not* an L0 problem. L1 borrows the *distributed* canon (Dijkstra-Scholten, Chandy-Lamport, FLP) to frame quiescence detection. The L1 distributed-systems critique (Critique 3, gap 2) catches the contradiction sharply: PD **has a central observer** (the daemon owns the commitment clock, the breach monitor, the Arbiter), so either quiescence is a trivial local SQLite query (FLP doesn't bite) or the agents are genuinely partition-prone (and then the daemon's SQLite is the bottleneck and needs a crash-recovery story). The dossier wants the intellectual credit of the leaderless framing while shipping the centralized architecture.

**Canonical resolution.** Declare the whole stack, L0 through L2, **CP with a central coordinator (the daemon) and distributed clients**. Within one harbor: quiescence is a *local query against the daemon's SQLite*, and the distributed-termination canon (Dijkstra-Scholten/Chandy-Lamport/FLP) applies **only** at the two edges where the daemon is not the sole observer: (a) agent-partitioned-from-daemon, and (b) cross-harbor (L3). This is not a retreat — it is the honest engineering statement, and it is fully consistent with L0's single-writer thesis. L1 must scope its FLP/snapshot citations to those two edges. L3's federation is where the leaderless canon *actually* bites, and it already (correctly) refuses consensus there.

### C4 — Delegation chain: one name, two objects (crypto vs. loop-detection)
**The conflict.** L1 §F catches this within itself: `delegation-chain.ts` (BUILT) is the **cryptographic** hop-binding/anti-replay chain; the **coordination** chain (loop-detection, block-upward, terminate-on-repeated-task-shape) is DESIGNED and a *different object*. But L0 §5 lists "cryptographic delegation primitives" as a provision, and L3 §4 assumes "capability attenuation (Anchor)" — and neither L0 nor L3 notices that the *coordination* meaning even exists. So "delegationChain" in the envelope (L1 §A2) is ambiguous across the volume.

**Canonical resolution.** Fix two names, used identically in all four papers:
- **`auth-chain`** = the cryptographic Ed25519 hop-bound, attenuation-monotonic chain (L0-provided, Anchor, ProVerif-verified). This is what L3 capability-transfer rides.
- **`delegation-trace`** = the coordination object: the task-lineage over which loop-detection and upward-block run (L1 DESIGNED).
The relationship (also a fix): **the `delegation-trace` is carried inside the `auth-chain`** — loop-detection runs over a lineage whose authenticity the crypto chain guarantees. The L1 deontic critique (Critique 2, gap 6) is right that this is currently a slogan: for it to be real, the *task-shape* field must be in the signed payload at each hop, which collides with the NO-KEYWORD-NLP / semantic-equivalence requirement for loop-detection (embeddings/structural-hash are not deterministically signable). Flag this tension explicitly as an open problem in Paper 1; do not assert "trace inside chain" as solved.

### C5 — Sagas / cross-organ atomicity: VISION at L0, the-cheap-correct-answer at L1, the wrong-functor at L3
**The conflict.** Three layers independently reach for Garcia-Molina & Salem Sagas and disagree on its status. L0 §3.11 calls cross-organ atomicity "VISION." The L0 reliability critique (Critique 1, gap 3) corrects this: it is the Saga problem with a **cheap local fix** (`db.transaction()` already exists in the codebase), so it is a *defect*, not a frontier. L1 §B4 uses Sagas correctly for protocol-cancellation compensation. L3 §Gap 4 reaches for Sagas to do **reputation revocation** — and the L3 category-theory critique (Critique 3, gap 4) shows the Sagas functor *does not transport* there: bonds form a conserved monoid (compensation restores the conserved total), reputation does not (trust spent during the propagation window is not recoverable).

**Canonical resolution.** Three distinct statuses, stated explicitly:
- **L0 intra-harbor cross-organ atomicity:** a *defect with a known cheap fix* — wrap multi-organ writes in `db.transaction()` / `BEGIN IMMEDIATE`. Re-label from VISION to "buildable now." (Paper 2.)
- **L1 protocol-cancellation compensation:** Sagas applied correctly (release claim, free port, abandon commitment). DESIGNED. (Paper 1.)
- **L3 reputation revocation:** Sagas **does not apply** — state the structural impossibility (no conserved quantity to restore), and frame the real mechanism as tombstone-propagation bounded by the revocation-convergence bound, NOT compensation. (Paper 4.) Drop Sagas from the L3 prior-art table for reputation; keep it only for bond settlement.

### C6 — Conservation "composes upward": exact functor (L3 §4) vs. lax/unproven (L3 §3)
**The conflict.** This is L3-internal but it is *the* consistency invariant the whole volume's economy rests on, so the stitch must rule on it. L3 §4 states "conservation composes upward" as the single cross-boundary invariant (exact structure-preservation). L3 §3 Open Problems #3 and #9 admit cross-harbor *multi-currency / non-fungible* settlement is conjectured impossible / breaks the clean invariant. The category-theory critique (Critique 3, gap 1) names this precisely: single-currency federation is a *conservative functor* (proven); multi-currency is at most a *lax functor* (preserved only up to the bounded-escrow slack φ) with unproven coherence.

**Canonical resolution.** Demote §4 to its proven scope, in Paper 4: *single-unit-of-account federation is a conservation-preserving functor (proven, `fh-cross-cons`); multi-currency / non-fungible federation is at most lax, bounded by φ, coherence unproven.* The slogan "conservation composes upward" may stand only with that qualifier. And unify Open Problems #3/#4/#9 as one sheaf-gluing/cohomology-obstruction question (the double-spend/equivocation race is the non-vanishing of H¹ of the gluing) — this earns the Spivak citation the manifesto already makes and sharpens three vague problems into one.

### C7 — The through-line's foundation is soft at exactly the rung each layer leans on
**The conflict.** ADR-0048's through-line — memory → checkpoint → continuity → person → reputation → market — is invoked by all four, but each layer leans on a *different* organ and each names a *different* soft spot:
- L0: continuity "bottoms out here," but resurrection **passes notes, not checkpoints** (BUILT-WEAK; OP-4 "checkpoint with teeth" is the most important unbuilt L0 thing).
- L2: "legible continuity = the L3 keystone… no legible continuity → no reputation → no tradeable agent."
- L3: reputation keys on the **third** organ (the witnessed-outcome ledger, DESIGNED), explicitly *not* the memory stream.

These do not contradict — but no single paper states the chain's weakest link as one sentence, so the reader meets three different "the foundation is soft here" claims.

**Canonical resolution.** One canonical sentence, repeated identically at the L0→L3 seam in every paper: **"The economy rests on three continuity organs — memory (BUILT), checkpoint (BUILT-WEAK: notes, not execution state), and the witnessed-outcome ledger (DESIGNED) — and reputation keys on the third, which does not yet exist; the checkpoint organ is the weakest *built* link and 'resurrection with teeth' (real execution-state checkpoint) is the literal foundation of L3."** This makes OP-4 (L0) and the outcome-ledger gap (L3) the *same* finding viewed from two ends.

### C8 — At-least-once transport vs. loud-fail honesty (ADR-0045)
**The conflict.** L0 provides tube as a durable, at-least-once, ordered bus. L1 §gap-14 and L2 (the legible-sovereign / honest-`done`) both invoke ADR-0045 loud-fail: every protocol anomaly is a "typed visible signal," "silent drop = sin." The L1 distributed-systems critique (Critique 3, gap 6) catches the collision: under at-least-once, a *healthy* system routinely redelivers and reorders, so "every anomaly is loud" plus "silent dedup is a sin" makes the operator drown in false alarms from normal transport behavior — two canon ADRs (0045 honesty, tube at-least-once) contradict, and no dossier notices.

**Canonical resolution.** Add a missing substrate clause to the adjacency contract, stated in Paper 1 (L1) and assumed by Paper 2 (L0): **benign transport non-determinism (redelivery, reorder, retry-then-succeed) MUST be deduped silently; only genuine protocol-FSM violations (malformed performative, unanswered `request` past `reply-by`, gone-silent counterparty after the failure-detector promotes suspicion→failure) surface loudly.** This requires an **idempotency key + dedup window in the envelope** (currently absent — L1 §A2 has only `inReplyTo`/`conversationId`) and makes every performative effect idempotent by construction. This is the cheapest highest-leverage L1 fix and it reconciles ADR-0045 with the tube's own semantics.

### C9 — Permission → capability (the deontic/enforcement collapse)
**The conflict.** L1 §D1 maps "permission → capability." L3 §4 makes the Arbiter jail "the residual control right (Grossman-Hart) that makes leasing contractible." Both treat capability as the realization of permission. The L1 deontic critique (Critique 2, gap 2) shows this collapses the very regimentation/enforcement distinction the volume gets right elsewhere: deontic *permission* (you *may*) is not *capability* (you *can*). The collapse makes "able but forbidden" — e.g. the project's own `--allow-main-worktree` flag that exists but must not be used — **inexpressible**, contradicting the guardrails-never-advertise-bypass rule in the operator's own memory.

**Canonical resolution.** Separate the two in Paper 1 and Paper 4: **capability = ability (what the jail makes possible); permission = normative status (what the deontic layer allows).** The jail bounds the *legitimate obligation set* (ought-implies-can: you may not be *obliged* to do what you are not *capable* of), but capability-present-permission-absent must remain a representable state. L3's "jail = residual control right" survives (it is about *ability* allocation, which is correct for Grossman-Hart), but L1 must stop equating permission with capability.

### C10 — "Reputation never ends" vs. revocation + append-only
**The conflict.** L3 §1.C states "never ends (no decay window an agent can outrun)" as a *property*. L3 §Gap-4 and Open Problem #8 say you must be able to surgically retract a fraudulent settled outcome. A property and its required violation cannot both be load-bearing — and the mechanism-design critique (Critique 1, gap 2) adds that no-decay is *mechanism-design-hostile* (Liu-Skrzypacz reputation bubbles; bounded memory is often welfare-improving, a tunable, and ∞ is rarely optimal).

**Canonical resolution.** Restate as: **reputation is monotone in *witnessed* outcomes, but a witnessed outcome is itself revocable via a propagating tombstone** (bounded by the revocation-convergence bound, per C5/C6). "Never decays" applies to *honest* outcomes only; it is not an anti-revocation property. And explicitly engage bounded-memory-as-a-design-parameter rather than asserting no-decay as a virtue. (Paper 4.)

### C11 — Discovery / `pd whois`: L1 object or L2 object? And is the ranker truly unified?
**The conflict.** L1 §G claims "half of discovery is L1" (a performative needs an addressee; candidate-selection for contract-net *is* a DF query). L2 §1.A.5 and §2-gap-10 claim discovery as an L2 read-surface and assert the Attention-Queue ranker and the `whois` ranker are **the same function**. The information-design critique (Critique 3, gap 1) shows the unification is false-as-stated: `whois` maximizes *fit* (capability match), the Attention Queue maximizes *regret-if-ignored* (stakes × irreversibility × anomaly) — different objectives, not one ranker with swapped weights.

**Canonical resolution.** Place discovery's **directory substrate** (existence/white-pages/yellow-pages, FIPA DF/AMS, presence) in **L1** (Paper 1) — it is what a performative addresses. Place the **ranking/relevance surfaces** (`whois`, Attention Queue, suggestibility) in **L2** (Paper 1's L2 wedge). The ranker claim is demoted everywhere to: **shared candidate-generation + recency-decay substrate; distinct scoring heads (`fit` for agent-facing whois, `regret` for operator-facing Attention Queue).** No paper may say "the same ranker."

### C12 — Staleness/decay discipline applied unevenly across read-surfaces
**The conflict.** L0 ships pheromone decay (BUILT) and TTL-swept claims/locks (BUILT). L2 inherits decay for pheromones but the information-design critique (Critique 3, gap 4) catches that the **briefing projection, resurrection handoff, and attest read-surfaces have no stated staleness discipline** — and the operator's own "dead Codex-CLI session owners" memory is exactly this failure (stale claims vetoing live work). L0 has the mechanism (TTL, decay); L2 doesn't uniformly apply it to its digests.

**Canonical resolution.** State one rule in Paper 1's L2 chapter: **every read-surface projection (briefing, resurrection note, whois result, attest report) carries an explicit TTL/recency-decay; a dead-session claim must decay out of "current," not persist as misleading truth.** Worked example: the dead-Codex-owner case. This is a free inheritance from L0's existing decay/TTL primitives — it is a *use*, not new mechanism.

---

## 2. Completeness Verdict — what is STILL missing for the stack to be airtight, prioritized

I rank by *how many layers break if it stays missing*.

**P0 — Cross-cutting; the stack is not airtight without these:**

1. **Cross-operator attestation (ADR-0040b).** (C2) The keystone for Papers 1–3 exists in design; the *cross-operator* version L3 needs does not, and L3 currently borrows the single-operator one. Without it, Paper 4's "boundary neither controls" is resting on a trusted root. **Highest priority** — it gates the entire market thesis.

2. **Checkpoint with teeth (OP-4 / the third continuity organ).** (C7) The through-line of the whole volume leans on "resurrection with teeth," and shipped resurrection passes notes. The minimal artifact (content-addressed snapshot of {working-tree diff + open claims + commitment set + last-N transcript turns}) is unbuilt and is the literal foundation of L3 reputation. Until it exists, the economy is built on sand and every paper should say so in the same words.

3. **The envelope substrate layer L1 is missing between "message" and "protocol."** (C8) Idempotency key + dedup window + causal order (Lamport happened-before) + a concrete failure-detector spec (Chandra-Toueg class: which one?). Three of the four L1 critiques independently flag pieces of this. Without it the performative taxonomy is *unsound under PD's own stated at-least-once transport*, and the loud-fail/honesty discipline self-contradicts.

4. **The grading-oracle's incentive-compatibility.** (Mechanism-design critique, gap 3) Every folk-theorem IC claim in L3 bottoms out in "the daemon derives the grade," but the grade is produced by a capturable evaluator (L2's adversarial review / L3's neutral judges). This is not a side-gap — it is a hole in the *core theorem*. Either prove the oracle strategy-proof or bond-and-slash the judges and prove the rate-the-raters recursion terminates. Gates Paper 4's central result and Paper 3's reputation-substrate claim.

**P1 — Layer-critical; one paper is not airtight:**

5. **L0 durability by fault class.** (Reliability critique, gap 1, BLOCKING for Paper 2) I1 must split: I1a process-crash-durable (BUILT, `synchronous=NORMAL`), I1b power-loss-durable (NOT GUARANTEED under NORMAL). The code's own justifying comment is wrong and contradicts the Gray-Reuter citation. The kernel's foundational promise is overstated by exactly the fault class the pitch most invites.

6. **A stated deontic logic for L1.** (Deontic critique, gaps 1, 7) L1 names a norm layer but specifies no logic — no consequence relation, no O/F/P conflict resolution, no contrary-to-duty treatment (Chisholm is cited as a gap while monotonic obligation-stacking is used throughout). Pick one (input/output logic à la Makinson-van der Torre fits best) and collapse CTD + decommitment-penalty into one enforcement-quadrant treatment.

7. **The operator-attention objective, re-spined on Signal Detection Theory.** (HCI critique, gaps 1, 3) L2's "attention-seconds-per-correct-decision" has no miss-cost term and is Goodhart-optimizable toward waving things through. Add the asymmetric miss/false-alarm cost matrix; this also fixes the canary-catch-rate governor's own reflexivity problem (Campbell's Law — political-theory critique gap 4).

8. **Consent as a first-class primitive (L2).** (Political-theory critique, gap 1) "The operator consents to cede authority" is a load-bearing assertion with no scope, no revocation, no exit. Add a scoped/revocable consent grant + an inalienable operator-override right. (Bonus: the consent grant is *exactly* what L3 hosted-trust transfers — it gives Paper 4 a concrete object to price.)

**P2 — Real, but localized:**

9. The **principal-above-the-actor** as a first-class economic entity (L3 Gap 1) — the clean Sybil-bond-farming fix, needs a cryptographic binding mechanism.
10. **OS-sandboxing honesty (L1 jail):** state plainly that `session_files` claims are *advisory coordination*, not OS-enforced isolation; either ground the jail in Landlock/unveil/Seatbelt or disclaim OS sandboxing. (Security critique.)
11. **Vigilance + alarm-management literature** for the L2 Distress lane (HCI critique gaps 1, 6) — an uncontrolled-false-alarm mayday channel self-destructs; the escalation predicate must be a rationalized alarm philosophy (ISA-18.2), not a TODO.
12. **Kernel-recovery / boot-integrity invariant** (L0) — the dossier covers agent death exhaustively and kernel death barely.

---

## 3. The Reconciled 4-Paper Mapping

The proposed carve-up is **confirmed in its spine**, with four content reassignments and one structural note.

### Paper 1 — *The Legible Swarm* (the L2 wedge) — CONFIRMED, with L1-discovery imported
- **Owns:** all of L2 (legibility read-surfaces + the authority half), plus the **L1 directory substrate** (per C11: existence/white-pages/yellow-pages belong with the wedge's discovery story, even though the protocol that addresses them is Paper 1-on-L1).
- **Open problems landing here:** forced-zoom sampling rate (couples to L3 reputation — flag the bridge), operator-attention objective (re-spined on SDT, P1#7), compaction-quality-as-attest-invariant, legibility information-theoretic lower bound, abdication-resistance, consent primitive (P1#8).
- **Wants a different home:** L2's "completionist-`done`-as-verifier" *mechanism* is net-new VISION and is really an **L1 commitment-with-satisfaction-predicate** (it *is* a commitment whose oracle is a verifier). Specify the mechanism in Paper 1's L1 chapter; consume it in the L2 chapter. The escalation *predicate* (alarm philosophy) also lands here but depends on L3 reputation — flag as a forward-reference, don't fully specify.

### Paper 2 — *The Anchor Protocol* (L0–L1 substrate) — CONFIRMED, but the title under-scopes it
- **Owns:** the L0 kernel (substrate, resource, identity-local, communication, obligation/enforcement, continuity, self-attestation organs) and the L1 *protocol substrate* that is BUILT (tube, pheromones, commitments, crypto `auth-chain`, Arbiter).
- **Naming note:** "Anchor Protocol" in the codebase is the *cross-harbor capability-transfer* ceremony (ADR-0014) — which is **L3**, not L0–L1. The paper covering L0–L1 should be titled for the *kernel*, e.g. *The Single-Writer Kernel* or *The Harbor Daemon*. **The Anchor Protocol proper belongs in Paper 4.** This is a title/content mismatch the volume plan must fix.
- **Open problems landing here:** OP-1 fair exclusion, OP-2 regimentation-vs-enforcement boundary (per C1), OP-3 cross-runtime soundness (differential testing), OP-4 checkpoint-with-teeth (the through-line foundation — co-owned with Paper 3, see below), OP-6 tamper-evidence-on-read-path, OP-7 schema evolution, OP-8 pheromone decay calibration, OP-9 same-machine adversary. Plus the new P1#5 (durability by fault class) and the consistency-model theorem (serializable/linearizable — the formal payoff the L0 dossier left implicit).
- **Wants a different home:** the L0 dossier's **Merkle tamper-evidence (I9)** defends against nobody under L0's own stated threat model (same-user-out-of-scope). Per both L0 critiques, **re-scope I9 as L3 provisioning** (it matters only against cross-machine sync or a non-same-user tamperer) — move its load-bearing treatment to Paper 4, leave a one-line "provisioned here, activated at L3" pointer in Paper 2.

### Paper 3 — *From Spawn to Person* (the L3 identity/continuity bridge) — CONFIRMED, and it should absorb OP-4
- **Owns:** the through-line made concrete — durable identity (ADR-0040 identity-local), the three continuity organs, the **outcome ledger** (the third organ reputation keys on), the role-vs-person distinction.
- **Co-owns with Paper 2:** OP-4 / checkpoint-with-teeth. Paper 2 owns the *kernel mechanism* (the content-addressed snapshot); Paper 3 owns the *why it is the foundation of personhood-and-reputation* argument. State C7's canonical sentence in both.
- **Open problems landing here:** what is recoverable vs. fundamentally lost when an LLM agent dies mid-thought (OP-4's hard half); the principal-above-the-actor binding (P2#9 — it is the identity object, so it is Paper 3, not Paper 4); reputation estimator selection (Elo/BT/TrueSkill) as a *design* (the scoring is L3 but the *substrate* is here).
- **Wants a different home / flag:** Paper 3 must carry the **C2 split explicitly** — it depends on ADR-0040 (identity-local), and it must hand Paper 4 the unsolved ADR-0040b (cross-operator attestation) as a named dependency, not assume it.

### Paper 4 — *The Harbor Economy* (the L3 market) — CONFIRMED, with the largest reconciliation debt
- **Owns:** the bond ledger + conservation, the float-plan/escrow ceremony, the **Anchor Protocol proper** (moved here from Paper 2's title-scope), the three-sided market, federation (witness log, bounded escrow, revocation gossip), hosted-trust positioning.
- **Open problems landing here:** PoA-when-reputation-is-for-sale (re-framed per mechanism-design critique from a PoA bound to a *signal-existence question* under tradeable reputation — wrong tool today), trustless cross-harbor settlement (conjectured impossible; engage Herlihy-Liskov-Shrira cross-chain-deals, which it is reinventing), competitive underwriting (Youle — resolve composition; reframe Cleanup-Lower-Bound as insurer reserve-adequacy per the mechanism-design critique), the unified sheaf-gluing problem (C6), cross-harbor unit-of-account, arbitration-as-a-market, wash-trade defense.
- **Carries the four heaviest reconciliations:** C2 (ADR-0040b — the BLOCKING keystone-overreach), C6 (lax-functor demotion), C10 (reputation tombstone vs. never-ends), the grading-oracle IC (P0#4), and Myerson-Satterthwaite honesty (strict conservation = budget balance ⇒ must sacrifice efficiency or IR; name which corner — the mechanism-design critique's gap 5).
- **Wants a different home:** the **principal-as-economic-entity** is *introduced* here as a market counterparty but its *identity binding* is defined in Paper 3 (P2#9). Cross-reference, don't duplicate.

**Structural note on the carve-up:** the volume currently maps roughly L2→P1, L0/L1→P2, L3-bridge→P3, L3-market→P4. The one genuine seam problem is that **L1 is split across Paper 1 (discovery substrate, completionist-done, escalation) and Paper 2 (tube/pheromone/commitment/Arbiter substrate)**. That is acceptable *if* each paper states which half of L1 it owns. Do not let L1 fall into the crack between Papers 1 and 2 — it is the layer most at risk of being under-covered because no paper is titled for it.

---

## 4. Nomenclature Key Delta — additions and corrections to the §3 key

The volume's §3 key currently fixes `BUILT · BUILT-WEAK · DESIGNED · VISION`. Keep those. The following are *additions and corrections* the four dossiers' drift forces.

**Corrections (label drift to fix):**
- **`[PROPOSED]` → `DESIGNED`.** The L2 dossier flags a stray `[PROPOSED]` from the discovery seed. One label set only; no synonyms.
- **"physically unreachable" is a *reserved phrase*** — usable only for PK-constraint/boot-gate-regimented states (C1). Replace with "detected within a bounded window, then halted/compensated" for every Arbiter-subscription rule. This is a term-of-art correction, not just prose.
- **"BUILT" for durability (I1) is incorrect as a single label** — split into **I1a BUILT (process-crash)** and **I1b NOT GUARANTEED (power-loss under NORMAL)**. A claim that conflates fault classes cannot carry one honesty label. (P1#5.)
- **"reputation never ends" is not an anti-revocation property** — correct to "monotone in *honest* witnessed outcomes; individually revocable via tombstone." (C10.)

**Additions to the key:**
- **`auth-chain` vs. `delegation-trace`** — the two delegation objects (C4). Never write bare "delegation chain" again; it is ambiguous across the volume.
- **ADR-0040 (identity-local) vs. ADR-0040b (cross-operator attestation)** — the keystone split (C2). Every "ADR-0040 is the keystone" sentence must specify which. **0040 is the keystone for Papers 1–3; 0040b is the unbuilt keystone for Paper 4.** This is the single most consequential nomenclature addition in the volume.
- **`capability` (ability) vs. `permission` (normative status)** — never collapsed (C9). The jail grants/bounds capability; the deontic layer grants permission; "able but forbidden" must stay expressible.
- **"three-sided market" carries a mandatory honesty rider** — *"three-sided by design; two-sided until reputation ships."* This is already the L3 canonical sentence; promote it into the key so it is never dropped. And per the category-theory critique, the three sides are **isomorphic at the conservation object, non-isomorphic at the identity object** — labeling the market "one structure, three decorations" without that qualifier is the decorative-analogy failure.
- **"conservation composes upward" carries a mandatory scope rider** — *"conservation-preserving functor in single-unit-of-account federation (proven); lax, φ-bounded, coherence-unproven in multi-currency"* (C6).
- **ADR-0040 keystone, restated for the key:** it is the keystone *because* "the score is cheap; the substrate it scores over — witnessed outcomes on a non-forgeable id — is the gate." Keep this exact sentence as the canonical gloss in all four papers; it is the cleanest cross-layer through-line statement in the corpus.

---

**Bottom line.** The four dossiers are individually strong and unusually honest, and the L0→L3 stack with the memory→continuity→person→reputation→market through-line holds. The volume is *not yet* one consistent book because of five load-bearing collisions: the Arbiter overclaim (C1), the keystone-threat-model overreach (C2, BLOCKING for Paper 4), the centralized-vs-distributed framing (C3), the conservation-functor overclaim (C6), and the through-line's softest link being named three different ways (C7). Fix those five, adopt the two-name delegation split (C4) and the capability/permission split (C9), and the four papers become four chapters of one coherent argument rather than four overlapping drafts."