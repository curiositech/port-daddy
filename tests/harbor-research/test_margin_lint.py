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


class TestNonPortraitMarginFiguresUnlimited(unittest.TestCase):
    """Only a \\pdmarginfigure whose slug resolves under plates/marginalia/
    counts as a portrait; any number of other margin figures (small
    multiples, sparklines, regime strips) is fine in one section -- they
    only ever get the advisory line-distance warning, never a hard failure,
    since no plate exists to check either."""

    def test_two_non_portraits_in_one_section_passes_with_advisory(self) -> None:
        with TemporaryDirectory() as tmp:
            repo = Path(tmp)
            # No plates/marginalia/*.jpg written for these slugs at all --
            # they cannot resolve as portraits.
            chapter = write_chapter(repo, "ch.tex", (
                "\\section{Intro}\n"
                "A first regime strip appears here.\n"
                "\\pdmarginfigure{regime-strip-a}{A small regime strip.}%\n"
                "A second one appears close by.\n"
                "\\pdmarginfigure{regime-strip-b}{Another small regime strip.}%\n"
            ))
            result = run_checker(repo, [chapter])
            self.assertEqual(result.returncode, 0, msg=result.stdout + result.stderr)
            self.assertNotIn("one-portrait-per-section", result.stdout)
            self.assertIn("margin-figures-may-collide", result.stdout)
            self.assertIn("ADVISORY", result.stdout)

    def test_far_apart_non_portraits_pass_with_no_findings(self) -> None:
        with TemporaryDirectory() as tmp:
            repo = Path(tmp)
            filler = "\n".join(f"Filler prose line {i}." for i in range(20))
            chapter = write_chapter(repo, "ch.tex", (
                "\\section{Intro}\n"
                "\\pdmarginfigure{regime-strip-a}{A small regime strip.}%\n"
                f"{filler}\n"
                "\\pdmarginfigure{regime-strip-b}{Another small regime strip, far away.}%\n"
            ))
            result = run_checker(repo, [chapter])
            self.assertEqual(result.returncode, 0, msg=result.stdout + result.stderr)
            self.assertIn("no findings", result.stdout)


class TestMarginFiguresMayCollide(unittest.TestCase):
    def test_two_portraits_close_together_get_both_findings(self) -> None:
        with TemporaryDirectory() as tmp:
            repo = Path(tmp)
            write_plate(repo, "lampson", VALID_SIDECAR)
            write_plate(repo, "wonham", VALID_SIDECAR)
            chapter = write_chapter(repo, "ch.tex", (
                "\\section{Intro}\n"
                "This idea is Lampson's access matrix, load-bearing here.\n"
                "\\pdmarginfigure{lampson}{Lampson's access matrix.}%\n"
                "This idea is Wonham's supervisory control theory, load-bearing here too.\n"
                "\\pdmarginfigure{wonham}{Wonham's supervisory control.}%\n"
            ))
            result = run_checker(repo, [chapter], extra=["--json"])
            findings = json.loads(result.stdout)
            rules = {f["rule"] for f in findings}
            self.assertIn("one-portrait-per-section", rules)
            self.assertIn("margin-figures-may-collide", rules)


class TestMarginaliaSidecar(unittest.TestCase):
    def test_slug_with_no_plate_is_treated_as_non_portrait_not_flagged(self) -> None:
        """A \\pdmarginfigure whose slug has no plate at all cannot be told
        apart, mechanically, from an intentional non-portrait margin figure
        (a small multiple, sparkline, or regime strip) that was never meant
        to resolve under plates/marginalia/ in the first place -- the
        coordinator's own definition of "portrait" IS "resolves under
        plates/marginalia/". This matches the real \\pdmarginfigure macro's
        own behavior too: it silently no-ops when the file doesn't exist,
        rather than erroring. The trade-off (a genuinely mistyped or
        forgotten portrait slug goes uncaught) is accepted and documented in
        margin_lint.py's own docstring."""
        with TemporaryDirectory() as tmp:
            repo = Path(tmp)
            chapter = write_chapter(repo, "ch.tex", (
                "\\section{Intro}\n"
                "This idea is Lampson's access matrix, load-bearing here.\n"
                "\\pdmarginfigure{lampson}{Lampson's access matrix.}%\n"
            ))
            result = run_checker(repo, [chapter])
            self.assertEqual(result.returncode, 0, msg=result.stdout + result.stderr)
            self.assertNotIn("marginalia-has-sidecar", result.stdout)

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


