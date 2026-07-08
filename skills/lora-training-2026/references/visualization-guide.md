# Visualization Suite Guide

Two HTML reports, no servers, no notebooks — open the file in a browser. They exist so you *look*
before and after spending GPU hours. The **dataset-doctor** and **eval-visualizer** agents read
these reports to make recommendations.

## 1. Dataset report — `visualize_dataset.py`

```bash
python scripts/visualize_dataset.py data/train.jsonl --out reports/dataset.html \
  --tokenizer qwen3-8b --max-seq-len 4096
```

Generates a single self-contained `dataset.html` (inline CSS/SVG, no internet needed) with:

| Panel | What it shows | What to look for |
|-------|---------------|------------------|
| **Summary** | #examples, #tokens, mean/median/p95/max length, est. tokens/epoch | sanity on scale + cost |
| **Token-length histogram** | distribution of per-example token counts | a fat right tail → set seq-len to p95, not max |
| **Truncation gauge** | % examples exceeding `--max-seq-len` | >2–3% red → raise seq-len or split examples |
| **Role balance** | counts of system/user/assistant turns | missing assistant turns = unusable rows |
| **Duplicate finder** | exact + near-duplicate clusters (hash + shingle) | high dup % → run `--dedup` before training |
| **Length outliers** | longest N examples, linked to render | trim or bucket the monsters |
| **Sample viewer** | rendered conversations with masked vs trained spans highlighted | confirm masking + template are correct |
| **Cost estimate** | tokens/epoch × epochs → rough GPU-minute band | catch a 10× surprise before it bills |

**Read order**: Truncation gauge → Role balance → Duplicate finder → Sample viewer. If any is red,
fix the data and re-run before training. This 30-second look prevents most failed runs.

## 2. Comparison report — `compare_outputs.py`

```bash
python scripts/compare_outputs.py --base qwen3-8b --adapter out/adapter \
  --prompts data/eval.jsonl --out reports/compare.html --max-new-tokens 256
```

Runs the **same held-out prompts** through the base model and the adapter, side by side:

| Panel | What it shows | What to look for |
|-------|---------------|------------------|
| **Side-by-side** | base vs tuned generation per prompt, word-diff highlighted | did the target behavior actually change? |
| **Behavior tags** | per-prompt: improved / regressed / unchanged (heuristic + your labels) | net improvement, no broad regressions |
| **Format compliance** | adherence to target format (JSON valid, length, structure) | the thing you trained for |
| **Regression probes** | a few general-ability prompts NOT in your domain | catastrophic forgetting check |
| **Length & repetition** | output length deltas, repetition/loop detection | overfit tells: short, repetitive, memorized |

**Read it as a decision**:
- Target behavior improved, probes unchanged → ship (merge + export).
- Target improved but probes **regressed** → over-trained or too-high rank → fewer epochs / lower r /
  mix in some general data.
- Outputs short/looping/verbatim-from-train → **overfit** → fewer epochs, more/diverse data.
- No change vs base → **underfit** → higher lr/rank/epochs, or the base already couldn't do it (wrong base).

## Optional: training curves
If you log to TensorBoard/W&B during `train_lora.py`, point your tool at `out/logs/`. The HTML
reports cover data and outputs; loss curves are complementary, not required.

## Design notes
- Reports are **single self-contained HTML files** — emailable, diffable, committable to a run folder.
- No telemetry, no external fetches — safe for sensitive data.
- Both scripts accept `--max-samples` to keep big datasets fast; sampling is deterministic via `--seed`.
