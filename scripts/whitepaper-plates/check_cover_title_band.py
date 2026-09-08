#!/usr/bin/env python3
"""Fail if a full-bleed cover's type would print over its artwork.

Two of the three editions set their title over a full-bleed plate: the maritime
cover bleeds `plates/jacket.jpg` over the whole page and starts its type 1.2cm
down, and the Swiss cover does the same with `plates/swiss/cover.jpg` at fixed
TikZ coordinates. Both work only while the plate leaves room. The technical
cover is deliberately NOT in that set and is not checked here: it hangs its
plate from the foot of a drawing sheet (`anchor=south` at 1.55in) and sets the
type in the bare paper above it, so the plate's own clean band is 1.5% and
means nothing about where the type lands.

This has now failed three ways in one evening, each of which a person looking
at a thumbnail called fine:

  * the plate's photograph started 22% down and the subtitle ran into it;
  * the replacement plate *looked* like it reserved 40% and started at 2.0%;
  * the type, moved up to make room, put the subtitle on top of the title's
    own last line, and left the imprint over a halftone photograph that is 37%
    lighter than luminance 140 -- neither black nor reversed white reads there.

So this checks two things, and the second is the one that actually decides.

PLATE CHECK (runs without a build): take the plate's own paper tone -- these are
aged-paper renders, so the brand hex is the wrong reference -- and walk down the
rows for the first where more than 2% of pixels are far from it. Hairline grid
rules stay under that threshold, which is right: the title sits over them by
design. A photograph or a flat colour plane does not.

PAGE CHECK (runs when the built PDF is there): take every text bounding box on
page one, map it onto the plate it prints over, and fail on a line that lands
on inked pixels. This is the honest test, because it uses where the type
actually landed rather than an arithmetic guess about leading and descenders,
and because it asks the right question about each line separately. An earlier
version demanded that every line sit inside the top clean band, which is not
the design: both covers deliberately set the imprint at the foot of the page,
over paper the plate leaves bare down there. That version failed three correct
maritime lines and would have pushed the fix in the wrong direction.

Run:
    python3 scripts/whitepaper-plates/check_cover_title_band.py
    python3 scripts/whitepaper-plates/check_cover_title_band.py --pdf-dir DIR
"""
from __future__ import annotations

import argparse
import os
import sys

import numpy as np
from PIL import Image

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PLATES = os.path.join(REPO, "website-v2", "public", "whitepaper", "plates")
PUB = os.path.join(REPO, "website-v2", "public", "whitepaper")

# edition -> (plate, built pdf, required clean fraction)
#
# The floor is what the type block needs plus a little air. The page check
# supersedes it whenever a build is available; the floor is what stops a plate
# being committed in the first place. Both full-bleed editions are registered:
# the Swiss cover, whose type is placed at absolute TikZ coordinates, and the
# maritime one, whose type is placed by a \vspace* from the top margin -- the
# same failure is available to both, and a check that covered only the edition
# that had already failed would be a patch, not a gate. Measured today: the
# maritime jacket leaves 39.2% clean, the Swiss cover 32.6%.
COVERS = {
    "maritime": (os.path.join(PLATES, "jacket.jpg"),
                 os.path.join(PUB, "coordination-papers-mega-volume.pdf"),
                 0.30),
    "swiss": (os.path.join(PLATES, "swiss", "cover.jpg"),
              os.path.join(PUB, "coordination-papers-mega-volume-swiss.pdf"),
              0.30),
}

# Both thresholds are set from the plates themselves rather than picked round.
# INK_THRESHOLD: the grid hairlines these plates print sit within ~35 channel
# units of the paper tone and the photographs and colour planes are 90 or more
# away, so 60 separates the two with room on each side.
# ROW_FRACTION: the share of a ROW that must be inked before the row counts,
# which is what excuses a narrow mark high on the plate -- a corner ornament, a
# registration tick, the head of a vertical rule -- rather than a horizontal
# hairline. (A full-width hairline inks 100% of its own row; what saves the
# grid rules is INK_THRESHOLD above, because they are printed faint. Both are
# tested.) The shallowest real artwork band measured here inks 14% of its first
# row, so 2% sits well below anything that is actually a picture.
# LINE_INK_FRACTION: the page check's own threshold, and the reason it is a
# separate number. The plate's top clean band is the right floor for "may this
# plate be committed", but it is the wrong model for "does this line of type
# print over artwork": both covers deliberately set the imprint at the FOOT of
# the page, and a check that demanded every line live inside the top band would
# fail a correct design. So each line is measured where it actually lands, in
# the plate rows and columns its own bounding box covers. Measured: on the
# maritime cover every line sits over at most 1.6% ink; the Swiss cover's
# imprint, before it was moved, sat over 30-73%. 8% is between them, close
# enough to the clean end that a hairline rule or a faint grid under a line
# does not trip it.
INK_THRESHOLD = 60
ROW_FRACTION = 0.02
LINE_INK_FRACTION = 0.08


class UnreadablePlate(Exception):
    """A plate this check cannot say anything true about."""


