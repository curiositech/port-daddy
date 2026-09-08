#!/usr/bin/env python3
"""Unit tests for the margin apparatus's text parsing.

Two adversarial reviews of PR #10092 said the same thing: roughly 1,250 lines
of new Python surgically rewrite the paper sources -- author-list parsing,
year-vs-arXiv-id disambiguation, title truncation, brace balancing, protected
spans around \\cite -- and none of it had a test. That is exactly the logic
that fails silently on an input it has not seen: a surname with two particles,
an entry whose only four-digit run is a DOI, a bibliography that is never
closed. Nothing crashes; the margin note is just quietly wrong.

These tests exercise the parsing directly, on inputs chosen because they are
the cases a hand-written bibliography actually contains. One of them found a
real defect on the way in: last_word() walked back over one name particle, so
"van der Waals" came out as "der Waals".

stdlib-only, like the rest of tests/harbor-research.

Run:
    python3 -m unittest discover -s tests/harbor-research
"""
from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = REPO_ROOT / "scripts" / "harbor-research"


def load(name: str):
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


shortforms = load("build_cite_shortforms")
promote = load("promote_cites")


class TestSurnames(unittest.TestCase):
    def test_a_plain_surname_is_the_last_word(self) -> None:
        self.assertEqual(shortforms.last_word("Leslie Lamport"), "Lamport")
        self.assertEqual(shortforms.last_word("E. Ostrom"), "Ostrom")

    def test_short_surnames_are_not_mistaken_for_initials(self) -> None:
        """Wu, Li and He are real surnames; the abbreviation rule is about a
        SINGLE letter before a period, deliberately, and this is the case that
        would break if it ever widened to "any short word"."""
        for name in ("C. Wu", "J. Li", "K. He"):
            self.assertEqual(shortforms.last_word(name), name.split()[-1])

    def test_one_particle_stays_with_the_surname(self) -> None:
        self.assertEqual(shortforms.last_word("Ludwig van Beethoven"), "van Beethoven")
        self.assertEqual(shortforms.last_word("Vincent van Gogh"), "van Gogh")

    def test_two_particles_both_stay(self) -> None:
        """The defect these tests were written for: walking back exactly one
        particle drops the head of a two-particle surname."""
        self.assertEqual(shortforms.last_word("van der Waals"), "van der Waals")
        self.assertEqual(shortforms.last_word("Ada de la Cruz"), "de la Cruz")

    def test_a_name_that_is_only_particles_is_not_consumed(self) -> None:
        """The walk-back is index-guarded, so it cannot run off the front."""
        self.assertEqual(shortforms.last_word("de"), "de")
        self.assertEqual(shortforms.last_word("van der"), "van der")


class TestAuthorLists(unittest.TestCase):
    def test_one_author(self) -> None:
        self.assertEqual(shortforms.parse_authors("E. Ostrom"), "Ostrom")

    def test_two_authors_join_with_an_escaped_ampersand(self) -> None:
        """A bare & is an alignment tab outside a tabular and would break the
        margin note the moment it is typeset."""
        self.assertEqual(
            shortforms.parse_authors("Leslie Lamport and Robert Shostak"),
            "Lamport \\& Shostak")

    def test_three_or_more_authors_become_et_al(self) -> None:
        self.assertEqual(
            shortforms.parse_authors("A. Smith, B. Jones, and C. Wu"), "Smith et al.")

    def test_an_explicit_et_al_keeps_the_first_surname(self) -> None:
        self.assertEqual(
            shortforms.parse_authors("R. Parasuraman et al."), "Parasuraman et al.")

    def test_a_latex_tie_does_not_glue_initial_to_surname(self) -> None:
        self.assertEqual(shortforms.parse_authors("J.~Meseguer"), "Meseguer")

    def test_a_title_in_markup_is_not_an_author_list(self) -> None:
        self.assertIsNone(shortforms.parse_authors("\\emph{Governing the Commons}"))
        self.assertIsNone(shortforms.parse_authors("\\url{https://example.org}"))

    def test_a_lowercase_opening_is_not_an_author_list(self) -> None:
        self.assertIsNone(shortforms.parse_authors("proceedings of the ..."))


class TestYear(unittest.TestCase):
    def test_the_last_plain_four_digit_run_wins(self) -> None:
        self.assertEqual(
            shortforms.find_year("A. Author. Title. Venue, pages 100--1200, 1987."),
            "1987")

    def test_an_arxiv_id_is_not_a_year(self) -> None:
        """1710.09437 contains a run that looks exactly like a year."""
        self.assertEqual(
            shortforms.find_year("A. Author. Title. arXiv:1710.09437, 2017."), "2017")

    def test_a_parenthetical_aside_does_not_supply_a_later_year(self) -> None:
        self.assertEqual(
            shortforms.find_year(
                "Author. Title. Venue, 1971. (With Green \\& Porter, Econometrica 1984.)"),
            "1971")

    def test_a_year_only_inside_the_aside_is_still_found(self) -> None:
        self.assertEqual(
            shortforms.find_year("Author. Title. (Econometrica 1984.)"), "1984")

    def test_no_year_at_all(self) -> None:
        self.assertIsNone(shortforms.find_year("Author. Title. Venue."))


