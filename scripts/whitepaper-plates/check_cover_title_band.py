#!/usr/bin/env python3
"""Fail if a line of type would print illegibly over the plate behind it.

This began as a cover check, after the Swiss cover failed three ways in one
evening -- each of which a person looking at a thumbnail called fine:

  * the plate's photograph started 22% down and the subtitle ran into it;
  * the replacement plate *looked* like it reserved 40% and started at 2.0%;
  * the type, moved up to make room, left the imprint over a halftone that is
    neither light enough for black nor dark enough for reversed white.

Two reviewers then made the same point about the fix: the measurement is not
cover-specific. A cover is only the most obvious page that sets type over an
image, and the Book has others. So the pages come from a manifest now
(type-over-art.json), and the first sweep with the general version found a
real defect nobody had registered -- see "What this found" below.

WHAT IS CHECKED, AND HOW

PLATE CHECK (needs no build). For the two full-bleed covers only: take the
plate's own paper tone -- these are aged-paper renders, so the brand hex is the
wrong reference -- and walk down the rows for the first where more than 2% of
pixels are far from it. This is the floor that stops a plate being committed in
the first place, before there is a PDF to read. Hairline grid rules print faint
enough to stay under INK_THRESHOLD, which is right: the title sits over them by
design. A photograph or a flat colour plane does not.

PAGE CHECK (needs a build, and is the one that decides). For every page of
every edition that carries a plate over MIN_PLATE_PAGE_FRACTION of its area:
render the page with its type redacted away, and for each line of type compute
the WCAG contrast ratio between the line's own colour and the ground it landed
on. Fail below AA -- 4.5:1, or 3:1 for large text.

Three earlier models were wrong and are worth recording, because each failed
in the direction that makes a gate useless.

The first demanded that every line sit inside the plate's top clean band. Both
covers deliberately set the imprint at the FOOT of the page, over paper the
plate leaves bare down there, so that version failed three correct maritime
lines and would have pushed the fix in the wrong direction.

The second measured the share of inked pixels under each line and failed above
8%. That held on the covers, whose plates are hard-edged -- photograph or
colour plane against bare paper -- and was wrong the moment it met a
watercolour, where a pale wash inks most of the pixels under a line and is
perfectly readable beneath it. Contrast against the type's own colour is the
question that was being approximated; ask it directly.

The third measured the right thing on the wrong surface: it read the embedded
plate file rather than the page. A page can put anything between the plate and
the type -- a scrim, a tint, a panel, a TikZ shape -- and every one of those
changes what a reader sees under a word while leaving the plate untouched. The
scrim that fixes the Part IV opener below moves its worst line from 2.56:1 to
5.96:1, and a check reading the plate file would still have called that page
broken. Render the page, take the type out of it, and measure what is left.

WHAT THIS FOUND

The first sweep with the page check generalised past the covers flagged the
maritime Part IV opener: its chapter list runs down into the dark headland of
the watercolour, and the last block sat at 2.56:1, 3.15:1 and 3.66:1 against
ink-coloured type. Rendering the page confirmed it -- "what may gossip, what
needs an authority point, and how a" was genuinely hard to read. It is a
length interaction, which is why it hit Part IV and not the others: that part
lists three chapters, so its block reaches further down the page than any
other. The fix is a paper scrim behind the part opener's type block (see
\\pd@part@maritime in the Book preamble); the same three lines now read
5.96:1, 6.56:1 and 7.71:1, and all three editions clear AA on every plated
page.

NEITHER HALF MAY FAIL OPEN

A plate with no inked row raises rather than reporting a clean band of 1.0 --
a blank or corrupt file is not the safest possible plate. A missing PyMuPDF
exits rather than reporting no offenders -- the caller asked for the page
check, so being unable to run it is a failure, not a pass. Scoring "I could
not tell" as "pass" is the one thing a gate must never do.

Run:
    python3 scripts/whitepaper-plates/check_cover_title_band.py
    python3 scripts/whitepaper-plates/check_cover_title_band.py --pdf-dir DIR
"""
from __future__ import annotations

import argparse
import json
import os
import sys

import numpy as np
from PIL import Image

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MANIFEST = os.path.join(os.path.dirname(os.path.abspath(__file__)), "type-over-art.json")

# Both plate-check thresholds are set from the plates themselves rather than
# picked round.
# INK_THRESHOLD: the grid hairlines these plates print sit within ~35 channel
# units of the paper tone and the photographs and colour planes are 90 or more
# away, so 60 separates the two with room on each side.
# ROW_FRACTION: the share of a ROW that must be inked before the row counts,
# which is what excuses a narrow mark high on the plate -- a corner ornament, a
# registration tick, the head of a vertical rule. (A full-width hairline inks
# 100% of its own row; what saves the grid rules is INK_THRESHOLD, because they
# are printed faint. Both are tested.) The shallowest real artwork band
# measured here inks 14% of its first row, so 2% sits well below anything that
# is actually a picture.
INK_THRESHOLD = 60
ROW_FRACTION = 0.02

