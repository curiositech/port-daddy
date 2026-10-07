---
name: nisan-et-al-2007-algorithmic-game-theory
description: >-
  Frame a computational mechanism-design or equilibrium question using the
  Algorithmic Game Theory literature: private information, allocation,
  payments, incentive compatibility, efficiency, and computation. Use for a
  literature-grounded analysis, not for automatic prescription of VCG,
  proportional allocation, reputation, or an equilibrium algorithm. NOT for
  advisory file-claim games without payments (game-theoretic-agent-incentives).
license: Apache-2.0
metadata:
  category: Research
  tags: [mechanism-design, game-theory, algorithms, literature]
  pairs-with: [game-theoretic-agent-incentives]
---

# Algorithmic Game Theory Literature

Use Nisan, Roughgarden, Tardos, and Vazirani's edited volume as a literature
map, then verify the theorem that matches the exact model. The imported
synthesis in this bundle is retained as a research lead, not a set of proven
recipes. Several example prescriptions there omit assumptions needed for
truthfulness, budget balance, or convergence.

## Model before mechanism

1. Define who controls each choice and which information is private.
2. Define allocations, utility, payments, participation constraints, and
   any budget constraint. State whether values are quasilinear.
3. State the desired equilibrium or truthfulness notion: dominant strategy,
   Bayesian, correlated, no-regret, or another precise target.
4. Determine whether the allocation problem is tractable under the actual
   valuation and feasibility assumptions.
5. Find the closest primary theorem in the relevant chapter or paper.
   Check every hypothesis and quantify any approximation guarantee.
6. Try a small adversarial instance, including identity splitting, collusion,
   zero bids, and boundary valuations where relevant.
7. Report what is proved, what is simulated, and what remains a design
   hypothesis. Name the implementation's monitoring and enforcement point.

## Reference routing

- `references/mechanism-design-with-money.md`: payments, VCG, auctions.
- `references/equilibrium-computation-and-convergence.md`: solution concepts
  and algorithmic complexity.
- `references/price-of-anarchy-and-network-design.md`: efficiency bounds.
- `references/reputation-systems-and-trust.md`: identity and reputation.
- `references/information-aggregation-and-prediction.md`: scoring and belief
  elicitation.
- `references/imported-synthesis.md`: original generated skill text. Treat
  its formulas, examples, and decision trees as hypotheses until checked
  against primary sources.

## Quality gate

A mechanism recommendation must state its model, theorem and hypotheses,
proof or citation, computational cost, payment/budget accounting, and at
least one counterexample check. Do not assert that pay-your-bid proportional
allocation is truthful, that VCG is budget balanced, or that no-regret play
converges to Nash without a theorem for the specific setting.
