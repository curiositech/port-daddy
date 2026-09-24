---
name: runtime-task-overlap-detector
version: 0.1.0
description: >
  Detects when two or more concurrently running agents are performing semantically
  equivalent work — using embedding-space task-shape similarity over live agent
  outputs and claims, not keyword matching. The core challenge is operating on
  incomplete, in-flight outputs: detection must fire early enough to be useful
  (ideally before redundant work finishes) while tolerating the ambiguity of
  partial completions. Combines ANN cosine similarity over dense embeddings as
  a fast pre-filter with optional NLI-based claim entailment as a precision
  second stage. Task-type is detectable from as little as 18% of generated
  tokens, making early-exit overlap detection feasible in streaming pipelines.
author: soma-windags-graft
tags: [multi-agent, deduplication, semantic-similarity, embeddings, nli, streaming, coordination]
pairs-with: []
---

# Runtime Task Overlap Detector

## When to Use

- A multi-agent system fans out work to concurrent agents and you need to detect
  that two agents have converged on the same effective task before both complete
  expensive LLM generation or tool use.
- An orchestrator receives agent output claims (partial or complete) and must
  deduplicate before routing downstream — especially when agents were dispatched
  with different surface-level instructions that turn out to be semantically
  equivalent.
- A streaming pipeline needs to kill a redundant agent mid-generation rather than
  waiting for completion and discarding output post-hoc.

NOT for:
- Exact-string or token-overlap deduplication — use MinHash-LSH or ROUGE for that;
  this skill addresses semantic equivalence where surface text differs.
- Keyword-based intent routing — embedding-space similarity is mandatory; keyword
  lists have catastrophic recall on paraphrased or domain-shifted agent outputs.
- Post-hoc deduplication of a finished corpus — this skill's value is in-flight
  detection; for offline deduplication use CREDENCE or SemHash directly.

## Core Concepts

**Task-shape similarity.** A coined operational term (not a published concept) for
the property that two agents are solving the same underlying problem regardless of
how their instructions, intermediate outputs, or surface text differ. Detectable via
embedding cosine similarity over partial outputs; no published system has named or
benchmarked this directly, but the component techniques are mature.

**ANN cosine pre-filter.** The primary detection gate. Encode each agent's current
output prefix (or structured claim) into a dense vector (sentence-BERT, BGE-large,
or equivalent); query an approximate nearest-neighbor index (HNSW via FAISS,
Usearch, or SemHash) for the other agents' vectors. Cosine similarity >= 0.88-0.92
is the empirically validated range for semantic deduplication (SemHash; CREDENCE,
arXiv:2606.19819). Below 0.75 overlap is near zero for general English. Threshold
must be calibrated per domain — technical/code outputs tolerate tighter thresholds
than open-ended prose.

**NLI entailment second stage.** When the embedding pre-filter flags a candidate
pair, a fine-tuned NLI model (DeBERTa-v3-large-mnli-fever-anli or equivalent)
checks directional entailment: does output A entail output B and vice versa?
Mutual entailment = semantic equivalence. DeBERTa-base inference is 20-50ms per
pair on GPU — tractable for O(N) candidate pairs after ANN pre-filtering but
prohibitive for O(N^2) full pairwise comparison. This stage is optional; the
embedding gate alone achieves 90-95% precision at calibrated thresholds.

**Early-exit from partial outputs.** Task type and semantic intent are classifiable
from the first ~18% of generated tokens (arXiv:2506.09996, NeurIPS 2025, using a
token-level supervised discriminative classifier). For overlap detection, this means
the embedding pre-filter should be applied to rolling output prefixes, not only
complete outputs. In practice: encode at fixed token checkpoints (e.g., 64, 128,
256 tokens) and re-query the ANN index at each checkpoint. First checkpoint where
cosine >= threshold triggers a candidate overlap signal.

**Structural message routing is not semantic deduplication.** MetaGPT's explicit
"deduplication" mechanism (arXiv:2308.00352) is role-based subscription filtering —
agents only receive messages matching their registered role type. This is structural,
not semantic. It does not detect when two agents with different role assignments
produce equivalent outputs. Do not conflate the two.

## Implementation Pattern

