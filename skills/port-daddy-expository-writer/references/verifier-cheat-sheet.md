# Verifier Cheat Sheet

One paragraph per tool. *You reach for this when…* framing. This is the prose the expository writer mines for accurate one-liners about each verifier; longer treatments live in the worked draft itself.

For deeper reference (input/output shapes, known-good idioms, integration patterns), see `port-daddy/skills/redteam-review/references/computational-tooling.md`. That file is the operator's critical reference for which verifier fits which problem.

---

## Symbolic protocol analyzers

### ProVerif

**You reach for this when…** you have a protocol with cryptographic primitives — signatures, encryptions, hashes, MACs — and you want a symbolic guarantee that a Dolev-Yao adversary cannot derive a forbidden value (a secret, a session key, the wrong identity). Best for secrecy and authentication properties expressed as injective-event correspondences.

**One-liner for prose.** ProVerif is a bouncer that reads your protocol, imagines a perfectly malicious party guest, and tells you whether the door holds.

**Syntax dialect.** Applied pi-calculus, `.pv` files. Principals are processes; cryptographic operations are abstract functions with equational theories. Adversary is implicit and unbounded.

**Strengths.** Mature (2001-present). Fast on stateless protocols. Excellent for the *issuance / verification / revocation* dance of capability tokens.

**Weaknesses.** Counters, timestamps, mutable state in general make ProVerif unhappy — the abstraction *folds* state into terms and loses precision. For stateful protocols you want Tamarin.

**Used in Port Daddy.** Anchor Protocol companion paper, all three phases (issue, present, revoke). Magic-link single-use. Algorithm-confusion immunity. Delegation-chain replay at depth 3.

---

### Tamarin

**You reach for this when…** the protocol has state that matters between sessions — a revocation cache, a nonce window, a monotonic counter, a session table. Multi-set rewriting handles state better than ProVerif's process algebra.

**One-liner for prose.** Tamarin is ProVerif with a memory. It can model the fact that something happened *before* something else, and have that prior fact constrain what the adversary can do later.

**Syntax dialect.** `.spthy` files. Rules consume linear facts (per-session state) and produce new facts; persistent facts (`!`) hold across rules. Lemmas in the guarded fragment of first-order logic.

**Strengths.** Stateful protocols. Equational theories for Diffie-Hellman and bilinear pairings. Strong tooling for exporting attack traces as sequence diagrams.

**Weaknesses.** Steeper learning curve than ProVerif. Slower on protocols where ProVerif would suffice; pick the simpler tool first.

**Used in Port Daddy.** Not yet in the deployed proofs; cited as the right next step for stateful protocol claims (e.g., bond-escrow lifecycle, revocation gossip).

---

## Model checkers

### TLA+ / TLC

**You reach for this when…** you have a distributed system with concurrent state, eventual consistency, escrow lifecycles, or any property that needs *every reachable state* of every interleaving to be inspected. Liveness as well as safety.

**One-liner for prose.** TLA+ is the daydream. Write what the system *means*; TLC walks every possible interleaving of the daydream looking for the thing you said couldn't happen.

**Syntax dialect.** `.tla` specifications plus `.cfg` (constants, invariants, properties). TLC is the explicit-state checker; Apalache is the symbolic backend.

**Strengths.** Mature. Has shipped real bugs at Amazon, MongoDB, Cosmos. Excellent for safety + liveness on small parameterized models.

**Weaknesses.** Explicit-state TLC is exponential in state space. For parameterized models past a few processes, switch to Apalache.

**Used in Port Daddy.** Six derived invariants — `NoteMonotonicity`, `EscrowInvariant`, `LockOwnerValid` among them — compiled into runtime checks via the Arbiter.

---

### Apalache

**You reach for this when…** the TLA+ spec you wrote in TLC explodes. Apalache is symbolic (SMT-backed), supports type annotations, and is faster on parameterized models — find any violation up to depth N rather than search to infinity.

**One-liner for prose.** Apalache is TLA+ with Spinoza behind the wheel — same axioms, faster at finding the contradiction.

**Syntax dialect.** Same `.tla` as TLC, with type annotations on variables and constants.

**Strengths.** Bounded model checking up to a depth; symbolic counterexamples. Type system catches whole categories of model errors before invocation.

**Weaknesses.** Bounded, not unbounded. A passing Apalache run says *no violation within depth N*, not *no violation ever*. Pair with TLC for small-state exhaustive runs and Apalache for parameterized depth.

---

### Spin / Promela

**You reach for this when…** you have a low-level message-passing protocol that is closer to imperative pseudo-code than to TLA+'s state-and-step style. LTL claims for liveness.

**One-liner for prose.** Spin is the C-program-shaped cousin of TLA+ — same lineage, but the model checker is built around message channels and goto statements.

**Used in Port Daddy.** Not in current proofs. Useful for the pheromone-retraction race in `§sec:pheromones` if it ever moves into formal verification.

---

## Bounded model checkers and fuzzers

### Kani (Rust)

