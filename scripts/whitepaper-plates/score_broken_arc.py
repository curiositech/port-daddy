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

The chosen render is not concentric to a caliper -- 6.3% of a radius apart,
11.5% different in radius, best of twelve -- and PROVENANCE.json says so. A
threshold the plate fails would be theatre, so what CI checks instead is that
the record still describes the file on disk: --verify-provenance re-measures
the committed plate and fails if it has drifted. That catches the regression
this script was written for (a plate quietly replaced by a worse one) without
pretending the geometry is better than it is.

Two numbers, not one, because they answer different questions. `measurement`
is the fit against the RAW render, which is the one that judges the drawing:
it is what picked candidate 1 out of twelve. `measurement_shipped` is the fit
against the committed JPEG, after the 2% inset and the centre crop to 2:1 --
that crop truncates both arcs, so its numbers are larger and are NOT a verdict
on the artwork. Only the shipped one can be re-derived in CI, since the raw
renders are not committed, so that is the one --verify-provenance uses.

Usage:
    python3 scripts/whitepaper-plates/score_broken_arc.py RENDER [RENDER ...]
    python3 scripts/whitepaper-plates/score_broken_arc.py --verify-provenance
    python3 scripts/whitepaper-plates/score_broken_arc.py --record-shipped
"""
from __future__ import annotations

import argparse
import json
import os

import numpy as np
from PIL import Image
from scipy import ndimage, optimize

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SWISS = os.path.join(REPO, "website-v2", "public", "whitepaper", "plates", "swiss")

# How far a re-measurement may sit from the recorded one before it counts as a
# different plate. The two numbers are shares of a radius, recorded to three
# decimals; the segmentation is deterministic on a fixed file, so any drift at
# all means the JPEG changed. 0.005 is a hair of slack for a NumPy or SciPy
# version that rounds the least-squares fit differently.
PROVENANCE_TOLERANCE = 0.005


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


PROVENANCE_PATH = os.path.join(SWISS, "PROVENANCE.json")


def measured_plates(record: dict) -> list[tuple[str, dict]]:
    """The plates whose geometry this script is the record for."""
    return [(name, entry) for name, entry in sorted(record.get("plates", {}).items())
            if entry.get("measurement")]


def verify_provenance() -> int:
    """Re-measure every committed plate that records a shipped measurement."""
    with open(PROVENANCE_PATH, encoding="utf-8") as handle:
        record = json.load(handle)

    checked, failures = 0, []
    for name, entry in measured_plates(record):
        checked += 1
        recorded = entry.get("measurement_shipped")
        if not recorded:
            failures.append(
                f"{name}: records a raw-render measurement but no "
                f"measurement_shipped -- run --record-shipped so CI has "
                f"something it can re-derive")
            continue
        plate = os.path.join(SWISS, entry["file"])
        if not os.path.exists(plate):
            failures.append(f"{name}: {entry['file']} is missing")
            continue
        result = score(plate)
        if result is None:
            failures.append(
                f"{name}: no pair of comparable violet arcs on the shipped plate, "
                f"but PROVENANCE.json records a measurement of two")
            continue
        offset, radius_gap = result
        drifted = False
        for label, measured, key in (
                ("centre offset", offset, "centre_offset_share_of_radius"),
                ("radius difference", radius_gap, "radius_difference_share_of_radius")):
            expected = recorded[key]
            if abs(measured - expected) > PROVENANCE_TOLERANCE:
                drifted = True
                failures.append(
                    f"{name}: {label} measures {measured:.3f}, PROVENANCE.json "
                    f"records {expected:.3f} -- the plate and its record disagree")
        if not drifted:
            print(f"{name}: shipped plate still measures centre {offset:.3f}, "
                  f"radius {radius_gap:.3f}, as recorded")

    if failures:
        print("\nbroken-arc provenance: FAIL")
        for failure in failures:
            print(f"  - {failure}")
        return 1
    print(f"broken-arc provenance: {checked} measured plate(s) still match their record")
    return 0


def record_shipped() -> int:
    """Write each measured plate's shipped-JPEG fit back into PROVENANCE.json."""
    with open(PROVENANCE_PATH, encoding="utf-8") as handle:
        record = json.load(handle)

    for name, entry in measured_plates(record):
        plate = os.path.join(SWISS, entry["file"])
        result = score(plate)
        if result is None:
            raise SystemExit(f"{name}: no pair of comparable violet arcs in {plate}")
        offset, radius_gap = result
        entry["measurement_shipped"] = {
            "script": "scripts/whitepaper-plates/score_broken_arc.py --record-shipped",
            "measured_on": (f"the committed {entry['file']}, after the 2% inset and the "
                            f"centre crop to {entry['final_aspect']} -- the crop truncates "
                            f"both arcs, so these numbers are larger than the raw render's "
                            f"and are not a verdict on the drawing"),
            "centre_offset_share_of_radius": round(offset, 3),
            "radius_difference_share_of_radius": round(radius_gap, 3),
        }
        print(f"{name}: recorded centre {offset:.3f}, radius {radius_gap:.3f}")

    tmp = PROVENANCE_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as handle:
        json.dump(record, handle, indent=2, ensure_ascii=False)
        handle.write("\n")
    os.replace(tmp, PROVENANCE_PATH)
    print(f"wrote {PROVENANCE_PATH}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("renders", nargs="*")
    parser.add_argument("--verify-provenance", action="store_true",
                        help="re-measure the committed plates against PROVENANCE.json")
    parser.add_argument("--record-shipped", action="store_true",
                        help="write each measured plate's shipped-JPEG fit into "
                             "PROVENANCE.json, so --verify-provenance has a "
                             "re-derivable number to hold it to")
    args = parser.parse_args()

    if args.verify_provenance or args.record_shipped:
        if args.renders:
            raise SystemExit("that mode takes no render arguments")
        if args.verify_provenance and args.record_shipped:
            raise SystemExit("--verify-provenance and --record-shipped are exclusive")
        return verify_provenance() if args.verify_provenance else record_shipped()
    if not args.renders:
        raise SystemExit("give at least one render, or pass --verify-provenance")

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
