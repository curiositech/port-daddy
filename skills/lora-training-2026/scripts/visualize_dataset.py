#!/usr/bin/env python3
"""
visualize_dataset.py — Single-file HTML report to eyeball a dataset before training.

Renders token-length distribution, truncation gauge, role balance, duplicate clusters,
length outliers, sample conversations, and a rough cost estimate — all into ONE
self-contained HTML file (inline CSS + SVG, no internet, no telemetry). Safe for
sensitive data. Pure stdlib; uses a real tokenizer if transformers is installed,
otherwise a calibrated heuristic (chars/3.6).

Usage:
    python visualize_dataset.py data/train.jsonl --out reports/dataset.html
    python visualize_dataset.py data/train.jsonl --out reports/dataset.html \
        --tokenizer Qwen/Qwen3-8B-Instruct --max-seq-len 4096 --epochs 3
    python visualize_dataset.py data/train.jsonl --json   # stats only, no HTML

Open the HTML in a browser. Read order: truncation -> roles -> dupes -> samples.
See references/visualization-guide.md.
"""
import argparse
import html
import json
import re
import sys
from collections import Counter
from pathlib import Path


def load(path: Path) -> list[dict]:
    recs = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line:
            try:
                recs.append(json.loads(line))
            except json.JSONDecodeError:
                pass
    return recs


def get_tokenizer(name: str | None):
    if not name:
        return None
    try:
        from transformers import AutoTokenizer  # type: ignore
        # trust_remote_code off by default (executes arbitrary repo code); the
        # heuristic fallback below covers the rare tokenizer that needs it.
        return AutoTokenizer.from_pretrained(name, trust_remote_code=False)
    except Exception as e:
        print(f"  (tokenizer '{name}' unavailable: {e}; using heuristic)", file=sys.stderr)
        return None


def count_tokens(text: str, tok) -> int:
    if tok is not None:
        try:
            return len(tok.encode(text))
        except Exception:
            pass
    # Heuristic: ~3.6 chars/token for mixed English; conservative.
    return max(1, round(len(text) / 3.6))


def record_text(rec: dict) -> tuple[str, list[str]]:
    """Return (full_text, roles) for length/role analysis."""
    if "text" in rec:
        return rec["text"], ["completion"]
    if "chosen" in rec:  # dpo
        return rec.get("prompt", "") + rec.get("chosen", ""), ["prompt", "chosen", "rejected"]
    msgs = rec.get("messages", [])
    return " ".join(m.get("content", "") for m in msgs), [m.get("role", "?") for m in msgs]


def histogram_svg(values, buckets=24, width=680, height=180, threshold=None):
    if not values:
        return "<p>no data</p>"
    lo, hi = min(values), max(values)
    if hi == lo:
        hi = lo + 1
    step = (hi - lo) / buckets
    counts = [0] * buckets
    for v in values:
        idx = min(buckets - 1, int((v - lo) / step))
        counts[idx] += 1
    maxc = max(counts) or 1
    bw = width / buckets
    bars = []
    for i, c in enumerate(counts):
        bh = (c / maxc) * (height - 30)
        x = i * bw
        y = height - 20 - bh
        center = lo + (i + 0.5) * step
        color = "#d9534f" if (threshold and center > threshold) else "#4a90d9"
        bars.append(f'<rect x="{x:.1f}" y="{y:.1f}" width="{bw-1:.1f}" height="{bh:.1f}" fill="{color}"><title>{int(center)} tok: {c}</title></rect>')
    thr_line = ""
    if threshold and lo <= threshold <= hi:
        tx = (threshold - lo) / (hi - lo) * width
        thr_line = (f'<line x1="{tx:.1f}" y1="0" x2="{tx:.1f}" y2="{height-20}" stroke="#d9534f" stroke-dasharray="4" stroke-width="2"/>'
                    f'<text x="{tx+3:.1f}" y="12" fill="#d9534f" font-size="11">seq-len {threshold}</text>')
    return (f'<svg width="{width}" height="{height}" style="background:#fafafa;border:1px solid #ddd">'
            + "".join(bars) + thr_line
            + f'<text x="0" y="{height-4}" font-size="11" fill="#666">{int(lo)} tok</text>'
            + f'<text x="{width-50}" y="{height-4}" font-size="11" fill="#666">{int(hi)} tok</text></svg>')