def inked_mask(path: str) -> np.ndarray:
    """Which of the plate's pixels carry ink, judged against its own paper.

    These are aged-paper renders, so the brand hex is the wrong reference: the
    tone is read from a strip near the top of the plate, inside the margins,
    and everything far enough from that tone counts as ink.
    """
    pixels = np.asarray(Image.open(path).convert("RGB")).astype(int)
    height, width, _ = pixels.shape
    strip = pixels[int(height * 0.005):int(height * 0.03),
                   int(width * 0.2):int(width * 0.8)].reshape(-1, 3)
    paper = np.median(strip, axis=0)
    return np.abs(pixels - paper).max(axis=2) > INK_THRESHOLD


def clean_band(path: str) -> float:
    """Fraction of the plate's height that is bare paper, top down."""
    inked = inked_mask(path)
    height = inked.shape[0]
    hits = np.flatnonzero(inked.mean(axis=1) > ROW_FRACTION)
    if not hits.size:
        # No row anywhere on the plate inks 2% of its pixels. A cover plate
        # always has artwork somewhere, so this is a blank, corrupt or
        # wrongly-thresholded file -- not a plate that is maximally safe.
        # Returning 1.0 here would score "I could not tell" as "pass", which
        # is the one thing a gate must never do.
        raise UnreadablePlate(
            f"{os.path.relpath(path, REPO)}: no inked row at all -- the plate "
            f"is blank, unreadable, or its paper tone was mis-measured")
    return float(hits[0]) / height


def type_over_art(pdf_path: str, plate_path: str) -> list[str]:
    """Lines of type on page one that land on inked parts of the plate.

    Each line is measured where it actually sits. The plate bleeds over the
    whole page, so a text bounding box in page coordinates maps proportionally
    onto plate pixels, and the question is simply how much of that rectangle
    carries ink.
    """
    try:
        import pymupdf
    except ImportError as err:                            # pragma: no cover
        # This is the honest half of the check. Swallowing a missing
        # dependency turned it into a silent no-op that still printed
        # "every line of cover type sits inside the band" -- the caller
        # asked for the page check, so not being able to run it is a
        # failure, not a pass.
        raise SystemExit(
            "the page check needs PyMuPDF: pip install pymupdf "
            f"(import failed: {err})") from err
    inked = inked_mask(plate_path)
    rows, columns = inked.shape
    document = pymupdf.open(pdf_path)
    page = document[0]
    page_width, page_height = page.rect.width, page.rect.height
    offenders = []
    for block in page.get_text("dict")["blocks"]:
        for line in block.get("lines", []):
            text = "".join(span["text"] for span in line["spans"]).strip()
            if not text:
                continue
            x0, y0, x1, y1 = line["bbox"]
            top = max(0, int(y0 / page_height * rows))
            bottom = min(rows, int(y1 / page_height * rows))
            left = max(0, int(x0 / page_width * columns))
            right = min(columns, int(x1 / page_width * columns))
            if bottom <= top or right <= left:
                continue                      # off the page, or a zero-width run
            share = float(inked[top:bottom, left:right].mean())
            if share > LINE_INK_FRACTION:
                offenders.append(
                    f"{text[:48]!r} at {y0 / page_height * 100:.1f}% down sits over "
                    f"{share * 100:.0f}% ink (ceiling {LINE_INK_FRACTION * 100:.0f}%)")
    return offenders


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pdf-dir", help="directory holding a locally built PDF "
                                          "to check instead of the committed one")
    args = parser.parse_args()

    failures = []
    for edition, (plate, pdf, required) in COVERS.items():
        rel = os.path.relpath(plate, REPO)
        if not os.path.exists(plate):
            failures.append(f"{rel}: missing")
            continue
        try:
            band = clean_band(plate)
        except UnreadablePlate as err:
            failures.append(str(err))
            continue
        print(f"{edition}: plate's clean band is {band * 100:.1f}% of the page "
              f"(floor {required * 100:.0f}%)")
        if band < required:
            failures.append(
                f"{rel}: clean band {band * 100:.1f}% is under the {required * 100:.0f}% "
                f"floor; the title will print over the artwork")

        # The page check needs a FRESH build. The committed PDF lags its own
        # source -- CI regenerates and commits it after a push -- so running
        # this against the checked-in file would fail on a defect the working
        # tree has already fixed. Point it at a build directory instead; the
        # whitepaper-build workflow does exactly that once it has compiled.
        if not args.pdf_dir:
            print(f"{edition}: page check skipped (needs --pdf-dir with a fresh build)")
            continue
        pdf = os.path.join(args.pdf_dir, os.path.basename(pdf))
        if os.path.exists(pdf):
            offenders = type_over_art(pdf, plate)
            if offenders:
                for line in offenders:
                    failures.append(f"{edition} cover: {line}")
            else:
                print(f"{edition}: every line of cover type lands on bare paper")
        else:
            print(f"{edition}: no built PDF to check ({os.path.relpath(pdf, REPO)})")

    if failures:
        print("\ncover title band: FAIL", file=sys.stderr)
        for failure in failures:
            print(f"  - {failure}", file=sys.stderr)
        return 1
    print("cover title band: every full-bleed cover leaves room for its type")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
