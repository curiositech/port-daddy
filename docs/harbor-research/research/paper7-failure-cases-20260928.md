# Paper 7: distinguishable failure cases and audit queries

Research note, 2026-09-28. Scope: the fixed-coordinate, fixed-snapshot graph-incidence observation model in Paper 7. These are representative cases, not an exhaustive taxonomy of agent failures. Numerical evidence is synthetic. The purpose is to specify what an auditor must observe to distinguish hypotheses and where additional evidence is necessary.

## An exact diagnostic matrix

Fix the visible incidence matrix B and let P = I − BB⁺ project edge readings onto the cycle space. For a **finite library of fixed, declared signatures** s_i, observations under hypothesis i are

    O_i = {Bx + s_i + η : ||Pη|| ≤ ε}.

Vertex potentials x are unrestricted under each hypothesis, and every projected error vector in the radius-ε ball is admissible. Define

    D_ij = ||P(s_i − s_j)||.

- D_ij = 0 if and only if the two noiseless observation classes coincide. Even the full edge readings cannot distinguish these classes when vertex potentials are unknown and unrestricted.
- With the stipulated complete error balls, O_i and O_j are disjoint if and only if D_ij > 2ε. Equality has a shared midpoint.
- All members of the finite library are identifiable with zero worst-case error exactly when every off-diagonal D_ij exceeds 2ε.
- Equal scalar radii ||Ps_i|| = ||Ps_j|| do **not** imply D_ij = 0. Retaining only the scalar score may discard diagnostic information still present in the projected vector.

Proof: quotient by im B. Each observation class becomes a Euclidean ball centered at Ps_i; the statements follow from equality of centers and intersection of closed balls. Paper 8, p. 8, Theorem 8 already states conditional finite-signature identifiability and the sufficient half-margin noise rule. The complete-ball necessity here is the ball-intersection argument used in Paper 7. This note enumerates their implications and does not claim a new identification theorem. Unknown fault magnitudes, adversarial query answers, or changing graphs require explicit families of signatures and an additional analysis; a list of mode names alone is insufficient.

## Twelve cases

The oriented triangle uses rows (0,1), (1,2), (2,0). In the exact numerical rows below, D² is computed from the full projected vector, not from differences of scalar radii. Numerical readings use a zero underlying potential; generally an unaffected new receipt has zero added fault offset but its reading is bx, which need not be zero. Remeasurements bind the same snapshot and stable underlying state.

| # | Competing explanations | What the current observations establish | Evidence that can separate them |
|---|---|---|---|
| 1 | Consistency versus one nonzero edge perturbation on a visible cycle | For s=(1,0,0) on the triangle, D²=1/3. A nonzero projected vector detects inconsistency; robust distinction requires D>2ε. | Existing cycle observations suffice within the model. Signed endpoint claims are needed to tie a conflict to an author. |
| 2 | A faulty bridge reading versus a legitimate difference between vertex states | A path has no cycle constraints; for readings (1,0) versus (0,0), D²=0. | An independently justified route joining the endpoints can close a cycle. Direct conflicting sender claims may already suffice. |
| 3 | One sender splits its claims across separated neighbor groups versus a consistent assignment | On triangle 0,1,2 plus leaf 3 at sender 0, s=(1,0,−1,0) has D²=0. Deleting sender 0 leaves two touched components and one invisible split-view direction. | A receipt on (1,3) with zero added fault offset under both hypotheses yields D²=3/8. The assumption that the new receipt is unaffected by the modeled sender fault is essential. |
| 4 | Coordinated, cancelling edge offsets versus consistency | On the triangle, s=(1,−1,0) is a gradient, so D²=0 despite two altered readings. This example is stated for edge offsets; realizing it by particular senders requires the sender-to-edge map. | A trusted external anchor or independent remeasurement whose failure signature is outside the existing gradient ambiguity. Another comparison controlled by the same coalition need not help. |
| 5 | Fault on edge (0,1) versus fault on edge (1,2) | The signatures (1,0,0) and (0,1,0) have identical projected vectors. Each is detectable against consistency, but their locations are indistinguishable: D²=0. | An independently trusted remeasurement of (0,1), with zero added fault offset under both hypotheses (reading 0 in the zero-potential fixture), raises D² to 3/5. Repeating an adversarial source without an independence/trust assumption gives no such guarantee. |
| 6 | Positive versus negative fault on the same edge | (1,0,0) and (−1,0,0) have equal scalar radii but different projected vectors, with D²=4/3. | Preserve the signed projected vector. No new receipt is needed for this pair under the stated noise threshold. |
| 7 | Two different claims collapsed by the feature encoding | Two different log heads with the same log length become identical under a length-only feature. If all retained features coincide, D²=0 on every observation graph. | A feature encoding that reflects the relevant claim equality, or the raw authenticated claims. More graph cycles cannot recover discarded distinctions. |
| 8 | A legitimate update between snapshots versus equivocation within one snapshot | If snapshot or coordinate identity was omitted, the same two claim values can have either explanation. Applying the fixed-snapshot theorem to this mixture is invalid. | Authenticated snapshot/epoch identifiers, coordinate/schema identity, and a protocol rule for which claims must agree. Timing differences alone need not prove equivocation. |
| 9 | A delayed or crashed sender versus deliberate evidence suppression | At a finite observation time, an absent receipt can have all of these causes. An omitted row has no algebraic value, and fabricating a zero row changes the model. | A delivery deadline or synchrony assumption and independent delivery/availability evidence can establish a contract violation. They need not establish intent. |
| 10 | A fault versus permitted measurement error | On the triangle, the unit fault and consistency classes touch when ε=1/(2√3); a projected midpoint fits both. | A justified tighter error contract or a measurement that increases pairwise separation. Mere repetition does not reduce an adversarial error bound without additional assumptions. |
| 11 | A globally consistent but false account versus a true account | A common false potential can satisfy every edge constraint. A uniform sender shift, s=(1,0,−1), also has D²=0 and is not by itself a split view. | Ground truth tied to an external trusted reference, a task specification, or verifiable effects. Internal agreement certifies consistency only. |
| 12 | Authenticated conflicting claims versus one consistent claim | Two unequal claims signed by the same identity for the same coordinate and snapshot directly establish a claim conflict if the protocol requires equality. A cycle residual can still be zero, as in case 3. | Retain the signed claims and their context. This identifies the conflicting credential under the authentication assumptions; it does not establish human intent or prove which statement is true. |

