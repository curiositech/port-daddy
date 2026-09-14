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
  T9  dash resolution                  (a dashed/dotted stroke whose on-length,
                                         gap or stroke width falls below one
                                         device pixel at --dash-dpi: FAIL)
  T10 typeface consistency             (more than one text family inside the
                                         figure's own drawing, excluding the
                                         caption, the identifier face and math:
                                         FAIL)

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

T9 exists because a dash pattern is the one part of a figure's style that can
be present in the source, present in the PDF, and absent on the page. `pd guide`
shipped `on 0.448pt off 0.996pt` on a 0.498pt stroke: at 150 dpi that is a
0.93 px dot -- under one device pixel -- repeating every 3.01 px, and its
rendered weight varied 1.6x with nothing but where each dot happened to land on
the pixel grid. No source linter can see that: the source says `densely dotted`
and the caption says "dotted", and both are true. Only the compiled PDF carries
the numbers, so the check belongs here.

What T9 can and cannot decide. It reads the exact dash array, stroke width and
scale off the content stream, so "this dash is smaller than a pixel at DPI" is
arithmetic, not a guess -- that part is sound. It does NOT decide whether the
result *looks* dotted: a pattern can clear every threshold here and still read
as solid at a distance, or be lost against a busy background. The thresholds
below are a floor, and clearing them is necessary, not sufficient.

