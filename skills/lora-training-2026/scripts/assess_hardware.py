#!/usr/bin/env python3
"""
assess_hardware.py — Decide LOCAL vs CLOUD for a LoRA run, and print the setup.

Detects your GPU (NVIDIA via nvidia-smi, Apple Silicon via sysctl/torch MPS),
estimates QLoRA/LoRA peak VRAM for the chosen model + sequence length, applies a
15% safety headroom, and prints a verdict with a copy-pasteable setup path for the
chosen route. Pure stdlib; GPU detection degrades gracefully if tools are missing.

Usage:
    python assess_hardware.py --model qwen3-8b --method qlora --seq-len 4096
    python assess_hardware.py --params 14 --method qlora --seq-len 8192
    python assess_hardware.py --model qwen3-32b --method qlora --json

The estimate is intentionally conservative. See references/local-vs-cloud.md for the math.
"""
import argparse
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

REGISTRY = Path(__file__).with_name("model_registry.json")
HEADROOM = 0.85  # use at most 85% of VRAM


def lookup_params(model_id: str | None, params: float | None) -> float | None:
    if params:
        return params
    if not model_id:
        return None
    try:
        models = json.loads(REGISTRY.read_text())["models"]
    except Exception:
        return None
    for m in models:
        if m["id"] == model_id:
            return float(m["params_b"])
    # fuzzy: pull a number like 8b / 14b from the id
    mo = re.search(r"(\d+(?:\.\d+)?)\s*b", model_id.lower())
    return float(mo.group(1)) if mo else None


def estimate_vram_gb(params_b: float, method: str, seq_len: int, micro_batch: int) -> float:
    """Conservative peak VRAM (GB) for LoRA-family training."""
    # Frozen base weights
    if method == "qlora":
        weights = params_b * 0.55          # ~4-bit NF4
    else:                                  # 16-bit lora / dora
        weights = params_b * 2.1           # bf16 weights
    # Adapter + optimizer states (8-bit adam) — small for LoRA
    adapter = max(0.3, params_b * 0.03)
    # Activations: scale with seq_len * batch; checkpointing assumed for big/long
    act = (seq_len / 2048) * micro_batch * (0.9 if method == "qlora" else 1.4)
    act *= max(1.0, params_b / 8.0) ** 0.5  # bigger hidden dim -> more activation
    overhead = 1.8                         # cuda context, fragmentation
    dora_extra = 0.5 if method == "dora" else 0.0
    return round(weights + adapter + act + overhead + dora_extra, 1)


