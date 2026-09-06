"""Unit tests for tikz_precheck.py's P10-P14 rules (added alongside the
original unnumbered checks). Follows the same fixture-file-per-case pattern
as skills/harbor-chartwork/tests/test_tikz_precheck.py -- one positive and
one negative case per new rule, at minimum."""
import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT_PATH = Path(__file__).resolve().parent / "tikz_precheck.py"
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
