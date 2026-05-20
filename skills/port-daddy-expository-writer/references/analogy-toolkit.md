# Analogy Toolkit

A pre-vetted set of analogies for formal-methods exposition in Port Daddy expository pieces. Each entry lists: the analogy, what it illuminates, when *not* to use it, and (where applicable) provenance.

Use these as starting material. Reach for one when a section has earned its punchline but the reader still needs a handhold. Better to use a fresh analogy the operator hasn't used elsewhere; this list is the *floor*, not the ceiling.

Apply Tell #4: at least one wild analogy per teaching piece. The reader doesn't have to recognize the source — the analogy's *energy* is what carries.

---

## 1. ProVerif as bouncer reading the script

**Illuminates.** Dolev-Yao adversary model. The verifier knows the rules of the room (the protocol) and considers every party guest the rules permit; if the rules say a guest can read any message anyone leaves on the floor, the verifier considers a guest who reads every message. The proof closes when *no* such guest can derive the secret.

**Use when.** Introducing ProVerif for the first time.

**Don't use when.** Describing stateful protocols (the bouncer doesn't remember between guests — that's Tamarin). Don't strain the metaphor.

---

## 2. TLA+ as daydream of the system

**Illuminates.** Specification-as-meaning. You write what the system *means* — initial conditions, allowed steps, invariants. The checker walks every interleaving of the daydream looking for a state where the invariant fails.

**Use when.** Introducing TLA+ to a reader who has only seen imperative-style "tests."

**Variant.** "TLA+ is the system in a snow globe — every interleaving, shaken, inspected for the impossible." Use the snow globe when the daydream metaphor has been used recently.

---

## 3. Apalache as Spinoza

**Illuminates.** Symbolic versus explicit-state model checking. Same axioms (the TLA+ spec), faster at finding the contradiction. The Spinoza joke lands for readers who took a philosophy course; for readers who didn't, it just sounds like a name, which is also fine — the energy carries.

**Use when.** Distinguishing Apalache from TLC in a single paragraph.

---

## 4. Kani as the gnat inside Rust

**Illuminates.** Bounded model checking on a single function. Picks one function, treats every input as symbolic, hunts for the byte that crashes you. The gnat metaphor captures both the smallness and the leverage.

**Use when.** Introducing Kani.

**Variant.** "Kani is the parasite that lives inside your Rust crate — invisibly, but with leverage." Slightly more grim; use when the topic is security-critical.

---

## 5. The capability token as nested envelope

**Illuminates.** Capability attenuation. Each delegation hop *shrinks* the set of allowed actions the way a nested envelope shrinks: the outer envelope can permit `{read, write, delete}`, the inner envelope (a sub-delegation) can permit `{read}`, but it can never permit `{read, write, delete, mount}`. The cryptographic signing chain enforces structurally what the envelope enforces physically: you can only seal an envelope smaller than the one you received.

**Use when.** Explaining the Anchor Protocol's subset check. Particularly good because the reader can *picture* it.

**Provenance.** Standard in capability-systems literature; the Macaroons paper (Birgisson et al. 2014) uses caveats as the explicit analog.

---

## 6. Stigmergy / ant pheromones for the mutable-signal ledger

**Illuminates.** Coordination signals that can be revoked, renamed, and re-attributed without sacrificing the immutability the rest of the architecture depends on. Ants drop pheromones; pheromones decay; updated pheromones replace stale ones; the trail is mutable but every drop is signed by the ant that left it.

**Use when.** Explaining `§sec:pheromones` and the mutable-signal ledger.

**Don't use when.** The reader is going to confuse "mutable signal" with "mutable record" — clarify that the *signal* is mutable but every *update* is immutable.

**Provenance.** Grassé (1959) coined *stigmergy*; the agent-systems literature has used it for decades.

---

## 7. The Pareto frontier as the negotiable boundary of utopia

**Illuminates.** Pareto improvements are the rare changes where nobody loses. The frontier is the surface beyond which any further movement makes *somebody* worse off. The Youle claim is a strong one: market pricing not only improves welfare but *Pareto-dominates* the committee — every agent at least as well off, somebody strictly better. Most policy changes are not Pareto improvements.

**Use when.** Setting up §sec:youle:welfare. The "rare changes" framing matters because it sets the bar correctly for the reader.

---

## 8. Sybil identities as multiple-hat trolls under one bridge