T10 exists because every other check in this file measures GEOMETRY -- size,
overlap, escape, lines through text, mediabox, dead canvas, width, caption
collision -- and none of them looks at the thing a reader notices first. The
Book's stack map passes T1 through T9 clean and was rejected on sight, because
under the Book preamble it sets `MACHINE FLOOR` and `file lock, clock, socket,
supervisor` in TeXGyrePagellaX (the body serif) and every other label in
TeXGyreHeros (the edition's grotesk). One drawing, two faces. The figure does
not merely disagree with the rest of the corpus; it disagrees with itself.

What T10 asserts is deliberately narrow: ONE text family inside the drawing. It
does not assert WHICH family, because that is an edition's decision -- the Swiss
and technical editions set figures in grotesk against a Palatino page on
purpose, so "the figure's face must match the caption's" would be wrong here and
would fire on every correctly-set figure in the Book. Two faces inside one
drawing is wrong under every edition, which is why that is the line it draws.

Two kinds of span are excluded, and the exclusions are named rather than
inferred. The IDENTIFIER face (`pd mono label`) is a second family by design.
MATH fonts are a second family by necessity -- a `$\kappa_7$` in a label pulls
in newpx's math set whatever the text face is. Both lists are in MONO_FAMILIES
and MATH_FAMILY_RE below, with the faces this repository's preambles actually
produce; a family in neither list is counted, so extending them is a visible act
rather than a silent one.

Units: T1 works in PDF points (a span's reported font size already IS points).
T2-T6, T8 all work in PDF points internally; T7's --textwidth-cm is converted
to points (1cm = 28.346456692913385pt) before comparing.

Ink metrics (advisory, not a check): each page's report also carries an
"ink" entry -- ink_fraction, edge_density, distinct_colors, and the plain-
English flags -- computed by rendering the same content region T6/T7 already
measure to a pixmap and running it through tufte-evidence-design's
scripts/ink_audit.py (imported, not copied). These numbers can never affect
figcheck's exit code; they exist to give a Tufte data-ink second opinion
alongside the geometry checks, the same way ink_audit.py itself is a prompt
for a human look, not a gate, when run standalone.

Usage:
  figcheck.py PDF [--json OUT.json] [--md OUT.md] [--min-font-pt 7]
                  [--textwidth-cm 16.3] [--dash-dpi 150]

Exit status:
  0  every T1-T5, T8 check passed on every page (T6/T7 warnings do not affect this)
  1  at least one T1-T5, T8 check failed
  2  usage error, or the PDF could not be opened
"""
import argparse
import importlib.util
import json
import math
import re
import sys
from pathlib import Path

try:
    import pymupdf
except ImportError:  # pragma: no cover - environment guard, not a code path under test
    print("figcheck.py: requires the 'pymupdf' package", file=sys.stderr)
    sys.exit(2)

# The ink block (below) is a heuristic second opinion, not a check: it must
# never be able to change figcheck's exit code, so failing to import
# ink_audit.py (the skill moved, the file is missing) degrades to "no ink
# data" per page rather than crashing figcheck itself.
INK_AUDIT_PATH = Path(__file__).resolve().parents[3] / "skills" / "tufte-evidence-design" / "scripts" / "ink_audit.py"


def _load_ink_audit():
    try:
        spec = importlib.util.spec_from_file_location("ink_audit", INK_AUDIT_PATH)
        module = importlib.util.module_from_spec(spec)
        assert spec.loader is not None
        spec.loader.exec_module(module)
        return module
    except Exception:  # noqa: BLE001 - advisory feature, never fatal
        return None

PT_PER_CM = 72.0 / 2.54
HARD_CHECKS = ("T1", "T2", "T3", "T4", "T5", "T8", "T9", "T10")
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

# T9. The reference device: 150 dpi at 1.0x, which is what "read it on a screen
# without zooming" means for a PDF whose natural unit is the point. 1pt = 150/72
# = 2.0833 px.
DASH_DPI_DEFAULT = 150.0
# A mark needs more than one device pixel to BE a mark: at exactly one pixel it
# is at the rasteriser's Nyquist limit, its weight depends on sub-pixel phase,
# and the two failure modes are a line that antialiases into nothing and a line
# whose dots merge into solid. Two pixels is the first length at which a dot
# renders at the same weight wherever it falls -- measured, on the probe in this
# skill's references/craft-rules.md, not picked as a round number.
DASH_MIN_ON_PX = 2.0
DASH_MIN_GAP_PX = 2.0
# A stroke thinner than a pixel is not fatal on its own -- a solid hairline at
# 0.5pt renders as a uniform light line, which is a legitimate thing to want.
# It is fatal in combination with a dash: the dot then has sub-pixel extent in
# BOTH directions and there is nothing left of it to see.
DASH_MIN_WIDTH_PX = 1.0

# T10. Turning a PDF font name into a FAMILY: drop a subset prefix (`ABCDEF+`),
# drop everything from the first hyphen (the weight/slope), drop a trailing
# `_gnu`-style variant tag and any trailing size digits (`CMR10`). So
# TeXGyreHeros-Bold, TeXGyreHeros-Regular and TeXGyreHeros-Italic are ONE
# family: T10 is about faces, and a role separating itself by weight or slope is
# what the house style asks for.
FONT_SUBSET_RE = re.compile(r"^[A-Z]{6}\+")
FONT_VARIANT_RE = re.compile(r"(_[A-Za-z]+)?\d*$")

# The identifier face. A second family inside the drawing BY DESIGN: `pd mono
# label` is the one role licensed to change family, because an identifier a
# reader could type has to look like code. Listed, not guessed -- SourceCodePro
# is what this repository's preambles resolve \ttfamily to; the rest are the
# usual alternatives, so a preamble change does not silently start failing.
MONO_FAMILIES = {
    "SourceCodePro", "Courier", "NimbusMonoPS", "TeXGyreCursor",
    "LMMono", "LMMonoLt", "DejaVuSansMono", "Inconsolata", "FiraMono", "CMTT",
}
# Math fonts. A second family by NECESSITY rather than by choice: a `$\kappa_7$`
# inside a label pulls in the math set whatever the text face is, and no author
# chose it. This matches the newpx family these preambles load (NewPXMI, pxsys,
# pxmiaX) plus the common Computer Modern / Unicode-math sets.
MATH_FAMILY_RE = re.compile(
    r"^(newpx|px|cm(mi|sy|ex)|msam|msbm|rsfs|eufm|stix|xits|lmmath|"
    r"latinmodernmath|texgyre\w*math)|math",
    re.IGNORECASE,
)

# T10 counts only spans carrying a WORD -- two or more consecutive letters.
#
# This is the exclusion that makes the check sound, and it was found by running
# it: a first version counted every span and failed 46 of 66 fragments, which is
# not 46 broken figures. TeX sets math DIGITS and single math variables in the
# TEXT roman family whatever face the surrounding node is in, so every pgfplots
# axis with numerals on it, and every `$k=3$` in a label, showed the body serif
# inside a grotesk drawing. Nobody chose that and there is nothing to fix.
#
# A word is different. `the disagreement closes a cycle` in Palatino inside a
# grotesk drawing is a node that reached past the styles -- in practice a
# `\normalfont` inside the node's TEXT, which resets to the DOCUMENT's family
# and which no `font=` rule can see. Two letters in a row is the smallest thing
# that separates the two cases, and it is a property of the glyphs rather than a
# guess about the source.
WORD_RE = re.compile(r"[A-Za-z]{2}")


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
                        # T10: the face this run was actually set in. The PDF is
                        # the only place this exists -- the source says
                        # \sffamily or nothing at all, and which font that
                        # resolves to depends on the preamble that compiled it.
                        "font": sp.get("font", ""),
                    }
                )
    return out


def font_family(name):
    """A PDF font name reduced to its family. See FONT_SUBSET_RE above."""
    name = FONT_SUBSET_RE.sub("", name or "")
    name = name.split("-", 1)[0]
    return FONT_VARIANT_RE.sub("", name) or name


def classify_family(family):
    """'mono', 'math', or 'text'. Only 'text' families are counted by T10."""
    if family in MONO_FAMILIES:
        return "mono"
    if MATH_FAMILY_RE.search(family):
        return "math"
    return "text"


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
                    "n_items": len(d["items"]),
                    # T9 needs the stroke's own parameters, which live on the
                    # drawing dict rather than on its items.
                    "dashes": d.get("dashes"), "width": d.get("width"),
                    "scale": _stroke_scale(d)})
    return out


def _stroke_scale(d):
    """The uniform scale the CTM applies to this path's stroke, so a dash
    measured in user-space units is converted to PAGE points before it is
    converted to pixels. pgf normally emits figure geometry at the identity
    CTM, in which case this is 1.0 -- but a `\\resizebox` or a `scale=` on the
    tikzpicture does reach the matrix, and a dash inside a 0.6x resizebox is
    0.6x smaller on the page than its dash array says. Taking the geometric
    mean of the two axis scales is exact for the uniform case (the only one
    TeX produces here) and a reasonable summary otherwise."""
    m = d.get("matrix") if isinstance(d, dict) else None
    if m is None:
        return 1.0
    try:
        a, b, c, dd = float(m.a), float(m.b), float(m.c), float(m.d)
    except (AttributeError, TypeError, ValueError):
        return 1.0
    sx = math.hypot(a, b)
    sy = math.hypot(c, dd)
    if sx <= 0 or sy <= 0:
        return 1.0
    return math.sqrt(sx * sy)


DASH_ARRAY_RE = re.compile(r"-?\d+(?:\.\d+)?|\.\d+")


def parse_dash(dashes):
    """PyMuPDF hands back the raw PDF dash setting as a string: '[ 1.2 2 ] 0',
    '[] 0' for a solid stroke, occasionally '[ 3 ] 0' for an on==off pattern.
    Returns (on_lengths, gap_lengths) in user-space units, or None for a stroke
    with no dash. A single-element array means on and off are the same length,
    which is what the PDF spec says and what pgf's `dashed` compiles to on some
    engines -- reading it as 'on only' would silently pass a zero gap."""
    if not dashes or not isinstance(dashes, str):
        return None
    inside = dashes.split("]")[0]
    nums = [float(x) for x in DASH_ARRAY_RE.findall(inside)]
    nums = [x for x in nums if x >= 0]
    if not nums or all(x == 0 for x in nums):
        return None
    if len(nums) == 1:
        return [nums[0]], [nums[0]]
    return nums[0::2], nums[1::2]


# --------------------------------------------------------------------------- #
# Checks -- each returns a list of finding dicts for one page
# --------------------------------------------------------------------------- #

def check_t1(spans, min_font_pt, page_no):
    findings = []
    for sp in spans:
        # T1 has TWO bands, and which one applied is now said out loud in the
        # finding, because a floor nobody can see the value of gets argued about
        # rather than met.
        #
        # Running text: the strict floor, with a 0.1 pt tolerance for
        # font-metric rounding (a 7 pt subscript in a Palatino caption reports
        # 6.97 pt; anything smaller is real).
        #
        # A span of three glyphs or fewer -- a sub/superscript, a tick numeral:
        # a wider band. Measured on this repository's own styles, a subscript
        # inside a \pdfiglabelsize label renders at 5.98 pt in a standalone
        # chapter (66.7 % of its 8.97 pt base) and 6.36 pt in the Book (72.9 %
        # of 8.72 pt). Every typesetter that has ever existed sets a subscript
        # at roughly 70 % of its base, so holding one to the running-text floor
        # would mean either no subscripts in figures or a figure whose base type
        # is larger than the body text beside it. The band is a decision about
        # what T1 is measuring, not a loophole.
        #
        # It is also a narrow band, and that narrowness is the reason
        # \pdfigmath exists: 5.98 pt clears 5.9 pt by 0.08 pt. Promotion is not
        # a way to pass T1 -- those subscripts already pass -- it is a way to
        # stop living 0.08 pt from the edge.
        short = len(sp["text"].strip()) <= 3
        tol = T1_SHORT_SPAN_PT if short else T1_TOLERANCE_PT
        band = "short-span" if short else "running-text"
        if sp["size"] < min_font_pt - tol:
            findings.append(
                {
                    "check": "T1",
                    "severity": "fail",
                    "page": page_no,
                    "bbox": sp["bbox"],
                    "text": sp["text"],
                    "size_pt": round(sp["size"], 2),
                    "band": band,
                    "floor_pt": round(min_font_pt - tol, 2),
                    "message": f"text {sp['text']!r} renders at {sp['size']:.2f}pt, "
                    f"below the {min_font_pt - tol:.2f}pt {band} floor "
                    f"({min_font_pt:.2f}pt nominal, {tol:.2f}pt band)",
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
# Ink metrics -- advisory only, borrowed from tufte-evidence-design's
# ink_audit.py rather than reimplemented here.
# --------------------------------------------------------------------------- #

INK_RENDER_ZOOM = 2.0  # 144 "dpi"-equivalent: enough for the pixel-level ink/edge
                        # heuristics to mean something without being slow on a
                        # one-page figure fragment.


def _pixmap_to_decoded_image(pix, ink_audit):
    """Build an ink_audit.DecodedImage directly from a rendered PyMuPDF
    Pixmap's sample bytes -- no PNG round-trip, no Pillow dependency, and no
    duplication of ink_audit's own PNG decoder (which exists for files on
    disk, not for a pixmap this script already has in memory)."""
    n = pix.n  # channels actually present, excluding any separate alpha plane
    has_alpha = bool(pix.alpha)
    samples = pix.samples
    width, height = pix.width, pix.height
    pixels = []
    stride = n
    for i in range(0, len(samples), stride):
        chunk = samples[i:i + stride]
        if has_alpha:
            r, g, b, a = chunk[0], chunk[1], chunk[2], chunk[3]
        elif n >= 3:
            r, g, b, a = chunk[0], chunk[1], chunk[2], 255
        else:  # grayscale, no alpha
            g = chunk[0]
            r, g2, b, a = g, g, g, 255
            g = g2
        pixels.append((r, g, b, a))
    return ink_audit.DecodedImage(width, height, pixels)


def compute_page_ink(page, content_rect, page_rect, page_no, ink_audit):
    """Render the page's already-measured content region (the same
    content_rect check_t6/check_t7 use) to a pixmap and run it through
    ink_audit's own audit(), so figcheck's report carries a Tufte data-ink
    heuristic alongside its geometry checks. Advisory only: any failure here
    is swallowed into a `{"page":..., "error": ...}` entry, never raised, so
    it can never change figcheck's pass/fail exit code."""
    if ink_audit is None:
        return {"page": page_no, "error": "ink_audit.py not importable"}
    region = content_rect if content_rect is not None else page_rect
    try:
        clip = pymupdf.Rect(region) & pymupdf.Rect(page_rect)
        if clip.is_empty or clip.width <= 0 or clip.height <= 0:
            return {"page": page_no, "error": "no content region to render"}
        pix = page.get_pixmap(matrix=pymupdf.Matrix(INK_RENDER_ZOOM, INK_RENDER_ZOOM), clip=clip)
        img = _pixmap_to_decoded_image(pix, ink_audit)
        result = ink_audit.audit(img)
        return {
            "page": page_no,
            "ink_fraction": result["ink_fraction"],
            "edge_density": result["edge_density"],
            "distinct_colors": result["distinct_colors"],
            "flags": result["flags"],
        }
    except Exception as exc:  # noqa: BLE001 - advisory feature, never fatal
        return {"page": page_no, "error": str(exc)}


