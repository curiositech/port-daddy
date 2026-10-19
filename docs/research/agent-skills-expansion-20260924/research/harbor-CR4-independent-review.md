# CR-4 independent counterexample review and Book disposition

2026-09-24. Review/planning only. Canonical worktree root, branch and linked gitdir verified; clean. All eight primary manuscript hashes still match manuscript-snapshot.json. Only this report and book-CR4-correction-plan/ were written. No source/bundle/manuscript changes, no canonical module import, no Harbor experiment loop, runtime or publication.

## Verdict

**The general claim that the supplied energy/cost greedy controller finds minimum-cost interventions is refuted. Its reconcile-mode beta-one round bound is also refuted.** These are concrete counterexamples, not merely missing proofs. A conditional sever-only cycle-rank bound survives the examples and has an elementary graph-incidence argument; do not discard it or silently apply it to zeroing/reconciliation. The supplied zeroing operation is not evidence of truthful, authorized repair.

The active Book does **not** repeat the CR-4 global-optimality/min-cut claim in the relevant federation section. Its detection, consistency-radius, localization and computational-cost material must not be globally retracted because a later greedy repair extension fails. The immediate correction targets are the inherited Harbor Results skill/compendium/script claims; the Book opportunity is a small negative-result exercise under its existing visibility boundary.

## Independent method and exact results

Root's NumPy/AST-extracted function result is preserved unchanged at architecture-skill-drafts/B05/validation/harbor-root-audit/CR4-COUNTEREXAMPLES.json. I independently reimplemented only the mathematical operations on the **two supplied fixtures**: rational Gaussian elimination of the normal equations for the least-squares projection, exact energy/cost selection, and a separate integer potential-propagation oracle enumerating all 32 deletion subsets. No random search, NumPy, source-module execution or full harness was used. The exact output agrees with root's numerical output and source control flow. The reimplementation does not by itself validate every branch of the original function.

Reproduction: book-CR4-correction-plan/independent-exact-check.py. Results: book-CR4-correction-plan/independent-exact-results.json. Source/Book hashes: book-CR4-correction-plan/readback-receipt.json. Edge orientation throughout is g_uv = x_u − x_v for u<v.

### A. Greedy feasible is not globally minimum cost

Edges in order: 01,02,12,13,23. Observations: (−1,−3,−3,−2,0). Positive additive deletion costs: (6,6,5,9,1).

The initial exact residual is (−1/4,1/4,−1/2,1/4,−1/4). Its squared norm is 1/2. Energy/cost ratios are respectively 1/96,1/96,1/20,1/144,1/16. Thus edge23 is uniquely selected first; no floating-point tie explains the failure.

| Choice | Removed edges | Cost | Final retained-data residual |
|---|---|---:|---:|
| Supplied greedy rule | 23, then12 | 1+5=6 | 0 |
| Exact minimum | 12 only | 5 | 0 |

After deleting23, the exact residual on remaining rows is (−1/3,1/3,−1/3,0), with squared norm1/3. The next unique maximum energy/cost selects12. But deleting12 alone permits the exact potential x=(0,1,3,3): its differences on01,02,13,23 are −1,−3,−2,0, exactly the retained observations. All 32 subsets were checked with the separate integer oracle; none cheaper than5 is consistent.

The optimal retained graph still has a cycle. Requiring a forest would overconstrain consistency: a cycle with zero circulation is allowed. Deleting12 also leaves the graph connected, so this particular optimum is not an ordinary disconnecting graph cut. This does not rule out every imaginable auxiliary-network reduction; it shows why an unspecified “minimum-weight cut across the circulation support” is not an established algorithm or proof. Do not replace it with an invented min-cut theorem.

### B. Zeroing does not obey the severing round bound

Triangle edges01,02,12; observations(2,2,1); costs(1,2,3). Its cycle rank is beta1=3−3+1=1.

