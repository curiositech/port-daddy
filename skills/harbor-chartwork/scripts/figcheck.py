#!/usr/bin/env python3
"""figcheck.py -- mechanical geometry QA on one compiled figure PDF.

Runs eight PyMuPDF geometry checks against a single-figure PDF (as produced by
compile_fragment.sh) and reports pass/fail/warn per check:

  T1  minimum rendered text size       (below --min-font-pt: FAIL)
  T2  text escaping its container      (a text line inside a filled drawn
                                         rect, but not fully contained by it: FAIL)
  T3  pairwise text overlap            (two different text lines overlapping
                                         > 5% of the smaller one's area: FAIL)
  T4  a drawn line through text        (a stroked straight segment crossing a
                                         text line's bbox INTERIOR, not just
                                         grazing its edge: FAIL)
  T5  content outside the MediaBox     (a text line or drawing not fully on
                                         the page: FAIL)
  T6  dead canvas                      (drawn+text content bbox under 40% of
                                         the page in BOTH width and height: WARN)
  T7  wider than the chapter textwidth (content bbox wider than --textwidth-cm: WARN)
  T8  caption collision                (a vector drawing or a tikzpicture text
                                         span intersects the caption's own text
                                         block: FAIL)

All checks operate purely on rendered PDF geometry (PyMuPDF's get_text("dict")
and get_drawings()), not on the TikZ source -- this is deliberately the
complement of tikz_precheck.py, which reads source and needs no compile.

T8 identifies the caption as the rendered text LINE whose text starts with
"Figure"/"Table" followed by a number or colon (e.g. "Figure 1: ..."); if no
line matches that pattern, it falls back to the lowest (bottom-most) text
line on the page, on the theory that a caption is normally the last thing on
a standalone figure page. Any other text line or any drawing (path/line/rect
from get_drawings()) that geometrically intersects that line's bbox is a hit
-- the figure's own artwork or a reproduced caption bar bleeding into the
real caption. (Line, not pymupdf's own coarser "block" grouping, on purpose:
a block can merge two visually-close-but-unrelated lines into one region,
which would blur exactly the collision this check looks for.)

Units: T1 works in PDF points (a span's reported font size already IS points).
T2-T6, T8 all work in PDF points internally; T7's --textwidth-cm is converted
to points (1cm = 28.346456692913385pt) before comparing.

Usage:
  figcheck.py PDF [--json OUT.json] [--md OUT.md] [--min-font-pt 7] [--textwidth-cm 16.3]

Exit status:
  0  every T1-T5, T8 check passed on every page (T6/T7 warnings do not affect this)
  1  at least one T1-T5, T8 check failed
  2  usage error, or the PDF could not be opened
"""
import argparse
import json
import re
import sys
from pathlib import Path

try:
    import pymupdf
except ImportError:  # pragma: no cover - environment guard, not a code path under test
    print("figcheck.py: requires the 'pymupdf' package", file=sys.stderr)
    sys.exit(2)

PT_PER_CM = 72.0 / 2.54
HARD_CHECKS = ("T1", "T2", "T3", "T4", "T5", "T8")
WARN_CHECKS = ("T6", "T7")
ALL_CHECKS = HARD_CHECKS + WARN_CHECKS

# T8: a caption line's text starts with "Figure"/"Table" followed shortly by
# a digit or a colon -- "Figure 1: ...", "Table 2 ...", "Figure: ...".
# Matched per rendered text LINE, not the coarser pymupdf "block" grouping --
# a block can merge two visually-close-but-unrelated lines together (exactly
# the collision T8 is looking for), so identifying "the caption" at block
# granularity would blur it with whatever it collides with. A line is the
# same unit T2-T5 already reason about.
CAPTION_LEAD_RE = re.compile(r"^\s*(Figure|Table)\s*[\d:]")

# Geometry tolerances (points). These absorb normal font-metric/antialiasing
# fuzz so the checks fire on real problems, not on floating-point noise.
CONTAINMENT_TOL_PT = 0.75      # T2: a text bbox may poke this far past its container
LINE_SHRINK_PT = 0.75          # T4: shrink a text bbox by this much before testing
                                #     line-interior crossings, so a line that only
                                #     grazes the exact edge does not count
