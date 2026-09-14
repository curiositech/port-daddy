"""Unit tests for tikz_precheck.py's P18-P25 rules -- the five that make the
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
# P18 -- a node that carries a pd style AND its own font=
# --------------------------------------------------------------------------- #
class TestP18StyleFontOverride(LawTestCase):
    def test_pd_style_plus_local_font_fails(self):
        report = self.run_on(
            "\\begin{tikzpicture}[pd figure]\n"
            "\\node[pd direct label,font=\\footnotesize\\bfseries] at (0,0) {SUCCESS};\n"
            "\\end{tikzpicture}\n"
        )
        findings = self.findings_for(report, "style-font")
        self.assertEqual(len(findings), 1)
        self.assertEqual(findings[0]["id"], "P18")
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
        self.assertEqual(findings[0]["id"], "P18")

    def test_local_font_without_a_pd_style_is_not_this_rule(self):
        """P19 owns that case; P18 is specifically the override."""
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
# P19 -- a bare size command used as a font, anywhere in a fragment
# --------------------------------------------------------------------------- #
class TestP19NodeFontSize(LawTestCase):
    def test_footnotesize_as_a_node_font_fails(self):
        report = self.run_on(
            "\\begin{tikzpicture}\n"
            "\\node[anchor=west,font=\\footnotesize,text=hhink] at (0,0) {substrate};\n"
            "\\end{tikzpicture}\n"
        )
        findings = self.findings_for(report, "node-size")
        self.assertEqual(len(findings), 1)
        self.assertEqual(findings[0]["id"], "P19")
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
        self.assertTrue(all(f["id"] == "P19" for f in findings))

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
        """P19 is the SIZE rule. font=\\bfseries alone is P18's business when a
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
        single place its sizes could move to; P19 must not fire there."""
        report = self.run_on(
            "\\begin{tikzpicture}\n"
            "\\node[font=\\footnotesize] at (0,0) {A};\n"
            "\\end{tikzpicture}\n",
            corpus="research",
        )
        self.assertFalse(self.findings_for(report, "node-size"))


# --------------------------------------------------------------------------- #
# P20 -- a house ink painted without going through a pd style
# --------------------------------------------------------------------------- #
class TestP20HardInk(LawTestCase):
    def test_bare_fill_of_a_house_ink_fails(self):
        report = self.run_on(
            "\\begin{tikzpicture}\n"
            "\\fill[hhsand!30] (0,0) rectangle (10,1);\n"
            "\\end{tikzpicture}\n"
        )
        findings = self.findings_for(report, "hard-ink")
        self.assertEqual(len(findings), 1)
        self.assertEqual(findings[0]["id"], "P20")
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


# --------------------------------------------------------------------------- #
# P21 -- a type family named in a fragment
# --------------------------------------------------------------------------- #
class TestP21NodeFontFamily(LawTestCase):
    def test_sffamily_fails(self):
        """The reported defect: a figure asking for sans against a Computer
        Modern page gets Latin Modern Sans and reads as a foreign object on
        it. The figure's face is the document's face."""
        report = self.run_on(
            "\\begin{tikzpicture}[pd figure]\n"
            "\\node[anchor=west,font=\\sffamily] at (0,0) {phase 1};\n"
            "\\end{tikzpicture}\n"
        )
        findings = self.findings_for(report, "node-family")
        self.assertEqual(len(findings), 1)
        self.assertEqual(findings[0]["id"], "P21")
        self.assertEqual(findings[0]["severity"], "fail")
        self.assertIn("sffamily", findings[0]["message"])
        self.assertIn("pd mono label", findings[0]["message"])

    def test_inheriting_the_document_face_passes(self):
        report = self.run_on(
            "\\begin{tikzpicture}[pd figure]\n"
            "\\node[pd panel title,anchor=west] at (0,0) {phase 1};\n"
            "\\end{tikzpicture}\n"
        )
        self.assertFalse(self.findings_for(report, "node-family"))
        self.assertEqual(report["summary"]["result"], "pass")

    def test_ttfamily_is_a_family_too(self):
        """An identifier asks for its face by role, not by \\ttfamily -- the
        role is also where the mono side bearing is decided."""
        report = self.run_on(
            "\\begin{tikzpicture}[pd figure]\n"
            "\\node[anchor=west,font=\\ttfamily] at (0,0) {sk_A};\n"
            "\\end{tikzpicture}\n"
        )
        findings = self.findings_for(report, "node-family")
        self.assertEqual(len(findings), 1)
        self.assertIn("ttfamily", findings[0]["message"])

    def test_pd_mono_label_passes(self):
        report = self.run_on(
            "\\begin{tikzpicture}[pd figure]\n"
            "\\node[pd mono label,anchor=west] at (0,0) {sk_A};\n"
            "\\end{tikzpicture}\n"
        )
        self.assertFalse(self.findings_for(report, "node-family"))

    def test_fontfamily_selection_is_caught(self):
        report = self.run_on(
            "\\begin{tikzpicture}[pd figure]\n"
            "\\node[font=\\fontfamily{qhv}\\selectfont] at (0,0) {x};\n"
            "\\end{tikzpicture}\n"
        )
        findings = self.findings_for(report, "node-family")
        self.assertEqual(len(findings), 1)
        self.assertIn("fontfamily", findings[0]["message"])

    def test_a_weight_or_slope_is_not_a_family(self):
        report = self.run_on(
            "\\begin{tikzpicture}[pd figure]\n"
            "\\node[font=\\bfseries] at (0,0) {A};\n"
            "\\node[font=\\itshape] at (1,0) {B};\n"
            "\\end{tikzpicture}\n"
        )
        self.assertFalse(self.findings_for(report, "node-family"))

    def test_the_laws_own_family_handle_passes(self):
        """A compound style may compose from the law's handles; that IS the
        one place, not a second one."""
        report = self.run_on(
            "\\begin{tikzpicture}[pd figure,\n"
            "  bucket/.style={pd state,font=\\pdfiglabelmono}]\n"
            "\\node[bucket] at (0,0) {c1};\n"
            "\\end{tikzpicture}\n"
        )
        self.assertFalse(self.findings_for(report, "node-family"))
        self.assertFalse(self.findings_for(report, "node-size"))

    def test_the_style_file_itself_is_exempt(self):
        path = write_fixture(
            HEAD + "\\tikzset{pd mono label/.style={font=\\pdfiglabelsize\\ttfamily}}\n",
            stem="pd-figure-language",
        )
        self.addCleanup(lambda: Path(path).unlink(missing_ok=True))
        report = tikz_precheck.run_precheck(path, corpus="chapter")
        self.assertFalse(self.findings_for(report, "node-family"))

    def test_research_corpus_is_out_of_scope(self):
        report = self.run_on(
            "\\begin{tikzpicture}\n"
            "\\node[font=\\sffamily] at (0,0) {x};\n"
            "\\end{tikzpicture}\n",
            corpus="research",
        )
        self.assertFalse(self.findings_for(report, "node-family"))


# --------------------------------------------------------------------------- #
# P22 -- the one licensed exception, used only where it is licensed
# --------------------------------------------------------------------------- #
class TestP22Figmath(LawTestCase):
    def test_figmath_on_plain_math_fails(self):
        report = self.run_on(
            "\\begin{tikzpicture}[pd figure]\n"
            "\\node[pd direct label] at (0,0) {{\\pdfigmath $g$} Erlang};\n"
            "\\end{tikzpicture}\n"
        )
        findings = self.findings_for(report, "figmath")
        self.assertEqual(len(findings), 1)
        self.assertEqual(findings[0]["id"], "P22")
        self.assertEqual(findings[0]["severity"], "fail")
        self.assertIn("no sub- or superscript", findings[0]["message"])

    def test_figmath_on_a_subscript_passes(self):
        report = self.run_on(
            "\\begin{tikzpicture}[pd figure]\n"
            "\\node[pd direct label] at (0,0) {{\\pdfigmath $g_A(\\rho,3)$} Erlang};\n"
            "\\end{tikzpicture}\n"
        )
        self.assertFalse(self.findings_for(report, "figmath"))
        self.assertEqual(report["summary"]["result"], "pass")

    def test_figmath_on_a_superscript_passes(self):
        report = self.run_on(
            "\\begin{tikzpicture}[pd figure]\n"
            "\\node[pd direct label] at (0,0) {{\\pdfigmath $r^{t}$}};\n"
            "\\end{tikzpicture}\n"
        )
        self.assertFalse(self.findings_for(report, "figmath"))

    def test_plain_math_without_the_macro_is_not_flagged(self):
        report = self.run_on(
            "\\begin{tikzpicture}[pd figure]\n"
            "\\node[pd direct label] at (0,0) {$g$};\n"
            "\\end{tikzpicture}\n"
        )
        self.assertFalse(self.findings_for(report, "figmath"))

    def test_a_mention_in_a_comment_does_not_fire(self):
        report = self.run_on(
            "% \\pdfigmath is for subscripts only\n"
            "\\begin{tikzpicture}[pd figure]\n"
            "\\node[pd direct label] at (0,0) {plain};\n"
            "\\end{tikzpicture}\n"
        )
        self.assertFalse(self.findings_for(report, "figmath"))


class TestRuleIdsAreReported(LawTestCase):
    def test_summary_counts_the_new_ids(self):
        report = self.run_on(
            "\\begin{tikzpicture}\n"
            "\\node[pd direct label,font=\\footnotesize] at (0,0) {x};\n"
            "\\fill[hhink] (0,0) rectangle (1,1);\n"
            "\\end{tikzpicture}\n"
        )
        by_id = report["summary"]["by_id"]
        self.assertEqual(by_id["P18"], 1)
        self.assertEqual(by_id["P19"], 1)
        self.assertEqual(by_id["P20"], 1)

    def test_summary_counts_p18(self):
        report = self.run_on(
            "\\begin{tikzpicture}\\node[font=\\sffamily] at (0,0) {x};\\end{tikzpicture}\n"
        )
        self.assertEqual(report["summary"]["by_id"]["P21"], 1)

    def test_markdown_report_lists_the_new_ids(self):
        report = self.run_on("\\begin{tikzpicture}\\end{tikzpicture}\n")
        md = tikz_precheck.render_markdown([report])
        for rid in ("P18", "P19", "P20", "P21", "P22", "P23", "P24", "P25"):
            self.assertIn(rid + "=", md)


class TestP23Dotted(LawTestCase):
    """P23: a dash whose on-length is \\pgflinewidth rather than a length."""

    def test_absolute_dash_pattern_passes(self):
        report = self.run_on(
            "\\begin{tikzpicture}\n"
            "\\draw[pd guide] (0,0)--(1,0);\n"
            "\\draw[draw=hhgray,line width=.7pt,dash pattern=on 1.2pt off 2pt] (0,1)--(1,1);\n"
            "\\end{tikzpicture}\n"
        )
        self.assertEqual(report["summary"]["by_id"]["P23"], 0)

    def test_dashed_family_is_not_flagged(self):
        """`dashed` and its relatives are absolute (on 3pt off 3pt); only the
        dotted family reads \\pgflinewidth, and only it can drift."""
        report = self.run_on(
            "\\begin{tikzpicture}\n"
            "\\draw[pd boundary,dashed] (0,0)--(1,0);\n"
            "\\draw[pd boundary,densely dashed] (0,1)--(1,1);\n"
            "\\draw[pd boundary,loosely dashed] (0,2)--(1,2);\n"
            "\\end{tikzpicture}\n"
        )
        self.assertEqual(report["summary"]["by_id"]["P23"], 0)

    def test_densely_dotted_fails(self):
        report = self.run_on(
            "\\begin{tikzpicture}\n"
            "\\draw[draw=hhgray,line width=.45pt,densely dotted] (0,0)--(1,0);\n"
            "\\end{tikzpicture}\n"
        )
        self.assertEqual(report["summary"]["by_id"]["P23"], 1)

    def test_every_member_of_the_dotted_family_fails(self):
        report = self.run_on(
            "\\begin{tikzpicture}\n"
            "\\draw[pd guide,dotted] (0,0)--(1,0);\n"
            "\\draw[pd guide,densely dotted] (0,1)--(1,1);\n"
            "\\draw[pd guide,loosely dotted] (0,2)--(1,2);\n"
            "\\end{tikzpicture}\n"
        )
        self.assertEqual(report["summary"]["by_id"]["P23"], 3)

    def test_a_dotted_key_in_a_comment_is_ignored(self):
        report = self.run_on(
            "\\begin{tikzpicture}\n"
            "% this used to be densely dotted, and that is why it broke\n"
            "\\draw[pd guide] (0,0)--(1,0);\n"
            "\\end{tikzpicture}\n"
        )
        self.assertEqual(report["summary"]["by_id"]["P23"], 0)

    def test_p23_applies_to_the_style_definition_file_too(self):
        """Every other law rule exempts pd-figure-language.tex, because those
        rules police fragments for opting OUT of the one place the law lives.
        P23 is about a defect that was IN that place, so it applies there."""
        report = self.run_on(
            "\\tikzset{pd guide/.style={draw=hhgray!62,line width=.45pt,densely dotted}}\n",
            stem="pd-figure-language",
        )
        self.assertEqual(report["summary"]["by_id"]["P23"], 1)


class TestP24BodyFont(LawTestCase):
    """P24: a family-selection command in a node's TEXT rather than its font=."""

    def test_a_plain_node_passes(self):
        report = self.run_on(
            "\\begin{tikzpicture}\n"
            "\\node[pd row label] at (0,0) {the 6-cycle};\n"
            "\\end{tikzpicture}\n"
        )
        self.assertEqual(report["summary"]["by_id"]["P24"], 0)

    def test_pdfigsub_is_the_licensed_way_to_step_down(self):
        report = self.run_on(
            "\\begin{tikzpicture}\n"
            "\\node[pd row label] at (0,0) {the 6-cycle\\\\\\pdfigsub the disagreement closes a cycle};\n"
            "\\end{tikzpicture}\n"
        )
        self.assertEqual(report["summary"]["by_id"]["P24"], 0)

    def test_normalfont_in_node_text_fails(self):
        """The real case, from fig-fh-cycle-vs-cut and fig-stp-nomint-lineage:
        \\normalfont resets to the DOCUMENT's family, so in the Book that line
        printed in Palatino inside a grotesk drawing. No font= rule sees it."""
        report = self.run_on(
            "\\begin{tikzpicture}\n"
            "\\node[pd row label] at (0,0) {the 6-cycle\\\\\\normalfont the disagreement closes a cycle};\n"
            "\\end{tikzpicture}\n"
        )
        self.assertEqual(report["summary"]["by_id"]["P24"], 1)
        msg = self.findings_for(report, "body-font")[0]["message"]
        self.assertIn("pdfigsub", msg)
        self.assertIn("DOCUMENT", msg)

    def test_every_family_command_in_node_text_fails(self):
        report = self.run_on(
            "\\begin{tikzpicture}\n"
            "\\node at (0,0) {a \\rmfamily b};\n"
            "\\node at (0,1) {a \\sffamily b};\n"
            "\\node at (0,2) {a \\ttfamily b};\n"
            "\\end{tikzpicture}\n"
        )
        self.assertEqual(report["summary"]["by_id"]["P24"], 3)

    def test_math_roman_is_not_flagged(self):
        """\\mathrm and \\text take the text roman whatever the node's face is.
        Flagging them would be flagging the typesetter, not the author -- and it
        is exactly the class figcheck's T10 cannot separate from the page."""
        report = self.run_on(
            "\\begin{tikzpicture}\n"
            "\\node[pd direct label] at (0,0) {$\\mathrm{sk}_A$ and $\\text{ok}$};\n"
            "\\end{tikzpicture}\n"
        )
        self.assertEqual(report["summary"]["by_id"]["P24"], 0)

    def test_a_family_command_in_a_comment_is_ignored(self):
        report = self.run_on(
            "\\begin{tikzpicture}\n"
            "% this used to say \\normalfont, which is why it broke\n"
            "\\node[pd row label] at (0,0) {fine};\n"
            "\\end{tikzpicture}\n"
        )
        self.assertEqual(report["summary"]["by_id"]["P24"], 0)

    def test_apparatus_files_are_exempt(self):
        """Not everything under figures/ is a figure. pd-pedagogy.tex uses
        \\normalfont inside an environment definition, which is correct there --
        and is how the pd-* prefix rule in is_apparatus() was found."""
        report = self.run_on(
            "\\newenvironment{thing}{\\normalfont}{}\n", stem="pd-pedagogy",
        )
        self.assertEqual(report["summary"]["by_id"]["P24"], 0)


