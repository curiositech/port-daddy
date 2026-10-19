"""Unit tests for tikz_precheck.py's P10-P14 rules (added alongside the
original unnumbered checks). Follows the same fixture-file-per-case pattern
as skills/harbor-chartwork/tests/test_tikz_precheck.py -- one positive and
one negative case per new rule, at minimum."""
import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT_PATH = Path(__file__).resolve().parent.parent / "scripts" / "tikz_precheck.py"
spec = importlib.util.spec_from_file_location("tikz_precheck", SCRIPT_PATH)
tikz_precheck = importlib.util.module_from_spec(spec)
sys.modules["tikz_precheck"] = tikz_precheck
spec.loader.exec_module(tikz_precheck)


def write_fixture(text, suffix=".tex"):
    tmp = tempfile.NamedTemporaryFile(mode="w", suffix=suffix, delete=False, encoding="utf-8")
    tmp.write(text)
    tmp.close()
    return tmp.name


class NewRuleTestCase(unittest.TestCase):
    def run_on(self, text, corpus="chapter", **kwargs):
        path = write_fixture(text)
        self.addCleanup(lambda: Path(path).unlink(missing_ok=True))
        return tikz_precheck.run_precheck(path, corpus=corpus, **kwargs)

    def findings_for(self, report, check):
        return [f for f in report["findings"] if f["check"] == check]


class TestStripComments(unittest.TestCase):
    def test_comment_blanked_but_offsets_preserved(self):
        text = "abc % a comment\ndef"
        stripped = tikz_precheck.strip_comments(text)
        self.assertEqual(len(stripped), len(text))
        self.assertNotIn("comment", stripped)
        self.assertTrue(stripped.startswith("abc "))
        self.assertTrue(stripped.endswith("def"))

    def test_escaped_percent_is_not_a_comment(self):
        text = "100\\% done \\tiny-ish"
        stripped = tikz_precheck.strip_comments(text)
        # the literal \% must survive -- nothing after it is blanked
        self.assertIn("\\%", stripped)
        self.assertIn("\\tiny", stripped)


class TestP10Tiny(NewRuleTestCase):
    def test_tiny_in_source_fails_with_id(self):
        report = self.run_on(
            "% source\n\\begin{tikzpicture}\n\\node at (0,0) {\\tiny hi};\n\\end{tikzpicture}\n"
        )
        findings = self.findings_for(report, "tiny")
        self.assertTrue(findings)
        self.assertEqual(findings[0]["id"], "P10")
        self.assertEqual(findings[0]["severity"], "fail")
        self.assertEqual(report["summary"]["by_id"]["P10"], 1)

    def test_tiny_only_in_comment_is_not_flagged(self):
        report = self.run_on(
            "% source\n\\begin{tikzpicture}\n% do not use \\tiny here\n"
            "\\node at (0,0) {hi};\n\\end{tikzpicture}\n"
        )
        self.assertFalse(self.findings_for(report, "tiny"))
        self.assertEqual(report["summary"]["by_id"]["P10"], 0)


class TestP11Scriptsize(NewRuleTestCase):
    def test_scriptsize_fails(self):
        report = self.run_on(
            "% source\n\\begin{tikzpicture}\n\\node at (0,0) {\\scriptsize hi};\n"
            "\\end{tikzpicture}\n"
        )
        findings = self.findings_for(report, "scriptsize")
        self.assertTrue(findings)
        self.assertEqual(findings[0]["id"], "P11")
        self.assertEqual(findings[0]["severity"], "fail")
        self.assertEqual(report["summary"]["result"], "fail")

    def test_no_scriptsize_clean(self):
        report = self.run_on(
            "% source\n\\begin{tikzpicture}\n\\node at (0,0) {hi};\n\\end{tikzpicture}\n"
        )
        self.assertFalse(self.findings_for(report, "scriptsize"))


