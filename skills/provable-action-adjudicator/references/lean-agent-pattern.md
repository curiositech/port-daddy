# Lean-Agent Architecture: Runtime Proof Checking for Agent Actions

In the Lean-Agent pattern, every agent action is gated by a Lean 4 proof obligation. The agent's *policy* — the function mapping observations to actions — emits not just an action but a *proof term* asserting that the action satisfies a specification. The Lean kernel type-checks that term at µs latency before the action executes. The kernel is the only trusted component; everything else — the policy, the proof generator, the spec — is untrusted and can be wrong.

## The Three-Layer Stack

**Policy layer** (`Policy : Obs → (Action × ProofObligation)`): The policy runs first, producing a candidate action and a statement of what must be true for that action to be safe. The statement is a `Prop` in Lean 4 — e.g., `∀ s : State, invariant s → invariant (apply action s)`. The policy does not prove the statement; it merely declares it.

**Proof-generation layer**: A separate process — often a second LLM call, a tactic engine, or a precompiled proof library — constructs a term `t : P` that witnesses the obligation. For runtime use this must complete in bounded time. Practical budgets: ~5ms for tactic replay of a known proof, ~50ms for lightweight Omega/decide calls, >100ms is offline territory.

**Kernel layer** (`Lean.Environment.check`): The Lean 4 type-checking kernel is ~10k LOC and formally verified against its own spec. Checking a well-formed term runs in 10–500µs depending on term complexity. The kernel either accepts (`⊢ t : P`) or rejects; no other outcome. On rejection the adjudicator falls back to a conservative action (stop, no-op, escalate).

## What Can Be Proved at Runtime

Runtime proof is feasible when the proof term can be computed deterministically and quickly:

- **Bounded arithmetic**: `Omega` tactic closes linear integer/natural goals in <1ms. Budget constraints, index bounds, step-count limits.
- **Decidable propositions**: `decide` evaluates `Decidable P` instances at compile time (if the domain is finite and small). Useful for enum-valued state machines.
- **Proof replay**: If a proof was found offline and serialized, the kernel replays it in µs — only type-checking, no search. This is the primary runtime path for known action classes.
- **Simple structural invariants**: `List.length`, `Finset.card`, tree balance properties expressible as `simp` lemmas close in <5ms.

## What Requires Offline Verification

Anything involving real search or undecidable domains cannot be proved online:

- **Policy-level safety for general neural nets**: `∀ x, f(x) ∈ SafeSet` requires formal NN verification (alpha-beta, Marabou, dReal). Offline, attach proof certificate to each deployed policy version.
- **Reachability in arbitrary graphs**: Undecidable in general; requires bounded-depth BFS with an explicit proof of the bound, computed offline.
- **LLM output properties**: "This text response is non-deceptive" cannot be formalized as a Lean `Prop` that a term can witness at runtime. Model-level properties must be proved at training time (e.g., RLHF specification via reward model — not Lean).
- **Liveness / termination**: Lean requires a structural termination argument. For agents with dynamic execution graphs, prove termination offline per action class; runtime checks only safety (not liveness).

## Integration Pattern (Pseudocode)

```lean
-- Spec: the adjudicator's interface
structure GatedAction where
  action : Action
  spec   : Prop
  proof  : spec  -- term witnessing the spec

-- Runtime: check happens in Environment.check, not here
def adjudicate (ga : GatedAction) : IO Action :=
  -- kernel already accepted ga.proof during elaboration
  -- if we reach here, the proof type-checked
  return ga.action
```

In practice, proof terms are serialized as `.olean` blobs and deserialized at agent startup. Per-step, the agent selects the appropriate pre-verified action class, instantiates the term with runtime constants, and the kernel re-checks the instantiation — this instantiation check is the µs-latency step.

## Key Points
- The Lean kernel is the only TCB component; policy and proof generator are untrusted and can be replaced or adversarially compromised without undermining soundness.
- Runtime proofs must be *term replay*, not *proof search* — search budgets (>50ms) belong offline; the online step is type-checking only.
- `decide` and `Omega` are the two workhorse tactics for runtime-decidable goals; anything requiring `simp` lemma search beyond a small fixed set is offline territory.
- Every deployed policy version should carry a cryptographically bound proof certificate; the adjudicator verifies the certificate matches the policy hash before accepting its proof library.
- Failure mode is safe: kernel rejection triggers a conservative fallback, never an unverified action. Design the fallback as a formally verified no-op.

## See Also
- `offline-verification-pipeline.md` — how to produce `.olean` proof bundles for each action class before deployment
- `policy-spec-alignment.md` — translating natural-language safety requirements into Lean `Prop` types
- `tactic-budget-profiling.md` — benchmarking `Omega`, `decide`, and `norm_num` under real-world agent step latency constraints
