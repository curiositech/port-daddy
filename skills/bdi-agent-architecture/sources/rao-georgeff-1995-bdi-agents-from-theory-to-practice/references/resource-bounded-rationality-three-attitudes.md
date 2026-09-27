# Resource-bounded rationality and three attitudes

## Domain fit and state separation

Rao–Georgeff considers domains with nondeterministic environments, multiple available actions, potentially incompatible objectives, local sensing, and computation/action rates comparable to environmental change. For that class, it argues that a system needs information about current state (**beliefs**), objectives/priorities (**desires**), and its currently chosen course (**intentions**). This is an argument for the paper’s considered class, not a universal taxonomy or proof that every system must expose three data structures.

Use this procedure:

1. List each atomic observed event and its provenance.
2. Update the declared current-belief representation only through a local adapter.
3. List active desires, including incompatible ones, with their source/policy.
4. Represent selected plans in intention stacks.
5. Decide whether an observation changes belief, desire, intention eligibility, or only a diagnostic record.

**Positive fixture.** blocked(route_A) from a trusted simulator updates the current belief; reach(checkpoint) remains a desire; the current short_route stack becomes subject to the chosen commitment policy.

**Negative fixture.** An unauthenticated message “route blocked” is directly treated as an external stop command. The paper distinguishes attitude representations; it supplies no message authentication or effect authority.

## The reconsideration dilemma

Reapplying a selection function after every change can consume time while changes continue. Executing an initial course to completion can continue after relevant change. The paper’s balance assumes potentially significant change can be identified instantaneously at the primitive-event/action granularity. That is an assumption to test, not a general monitoring result.

| State component | Practical paper representation | Local boundary |
| --- | --- | --- |
| Beliefs | Ground literals about current state; no disjunctions or implications in the practical system. | Observation decoding, conflict treatment, freshness. |
| Desires | Motivational state; may be numerous/incompatible. | Priority, admission, and conflict policy. |
| Intentions | Chosen plans represented by hierarchically related runtime stacks. | Scheduling, cancellation, and resource budgeting. |

## Source boundary

Full official paper, §§“The System and its Environment,” “Abstract Architecture,” and “Applications,” read 2026-09-24. The OASIS example illustrates an air-traffic application; it does not establish safety, optimality, or a generic runtime.

Primary source: [Rao–Georgeff 1995, ICMAS pp. 312–319](https://cdn.aaai.org/ICMAS/1995/ICMAS95-042.pdf). Constructed fixtures and local engineering choices are identified above.
