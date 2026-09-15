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

# margin_lint.py's margin-carries-the-caption rule (margin-apparatus.md section
# 3): a chapter that puts a \pdmarginfigure in the margin and NOTHING else has
# an empty margin apparatus with decoration in it, and fails. Portraits are the
# margin's sixth-priority device; a caption is its first. So every fixture
# whose subject is a margin figure carries one real first-priority device
# beside it, exactly as a well-formed chapter does -- otherwise the fixture is
# not a chapter the Book would accept and the rule under test is being
# exercised on a shape the doctrine forbids.
#
# The sentence states a claim rather than naming a subject, so it does not trip
# caption-states-a-claim either.
CARRIED_CAPTION = (
    "\\pdmargincaption{Throughput stays flat until the queue crosses eight "
    "writers, then falls linearly.}%\n"
)


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
                "\\pdmarginfigure{lampson}{Lampson's access matrix.}%\n"
                + CARRIED_CAPTION +
                "\n"
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
                + CARRIED_CAPTION
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
                + CARRIED_CAPTION
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
                + CARRIED_CAPTION
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
                + CARRIED_CAPTION
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
                + CARRIED_CAPTION
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


class TestMarginCarriesTheCaption(unittest.TestCase):
    r"""margin-apparatus.md section 3 orders the margin's claims: captions,
    sidenotes, short-form citations, small explanatory graphics, glosses, and
    portraits LAST. A chapter using the margin for the sixth-priority device
    while the first five are all absent has an empty apparatus with decoration
    in it, and that is the defect margin_lint.py exists to catch.
    """

    def test_portrait_alone_in_the_margin_fails(self) -> None:
        with TemporaryDirectory() as tmp:
            repo = Path(tmp)
            write_plate(repo, "lampson", VALID_SIDECAR)
            chapter = write_chapter(repo, "ch.tex", (
                "\\section{Intro}\n"
                "This idea is Lampson's access matrix, load-bearing here.\n"
                "\\pdmarginfigure{lampson}{Lampson's access matrix.}%\n"
            ))
            result = run_checker(repo, [chapter])
            self.assertEqual(result.returncode, 1)
            self.assertIn("margin-carries-the-caption", result.stdout)

    def test_a_caption_beside_the_portrait_satisfies_it(self) -> None:
        with TemporaryDirectory() as tmp:
            repo = Path(tmp)
            write_plate(repo, "lampson", VALID_SIDECAR)
            chapter = write_chapter(repo, "ch.tex", (
                "\\section{Intro}\n"
                "This idea is Lampson's access matrix, load-bearing here.\n"
                "\\pdmarginfigure{lampson}{Lampson's access matrix.}%\n"
                + CARRIED_CAPTION
            ))
            result = run_checker(repo, [chapter])
            self.assertEqual(result.returncode, 0, msg=result.stdout + result.stderr)
            self.assertNotIn("margin-carries-the-caption", result.stdout)

    def test_a_sidenote_also_satisfies_it(self) -> None:
        with TemporaryDirectory() as tmp:
            repo = Path(tmp)
            write_plate(repo, "lampson", VALID_SIDECAR)
            chapter = write_chapter(repo, "ch.tex", (
                "\\section{Intro}\n"
                "This idea is Lampson's access matrix, load-bearing here.\n"
                "\\pdmarginfigure{lampson}{Lampson's access matrix.}%\n"
                "A claim carries its provenance.\\pdsidenote{Lampson 1971.}\n"
            ))
            result = run_checker(repo, [chapter])
            self.assertEqual(result.returncode, 0, msg=result.stdout + result.stderr)
            self.assertNotIn("margin-carries-the-caption", result.stdout)

    def test_a_chapter_with_no_margin_figure_is_not_reported(self) -> None:
        """The rule is about a margin used badly, not a margin left empty."""
        with TemporaryDirectory() as tmp:
            repo = Path(tmp)
            chapter = write_chapter(repo, "ch.tex", (
                "\\section{Intro}\nPlain prose, no margin apparatus.\n"
            ))
            result = run_checker(repo, [chapter])
            self.assertEqual(result.returncode, 0, msg=result.stdout + result.stderr)
            self.assertNotIn("margin-carries-the-caption", result.stdout)


