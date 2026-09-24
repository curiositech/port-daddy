# The Computational Reality of Equilibrium: When Existence Doesn't Mean Findability

## Source and model boundary

This reference uses Chapters 3–5 and §4.6 of Shoham and Leyton-Brown, *Multiagent Systems* (the authors' [Revision 1.1 manuscript](https://www.masfoundations.org/mas.pdf), 2009/2010). The manuscript is an uncorrected PDF with different pagination from the printed book; its chapter and theorem labels are the stable pointers here. Every complexity statement below names an input representation and a question. A finite-game theorem is not a deployment guarantee.

## Start by naming the question

For an explicitly represented finite normal-form game, these questions differ.

| Question | Example output | What a small fixture can do |
|---|---|---|
| Verify a supplied profile | whether the supplied profile is Nash | calculate each pure deviation's expected payoff |
| Find one equilibrium | one mixed profile | use a model-specific algorithm |
| Find all equilibria | a set/description | may require substantially different work |
| Find one with a property | e.g., welfare at least a specified value | property-existence question |

For a rational candidate mixed profile $x$, player $i$'s payoff from a pure deviation $a_i$ is

$$u_i(a_i,x_{-i})=\sum_{a_{-i}}\left(\prod_{j\ne i}x_j(a_j)\right)u_i(a_i,a_{-i}).$$

First check that each probability vector is nonnegative and sums to one. Then compare the payoff of every pure deviation with the candidate's expected payoff. The candidate is Nash exactly when no deviation improves it; equivalently, each action with positive support attains the best-response value. For explicit rational payoff tables and a rational candidate, this arithmetic is polynomial in the encoded input size. An approximate numerical check must declare its tolerance and reports an approximate certificate. This is not the NP-hard property-existence question in Chapter 4.

### Worked verification fixture

Consider the coordination game ((L,L)=(2,2)), ((R,R)=(1,1)), and off-diagonals ((0,0)). At ((L,L)), deviating to (R) changes each payoff from 2 to 0, so this *supplied* profile passes the best-response test. Asking whether the same game has an equilibrium with a specified welfare or an action excluded is a different query; Chapter 4 §4.2.4 discusses NP-hardness for several such property questions. Do not infer a run time for one question from a theorem about another.

## Two-player zero-sum: a tractable, encoded model

A two-player zero-sum matrix game has payoff matrices $A$ and $-A$. The row player's maxmin LP is

$$\max_{p,v}v\quad\text{subject to}\quad A^{\mathsf T}p\ge v\mathbf 1,\quad\mathbf 1^{\mathsf T}p=1,\quad p\ge0.$$

The column player's dual minimizes an upper bound on the row payoff. This is polynomial-time solvable for an explicitly encoded rational matrix using a suitable LP algorithm; it does not imply an encoding-free cubic runtime.

Use it when the zero-sum relation is part of the model and the matrix is available. If utilities are independently estimated, first record why they are exact negatives. “Close to zero-sum” is an approximation choice requiring its own error evaluation.

## General-sum games: LCP, pivots, and their limits

For two-player general-sum games, the book presents a linear-complementarity formulation and Lemke–Howson pivoting. The formulation is useful because complementarity expresses: an action is either unused or earns the equilibrium payoff. It is not a claim that a pivot path is short, that every equilibrium is found, or that the result is socially preferred.

Support enumeration is another procedure: choose candidate supports, solve the equal-payoff equations, then check probabilities and off-support inequalities. It is a transparent diagnostic for small games, but its combinatorial support space makes it a poor default for large games. Retain a rejected support and the inequality that rejected it; that is more useful than treating “no result” as proof of absence.

## PPAD is a classification, not an exponential lower bound

Chapter 4 §4.2.1 states a PPAD-completeness result for equilibrium computation; its footnote 3 makes the approximation qualification explicit: compute an epsilon equilibrium to specified precision. Do not turn this into an exact-arithmetic theorem for arbitrary numbers of players. Exact two-player rational equilibrium computation and approximate multiplayer formulations must be named separately when selecting a solver. PPAD-completeness is evidence that the problem is unlikely to have a polynomial-time algorithm under standard complexity beliefs. It does **not** prove an exponential lower bound, P ≠ PPAD, or a universal practical timeout. Representation can also alter the input size and available algorithms.

When documenting a solver, write the representation, number of players, solution concept, tolerance, termination condition, and whether it verifies the returned profile. “The solver returned a vector” is not a Nash certificate unless the deviation inequalities were checked.

## Sequential games and sequence form

A strategy in an extensive-form game assigns an action at every decision node or information set owned by a player, including nodes not reached on the realized path. Backward induction computes subgame-perfect equilibria for a finite perfect-information tree with specified players and utilities; its running time is linear in the tree representation, not in the implicit normal-form strategy count.

Sequence form compactly represents realization plans for suitable extensive games with **perfect recall**. It is not a general cure for imperfect recall and it does not make arbitrary general-sum equilibrium computation polynomial. Before selecting it, state the information sets, whether players remember their own actions and observations, and the solution question. A delayed observation alone is not a formal proof of imperfect recall.

## Correlated equilibrium: a recommendation system, not public randomness alone

For a normal-form game, a correlated equilibrium is a distribution (q(a)) over action profiles satisfying, for each player and recommended action, the conditional no-profitable-deviation inequalities. Its usual LP variables are (q(a)), so the model has explicit joint-action input. A correlation device must credibly sample the distribution and deliver the required recommendations; a public random bit does neither by itself.

### Worked 2×2 comparison

In Battle of the Sexes, let ((O,O)=(2,1)), ((F,F)=(1,2)), and mismatches be zero. The distribution that recommends ((O,O)) with probability (1/2) and ((F,F)) with probability (1/2) is a CE: when either player is told their action, following yields a positive payoff while switching produces a mismatch. This is an example, not a claim that CE dominates every Nash equilibrium or that a timestamp can implement the device.

Chapter 4 §4.6 gives LP-based CE computation and decision results for stated questions. Specify the objective and representation before claiming welfare optimization or polynomial complexity.

## Practical analysis record

For each actual system model, keep this short record:

1. players, actions, utilities, information and any randomization/recommendation channel;
2. finite representation and exact question: verify, find, enumerate, or property-search;
3. solution method and its model hypotheses;
4. certificate: deviation inequalities, dual conditions, or a stated non-certificate;
5. operational assumptions outside the game (authentication, effect execution, failures).

This makes a solver result reviewable without treating a textbook theorem as an authorization or reliability guarantee.