| Round | Edge zeroed | Cochain after action | Exact squared residual |
|---|---|---|---:|
| Initial | — | (2,2,1) | 1/3 |
| 1 | 01 | (0,2,1) | 1/3 |
| 2 | 02 | (0,0,1) | 1/3 |
| 3 | 12 | (0,0,0) | 0 |

All three rows remain in the linear system. The eligibility mask only prevents selecting the same edge again. No edge is removed and beta1 remains1 throughout. Three rounds therefore directly violate a blanket at-most-beta1 claim for this mode. Exact arithmetic shows the first two steps make no residual progress, so numerical noise is not the explanation.

Zero disagreement is not inherently the truthful value: honest vertex potentials can differ. Without new source observations, endpoint protocol, authority and an effect receipt, setting g_e=0 is a synthetic data edit. It can alter valid measurements along with invalid ones. Reaching the zero cochain establishes consistency of the edited numbers, not repaired external history or settlement safety.

## What can still be said about sever-only termination

For an ordinary finite graph-incidence operator with Euclidean least squares, exact residual rho lies in ker(B^T), the circulation space. A bridge has rho_e=0: summing divergence over either side of its cut proves this. If rho is nonzero, a positive-energy selected edge is therefore not a bridge. Deleting it reduces m−n+components by one. After at most the initial beta1 such deletions, a forest remains and every edge cochain on that forest admits vertex potentials. Thus an **idealized sever-only rule selecting a genuinely nonzero residual edge** reaches consistency in at most beta1 deletions. Positive finite costs do not change that argument.

This is a scoped elementary reasoning check, not a certification of the floating-point implementation or arbitrary cellular sheaves. The same intuition can be checked for the stated coordinate-subset model when one physical-edge deletion removes all of its coordinate constraints: a selected coordinate-cycle edge is also on a base-graph cycle. Do not assert coordinate-wise optimization is cost-separable when one physical intervention has a shared cost across coordinates. No general sheaf claim follows: arbitrary restriction maps need not make graph bridges residual-free.

Source implementation caveats remain. solve_cohomological_repair_greedy uses floating-point least squares and an absolute energy/cost cutoff at lines252–253, independently of the residual tolerance at229. Such a stop need not mean r<TOL; the function returns no explicit completion status. Numerical residue can also disturb exact bridge-support reasoning. These are source-level boundaries, not additional executed fixtures. Costs are assumed positive/finite and input shapes/modes valid rather than checked. The loop cap is |E|, not an implementation assertion of beta1. Keep mathematical progress, implementation stopping and observation truth separate.

## Precise claim repair map (proposed, not applied)

| Surface | Current claim/location | Necessary correction |
|---|---|---|
| harbor-results/SKILL.md | :53, :116, minimum-cost/optimal-min-cut and <=beta1 | Mark energy/cost selection as a heuristic; general optimum refuted by the four-vertex fixture. Restrict any beta1 statement to the exact sever-only incidence setting; reconcile zeroing fails it. Keep CR-5 separate. |
| references/results-compendium.md | :51–55, CR-4 minimum cuts, active remediation compiler, “theorem core completed” | Replace general completion status with a tested single-cycle fixture plus counterexamples. Define objective and intervention semantics. The statement that nonlinear costs “require submodular optimization” is not established merely by their nonlinearity; require an actual function/property before naming a solver. |
| scripts/sheaf_repair_and_2complex.py | :11–18 and :198, theorem/optimizer headings | Preserve function and method for reproducibility, but label its actual heuristic and exact input/model scope. No deletion of the method to hide a failed universal claim. |
| Same script | :200–279, especially :206–208 and :260–275 | Split row deletion from observed-value zeroing in names, outputs and proposed tests. “Repaired edges” is misleading for reconcile: it records modified coordinates, not independently verified repairs. Proposed future return should expose completion/early-stop state and remaining residual. |
| Same script | :378–408, “EXACT minimal-cost bottleneck” | Preserve this positive single-cycle test as a fixture result. It does not compare against general subset optimum. On that simple one-cycle graph, circulation energy is equal across edges, making energy/cost choose the cheapest edge; that special structure is unusually favorable. |
| Same script | :425–437, off-support mutant | The code does not check that chosen index5 has zero initial residual. Its assertion abs(new_r−init_r)>threshold also does not assert new_r>0. Keep the experiment but narrow its claim to the checked inequality until its stated premises/postcondition are actually tested. |
| Same script | :453, “CR-4 & CR-5 CERTIFIED” | A passing finite suite does not certify the refuted universal CR-4 statement. Keep per-fixture measured outcomes distinct from theorem status. |
| references/l3-tacit-lessons.md | :12–19, data-versus-sheaf and bridge lesson | Preserve the existing lesson. Add, in a future authorized edit, that an alarm reduction obtained by removing constraints is not evidence of world repair; a successful special-case heuristic run is not a global optimum certificate. |

