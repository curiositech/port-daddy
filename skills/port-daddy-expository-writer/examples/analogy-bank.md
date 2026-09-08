# Analogy Bank

Twelve ready-to-use analogies for Port Daddy expository writing. Each entry is one to three sentences, sized for drop-in use in a draft. For longer treatments and provenance, see `references/analogy-toolkit.md`.

These are the *workhorses*. Reach for them when a section needs a handhold and a fresh analogy hasn't surfaced. Better to use one of these than to default to corporate evenness.

---

**1. ProVerif as bouncer.**
ProVerif is the bouncer at the protocol door. It reads the script — your `.pv` file — imagines a perfectly malicious party guest who can read every message, replay any sequence, and compose new messages from old ones, and asks whether the door holds. If the proof closes, the door holds against every guest the model permits. *The model is the critical word.*

---

**2. TLA+ as daydream.**
TLA+ is the daydream of the system. You write what the system *means* — initial conditions, allowed steps, invariants you wish would always hold — and TLC walks every possible interleaving of the daydream, looking for the state where you said something couldn't happen but it does anyway.

---

**3. Apalache as Spinoza.**
Apalache is TLA+ with Spinoza behind the wheel: same axioms, faster at finding the contradiction. Symbolic where TLC is explicit; type-checked where TLC is permissive; bounded where TLC is unbounded. Reach for Apalache when TLC chokes on a parameterized model.

---

**4. Kani as the gnat inside Rust.**
Kani is the gnat that lives inside your Rust crate. It picks one function, treats every input as symbolic, and lets a SAT solver hunt for the byte that crashes you. When it finds one, it hands you the bytes — drop them into your fuzz corpus and the formal counterexample becomes a regression test.

---

**5. Z3 as the universal solver.**
Z3 is the universal solver. Every formal-methods tool eventually calls it. When the problem can be encoded as a quantifier-free first-order formula over a decidable theory — bitvectors, arrays, linear arithmetic — Z3 either finds you an example or proves none exists. Quantifiers and nonlinear real arithmetic are where it starts to time out; that's the line you don't want to cross without a plan.

---

**6. Capability tokens as nested envelopes.**
A capability token is a nested envelope. The outer envelope permits a set of actions; the inner envelope (a sub-delegation) permits a *subset* of those actions. You can only seal an envelope smaller than the one you received. The cryptographic signing chain enforces this structurally: there is no signature an attacker could forge that would let them seal a *larger* envelope from a smaller one.

---

**7. Pheromones as the mutable-signal ledger.**
The mutable-signal ledger works like ant pheromones. Each ant drops a signed signal; signals decay; updated signals replace stale ones along the same trail. The *signal* is mutable — agents can revoke, rename, re-attribute — but every *update* is immutable, hash-chained to its predecessor. The trail is alive; the audit log is not.

---

**8. Pareto frontier as negotiable utopia.**
The Pareto frontier is the negotiable boundary of utopia: the surface beyond which any further movement makes *somebody* worse off. A Pareto improvement is a rare gift — nobody loses, somebody wins, the frontier moves outward by a notch. Most policy changes don't clear that bar; the Youle claim is that this auction does.

---

**9. Sybil identities as multi-hat trolls.**
A Sybil attacker is one troll wearing K hats. They post K deposits, undercut every honest bid, and default on losses. The trick — the *unsettling* trick — is that the deposit slash is capped at the coverage amount. Past that cap, additional deposits never reach the commons. The attacker's profit is bounded by *coverage*, not by *deposit*; you cannot deter Sybils with money alone.

---

**10. Folk theorem as cartel's open door.**
The folk theorem says any individually rational outcome is sustainable in the limit of infinite repetition — patient enough future, severe enough punishment, collusion is a Nash equilibrium. The cartel's door is always open. The protocol designer's job is to make detection probable enough that the future *isn't* patient enough. The closed-form threshold for the Bonded Commons sits around $p_d \approx 0.10$ at $\delta = 0.95$: you need ten-percent per-round detection to keep the door closed.

---

**11. Monte Carlo as empirical witness.**
A Monte Carlo trial is a single witness. The simulation hands you 72,000 of them — 36 parameter configurations, 2,000 trials each — and the aggregate is what an experimentalist offers when the theorist hasn't finished yet. Each trial is an existence proof of *the claim held under these parameters, in this draw of randomness*. The headline is the aggregate; the honest read is the per-configuration breakdown.

---

**12. TLA+ counterexample as the bug, named and dated.**
A model-checker counterexample is the bug, named and dated. A unit-test failure says *the assertion failed on input X*. A TLA+ counterexample says *here is the shortest sequence of states, starting from `Init`, taking one step at a time, that reaches a state where your invariant fails — eleven steps, here they are.* The trace is the report.

---

## How to deploy

When drafting:

1. Identify the section that needs a handhold (a new primitive being introduced, a counterintuitive claim, a technical concept the reader hasn't seen before).
2. Pull the matching analogy from this bank.
3. *Adapt it.* These are starting material, not finished prose. Splice in the specific names from the section you're writing.
4. If the analogy isn't landing, reach for `references/analogy-toolkit.md` for the longer-form versions with variants.
5. If none of those fit, the section probably needs a *fresh* analogy — one you've drawn from somewhere outside this bank. The bank is the floor.

When auditing (in `expositor-voice-editor`):

- `scripts/count-analogies.sh` flags drafts that fall below the density threshold.
- If a section is below threshold and none of the bank's analogies fits, push it back to the drafter with a note: *engage Tell #4*.