def bar_row(label, count, total, color="#4a90d9"):
    pct = (count / total * 100) if total else 0
    return (f'<div class="rolebar"><span class="rl">{html.escape(label)}</span>'
            f'<span class="rt"><span class="rf" style="width:{pct:.1f}%;background:{color}"></span></span>'
            f'<span class="rc">{count} ({pct:.0f}%)</span></div>')


def render_sample(rec: dict) -> str:
    if "text" in rec:
        return f'<div class="turn completion"><b>completion</b><pre>{html.escape(rec["text"][:1200])}</pre></div>'
    if "chosen" in rec:
        return (f'<div class="turn user"><b>prompt</b><pre>{html.escape(rec.get("prompt","")[:800])}</pre></div>'
                f'<div class="turn chosen"><b>chosen ✓</b><pre>{html.escape(rec.get("chosen","")[:800])}</pre></div>'
                f'<div class="turn rejected"><b>rejected ✗</b><pre>{html.escape(rec.get("rejected","")[:800])}</pre></div>')
    out = []
    for m in rec.get("messages", []):
        role = m.get("role", "?")
        trained = ' <em>(trained)</em>' if role == "assistant" else ' <em>(masked)</em>'
        out.append(f'<div class="turn {role}"><b>{html.escape(role)}{trained}</b><pre>{html.escape(str(m.get("content",""))[:1000])}</pre></div>')
    return "".join(out)


