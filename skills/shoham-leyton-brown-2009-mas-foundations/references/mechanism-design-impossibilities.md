# Impossibility Results and What They Teach About Coordination

## Source and use

This reference relies on Chapter 9 §9.4 and Chapter 10 §§10.2–10.6 of Shoham and Leyton-Brown's [Revision 1.1 manuscript](https://www.masfoundations.org/mas.pdf). An impossibility theorem identifies a model boundary. It does not prove that every product design fails, and an escape must say which hypothesis it changes.

## Arrow: a social welfare theorem with named axioms

For a finite electorate and at least three alternatives, Arrow's theorem concerns a social welfare function over unrestricted preference profiles. Pareto efficiency and independence of irrelevant alternatives imply dictatorship (Chapter 9, Theorem 9.4.4). The useful design exercise is to write the alternative set, preference domain, and whether the output is a ranking or a selected alternative.

A plurality election can fail to choose a Condorcet winner; that is a Condorcet-efficiency observation, not a proof that plurality violates Pareto/unanimity. Approval voting or cardinal reports change the report/preference model, so they may relax a hypothesis rather than refute Arrow under the same axioms.

## Gibbard–Satterthwaite: strategyproofness has scope

The deterministic result applies with at least three alternatives in the choice range, unrestricted ordinal preferences, an onto/citizen-sovereignty condition, and dominant-strategy truthfulness. Under those hypotheses, the social choice function is dictatorial. A Bayesian mechanism can have different implementation properties only after a prior, a mechanism and a Bayes–Nash incentive condition are specified. “Use Bayesian incentives” is not an unqualified escape.

## Myerson–Satterthwaite and the AGV trade

For the standard bilateral-trade impossibility, specify one indivisible object, one seller and one buyer, independent private valuations with continuous positive densities on intervals whose interiors overlap, risk-neutral/quasilinear utility, and participation after each party learns its own type. With no outside subsidy, Bayesian incentive compatibility and interim individual rationality cannot coexist with ex-post efficient trade for every valuation pair. These support conditions matter; this is not a claim about every Bayesian trade instance. The [original Myerson–Satterthwaite paper](https://www.cs.princeton.edu/courses/archive/spr10/cos444/papers/myerson_satterthwaite83.pdf), §2 and Corollary 1, states the model and support condition; root inspected those bodies on 2026-09-24.

As an explicit boundary case from the same corollary discussion, let the seller's possible values be 1 or 4 and buyer's be 0 or 3. A fixed price of 2, with voluntary acceptance on both sides, trades exactly at seller 1/buyer 3 and is efficient on these four pairs. These discrete supports violate the positive-density hypothesis. A theorem checklist should expose that distinction before declaring a design impossible.

The AGV construction illustrates a precise exchange: it achieves Bayes–Nash incentive compatibility and budget balance under its conditions, but does not retain dominant-strategy truthfulness or ex-interim IR; its guarantee is ex-ante IR. A mechanism record must name timing, prior, utility transferability, IR notion and balance convention.

### Small timing comparison

A buyer with value (v) and seller cost (c) may trade only if a mechanism says who reports first, when transfer occurs, and what happens after a report. “Trade iff reported buyer value is at least reported seller cost” describes an allocation rule, not BIC, DSIC, balance, or IR. Test each property against the described report game.

## Roberts: alternatives, not agents

Roberts' theorem characterizes deterministic social choice functions implementable in dominant strategies as affine maximizers under general quasilinear preferences when at least three alternatives are in the choice range (with the theorem's remaining domain conditions). The “three” condition is about alternatives, not the number of agents. It is a classification result for a specific preference domain; it does not say every practical scorer must be affine.

## VCG is a conditional construction

A Groves/VCG mechanism combines an allocation maximizing reported social welfare with a payment rule. Dominant-strategy truthfulness and efficiency require the quasilinear private-value model, correct welfare maximization, and computational feasibility of that allocation. Budget behavior is setting-dependent: VCG can run a surplus or a deficit; weak balance appears only under additional conditions in the book. Do not label VCG a default, a guaranteed surplus, or a replacement for a balance analysis.

Use this checklist:

1. What are types, reports, allocation, and payments?
2. Are utilities quasilinear and is welfare maximization exact?
3. Can allocation and payments be computed and audited?
4. Which balance and IR condition is actually evaluated?
5. Does execution/verification match the modeled outcome?

## Cost sharing and posted prices

The multicast cost-sharing discussion is Chapter 10 §10.6.3, not Theorem 10.4.11 (which belongs to a different simple-exchange result). Preserve the trade-off only with its own construction and hypotheses; do not transplant a theorem number.

A posted price can be strategyproof in common take-it-or-leave-it single-parameter settings because an agent chooses accept/reject at a fixed price. Its efficiency depends on price, type distribution, feasibility and objective. It is neither a generic proof of efficiency nor a generic truthfulness failure.

## Revelation and computation

The revelation principle supports direct mechanisms under its stated implementation conditions; it does not remove outcome verification, payment collection, computational hardness, or participation constraints. For explicit normal-form games, checking a supplied Nash profile is direct by deviation inequalities. Chapter 4's NP-hard results concern property-search questions such as whether an equilibrium with specified properties exists. Keep those computational questions separate from mechanism-theoretic implementation.

## Design response: document the chosen relaxation

When a desired package is impossible, record:

| Desired property | Model hypothesis being changed | Evidence needed |
|---|---|---|
| budget balance | transfer/balance convention | payment total on all relevant profiles |
| truthfulness | DSIC or BIC plus prior | deviation calculation |
| efficiency | objective and feasibility | outcome comparison |
| individual rationality | ex-post, ex-interim or ex-ante | utility baseline |
| unrestricted preferences | restricted domain | actual domain justification |

This is a method for making a justified trade, not a universal ranking of VCG, correlated equilibrium, or any other tool.
