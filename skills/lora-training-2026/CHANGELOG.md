# LoRA Training 2026 — Changelog

## v1.0.0 (2026-06-19)

Initial release. End-to-end LoRA/QLoRA/DoRA fine-tuning skill for open-weight models.

**Agents**
- `base-model-selector` — recommends a source model by task/license/VRAM/language trade-offs
- `compute-advisor` — local-vs-cloud decision + concrete setup for either route
- `dataset-doctor` — diagnoses dataset health from the visualization report
- `training-orchestrator` — authors the run config, picks hyperparameters, supervises the loss
- `eval-visualizer` — interprets base-vs-tuned comparison, decides ship/retrain/rethink

**References**
- `base-models-2026` — Qwen3, Llama 4, Gemma 3, Mistral, Phi-4, DeepSeek distills, SmolLM strengths/weaknesses
- `local-vs-cloud` — VRAM math, provider table, cost intuition, setup recipes
- `hyperparameters` — rank/alpha/lr/scheduler, QLoRA/DoRA/rsLoRA, starting recipes by regime
- `dataset-formats` — chatml/alpaca/completion/dpo/vision/tool formats
- `visualization-guide` — reading the dataset and comparison HTML reports
- `troubleshooting` — OOM, NaN, over/underfit, garbage output, slow training, cloud hygiene

**Scripts** (stdlib for the no-GPU ones; transformers/peft/unsloth for training)
- `recommend_base_model.py` + `model_registry.json` — data-driven base-model ranker
- `assess_hardware.py` — GPU detection + QLoRA VRAM estimate → LOCAL/CLOUD verdict + setup
- `prepare_dataset.py` — validate/convert/dedup/split with health checks
- `visualize_dataset.py` — single-file HTML dataset report (lengths, truncation, dupes, samples)
- `train_lora.py` — unified Unsloth→PEFT/TRL trainer driven by YAML; `--dry-run` anywhere
- `train_lora.sh` — one-shot cloud launcher (local/modal/runpod)
- `compare_outputs.py` — base-vs-tuned side-by-side HTML with regression probes; `--pairs` no-GPU path
- `merge_and_export.py` — merge adapter → safetensors or quantized GGUF

**Verified**: all scripts compile; no-GPU paths tested end-to-end (recommend → assess → prepare →
visualize → compare → dry-run train). Bash launcher syntax-checked.
