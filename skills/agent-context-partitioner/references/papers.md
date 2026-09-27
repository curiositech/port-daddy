# Reference Papers

## Foundational Clustering Algorithms

### Evidence Accumulation Clustering (EAC)
- **Citation**: Fred, A., & Jain, A. K. (2002). Data Clustering Using Evidence Accumulation. *ICPR 2002*.
- **DOI**: 10.1109/ICPR.2002.1048458
- **Key idea**: Run N random initializations, build a co-association matrix (how often pairs end up in same cluster), perform final clustering on the co-association distance. Order-independent by construction.
- **Relevance**: Direct template for `consensus_partition()` in `online_k_selector.py`.

### BIRCH: Balanced Iterative Reducing and Clustering Using Hierarchies
- **Citation**: Zhang, T., Ramakrishnan, R., & Livny, M. (1996). BIRCH: An Efficient Data Clustering Method for Very Large Databases. *SIGMOD 1996*.
- **Key idea**: Incremental, online clustering via a CF-tree. O(n) single pass. Natural fit for streaming token chunks.
- **Relevance**: `CausalBIRCH` in SKILL.md. Best for high-throughput online mode.

### Gap Statistic for K Selection
- **Citation**: Tibshirani, R., Walther, G., & Hastie, T. (2001). Estimating the Number of Clusters in a Data Set via the Gap Statistic. *Journal of the Royal Statistical Society, Series B, 63*(2), 411–423.
- **Key idea**: Compare within-cluster dispersion to a null reference distribution; optimal K is where the gap peaks. Gold standard for offline K selection.
- **Relevance**: `gap_statistic_k()` in SKILL.md.

---

## Graph Partitioning

### METIS: Multilevel Graph Partitioning
- **Citation**: Karypis, G., & Kumar, V. (1998). A Fast and High Quality Multilevel Scheme for Partitioning Irregular Graphs. *SIAM Journal on Scientific Computing, 20*(1), 359–392.
- **Key idea**: Coarsen the graph, partition the coarsened graph cheaply, refine the partition back to the original. Achieves near-optimal cuts in near-linear time.
- **Relevance**: `partition_task_dag()` Phase 2 in SKILL.md. Python binding: `metis` package (pymetis).

### Fiduccia-Mattheyses (FM) Refinement
- **Citation**: Fiduccia, C. M., & Mattheyses, R. M. (1982). A Linear-Time Heuristic for Improving Network Partitions. *DAC 1982*, pp. 175–181.
- **Key idea**: Move nodes between partitions one at a time to reduce cut edges; accept only the best prefix of moves (Kernighan trick). O(|E|) per pass.
- **Relevance**: `fm_refinement()` in `dag_partitioner.py`.

### Dilworth's Theorem
- **Citation**: Dilworth, R. P. (1950). A Decomposition Theorem for Partially Ordered Sets. *Annals of Mathematics, 51*(1), 161–166.
- **Key idea**: In any finite partially ordered set, the minimum number of chains needed to cover all elements equals the maximum size of an antichain. Gives a lower bound on the number of sequential agent runs needed for a DAG.
- **Relevance**: `dilworth_chain_decomposition()` in `dag_partitioner.py`.

---

## Topological Stability

### Persistent Homology (H₀) for Cluster Stability
- **Citation**: Edelsbrunner, H., & Harer, J. (2010). *Computational Topology: An Introduction*. American Mathematical Society.
- **Citation**: Carlsson, G. (2009). Topology and Data. *Bulletin of the American Mathematical Society, 46*(2), 255–308.
- **Key idea**: Track connected components (H₀) as distance threshold ε increases via Vietoris-Rips filtration. Clusters that persist over a wide ε range are topologically stable. The "gap" between persistence values gives a principled ε choice.
- **Relevance**: `persistent_homology_partition()` in SKILL.md. Python: `ripser` or `gudhi`.

### Leiden Algorithm (Community Detection)
- **Citation**: Traag, V. A., Waltman, L., & van Eck, N. J. (2019). From Louvain to Leiden: Guaranteeing Well-Connected Communities. *Scientific Reports, 9*, 5233.
- **Key idea**: Improvement over Louvain that guarantees internally connected communities. Local refinement phase prevents poorly connected clusters.
- **Relevance**: Mentioned as alternative for streaming context clustering with local update support.

