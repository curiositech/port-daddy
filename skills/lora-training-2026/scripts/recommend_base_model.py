#!/usr/bin/env python3
"""
recommend_base_model.py — Rank open-weight base models for a LoRA task.

Data-driven companion to references/base-models-2026.md. Reads model_registry.json
(same dir) and scores candidates against your task, VRAM budget, license needs,
languages, and modality. Pure stdlib — no installs, runs anywhere.

Usage:
    python recommend_base_model.py --task "support reply rewriting" --vram 16
    python recommend_base_model.py --task "extract fields from receipts" --modality vision --vram 24
    python recommend_base_model.py --task "math word problems" --need reasoning --license-need permissive
    python recommend_base_model.py --list                      # dump the registry
    python recommend_base_model.py --task "..." --json         # machine-readable

Notes:
    Heuristic ranker, not an oracle. ALWAYS confirm the exact checkpoint, license,
    and context length on the model's Hugging Face card before training. For nuanced
    calls, hand off to the base-model-selector agent.
"""
import argparse
import json
import re
import sys
from pathlib import Path

REGISTRY = Path(__file__).with_name("model_registry.json")

# Rough QLoRA peak-VRAM (GB) by total params, seq-len <= 4k, from references/local-vs-cloud.md.
def qlora_vram_gb(params_b: float) -> float:
    # ~0.6 GB/B for 4-bit weights + activation/overhead headroom band.
    return round(params_b * 0.65 + 4.0, 1)

LICENSE_RANK = {"permissive": 3, "community": 2, "research": 1, "proprietary-open": 1}

# Keyword -> good_for tag signals, used to match free-text task to model strengths.
TASK_SIGNALS = {
    "reasoning": ["reason", "math", "logic", "plan", "step", "proof", "stem", "solve"],
    "coding": ["code", "program", "python", "sql", "bug", "refactor", "function"],
    "vision": ["image", "vision", "ocr", "receipt", "document", "screenshot", "photo", "diagram", "chart"],
    "multilingual": ["spanish", "french", "german", "chinese", "japanese", "korean", "multiling", "translat", "language"],
    "edge": ["edge", "device", "on-device", "mobile", "offline", "embedded", "tiny", "small", "fast", "cheap", "local"],
    "format": ["format", "json", "rewrite", "style", "tone", "template", "classif", "route", "tag", "extract"],
    "agent": ["agent", "tool", "function call", "workflow", "orchestr"],
    "summarization": ["summar", "tldr", "digest", "brief"],
    "support": ["support", "customer", "ticket", "chat", "help desk", "faq"],
    "long-context": ["long context", "long-context", "whole document", "entire", "book", "repo", "codebase"],
}


def load_registry() -> list[dict]:
    return json.loads(REGISTRY.read_text())["models"]


def detect_tags(task: str) -> set[str]:
    t = task.lower()
    tags = set()
    for tag, kws in TASK_SIGNALS.items():
        if any(kw in t for kw in kws):
            tags.add(tag)
    return tags


