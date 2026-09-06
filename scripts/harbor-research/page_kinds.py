#!/usr/bin/env python3
"""page_kinds.py -- measure how many kinds of content each page of a textbook
PDF shows.

Usage:
    page_kinds.py BOOK.pdf --out DIR [--chapters-from-bookmarks] [--debug PAGE]

Writes into DIR:
    page-kinds.csv  -- per-page kind census
    heat-strip.png  -- one row per chapter, one cell per page, shaded by n_kinds
    summary.md      -- per-chapter and whole-book statistics

Detection is deterministic and based purely on `page.get_text("dict")` spans:
fonts, sizes, boldness/small-caps, and literal text markers. See the module
docstrings on each `detect_*` function for the exact rule being applied.
"""
from __future__ import annotations

import argparse
import csv
import os
import re
import statistics
import sys
from collections import Counter, OrderedDict

import fitz  # PyMuPDF
from PIL import Image, ImageDraw, ImageFont

# --------------------------------------------------------------------------
# Constants / vocabulary
# --------------------------------------------------------------------------

# flags bit values from PyMuPDF span "flags":
#   1 superscript, 2 italic, 4 serifed, 8 monospaced, 16 bold
FLAG_ITALIC = 2
FLAG_MONO = 8
FLAG_BOLD = 16

CLAIM_KEYWORDS = [
    "Theorem",
    "Design invariant",
    "Model-checked property",
    "Empirical hypothesis",
    "Definition",
    "Lemma",
    "Corollary",
    "Proposition",
]
# Matches e.g. "Theorem 1.8.3", "Proposition 6.12.1", "Design invariant 2.1".
# Case-insensitive: some chapters set claim heads in title case ("Theorem"),
# others render the keyword in true upper case ("THEOREM") as a small-caps
# stand-in, exactly like the CHECK/TRACE/OPEN exercise labels.
CLAIM_RE = re.compile(
    r"^\s*(" + "|".join(re.escape(k) for k in CLAIM_KEYWORDS) + r")\s*\d+(\.\d+){0,3}\b",
    re.IGNORECASE,
)

FIGURE_RE = re.compile(r"^\s*Figure\s*\d+\.\d+\s*:", re.IGNORECASE)
TABLE_RE = re.compile(r"^\s*Table\s*\d+\.\d+\s*:", re.IGNORECASE)

EXNUM_RE = re.compile(r"^\d+\.\d+$")
EXTYPE_WORDS = {"CHECK", "TRACE", "OPEN"}
SOLUTION_RE = re.compile(r"^Solution\s+p\.")

PROOF_HEADS = {"proof.", "proof idea."}

ASIDE_KEYWORDS = ["Key idea", "Pitfall", "Scene", "See also", "Interlude"]

EXAMPLE_MARK = "Numbers by hand"
BOUNDARY_MARK = "Where this stops"
SESSION_MARK = "At the terminal"

RUNNING_HEAD_Y_MAX = 45.0  # points from top a running head / folio can live in
# Searched (not matched) against each top-strip span so it still finds the
# chapter marker whether "Chapter N." is its own span or PyMuPDF has merged
# it with the trailing chapter title into one span.
RUNNING_HEAD_CHAPTER_RE = re.compile(r"\bChapter\s+(\d+)\.")
FOLIO_RE = re.compile(r"^[ivxlcdm]+$|^\d{1,4}$", re.IGNORECASE)

ALL_KIND_NAMES = [
    "prose",
    "claim",
    "example",
    "boundary",
    "recall",
    "aside",
    "session",
    "figure",
    "table",
    "exercise",
    "proof",
    "code",
]

# Kinds that count for the "no figure/table/example/session" run detection.
ANCHOR_KINDS = {"figure", "table", "example", "session"}

MONOSPACE_RUN_MIN_LINES = 3
MONOSPACE_LINE_RATIO = 0.6


# --------------------------------------------------------------------------
# Low level span helpers
# --------------------------------------------------------------------------

def is_mono_font(fontname: str) -> bool:
    fn = fontname.lower()
    return "mono" in fn or "courier" in fn or fn.endswith("tt") or "tt-" in fn


def is_mono_span(span: dict) -> bool:
    """Monospace detection: PyMuPDF's own monospace flag bit is the most
    reliable signal; the font-name heuristic (Mono/tt/Courier in the name)
    is a fallback for renderers that don't set the bit."""
    return bool(span.get("flags", 0) & FLAG_MONO) or is_mono_font(span.get("font", ""))