# How much of a page an image must cover before the type over it is measured.
# Below this it is a margin figure or an inline diagram, which the figure gates
# own; this check is about a page whose ground is a picture.
MIN_PLATE_PAGE_FRACTION = 0.20


class UnreadablePlate(Exception):
    """A plate this check cannot say anything true about."""


def load_manifest(path: str = MANIFEST) -> dict:
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def relative_luminance(rgb) -> np.ndarray:
    """WCAG 2.2 relative luminance, vectorised over an image or one colour."""
    channels = np.asarray(rgb, dtype=float) / 255.0
    linear = np.where(channels <= 0.04045, channels / 12.92,
                      ((channels + 0.055) / 1.055) ** 2.4)
    return (0.2126 * linear[..., 0] + 0.7152 * linear[..., 1]
            + 0.0722 * linear[..., 2])


def contrast_ratio(one: float, other: float) -> float:
    lighter, darker = max(one, other), min(one, other)
    return (lighter + 0.05) / (darker + 0.05)


def inked_mask(pixels: np.ndarray) -> np.ndarray:
    """Which pixels carry ink, judged against the plate's own paper tone."""
    height, width, _ = pixels.shape
    strip = pixels[int(height * 0.005):int(height * 0.03),
                   int(width * 0.2):int(width * 0.8)].reshape(-1, 3)
    paper = np.median(strip, axis=0)
    return np.abs(pixels - paper).max(axis=2) > INK_THRESHOLD


def read_plate(path: str) -> np.ndarray:
    return np.asarray(Image.open(path).convert("RGB")).astype(int)


def clean_band(path: str) -> float:
    """Fraction of the plate's height that is bare paper, top down."""
    inked = inked_mask(read_plate(path))
    height = inked.shape[0]
    hits = np.flatnonzero(inked.mean(axis=1) > ROW_FRACTION)
    if not hits.size:
        # No row anywhere on the plate inks 2% of its pixels. A cover plate
        # always has artwork somewhere, so this is a blank, corrupt or
        # wrongly-thresholded file -- not a plate that is maximally safe.
        raise UnreadablePlate(
            f"{os.path.relpath(path, REPO)}: no inked row at all -- the plate "
            f"is blank, unreadable, or its paper tone was mis-measured")
    return float(hits[0]) / height


def _import_pymupdf():
    try:
        import pymupdf
    except ImportError as err:                            # pragma: no cover
        raise SystemExit(
            "the page check needs PyMuPDF: pip install pymupdf "
            f"(import failed: {err})") from err
    return pymupdf


def page_plates(page, min_fraction: float = MIN_PLATE_PAGE_FRACTION) -> list:
    """(xref, rect) for every image covering enough of the page to be a ground."""
    area = page.rect.width * page.rect.height
    found = []
    for image in page.get_images(full=True):
        xref = image[0]
        for rect in page.get_image_rects(xref):
            if rect.width * rect.height / area >= min_fraction:
                found.append((xref, rect))
    return found


def text_lines(page):
    """(text, bbox, colour, size) for every non-empty line on the page."""
    for block in page.get_text("dict")["blocks"]:
        for line in block.get("lines", []):
            spans = line["spans"]
            text = "".join(span["text"] for span in spans).strip()
            if not text:
                continue
            colour = spans[0]["color"]
            rgb = ((colour >> 16) & 255, (colour >> 8) & 255, colour & 255)
            yield text, line["bbox"], rgb, max(span["size"] for span in spans)


def ground_raster(pymupdf, page, dpi: int) -> np.ndarray:
    """The page as it prints, minus its type: the ground each line lands on.

    Reading the embedded plate instead would answer a different question.
    A page can put anything between the plate and the type -- a scrim, a tint,
    a panel, a TikZ shape -- and every one of those changes what the reader
    actually sees under a word while leaving the plate file untouched. So the
    page is rendered with its text redacted away and its images and line art
    left alone, and the ground is measured off that.
    """
    page.add_redact_annot(page.rect)
    page.apply_redactions(images=pymupdf.PDF_REDACT_IMAGE_NONE,
                          graphics=pymupdf.PDF_REDACT_LINE_ART_NONE,
                          text=pymupdf.PDF_REDACT_TEXT_REMOVE)
    pixmap = page.get_pixmap(dpi=dpi)
    raster = np.frombuffer(pixmap.samples, dtype=np.uint8).reshape(
        pixmap.height, pixmap.width, pixmap.n)
    return relative_luminance(raster[:, :, :3].astype(float))