An omitted coordinate is covered by cases 7 and 9: either the feature map discards the distinction or the corresponding measurement is absent. Forged or compromised identities concern the authentication contract in case 12, not a topological signature.

## What the next query can prove

For a fixed pair i,j, apply Paper 7's marginal formula to d=s_i−s_j and the difference z between their declared fault contributions on candidate row b. If b's endpoints are already connected, and x̂ minimizes ||d−Bx||², then

    D_ij(new)² − D_ij(old)² = (z − b x̂)² / (1 + b (BᵀB)⁺ bᵀ).

Across distinct old components the immediate increase is zero. Candidate signatures must come from the declared fault model; they are not supplied by the topology. Query cost must include acquiring and authenticating the evidence, and the model must state whether an adversary can alter the new reading.

**Complementarity prevents an automatic greedy guarantee.** Start with one zero-valued edge (0,1) and isolated vertex 2. Candidate receipts are e=(1,2) with reading 1 and f=(2,0) with reading 0. Either query alone leaves a tree and squared residual 0. Both queries close a triangle and yield squared residual 1/3. Thus the set function F of acquired receipts has F(∅)=F({e})=F({f})=0 and F({e,f})=1/3. It violates the submodular inequality F({e})+F({f})≥F({e,f})+F(∅). The same construction gives pairwise signature-separation complementarity. A policy that stops at zero immediate gain can fail despite an informative affordable query bundle. This refutes an unqualified use of the usual diminishing-returns greedy argument; it does not prove every greedy policy fails or establish the complexity of the global optimization problem.

## A bounded next research task

Build a finite library of authenticated, snapshot-bound claim-conflict scenarios with known truth and acquisition costs. Require the feature map to satisfy φ(a)=φ(b) iff a and b are equivalent under the **declared claim relation** on the admitted domain. Equality preservation alone is insufficient: a constant map preserves equality but hides every inequality. If a compressed hash is used, state the cryptographic collision assumption; do not interpret hash-bit distance as semantic severity.

Keep full raw evidence as experiment ground truth, separate from each algorithm's allowed input. Compute D for declared signatures, mark impossible pairs, and enumerate affordable query subsets on small graphs to obtain an exact oracle. Under a full-claim contract, give all methods access to the authenticated claims and include direct comparison. Under an edge-only contract, give residual and cycle-sum methods identical receipts; any permitted acquisition of raw claims has an explicit cost. State the real privacy, bandwidth, or interface constraint that makes an edge-only contract useful. Compare proposed acquisition policies with the exact oracle, random acquisition, and cost-only acquisition under the same access and costs. Report false alarms, unresolved hypothesis pairs, bytes retained, queries/cost, and effects of missingness and adversarial answers. Distinguish information lost at encoding, at edge projection, and at scalar-score compression.

The decisive falsifier is no improvement in query cost or retained evidence at the same diagnostic guarantee over these baselines. That outcome would preserve the information-boundary theorems while defeating the proposed operational advantage. A successful result would support the precise regime tested, not arbitrary agent failures.

## Reproduction

`skills/harbor-results/scripts/paper7_failure_cases.py` checks 14 synthetic records using independent NumPy least-squares solves: 11 pairwise graph fixtures, the touching-noise-ball witness, an encoding collision, and the complementary-query witness. The expected rational squared distances are specified by hand. No agent runtime, signed-receipt implementation, network experiment, or deployed diagnostic accuracy is claimed.

Sources within the repository: `docs/harbor-research/tex/paper7.tex`, sections `sec:mechanism`, `sec:robust`, and `sec:active-audit`; `docs/harbor-research/pdf/paper8.pdf`, pp. 7–8, definition of failure signatures and Theorem 8; `skills/harbor-results/scripts/sheaf_harness_v2.py`. The broader corpus reading and prioritization is recorded separately in `research/corpus-reading-20260928.md`.