class TestP25FontHandle(LawTestCase):
    """P25: a `font=` built from anything but the house handles.

    The general form of P19 and P21, and a whitelist because the mechanism is
    general: a node's `font=` replaces the PICTURE-level `font=` that carries
    \\pdfiglabelfamily, so the node falls back to the document's face. Measured
    in the Book: font=\\bfseries renders TeXGyrePagellaX-Bold and font=\\itshape
    renders TeXGyrePagellaX-Italic inside drawings set in TeXGyreHeros.
    """

    def test_a_house_handle_passes(self):
        report = self.run_on(
            "\\begin{tikzpicture}[idbox/.style={font=\\pdfiglabelmono,inner sep=0pt}]\n"
            "\\node[idbox] at (0,0) {sk_A};\n"
            "\\end{tikzpicture}\n"
        )
        self.assertEqual(report["summary"]["by_id"]["P25"], 0)

    def test_a_composed_handle_passes(self):
        report = self.run_on(
            "\\begin{tikzpicture}\n"
            "\\node[font=\\pdfiglabelbold] at (0,0) {a};\n"
            "\\node[font=\\pdfiglabelitalic] at (0,1) {b};\n"
            "\\end{tikzpicture}\n"
        )
        self.assertEqual(report["summary"]["by_id"]["P25"], 0)

    def test_a_weight_only_font_still_fails(self):
        """The case a blacklist could never have caught: \\bfseries names no
        family and no size, and it still loses the family."""
        report = self.run_on(
            "\\begin{tikzpicture}\n\\node[font=\\bfseries] at (0,0) {cap};\n\\end{tikzpicture}\n"
        )
        self.assertEqual(report["summary"]["by_id"]["P25"], 1)
        self.assertIn("DOCUMENT", self.findings_for(report, "font-handle")[0]["message"])

    def test_a_slope_only_font_still_fails(self):
        report = self.run_on(
            "\\begin{tikzpicture}\n\\node[font=\\itshape] at (0,0) {reject};\n\\end{tikzpicture}\n"
        )
        self.assertEqual(report["summary"]["by_id"]["P25"], 1)

    def test_a_shape_font_fails(self):
        """Small caps belongs in the node's text as \\textsc{}, where it composes
        with the role's font instead of replacing it."""
        report = self.run_on(
            "\\begin{tikzpicture}\n\\node[font=\\scshape] at (0,0) {for the operator};\n\\end{tikzpicture}\n"
        )
        self.assertEqual(report["summary"]["by_id"]["P25"], 1)

    def test_the_stack_map_shape_fails(self):
        """The original defect, verbatim from main's fig-swk-stack-map.tex."""
        report = self.run_on(
            "\\begin{tikzpicture}\n"
            "\\node[font=\\footnotesize\\bfseries,text=white,anchor=west] at (0,0) {MACHINE FLOOR};\n"
            "\\end{tikzpicture}\n"
        )
        self.assertEqual(report["summary"]["by_id"]["P25"], 1)

    def test_textsc_in_node_text_is_fine(self):
        report = self.run_on(
            "\\begin{tikzpicture}\n"
            "\\node[pd axis label] at (0,0) {\\textsc{for the operator}};\n"
            "\\end{tikzpicture}\n"
        )
        self.assertEqual(report["summary"]["by_id"]["P25"], 0)

    def test_the_style_file_is_exempt(self):
        report = self.run_on(
            "\\tikzset{pd note/.style={font=\\pdfiglabelitalic,text=hhink}}\n"
            "\\tikzset{x/.style={font=\\bfseries}}\n",
            stem="pd-figure-language",
        )
        self.assertEqual(report["summary"]["by_id"]["P25"], 0)