class TestP12Resizebox(NewRuleTestCase):
    def test_small_fraction_warns(self):
        report = self.run_on(
            "% source\n\\begin{figure}\n\\resizebox{0.5\\textwidth}{!}{\\begin{tikzpicture}"
            "\\end{tikzpicture}}\n\\end{figure}\n"
        )
        findings = self.findings_for(report, "resizebox")
        self.assertTrue(findings)
        self.assertEqual(findings[0]["id"], "P12")
        self.assertEqual(findings[0]["severity"], "warn")
        self.assertEqual(report["summary"]["result"], "warn")
        self.assertEqual(report["summary"]["by_id"]["P12"], 1)

    def test_non_fraction_argument_warns(self):
        report = self.run_on(
            "% source\n\\begin{figure}\n\\resizebox{8cm}{!}{\\begin{tikzpicture}"
            "\\end{tikzpicture}}\n\\end{figure}\n"
        )
        findings = self.findings_for(report, "resizebox")
        self.assertTrue(findings)
        self.assertEqual(findings[0]["severity"], "warn")

    def test_healthy_fraction_does_not_warn(self):
        report = self.run_on(
            "% source\n\\begin{figure}\n\\resizebox{0.9\\textwidth}{!}{\\begin{tikzpicture}"
            "\\end{tikzpicture}}\n\\end{figure}\n"
        )
        self.assertFalse(self.findings_for(report, "resizebox"))
        self.assertEqual(report["summary"]["by_id"]["P12"], 0)


class TestP13BareFill(NewRuleTestCase):
    def test_low_alpha_fill_with_no_draw_fails(self):
        report = self.run_on(
            "% source\n\\begin{tikzpicture}\n\\fill[hhteal!15] (0,0) rectangle (1,1);\n"
            "\\end{tikzpicture}\n"
        )
        findings = self.findings_for(report, "bare-fill")
        self.assertTrue(findings)
        self.assertEqual(findings[0]["id"], "P13")
        self.assertEqual(findings[0]["severity"], "fail")
        self.assertEqual(report["summary"]["result"], "fail")

    def test_low_alpha_fill_with_draw_is_exempt(self):
        report = self.run_on(
            "% source\n\\begin{tikzpicture}\n"
            "\\fill[hhteal!15, draw=hhink] (0,0) rectangle (1,1);\n\\end{tikzpicture}\n"
        )
        self.assertFalse(self.findings_for(report, "bare-fill"))

    def test_house_fill_style_reference_is_exempt(self):
        report = self.run_on(
            "% source\n\\begin{tikzpicture}\n"
            "\\fill[pd focus fill!15] (0,0) rectangle (1,1);\n\\end{tikzpicture}\n"
        )
        self.assertFalse(self.findings_for(report, "bare-fill"))

    def test_path_fill_key_low_alpha_fails(self):
        report = self.run_on(
            "% source\n\\begin{tikzpicture}\n"
            "\\path[fill=hhamber!5] (0,0) circle (1);\n\\end{tikzpicture}\n"
        )
        findings = self.findings_for(report, "bare-fill")
        self.assertTrue(findings)

    def test_path_without_fill_is_not_considered(self):
        report = self.run_on(
            "% source\n\\begin{tikzpicture}\n"
            "\\path[draw=hhink!15] (0,0) circle (1);\n\\end{tikzpicture}\n"
        )
        self.assertFalse(self.findings_for(report, "bare-fill"))

    def test_high_alpha_fill_is_fine(self):
        report = self.run_on(
            "% source\n\\begin{tikzpicture}\n\\fill[hhteal!80] (0,0) rectangle (1,1);\n"
            "\\end{tikzpicture}\n"
        )
        self.assertFalse(self.findings_for(report, "bare-fill"))


