# Mechanism Design in Constrained Reality: When Designers Cannot Control Strategy Spaces

## Source and boundary

Chapter 10 §10.7 of Shoham and Leyton-Brown's [Revision 1.1 manuscript](https://www.masfoundations.org/mas.pdf) studies constrained mechanism design. Its contracts, bribes and mediators are useful because they change a precisely stated game. A log records events written to it; it does not by itself make an external task outcome observable, truthful, or enforceable.

## Contracts: commitment needs observability and credible enforcement

A contract can remove or alter strategies when parties can observe the relevant deviation/outcome, commit to the contract, and expect the designated enforcement to occur. For an operational analogue, specify:
- the report/action covered;
- who observes which outcome;
- how a disputed observation is resolved;
- the payment/penalty and collection authority;
- the failure, appeal and timeout behavior.

A signed receipt can attest a signed statement. It does not prove that a physical action happened or that a task result was correct unless a verifier with suitable authority produces that observation.

## Bribes: an outcome-contingent payoff transformation

The constrained-design example modifies a player's payoff through a transfer conditioned on a specified outcome. If the original payoff for outcome \(o\) is \(u_i(o)\), an agreed transfer changes the relevant payoff according to the contract's fee/side-payment rule. The technique is informative only when the payer can commit, the recipient can verify the condition, and transfers are feasible. Calling the transfer “zero cost” omits funding, enforcement and participation.

Worked design question: list the original strategy profile/payoffs, the transfer trigger, changed payoffs, and deviations before/after. Then separately decide whether the trigger is observable. The latter is a systems fact, not supplied by the payoff algebra.

### Worked payoff change from §10.7.2

The source's two-agent service-choice example has the following payoff pairs. Rows are agent 1's action; columns are agent 2's. The second table adds a credible transfer of 10 to agent 1 at (f,f), and to agent 2 at (s,s).

| Original game | agent 2: f | agent 2: s |
|---|---|---|
| agent 1: f | (3,3) | (6,4) |
| agent 1: s | (4,6) | (2,2) |

| With promised transfers | agent 2: f | agent 2: s |
|---|---|---|
| agent 1: f | (13,3) | (6,4) |
| agent 1: s | (4,6) | (2,12) |

Check both opponent actions: for agent 1, f gives 13 rather than 4, or 6 rather than 2. For agent 2, s gives 4 rather than 3, or 12 rather than 6. Thus f and s are strictly dominant in the transformed game. At (f,s), neither transfer is triggered, so the equilibrium payment is zero. Off-equilibrium liabilities remain real and require a funded, credible commitment. This is a fully specified payoff example, not a guarantee that promising arbitrary rewards makes a real system cooperate.

## Mediators: commitment changes strategy form

A mediator can solicit information or actions and return recommendations/outcomes. The source example relies on a reliable, credible center and on agents that commit, by accepting mediation, to forgo independent action in the specified setting. A random coordinator without commitment is not automatically a mediator in this sense.

For a practical mediator, record identity/authority, protocol messages, recommendation visibility, opt-in/opt-out timing, data boundaries, enforcement, and recovery on mediator failure. These details also determine whether a correlated-equilibrium interpretation is available.

### Worked mediator extension from §10.7.3

Start with a two-action Prisoner's Dilemma: (C,C) pays (4,4), (C,D) pays (0,6), (D,C) pays (6,0), and (D,D) pays (1,1). Add action M: a party choosing M irrevocably delegates this modeled move; the reliable mediator plays C if both choose M and D for its sole client otherwise. The resulting three-action game is:

| row / column | M | C | D |
|---|---|---|---|
| M | (4,4) | (6,0) | (1,1) |
| C | (0,6) | (4,4) | (0,6) |
| D | (1,1) | (6,0) | (1,1) |

Against M, a unilateral switch to C or D reduces the deviator's payoff to 0 or 1. A joint deviation cannot strictly improve both payoffs beyond 4. Therefore (M,M) is a strong equilibrium in this two-player extension. A recommendation that agents may freely ignore would define a different game; the binding delegation is essential.