def detect_nvidia():
    if not shutil.which("nvidia-smi"):
        return None
    try:
        out = subprocess.run(
            ["nvidia-smi", "--query-gpu=name,memory.total", "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=10,
        )
        if out.returncode != 0 or not out.stdout.strip():
            return None
        gpus = []
        for line in out.stdout.strip().splitlines():
            name, mem = [x.strip() for x in line.split(",")]
            gpus.append({"name": name, "vram_gb": round(float(mem) / 1024, 1)})
        return gpus
    except Exception:
        return None


def detect_apple():
    if sys.platform != "darwin":
        return None
    try:
        out = subprocess.run(["sysctl", "-n", "hw.memsize"], capture_output=True, text=True, timeout=5)
        if out.returncode == 0 and out.stdout.strip().isdigit():
            gb = round(int(out.stdout.strip()) / (1024 ** 3), 1)
            return {"name": "Apple Silicon (unified memory, MPS)", "vram_gb": gb, "apple": True}
    except Exception:
        pass
    return None


CLOUD_TIERS = [
    (16, "1×T4/L4 (16GB) — RunPod/Colab", "runpod"),
    (24, "1×L4/A10 (24GB) — RunPod/Lambda", "runpod"),
    (40, "1×A100 40GB — Modal/Lambda", "modal"),
    (80, "1×A100/H100 80GB — Modal/RunPod", "modal"),
    (160, "2×A100/H100 80GB — Modal/Lambda", "modal"),
]


def cloud_recommendation(need_gb: float):
    for cap, label, provider in CLOUD_TIERS:
        if need_gb <= cap * HEADROOM:
            return label, provider
    return "multi-GPU node (≥4×80GB) — consider FSDP/QLoRA sharding", "modal"


def local_setup(apple: bool) -> str:
    if apple:
        return ("uv pip install mlx-lm   # Apple Silicon, small models (<=8B) only\n"
                "# CUDA path is faster; MPS is supported but slower.")
    return ("uv venv && source .venv/bin/activate\n"
            'uv pip install "unsloth @ git+https://github.com/unslothai/unsloth.git" \\\n'
            "               trl peft transformers datasets accelerate bitsandbytes\n"
            "python train_lora.py --config configs/run.yaml")


def cloud_setup(provider: str) -> str:
    if provider == "modal":
        return ("pip install modal && modal token new\n"
                "bash train_lora.sh --provider modal --config configs/run.yaml")
    return ("# On a RunPod/Lambda CUDA pod:\n"
            'uv pip install "unsloth @ git+https://github.com/unslothai/unsloth.git" trl peft transformers datasets accelerate bitsandbytes\n'
            "python train_lora.py --config configs/run.yaml\n"
            "# Then push the adapter to HF Hub before the pod is reclaimed.")


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--model", help="registry id, e.g. qwen3-8b (or use --params)")
    p.add_argument("--params", type=float, help="model size in billions if not in registry")
    p.add_argument("--method", choices=["qlora", "lora", "dora"], default="qlora")
    p.add_argument("--seq-len", type=int, default=4096)
    p.add_argument("--micro-batch", type=int, default=1)
    p.add_argument("--json", action="store_true")
    args = p.parse_args()

    params_b = lookup_params(args.model, args.params)
    if not params_b:
        print("Error: could not determine model size. Pass --params <B> or a known --model.", file=sys.stderr)
        return 2

    need_gb = estimate_vram_gb(params_b, args.method, args.seq_len, args.micro_batch)

    gpus = detect_nvidia()
    apple = detect_apple() if not gpus else None
    local_vram = None
    gpu_desc = "none detected"
    is_apple = False
    if gpus:
        local_vram = max(g["vram_gb"] for g in gpus)  # single-GPU LoRA: use the biggest card
        gpu_desc = "; ".join(f"{g['name']} ({g['vram_gb']}GB)" for g in gpus)
    elif apple:
        local_vram = apple["vram_gb"] * 0.6  # unified memory: only part is usable as VRAM
        gpu_desc = apple["name"]
        is_apple = True

    fits_local = bool(local_vram and need_gb <= local_vram * HEADROOM)
    # Apple: only small models realistically
    if is_apple and params_b > 8:
        fits_local = False

    verdict = "LOCAL" if fits_local else "USE CLOUD"
    cloud_label, cloud_provider = cloud_recommendation(need_gb)

    if args.json:
        print(json.dumps({
            "model": args.model, "params_b": params_b, "method": args.method,
            "seq_len": args.seq_len, "est_peak_vram_gb": need_gb,
            "detected_gpu": gpu_desc, "local_usable_vram_gb": local_vram,
            "verdict": verdict,
            "cloud_recommendation": None if fits_local else {"tier": cloud_label, "provider": cloud_provider},
        }, indent=2))
        return 0

    bar = "=" * 60
    print(f"\n{bar}\n  Hardware Assessment\n{bar}")
    print(f"  Model:        {args.model or f'{params_b}B'}  ({params_b}B, {args.method}, seq {args.seq_len})")
    print(f"  Est. peak:    ~{need_gb} GB  (conservative, 15% headroom applied)")
    print(f"  Detected GPU: {gpu_desc}" + (f"  → usable ~{local_vram}GB" if local_vram else ""))
    print(f"{bar}")
    if fits_local:
        print(f"  ✅ VERDICT: LOCAL OK   (~{need_gb}GB needed ≤ {round(local_vram*HEADROOM,1)}GB usable)")
        print(f"\n  Setup (local):\n")
        for ln in local_setup(is_apple).splitlines():
            print(f"    {ln}")
        print(f"\n  If tight: lower --seq-len to your data p95, enable gradient_checkpointing.")
    else:
        why = "no usable GPU detected" if not local_vram else f"~{need_gb}GB needed > {round(local_vram*HEADROOM,1)}GB usable"
        print(f"  ☁️  VERDICT: USE CLOUD   ({why})")
        print(f"  Recommended tier: {cloud_label}")
        print(f"\n  Setup (cloud):\n")
        for ln in cloud_setup(cloud_provider).splitlines():
            print(f"    {ln}")
        print(f"\n  To try staying local: step down a model size, use qlora, shorten --seq-len.")
    print(f"{bar}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