MEDIABOX_TOL_PT = 0.5          # T5
MIN_CONTAINER_DIM_PT = 3.0     # T2: ignore hairline/degenerate "containers"
MAX_CONTAINER_ITEMS = 5        # T2: a container is one rectangle, not a multi-shape path
OVERLAP_FRACTION = 0.05        # T3
T1_TOLERANCE_PT = 0.1          # T1: font-metric rounding slack
T1_SHORT_SPAN_PT = 1.1         # T1: sub/superscripts and tick numerals (<= 3 glyphs)
ADJACENT_LINE_VFRAC = 0.4      # T3: stacked lines whose boxes touch this little are neighbours, not a collision
DEAD_CANVAS_FRACTION = 0.40    # T6
OVERWIDTH_TOL_CM = 0.2         # T7: see check_t7 -- absorbs resizebox rounding noise


# --------------------------------------------------------------------------- #
# Geometry primitives
# --------------------------------------------------------------------------- #

def rect_area(r):
    return max(0.0, r[2] - r[0]) * max(0.0, r[3] - r[1])


def rect_contains(outer, inner, tol=0.0):
    return (
        inner[0] >= outer[0] - tol
        and inner[1] >= outer[1] - tol
        and inner[2] <= outer[2] + tol
        and inner[3] <= outer[3] + tol
    )


def rect_center(r):
    return ((r[0] + r[2]) / 2.0, (r[1] + r[3]) / 2.0)


def point_in_rect(pt, r, eps=0.0):
    return (r[0] - eps) <= pt[0] <= (r[2] + eps) and (r[1] - eps) <= pt[1] <= (r[3] + eps)


def rect_overlap_area(a, b):
    x0 = max(a[0], b[0])
    y0 = max(a[1], b[1])
    x1 = min(a[2], b[2])
    y1 = min(a[3], b[3])
    if x1 <= x0 or y1 <= y0:
        return 0.0
    return (x1 - x0) * (y1 - y0)


def shrink_rect(r, amt):
    return (r[0] + amt, r[1] + amt, r[2] - amt, r[3] - amt)


def union_rect(rects):
    rects = list(rects)
    if not rects:
        return None
    x0 = min(r[0] for r in rects)
    y0 = min(r[1] for r in rects)
    x1 = max(r[2] for r in rects)
    y1 = max(r[3] for r in rects)
    return (x0, y0, x1, y1)


def liang_barsky_clip(p0, p1, rect):
    """Clip segment p0->p1 against axis-aligned rect. Return (t0, t1) in [0,1]
    for the portion of the segment inside rect, or None if it never enters."""
    x0, y0 = p0
    x1, y1 = p1
    dx = x1 - x0
    dy = y1 - y0
    xmin, ymin, xmax, ymax = rect
    t0, t1 = 0.0, 1.0
    for p, q in ((-dx, x0 - xmin), (dx, xmax - x0), (-dy, y0 - ymin), (dy, ymax - y0)):
        if p == 0:
            if q < 0:
                return None
            continue
        r = q / p
        if p < 0:
            if r > t1:
                return None
            if r > t0:
                t0 = r
        else:
            if r < t0:
                return None
            if r < t1:
                t1 = r
    if t0 > t1:
        return None
    return (t0, t1)


# --------------------------------------------------------------------------- #
# PDF extraction
# --------------------------------------------------------------------------- #

def extract_lines(page):
    """One record per rendered text LINE (pymupdf groups a `\\node`'s text into
    one block; a wrapped node produces one line per wrapped row). Grouping at
    line granularity -- not per-span/per-word -- is deliberate: T2-T4 ask
    geometric questions about a line of text as a reader sees it, and checking
    at word granularity would both spam N findings for one overflowing line
    and misfire on ordinary inter-word adjacency."""
    lines = []
    td = page.get_text("dict")
    for block in td.get("blocks", []):
        if block.get("type") != 0:
            continue
        for li, line in enumerate(block.get("lines", [])):
            spans = line.get("spans", [])
            if not spans:
                continue
            text = "".join(sp.get("text", "") for sp in spans)
            sizes = [sp["size"] for sp in spans if sp.get("text", "").strip()]
            lines.append(
                {
                    "block_no": block["number"],
                    "line_no": li,
                    "bbox": tuple(line["bbox"]),
                    "text": text,
                    "max_size": max(sizes) if sizes else (spans[0]["size"] if spans else 0.0),
                    "spans": spans,
                }
            )
    return lines


