"""Unit tests for tikz_precheck.py's P15-P17 rules -- the three that make the
typographic law in figures/pd-figure-language.tex binding rather than advisory.

Same fixture-file-per-case pattern as test_tikz_precheck.py and
test_tikz_precheck_new_rules.py: at minimum one PASSING case and one FAILING
case per rule, so the rule itself is tested and not only its happy path.
"""
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

HEAD = "% provenance: a fixture for the typographic-law rules.\n"


def write_fixture(text, stem="fixture"):
    tmp = tempfile.NamedTemporaryFile(
        mode="w", prefix=stem + "-", suffix=".tex", delete=False, encoding="utf-8"
    )
    tmp.write(text)
    tmp.close()
    return tmp.name


class LawTestCase(unittest.TestCase):
    def run_on(self, body, corpus="chapter", stem="fixture"):
        path = write_fixture(HEAD + body, stem=stem)
        self.addCleanup(lambda: Path(path).unlink(missing_ok=True))
        return tikz_precheck.run_precheck(path, corpus=corpus)

    def findings_for(self, report, check):
        return [f for f in report["findings"] if f["check"] == check]


# --------------------------------------------------------------------------- #
# P15 -- a node that carries a pd style AND its own font=
# --------------------------------------------------------------------------- #
class TestP15StyleFontOverride(LawTestCase):
    def test_pd_style_plus_local_font_fails(self):
        report = self.run_on(
            "\\begin{tikzpicture}[pd figure]\n"
            "\\node[pd direct label,font=\\footnotesize\\bfseries] at (0,0) {SUCCESS};\n"
            "\\end{tikzpicture}\n"
        )
        findings = self.findings_for(report, "style-font")
        self.assertEqual(len(findings), 1)
        self.assertEqual(findings[0]["id"], "P15")
        self.assertEqual(findings[0]["severity"], "fail")
        self.assertIn("pd direct label", findings[0]["message"])
        self.assertEqual(report["summary"]["result"], "fail")

    def test_pd_style_alone_passes(self):
        report = self.run_on(
            "\\begin{tikzpicture}[pd figure]\n"
            "\\node[pd verdict,text=hhteal] at (0,0) {SUCCESS};\n"
            "\\end{tikzpicture}\n"
        )
        self.assertFalse(self.findings_for(report, "style-font"))

    def test_font_without_a_size_still_fails(self):
        """The rule is about overriding the ROLE, not only about the size --
        font=\\ttfamily replaces the style's family just as completely."""
        report = self.run_on(
            "\\begin{tikzpicture}[pd figure]\n"
            "\\node[pd direct label,font=\\ttfamily] at (0,0) {c1 c7};\n"
            "\\end{tikzpicture}\n"
        )
        findings = self.findings_for(report, "style-font")
        self.assertEqual(len(findings), 1)
        self.assertEqual(findings[0]["id"], "P15")

    def test_local_font_without_a_pd_style_is_not_this_rule(self):
        """P16 owns that case; P15 is specifically the override."""
        report = self.run_on(
            "\\begin{tikzpicture}\n"
            "\\node[anchor=west,font=\\bfseries] at (0,0) {label};\n"
            "\\end{tikzpicture}\n"
        )
        self.assertFalse(self.findings_for(report, "style-font"))

    def test_the_style_file_itself_is_exempt(self):
        path = write_fixture(
            HEAD
            + "\\tikzset{pd direct label/.style={font=\\pdfiglabel,text=hhink}}\n"
            "\\node[pd direct label,font=\\footnotesize] at (0,0) {x};\n",
            stem="pd-figure-language",
        )
        self.addCleanup(lambda: Path(path).unlink(missing_ok=True))
        report = tikz_precheck.run_precheck(path, corpus="chapter")
        self.assertFalse(self.findings_for(report, "style-font"))
        self.assertFalse(self.findings_for(report, "node-size"))


