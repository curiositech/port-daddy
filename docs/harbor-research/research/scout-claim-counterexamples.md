# Three falsifiers for the literature scout

Date: 6 November 2026. These address the supplied scout's proposed formulations, not the cited primary authors. Reproduce with `python3 -B skills/harbor-results/scripts/scout_claim_counterexamples.py`. The examples are exact and constructed; no agent or field measurement is implied.

## D14: conserved reputation does not conserve its payoff

The scout proposes no gain from splitting when the payoff is “not superadditive over splits.” Under additive per-identity rewards this direction is reversed. Let U(x)=min(x,1). A principal holding 2 units earns 1. Transfer its balance once into two authenticated children with 0.9 units each. Total reputation falls from 2 to 1.8, yet the children's combined reward is 1.8. Conservation, lineage and discounting all hold. The false claim is already refuted by this one example.

A sufficient condition has a short proof: if U is nondecreasing, superadditive and U(0)=0, then for any nonnegative descendant balances b_i with sum b_i <= x,

    sum U(b_i) <= U(sum b_i) <= U(x).

The first inequality follows by finite induction and the second by monotonicity. For arbitrary zero-loss two-way splitting with additive alias rewards, no benefit for every split implies superadditivity by definition. That necessity is not claimed for a fixed lossy transfer rule, restricted splits, identity costs or other strategic effects. A threshold reward is not automatically a convex function.

Operational consequence: compute rewards and voting ceilings at the accountable-principal level when fragmentation must not multiply them. Changing the reward function changes the game; an additive reputation invariant alone cannot certify Sybil-proofness. Principal linkage, entry costs, coalition effects and utility semantics still need their own hypotheses.

## D8: sufficient for one decision is not equivalent for all decisions

Let the full observation identify one of four equally likely worlds. A one-bit digest identifies which of two pairs contains that world. An operator allowed to open two records achieves zero misses, so this is a valid covering for that task. But the separate task of guessing the exact world has minimum error 1/2 from the digest and zero from the full observation. Thus task-specific zero loss does not imply zero deficiency over all bounded decision losses. A proposed “zero-deficiency corner” must explicitly restrict the decision class; it cannot silently use full Blackwell equivalence.

## D29: conjunction of trace properties is not arbitrary component composition

Two reservation actors each preserve a one-unit budget when run alone. Each reads the free balance, then grants based on that observation. Four of the six legal two-actor interleavings reserve twice. Making check-and-reserve atomic removes the violation in both actor orders. This is a safety-property failure, without any confidentiality hyperproperty.

Intersections of safety properties are safety properties. That closure fact does not show independently verified components preserve their claims when composed. An assume-guarantee rule needs compatible environments, shared-state interference conditions, observation mappings and implementation atomicity. The five descriptive assurance modes do not acquire a meet law merely by being ordered.

## Evidence boundary

The script enumerates its positive-case and schedule counts at runtime. Its linear and quadratic payoff checks illustrate the sufficient condition; finite enumeration is not the general proof. The digest example uses a single uniform prior and 0-1 guessing loss, sufficient to refute all-decision equivalence. The reservation model is a minimal counterexample, not a race observed in the production kernel. Independent adversarial review remains required before these examples change manuscript statements.
