# Source method boundaries

- Kritikakis and Tollis, [arXiv v1 (2022)](https://arxiv.org/html/2212.03945v1), §§2–3 and Algorithms 1–5, was read in the B06 primary-source record. It supplies the printed names CO, NO, H3, H3 conc., and concatenation. “H1/H2/H3” as a paper taxonomy is not source terminology. The printed H3 forced-successor predicate is ambiguous between adjacent prose (current out-degree 1) and pseudocode (successor in-degree 1); this bundle preserves the ambiguity.
- Kritikakis and Tollis, [SEA 2023](https://drops.dagstuhl.de/opus/volltexte/2023/18352/pdf/LIPIcs-SEA-2023-2.pdf), §§3–4, Algorithm 1, Theorem 5, and Appendix A.1, was read in the B06 primary-source record. It supplies the partial edge filter and the final static reachability index.

The arXiv heuristics are not an exact chain-partition theorem. SEA’s filter is not exact transitive reduction. Both sources operate on graph structure; neither supplies a deployment/review/sensor semantic proof, a scheduler, a worker-allocation policy, or a dynamic-index guarantee.

Root finite review found that the printed early-self-seed/conditional-merge combination loses cross-chain reachability. See [the source/implementation discrepancy](printed-index-and-implementation-gap.md) for exact pins, counterexample, and the different author-source invariant. The active construction is a separately justified all-successor reference method, with its own cost.