# --------------------------------------------------------------------------- #
# P16 -- a bare size command used as a font, anywhere in a fragment
# --------------------------------------------------------------------------- #
class TestP16NodeFontSize(LawTestCase):
    def test_footnotesize_as_a_node_font_fails(self):
        report = self.run_on(
            "\\begin{tikzpicture}\n"
            "\\node[anchor=west,font=\\footnotesize,text=hhink] at (0,0) {substrate};\n"
            "\\end{tikzpicture}\n"
        )
        findings = self.findings_for(report, "node-size")
        self.assertEqual(len(findings), 1)
        self.assertEqual(findings[0]["id"], "P16")
        self.assertEqual(findings[0]["severity"], "fail")
        self.assertIn("footnotesize", findings[0]["message"])

    def test_a_named_role_passes(self):
        report = self.run_on(
            "\\begin{tikzpicture}[pd figure]\n"
            "\\node[pd row label] at (0,0) {substrate};\n"
            "\\node[pd axis label,anchor=east,align=left] at (5,0) {one writer, claims};\n"
            "\\end{tikzpicture}\n"
        )
        self.assertFalse(self.findings_for(report, "node-size"))
        self.assertEqual(report["summary"]["result"], "pass")

    def test_pgfplots_axis_style_block_is_reached(self):
        """The defect's biggest hiding place was not a node at all: every plot
        fragment restated tick label style={font=...} by hand."""
        report = self.run_on(
            "\\begin{tikzpicture}\n\\begin{axis}[\n"
            "  tick label style={font=\\footnotesize,text=hhgray},\n"
            "  title style={font=\\footnotesize\\bfseries,text=hhink},\n"
            "]\n\\end{axis}\n\\end{tikzpicture}\n"
        )
        findings = self.findings_for(report, "node-size")
        self.assertEqual(len(findings), 2)
        self.assertTrue(all(f["id"] == "P16" for f in findings))

    def test_pd_axis_key_passes(self):
        report = self.run_on(
            "\\begin{tikzpicture}[pd figure]\n\\begin{axis}[pd axis,\n"
            "  xlabel={swarm size $N$},\n"
            "]\n\\end{axis}\n\\end{tikzpicture}\n"
        )
        self.assertFalse(self.findings_for(report, "node-size"))

    def test_fontsize_selectfont_is_a_size_too(self):
        report = self.run_on(
            "\\begin{tikzpicture}\n"
            "\\node[font=\\fontsize{7}{8}\\selectfont] at (0,0) {tick};\n"
            "\\end{tikzpicture}\n"
        )
        findings = self.findings_for(report, "node-size")
        self.assertEqual(len(findings), 1)
        self.assertIn("fontsize", findings[0]["message"])

    def test_a_weight_only_font_is_not_a_size(self):
        """P16 is the SIZE rule. font=\\bfseries alone is P15's business when a
        pd style is present and nobody's otherwise."""
        report = self.run_on(
            "\\begin{tikzpicture}\n"
            "\\node[font=\\bfseries] at (0,0) {A};\n"
            "\\end{tikzpicture}\n"
        )
        self.assertFalse(self.findings_for(report, "node-size"))

    def test_a_size_command_in_a_comment_does_not_fire(self):
        report = self.run_on(
            "% the old version said font=\\footnotesize here\n"
            "\\begin{tikzpicture}[pd figure]\n"
            "\\node[pd direct label] at (0,0) {A};\n"
            "\\end{tikzpicture}\n"
        )
        self.assertFalse(self.findings_for(report, "node-size"))

    def test_research_corpus_is_out_of_scope(self):
        """docs/harbor-research has no pd-figure-language.tex, so there is no
        single place its sizes could move to; P16 must not fire there."""
        report = self.run_on(
            "\\begin{tikzpicture}\n"
            "\\node[font=\\footnotesize] at (0,0) {A};\n"
            "\\end{tikzpicture}\n",
            corpus="research",
        )
        self.assertFalse(self.findings_for(report, "node-size"))


