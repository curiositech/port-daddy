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


class TestCli(unittest.TestCase):
    def run_cli(self, *args: str) -> subprocess.CompletedProcess:
        return subprocess.run([sys.executable, str(SCRIPT), *args],
                              cwd=REPO_ROOT, capture_output=True, text=True)

    def test_the_committed_corpus_pairs_and_balances(self):
        result = self.run_cli()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("every environment pairs", result.stdout)

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
