#!/usr/bin/env python3
"""humanize_review.py — flag AI-isms in copy/media and emit a static HTML fix plan.

Stdlib only. Two detection layers:

  1. STRUCTURAL (this script): measurable signals only — densities, variances,
     ratios, codepoints, hex values, font names. No keyword classification of
     free text; that has catastrophic recall and is banned in this codebase.
  2. LLM-JUDGE (the agent running the skill): phrase-level tropes are judged
     by the model against references/catalog.json, written to a findings JSON,
     and merged into the report via --findings.

Usage:
  python3 humanize_review.py FILE [FILE...] --out report.html
  python3 humanize_review.py FILE --findings findings.json --out report.html
  python3 humanize_review.py --selftest

Findings JSON (from the agent's judge pass):
  [{"file": "...", "line": 12, "excerpt": "...", "ism": "not-x-but-y",
    "dialect": "claude", "severity": "high", "explanation": "...",
    "rewrite": "..."}]
"""

import argparse
import html
import json
import math
import re
import statistics
import sys
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

# ---------------------------------------------------------------- structural

# Hex colors that ship as defaults in AI-generated UI (Tailwind indigo/violet/
# blue families). Exact-match on structured CSS values, which is allowed.
AI_DEFAULT_HEXES = {
    "6366f1": "indigo-500 — the v0/Lovable/artifact default accent",
    "8b5cf6": "violet-500 — the AI gradient partner",
    "7c3aed": "violet-600",
    "4f46e5": "indigo-600",
    "a855f7": "purple-500",
    "3b82f6": "blue-500 — the other default accent",
    "2563eb": "blue-600",
}

# Font families that read as "nobody chose this" in 2025+. Structured CSS
# values, exact match allowed.
AI_DEFAULT_FONTS = {
    "inter": "Inter — the unchosen default of AI-generated UI",
    "geist": "Geist — Vercel default, marks v0 output",
    "sora": "Sora — AI-landing-page cliché",
    "manrope": "Manrope — AI-landing-page cliché",
    "space grotesk": "Space Grotesk — AI-landing-page cliché",
}

EMOJI_RANGES = (
    (0x1F300, 0x1FAFF),  # symbols, pictographs, extended
    (0x2600, 0x27BF),    # misc symbols, dingbats
    (0x2B00, 0x2BFF),    # arrows/stars incl. 2B50
    (0xFE0F, 0xFE0F),    # variation selector
)


def is_emoji(ch: str) -> bool:
    cp = ord(ch)
    return any(lo <= cp <= hi for lo, hi in EMOJI_RANGES)


def split_sentences(text: str):
    # crude but deterministic; good enough for length statistics
    parts = re.split(r"(?<=[.!?])\s+", text)
    return [p.strip() for p in parts if p.strip()]


def word_count(text: str) -> int:
    return len(re.findall(r"[A-Za-z0-9'’-]+", text))


def finding(file, line, excerpt, ism, severity, explanation, rewrite="", dialect="generic-llm"):
    return {
        "file": str(file), "line": line, "excerpt": excerpt[:300], "ism": ism,
        "dialect": dialect, "severity": severity, "explanation": explanation,
        "rewrite": rewrite, "layer": "structural",
    }


