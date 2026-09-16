#!/usr/bin/env python3
"""Render in-situ page context for every figure in the Book.

The figure-review tool needs to show a figure *where it actually sits*: the
figure's own region of the page, the whole page it interrupts, and the printed
spread it belongs to. This script is the generator for that image layer. The
images are its output, not hand-made assets -- when the Book reflows (new
geometry, new leading, an inserted figure), re-run this and everything is
rebuilt from the PDF that is committed at that moment.

Ground truth is the typeset PDF, not any prose register. A figure exists here
if and only if LaTeX typeset a ``figure`` float for it, which the PDF records
as a ``figure.caption.*`` named destination. That is the only source that
cannot drift from what a reader sees.

Identity is deliberately *not* keyed on the page number (reflow moves it) or on
the printed figure number (inserting one figure renumbers its whole chapter).
It is keyed on a fingerprint of the caption text, resolved through a committed
identity table, so rulings already recorded against a figure id survive both.

Three things are measured rather than assumed, and each is recorded per figure:

* the figure's bounding box, from the ink actually on the page;
* how that box was obtained (``detection_method``) and how much to trust it
  (``bbox_confidence``);
* the smallest type inside the box, so the tool can warn when a crop is at or
  below the resolution limit instead of presenting it as legible.

Usage::

    python3 scripts/build-figure-page-context.py            # render everything
    python3 scripts/build-figure-page-context.py --check     # manifest only, no images
    python3 scripts/build-figure-page-context.py --only "Figure 7.6"

Requires PyMuPDF and Pillow.
"""

from __future__ import annotations

import argparse
import difflib
import hashlib
import io
import json
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

import pymupdf
from PIL import Image

REPO = Path(__file__).resolve().parent.parent

BOOK = REPO / "website-v2/public/whitepaper/coordination-papers-mega-volume.pdf"
OUT = REPO / "docs/harbor-research/exposition/figures/page-context"
MANIFEST = OUT / "manifest.json"
IDENTITY = OUT / "figure-identity.json"

FRAGMENT_DIRS = [
    REPO / "website-v2/public/whitepaper/figures",
    REPO / "whitepaper/figures",
]

# --- rendering settings -------------------------------------------------
#
# Format is WebP lossless. Measured over eight representative figures, a
# 300 dpi figure crop costs, on average: PNG 230K, PNG palette-64 88K,
# WebP lossless 76K, WebP q88 152K, WebP q80 127K. Lossy WebP is *larger*
# than lossless on this corpus because the content is flat-colour line art
# and type on white, where DCT spends its bits on ringing. Palette PNG is
# close on size but quantises colour, and the colour of a fill is part of
# what the author is reviewing, so it is the wrong trade here.
#
# dpi is chosen against measured type size, not habit. The smallest type in
# the corpus is 2.35 pt (Figure 7.6). At the 150 dpi used by the earlier
# pixel-judgment pass that glyph is 4.9 px tall, which is not readable. At
# 300 dpi it is 9.8 px, which is the floor at which the shape resolves.
CROP_DPI = 300
PAGE_DPI = 150
SPREAD_DPI = 110
CROP_BLEED_PT = 8.0  # small bleed so the crop does not shave its own edge
SPREAD_GUTTER_PX = 10

# Legibility floor, in device pixels, for the smallest glyph in a crop.
LEGIBLE_PX = 9.0

FIG_CAPTION = re.compile(r"\s*Figure\s+(\d+)\.(\d+):")
LST_CAPTION = re.compile(r"\s*Listing\s+(\d+)\.(\d+):")

# Text column of the committed Book, measured from the PDF (7x10in trim).
COL_LEFT = 57.6
COL_WIDTH = 325.9

# A float's internal parts can sit this far apart before we stop walking up.
# Calibrated against Figure 1.3, whose column headers sit 25.7 pt above the
# grid they label and are part of the figure.
UP_GAP_PT = 30.0


# ---------------------------------------------------------------- helpers


