#!/usr/bin/env python3
"""Unit tests for the two plate checks that gate CI.

Both scripts were shipped with prose justifying their constants against the
plates that happened to be committed the day they were written, and nothing
else. Three reviews said the same thing about that, and they were right: a
gate whose only exercise is the current artwork cannot tell you it still works
when the artwork changes -- which is precisely the moment it is supposed to
speak.

So the fixtures here are synthetic, and each one is built to isolate one
decision the checks make:

  * that the paper tone is read from the plate rather than assumed white
    (these are aged-paper renders; a white reference calls the whole plate
    inked);
  * that a hairline rule crossing the full width does not count as artwork
    (the title sits over grid rules by design);
  * that a plate with no ink at all is an error, not a pass -- the fail-open
    branch this closed used to score "I could not tell" as "maximally safe";
  * that a line of type is judged where it actually lands, not against one
    global band, because both covers set the imprint at the foot of the page
    on purpose;
  * that two arcs on one circle measure as concentric and two on different
    circles do not.

stdlib plus the three wheels the checks themselves need.

Run:
    python3 -m unittest discover -s tests/whitepaper-plates
"""
from __future__ import annotations

import importlib.util
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image

REPO = Path(__file__).resolve().parents[2]
SCRIPTS = REPO / "scripts" / "whitepaper-plates"


def load(name: str):
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


band = load("check_cover_title_band")
arcs = load("score_broken_arc")

# The aged-paper tone these plates actually print on, not white. Every fixture
# uses it so that a check which assumed #ffffff would fail these tests.
PAPER = (251, 247, 239)


def plate(rows: int = 400, columns: int = 300, paper=PAPER) -> np.ndarray:
    return np.tile(np.array(paper, dtype=np.uint8), (rows, columns, 1))


def write(pixels: np.ndarray, directory: str, name: str = "plate.png") -> str:
    path = os.path.join(directory, name)
    Image.fromarray(pixels).save(path)
    return path