def extract_spans(page):
    """One record per rendered text SPAN (a run of same-formatted glyphs,
    typically one word). Used only by T1, which cares about the smallest
    individual piece of rendered text, not the wrapping line."""
    out = []
    td = page.get_text("dict")
    for block in td.get("blocks", []):
        if block.get("type") != 0:
            continue
        for li, line in enumerate(block.get("lines", [])):
            for sp in line.get("spans", []):
                if not sp.get("text", "").strip():
                    continue  # bare whitespace spans carry no legible glyph
                out.append(
                    {
                        "block_no": block["number"],
                        "line_no": li,
                        "bbox": tuple(sp["bbox"]),
                        "text": sp["text"],
                        "size": sp["size"],
                    }
                )
    return out


def extract_drawings(page):
    """TikZ/pgf output (what compile_fragment.sh produces) always draws even a
    rectangle as four explicit line-to segments ('l' items), never the compact
    PDF 're' operator -- but PyMuPDF's own drawing primitives (used by this
    script's unit tests) emit 're' for draw_rect(). Decomposing 're' into its
    four edges here means T4 sees straight-line geometry the same way
    regardless of which path the PDF took to describe a rectangle."""
    out = []
    for d in page.get_drawings():
        segments = []
        if d["type"] in ("s", "fs"):
            for item in d["items"]:
                if item[0] == "l":
                    p0, p1 = item[1], item[2]
                    segments.append(((p0.x, p0.y), (p1.x, p1.y)))
                elif item[0] == "re":
                    r = item[1]
                    corners = [(r.x0, r.y0), (r.x1, r.y0), (r.x1, r.y1), (r.x0, r.y1)]
                    for k in range(4):
                        segments.append((corners[k], corners[(k + 1) % 4]))
        out.append({"rect": tuple(d["rect"]), "type": d["type"], "segments": segments,
                    "n_items": len(d["items"])})
    return out


# --------------------------------------------------------------------------- #
# Checks -- each returns a list of finding dicts for one page
# --------------------------------------------------------------------------- #

def check_t1(spans, min_font_pt, page_no):
    findings = []
    for sp in spans:
        # A 0.1 pt tolerance absorbs font-metric rounding: a 7 pt subscript
        # in a Palatino caption reports 6.97 pt.  Anything smaller is real.
        # Sub- and superscripts and tick numerals are one to three glyphs set
        # at 70 % of the surrounding size; at \footnotesize that is 5.98 pt.
        # Every printed textbook does this, so short spans get a wider band
        # (T1_SHORT_SPAN_PT) while running text keeps the strict floor.
        tol = T1_SHORT_SPAN_PT if len(sp["text"].strip()) <= 3 else T1_TOLERANCE_PT
        if sp["size"] < min_font_pt - tol:
            findings.append(
                {
                    "check": "T1",
                    "severity": "fail",
                    "page": page_no,
                    "bbox": sp["bbox"],
                    "text": sp["text"],
                    "size_pt": round(sp["size"], 2),
                    "message": f"text {sp['text']!r} renders at {sp['size']:.2f}pt, "
                    f"below the {min_font_pt:.2f}pt floor",
                }
            )
    return findings


def check_t2(lines, drawings, page_no):
    findings = []
    containers = [
        d
        for d in drawings
        if d["type"] in ("f", "fs")
        # one rectangle (a single 're' item, or four line segments and a close):
        # a bar series or a multi-cell grid drawn as one path is not a box that
        # text lives inside, even though its bounding rect encloses labels
        and d.get("n_items", 0) <= MAX_CONTAINER_ITEMS
        and (d["rect"][2] - d["rect"][0]) >= MIN_CONTAINER_DIM_PT
        and (d["rect"][3] - d["rect"][1]) >= MIN_CONTAINER_DIM_PT
    ]
    for ln in lines:
        center = rect_center(ln["bbox"])
        candidates = [c for c in containers if point_in_rect(center, c["rect"])]
        if not candidates:
            continue
        best = min(candidates, key=lambda c: rect_area(c["rect"]))
        if not rect_contains(best["rect"], ln["bbox"], tol=CONTAINMENT_TOL_PT):
            findings.append(
                {
                    "check": "T2",
                    "severity": "fail",
                    "page": page_no,
                    "bbox": ln["bbox"],
                    "container_bbox": best["rect"],
                    "text": ln["text"],
                    "message": f"text {ln['text']!r} escapes its containing rect "
                    f"{tuple(round(v, 1) for v in best['rect'])}",
                }
            )
    return findings