def check_t9(drawings, dash_dpi, page_no):
    """T9: a dash that cannot resolve at the reference device resolution.

    The failure this exists for is specific, and it is invisible everywhere
    else. `pd guide` was declared `line width=.45pt,densely dotted`. That
    expands to `dash pattern=on \\pgflinewidth off 1pt`, and \\pgflinewidth is
    read when the KEY is processed -- so an edition override that appended
    `line width=.5pt` afterwards widened the stroke and left the dash at the
    .45pt already baked in. Source says "densely dotted". Caption says
    "dotted". PDF says `[0.448 0.996]`. Page, at 150 dpi, says a 0.93-pixel
    dot whose weight swings 1.6x with sub-pixel phase.

    Only the last of those four is checkable, and only from the PDF.

    A dash is measured in three parts because it fails in three ways: too
    short an ON and the mark disappears, too short a GAP and adjacent marks
    merge into a solid line, too thin a STROKE and there is no mark in the
    other direction either. Each is reported separately, with the pixel
    figure, so the fix is arithmetic rather than taste.
    """
    findings = []
    px_per_pt = dash_dpi / 72.0
    for d in drawings:
        if d["type"] not in ("s", "fs"):
            continue
        parsed = parse_dash(d.get("dashes"))
        if parsed is None:
            continue
        ons, gaps = parsed
        scale = d.get("scale") or 1.0
        width_pt = (d.get("width") or 0.0) * scale
        width_px = width_pt * px_per_pt
        on_px = min(ons) * scale * px_per_pt
        gap_px = min(gaps) * scale * px_per_pt if gaps else 0.0
        problems = []
        if on_px < DASH_MIN_ON_PX:
            problems.append(f"on-length {min(ons) * scale:.3f}pt = {on_px:.2f}px "
                            f"(floor {DASH_MIN_ON_PX:g}px)")
        if gap_px < DASH_MIN_GAP_PX:
            problems.append(f"gap {min(gaps) * scale:.3f}pt = {gap_px:.2f}px "
                            f"(floor {DASH_MIN_GAP_PX:g}px)")
        if width_px < DASH_MIN_WIDTH_PX:
            problems.append(f"stroke {width_pt:.3f}pt = {width_px:.2f}px "
                            f"(floor {DASH_MIN_WIDTH_PX:g}px)")
        if not problems:
            continue
        findings.append({
            "check": "T9",
            "severity": "fail",
            "page": page_no,
            "rect": d["rect"],
            "dashes": d.get("dashes"),
            "message": (
                f"dashed stroke will not resolve at {dash_dpi:g} dpi / 1.0x: "
                + "; ".join(problems)
                + " -- state the pattern in absolute points and widen it, or drop "
                  "the dash if the distinction it makes is not one the reader needs"
            ),
        })
    return findings


