"""Unit tests for figcheck.py's T9 (dash resolution) and T10 (typeface
consistency) -- the two checks that answer questions no source linter can.

Same synthetic-PDF-via-pymupdf pattern as test_figcheck_t8.py. The font-family
helpers are unit-tested directly, because T10's whole soundness rests on them:
what counts as one family, what counts as math, and what counts as a word.
"""
import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path

import pymupdf

SCRIPT_PATH = Path(__file__).resolve().parent.parent / "scripts" / "figcheck.py"
spec = importlib.util.spec_from_file_location("figcheck", SCRIPT_PATH)
figcheck = importlib.util.module_from_spec(spec)
sys.modules["figcheck"] = figcheck
spec.loader.exec_module(figcheck)


def save_temp_pdf(doc):
    tmp = tempfile.NamedTemporaryFile(suffix=".pdf", delete=False)
    tmp.close()
    doc.save(tmp.name)
    return tmp.name


# --------------------------------------------------------------------------- #
# The family helpers
# --------------------------------------------------------------------------- #
class TestFontFamily(unittest.TestCase):
    def test_weight_and_slope_are_not_families(self):
        """A role separating itself by weight is what the house style ASKS for,
        so bold and regular of one face must reduce to one family or T10 would
        fire on every correctly-set figure."""
        for name in ("TeXGyreHeros-Bold", "TeXGyreHeros-Regular", "TeXGyreHeros-Italic"):
            self.assertEqual(figcheck.font_family(name), "TeXGyreHeros")

    def test_subset_prefix_is_stripped(self):
        self.assertEqual(figcheck.font_family("ABCDEF+TeXGyrePagellaX-Bold"), "TeXGyrePagellaX")

    def test_size_and_variant_tags_are_stripped(self):
        self.assertEqual(figcheck.font_family("CMR10"), "CMR")
        self.assertEqual(figcheck.font_family("NewPXMI_gnu"), "NewPXMI")

    def test_two_real_faces_stay_two_families(self):
        self.assertNotEqual(
            figcheck.font_family("TeXGyreHeros-Regular"),
            figcheck.font_family("TeXGyrePagellaX-Regular"),
        )


class TestClassifyFamily(unittest.TestCase):
    def test_the_identifier_face_is_mono(self):
        self.assertEqual(figcheck.classify_family("SourceCodePro"), "mono")

    def test_the_math_sets_this_repo_loads_are_math(self):
        """Measured in real fragment PDFs from this corpus, not invented."""
        for fam in ("NewPXMI", "pxsys", "pxmiaX", "CMMI", "CMSY"):
            self.assertEqual(figcheck.classify_family(fam), "math", fam)

    def test_a_text_face_is_text(self):
        for fam in ("TeXGyreHeros", "TeXGyrePagellaX", "LMRoman"):
            self.assertEqual(figcheck.classify_family(fam), "text", fam)


class TestWordRule(unittest.TestCase):
    """T10 counts only spans carrying two consecutive letters. This is the
    exclusion that took it from 46 false failures out of 66 fragments down to
    twelve, of which three were real."""

    def test_digits_and_single_variables_are_not_words(self):
        for s in ("3", "0.992", " 2", "431", "k", "x", "-", "="):
            self.assertIsNone(figcheck.WORD_RE.search(s), s)

    def test_ordinary_label_text_is_a_word(self):
        for s in ("substrate", "MACHINE", "no cycle", "id1"):
            self.assertIsNotNone(figcheck.WORD_RE.search(s), s)


