#!/usr/bin/env python3
"""Measure whether chapter-stp's two arcs really lie on one circle.

The plate has one job: show a band interrupted and resumed, both halves plainly
the same ring at the same radius, so the eye reads one broken circle rather than
two curves. Three rounds of prompt language never bought it, and the round-4
pick was made by eye and written up as if it had -- a reviewer looked at the
shipped plate and said the halves do not share a centre, and measurement agreed
with the reviewer, not with me.

So the pick is measured now. Segment the violet, close the halftone screen that
fragments it over the photograph, take the two largest components, sample each
one's outer boundary by angle, and least-squares fit a circle to each. Two
numbers decide it:

  * centre offset, as a share of radius -- how far from concentric the halves
    are. This is the one that gives away "two unrelated shapes"; a plate can
    have near-equal radii and still read as two curves if the centres are
    displaced.
  * radius difference, as a share of radius -- how far from equal the halves
    are.

Both are reported against the RAW render rather than the cropped plate, because
the crop removes part of each arc and the fit then answers a question about the
crop instead of about the drawing.

Usage:
    python3 scripts/whitepaper-plates/score_broken_arc.py RENDER [RENDER ...]
"""
from __future__ import annotations

import argparse
import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage, optimize


def violet_arcs(path: str):
    """The two largest violet components, or None if the plate has no pair."""
    pixels = np.asarray(Image.open(path).convert("RGB")).astype(float)
    red, green, blue = pixels[:, :, 0], pixels[:, :, 1], pixels[:, :, 2]
    # "violet-ish" rather than a distance to one hex: the ink is screened into a
    # halftone where it crosses the photograph, so its pixels are a cloud.
    mask = (blue > green + 25) & (red > green) & (blue > 60) & (pixels.max(axis=2) < 235)
    mask = ndimage.binary_closing(mask, np.ones((9, 9)))
    mask = ndimage.binary_opening(mask, np.ones((5, 5)))
    labels, count = ndimage.label(mask)
    if count < 2:
        return None
    sizes = ndimage.sum(mask, labels, range(1, count + 1))
    order = np.argsort(sizes)[::-1]
    if sizes[order[1]] < 0.15 * sizes[order[0]]:
        return None                       # one blob and a speck: not two arcs
    return [(labels == order[k] + 1) for k in range(2)]


def fit_outer_circle(component: np.ndarray) -> tuple[float, float, float]:
    ys, xs = np.nonzero(component)
    cy, cx = ys.mean(), xs.mean()
    angle = np.arctan2(ys - cy, xs - cx)
    radius = np.hypot(xs - cx, ys - cy)
    bins = np.digitize(angle, np.linspace(-np.pi, np.pi, 241))
    oy, ox = [], []
    for b in np.unique(bins):
        sel = bins == b
        i = np.argmax(radius[sel])
        oy.append(ys[sel][i])
        ox.append(xs[sel][i])
    oy, ox = np.array(oy, float), np.array(ox, float)
    guess = [ox.mean(), oy.mean(), np.hypot(ox - ox.mean(), oy - oy.mean()).mean()]
    fit = optimize.least_squares(
        lambda p: np.hypot(ox - p[0], oy - p[1]) - p[2], guess)
    return tuple(fit.x)


def score(path: str) -> tuple[float, float] | None:
    parts = violet_arcs(path)
    if parts is None:
        return None
    (c1x, c1y, r1), (c2x, c2y, r2) = (fit_outer_circle(p) for p in parts)
    biggest = max(r1, r2)
    return (float(np.hypot(c1x - c2x, c1y - c2y) / biggest),
            float(abs(r1 - r2) / biggest))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("renders", nargs="+")
    args = parser.parse_args()

    rows = []
    for path in args.renders:
        result = score(path)
        name = os.path.basename(path)
        if result is None:
            print(f"{name:28s}  no pair of comparable violet arcs")
            continue
        offset, radius_gap = result
        rows.append((offset + radius_gap, name, offset, radius_gap))
        print(f"{name:28s}  centre offset {offset * 100:6.1f}% of R   "
              f"radius difference {radius_gap * 100:5.1f}%")
    if rows:
        rows.sort()
        _, name, offset, radius_gap = rows[0]
        print(f"\nbest by measurement: {name} "
              f"(centre {offset * 100:.1f}%, radius {radius_gap * 100:.1f}%)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