def check_t10(spans, lines, page_no):
    """T10: more than one text family inside the figure's own drawing.

    The caption is excluded: it is page furniture, legitimately set in the body
    face, and on a standalone fragment PDF it is everything from the top of the
    first caption line downward. The identifier face and the math fonts are
    excluded for the reasons given in MONO_FAMILIES and MATH_FAMILY_RE.

    What is left is the drawing's own type, and there may be one face of it.
    Weight and slope are not faces -- TeXGyreHeros-Bold and -Regular are one
    family, and separating a role by weight is exactly what the house style
    asks. Two FAMILIES means some node reached past the styles and named its own
    font, which is what P18/P21 catch in source and what nothing caught on the
    page: the Book's stack map passes T1-T9 clean while setting two of its
    labels in Palatino and the rest in grotesk.
    """
    caps = find_caption_lines(lines)
    # Everything at or below the first caption line's TOP edge is caption. A
    # caption wraps to several lines and find_caption_lines only matches the
    # first; taking the whole band below it is right for a single-figure PDF and
    # errs toward excluding text rather than misattributing it to the drawing.
    caption_top = min((c["bbox"][1] for c in caps), default=None)
    families = {}
    for sp in spans:
        if caption_top is not None and sp["bbox"][1] >= caption_top - 0.5:
            continue
        fam = font_family(sp.get("font", ""))
        if not fam or classify_family(fam) != "text":
            continue
        text = sp["text"].strip()
        if not WORD_RE.search(text):
            continue
        rec = families.setdefault(fam, {"glyphs": 0, "sample": ""})
        rec["glyphs"] += len(text)
        if not rec["sample"]:
            rec["sample"] = text[:28]
    if len(families) <= 1:
        return []
    # The minority family is the defect: name it first, with a sample, so the
    # offending node is findable without opening the PDF.
    order = sorted(families.items(), key=lambda kv: kv[1]["glyphs"])
    listed = ", ".join(f"{fam} ({r['glyphs']} glyphs, e.g. {r['sample']!r})" for fam, r in order)
    return [
        {
            "check": "T10",
            "severity": "fail",
            "page": page_no,
            "families": {fam: r["glyphs"] for fam, r in order},
            "message": f"the drawing is set in {len(families)} typefaces: {listed}. "
            f"One figure, one face -- a node that names its own font (font=\\sffamily, "
            f"font=\\bfseries on top of a pd style) leaves the edition's face behind. "
            f"Take the role, not the font.",
        }
    ]


