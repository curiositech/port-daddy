#!/usr/bin/env python3
"""
train_lora.py — Unified LoRA/QLoRA/DoRA trainer driven by a YAML config.

Tries Unsloth first (2-5x faster, lower VRAM); falls back to plain PEFT + TRL if
Unsloth isn't installed. Same config works locally or on a cloud GPU. The
training-orchestrator agent writes the config; references/hyperparameters.md explains
every field.

Usage:
    python train_lora.py --config configs/run.yaml
    python train_lora.py --config configs/run.yaml --dry-run     # print resolved plan, no training
    python train_lora.py --print-example-config > configs/run.yaml

Requires (install per references/local-vs-cloud.md):
    unsloth (optional, recommended) OR (peft trl), plus transformers datasets accelerate bitsandbytes

This script intentionally does NOT run in CI/sandboxes without a GPU — it is the real
training entrypoint. Use --dry-run to validate a config anywhere.
"""
import argparse
import json
import sys
from pathlib import Path

EXAMPLE_CONFIG = """# LoRA run config — see references/hyperparameters.md
model: Qwen/Qwen3-8B-Instruct        # base checkpoint (confirm on HF)
method: qlora                        # qlora | lora | dora
output_dir: out/adapter

# data (from prepare_dataset.py)
train_file: data/train.jsonl
eval_file: data/eval.jsonl           # optional
data_format: chatml                  # chatml | alpaca | completion | dpo
train_on_responses_only: true        # mask the prompt, train on assistant turns

# adapter
r: 16
lora_alpha: 32
lora_dropout: 0.05
use_rslora: false
target_modules: all-linear           # or q_proj,k_proj,v_proj,o_proj,gate_proj,up_proj,down_proj

# optimization
learning_rate: 2.0e-4
epochs: 3
max_seq_len: 2048                    # set to your data p95 (visualize_dataset.py)
micro_batch_size: 1
gradient_accumulation_steps: 16      # effective batch = micro * accum
warmup_ratio: 0.05
lr_scheduler: cosine
optimizer: adamw_8bit
weight_decay: 0.0
max_grad_norm: 1.0
gradient_checkpointing: true
seed: 42
logging_steps: 10
save_steps: 200                      # checkpoint cadence (important on ephemeral cloud)
packing: false                       # pack short examples to fill sequences (throughput)
"""


def load_config(path: Path) -> dict:
    text = path.read_text(encoding="utf-8")
    if path.suffix == ".json":
        return json.loads(text)
    # Try PyYAML, fall back to a minimal flat-YAML parser (our configs are flat).
    try:
        import yaml  # type: ignore
        return yaml.safe_load(text)
    except Exception:
        cfg = {}
        for line in text.splitlines():
            line = line.split("#", 1)[0].rstrip()
            if not line or ":" not in line:
                continue
            k, v = line.split(":", 1)
            k, v = k.strip(), v.strip()
            if not v:
                continue
            if v.lower() in ("true", "false"):
                cfg[k] = v.lower() == "true"
            else:
                try:
                    cfg[k] = int(v)
                except ValueError:
                    try:
                        cfg[k] = float(v)
                    except ValueError:
                        cfg[k] = v.strip("'\"")
        return cfg


def resolve_plan(cfg: dict) -> dict:
    eff_batch = cfg.get("micro_batch_size", 1) * cfg.get("gradient_accumulation_steps", 16)
    return {
        "model": cfg["model"], "method": cfg.get("method", "qlora"),
        "r": cfg.get("r", 16), "lora_alpha": cfg.get("lora_alpha", 2 * cfg.get("r", 16)),
        "lr": cfg.get("learning_rate", 2e-4), "epochs": cfg.get("epochs", 3),
        "max_seq_len": cfg.get("max_seq_len", 2048), "effective_batch": eff_batch,
        "target_modules": cfg.get("target_modules", "all-linear"),
        "use_rslora": cfg.get("use_rslora", False), "output_dir": cfg.get("output_dir", "out/adapter"),
    }


def build_target_modules(cfg):
    tm = cfg.get("target_modules", "all-linear")
    if tm == "all-linear":
        return ["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"]
    if isinstance(tm, str):
        return [x.strip() for x in tm.split(",") if x.strip()]
    return tm


def load_dataset_messages(path, data_format):
    from datasets import load_dataset  # type: ignore
    ds = load_dataset("json", data_files=str(path), split="train")
    return ds


