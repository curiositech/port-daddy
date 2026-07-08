# Runtime vs. Offline Verification: What the µs Budget Permits

The adjudicator's latency budget is brutally fixed: every action intercept must resolve before the agent's next token generation begins, typically 10–50ms on a loaded inference host. This hard ceiling determines which verification techniques are architecturally viable at runtime and which must be pre-computed offline.

## What Is Tractable at Runtime

**Propositional satisfiability (conjunctive guards):** Conjunctions and disjunctions over ground atoms — `action.type == "file_write" AND target.path.startswith("/secrets/")` — evaluate in nanoseconds. These are hash-table lookups and bitwise comparisons. The entire Cedar policy language (AWS) is designed around this: every Cedar policy evaluates in worst-case O(|policy| × |entities|) time, producing results in under 1µs on warm cache. Bound: O(1) to O(k) where k is the number of applicable policy rules; k is typically single-digits at runtime since the rule trie is pre-indexed by action type.

**Datalog over a bounded substrate:** Datalog with stratified negation (the Soufflé dialect) is decidable in PTIME in the size of the extensional database (EDB). The key word is *bounded*: the EDB is the provenance DAG snapshot at decision time, typically hundreds of tuples for a recent window. Soufflé compiles Datalog to native C++ with parallel SIMD joins; FORGE benchmarks show sub-millisecond median authorization latency on this substrate. The critical constraint: the EDB must not grow unboundedly. Enforce a sliding window (e.g., `lookback: 200 actions`); older facts are archived, not queried.

**LTL over finite traces:** Linear Temporal Logic formulas restricted to a finite horizon are just propositional queries over a time-indexed tuple store. `G(p → X q)` ("whenever p holds, q holds in the next step") evaluated over the last N steps reduces to a scan of the provenance window. Runtime monitors like DejaVu and MarQ implement exactly this; they compile LTL(finite) to finite automata and evaluate new events in O(1) amortized. The finite-trace restriction is mandatory: LTL over infinite paths requires model checking, which is PSPACE-complete and strictly offline.

**Lean 4 decidable arithmetic via pre-compiled proofs:** The Lean-Agent Protocol architecture (arxiv:2604.01483) separates proof generation from proof checking. Generating a proof that `amount < 10000` is satisfied for a specific amount requires no tactic search at runtime — the Lean kernel's `decide` evaluates the closed arithmetic term directly. AWS Cedar benchmarks report ~5µs for kernel evaluation on warm cache. The ~5µs number is for the kernel check alone; add substrate marshaling (~3–10µs) and the total is still well under 100µs. This is viable. What is not viable: any proof obligation that cannot be expressed as a decidable arithmetic sentence (no unbounded quantifiers, no inductive types, no recursion over open domains).

## What Requires Offline Proof

**Full first-order logic (FOL):** FOL is undecidable (Church-Turing). Any policy expressed with unrestricted quantifiers over potentially infinite domains — "for all agents that have ever existed, if they accessed file F then..." — cannot be evaluated at runtime. The offline alternative: reduce to a decidable fragment (EPR, Bernays-Schönfinkel, or the two-variable fragment FO²) or hand it to a model-bounded SMT solver (Z3) offline and snapshot the result.

**Inductive invariants:** Proving that a property holds over all reachable states of a system requires fixed-point computation. The standard tools — IC3/PDR for transition systems, Houdini for concurrent programs — iterate until convergence, which may require thousands of rounds. This is an offline artifact: run IC3 once over the system model, extract the invariant certificate, and ship it as a compiled claim the runtime can sample against (but not re-derive). If the system model changes (new tool added to the agent's action space), re-run IC3 offline before deploying.

**LTL over infinite traces / liveness properties:** A liveness property like "the agent will eventually respond to every request" requires reasoning about infinite execution paths. This is the model-checking problem proper: PSPACE-complete in the size of the state space. The offline path is SPIN, NuSMV, or a probabilistic model checker (PRISM) over an abstracted system model. The runtime path is a reachability approximation: not the same guarantee. Engineers should be explicit about which they have.

**Reachability in pushdown systems / recursive agent architectures:** Multi-agent systems with recursive delegation (agent A delegates to B which may delegate back to a sub-instance of A) form pushdown systems. Reachability in pushdown systems is EXPTIME-complete. Offline analysis via WPDS or Weighted Pushdown Systems is tractable for bounded recursion depth; runtime evaluation is not viable for arbitrary delegation depths.

## The µs Budget in Practice

A realistic breakdown for a single adjudication under FORGE's architecture:

| Step | Latency |
|---|---|
| Deserialize action object | ~2µs |
| EDB window snapshot (last 200 tuples) | ~5–15µs |
| Soufflé native binary query | ~200–800µs |
| Lean kernel arithmetic check (if triggered) | ~5µs |
| Verdict serialization + return | ~2µs |
| **Total** | **~214–824µs** |

The 12–38% end-to-end overhead reported in FORGE on τ²-Bench is not µs overhead per call — it is the aggregate wall-clock cost of many hundreds of adjudications per multi-step task. Per-decision, the overhead is sub-millisecond. At thousand-decisions-per-second throughput (FORGE's reported number), the engine saturates a single core at ~80% on a modern server CPU; parallelize across cores for multi-agent workloads.

The architectural lesson: the µs constraint prohibits any verification that requires iterative search or proof construction. It permits any verification over pre-compiled, fixed-size structures — lookup tables, compiled Datalog binaries, pre-checked proofs, automaton state transitions. The compilation step is where formal power lives; the runtime step is indexing into its results.

## Key Points

- **Propositional, Datalog(stratified), and LTL(finite-trace) are the three tractable runtime verification classes.** Everything else is offline artifact production.
- **Lean 4 proof checking at runtime is viable (~5µs) only because proofs are pre-compiled offline.** Never invoke tactic search at runtime; it takes seconds to minutes.
- **Inductive invariants and liveness properties are strictly offline.** If your policy requires them, the runtime check must be against a snapshot or certificate computed offline, not a fresh derivation.
- **Bound the EDB or pay the cost.** Datalog evaluation is polynomial in EDB size. An unbounded provenance DAG will degrade sub-millisecond performance to seconds. Enforce a sliding window.
- **The 12–38% end-to-end overhead (FORGE) is aggregate, not per-call.** Individual adjudications are sub-millisecond; the overhead reflects hundreds of calls per multi-step task.

## See Also

- `SKILL.md §Implementation Pattern` — the canonical latency table and FORGE/Cedar benchmark numbers with sources
- `references/datalog-policy-compilation.md` — Soufflé compilation pipeline, contradiction detection, and EDB window management
- `references/lean4-arithmetic-proofs.md` — the proof-generation-offline / proof-checking-at-runtime architecture in detail (Lean-Agent Protocol, arxiv:2604.01483)
