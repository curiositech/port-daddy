"""Unit tests for tikz_precheck.py, using small fixture strings written to
temp files (the script only ever reads fragment text, so this is sufficient
-- no TeX engine involved)."""
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


class PrecheckTestCase(unittest.TestCase):
    def run_on(self, text, corpus="chapter", **kwargs):
        path = write_fixture(text)
        self.addCleanup(lambda: Path(path).unlink(missing_ok=True))
        return tikz_precheck.run_precheck(path, corpus=corpus, **kwargs)

    def findings_for(self, report, check):
        return [f for f in report["findings"] if f["check"] == check]


class TestProvenance(PrecheckTestCase):
    def test_missing_comment_fails(self):
        report = self.run_on("\\begin{tikzpicture}\n\\end{tikzpicture}\n")
        self.assertTrue(self.findings_for(report, "provenance"))
        self.assertEqual(report["summary"]["result"], "fail")

    def test_bare_percent_fails(self):
        report = self.run_on("%\n\\begin{tikzpicture}\n\\end{tikzpicture}\n")
        self.assertTrue(self.findings_for(report, "provenance"))

    def test_real_comment_passes(self):
        report = self.run_on(
            "% Figure 1 -- the seven-organ stack.\n"
            "\\begin{tikzpicture}\n\\end{tikzpicture}\n"
        )
        self.assertFalse(self.findings_for(report, "provenance"))


class TestTiny(PrecheckTestCase):
    def test_tiny_flagged(self):
        report = self.run_on(
            "% source\n\\begin{tikzpicture}\n\\node at (0,0) {\\tiny hi};\n\\end{tikzpicture}\n"
        )
        self.assertTrue(self.findings_for(report, "tiny"))
        self.assertEqual(report["summary"]["result"], "fail")

    def test_no_tiny_clean(self):
        report = self.run_on("% source\n\\begin{tikzpicture}\n\\end{tikzpicture}\n")
        self.assertFalse(self.findings_for(report, "tiny"))


class TestResizebox(PrecheckTestCase):
    def test_resizebox_is_warn_not_fail(self):
        report = self.run_on(
            "% source\n\\begin{figure}\n\\resizebox{\\textwidth}{!}{\\begin{tikzpicture}"
            "\\end{tikzpicture}}\n\\end{figure}\n"
        )
        findings = self.findings_for(report, "resizebox")
        self.assertTrue(findings)
        self.assertEqual(findings[0]["severity"], "warn")
        # resizebox alone must not fail the build
        self.assertEqual(report["summary"]["result"], "warn")


class TestColors(PrecheckTestCase):
    def test_disallowed_chapter_color_fails(self):
        report = self.run_on(
            "% source\n\\begin{tikzpicture}\n\\draw[draw=hotpink] (0,0) -- (1,1);\n\\end{tikzpicture}\n",
            corpus="chapter",
        )
        findings = self.findings_for(report, "color")
        self.assertTrue(any(f["color"] == "hotpink" for f in findings))
        self.assertEqual(report["summary"]["result"], "fail")

    def test_allowed_chapter_color_with_mixing_passes(self):
        report = self.run_on(
            "% source\n\\begin{tikzpicture}\n\\fill[fill=hhteal!8] (0,0) rectangle (1,1);\n"
            "\\node[draw=black] at (0,0) {x};\n\\end{tikzpicture}\n",
            corpus="chapter",
        )
        self.assertFalse(self.findings_for(report, "color"))

    def test_research_corpus_uses_its_own_palette(self):
        # "shipred" is disallowed for the chapter corpus but fine for research;
        # "hhteal" is the reverse.
        text = "% source\n\\begin{tikzpicture}\n\\draw[draw=shipred] (0,0) -- (1,1);\n\\end{tikzpicture}\n"
        chapter_report = self.run_on(text, corpus="chapter")
        research_report = self.run_on(text, corpus="research")
        self.assertTrue(any(f["color"] == "shipred" for f in self.findings_for(chapter_report, "color")))
        self.assertFalse(self.findings_for(research_report, "color"))

    def test_style_reference_not_mistaken_for_color(self):
        report = self.run_on(
            "% source\n\\begin{tikzpicture}\n\\node[pd actor] at (0,0) {x};\n\\end{tikzpicture}\n",
            corpus="chapter",
        )
        self.assertFalse(self.findings_for(report, "color"))