**Illuminates.** Why deposit-based Sybil deterrence is coverage-bounded. One troll wearing K hats can keep posting deposits up to the coverage cap, but past the cap the additional deposits are *refunded* on no-loss transactions — they never reach the commons. The attacker's profit is bounded by `coverage`, not by `deposit`.

**Use when.** Walking through §sec:youle:a5.

**Variant.** The same idea framed as *fractional reserves at a casino*: the casino requires you to chip-in to the table, but once you've covered the maximum loss they don't take more chips from you on winning hands.

---

## 9. The folk theorem as the cartel's open door

**Illuminates.** Why detection probability has to clear a threshold to break a repeated-game cartel. The folk theorem says *any* individually rational outcome is sustainable in the limit of infinite repetition — which is to say, if the future is patient enough and the punishment severe enough, collusion is a Nash equilibrium. The protocol designer's job is to make detection probable enough that the future *isn't* patient enough.

**Use when.** Setting up §sec:youle:a6. Particularly useful because the political-game-theory-once reader has *heard* of the folk theorem and will appreciate seeing it deployed precisely.

**Provenance.** Fudenberg & Maskin (1986) is the canonical reference; the result is older.

---

## 10. Monte Carlo as the empirical witness

**Illuminates.** Why empirical confirmation matters when closed-form proof is not available. 72,000 trials over 36 parameter configurations is not the same as a theorem, and the paper says so — but it is also not nothing. Each trial is a *witness*: an existence proof that under these parameters, in this draw of randomness, the claim held. The aggregate is what an experimentalist offers when the theorist hasn't finished yet.

**Use when.** Walking the reader through §sec:youle:welfare. The reader who has seen game-theoretic results presented as Nash-equilibria-or-die will need this to feel comfortable with the empirical regime.

---

## 11. The Merkle forest as the village ledger

**Illuminates.** The Merkle forest holds agent reputation history. Every entry is hash-chained; tampering with one entry breaks the chain forward. The forest holds *many* trees — one per actor — so an attacker forging a single tree doesn't compromise the rest of the village.

**Use when.** Explaining §sec:merkle-forest's role in adverse-selection control for the Youle market.

**Don't use when.** The reader is going to confuse "Merkle forest" with a blockchain. Distinguish early: the forest does not need consensus on a single chain; it needs only that each tree's local chain is intact.

---

## 12. The TLA+ counterexample as the bug, named and dated

**Illuminates.** Why model-checker counterexamples are *worth more* than failed unit tests. A unit test failure says "the assertion failed on input X"; a TLA+ counterexample says "here is the *shortest* sequence of states that reaches a state where your invariant fails, starting from `Init`, taking one step at a time." The trace *is* the bug report.

**Use when.** Selling the TLA+ workflow to a reader who has only seen test-driven failure modes.

---

## 13. Cooperative multitasking → multi-agent coordination

**Illuminates.** Operator analogy from prior writing. Windows 3.1 cooperative multitasking ↔ agent fleets that have to yield voluntarily because nothing is going to preempt them. The historical frame gives the reader a feeling for why coordination primitives are *necessary*, not optional.

**Use when.** Introducing Port Daddy's role in agent coordination at a system level.

**Provenance.** Operator-canonical; appears in earlier Port Daddy writing.

---

## 14. The compiler as collaborator

**Illuminates.** Why a Kani-verified Rust core is more than a "code review with extra steps." The verifier is not pointing at lines and saying "this might be wrong"; it is closing or refusing to close a *proof*. The compiler is collaborating with the proof system to make sure the bytes that run are the bytes that were checked.

**Use when.** Explaining the Kani-verified core in `§sec:structural`.

---

## 15. Game theory as anthropology of incentive

**Illuminates.** What the political-theory-once reader actually remembers is the *attitude* — game theory teaches you to ask, of every system, *what is the rational move for each participant?* Mechanism design inverts the question: *given the moves we want, what rules make them rational?* The expository piece on §sec:youle is doing exactly this inversion, and naming it early is a useful frame.

**Use when.** Opening an essay on mechanism design.

---

## Where to grow this file

Add a new analogy here when:

- You used it in a piece and the operator confirmed it landed.
- It illuminates a primitive that none of the existing entries cover.
- It is cross-domain enough to count as "wild" — formal-methods analogies *inside* formal methods don't qualify.

Avoid:

- Analogies the operator has explicitly criticized in prior reviews.
- Analogies that flatter without illuminating (every formal verifier as "an unblinking eye" — overused, decorative).
- Analogies that require the reader to know niche pop culture without payoff.