The primary script hash is 73b29e95eb57e54657ff38bd4c3f36bfd5706b3551cf0ed1ab013e77bc5fbe44, matching root's receipt. This review read the whole CR4/CR5 script and the relevant original compendium/tacit lesson. It preserves all R6 methods: mechanism proof, three-tier harness, consistency-radius/localization/cost work, repair heuristic, simplicial Hodge decomposition and legibility-ratio experiments. It neither reran nor certified CR-1/2/3 or CR-5. Their independent assumptions and source claims need their own reviews; failure of the repair claim is not blanket falsification of R6.

## Actual Book comparison and exact placement

Active source: website-v2/public/whitepaper/federated-harbor-whitepaper.tex, SHA2564e770b7839cec82fa3be1f34d2405c0bf4beffe397d1c9079be9ec060e99e1a8. The relevant live passages were read, not inferred from headings:

- :534–557 defines the model, three visibility tiers and completion residual, and explicitly says zero is not an all-clear.
- :559–584 retains the scoped synthetic detection harness; :610–617 already constructs a zero-residual alibi by darkening a ring edge.
- :698–708 states computational cost of evaluating the residual, **not** minimum-cost intervention selection. The word “Cost” must not be misread as the missing repair theorem.
- :727–735 proposes operational use/direct reconciliation, without an energy-greedy optimum claim. This is the appropriate place for a future boundary pointer distinguishing alarm telemetry from an intervention optimizer; do not insert a false assertion that the Book claimed the refuted theorem.
- :737–755 already states zero is not safety, severing darkens a loop, and measurements require thresholds. :757 explicitly denies transferring a continuous-time sheaf diffusion rate to adversarial signed-log gossip.
- :1198–1205 already has a coalition-cancellation exercise. A **new small Trace exercise in the same sheaf exercise group**, after :1205 and before the formal-model group at:1207, could ask readers to compute the greedy ratios, verify the cheaper potential, then distinguish “consistent retained data” from “truth repaired.” Keep the zeroing triangle as a second part or solution counterexample.

Reader question: does making the residual disappear prove the selected repair was cheapest, or that the evidence became truthful? The two fixtures answer both without a new chapter section. This would be a correction/teaching application of elementary projection and graph cycle facts, not a new scientific result. No external competitor/absence claim is needed; no new source theorem is imported.

**Figure decision: no additional port.** The exact score and action tables above fully expose the counterexamples; a new graph would duplicate the Book's existing cycle/visibility geometry while making five costs and five observations harder to read. Preserve the existing accepted figures. If the exercise is integrated later, the natural artifact is a compact table with a hand-checkable potential, not another generic network picture. This is an editorial recommendation now, not a permission deferral or unfinished authorized port.

## Bounded future validation obligation

Retain the old single-cycle positive fixture and add these two negatives. For minimum-cost claims, compare tiny-instance heuristics against exact subset search under the same intervention semantics and cost function. For sever termination, separately test graph-incidence bridges/cycles and report early termination rather than silent success. For genuine reconciliation, first define what verified observation replaces g_e, who may change it, and what operational harm/coverage is retained; arbitrary zeroing is not an acceptable substitute. No large sweep or live Harbor execution is needed to establish the present refutations. An approximation factor, general cut reduction, and field benefit remain unproved; none is invented here.