def score(model: dict, args, task_tags: set[str]) -> tuple[float, list[str]]:
    reasons: list[str] = []
    s = 0.0
    good = set(model.get("good_for", [])) | set(model.get("strengths", []))

    # Task fit
    overlap = task_tags & good
    if overlap:
        s += 4 * len(overlap)
        reasons.append(f"task fit: {', '.join(sorted(overlap))}")

    # Modality hard filter
    needs_vision = args.modality == "vision" or "vision" in task_tags
    has_vision = "vision" in model.get("modality", [])
    if needs_vision and not has_vision:
        return (-1, ["excluded: task needs vision, model is text-only"])
    if needs_vision and has_vision:
        s += 5
        reasons.append("supports vision")

    # Explicit capability need
    if args.need and args.need in good:
        s += 5
        reasons.append(f"meets --need {args.need}")
    elif args.need and args.need not in good:
        s -= 3
        reasons.append(f"weak on --need {args.need}")

    # VRAM fit
    need_gb = qlora_vram_gb(model["params_b"])
    if args.vram:
        if need_gb <= args.vram * 0.85:
            s += 4
            reasons.append(f"QLoRA fits {args.vram}GB (~{need_gb}GB)")
        elif need_gb <= args.vram:
            s += 1
            reasons.append(f"tight on {args.vram}GB (~{need_gb}GB) — shorten seq/checkpoint")
        else:
            s -= 4
            reasons.append(f"needs ~{need_gb}GB > your {args.vram}GB → cloud")

    # License
    lic = model.get("license", "research")
    if args.license_need and args.license_need != "any":
        if args.license_need == "permissive" and lic != "permissive":
            s -= 4
            reasons.append(f"license {lic} not permissive")
        elif args.license_need == "community" and lic == "research":
            s -= 4
            reasons.append("research-only license")
    s += LICENSE_RANK.get(lic, 0)  # mild preference toward permissive

    # Languages
    if args.languages:
        wanted = [l.strip().lower() for l in args.languages.split(",") if l.strip()]
        ml = model.get("languages", "")
        non_english = [w for w in wanted if w not in ("en", "english")]
        if non_english and ml in ("many",) :
            s += 2
            reasons.append("broad multilingual coverage")
        elif non_english and ("eu" in ml or "zh" in ml or "+" in ml):
            s += 1
            reasons.append(f"some non-English coverage ({ml})")
        elif non_english and ml in ("en",):
            s -= 2
            reasons.append("English-centric; weak for requested languages")

    # Instruct preference (default yes)
    if model.get("instruct"):
        s += 1

    # MoE memory caveat
    if model.get("active_b"):
        reasons.append(f"MoE: size memory by TOTAL {model['params_b']}B, not active {model['active_b']}B")

    return (s, reasons)


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--task", help="free-text description of what the adapter should do")
    p.add_argument("--vram", type=float, help="local GPU VRAM in GB (omit if going cloud)")
    p.add_argument("--license-need", choices=["permissive", "community", "any"], default="any")
    p.add_argument("--languages", help="csv of required languages, e.g. en,es,zh")
    p.add_argument("--modality", choices=["text", "vision"], default="text")
    p.add_argument("--need", choices=["reasoning", "coding", "vision", "long-context"], help="hard capability requirement")
    p.add_argument("--top", type=int, default=5, help="show top N (default 5)")
    p.add_argument("--list", action="store_true", help="dump the registry and exit")
    p.add_argument("--json", action="store_true", help="machine-readable output")
    args = p.parse_args()

    models = load_registry()

    if args.list:
        for m in models:
            print(f"{m['id']:22} {m['params_b']:>5}B  {m['license']:11} ctx{m['context_k']}k  {m['hf']}")
        return 0

    if not args.task:
        p.error("--task is required (or use --list)")

    task_tags = detect_tags(args.task)
    ranked = []
    for m in models:
        s, reasons = score(m, args, task_tags)
        if s > -1:  # not hard-excluded
            ranked.append((s, m, reasons))
    ranked.sort(key=lambda x: x[0], reverse=True)
    ranked = ranked[: args.top]

    if args.json:
        print(json.dumps({
            "task": args.task, "detected_tags": sorted(task_tags),
            "results": [{"id": m["id"], "hf": m["hf"], "score": round(s, 1),
                         "est_qlora_vram_gb": qlora_vram_gb(m["params_b"]),
                         "license": m["license"], "reasons": r}
                        for s, m, r in ranked],
        }, indent=2))
        return 0

    print(f"\nTask: {args.task}")
    print(f"Detected task signals: {', '.join(sorted(task_tags)) or '(none — broaden --task)'}\n")
    print("Ranked base models (confirm checkpoint/license on HF before training):\n")
    for i, (s, m, reasons) in enumerate(ranked, 1):
        flag = "  ⭐ PRIMARY" if i == 1 else ""
        print(f"{i}. {m['id']}  ({m['params_b']}B, {m['license']}, ctx {m['context_k']}k){flag}")
        print(f"   {m['hf']}")
        print(f"   est. QLoRA VRAM ~{qlora_vram_gb(m['params_b'])}GB   score {round(s,1)}")
        for r in reasons:
            print(f"     - {r}")
        print()
    print("Next: python assess_hardware.py --model <id> --method qlora --seq-len 4096\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
