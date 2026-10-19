# P8 — Deterministic simulation, empirical evaluation, and formal limits

**Round 1 · independent · sealed · anchor `6c2c30d74b889b4d8037ce5d43b265bfbf21a686`**

## Thesis

Drydock must constitutionally forbid an unqualified `PASS`. Every result must name the exact subject, model, scenario, schedule space, fault set, oracle, witness, and authority tier it covers.

Determinism proves repeatability only after every relevant source of nondeterminism has been brought under control. Property tests and schedule exploration can find counterexamples but cannot turn finite search into universal proof. Differential agreement can expose disagreement, not establish correctness. Model checking proves properties of a bounded or symbolic model, not its implementation without a checked refinement relation. Replay proves what happens on one captured history. Shadow execution proves comparative behavior only for mediated effects. A real canary proves that one real path worked under one provider, account, price, capacity, and time window.

The repository adopts this layered theory: Drydock contains effects while Trial Basin supplies deterministic providers, traces, adversarial scenarios, and evidence; Port Daddy may be the subject but cannot own either witness boundary ([product atlas](../../../proposals/grand-harbor-product-atlas.md)). FoundationDB likewise combines deterministic simulation with live performance and hardware-failure testing rather than treating simulation as sufficient ([official documentation](https://apple.github.io/foundationdb/testing.html)).

## Evidence and honest proof envelope

| Mechanism | Status at the sealed head | What it can honestly prove |
|---|---|---|
| Determinism, virtual time, schedule control | **SOURCE_PRESENT** as local seams: injected `now`/`sleep`, generation-bound circuit leases, deterministic DAG ordering. An integrated execution scheduler is **PROPOSED**. Dynamic evaluation is **BLOCKED_BY_HALT**. | Reproduces and explores controlled executions. It does not cover escaped wall clocks, OS threads, entropy, external services, or unscheduled I/O. CHESS shows why controlled interleavings outperform stress testing, but only for explored schedules ([Microsoft Research](https://www.microsoft.com/en-us/research/publication/chess-a-systematic-testing-tool-for-concurrent-software/)). |
| Fault and property testing | **SOURCE_PRESENT**: named transaction-boundary faults, rollback assertions, fast-check over bond/SQLite operations, and Loro proptest seeds. Exact-head outcomes are **UNKNOWN** because execution was forbidden. | A failure disproves the property for a concrete input and history. A green randomized run means only that its generator found no counterexample. QuickCheck is generated testing against programmer-supplied properties, not proof of all inputs ([Claessen and Hughes](https://research.chalmers.se/en/publication/237427)). |
| Differential testing | **SOURCE_PRESENT** for Rust/TypeScript planner parity through shared vectors. General semantic equivalence is **UNKNOWN**. | Disagreement proves at least one implementation or oracle is wrong. Agreement on shared vectors cannot exclude a common-mode defect or omitted case; an independent model oracle is required ([McKeeman](https://www.cs.tufts.edu/comp/150FP/archive/bill-mckeeman/DifferentailTesting.pdf)). |
| Model checking and symbolic verification | **SOURCE_PRESENT**: the manifest records formal artifacts across ProVerif, TLA+/TLC, Apalache, Kani, Z3, and EasyCrypt. Current CI execution is **UNKNOWN**. | TLC checks safety and liveness over the selected explicit state model; Apalache checks bounded symbolic executions or finite-data inductive invariants. Neither proves omitted transitions, environmental fidelity, cryptographic implementation, or code/model refinement ([TLA+ tools](https://lamport.azurewebsites.net/tla/tools.html)). |
| Replay, shadow execution, canaries | Event-log idempotent replay is **SOURCE_PRESENT**. Full T2 replay and shadow-runtime execution are **PROPOSED**. Real T3 canaries are **BLOCKED_BY_HALT**. | Replay establishes behavior for a recorded trace, not neighboring schedules. Shadowing compares decisions only if all effects are captured or suppressed. A canary is a partial, time-limited production observation ([Google SRE](https://sre.google/workbook/canarying-releases/)). |

## Non-negotiables

1. **Typed claims, never aggregate green.** Every verdict is one of safety-model, implementation-property, trace-replay, differential, shadow, empirical, or real-canary evidence. Witnesses do not silently compose.
2. **Seal nondeterminism.** A scenario manifest binds commit and tree, binaries, toolchain/image, policy, seed, virtual epoch, entropy stream, event schedule, fault IDs, external recordings, oracle version, and invariant set. Two executions of one manifest produce byte-identical observations or are declared nondeterministic.
3. **Mutation-test every oracle.** Negative controls are anti-vacuity evidence. A concrete theater risk exists: `whitepaper/corpus.json` marks v6 multi-hop escalation as a negative control, while the ProVerif runner recognizes only `*_vuln*` and `*naive_unsound*` filenames. V6 matches neither. Negative-control semantics must come from the authoritative manifest, and an unbaselined model must never yield a release pass.
4. **Every failure becomes a sealed fixture.** Preserve the raw trace first; then deterministically minimize it while retaining the same violated predicate. Commit a content-addressed bundle containing manifest, schedule, faults, observations, oracle, shortest counterexample, and expected bad/fixed outcomes. Replay it twice before accepting the fixture.
5. **Evidence never grants authority.** Each tier requires a new exact grant, and a result does not travel across commits, images, policies, scenarios, providers, or price snapshots. The active halt caps work at static D0.

## Strongest implementation proposal

**PROPOSED: Trial Basin Evidence Kernel.** Once separately authorized, build a small deterministic transition core before any VM or provider adapter:

`step(state, event, virtual_time, entropy) → state, effect_intents`

A single scheduler owns virtual time, task readiness, message delivery, cancellation, and fault decisions. Typed adapters turn effect intents into deterministic fake responses, recorded T2 observations, shadow comparisons, or separately granted T3 effects. The subject never supplies its own verdict.

On failure, the kernel freezes the complete manifest, applies schedule/input/fault minimization, emits the fixture bundle, and verifies replay. Formal counterexample traces should compile into executable scenarios; executable traces should project back into the model's state vocabulary. Differential tests include an independent specification oracle, not merely two implementations sharing fixtures. Empirical result cards pre-register hypotheses, baselines, cut criteria, sample size, confidence intervals, effect sizes, exclusions, and threats to validity.

## Falsification tests

- Inject an unmediated clock, random source, thread, and filesystem enumeration; determinism certification must fail.
- Seed stale-generation healing, duplicate settlement, retry-after-cancel, and reordered delivery; schedule search must find and shrink each crime.
- Mutate every invariant and checker branch. Removing v7's immediate-parent attenuation check must reproduce v6's reachable escalation.
- Give both differential implementations the same planted bug; the independent oracle must reject their agreement.
- Duplicate, drop, corrupt, and reorder replay events; exact replay must reproduce the expected terminal digest or fail loudly.
- In shadow mode, place an external effect sentinel behind every broker. Any real mutation invalidates the run.
- A future canary must be one attempt, bounded, reconciled before/after, and incapable of retry-based authority widening.

## Impossible combinations

- Exhaustive exploration of an unbounded concurrent state space.
- Perfect deterministic replay while retaining unmodeled real-world nondeterminism.
- A side-effect-free shadow that proves real provider side effects.
- A zero-risk real canary.
- Deterministic consensus termination in a fully asynchronous system with one crash and no timing, failure-detector, or probabilistic assumptions; FLP establishes that boundary ([paper](https://groups.csail.mit.edu/tds/papers/Lynch/jacm85.pdf)).

## Skill audit

- `sandboxed-adversarial-test-harness` owns containment and the halt gate.
- `falsification-first` owns negative controls and checker mutation.
- `tlaplus-practitioner` owns bounded state-machine safety/liveness.
- `proverif-tamarin-protocol-modeling` owns symbolic protocol claims.
- `empirical-systems-evaluation` owns baselines, confidence intervals, effect sizes, and validity threats.
- `dag-replay-debugger` is postmortem DAG inspection, while `runtime-verification-for-agents` is production monitoring; neither owns deterministic system exploration or fixture promotion.

## Missing skill proposal

**`trial-basin-deterministic-systems-evaluation`**

Activate when implementing or auditing an executable deterministic systems harness that must control virtual time, entropy, task/message schedules, faults, replay, shadow comparison, counterexample minimization, and promotion of failures into content-addressed fixtures across concrete adapters.

Do not activate for VM, credential, network, or spend containment; statistical study design; symbolic protocol proofs; production runtime monitoring; generic DAG debugging; ML training; or authorizing or running a real canary.

## Confidence and unknowns

Confidence is high for the source classifications and the manifest/runner mismatch, and medium for repository-wide absence claims because static search is not proof of nonexistence. Exact-head test results, schedule coverage, model-to-code refinement, shadow effect capture, provider behavior, canary accounting, and empirical effect sizes remain `UNKNOWN`. Every dynamic Trial Basin, shadow, or provider claim remains `BLOCKED_BY_HALT`.

**SEALED — P8 — 2026-09-16.**
