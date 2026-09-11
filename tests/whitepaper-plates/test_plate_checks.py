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
  * that the ground is read off the RENDERED page rather than the embedded
    plate, so a scrim, a tint or a panel drawn between the two counts -- the
    maritime Part IV opener is fixed by exactly such a scrim, and a check that
    read the plate file would still call it broken;
  * that contrast, not ink coverage, is what decides, so a pale wash under a
    line is not mistaken for artwork the line cannot survive;
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


class ManifestTests(unittest.TestCase):
    """The manifest is the register of what gets checked; if it goes stale the
    check quietly stops covering a page and nothing says so."""

    def setUp(self) -> None:
        self.manifest = band.load_manifest()

    def test_every_registered_cover_plate_is_on_disk_and_clears_its_floor(self) -> None:
        self.assertTrue(self.manifest["covers"])
        for cover in self.manifest["covers"]:
            with self.subTest(cover=cover["id"]):
                path = os.path.join(band.REPO, cover["plate"])
                self.assertTrue(os.path.exists(path), f"{cover['plate']} is missing")
                self.assertGreaterEqual(band.clean_band(path),
                                        cover["clean_band_floor"])

    def test_every_cover_still_measures_what_the_manifest_records(self) -> None:
        for cover in self.manifest["covers"]:
            recorded = cover.get("measured", {}).get("clean_band")
            if recorded is None:
                continue
            with self.subTest(cover=cover["id"]):
                measured = band.clean_band(os.path.join(band.REPO, cover["plate"]))
                self.assertAlmostEqual(measured, recorded, delta=0.005)

    def test_the_built_edition_is_registered_and_no_other(self) -> None:
        """One edition is built; three drivers are present. The page half of
        this check reads built PDFs, so registering an edition nothing builds
        would fail it on a file that never arrives -- check_pages counts a
        registered edition with no PDF as a finding, which is the right rule
        and the reason the register has to track what the build produces."""
        self.assertEqual({e["id"] for e in self.manifest["editions"]}, {"swiss"})
        for edition in self.manifest["editions"]:
            with self.subTest(edition=edition["id"]):
                self.assertTrue(os.path.exists(os.path.join(band.REPO, edition["pdf"])))

    def test_every_character_still_has_a_driver_root(self) -> None:
        """The other two characters are switchable, not deleted. Their driver
        roots stay in the tree so either can be built by hand or made central
        again by moving \\pdedition's default in the preamble."""
        whitepaper = os.path.join(band.REPO, "website-v2", "public", "whitepaper")
        for edition in ("maritime", "swiss", "technical"):
            with self.subTest(edition=edition):
                driver = os.path.join(
                    whitepaper, f"coordination-papers-mega-volume-{edition}.tex")
                self.assertTrue(os.path.exists(driver), f"{driver} is missing")
                with open(driver, encoding="utf-8") as handle:
                    source = handle.read()
                self.assertIn(rf"\def\pdedition{{{edition}}}", source)

    def test_the_floors_are_the_wcag_aa_ones(self) -> None:
        contrast = self.manifest["contrast"]
        self.assertEqual(contrast["normal"], 4.5)
        self.assertEqual(contrast["large"], 3.0)
        self.assertEqual(contrast["large_point_size"], 18.0)


class ContrastTests(unittest.TestCase):
    def test_luminance_endpoints(self) -> None:
        self.assertAlmostEqual(float(band.relative_luminance(np.array((255, 255, 255)))), 1.0)
        self.assertAlmostEqual(float(band.relative_luminance(np.array((0, 0, 0)))), 0.0)

    def test_black_on_white_is_the_maximum_ratio(self) -> None:
        self.assertAlmostEqual(band.contrast_ratio(1.0, 0.0), 21.0)

    def test_the_ratio_does_not_care_which_way_round_it_is_given(self) -> None:
        self.assertEqual(band.contrast_ratio(0.2, 0.8), band.contrast_ratio(0.8, 0.2))


