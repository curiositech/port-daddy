# LoRA Hyperparameters (2026)

What each knob does, sane defaults, and how to move them by regime. `train_lora.py` reads these
from `run.yaml`; the **training-orchestrator** agent picks them from dataset size + method.

## The LoRA knobs

### rank (`r`) — adapter capacity
- **What**: dimension of the low-rank update. Higher = more capacity to change behavior, more params,
  more memory, more overfit risk.
- **Defaults**: style/format/tone → **8–16**. New skills/behavior → **32–64**. Broad domain shift on
  lots of data → **64–128**.
- **Heuristic**: start at 16. If under-fitting (train loss plateaus high), raise. If overfitting
  (train↓, eval↑), lower or add data.

### alpha (`lora_alpha`) — update scaling
- **What**: effective scale = `alpha / r` (classic) — multiplies the adapter's contribution.
- **Default**: `alpha = 2 × r` (the common, robust choice). With **rsLoRA**, scaling becomes
  `alpha / sqrt(r)`, which keeps behavior stable as you change rank — prefer it when sweeping rank.
- **Don't** copy a fixed `alpha=16` regardless of rank; that's the stale habit.

### dropout (`lora_dropout`)
- **Default**: 0.0–0.05. Use small dropout (0.05–0.1) only with small datasets to fight overfit.

### target_modules — where the adapter attaches
- **Default (recommended)**: attention **and** MLP: `q_proj,k_proj,v_proj,o_proj,gate_proj,up_proj,down_proj`.
  Targeting only attention is the old default and leaves capability on the table.
- Unsloth's `target_modules="all-linear"` is a safe shortcut.

### Method: LoRA vs QLoRA vs DoRA
| Method | What | Use when |
|--------|------|----------|
| **LoRA (16-bit)** | adapter on full-precision frozen base | you have VRAM headroom; max quality |
| **QLoRA (4-bit)** | adapter on 4-bit NF4 frozen base | default; fits big models on small GPUs |
| **DoRA** | decomposes weight into magnitude+direction, LoRA on direction | small data, want a bit more quality; slightly slower; lower lr |
| **rsLoRA** | rank-stabilized scaling | whenever you sweep rank or use high rank |

## Training knobs

### learning_rate
- **QLoRA**: `2e-4` is the canonical start. Range `1e-4 … 3e-4`.
- **16-bit LoRA**: `1e-4 … 2e-4`.
- **DoRA**: start ~2–3× lower (`5e-5 … 1e-4`).
- Loss spiking/NaN → halve it. Loss flat → raise 1.5–2×.

### epochs
- **1–3** for most instruction tuning. **1** if you have >10k good examples. **3–4** only for small
  (<1k) sets — and watch eval loss for overfit. Rarely go past 4; more epochs = memorization.

### batch size + gradient accumulation
- Pick the largest **micro-batch** that fits (often 1–2 with QLoRA), then set
  `gradient_accumulation_steps` so **effective batch = micro_batch × grad_accum × num_gpus ≈ 16–32**.
- Effective batch matters far more than micro-batch for stability.

### scheduler + warmup
- **cosine** decay with **3–5% warmup** (or `warmup_steps = 5–20`) is the dependable default.
- linear is fine too; constant only for very short runs.

### sequence length (`max_seq_len`)
- Set to the **95th–99th percentile** of your token lengths (read it from `visualize_dataset.py`),
  not the max. Padding/truncating to the rare 8k outlier wastes memory on every step.
- LoRA does **not** extend the base's context window.

### precision
- `bf16` on Ampere+ (default). `fp16` only on older cards. Never train master weights in fp16 if bf16
  is available.

### optimizer + memory
- **`adamw_8bit`** (bitsandbytes) — standard for LoRA, big memory win, no quality loss in practice.
- **gradient checkpointing**: on for tight VRAM (Unsloth's is memory-cheap), off for max speed.
- **packing**: concatenate short examples to fill sequences — big throughput win for short data;
  ensure your trainer masks across example boundaries.

## Starting recipes by regime

### A. Style/format/persona, 200–2,000 examples, ≤8B
```yaml
method: qlora
r: 16
lora_alpha: 32
lora_dropout: 0.05
target_modules: all-linear
learning_rate: 2.0e-4
epochs: 3
max_seq_len: 2048          # set from your data's p95
effective_batch: 16
scheduler: cosine
warmup_ratio: 0.05
optimizer: adamw_8bit
```

### B. New skill/behavior, 2k–20k examples, 8–14B
```yaml
method: qlora
r: 32
lora_alpha: 64
use_rslora: true
target_modules: all-linear
learning_rate: 2.0e-4
epochs: 2
max_seq_len: 4096
effective_batch: 32
scheduler: cosine
warmup_ratio: 0.03
optimizer: adamw_8bit
gradient_checkpointing: true
```

### C. Reasoning distill / harder shift, 32B, cloud
```yaml
method: qlora
r: 64
lora_alpha: 64
use_rslora: true
target_modules: all-linear
learning_rate: 1.0e-4
epochs: 1-2
max_seq_len: 4096-8192
effective_batch: 32
gradient_checkpointing: true
```

### D. DPO/preference tuning (after an SFT LoRA)
- Lower lr (`5e-6 … 5e-5`), `beta=0.1`, 1 epoch, pairs in chosen/rejected format. Start from your
  SFT adapter, don't DPO a raw base.

## Reading the loss (sanity, not gospel)
- Healthy SFT: train loss drops then flattens; eval loss tracks it down then flattens.
- **Overfit**: eval loss turns **up** while train keeps dropping → fewer epochs / more data / lower r.
- **Underfit**: both stay high/flat → higher lr, higher r, more epochs, check data isn't trivial.
- **NaN/spike**: lower lr, check bf16, clip grads (`max_grad_norm=1.0`), inspect for bad examples.

> Loss is a proxy. The real test is `compare_outputs.py` on held-out prompts — a lower loss that
> regressed general ability is a worse model.
