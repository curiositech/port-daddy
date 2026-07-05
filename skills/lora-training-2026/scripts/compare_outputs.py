#!/usr/bin/env python3
"""
compare_outputs.py — Side-by-side base-vs-tuned preview as one self-contained HTML.

Runs the SAME held-out prompts through the base model and the LoRA adapter, renders a
word-diff comparison, flags format compliance, runs general-ability regression probes,
and detects overfit tells (short/repetitive/looping output). The eval-visualizer agent
reads this report to decide ship / retrain / rethink.

Usage:
    python compare_outputs.py --base Qwen/Qwen3-8B-Instruct --adapter out/adapter \
        --prompts data/eval.jsonl --out reports/compare.html

    # Bring your own generations (no GPU): a JSONL of {prompt, base, tuned}
    python compare_outputs.py --pairs generations.jsonl --out reports/compare.html

Prompts file: JSONL of {"messages":[...]} (last user turn is the prompt) or {"prompt": "..."}.
Add {"expect":"json"} or {"expect_regex":"..."} per row to check format compliance.
"""
import argparse
import difflib
import html
import json
import re
import sys
from pathlib import Path

# A few general-ability probes to catch catastrophic forgetting (kept tiny, domain-neutral).
DEFAULT_PROBES = [
    "What is the capital of France?",
    "Write a one-line Python function that returns the square of a number.",
    "Summarize in one sentence: The sun is a star at the center of the solar system.",
]


def load_prompts(path: Path) -> list[dict]:
    rows = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            rows.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return rows


def prompt_text(row: dict) -> str:
    if "prompt" in row:
        return row["prompt"]
    msgs = row.get("messages", [])
    users = [m["content"] for m in msgs if m.get("role") == "user"]
    return users[-1] if users else (msgs[0]["content"] if msgs else "")


def generate_all(base_id, adapter, rows, probes, max_new_tokens):
    """Load base once, generate; then attach adapter, generate. Returns parallel lists."""
    import torch  # type: ignore
    from transformers import AutoModelForCausalLM, AutoTokenizer  # type: ignore

    tok = AutoTokenizer.from_pretrained(base_id, trust_remote_code=True)
    if tok.pad_token is None:
        tok.pad_token = tok.eos_token
    model = AutoModelForCausalLM.from_pretrained(
        base_id, torch_dtype=torch.bfloat16, device_map="auto", trust_remote_code=True)

    all_prompts = [prompt_text(r) for r in rows] + list(probes)

    def gen(m):
        outs = []
        for ptxt in all_prompts:
            msgs = [{"role": "user", "content": ptxt}]
            ids = tok.apply_chat_template(msgs, return_tensors="pt", add_generation_prompt=True).to(m.device)
            with torch.no_grad():
                out = m.generate(ids, max_new_tokens=max_new_tokens, do_sample=False,
                                 pad_token_id=tok.pad_token_id)
            outs.append(tok.decode(out[0][ids.shape[1]:], skip_special_tokens=True).strip())
        return outs

    base_outs = gen(model)
    from peft import PeftModel  # type: ignore
    tuned = PeftModel.from_pretrained(model, adapter)
    tuned_outs = gen(tuned)
    return all_prompts, base_outs, tuned_outs


def word_diff(a: str, b: str) -> str:
    sm = difflib.SequenceMatcher(None, a.split(), b.split())
    out = []
    for op, i1, i2, j1, j2 in sm.get_opcodes():
        bt = " ".join(b.split()[j1:j2])
        at = " ".join(a.split()[i1:i2])
        if op == "equal":
            out.append(html.escape(bt))
        elif op == "insert":
            out.append(f'<ins>{html.escape(bt)}</ins>')
        elif op == "delete":
            out.append(f'<del>{html.escape(at)}</del>')
        elif op == "replace":
            out.append(f'<del>{html.escape(at)}</del> <ins>{html.escape(bt)}</ins>')
    return " ".join(out)


