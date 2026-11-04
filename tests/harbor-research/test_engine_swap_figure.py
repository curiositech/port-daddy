"""Source-owned payoff geometry, not a market experiment or participation proof."""
from fractions import Fraction as F
import os
from pathlib import Path
import re
import unicodedata
import unittest

ROOT = Path(__file__).resolve().parents[2]
FIGURE = ROOT / "book/figures/fig-stp-engine-swap-regime.tex"
NUMBER = r"[-+]?(?:\d+(?:\.\d*)?|\.\d+)"
POINT = rf"\(\s*({NUMBER})\s*,\s*({NUMBER})\s*\)"


def normalized_text(text):
    """Ignore source wrapping and PDF's typographic hyphens/minus signs."""
    text = unicodedata.normalize("NFKC", text)
    text = text.translate(str.maketrans({char: "-" for char in "‐‑‒–−"}))
    return " ".join(text.split())


def economic_geometry(source):
    """Read this native figure's marks in economic units, not page coordinates.

    Both panels use the same foreach-generated tick scales. Deriving their
    origins/scales keeps a translated or proportionally rescaled drawing from
    changing the contract, while a misplaced line or marker still fails it.
    This intentionally understands the figure's small TikZ vocabulary only.
    """
    source = re.sub(r"(?m)%.*$", "", source)
    origins = {name: F(value) for value, name in
               re.findall(rf"({NUMBER})/(Unattested|Attested)", source)}
    assert set(origins) == {"Unattested", "Attested"}, "Both price panels required"
    gain_scales = {F(value) for value in
                   re.findall(rf"\{{({NUMBER})\*\\v\}}", source)}
    price_scales = {F(value) for value in
                    re.findall(rf"\{{\\x\+({NUMBER})\*\\v\}}", source)}
    assert len(gain_scales) == len(price_scales) == 1, "One shared scale per axis"
    gain_scale, price_scale = gain_scales.pop(), price_scales.pop()
    assert gain_scale > 0 and price_scale > 0, "Increasing axes required"

    def units(name, x, y):
        return (F(x) - origins[name]) / price_scale, F(y) / gain_scale

    result = {}
    for name, role in (("Unattested", "pd breach rule"), ("Attested", "pd ready rule")):
        lines = re.findall(rf"\\draw\[{role}\]\s*{POINT}\s*--\s*{POINT}\s*;", source)
        assert len(lines) == 1, f"One analytic line required for {name}"
        x0, y0, x1, y1 = lines[0]
        result[name] = (units(name, x0, y0), units(name, x1, y1))
    markers = re.findall(rf"\\node\[pd ready datum\]\s+at\s*{POINT}\s*\{{\}};", source)
    result["markers"] = tuple(units("Attested", x, y) for x, y in markers)
    return result


