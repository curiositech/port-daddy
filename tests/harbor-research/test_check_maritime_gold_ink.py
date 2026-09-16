#!/usr/bin/env python3
"""Tests for scripts/harbor-research/check_maritime_gold_ink.py.

stdlib-only, like the rest of tests/harbor-research. Two flavors:

  * TestCommittedTree runs the real checker against this repository's own
    committed tree -- the "the checker passes on what is actually committed"
    requirement, and the one that catches the check itself failing open
    (scanning zero files).

  * TestFixtures builds small, self-contained fixture repos under a tempdir
    exercising each rule (allowed ink use, disallowed ink use, proximity to
    the story colour in TeX, and both in one CSS rule block) directly
    against the module's own functions -- no subprocess needed, since the
    checker is import-safe (argparse only runs under __main__).

Run:
    python3 -m unittest discover -s tests/harbor-research
    python3 tests/harbor-research/test_check_maritime_gold_ink.py
"""
from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

REPO_ROOT = Path(__file__).resolve().parents[2]
CHECKER_PATH = REPO_ROOT / "scripts" / "harbor-research" / "check_maritime_gold_ink.py"

spec = importlib.util.spec_from_file_location("check_maritime_gold_ink", CHECKER_PATH)
checker = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = checker
spec.loader.exec_module(checker)


def write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


class TestCommittedTree(unittest.TestCase):
    def test_the_real_repository_passes_and_actually_scanned_something(self):
        tex_failures, tex_files, tex_ink_seen = checker.check_tex_usage(str(REPO_ROOT))
        css_failures, css_files, css_ink_seen = checker.check_css_usage(str(REPO_ROOT))
        self.assertEqual(tex_failures, [], tex_failures)
        self.assertEqual(css_failures, [], css_failures)
        self.assertGreater(tex_files, 0, "no TeX files found -- the glob has drifted")
        self.assertGreater(css_files, 0, "no CSS/component files found -- the glob has drifted")
        # The two known title-rule fillets, and the one palette \definecolor.
        self.assertGreaterEqual(tex_ink_seen, 3)
        # tokens.semantic.css's own \definecolor-equivalent.
        self.assertGreaterEqual(css_ink_seen, 1)


class TestTexRules(unittest.TestCase):
    def test_allowed_uses_pass(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            write(root / "whitepaper/figures/pd-palette.tex",
                  "\\definecolor{pdmaritimegold}{HTML}{805A14}\n")
            write(root / "website-v2/public/whitepaper/pre.tex",
                  "\\vspace{2pt}\\noindent{\\color{pdmaritimegold}\\rule{\\textwidth}{0.4pt}}\\par\n")
            failures, files, seen = checker.check_tex_usage(str(root))
            self.assertEqual(failures, [])
            self.assertEqual(files, 2)
            self.assertEqual(seen, 2)

    def test_use_outside_the_allowed_pattern_fails(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            write(root / "whitepaper/ch.tex",
                  "\\node[fill=pdmaritimegold] at (0,0) {x};\n")
            failures, _, _ = checker.check_tex_usage(str(root))
            self.assertEqual(len(failures), 1)
            self.assertIn("outside its documented roles", failures[0])

    def test_commented_out_use_is_not_flagged(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            write(root / "whitepaper/ch.tex",
                  "% \\node[fill=pdmaritimegold] at (0,0) {x};\n")
            failures, _, seen = checker.check_tex_usage(str(root))
            self.assertEqual(failures, [])
            self.assertEqual(seen, 0)

    def test_ink_near_story_colour_fails_even_if_the_ink_use_is_allowed(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            write(
                root / "whitepaper/ch.tex",
                "\\color{pdmaritimegold}\\rule{1cm}{1pt}\n"
                "\\textcolor{pdgold}{the market}\n",
            )
            failures, _, _ = checker.check_tex_usage(str(root))
            self.assertTrue(
                any("never sit beside" in f for f in failures),
                failures,
            )

    def test_ink_far_from_story_colour_in_the_same_file_is_fine(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            lines = ["\\color{pdmaritimegold}\\rule{1cm}{1pt}"]
            lines.extend(["filler line"] * 20)
            lines.append("\\textcolor{pdgold}{the market}")
            write(root / "whitepaper/ch.tex", "\n".join(lines) + "\n")
            failures, _, _ = checker.check_tex_usage(str(root))
            self.assertEqual(failures, [])


class TestCssRules(unittest.TestCase):
    def test_definitions_file_lists_both_tokens_without_failing(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            write(
                root / "website-v2/src/styles/tokens.semantic.css",
                ":root {\n  --print-maritime-gold: #805a14;\n  --story-gold: #666a00;\n}\n",
            )
            failures, files, seen = checker.check_css_usage(str(root))
            self.assertEqual(failures, [])
            self.assertEqual(files, 1)
            self.assertEqual(seen, 1)

    def test_component_using_the_literal_ink_token_fails(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            write(
                root / "website-v2/src/styles/tokens.semantic.css",
                ":root {\n  --print-maritime-gold: #805a14;\n}\n",
            )
            write(
                root / "website-v2/src/components/Badge.css",
                ".badge { color: var(--print-maritime-gold); }\n",
            )
            failures, _, _ = checker.check_css_usage(str(root))
            self.assertTrue(any("reaches for" in f for f in failures), failures)

    def test_component_using_both_tokens_in_one_rule_fails(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            write(
                root / "website-v2/src/styles/tokens.semantic.css",
                ":root {\n  --print-maritime-gold: #805a14;\n  --story-gold: #666a00;\n}\n",
            )
            write(
                root / "website-v2/src/components/Badge.css",
                ".badge {\n  color: var(--print-maritime-gold);\n  border-color: var(--story-gold);\n}\n",
            )
            failures, _, _ = checker.check_css_usage(str(root))
            self.assertTrue(any("one rule block" in f for f in failures), failures)


class TestFailClosed(unittest.TestCase):
    def test_no_files_found_is_a_failure_not_a_silent_pass(self):
        with TemporaryDirectory() as tmp:
            # An empty tree: neither glob matches anything.
            rc = _run_main_against(tmp)
            self.assertEqual(rc, 1)


def _run_main_against(root: str) -> int:
    import io
    import contextlib

    old_argv = sys.argv
    sys.argv = ["check_maritime_gold_ink.py", "--repo-root", root]
    try:
        with contextlib.redirect_stdout(io.StringIO()):
            return checker.main()
    finally:
        sys.argv = old_argv


if __name__ == "__main__":
    unittest.main()