class PageCheckTests(unittest.TestCase):
    """The page half: each line judged on the ground it actually lands on."""

    def build(self, directory: str, lines, plate_rect=(0, 0, 300, 400),
              scrim=None) -> str:
        """A one-page PDF with a plate: dark in its lower half, paper above."""
        import pymupdf
        pixels = plate(400, 300)
        pixels[200:, :, :] = (24, 24, 24)
        image_path = write(pixels, directory)
        document = pymupdf.open()
        page = document.new_page(width=300, height=400)
        page.insert_image(pymupdf.Rect(*plate_rect), filename=image_path)
        if scrim is not None:
            page.draw_rect(pymupdf.Rect(*scrim), color=None,
                           fill=(0.984, 0.969, 0.937), fill_opacity=0.9)
        for text, y, size, colour in lines:
            page.insert_text((20, y), text, fontsize=size, color=colour)
        path = os.path.join(directory, "page.pdf")
        document.save(path)
        return path

    CONTRAST = {"normal": 4.5, "large": 3.0, "large_point_size": 18.0,
                "ground_percentile": 10}

    def test_a_line_on_bare_paper_passes_however_far_down_it_sits(self) -> None:
        """Both covers set the imprint at the foot of the page on purpose, so
        depth on the page is not the question."""
        with tempfile.TemporaryDirectory() as directory:
            pdf = self.build(directory, [("Erich Owens", 150.0, 9, (0, 0, 0))])
            self.assertEqual(band.illegible_lines(pdf, self.CONTRAST), [])

    def test_dark_type_on_a_dark_ground_is_reported_with_its_ratio(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            pdf = self.build(directory, [("Erich Owens", 300.0, 9, (0, 0, 0))])
            offenders = band.illegible_lines(pdf, self.CONTRAST)
            self.assertEqual(len(offenders), 1)
            self.assertIn("Erich Owens", offenders[0])
            self.assertIn(":1", offenders[0])

    def test_reversed_type_on_the_same_dark_ground_passes(self) -> None:
        """The measure is contrast against the line's OWN colour, so white on
        the headland is fine where black on it is not."""
        with tempfile.TemporaryDirectory() as directory:
            pdf = self.build(directory, [("Erich Owens", 300.0, 9, (1, 1, 1))])
            self.assertEqual(band.illegible_lines(pdf, self.CONTRAST), [])

    def test_a_scrim_between_the_plate_and_the_type_counts(self) -> None:
        """The reason the ground is read off the rendered page and not off the
        plate file: this is the fix the maritime Part IV opener needed, and a
        check reading the plate would still call the page broken."""
        with tempfile.TemporaryDirectory() as directory:
            without = self.build(directory, [("Erich Owens", 300.0, 9, (0, 0, 0))])
            self.assertEqual(len(band.illegible_lines(without, self.CONTRAST)), 1)
        with tempfile.TemporaryDirectory() as directory:
            withscrim = self.build(directory, [("Erich Owens", 300.0, 9, (0, 0, 0))],
                                   scrim=(10, 280, 290, 320))
            self.assertEqual(band.illegible_lines(withscrim, self.CONTRAST), [])

    def test_large_type_is_held_to_the_lower_wcag_floor(self) -> None:
        """A ground that fails a 9pt line can still carry a 24pt one; the two
        floors are 4.5:1 and 3:1, and the check must apply the right one."""
        # Chosen by the arithmetic, not by eye: against this fixture's paper
        # (luminance 0.925) a 50% grey reads 3.76:1 -- under the 4.5:1 floor
        # for normal text and over the 3:1 floor for large.
        grey = (0.50, 0.50, 0.50)
        with tempfile.TemporaryDirectory() as directory:
            small = self.build(directory, [("Erich Owens", 150.0, 9, grey)])
            self.assertEqual(len(band.illegible_lines(small, self.CONTRAST)), 1)
        with tempfile.TemporaryDirectory() as directory:
            large = self.build(directory, [("Erich Owens", 150.0, 24, grey)])
            self.assertEqual(band.illegible_lines(large, self.CONTRAST), [])

    def test_a_page_whose_image_is_too_small_to_be_a_ground_is_not_checked(self) -> None:
        """Below the fraction it is a margin figure or an inline diagram, and
        the figure gates own those."""
        with tempfile.TemporaryDirectory() as directory:
            pdf = self.build(directory, [("Erich Owens", 300.0, 9, (0, 0, 0))],
                             plate_rect=(0, 0, 90, 90))
            self.assertEqual(band.illegible_lines(pdf, self.CONTRAST), [])

    def test_the_ground_raster_has_the_type_taken_out_of_it(self) -> None:
        """Otherwise the glyphs themselves would be measured as the ground and
        every line would look like it sits on ink."""
        import pymupdf
        with tempfile.TemporaryDirectory() as directory:
            pdf = self.build(directory, [("Erich Owens", 150.0, 9, (0, 0, 0))])
            document = pymupdf.open(pdf)
            page = document[0]
            self.assertIn("Erich Owens", page.get_text())
            band.ground_raster(pymupdf, page, 150)
            self.assertEqual(page.get_text().strip(), "")


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