def overfit_tells(text: str) -> list[str]:
    tells = []
    words = text.split()
    if len(words) < 3:
        tells.append("very short")
    # repetition: any 4-gram repeated 3+ times
    grams = [" ".join(words[i:i+4]) for i in range(len(words) - 3)]
    from collections import Counter
    c = Counter(grams)
    if c and c.most_common(1)[0][1] >= 3:
        tells.append("repetition/looping")
    # degenerate single-token spam
    if words and len(set(words)) / len(words) < 0.4 and len(words) > 8:
        tells.append("low lexical diversity")
    return tells


def format_ok(text: str, row: dict) -> str | None:
    if row.get("expect") == "json":
        try:
            json.loads(text[text.find("{"): text.rfind("}") + 1])
            return "json ✓"
        except Exception:
            return "json ✗"
    if row.get("expect_regex"):
        return ("regex ✓" if re.search(row["expect_regex"], text) else "regex ✗")
    return None


CSS = """
body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;margin:0;background:#f0f2f5;color:#222}
.wrap{max-width:1000px;margin:0 auto;padding:24px}
h1{font-size:22px;margin:0 0 4px}.sub{color:#666;font-size:13px;margin:0 0 18px}
.card{background:#fff;border:1px solid #e2e4e8;border-radius:8px;padding:16px;margin:0 0 14px}
.card h2{font-size:15px;margin:0 0 10px}
.prompt{font-size:13px;background:#f4f6f9;border-left:3px solid #888;padding:6px 10px;margin:0 0 8px}
.cols{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.col{border:1px solid #e6e8ec;border-radius:6px;padding:8px}
.col h3{font-size:12px;margin:0 0 6px;color:#777;text-transform:uppercase}
.base{background:#fbfbfb}.tuned{background:#f5faff}
pre{white-space:pre-wrap;word-break:break-word;font-size:12.5px;margin:0;font-family:ui-monospace,monospace}
ins{background:#d6f5d6;text-decoration:none}del{background:#f7d6d6;text-decoration:line-through;opacity:.7}
.tag{display:inline-block;font-size:11px;padding:2px 8px;border-radius:10px;margin-right:6px}
.t-improved{background:#d6f5d6;color:#1e7a1e}.t-regressed{background:#f7d6d6;color:#a3261c}
.t-unchanged{background:#eee;color:#666}.t-warn{background:#fff3cd;color:#856404}
.kpis{display:flex;gap:14px;flex-wrap:wrap}.kpi{flex:1;min-width:120px;background:#f7f9fc;border:1px solid #e6ebf2;border-radius:6px;padding:10px}
.kpi .v{font-size:20px;font-weight:600}.kpi .l{font-size:11px;color:#777;text-transform:uppercase}
.probe{background:#fffaf3}
"""