class TestGlossNotRepeated(unittest.TestCase):
    """The programme is a gloss at the FIRST use of every house term, so a
    chapter may carry many distinct glosses; the defect is the SAME term
    glossed twice."""

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

    def test_three_distinct_glosses_pass(self) -> None:
        with TemporaryDirectory() as tmp:
            repo = Path(tmp)
            chapter = write_chapter(repo, "ch.tex", (
                "\\section{Intro}\n"
                "The swarm uses \\pdgloss{Stigmergy}{coordination through traces left in the "
                "environment.} to coordinate.\n\n"
                "Later it relies on \\pdgloss{Digest}{a compressed summary of shared state.} "
                "for compaction.\n\n"
                "Finally the operator watches for \\pdgloss{Read-poverty}{the binding "
                "information constraint at scale.} directly.\n"
            ))
            result = run_checker(repo, [chapter])
            self.assertEqual(result.returncode, 0, msg=result.stdout + result.stderr)
            self.assertNotIn("gloss-not-repeated", result.stdout)

    def test_repeated_gloss_fails(self) -> None:
        with TemporaryDirectory() as tmp:
            repo = Path(tmp)
            chapter = write_chapter(repo, "ch.tex", (
                "\\section{Intro}\n"
                "The swarm uses \\pdgloss{Stigmergy}{coordination through traces left in the "
                "environment.} inline, in a real sentence about the mechanism.\n\n"
                "Later the chapter repeats itself and calls \\pdgloss{Stigmergy}{a second, "
                "redundant definition of the same term.} again about stigmergy.\n"
            ))
            result = run_checker(repo, [chapter])
            self.assertEqual(result.returncode, 1)
            self.assertIn("gloss-not-repeated", result.stdout)

    def test_case_insensitive_repeat_fails(self) -> None:
        with TemporaryDirectory() as tmp:
            repo = Path(tmp)
            chapter = write_chapter(repo, "ch.tex", (
                "\\section{Intro}\n"
                "The swarm uses \\pdgloss{Stigmergy}{coordination through traces left in the "
                "environment.} inline, in a real sentence about the mechanism.\n\n"
                "Later the chapter uses \\pdgloss{stigmergy}{a second, lowercase repeat of the "
                "same term.} again about stigmergy.\n"
            ))
            result = run_checker(repo, [chapter])
            self.assertEqual(result.returncode, 1)
            self.assertIn("gloss-not-repeated", result.stdout)

    def test_markup_stripped_repeat_fails(self) -> None:
        with TemporaryDirectory() as tmp:
            repo = Path(tmp)
            chapter = write_chapter(repo, "ch.tex", (
                "\\section{Intro}\n"
                "The swarm uses \\pdgloss{Stigmergy}{coordination through traces left in the "
                "environment.} inline, in a real sentence about the mechanism.\n\n"
                "Later the chapter uses \\pdgloss{\\emph{Stigmergy}}{a second definition wrapped "
                "in emphasis markup.} again about stigmergy.\n"
            ))
            result = run_checker(repo, [chapter])
            self.assertEqual(result.returncode, 1)
            self.assertIn("gloss-not-repeated", result.stdout)


class TestGlossTermInPriorProse(unittest.TestCase):
    def test_normal_gloss_call_passes(self) -> None:
        with TemporaryDirectory() as tmp:
            repo = Path(tmp)
            chapter = write_chapter(repo, "ch.tex", (
                "\\section{Intro}\n"
                "The swarm uses \\pdgloss{Stigmergy}{coordination through traces left in the "
                "environment.} to coordinate its markers.\n"
            ))
            result = run_checker(repo, [chapter])
            self.assertEqual(result.returncode, 0, msg=result.stdout + result.stderr)
            self.assertNotIn("gloss-term-in-prior-prose", result.stdout)

    def test_empty_term_fails(self) -> None:
        with TemporaryDirectory() as tmp:
            repo = Path(tmp)
            chapter = write_chapter(repo, "ch.tex", (
                "\\section{Intro}\n"
                "This sentence carries a blank gloss label \\pdgloss{}{a definition with no "
                "term attached to it at all.} for no reason.\n"
            ))
            result = run_checker(repo, [chapter])
            self.assertEqual(result.returncode, 1)
            self.assertIn("gloss-term-in-prior-prose", result.stdout)


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


class TestProvedOnResolves(unittest.TestCase):
    """\\pdprovedon looks its label up in a generated table and, finding
    nothing, sets a blank margin note -- no error, no warning, just a "Proved
    on p. N" pointer that silently is not there. The generator already fails
    closed on the other direction (an entry whose target label has moved), so
    this rule closes the pair."""

    DISCHARGES_REL = Path("website-v2") / "public" / "whitepaper" / "figures" / "pd-discharges.tex"

    def write_discharges(self, repo: Path, labels: list[str]) -> None:
        path = repo / self.DISCHARGES_REL
        path.parent.mkdir(parents=True, exist_ok=True)
        body = "\n".join(
            f"\\pdprovedonentry{{{label}}}{{ap:thm:x}}{{thm}}" for label in labels)
        path.write_text("% GENERATED\n\n" + body + "\n", encoding="utf-8")

    def test_a_pointer_with_an_entry_passes(self) -> None:
        with TemporaryDirectory() as tmp:
            repo = Path(tmp)
            self.write_discharges(repo, ["thm:kernel-promise"])
            chapter = write_chapter(repo, "ch.tex", (
                "\\section{Intro}\n"
                "The kernel leaves this open.\\pdprovedon{thm:kernel-promise}\n"
            ))
            result = run_checker(repo, [chapter])
            self.assertEqual(result.returncode, 0, msg=result.stdout + result.stderr)
            self.assertNotIn("provedon-resolves", result.stdout)

    def test_a_pointer_with_no_entry_fails_the_build(self) -> None:
        with TemporaryDirectory() as tmp:
            repo = Path(tmp)
            self.write_discharges(repo, ["thm:some-other-promise"])
            chapter = write_chapter(repo, "ch.tex", (
                "\\section{Intro}\n"
                "The kernel leaves this open.\\pdprovedon{thm:renamed-away}\n"
            ))
            result = run_checker(repo, [chapter])
            self.assertEqual(result.returncode, 1, msg=result.stdout + result.stderr)
            self.assertIn("provedon-resolves", result.stdout)
            self.assertIn("thm:renamed-away", result.stdout)

    def test_a_missing_table_does_not_excuse_a_pointer(self) -> None:
        """No pd-discharges.tex at all means no entry resolves, which is the
        same defect and must not read as "nothing to check"."""
        with TemporaryDirectory() as tmp:
            repo = Path(tmp)
            chapter = write_chapter(repo, "ch.tex", (
                "\\section{Intro}\n"
                "The kernel leaves this open.\\pdprovedon{thm:kernel-promise}\n"
            ))
            result = run_checker(repo, [chapter])
            self.assertEqual(result.returncode, 1, msg=result.stdout + result.stderr)
            self.assertIn("provedon-resolves", result.stdout)


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
