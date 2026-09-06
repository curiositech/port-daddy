#!/usr/bin/env python3
"""Find ink that leaves the Book's text column: drawings, images or text past
the page edge, or drawings/images that run into the margin column.

The Book's geometry (coordination-papers-mega-volume-preamble.tex) is 7 x 10 in,
twoside, inner 0.8 in, textwidth 4.5 in, marginparsep 0.2 in, marginparwidth
1.3 in. Marginal notes are text and are allowed in the margin column; drawn
figures and images are not (the 1.5 pt boundary bar is the one exception).

usage: page_overflow.py BOOK.pdf [--slack PT] [--json]
exit 1 when any page has ink past the mediabox or a figure past the column.
"""
import argparse, json, sys
import fitz  # pymupdf

PAPER_W, PAPER_H = 7 * 72, 10 * 72
INNER, TEXTW = 0.8 * 72, 4.5 * 72

def column(page, page_no):
    """The text column of this page. The head rule (a hairline the width of
    \textwidth near the top) gives it exactly; parity of the printed folio
    (PDF page - 1 in the body) is the fallback. Returns x0, x1, outer side."""
    for d in page.get_drawings():
        r = d["rect"]
        if r.height < 1 and abs(r.width - TEXTW) < 2 and r.y0 < 60:
            return r.x0, r.x1, ("R" if r.x0 < PAPER_W / 2 - 20 else "L")
    if (page_no - 1) % 2 == 1:
        return INNER, INNER + TEXTW, "R"
    return PAPER_W - INNER - TEXTW, PAPER_W - INNER, "L"

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("pdf"); ap.add_argument("--slack", type=float, default=3.0)
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()
    doc = fitz.open(a.pdf)
    findings = []
    for i, page in enumerate(doc):
        pno = i + 1
        x0, x1, outer = column(page, pno)
        # caption on the page, for naming
        caps = [b[4].strip().split("\n")[0][:60] for b in page.get_text("blocks")
                if b[4].lstrip().startswith(("Figure ", "Table "))]
        items = []
        for d in page.get_drawings():
            r = d["rect"]
            if r.width < 4 and r.height > 20:  # margin bar / rules in the margin
                continue
            if r.width < 6 and r.height < 6:  # margin glyphs, datum marks
                continue
            items.append(("drawing", r))
        for img in page.get_image_info():
            r = fitz.Rect(img["bbox"])
            if r.width >= PAPER_W - 2 and r.height >= PAPER_H - 2:
                continue  # full-bleed plate
            items.append(("image", r))
        has_rule = any(d["rect"].height < 1 and abs(d["rect"].width - TEXTW) < 2 and d["rect"].y0 < 60
                       for d in page.get_drawings())
        for kind, r in items:
            off_page = max(0, -r.x0) + max(0, r.x1 - PAPER_W)
            if not has_rule:
                into_margin = 0  # opener or plate page: no column to respect
            elif outer == "R":
                into_margin = r.x1 - x1
            else:
                into_margin = x0 - r.x0
            if off_page > 0.5 or into_margin > a.slack:
                findings.append({"page": pno, "kind": kind, "off_page_pt": round(off_page, 1),
                                 "past_column_pt": round(max(0, into_margin), 1),
                                 "rect": [round(v, 1) for v in r], "caption": caps[0] if caps else ""})
        # text past the page edge
        for b in page.get_text("blocks"):
            if b[2] > PAPER_W + 0.5 or b[0] < -0.5:
                findings.append({"page": pno, "kind": "text", "off_page_pt": round(max(b[2] - PAPER_W, -b[0]), 1),
                                 "past_column_pt": 0, "rect": [round(v, 1) for v in b[:4]], "caption": b[4][:50]})
    # collapse to one row per page/kind with the worst offsets
    worst = {}
    for f in findings:
        k = (f["page"], f["kind"])
        w = worst.setdefault(k, dict(f))
        w["off_page_pt"] = max(w["off_page_pt"], f["off_page_pt"])
        w["past_column_pt"] = max(w["past_column_pt"], f["past_column_pt"])
        if f["caption"] and not w["caption"]:
            w["caption"] = f["caption"]
    rows = sorted(worst.values(), key=lambda r: r["page"])
    if a.json:
        print(json.dumps(rows, indent=1))
    else:
        for r in rows:
            print(f"p{r['page']:>3} {r['kind']:<8} off-page {r['off_page_pt']:>6.1f} pt  past column {r['past_column_pt']:>6.1f} pt  {r['caption']}")
        print(f"{len(rows)} page/kind rows; {sum(1 for r in rows if r['off_page_pt']>0)} with ink past the page edge")
    sys.exit(1 if any(r["off_page_pt"] > 0 or (r["kind"] != "text" and r["past_column_pt"] > a.slack) for r in rows) else 0)

if __name__ == "__main__":
    main()
