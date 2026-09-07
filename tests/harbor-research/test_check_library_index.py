#!/usr/bin/env python3
"""Fixture-based tests for scripts/harbor-research/check_library_index.py.

stdlib-only (unittest, tempfile, subprocess). Each test builds a small,
self-contained fixture repo under a tempdir -- a textbook.json, a research
paper, a chapter, and a library-index.json -- and runs the real checker
against it with --repo-root, so these tests exercise the actual CLI a
developer or CI runs, not an internal API that could drift from it.

The checker's own module lookup for check_citations.py/
check_propagated_corrections.py is anchored to its real location on disk
(sys.path.insert(0, dirname(__file__)) in check_library_index.py), so
--repo-root only redirects the *data* the checker reads (library-index.json,
the tex corpus, textbook.json) -- exactly the isolation these tests need.

Run:
    python3 -m unittest discover -s tests/harbor-research
    python3 tests/harbor-research/test_check_library_index.py
"""
from __future__ import annotations

import json
import subprocess
import sys
import textwrap
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

REPO_ROOT = Path(__file__).resolve().parents[2]
CHECKER = REPO_ROOT / "scripts" / "harbor-research" / "check_library_index.py"


def write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(textwrap.dedent(content).lstrip("\n"), encoding="utf-8")


TWIN_HEADER = """\
% -----------------------------------------------------------------------
% TWIN-LOCATION NOTICE. This file is one of the shared homes for the same
% results; edit every listed home or the drift checker fails.
%   Standalone paper : docs/harbor-research/tex/paper1.tex (S1)
%   Chapter          : whitepaper/testchap.tex (Chapter 1, Test Chapter)
%   Index ids        : TEST1
%   Check            : python3 scripts/harbor-research/check_library_index.py
%   System document  : docs/harbor-research/LIBRARY-SYSTEM.md
% -----------------------------------------------------------------------
"""

PAPER1_BODY = """\
{header}\\documentclass{{article}}
\\begin{{document}}
\\section{{Floor}}\\label{{sec:floor}}
Theorem: the answer is 42 [verified].
{extra}\\end{{document}}
"""

CHAPTER_BODY = """\
{header}\\documentclass{{article}}
\\newcommand{{\\pdchapterprefix}}{{{prefix}}}
\\begin{{document}}
\\section{{Floor, retold}}\\label{{sec:chap-floor}}
Theorem~\\ref{{thm:foo}}: the answer is 42 [verified], imported from the paper.
\\begin{{theorem}}[Foo]\\label{{thm:foo}}
The statement of foo.
\\end{{theorem}}
{extra}\\end{{document}}
"""


def textbook_json(prefix: str = "tc", chapter_source: str = "whitepaper/testchap.tex") -> str:
    return json.dumps({
        "$schema": "./textbook.schema.json",
        "edition": {"title": "Test Edition"},
        "parts": [],
        "chapters": [
            {
                "number": 1,
                "id": "testchap",
                "prefix": prefix,
                "title": "Test Chapter",
                "source": chapter_source,
            }
        ],
    })


def index_json(entries: list[dict], allow: list[dict] | None = None) -> str:
    return json.dumps({
        "$schema": "./library-index.schema.json",
        "version": 1,
        "entries": entries,
        "unindexed_allow": allow or [],
    })


def base_entry(**overrides) -> dict:
    entry = {
        "id": "TEST1",
        "kind": "theorem",
        "title": "The answer is 42",
        "one_breath": "The answer is 42.",
        "standalone": {
            "file": "docs/harbor-research/tex/paper1.tex",
            "labels": ["sec:floor"],
            "sections": ["S1"],
        },
        "chapters": [
            {
                "file": "whitepaper/testchap.tex",
                "chapter": 1,
                "prefix": "tc",
                "labels": ["thm:foo"],
                "sections": ["S1"],
            }
        ],
        "figures": [],
        "scripts": [],
        "numbers": [
            {"name": "the_answer", "value": "42", "tag": "verified", "regex": r"42"},
        ],
        "mechanization": [],
        "site": [],
        "status": "folded",
    }
    entry.update(overrides)
    return entry


