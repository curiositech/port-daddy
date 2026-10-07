"""Numerical and source contracts; not a substitute for full-page review."""
import math
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[2]
SKETCHES = ROOT / "website-v2/public/whitepaper/figures/pd-margin-sketches.tex"


class MarginSketchTests(unittest.TestCase):
    def test_survival_examples_have_equal_means_and_different_tails(self):
        # Lomax(shape=3, scale=2): E[T]=scale/(shape-1)=1,
        # Var[T]=scale^2*shape/((shape-1)^2*(shape-2))=3.
        self.assertEqual(2 / (3 - 1), 1)
        self.assertEqual(4 * 3 / (4 * 1), 3)
        lomax = lambda t: (1 + t / 2) ** -3
        self.assertEqual(lomax(0), 1)
        self.assertAlmostEqual(lomax(6), 0.015625)
        self.assertGreater(lomax(6), 6 * math.exp(-6))
        source = SKETCHES.read_text()
        self.assertIn("90-90*ln(1+\\x/2)/ln(10)", source)
        self.assertIn("90-30*\\x/ln(10)", source)
        self.assertIn("survival probability (log)", source)
        self.assertIn("duration / mean", source)

    def test_downtime_and_split_arithmetic(self):
        self.assertAlmostEqual(1.5 + 2.667, 4.167)
        self.assertAlmostEqual(1.5 + 2.5 * 2.667, 8.1675)
        self.assertEqual(2 * 50 * .9, 90)

    def test_revised_sketches_have_one_caption_not_extra_headings(self):
        source = SKETCHES.read_text()
        for name in ("wal-exposure-window", "heartbeat-suspicion", "heavy-tail-shape",
                     "no-mint-split", "equivocation-pair", "certificate-lifetime"):
            self.assertIn(r"\pdmarginexhibit{" + name + "}{}{", source)
        layout = (SKETCHES.parent / "pd-margin-layout.tex").read_text()
        self.assertIn(r"\if\relax\detokenize{#2}\relax\else", layout)

    def test_arithmetic_and_temporal_steps_are_drawn(self):
        source = SKETCHES.read_text()
        self.assertIn(r"\draw[pd margin ink,<->]", source)
        self.assertIn("{?}", source)
        self.assertIn(r"\foreach \x in {18,38,63,82}", source)
        self.assertIn(r"\node (left) at (20,-45) {50}", source)
        self.assertIn(r"\node (right) at (72,-45) {50}", source)
        self.assertIn(r"$\div 2$", source)
        self.assertIn(r"$\times 0.9$", source)
        self.assertIn(r"\pdmargincredit{childa}{20,-104}{45}", source)
        self.assertIn(r"\pdmargincredit{childb}{72,-104}{45}", source)

    def test_expiry_categories_use_distinct_colours_and_shapes(self):
        source = SKETCHES.read_text()
        colours = re.findall(r"pd expiry (?:card|epoch|policy)/\.style=\{draw=(\w+)", source)
        self.assertEqual(len(colours), 3)
        self.assertEqual(len(set(colours)), 3)
        expiry = source[source.index(r"\newcommand{\pdlifetimeintersection}"):]
        self.assertIn("circle[radius=", expiry)
        self.assertIn("rectangle", expiry)
        self.assertIn("--cycle", expiry)
        self.assertIn(r"0/83/card,-29/63/epoch,-58/39/policy", expiry)

    def test_native_width_and_unique_exhibits(self):
        source = SKETCHES.read_text()
        ids = re.findall(r"\\pdmarginexhibit\{([^}]+)\}", source)
        self.assertEqual(len(ids), 8)
        self.assertEqual(len(set(ids)), 8)
        self.assertNotRegex(source, r"\\(?:resizebox|scalebox|tiny|scriptsize|fontsize)\b")
        self.assertIn("x=1pt,y=1pt", source)

    def test_one_leviathan_and_three_portrait_anchors(self):
        legible = (ROOT / "whitepaper/legible-swarm.tex").read_text()
        bonded = (ROOT / "website-v2/public/whitepaper/agent-transactions-whitepaper.tex").read_text()
        self.assertEqual(legible.count(r"\pdmarginfigure{leviathan}"), 1)
        self.assertEqual(legible.count(r"\pdmarginfigure{hobbes}"), 1)
        for person in ("sen", "hickman"):
            self.assertEqual(bonded.count("\\pdmarginfigure{" + person + "}"), 1)

    def test_delegation_summary_keeps_direct_issuance_alternative(self):
        anchor = (ROOT / "website-v2/public/whitepaper/anchor-protocol-whitepaper.tex").read_text()
        table = anchor[anchor.index(r"\label{tab:proverif-results}"):]
        table = table[:table.index(r"\end{table}")]
        self.assertIn(r"\text{IssuedRoot}(a)", table)
        self.assertIn(r"\text{Delegated}(a,b)", table)
        self.assertIn(r"\lor\ \text{IssuedRoot}(b)", table)
        self.assertIn(r"\textbf{FALSE}", table)


if __name__ == "__main__":
    unittest.main()