# --------------------------------------------------------------------------- #
# Driver
# --------------------------------------------------------------------------- #

def run_figcheck(pdf_path, min_font_pt=7.0, textwidth_cm=16.3, dash_dpi=DASH_DPI_DEFAULT):
    # Accept a str as well as a Path: the report below takes `.stem` off this
    # argument, so a caller passing a plain string (every test in
    # tests/test_figcheck*.py does) used to reach that line and raise
    # AttributeError after doing all the work. Coerce once, here.
    pdf_path = Path(pdf_path)
    doc = pymupdf.open(pdf_path)
    textwidth_pt = textwidth_cm * PT_PER_CM
    findings = []
    ink_audit = _load_ink_audit()
    ink_report = []
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
        findings += check_t9(drawings, dash_dpi, page_no)
        findings += check_t10(spans, lines, page_no)
        ink_report.append(compute_page_ink(page, content_rect, page_rect, page_no, ink_audit))

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
        # The FRAGMENT's name, not the path of the throwaway PDF it was measured
        # from. Those PDFs are compiled into whatever scratch directory the run
        # happened to use, so writing the absolute path stamped one session's
        # temp directory into 79 committed reports -- a string that names nothing
        # on any other machine, changes on every run, and makes a re-run of the
        # same figure look like a diff. The stem is the identity a reader wants
        # anyway: it is the fragment under figures/, and it is what the register
        # and the triage table key on.
        "figure": pdf_path.stem,
        "page_count": len(doc),
        "params": {"min_font_pt": min_font_pt, "textwidth_cm": textwidth_cm},
        "checks": checks_report,
        "ink": ink_report,
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
    "T9": "dash too small to resolve",
    "T10": "more than one typeface in the drawing",
}
# A label per check, asserted rather than assumed: render_markdown indexes this
# by check id, so a check added to ALL_CHECKS without a label here raises a
# KeyError in the report writer -- after the check has already done its work and
# the JSON has already been written. Fail at import, where it is obvious.
assert set(CHECK_LABELS) == set(ALL_CHECKS), (
    f"CHECK_LABELS and ALL_CHECKS disagree: {set(CHECK_LABELS) ^ set(ALL_CHECKS)}"
)