class FixtureRepo:
    """A minimal repo tree the checker can run against via --repo-root."""

    def __init__(self, tmp: Path, *, with_twin_headers: bool = True,
                 paper_extra: str = "", chapter_extra: str = "",
                 chapter_prefix: str = "tc", textbook_prefix: str = "tc"):
        self.root = tmp
        write(tmp / "whitepaper" / "textbook.json", textbook_json(prefix=textbook_prefix))
        write(
            tmp / "docs" / "harbor-research" / "tex" / "paper1.tex",
            PAPER1_BODY.format(header=TWIN_HEADER if with_twin_headers else "", extra=paper_extra),
        )
        write(
            tmp / "whitepaper" / "testchap.tex",
            CHAPTER_BODY.format(
                header=TWIN_HEADER if with_twin_headers else "",
                extra=chapter_extra,
                prefix=chapter_prefix,
            ),
        )

    def write_index(self, entries: list[dict], allow: list[dict] | None = None) -> None:
        write(self.root / "docs" / "harbor-research" / "library-index.json", index_json(entries, allow))


def run_checker(repo_root: Path, *extra_args: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, str(CHECKER), "--repo-root", str(repo_root), *extra_args],
        capture_output=True, text=True,
    )


class TestHappyPath(unittest.TestCase):
    def test_clean_fixture_passes(self) -> None:
        with TemporaryDirectory() as tmp:
            repo = FixtureRepo(Path(tmp))
            repo.write_index([base_entry()])
            result = run_checker(repo.root)
            self.assertEqual(result.returncode, 0, msg=result.stdout + result.stderr)
            self.assertIn("CHECK (a) existence: 0 failure", result.stdout)
            self.assertIn("CHECK (b) coverage: 0 failure", result.stdout)
            self.assertIn("CHECK (c) drift: 0 failure", result.stdout)
            self.assertIn("CHECK (d) twin header: 0 failure", result.stdout)
            self.assertIn("CHECK (e) chapter prefix: 0 failure", result.stdout)


class TestCheckA_Existence(unittest.TestCase):
    def test_missing_label_fails(self) -> None:
        with TemporaryDirectory() as tmp:
            repo = FixtureRepo(Path(tmp))
            entry = base_entry()
            entry["standalone"]["labels"] = ["sec:does-not-exist"]
            repo.write_index([entry])
            result = run_checker(repo.root)
            self.assertEqual(result.returncode, 1)
            self.assertIn("sec:does-not-exist", result.stdout)
            self.assertIn("not found in", result.stdout)

    def test_missing_file_fails(self) -> None:
        with TemporaryDirectory() as tmp:
            repo = FixtureRepo(Path(tmp))
            entry = base_entry()
            entry["chapters"][0]["file"] = "whitepaper/does-not-exist.tex"
            repo.write_index([entry])
            result = run_checker(repo.root)
            self.assertEqual(result.returncode, 1)
            self.assertIn("does not exist", result.stdout)

    def test_missing_script_path_fails(self) -> None:
        with TemporaryDirectory() as tmp:
            repo = FixtureRepo(Path(tmp))
            entry = base_entry(scripts=["skills/harbor-results/scripts/nope.py"])
            repo.write_index([entry])
            result = run_checker(repo.root)
            self.assertEqual(result.returncode, 1)
            self.assertIn("scripts path does not exist", result.stdout)


