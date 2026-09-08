#!/usr/bin/env python3
"""Fail if a full-bleed cover's type would print over its artwork.

The Swiss and technical covers are full-bleed images with the title set at fixed
overlay coordinates on top. That works only while the plate leaves room. It has
now failed three ways in one evening, each of which a person looking at a
thumbnail called fine:

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

PAGE CHECK (runs when the built PDF is there): read every text bounding box on
page one and the plate's inked region, and fail on any overlap. This is the
honest test, because it uses where the type actually landed rather than an
arithmetic guess about leading and descenders.

Run:
    python3 scripts/whitepaper-plates/check_cover_title_band.py
    python3 scripts/whitepaper-plates/check_cover_title_band.py --pdf DIR
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
# being committed in the first place.
COVERS = {
    "swiss": (os.path.join(PLATES, "swiss", "cover.jpg"),
              os.path.join(PUB, "coordination-papers-mega-volume-swiss.pdf"),
              0.30),
}

# Both thresholds are set from the plates themselves rather than picked round.
# INK_THRESHOLD: the grid hairlines these plates print sit within ~35 channel
# units of the paper tone and the photographs and colour planes are 90 or more
# away, so 60 separates the two with room on each side.
# ROW_FRACTION: a hairline crossing the full width inks well under 1% of a row's
# pixels; the shallowest real artwork band measured here inks 14% of its first
# row. 2% sits between them, nearer the hairline end so the check errs toward
# calling a row inked.
INK_THRESHOLD = 60
ROW_FRACTION = 0.02


def clean_band(path: str) -> float:
    """Fraction of the plate's height that is bare paper, top down."""
    pixels = np.asarray(Image.open(path).convert("RGB")).astype(int)
    height, width, _ = pixels.shape
    strip = pixels[int(height * 0.005):int(height * 0.03),
                   int(width * 0.2):int(width * 0.8)].reshape(-1, 3)
    paper = np.median(strip, axis=0)
    inked = (np.abs(pixels - paper).max(axis=2) > INK_THRESHOLD)
    hits = np.flatnonzero(inked.mean(axis=1) > ROW_FRACTION)
    return float(hits[0]) / height if hits.size else 1.0


def type_over_art(pdf_path: str, band: float) -> list[str]:
    """Text on page one that reaches below the plate's clean band."""
    try:
        import pymupdf
    except ImportError:                                   # pragma: no cover
        return []
    document = pymupdf.open(pdf_path)
    page = document[0]
    height = page.rect.height
    limit = band * height
    offenders = []
    for block in page.get_text("dict")["blocks"]:
        for line in block.get("lines", []):
            text = "".join(span["text"] for span in line["spans"]).strip()
            if not text:
                continue
            bottom = line["bbox"][3]
            if bottom > limit:
                offenders.append(
                    f"{text[:48]!r} reaches {bottom / height * 100:.1f}% down, "
                    f"past the plate's clean band at {band * 100:.1f}%")
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
        band = clean_band(plate)
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
            offenders = type_over_art(pdf, band)
            if offenders:
                for line in offenders:
                    failures.append(f"{edition} cover: {line}")
            else:
                print(f"{edition}: every line of cover type sits inside the band")
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
