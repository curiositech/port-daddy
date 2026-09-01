# Computational Tooling for Defenders

Same shape as the red-team tooling reference, oriented at defender workflows: prove the
properties, monitor invariants in production, lock in regressions.

---

## 1. Symbolic Protocol Analysis (Defender Use)

### ProVerif
When: prove secrecy and authentication of capability issuance + delegation. Defenders
use ProVerif to *certify* a property; red team uses it to find counterexamples. Same
tool, opposite goal.
Input: applied-pi-calculus model committed alongside the protocol code; CI runs ProVerif
on every change. A current example is
`whitepaper/formal/proverif/anchor/token-verify/algconfusion.pv`.
Output: `RESULT ... is true` for every required lemma. Failure blocks merge.

### Tamarin
When: stateful properties — "no two valid uses of the same nonce", "revocation
eventually reaches every honest verifier under fair scheduling".
Input: `.spthy` co-located with code; CI invokes `tamarin-prover --prove`.
Output: proofs cached in artifact store as proof obligations.

### CryptoVerif
When: rare; reserved for the foundational signing primitive. One-time investment to
produce a computational proof, then re-checked only on primitive change.

---

## 2. Model Checking (Defender Use)

### TLA+ / TLC
When: spec the gossip + revocation + bond-escrow state machines; check liveness and
safety invariants. Defenders run TLC with progressively larger state-space bounds in CI
(small in PR, large nightly).
Input: `.tla` + `.cfg` per subsystem.
Output: `No errors found` over `N states`. Surface state-space coverage in dashboards.

### Apalache
When: parameterized verification — "any N daemons satisfy the invariant" with N
symbolic. Use type-level annotations to prevent foot-guns.
Input: typed TLA+.
Output: per-invariant proof or symbolic counterexample.

### Spin
When: low-level message protocols (pheromone retraction, lock acquisition). Especially
useful for liveness under fair scheduling.
Input: `.pml` with LTL claims.
Output: verification successful / counterexample trail.

---

## 3. Bounded Checking + Continuous Fuzzing

### Kani (Rust) — in CI
When: every PR touching the cryptographic core, parsers, or filter ops. Set bounds high
enough to be meaningful but low enough to fit CI budget; nightly job runs deeper bounds.
Input: `#[kani::proof]` annotations checked in alongside code.
Output: pass/fail; counterexamples auto-saved as fuzz seeds for AFL++.

### AFL++ / libFuzzer — in OSS-Fuzz-style CI
When: continuous fuzzing of parser surfaces. Run as a long-lived job; surface new
crashes via issue tracker auto-creation.
Input: harnesses checked into `fuzz/` with seed corpora; coverage tracked via
`AFL_FORKSRV_INIT`.
Output: corpus growth, crash deduplication, regression tests added to unit suite.

### KLEE
When: occasional deep symbolic exploration of small modules. Not a continuous tool —
use for audit milestones.
Input: bitcode + symbolic-input annotations.
Output: per-path test cases; commit those with high branch coverage as regression suite.

---

## 4. Property-Based + Metamorphic Testing

### Hypothesis / fast-check / proptest
When: every public API surface should have a property test alongside example tests.
Stateful machines (`RuleBasedStateMachine`) capture protocol-level invariants.
Input: strategies + properties co-located with unit tests.
Output: shrunk failure cases auto-promoted to regression tests; persistent corpus
checked into version control.

Metamorphic relations to encode:
- `verify(token) == verify(canonicalize(token))` (idempotent re-encode).
- `revoke(t); verify(t) == false` (revocation is observable everywhere within window).
- `delegate(t, s); attenuate(t', s) ⊑ s` (scope is monotone narrowing).
- `concurrent_claim(p, p) -> exactly-one-winner` (claim is mutually exclusive).

---

## 5. SAT / SMT (Defender Use)