# --------------------------------------------------------------------------- #
# T10 end to end
# --------------------------------------------------------------------------- #
class TestT10(unittest.TestCase):
    def build(self, drawing_runs, caption="Figure 1: a caption."):
        """drawing_runs: (text, fontname) pairs placed well above the caption."""
        doc = pymupdf.open()
        page = doc.new_page(width=300, height=300)
        y = 40
        for text, font in drawing_runs:
            page.insert_text((40, y), text, fontname=font, fontsize=9)
            y += 16
        page.insert_text((40, 260), caption, fontname="tiro", fontsize=9)
        return save_temp_pdf(doc)

    def run_on(self, path):
        report = figcheck.run_figcheck(path)
        Path(path).unlink(missing_ok=True)
        return report

    def test_one_face_passes(self):
        report = self.run_on(self.build([("substrate", "helv"), ("coordination", "helv")]))
        self.assertEqual(report["checks"]["T10"]["status"], "pass")

    def test_two_faces_in_the_drawing_fail(self):
        """The stack map's defect: two labels in the body serif, the rest in the
        edition's grotesk, inside one drawing."""
        report = self.run_on(self.build([("substrate", "helv"), ("MACHINE FLOOR", "tiro")]))
        self.assertEqual(report["checks"]["T10"]["status"], "fail")
        msg = report["checks"]["T10"]["findings"][0]["message"]
        self.assertIn("2 typefaces", msg)

    def test_the_minority_face_is_named_first(self):
        """The minority family IS the defect -- it is the handful of glyphs that
        escaped -- so it is listed first, with a sample, and the message is
        readable without opening the PDF. (pymupdf's "tiro" alias embeds as
        Times; the family name in the report is the embedded one, which is what
        a reader would see.)"""
        report = self.run_on(
            self.build([("aaa bbb ccc ddd", "helv"), ("zz", "tiro")])
        )
        families = report["checks"]["T10"]["findings"][0]["families"]
        self.assertEqual(len(families), 2)
        first, second = list(families)
        self.assertLess(families[first], families[second])
        self.assertEqual(first, "Times")

    def test_weight_difference_alone_does_not_fail(self):
        report = self.run_on(self.build([("substrate", "helv"), ("coordination", "hebo")]))
        self.assertEqual(report["checks"]["T10"]["status"], "pass")

    def test_the_caption_does_not_count(self):
        """The caption is page furniture and is legitimately set in the body
        face, which differs from the figure's face in the Swiss and technical
        editions by design."""
        report = self.run_on(
            self.build([("substrate", "helv")], caption="Figure 1: a serif caption.")
        )
        self.assertEqual(report["checks"]["T10"]["status"], "pass")

    def test_t10_is_a_hard_check(self):
        self.assertIn("T10", figcheck.HARD_CHECKS)

    def test_every_check_has_a_markdown_label(self):
        """render_markdown indexes CHECK_LABELS by check id, so a check added to
        ALL_CHECKS without a label raises a KeyError in the report writer AFTER
        the JSON has already been written. figcheck asserts this at import; this
        test says so out loud."""
        self.assertEqual(set(figcheck.CHECK_LABELS), set(figcheck.ALL_CHECKS))


# --------------------------------------------------------------------------- #
# T9
# --------------------------------------------------------------------------- #
class TestParseDash(unittest.TestCase):
    def test_solid_has_no_dash(self):
        for s in ("[] 0", "", None):
            self.assertIsNone(figcheck.parse_dash(s))

    def test_an_all_zero_array_is_solid(self):
        self.assertIsNone(figcheck.parse_dash("[ 0 0 ] 0"))

    def test_on_and_off_are_split(self):
        ons, gaps = figcheck.parse_dash("[ 1.2 2 ] 0")
        self.assertEqual((ons, gaps), ([1.2], [2.0]))

    def test_a_single_element_array_means_on_equals_off(self):
        """The PDF spec's own reading. Taking it as 'on only' would silently
        pass a zero gap."""
        ons, gaps = figcheck.parse_dash("[ 3 ] 0")
        self.assertEqual((ons, gaps), ([3.0], [3.0]))


class TestT9(unittest.TestCase):
    def build(self, dashes, width):
        doc = pymupdf.open()
        page = doc.new_page(width=300, height=300)
        page.draw_line(
            pymupdf.Point(40, 100), pymupdf.Point(260, 100),
            dashes=dashes, width=width, color=(0.5, 0.5, 0.5),
        )
        page.insert_text((40, 260), "Figure 1: a caption.", fontname="helv", fontsize=9)
        return save_temp_pdf(doc)

    def run_on(self, path, **kw):
        report = figcheck.run_figcheck(path, **kw)
        Path(path).unlink(missing_ok=True)
        return report

    def test_the_shipped_guide_geometry_fails(self):
        """on 0.448pt = 0.93 device px at 150 dpi -- under one pixel."""
        report = self.run_on(self.build("[ 0.448 0.996 ] 0", 0.498))
        self.assertEqual(report["checks"]["T9"]["status"], "fail")
        self.assertIn("on-length", report["checks"]["T9"]["findings"][0]["message"])

    def test_the_replacement_geometry_passes(self):
        report = self.run_on(self.build("[ 1.2 2.0 ] 0", 0.7))
        self.assertEqual(report["checks"]["T9"]["status"], "pass")

    def test_a_solid_stroke_is_not_a_dash_finding(self):
        report = self.run_on(self.build("[] 0", 0.4))
        self.assertEqual(report["checks"]["T9"]["status"], "pass")

    def test_a_sub_pixel_stroke_under_a_dash_fails(self):
        report = self.run_on(self.build("[ 1.2 2.0 ] 0", 0.3))
        msg = report["checks"]["T9"]["findings"][0]["message"]
        self.assertIn("stroke", msg)

    def test_the_floor_moves_with_dash_dpi(self):
        """The same dash resolves at 300 dpi and not at 150. The check is about
        a device, so the device is a parameter."""
        # on/gap 0.8pt = 1.67px at 150 dpi (under the 2px floor) and 3.33px at 300.
        path = self.build("[ 0.8 0.8 ] 0", 0.5)
        self.assertEqual(figcheck.run_figcheck(path, dash_dpi=150)["checks"]["T9"]["status"], "fail")
        self.assertEqual(figcheck.run_figcheck(path, dash_dpi=300)["checks"]["T9"]["status"], "pass")
        Path(path).unlink(missing_ok=True)


if __name__ == "__main__":
    unittest.main()