class TestP14RowLabels(NewRuleTestCase):
    def test_bare_word_east_anchor_scriptsize_warns(self):
        report = self.run_on(
            "% source\n\\begin{tikzpicture}\n"
            "\\node[anchor=east, font=\\scriptsize] at (0,0) {Assets};\n\\end{tikzpicture}\n"
        )
        findings = self.findings_for(report, "row-labels")
        self.assertTrue(findings)
        self.assertEqual(findings[0]["id"], "P14")
        self.assertEqual(findings[0]["severity"], "warn")
        # the row-labels rule itself is warn-only; note that a real
        # `font=\scriptsize` also trips P11 separately (that command is
        # banned outright in a fragment), so the *overall* result here is
        # "fail" -- this test only asserts P14's own contribution.
        self.assertEqual(report["summary"]["by_id"]["P14"], 1)

    def test_bare_word_east_anchor_tiny_warns(self):
        report = self.run_on(
            "% source\n\\begin{tikzpicture}\n"
            "\\node[anchor=east, font=\\tiny] at (0,0) {Liabilities};\n\\end{tikzpicture}\n"
        )
        self.assertTrue(self.findings_for(report, "row-labels"))
        self.assertEqual(report["summary"]["by_id"]["P14"], 1)

    def test_multiword_text_is_not_flagged(self):
        report = self.run_on(
            "% source\n\\begin{tikzpicture}\n"
            "\\node[anchor=east, font=\\scriptsize] at (0,0) {Total Assets};\n"
            "\\end{tikzpicture}\n"
        )
        self.assertFalse(self.findings_for(report, "row-labels"))

    def test_non_east_anchor_is_not_flagged(self):
        report = self.run_on(
            "% source\n\\begin{tikzpicture}\n"
            "\\node[anchor=west, font=\\scriptsize] at (0,0) {Assets};\n\\end{tikzpicture}\n"
        )
        self.assertFalse(self.findings_for(report, "row-labels"))

    def test_normal_size_east_anchor_is_not_flagged(self):
        report = self.run_on(
            "% source\n\\begin{tikzpicture}\n"
            "\\node[anchor=east] at (0,0) {Assets};\n\\end{tikzpicture}\n"
        )
        self.assertFalse(self.findings_for(report, "row-labels"))


if __name__ == "__main__":
    unittest.main()


# --------------------------------------------------------------------------- #
# P15-P17: caption/drawing integrity and identifier consistency.
#
# Every rule below gets a failing fixture and a passing one. The passing
# fixture is the point: a check that only ever fires is a check nobody can
# ship behind.
# --------------------------------------------------------------------------- #

_DOTTED_PROMISE = (
    "%% source\n"
    "\\begin{figure}\n\\begin{tikzpicture}\n"
    "  \\draw[%s] (0,0) -- (0,-3);\n"
    "\\end{tikzpicture}\n"
    "\\caption{The issuer drops out, which is why its lifeline is dotted "
    "from that point down.}\n"
    "\\end{figure}\n"
)


class TestP15CaptionPromise(NewRuleTestCase):
    def test_promise_with_no_directive_fails(self):
        report = self.run_on(_DOTTED_PROMISE % "pd hairline")
        findings = self.findings_for(report, "caption-promise")
        self.assertTrue(findings, "a caption promising 'dotted' over a solid drawing must fail")
        self.assertEqual(findings[0]["id"], "P15")
        self.assertEqual(findings[0]["severity"], "fail")
        self.assertIn("dotted", findings[0]["message"])

    def test_promise_backed_by_a_directive_passes(self):
        report = self.run_on(_DOTTED_PROMISE % "densely dotted")
        self.assertEqual(self.findings_for(report, "caption-promise"), [])

    def test_promise_backed_by_a_house_style_passes(self):
        # `pd guide` IS the house dotted style; naming it satisfies the promise.
        report = self.run_on(_DOTTED_PROMISE % "pd guide")
        self.assertEqual(self.findings_for(report, "caption-promise"), [])

    def test_negated_styling_word_is_not_a_promise(self):
        report = self.run_on(
            "% source\n\\begin{figure}\n\\begin{tikzpicture}\n"
            "  \\draw[pd neutral fill] (0,0) rectangle (2,2);\n"
            "\\end{tikzpicture}\n"
            "\\caption{The two regions are filled and edged, not hatched.}\n"
            "\\end{figure}\n"
        )
        self.assertEqual(self.findings_for(report, "caption-promise"), [])

    def test_a_caption_saying_nothing_about_style_is_never_checked(self):
        report = self.run_on(
            "% source\n\\begin{figure}\n\\begin{tikzpicture}\n"
            "  \\draw[pd hairline] (0,0) -- (0,-3);\n"
            "\\end{tikzpicture}\n"
            "\\caption{Two participants and one message. [internal]}\n"
            "\\end{figure}\n"
        )
        self.assertEqual(self.findings_for(report, "caption-promise"), [])


