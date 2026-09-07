#!/usr/bin/env python3
"""Fixture-based tests for skills/tufte-evidence-design/scripts/margin_lint.py.

stdlib-only (unittest, tempfile, subprocess), same pattern as
test_check_marginalia_sidecars.py: each test builds a small, self-contained
fixture repo under a tempdir (one chapter .tex file, and a
website-v2/public/whitepaper/plates/marginalia/ directory when the fixture
needs a plate) and runs the real checker against it with --repo-root, so
these tests exercise the actual CLI a developer or CI runs.

Run:
    python3 -m unittest discover -s tests/harbor-research
    python3 tests/harbor-research/test_margin_lint.py
"""
from __future__ import annotations

import json
import subprocess
import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

REPO_ROOT = Path(__file__).resolve().parents[2]
CHECKER = REPO_ROOT / "skills" / "tufte-evidence-design" / "scripts" / "margin_lint.py"
PLATES_REL = Path("website-v2") / "public" / "whitepaper" / "plates" / "marginalia"

VALID_SIDECAR = {
    "subject": "Test Subject",
    "commons_file_page": "https://commons.wikimedia.org/wiki/File:Test.jpg",
    "original_url": "https://upload.wikimedia.org/wikipedia/commons/t/te/Test.jpg",
    "sha1": "a" * 40,
    "width": 400,
    "height": 500,
    "artist": "Test Artist",
    "credit": "Own work",
    "licence_short": "CC BY-SA 4.0",
    "licence_url": "https://creativecommons.org/licenses/by-sa/4.0",
    "attribution_required": True,
    "usage_terms": "Creative Commons Attribution-Share Alike 4.0",
    "retrieved": "2026-09-07",
    "crop": "no crop applied; used at full frame",
}


def write_chapter(repo: Path, name: str, text: str) -> Path:
    path = repo / name
    path.write_text(text, encoding="utf-8")
    return path


def write_plate(repo: Path, slug: str, sidecar: dict | None) -> None:
    plates_dir = repo / PLATES_REL
    plates_dir.mkdir(parents=True, exist_ok=True)
    (plates_dir / f"{slug}.jpg").write_bytes(b"\xff\xd8\xff\xd9")
    if sidecar is not None:
        (plates_dir / f"{slug}.json").write_text(json.dumps(sidecar), encoding="utf-8")


def run_checker(repo_root: Path, files: list[Path], extra: list[str] | None = None) -> subprocess.CompletedProcess:
    argv = [sys.executable, str(CHECKER), *[str(f) for f in files], "--repo-root", str(repo_root)]
    if extra:
        argv += extra
    return subprocess.run(argv, capture_output=True, text=True)


class TestOnePortraitPerSection(unittest.TestCase):
    def test_one_per_section_passes(self) -> None:
        with TemporaryDirectory() as tmp:
            repo = Path(tmp)
            write_plate(repo, "lampson", VALID_SIDECAR)
            write_plate(repo, "wonham", VALID_SIDECAR)
            chapter = write_chapter(repo, "ch.tex", (
                "\\section{Intro}\n"
                "This idea is Lampson's access matrix, load-bearing here.\n"
                "\\pdmarginfigure{lampson}{Lampson's access matrix.}%\n\n"
                "\\section{Later}\n"
                "This idea is Wonham's supervisory control theory, load-bearing here.\n"
                "\\pdmarginfigure{wonham}{Wonham's supervisory control.}%\n"
            ))
            result = run_checker(repo, [chapter])
            self.assertEqual(result.returncode, 0, msg=result.stdout + result.stderr)

    def test_two_in_one_section_fails(self) -> None:
        with TemporaryDirectory() as tmp:
            repo = Path(tmp)
            write_plate(repo, "lampson", VALID_SIDECAR)
            write_plate(repo, "wonham", VALID_SIDECAR)
            chapter = write_chapter(repo, "ch.tex", (
                "\\section{Intro}\n"
                "This idea is Lampson's access matrix, load-bearing here.\n"
                "\\pdmarginfigure{lampson}{Lampson's access matrix.}%\n\n"
                "This idea is Wonham's supervisory control theory, load-bearing here too.\n"
                "\\pdmarginfigure{wonham}{Wonham's supervisory control.}%\n"
            ))
            result = run_checker(repo, [chapter])
            self.assertEqual(result.returncode, 1)
            self.assertIn("one-portrait-per-section", result.stdout)


class TestMarginaliaSidecar(unittest.TestCase):
    def test_missing_plate_fails(self) -> None:
        with TemporaryDirectory() as tmp:
            repo = Path(tmp)
            chapter = write_chapter(repo, "ch.tex", (
                "\\section{Intro}\n"
                "This idea is Lampson's access matrix, load-bearing here.\n"
                "\\pdmarginfigure{lampson}{Lampson's access matrix.}%\n"
            ))
            result = run_checker(repo, [chapter])
            self.assertEqual(result.returncode, 1)
            self.assertIn("marginalia-has-sidecar", result.stdout)
            self.assertIn("has no plate", result.stdout)

    def test_plate_with_broken_sidecar_fails(self) -> None:
        with TemporaryDirectory() as tmp:
            repo = Path(tmp)
            bad_sidecar = dict(VALID_SIDECAR)
            del bad_sidecar["artist"]
            write_plate(repo, "lampson", bad_sidecar)
            chapter = write_chapter(repo, "ch.tex", (
                "\\section{Intro}\n"
                "This idea is Lampson's access matrix, load-bearing here.\n"
                "\\pdmarginfigure{lampson}{Lampson's access matrix.}%\n"
            ))
            result = run_checker(repo, [chapter])
            self.assertEqual(result.returncode, 1)
            self.assertIn("marginalia-has-sidecar", result.stdout)
            self.assertIn("missing required field 'artist'", result.stdout)

    def test_complete_plate_and_sidecar_passes(self) -> None:
        with TemporaryDirectory() as tmp:
            repo = Path(tmp)
            write_plate(repo, "lampson", VALID_SIDECAR)
            chapter = write_chapter(repo, "ch.tex", (
                "\\section{Intro}\n"
                "This idea is Lampson's access matrix, load-bearing here.\n"
                "\\pdmarginfigure{lampson}{Lampson's access matrix.}%\n"
            ))
            result = run_checker(repo, [chapter])
            self.assertEqual(result.returncode, 0, msg=result.stdout + result.stderr)


