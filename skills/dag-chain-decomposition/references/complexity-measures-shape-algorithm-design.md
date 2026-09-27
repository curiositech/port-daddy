# Choose by objective and measured parameters

Record `|V|`, `|E|`, reachability relation cost, chain count/width, longest path only if relevant, query volume, index memory, and graph revision cadence. Do not use fixed square-root cutoffs or graph-shape ratios as source theorems.

For exact chains, matching cost depends on the chosen comparability representation and matcher. For SEA 2023 indexing, separate topological sorting `O(|V|+|E|)`, supplied-decomposition cost, filter work, dense initialization `Θ(k_c|V|)`, and the selected propagation method. The all-successor reference construction costs `O(k_c|E|)` propagation; the paper reports `O(|E_tr|+k_c|E_red|)` for its optimization, whose literal self-seed/skip combination has a cross-chain counterexample. Do not transfer that bound to a repaired variant without analysis. Adjacency ordering must also be included; comparison sorting is not silently linear. A benchmark plan reports these values and baseline agreement rather than declaring a universal winner.

Sources: [Fulkerson 1956](https://resources.mpi-inf.mpg.de/departments/d1/teaching/ss11/graph_theory/DilworthFulkerson.pdf); [SEA 2023](https://drops.dagstuhl.de/opus/volltexte/2023/18352/pdf/LIPIcs-SEA-2023-2.pdf).