def _adjacent_lines(ra, rb):
    """Two text boxes stacked as consecutive lines of one paragraph: they share
    most of their horizontal extent and their vertical overlap is a sliver
    (ascenders of one line touching descenders of the next).  Math-heavy
    caption lines do this under every font; it is leading, not a collision."""
    x_overlap = min(ra[2], rb[2]) - max(ra[0], rb[0])
    narrower = min(ra[2] - ra[0], rb[2] - rb[0])
    if narrower <= 0 or x_overlap < 0.5 * narrower:
        return False
    y_overlap = min(ra[3], rb[3]) - max(ra[1], rb[1])
    shorter = min(ra[3] - ra[1], rb[3] - rb[1])
    return shorter > 0 and 0 < y_overlap < ADJACENT_LINE_VFRAC * shorter


def check_t3(lines, page_no):
    findings = []
    n = len(lines)
    for i in range(n):
        a = lines[i]
        area_a = rect_area(a["bbox"])
        if area_a <= 0:
            continue
        for j in range(i + 1, n):
            b = lines[j]
            if a["block_no"] == b["block_no"] and a["line_no"] == b["line_no"]:
                continue  # same rendered line: normal word-to-word adjacency
            area_b = rect_area(b["bbox"])
            if area_b <= 0:
                continue
            overlap = rect_overlap_area(a["bbox"], b["bbox"])
            if overlap <= 0:
                continue
            smaller = min(area_a, area_b)
            frac = overlap / smaller
            if frac > OVERLAP_FRACTION and not _adjacent_lines(a["bbox"], b["bbox"]):
                findings.append(
                    {
                        "check": "T3",
                        "severity": "fail",
                        "page": page_no,
                        "bbox": a["bbox"],
                        "other_bbox": b["bbox"],
                        "text": a["text"],
                        "other_text": b["text"],
                        "overlap_fraction": round(frac, 3),
                        "message": f"text {a['text']!r} overlaps {b['text']!r} by "
                        f"{frac * 100:.1f}% of the smaller bbox",
                    }
                )
    return findings


def check_t4(lines, drawings, page_no):
    findings = []
    segments = []
    for d in drawings:
        segments.extend(d["segments"])
    for ln in lines:
        w = ln["bbox"][2] - ln["bbox"][0]
        h = ln["bbox"][3] - ln["bbox"][1]
        if w <= 2 * LINE_SHRINK_PT or h <= 2 * LINE_SHRINK_PT:
            continue  # too small to have a meaningful "interior" left after shrinking
        shrunk = shrink_rect(ln["bbox"], LINE_SHRINK_PT)
        hit = None
        for p0, p1 in segments:
            if p0 == p1:
                continue
            clip = liang_barsky_clip(p0, p1, shrunk)
            if clip and (clip[1] - clip[0]) > 1e-6:
                hit = (p0, p1)
                break
        if hit:
            findings.append(
                {
                    "check": "T4",
                    "severity": "fail",
                    "page": page_no,
                    "bbox": ln["bbox"],
                    "text": ln["text"],
                    "line_segment": hit,
                    "message": f"a drawn line crosses through the interior of text {ln['text']!r}",
                }
            )
    return findings


def check_t5(lines, drawings, page_rect, page_no):
    findings = []
    for ln in lines:
        if not rect_contains(page_rect, ln["bbox"], tol=MEDIABOX_TOL_PT):
            findings.append(
                {
                    "check": "T5",
                    "severity": "fail",
                    "page": page_no,
                    "bbox": ln["bbox"],
                    "text": ln["text"],
                    "message": f"text {ln['text']!r} at {tuple(round(v, 1) for v in ln['bbox'])} "
                    f"falls outside the MediaBox {tuple(round(v, 1) for v in page_rect)}",
                }
            )
    for d in drawings:
        if not rect_contains(page_rect, d["rect"], tol=MEDIABOX_TOL_PT):
            findings.append(
                {
                    "check": "T5",
                    "severity": "fail",
                    "page": page_no,
                    "bbox": d["rect"],
                    "message": f"a drawing at {tuple(round(v, 1) for v in d['rect'])} "
                    f"falls outside the MediaBox {tuple(round(v, 1) for v in page_rect)}",
                }
            )
    return findings