class TestCaptionStatesAClaim(unittest.TestCase):
    r"""SKILL.md's checklist: every caption states the figure's CLAIM as a
    sentence, not a label. A script cannot parse English, but one shape of
    label is mechanically unmistakable -- a first sentence opening with an
    interrogative or relative word names the subject and asserts nothing.
    """

    def test_caption_opening_with_how_is_flagged(self) -> None:
        with TemporaryDirectory() as tmp:
            repo = Path(tmp)
            chapter = write_chapter(repo, "ch.tex", (
                "\\section{Intro}\n"
                "\\pdmargincaption{How the harbor economy sits relative to the nearest "
                "prior art on each axis.}\n"
            ))
            result = run_checker(repo, [chapter])
            self.assertEqual(result.returncode, 1)
            self.assertIn("caption-states-a-claim", result.stdout)

    def test_caption_stating_an_assertion_passes(self) -> None:
        with TemporaryDirectory() as tmp:
            repo = Path(tmp)
            chapter = write_chapter(repo, "ch.tex", (
                "\\section{Intro}\n" + CARRIED_CAPTION
            ))
            result = run_checker(repo, [chapter])
            self.assertEqual(result.returncode, 0, msg=result.stdout + result.stderr)

    def test_a_claim_that_merely_contains_a_label_word_passes(self) -> None:
        """The rule reads the FIRST word of the first sentence, not the
        caption's whole text -- "when" mid-sentence is ordinary English."""
        with TemporaryDirectory() as tmp:
            repo = Path(tmp)
            chapter = write_chapter(repo, "ch.tex", (
                "\\section{Intro}\n"
                "\\pdmargincaption{Latency doubles when the shard count passes four.}\n"
            ))
            result = run_checker(repo, [chapter])
            self.assertEqual(result.returncode, 0, msg=result.stdout + result.stderr)


class TestMarginGraphicFits(unittest.TestCase):
    r"""margin-apparatus.md section 3.4: the margin column is 1.3in, and a
    graphic wider than that is not a margin graphic. Redraw it smaller with
    fewer marks, or leave it in the column -- never scale a column figure
    down, which is legible at 4.5in and not at 1.3in.
    """

    def test_a_textwidth_graphic_in_the_margin_is_flagged(self) -> None:
        with TemporaryDirectory() as tmp:
            repo = Path(tmp)
            chapter = write_chapter(repo, "ch.tex", (
                "\\section{Intro}\n"
                "\\pdsidenote{\\includegraphics[width=0.9\\textwidth]{plot}}\n"
            ))
            result = run_checker(repo, [chapter])
            self.assertEqual(result.returncode, 1)
            self.assertIn("margin-graphic-fits", result.stdout)

    def test_a_graphic_drawn_to_the_margin_column_passes(self) -> None:
        with TemporaryDirectory() as tmp:
            repo = Path(tmp)
            chapter = write_chapter(repo, "ch.tex", (
                "\\section{Intro}\n"
                "\\pdsidenote{\\includegraphics[width=1.2in]{regime-strip}}\n"
            ))
            result = run_checker(repo, [chapter])
            self.assertEqual(result.returncode, 0, msg=result.stdout + result.stderr)


class TestCaptionInColumn(unittest.TestCase):
    r"""margin-apparatus.md section 3.1 makes a margin caption the default
    rather than the exception. Which captions are eligible is not re-derived
    in the lint: it asks captions_to_margin.py, so the converter and the lint
    can never disagree about what counts.
    """

    def test_a_figure_caption_left_in_the_column_is_flagged(self) -> None:
        with TemporaryDirectory() as tmp:
            repo = Path(tmp)
            chapter = write_chapter(repo, "ch.tex", (
                "\\section{Intro}\n"
                "\\begin{figure}\n"
                "\\includegraphics{plot}\n"
                "\\caption{Throughput falls linearly past eight writers.}\n"
                "\\end{figure}\n"
            ))
            result = run_checker(repo, [chapter])
            self.assertEqual(result.returncode, 1)
            self.assertIn("caption-in-column", result.stdout)

    def test_a_longtable_caption_is_exempt(self) -> None:
        r"""That \caption is longtable's own: it must sit in its own row and
        it heads a table that spans pages, so one margin block beside page one
        points at the wrong content. All seven captions still in the Book's
        text column are this shape."""
        with TemporaryDirectory() as tmp:
            repo = Path(tmp)
            chapter = write_chapter(repo, "ch.tex", (
                "\\section{Intro}\n"
                "\\begin{longtable}{ll}\n"
                "\\caption{Per-claim maturity against the reference daemon.}\\\\\n"
                "a & b\\\\\n"
                "\\end{longtable}\n"
            ))
            result = run_checker(repo, [chapter])
            self.assertEqual(result.returncode, 0, msg=result.stdout + result.stderr)
            self.assertNotIn("caption-in-column", result.stdout)