class TestApparatusDetection(LawTestCase):
    def test_every_pd_prefixed_file_is_apparatus(self):
        for stem in ("pd-figure-language", "pd-figure-language-swiss", "pd-palette",
                     "pd-pedagogy", "pd-cite-shortforms", "pd-textbook-map",
                     "pd-something-invented-tomorrow"):
            self.assertTrue(tikz_precheck.is_apparatus(stem + ".tex"), stem)

    def test_a_drawing_is_not_apparatus(self):
        for stem in ("fig-swk-stack-map", "legible-swarm-roles", "appendix-figures"):
            self.assertFalse(tikz_precheck.is_apparatus(stem + ".tex"), stem)


class TestRuleIdRegistry(unittest.TestCase):
    """The numbering itself, checked.

    P15-P17 exist twice in this repository right now: as this file's rules
    (before they were renumbered to P18-P20) and as caption-promise,
    identifier-consistency and caption-vocabulary on
    claude/figures-that-were-missing. Two agents each took "the next three free
    numbers" thirty-three minutes apart, and nothing noticed. This test is what
    notices: claiming a number means adding a line to RULE_IDS or to
    RESERVED_RULE_IDS, and a collision or a gap fails here rather than in a
    reviewer's head.
    """

    def test_implemented_and_reserved_ids_are_disjoint(self):
        clash = set(tikz_precheck.RULE_IDS) & set(tikz_precheck.RESERVED_RULE_IDS)
        self.assertEqual(
            clash, set(),
            f"these rule ids are both implemented here and reserved for another branch: "
            f"{sorted(clash)}. One of the two has to move.",
        )

    def test_the_numbering_has_no_gaps(self):
        ids = sorted(
            set(tikz_precheck.RULE_IDS) | set(tikz_precheck.RESERVED_RULE_IDS),
            key=lambda s: int(s[1:]),
        )
        numbers = [int(s[1:]) for s in ids]
        expected = list(range(numbers[0], numbers[0] + len(numbers)))
        self.assertEqual(
            numbers, expected,
            f"the rule numbering runs {ids} -- a gap means a number was skipped or "
            f"silently freed, which is how the next collision starts. Reserve it in "
            f"RESERVED_RULE_IDS with the branch that owns it, or renumber.",
        )

    def test_every_implemented_id_says_what_it_checks(self):
        """A number in RULE_IDS with no line in the module docstring is a rule
        nobody can look up, which is how two of them ended up meaning two
        things."""
        doc = tikz_precheck.__doc__ or ""
        missing = [r for r in tikz_precheck.RULE_IDS if f"- {r} " not in doc]
        self.assertEqual(missing, [], f"not documented in the module docstring: {missing}")

    def test_every_reserved_id_names_its_owner(self):
        for rid, owner in tikz_precheck.RESERVED_RULE_IDS.items():
            self.assertIn(
                "claude/", owner,
                f"{rid} is reserved but does not name the branch that owns it: {owner!r}",
            )


if __name__ == "__main__":
    unittest.main()
