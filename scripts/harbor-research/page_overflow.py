#!/usr/bin/env python3
# The docstring names \marginnote, and "\m" is not an escape sequence, so a
# plain string makes Python 3.12 print a SyntaxWarning on every CI run --
# noise in a log whose whole job is to be read. Raw string, no warning.
r"""Find ink that leaves the Book's text column: drawings, images or text past
the page edge, or drawings/images that run into the margin column.

The Book's geometry (coordination-papers-mega-volume-preamble.tex) is 7 x 10 in,
twoside, inner 0.8 in, textwidth 4.5 in, marginparsep 0.2 in, marginparwidth
1.3 in. Marginal notes are text and are allowed in the margin column; drawn
figures and images are not (the 1.5 pt boundary bar is the one exception).

It also finds two pieces of text printed on top of each other in the margin
column (a Recall block over an Exercises pointer, an axis label over a tick
label), which \marginnote never warns about and the log never shows.

usage: page_overflow.py BOOK.pdf [--slack PT] [--json]
exit 1 when any page has ink past the mediabox, a figure past the column, or
a margin-column collision.
"""
import argparse, json, sys
import fitz  # pymupdf

PAPER_W, PAPER_H = 7 * 72, 10 * 72
INNER, TEXTW = 0.8 * 72, 4.5 * 72
FULLW_EXTRA = (0.2 + 1.3) * 72  # marginparsep + marginparwidth: the full-width overhang the Book allows a picture

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

MARGIN_SEP, MARGIN_W = 0.2 * 72, 1.3 * 72

OFFPAGE_PAD = 200.0

def text_blocks_unclipped(page):
    """Text blocks including any set outside the paper, in the paper's own
    coordinates. MuPDF's text device drops glyphs wholly outside the mediabox
    and leaves an empty inverted block behind, and clearing TEXT_MEDIABOX_CLIP
    does not bring them back -- so instead the mediabox is grown by OFFPAGE_PAD
    on every side (on this in-memory page only) before extraction, which moves
    the edge rather than clipping at it, and the coordinates are shifted back.
    A block whose edge lies past the paper is text a reader cannot see: ten
    Recall blocks hung below the foot in one build and were simply absent from
    the page, with no warning."""
    rect = page.rect
    page.set_mediabox(fitz.Rect(-OFFPAGE_PAD, -OFFPAGE_PAD, rect.width + OFFPAGE_PAD, rect.height + OFFPAGE_PAD))
    out = []
    for b in page.get_text("blocks"):
        if b[0] > b[2] or b[6] != 0:
            continue
        out.append((b[0] - OFFPAGE_PAD, b[1] - OFFPAGE_PAD, b[2] - OFFPAGE_PAD, b[3] - OFFPAGE_PAD, b[4]))
    page.set_mediabox(fitz.Rect(0, 0, rect.width, rect.height))
    return out

# The text block's foot (paper height less the 0.95 in bottom margin) and the
# running foot's own band below it. A float too tall for the page overruns the
# text block by its excess; up to 68 pt of that stays ON the paper, printed
# over the running foot, so the off-paper check never sees it and the only
# witness is a "Float too large for page" line in the log. Table 5.9 did this
# (60 pt) and the author photographed the caption sitting on the footer.
TEXT_FOOT = PAPER_H - 0.95 * 72
# Both running feet the Book sets: the body's title-and-chapter line, and the
# front matter's edition line (preamble \fancyfoot[C], which sits lower in the
# band than the body's).
FOOTER_TEXT = ("The Harbor, the Person, and the Economy", "Textbook Edition")

def foot_intrusions(page, x0, x1, slack=8.0):
    """Column text set below the text block's foot that is not the running foot.
    The slack is half a line: the last line of every full page carries its
    descenders 2.9 pt below the block's foot, and a display with a deep
    subscript reaches 4.5, so a threshold at 2 pt named ninety pages that were
    fine. A table overrunning the block is 50 to 70 pt below it.

    6.0 was fitted to a sample that had no radical over a nested subscript.
    Theorem 8.4.1's display -- r=|s|sqrt(1-R^{K_c}_eff(e)), on C_n: |s|/sqrt n
    -- reaches 6.1, and it was reported as one line over the running foot on
    p. 426 of the Swiss edition and p. 422 of the technical. It is not over
    the running foot: measured on the built PDF, that line's box bottom sits
    657.7 and the running foot's box top sits 675.2, so there is 17.5 pt of
    clear air between them and a reader sees an ordinary last line. Measured
    across all three editions, ordinary last lines land at 0-3 pt (364 of
    them), a handful of deep displays at 4-6, and the real defects -- a
    longtable row running off the block -- at 50 to 70. 8.0 sits in the empty
    gap between those two populations, which is where a threshold belongs.
    Verified on the PDF that had the real one: the 63.9 pt, six-line
    intrusion on p. 505 still fails at this slack."""
    out = []
    for b in page.get_text("dict")["blocks"]:
        if b.get("type") != 0:
            continue
        for l in b["lines"]:
            r = fitz.Rect(l["bbox"])
            if r.x1 < x0 - 2 or r.x0 > x1 + 2:
                continue                      # margin column, or off to the side
            if r.y1 <= TEXT_FOOT + slack:
                continue
            text = "".join(s["text"] for s in l["spans"]).strip()
            if not text or any(f in text for f in FOOTER_TEXT) or text.isdigit():
                continue                      # the running foot and the folio
            out.append({"below_foot_pt": round(r.y1 - TEXT_FOOT, 1), "text": text[:50]})
    return out