def analyze_prose(path: Path, text: str):
    out = []
    lines = text.splitlines()
    words = word_count(text)
    if words == 0:
        return out

    # em-dash density (em dash, double hyphen used as one)
    dashes = text.count("—") + len(re.findall(r"(?<=\w)--(?=\w)", text))
    per_100 = dashes / words * 100
    if words > 80 and per_100 > 1.2:
        first = next((i + 1 for i, l in enumerate(lines) if "—" in l or re.search(r"(?<=\w)--(?=\w)", l)), 1)
        out.append(finding(path, first, f"{dashes} em-dashes in {words} words ({per_100:.1f}/100w)",
                           "em-dash-density", "high",
                           "Em-dash rate above ~1.2 per 100 words is a strong machine tell; human "
                           "editors reach for commas, periods, and parentheses too.",
                           "Replace most em-dashes with periods or commas; keep at most one per paragraph.",
                           "claude"))

    # staccato: share of very short sentences + low length variance
    sents = split_sentences(re.sub(r"```.*?```", "", text, flags=re.S))
    if len(sents) >= 8:
        lens = [word_count(s) for s in sents]
        short = sum(1 for n in lens if n <= 4)
        if short / len(sents) > 0.22:
            out.append(finding(path, 1, f"{short}/{len(sents)} sentences are ≤4 words",
                               "staccato-delivery", "high",
                               "Runs of clipped fragments (“Tight. Controlled. Deliberate.”) are a "
                               "signature LLM rhythm.",
                               "Merge fragments into full sentences; vary cadence naturally.",
                               "claude"))
        if len(lens) >= 10 and statistics.pstdev(lens) < 4.0 and statistics.mean(lens) > 8:
            out.append(finding(path, 1, f"sentence-length stdev {statistics.pstdev(lens):.1f} over {len(lens)} sentences",
                               "uniform-sentence-length", "medium",
                               "Near-constant sentence length reads as generated; human prose breathes.",
                               "Vary sentence length deliberately: one long, one short."))

    # contraction rate (near-zero in formal LLM register)
    contractions = len(re.findall(r"\b\w+[’'](?:t|s|re|ve|ll|d|m)\b", text))
    if words > 200 and contractions == 0:
        out.append(finding(path, 1, f"0 contractions in {words} words",
                           "zero-contractions", "medium",
                           "No contractions across a long passage signals machine formality.",
                           "Use contractions where a person speaking would."))

    # one-line-paragraph runs (broetry)
    run = best_run = 0
    run_line = 0
    for i, l in enumerate(lines):
        s = l.strip()
        if s and not s.startswith(("#", "-", "*", ">", "|", "```")) and len(s.split()) <= 14 \
           and i + 1 < len(lines) and not lines[i + 1].strip():
            run += 1
            if run > best_run:
                best_run, run_line = run, i + 1
        elif s:
            run = 0
    if best_run >= 4:
        out.append(finding(path, run_line, f"run of {best_run} consecutive one-line paragraphs",
                           "broetry-line-breaks", "medium",
                           "Stacked one-line paragraphs are the LinkedIn-AI cadence.",
                           "Group related lines into real paragraphs."))

    # heading density + bullet-to-paragraph ratio (markdown)
    headings = sum(1 for l in lines if re.match(r"\s{0,3}#{1,6}\s", l))
    bullets = sum(1 for l in lines if re.match(r"\s*[-*+]\s|\s*\d+\.\s", l))
    paras = sum(1 for i, l in enumerate(lines)
                if l.strip() and not re.match(r"\s*([-*+#>|]|\d+\.|```)", l)
                and (i == 0 or not lines[i - 1].strip()))
    if headings >= 5 and paras > 0 and headings / max(paras, 1) > 0.5:
        out.append(finding(path, 1, f"{headings} headings vs {paras} paragraphs",
                           "heading-spam", "medium",
                           "A heading every paragraph or two is scaffolding, not writing.",
                           "Cut headings that label a single paragraph; let prose carry transitions."))
    if bullets >= 10 and paras > 0 and bullets / max(paras, 1) > 2.5:
        out.append(finding(path, 1, f"{bullets} bullet lines vs {paras} paragraphs",
                           "bullet-colonization", "high",
                           "Bullets outnumbering paragraphs ~3:1 marks headline-then-bullets disease.",
                           "Convert bullet runs that argue or narrate into paragraphs; keep bullets for true lists."))

    # bolded-phrase-colon bullets (**Speed:** it is fast / **Speed**: it is fast)
    bpc = [(i + 1, l.strip()) for i, l in enumerate(lines)
           if re.match(r"\s*[-*+]?\s*\*\*[^*]{1,60}?:?\*\*\s*[:—]?\s+\S", l)
           and re.search(r":\*\*|\*\*\s*[:—]", l)]
    if len(bpc) >= 4:
        out.append(finding(path, bpc[0][0], f"{len(bpc)} '**Label:** text' bullets, e.g. {bpc[0][1][:80]}",
                           "bold-label-colon-bullets", "medium",
                           "The bolded-noun-colon bullet grid is a generated-doc signature.",
                           "Keep at most one such list per document, or rewrite as prose."))

    # unattributed blockquotes (quote no one said)
    for i, l in enumerate(lines):
        if re.match(r"\s*>\s*\S", l):
            tail = "\n".join(lines[i:i + 3])
            if not re.search(r"[——-]\s*[A-Z][\w.\s]{2,40}$", tail.strip()) and not re.search(r"\b(said|wrote|per|via)\b", tail):
                out.append(finding(path, i + 1, l.strip()[:120],
                                   "unattributed-quote", "high",
                                   "A floating quote with no source reads as manufactured gravitas.",
                                   "Attribute it, or delete it. If nobody said it, it is not a quote.",
                                   "claude"))
                break  # one report per file is enough

    # arrow chains
    arrows = [(i + 1, l.strip()) for i, l in enumerate(lines) if l.count("→") >= 2]
    if arrows:
        out.append(finding(path, arrows[0][0], arrows[0][1][:120],
                           "arrow-chain", "medium",
                           "A → B → C chains compress reasoning the reader needed to see.",
                           "Write the causal chain as a sentence."))

    # emoji as structure (headers/bullets)
    emoji_lines = []
    for i, l in enumerate(lines):
        s = l.strip()
        if not s:
            continue
        m = re.match(r"(#{1,6}\s+|[-*+]\s+|\d+\.\s+)?(.*)", s)
        body_txt = m.group(2)
        is_structural = bool(m.group(1)) or s.startswith("#")
        if body_txt and is_emoji(body_txt[0]) and (is_structural or len(body_txt.split()) <= 8):
            emoji_lines.append((i + 1, s))
    if len(emoji_lines) >= 1:
        out.append(finding(path, emoji_lines[0][0], emoji_lines[0][1][:120],
                           "emoji-as-structure", "high",
                           "Emoji-prefixed headers/bullets (🚀 Features) are the README-generator look.",
                           "Delete the emoji; if a glyph is needed, use a real icon system.",
                           "chatgpt"))
    return out


