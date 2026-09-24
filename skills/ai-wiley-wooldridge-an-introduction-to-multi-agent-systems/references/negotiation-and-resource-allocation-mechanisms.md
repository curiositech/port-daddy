# Negotiation and resource allocation: distinguish protocol from incentives

A protocol structures interaction; it does not make participants honest or guarantee an efficient outcome.

## Specify the interaction model

Record agents/actions, preferences or utility assumptions, feasible outcomes, outside options, knowledge, cooperative vs self-interested incentives, and what agreement/completion means. If preferences are not numeric or comparable, do not invent utility merely to run an optimizer.

## Contract Net for task sharing

For its five stages and message sequence, see [coordination](coordination-as-necessity-not-luxury.md). Contract Net structures announcement, proposals, selection, and execution in a cooperative task-sharing setting. It does not by itself define a payment rule, truthfulness, fairness, or complete failure recovery.

### Feasibility before ranking

A task requires a supported format and completion before deadline. First exclude proposals violating hard constraints; then apply the declared ranking rule. If none remain, report no feasible award. Keep evidence for exclusion and selection.

## Bargaining and agreement

Author chapter 15 slides summarize monotonic concession and Zeuthen strategy. In the monotonic concession protocol summarized in the slides, agents make simultaneous proposals from the negotiation set. Agreement occurs when one agent finds the other's proposal at least as good as its own. In later rounds an agent may not propose a deal the other prefers less than the previous proposal; if neither concedes, the protocol ends at the conflict deal. This procedure presupposes that the parties can compare deals under a shared preference model.

For a task-oriented domain (TOD), the lecture models a finite task set T, agents, and a cost function c over subsets of tasks. In an encounter, each agent begins with its assigned task set T_i. A deal reallocates the union of tasks; utility for agent i is its original standalone cost c(T_i) minus its cost under the deal. The conflict deal preserves original allocations and has utility zero under this definition. The negotiation set contains deals that are individually rational relative to that conflict deal and Pareto efficient under the modeled costs.

Constructed counterexample: two delivery tasks to the same destination have standalone costs 5 and 6. If one agent can perform both for cost 7, aggregate cost falls from 11 to 7. But assigning both to the first agent gives utilities 5−7=−2 and 6; assigning both to the second gives 5 and 6−7=−1. Neither pure assignment is individually rational for both under the lecture’s cost-only utility rule. The aggregate saving does not create a mutually beneficial deal unless a permitted transfer or another allocation rule is added. The numbers are illustrative; the cost model must include real capacity/deadline constraints before use.

Zeuthen-style reasoning starts from each party’s most preferred deal, asks which is less willing to risk conflict, and has that party concede just enough to change the risk balance. Willingness to risk conflict depends on the utility gap between current proposal and conflict outcome in the model. The slides state an equilibrium result under assumptions; that result does not establish robustness to deception, changed utilities, bounded computation, or a different protocol. Specify utilities, disagreement outcome, proposal space, timing, and beliefs before applying it.

## Bounded single-item Vickrey example

A second-price sealed-bid auction awards one item to the highest bidder and charges the winner the second-highest bid. Under standard private values and quasi-linear utility, truthful bidding is weakly dominant. This does not establish truthfulness with collusion, budget constraints, interdependent values, multiple items, or changed rules. This is a mechanism example, not a recommendation for task dispatch.

With values A=10 and B=7, truthful bids make A win and pay 7. A bidding 6 loses and yields 0 rather than 3; bidding 12 still wins and pays 7. This hand check is not proof of the general result.

## Worked design procedure

1. Define resource/task and feasible outcomes.
2. Separate hard constraints from preferences.
3. Establish shared vs strategic objectives.
4. Select task-sharing, bargaining, or specified auction protocol.
5. Define proposals, rejection, acceptance, outcomes.
6. State no-proposal, tie, timeout, changed-task, and nonperformance paths.
7. Analyze incentives within actual utility/information model.
8. Test profiles and edge cases; distinguish tests from theorem.

## Sources and access

- Wooldridge, [chapter 14 author lecture slides](https://www.cs.ox.ac.uk/people/michael.wooldridge/pubs/imas/distrib/pdf-slides/lect14.pdf), source for auction families; scoped Vickrey statement is standard private-value theory, not a universal resource-allocation claim.
- Wooldridge, [chapter 15 author lecture slides](https://www.cs.ox.ac.uk/people/michael.wooldridge/pubs/imas/distrib/pdf-slides/lect15.pdf), full deck read for bargaining parameters, monotonic concession, and Zeuthen summaries.
- Wooldridge, [chapter 8 author lecture slides](https://www.cs.ox.ac.uk/people/michael.wooldridge/pubs/imas/distrib/pdf-slides/lect08.pdf), full deck read for Contract Net.
- Smith, [1980 Contract Net paper](https://cse-robotics.engr.tamu.edu/dshell/cs631/papers/smith80contract.pdf), full copy opened for historical scope/assumptions.
- Full book not accessed. Removed old utility figures, “95% accurate” bidding, optimality, and broad truthful-bidding claims.

