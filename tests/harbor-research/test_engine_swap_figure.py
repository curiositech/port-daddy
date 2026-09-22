"""Source-owned payoff geometry, not a market experiment or participation proof."""
from fractions import Fraction as F
import os
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]
FIGURE = ROOT / "website-v2/public/whitepaper/figures/fig-stp-engine-swap-regime.tex"


class EngineSwapFigureTests(unittest.TestCase):
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
        # 6 cm per gain unit; 7 cm per horizontal price unit.
        self.assertIn("(0.7,1.8) -- (4.9,1.8)", source)
        self.assertIn("(6.45,1.8) -- (10.65,-1.8)", source)
        self.assertEqual(F("1.8") / 6, F(3, 10))
        self.assertEqual((F("10.65") - F("6.45")) / 7, F(3, 5))
        self.assertEqual(F("-1.8") / 6, -F(3, 10))
        self.assertIn("at (-.09,{6*\\gain})", source)
        self.assertIn("{common price $p$}", source)
        self.assertIn("{price gap $p_H-p_L$}", source)

    def test_participation_not_mistaken_for_price_axis(self):
        self.assertEqual((F(1, 2) - F(2, 5)) / (1 - F(2, 5)), F(1, 6))
        source = FIGURE.read_text()
        self.assertNotIn("committed share", source)
        self.assertIn("does not\nguarantee the price gap", source)
        self.assertIn("no audited bond", source)
        self.assertIn("Analytic example", source)

    def test_native_width_gate_and_stable_identity(self):
        source = FIGURE.read_text()
        self.assertIn(r"\SGMeasuredFigure{stp-engine-swap-regime}", source)
        self.assertIn(r"\label{fig:stp-engine-swap-regime}", source)
        for forbidden in (r"\resizebox", r"\scalebox", r"\tiny", r"\scriptsize"):
            self.assertNotIn(forbidden, source)

    @unittest.skipUnless(os.environ.get("BOOK_PAYLOAD_PDF"), "assembled Book not supplied")
    def test_final_page_has_both_price_axes_and_conditional_caption(self):
        import fitz
        with fitz.open(os.environ["BOOK_PAYLOAD_PDF"]) as book:
            pages = [p for p in book if "Swap gain" in p.get_text()
                     and "no audited bond" in p.get_text()]
            self.assertEqual(len(pages), 1)
            text = " ".join(pages[0].get_text().split())
            for expected in ("Unattested", "Attested", "common price", "price gap",
                             "indifferent", "Full pass", "guarantee the price gap"):
                self.assertIn(expected, text)


if __name__ == "__main__":
    unittest.main()
