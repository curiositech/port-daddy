# N–Z research additions

## Sources accessed 2026-09-23

- NIST reference monitor glossary: https://csrc.nist.gov/glossary/term/reference_monitor — always-invoked mediation differs from observing an ordinary callback.
- NIST AI 100-2e2025: https://doi.org/10.6028/NIST.AI.100-2e2025 — attacker knowledge and mitigations belong in the threat taxonomy.
- Carlini et al.: https://arxiv.org/abs/1902.06705 and Tramer et al.: https://arxiv.org/abs/2002.08347 — defenses require adaptive evaluation, not fixed attacks alone.
- RFC 9110 section 9.2.2: https://www.rfc-editor.org/rfc/rfc9110#section-9.2.2 — do not automatically retry non-idempotent operations without proof of idempotence or non-application.
- AWS Durable Execution guidance: https://docs.aws.amazon.com/durable-execution/patterns/best-practices/idempotency/ — at-most-once per retry is not whole-workflow exactly-once.

## Applied changes

- runtime-verification-for-agents: monitoring versus enforcement, five evidence classes, and attacker-aware ground-truth evaluation.
- sandboxed-adversarial-test-harness: uncertain-effect matrix, HOLD/reconciliation, adaptive attacks, safety separated from liveness.
- provable-action-adjudicator: uncertain-effect/evidence guidance and replacement of unsupported universal microsecond/imported-benchmark claims with frozen local measurement.
- resource-bounded-planning: whole-team attempt-tree budget including retries, review, reconciliation, and operator time.
- skill-grader: structural quality separated from causal efficacy; blocked randomized availability evaluation with length-matched and resource-only controls.
- research-craft and research-analyst: source ledger, evidence classes, and version-pinned causal evaluation.

No source establishes deployment or efficacy in this repository; the new material defines bounded hypotheses and evaluation designs.

## Review dispositions, 2026-09-23

- FormalJudge placeholder/Lean metrics: replaced with arXiv:2602.11136, Dafny/Z3 scope, and an explicit local hypothesis.
- Operad guarantees: corrected to formal typed composition; outcome equivalence, effects, acyclicity, and parallelism now require separate semantics/evidence.
- Runtime verification: finite injection results relabeled as corpus results, not formal correctness or complete mediation.
- Swarm retained documents: scope/supersession banners added; no live authority or latency claim.
- NIST: all cited 2025 labels now use DOI 10.6028/NIST.AI.100-2e2025.
- Resource planning: removed universal override-rate defaults; replaced with local calibration.

## Operad full-entrypoint correction, 2026-09-23

The earlier partial operad disposition left contradictory claims elsewhere in the entrypoint. The full rewrite now distinguishes colored-operad substitution laws, a compatible algebra, implementation contracts, and empirical behavior. Associativity equates regroupings of the same substitution tree; it neither makes every operation associative nor equates a hierarchical agent workflow with a different flat prompt. Nondeterminism does not weaken the abstract laws to approximate equality. Acyclicity is explicitly this skill's chosen workflow constraint. Scheduling, effects, authority, and artifact sharing have separate obligations; no maximum-parallelism theorem, universal input-count limit, automatic olog transfer, or claimed Jury-rig conformance remains.

Primary sources read for this correction:

- [Leinster, Higher Operads, Higher Categories (2004), Chapter 2](https://arxiv.org/pdf/math/0305049): Definition 2.1.1 (multicategory laws), Examples 2.1.2–2.1.5 (categories as unary multicategories and the additional monoidal construction), Definition 2.1.12 (algebras).
- [Fong and Spivak, An Invitation to Applied Category Theory (2019)](https://arxiv.org/pdf/1803.05316): Chapter 6 was correctly numbered; §§6.5.1–6.5.3 precisely locate operads/algebras and the symmetric-monoidal construction. Chapter 5 §5.2.2 separately supplies an acyclic port-graph model.
- [Spivak (2013), arXiv:1305.0297](https://arxiv.org/abs/1305.0297), §2: colored-operad conventions, functors, and algebras; the paper explicitly includes recursion. [Vagner, Spivak, and Lerman (2015), arXiv:1408.1598](https://arxiv.org/abs/1408.1598) supplies a specific dynamical-system interpretation rather than generic agent guarantees.
- [Catlab official documentation](https://algebraicjulia.github.io/Catlab.jl/latest/) (accessed 2026-09-23): computational wiring-diagram tools; explicitly not a theorem prover or proof assistant.

The implementation example now uses explicit artifact/node/port bindings, with provenance checks for reports about the same patch. Validation: `PYTHONDONTWRITEBYTECODE=1 python3 skills/skill-hygiene/scripts/audit_skill_bundle.py skills/operad-task-decomposition --json` returned `ok: true` and empty finding arrays. A separate in-memory check parsed the JSON fragment and verified all three node bindings, declared types, final output reference, and acyclicity. `git diff --check` passed for the two owned files. These are documentation/example checks, not proofs of an executor or agent behavior. No validators were edited.
