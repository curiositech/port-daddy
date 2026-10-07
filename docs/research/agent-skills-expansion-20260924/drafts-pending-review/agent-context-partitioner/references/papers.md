# Source-bounded research notes

These papers inform design questions, not runtime authority or an optimal partition objective. The algorithm included in this bundle uses no learned clustering, mutual-information estimator, or dynamic worker selection.

## Dynamic agent teams: DyLAN

Liu et al., “A Dynamic LLM-Powered Agent Network for Task-Oriented Agent Collaboration,” arXiv:2310.02170v2 (2024), https://arxiv.org/abs/2310.02170 . The abstract describes a two-stage approach: task-conditioned team optimization using an Agent Importance Score, then task solving with dynamic collaboration. Its reported results and the “up to 25.0%” MMLU-subject gain are scoped to the paper’s evaluated tasks and setup. It does not justify this skill’s partition-only contract, select a universal worker count, or prove that similarity-based context assignment is safe.

## Prompt compression: LLMLingua

Jiang et al., “LLMLingua: Compressing Prompts for Accelerated Inference of Large Language Models,” arXiv:2310.05736v2 (EMNLP 2023), https://arxiv.org/abs/2310.05736 . The abstract describes a coarse-to-fine method with a budget controller, iterative token-level compression, and distribution alignment, evaluated on four named datasets. It reports up to 20x compression with little performance loss in its experiments. This is not a guarantee for arbitrary private evidence, obligations, or structured continuation packages. Compression must be validated against the original inventory and preserve required obligations and source lineage.

## Graph-partitioning methods are not interchangeable with this helper

METIS, Fiduccia–Mattheyses, and Dilworth address graph partitioning or order structure under their formal input models. The active helper is a small deterministic greedy assignment over a supplied DAG and target inventory. It does not implement those algorithms or inherit their properties. Apply a dedicated graph-partitioning method only after mapping its objective and constraints to the actual privacy, capability, capacity, and causal contract; then test the resulting proposal against the source root.

## Excluded rationale

Mutual-information minimization is not established here as the theoretically correct objective for assigning agent context. Yao’s communication-complexity work does not, by itself, establish that claim. The unverified “HyperTree Planning” citation and prior internally attributed Newsle/Siemens method are not used as support. If those methods become relevant, verify exact identity and full source before integrating them.