def analyze_markup(path: Path, text: str):
    """HTML/CSS/JSX: structured-value checks (colors, fonts, tokens, emoji UI)."""
    out = []
    lines = text.splitlines()
    low = text.lower()

    for hexv, label in AI_DEFAULT_HEXES.items():
        if hexv in low:
            ln = next((i + 1 for i, l in enumerate(lines) if hexv in l.lower()), 1)
            out.append(finding(path, ln, f"#{hexv}", "ai-default-accent-color", "high",
                               f"{label}. The color nobody picked on purpose.",
                               "Choose an accent from the brand/content; if unsure, pull from the imagery."))

    for fam, label in AI_DEFAULT_FONTS.items():
        if re.search(rf"font(?:-family)?\s*[:=][^;}}\n]*\b{re.escape(fam)}\b", low) or \
           re.search(rf"fonts\.googleapis[^\"']*{re.escape(fam.replace(' ', '+'))}", low):
            ln = next((i + 1 for i, l in enumerate(lines) if fam in l.lower()), 1)
            out.append(finding(path, ln, fam, "ai-default-typeface", "high",
                               f"{label}.",
                               "Pick a typeface as a decision: match the property's voice."))

    for tok, ism in (("backdrop-blur", "glassmorphism-default"),
                     ("rounded-2xl", "rounded-2xl-card-default"),
                     ("bg-gradient-to-r", "gradient-headline-default")):
        n = low.count(tok)
        if n >= 3:
            ln = next((i + 1 for i, l in enumerate(lines) if tok in l.lower()), 1)
            out.append(finding(path, ln, f"{tok} ×{n}", ism, "medium",
                               f"'{tok}' repeated {n}× — the unstyled style of generated UI.",
                               "Keep it only where it earns its place; design one deliberate surface treatment."))

    # emoji inside interactive/labeling elements
    for i, l in enumerate(lines):
        if re.search(r"<(button|a|h[1-6]|th|label|summary)\b[^>]*>[^<]*", l):
            seg = re.findall(r">([^<]+)<", l)
            if any(is_emoji(ch) for s in seg for ch in s):
                out.append(finding(path, i + 1, l.strip()[:120], "emoji-as-icon", "high",
                                   "Emoji inside UI chrome reads cheap and unprofessional.",
                                   "Use SF Symbols / Lucide / Heroicons / bespoke SVG."))
                break
    return out


