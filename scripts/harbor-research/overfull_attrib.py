#!/usr/bin/env python3
"""Attribute every 'Overfull \\hbox' in a TeX log to the source file being read,
by following the log's file-open parentheses. usage: overfull_attrib.py LOG [--min PT] [--top N]"""
import re, argparse
ap = argparse.ArgumentParser(); ap.add_argument("log"); ap.add_argument("--min", type=float, default=10.0)
ap.add_argument("--top", type=int, default=40); a = ap.parse_args()
with open(a.log, errors="replace") as fh:
    log = fh.read()
stack, out, i, n = [], [], 0, len(log)
rec = re.compile(r"Overfull \\hbox \(([\d.]+)pt too wide\) (?:in paragraph at lines (\d+)--(\d+)|detected at line (\d+))\n(.*?)\n\s*\[\]", re.S)
opens = re.compile(r"\((\.?/?[\w./\\-]+\.(?:tex|sty|cls|def|cfg|clo|fd|otf|ttf|pfb|map|tfm|enc|dfu|ldf|lua|mkii|mkiv|bbl|aux|toc|out|lof|lot))")
# walk the log once, tracking parentheses that open files
events = []
for m in re.finditer(r"\(([\w./\\-]+\.(?:tex|sty|cls|def|cfg|clo|fd|dfu|ldf|aux|toc|out|lof|lot|bbl))|\)|Overfull \\hbox", log):
    events.append((m.start(), m.group(0), m.group(1)))
recs = {m.start(): m for m in rec.finditer(log)}
for pos, tok, fname in events:
    if fname:
        stack.append(fname)
    elif tok == ")":
        if stack: stack.pop()
    else:
        m = recs.get(pos)
        if not m: continue
        w = float(m.group(1)); ln = m.group(2) or m.group(4)
        src = next((f for f in reversed(stack) if f.endswith(".tex") and "/tex/" not in f and "texmf" not in f), stack[-1] if stack else "?")
        body = re.sub(r"\\TU/[\w().-]+/\S+ ?", "", m.group(5)).replace("\n", " ").strip()
        out.append((w, src, ln, body[:90]))
import os
cache = {}
def srcline(path, ln):
    """the source line itself (for the generated body, the chapter it came from too)"""
    try:
        if path not in cache:
            target = path if os.path.exists(path) else os.path.join(os.path.dirname(a.log), path)
            with open(target, errors="replace") as fh:
                cache[path] = fh.read().splitlines()
        lines = cache[path]; k = int(ln) - 1
        chap = ""
        if path.endswith("mega-volume-body.tex"):
            for j in range(k, -1, -1):
                mm = re.match(r"\\pdchapter\{(\d+)\}", lines[j])
                if mm: chap = f"ch{mm.group(1)} "; break
        return chap + lines[k].strip()[:110]
    except Exception:
        return ""
BODY = ".cache/whitepaper-build/coordination-papers-mega-volume/mega-volume-body.tex"
# TeX wraps log lines at 79 columns, so long file paths rarely survive the
# parenthesis walk; an unresolved record with a body-sized line number is the body.
def resolve(src, ln):
    if src == "?" and os.path.exists(BODY):
        return BODY
    return src
out = [(w, resolve(src, ln), ln, body, srcline(resolve(src, ln), ln)) for (w, src, ln, body) in out]
out.sort(key=lambda r: -r[0])
sel = [r for r in out if r[0] >= a.min]
print(f"{len(out)} overfull lines; {len(sel)} at or over {a.min} pt")
for w, src, ln, body, sl in sel[: a.top]:
    print(f"{w:7.1f}  {os.path.basename(src)}:{ln}  {sl or body}")