class TestNodeWrapping(PrecheckTestCase):
    def test_multiword_without_wrap_fails(self):
        report = self.run_on(
            "% source\n\\begin{tikzpicture}\n\\node[font=\\small] at (0,0) {two words here};\n"
            "\\end{tikzpicture}\n"
        )
        self.assertTrue(self.findings_for(report, "node-wrap"))
        self.assertEqual(report["summary"]["result"], "fail")

    def test_single_word_is_exempt(self):
        report = self.run_on(
            "% source\n\\begin{tikzpicture}\n\\node[font=\\small] at (0,0) {kernel};\n\\end{tikzpicture}\n"
        )
        self.assertFalse(self.findings_for(report, "node-wrap"))

    def test_inline_align_exempts(self):
        report = self.run_on(
            "% source\n\\begin{tikzpicture}\n\\node[align=left] at (0,0) {two words here};\n"
            "\\end{tikzpicture}\n"
        )
        self.assertFalse(self.findings_for(report, "node-wrap"))

    def test_inline_text_width_exempts(self):
        report = self.run_on(
            "% source\n\\begin{tikzpicture}\n\\node[text width=3cm] at (0,0) {two words here};\n"
            "\\end{tikzpicture}\n"
        )
        self.assertFalse(self.findings_for(report, "node-wrap"))

    def test_known_safe_house_style_exempts(self):
        # "pd panel title" bakes in align=left in figures/pd-figure-language.tex.
        report = self.run_on(
            "% source\n\\begin{tikzpicture}\n\\node[pd panel title] at (0,0) {two words here};\n"
            "\\end{tikzpicture}\n"
        )
        self.assertFalse(self.findings_for(report, "node-wrap"))

    def test_known_unsafe_house_style_still_fails(self):
        # "pd axis label" does NOT set align/text width in pd-figure-language.tex.
        report = self.run_on(
            "% source\n\\begin{tikzpicture}\n\\node[pd axis label] at (0,0) {two words here};\n"
            "\\end{tikzpicture}\n"
        )
        self.assertTrue(self.findings_for(report, "node-wrap"))

    def test_local_style_that_wraps_exempts(self):
        report = self.run_on(
            "% source\n\\begin{tikzpicture}[myline/.style={align=center,font=\\small}]\n"
            "\\node[myline] at (0,0) {two words here};\n\\end{tikzpicture}\n"
        )
        self.assertFalse(self.findings_for(report, "node-wrap"))

    def test_local_style_that_does_not_wrap_still_fails(self):
        report = self.run_on(
            "% source\n\\begin{tikzpicture}[myline/.style={draw=black,thick}]\n"
            "\\node[myline] at (0,0) {two words here};\n\\end{tikzpicture}\n"
        )
        self.assertTrue(self.findings_for(report, "node-wrap"))

    def test_style_after_the_node_name_is_still_seen(self):
        # `\node (name) [style] at (x,y) {...}` -- style after the coordinate name.
        report = self.run_on(
            "% source\n\\begin{tikzpicture}\n\\node (n1) [align=left] at (0,0) {two words here};\n"
            "\\end{tikzpicture}\n"
        )
        self.assertFalse(self.findings_for(report, "node-wrap"))


class TestTitleNumbers(PrecheckTestCase):
    def test_caption_title_bold_with_result_number_fails(self):
        report = self.run_on(
            "% source\n\\begin{figure}\n\\begin{tikzpicture}\\end{tikzpicture}\n"
            "\\caption{\\textbf{R7 regime.} Some more prose follows here.}\n\\end{figure}\n"
        )
        self.assertTrue(self.findings_for(report, "title-number"))
        self.assertEqual(report["summary"]["result"], "fail")

    def test_result_number_in_plain_caption_prose_is_not_flagged(self):
        # Mirrors the real fig-paper7-radius.tex case: "CR-1" appears in the
        # caption's prose (not its bolded lead), and should NOT be flagged --
        # the heuristic targets titles, not every mention of a result name.
        report = self.run_on(
            "% source\n\\begin{figure}\n\\begin{tikzpicture}\\end{tikzpicture}\n"
            "\\caption{Conviction strength is set by topology alone. The CR-1 closed "
            "form plots certified residual per unit lie.}\n\\end{figure}\n"
        )
        self.assertFalse(self.findings_for(report, "title-number"))

    def test_pgfplots_axis_title_with_result_number_fails(self):
        report = self.run_on(
            "% source\n\\begin{tikzpicture}\n\\begin{axis}[title={B6 -- the cliff}]\n"
            "\\end{axis}\n\\end{tikzpicture}\n"
        )
        self.assertTrue(self.findings_for(report, "title-number"))

    def test_clean_title_passes(self):
        report = self.run_on(
            "% source\n\\begin{figure}\n\\begin{tikzpicture}\\end{tikzpicture}\n"
            "\\caption{\\textbf{The floor falls as the budget grows.} More prose.}\n"
            "\\end{figure}\n"
        )
        self.assertFalse(self.findings_for(report, "title-number"))


class TestDetectCorpus(unittest.TestCase):
    def test_research_path_detected(self):
        self.assertEqual(
            tikz_precheck.detect_corpus("/repo/docs/harbor-research/figures/fig-x.tex"), "research"
        )

    def test_chapter_path_detected(self):
        self.assertEqual(
            tikz_precheck.detect_corpus("/repo/whitepaper/figures/fig-x.tex"), "chapter"
        )


class TestCLI(unittest.TestCase):
    def test_main_exit_zero_on_clean_fragment(self):
        path = write_fixture("% source\n\\begin{tikzpicture}\n\\node at (0,0) {kernel};\n\\end{tikzpicture}\n")
        self.addCleanup(lambda: Path(path).unlink(missing_ok=True))
        status = tikz_precheck.main([path, "--corpus", "chapter"])
        self.assertEqual(status, 0)

    def test_main_exit_one_on_hard_finding(self):
        path = write_fixture("\\begin{tikzpicture}\n\\node at (0,0) {kernel};\n\\end{tikzpicture}\n")
        self.addCleanup(lambda: Path(path).unlink(missing_ok=True))
        status = tikz_precheck.main([path, "--corpus", "chapter"])
        self.assertEqual(status, 1)

    def test_main_exit_two_on_missing_file(self):
        status = tikz_precheck.main(["/no/such/fragment.tex"])
        self.assertEqual(status, 2)

    def test_main_writes_json_and_md(self):
        path = write_fixture("% source\n\\begin{tikzpicture}\n\\node at (0,0) {kernel};\n\\end{tikzpicture}\n")
        self.addCleanup(lambda: Path(path).unlink(missing_ok=True))
        out_dir = tempfile.mkdtemp()
        json_path = str(Path(out_dir) / "out.json")
        md_path = str(Path(out_dir) / "out.md")
        status = tikz_precheck.main([path, "--corpus", "chapter", "--json", json_path, "--md", md_path])
        self.assertEqual(status, 0)
        self.assertTrue(Path(json_path).is_file())
        self.assertTrue(Path(md_path).is_file())


if __name__ == "__main__":
    unittest.main()