class TestP16IdentifierConsistency(NewRuleTestCase):
    def test_underscore_and_bare_spellings_of_one_identifier_fail(self):
        report = self.run_on(
            "% source\n\\begin{figure}\n\\begin{tikzpicture}\n"
            "  \\node[pd actor] at (0,0) {\\texttt{card\\_0}};\n"
            "  \\node[pd actor] at (3,0) {\\texttt{card0} again};\n"
            "\\end{tikzpicture}\n\\caption{Two names for one card.}\n\\end{figure}\n"
        )
        findings = self.findings_for(report, "identifier-consistency")
        self.assertTrue(findings)
        self.assertEqual(findings[0]["id"], "P16")
        self.assertEqual(findings[0]["severity"], "fail")
        self.assertIn("card0", findings[0]["message"])

    def test_register_mixing_is_out_of_scope_and_stays_a_human_rule(self):
        """`$card_0$` and `\\texttt{card\\_0}` print in two faces but reduce to
        one spelling here. P16 does not claim to see that -- craft-rules.md 7.3
        keeps it as a human rule. This test pins the limitation so nobody
        "fixes" it with a heuristic that floods the corpus."""
        report = self.run_on(
            "% source\n\\begin{figure}\n\\begin{tikzpicture}\n"
            "  \\node[pd actor] at (0,0) {card$_0$};\n"
            "\\end{tikzpicture}\n"
            "\\caption{The root card \\texttt{card\\_0} is signed once.}\n\\end{figure}\n"
        )
        self.assertEqual(self.findings_for(report, "identifier-consistency"), [])

    def test_bare_digit_suffix_against_underscore_subscript_fails(self):
        report = self.run_on(
            "% source\n\\begin{figure}\n\\begin{tikzpicture}\n"
            "  \\node[pd actor] at (0,0) {card$_0$};\n"
            "  \\node[pd actor] at (3,0) {\\texttt{card0}};\n"
            "\\end{tikzpicture}\n\\caption{Two names for one card.}\n\\end{figure}\n"
        )
        findings = self.findings_for(report, "identifier-consistency")
        self.assertTrue(findings, "card$_0$ against card0 is a split that survives any face")
        self.assertEqual(findings[0]["id"], "P16")

    def test_skA_against_sk_underscore_A_fails(self):
        report = self.run_on(
            "% source\n\\begin{figure}\n\\begin{tikzpicture}\n"
            "  \\node[pd actor] at (0,0) {signed \\texttt{sk\\_A}};\n"
            "  \\node[pd actor] at (3,0) {signed \\texttt{skA}};\n"
            "\\end{tikzpicture}\n\\caption{One key.}\n\\end{figure}\n"
        )
        self.assertTrue(self.findings_for(report, "identifier-consistency"))

    def test_one_spelling_everywhere_passes(self):
        report = self.run_on(
            "% source\n\\begin{figure}\n\\begin{tikzpicture}\n"
            "  \\node[pd actor] at (0,0) {\\texttt{card\\_0}};\n"
            "  \\node[pd actor] at (3,0) {\\texttt{card\\_1}};\n"
            "\\end{tikzpicture}\n"
            "\\caption{\\texttt{card\\_1} narrows \\texttt{card\\_0}.}\n\\end{figure}\n"
        )
        self.assertEqual(self.findings_for(report, "identifier-consistency"), [])

    def test_distinct_identifiers_are_not_merged(self):
        report = self.run_on(
            "% source\n\\begin{figure}\n\\begin{tikzpicture}\n"
            "  \\node[pd actor] at (0,0) {\\texttt{cap\\_0} and \\texttt{cap\\_1}};\n"
            "\\end{tikzpicture}\n\\caption{Two capability sets.}\n\\end{figure}\n"
        )
        self.assertEqual(self.findings_for(report, "identifier-consistency"), [])

    def test_case_is_preserved_not_merged(self):
        # X_1 and x_1 are different objects in more than one figure here.
        report = self.run_on(
            "% source\n\\begin{figure}\n\\begin{tikzpicture}\n"
            "  \\node[pd actor] at (0,0) {$X_1$ versus $x_1$};\n"
            "\\end{tikzpicture}\n\\caption{A variable and its realisation.}\n\\end{figure}\n"
        )
        self.assertEqual(self.findings_for(report, "identifier-consistency"), [])