class TestGlossOncePerChapter(unittest.TestCase):
    def test_single_gloss_passes(self) -> None:
        with TemporaryDirectory() as tmp:
            repo = Path(tmp)
            chapter = write_chapter(repo, "ch.tex", (
                "\\section{Intro}\n"
                "The swarm uses \\pdgloss{Stigmergy}{coordination through traces left in the "
                "environment.} inline, in a real sentence about the mechanism.\n"
            ))
            result = run_checker(repo, [chapter])
            self.assertEqual(result.returncode, 0, msg=result.stdout + result.stderr)

    def test_repeated_gloss_fails(self) -> None:
        with TemporaryDirectory() as tmp:
            repo = Path(tmp)
            chapter = write_chapter(repo, "ch.tex", (
                "\\section{Intro}\n"
                "The swarm uses \\pdgloss{Stigmergy}{coordination through traces left in the "
                "environment.} inline, in a real sentence about the mechanism.\n\n"
                "Later the chapter repeats itself and calls \\pdgloss{Stigmergy}{a second, "
                "redundant definition of the same term.} again in running prose.\n"
            ))
            result = run_checker(repo, [chapter])
            self.assertEqual(result.returncode, 1)
            self.assertIn("gloss-once-per-chapter", result.stdout)

    def test_case_insensitive_repeat_fails(self) -> None:
        with TemporaryDirectory() as tmp:
            repo = Path(tmp)
            chapter = write_chapter(repo, "ch.tex", (
                "\\section{Intro}\n"
                "The swarm uses \\pdgloss{Stigmergy}{coordination through traces left in the "
                "environment.} inline, in a real sentence about the mechanism.\n\n"
                "Later the chapter uses \\pdgloss{stigmergy}{a second, lowercase repeat of the "
                "same term.} again in running prose.\n"
            ))
            result = run_checker(repo, [chapter])
            self.assertEqual(result.returncode, 1)
            self.assertIn("gloss-once-per-chapter", result.stdout)


class TestGlossInRunningProse(unittest.TestCase):
    def test_gloss_in_sentence_passes(self) -> None:
        with TemporaryDirectory() as tmp:
            repo = Path(tmp)
            chapter = write_chapter(repo, "ch.tex", (
                "\\section{Intro}\n"
                "The swarm uses \\pdgloss{Stigmergy}{coordination through traces left in the "
                "environment.} inline, in a real sentence about the mechanism it relies on.\n"
            ))
            result = run_checker(repo, [chapter])
            self.assertEqual(result.returncode, 0, msg=result.stdout + result.stderr)

    def test_gloss_alone_in_paragraph_fails(self) -> None:
        with TemporaryDirectory() as tmp:
            repo = Path(tmp)
            chapter = write_chapter(repo, "ch.tex", (
                "\\section{Intro}\n"
                "Some introductory prose sits here first.\n\n"
                "\\pdgloss{Isolated}{a term with no surrounding prose in its own paragraph.}\n\n"
                "More prose continues after it.\n"
            ))
            result = run_checker(repo, [chapter])
            self.assertEqual(result.returncode, 1)
            self.assertIn("gloss-in-running-prose", result.stdout)


class TestFootnoteAdvisory(unittest.TestCase):
    def test_footnote_is_reported_but_does_not_fail(self) -> None:
        with TemporaryDirectory() as tmp:
            repo = Path(tmp)
            chapter = write_chapter(repo, "ch.tex", (
                "\\section{Intro}\n"
                "A claim needs provenance.\\footnote{A standalone version of this section is "
                "elsewhere.}\n"
            ))
            result = run_checker(repo, [chapter])
            self.assertEqual(result.returncode, 0, msg=result.stdout + result.stderr)
            self.assertIn("no-footnote-in-body", result.stdout)
            self.assertIn("ADVISORY", result.stdout)


class TestJsonOutput(unittest.TestCase):
    def test_json_flag_emits_parseable_list(self) -> None:
        with TemporaryDirectory() as tmp:
            repo = Path(tmp)
            chapter = write_chapter(repo, "ch.tex", (
                "\\section{Intro}\n"
                "A claim needs provenance.\\footnote{A standalone version of this section is "
                "elsewhere.}\n"
            ))
            result = run_checker(repo, [chapter], extra=["--json"])
            self.assertEqual(result.returncode, 0)
            findings = json.loads(result.stdout)
            self.assertEqual(len(findings), 1)
            self.assertEqual(findings[0]["rule"], "no-footnote-in-body")
            self.assertEqual(findings[0]["severity"], "advisory")


class TestCleanChapterPasses(unittest.TestCase):
    def test_no_macros_at_all_passes(self) -> None:
        with TemporaryDirectory() as tmp:
            repo = Path(tmp)
            chapter = write_chapter(repo, "ch.tex", (
                "\\section{Intro}\n"
                "Plain prose with no margin apparatus at all.\n"
            ))
            result = run_checker(repo, [chapter])
            self.assertEqual(result.returncode, 0, msg=result.stdout + result.stderr)
            self.assertIn("no findings", result.stdout)


if __name__ == "__main__":
    unittest.main()
