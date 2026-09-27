# Bounded proof-artifact pattern — unverified external context

This note preserves a useful design question without attributing unverified properties to a particular Lean implementation. The repository contains no primary source that establishes a local Lean runtime, a verified kernel deployment, proof replay latency, or an enforcement integration. Do not treat those as facts.

## What a proof artifact can establish

A checker can establish a theorem only relative to a version-pinned formal model, assumptions, and supplied inputs. That can be valuable for a narrow invariant, such as “this proposed capability set is within the declared allow-list.” It does not establish that an external mutation occurred, that an effect was durable, or that all relevant production conditions were modeled.

## If evaluating a proof-artifact integration

1. State the exact invariant, model boundary, inputs, and effect evidence required after the check.
2. Pin the checker, language, solver, and artifact versions; record their digests.
3. Measure the exact local path against a preregistered workload. Do not infer a latency bound from a paper, a benchmark, or an offline compilation result.
4. Fail closed when the artifact, checker, version, inputs, or effect receipt are unavailable.
5. Keep recovery and reconciliation separate from the invariant check: an unavailable or uncertain effect needs a receipt lookup or repair workflow.

This is architectural context only. It does not authorize a runtime gate or support a claim of formal correctness for a broader system.
