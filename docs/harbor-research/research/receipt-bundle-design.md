# Costed receipt bundles for specified Paper 7 failures

Research note, 2026-09-28. This is an exact enumeration of small **synthetic** acquisition contracts, not a signed-receipt implementation, a sampled incident distribution, or a one-to-one taxonomy of agent failures. It applies Paper 7's edge-receipt formula and Paper 8's finite-signature separation criterion to a fixed library of declared interventions. Every fixture has three vertices, at most three admitted candidate packets, and budgets 1–3; the checker enumerates every affordable subset.

## Observation and admission contract

One work item, coordinate, feature schema, and snapshot watermark are fixed before selection. Each base edge packet has an oriented endpoint pair and one declared offset under each hypothesis. Acquired edge packets add independently sourced rows to the *same* coordinate and snapshot. Under hypothesis $i$, the observed edge vector is $B_Sx+s_{i,S}+\eta$, where the vertex state $x$ is unrestricted and may differ between hypotheses. A raw packet, when offered, is a directly comparable authenticated claim feature outside $\operatorname{im}B_S$. Its declared scalar offset is concatenated with the projected edge vector in a preregistered Euclidean metric. These offsets are assumptions of the fixture, not predictions learned from the answer to a query.

An acquisition price is a positive integer covering request, delivery, retention, and validation of one packet. Base packets are sunk and free in the optimization. Every method sees the same base, admitted candidates, costs, signatures, and budget. A packet without disclosure authority or availability is excluded before optimization. Packet `evidence_id` and source distinguish an independent remeasurement from a copy: a repeated ID contributes exactly one row, even if copied twice. This model assumes the listed packet signatures and raw comparison are trustworthy under the named interventions. It does not verify signatures, provenance, independence, or the underlying truth.

For each pair $i,j$, let $d=s_i-s_j$ on the chosen edge rows and let $r$ be the corresponding raw-packet difference. The score uses the **full vector**, with

$$
D_{ij}(S)^2=\min_x\|d-B_Sx\|_2^2+\|r\|_2^2.
$$

The noise contract admits **every** error in the combined projected space with Euclidean norm at most $\epsilon=0.1$, under either hypothesis. Thus two complete closed error balls are disjoint exactly when $D_{ij}>0.2$, or $D_{ij}^2>0.04$. Equality is unresolved. This is a worst-case deterministic contract; it is neither an independent per-packet noise model nor a probability distribution. If the permissible total error radius grows with each new packet, the monotonic-margin statement below needs to be re-evaluated.

At a fixed budget, the exact oracle maximizes (1) the number of robustly separated pairs, then (2) the minimum pairwise squared distance; it then chooses least spend and lexicographic packet names. This is a design score, not a failure probability. The script rounds squared distances to 12 decimal places after independent least-squares and orthonormal-cycle calculations agree to $10^{-10}$; numerical dust below $10^{-12}$ is zero. All decision gaps in these fixtures are much larger than that tolerance.

## Frozen packet libraries

All unlisted offsets are zero. A slash separates hypothesis values. The signatures remain the same across every acquired subset and budget.

| Fixture and labels | Base edge packets | Admitted candidate packets, price and signature | Exclusion or diagnostic purpose |
|---|---|---|---|
| `triangle_zero_gain`: consistent / declared fault | `base01`: 01, 0/0 | `a12`: 12, 0/1, cost 1; `b20`: 20, 0/0, cost 2 | Either candidate alone leaves a tree. Together they close a triangle. |
| `triangle_decoy`: same labels and base | `base01`: 01, 0/0 | `a12`, `b20` as above; `c01`: independent 01, 0/(1/4), cost 1 | `c01` gives a small immediate signal but no robust separation. |
| `location`: fault01 / fault12 / honest | `base01`: 01, 1/0/0; `base12`: 12, 0/1/0; `base20`: 20, 0/0/0 | `independent01`: separately sourced 01, 0/0/0, cost 1; `raw01`: direct signed-claim feature 1/0/0, cost 1 | `independent01_copy` has the same ID and source as `independent01`. `forbidden_oracle` lacks authority; `offline_oracle` is unavailable. All three are excluded. |
| `coherent_false_account`: true / false coherent | `base01`: 01, 0/1; `base12`: 12, 0/0; `base20`: 20, 0/−1 | `another_consistent01`: 01, 0/1, cost 1; `external_anchor`: direct trusted truth feature 0/1, cost 2 | Every internal edge report remains a gradient. The anchor's truth authority is an external premise. |
| `head_length_collision`: head A / head B | `base01`: 01, 0/0 | `more_length12`: 12, 0/0, cost 1; `more_length20`: 20, 0/0, cost 1; `signed_head_inequality`: direct exact-head comparison 0/1, cost 2 | Both distinct heads have the same length. The length-only feature discards the distinction before projection. |
| `opposite_sign_same_scalar`: +01 / −01 | `base01`: 01, 1/−1; `base12`: 12, 0/0; `base20`: 20, 0/0 | none | Both individual projected residual norms are $1/\sqrt3$, but their vectors differ and pairwise $D^2=4/3$. |

