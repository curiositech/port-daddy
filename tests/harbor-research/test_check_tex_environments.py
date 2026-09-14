#!/usr/bin/env python3
r"""Tests for scripts/harbor-research/check_tex_environments.py.

stdlib-only, no TeX. The cases are the ones that actually happened on
2026-09-08: a table converted from tabularx to xltabular at one end only,
which stopped the Book compiling in every edition; and the tikz label
"\\{...}" that made the first draft of this check report two confident false
positives. A checker that cries wolf on ordinary figure source gets switched
off, so the negative cases matter as much as the positive one.

Run:
    python3 -m unittest discover -s tests/harbor-research
"""
from __future__ import annotations

import subprocess
import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT = REPO_ROOT / "scripts" / "harbor-research" / "check_tex_environments.py"

sys.path.insert(0, str(REPO_ROOT / "scripts" / "harbor-research"))
import check_tex_environments as cte  # noqa: E402


def write(tmp: str, body: str) -> Path:
    p = Path(tmp) / "sample.tex"
    p.write_text(body, encoding="utf-8")
    return p


class TestEnvironmentPairing(unittest.TestCase):
    def test_the_defect_that_stopped_the_book_compiling(self):
        # \begin{tabularx} ... \end{xltabular}: one half of a conversion.
        with TemporaryDirectory() as tmp:
            p = write(tmp, "{\\small\n\\begin{tabularx}{\\textwidth}{ll}\na & b \\\\\n\\end{xltabular}}\n")
            problems = cte.check(p)
        self.assertEqual(len(problems), 2)
        self.assertTrue(any("tabularx opened 1x, closed 0x" in x for x in problems))
        self.assertTrue(any("xltabular opened 0x, closed 1x" in x for x in problems))

    def test_a_matched_pair_is_silent(self):
        with TemporaryDirectory() as tmp:
            p = write(tmp, "\\begin{xltabular}{\\textwidth}{ll}\na & b \\\\\n\\end{xltabular}\n")
            self.assertEqual(cte.check(p), [])

    def test_starred_and_nested_environments_pair_normally(self):
        with TemporaryDirectory() as tmp:
            p = write(tmp, "\\begin{figure*}\n\\begin{tikzpicture}\n\\end{tikzpicture}\n\\end{figure*}\n")
            self.assertEqual(cte.check(p), [])

    def test_an_environment_this_file_defines_is_not_a_use(self):
        # \newenvironment{pdexample}{...\begin{quote}}{...} names pdexample
        # without opening one; counting it would fail every preamble.
        with TemporaryDirectory() as tmp:
            p = write(tmp, "\\newenvironment{pdexample}{\\par}{\\par}\n\\begin{pdexample}\nx\n\\end{pdexample}\n")
            self.assertEqual(cte.check(p), [])

    def test_a_commented_out_begin_is_not_a_use(self):
        with TemporaryDirectory() as tmp:
            p = write(tmp, "% \\begin{tabularx}\n\\begin{figure}\n\\end{figure}\n")
            self.assertEqual(cte.check(p), [])


class TestBraceBalance(unittest.TestCase):
    def test_a_tikz_label_with_a_line_break_before_a_brace_is_balanced(self):
        # "\\{" is the line-break command then an open brace, NOT an escaped
        # brace. Stripping escapes first drops the real brace and reports a
        # phantom defect; the first draft of this check did exactly that.
        with TemporaryDirectory() as tmp:
            p = write(tmp, "\\node {acquire\\\\{\\itshape loser is told the holder}};\n")
            self.assertEqual(cte.brace_delta(p.read_text()), 0)
            self.assertEqual(cte.check(p), [])

    def test_genuinely_escaped_braces_are_not_counted(self):
        with TemporaryDirectory() as tmp:
            p = write(tmp, "\\texttt{a \\{ b \\} c}\n")
            self.assertEqual(cte.check(p), [])

    def test_a_dropped_closing_brace_is_reported(self):
        with TemporaryDirectory() as tmp:
            p = write(tmp, "\\textbf{unclosed\n")
            self.assertTrue(any("braces net +1" in x for x in cte.check(p)))

    def test_a_percent_in_a_url_does_not_swallow_the_rest_of_the_line(self):
        # \% is not a comment; treating it as one would hide real content.
        with TemporaryDirectory() as tmp:
            p = write(tmp, "\\url{a\\%b} \\textbf{c}\n")
            self.assertEqual(cte.check(p), [])


