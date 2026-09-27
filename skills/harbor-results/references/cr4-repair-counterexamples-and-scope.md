# CR-4 repair counterexamples and exact scope

## What the helper computes

For an ordinary graph-incidence matrix \(B\), supplied observation vector \(g\), and supplied positive finite costs \(w_e\), the helper first obtains a least-squares residual \(\rho=g-B\hat x\). It scores eligible rows by \(\rho_e^2/w_e\). In `sever` mode the selected row is excluded from the next residual; in `reconcile` mode its observation is replaced by zero. This is an explicit finite-input procedure, not a named optimization reduction.

The function validates row counts, finite observations, finite positive costs, tolerances, and `sever`/`reconcile` mode, edge-to-incidence binding, one-dimensional observations, and finite intermediate results. It exposes `completed`, `already-consistent`, `early-stop-zero-score`, or `round-limit`. `completed` means only the modeled residual met the supplied tolerance. The result separates `eligibleEdges` (not yet selected) from `retainedEdges` (still in the residual model); `modeledObservations` follows retained-edge order. Reconcile mode retains every edge even after zeroing it.

## Exact five-edge falsifier: feasible greedy selection costs more

Use edges \(01,02,12,13,23\), observations \((-1,-3,-3,-2,0)\), and costs \((6,6,5,9,1)\), oriented as \(g_{uv}=x_u-x_v\). The initial exact residual is \((-1/4,1/4,-1/2,1/4,-1/4)\). The energy/cost scores are \(1/96,1/96,1/20,1/144,1/16\), so edge23 is uniquely selected. The next iteration selects edge12. Greedy sever cost is \(1+5=6\).

An independent integer-potential oracle enumerates all 32 deletion subsets. Deleting only edge12 costs 5 and permits the retained observations with \(x=(0,1,3,3)\). The retained graph remains connected and cyclic, with zero circulation. Thus this fixture refutes a general minimum-cost claim and does not support calling the objective an ordinary graph cut. It does not prove that no alternative algorithm or carefully specified reduction could solve another optimization problem.

## Triangle falsifier: zeroing is not the sever bound

For triangle \(01,02,12\), observations \((2,2,1)\), and costs \((1,2,3)\), beta_1 is 1. Reconcile mode zeros rows in cost-score order 01,02,12. Its residual-squared sequence is \(1/3,1/3,1/3,0\): three actions, not one. Zeroing all coordinates makes an edited cochain consistent; it does not supply a verified replacement observation or prove anything about the external event history.

## Conditional sever-only termination lemma

For an **exact**, finite simple graph-incidence least-squares residual, \(B^T\rho=0\), so a bridge has zero residual by summing divergence across either side of its cut. If a sever rule selects a genuinely nonzero residual edge, that edge lies on a cycle. Removing it lowers (m minus n plus components) by one. At most the initial beta_1 such idealized deletions leave a forest, on which every edge cochain admits potentials. Positive finite costs affect selection but not this cycle-rank fact.

This does not transfer to floating-point stop behavior, reconcile zeroing, shared physical costs across coordinate copies, arbitrary cellular sheaves, or a global cost optimum. The helper reports its actual stop state so these cases remain observable.

## Operational gate

A residual finding is evidence telemetry. Before `sever`, name the evidence-retention/fencing policy. Before `reconcile`, record the replacement observation, endpoint protocol, authority, and effect receipt. A lower residual cannot stand in for any of them.

## Sources and reproducibility scope

- Review provenance (not required to run the portable fixtures): root’s independently checked fixture record: `CR4-COUNTEREXAMPLES.json`, produced by AST extraction of the original function plus exhaustive integer-potential comparison. It is local review evidence, not a field experiment.
- Independent exact fixture checker: `book-CR4-correction-plan/independent-exact-check.py`, with rational normal equations and all 32 subsets. It is not imported by this bundle.
- [NumPy `lstsq` reference](https://numpy.org/doc/2.3/reference/generated/numpy.linalg.lstsq.html), accessed 2026-09-24: documents the numerical least-squares routine used by the helper. It does not state an intervention-optimization theorem.
- [Fan Chung, *Spectral Graph Theory*](https://www.math.ucsd.edu/~fan/research/revised.html), revised 2006, accessed 2026-09-24: background on graph Laplacians/cycles. The conditional lemma above is supplied here with its own explicit assumptions; this source is not cited for a greedy repair result.

## Portable checks

From the skill root, run `python3 scripts/test_cr4_contract.py` for shape, numerical-domain, row-binding and stop-state checks, and `python3 scripts/sheaf_repair_and_2complex.py --cr4-fixtures` for the documented positive and negative fixtures. Both need NumPy; neither contacts a service.
