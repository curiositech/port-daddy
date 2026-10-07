# Failure diagnostics for a BDI-style system

## Diagnosis procedure

Treat each symptom as evidence requiring competing explanations.

1. Capture the event, its provenance/timestamp, current beliefs/desires, active stacks, plan candidates, rejections, selection, and action-gate result.
2. State the symptom without a cause claim.
3. Test candidates by replaying the same trace while varying one declared component.
4. Record unknowns and unresolved outcomes.
5. Change policy/library only after the trace supports the chosen local diagnosis.

| Symptom | Candidate explanations | Hand-checkable negative case |
| --- | --- | --- |
| Active stack continues after a conflict | blind policy; absent/late update; stale belief; precondition not rechecked; effect already admitted | “The agent is blind” from one obsolete action. |
| Repeated revisions | broad trigger; alternating priorities; input jitter; selection ties; duplicate events | “Open-mindedness alone caused thrashing.” |
| Slow response | queue backlog; matching; preconditions; deliberation; update; action gate | “Delay exceeds change period, so matching is the bottleneck.” |
| No candidate | no invocation match; failed precondition; policy rejection; incomplete library; lost event | “No plan proves goal impossible.” |
| Conflicting desires | declared priorities, missing arbitration, simultaneous independent stacks | “One desire automatically wins.” |

**Positive fixture.** Replay a queued blocked(route) event with two plans and record exactly why short_route was retained, dropped, or not considered.

**Negative fixture.** Treat a simulator’s selected action as external authority. BDI attitude and plan traces do not authorize a real-world effect.

## Approximation boundary

The paper’s representation simplifications and commitment choices can produce domain-specific failure modes, but it does not publish this taxonomy, a root-cause oracle, or universal remediation. Use it as an engineering diagnostic worksheet.

## Source boundary

Official paper read in full 2026-09-24; this reference’s diagnostic procedure and fixtures are local engineering material.

Primary source: [Rao–Georgeff 1995, ICMAS pp. 312–319](https://cdn.aaai.org/ICMAS/1995/ICMAS95-042.pdf). Constructed fixtures and local engineering choices are identified above.
