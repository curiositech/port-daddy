#!/usr/bin/env python3
"""Unit tests for the two margin-apparatus generators that had none.

The first round of tests here (test_margin_apparatus_parsers.py) covered
build_cite_shortforms.py and promote_cites.py, and three reviews then said the
same thing about what it left out: promote_provenance.py is the one script in
the set that rewrites committed chapter prose on a heuristic -- a backward
paragraph search for the nearest number, a tie-break between several scripts,
a seed pulled out of a file head -- and its own docstring says a wrong match
"silently flips verified/internal". That is exactly the failure the tests were
written to catch, and it was the file left uncovered.

The `--check` gate in CI proves only that re-running the script reproduces what
is committed. It cannot tell you a fresh match would be RIGHT: a rule that
matches the wrong paragraph matches it just as reproducibly. These tests are
about the match itself.

build_discharge_pointers.py is lower risk -- a hand-curated table plus a label
existence check -- but its namespacing and its four refusal paths decide
whether a "Proved on p. N" pointer resolves at all, so they are pinned too.

stdlib-only, like the rest of tests/harbor-research.

Run:
    python3 -m unittest discover -s tests/harbor-research
"""
from __future__ import annotations

import importlib.util
import os
import tempfile
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = REPO_ROOT / "scripts" / "harbor-research"


def load(name: str):
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


provenance = load("promote_provenance")
discharges = load("build_discharge_pointers")


def entry(entry_id: str, scripts: list[str], numbers: list[dict],
          chapter: str = "ch.tex") -> dict:
    return {
        "id": entry_id,
        "scripts": scripts,
        "numbers": numbers,
        "chapters": [{"file": chapter}],
    }


def number(name: str, regex: str, tag: str = "verified") -> dict:
    return {"name": name, "regex": regex, "tag": tag}


class BalancedGroupTests(unittest.TestCase):
    def test_a_nested_group_closes_at_its_own_brace(self) -> None:
        text = "\\texttt{a {b} c} tail"
        self.assertEqual(text[:provenance.balanced_group_end(text, 7)],
                         "\\texttt{a {b} c}")

    def test_an_escaped_brace_does_not_close_the_group(self) -> None:
        text = "\\texttt{a \\{ b} tail"
        self.assertEqual(text[:provenance.balanced_group_end(text, 7)],
                         "\\texttt{a \\{ b}")

    def test_an_unclosed_group_runs_to_the_end_rather_than_overrunning(self) -> None:
        text = "\\texttt{never closed"
        self.assertEqual(provenance.balanced_group_end(text, 7), len(text))


class TexttSpanTests(unittest.TestCase):
    def test_a_tag_inside_texttt_is_protected(self) -> None:
        text = "prose \\texttt{r1 [verified] ok} more"
        spans = provenance.texttt_spans(text)
        self.assertTrue(provenance.in_any_span(text.index("[verified]"), spans))

    def test_a_tag_after_the_texttt_closes_is_not(self) -> None:
        text = "\\texttt{quoted} then [verified]"
        spans = provenance.texttt_spans(text)
        self.assertFalse(provenance.in_any_span(text.index("[verified]"), spans))


class ParagraphStartTests(unittest.TestCase):
    def test_the_search_stops_at_the_blank_line_above(self) -> None:
        text = "first para\n\nsecond para [verified]"
        start = provenance.paragraph_start(text, text.index("[verified]"))
        self.assertEqual(text[start:].split(" [")[0], "second para")

    def test_with_no_blank_line_the_window_is_bounded(self) -> None:
        """A tag in a chapter's opening paragraph must not drag the whole
        chapter in as its search window."""
        text = "x" * 5000 + " [verified]"
        start = provenance.paragraph_start(text, text.index("[verified]"))
        self.assertEqual(start, text.index("[verified]") - provenance.SEARCH_WINDOW)


