#!/usr/bin/env python3
"""Fail if a full-bleed cover plate has no room for the title typeset over it.

The Swiss and technical covers are full-bleed images with the title set at fixed
overlay coordinates on top. That works only while the plate leaves the top of
the page as bare paper. Round 4a's cover looked like it did -- in a contact
sheet at 430px the upper band reads as empty -- and it did not: substantial ink
started 2% down, and the built cover printed "and the Economy" and the whole
subtitle over a photograph of a container port.

A thumbnail cannot answer this and neither can an eye. This measures it.

Method: take the plate's own paper tone as the median of a thin strip across the
top (its own off-white, not the brand hex -- these are aged-paper renders), then
walk down the rows and find the first one where more than 2% of pixels are far
from that tone. Hairline grid rules stay under the threshold, which is right:
the title sits over them by design. A photograph or a flat colour plane does
not.

Run:
    python3 scripts/whitepaper-plates/check_cover_title_band.py
"""
from __future__ import annotations

import os
import sys

import numpy as np
from PIL import Image

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PLATES = os.path.join(REPO, "website-v2", "public", "whitepaper", "plates")

# plate -> (required clean fraction, what occupies that band)
#
# The Swiss cover sets a three-line title at 34pt from 16mm down and the
# subtitle at 60mm, on a 254mm page: the type block ends at about 28.3%. The
# floor is 30%, which is that plus a two-point gap so the last line of the
# subtitle is not sitting on the edge of a photograph.
COVERS = {
    os.path.join(PLATES, "swiss", "cover.jpg"): (
        0.30, "the three-line title (34pt from 16mm) and the subtitle (13pt at 60mm)"),
}

INK_THRESHOLD = 60      # channel distance from paper that counts as real ink
ROW_FRACTION = 0.02     # share of a row that must be inked for the row to count


def clean_band(path: str) -> float:
    """Fraction of the plate's height that is bare paper, top down."""
    image = Image.open(path).convert("RGB")
    pixels = np.asarray(image).astype(int)
    height, width, _ = pixels.shape
    strip = pixels[int(height * 0.005):int(height * 0.03),
                   int(width * 0.2):int(width * 0.8)].reshape(-1, 3)
    paper = np.median(strip, axis=0)
    inked = (np.abs(pixels - paper).max(axis=2) > INK_THRESHOLD)
    per_row = inked.mean(axis=1)
    hits = np.flatnonzero(per_row > ROW_FRACTION)
    return float(hits[0]) / height if hits.size else 1.0


def main() -> int:
    failures = []
    for path, (required, what) in COVERS.items():
        rel = os.path.relpath(path, REPO)
        if not os.path.exists(path):
            failures.append(f"{rel}: missing")
            continue
        band = clean_band(path)
        verdict = "ok" if band >= required else "TOO SHALLOW"
        print(f"{rel}: clean band {band * 100:.1f}% of the page "
              f"(needs {required * 100:.0f}% for {what}) -- {verdict}")
        if band < required:
            failures.append(
                f"{rel}: the plate's clean band is {band * 100:.1f}% of the page but "
                f"{what} needs {required * 100:.0f}%. The title will print over the "
                f"artwork. Re-render the cover with a deeper reserved band, or move "
                f"the type.")
    if failures:
        print("\ncover title band: FAIL", file=sys.stderr)
        for failure in failures:
            print(f"  - {failure}", file=sys.stderr)
        return 1
    print("cover title band: every full-bleed cover leaves room for its title")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