def render_markdown(report):
    lines = []
    # The report's identity key is "figure" (the fragment stem), not "pdf":
    # run_figcheck stopped emitting an absolute scratch path deliberately --
    # see its own comment -- and this line was left reading the old key, so
    # every `--md` run died with a KeyError.
    lines.append(f"# figcheck: `{report['figure']}`")
    lines.append("")
    lines.append(f"Result: **{report['summary']['result'].upper()}** "
                 f"({report['page_count']} page(s))")
    lines.append("")
    for entry in report.get("ink", []):
        if "error" in entry:
            lines.append(f"Ink (page {entry['page']}): unavailable -- {entry['error']}")
        else:
            lines.append(
                f"Ink (page {entry['page']}): fraction {entry['ink_fraction']:.3f}, "
                f"edge density {entry['edge_density']:.3f} "
                "(heuristic proxy, advisory only -- see tufte-evidence-design/scripts/ink_audit.py)"
            )
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
    ap.add_argument("--dash-dpi", type=float, default=DASH_DPI_DEFAULT,
                    help="reference device resolution for T9 (default 150, i.e. "
                         "a 1.0x screen read)")
    args = ap.parse_args(argv)

    pdf_path = Path(args.pdf)
    if not pdf_path.is_file():
        print(f"figcheck.py: no such file: {pdf_path}", file=sys.stderr)
        return 2

    try:
        report = run_figcheck(pdf_path, min_font_pt=args.min_font_pt,
                              textwidth_cm=args.textwidth_cm, dash_dpi=args.dash_dpi)
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
