# Computational Tooling for Red Teaming

Tools the red team should reach for. For each: when it fits this system, what input it
expects, what output to consume.

---

## 1. Symbolic Protocol Analysis

### ProVerif
When: capability-token issuance, delegation, revocation as a Dolev-Yao symbolic protocol.
Best for secrecy and authentication queries (Lowe 1997 hierarchy).
Input: applied-pi-calculus (`.pv`) describing principals, free names, equations on
signatures. Model Ed25519 as an abstract `sign/verify` pair.
Output: `RESULT inj-event(...) is true/false`. Counterexample traces show how an
attacker derives a forbidden term. Consume traces as concrete attack scripts.

### Tamarin
When: stateful protocols where revocation cache, nonce window, and counter monotonicity
matter — i.e. *most* of the Anchor/Bonded protocols. Multi-set rewriting handles state
better than ProVerif.
Input: `.spthy` rules (linear facts for state, persistent for keys), lemmas in guarded
fragment of FOL.
Output: proof or attack trace; trace exporter renders as message-sequence diagram.

### CryptoVerif
When: you need *computational* (not just symbolic) guarantees — game-hopping proofs over
concrete crypto assumptions (EUF-CMA on Ed25519, IND-CCA on KEM).
Input: `.cv` describing oracles and the security game.
Output: probability bounds reducing to underlying assumption. Use sparingly — high
investment, only worthwhile for the core token-signing primitive.

---

## 2. Model Checking

### TLA+ / TLC
When: liveness and safety of the gossip layer, sortie auction state machine, bond
escrow lifecycle. Especially good for "no two daemons disagree on revocation status
after eventual consistency window."
Input: `.tla` specification + `.cfg` with constants and invariants.
Output: error trace as state-by-state transition log. Feed states back into property-
based tests.

### Apalache
When: TLA+ specs that explode in TLC. Symbolic (SMT-backed) checking, supports type
annotations, faster on parameterized models.
Input: same `.tla` plus type annotations.
Output: counterexample states. Better for "find any violation up to depth N" than for
proofs at infinity.

### Spin
When: low-level message-passing protocols (e.g. the pheromone retraction race). Promela
is closer to imperative pseudo-code; LTL claims for liveness.
Input: `.pml` processes + LTL formula.
Output: `.trail` execution; replay with `spin -t` for stepwise trace.

---

## 3. Bounded Checking and Fuzzing

### Kani (Rust)
When: any Rust code path in the daemon that handles untrusted input — token parsers,
cuckoo-filter ops, signature verification glue. Bounded model checker built on CBMC.
Input: Rust functions annotated with `#[kani::proof]` and `kani::any()` symbolic inputs.
Output: pass/fail with concrete counterexample bytes. Save as fuzz seeds.

### AFL++
When: parser hardening — capability-token decoders, CBOR/JSON envelopes, gossip-message
deserializers. Coverage-guided greybox fuzzing.
Input: harness binary + a corpus directory.
Output: `crashes/` and `hangs/` with input bytes. Triage by stack-hash.

### libFuzzer
When: in-process fuzzing tightly bound to a target function, especially with sanitizers
(ASan, UBSan, MSan).
Input: `LLVMFuzzerTestOneInput(const uint8_t*, size_t)` harness.
Output: crash files; use with `-fsanitize=fuzzer,address` for fast feedback.

### KLEE
When: symbolic execution of small, self-contained C/C++ code (revocation lookup,
fingerprint compare). Generates inputs that exercise every feasible branch.
Input: LLVM bitcode + `klee_make_symbolic` annotations.
Output: `.ktest` files per path; replay against the concrete binary.

---

## 4. Property-Based and Metamorphic Testing

### Hypothesis (Python)
When: the daemon has a Python control plane or test harness. Strategies for
capability tokens, delegation chains, message timings.
Input: `@given(strategy)` decorators producing structured inputs; stateful machines via
`RuleBasedStateMachine`.
Output: shrunk failing example. Persist via `.hypothesis/` database.

### fast-check (TypeScript)
When: TS surfaces — Port Daddy CLI, Fastify routes, MCP server. Property tests over
JSON shapes, claim/release sequences.
Input: `fc.assert(fc.property(...))` with arbitraries.
Output: minimal failing input, replay via seed.

### proptest (Rust)
When: Rust components (likely the cryptographic core if Rust). Strategies compose like
Hypothesis; works well alongside Kani for the same code.
Input: `proptest!` macro with strategies.
Output: failing case stored as regression in `proptest-regressions/`.

Metamorphic angle: define relations like `verify(token) == verify(reencode(token))`,
`revoke(t); verify(t) == false` invariant under reordering of unrelated ops.

---

## 5. SAT / SMT

### Z3
When: constraint problems — "is there a sequence of N delegations that violates
attenuation?", cuckoo-filter collision finding, scope-conflict reasoning.
Input: SMT-LIB or Python `z3-solver` API, encode bitvectors for fingerprints.
Output: `sat` model (witness) or `unsat`. For protocol-level use, often invoked under
the hood by Tamarin/Apalache.

### CVC5
When: alternative SMT backend; sometimes faster on string/datatype-heavy problems
(JSON token shapes).
Input: SMT-LIB v2.
Output: same as Z3. Cross-check disagreements between solvers as a smell test.

---

## 6. Network Adversary Simulation

### Jepsen
When: testing the federated consistency model under partition, clock skew, pause. Lein-
based; nemeses include partition, kill, slow.
Input: a Clojure test invoking the daemon's client API plus a generator of operations.
Output: Knossos / Elle linearizability/serializability checker reports. Read the bad
traces — they are gold.

### tc / netem
When: low-effort latency, loss, reorder, duplication on a Linux interface.
Input: `tc qdisc add dev eth0 root netem delay 200ms 50ms loss 1% reorder 25%`.
Output: behavioral changes in the system under test; pair with metrics.

### comcast
When: cross-platform, simpler than tc for one-off scenarios. Wraps pf/ipfw/tc.
Input: CLI flags `--latency=200 --packet-loss=5%`.
Output: shaping rules applied; tear down with `comcast --stop`.

---

## 7. Economic Mechanism Testing

### Mesa (Python agent-based)
When: simulating Sybil dynamics, reputation decay, cartel formation. Schedule-driven
agents on a grid or graph.
Input: Agent and Model classes, scheduler, reporter.
Output: per-step DataFrame; visualize with built-in server. Sweep parameter space to
identify regime changes.

### NetLogo
When: rapid iteration on social-coordination ideas, communicating models to non-coders.
Less suited to integration with the actual daemon.
Input: `.nlogo` model with turtles + patches.
Output: BehaviorSpace CSV runs.

### Auction / Market Sim Libraries
- AuctionFox / openauctioneer / mesa-economy: implement Vickrey, English, sealed-bid.
- BSE (Bristol Stock Exchange): order-book simulator for continuous double auction.
- Use these to stress-test the bond-pricing auction and detect cartel-favorable equilibria.

Input: agent strategy implementations (truthful, shading, collusion).
Output: efficiency metrics (allocative efficiency, revenue, bid shading distribution).

---

## Glue Patterns

- Pipe ProVerif/Tamarin counterexamples directly into Hypothesis seeds — symbolic attack
  becomes executable test.
- Pipe Kani counterexamples into AFL++ corpus — bounded counterexamples seed greybox fuzz.
- Pipe TLC error states into Jepsen generators — model-level disagreements become
  reproducible cluster tests.
- For mechanism-design findings, instrument the simulator output with the same
  reputation-tracking schema used in production, so a finding ports straight to a regression.