**You reach for this when…** you have a Rust function on a security-critical path — a token parser, a capability subset check, a signature verifier — and you want bounded proof of "no panic, no UB, on any input."

**One-liner for prose.** Kani is the gnat inside your Rust. Picks one function, treats every input as symbolic, lets a SAT solver hunt for the byte that crashes you.

**Syntax dialect.** Standard Rust plus `#[kani::proof]` attributes and `kani::any()` for symbolic inputs. Backed by CBMC.

**Strengths.** Counterexamples are *bytes*, which means you can drop them into AFL++ or proptest as regression seeds. Closed-loop between formal and concrete testing.

**Weaknesses.** Bounded by loop-unroll depth. Verifies behavior of one function at a time; not a whole-program checker.

**Used in Port Daddy.** The Kani-verified Rust core (`harbor-card-rs`) — capability subset check and constant-time signature comparison — compiled to a shared library and called from the Node.js daemon via FFI. *The verified code and the deployed code are the same binary.*

---

### AFL++, libFuzzer, KLEE

These are the concrete and symbolic fuzzers that complement Kani. AFL++ is coverage-guided greybox; libFuzzer is in-process with sanitizers; KLEE is symbolic execution of small C/C++.

In expository prose, mention them when explaining the *closed loop* between formal counterexamples and concrete regression tests — Kani finds a byte sequence that violates an invariant, the bytes go into the AFL corpus, the next round of fuzzing replays them. The composition is the story.

---

## SMT solvers

### Z3

**You reach for this when…** you have a constraint problem — "is there a sequence of N delegations that violates capability attenuation?", "is there a cuckoo-filter input that collides for two distinct tokens?", "is there a bid pattern consistent with grim-trigger cartel sustainability?" Z3 returns *sat* with a witness or *unsat*.

**One-liner for prose.** Z3 is the universal solver — every formal-methods tool eventually calls it under the hood. When the problem you care about can be encoded as a quantifier-free first-order formula over a decidable theory (bitvectors, arrays, real arithmetic), Z3 either finds an example or proves none exists.

**Syntax dialect.** SMT-LIB v2, or Python via `z3-solver`. For complex problems, the Python API is friendlier.

**Strengths.** Mature, fast, ubiquitous. Bitvector reasoning is excellent.

**Weaknesses.** Quantifiers and nonlinear real arithmetic are where Z3 starts to time out. If you find yourself nesting quantifiers, reach for a higher-level tool that knows how to discharge them (Tamarin, Coq, Lean).

**Used in Port Daddy.** Indirectly — Tamarin and Apalache both call Z3 under the hood. The redteam toolkit cites it directly for cuckoo-filter collision finding and scope-conflict reasoning.

---

### CVC5

**You reach for this when…** Z3 returns the *wrong* result, or times out where you suspect it shouldn't. CVC5 is an alternative SMT backend that is sometimes faster on string/datatype-heavy problems. Disagreements between Z3 and CVC5 on the same SMT-LIB v2 input are a strong smell test.

---

## Property-based and metamorphic testing

These are not verifiers — they are randomized testers — but they live next to the verifiers in the workflow. They are how a verifier counterexample becomes a regression test, and how a verifier's *bounded* result gets *unbounded* empirical support.

### Hypothesis (Python), fast-check (TypeScript), proptest (Rust)

**You reach for these when…** you want property-based tests over generated inputs, especially with shrinking. Hypothesis's `RuleBasedStateMachine` is excellent for stateful properties; fast-check's arbitraries compose well with JSON shapes; proptest pairs naturally with Kani.

**One-liner for prose.** Property-based testing is what you do *after* the formal proof closes — you let a fuzzer pick a million inputs and watch the property hold under each one. The proof said it's true; the fuzzer reminds you of that fact at 2 a.m. when you forgot.

---

## Network adversaries

### Jepsen

**You reach for this when…** you have a distributed system that claims a consistency model (linearizability, serializability, snapshot isolation) and you want to *exercise* the claim under partition, clock skew, pause. Knossos and Elle are the checkers; the nemeses are partition, kill, slow.

**One-liner for prose.** Jepsen is the cluster equivalent of Kani — symbolic stress instead of symbolic inputs. It does not prove anything; it falsifies confidently.

---

## When to use which: a one-line lookup

| You want to prove… | Reach for |
|---|---|
| "The adversary can't forge a token" | ProVerif |
| "The adversary can't replay a token across sessions" | Tamarin (or ProVerif at bounded depth) |
| "The revocation gossip converges" | TLA+ / Apalache |
| "The escrow invariant holds across every interleaving" | TLA+ |
| "This Rust function never panics" | Kani |
| "These two functions never collide on any input" | Z3 (encode as SMT) |
| "The auction equilibrium survives 36 parameter configurations" | Mesa / Monte Carlo simulation (not a verifier — and the paper is honest about that being empirical) |
| "The protocol holds under partition" | Jepsen + Knossos/Elle |

When the expository piece walks the reader through *which* verifier the paper chose, the answer almost always comes back to one of the rows above. The fit between problem and tool is most of the pedagogy.