class TestRootLoadsWhatItsFiguresNeed(unittest.TestCase):
    r"""The 2026-09-14 defect: a pgfplots figure \input into a tikz-only chapter.

    Every environment paired and the file balanced, so the first check passed.
    The Book compiled, because its preamble loads pgfplots for other figures.
    Only the standalone chapter build died -- eight minutes in, on "Environment
    axis undefined" -- and took the job that consumes its artifact with it.
    """

    def build(self, tmp: str, root_body: str, **fragments: str) -> Path:
        base = Path(tmp)
        (base / "figures").mkdir(exist_ok=True)
        for name, body in fragments.items():
            (base / "figures" / f"{name}.tex").write_text(body, encoding="utf-8")
        root = base / "chapter.tex"
        root.write_text(root_body, encoding="utf-8")
        return root

    def test_an_inputted_pgfplots_figure_without_pgfplots_is_refused(self):
        with TemporaryDirectory() as tmp:
            root = self.build(
                tmp,
                "\\documentclass{article}\n\\usepackage{tikz}\n"
                "\\begin{document}\n\\input{figures/plot}\n\\end{document}\n",
                plot="\\begin{tikzpicture}\n\\begin{axis}[]\n\\end{axis}\n\\end{tikzpicture}\n",
            )
            problems = cte.check_root_provides(root)
        self.assertEqual(len(problems), 1)
        self.assertIn("\\usepackage{pgfplots}", problems[0])
        self.assertIn("figures/plot.tex", problems[0])
        # The message must carry TeX's own wording, so a search for the build
        # error lands on the check that would have caught it.
        self.assertIn("Environment axis undefined", problems[0])

    def test_loading_pgfplots_satisfies_it(self):
        with TemporaryDirectory() as tmp:
            root = self.build(
                tmp,
                "\\documentclass{article}\n\\usepackage{tikz}\n\\usepackage{pgfplots}\n"
                "\\begin{document}\n\\input{figures/plot}\n\\end{document}\n",
                plot="\\begin{axis}[]\n\\end{axis}\n",
            )
            self.assertEqual(cte.check_root_provides(root), [])

    def test_pgfplots_supplies_tikz(self):
        # \usepackage{pgfplots} loads tikz; demanding both would be a false
        # positive on every chapter that plots but never draws by hand.
        with TemporaryDirectory() as tmp:
            root = self.build(
                tmp,
                "\\documentclass{article}\n\\usepackage{pgfplots}\n"
                "\\begin{document}\n\\input{figures/plot}\n\\end{document}\n",
                plot="\\begin{tikzpicture}\n\\end{tikzpicture}\n",
            )
            self.assertEqual(cte.check_root_provides(root), [])

    def test_a_package_reached_through_an_inputted_preamble_counts(self):
        # The mega-volume keeps its \usepackage lines in a separate preamble
        # file. Looking only at the root would fail the Book itself.
        with TemporaryDirectory() as tmp:
            base = Path(tmp)
            (base / "figures").mkdir()
            (base / "figures" / "plot.tex").write_text("\\begin{axis}[]\n\\end{axis}\n", encoding="utf-8")
            (base / "preamble.tex").write_text("\\usepackage{pgfplots}\n", encoding="utf-8")
            root = base / "book.tex"
            root.write_text(
                "\\documentclass{book}\n\\input{preamble}\n"
                "\\begin{document}\n\\input{figures/plot}\n\\end{document}\n",
                encoding="utf-8",
            )
            self.assertEqual(cte.check_root_provides(root), [])

    def test_a_comma_list_of_packages_is_read(self):
        with TemporaryDirectory() as tmp:
            root = self.build(
                tmp,
                "\\documentclass{article}\n\\usepackage{amsmath,pgfplots,booktabs}\n"
                "\\begin{document}\n\\input{figures/plot}\n\\end{document}\n",
                plot="\\begin{axis}[]\n\\end{axis}\n",
            )
            self.assertEqual(cte.check_root_provides(root), [])

    def test_an_optional_argument_does_not_hide_the_package(self):
        with TemporaryDirectory() as tmp:
            root = self.build(
                tmp,
                "\\documentclass{article}\n\\usepackage[font=small]{caption}\n"
                "\\usepackage{pgfplots}\n"
                "\\begin{document}\n\\input{figures/plot}\n\\end{document}\n",
                plot="\\begin{axis}[]\n\\end{axis}\n",
            )
            self.assertEqual(cte.check_root_provides(root), [])

    def test_a_commented_out_figure_input_is_not_a_use(self):
        with TemporaryDirectory() as tmp:
            root = self.build(
                tmp,
                "\\documentclass{article}\n\\usepackage{tikz}\n"
                "\\begin{document}\n% \\input{figures/plot}\n\\end{document}\n",
                plot="\\begin{axis}[]\n\\end{axis}\n",
            )
            self.assertEqual(cte.check_root_provides(root), [])

    def test_an_input_that_is_not_on_disk_is_left_to_tex(self):
        # A generated fragment is not this check's business to report missing.
        with TemporaryDirectory() as tmp:
            root = self.build(
                tmp,
                "\\documentclass{article}\n\\usepackage{tikz}\n"
                "\\begin{document}\n\\input{figures/generated-at-build-time}\n\\end{document}\n",
            )
            self.assertEqual(cte.check_root_provides(root), [])

    def test_an_input_cycle_terminates(self):
        with TemporaryDirectory() as tmp:
            base = Path(tmp)
            (base / "a.tex").write_text("\\documentclass{article}\n\\input{b}\n", encoding="utf-8")
            (base / "b.tex").write_text("\\input{a}\n", encoding="utf-8")
            self.assertEqual(cte.check_root_provides(base / "a.tex"), [])

    def test_only_documents_with_a_documentclass_are_roots(self):
        # Figure fragments are not compiled on their own; treating one as a
        # root would demand a preamble it is never supposed to have.
        with TemporaryDirectory() as tmp:
            base = Path(tmp)
            frag = base / "fig.tex"
            frag.write_text("\\begin{axis}[]\n\\end{axis}\n", encoding="utf-8")
            root = base / "doc.tex"
            root.write_text("\\documentclass{article}\n", encoding="utf-8")
            self.assertEqual(cte.roots([frag, root]), [root])


