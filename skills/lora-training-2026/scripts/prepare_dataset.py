#!/usr/bin/env python3
"""
prepare_dataset.py — Validate, convert, dedup, and split a fine-tuning dataset.

Normalizes raw data (chatml/messages, alpaca/instruction, completion, dpo) into a
uniform messages format the trainer consumes, removes exact/near duplicates, splits
train/eval, and writes a JSON stats sidecar. Pure stdlib (no datasets/pandas needed).

Usage:
    python prepare_dataset.py raw.jsonl --format chatml --split 0.9 --out data/
    python prepare_dataset.py raw.jsonl --format alpaca --dedup --out data/
    python prepare_dataset.py raw.jsonl --format dpo --no-split --out data/

Input: JSONL (one record per line) or a JSON array file.
Output: data/train.jsonl, data/eval.jsonl (unless --no-split), data/stats.json
Run visualize_dataset.py on the output before training.
"""
import argparse
import hashlib
import json
import random
import re
import sys
from pathlib import Path


def load_records(path: Path) -> list[dict]:
    text = path.read_text(encoding="utf-8").strip()
    if not text:
        return []
    if text[0] == "[":
        return json.loads(text)
    recs = []
    for i, line in enumerate(text.splitlines(), 1):
        line = line.strip()
        if not line:
            continue
        try:
            recs.append(json.loads(line))
        except json.JSONDecodeError as e:
            print(f"  ! line {i}: bad JSON ({e}) — skipped", file=sys.stderr)
    return recs


def to_messages(rec: dict, fmt: str) -> dict | None:
    """Normalize one record to {'messages': [...]} or DPO {'prompt','chosen','rejected'}."""
    if fmt == "chatml":
        msgs = rec.get("messages") or rec.get("conversations")
        if not msgs:
            return None
        # Tolerate {from, value} (ShareGPT) shape
        norm = []
        for m in msgs:
            role = m.get("role") or {"human": "user", "gpt": "assistant", "system": "system"}.get(m.get("from"), m.get("from"))
            content = m.get("content", m.get("value", ""))
            norm.append({"role": role, "content": content})
        return {"messages": norm}
    if fmt == "alpaca":
        instr = rec.get("instruction", "")
        inp = rec.get("input", "")
        out = rec.get("output", rec.get("response", ""))
        user = instr if not inp else f"{instr}\n\n{inp}"
        msgs = []
        if rec.get("system"):
            msgs.append({"role": "system", "content": rec["system"]})
        msgs += [{"role": "user", "content": user}, {"role": "assistant", "content": out}]
        return {"messages": msgs}
    if fmt == "completion":
        txt = rec.get("text", "")
        return {"text": txt} if txt else None
    if fmt == "dpo":
        if all(k in rec for k in ("prompt", "chosen", "rejected")):
            return {"prompt": rec["prompt"], "chosen": rec["chosen"], "rejected": rec["rejected"]}
        return None
    return None


def record_health(rec: dict, fmt: str) -> list[str]:
    issues = []
    if fmt == "dpo":
        if not rec.get("chosen") or not rec.get("rejected"):
            issues.append("empty chosen/rejected")
        if rec.get("chosen") == rec.get("rejected"):
            issues.append("chosen == rejected")
        return issues
    if fmt == "completion":
        if not rec.get("text", "").strip():
            issues.append("empty text")
        return issues
    msgs = rec.get("messages", [])
    roles = [m["role"] for m in msgs]
    if "assistant" not in roles:
        issues.append("no assistant turn (nothing to train on)")
    if any(not m.get("content") for m in msgs):
        issues.append("empty turn content")
    # Template residue (double-templating)
    if any(re.search(r"<\|im_(start|end)\|>|<\|eot_id\|>", str(m.get("content", ""))) for m in msgs):
        issues.append("chat-template residue in content (double-templated)")
    # Label leakage: assistant text appearing verbatim in a user/system turn
    asst = " ".join(m["content"] for m in msgs if m["role"] == "assistant")
    other = " ".join(m["content"] for m in msgs if m["role"] != "assistant")
    if len(asst) > 40 and asst.strip() in other:
        issues.append("possible label leakage (answer present in prompt)")
    return issues


def fingerprint(rec: dict, fmt: str) -> str:
    if fmt == "dpo":
        key = (rec.get("prompt", "") + "||" + rec.get("chosen", ""))
    elif fmt == "completion":
        key = rec.get("text", "")
    else:
        key = " ".join(f"{m['role']}:{m['content']}" for m in rec.get("messages", []))
    norm = re.sub(r"\s+", " ", key.lower()).strip()
    return hashlib.sha256(norm.encode()).hexdigest()