def check_t6(content_rect, page_rect, page_no):
    if content_rect is None:
        return [
            {
                "check": "T6",
                "severity": "warn",
                "page": page_no,
                "message": "no drawn content or text found on this page",
            }
        ]
    cw = content_rect[2] - content_rect[0]
    ch = content_rect[3] - content_rect[1]
    pw = page_rect[2] - page_rect[0]
    ph = page_rect[3] - page_rect[1]
    if pw <= 0 or ph <= 0:
        return []
    if (cw / pw) < DEAD_CANVAS_FRACTION and (ch / ph) < DEAD_CANVAS_FRACTION:
        return [
            {
                "check": "T6",
                "severity": "warn",
                "page": page_no,
                "content_bbox": content_rect,
                "message": f"drawn content is only {cw / pw * 100:.0f}% x {ch / ph * 100:.0f}% "
                f"of the page (both below {DEAD_CANVAS_FRACTION * 100:.0f}%)",
            }
        ]
    return []


def check_t7(content_rect, textwidth_pt, textwidth_cm, page_no):
    """Warn only past a real margin, not a rounding hair: across this skill's
    own corpus audit, a fragment sized via `\\resizebox{0.9\\textwidth}{!}{...}`
    routinely lands a fraction of a millimeter over textwidth from ordinary
    stroke-width/line-cap rounding (median overage ~0.01cm across 105 cases) --
    noise that would otherwise drown out the real, actionable outliers (a
    handful of fragments 0.5-2.8cm over)."""
    if content_rect is None:
        return []
    cw = content_rect[2] - content_rect[0]
    tolerance_pt = OVERWIDTH_TOL_CM * PT_PER_CM
    if cw > textwidth_pt + tolerance_pt:
        return [
            {
                "check": "T7",
                "severity": "warn",
                "page": page_no,
                "content_width_pt": round(cw, 1),
                "textwidth_pt": round(textwidth_pt, 1),
                "message": f"drawn content is {cw / PT_PER_CM:.2f}cm wide, "
                f"wider than the {textwidth_cm:.2f}cm chapter textwidth",
            }
        ]
    return []


def find_caption_lines(lines):
    """The line(s) whose text opens like a caption ("Figure 1: ...",
    "Table 2 ..."); if none match, fall back to the single lowest (largest
    bottom-edge y) text line on the page -- a standalone figure PDF normally
    has its caption as the last thing on the page even when it isn't
    literally prefixed "Figure"/"Table"."""
    matches = [ln for ln in lines if CAPTION_LEAD_RE.match(ln["text"])]
    if matches:
        return matches
    if not lines:
        return []
    return [max(lines, key=lambda ln: ln["bbox"][3])]


def check_t8(lines, drawings, page_no):
    findings = []
    for cap in find_caption_lines(lines):
        cap_rect = cap["bbox"]
        cap_text = cap["text"].strip()
        for d in drawings:
            if rect_overlap_area(cap_rect, d["rect"]) <= 0:
                continue
            findings.append(
                {
                    "check": "T8",
                    "severity": "fail",
                    "page": page_no,
                    "bbox": d["rect"],
                    "caption_bbox": cap_rect,
                    "caption_text": cap_text,
                    "message": f"a drawing at {tuple(round(v, 1) for v in d['rect'])} "
                    f"intersects the caption {cap_text!r} at "
                    f"{tuple(round(v, 1) for v in cap_rect)}",
                }
            )
        for ln in lines:
            if ln is cap:
                continue  # the caption's own line, not a collision with itself
            if rect_overlap_area(cap_rect, ln["bbox"]) <= 0:
                continue
            findings.append(
                {
                    "check": "T8",
                    "severity": "fail",
                    "page": page_no,
                    "bbox": ln["bbox"],
                    "caption_bbox": cap_rect,
                    "caption_text": cap_text,
                    "text": ln["text"],
                    "message": f"text {ln['text']!r} intersects the caption {cap_text!r} "
                    f"at {tuple(round(v, 1) for v in cap_rect)}",
                }
            )
    return findings


# --------------------------------------------------------------------------- #
# Driver
# --------------------------------------------------------------------------- #