# --------------------------------------------------------------------------- #
# P17 -- a house ink painted without going through a pd style
# --------------------------------------------------------------------------- #
class TestP17HardInk(LawTestCase):
    def test_bare_fill_of_a_house_ink_fails(self):
        report = self.run_on(
            "\\begin{tikzpicture}\n"
            "\\fill[hhsand!30] (0,0) rectangle (10,1);\n"
            "\\end{tikzpicture}\n"
        )
        findings = self.findings_for(report, "hard-ink")
        self.assertEqual(len(findings), 1)
        self.assertEqual(findings[0]["id"], "P17")
        self.assertEqual(findings[0]["severity"], "fail")
        self.assertIn("pd neutral fill", findings[0]["message"])

    def test_the_named_fill_style_passes(self):
        report = self.run_on(
            "\\begin{tikzpicture}[pd figure]\n"
            "\\fill[pd neutral fill] (0,0) rectangle (10,1);\n"
            "\\draw[pd focus rule] (0,2) -- (10,2);\n"
            "\\end{tikzpicture}\n"
        )
        self.assertFalse(self.findings_for(report, "hard-ink"))
        self.assertEqual(report["summary"]["result"], "pass")

    def test_draw_of_a_house_ink_names_the_rule_style(self):
        report = self.run_on(
            "\\begin{tikzpicture}\n"
            "\\draw[draw=hhteal,line width=1.05pt] (0,0) -- (4,0);\n"
            "\\end{tikzpicture}\n"
        )
        findings = self.findings_for(report, "hard-ink")
        self.assertEqual(len(findings), 1)
        self.assertIn("pd focus rule", findings[0]["message"])

    def test_a_bare_token_on_fill_names_a_fill_style_not_a_rule(self):
        """The command decides: a bare colour on \\fill is an AREA. Sending the
        author to `pd focus rule` for a shaded band is worse than saying
        nothing, and is exactly the mistake the first conversion pass made."""
        report = self.run_on(
            "\\begin{tikzpicture}\n"
            "\\fill[hhteal!9] (0,0) rectangle (4,1);\n"
            "\\end{tikzpicture}\n"
        )
        findings = self.findings_for(report, "hard-ink")
        self.assertEqual(len(findings), 1)
        self.assertIn("pd focus fill", findings[0]["message"])
        self.assertNotIn("rule", findings[0]["message"])

    def test_a_bare_token_on_draw_still_names_a_rule_style(self):
        report = self.run_on(
            "\\begin{tikzpicture}\n"
            "\\draw[hhteal,line width=1.2pt] (0,0) -- (4,1);\n"
            "\\end{tikzpicture}\n"
        )
        findings = self.findings_for(report, "hard-ink")
        self.assertEqual(len(findings), 1)
        self.assertIn("pd focus rule", findings[0]["message"])

    def test_addplot_series_colour_is_reached(self):
        report = self.run_on(
            "\\begin{tikzpicture}\n\\begin{axis}[pd axis]\n"
            "\\addplot[hhteal,domain=0:64] {0.9^x};\n"
            "\\end{axis}\n\\end{tikzpicture}\n"
        )
        findings = self.findings_for(report, "hard-ink")
        self.assertEqual(len(findings), 1)
        self.assertIn("pd focus rule", findings[0]["message"])

    def test_a_pd_style_anywhere_in_the_option_list_exempts_the_path(self):
        """A path that goes through a house style may still tune one key --
        that is not opting out, it is specialising."""
        report = self.run_on(
            "\\begin{tikzpicture}[pd figure]\n"
            "\\draw[pd caution rule,dashed,line width=1.25pt] (0,0) -- (4,0);\n"
            "\\addplot[pd focus rule,draw=hhteal] coordinates {(0,0)};\n"
            "\\end{tikzpicture}\n"
        )
        self.assertFalse(self.findings_for(report, "hard-ink"))

    def test_hhpaper_is_the_ground_not_an_ink(self):
        """fill=hhpaper is a knockout backing and draw=hhpaper a halo ring;
        neither has a pd style that says it better, so neither is a finding."""
        report = self.run_on(
            "\\begin{tikzpicture}\n"
            "\\fill[hhpaper] (0,0) rectangle (1,1);\n"
            "\\draw[draw=hhpaper,line width=.55pt] (0,2) circle (2pt);\n"
            "\\end{tikzpicture}\n"
        )
        self.assertFalse(self.findings_for(report, "hard-ink"))

    def test_a_non_house_colour_is_the_older_colour_rule_not_this_one(self):
        report = self.run_on(
            "\\begin{tikzpicture}\n"
            "\\fill[black!20] (0,0) rectangle (1,1);\n"
            "\\end{tikzpicture}\n"
        )
        self.assertFalse(self.findings_for(report, "hard-ink"))

    def test_research_corpus_is_out_of_scope(self):
        report = self.run_on(
            "\\begin{tikzpicture}\n"
            "\\fill[hhsand!30] (0,0) rectangle (1,1);\n"
            "\\end{tikzpicture}\n",
            corpus="research",
        )
        self.assertFalse(self.findings_for(report, "hard-ink"))


class TestRuleIdsAreReported(LawTestCase):
    def test_summary_counts_the_new_ids(self):
        report = self.run_on(
            "\\begin{tikzpicture}\n"
            "\\node[pd direct label,font=\\footnotesize] at (0,0) {x};\n"
            "\\fill[hhink] (0,0) rectangle (1,1);\n"
            "\\end{tikzpicture}\n"
        )
        by_id = report["summary"]["by_id"]
        self.assertEqual(by_id["P15"], 1)
        self.assertEqual(by_id["P16"], 1)
        self.assertEqual(by_id["P17"], 1)

    def test_markdown_report_lists_the_new_ids(self):
        report = self.run_on("\\begin{tikzpicture}\\end{tikzpicture}\n")
        md = tikz_precheck.render_markdown([report])
        for rid in ("P15", "P16", "P17"):
            self.assertIn(rid + "=", md)


if __name__ == "__main__":
    unittest.main()