def shingles(text: str, k: int = 8) -> set[str]:
    words = re.sub(r"\s+", " ", text.lower()).split()
    return {" ".join(words[i:i + k]) for i in range(max(1, len(words) - k + 1))}


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("input", help="input JSONL or JSON array")
    p.add_argument("--format", choices=["chatml", "alpaca", "completion", "dpo"], default="chatml")
    p.add_argument("--out", default="data/", help="output directory")
    p.add_argument("--split", type=float, default=0.9, help="train fraction (rest is eval)")
    p.add_argument("--no-split", action="store_true", help="write everything to train.jsonl")
    p.add_argument("--dedup", action="store_true", help="drop exact + near duplicates")
    p.add_argument("--near-threshold", type=float, default=0.9, help="Jaccard for near-dup (with --dedup)")
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--drop-unhealthy", action="store_true", help="drop records with health issues instead of warning")
    args = p.parse_args()

    src = Path(args.input)
    if not src.exists():
        print(f"Error: not found: {src}", file=sys.stderr)
        return 2

    raw = load_records(src)
    print(f"Loaded {len(raw)} raw records ({args.format})")

    normalized, dropped_format, unhealthy = [], 0, 0
    health_counts: dict[str, int] = {}
    for rec in raw:
        norm = to_messages(rec, args.format)
        if norm is None:
            dropped_format += 1
            continue
        issues = record_health(norm, args.format)
        for iss in issues:
            health_counts[iss] = health_counts.get(iss, 0) + 1
        if issues:
            unhealthy += 1
            if args.drop_unhealthy:
                continue
        normalized.append(norm)

    # Dedup
    removed_exact = removed_near = 0
    if args.dedup:
        seen, kept, kept_shingles = set(), [], []
        for rec in normalized:
            fp = fingerprint(rec, args.format)
            if fp in seen:
                removed_exact += 1
                continue
            seen.add(fp)
            if args.format in ("chatml", "alpaca", "completion"):
                if args.format == "completion":
                    txt = rec.get("text", "")
                else:
                    txt = " ".join(m["content"] for m in rec.get("messages", []))
                sh = shingles(txt)
                is_near = False
                for prev in kept_shingles[-500:]:  # bounded comparison window
                    if prev and sh:
                        j = len(sh & prev) / len(sh | prev)
                        if j >= args.near_threshold:
                            is_near = True
                            break
                if is_near:
                    removed_near += 1
                    continue
                kept_shingles.append(sh)
            kept.append(rec)
        normalized = kept

    # Split
    rng = random.Random(args.seed)
    rng.shuffle(normalized)
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    if args.no_split or len(normalized) < 10:
        train, eval_ = normalized, []
    else:
        n_train = int(len(normalized) * args.split)
        train, eval_ = normalized[:n_train], normalized[n_train:]

    (out_dir / "train.jsonl").write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in train) + ("\n" if train else ""), encoding="utf-8")
    if eval_:
        (out_dir / "eval.jsonl").write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in eval_) + "\n", encoding="utf-8")

    stats = {
        "input": str(src), "format": args.format,
        "raw": len(raw), "dropped_unparseable_format": dropped_format,
        "unhealthy_records": unhealthy, "health_issue_counts": health_counts,
        "removed_exact_dupes": removed_exact, "removed_near_dupes": removed_near,
        "final_total": len(normalized), "train": len(train), "eval": len(eval_),
    }
    (out_dir / "stats.json").write_text(json.dumps(stats, indent=2), encoding="utf-8")

    print(f"  format-dropped: {dropped_format}   unhealthy: {unhealthy}   "
          f"deduped: {removed_exact} exact / {removed_near} near")
    if health_counts:
        print("  health issues:")
        for k, v in sorted(health_counts.items(), key=lambda x: -x[1]):
            print(f"    - {v:>5}  {k}")
    print(f"  -> {out_dir}/train.jsonl ({len(train)})" + (f", eval.jsonl ({len(eval_)})" if eval_ else " (no eval split)"))
    print(f"  -> {out_dir}/stats.json")
    print(f"\nNext: python visualize_dataset.py {out_dir}/train.jsonl --out reports/dataset.html")
    if unhealthy and not args.drop_unhealthy:
        print("  ⚠ unhealthy records kept — review, or re-run with --drop-unhealthy")
    return 0


if __name__ == "__main__":
    sys.exit(main())