The triangle values reproduce the Paper 7 witness: `base01=0`, `a12=1`, `b20=0` under the fault. `a12` and `b20` individually have $D^2=0$, jointly $D^2=1/3$. In the decoy fixture, `c01` alone has $D^2=1/32$, below the robust threshold $0.04$. The two culprit locations in `location` have the same base projected vector, so their pairwise $D^2=0$, although each differs from honest by $1/3$. A trusted remeasurement or the equally priced direct signed-claim packet separates all three pairs at budget 1. The edge option obtains a larger minimum $D^2$ in this chosen metric ($0.4$ versus $1/3$ for `raw01`), but neither provides more identified pairs. This fixture does not support a topological detection advantage.

## Exact acquisition results

`cost_ranked` takes affordable packets in ascending `(cost,name)` order. `one_step` repeatedly chooses the greatest increase per cost in the stated lexicographic score and **stops when every immediate gain is zero**. `two_step` scores every feasible one- or two-packet continuation, executes the first packet of the best plan, then replans; it stops at zero best gain. Ties use least plan cost then names. These are deterministic policies, not claimed approximations. `random` enumerates every permutation of admitted packets uniformly, acquiring each in that order if it fits; the table gives its exact expected number of robustly separated pairs. No policy receives an unpriced raw-claim channel.

| Fixture | Budget | Exact bundle and separated pairs | Cost ranked | One step | Two step | Random expected separated pairs |
|---|---:|---|---|---|---|---:|
| triangle zero gain | 3 | `a12,b20`, 1 | `a12,b20`, 1 | empty, 0 | `a12,b20`, 1 | 1 |
| triangle decoy | 1 | `c01`, 0 | `a12`, 0 | `c01`, 0 | `c01`, 0 | 0 |
| triangle decoy | 3 | `a12,b20`, 1 | `a12,c01`, 0 | `c01`, 0 | `a12,b20`, 1 | 1/3 |
| location | 1 | `independent01`, 3 | `independent01`, 3 | `independent01`, 3 | `independent01`, 3 | 3 |
| coherent false account | 2 | `external_anchor`, 1 | `another_consistent01`, 0 | `external_anchor`, 1 | `external_anchor`, 1 | 1/2 |
| head length collision | 2 | `signed_head_inequality`, 1 | two length packets, 0 | `signed_head_inequality`, 1 | `signed_head_inequality`, 1 | 1/3 |
| opposite sign same scalar | 1 | empty, 1 | empty, 1 | empty, 1 | empty, 1 | 1 |

The JSON output includes **all 18** fixture-budget rows, all affordable-subset counts, exact tie counts, packet costs, minimum squared distances, and full random-order distributions. The largest subset enumeration has seven affordable bundles. The zero-gain stop is a concrete counterexample: budget 3 can buy `a12,b20`, but one-step stops before buying either. In `triangle_decoy`, an immediate gain of $1/32$ draws one-step to `c01`; the remaining budget cannot buy both cycle-closing packets. At budget 3 the exact random policy separates the pair in two of six orders. Two-step succeeds in these fixtures, with no general optimality claim.

## Equal-information checks and a bounded cycle certificate

