# Source model and theorem conditions

## Primary source access

This bundle was reconciled on 2026-09-24 against Shoham and Leyton-Brown, *Multiagent Systems: Algorithmic, Game-Theoretic, and Logical Foundations*, authors' [official site](https://www.masfoundations.org/) and [Revision 1.1 manuscript PDF](https://www.masfoundations.org/mas.pdf). The official site identifies the 2009 Cambridge text and describes its foundations coverage. The authors label the 532-page PDF an uncorrected manuscript with different pagination from the printed book; therefore references use chapter, section and theorem labels rather than asserted print pages.

Read source areas: Chapter 1 §§1.1–1.3 (distributed CSP and ABT); Chapters 3–5 (normal/extensive games, Nash and sequence form); Chapter 4 §§4.2 and 4.6 (Nash/CE computation); Chapter 6 §§6.1–6.4 (automata, stochastic and congestion games); Chapter 7 §§7.2 and 7.4 (fictitious play and Minimax-Q); Chapter 9 §9.4 (social choice); and Chapter 10 §§10.2–10.7 (implementation, VCG, AGV, cost sharing and constrained design).

## Reusable theorem worksheet

| Field | Write before transferring a result |
|---|---|
| objects | players/variables, finite representation, actions/domains |
| information | observations, types, information sets, recall, prior |
| objective | utilities/payments or hard constraints |
| solution | Nash, CE, subgame perfect, feasibility, BIC, DSIC, IR, balance |
| hypotheses | zero-sum, quasilinear, finite, perfect recall, delivery/fairness, credible device |
| computation | input encoding, algorithm, tolerance and termination |
| evidence | deviation inequalities, LP constraints, nogood, potential change, payment totals |
| non-model facts | identity, authorization, observation of effects, enforcement and recovery |

## Important conditions, not slogans

- A supplied explicit normal-form Nash candidate is checked by expected-payoff deviations; Chapter 4 property-search hardness is a different question.
- Sequence form needs perfect recall. Backward induction uses a finite perfect-information tree with utilities.
- A CE includes a distribution and conditional no-deviation inequalities plus a credible recommendation/signal process.
- Atomic congestion uses the discrete Rosenthal sum; finite sequential strict improvement is the termination condition.
- Arrow needs unrestricted preferences, Pareto and IIA with at least three alternatives; Myerson–Satterthwaite is bilateral Bayesian trade under its quasilinear/private-value conditions.
- VCG's DSIC/efficiency result uses welfare maximization and quasilinear private values; AGV uses Bayes–Nash rather than dominant-strategy IC.
- ABT has a finite CSP, total priority order and protocol/delivery assumptions; its priority is not authority.

## Limits

The book supports mathematical models and algorithm descriptions. It does not establish a live system's identity, authorization, physical completion, source-code compatibility, empirical performance, cost, or a policy threshold. Those claims need their own sources and evaluations.