---

## Communication Complexity

### Yao's Communication Complexity Lower Bound
- **Citation**: Yao, A. C.-C. (1979). Some Complexity Questions Related to Distributive Computing. *STOC 1979*, pp. 209–213.
- **Key idea**: For two communicating parties to jointly compute a function, the required communication is bounded below by the rank of the communication matrix (or by mutual information in the probabilistic setting).
- **Relevance**: Justifies why minimizing MI across partition cuts is the theoretically correct objective for multi-agent context partitioning, not just cosine distance.

---

## Mutual Information Estimation

### Kraskov MI Estimator
- **Citation**: Kraskov, A., Stögbauer, H., & Grassberger, P. (2004). Estimating Mutual Information. *Physical Review E, 69*(6), 066138.
- **Key idea**: k-NN based MI estimator that is consistent and parameter-free (aside from k). Practical for continuous embeddings.
- **Relevance**: For weighting partition edges by MI(C_u; C_v | tasks) rather than raw cosine similarity. Python: `sklearn.feature_selection.mutual_info_regression` as a proxy.

---

## Context Compression for LLMs

### LLMLingua
- **Citation**: Jiang, H., Wu, Q., Lin, C.-Y., Yang, Y., & Lam, W. (2023). LLMLingua: Compressing Prompts for Accelerated Inference of Large Language Models. *EMNLP 2023*.
- **arXiv**: 2310.05736
- **Key idea**: Token-level prompt compression using a small LM to score token importance. Achieves 3–20× compression with minimal quality loss.
- **Relevance**: For the "compress boundary chunks" step in `compute_handoff()`. When sending context across agent boundaries, LLMLingua the boundary chunks before sending.

---

## Multi-Agent Context Economics

### Context Economics for Agent Swarms (Port Daddy internal)
- **Skill**: `context-economics-for-agent-swarms`
- **Key idea**: Token budgets are a first-class economic constraint. Agents should "charge" for context sharing via the PD metering layer. See Port Daddy ADRs 0044–0048.
- **Relevance**: Port Daddy integration points in SKILL.md.

### HyperTree Planning
- **Citation**: Chen, Y., et al. (2025). HyperTree Planning for Agent Reasoning. *(Preprint)*
- **Key idea**: Represents agent reasoning as a hypergraph where hyperedges capture multi-node dependencies. Hyperedge cuts generalize standard graph partitioning to multi-way context dependencies.
- **Relevance**: When tasks have 3-way dependencies (not just pairwise), hyperedge-aware partitioning reduces spurious cross-agent handoffs.

### Dynamic LLM-Agent Network
- **Citation**: Liu, Z., et al. (2024). Dynamic LLM-Agent Network: An LLM-Agent Collaboration Framework with Agent Team Optimization. *(Preprint)*
- **Key idea**: Models agent communication topology as a learnable k-NN graph; prunes communication edges to improve efficiency and reduce noise.
- **Relevance**: Learned communication topology rather than static DAG structure.

---

## Online Agglomerative Clustering (Newsle-era)

The Siemens research paper mentioned by the operator is likely one of:

- **Titan / Online Hierarchical Clustering**: Pham, N., & Pagh, R. (2012). *A Near-Linear Time Approximation Algorithm for Angle-based Outlier Detection in High-dimensional Data*. The 2000s Siemens NLP labs produced several online TF-IDF clustering papers for news deduplication; the closest published work matching the description is:
  - **Offline reference**: Allan, J., Papka, R., & Lavrenko, V. (1998). On-line New Event Detection and Tracking. *SIGIR 1998*. (TDT era; greedy single-pass clustering with centroid update — the exact algorithm Erich describes.)
  - **The epsilon-chain problem** is formalized in: Charikar, M., & Chekuri, C. (2004). Approximation Algorithms for Directed Steiner Problems. (The triangle violation is a known failure mode of single-linkage / nearest-centroid online clustering.)
  - **The fix Erich likely used**: RANSAC over cluster assignments is equivalent to the bootstrap consensus approach in Fred & Jain 2002 (EAC), applied to sequential article streams. Cluster merging / dissolution post-hoc is the "offline refinement pass" of TDT systems.
