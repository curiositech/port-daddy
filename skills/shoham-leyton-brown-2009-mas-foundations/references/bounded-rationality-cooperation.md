# Bounded Rationality and the Emergence of Cooperation

## Source scope

The models here come from Shoham and Leyton-Brown Chapters 6–7 in the authors' [Revision 1.1 manuscript](https://www.masfoundations.org/mas.pdf). They are methods for explicitly modeled games and learning processes. They do not show that restricted software agents cooperate, that empirical success rates identify equilibria, or that an operational policy has learned a truthful preference.

## Repeated Prisoner's Dilemma with bounded automata

In a finitely repeated Prisoner's Dilemma with unrestricted rational players, backward induction supports defection at every stage under the usual payoff ordering. The book's bounded-rationality result instead studies a machine game: players choose finite automata and machine complexity/state bounds enter the utility/model.

For the repeated-PD result presented in Chapter 6 §6.1.3, the stated condition is
\[
2 < \max(S(M_1),S(M_2)) < k
\]
in its specific bounded-automaton construction. Under that construction, constant defection is not a symmetric equilibrium while the Tit-for-Tat automaton is. The state-bound claim belongs to that machine-game model. This does **not** mean “fewer than \(k\) states forces cooperation,” that cooperation is unique, or that limiting memory is a safe controller design.

### Constructed model-checking sequence

Before using a finite-controller analogy, write:
1. stage-game payoff matrix and horizon/discounting;
2. automaton states and complexity cost \(S(M_i)\);
3. whether each agent observes actions/history;
4. candidate automata and all one-agent deviations;
5. desired property, such as a cooperative equilibrium under this exact model.

Changing state limits may change the equilibrium set and can make computation harder. It is a hypothesis to evaluate, not a general coordination mechanism.

## Fictitious play: conditional convergence statement

Fictitious play updates each player’s empirical frequencies and plays a best response to the empirical distribution. A matching-pennies trace is a helpful example: after observed actions, update counts, normalize them, and calculate a best response to the normalized frequencies. It demonstrates the rule, not a universal convergence theorem.

The book's Theorem 7.2.4 says: **if** empirical distributions converge under fictitious play, their limits form a Nash equilibrium. It does not say play paths or empirical distributions converge in every game. Therefore an operational learner must define observations, update rule, exploration, nonstationarity policy, and a held-out evaluation; “skill success rate” alone is not a game payoff or an equilibrium certificate.

## Minimax-Q: exact zero-sum stochastic games

For a zero-sum stochastic game, Minimax-Q uses
\[
Q_{t+1}(s,a_i,a_{-i})=(1-\alpha_t)Q_t(s,a_i,a_{-i})
+\alpha_t[r_i+\gamma V_t(s')]
\]
and
\[
V_t(s)=\max_{\pi_i\in\Delta(A_i)}\min_{a_{-i}\in A_{-i}}\sum_{a_i\in A_i}\pi_i(a_i)Q_t(s,a_i,a_{-i}).
\]
The maximization is over mixed action distributions, not just pure actions. In Matching Pennies, each pure row action has worst-case payoff minus one, whereas a half/half mixture guarantees zero. Solve the state matrix game (for example, its LP), store the resulting mixed policy, and use its expected value in the update. The book's Figure 7.8 includes that policy update.

The guarantee belongs to the stated zero-sum model and the algorithm's conditions, including an appropriate observation/reward model, sufficient state-action coverage, discounting and learning-rate schedule. It concerns the game value/policy criterion, not a claim that an agent knows no information about an opponent's payoffs in every implementation.

Do not substitute “almost zero-sum” for zero-sum. If an approximation is chosen, define the approximation and measure its error against a specified general-sum baseline; Chapter 7 notes the difficulty of general-sum reinforcement-learning convergence.

## Congestion games: finite, atomic, sequential improvement

A finite atomic congestion game has resources, feasible resource subsets and costs that depend on resource load. The discrete potential is
\[
\Phi(a)=\sum_r\sum_{j=1}^{n_r(a)}c_r(j).
\]
A strictly cost-improving unilateral move strictly decreases this potential, so any sequential strict-improvement sequence terminates in a finite profile space. The theorem does not include simultaneous moves, non-improving tie changes, or arbitrary shared-resource task allocation.

### Hand-checkable potential example

Let two agents choose A or B. Let \(c_A(1)=1,c_A(2)=2\), and likewise for B. At \((A,A)\), \(\Phi=1+2=3\). One agent moves alone to B; their cost falls \(2\to1\) and \(\Phi=1+1=2\). The example proves the local potential identity for this model. It does not prove global optimality.

The Pigou traffic example is nonatomic: its integral potential and \(4/3\) linear-cost price-of-anarchy bound belong to a named continuum routing class. A policy threshold such as “accept 1.5×” is a local choice requiring an objective and validation, not a theorem.

## Computational limits are an explicit trade-off

The bounded-machine best-response result in §6.1.3 shows that imposing a state bound can change computational complexity. Do not turn this into “do not compute; always learn.” Choose between analytical computation, simulation, and learning based on the encoded model, data availability and the cost of exploration. Report the chosen model and termination/evaluation criteria.

## Transfer checklist

- Match the theorem's game class before transferring it.
- Treat state/memory charges, horizon and payoff scale as model parameters.
- Separate observed outcomes from utilities and learned frequencies from equilibrium certificates.
- Use strictly sequential improvement only where an atomic potential model is justified.
- Evaluate any operational analogue against counterfactual policies and failure costs.

This retains the useful automata, learning and potential-game methods without attributing a universal coordination guarantee to them.