class TestCheckB_Coverage(unittest.TestCase):
    def test_unclaimed_label_fails(self) -> None:
        with TemporaryDirectory() as tmp:
            repo = FixtureRepo(
                Path(tmp),
                chapter_extra="\\begin{definition}[Stray]\\label{def:stray}\nx\n\\end{definition}\n",
            )
            repo.write_index([base_entry()])
            result = run_checker(repo.root)
            self.assertEqual(result.returncode, 1)
            self.assertIn("def:stray", result.stdout)
            self.assertIn("not claimed", result.stdout)

    def test_unclaimed_label_passes_when_allow_listed(self) -> None:
        with TemporaryDirectory() as tmp:
            repo = FixtureRepo(
                Path(tmp),
                chapter_extra="\\begin{definition}[Stray]\\label{def:stray}\nx\n\\end{definition}\n",
            )
            repo.write_index(
                [base_entry()],
                allow=[{"id": "def:stray", "file": "whitepaper/testchap.tex", "reason": "test fixture stray def"}],
            )
            result = run_checker(repo.root)
            self.assertEqual(result.returncode, 0, msg=result.stdout)

    def test_unlabeled_environment_fails(self) -> None:
        with TemporaryDirectory() as tmp:
            repo = FixtureRepo(
                Path(tmp),
                chapter_extra="\\begin{lemma}[No label here]\nx\n\\end{lemma}\n",
            )
            repo.write_index([base_entry()])
            result = run_checker(repo.root)
            self.assertEqual(result.returncode, 1)
            self.assertIn("has no \\label", result.stdout)
            self.assertIn("unlabeled-env:whitepaper/testchap.tex:", result.stdout)

    def test_unlabeled_environment_passes_when_allow_listed_by_synthetic_id(self) -> None:
        with TemporaryDirectory() as tmp:
            repo = FixtureRepo(
                Path(tmp),
                chapter_extra="\\begin{lemma}[No label here]\nx\n\\end{lemma}\n",
            )
            # The lemma opens right after the \end{theorem} block that CHAPTER_BODY
            # already contains, plus the blank \begin{document} etc. -- rather than
            # hardcode the exact line number (fragile), discover it from the file.
            chapter_text = (repo.root / "whitepaper" / "testchap.tex").read_text()
            line_no = next(
                i for i, line in enumerate(chapter_text.splitlines(), start=1)
                if line.startswith("\\begin{lemma}")
            )
            synthetic_id = f"unlabeled-env:whitepaper/testchap.tex:{line_no}"
            repo.write_index(
                [base_entry()],
                allow=[{"id": synthetic_id, "file": "whitepaper/testchap.tex", "reason": "test fixture, no label allowed"}],
            )
            result = run_checker(repo.root)
            self.assertEqual(result.returncode, 0, msg=result.stdout)


class TestCheckC_Drift(unittest.TestCase):
    def test_number_missing_from_chapter_fails(self) -> None:
        with TemporaryDirectory() as tmp:
            # Chapter body's own template already prints "42"; overwrite it away.
            repo = FixtureRepo(Path(tmp))
            chapter_path = repo.root / "whitepaper" / "testchap.tex"
            chapter_path.write_text(chapter_path.read_text().replace("42", "forty-two"))
            repo.write_index([base_entry()])
            result = run_checker(repo.root)
            self.assertEqual(result.returncode, 1)
            self.assertIn("drift:", result.stdout)
            self.assertIn("not found in chapter", result.stdout)

    def test_invalid_regex_is_reported_not_crashed(self) -> None:
        with TemporaryDirectory() as tmp:
            repo = FixtureRepo(Path(tmp))
            entry = base_entry()
            entry["numbers"][0]["regex"] = "(unclosed["
            repo.write_index([entry])
            result = run_checker(repo.root)
            self.assertEqual(result.returncode, 1)
            self.assertIn("not a valid Python regex", result.stdout)


class TestCheckD_TwinHeader(unittest.TestCase):
    def test_missing_header_on_both_files_fails(self) -> None:
        with TemporaryDirectory() as tmp:
            repo = FixtureRepo(Path(tmp), with_twin_headers=False)
            repo.write_index([base_entry()])
            result = run_checker(repo.root)
            self.assertEqual(result.returncode, 1)
            self.assertIn("twin-header:", result.stdout)
            self.assertIn("TWIN-LOCATION NOTICE", result.stdout)

    def test_header_present_but_missing_partner_name_fails(self) -> None:
        with TemporaryDirectory() as tmp:
            repo = FixtureRepo(Path(tmp))
            # Corrupt paper1's header so it no longer names its chapter partner.
            paper_path = repo.root / "docs" / "harbor-research" / "tex" / "paper1.tex"
            paper_path.write_text(
                paper_path.read_text().replace("whitepaper/testchap.tex", "whitepaper/somewhere-else.tex")
            )
            repo.write_index([base_entry()])
            result = run_checker(repo.root)
            self.assertEqual(result.returncode, 1)
            self.assertIn("does not name its partner", result.stdout)

    def test_header_present_but_missing_index_id_fails(self) -> None:
        with TemporaryDirectory() as tmp:
            repo = FixtureRepo(Path(tmp))
            paper_path = repo.root / "docs" / "harbor-research" / "tex" / "paper1.tex"
            paper_path.write_text(paper_path.read_text().replace("TEST1", "SOMETHING-ELSE"))
            repo.write_index([base_entry()])
            result = run_checker(repo.root)
            self.assertEqual(result.returncode, 1)
            self.assertIn("does not list index id", result.stdout)

    def test_standalone_only_entry_needs_no_header(self) -> None:
        with TemporaryDirectory() as tmp:
            repo = FixtureRepo(Path(tmp), with_twin_headers=False)
            entry = base_entry(chapters=[], status="standalone-only")
            # The fixture chapter file still carries \label{thm:foo} even though
            # this entry no longer claims it (chapters=[]); allow it explicitly
            # so this test isolates check (d), not check (b).
            repo.write_index(
                [entry],
                allow=[{"id": "thm:foo", "file": "whitepaper/testchap.tex", "reason": "unused in this fixture"}],
            )
            result = run_checker(repo.root)
            self.assertEqual(result.returncode, 0, msg=result.stdout)
            self.assertIn("CHECK (d) twin header: 0 failure", result.stdout)