On edge-only packets, an exact oriented cycle-sum checker and least-squares feasibility have the same noiseless zero/nonzero result: $d\notin\operatorname{im}B_S$ exactly when some oriented cycle sum is nonzero. The script computes each squared distance two ways, by independent least squares and by an orthonormal basis of $\ker B_S^\top$; it asserts agreement. The norm is a geometric margin in the declared metric, while the cycle sum is an equally informed feasibility baseline. A direct signed-claim checker uses `raw01` or `signed_head_inequality` only when that priced packet is in the common candidate set. In `location`, direct claim inspection already resolves the culprit pair at the same price. If all original endpoint claims were already held, direct comparison would be a zero-extra-cost baseline and edge projection could not claim added detection.

There is a useful **restricted exact characterization** for one initially indistinguishable pair and edge-only candidates. Suppose the base difference $d_0=B_0x_0$. Contract each connected component of the base graph. Give candidate edge $e$ the oriented gain $g_e=d_e-b_ex_0$; an edge inside a base component becomes a loop, and parallel candidate edges remain distinct. A selected candidate set separates the pair noiselessly if and only if it contains a cycle with nonzero oriented gain sum. Consequently, with positive additive packet prices, the cheapest separating bundle is the cheapest unbalanced simple cycle, including loops and parallel two-edge cycles.

To see this, the selected pair remains indistinguishable exactly when its gains are vertex-potential differences on the contracted multigraph. Such a potential exists exactly when every closed-walk gain sum is zero. An inconsistent closed walk contains an unbalanced simple cycle. Removing packets outside that cycle cannot increase its price. The assertion is the additive [gain-graph balance criterion](https://arxiv.org/abs/math/0210052) applied to this acquisition model, not a new general theorem or a polynomial-time algorithm. The script enumerates contracted simple cycles and cross-checks their cheapest price against all subsets: `triangle_zero_gain` has one unbalanced simple cycle costing 3; `triangle_decoy` has two, with the cheapest noiseless loop `c01` costing 1. The latter is still too weak for the declared robust margin, so cheapest noiseless cycle is **not** cheapest robust separating bundle. The characterization does not cover multiple-pair coverage, raw packets, correlated candidate measurements, varying source trust, or a changing hypothesis library.

For a fixed library, independent added rows and a fixed total error radius make every $D_{ij}^2$ nondecreasing: the new least-squares objective is the old sum of squares plus nonnegative new terms, minimized over the same nuisance potentials. This does **not** make the score submodular. The triangle gives $F(\varnothing)=F(\{a\})=F(\{b\})=0$ and $F(\{a,b\})=1/3$, violating diminishing returns. A cheap greedy approximation bound would need a separate proof for the actual objective and contract.

## Decision boundary and reproduction

This benchmark supports spending on complementary packets when the frozen signatures and independent-source premise are credible. It does not show deployed advantage, semantic truth, source honesty, or a universal selector. Coherent falsehood remains invisible to internal compatibility; length-only encoding cannot be repaired by adding length-only edges; copied, unavailable, or unauthorized packets add no lawful independent measurement. An external truth oracle and cryptographically verified, snapshot-bound independent receipts are prerequisites for a field claim. Changing the hypothesis library as packets arrive changes the optimization problem.

If matched direct claim inspection or exact cycle sums achieve the same diagnostic guarantee with no greater acquisition and retention cost, the simpler checker wins. The relevant next test is a grounded packet corpus with measured prices, independently adjudicated interventions, validated feature equality, and missingness/adversarial-answer rules. The exact small graph is a falsifiable design check, not evidence that a topological selector saves cost in practice. Costed noisy Bayesian test selection, including nonuniform costs and correlated noise, is already studied by [Golovin, Krause, and Ray's EC² paper](https://arxiv.org/abs/1010.3091); this deterministic complete-ball objective does not inherit their adaptive guarantee.

From the repository root, run the import-safe checker with NumPy installed:

```sh
python3 -B skills/harbor-results/scripts/receipt_bundle_design.py
```

It writes JSON only to stdout and asserts the stated witnesses. The numerical source of truth is the script's fixed packet library; no random sampling, paid model, Port Daddy runtime, network service, or generated artifact is required. Source context: Paper 7 `tex/paper7.tex` §“Sharp robustness under bounded error” and §“The value of one more receipt”; Paper 8 `tex/paper8.tex` finite-signature and added-packet results; `research/paper7-failure-cases-20260928.md`; and `research/corpus-reading-20260928.md`.