class ScriptSeedTests(unittest.TestCase):
    def test_a_seed_in_the_script_head_is_used(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "r.py"
            path.write_text("# seed: 20250101\nimport random\n", encoding="utf-8")
            rel = os.path.relpath(path, provenance.REPO_ROOT)
            self.assertEqual(provenance.script_seed(rel, {}), "20250101")

    def test_a_script_that_is_not_there_falls_back_to_the_house_seed(self) -> None:
        self.assertEqual(provenance.script_seed("no/such/script.py", {}),
                         provenance.DEFAULT_SEED)

    def test_the_cache_is_consulted_before_the_disk(self) -> None:
        cache = {"anything.py": "19991231"}
        self.assertEqual(provenance.script_seed("anything.py", cache), "19991231")


class PickScriptTests(unittest.TestCase):
    def test_one_script_is_never_ambiguous(self) -> None:
        self.assertEqual(
            provenance.pick_script(entry("R1", ["a/b1_tower.py"], []), "tower gain"),
            ("a/b1_tower.py", False))

    def test_a_name_word_shared_with_the_filename_decides(self) -> None:
        picked, ambiguous = provenance.pick_script(
            entry("R1", ["a/b1_tower.py", "a/b2_escalation.py"], []), "escalation band")
        self.assertEqual(picked, "a/b2_escalation.py")
        self.assertFalse(ambiguous)

    def test_no_shared_word_takes_the_first_and_says_so(self) -> None:
        """The caller prints that line as a warning, which is the point: a
        silent first-of-several pick is how the wrong script gets cited."""
        picked, ambiguous = provenance.pick_script(
            entry("R1", ["a/b1_tower.py", "a/b2_escalation.py"], []), "5.98 bits")
        self.assertEqual(picked, "a/b1_tower.py")
        self.assertTrue(ambiguous)

    def test_no_scripts_at_all_is_reported_as_no_script(self) -> None:
        self.assertEqual(provenance.pick_script(entry("R3", [], []), "anything"),
                         ("", False))


class FindMatchTests(unittest.TestCase):
    def test_the_nearest_preceding_number_wins(self) -> None:
        text = "the floor is 5.98 bits and the gain is 2.13x [verified]"
        candidates = [
            entry("R1", ["a/floor.py"], [number("floor", r"5\.98")]),
            entry("R2", ["a/gain.py"], [number("gain", r"2\.13")]),
        ]
        found = provenance.find_match(text, text.index("[verified]"), "verified", candidates)
        self.assertEqual(found[0]["id"], "R2")

    def test_a_number_whose_tag_disagrees_is_not_matched(self) -> None:
        """A number the index calls [internal] cannot vouch for a [verified]
        tag; matching it anyway is how the two would get swapped."""
        text = "the gain is 2.13x [verified]"
        candidates = [entry("R2", ["a/gain.py"],
                            [number("gain", r"2\.13", tag="internal")])]
        self.assertIsNone(
            provenance.find_match(text, text.index("[verified]"), "verified", candidates))

    def test_a_nearer_entry_with_no_script_yields_to_a_farther_one_with_one(self) -> None:
        text = "the floor is 5.98 bits and the ratio is 6/105 [verified]"
        candidates = [
            entry("R1", ["a/floor.py"], [number("floor", r"5\.98")]),
            entry("R3", [], [number("ratio", r"6/105")]),
        ]
        found = provenance.find_match(text, text.index("[verified]"), "verified", candidates)
        self.assertEqual(found[0]["id"], "R1")

    def test_a_number_in_the_paragraph_above_is_out_of_reach(self) -> None:
        text = "the floor is 5.98 bits\n\na different point [verified]"
        candidates = [entry("R1", ["a/floor.py"], [number("floor", r"5\.98")])]
        self.assertIsNone(
            provenance.find_match(text, text.index("[verified]"), "verified", candidates))

    def test_an_unparseable_regex_is_skipped_not_raised(self) -> None:
        text = "the floor is 5.98 bits [verified]"
        candidates = [
            entry("BAD", ["a/x.py"], [number("bad", r"(unclosed")]),
            entry("R1", ["a/floor.py"], [number("floor", r"5\.98")]),
        ]
        found = provenance.find_match(text, text.index("[verified]"), "verified", candidates)
        self.assertEqual(found[0]["id"], "R1")


class PromoteTests(unittest.TestCase):
    INDEX = {"entries": [entry("R1", ["skills/harbor-results/scripts/a7_experiment.py"],
                               [number("floor", r"5\.98")])]}

    def promote(self, text: str):
        return provenance.promote(text, "ch.tex", self.INDEX, {"skills/harbor-results/scripts/a7_experiment.py": "20260816"})

    def test_a_matched_tag_becomes_a_margin_note(self) -> None:
        out, replaced, left = self.promote("the floor is 5.98 bits [verified]")
        self.assertEqual(replaced, 1)
        self.assertEqual(left, [])
        self.assertIn("\\pdprov{a7\\_experiment.py}{20260816}{verified}", out)

    def test_the_underscore_is_escaped_because_pdprov_sets_it_in_texttt(self) -> None:
        """A bare _ there is LaTeX's subscript operator outside math mode."""
        out, _replaced, _left = self.promote("the floor is 5.98 bits [verified]")
        self.assertNotIn("{a7_experiment.py}", out)

    def test_a_tag_in_quoted_script_output_is_left_with_a_reason(self) -> None:
        out, replaced, left = self.promote(
            "the floor is 5.98 bits \\texttt{run: 5.98 [verified]}")
        self.assertEqual(replaced, 0)
        self.assertIn("[verified]", out)
        self.assertEqual(len(left), 1)
        self.assertIn("texttt", left[0])

    def test_an_unmatched_tag_is_left_with_its_line_number(self) -> None:
        out, replaced, left = self.promote("one\ntwo\nno number here [internal]")
        self.assertEqual(replaced, 0)
        self.assertIn("[internal]", out)
        self.assertIn("ch.tex:3", left[0])

    def test_promotion_is_idempotent(self) -> None:
        once, _r, _l = self.promote("the floor is 5.98 bits [verified]")
        twice, replaced, _l = self.promote(once)
        self.assertEqual(twice, once)
        self.assertEqual(replaced, 0)

    def test_a_chapter_the_index_claims_nothing_for_is_left_alone(self) -> None:
        out, replaced, left = provenance.promote(
            "the floor is 5.98 bits [verified]", "other.tex", self.INDEX, {})
        self.assertEqual(replaced, 0)
        self.assertIn("[verified]", out)
        self.assertEqual(len(left), 1)


class LabelExistsTests(unittest.TestCase):
    def test_a_label_prefix_is_not_a_label(self) -> None:
        """\\label{thm:tower} must not be found by a lookup for thm:tow --
        the regex is anchored on the closing brace for exactly this reason."""
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "ch.tex"
            path.write_text("\\begin{theorem}\\label{thm:tower}\n", encoding="utf-8")
            rel = os.path.relpath(path, discharges.REPO_ROOT)
            self.assertTrue(discharges.label_exists(rel, "thm:tower"))
            self.assertFalse(discharges.label_exists(rel, "thm:tow"))

    def test_a_source_that_is_not_there_has_no_labels(self) -> None:
        self.assertFalse(discharges.label_exists("no/such/chapter.tex", "thm:x"))


class BuildDischargeTests(unittest.TestCase):
    """build() reads the real textbook.json and the real chapter sources; only
    PAIRS is swapped, so the namespacing and the refusals are exercised against
    the corpus they actually run on."""

    def setUp(self) -> None:
        self.original = discharges.PAIRS

    def tearDown(self) -> None:
        discharges.PAIRS = self.original

    def first_real_pair(self):
        self.assertTrue(self.original, "PAIRS is empty; nothing to exercise")
        return self.original[0]

    @staticmethod
    def rows(body: str) -> list[str]:
        """Emitted entries only. The generated header explains the macro by
        naming it, so a naive substring count is one too many."""
        return [line for line in body.splitlines()
                if line.startswith("\\pdprovedonentry")]

    def test_the_committed_pairs_all_resolve(self) -> None:
        body, errors = discharges.build()
        self.assertEqual(errors, [])
        self.assertEqual(len(self.rows(body)), len(self.original))

    def test_the_target_label_is_namespaced_with_the_target_chapter_prefix(self) -> None:
        pair = self.first_real_pair()
        _promise_id, promise_label, target_id, target_label, _kind, _evidence = pair
        textbook = discharges.load_textbook()
        prefix = discharges.chapter_by_id(textbook)[target_id]["prefix"]
        discharges.PAIRS = [pair]
        body, errors = discharges.build()
        self.assertEqual(errors, [])
        self.assertIn(f"\\pdprovedonentry{{{promise_label}}}"
                      f"{{{prefix}:{target_label}}}", body)

    def test_an_unknown_chapter_id_is_an_error_not_a_row(self) -> None:
        pair = list(self.first_real_pair())
        pair[2] = "no-such-chapter"
        discharges.PAIRS = [tuple(pair)]
        body, errors = discharges.build()
        self.assertEqual(self.rows(body), [])
        self.assertIn("unknown chapter id", errors[0])

    def test_an_unknown_kind_is_an_error_not_a_row(self) -> None:
        pair = list(self.first_real_pair())
        pair[4] = "paragraph"
        discharges.PAIRS = [tuple(pair)]
        body, errors = discharges.build()
        self.assertEqual(self.rows(body), [])
        self.assertIn("unknown kind", errors[0])

    def test_a_label_that_has_moved_is_an_error_not_a_dangling_pointer(self) -> None:
        """The whole point of the existence check: a renamed \\label must stop
        the build rather than emit a pointer that resolves to nothing."""
        pair = list(self.first_real_pair())
        pair[3] = "thm:renamed-away"
        discharges.PAIRS = [tuple(pair)]
        body, errors = discharges.build()
        self.assertEqual(self.rows(body), [])
        self.assertIn("not found", errors[0])


if __name__ == "__main__":
    unittest.main()
