# NLI-Based Task Entailment for Agent Overlap Detection

Natural Language Inference reformulates the overlap detection problem as a textual entailment question: given premise P ("Agent A is performing task X, producing output prefix P_a") and hypothesis H ("Agent B is performing task X, producing output prefix P_b"), does P entail H and H entail P? Mutual entailment — bi-directional implication — is the operational definition of semantic equivalence here. Unidirectional entailment (P ⊨ H but not H ⊨ P) signals task subsumption: Agent B's task is a subcase of Agent A's, but not identical. Both patterns are actionable coordination signals.

## NLI Models for This Domain

The standard production choice is `cross-encoder/nli-deberta-v3-large` (Microsoft DeBERTa-v3-large fine-tuned on MNLI + FEVER + ANLI). It outputs three logits [contradiction, neutral, entailment]; softmax the entailment logit as your confidence score. On a single A100, DeBERTa-large inference runs at **20-40ms per pair** (sequence lengths ~256 tokens). On CPU-only, expect 200-400ms per pair — workable for low-N agent fleets but breaks under O(N²) full pairwise load.

Lighter alternatives when latency is paramount:

| Model | Size | GPU latency | CPU latency | NLI accuracy (MNLI) |
|---|---|---|---|---|
| DeBERTa-v3-large (cross-encoder) | 435M params | 20-40ms | 200-400ms | 91.4% |
| DeBERTa-v3-base (cross-encoder) | 86M params | 8-15ms | 60-120ms | 88.1% |
| MiniLM-L6-v2 (cross-encoder) | 22M params | 3-6ms | 15-30ms | 82.3% |
| DistilBERT NLI | 66M params | 5-10ms | 40-80ms | 82.0% |

For agent overlap detection specifically, DeBERTa-base is the practical sweet spot: it cuts latency by 50-60% versus large with only a 3pp accuracy drop. MiniLM is viable as a third-stage tiebreaker after ANN + base-NLI if you need sub-10ms GPU latency per pair, but its lower accuracy means more false positives on paraphrased technical claims.

## The Cross-Encoder Architecture Matters

Cross-encoders jointly encode both sequences — [CLS] + text_A + [SEP] + text_B + [SEP] — in a single forward pass, enabling full cross-attention between the two inputs. This is what makes them accurate for entailment. Bi-encoders (like sentence-BERT) encode sequences independently; they are fast for retrieval (ANN pre-filter) but cannot model token-level interactions between A and B, so they miss fine-grained semantic distinctions. The two-stage pipeline is architecturally motivated: bi-encoder for speed, cross-encoder for precision.

## Practical Entailment Scoring

```python
from transformers import pipeline

# Load once at orchestrator startup
nli = pipeline(
    "text-classification",
    model="cross-encoder/nli-deberta-v3-base",   # base for latency
    device=0,  # GPU; set -1 for CPU
    truncation=True,
    max_length=512
)

def mutual_entailment(text_a: str, text_b: str, threshold: float = 0.80) -> tuple[bool, float]:
    """Returns (is_overlap, min_entailment_score)."""
    # Truncate to 200 tokens each side to stay under 512 combined
    a_trunc = " ".join(text_a.split()[:200])
    b_trunc = " ".join(text_b.split()[:200])

    r_ab = nli(f"{a_trunc} </s> {b_trunc}", top_k=None)
    r_ba = nli(f"{b_trunc} </s> {a_trunc}", top_k=None)

    score_ab = next(r["score"] for r in r_ab if r["label"] == "ENTAILMENT")
    score_ba = next(r["score"] for r in r_ba if r["label"] == "ENTAILMENT")

    min_score = min(score_ab, score_ba)
    return min_score >= threshold, min_score
```

The `</s>` separator token is the DeBERTa convention; `[SEP]` is equivalent. The pipeline's `truncation=True` handles overflow but prefer explicit truncation so you control which tokens get cut (trailing tokens, not leading task-type tokens).

## Latency vs. Accuracy Calibration

At the full-pipeline level (embedding ANN + NLI second stage), the accuracy/latency tradeoffs collapse to two decision points:

**1. ANN threshold.** Lower threshold (e.g., 0.80) → more candidate pairs passed to NLI → NLI latency dominates. Higher threshold (0.92) → fewer pairs, lower NLI load, but more true overlaps missed at the ANN gate (recall penalty). For N=10 agents, even O(N²)=45 NLI calls at 15ms each = 675ms, which is acceptable. For N=50, that's 1225 calls = 18 seconds — the ANN gate becomes mandatory.

**2. NLI model size.** Use base (not large) unless your fleet operates on highly formal, structured outputs where the 3pp accuracy gap actually matters (e.g., agent claims expressed as logical propositions rather than natural language prose).

If GPU is unavailable: use embedding cosine alone (no NLI second stage) with a tighter threshold (0.92-0.95). This loses ~5-8pp precision on ambiguous pairs but avoids the CPU latency cliff entirely.

## Key Points

- Mutual entailment (P ⊨ H AND H ⊨ P) is the correct equivalence predicate; unidirectional entailment detects task subsumption, which is a distinct but also useful coordination signal.
- DeBERTa-v3-base (cross-encoder) is the practical default: 8-15ms GPU, 88% MNLI accuracy, 50% faster than large — the latency saving outweighs the marginal accuracy loss for most fleet sizes.
- NLI is only tractable as a second stage after ANN pre-filtering; O(N²) NLI over a full agent fleet blows up past N=20 without GPU and N=50 with it.
- Truncate input to ~200 tokens per agent output before concatenation; NLI accuracy degrades meaningfully when truncation kicks in at the model level because the task-signal-dense prefix gets preserved while conclusion tokens are cut — which is the correct behavior for in-flight partial outputs.
- An entailment threshold of 0.80 is a reasonable starting point; lower (0.70) if you want to catch all overlaps and tolerate false positives surfaced to a human coordinator; raise to 0.88 for autonomous kill signals.

## See Also

- SKILL.md §"NLI entailment second stage" — architectural placement of this stage within the full two-stage pipeline
- `references/embedding-pre-filter.md` — ANN cosine similarity gate that feeds candidate pairs into this NLI stage
- `references/partial-output-checkpointing.md` — token checkpoint strategy that determines what text A and text B contain when NLI is invoked