## Feasibility and incentives are separate axes

A distributed CSP can determine which allocations satisfy hard constraints. Mechanism design asks whether strategic agents prefer truthful reports/actions under a utility/payment model. A system may need both: first enumerate feasible allocations, then analyze incentive compatibility among them. Neither model replaces authentication, authorization, or execution verification.

## Scheduling with verified execution times

For the compensation-and-penalty setting in §10.6.1, let $t_{ij}$ be agent $i$'s minimum time for task $j$, $\hat t_{ij}$ its report, and $\tilde t_{ij}\ge t_{ij}$ the observed execution time. Each task has one assignee, encoded by $x_{ij}\in\{0,1\}$. Choose an allocation minimizing reported makespan. Define $L_i=\sum_jx_{ij}\tilde t_{ij}$ and $\hat L_k=\sum_jx_{kj}\hat t_{kj}$. With zero report-independent offset, the charge paid by agent $i$ is

$$p_i=-L_i+\max\{L_i,\max_{k\ne i}\hat L_k\}.$$

Its time cost plus charge gives utility $-L_i-p_i=-\max\{L_i,\max_{k\ne i}\hat L_k\}$. This cancellation explains the incentive calculation: slowing down cannot improve that utility, and reporting the true processing times permits the allocation rule to minimize the relevant objective, holding the other reports fixed. These are weak preferences; truth need not be the unique best response. The argument needs trustworthy timing, feasible minimum times, the specified utility, and the exact allocation rule. A transcript alone does not verify execution duration. Arbitrarily substituting a heuristic allocation algorithm does not preserve the theorem.

A separate offset $h_i(\hat t_{-i})$ adds to the charge and subtracts from utility under this sign convention. Individual rationality must be checked against the outside option; the zero-offset rule above does not promise it. The Revision 1.1 discussion's positive-offset participation prescription is inconsistent with its printed charge/utility signs, so do not import it without resolving that convention. For a small implementation check, enumerate allocations and unilateral reports, then compare utilities using *actual* own times and others' reports. Exact makespan optimization is computationally hard in general; finite enumeration is only a teaching fixture.

## Bandwidth bids: price taking and strategic response differ

For a single divisible link of capacity $C>0$, suppose bids $w_i\ge0$ have positive total. Set $\mu=(\sum_iw_i)/C$, allocate $d_i=w_i/\mu$, and charge $w_i$. Agent $i$ then values $v_i(d_i)-w_i$. Declare an explicit zero-total rule; the positive-total formula has a zero denominator otherwise. It exhausts capacity algebraically, but does not by itself establish efficiency.

The source's price-taking calculation treats $\mu$ as fixed while a user optimizes. In the strategic bidding game, the user's own bid changes $\mu$. A useful diagnostic is therefore to compute the derivative under both assumptions before importing an equilibrium claim. For example, two linear valuations $v_1(d)=v_2(d)=d$ with $C=1$ have symmetric bids $1/4$: each receives $1/2$ and has utility $1/4$. Holding the other bid at $1/4$, changing one's bid to $1/2$ yields utility $1/6$, not $1/4$. This is a deliberately small calculation, not an empirical congestion result.

Theorem 10.6.4's three-quarter welfare comparison belongs to this particular single-link model, with at least two users, the section's continuous, concave, strictly increasing valuations and differentiability conditions, and $v_i(0)\ge0$. It compares valuation welfare at Nash and competitive allocations. It is not a latency, reliability, convergence-speed, or arbitrary-network guarantee. Check the complete hypotheses before reusing the bound.

## Multicast cost sharing: two distinct procedures

Specify the routing tree, edge costs, participant valuations, and who faithfully executes the protocol. The source's distributed methods assume compliant infrastructure. A cryptographic message signature does not supply that assumption.