MARKUP_EXT = {".html", ".htm", ".css", ".jsx", ".tsx", ".vue", ".svelte", ".js", ".ts"}


def analyze_file(path: Path):
    try:
        text = path.read_text(errors="replace")
    except Exception as e:
        return [finding(path, 0, str(e), "unreadable", "low", "Could not read file.")]
    if path.suffix.lower() in MARKUP_EXT:
        res = analyze_markup(path, text)
        # JSX copy is prose too — analyze string-ish lines lightly only for html
        if path.suffix.lower() in {".html", ".htm"}:
            stripped = re.sub(r"<[^>]+>", " ", text)
            res += analyze_prose(path, stripped)
        return res
    return analyze_prose(path, text)


# ------------------------------------------------------------------- report

SEV_ORDER = {"high": 0, "medium": 1, "low": 2}


def render_report(findings, out_path: Path, title="Humanize review"):
    findings = sorted(findings, key=lambda f: (SEV_ORDER.get(f.get("severity", "low"), 3),
                                               f.get("file", ""), f.get("line", 0)))
    counts = {s: sum(1 for f in findings if f.get("severity") == s) for s in ("high", "medium", "low")}
    rows = []
    for n, f in enumerate(findings, 1):
        rewrite = f.get("rewrite") or ""
        rows.append(f"""
      <tr class="sev-{html.escape(f.get('severity','low'))}">
        <td class="num">{n}</td>
        <td><span class="sev">{html.escape(f.get('severity',''))}</span></td>
        <td class="ism">{html.escape(f.get('ism',''))}<div class="dialect">{html.escape(f.get('dialect',''))} · {html.escape(f.get('layer','judge'))}</div></td>
        <td class="loc">{html.escape(Path(f.get('file','')).name)}:{f.get('line','')}</td>
        <td class="body"><del>{html.escape(f.get('excerpt',''))}</del>
          <div class="why">{html.escape(f.get('explanation',''))}</div>
          {f'<ins>{html.escape(rewrite)}</ins>' if rewrite else ''}</td>
      </tr>""")
    doc = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{html.escape(title)}</title>