class TestCheckE_ChapterPrefix(unittest.TestCase):
    def test_prefix_mismatch_with_textbook_fails(self) -> None:
        with TemporaryDirectory() as tmp:
            repo = FixtureRepo(Path(tmp), chapter_prefix="tc")
            entry = base_entry()
            entry["chapters"][0]["prefix"] = "wrong"
            repo.write_index([entry])
            result = run_checker(repo.root)
            self.assertEqual(result.returncode, 1)
            self.assertIn("prefix:", result.stdout)

    def test_pdchapterprefix_macro_mismatch_fails(self) -> None:
        with TemporaryDirectory() as tmp:
            # Chapter file declares a different \pdchapterprefix than textbook.json.
            repo = FixtureRepo(Path(tmp), chapter_prefix="oops", textbook_prefix="tc")
            entry = base_entry()  # entry still claims "tc", matching textbook.json
            repo.write_index([entry])
            result = run_checker(repo.root)
            self.assertEqual(result.returncode, 1)
            self.assertIn("\\pdchapterprefix is 'oops'", result.stdout)


class TestMarkdown(unittest.TestCase):
    def test_write_then_check_md_is_fresh(self) -> None:
        with TemporaryDirectory() as tmp:
            repo = FixtureRepo(Path(tmp))
            repo.write_index([base_entry()])
            written = run_checker(repo.root, "--write-md")
            self.assertEqual(written.returncode, 0, msg=written.stdout)
            md_path = repo.root / "docs" / "harbor-research" / "LIBRARY-INDEX.md"
            self.assertTrue(md_path.exists())
            self.assertIn("TEST1", md_path.read_text())
            checked = run_checker(repo.root, "--check-md")
            self.assertEqual(checked.returncode, 0, msg=checked.stdout)

    def test_check_md_fails_when_stale(self) -> None:
        with TemporaryDirectory() as tmp:
            repo = FixtureRepo(Path(tmp))
            repo.write_index([base_entry()])
            run_checker(repo.root, "--write-md")
            # Change the index (retitle the entry) without regenerating the MD.
            entry = base_entry(title="A different title now")
            repo.write_index([entry])
            checked = run_checker(repo.root, "--check-md")
            self.assertEqual(checked.returncode, 1)
            self.assertIn("stale", checked.stdout)

    def test_check_md_fails_when_missing(self) -> None:
        with TemporaryDirectory() as tmp:
            repo = FixtureRepo(Path(tmp))
            repo.write_index([base_entry()])
            checked = run_checker(repo.root, "--check-md")
            self.assertEqual(checked.returncode, 1)
            self.assertIn("does not exist", checked.stdout)


class TestMalformedIndex(unittest.TestCase):
    def test_invalid_json_is_a_clean_fatal_error(self) -> None:
        with TemporaryDirectory() as tmp:
            repo = FixtureRepo(Path(tmp))
            write(repo.root / "docs" / "harbor-research" / "library-index.json", "{not valid json")
            result = run_checker(repo.root)
            self.assertEqual(result.returncode, 1)
            self.assertIn("not valid JSON", result.stderr)

    def test_duplicate_entry_id_is_a_clean_fatal_error(self) -> None:
        with TemporaryDirectory() as tmp:
            repo = FixtureRepo(Path(tmp))
            repo.write_index([base_entry(), base_entry()])
            result = run_checker(repo.root)
            self.assertEqual(result.returncode, 1)
            self.assertIn("duplicate entry id", result.stderr)


if __name__ == "__main__":
    unittest.main()