**Iterative equal shares on a fixed tree.** Begin with all requesting users. For each used edge, split its cost equally among the retained users whose source path uses it. Each user's total charge is the sum along its path. Remove a user whose reported value is below that charge, recompute shares, and repeat until no removal is needed. An empty set incurs no shared cost. Shares can increase after a removal, so a single pass is insufficient. The fixed-tree construction gives the relevant cross-monotone cost shares; arbitrary routing changes require a separate proof. A shared edge costing 6 and two leaf edges costing 1 each give two users an initial charge of 4 each. If their values are 8 and 3, the second leaves, and the first's recomputed charge becomes 7. This is the budget-balancing cost-share method, not the efficient VCG method.

**Efficient allocation with tree VCG payments.** For node $i$, let $c_i$ be its incoming edge cost and $\hat v_i$ its reported value; give the root a zero incoming cost. On an upward traversal calculate

$$m_i=\hat v_i-c_i+\sum_{j\in\operatorname{children}(i)}\max(m_j,0).$$

Set $s_{\mathrm{root}}=m_{\mathrm{root}}$. Traverse downward, assigning each child $j$ the value $s_j=\min(s_i,m_j)$. Connect nodes with $s_i\ge0$; for a connected node charge $p_i=\max(\hat v_i-s_i,0)$, and charge disconnected nodes zero. Negative ancestor values propagate downward, preventing a disconnected subtree from treating its own local surplus as permission to connect. These messages convey different quantities: $m_i$ is a subtree's conditional marginal value; $s_i$ accounts for ancestors' constraints.

For a zero-value root with two direct leaves, costs 2 and 3, and values 5 and 1, the upward values are 3 and −2 and the root value is 3. The downward values are 3 and −2: connect the first leaf and charge 2; exclude the second. Compare small fixtures with exhaustive welfare maximization and the VCG externality formula. The source's two-values-per-link result counts mathematical real values under its tree model. It gives neither a bounded bit complexity nor a resilient network transport protocol, and does not promise recovery of total cost.

## Stable matching: a narrow truthful mechanism result

Student-proposing deferred acceptance has a dominant-strategy result for students under the relevant strict preferences, feasibility and advisor-side assumptions, including the model in which advisors are compelled to report honestly. It does not establish that task queues reveal capabilities truthfully or that arbitrary registry matching is stable. To reuse it, define two sides, preferences, quotas, proposal order, ties/unacceptability handling, and which side has the strategyproofness claim.

### Deferred acceptance procedure and stable-outcome check

For a finite one-to-one matching with strict preferences and an unmatched option, keep a queue of free proposers and a record of whom each has already approached. A proposer applies to its highest-ranked acceptable receiver not yet approached. Each receiver tentatively retains its preferred acceptable proposal among its current match and new proposals, rejecting the others. Rejected proposers continue; stop when no unmatched proposer has an untried acceptable receiver. Tentative acceptance is not a final assignment before termination. Each ordered proposal pair is tried at most once, so the finite procedure terminates.

Independently check stability: no unmatched acceptable pair may prefer one another to their assigned partners, and no participant may prefer remaining unmatched. With students s1: a1 before a2, s2: a2 before a1, and advisors a1: s2 before s1, a2: s1 before s2, both pairings are stable. Student proposals choose (s1,a1),(s2,a2); advisor proposals choose the other pairing. This shows that the proposing side changes outcome selection even with identical inputs. Ties, capacities, couples, changing preferences and strategic reporting need separately specified variants; the one-to-one fixture does not cover them.

## Practical constrained-design worksheet

| Layer | Required statement |
|---|---|
| model | agents, types, actions, utilities and outcome rule |
| constraint | what behavior is removed or committed |
| evidence | who observes the triggering fact and how |
| enforcement | payment/penalty authority and failure handling |
| computation | allocation/payment algorithm and encoded input |
| evaluation | deviation test plus outcome/participation measures |

Use the table to preserve the contracts/bribes/mediators workflow without claiming that a technical log or a coordination graph itself supplies the missing strategic conditions.
