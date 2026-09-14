#!/usr/bin/env python3
"""margin_occupancy.py -- measure what fraction of the Book's BODY pages carry
anything in the margin column, and how many characters are there when they do.

Geometry comes from the Book's own \geometry call in
coordination-papers-mega-volume-preamble.tex:

    paperwidth=7in left=0.8in textwidth=4.5in marginparsep=0.2in marginparwidth=1.3in

so the margin column spans x in [0.8+4.5+0.2, 0.8+4.5+0.2+1.3] inches
= [5.5in, 6.8in] = [396pt, 489.6pt] on a 504pt-wide page.

A BODY page is a page that carries running body prose: it has at least
MIN_BODY_CHARS characters inside the text column [0.8in, 5.3in] and is not a
part opener, a plate, or front/back matter (detected by the absence of a
running foot). Running heads/feet live outside the body band vertically and are
excluded by the y-band, so they never count as margin content.

Usage: margin_occupancy.py BOOK.pdf [--json OUT] [--csv OUT]
"""
from __future__ import annotations
import argparse, json, statistics, sys, csv as _csv

import fitz

PT = 72.0
MARGIN_X0 = (0.8 + 4.5 + 0.2) * PT          # 396.0
MARGIN_X1 = (0.8 + 4.5 + 0.2 + 1.3) * PT    # 489.6
TEXT_X0 = 0.8 * PT                          # 57.6
TEXT_X1 = (0.8 + 4.5) * PT                  # 381.6
# vertical body band: below the running head, above the running foot.
TOP_Y = 0.70 * PT * 1.0 + 40.0              # ~ 90pt from the top edge
BOT_Y_FROM_BOTTOM = 52.0                    # exclude the running foot band
MIN_BODY_CHARS = 400                        # a page of real running prose


def page_stats(page):
    h = page.rect.height
    top, bot = TOP_Y, h - BOT_Y_FROM_BOTTOM
    body_chars = 0
    margin_chars = 0
    d = page.get_text("dict")
    for blk in d.get("blocks", []):
        if blk.get("type") != 0:
            continue
        for line in blk.get("lines", []):
            for span in line.get("spans", []):
                x0, y0, x1, y1 = span["bbox"]
                if y1 < top or y0 > bot:
                    continue
                t = span.get("text", "")
                n = len(t.strip())
                if not n:
                    continue
                cx = (x0 + x1) / 2.0
                if MARGIN_X0 - 6 <= cx <= MARGIN_X1 + 18:
                    margin_chars += n
                elif TEXT_X0 - 20 <= cx <= TEXT_X1 + 6:
                    body_chars += n
    # vector/image ink in the margin band (a margin figure or a rule) also counts
    margin_ink = False
    for dr in page.get_drawings():
        r = dr["rect"]
        if r.x0 >= MARGIN_X0 - 6 and r.x1 <= MARGIN_X1 + 20 and top <= r.y1 and r.y0 <= bot:
            if r.width > 2 and r.height > 2:
                margin_ink = True
                break
    if not margin_ink:
        for img in page.get_image_info():
            r = fitz.Rect(img["bbox"])
            if r.x0 >= MARGIN_X0 - 20 and top <= r.y1 and r.y0 <= bot:
                margin_ink = True
                break
    return body_chars, margin_chars, margin_ink


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("pdf")
    ap.add_argument("--json")
    ap.add_argument("--csv")
    ap.add_argument("--label", default="")
    a = ap.parse_args()
    doc = fitz.open(a.pdf)
    rows = []
    for i, page in enumerate(doc):
        b, m, ink = page_stats(page)
        rows.append({"page": i + 1, "body_chars": b, "margin_chars": m, "margin_ink": ink})
    body = [r for r in rows if r["body_chars"] >= MIN_BODY_CHARS]
    occupied = [r for r in body if r["margin_chars"] > 0 or r["margin_ink"]]
    chars_when_present = [r["margin_chars"] for r in body if r["margin_chars"] > 0]
    out = {
        "label": a.label,
        "pdf": a.pdf,
        "total_pages": len(rows),
        "body_pages": len(body),
        "body_pages_with_margin": len(occupied),
        "occupancy_pct": round(100.0 * len(occupied) / len(body), 1) if body else 0.0,
        "median_margin_chars_when_present": int(statistics.median(chars_when_present)) if chars_when_present else 0,
        "mean_margin_chars_when_present": round(statistics.mean(chars_when_present), 1) if chars_when_present else 0.0,
        "total_margin_chars": sum(r["margin_chars"] for r in body),
    }
    print(json.dumps(out, indent=2))
    if a.json:
        json.dump(out, open(a.json, "w"), indent=2)
    if a.csv:
        with open(a.csv, "w", newline="") as fh:
            w = _csv.DictWriter(fh, fieldnames=["page", "body_chars", "margin_chars", "margin_ink"])
            w.writeheader()
            w.writerows(rows)
    return 0


if __name__ == "__main__":
    sys.exit(main())