class TestP17CaptionVocabulary(NewRuleTestCase):
    def test_caption_identifier_absent_from_the_drawing_warns(self):
        report = self.run_on(
            "% source\n\\begin{figure}\n\\begin{tikzpicture}\n"
            "  \\node[pd actor] at (0,0) {\\texttt{card\\_0}};\n"
            "\\end{tikzpicture}\n"
            "\\caption{The card binds a fresh \\texttt{jti}.}\n\\end{figure}\n"
        )
        findings = self.findings_for(report, "caption-vocabulary")
        self.assertTrue(findings)
        self.assertEqual(findings[0]["id"], "P17")
        self.assertEqual(findings[0]["severity"], "warn")
        self.assertIn("jti", findings[0]["message"])

    def test_caption_identifier_present_in_a_label_passes(self):
        report = self.run_on(
            "% source\n\\begin{figure}\n\\begin{tikzpicture}\n"
            "  \\node[pd actor] at (0,0) {\\texttt{card\\_0}, \\texttt{jti}};\n"
            "\\end{tikzpicture}\n"
            "\\caption{The card binds a fresh \\texttt{jti}.}\n\\end{figure}\n"
        )
        self.assertEqual(self.findings_for(report, "caption-vocabulary"), [])

    def test_an_all_caps_operator_is_not_a_label(self):
        report = self.run_on(
            "% source\n\\begin{figure}\n\\begin{tikzpicture}\n"
            "  \\node[pd actor] at (0,0) {two filters};\n"
            "\\end{tikzpicture}\n"
            "\\caption{A bitwise \\texttt{OR} keeps both placements.}\n\\end{figure}\n"
        )
        self.assertEqual(self.findings_for(report, "caption-vocabulary"), [])

    def test_a_warning_does_not_fail_the_fragment(self):
        report = self.run_on(
            "% source\n\\begin{figure}\n\\begin{tikzpicture}\n"
            "  \\node[pd actor] at (0,0) {\\texttt{card\\_0}};\n"
            "\\end{tikzpicture}\n"
            "\\caption{The card binds a fresh \\texttt{jti}.}\n\\end{figure}\n"
        )
        self.assertEqual(report["summary"]["result"], "warn")
        self.assertEqual(report["summary"]["hard_count"], 0)


class TestVisiblePlain(unittest.TestCase):
    """The normaliser the three rules above share: what a reader sees, with
    the markup that spells it removed."""

    def test_markup_variants_reduce_to_one_string(self):
        for spelling in ("\\texttt{card\\_0}", "$\\mathrm{card}_0$", "card$_0$", "card\\_0"):
            with self.subTest(spelling=spelling):
                self.assertEqual(
                    tikz_precheck.visible_plain(spelling).strip(), "card_0"
                )

    def test_canonical_identifier_drops_only_underscores(self):
        self.assertEqual(tikz_precheck.canonical_identifier("card_0"), "card0")
        self.assertEqual(tikz_precheck.canonical_identifier("sk_A"), "skA")
        self.assertEqual(tikz_precheck.canonical_identifier("X_1"), "X1")
        self.assertNotEqual(
            tikz_precheck.canonical_identifier("X_1"),
            tikz_precheck.canonical_identifier("x_1"),
        )

    def test_prose_words_are_not_identifiers(self):
        spellings = dict(tikz_precheck.identifier_spellings("the daemon issues a card"))
        self.assertEqual(spellings, {})
