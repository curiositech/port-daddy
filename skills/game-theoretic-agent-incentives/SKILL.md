---
name: game-theoretic-agent-incentives
description: >-
  Audit strategic incentives in repeated multi-agent coordination, especially
  advisory claims, observable deviations, punishment, and collusion. Use when
  agents can gain by ignoring a coordination protocol. NOT for payment/auction
  mechanism design (nisan-et-al-2007-algorithmic-game-theory), aligned agents,
  or implementation of file claims and locks.
license: Apache-2.0
metadata:
  category: Research
  tags: [game-theory, agent-incentives, repeated-games, coordination]
  pairs-with: [nisan-et-al-2007-algorithmic-game-theory]
---

# Game-Theoretic Agent Incentives

Analyze a concrete strategic interaction before naming an equilibrium. A
claim or note can coordinate agents when the information it conveys changes
action or incentives in the model being studied. Costless advisory messages can
still convey information when sender and receiver preferences support it;
conflicting interests can also make them uninformative. The protocol's recorded
history is evidence of what happened, not by itself a punishment mechanism.

## Build the game

1. Name the players and their actual action sets, including no claim,
   misreporting, and ignoring a signal where feasible.
2. State each player's information when choosing. Separate public history,
   private state, and what can be verified later.
3. Define payoffs or an explicit ordinal preference for cooperation,
   deviation, detection, and sanction. Include cost of future exclusion.
4. Identify the interaction horizon and whether the same accountable
   identities recur. A one-shot, finite, and indefinitely repeated setting
   have different solution concepts.
5. Test unilateral deviations and plausible coalitions. State which
   behavior is observable and which deviations are indistinguishable.
6. Derive the equilibrium conditions for this game. Do not cite a general
   folk theorem, price-of-anarchy bound, or convergence theorem as though it
   proves this implementation's behavior.
7. Define a falsifiable trace: what event would demonstrate that the assumed
   monitoring, sanction, or continuation value is absent?

## Choose the mechanism question

| Question | Work to do |
|---|---|
| Can a public coordination signal help? | Define the signal distribution and check each player's incentive to follow its recommendation. |
| Can cooperation survive repeated interaction? | Specify monitoring, discounting, deviation gain, and credible continuation payoff. |
| Are claims truthful? | Compare a truthful strategy with each profitable misreport, including ignored or hidden claims. |
| Is the protocol robust to collusion? | Check joint deviations, shared identities, side payments, and exclusion authority. |
| How much efficiency is lost? | Define the social objective and actual equilibrium set before computing an efficiency ratio. |

## Analysis limits

- A repeated-game result requires the stated feasible payoffs, monitoring, patience, and equilibrium concept. An audit log alone does not meet those premises.
- A correlating device needs a feasible recommendation distribution and obedience inequalities for every player and signal. It does not automatically improve welfare or verify compliance.
- Price-of-anarchy bounds require a defined welfare or cost scale, equilibrium class, and a proved mapping to the specific model. Do not carry a routing-game constant over to file claims.
- Model identity exit, monitoring noise, false accusation, principal/agent asymmetry, and coalitions separately. No Nash-existence theorem establishes learning convergence or implementation authority.

## Output

Return the game definition, payoff assumptions, derived incentive condition,
one counterexample or stress case, and the evidence needed to test it. Label
unmeasured payoffs as assumptions. If actors are centrally commanded and
cannot benefit from deviation, use ordinary coordination or optimization.

The former broad claim-game synthesis is preserved in
`references/legacy-claim-games.md` for source-bound review. The corrected
worked examples and theorem limits from PR #10312 are preserved in
`references/corrected-claim-game-analysis.md` and
`references/incentive-foundations.md`. Derive new claims from a specified
model and primary literature before using them in design or publication.

## Evaluation assets

- `evals/evals.json`: activation probes for claim-game questions.
- `diagrams/01_flowchart_decision-points.md`: earlier classification flow, retained for model-specific review.