def is_bold(flags: int) -> bool:
    return bool(flags & FLAG_BOLD)


def is_italic(flags: int) -> bool:
    return bool(flags & FLAG_ITALIC)


def looks_small_caps(span: dict) -> bool:
    """Small caps detection: font name carries the usual hints, or the text
    itself is rendered as multi-letter upper case (this book fakes small caps
    with plain upper-case text at a reduced size rather than a real small-caps
    font feature)."""
    font = span.get("font", "")
    fn = font.lower()
    if "sc" in fn or "smcp" in fn:
        return True
    txt = span.get("text", "").strip()
    letters = [c for c in txt if c.isalpha()]
    if len(letters) >= 2 and all(c.isupper() for c in letters):
        return True
    return False


def is_heading_style(span: dict) -> bool:
    return is_bold(span.get("flags", 0)) or looks_small_caps(span)


def get_page_lines(page):
    """Return a list of lines (each a list of non-empty spans) in the
    document's natural block/line order, tagged with the line's top y."""
    d = page.get_text("dict")
    lines = []
    for b in d.get("blocks", []):
        if "lines" not in b:
            continue
        for l in b["lines"]:
            spans = [s for s in l["spans"] if s.get("text", "") != ""]
            if not spans:
                continue
            y0 = min(s["bbox"][1] for s in spans)
            lines.append((y0, spans))
    return lines


def line_plain_text(spans):
    return "".join(s["text"] for s in spans)


# --------------------------------------------------------------------------
# Body-size estimation (what counts as "prose")
# --------------------------------------------------------------------------