def sha256_of(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def normalise_caption(text: str) -> str:
    """Collapse a caption (TeX source or printed) to a comparable string."""
    text = re.sub(r"\\label\s*\{[^}]*\}", " ", text)
    text = re.sub(r"\\[a-zA-Z@]+", " ", text)
    text = text.replace("--", "-").replace("\u2019", "'")
    text = re.sub(r"[^a-z0-9 ]", " ", text.lower())
    return re.sub(r"\s+", " ", text).strip()


def caption_fingerprint(printed: str) -> str:
    """Stable id key: survives reflow and renumbering, changes if reworded."""
    body = re.sub(r"^\s*(?:Figure|Listing)\s+\d+\.\d+:", "", printed)
    return hashlib.sha1(normalise_caption(body).encode()).hexdigest()[:16]


def slugify(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")


# -------------------------------------------------------------- fragments


def load_fragments() -> dict[str, dict]:
    """Every figure fragment that carries a \\caption, from both figure dirs."""
    out: dict[str, dict] = {}
    for directory in FRAGMENT_DIRS:
        if not directory.is_dir():
            continue
        for path in sorted(directory.glob("*.tex")):
            text = path.read_text(encoding="utf-8", errors="replace")
            match = re.search(r"\\caption\s*\{", text)
            if not match:
                continue
            index, depth, chunk = match.end(), 1, []
            while index < len(text) and depth:
                char = text[index]
                if char == "{":
                    depth += 1
                elif char == "}":
                    depth -= 1
                    if not depth:
                        break
                chunk.append(char)
                index += 1
            label = re.search(r"\\label\s*\{((?:fig|alg):[^}]+)\}", text)
            name = path.stem
            out.setdefault(
                name,
                {
                    "fragment": str(path.relative_to(REPO)),
                    "caption_tex": "".join(chunk).strip(),
                    "label": label.group(1) if label else None,
                },
            )
    return out


# ------------------------------------------------------------- geometry


def ink_rects(page: pymupdf.Page) -> list[tuple[pymupdf.Rect, str]]:
    """Vector and raster ink, with running head/foot rules dropped."""
    out: list[tuple[pymupdf.Rect, str]] = []
    width = page.rect.width
    for drawing in page.get_drawings():
        rect = pymupdf.Rect(drawing["rect"])
        if rect.is_empty or rect.is_infinite:
            continue
        if rect.height < 0.8 and rect.width > width * 0.55:
            continue  # the rule under the running head
        out.append((rect, "draw"))
    for image in page.get_images(full=True):
        for rect in page.get_image_rects(image[0]):
            out.append((pymupdf.Rect(rect), "image"))
    return out


def text_rects(page: pymupdf.Page) -> list[tuple[pymupdf.Rect, str]]:
    out = []
    for block in page.get_text("blocks"):
        rect = pymupdf.Rect(block[:4])
        if not rect.is_empty:
            out.append((rect, block[4]))
    return out


def has_form_xobject(page: pymupdf.Page) -> bool:
    """True when the page draws an imported PDF somewhere."""
    return any(x[2] == 0 for x in page.get_xobjects())


# The Book's own faces. Anything typeset in a figure from outside this set came
# in with an imported graphic rather than from the Book's preamble.
HOUSE_FACES = ("TeXGyre", "NewPX", "pxmi", "pxsy", "LMMath", "CMSY", "CMMI", "CMR")


def fonts_in(page: pymupdf.Page, box: pymupdf.Rect) -> list[str]:
    """Typefaces actually used inside a region."""
    faces: set[str] = set()
    for block in page.get_text("dict")["blocks"]:
        if block["type"] != 0:
            continue
        for line in block["lines"]:
            for span in line["spans"]:
                rect = pymupdf.Rect(span["bbox"])
                if span["text"].strip() and rect.y0 >= box.y0 and rect.y1 <= box.y1:
                    faces.add(span["font"])
    return sorted(faces)


def classify(page: pymupdf.Page, ink: pymupdf.Rect) -> tuple[str, list[str]]:
    """Which kind of figure this is, decided per float rather than per page.

    A page can hold an imported plate *and* a TikZ figure -- page 377 holds
    both -- so asking "does this page draw a Form XObject" mislabels the
    neighbour. The typefaces inside the float settle it: the Book sets its own
    figures in TeX Gyre, and a plate arrives carrying whatever its author used
    (here Palatino and STIXGeneral, which the Book never declares).
    """
    faces = fonts_in(page, ink)
    foreign = [f for f in faces if not any(h in f for h in HOUSE_FACES)]
    if faces and len(foreign) == len(faces) and has_form_xobject(page):
        return "includegraphics-pdf", faces
    return "vector-ink", faces


@dataclass
class Detection:
    bbox: pymupdf.Rect
    ink: pymupdf.Rect | None
    method: str
    confidence: str
    notes: dict = field(default_factory=dict)


def detect_float(page: pymupdf.Page, caption: pymupdf.Rect, floor: float) -> Detection:
    """Measure the float that owns ``caption``.

    Two structural facts do the work. First, a LaTeX float is atomic: nothing
    but the float's own content can be typeset between its graphic and its
    caption, so everything in that gap belongs to the figure and needs no
    guessing. Second, vector or raster ink is a reliable anchor for where the
    graphic starts, because body prose contributes none.

    Growing *upward* past the ink is the only judgement call -- a figure's
    column headers live there (Figure 1.3), but so does body prose. Blocks are
    admitted only when they sit horizontally inside the ink span and are not
    full-measure prose.
    """
    height = page.rect.height
    head, foot = height * 0.060, height * 0.925

    def in_band(rect: pymupdf.Rect) -> bool:
        return (
            rect.y1 > floor
            and rect.y1 <= caption.y0 + 0.5
            and rect.y1 > head
            and rect.y0 < foot
        )

    band_ink = [(r, k) for r, k in ink_rects(page) if in_band(r)]
    texts = text_rects(page)

    if not band_ink:
        # No ink at all: a text-only float (a code listing or a plain table).
        cluster = pymupdf.Rect()
        count = 0
        frontier = caption.y0
        for rect, body in sorted(
            (t for t in texts if in_band(t[0])), key=lambda t: -t[0].y1
        ):
            if FIG_CAPTION.match(body) or LST_CAPTION.match(body):
                continue
            if frontier - rect.y1 > UP_GAP_PT:
                break
            cluster |= rect
            frontier = min(frontier, rect.y0)
            count += 1
        if not count:
            box = pymupdf.Rect(COL_LEFT, caption.y0 - 200, COL_LEFT + COL_WIDTH, caption.y1)
            return Detection(box, None, "column-fallback", "guessed",
                             {"reason": "no ink and no text cluster above the caption"})
        cluster |= caption
        return Detection(cluster, None, "text-cluster", "measured-text",
                         {"text_blocks": count, "typefaces": fonts_in(page, cluster)})

    ink = pymupdf.Rect()
    for rect, _ in band_ink:
        ink |= rect

    box = pymupdf.Rect(ink)
    box.y1 = max(box.y1, caption.y0)

    # Atomic-float rule: anything between the ink and the caption is the float's.
    for rect, body in texts:
        if not in_band(rect) or FIG_CAPTION.match(body) or LST_CAPTION.match(body):
            continue
        if rect.y0 >= ink.y1 - 2:
            box |= rect

    # Upward growth, guarded.
    growing = True
    while growing:
        growing = False
        for rect, body in texts:
            if not in_band(rect) or FIG_CAPTION.match(body) or LST_CAPTION.match(body):
                continue
            if rect.y1 > box.y0:
                continue
            inside = rect.x0 >= ink.x0 - 6 and rect.x1 <= ink.x1 + 6
            prose = rect.x0 <= COL_LEFT + 2.0 and rect.width >= 0.90 * COL_WIDTH
            if box.y0 - rect.y1 <= UP_GAP_PT and inside and not prose:
                box |= rect
                growing = True

    box |= caption
    kind, faces = classify(page, ink)
    # Everything from the ink down to the caption is structural and certain.
    # A box that reaches *above* the ink got there through the one heuristic in
    # this function, so it is reported separately rather than folded into
    # "measured" -- those are the boxes worth a human glance.
    grown_pt = round(max(0.0, ink.y0 - box.y0), 1)
    confidence = "measured" if grown_pt <= 0.5 else "measured-grown-upward"
    return Detection(box, ink, kind, confidence,
                     {"ink_rects": len(band_ink),
                      "caption_gap_pt": round(caption.y0 - ink.y1, 1),
                      "grown_above_ink_pt": grown_pt,
                      "typefaces": faces})


CAPTION_LINE_GAP_PT = 8.0


def caption_extent(page: pymupdf.Page, first_block: pymupdf.Rect) -> tuple[pymupdf.Rect, str]:
    """The whole caption, which is often more than one text block.

    A caption carrying inline maths is split by PyMuPDF into several blocks
    whose boxes interleave, so the block that matches "Figure 7.6:" covers only
    its first two lines. Walking *lines* instead is unambiguous: measured
    across the corpus, successive lines of one caption sit within 2.1 pt of
    each other (often overlapping, where maths raises a line), while the break
    to the following paragraph is 15 pt or more.
    """
    height = page.rect.height
    lines: list[tuple[float, float, float, float, str]] = []
    for block in page.get_text("dict")["blocks"]:
        if block["type"] != 0:
            continue
        for line in block["lines"]:
            x0, y0, x1, y1 = line["bbox"]
            if y1 > height * 0.925:
                continue  # running foot
            text = "".join(s["text"] for s in line["spans"])
            lines.append((y0, y1, x0, x1, text))
    lines.sort()

    box = pymupdf.Rect(first_block)
    collected: list[str] = []
    bottom = first_block.y0
    started = False
    for y0, y1, x0, x1, text in lines:
        if y1 <= first_block.y0:
            continue
        if not started:
            started = True
        elif y0 - bottom > CAPTION_LINE_GAP_PT:
            break
        box |= pymupdf.Rect(x0, y0, x1, y1)
        collected.append(text)
        bottom = max(bottom, y1)
    return box, " ".join(collected)


def printed_folio(page: pymupdf.Page) -> str | None:
    """The page number the reader sees, which is not the PDF page index.

    The Book's front matter is unnumbered and then roman, so PDF page 25 is
    printed folio 10. Reviewers cite the folio; the renderer needs the index.
    Both go in the manifest so neither side has to guess.
    """
    blocks = page.get_text("blocks")
    if not blocks:
        return None
    match = re.search(r"\n([0-9ivxlc]+)\s*$", blocks[0][4].strip() + "\n")
    return match.group(1) if match else None


def smallest_type_pt(page: pymupdf.Page, box: pymupdf.Rect) -> float | None:
    smallest = None
    for block in page.get_text("dict")["blocks"]:
        if block["type"] != 0:
            continue
        for line in block["lines"]:
            for span in line["spans"]:
                rect = pymupdf.Rect(span["bbox"])
                if not span["text"].strip():
                    continue
                if rect.y0 >= box.y0 and rect.y1 <= box.y1:
                    size = round(span["size"], 2)
                    smallest = size if smallest is None else min(smallest, size)
    return smallest


# -------------------------------------------------------------- discovery


@dataclass
class Float:
    page: int
    kind: str          # "figure" | "listing"
    number: str        # printed number, e.g. "1.10"
    chapter: int
    caption_rect: pymupdf.Rect
    caption_text: str
    caption_full: str = ""


def discover(doc: pymupdf.Document) -> list[Float]:
    """Every ``figure`` float LaTeX typeset, from the PDF's own destinations.

    ``figure.caption.*`` destinations count the float environments. Most carry
    a numbered ``Figure`` caption; a couple in this Book are code listings that
    live inside a ``figure`` environment, which is why the destination count
    (61) exceeds the numbered-figure count (59).
    """
    dest_pages: dict[int, int] = {}
    for name, dest in doc.resolve_names().items():
        if name.startswith("figure.caption."):
            dest_pages[dest["page"] + 1] = dest_pages.get(dest["page"] + 1, 0) + 1

    floats: list[Float] = []
    claimed: dict[int, int] = {}
    for index in range(doc.page_count):
        page_no = index + 1
        for block in doc[index].get_text("blocks"):
            body = block[4]
            match = FIG_CAPTION.match(body)
            if match:
                rect, full = caption_extent(doc[index], pymupdf.Rect(block[:4]))
                floats.append(Float(page_no, "figure", f"{match.group(1)}.{match.group(2)}",
                                    int(match.group(1)), rect, body, full))
                claimed[page_no] = claimed.get(page_no, 0) + 1
    # Listings only count when the page has a figure destination left over.
    for index in range(doc.page_count):
        page_no = index + 1
        spare = dest_pages.get(page_no, 0) - claimed.get(page_no, 0)
        if spare <= 0:
            continue
        for block in doc[index].get_text("blocks"):
            match = LST_CAPTION.match(block[4])
            if match and spare > 0:
                rect, full = caption_extent(doc[index], pymupdf.Rect(block[:4]))
                floats.append(Float(page_no, "listing", f"{match.group(1)}.{match.group(2)}",
                                    int(match.group(1)), rect, block[4], full))
                spare -= 1
    floats.sort(key=lambda f: (f.page, f.caption_rect.y0))
    return floats


def resolve_identity(floats: list[Float], fragments: dict[str, dict]) -> dict:
    """Map each float to a durable id, via the committed table then by caption."""
    table = json.loads(IDENTITY.read_text()) if IDENTITY.exists() else {"figures": {}}
    known = table.get("figures", {})

    normalised = {name: normalise_caption(meta["caption_tex"]) for name, meta in fragments.items()}
    taken = {entry["fragment_id"] for entry in known.values() if entry.get("fragment_id")}

    resolved: dict[str, dict] = {}
    for item in floats:
        finger = caption_fingerprint(item.caption_text)
        if finger in known:
            resolved[finger] = dict(known[finger])
            resolved[finger]["identity_source"] = "identity-table"
            continue
        printed = normalise_caption(
            re.sub(r"^\s*(?:Figure|Listing)\s+\d+\.\d+:", "", item.caption_text))
        best, score = None, 0.0
        for name, text in normalised.items():
            if name in taken:
                continue
            ratio = difflib.SequenceMatcher(None, printed, text).ratio()
            if ratio > score:
                best, score = name, ratio
        if best and score >= 0.85:
            taken.add(best)
            resolved[finger] = {
                "id": best,
                "fragment_id": best,
                "pixel_judgment_id": best,
                "identity_source": f"caption-match:{score:.2f}",
            }
        else:
            resolved[finger] = {
                "id": f"unresolved-{item.kind}-{item.number.replace('.', '-')}",
                "fragment_id": None,
                "pixel_judgment_id": None,
                "identity_source": "UNRESOLVED",
                "match_hint": best,
                "match_score": round(score, 3),
            }
    return resolved


# --------------------------------------------------------------- render


def render(doc: pymupdf.Document, page_no: int, dpi: int, clip=None) -> Image.Image:
    pix = doc[page_no - 1].get_pixmap(dpi=dpi, clip=clip)
    return Image.frombytes("RGB", (pix.width, pix.height), pix.samples)


def spread_pages(page_no: int, total: int) -> tuple[int | None, int | None]:
    """The printed leaf-spread holding ``page_no``.

    Page 1 of a bound book is a recto, so odd pages print on the right and
    even on the left, and the facing pairs are (2,3), (4,5), ... For a recto
    the page before it in the reader's eye is its facing verso; for a verso
    the page after is its facing recto. Pairing a recto with page+1 would show
    a leaf the reader never sees opposite it.
    """
    if page_no % 2 == 0:
        verso, recto = page_no, page_no + 1
    else:
        verso, recto = page_no - 1, page_no
    verso = verso if 1 <= verso <= total else None
    recto = recto if 1 <= recto <= total else None
    return verso, recto


def write_if_changed(path: Path, data: bytes) -> tuple[bool, int]:
    """Idempotence: leave the file (and the git index) alone when unchanged."""
    if path.exists() and path.read_bytes() == data:
        return False, len(data)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return True, len(data)


def encode(image: Image.Image) -> bytes:
    buf = io.BytesIO()
    image.save(buf, "WEBP", lossless=True, quality=100, method=4)
    return buf.getvalue()


# ------------------------------------------------------------------ main


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="manifest only, skip images")
    parser.add_argument("--only", help="render one float, by printed label, e.g. 'Figure 7.6'")
    args = parser.parse_args()

    if not BOOK.exists():
        print(f"Book not found: {BOOK}", file=sys.stderr)
        return 1

    doc = pymupdf.open(BOOK)
    digest = sha256_of(BOOK)
    fragments = load_fragments()
    floats = discover(doc)
    identity = resolve_identity(floats, fragments)

    print(f"Book        {BOOK.relative_to(REPO)}")
    print(f"sha256      {digest}")
    print(f"pages       {doc.page_count}")
    print(f"floats      {len(floats)} "
          f"({sum(1 for f in floats if f.kind == 'figure')} figures, "
          f"{sum(1 for f in floats if f.kind == 'listing')} listings)")

    by_page: dict[int, list[Float]] = {}
    for item in floats:
        by_page.setdefault(item.page, []).append(item)

    records, written, total_bytes = [], 0, 0
    for item in floats:
        siblings = sorted(by_page[item.page], key=lambda f: f.caption_rect.y0)
        position = siblings.index(item)
        floor = siblings[position - 1].caption_rect.y1 if position else 0.0

        page = doc[item.page - 1]
        found = detect_float(page, item.caption_rect, floor)
        finger = caption_fingerprint(item.caption_text)
        ident = identity[finger]
        slug = slugify(ident["id"])

        smallest = smallest_type_pt(page, found.bbox)
        crop_px = round(smallest / 72.0 * CROP_DPI, 1) if smallest else None

        verso, recto = spread_pages(item.page, doc.page_count)
        paths = {
            "figure": f"img/figure/{slug}.webp",
            "page": f"img/page/{slug}.webp",
            "spread": f"img/spread/{slug}.webp",
        }

        label = f"{item.kind.capitalize()} {item.number}"
        if not args.check and (args.only is None or args.only in (label, item.number)):
            clip = pymupdf.Rect(found.bbox) + (
                -CROP_BLEED_PT, -CROP_BLEED_PT, CROP_BLEED_PT, CROP_BLEED_PT)
            clip &= page.rect
            changed, size = write_if_changed(OUT / paths["figure"],
                                             encode(render(doc, item.page, CROP_DPI, clip)))
            written += changed
            total_bytes += size

            changed, size = write_if_changed(OUT / paths["page"],
                                             encode(render(doc, item.page, PAGE_DPI)))
            written += changed
            total_bytes += size

            leaves = [render(doc, n, SPREAD_DPI) for n in (verso, recto) if n]
            width = sum(i.width for i in leaves) + SPREAD_GUTTER_PX * (len(leaves) - 1)
            sheet = Image.new("RGB", (width, max(i.height for i in leaves)), "white")
            offset = 0
            for leaf in leaves:
                sheet.paste(leaf, (offset, 0))
                offset += leaf.width + SPREAD_GUTTER_PX
            changed, size = write_if_changed(OUT / paths["spread"], encode(sheet))
            written += changed
            total_bytes += size

        caption_body = re.sub(r"^\s*(?:Figure|Listing)\s+\d+\.\d+:\s*", "",
                              item.caption_full or item.caption_text)
        caption_body = re.sub(r"\s+", " ", caption_body).strip()
        records.append({
            "id": ident["id"],
            "pixel_judgment_id": ident.get("pixel_judgment_id"),
            "slug": slug,
            "float_kind": item.kind,
            "printed_number": item.number,
            # "Figure 1.1" and "Listing 1.1" are different floats that share a
            # number, so the number alone is not a key. This is.
            "printed_label": f"{item.kind.capitalize()} {item.number}",
            "chapter": item.chapter,
            "page": item.page,
            "printed_folio": printed_folio(page),
            "caption": caption_body,
            "caption_fingerprint": finger,
            "fragment": ident.get("fragment")
            or (fragments.get(ident["fragment_id"], {}) or {}).get("fragment"),
            "tex_label": (fragments.get(ident["fragment_id"], {}) or {}).get("label"),
            "identity_source": ident["identity_source"],
            "bbox_pt": [round(v, 2) for v in found.bbox],
            "ink_bbox_pt": [round(v, 2) for v in found.ink] if found.ink else None,
            "caption_bbox_pt": [round(v, 2) for v in item.caption_rect],
            "detection_method": found.method,
            "bbox_confidence": found.confidence,
            "detection_notes": found.notes,
            "smallest_type_pt": smallest,
            "smallest_type_px_at_crop_dpi": crop_px,
            "legible_at_crop_dpi": (crop_px >= LEGIBLE_PX) if crop_px else None,
            "spread": {
                "verso": verso,
                "recto": recto,
                "figure_side": "verso" if item.page == verso else "recto",
            },
            "neighbours": {
                "before": item.page - 1 if item.page > 1 else None,
                "after": item.page + 1 if item.page < doc.page_count else None,
            },
            "images": paths,
        })

    manifest = {
        "schema": 1,
        "generator": "scripts/build-figure-page-context.py",
        "source_pdf": {
            "path": str(BOOK.relative_to(REPO)),
            "sha256": digest,
            "page_count": doc.page_count,
            "trim_pt": [round(doc[0].rect.width, 2), round(doc[0].rect.height, 2)],
            "binding": "one-sided",
            "binding_evidence": (
                "odd and even pages share the same text-block origin (median x0 "
                "57.19 vs 57.16 pt) and the same running head, so the committed "
                "Book has no alternating gutter; spreads are paired by the "
                "printed-book convention that page 1 is a recto"),
        },
        "render": {
            "format": "image/webp",
            "encoding": "lossless",
            "figure_crop_dpi": CROP_DPI,
            "figure_crop_bleed_pt": CROP_BLEED_PT,
            "page_dpi": PAGE_DPI,
            "spread_dpi": SPREAD_DPI,
            "coordinate_space": (
                "PDF points, origin top-left, as PyMuPDF reports them; multiply "
                "by dpi/72 for pixels in the page render"),
        },
        "counts": {
            "floats": len(records),
            "figures": sum(1 for r in records if r["float_kind"] == "figure"),
            "listings": sum(1 for r in records if r["float_kind"] == "listing"),
            "measured": sum(1 for r in records if r["bbox_confidence"] == "measured"),
            "measured_grown_upward": sum(
                1 for r in records if r["bbox_confidence"] == "measured-grown-upward"),
            "measured_text": sum(1 for r in records if r["bbox_confidence"] == "measured-text"),
            "guessed": sum(1 for r in records if r["bbox_confidence"] == "guessed"),
            "below_legibility_floor": sum(1 for r in records if r["legible_at_crop_dpi"] is False),
        },
        "figures": records,
    }
    MANIFEST.parent.mkdir(parents=True, exist_ok=True)
    MANIFEST.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")

    if not IDENTITY.exists():
        IDENTITY.write_text(json.dumps(
            {"note": "Durable figure ids keyed by caption fingerprint. Survives "
                     "reflow and renumbering; regenerate a row only when a "
                     "caption is deliberately reworded.",
             "figures": identity}, indent=2, ensure_ascii=False) + "\n")

    print(f"measured    {manifest['counts']['measured']}")
    print(f"grown-up    {manifest['counts']['measured_grown_upward']}")
    print(f"text-only   {manifest['counts']['measured_text']}")
    print(f"guessed     {manifest['counts']['guessed']}")
    print(f"below {LEGIBLE_PX:.0f}px  {manifest['counts']['below_legibility_floor']}")
    if not args.check:
        print(f"images      {written} written, {total_bytes / 1048576:.1f} MiB total")
    unresolved = [r["id"] for r in records if r["identity_source"] == "UNRESOLVED"]
    if unresolved:
        print(f"UNRESOLVED  {len(unresolved)}: {', '.join(unresolved)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
