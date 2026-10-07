# Representation Determines Tractability: How Problem Encoding Changes Computational Complexity

## Source and discipline

The representation material is grounded in Shoham and Leyton-Brown Chapters 3–6 of the authors' [Revision 1.1 manuscript](https://www.masfoundations.org/mas.pdf). “Compact” only has meaning relative to an input encoding and a named query. A task graph becomes a strategic game only after players, actions, information, utilities, and timing are defined.

## Normal form: direct utilities, potentially large tables

A finite normal-form game gives every player an action set and a payoff for every joint action. It is ideal for checking a supplied profile: compute expected payoffs for every unilateral pure deviation. It can be expensive because the table grows with the product of action counts. Nash existence follows for finite games with mixed strategies, but existence says neither which equilibrium is desirable nor how a specific representation will be solved.

Use a normal form when the joint action table is genuinely available. Do not fabricate a table from a task hierarchy and call a component “incentive-compatible”; incentives require utilities and alternative actions.

## Extensive form: a strategy is contingent, not a path

A finite extensive-form game explicitly records move order, chance, information sets, and terminal utilities. A player's strategy specifies an action at every decision node or information set they may face, including unreached contingencies. With perfect information, backward induction processes the *given tree* from its leaves and yields a subgame-perfect equilibrium. Its linearity is in tree size.

A workflow DAG is useful evidence about precedence, but it is not automatically an extensive form. To model it as one, identify decision makers, available moves, observations, payoffs, and what counts as a terminal outcome. Only then does a backward-induction claim have a subject.

## Sequence form: perfect recall is the key condition

Sequence form represents realization probabilities and flow constraints instead of enumerating all pure contingent strategies. The compact formulation in Chapter 5 §5.2.3 relies on perfect recall: a player does not forget their own earlier information or actions. It is suitable for the stated game classes and solution questions, not a blanket method for every imperfect-information process.

Use this diagnostic before invoking it:

| Question | Evidence required |
|---|---|
| Is it extensive form? | players, tree, information sets, terminal utilities |
| Is recall perfect? | model shows remembered own actions/information |
| Which computation? | e.g., two-player zero-sum LP versus a general-sum method |
| What is output? | realization plan, equilibrium notion, certificate |

A message that arrives late does not alone establish imperfect recall. State whether the decision maker actually loses access to earlier observations or actions.

## Correlated equilibrium requires an implemented signal model

A CE is a distribution over joint actions with conditional incentive constraints. An LP can represent it for an explicit normal-form game, but the operational system must define a credible sampling and recommendation channel and the agents' modeled utilities. A public beacon can contribute entropy; it is not automatically a private recommendation mechanism, a commitment device, or an incentive guarantee.

For a Battle-of-the-Sexes payoff matrix, the half-on-each-coordinated-outcome distribution is a hand-checkable CE because following the recommended action avoids the zero mismatch payoff. That comparison does not establish higher welfare or implementability in another game. Record the distribution, signals, agents' observations, and all deviation inequalities.

## Atomic congestion: use the discrete potential

A finite unweighted atomic congestion game has resources $r$, each player's feasible resource subsets, and cost $c_r(k)$ when $k$ players use resource $r$. For profile $a$, let $n_r(a)$ be the resource load. Rosenthal's potential is

$$\Phi(a)=\sum_r\sum_{j=1}^{n_r(a)}c_r(j).$$

For a unilateral move, the potential change equals that mover's cost change. Therefore a sequence of **strictly improving unilateral** moves terminates in a finite game, because there are finitely many profiles and the potential strictly decreases under cost minimization. Simultaneous changes, tie switches, and unmodeled shared-resource costs are outside that proof.

Example: two players choose (A) or (B), with (c_A(1)=1,c_A(2)=2) and (c_B(1)=1,c_B(2)=2). At ((A,A)), a player moving to (B) reduces their cost from 2 to 1 and potential from 3 to 2. This demonstrates the potential identity, not a scheduling recommendation.

The integral $\sum_r\int_0^{x_r}c_r(z)\,dz$ belongs to a nonatomic/continuum formulation, such as selfish routing. Keep atomic and nonatomic claims separate. The Pigou (4/3) example is a bound for its named routing/cost class, not a universal “tolerable” threshold.

## Stochastic games: distinguish zero-sum and general-sum computation

A finite discounted stochastic game can be modeled with states, joint actions, transition probabilities, discount factor, and state-dependent utilities. For a two-player zero-sum game, the Shapley max–min Bellman operator has the special structure used in value-iteration arguments. A general-sum Markov-perfect equilibrium problem needs a specified equilibrium selection/operator; naive fixed-point iteration is not generally guaranteed to converge.

Write “zero-sum Shapley iteration” only after proving the payoff relation and encoding transitions. Write “general-sum equilibrium search” only with its distinct algorithm and stopping/certificate rule. Existence, a numerical fixed point, and an executable policy are separate claims.

## A representation worksheet

Before choosing an algorithm, complete:

- **Objects:** players/variables, action or domain sets, information, utilities or constraints.
- **Encoding:** table, tree, factor graph, resource list, transition kernel; include size.
- **Question:** feasibility, candidate verification, one solution, all solutions, or property search.
- **Conditions:** perfect recall, zero-sum relation, finite profile set, signal/commitment model, discounting.
- **Certificate:** constraints, deviations, potential descent, or explicit limitation.

This worksheet preserves the useful representation comparisons while preventing a generic workflow label from inheriting a game-theoretic theorem.