class CleanBandTests(unittest.TestCase):
    def test_the_band_ends_where_the_artwork_starts(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            pixels = plate()
            pixels[160:, :, :] = (20, 20, 20)          # artwork from 40% down
            self.assertAlmostEqual(
                band.clean_band(write(pixels, directory)), 0.40, places=2)

    def test_the_paper_tone_is_read_from_the_plate_not_assumed_white(self) -> None:
        """A plate on dark stock is still bare paper at the top."""
        with tempfile.TemporaryDirectory() as directory:
            pixels = plate(paper=(60, 58, 54))
            pixels[200:, :, :] = (245, 245, 245)
            self.assertAlmostEqual(
                band.clean_band(write(pixels, directory)), 0.50, places=2)

    def test_a_faint_grid_rule_does_not_end_the_band(self) -> None:
        """The title is set over the plate's grid rules by design, and it is
        INK_THRESHOLD that excuses them, not ROW_FRACTION: a full-width rule
        inks 100% of its own row, so only its faintness saves it."""
        with tempfile.TemporaryDirectory() as directory:
            pixels = plate()
            pixels[80, :, :] = (221, 217, 209)         # ~30 units off the paper
            pixels[300:, :, :] = (20, 20, 20)          # the real artwork
            self.assertAlmostEqual(
                band.clean_band(write(pixels, directory)), 0.75, places=2)

    def test_a_narrow_mark_high_on_the_plate_does_not_end_the_band(self) -> None:
        """And this is what ROW_FRACTION buys: a registration tick or a corner
        ornament inks a sliver of its row, not the row."""
        with tempfile.TemporaryDirectory() as directory:
            pixels = plate()
            pixels[60:90, 0:3, :] = (20, 20, 20)       # 1% of each row's width
            pixels[300:, :, :] = (20, 20, 20)
            self.assertAlmostEqual(
                band.clean_band(write(pixels, directory)), 0.75, places=2)

    def test_a_plate_with_no_ink_at_all_is_an_error(self) -> None:
        """The closed fail-open branch. This used to return 1.0 -- a blank or
        unreadable plate scored as the safest possible one."""
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(band.UnreadablePlate):
                band.clean_band(write(plate(), directory))

    def test_the_floor_the_committed_covers_are_held_to_is_the_one_they_pass(self) -> None:
        """Both full-bleed editions are registered, and the technical one --
        whose type sits in the paper above its plate, not over it -- is not."""
        self.assertEqual(set(band.COVERS), {"maritime", "swiss"})
        for edition, (path, _pdf, floor) in band.COVERS.items():
            with self.subTest(edition=edition):
                self.assertTrue(os.path.exists(path), f"{path} is missing")
                self.assertGreaterEqual(band.clean_band(path), floor)


class TypeOverArtTests(unittest.TestCase):
    """The page half: each line judged where it lands, not against one band."""

    def build(self, directory: str, ys: list[float]) -> str:
        import pymupdf
        document = pymupdf.open()
        page = document.new_page(width=300, height=400)   # 1pt per plate pixel
        for y in ys:
            page.insert_text((30, y), "Erich Owens", fontsize=11)
        path = os.path.join(directory, "cover.pdf")
        document.save(path)
        return path

    def test_a_line_over_bare_paper_passes_however_far_down_it_sits(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            pixels = plate()
            pixels[100:300, :, :] = (20, 20, 20)      # artwork in the middle band
            plate_path = write(pixels, directory)
            pdf = self.build(directory, [380.0])      # the imprint, at the foot
            self.assertEqual(band.type_over_art(pdf, plate_path), [])

    def test_a_line_over_artwork_is_reported_with_its_ink_share(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            pixels = plate()
            pixels[100:300, :, :] = (20, 20, 20)
            plate_path = write(pixels, directory)
            pdf = self.build(directory, [200.0])      # straight into the artwork
            offenders = band.type_over_art(pdf, plate_path)
            self.assertEqual(len(offenders), 1)
            self.assertIn("Erich Owens", offenders[0])
            self.assertIn("100% ink", offenders[0])

    def test_the_ceiling_sits_between_a_hairline_and_a_photograph(self) -> None:
        self.assertGreater(band.LINE_INK_FRACTION, 0.02)
        self.assertLess(band.LINE_INK_FRACTION, 0.30)


class BrokenArcTests(unittest.TestCase):
    """The concentricity measurement behind the chapter-stp pick."""

    VIOLET = (147, 63, 165)

    def ring(self, pixels: np.ndarray, cx: float, cy: float, radius: float,
             start: float, stop: float, width: float = 14.0) -> None:
        rows, columns, _ = pixels.shape
        ys, xs = np.mgrid[0:rows, 0:columns]
        distance = np.hypot(xs - cx, ys - cy)
        angle = np.arctan2(ys - cy, xs - cx)
        on = ((np.abs(distance - radius) < width / 2)
              & (angle >= start) & (angle <= stop))
        pixels[on] = self.VIOLET

    def test_two_arcs_on_one_circle_measure_as_one_circle(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            pixels = plate(600, 600)
            self.ring(pixels, 300, 300, 200, -2.9, -0.3)
            self.ring(pixels, 300, 300, 200, 0.3, 2.9)
            offset, radius_gap = arcs.score(write(pixels, directory))
            self.assertLess(offset, 0.05)
            self.assertLess(radius_gap, 0.05)

    def test_two_arcs_at_different_radii_are_measured_as_different(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            pixels = plate(600, 600)
            self.ring(pixels, 300, 300, 200, -2.9, -0.3)
            self.ring(pixels, 300, 300, 260, 0.3, 2.9)
            offset, radius_gap = arcs.score(write(pixels, directory))
            self.assertGreater(offset + radius_gap, 0.05)

    def test_one_arc_alone_is_not_a_pair(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            pixels = plate(600, 600)
            self.ring(pixels, 300, 300, 200, -2.9, -0.3)
            self.assertIsNone(arcs.score(write(pixels, directory)))

    def test_every_measured_plate_carries_a_re_derivable_number(self) -> None:
        """--verify-provenance can only hold the record to a number it can
        recompute, and the raw renders are not committed. So a plate that
        records a raw-render measurement must also record the shipped one."""
        with open(arcs.PROVENANCE_PATH, encoding="utf-8") as handle:
            record = json.load(handle)
        measured = arcs.measured_plates(record)
        self.assertTrue(measured, "no plate records a broken-arc measurement")
        for name, entry in measured:
            with self.subTest(plate=name):
                shipped = entry.get("measurement_shipped")
                self.assertIsNotNone(shipped)
                self.assertIn("centre_offset_share_of_radius", shipped)
                self.assertIn("radius_difference_share_of_radius", shipped)


if __name__ == "__main__":
    unittest.main()
