#!/usr/bin/env python3
"""
merge_and_export.py — Merge a LoRA adapter into the base and export for serving.

Loads the base in 16-bit (mergeable), folds in the adapter (merge_and_unload), and
writes either safetensors (vLLM/TGI/HF) or GGUF (Ollama/llama.cpp, optionally quantized).
The tokenizer is copied alongside so the export is self-sufficient.

Usage:
    python merge_and_export.py --base Qwen/Qwen3-8B-Instruct --adapter out/adapter \
        --format safetensors --out exports/qwen3-8b-tuned
    python merge_and_export.py --base Qwen/Qwen3-8B-Instruct --adapter out/adapter \
        --format gguf --quant q4_k_m --out exports/qwen3-8b-tuned

GGUF requires llama.cpp's convert script. Point to it with --llama-cpp /path/to/llama.cpp
or have it on PATH. See references/troubleshooting.md "Adapter won't merge / export fails".
"""
import argparse
import shutil
import subprocess
import sys
from pathlib import Path


def merge(base_id: str, adapter: str, out_dir: Path, trust_remote_code: bool = False):
    import torch  # type: ignore
    from transformers import AutoModelForCausalLM, AutoTokenizer  # type: ignore
    from peft import PeftModel  # type: ignore

    print(f"[merge] loading base {base_id} in bf16 (merge requires non-4bit)…")
    model = AutoModelForCausalLM.from_pretrained(
        base_id, torch_dtype=torch.bfloat16, device_map="cpu", trust_remote_code=trust_remote_code)
    print(f"[merge] applying adapter {adapter}…")
    model = PeftModel.from_pretrained(model, adapter)
    print("[merge] merge_and_unload()…")
    model = model.merge_and_unload()
    out_dir.mkdir(parents=True, exist_ok=True)
    model.save_pretrained(out_dir, safe_serialization=True)
    AutoTokenizer.from_pretrained(base_id, trust_remote_code=trust_remote_code).save_pretrained(out_dir)
    print(f"[merge] merged safetensors -> {out_dir}")


def to_gguf(merged_dir: Path, out_dir: Path, quant: str, llama_cpp: str | None):
    # Find llama.cpp's converter
    candidates = []
    if llama_cpp:
        candidates += [Path(llama_cpp) / "convert_hf_to_gguf.py", Path(llama_cpp) / "convert-hf-to-gguf.py"]
    which = shutil.which("convert_hf_to_gguf.py")
    if which:
        candidates.append(Path(which))
    convert = next((c for c in candidates if c.exists()), None)
    if not convert:
        print("Error: llama.cpp converter not found. Pass --llama-cpp /path/to/llama.cpp", file=sys.stderr)
        print("  git clone https://github.com/ggerganov/llama.cpp", file=sys.stderr)
        return 3
    out_dir.mkdir(parents=True, exist_ok=True)
    f16 = out_dir / "model-f16.gguf"
    print(f"[gguf] converting -> {f16}…")
    subprocess.run([sys.executable, str(convert), str(merged_dir), "--outfile", str(f16), "--outtype", "f16"], check=True)
    if quant and quant != "f16":
        qbin = shutil.which("llama-quantize") or (str(Path(llama_cpp) / "llama-quantize") if llama_cpp else None)
        if not qbin or not Path(qbin).exists():
            print(f"[gguf] f16 GGUF written ({f16}). For {quant}, build llama.cpp and run:", file=sys.stderr)
            print(f"  llama-quantize {f16} {out_dir}/model-{quant}.gguf {quant}", file=sys.stderr)
            return 0
        qout = out_dir / f"model-{quant}.gguf"
        print(f"[gguf] quantizing -> {qout} ({quant})…")
        subprocess.run([qbin, str(f16), str(qout), quant], check=True)
        print(f"[gguf] done. Run with Ollama:  ollama create mymodel -f Modelfile  (FROM {qout})")
    return 0


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--base", required=True, help="base model id")
    p.add_argument("--adapter", required=True, help="trained LoRA adapter dir")
    p.add_argument("--format", choices=["safetensors", "gguf"], default="safetensors")
    p.add_argument("--quant", default="q4_k_m", help="GGUF quant (q4_k_m, q5_k_m, q8_0, f16)")
    p.add_argument("--out", required=True, help="output directory")
    p.add_argument("--llama-cpp", help="path to a llama.cpp checkout (for GGUF)")
    p.add_argument("--keep-merged", action="store_true", help="keep intermediate safetensors when exporting GGUF")
    p.add_argument("--trust-remote-code", action="store_true",
                   help="allow executing custom modeling code shipped in the base model repo "
                        "(only needed for a handful of architectures not yet upstreamed into "
                        "transformers; off by default because it runs arbitrary code from the repo)")
    args = p.parse_args()

    out = Path(args.out)
    merged = out if args.format == "safetensors" else out / "_merged"
    try:
        merge(args.base, args.adapter, merged, trust_remote_code=args.trust_remote_code)
    except ImportError as e:
        print(f"Error: missing dependency: {e}", file=sys.stderr)
        print("Install: uv pip install transformers peft accelerate torch safetensors", file=sys.stderr)
        return 3

    rc = 0
    if args.format == "gguf":
        rc = to_gguf(merged, out, args.quant, args.llama_cpp)
        if not args.keep_merged and merged.exists():
            shutil.rmtree(merged, ignore_errors=True)
        print(f"\nExport complete -> {out}  (GGUF for Ollama/llama.cpp)")
    else:
        print(f"\nExport complete -> {out}  (safetensors for vLLM/TGI/HF)")
        print(f"  Serve example:  vllm serve {out}")
    return rc


if __name__ == "__main__":
    sys.exit(main())