def run_figcheck(pdf_path, min_font_pt=7.0, textwidth_cm=16.3):
    doc = pymupdf.open(pdf_path)
    textwidth_pt = textwidth_cm * PT_PER_CM
    findings = []
    for page_no in range(len(doc)):
        page = doc[page_no]
        page_rect = tuple(page.mediabox)
        spans = extract_spans(page)
        lines = extract_lines(page)
        drawings = extract_drawings(page)
        content_rect = union_rect(
            [ln["bbox"] for ln in lines] + [d["rect"] for d in drawings]
        )

        findings += check_t1(spans, min_font_pt, page_no)
        findings += check_t2(lines, drawings, page_no)
        findings += check_t3(lines, page_no)
        findings += check_t4(lines, drawings, page_no)
        findings += check_t5(lines, drawings, page_rect, page_no)
        findings += check_t6(content_rect, page_rect, page_no)
        findings += check_t7(content_rect, textwidth_pt, textwidth_cm, page_no)
        findings += check_t8(lines, drawings, page_no)

    by_check = {c: [] for c in ALL_CHECKS}
    for f in findings:
        by_check[f["check"]].append(f)

    checks_report = {}
    for c in ALL_CHECKS:
        items = by_check[c]
        if c in HARD_CHECKS:
            status = "fail" if items else "pass"
        else:
            status = "warn" if items else "pass"
        checks_report[c] = {"status": status, "count": len(items), "findings": items}

    hard_failed = [c for c in HARD_CHECKS if checks_report[c]["status"] == "fail"]
    warned = [c for c in WARN_CHECKS if checks_report[c]["status"] == "warn"]

    report = {
        "pdf": str(pdf_path),
        "page_count": len(doc),
        "params": {"min_font_pt": min_font_pt, "textwidth_cm": textwidth_cm},
        "checks": checks_report,
        "summary": {
            "result": "fail" if hard_failed else "pass",
            "failed_checks": hard_failed,
            "warned_checks": warned,
        },
    }
    doc.close()
    return report


CHECK_LABELS = {
    "T1": "minimum rendered text size",
    "T2": "text escaping its container",
    "T3": "pairwise text overlap",
    "T4": "a drawn line through text",
    "T5": "content outside the MediaBox",
    "T6": "dead canvas (warn only)",
    "T7": "wider than chapter textwidth (warn only)",
    "T8": "caption collision",
}


def render_markdown(report):
    lines = []
    lines.append(f"# figcheck: `{Path(report['pdf']).name}`")
    lines.append("")
    lines.append(f"Result: **{report['summary']['result'].upper()}** "
                 f"({report['page_count']} page(s))")
    lines.append("")
    lines.append("| Check | What it means | Status | Findings |")
    lines.append("|---|---|---|---|")
    for c in ALL_CHECKS:
        chk = report["checks"][c]
        lines.append(f"| {c} | {CHECK_LABELS[c]} | {chk['status']} | {chk['count']} |")
    lines.append("")
    for c in ALL_CHECKS:
        chk = report["checks"][c]
        if not chk["findings"]:
            continue
        lines.append(f"## {c} -- {CHECK_LABELS[c]}")
        for f in chk["findings"]:
            lines.append(f"- (page {f.get('page', 0)}) {f['message']}")
        lines.append("")
    return "\n".join(lines)


def main(argv=None):
    ap = argparse.ArgumentParser(description="Mechanical geometry QA on one compiled figure PDF.")
    ap.add_argument("pdf")
    ap.add_argument("--json", help="write the JSON report to this path")
    ap.add_argument("--md", help="write the markdown summary to this path")
    ap.add_argument("--min-font-pt", type=float, default=7.0)
    ap.add_argument("--textwidth-cm", type=float, default=16.3)
    args = ap.parse_args(argv)

    pdf_path = Path(args.pdf)
    if not pdf_path.is_file():
        print(f"figcheck.py: no such file: {pdf_path}", file=sys.stderr)
        return 2

    try:
        report = run_figcheck(pdf_path, min_font_pt=args.min_font_pt, textwidth_cm=args.textwidth_cm)
    except Exception as exc:  # noqa: BLE001 -- surface any PDF-parsing failure as a usage error
        print(f"figcheck.py: could not process {pdf_path}: {exc}", file=sys.stderr)
        return 2

    if args.json:
        Path(args.json).write_text(json.dumps(report, indent=2, default=str))
    if args.md:
        Path(args.md).write_text(render_markdown(report))

    if not args.json and not args.md:
        print(json.dumps(report, indent=2, default=str))

    return 1 if report["summary"]["result"] == "fail" else 0


if __name__ == "__main__":
    sys.exit(main())