class TestAuthorBoundary(unittest.TestCase):
    def test_initials_do_not_end_the_author_list(self) -> None:
        flat = "J. C. Smith. Title. Venue, 1999."
        self.assertEqual(flat[:shortforms.find_author_boundary(flat)], "J. C. Smith.")

    def test_et_al_ends_the_author_list(self) -> None:
        flat = "R. Parasuraman et al. Title. Venue, 2000."
        self.assertEqual(flat[:shortforms.find_author_boundary(flat)],
                         "R. Parasuraman et al.")

    def test_eds_does_not_end_the_author_list(self) -> None:
        flat = "A. Smith (eds.). Title. Venue, 2001."
        self.assertTrue(
            flat[:shortforms.find_author_boundary(flat)].startswith("A. Smith (eds.)"))

    def test_no_period_at_all_falls_back_to_the_whole_string(self) -> None:
        flat = "A Smith Title Venue 2001"
        self.assertEqual(shortforms.find_author_boundary(flat), len(flat))


class TestProtectedSpans(unittest.TestCase):
    """\\cite must not be promoted inside a bibliography, a caption, a
    footnote, a heading, or another margin note's own argument."""

    def promoted(self, text: str) -> str:
        return promote.promote(text, "t.tex")[0]

    def test_a_plain_cite_is_promoted(self) -> None:
        self.assertEqual(self.promoted("prose \\cite{k} more"), "prose \\pdcite{k} more")

    def test_a_cite_with_an_optional_note_is_left_alone(self) -> None:
        """\\pdcite's signature has no room for a citation note."""
        self.assertEqual(self.promoted("prose \\cite[p. 4]{k}"), "prose \\cite[p. 4]{k}")

    def test_a_cite_inside_a_caption_is_left_alone(self) -> None:
        self.assertEqual(self.promoted("\\caption{after \\cite{k}}"),
                         "\\caption{after \\cite{k}}")

    def test_a_cite_inside_a_footnote_is_left_alone(self) -> None:
        self.assertEqual(self.promoted("\\footnote{see \\cite{k}}"),
                         "\\footnote{see \\cite{k}}")

    def test_a_cite_in_a_heading_is_left_alone(self) -> None:
        self.assertEqual(self.promoted("\\section{On \\cite{k}}"),
                         "\\section{On \\cite{k}}")

    def test_a_cite_inside_the_bibliography_is_left_alone(self) -> None:
        text = ("body \\cite{a}\n\\begin{thebibliography}{9}\n"
                "\\bibitem{b} see \\cite{b}\n\\end{thebibliography}\n")
        out = self.promoted(text)
        self.assertIn("body \\pdcite{a}", out)
        self.assertIn("see \\cite{b}", out)

    def test_a_cite_inside_a_margin_macro_is_left_alone(self) -> None:
        """Margin material cannot nest: a \\pdcite issued from inside a
        \\pdgloss would put two independent boxes on the same source line."""
        self.assertEqual(self.promoted("\\pdgloss{term}{gloss \\cite{k}}"),
                         "\\pdgloss{term}{gloss \\cite{k}}")

    def test_an_unclosed_bibliography_is_an_error_not_a_silent_skip(self) -> None:
        """It used to protect everything after it, so a typo'd \\end quietly
        promoted nothing from that line to the end of the chapter."""
        with self.assertRaises(promote.UnterminatedBibliography):
            promote.protected_spans("a\n\\begin{thebibliography}{9}\n\\bibitem{x}y\n", "t.tex")

    def test_the_error_names_the_source_and_the_line(self) -> None:
        try:
            promote.protected_spans("one\ntwo\n\\begin{thebibliography}{9}\n", "ch.tex")
        except promote.UnterminatedBibliography as err:
            self.assertIn("ch.tex:3", str(err))
        else:                                        # pragma: no cover
            self.fail("expected UnterminatedBibliography")

    def test_promotion_is_idempotent(self) -> None:
        once = self.promoted("prose \\cite{k}")
        self.assertEqual(self.promoted(once), once)


class TestBraceBalance(unittest.TestCase):
    def test_balanced_and_unbalanced(self) -> None:
        self.assertTrue(shortforms.is_brace_balanced("a {b} c"))
        self.assertFalse(shortforms.is_brace_balanced("a {b c"))
        self.assertFalse(shortforms.is_brace_balanced("a b} c"))

    def test_an_escaped_brace_is_counted_too_which_is_deliberate(self) -> None:
        """This is a net under the heuristics, not a LaTeX parser: it counts
        every brace, so a shortform carrying a literal \\{ is rejected even
        though LaTeX would accept it. Refusing a row is the safe direction --
        the alternative is emitting one the typesetter cannot brace-match --
        and the corpus's shortforms are surnames, years and title fragments,
        where a literal brace does not arise."""
        self.assertFalse(shortforms.is_brace_balanced("a \\{ b"))


if __name__ == "__main__":
    unittest.main()
