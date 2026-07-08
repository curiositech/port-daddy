# LoRA Training 2026

Fine-tune an open-weight model with a LoRA/QLoRA/DoRA adapter, made exceptionally easy — from
"I have data and a goal" to a trained, previewed, exportable adapter. Picks the base model, decides
**local vs cloud** (and sets up either), and **visualizes** both your data and the model's outputs.

## Structure

```
lora-training-2026/
├── SKILL.md              # Core process + when-to-use + anti-patterns (read first)
├── CHANGELOG.md
├── README.md             # This file
├── agents/               # Sub-agent prompts for each decision step
│   ├── base-model-selector.md
│   ├── compute-advisor.md
│   ├── dataset-doctor.md
│   ├── training-orchestrator.md
│   └── eval-visualizer.md
├── references/           # Deep dives (NOT loaded by default)
│   ├── base-models-2026.md
│   ├── local-vs-cloud.md
│   ├── hyperparameters.md
│   ├── dataset-formats.md
│   ├── visualization-guide.md
│   └── troubleshooting.md
├── scripts/              # Self-contained CLIs (--help on each)
│   ├── recommend_base_model.py   model_registry.json
│   ├── assess_hardware.py
│   ├── prepare_dataset.py        visualize_dataset.py
│   ├── train_lora.py             train_lora.sh
│   ├── compare_outputs.py
│   └── merge_and_export.py
└── assets/
    └── run.example.yaml
```

## The 6-step flow

```
1. recommend_base_model.py   → pick the source model (strengths/weaknesses)
2. assess_hardware.py        → LOCAL OK or USE CLOUD + exact setup
3. prepare_dataset.py + visualize_dataset.py  → format + LOOK at the data
4. train_lora.py / train_lora.sh   → train (same config local or cloud)
5. compare_outputs.py        → base-vs-tuned preview, ship/retrain/rethink
6. merge_and_export.py       → safetensors (vLLM) or GGUF (Ollama)
```

## Quick start

```bash
cd scripts
python recommend_base_model.py --task "rewrite support replies tersely" --vram 16
python assess_hardware.py --model qwen3-8b --method qlora --seq-len 2048
python prepare_dataset.py raw.jsonl --format chatml --dedup --split 0.9 --out ../data/
python visualize_dataset.py ../data/train.jsonl --out ../reports/dataset.html --max-seq-len 2048
python train_lora.py --print-example-config > ../configs/run.yaml   # then edit
python train_lora.py --config ../configs/run.yaml          # local
#   or: bash train_lora.sh --provider modal --config ../configs/run.yaml   # cloud
python compare_outputs.py --base Qwen/Qwen3-8B-Instruct --adapter ../out/adapter \
    --prompts ../data/eval.jsonl --out ../reports/compare.html
python merge_and_export.py --base Qwen/Qwen3-8B-Instruct --adapter ../out/adapter \
    --format gguf --quant q4_k_m --out ../exports/
```

The scripts that don't need a GPU (`recommend_base_model.py`, `assess_hardware.py`,
`prepare_dataset.py`, `visualize_dataset.py`, `compare_outputs.py --pairs`, any `--dry-run`) run
anywhere with just Python's stdlib. Training/generation/export pull in transformers/peft/unsloth.

## Validate the skill

```bash
python ../skill-architect/scripts/validate_skill.py .
```
