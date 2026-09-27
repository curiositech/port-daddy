# Validation obligations for a claimed cover

A matching-based result is only exact if the relation matches the requested objective. Preserve: input vertices/arcs, reachability relation or closure source, matching algorithm/result, successor map, reconstructed partition, and antichain witness.

Check coverage exactly once, chain comparability by a path, and absence of successor/predecessor conflicts. For direct-edge paths, validate selected arcs are present. For a schedule, separately validate capacity and precedence with concrete durations; a chain certificate supplies neither.

If a graph has a cycle, reject the DAG premise or report SCCs. Contracting SCCs can diagnose a condensation DAG but does not make the original tasks internally ordered. These checks are engineering validation, not a substitute for a theorem proof.

Sources: [Dilworth 1950](https://doi.org/10.2307/1969503); [Fulkerson 1956](https://resources.mpi-inf.mpg.de/departments/d1/teaching/ss11/graph_theory/DilworthFulkerson.pdf).
