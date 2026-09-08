#!/usr/bin/env python3
"""leading_scan.py -- find body lines that sit too low under the line above.

Reads the rendered Book and reports every pair of consecutive body lines
(same left edge, body size) whose baseline step is between --low and --high
points when the lower line carries a monospace span. This is the signature
of the XeTeX glyph-metrics defect that pushed every \\texttt line down by a
line and a half; after the fix the remaining hits are paragraph starts and
list items with legitimate space. Usage:

    leading_scan.py BOOK.pdf [--body 10.46] [--low 20] [--high 40] [--list]

Prints the count and the pages; --list prints each hit. Exit 0 always: the
number is for the ledger and the eye, not a gate, until the benign cases are
separable.
"""
import argparse
import sys

import pymupdf


def scan(path, body, low, high):
    d = pymupdf.open(path)
    hits = []
    for i, p in enumerate(d):
        lines = []
        for b in p.get_text("dict")["blocks"]:
            if b.get("type") != 0:
                continue
            for l in b["lines"]:
                if not l["spans"] or not any(abs(s["size"] - body) < 0.3 for s in l["spans"]):
                    continue
                mono = any(("Mono" in s["font"]) or ("Cursor" in s["font"]) or ("lmtt" in s["font"]) for s in l["spans"])
                lines.append((l["bbox"][1], l["bbox"][0], mono, "".join(s["text"] for s in l["spans"])[:48]))
        lines.sort()
        for (y0, x0, _, _), (y1, x1, mono1, t1) in zip(lines, lines[1:]):
            if abs(x0 - x1) < 2 and low < (y1 - y0) < high and mono1:
                hits.append((i + 1, round(y1 - y0, 1), t1))
    return hits


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("pdf")
    ap.add_argument("--body", type=float, default=10.46)
    ap.add_argument("--low", type=float, default=20.0)
    ap.add_argument("--high", type=float, default=40.0)
    ap.add_argument("--list", action="store_true")
    a = ap.parse_args()
    hits = scan(a.pdf, a.body, a.low, a.high)
    pages = sorted({h[0] for h in hits})
    print(f"{len(hits)} low monospace line(s) on {len(pages)} page(s): {pages[:30]}")
    if a.list:
        for h in hits:
            print(f"  p.{h[0]:4d}  +{h[1]:5.1f} pt  {h[2]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