def margin_column(x0, x1, outer):
    """The margin column beside the text column: outer side, marginparsep away."""
    if outer == "R":
        return x1 + MARGIN_SEP, x1 + MARGIN_SEP + MARGIN_W
    return x0 - MARGIN_SEP - MARGIN_W, x0 - MARGIN_SEP

def margin_collisions(page, x0, x1, outer, leading=10.4, ratio=0.6):
    """Two lines of margin text printed in the same vertical space. \\marginnote
    never warns about this: it places a note beside the line that issued it and
    does not look at what is already there, so a Recall block and an Exercises
    pointer issued a few lines apart printed on top of each other while the
    log stayed clean (0 "Marginpar on page" lines, seven collisions on the
    page). Measured on the page instead.

    Measured on BASELINES, not bounding boxes. Consecutive lines of one note
    sit one leading apart; a line from another note that landed inside it sits
    a fraction of a leading from its neighbours, or on top of one. Boxes
    mislead here: a line starting with a math glyph carries a taller box that
    overlaps the line above by most of a line and is still just the next line
    (that false positive is what moved this check off boxes). The leading is
    the margin font's, not the page's: footnotesize sets at 10.4 pt in this
    book and small at 11.4, and a first cut that took the page's median gap
    flagged a note's own second line whenever the page held only two distant
    notes. Two lines collide when their baselines are closer than `ratio` of
    the leading AND their x-ranges overlap -- two tick labels side by side on
    one baseline are one line, not two. Each finding says whether a
    drawing or image encloses the text, because an axis label over a tick label
    in a full-width figure is a real overlap too, but a different fix (the
    fragment) from a note that needs moving (the source line)."""
    mx0, mx1 = margin_column(x0, x1, outer)
    lines = []
    for b in page.get_text("dict")["blocks"]:
        if b.get("type") != 0:
            continue
        for l in b["lines"]:
            r = fitz.Rect(l["bbox"])
            if r.x0 < mx0 - 4 or r.x1 > mx1 + 4 or r.width > MARGIN_W + 4:
                continue
            text = "".join(s["text"] for s in l["spans"]).strip()
            if not text:
                continue
            baseline = l["spans"][0]["origin"][1]
            lines.append((baseline, r, text))
    if len(lines) < 2:
        return []
    lines.sort(key=lambda t: (t[0], t[1].x0))
    pictures = [d["rect"] for d in page.get_drawings() if d["rect"].width > 30 and d["rect"].height > 30]
    pictures += [fitz.Rect(i["bbox"]) for i in page.get_image_info()]
    def in_picture(r):
        return any(p.contains(r) or (p.intersects(r) and p.width > 100) for p in pictures)
    out = []
    for (ya, ra, ta), (yb, rb, tb) in zip(lines, lines[1:]):
        gap = yb - ya
        # One visual line split at a font change (a math glyph mid-sentence)
        # comes back as two lines whose x-ranges nearly abut and whose reported
        # baselines differ by the math font's origin offset; 3 pt of overlap
        # covers the glyph box being wider than its advance.
        side_by_side = ra.x1 <= rb.x0 + 3 or rb.x1 <= ra.x0 + 3
        if gap < ratio * leading and not side_by_side:
            out.append({
                "gap_pt": round(gap, 1), "leading_pt": round(leading, 1),
                "a": ta[:50], "b": tb[:50],
                "in_figure": bool(in_picture(ra) or in_picture(rb)),
            })
    return out

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("pdf"); ap.add_argument("--slack", type=float, default=3.0)
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()
    doc = fitz.open(a.pdf)
    findings = []
    collisions = []
    intrusions = []
    for i, page in enumerate(doc):
        pno = i + 1
        x0, x1, outer = column(page, pno)
        for c in margin_collisions(page, x0, x1, outer):
            collisions.append({"page": pno, **c})
        has_head_rule = any(d["rect"].height < 1 and abs(d["rect"].width - TEXTW) < 2 and d["rect"].y0 < 60
                            for d in page.get_drawings())
        if has_head_rule:                     # body pages only; openers and plates own their page
            for f in foot_intrusions(page, x0, x1):
                intrusions.append({"page": pno, **f})
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
            # All four edges. This measured only the two vertical ones -- off the
            # left of the paper and off the right -- while the text check below
            # measured all four. A drawing or an image above the head or below
            # the foot was therefore invisible to this script by construction,
            # which is how Ostrom's portrait printed with 88 pt of its 117 pt
            # above the top of p. 343 of the maritime edition and the run still
            # reported zero ink off the paper.
            off_page = max(0, -r.x0, r.x1 - PAPER_W, -r.y0, r.y1 - PAPER_H)
            if not has_rule:
                into_margin = 0  # opener or plate page: no column to respect
            elif outer == "R":
                into_margin = r.x1 - x1
            else:
                into_margin = x0 - r.x0
            if off_page > 0.5 or into_margin > a.slack:
                kind = kind if into_margin <= FULLW_EXTRA + a.slack and off_page <= 0.5 else kind
                findings.append({"page": pno, "kind": kind, "off_page_pt": round(off_page, 1),
                                 "past_column_pt": round(max(0, into_margin), 1),
                                 "rect": [round(v, 1) for v in r], "caption": caps[0] if caps else ""})
        # text past the page edge -- sideways, or OFF THE FOOT. The foot case is
        # extracted with the mediabox clip off, because text placed below the
        # paper is not in the visible text at all: ten Recall blocks hung below
        # the page in one build and their pointers were simply gone, with no
        # warning and no error. This is the check that finds that.
        # All four edges, one loop, past the paper's own edge (see
        # text_blocks_unclipped). The sideways half of this used the clipped
        # extraction, in which a block off the paper never appears -- so
        # "b[0] < -0.5" could not fire and the check was inert.
        for b in text_blocks_unclipped(page):
            off = max(b[3] - PAPER_H, b[2] - PAPER_W, -b[0], -b[1])
            if off > 0.5:
                findings.append({"page": pno, "kind": "text", "off_page_pt": round(off, 1),
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
    # a picture inside the full-width overhang was placed there by the Book's
    # safety net: legal, but it names a figure that still wants a redraw to the column
    loss = [r for r in rows if r["off_page_pt"] > 0 or (r["kind"] != "text" and r["past_column_pt"] > FULLW_EXTRA + a.slack)]
    wide = [r for r in rows if r not in loss and r["kind"] != "text"]
    if a.json:
        print(json.dumps({"loss": loss, "full_width": wide, "margin_collisions": collisions, "foot_intrusions": intrusions}, indent=1))
    else:
        print(f"-- {len(loss)} page/kind rows with loss (ink past the paper edge or past the full width)")
        for r in loss:
            print(f"p{r['page']:>3} {r['kind']:<8} off-page {r['off_page_pt']:>6.1f} pt  past column {r['past_column_pt']:>6.1f} pt  {r['caption']}")
        # "advisory" is load-bearing in this string, not decoration: these rows
        # do NOT fail the run (see the exit below) and run_pdf_checks.py reads
        # the word to keep them out of the failure summary. Without it, one
        # real finding — a line 8 pt off the paper — was quoted underneath
        # fifty-two legal ones, which is how a summary becomes a log again.
        print(f"-- advisory: {len(wide)} pictures set past the column by the safety net (redraw to the column):")
        for r in wide:
            print(f"p{r['page']:>3} +{r['past_column_pt']:>5.1f} pt  {r['caption'][:70]}")
        print(f"-- {len(collisions)} margin-column collisions (two pieces of text in the same vertical space):")
        for c in collisions:
            where = "in a figure" if c["in_figure"] else "margin notes"
            print(f"p{c['page']:>3} gap {c['gap_pt']:>5.1f} of {c['leading_pt']:>4.1f} pt  {where:<12} [{c['a']}]  x  [{c['b']}]")
        by_page = {}
        for f in intrusions:
            by_page.setdefault(f["page"], []).append(f)
        print(f"-- {len(by_page)} page(s) with column text below the text block's foot (over the running foot):")
        for pno, rows in sorted(by_page.items()):
            worst = max(r["below_foot_pt"] for r in rows)
            print(f"p{pno:>3} {worst:>6.1f} pt below the foot, {len(rows)} line(s)  [{rows[0]['text']}]")
    # A collision or a foot intrusion fails the run like off-page ink does:
    # all three are text the reader cannot read, and all stayed invisible to
    # the log (or visible only as a warning nobody was reading).
    sys.exit(1 if (loss or collisions or intrusions) else 0)

if __name__ == "__main__":
    main()
