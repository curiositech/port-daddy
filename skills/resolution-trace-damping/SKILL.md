---
name: resolution-trace-damping
version: 0.1.0
description: >
  Resolution-trace damping is an implementation-specific stigmergic heuristic for multi-agent systems: after an agent solves a problem at a node, it deposits
  a RESOLUTION trace there. An opt-in read helper can return a
  damped effective pheromone under the implementation's stated formula. This is a
  candidate for reducing repeated attraction to completed nodes, not a demonstrated
  prevention of redundant work or starvation. Verify source version and navigation
  behavior before claiming that agents follow the damped gradient.
author: soma-windags-graft
tags: [stigmergy, multi-agent, coordination, resolution-signals, pheromone]
pairs-with: []
---

# Resolution-Trace Damping

## When to Use

- A completion signal may inform peers, provided completion has a defined, auditable criterion and binds a task version that can be invalidated on regression.
- You have measured repeated work on a representative task set and want to test whether a local damping policy changes revisits without suppressing reopened or unfinished work.
- You need distributed work-spreading with no central scheduler; the damping
  field is a heuristic input whose actual routing effect must be verified in the pinned implementation.

NOT for:
- Nodes that are only partially resolved unless the implementation defines and tests the meaning of partial intensity; do not assume intensity is calibrated completion probability.
- Suppressing genuinely urgent re-work (regressions, cascading failures); define an independently authorized urgent-work path and verify that its actual routing policy bypasses stale suppression.
- Replacing a separately implemented deny or quarantine policy. A local completion score does not establish any global blocking mechanism, whatever trace names an implementation uses.

## Core Concepts

**RESOLUTION trace** — a separately recorded local completion signal. In the pinned Port Daddy source, `sprayResolution(table, id, key, strength)` **replaces** one `metadata.resolutions[key]` value; it does not accumulate deposits. The inherited SOMA `Medium.resolution` accumulation/non-diffusion description is unverified and must not be attributed to this implementation.

**resolution_damping (d)** — an implementation-specific scalar. No default value is established by the reviewed sources. Under the stated formula, `d=0` disables damping and the clamp makes the effective signal zero once `d * res >= 1`; parameter bounds and units must be validated against the implementation.

**Candidate effective pheromone** — the inspected Port Daddy source snapshot returns this from `sniffEffective`; another consumer or a different repository version may differ. Formula:

    effective(n) = raw(n) * max(0.0, 1 - d * res(n))

where `raw(n)` denotes the raw signal and `res(n)` the separate resolution score. These are conceptual variables, not verified SOMA API names.
For finite nonnegative inputs, the multiplier lies in `[0,1]`; the clamp prevents sign inversion when `d * res > 1`. The Port Daddy helper additionally clamps its attenuation amount at both ends. Its inspected source does not validate every nonfinite input; do not infer the domain from a TypeScript `number` annotation.

**Gradient behavior — unverified boundary.** This skill's inherited reference says the gradient path reads raw pheromone, while the original entrypoint claimed effective pheromone. Treat this as a material source/version mismatch: inspect and pin the implementation, then test `sense()` and `gradient()` independently before asserting which signal controls navigation.

**Repeated-work hypothesis.** A positive-feedback pattern may cause revisits, but this skill contains no evaluated result establishing its prevalence or that damping resolves it. State the workload and measure both duplicate revisits and missed reopened/unfinished work.

## Implementation Pattern

```python
import math

def candidate_priority(raw, resolution, damping, work_status, evidence_current):
    """Constructed pure policy example, not a Port Daddy/SOMA API."""
    for value in (raw, resolution, damping):
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise ValueError("signals must be numbers")
        if not math.isfinite(value) or value < 0:
            raise ValueError("signals must be finite and nonnegative")
    if work_status not in {"OPEN", "PARTIAL", "RESOLVED", "REOPENED"}:
        raise ValueError("unknown work status")
    if not isinstance(evidence_current, bool):
        raise ValueError("evidence disposition must be explicit")
    # A stale completion must not suppress unfinished or reopened work.
    if work_status != "RESOLVED" or not evidence_current:
        return raw
    return raw * max(0.0, 1.0 - damping * resolution)

# Constructed arithmetic, not measured routing improvement.
assert candidate_priority(1.0, 1.0, 0.5, "RESOLVED", True) == 0.5
assert candidate_priority(1.0, 1.0, 0.5, "REOPENED", False) == 1.0
```

The example deliberately separates work status from a heuristic score. A production adapter must bind `evidence_current` to a verified task/version/evidence record; a caller-supplied boolean is not such verification. Record the task and work version, completion-evidence digest, issuer, signal key, deposit/replacement sequence, policy version and invalidation reason. Preserve the raw signal and return the applied policy with any attenuated value.

Signal expiry and task reopening are different transitions: an expired score does not invalidate verified completion or authorize repeating completed work. Conversely, a new task version must not inherit an old score just because it uses the same file path. An authoritative work ledger decides eligibility; damping can only rank already-eligible work. Define a partial-completion policy explicitly before attenuating it.

The inherited SOMA no-decay claim remains unverified. The inspected Port Daddy evaporation loop fades resolution values by the square of its pheromone decay factor. It still needs an application-level invalidation contract for newly reopened work; waiting for natural decay is not equivalent to immediate invalidation.

## Key References

- The cited SOMA `medium.py` path and line ranges are an inherited, unverified implementation reference; repository/commit identity was not established in the research pass. Do not describe them as current source truth until independently pinned and checked.
- The inspected Port Daddy snapshot uses `r=min(1,max(0,d*res))`, then `raw*(1-r)` in a read helper. This is a source fact for the cited commit, not proof an agent navigation consumer uses it. The SOMA formula/source remains unverified.
- [Robinson et al. (2005)](https://www.nature.com/articles/438442a) report an ant-foraging negative trail signal; only the publisher abstract was inspected here on 2026-09-24. This is biological context, not a validation of the software formula. See [negative feedback and evaluation](references/negative-feedback-evaluation.md). The inherited Hansen–Ghrist lead concerns a different mathematical model and supplies no damping evidence.

## Bundle navigation

- [Decision flow](diagrams/01_flowchart_decision-points.md) — visual decision points for damping a resolution trace.
- [References index](references/INDEX.md) — load the relevant background mechanism or Port Daddy application.


## Reopen, expiry, and measured trade-offs

See [reopen and decay policy](references/reopen-and-decay-policy.md) for the linked procedure and source limits.

Track completion as revocable state, not an irreversible assertion. Define the resolution key, completion evidence, invalidation on regression/new work, and expiry/decay/reset policy. Test solved, unresolved, false-completion, reopened, and urgent work. At the cited Port Daddy commit, `sniffEffective` applies the attenuation formula; its inspected file does not establish which path the gradient/navigation consumer uses. The inspected GET route can opt into `sniffEffective`; no inspected navigation path establishes its use for gradient choice. Pin and inspect both consumers before making a routing claim; the generic SOMA source remains unverified.

Sweep `d`, deposit, TTL/decay, and urgency policy against a workload with known duplicate revisits and reopening events. Measure revisit reduction and missed unfinished/reopened work separately; do not claim “single pass,” coverage, or a balanced default from analogy. See [reopen and decay policy](references/reopen-and-decay-policy.md).

- [Reopenable resolution lifecycle](diagrams/research-d05-reopenable-resolution-lifecycle-rewrites-existing-mermaid.md)
- [Damping equation and implementation boundary](diagrams/research-d06-damping-equation-and-implementation-boundary.md)
- [False completion and reopen trace](diagrams/research-d07-false-completion-and-reopen-trace.md)

