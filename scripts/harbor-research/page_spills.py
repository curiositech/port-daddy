#!/usr/bin/env python3
"""page_spills.py -- find pages of the Book that spill.

Three checks, all on the rendered PDF (so they see what the reader sees):

  O  opener spill: a chapter opener carries "The question this chapter answers"
     but the 22 pt question line is not on the same page.
  H  stranded heading: a section or subsection heading (bold, >= 12 pt) sits
     within two text lines of the page foot, with its body on the next page.
  W  short page: the last text line ends more than --slack points above the
     text block's foot, and the page is not the last page of a chapter, a
     part opener, or a page that ends with a full-width table or figure.

Usage: page_spills.py BOOK.pdf [--slack 150] [--json]
Exit 1 when any O or H finding exists (W is advisory: some short pages are
legitimate, and the report lets an editor decide).
"""
import argparse
import json
import sys

import pymupdf

LABEL = "The question this chapter answers"


def page_lines(page):
    out = []
    for b in page.get_text("dict")["blocks"]:
        if b.get("type") != 0:
            continue
        for l in b["lines"]:
            spans = l["spans"]
            if not spans:
                continue
            txt = "".join(s["text"] for s in spans).strip()
            if not txt:
                continue
            size = max(s["size"] for s in spans)
            bold = any("Bold" in s["font"] for s in spans)
            out.append({"y0": l["bbox"][1], "y1": l["bbox"][3], "x0": l["bbox"][0], "text": txt, "size": size, "bold": bold})
    out.sort(key=lambda r: r["y0"])
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("pdf")
    ap.add_argument("--slack", type=float, default=150.0, help="trailing whitespace (pt) that makes a page 'short'")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()
    doc = pymupdf.open(a.pdf)
    findings = []
    # text block foot: the median of the lowest body line over all pages
    feet = []
    per_page = []
    for i, p in enumerate(doc):
        lines = page_lines(p)
        per_page.append(lines)
        body = [l for l in lines if l["size"] < 11.5 and l["y0"] > 60]
        if body:
            feet.append(max(l["y1"] for l in body if l["y1"] < p.rect.height - 40) if any(l["y1"] < p.rect.height - 40 for l in body) else 0)
    feet = sorted(f for f in feet if f > 0)
    foot = feet[len(feet) * 9 // 10] if feet else 0
    for i, lines in enumerate(per_page):
        page_no = i + 1
        texts = [l["text"] for l in lines]
        # O: opener spill
        if any(LABEL.lower() == t.lower() for t in texts):
            big = [l for l in lines if l["size"] >= 20 and l["y0"] > 0]
            label_y = next(l["y0"] for l in lines if l["text"].lower() == LABEL.lower())
            if not any(l["y0"] > label_y for l in big):
                findings.append({"kind": "O", "page": page_no, "detail": "opener label present, question not on the same page"})
        # H: stranded heading
        body = [l for l in lines if l["size"] < 11.5 and l["y0"] > 60 and l["y1"] < foot + 2]
        heads = [l for l in lines if l["bold"] and l["size"] >= 12 and l["y0"] > 60]
        for h in heads:
            after = [l for l in body if l["y0"] > h["y1"]]
            if len(after) <= 2 and (foot - h["y1"]) < 40 and page_no < len(per_page):
                findings.append({"kind": "H", "page": page_no, "detail": f"heading '{h['text'][:50]}' within two lines of the page foot"})
        # W: short page
        content = [l for l in lines if l["y0"] > 60 and l["y1"] < foot + 2]
        if content and foot:
            last = max(l["y1"] for l in content)
            gap = foot - last
            nxt = per_page[i + 1] if i + 1 < len(per_page) else []
            next_is_opener = any(t.startswith("Chapter ") and " of " in t for t in [l["text"] for l in nxt][:3]) or any("Part " in l["text"] and l["size"] > 20 for l in nxt[:6])
            ends_chapter = any(l["text"].startswith("Review of the key ideas") for l in lines) is False and next_is_opener
            drawings = [d for d in doc[i].get_drawings() if d["rect"].y1 > last - 5]
            if gap > a.slack and not next_is_opener and not drawings:
                findings.append({"kind": "W", "page": page_no, "detail": f"{gap:.0f} pt empty above the foot; next page starts with '{(nxt[0]['text'] if nxt else '')[:40]}'"})
    hard = [f for f in findings if f["kind"] in ("O", "H")]
    if a.json:
        print(json.dumps({"foot_pt": foot, "findings": findings}, indent=1))
    else:
        print(f"text foot at {foot:.1f} pt; {len(findings)} finding(s): {sum(f['kind']=='O' for f in findings)} O, {sum(f['kind']=='H' for f in findings)} H, {sum(f['kind']=='W' for f in findings)} W")
        for f in findings:
            print(f"  {f['kind']} p.{f['page']:4d}  {f['detail']}")
    return 1 if hard else 0


if __name__ == "__main__":
    sys.exit(main())