def train(cfg: dict):
    method = cfg.get("method", "qlora")
    load_in_4bit = method == "qlora"
    use_dora = method == "dora"
    max_seq = cfg.get("max_seq_len", 2048)
    targets = build_target_modules(cfg)

    # ---- Try Unsloth (preferred) ----
    model = tokenizer = None
    backend = None
    try:
        from unsloth import FastLanguageModel  # type: ignore
        model, tokenizer = FastLanguageModel.from_pretrained(
            model_name=cfg["model"], max_seq_length=max_seq,
            load_in_4bit=load_in_4bit, dtype=None,
        )
        model = FastLanguageModel.get_peft_model(
            model, r=cfg.get("r", 16), lora_alpha=cfg.get("lora_alpha", 32),
            lora_dropout=cfg.get("lora_dropout", 0.05), target_modules=targets,
            use_rslora=cfg.get("use_rslora", False), use_dora=use_dora,
            use_gradient_checkpointing="unsloth" if cfg.get("gradient_checkpointing", True) else False,
            random_state=cfg.get("seed", 42),
        )
        backend = "unsloth"
    except ImportError:
        # ---- Fallback: transformers + PEFT ----
        import torch  # type: ignore
        from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig  # type: ignore
        from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training  # type: ignore
        quant = None
        if load_in_4bit:
            quant = BitsAndBytesConfig(load_in_4bit=True, bnb_4bit_quant_type="nf4",
                                       bnb_4bit_compute_dtype=torch.bfloat16, bnb_4bit_use_double_quant=True)
        tokenizer = AutoTokenizer.from_pretrained(cfg["model"], trust_remote_code=True)
        model = AutoModelForCausalLM.from_pretrained(
            cfg["model"], quantization_config=quant, torch_dtype=torch.bfloat16,
            device_map="auto", trust_remote_code=True,
        )
        if load_in_4bit:
            model = prepare_model_for_kbit_training(
                model, use_gradient_checkpointing=cfg.get("gradient_checkpointing", True))
        lora = LoraConfig(
            r=cfg.get("r", 16), lora_alpha=cfg.get("lora_alpha", 32),
            lora_dropout=cfg.get("lora_dropout", 0.05), target_modules=targets,
            use_rslora=cfg.get("use_rslora", False), use_dora=use_dora,
            bias="none", task_type="CAUSAL_LM",
        )
        model = get_peft_model(model, lora)
        backend = "peft"

    print(f"[train_lora] backend = {backend}")
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    data_format = cfg.get("data_format", "chatml")
    train_ds = load_dataset_messages(cfg["train_file"], data_format)

    def to_text(ex):
        if "messages" in ex:
            return {"text": tokenizer.apply_chat_template(ex["messages"], tokenize=False, add_generation_prompt=False)}
        if "text" in ex:
            return {"text": ex["text"]}
        # alpaca-shaped fallback
        msgs = []
        if ex.get("system"):
            msgs.append({"role": "system", "content": ex["system"]})
        user = ex.get("instruction", "")
        if ex.get("input"):
            user += "\n\n" + ex["input"]
        msgs += [{"role": "user", "content": user}, {"role": "assistant", "content": ex.get("output", "")}]
        return {"text": tokenizer.apply_chat_template(msgs, tokenize=False)}

    train_ds = train_ds.map(to_text)

    from trl import SFTConfig, SFTTrainer  # type: ignore
    sft_cfg = SFTConfig(
        output_dir=cfg.get("output_dir", "out/adapter"),
        per_device_train_batch_size=cfg.get("micro_batch_size", 1),
        gradient_accumulation_steps=cfg.get("gradient_accumulation_steps", 16),
        learning_rate=float(cfg.get("learning_rate", 2e-4)),
        num_train_epochs=cfg.get("epochs", 3),
        warmup_ratio=cfg.get("warmup_ratio", 0.05),
        lr_scheduler_type=cfg.get("lr_scheduler", "cosine"),
        optim=cfg.get("optimizer", "adamw_8bit"),
        weight_decay=cfg.get("weight_decay", 0.0),
        max_grad_norm=cfg.get("max_grad_norm", 1.0),
        logging_steps=cfg.get("logging_steps", 10),
        save_steps=cfg.get("save_steps", 200),
        max_seq_length=max_seq,
        packing=cfg.get("packing", False),
        bf16=True, seed=cfg.get("seed", 42),
        report_to="none",
    )
    trainer = SFTTrainer(model=model, tokenizer=tokenizer, train_dataset=train_ds, args=sft_cfg, dataset_text_field="text")

    # Train only on assistant responses when requested (chatml)
    if cfg.get("train_on_responses_only", True) and data_format in ("chatml", "alpaca"):
        try:
            from unsloth.chat_templates import train_on_responses_only  # type: ignore
            trainer = train_on_responses_only(trainer)
        except Exception:
            print("[train_lora] note: response-only masking needs Unsloth; training on full text.")

    trainer.train()
    out = cfg.get("output_dir", "out/adapter")
    model.save_pretrained(out)
    tokenizer.save_pretrained(out)
    print(f"[train_lora] saved adapter -> {out}")
    print(f"[train_lora] next: python compare_outputs.py --base {cfg['model']} --adapter {out} "
          f"--prompts {cfg.get('eval_file', 'data/eval.jsonl')} --out reports/compare.html")


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--config", help="path to run.yaml / run.json")
    p.add_argument("--dry-run", action="store_true", help="print the resolved plan and exit (no GPU needed)")
    p.add_argument("--print-example-config", action="store_true", help="print a starter config to stdout")
    args = p.parse_args()

    if args.print_example_config:
        print(EXAMPLE_CONFIG)
        return 0
    if not args.config:
        p.error("--config is required (or use --print-example-config)")

    cfg_path = Path(args.config)
    if not cfg_path.exists():
        print(f"Error: config not found: {cfg_path}", file=sys.stderr)
        return 2
    cfg = load_config(cfg_path)
    for req in ("model", "train_file"):
        if req not in cfg:
            print(f"Error: config missing required key '{req}'", file=sys.stderr)
            return 2

    plan = resolve_plan(cfg)
    print("Resolved training plan:")
    print(json.dumps(plan, indent=2))
    if args.dry_run:
        print("\n--dry-run: config valid, not training.")
        return 0

    try:
        train(cfg)
    except ImportError as e:
        print(f"\nError: missing training dependency: {e}", file=sys.stderr)
        print("Install per references/local-vs-cloud.md:", file=sys.stderr)
        print('  uv pip install "unsloth @ git+https://github.com/unslothai/unsloth.git" trl peft transformers datasets accelerate bitsandbytes', file=sys.stderr)
        return 3
    return 0


if __name__ == "__main__":
    sys.exit(main())
