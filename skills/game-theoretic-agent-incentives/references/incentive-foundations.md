# Incentive Foundations

The main skill uses a concrete illustrative matrix and finite trigger calculation. This reference separates textbook definitions from product claims.

```mermaid
flowchart TD
  A[Payoff distribution and recommendation] --> B[Recipient sees signal]
  B --> C{Follow maximizes conditional expected payoff?}
  C -->|Yes for every signal and deviation| D[Correlated-equilibrium candidate]
  C -->|No| E[Revise distribution or reject claim]
```

```mermaid
flowchart LR
  A[Stage-game deviation gain] --> B[Discounted future consequence]
  B --> C{Monitoring detects deviation?}
  C -->|No| D[No trigger inference]
  C -->|Yes| E{Identity and horizon preserve consequence?}
  E -->|No| D
  E -->|Yes| F[Check strategy-specific inequality]
```

Primary and authoritative references:

- Robert Aumann, “Subjectivity and Correlation in Randomized Strategies,” [Journal of Mathematical Economics 1974](https://doi.org/10.1016/0304-4068(74)90037-8).
- Drew Fudenberg and Eric Maskin, “The Folk Theorem in Repeated Games with Discounting or with Incomplete Information,” [Econometrica 1986](https://doi.org/10.2307/1911307).

The cited papers establish results under stated mathematical assumptions. They do not show that claims are cheap talk in every protocol, that a daemon is a valid mediator, that a particular price-of-anarchy bound applies to files, or that identity persistence is implemented. No PoA theorem is cited here because no formal file-claim mapping was supplied.
