"""Editorial and arithmetic guards for the Book's evidence column.

These checks do not replace looking at the rendered pages.
"""
import json
import re
import unittest
from fractions import Fraction
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WEB = ROOT / "website-v2/public/whitepaper"
SOURCES = [
    ROOT / "whitepaper/single-writer-kernel.tex",
    WEB / "anchor-protocol-whitepaper.tex", WEB / "sealed-harbor.tex",
    ROOT / "whitepaper/legible-swarm.tex", WEB / "spawn-to-person.tex",
    WEB / "harbor-economy.tex", WEB / "agent-transactions-whitepaper.tex",
    WEB / "federated-harbor-whitepaper.tex",
]


def cue_problems(text):
    problems = []
    for match in re.finditer(r"^\\(?:keyidea|pitfall)(?:\[([^\]]*)\])?\{", text, re.M):
        head = match[1]
        if not head or head.lower().rstrip(".") in ("pitfall", "key idea", "the main point"):
            problems.append(match[0])
    return problems


class BookEvidenceEditorial(unittest.TestCase):
    def test_market_status_caption_describes_the_market_table(self):
        source = (WEB / 'harbor-economy.tex').read_text()
        captions = re.findall(r'\\caption\{([^{}]*)\}\\label\{tab:honest-state\}', source)
        self.assertEqual(len(captions), 1)
        self.assertIn('ledger', captions[0])
        self.assertIn('reputation', captions[0])
        self.assertNotIn('L: legibility', captions[0])

    def test_dependency_spine_is_captioned_and_not_scaled(self):
        figure = (WEB / 'figures/fig-stp-dependency-spine.tex').read_text()
        self.assertIn(r'\caption{', figure)
        self.assertIn(r'\label{fig:stp-dependency-spine}', figure)
        for forbidden in (r'\resizebox', r'\tiny', r'\scriptsize'):
            self.assertNotIn(forbidden, figure)
        source = (WEB / 'spawn-to-person.tex').read_text()
        self.assertIn(r'\input{figures/fig-stp-dependency-spine}', source)
        self.assertNotIn('unfinished bridge: persistence', source)

    def test_sanction_example_distinguishes_loss_from_newcomer_gap(self):
        score, sanction, newcomer = 90, 30, 50
        retained = max(score - sanction, newcomer)
        self.assertEqual(score - retained, 30)
        self.assertEqual(retained - newcomer, 10)
        source = (WEB / 'spawn-to-person.tex').read_text()
        self.assertIn(r'he loses $30$ by staying', source)

    def test_cue_guard_rejects_generic_and_missing_heads(self):
        for value in (r"\pitfall{Text}", r"\keyidea[The main point]{Text}",
                      r"\pitfall[Pitfall]{Text}"):
            self.assertTrue(cue_problems(value))
        self.assertFalse(cue_problems(r"\pitfall[Power loss can erase commits]{Text}"))

    def test_authored_cues_name_the_claim(self):
        for path in SOURCES:
            self.assertEqual(cue_problems(path.read_text()), [], str(path))

    def test_shared_macro_and_figure_primitives_are_identical(self):
        for name in ("pd-pedagogy.tex", "pd-figure-language.tex"):
            self.assertEqual((ROOT / "whitepaper/figures" / name).read_bytes(),
                             (WEB / "figures" / name).read_bytes())

    def test_legacy_cue_fallback_does_not_print_generic_label(self):
        source = (WEB / "figures/pd-pedagogy.tex").read_text()
        override = source[source.index(r"\RenewDocumentCommand\keyidea"):]
        self.assertIn(r"\ifstrempty{#1}{}{\pd@marginhead{#1}}", override)
        self.assertNotIn(r"\pd@marginhead{Pitfall}", override)
        self.assertNotIn(r"\pd@marginhead{Key idea}", override)

    def test_illustration_captions_do_not_append_production_labels(self):
        source = (WEB / "figures/pd-margin-evidence.tex").read_text()
        self.assertNotIn("Generated analogy", source)
        self.assertIn("}{#4}}", source)

    def test_press_analogy_has_one_caption_and_no_repeated_heading(self):
        source = SOURCES[0].read_text()
        match = re.search(
            r"\\pdmarginanalogy\{swk-one-printing-press\}\{([^}]*)\}"
            r"\{one-printing-press\}\{([^}]*)\}", source)
        self.assertIsNotNone(match)
        self.assertEqual(match[1], '')
        self.assertIn('single-writer daemon', match[2])
        self.assertNotIn('The analogy concerns', match[2])
        self.assertLessEqual(len(match[2].split()), 16)

    def test_reader_evidence_policies_do_not_require_private_adrs(self):
        corpus = json.loads((ROOT / "whitepaper/corpus.json").read_text())
        def check(value):
            if isinstance(value, dict):
                if "evidencePolicy" in value:
                    self.assertNotRegex(value["evidencePolicy"], r"(?i)\bADR[-\s]?\d|docs/adr/")
                for child in value.values():
                    check(child)
            elif isinstance(value, list):
                for child in value:
                    check(child)
        check(corpus)

    def test_rejected_art_is_not_placed(self):
        source = "\n".join(p.read_text() for p in SOURCES)
        for rejected in ("rope-splice", "canal-lock"):
            self.assertNotIn("{" + rejected + "}", source)
        placed = re.findall(r"\\pdmarginanalogy\{[^}]+\}\{[^}]*\}\{([^}]+)\}", source)
        self.assertEqual(set(placed), {"one-printing-press", "reduced-key",
                                     "sealed-specimen", "map-and-lens",
                                     "bond-balance",
                                     "ch01-fairness-ticket-dispenser",
                                     "ch05-continuity-rope-splice",
                                     "ch05-episodic-card-file",
                                     "ch06-reusable-printing-block",
                                     "ch07-cleanup-repair-kit",
                                     "ch08-local-admission-turnstile"})
        # Replace the displayed analogy, not the historical source assets.
        self.assertTrue((WEB / 'plates/marginalia/movable-type-photo.jpg').is_file())
        self.assertTrue((WEB / 'plates/marginalia/movable-type-photo.json').is_file())
        for slug in placed:
            self.assertTrue((WEB / "plates/margin-evidence" / (slug + ".png")).is_file())
            self.assertTrue((WEB / "plates/margin-evidence" / (slug + ".json")).is_file())

    def test_strict_one_percent_target_needs_six_reviewers(self):
        miss = Fraction(2, 5)
        self.assertGreater(miss**5, Fraction(1, 100))
        self.assertLess(miss**6, Fraction(1, 100))
        plot = (WEB / "figures/fig-he-assurance.tex").read_text()
        # The native two-panel redraw evaluates the same analytical model
        # directly in PGFPlots; do not require its retired drawing macro.
        self.assertIn("{100*(1-.6)^x}", plot)
        self.assertIn("domain=1:6,samples=6", plot)
        self.assertIn("{40}", plot)  # perfectly shared errors do not decay
        self.assertIn("{x}", plot)   # normalized budget is linear in k
        self.assertIn("One budget unit: bounty $b$ + bond carry $c_B$", plot)

    def test_four_period_capacity_is_not_infinite_capacity(self):
        finite = sum(Fraction(9, 2**t) for t in range(4))
        self.assertEqual(finite, Fraction(135, 8))
        self.assertLess(finite, 17)
        self.assertGreater(Fraction(9) / (1 - Fraction(1, 2)), 17)


if __name__ == "__main__":
    unittest.main()