<style>
  /* Deliberately not the AI default look: no Inter/Geist, no indigo. */
  :root {{ --ink:#1a1714; --paper:#faf7f2; --rule:#d8d0c2; --accent:#8a3324;
           --high:#8a3324; --medium:#9a6a00; --low:#4a5d49; }}
  html {{ font-size: 16px; }}
  body {{ font-family: Georgia, 'Times New Roman', serif; background: var(--paper);
         color: var(--ink); margin: 0; padding: 3rem 4vw; line-height: 1.55; }}
  h1 {{ font-size: 2rem; font-weight: normal; margin: 0 0 .25rem; }}
  .kicker {{ font-family: Menlo, monospace; font-size: .875rem; font-weight: 700;
            letter-spacing: .12em; text-transform: uppercase; color: var(--accent); }}
  .summary {{ font-size: 1rem; margin: .75rem 0 2rem; }}
  table {{ width: 100%; border-collapse: collapse; background: #fff;
          border: 1px solid var(--rule); font-size: .9375rem; }}
  th {{ font-family: Menlo, monospace; font-size: .8125rem; text-transform: uppercase;
       letter-spacing: .08em; text-align: left; padding: .6rem .7rem;
       border-bottom: 2px solid var(--ink); }}
  td {{ padding: .65rem .7rem; border-bottom: 1px solid var(--rule); vertical-align: top; }}
  td.num {{ font-family: Menlo, monospace; color: #777; }}
  .sev {{ font-family: Menlo, monospace; font-size: .8125rem; font-weight: 700;
         text-transform: uppercase; }}
  tr.sev-high .sev {{ color: var(--high); }}
  tr.sev-medium .sev {{ color: var(--medium); }}
  tr.sev-low .sev {{ color: var(--low); }}
  td.ism {{ font-family: Menlo, monospace; font-size: .875rem; white-space: nowrap; }}
  .dialect {{ color: #8a8378; font-size: .8125rem; margin-top: .15rem; }}
  td.loc {{ font-family: Menlo, monospace; font-size: .875rem; white-space: nowrap; }}
  del {{ background: #f6e3df; text-decoration-color: var(--high); display: inline-block;
        padding: .05rem .2rem; }}
  ins {{ background: #e7eee4; text-decoration: none; display: block; margin-top: .4rem;
        padding: .3rem .45rem; border-left: 3px solid var(--low); }}
  .why {{ font-size: .875rem; color: #564f45; margin-top: .35rem; }}
  footer {{ margin-top: 2rem; font-family: Menlo, monospace; font-size: .875rem; color: #8a8378; }}
</style></head><body>
<div class="kicker">make_copy_and_media_human · line-item fix plan</div>
<h1>{html.escape(title)}</h1>
<p class="summary"><strong>{len(findings)}</strong> findings —
  {counts['high']} high, {counts['medium']} medium, {counts['low']} low.
  Struck text is the AI-ism as found; the inset block is the proposed fix.</p>
<table>
  <thead><tr><th>#</th><th>Sev</th><th>Ism</th><th>Where</th><th>Finding → fix</th></tr></thead>
  <tbody>{''.join(rows) if rows else '<tr><td colspan=5>No findings. Either clean, or the judge pass has not run.</td></tr>'}</tbody>
</table>
<footer>generated {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%MZ')} · structural layer is
measurable signals only; phrase-level tropes come from the model judge pass.</footer>
</body></html>"""
    out_path.write_text(doc)
    return out_path


# ------------------------------------------------------------------ selftest

SELFTEST = """# 🚀 Why Our Platform Wins

It's not just a tool — it's a paradigm. Tight. Focused. Relentless.

> The future belongs to those who automate it.

**Speed:** blazing fast.
**Scale:** infinitely elastic.
**Security:** enterprise-grade.
**Joy:** developer-first.

Input → Pipeline → Magic → Revenue
"""


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("files", nargs="*", help="files to review (md, txt, html, css, tsx...)")
    ap.add_argument("--findings", help="JSON findings from the model judge pass to merge")
    ap.add_argument("--out", default="humanize-report.html")
    ap.add_argument("--title", default="Humanize review")
    ap.add_argument("--json", help="also dump merged findings JSON here")
    ap.add_argument("--selftest", action="store_true")
    args = ap.parse_args()

    findings = []
    if args.selftest:
        p = Path("/tmp-selftest.md")  # never written; analyzed from memory
        findings += analyze_prose(Path("selftest.md"), SELFTEST)
        ok = {f["ism"] for f in findings}
        need = {"emoji-as-structure", "unattributed-quote", "bold-label-colon-bullets", "arrow-chain"}
        missing = need - ok
        print("selftest findings:", sorted(ok))
        if missing:
            print("MISSING:", sorted(missing)); sys.exit(1)
        print("selftest OK"); sys.exit(0)

    for f in args.files:
        findings += analyze_file(Path(f))
    if args.findings:
        ext = json.loads(Path(args.findings).read_text())
        for f in ext:
            f.setdefault("layer", "judge")
        findings += ext
    if args.json:
        Path(args.json).write_text(json.dumps(findings, indent=2))
    out = render_report(findings, Path(args.out), title=args.title)
    print(f"wrote {out} ({len(findings)} findings)")


if __name__ == "__main__":
    main()
