# Theory–practice gap: principled approximation

## Three representations

The paper connects a quantitative decision-tree account, a symbolic possible-worlds/modal account, and a practical architecture. Each step changes what can be represented.

| Level | Preserves | Explicit limitation |
| --- | --- | --- |
| Decision tree | probabilities, payoffs, decision/chance paths | needs a complete enough model and defined deliberation function. |
| Symbolic BDI | beliefs, desires, intentions as accessibility relations; static/dynamic constraints | ideal closed attitudes and provability procedures are not a practical real-time implementation. |
| Practical system | current-state ground beliefs, plan options, intention stacks, event queue | loses disjunctions/implications and requires domain-specific fast procedures. |

Apply the approximation procedure:

1. name the formal property needed (for example, a chosen path remains feasible under a declared model);
2. identify the practical representation that stands in for it;
3. list omitted constructs and local adapters;
4. create positive and negative conformance fixtures; and
5. measure timing and outcome separately from external effect authority.

**Positive fixture.** A formal desired path to checkpoint becomes plans with invocation/precondition/body. A trace establishes whether the practical interpreter selects the intended plan under declared beliefs.

**Negative fixture.** A passing trace proves the formal theory, real-world success, or a safe external effect. The mapping and the effect boundary require separate evidence.

## Verification boundary

The paper says formalization can be used to specify/design/verify behavior when environment changes and expected behavior are known for the application. It also says the ideal interpreter’s provability procedures are not computable and provides no way to establish real-time speed for option generation/deliberation. Treat verification scope, model coverage, and target timing as declared properties.

## Source boundary

Official paper, BDI logics through practical system sections, read 2026-09-24. OASIS trials are an application report, not general empirical calibration.

Primary source: [Rao–Georgeff 1995, ICMAS pp. 312–319](https://cdn.aaai.org/ICMAS/1995/ICMAS95-042.pdf). Constructed fixtures and local engineering choices are identified above.