CSS = """
body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;margin:0;background:#f0f2f5;color:#222}
.wrap{max-width:840px;margin:0 auto;padding:24px}
h1{font-size:22px;margin:0 0 4px} .sub{color:#666;margin:0 0 20px;font-size:13px}
.card{background:#fff;border:1px solid #e2e4e8;border-radius:8px;padding:18px;margin:0 0 16px}
.card h2{font-size:15px;margin:0 0 12px;border-bottom:1px solid #eee;padding-bottom:8px}
.kpis{display:flex;flex-wrap:wrap;gap:14px}
.kpi{flex:1;min-width:120px;background:#f7f9fc;border:1px solid #e6ebf2;border-radius:6px;padding:10px}
.kpi .v{font-size:20px;font-weight:600} .kpi .l{font-size:11px;color:#777;text-transform:uppercase}
.rolebar{display:flex;align-items:center;gap:10px;margin:6px 0}
.rl{width:90px;font-size:13px} .rt{flex:1;height:14px;background:#eee;border-radius:7px;overflow:hidden}
.rf{display:block;height:100%} .rc{width:110px;text-align:right;font-size:12px;color:#555}
.gauge{height:26px;border-radius:13px;background:#e8f0e8;overflow:hidden;position:relative}
.gauge .fill{height:100%} .gauge .txt{position:absolute;left:10px;top:4px;font-size:13px;font-weight:600}
.flag{padding:8px 12px;border-radius:6px;margin:6px 0;font-size:13px}
.flag.red{background:#fdecea;color:#a3261c;border:1px solid #f5c6c0}
.flag.green{background:#eaf7ea;color:#1e7a1e;border:1px solid #bfe6bf}
.flag.yellow{background:#fff8e1;color:#8a6d00;border:1px solid #f0e0a0}
.turn{border-left:3px solid #ccc;padding:6px 10px;margin:6px 0;background:#fafbfc}
.turn.assistant,.turn.chosen{border-color:#4a90d9} .turn.user{border-color:#9aa}
.turn.rejected{border-color:#d9534f} .turn b{font-size:12px;color:#555} .turn em{color:#999;font-weight:400}
pre{white-space:pre-wrap;word-break:break-word;margin:4px 0 0;font-size:12px;font-family:ui-monospace,monospace;color:#333}
details summary{cursor:pointer;font-size:13px;color:#4a90d9}
"""


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("input", help="prepared JSONL (from prepare_dataset.py)")
    p.add_argument("--out", default="reports/dataset.html")
    p.add_argument("--tokenizer", help="HF tokenizer name for exact counts (optional)")
    p.add_argument("--max-seq-len", type=int, default=4096)
    p.add_argument("--epochs", type=int, default=3)
    p.add_argument("--max-samples", type=int, default=8, help="sample conversations to render")
    p.add_argument("--json", action="store_true", help="print stats JSON, skip HTML")
    args = p.parse_args()

    src = Path(args.input)
    if not src.exists():
        print(f"Error: not found: {src}", file=sys.stderr)
        return 2
    recs = load(src)
    if not recs:
        print("Error: no valid records", file=sys.stderr)
        return 2

    tok = get_tokenizer(args.tokenizer)
    lengths, role_counter, fps = [], Counter(), Counter()
    for rec in recs:
        text, roles = record_text(rec)
        lengths.append(count_tokens(text, tok))
        role_counter.update(roles)
        fps[re.sub(r"\s+", " ", text.lower()).strip()[:400]] += 1

    lengths_sorted = sorted(lengths)
    n = len(lengths)
    def pct(q):
        return lengths_sorted[min(n - 1, int(q * n))]
    p50, p95, p99, mx = pct(0.50), pct(0.95), pct(0.99), max(lengths)
    total_tokens = sum(lengths)
    truncated = sum(1 for l in lengths if l > args.max_seq_len)
    trunc_pct = truncated / n * 100
    dupes = sum(c - 1 for c in fps.values() if c > 1)
    dup_pct = dupes / n * 100
    no_assistant = sum(1 for r in recs if "messages" in r and not any(m.get("role") == "assistant" for m in r["messages"]))
    eff_tokens = min(total_tokens, n * args.max_seq_len)  # after truncation
    tokens_per_epoch = eff_tokens
    total_train_tokens = tokens_per_epoch * args.epochs

    stats = {
        "records": n, "total_tokens": total_tokens, "tokenizer": args.tokenizer or "heuristic(chars/3.6)",
        "len_p50": p50, "len_p95": p95, "len_p99": p99, "len_max": mx,
        "max_seq_len": args.max_seq_len, "truncated": truncated, "truncated_pct": round(trunc_pct, 2),
        "duplicate_rows": dupes, "duplicate_pct": round(dup_pct, 2),
        "records_without_assistant": no_assistant,
        "roles": dict(role_counter), "epochs": args.epochs,
        "tokens_per_epoch_after_trunc": tokens_per_epoch, "total_train_tokens": total_train_tokens,
    }

    if args.json:
        print(json.dumps(stats, indent=2))
        return 0

    # Flags
    flags = []
    if trunc_pct > 3:
        flags.append(("red", f"{trunc_pct:.1f}% of examples exceed seq-len {args.max_seq_len} and will be TRUNCATED. Raise --max-seq-len toward p95 ({p95}) or split long examples."))
    elif trunc_pct > 0:
        flags.append(("yellow", f"{trunc_pct:.1f}% truncated at {args.max_seq_len}. Acceptable, but p95 is {p95}."))
    else:
        flags.append(("green", f"No truncation at seq-len {args.max_seq_len} (p99={p99})."))
    if no_assistant:
        flags.append(("red", f"{no_assistant} record(s) have no assistant turn — nothing to train on. Re-run prepare_dataset.py --drop-unhealthy."))
    if dup_pct > 5:
        flags.append(("red", f"{dup_pct:.1f}% duplicate rows ({dupes}) — memorization risk. Re-run prepare_dataset.py --dedup."))
    elif dup_pct > 0:
        flags.append(("yellow", f"{dup_pct:.1f}% duplicate rows ({dupes})."))
    else:
        flags.append(("green", "No exact duplicate rows detected."))
    if mx > 3 * p95:
        flags.append(("yellow", f"Long tail: max {mx} tok vs p95 {p95}. A few outliers inflate seq-len/cost — trim or bucket."))

    # Build HTML
    role_total = sum(role_counter.values())
    role_html = "".join(bar_row(r, c, role_total,
                                 "#4a90d9" if r in ("assistant", "chosen") else "#9aa")
                        for r, c in role_counter.most_common())
    gauge_color = "#d9534f" if trunc_pct > 3 else ("#e0a800" if trunc_pct > 0 else "#3a3")
    gauge = (f'<div class="gauge"><div class="fill" style="width:{min(100,trunc_pct):.1f}%;background:{gauge_color}"></div>'
             f'<div class="txt">{trunc_pct:.1f}% truncated at {args.max_seq_len} tok</div></div>')
    samples = "".join(f'<details><summary>Sample #{i+1} ({count_tokens(record_text(r)[0], tok)} tok)</summary>{render_sample(r)}</details>'
                      for i, r in enumerate(recs[:args.max_samples]))
    flags_html = "".join(f'<div class="flag {c}">{html.escape(m)}</div>' for c, m in flags)

    html_doc = f"""<!doctype html><html><head><meta charset="utf-8">
<title>Dataset Report — {html.escape(src.name)}</title><style>{CSS}</style></head><body><div class="wrap">
<h1>Dataset Report</h1>
<p class="sub">{html.escape(str(src))} · {n} records · tokenizer: {html.escape(stats['tokenizer'])}</p>

<div class="card"><h2>Verdict</h2>{flags_html}</div>

<div class="card"><h2>Summary</h2><div class="kpis">
<div class="kpi"><div class="v">{n:,}</div><div class="l">examples</div></div>
<div class="kpi"><div class="v">{total_tokens:,}</div><div class="l">total tokens</div></div>
<div class="kpi"><div class="v">{p50}/{p95}</div><div class="l">p50 / p95 len</div></div>
<div class="kpi"><div class="v">{total_train_tokens:,}</div><div class="l">tokens × {args.epochs} epochs</div></div>
</div></div>

<div class="card"><h2>Token-length distribution</h2>
{histogram_svg(lengths, threshold=args.max_seq_len)}
<p class="sub">p50 {p50} · p95 {p95} · p99 {p99} · max {mx}. Set max_seq_len near p95, not max.</p></div>

<div class="card"><h2>Truncation</h2>{gauge}</div>

<div class="card"><h2>Role balance</h2>{role_html}</div>

<div class="card"><h2>Cost estimate (rough)</h2>
<p class="sub">~{total_train_tokens:,} training tokens over {args.epochs} epoch(s) after truncation.
Small QLoRA jobs at this scale are typically minutes-to-~1h of single-GPU time. Long tails and extra
epochs are where surprise cost comes from.</p></div>

<div class="card"><h2>Sample conversations</h2>
<p class="sub">Confirm the chat template renders correctly and assistant turns are the trained spans.</p>
{samples}</div>

<p class="sub">Generated by visualize_dataset.py · no telemetry · open offline.</p>
</div></body></html>"""

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(html_doc, encoding="utf-8")
    print(f"Wrote {out}  ({n} records, p95={p95} tok, trunc={trunc_pct:.1f}%, dupes={dup_pct:.1f}%)")
    for c, m in flags:
        sym = {"red": "✗", "yellow": "⚠", "green": "✓"}[c]
        print(f"  {sym} {m}")
    print(f"\nOpen {out} in a browser. Next: train, then compare_outputs.py.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