class EngineSwapFigureTests(unittest.TestCase):
    def assert_economic_geometry(self, source):
        geometry = economic_geometry(source)
        self.assertEqual(geometry["Unattested"], ((F(0), F(".3")), (F(".6"), F(".3"))))
        self.assertEqual(geometry["Attested"], ((F(0), F(".3")), (F(".6"), F("-.3"))))
        self.assertEqual(geometry["markers"], ((F(".3"), F(0)), (F(".6"), F("-.3"))))

    def test_common_price_cancels_exactly(self):
        high, low = F(1, 2), F(1, 5)
        for price in (F(0), F(1, 10), F(3, 10), F(3, 5), F(2)):
            self.assertEqual((price - low) - (price - high), F(3, 10))

    def test_gap_not_attestation_alone_controls_sign(self):
        for low_price in (F(0), F(1, 5), F(1)):
            for gap in (F(0), F(1, 10), F(3, 10), F(1, 2), F(3, 5)):
                high_price = low_price + gap
                gain = (low_price - F(1, 5)) - (high_price - F(1, 2))
                self.assertEqual(gain, F(3, 10) - gap)
                self.assertEqual(gain > 0, gap < F(3, 10))
        self.assertEqual(F(3, 10) - F(3, 10), 0)
        self.assertEqual(F(3, 10) - F(3, 5), -F(3, 10))

    def test_source_endpoints_follow_declared_shared_scale(self):
        source = FIGURE.read_text()
        self.assert_economic_geometry(source)
        self.assertIn(r"{common price $p$}", source)
        self.assertIn(r"{attested price gap $p_H-p_L$}", source)
        for parameter in (r"\theta_H=1", r"\theta_L=0.4", r"c_H=0.5", r"c_L=0.2"):
            self.assertIn(parameter, source)

    def test_geometry_contract_rejects_wrong_scale_gain_and_threshold(self):
        source = FIGURE.read_text()
        wrong_scale = re.sub(
            rf"\{{({NUMBER})\*\\v\}}",
            lambda match: "{" + f"{float(F(match[1]) * 2):g}" + r"*\v}", source)
        wrong_gain = re.sub(
            rf"(\\draw\[pd ready rule\]\s*{POINT}\s*--\s*){POINT}",
            lambda match: match[1] + f"({match[4]},{float(-F(match[5])):g})", source)
        wrong_threshold = re.sub(
            rf"(\\node\[pd ready datum\]\s+at\s*){POINT}",
            lambda match: match[1] + f"({float(F(match[2]) + F('.3')):g},{match[3]})",
            source, count=1)
        mutations = (wrong_scale, wrong_gain, wrong_threshold)
        for mutation in mutations:
            self.assertNotEqual(source, mutation)
            with self.assertRaises(AssertionError):
                self.assert_economic_geometry(mutation)

    def test_translating_panels_does_not_change_economic_units(self):
        source = FIGURE.read_text()
        translated = re.sub(POINT, lambda match:
                            f"({float(F(match[1]) + 1):g},{match[2]})", source)
        translated = re.sub(rf"({NUMBER})/(Unattested|Attested)", lambda match:
                            f"{float(F(match[1]) + 1):g}/{match[2]}", translated)
        self.assertNotEqual(source, translated)
        self.assert_economic_geometry(translated)

    def test_participation_not_mistaken_for_price_axis(self):
        self.assertEqual((F(1, 2) - F(2, 5)) / (1 - F(2, 5)), F(1, 6))
        source = normalized_text(FIGURE.read_text())
        self.assertNotIn("committed share", source)
        self.assertIn("makes that pricing possible; it does not require it", source)
        self.assertIn("only when their gap covers", source)
        self.assertIn(r"gap of $0.6$ and gain $-0.3$", source)
        self.assertIn("no audited bond or future reputation payoff", source)
        self.assertIn("Analytic example", source)

    def test_native_shared_roles_and_stable_identity(self):
        source = FIGURE.read_text()
        self.assertIn(r"\begin{tikzpicture}[pd figure,x=1cm,y=1cm]", source)
        self.assertIn(r"\label{fig:stp-engine-swap-regime}", source)
        for forbidden in (r"\resizebox", r"\scalebox", r"\tiny", r"\scriptsize"):
            self.assertNotIn(forbidden, source)

    @unittest.skipUnless(os.environ.get("BOOK_PAYLOAD_PDF"), "assembled Book not supplied")
    def test_final_page_has_both_price_axes_and_conditional_caption(self):
        import fitz
        with fitz.open(os.environ["BOOK_PAYLOAD_PDF"]) as book:
            pages = [normalized_text(page.get_text()) for page in book]
            pages = [text for text in pages if "Substitution gain" in text
                     and "no audited bond" in text]
            self.assertEqual(len(pages), 1)
            for expected in ("Unattested", "Attested", "common price", "attested price gap",
                             "indifferent", "Full pass-through", "gain -0.3",
                             "it does not require it", "only when their gap covers"):
                self.assertIn(expected, pages[0])


if __name__ == "__main__":
    unittest.main()