def build_html(prompts, base_outs, tuned_outs, rows, n_eval, src_name):
    cards, improved, regressed, unchanged, fmt_pass, fmt_total = [], 0, 0, 0, 0, 0
    for i, (ptxt, b, t) in enumerate(zip(prompts, base_outs, tuned_outs)):
        is_probe = i >= n_eval
        row = rows[i] if i < n_eval else {}
        tells = overfit_tells(t)
        changed = b.strip() != t.strip()
        # crude heuristic label
        if is_probe:
            label = "regressed" if (len(t.split()) < max(2, len(b.split()) // 3) or tells) else "unchanged"
        else:
            label = "improved" if changed and not tells else ("unchanged" if not changed else "regressed")
        if not is_probe:
            if label == "improved": improved += 1
            elif label == "regressed": regressed += 1
            else: unchanged += 1
        else:
            if label == "regressed": regressed += 1
        fchk = format_ok(t, row)
        if fchk:
            fmt_total += 1
            if fchk.endswith("✓"): fmt_pass += 1
        tags = [f'<span class="tag t-{label}">{label}</span>']
        if is_probe: tags.append('<span class="tag t-warn">regression probe</span>')
        if fchk: tags.append(f'<span class="tag t-{"improved" if fchk.endswith("✓") else "regressed"}">{fchk}</span>')
        for tl in tells: tags.append(f'<span class="tag t-warn">{tl}</span>')
        cards.append(f"""<div class="card {'probe' if is_probe else ''}">
<div>{''.join(tags)}</div>
<div class="prompt">{html.escape(ptxt[:400])}</div>
<div class="cols">
<div class="col base"><h3>base</h3><pre>{html.escape(b[:1500])}</pre></div>
<div class="col tuned"><h3>tuned (diff vs base)</h3><pre>{word_diff(b, t)[:4000]}</pre></div>
</div></div>""")

    fmt_str = f"{fmt_pass}/{fmt_total}" if fmt_total else "n/a"
    verdict = ("SHIP" if improved > regressed and regressed == 0
               else "RETRAIN" if improved >= regressed
               else "RETHINK")
    summary = f"""<div class="card"><h2>Verdict: {verdict}</h2><div class="kpis">
<div class="kpi"><div class="v">{improved}</div><div class="l">improved</div></div>
<div class="kpi"><div class="v">{unchanged}</div><div class="l">unchanged</div></div>
<div class="kpi"><div class="v">{regressed}</div><div class="l">regressed</div></div>
<div class="kpi"><div class="v">{fmt_str}</div><div class="l">format compliance</div></div>
</div><p class="sub" style="margin-top:10px">Heuristic labels — read the diffs yourself. SHIP only if the
target behavior improved AND the regression probes held. See references/visualization-guide.md.</p></div>"""

    return f"""<!doctype html><html><head><meta charset="utf-8"><title>Compare — {html.escape(src_name)}</title>
<style>{CSS}</style></head><body><div class="wrap">
<h1>Base vs Tuned</h1><p class="sub">{n_eval} eval prompts + {len(prompts)-n_eval} regression probes · greedy decoding · no telemetry</p>
{summary}{''.join(cards)}
<p class="sub">Generated by compare_outputs.py · open offline.</p></div></body></html>"""


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--base", help="base model id")
    p.add_argument("--adapter", help="path to trained LoRA adapter")
    p.add_argument("--prompts", help="held-out prompts JSONL")
    p.add_argument("--pairs", help="precomputed {prompt,base,tuned} JSONL (no GPU needed)")
    p.add_argument("--out", default="reports/compare.html")
    p.add_argument("--max-new-tokens", type=int, default=256)
    p.add_argument("--no-probes", action="store_true", help="skip general-ability regression probes")
    args = p.parse_args()

    if args.pairs:
        rows = load_prompts(Path(args.pairs))
        prompts = [r.get("prompt", "") for r in rows]
        base_outs = [r.get("base", "") for r in rows]
        tuned_outs = [r.get("tuned", "") for r in rows]
        n_eval = len(rows)
        rows_meta = rows
    else:
        if not (args.base and args.adapter and args.prompts):
            p.error("need --base, --adapter, --prompts (or use --pairs)")
        rows_meta = load_prompts(Path(args.prompts))
        n_eval = len(rows_meta)
        probes = [] if args.no_probes else DEFAULT_PROBES
        try:
            prompts, base_outs, tuned_outs = generate_all(
                args.base, args.adapter, rows_meta, probes, args.max_new_tokens)
        except ImportError as e:
            print(f"Error: missing dependency: {e}", file=sys.stderr)
            print("Install: uv pip install transformers peft accelerate torch", file=sys.stderr)
            print("Or generate pairs elsewhere and pass --pairs generations.jsonl", file=sys.stderr)
            return 3

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(build_html(prompts, base_outs, tuned_outs, rows_meta, n_eval, out.name), encoding="utf-8")
    print(f"Wrote {out}  ({n_eval} eval prompts + {len(prompts)-n_eval} probes)")
    print("Open it and judge: target behavior improved AND probes held = ship.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