### Z3
When: prove finite-state invariants (e.g. "no two delegations reach the same scope from
disjoint roots"). Embed in CI via `pytest`-driven Python harness.
Input: SMT-LIB or `z3-solver` Python.
Output: `unsat` (invariant holds) or `sat` model (counterexample → regression).

### CVC5
When: cross-validate Z3 results, especially on string- or datatype-heavy queries.
Disagreements between solvers are themselves bugs.
Input: SMT-LIB v2.
Output: same; difftest against Z3.

---

## 6. Network Adversary Simulation

### Jepsen
When: nightly chaos-style runs against a multi-daemon federation. Defenders use Jepsen
not just to find bugs but to prove resilience under documented fault models.
Input: Clojure test invoking the federation API; nemeses configured per scenario.
Output: linearizability/serializability verdicts. Persist scenario configurations as
defended-against fault models in docs.

### tc / netem / comcast
When: integration-test infrastructure. Run a fixed set of network scenarios on every
release candidate.
Input: scenario scripts in `tests/network/`.
Output: pass/fail of behavioral assertions under each scenario.

---

## 7. Economic Mechanism Testing

### Mesa (Python ABM)
When: pre-deployment validation of mechanism changes. Sweep parameter space, check that
welfare metrics monotonically improve and that no Sybil/cartel strategy beats the honest
strategy.
Input: agent strategies modeling honest, Sybil, cartel, lemon, churner behaviors.
Output: per-scenario welfare and inequity metrics; commit baselines as regression tests.

### Auction simulators (BSE, mesa-economy)
When: validating bond-pricing auction designs against known strategies (truth-telling,
shading, last-look).
Input: strategy implementations + market parameters.
Output: revenue, allocative-efficiency, and bid-shading distributions.

---

## 8. Defender-Specific Tooling

### 8.1 Invariant Runtime Checking (Arbiter Pattern)
Embed runtime assertions for the protocol invariants verified statically. Cheap checks
on every operation; expensive checks sampled.

Tools:
- **Drogue / runtime-verification crates (Rust)** for Linear Temporal Logic over event
  streams.
- **Aspect-style instrumentation** in the daemon — wrap every `claim`, `release`,
  `revoke` with pre/post-condition checks logged to a separate evidence channel.
- **pd guard** itself as the project's existing Arbiter surface; enforce coordination
  invariants pre-commit.

When: production daemon. Configure a "warn" mode in dev, "enforce" mode in prod.
Input: invariant predicates encoded in code or a DSL.
Output: violation events on a quarantined channel; trip the kill switch on safety
violations.

### 8.2 Continuous Fuzzing in CI
Treat fuzzing as a *test suite*, not a one-off audit. Targets:
- All parsers (token, gossip, capability chain).
- Public-key serialization round-trip.
- Cuckoo-filter ops at boundaries (full, near-full, empty).

Tools:
- ClusterFuzzLite for self-hosted continuous fuzzing.
- OSS-Fuzz for projects accepted into the program.
- GitHub Actions with cron-triggered AFL++ jobs as a baseline.

Input: harnesses + corpora in repo.
Output: crash → auto-issue → regression test in PR. Track coverage and corpus growth as
release-quality metrics.

### 8.3 Formal Proof Obligations as Test Artifacts
Every safety property should exist in three forms:
1. **English statement** in the security soundness spec (`docs/SECURITY_SOUNDNESS.md`).
2. **Formal lemma** in Tamarin/ProVerif/TLA+/Z3 (`whitepaper/formal/`).
3. **Runtime check** in code or property test (`tests/properties/`, Arbiter rules).

Build a manifest mapping each property across the three layers. Drift between layers is
itself a finding. Tools:
- Custom CI script verifying every property in (1) has an entry in (2) and (3).
- `cargo-deny` / `npm-audit` style policy: missing entries block merge.

Output: a properties dashboard showing coverage. Newly added properties light up red
until all three layers are populated.

### 8.4 Observability for Adversary Telemetry
Defender needs to *see* attempts. Instrument:
- Failed verification attempts grouped by failure mode (pin them to attack-pattern IDs).
- Cuckoo-filter insertion-failure rate.
- Distress-signal frequency per identity.
- Revocation propagation latency p50/p99.

Tools: OpenTelemetry traces, Prometheus metrics, Grafana dashboards keyed to attack
pattern IDs. A spike on a metric is a live attack signal.

---

## Glue Patterns

- ProVerif/Tamarin proofs become CI gates; failures block merge.
- Kani counterexamples auto-flow into AFL++ corpus.
- TLC error states become Jepsen scenarios.
- Mesa simulation outputs become regression baselines for any mechanism change.
- Runtime invariant violations auto-create issues with the attack-pattern ID and the
  triggering input bytes.
