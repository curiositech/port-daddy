#!/usr/bin/env bash
# train_lora.sh — One-shot cloud launcher wrapping train_lora.py.
#
# Makes "train in the cloud" a single command. Provisions a GPU sized to your config,
# syncs code+data, runs train_lora.py, and brings the adapter back.
#
# Usage:
#   bash train_lora.sh --provider modal  --config configs/run.yaml --gpu A100-40GB
#   bash train_lora.sh --provider runpod --config configs/run.yaml --host root@1.2.3.4 --port 22
#   bash train_lora.sh --provider local  --config configs/run.yaml      # just runs train_lora.py
#
# Providers:
#   local  — run train_lora.py here (sanity)
#   modal  — serverless GPU (recommended; needs `pip install modal && modal token new`)
#   runpod — SSH into an existing pod (--host required); rsyncs and runs
#
# Tip: run assess_hardware.py first to pick --gpu. Always retrieve the adapter before
# the cloud instance is reclaimed — this script does that for you on success.
set -euo pipefail

PROVIDER="" ; CONFIG="configs/run.yaml" ; GPU="A100-40GB" ; HOST="" ; PORT="22"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --provider) PROVIDER="$2"; shift 2;;
    --config)   CONFIG="$2";   shift 2;;
    --gpu)      GPU="$2";      shift 2;;
    --host)     HOST="$2";     shift 2;;
    --port)     PORT="$2";     shift 2;;
    -h|--help)  sed -n '2,30p' "$0"; exit 0;;
    *) echo "Unknown arg: $1" >&2; exit 2;;
  esac
done

[[ -z "$PROVIDER" ]] && { echo "Error: --provider required (local|modal|runpod)" >&2; exit 2; }
[[ -f "$CONFIG" ]] || { echo "Error: config not found: $CONFIG" >&2; exit 2; }

# Parse a few fields from the YAML config (flat keys) without yq.
cfg_get() { grep -E "^${1}:" "$CONFIG" | head -1 | sed -E "s/^${1}:[[:space:]]*//; s/[[:space:]]*#.*//; s/['\"]//g"; }
TRAIN_FILE="$(cfg_get train_file)"; TRAIN_FILE="${TRAIN_FILE:-data/train.jsonl}"
OUTPUT_DIR="$(cfg_get output_dir)"; OUTPUT_DIR="${OUTPUT_DIR:-out/adapter}"
MODEL="$(cfg_get model)"

echo "==> provider=$PROVIDER  model=$MODEL  gpu=$GPU  config=$CONFIG"
echo "==> validating config (dry-run)…"
python3 "$SCRIPT_DIR/train_lora.py" --config "$CONFIG" --dry-run

PIP_INSTALL='uv pip install "unsloth @ git+https://github.com/unslothai/unsloth.git" trl peft transformers datasets accelerate bitsandbytes || pip install unsloth trl peft transformers datasets accelerate bitsandbytes'

case "$PROVIDER" in
  local)
    python3 "$SCRIPT_DIR/train_lora.py" --config "$CONFIG"
    ;;

  modal)
    command -v modal >/dev/null || { echo "Install Modal: pip install modal && modal token new" >&2; exit 3; }
    GEN="$(mktemp -d)/lora_modal_app.py"
    cat > "$GEN" <<PYEOF
# Auto-generated Modal app — provisions a $GPU GPU, trains, returns the adapter.
import modal
app = modal.App("lora-training-2026")
image = (modal.Image.debian_slim()
         .pip_install("unsloth", "trl", "peft", "transformers", "datasets", "accelerate", "bitsandbytes")
         .add_local_dir(".", remote_path="/workspace"))
vol = modal.Volume.from_name("lora-adapters", create_if_missing=True)

@app.function(gpu="${GPU%%-*}", image=image, timeout=60*60*4, volumes={"/adapters": vol})
def run():
    import subprocess, shutil, os
    os.chdir("/workspace")
    subprocess.run(["python", "scripts/train_lora.py", "--config", "$CONFIG"], check=True)
    shutil.copytree("$OUTPUT_DIR", "/adapters/$OUTPUT_DIR", dirs_exist_ok=True)
    vol.commit()
    print("adapter saved to modal volume 'lora-adapters'")

@app.local_entrypoint()
def main():
    run.remote()
PYEOF
    echo "==> launching on Modal ($GPU)…"
    ( cd "$(dirname "$CONFIG")/.." 2>/dev/null || true; modal run "$GEN" )
    echo "==> done. Pull the adapter:  modal volume get lora-adapters $OUTPUT_DIR ./$OUTPUT_DIR"
    ;;

  runpod)
    [[ -z "$HOST" ]] && { echo "Error: --host root@IP required for runpod" >&2; exit 2; }
    echo "==> syncing to $HOST…"
    rsync -az -e "ssh -p $PORT" --exclude '.git' --exclude 'out' ./ "$HOST:/workspace/lora/"
    echo "==> installing + training on pod…"
    ssh -p "$PORT" "$HOST" "cd /workspace/lora && ($PIP_INSTALL) && python3 scripts/train_lora.py --config $(printf '%q' "$CONFIG")"
    echo "==> retrieving adapter (before reclaim!)…"
    mkdir -p "$OUTPUT_DIR"
    rsync -az -e "ssh -p $PORT" "$HOST:/workspace/lora/$OUTPUT_DIR/" "./$OUTPUT_DIR/"
    echo "==> adapter at ./$OUTPUT_DIR"
    ;;

  *) echo "Unknown provider: $PROVIDER (use local|modal|runpod)" >&2; exit 2;;
esac

echo "==> next: python3 $SCRIPT_DIR/compare_outputs.py --base $MODEL --adapter $OUTPUT_DIR --prompts data/eval.jsonl --out reports/compare.html"
