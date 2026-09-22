"""Checks for the six bare-passage conversions; not whole-book approval."""
from fractions import Fraction as Q
from math import comb, factorial, log2
from pathlib import Path
import os
import re
import unittest

ROOT = Path(__file__).resolve().parents[2]
LS = ROOT / "whitepaper/legible-swarm.tex"
STP = ROOT / "website-v2/public/whitepaper/spawn-to-person.tex"
TARGETS = {
    LS: {"ex:queue-boundary": "Sole Ownership at the Queue Boundary",
         "ex:digest-review-budget": "Digest Bits and File Opens"},
    STP: {"ex:newcomer-floor": "Sanctions at the Newcomer Floor",
          "ex:maturation-cost": "The Cost of Starting Over",
          "ex:binding-probation": "Probation under a Binding Cap",
          "ex:audit-depth": "Diversity and Audit Depth"},
}


def examples(source):
    return re.findall(r"\\begin\{pdexample\}\{([^}]+)\}(.*?)\\end\{pdexample\}",
                      source, re.S)


class WorkedExampleChecks(unittest.TestCase):
    @unittest.skipUnless(os.environ.get("BOOK_WORKED_PDF"), "assembled Book PDF not supplied")
    def test_six_actual_headings_are_bold_and_correctly_numbered(self):
        import fitz
        path = Path(os.environ["BOOK_WORKED_PDF"])
        aux = path.with_suffix(".aux").read_text()
        expected = {
            "ls:ex:queue-boundary": ("4.4.2", "Sole Ownership at the Queue Boundary"),
            "ls:ex:digest-review-budget": ("4.6.3", "Digest Bits and File Opens"),
            "stp:ex:newcomer-floor": ("5.6.2", "Sanctions at the Newcomer Floor"),
            "stp:ex:maturation-cost": ("5.6.4", "The Cost of Starting Over"),
            "stp:ex:binding-probation": ("5.6.6", "Probation under a Binding Cap"),
            "stp:ex:audit-depth": ("5.11.2", "Diversity and Audit Depth"),
        }
        with fitz.open(path) as document:
            for label, (number,title) in expected.items():
                match = re.search(r"\\newlabel\{"+re.escape(label)+r"\}\{\{([^}]*)\}\{([^}]*)\}", aux)
                self.assertIsNotNone(match, label)
                self.assertEqual(match[1], number)
                pages = document.get_page_numbers(match[2])
                self.assertEqual(len(pages), 1, label)
                bold = " ".join(span["text"] for block in document[pages[0]].get_text("dict")["blocks"]
                                for line in block.get("lines",[]) for span in line["spans"]
                                if "Semibold" in span["font"] or "Bold" in span["font"])
                bold = " ".join(bold.replace("\u2011", "-").split())
                self.assertIn(f"Numbers by Hand {number} ({title}).", bold)
                if label == "stp:ex:binding-probation":
                    page_text = " ".join(document[pages[0]].get_text().split())
                    # Recognize either the old or tightened ending: the old
                    # witness must fail for placement, not merely new wording.
                    self.assertTrue(any(ending in page_text for ending in (
                        "probation alone is insufficient.",
                        "you need a bond instead.)")),
                        "binding-cap answer is stranded on a later page")

    def test_six_labeled_blocks_and_no_nested_floats(self):
        self.assertRegex(STP.read_text(),
                         r"\\Needspace\{28\\baselineskip\}\s+\\begin\{pdexample\}\{Probation under a Binding Cap\}")
        for path, expected in TARGETS.items():
            source = path.read_text()
            self.assertNotRegex(source, r"\\(?:paragraph|textbf)\{Numbers by hand\.\}")
            for label, title in expected.items():
                matches = [body for head, body in examples(source)
                           if head == title and r"\label{" + label + "}" in body]
                self.assertEqual(len(matches), 1, label)
                self.assertNotRegex(matches[0], r"\\begin\{(?:table|figure)\*?\}")
                self.assertIn(r"\emph{Now you try:}", matches[0])

    def test_independent_tables_remain_after_their_examples(self):
        source = STP.read_text()
        for example, table in (("ex:newcomer-floor", "tab:necessity-numbers"),
                               ("ex:maturation-cost", "tab:whitewash-numbers")):
            start = source.index(r"\label{" + example + "}")
            end = source.index(r"\end{pdexample}", start)
            next_table = source.index(r"\begin{table}[H]", end)
            table_end = source.index(r"\end{table}", next_table)
            self.assertIn(r"\label{" + table + "}", source[next_table:table_end])
            self.assertEqual(source.count(r"\label{" + table + "}"), 1)
        self.assertNotIn("Does the sanction bite?", source)

    def test_queue_and_counting_arithmetic(self):
        c, offered = 3, Q(5, 3)
        rho = offered / c
        tail = offered**c / (factorial(c) * (1-rho))
        erlang_c = tail / (sum(offered**j / factorial(j) for j in range(c)) + tail)
        wait = (1 + erlang_c / (c*(1-rho))) / Q(6, 5)
        self.assertEqual(erlang_c, Q(125, 417))
        self.assertEqual(wait, Q(1135, 1112))
        self.assertAlmostEqual(float((wait-1)*3600), 74.46043165, places=6)
        self.assertAlmostEqual(log2(comb(1000, 3)/comb(10, 3)), 20.401168, places=6)
        self.assertAlmostEqual(log2(comb(1000, 3)/comb(100, 3)), 10.005099, places=6)
        source = LS.read_text()
        self.assertIn("not measured roadmap performance", source)
        self.assertNotIn("met in the wild", source)

    def test_reset_and_probation_arithmetic(self):
        self.assertEqual([max(r-30, 50) for r in (50, 90)], [50, 60])
        self.assertEqual(sum(Q(9)-Q(18, 10)*t for t in range(1, 6)), 18)
        self.assertEqual(sum(Q(9)-Q(9, 10)*t for t in range(1, 11)), Q(81, 2))
        self.assertAlmostEqual(float(20*(Q(95,100)/Q(60,100))**5), 199.017731, places=6)
        schedule = [Q(12), Q(12), Q(20,9)]
        self.assertEqual(sum(Q(3,5)**t*g for t,g in enumerate(schedule)), 20)
        honest = sum(Q(19,20)**t*g for t,g in enumerate(schedule))
        self.assertEqual(honest, Q(4573,180))
        self.assertEqual(round(float(honest),2), 25.41)
        for horizon in range(41):
            self.assertLess(8*sum(Q(3,5)**t for t in range(horizon+1)), 20)
        self.assertEqual(8/(1-Q(3,5)), 20)
        self.assertLess(7/(1-Q(3,5)), 20)

    def test_audit_depth_uses_the_stated_two_regimes(self):
        # Exact rationals prevent a floating-point near-one decision.
        for cliques, expected_linear, expected_total in ((8,0,27),(2,15,36),(1,35,53)):
            value, levels, linear = Q(400), 0, 0
            while value >= 1:
                if value > cliques*50:
                    value -= cliques*10
                    linear += 1
                else:
                    value *= Q(4,5)
                levels += 1
            self.assertEqual((linear,levels), (expected_linear,expected_total))
            self.assertEqual(levels*50, {8:1350,2:1800,1:2650}[cliques])

    def test_sparkline_uses_all_three_exact_domains(self):
        source = (ROOT / "website-v2/public/whitepaper/figures/spark-stp-audit-depth.tex").read_text()
        for signature in ("8/0/27", "2/15/36", "1/35/53"):
            self.assertIn(signature, source)
        self.assertIn("domain=0:\\L,samples=\\L+1", source)
        self.assertIn("domain=\\L:\\N,samples=\\N-\\L+1", source)
        self.assertIn("log scale", source)
        self.assertIn("400-10*\\C*\\x", source)
        self.assertIn("50*\\C*pow(.8,\\x-\\L)", source)
        self.assertIn("not measured audit performance", STP.read_text())


if __name__ == "__main__":
    unittest.main()