class TestCli(unittest.TestCase):
    def run_cli(self, *args: str) -> subprocess.CompletedProcess:
        return subprocess.run([sys.executable, str(SCRIPT), *args],
                              cwd=REPO_ROOT, capture_output=True, text=True)

    def test_the_committed_corpus_pairs_and_balances(self):
        result = self.run_cli()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("every environment pairs", result.stdout)

    def test_the_committed_roots_load_what_their_figures_need(self):
        result = self.run_cli()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("loads the packages its figures need", result.stdout)
        # Having checked nothing is not a pass: the corpus really does have
        # compilable roots, and the count must say so.
        found = int(result.stdout.split("root document(s)")[0].strip().split("\n")[-1])
        self.assertGreater(found, 1)

    def test_a_file_outside_the_repo_is_named_rather_than_crashing(self):
        with TemporaryDirectory() as tmp:
            p = write(tmp, "\\begin{a}\n\\end{b}\n")
            result = self.run_cli(str(p))
        self.assertEqual(result.returncode, 1)
        self.assertIn("sample.tex", result.stdout)

    def test_a_missing_file_fails_rather_than_passing_silently(self):
        result = self.run_cli("does/not/exist.tex")
        self.assertEqual(result.returncode, 1)


if __name__ == "__main__":
    unittest.main()