def estimate_body_size(doc, sample_pages=60):
    sizes = Counter()
    n = len(doc)
    step = max(1, n // sample_pages)
    for i in range(0, n, step):
        page = doc[i]
        for y0, spans in get_page_lines(page):
            for s in spans:
                txt = s["text"].strip()
                if len(txt) < 4:
                    continue
                if is_bold(s["flags"]) or is_italic(s["flags"]):
                    continue
                sizes[round(s["size"], 1)] += len(txt)
    if not sizes:
        return 10.5
    return sizes.most_common(1)[0][0]


# --------------------------------------------------------------------------
# Per-page kind detection
# --------------------------------------------------------------------------

def detect_claim(lines):
    hits = 0
    for y0, spans in lines:
        # Build contiguous bold runs and test each against CLAIM_RE.
        run_text = ""
        run_has_heading_style = False
        for s in spans:
            if is_bold(s["flags"]):
                run_text += s["text"]
                run_has_heading_style = True
            else:
                if run_has_heading_style and CLAIM_RE.match(run_text):
                    hits += 1
                run_text = ""
                run_has_heading_style = False
        if run_has_heading_style and CLAIM_RE.match(run_text):
            hits += 1
    return hits


def detect_figure_table(lines):
    fig_hits = 0
    tbl_hits = 0
    for y0, spans in lines:
        run_text = ""
        run_bold = False
        for s in spans:
            if is_bold(s["flags"]):
                run_text += s["text"]
                run_bold = True
            else:
                if run_bold:
                    if FIGURE_RE.match(run_text):
                        fig_hits += 1
                    if TABLE_RE.match(run_text):
                        tbl_hits += 1
                run_text = ""
                run_bold = False
        if run_bold:
            if FIGURE_RE.match(run_text):
                fig_hits += 1
            if TABLE_RE.match(run_text):
                tbl_hits += 1
    return fig_hits, tbl_hits


def detect_exercises(lines):
    """Bold "N.N" immediately followed (same line) by an upper-case
    CHECK/TRACE/OPEN span counts as one exercise. A "Solution p." margin
    reference is used only as a fallback if no primary hits were found on
    the page (they normally co-occur 1:1, so summing both would double
    count)."""
    primary = 0
    solutionp = 0
    for y0, spans in lines:
        for i, s in enumerate(spans):
            txt = s["text"].strip()
            if is_bold(s["flags"]) and EXNUM_RE.match(txt):
                # look ahead a couple of spans for the type word
                for j in range(i + 1, min(i + 3, len(spans))):
                    nxt = spans[j]["text"].strip()
                    if nxt.upper() in EXTYPE_WORDS and any(c.isalpha() for c in nxt):
                        primary += 1
                        break
            if SOLUTION_RE.match(txt):
                solutionp += 1
    return max(primary, solutionp)


def detect_proof(lines):
    hits = 0
    for y0, spans in lines:
        for s in spans:
            txt = s["text"].strip().lower()
            if txt in PROOF_HEADS and (is_bold(s["flags"]) or is_italic(s["flags"])):
                hits += 1
    return hits


def detect_recall(lines):
    for y0, spans in lines:
        if not spans:
            continue
        first = spans[0]
        txt = first["text"].strip().rstrip(":").strip()
        if txt.lower() == "recall" and is_heading_style(first):
            return True
    return False


def detect_aside(lines):
    found = set()
    for y0, spans in lines:
        if not spans:
            continue
        first = spans[0]
        txt = first["text"].strip().rstrip(":").strip()
        for kw in ASIDE_KEYWORDS:
            if txt.lower() == kw.lower() and is_heading_style(first):
                found.add(kw)
    return found


def detect_literal_marks(page_text):
    # Case-insensitive: some chapters render these heads in true upper case
    # (e.g. "WHERE THIS STOPS") rather than title case.
    lowered = page_text.lower()
    return {
        "example": EXAMPLE_MARK.lower() in lowered,
        "boundary": BOUNDARY_MARK.lower() in lowered,
        "session": SESSION_MARK.lower() in lowered,
    }


def detect_code_block(lines):
    """A run of 3+ consecutive lines whose text is dominated (>=60% of
    non-whitespace characters) by a monospace font. Short digit-only lines
    (code-listing line-number gutters) are ignored rather than breaking the
    run."""
    run = 0
    maxrun = 0
    ordered = sorted(lines, key=lambda t: t[0])
    for y0, spans in ordered:
        txt = line_plain_text(spans)
        stripped = txt.strip()
        if not stripped:
            continue
        if re.match(r"^\d+[.)]?$", stripped) and len(stripped) <= 3:
            continue  # gutter line number: neither breaks nor extends a run
        total = 0
        mono = 0
        for s in spans:
            t = s["text"].strip()
            if not t:
                continue
            total += len(t)
            if is_mono_span(s):
                mono += len(t)
        ratio = (mono / total) if total else 0.0
        if ratio >= MONOSPACE_LINE_RATIO:
            run += 1
            maxrun = max(maxrun, run)
        else:
            run = 0
    return maxrun >= MONOSPACE_RUN_MIN_LINES


def detect_prose(lines, body_size, tol=0.6):
    for y0, spans in lines:
        for s in spans:
            txt = s["text"].strip()
            if len(txt) < 4:
                continue
            if abs(s["size"] - body_size) <= tol:
                return True
    return False


def detect_margin_notes(lines, page_width, page_number_1indexed):
    """Spans whose x0 sits in the outer-margin column: x > 0.78*width on
    odd (recto) pages, x < 0.22*width on even (verso) pages."""
    count = 0
    odd = (page_number_1indexed % 2) == 1
    hi = 0.78 * page_width
    lo = 0.22 * page_width
    for y0, spans in lines:
        for s in spans:
            if not s["text"].strip():
                continue
            x0 = s["bbox"][0]
            if odd and x0 > hi:
                count += 1
            elif (not odd) and x0 < lo:
                count += 1
    return count


def detect_running_head(lines, page_width):
    """Returns (chapter_num_or_None, folio_text_or_None) parsed out of the
    top-of-page running head / folio line."""
    chapter_num = None
    folio = None
    top_spans = []
    for y0, spans in lines:
        if y0 <= RUNNING_HEAD_Y_MAX:
            top_spans.extend(spans)
    for s in top_spans:
        txt = s["text"].strip()
        m = RUNNING_HEAD_CHAPTER_RE.search(txt)
        if m:
            chapter_num = m.group(1)
    for s in top_spans:
        txt = s["text"].strip()
        if RUNNING_HEAD_CHAPTER_RE.search(txt):
            continue
        if FOLIO_RE.match(txt) and 1 <= len(txt) <= 4:
            folio = txt
    return chapter_num, folio


# --------------------------------------------------------------------------
# Chapter assignment
# --------------------------------------------------------------------------

def build_bookmark_chapter_map(doc):
    """--chapters-from-bookmarks: derive chapter start pages from the PDF's
    own table of contents rather than the running head. Only level-1 entries
    that (a) come after the first "Part ..." heading and (b) start with a
    bare integer are treated as book chapters -- this skips the standalone
    front-matter "Introduction" section, which happens to also be numbered
    "1" in the TOC but is not one of the book's eight running-head chapters.
    """
    toc = doc.get_toc()
    seen_part = False
    chapters = []  # (start_page0idx, chapter_num)
    for lvl, title, pg in toc:
        if lvl != 1:
            continue
        t = title.strip()
        if re.match(r"^Part\s+[IVXLCDM]+\b", t, re.IGNORECASE):
            seen_part = True
            continue
        m = re.match(r"^(\d+)\s+\S", t)
        if m and seen_part:
            chapters.append((pg - 1, m.group(1)))
    chapters.sort()
    return chapters


def chapter_for_page_bookmarks(chapters, page_idx):
    result = None
    for start, num in chapters:
        if start <= page_idx:
            result = num
        else:
            break
    return result if result is not None else "front"


# --------------------------------------------------------------------------
# Main per-page analysis
# --------------------------------------------------------------------------

def analyze_page(doc, page_idx, body_size, chapters_bm=None):
    page = doc[page_idx]
    lines = get_page_lines(page)
    page_text = page.get_text("text")
    width = page.rect.width

    kinds = set()

    if detect_prose(lines, body_size):
        kinds.add("prose")

    if detect_claim(lines) > 0:
        kinds.add("claim")

    marks = detect_literal_marks(page_text)
    if marks["example"]:
        kinds.add("example")
    if marks["boundary"]:
        kinds.add("boundary")
    if marks["session"]:
        kinds.add("session")

    if detect_recall(lines):
        kinds.add("recall")

    if detect_aside(lines):
        kinds.add("aside")

    fig_hits, tbl_hits = detect_figure_table(lines)
    if fig_hits > 0:
        kinds.add("figure")
    if tbl_hits > 0:
        kinds.add("table")

    n_exercises = detect_exercises(lines)
    if n_exercises > 0:
        kinds.add("exercise")

    if detect_proof(lines) > 0:
        kinds.add("proof")

    if detect_code_block(lines):
        kinds.add("code")

    n_margin_notes = detect_margin_notes(lines, width, page_idx + 1)

    chapter_num, folio = detect_running_head(lines, width)

    return {
        "kinds": kinds,
        "n_exercises": n_exercises,
        "n_margin_notes": n_margin_notes,
        "chapter_num": chapter_num,
        "folio": folio,
        "words": len(page.get_text("words")),
    }


def assign_chapters(per_page, chapters_bm):
    """Fill in the CSV "chapter" column: running-head chapter number when
    present, else forward-filled from the last seen chapter ("front" before
    the first chapter head, "back" is not distinguishable by running head
    alone so pages after the last-seen chapter keep carrying that number --
    see the known-gaps note in the report)."""
    n = len(per_page)
    if chapters_bm:
        for i, row in enumerate(per_page):
            row["chapter"] = chapter_for_page_bookmarks(chapters_bm, i)
        return

    last_chapter = None
    seen_any = False
    for row in per_page:
        if row["chapter_num"] is not None:
            last_chapter = row["chapter_num"]
            seen_any = True
            row["chapter"] = last_chapter
        elif not seen_any:
            row["chapter"] = "front"
        else:
            row["chapter"] = last_chapter

    # Mark true back matter: pages after the running head has permanently
    # stopped mentioning any "Chapter N." (i.e. no chapter head appears in
    # the remainder of the document).
    last_chapter_page = None
    for i, row in enumerate(per_page):
        if row["chapter_num"] is not None:
            last_chapter_page = i
    if last_chapter_page is not None:
        for i in range(last_chapter_page + 1, n):
            if per_page[i]["chapter_num"] is None:
                per_page[i]["chapter"] = "back"
            else:
                break


# --------------------------------------------------------------------------
# Output: CSV
# --------------------------------------------------------------------------

def write_csv(per_page, out_dir):
    path = os.path.join(out_dir, "page-kinds.csv")
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(
            [
                "page",
                "printed_folio",
                "chapter",
                "kinds",
                "n_kinds",
                "has_figure",
                "has_table",
                "n_exercises",
                "n_margin_notes",
                "words",
            ]
        )
        for row in per_page:
            kinds_sorted = [k for k in ALL_KIND_NAMES if k in row["kinds"]]
            n_kinds = len(row["kinds"] - {"prose"})
            w.writerow(
                [
                    row["page"],
                    row["folio"] or "",
                    row["chapter"],
                    ";".join(kinds_sorted),
                    n_kinds,
                    "figure" in row["kinds"],
                    "table" in row["kinds"],
                    row["n_exercises"],
                    row["n_margin_notes"],
                    row["words"],
                ]
            )
    return path


# --------------------------------------------------------------------------
# Output: heat-strip.png
# --------------------------------------------------------------------------

def n_kinds_color(n):
    if n <= 1:
        return (250, 246, 227)  # light cream
    if n == 2:
        return (214, 214, 214)  # light grey
    if n == 3:
        return (150, 150, 150)  # mid grey
    if n == 4:
        return (70, 70, 70)     # dark
    return (0, 0, 0)            # 5+ black


def chapter_order(per_page):
    """Chapters in book order, first-appearance order."""
    order = []
    seen = set()
    for row in per_page:
        c = row["chapter"]
        if c not in seen:
            seen.add(c)
            order.append(c)
    return order


def write_heat_strip(per_page, out_dir):
    cell_w = 6
    row_h = 18
    label_w = 90
    margin = 10

    order = chapter_order(per_page)
    by_chapter = OrderedDict((c, []) for c in order)
    for row in per_page:
        by_chapter[row["chapter"]].append(row)

    max_pages = max((len(v) for v in by_chapter.values()), default=1)
    width = label_w + max_pages * cell_w + 2 * margin
    legend_h = 40
    height = margin * 2 + row_h * len(order) + legend_h

    img = Image.new("RGB", (width, height), (255, 255, 255))
    d = ImageDraw.Draw(img)
    try:
        font = ImageFont.load_default()
    except Exception:
        font = None

    y = margin
    for c in order:
        label = f"Ch {c}" if c not in ("front", "back") else c
        d.text((2, y + row_h // 2 - 5), label, fill=(20, 20, 20), font=font)
        x = label_w
        for row in by_chapter[c]:
            n_kinds = len(row["kinds"] - {"prose"})
            color = n_kinds_color(n_kinds)
            d.rectangle([x, y, x + cell_w - 1, y + row_h - 2], fill=color)
            x += cell_w
        y += row_h

    # Legend
    ly = height - legend_h + 8
    lx = margin
    legend_entries = [("0-1", 0), ("2", 2), ("3", 3), ("4", 4), ("5+", 5)]
    for label, n in legend_entries:
        color = n_kinds_color(n)
        d.rectangle([lx, ly, lx + 16, ly + 16], fill=color, outline=(0, 0, 0))
        d.text((lx + 20, ly + 2), label, fill=(20, 20, 20), font=font)
        lx += 60

    path = os.path.join(out_dir, "heat-strip.png")
    img.save(path)
    return path


# --------------------------------------------------------------------------
# Output: summary.md
# --------------------------------------------------------------------------

def find_low_anchor_runs(rows, min_len=5):
    """Runs of >4 (i.e. length >=5) consecutive pages within `rows` (already
    filtered to one chapter, in page order) that have none of figure/table/
    example/session."""
    runs = []
    start = None
    for i, row in enumerate(rows):
        lacks_anchor = not (row["kinds"] & ANCHOR_KINDS)
        if lacks_anchor:
            if start is None:
                start = i
        else:
            if start is not None and i - start >= min_len:
                runs.append((rows[start]["page"], rows[i - 1]["page"]))
            start = None
    if start is not None and len(rows) - start >= min_len:
        runs.append((rows[start]["page"], rows[-1]["page"]))
    return runs


def write_summary(per_page, out_dir):
    order = chapter_order(per_page)
    by_chapter = OrderedDict((c, []) for c in order)
    for row in per_page:
        by_chapter[row["chapter"]].append(row)

    lines = ["# Page-kinds summary", ""]

    all_nk = [len(r["kinds"] - {"prose"}) for r in per_page]
    total_pages = len(per_page)
    book_mean = statistics.mean(all_nk) if all_nk else 0.0
    book_max = max(all_nk) if all_nk else 0
    book_share = (sum(1 for n in all_nk if n <= 3) / total_pages) if total_pages else 0.0

    for c in order:
        rows = by_chapter[c]
        nk = [len(r["kinds"] - {"prose"}) for r in rows]
        pages = len(rows)
        mean_nk = statistics.mean(nk) if nk else 0.0
        max_nk = max(nk) if nk else 0
        share_le3 = (sum(1 for n in nk if n <= 3) / pages) if pages else 0.0
        high_pages = [r["page"] for r in rows if len(r["kinds"] - {"prose"}) >= 5]
        runs = find_low_anchor_runs(rows, min_len=5)

        title = f"Chapter {c}" if c not in ("front", "back") else c.capitalize()
        lines.append(f"## {title}")
        lines.append("")
        lines.append(f"- pages: {pages}")
        lines.append(f"- mean n_kinds: {mean_nk:.2f}")
        lines.append(f"- max n_kinds: {max_nk}")
        lines.append(
            f"- share of pages with n_kinds <= 3: {share_le3:.1%} "
            f"(target >= 95%){'  MEETS TARGET' if share_le3 >= 0.95 else '  BELOW TARGET'}"
        )
        if high_pages:
            lines.append(f"- pages with n_kinds >= 5: {', '.join(str(p) for p in high_pages)}")
        else:
            lines.append("- pages with n_kinds >= 5: none")
        if runs:
            run_strs = [f"{a}-{b}" for a, b in runs]
            lines.append(
                "- runs of >4 consecutive pages with no figure/table/example/session: "
                + ", ".join(run_strs)
            )
        else:
            lines.append(
                "- runs of >4 consecutive pages with no figure/table/example/session: none"
            )
        lines.append("")

    lines.append("## Whole book")
    lines.append("")
    lines.append(
        f"- {total_pages} pages, mean n_kinds {book_mean:.2f}, max n_kinds {book_max}, "
        f"{book_share:.1%} of pages at n_kinds <= 3."
    )
    lines.append("")

    path = os.path.join(out_dir, "summary.md")
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    return path


# --------------------------------------------------------------------------
# Debug
# --------------------------------------------------------------------------

def debug_page(doc, page_idx, body_size):
    page = doc[page_idx]
    lines = get_page_lines(page)
    print(f"=== debug page {page_idx + 1} (0-indexed {page_idx}) ===")
    for y0, spans in lines:
        for s in spans:
            txt = s["text"]
            if not txt.strip():
                continue
            tags = []
            if is_bold(s["flags"]):
                tags.append("bold")
            if is_italic(s["flags"]):
                tags.append("italic")
            if is_mono_span(s):
                tags.append("mono")
            if looks_small_caps(s):
                tags.append("smallcaps")
            if abs(s["size"] - body_size) <= 0.6:
                tags.append("body-size")
            print(
                f"  y={y0:6.1f} x0={s['bbox'][0]:6.1f} size={s['size']:5.1f} "
                f"font={s['font']!r} tags={tags} text={txt!r}"
            )
    result = analyze_page(doc, page_idx, body_size)
    print("--- classified kinds:", sorted(result["kinds"]))
    print("--- n_exercises:", result["n_exercises"], "n_margin_notes:", result["n_margin_notes"])
    print("--- chapter_num from running head:", result["chapter_num"], "folio:", result["folio"])


# --------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------

def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("pdf", help="path to the textbook PDF")
    ap.add_argument(
        "--out", required=False, default=None, help="output directory (required unless --debug is given)"
    )
    ap.add_argument(
        "--chapters-from-bookmarks",
        action="store_true",
        help="derive chapter boundaries from the PDF table of contents "
        "instead of parsing running heads",
    )
    ap.add_argument(
        "--debug",
        type=int,
        default=None,
        metavar="PAGE",
        help="print the spans classified on one 1-indexed page and exit",
    )
    args = ap.parse_args(argv)

    doc = fitz.open(args.pdf)
    body_size = estimate_body_size(doc)

    if args.debug is not None:
        debug_page(doc, args.debug - 1, body_size)
        return 0

    if not args.out:
        ap.error("--out is required unless --debug is given")

    os.makedirs(args.out, exist_ok=True)

    chapters_bm = build_bookmark_chapter_map(doc) if args.chapters_from_bookmarks else None

    per_page = []
    for i in range(len(doc)):
        result = analyze_page(doc, i, body_size)
        result["page"] = i + 1
        per_page.append(result)

    assign_chapters(per_page, chapters_bm)

    csv_path = write_csv(per_page, args.out)
    png_path = write_heat_strip(per_page, args.out)
    md_path = write_summary(per_page, args.out)

    print(f"wrote {csv_path}")
    print(f"wrote {png_path}")
    print(f"wrote {md_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