class TestFootnoteEnforced(unittest.TestCase):
    r"""no-footnote-in-body is ENFORCED, not advisory.

    It was advisory for one stated reason: margin-apparatus.md's Net
    comparison table recorded a numbered inline sidenote as "not implemented"
    in this repo, so rewriting a \footnote was an editorial call about where a
    provenance note should live, not a rename. \pdsidenote now exists in
    figures/pd-pedagogy.tex, so that reason is gone and the conversion is
    mechanical -- captions_to_margin.py --fix performs it. The rule fails the
    build accordingly.

    The exemption below is the part that must not regress: a footnote with no
    line of running prose beside it stays a footnote.
    """

    def test_footnote_beside_prose_fails(self) -> None:
        with TemporaryDirectory() as tmp:
            repo = Path(tmp)
            chapter = write_chapter(repo, "ch.tex", (
                "\\section{Intro}\n"
                "A claim needs provenance.\\footnote{A standalone version of this section is "
                "elsewhere.}\n"
            ))
            result = run_checker(repo, [chapter])
            self.assertEqual(result.returncode, 1, msg=result.stdout + result.stderr)
            self.assertIn("no-footnote-in-body", result.stdout)
            self.assertIn("[FAIL]", result.stdout)

    def test_footnote_in_a_heading_title_is_exempt(self) -> None:
        r"""A heading title is a moving argument -- it is written to the .toc
        and the .aux -- and a margin device expanded there ended the Book's
        build (100 "Missing \endcsname inserted" errors, a 360-page torso of
        the 549-page Book). The Book's one surviving \footnote is this shape.
        """
        with TemporaryDirectory() as tmp:
            repo = Path(tmp)
            chapter = write_chapter(repo, "ch.tex", (
                "\\section{Intro}\n"
                "\\subsubsection{Pricing Mechanism\\protect\\footnote{Contributed by a "
                "second author.}}\n"
                "Prose follows the heading.\n"
            ))
            result = run_checker(repo, [chapter])
            self.assertEqual(result.returncode, 0, msg=result.stdout + result.stderr)
            self.assertNotIn("no-footnote-in-body", result.stdout)

    def test_footnote_inside_a_float_is_exempt(self) -> None:
        r"""A margin note issued from inside a float box anchors to the float,
        not to the sentence, so it would point the reader at the wrong thing.
        """
        with TemporaryDirectory() as tmp:
            repo = Path(tmp)
            chapter = write_chapter(repo, "ch.tex", (
                "\\section{Intro}\n"
                "\\begin{table}\n"
                "\\pdmargincaption{Latency doubles once the shard count passes four.}\n"
                "\\begin{tabular}{ll}a & b\\footnote{A note with no prose beside it.}\\\\\n"
                "\\end{tabular}\n"
                "\\end{table}\n"
            ))
            result = run_checker(repo, [chapter])
            self.assertEqual(result.returncode, 0, msg=result.stdout + result.stderr)
            self.assertNotIn("no-footnote-in-body", result.stdout)


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
            self.assertEqual(result.returncode, 1)
            findings = json.loads(result.stdout)
            self.assertEqual(len(findings), 1)
            self.assertEqual(findings[0]["rule"], "no-footnote-in-body")
            self.assertEqual(findings[0]["severity"], "enforced")


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
