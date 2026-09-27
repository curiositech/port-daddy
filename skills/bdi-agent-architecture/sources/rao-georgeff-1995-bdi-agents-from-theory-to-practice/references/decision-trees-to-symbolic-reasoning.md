# Decision trees to symbolic reasoning

## Transformation method

The paper begins with a decision tree containing decision nodes, chance nodes, terminal nodes, probability information, and payoffs. A deliberation function such as maximin or expected-utility maximization selects best action sequences **given its model and inputs**.

For a full tree, the described transformation recursively removes each chance node for a particular successor state, yielding decision-only trees representing possible environment states. Probability information becomes a belief-accessibility relation; payoff information becomes a desire-accessibility relation; selected best paths become an intention-accessibility relation.

1. State whether the input is a full decision tree, including zero-payoff paths.
2. Enumerate the environment alternatives introduced at chance nodes.
3. Preserve the selection function and its probability/payoff assumptions.
4. Map selected paths separately from desired paths.
5. State what is omitted when using the practical ground-literal/plan approximation.

**Positive fixture.** A two-route tree has chance outcomes clear and blocked; desired paths reach the checkpoint; selected paths depend on declared costs. The transformation explains the relations, not the actual route outcome.

**Negative fixture.** Assign a value to a route without probabilities/payoffs, then call the selected route optimal. The source supplies no optimum without the defined deliberation model and inputs.

## Formal limits

The paper reduces numeric information to believed/not-believed, desired/not-desired, and intended/not-intended in its logical presentation. It adopts KD45 for belief and D/K constraints for desires and intentions, then permits different BDI systems because no unique correct axiomatization covers every relevant agent. Do not infer a fixed static relation, complete state knowledge, or runtime theorem proving from this formal account.

## Accessibility-relation classification

The paper separates two dimensions; a mere inclusion diagram cannot specify both.

| Dimension | What to record | What it does not establish |
|---|---|---|
| Accessible-world sets | Inclusion in either direction and empty/nonempty intersection for each relevant pair of B, D, I sets | The internal time-tree structure of any world |
| Structure inside worlds | One time tree is a sub-world/super-world of the other, identical, or incomparable | Inclusion among the sets of worlds |

The authors report twelve BDI systems from combinations of these constraints; the article does not enumerate a complete table. Do not multiply the phrases above into sixteen independent systems, or invent a full classification theorem from this summary.

Three named examples connect attitudes differently:

| Variant | Paper's stated condition | Diagnostic question |
|---|---|---|
| Realism | Believing a proposition entails desiring it | Does this application actually want that cross-attitude condition? |
| Strong realism | Desiring to achieve a proposition entails believing it is an option | What accessible path witnesses that option? |
| Weak realism | Desiring to achieve a proposition excludes believing its negation inevitable | Is the negation unavoidable on every belief-accessible future? |

Within-attitude closure and cross-attitude closure are different. The selected KD45 belief logic and D/K desire/intention axioms constrain each attitude. The discussed asymmetry requirement asks for mutual consistency without completeness; the non-consequential-closure requirement prevents importing every implication of one attitude into the others. These choices are model constraints, not a promise that a practical plan interpreter implements modal theorem proving.

**Constructed set exercise.** Let B={w1,w2}, D={w2,w3}, I={w2}. The intersections B∩D, B∩I, and D∩I are all {w2}; I is included in B and D, while neither B nor D includes the other. This checks the set dimension by inspection. It does not define the world's time trees, valuations, temporal/modal axioms, or dynamics, so it is not a complete BDI model or proof of interpreter correctness. Add those structures before claiming a semantic result.

## Source boundary

Official paper, §§“Decision Trees to Possible Worlds” and “BDI Logics,” read in full 2026-09-24. The cited detailed transformation algorithm is in earlier work; this paper gives its summary, not an executable implementation.

Primary source: [Rao–Georgeff 1995, ICMAS pp. 312–319](https://cdn.aaai.org/ICMAS/1995/ICMAS95-042.pdf). Constructed fixtures and local engineering choices are identified above.
