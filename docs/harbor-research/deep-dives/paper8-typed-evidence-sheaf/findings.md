# Findings — Paper 8, The Cohomology of Agent Evidence

## Verdict — `NARROW`

The stated linear-algebra and cohomology results are correct under the paper's declared cellular sheaf, orientations, inner products, and packet-error model. The exact four-role fixture reproduces its ranks, Hodge components, sparse support distance, and relative connecting obstruction. The prospective scientific contribution is an agent-evidence acquisition contract and a controlled operational comparison. Neither field utility nor one-to-one attribution of semantic agent failures follows from the present synthetic results.

| Question | Assessment | Evidence |
|---|---|---|
| Mathematical correctness | **Sound within the model.** The face/Hodge decomposition, face-attachment invariance, edge-group distance thresholds, and relative extension criterion follow from the cochain complex. | Exact proofs in `paper8.tex`; rational incidence maps and independent test oracles in `scripts/sheaf_2complex_study.py` and `tests/test_sheaf_2complex_study.py`. |
| Novelty | **Application and experimental design, not new sheaf theory.** Cellular sheaf cohomology, relative exactness, Hodge decomposition, and sparse-recovery distance are established. | [Curry](https://arxiv.org/abs/1303.3255), [Hansen and Ghrist](https://arxiv.org/abs/1808.01513), [Jiang et al.](https://arxiv.org/abs/0811.1067), [Zhao et al.](https://arxiv.org/abs/1803.09631). |
| Interest | **Potentially useful as an observability design discipline.** Typed stalks show exactly which role-specific features can be compared, and the connecting class states when a visible compatible section cannot extend. | The heterogeneous two-complex and its explicit obstruction witnesses. |
| Broad application | **Unproven.** Real agents must emit independent provenance-bound edge or face receipts; existing self-reported scores do not meet that contract. | The paper's acquisition and equal-information baseline requirements. |
| Presentation | **Coherent technical account.** Definitions, assumptions, proofs, fixture, and limits are explicit. The graph specialization is lengthy; readers should treat it as a baseline, not the main result. | Paper sections 2–7 and exact reproduction protocol. |

## Falsification boundary

A nonzero face syndrome proves violation of a selected typed face relation. A nonzero harmonic component proves a closed, nonexact sheaf cochain. Neither names a cause: different interventions can share an observation signature, and a jointly false compatible account lies in `im d0`. A nonzero relative connecting class rules out extension of a visible **compatible section** under the declared maps; it does not assert that unseen evidence was collected. Sheaf `H¹` can be nonzero even if the underlying simplicial space is contractible, because stalks and restriction maps matter.

Adding a face while keeping the edge observation map fixed changes the classification of the residual but cannot increase detection from those same edge packets. A separately acquired face receipt can add information, but the direct-contract comparator must receive it too. In the graph specialization, repeated endpoint-claim equality detects every cycle inconsistency when both endpoint claims are disclosed. This is the central utility control.

The minimum edge-group distance `d_F` is a precise fault-model score. It establishes detection of every error on at most `k` packets when `d_F>k`, and unique correction modulo compatible reports when `d_F>2k`. It has no one-to-one interpretation for semantic labels such as dishonesty, partition, or review error. Such a claim needs a predeclared intervention library with distinct full signatures and an independent ledger truth oracle.

## Next decisive experiment

Acquire real workflow traces for one work item, immutable PR head, schema, event-log root, and watermark. Require independently sourced, authenticated role/edge/face receipts. Predeclare stale CI, mismatched head, replayed approval, forged packet, copied packet, missing packet, and coherent false-report interventions. Compare exact direct contract checking with Hodge, relative, and sparse-error certificates on **identical available evidence**, including abstentions. Report detection, false alarms, ambiguity, explanation quality, acquisition cost, and privacy cost. A sheaf result is useful if it improves a measured outcome at the same false-alarm budget; otherwise use the direct checker.

Related multi-agent sheaf work already offers broad heterogeneous coordination models: [Hanks et al.](https://arxiv.org/abs/2504.02049). Sheaf cosystolic expansion gives a deeper local-to-global research route under explicit hypotheses: [First and Kaufman](https://arxiv.org/abs/2403.19388). A separate relative grounding construction is [Yokoyama](https://arxiv.org/abs/2601.19056). These are the proper comparison points before any novelty claim about algebraic topology.