```
# Setup (once per orchestrator session)
model = SentenceTransformer("BAAI/bge-large-en-v1.5")   # or equivalent
index = HNSWIndex(dim=1024, metric="cosine")             # FAISS / Usearch / SemHash
registry = {}  # agent_id -> (vector, output_prefix, status)

EMBED_CHECKPOINTS = [64, 128, 256]   # tokens
COSINE_THRESHOLD = 0.88              # calibrate per domain; start here
NLI_THRESHOLD = 0.85                 # entailment confidence for second stage

# Per streaming chunk from agent A
def on_agent_token(agent_id, token_buffer):
    if len(token_buffer) not in EMBED_CHECKPOINTS:
        return  # no-op until checkpoint

    vec = model.encode(token_buffer[:len(token_buffer)])
    registry[agent_id] = (vec, token_buffer, "in-flight")

    # Query ANN for other agents' vectors
    neighbors = index.query(vec, k=len(registry), threshold=COSINE_THRESHOLD)
    for other_id, cosine_sim in neighbors:
        if other_id == agent_id:
            continue
        if cosine_sim >= COSINE_THRESHOLD:
            if NLI_AVAILABLE:
                # Second-stage entailment check
                score = nli_model.entailment(
                    registry[agent_id][1], registry[other_id][1]
                )
                if score >= NLI_THRESHOLD:
                    emit_overlap_signal(agent_id, other_id, cosine_sim, score)
            else:
                emit_overlap_signal(agent_id, other_id, cosine_sim, None)

    # Upsert vector into ANN index
    index.upsert(agent_id, vec)

# Overlap signal handler (orchestrator decides policy)
def emit_overlap_signal(a, b, cosine, nli_score):
    # Options: kill younger agent, merge outputs, alert coordinator
    # Do NOT automatically kill — false positives exist; surface for policy decision
    log.warn(f"Overlap: {a} <-> {b} cosine={cosine:.3f} nli={nli_score}")
```

Key engineering notes:
- Upsert (not insert) per agent per checkpoint — the vector for an agent evolves
  as more tokens arrive; the latest prefix vector replaces the prior one.
- Do not run two `model.encode` calls in parallel if using MPS (Apple Silicon) —
  run sequentially; parallel MPS encode calls can crash or produce garbage.
- For N <= 20 concurrent agents, full pairwise O(N^2) NLI is tractable (~20ms x
  190 pairs = ~4 seconds max). For N > 50, ANN pre-filter is mandatory.
- The 0.88 threshold is calibrated for general English; code review outputs,
  formal claims, or highly templated agent outputs may need 0.92-0.95 to avoid
  false positives.
- Plan-sketch hashing (hashing structured step sequences, verb types, constraint
  sets) is an untested engineering concept; no published implementation exists.
  Treat as aspirational. Stick to dense embeddings.

## Key References

1. **CREDENCE: Claim Reduction for Decomposition & Enhanced Credibility** —
   arXiv:2606.19819 (2025). BGE-large-en embeddings at cosine 0.92 threshold for
   atomic claim deduplication in decomposition pipelines. Semantic-F1 outperforms
   Jaccard-F1 by 15-32pp across three benchmarks. The most rigorous published
   validation of embedding cosine similarity for semantic claim deduplication.

2. **From Exact Hits to Close Enough: Semantic Caching for LLM Embeddings** —
   arXiv:2603.03301 (2025). Systematic threshold-vs.-hit-rate curves at three
   normalized L2 distances across nine datasets (ELI5, WildChat, MMLU, etc.).
   The only published calibration study for cosine similarity thresholds over
   LLM outputs. Required reading before choosing a threshold.

3. **From Judgment to Interference: Early Stopping LLM Harmful Outputs via
   Streaming Content Monitoring** — arXiv:2506.09996 (NeurIPS 2025). Demonstrates
   that task/content classification is feasible from the first 18% of streaming
   tokens using a token-level supervised classifier. Establishes the empirical
   basis for checkpoint-based embedding of partial outputs.

4. **Automatic Task Detection and Heterogeneous LLM Speculative Decoding** —
   arXiv:2505.08600 (2025). Sentence-BERT + K-means for offline task-type
   clustering; Mamba-based classifier for online routing at 99.5% accuracy with
   ~500ms overhead. The only built-and-tested system for detecting "task shape"
   at inference time from partial inputs, making it the closest published analogue
   to runtime task-overlap detection.

## Imported bundle navigation

These preserved source files add depth when their stated topic is needed.

- [diagrams/01_flowchart_decision-points.md](diagrams/01_flowchart_decision-points.md) — Diagram 1: flowchart.
- [references/agentbench-overlap-patterns.md](references/agentbench-overlap-patterns.md) — Empirical Overlap Patterns from AgentBench and AutoGen.
- [references/embedding-similarity-approaches.md](references/embedding-similarity-approaches.md) — Embedding Similarity Approaches for Runtime Task Overlap Detection.
- [references/entailment-based-detection.md](references/entailment-based-detection.md) — NLI-Based Task Entailment for Agent Overlap Detection.
- [references/plan-sketch-hashing.md](references/plan-sketch-hashing.md) — Abstract Plan Sketches as Hashable Strings: Structural Similarity and Deduplication Patterns.