def ground_under(luminance: np.ndarray, bbox, scale: float, percentile: float):
    """The ground beneath one line's bounding box, or None if it has no area."""
    rows, columns = luminance.shape
    top = max(0, int(bbox[1] * scale))
    bottom = min(rows, int(np.ceil(bbox[3] * scale)))
    left = max(0, int(bbox[0] * scale))
    right = min(columns, int(np.ceil(bbox[2] * scale)))
    if bottom <= top or right <= left:
        return None
    return float(np.percentile(luminance[top:bottom, left:right], percentile))


def illegible_lines(pdf_path: str, contrast: dict, dpi: int = 150) -> list[str]:
    """Every line of type on a plated page that reads below AA contrast."""
    pymupdf = _import_pymupdf()
    document = pymupdf.open(pdf_path)
    scale = dpi / 72.0
    offenders = []

    for number in range(1, document.page_count + 1):
        page = document[number - 1]
        if not page_plates(page):
            continue
        # Read the type first: redacting it away is what makes the ground
        # measurable, and it is destructive.
        lines = list(text_lines(page))
        if not lines:
            continue
        luminance = ground_raster(pymupdf, page, dpi)
        for text, bbox, rgb, size in lines:
            type_luminance = float(relative_luminance(np.array(rgb)))
            floor = (contrast["large"] if size >= contrast["large_point_size"]
                     else contrast["normal"])
            ground = ground_under(luminance, bbox, scale,
                                  contrast["ground_percentile"])
            if ground is None:
                continue
            ratio = contrast_ratio(type_luminance, ground)
            if ratio < floor:
                offenders.append(
                    f"page {number}: {text[:44]!r} at {size:.1f}pt reads "
                    f"{ratio:.2f}:1 against the ground under it "
                    f"(WCAG AA floor {floor}:1)")
    return offenders


def check_covers(manifest: dict, failures: list) -> None:
    """The plate half: does each full-bleed cover reserve room for its type."""
    for cover in manifest["covers"]:
        plate = os.path.join(REPO, cover["plate"])
        relative = os.path.relpath(plate, REPO)
        if not os.path.exists(plate):
            failures.append(f"{relative}: missing")
            continue
        try:
            band = clean_band(plate)
        except UnreadablePlate as err:
            failures.append(str(err))
            continue
        floor = cover["clean_band_floor"]
        print(f"{cover['id']}: clean band {band * 100:.1f}% of the plate "
              f"(floor {floor * 100:.0f}%)")
        if band < floor:
            failures.append(
                f"{relative}: clean band {band * 100:.1f}% is under the "
                f"{floor * 100:.0f}% floor; the title will print over the artwork")
        recorded = cover.get("measured", {}).get("clean_band")
        if recorded is not None and abs(band - recorded) > 0.005:
            failures.append(
                f"{relative}: clean band measures {band:.3f}, the manifest "
                f"records {recorded:.3f} -- the plate and its record disagree")


def check_pages(manifest: dict, pdf_dir: str, failures: list) -> None:
    """The page half: is every line of type legible on the ground it lands on."""
    for edition in manifest["editions"]:
        name = os.path.basename(edition["pdf"])
        pdf = os.path.join(pdf_dir, name)
        if not os.path.exists(pdf):
            # The manifest names the edition, so its absence is a finding, not
            # a skip: a build that produced two editions of three would
            # otherwise pass the page check for the one it never rendered.
            failures.append(
                f"{edition['id']}: no built PDF to check ({name} is not in {pdf_dir}); "
                f"the manifest names this edition and the check cannot pass without it")
            continue
        offenders = illegible_lines(pdf, manifest["contrast"])
        if offenders:
            failures.extend(f"{edition['id']}: {line}" for line in offenders)
        else:
            print(f"{edition['id']}: every line of type over a plate clears WCAG AA")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pdf-dir", help="directory holding freshly built PDFs; "
                                          "without it only the plate half runs")
    parser.add_argument("--manifest", default=MANIFEST)
    args = parser.parse_args()

    manifest = load_manifest(args.manifest)
    failures: list[str] = []
    check_covers(manifest, failures)

    # The page check needs a FRESH build. The committed PDFs lag their own
    # source -- CI regenerates and commits them after a push -- so running this
    # against the checked-in files would fail on a defect the working tree has
    # already fixed. Point it at a build directory instead; whitepaper-build's
    # cover-band job does exactly that with the artifact it just made.
    if args.pdf_dir:
        check_pages(manifest, args.pdf_dir, failures)
    else:
        print("page check skipped (needs --pdf-dir with a fresh build)")

    if failures:
        print("\ntype over art: FAIL", file=sys.stderr)
        for failure in failures:
            print(f"  - {failure}", file=sys.stderr)
        return 1
    print("type over art: every registered page leaves its type legible")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
