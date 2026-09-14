"""Tests for scripts/harbor-research/build_figure_desk.py and figure_doctrine.py.

The generator's whole claim is that the Figure Desk's data derives from the
repository rather than from someone's memory. These tests are what makes that
claim checkable:

  * the parsers are exercised on FIXTURES, not on the live corpus, so a change
    to the Book cannot turn a parser bug into a passing test;
  * the two identifier schemes the author's saved rulings hang off (a figure's
    fragment stem, and an undrawn candidate's pinned id) are asserted to be
    stable, because a silent change to either orphans a ruling;
  * --check is asserted to FAIL on a stale output, since a freshness check that
    cannot fail is worse than none at all.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SCRIPTS = os.path.join(REPO_ROOT, "scripts", "harbor-research")
sys.path.insert(0, SCRIPTS)

import build_figure_desk as B  # noqa: E402
import figure_doctrine as D  # noqa: E402
import palette_check as P  # noqa: E402


TRIAGE_FIXTURE = """\
# Figure triage

## Chapter 1 — The Single-Writer Kernel (3 sites, 2 figures)

| # | fragment | page's idea | what is drawn | role | disposition | new kind / spec |
|---|---|---|---|---|---|---|
| 1.1 | fig-alpha | the first idea | two bands | carries | **redraw** | *block diagram*, two rows |
| 1.2 | fig-beta | the second idea | a rail | supports | **keep** (labels bigger) | — |
| add | — | §1.4 widget decay: the worked example computes 0.9^t | — | — | **add** | *xy plot*: w(t) |

## Chapter 2 — The Anchor Protocol (2 sites, 2 figures)

| # | fragment | page's idea | what is drawn | role | disposition | new kind / spec |
|---|---|---|---|---|---|---|
| 2.1 | fig-gamma (shared with 3.1) | a shared idea | boxes | carries | **restyle** | keep; heavier edges |
| 2.2 | fig-delta | see 2.1 | — | — | **restyle** | — |

Shared figures (2.1/3.1, 1.1/4.4) are drawn once; the second chapter cross-references.
"""

PIXEL_FIXTURE = """\
# Pixel judgment

**A compiling, figcheck-clean figure earns nothing.** Seven figures in this Book
pass every mechanical gate the repository owns and are illegible, mislabelled or
wrong. The gates are a floor, not evidence.

551 pages, SHA-256 `%s`,
committed at `abc1234`.

## 1. Five findings that are not about any one figure

### 1.1 The first finding

A lede paragraph about the first finding.

A second paragraph.

- **7.7**: a bullet about a figure.
- **8.5**: another bullet.

```
a code block
```

### 1.2 The second finding

Just a lede.

## 2. The triage

### Chapter 1

| fig | fragment | page | the page's one idea | role | five-point rubric | measured | dataviz check | verdict | what the pixels show |
|---|---|---|---|---|---|---|---|---|---|
| 1.1 | `fig-alpha` | 19 | the first idea | supports | +fact +instance +anchored +contrast +collisions | min 8.72 pt | form ok | **keep** | Nothing collides. |
| 1.2 | `fig-beta` | 25 | the second idea | carries | +fact +instance +anchored -contrast -collisions | min 5.0 pt | this is a table | **redraw** | Labels collide; chartjunk everywhere. |
| 1.3 (new) | `fig-epsilon` | - | a new idea | carries | +fact +instance +anchored +contrast +collisions | min 8.5 pt | right form | **add** | **Added in this change.** |

## 3. Counts

| disposition | n | which |
|---|---|---|
| **keep** | 1 | 1.1 |
| **redraw** | 1 | **1.2** |
| **add** | 1 | 1.3 |
| *judged* | **2** | every figure in the Book |

## 4. Missing figures
""" % ("0" * 64)

REGISTER_FIXTURE = """\
# Figure register

## Register summary

| chapter | rows | must | should | could | no | existing figure | none yet | most under-served idea |
|---|---|---|---|---|---|---|---|---|
| 1 — The Single-Writer Kernel | 55 | 13 | 10 | 13 | 19 | 18 | 37 | The taint automaton has no figure. |
| 2 — The Anchor Protocol | 41 | 8 | 15 | 7 | 10 | 12 | 29 | The v6 attack has no chain diagram. |
| **total** | **96** | **21** | **25** | **20** | **29** | **30** | **66** | — |

## How to read a row
"""


class TriageParsing(unittest.TestCase):
    def setUp(self):
        self.triage, self.adds, self.shared = B.parse_triage(TRIAGE_FIXTURE)

    def test_rows_are_keyed_by_fragment_stem(self):
        self.assertIn("fig-alpha", self.triage)
        self.assertEqual(self.triage["fig-alpha"]["num"], "1.1")
        self.assertEqual(self.triage["fig-alpha"]["disposition"], "redraw")
        self.assertEqual(self.triage["fig-alpha"]["role"], "carries")

    def test_a_qualified_disposition_keeps_its_qualifier(self):
        # "keep (labels bigger)" must not become "keep": the desk shows the
        # whole cell, and dispBase() does the narrowing on the client.
        self.assertEqual(self.triage["fig-beta"]["disposition"], "keep (labels bigger)")

    def test_inline_shared_note_is_peeled_out_of_the_fragment_cell(self):
        # "fig-gamma (shared with 3.1)" is one cell; the id is the first token
        self.assertIn("fig-gamma", self.triage)
        self.assertNotIn("fig-gamma (shared with 3.1)", self.triage)
        self.assertEqual(self.triage["fig-gamma"]["inlineShare"], "3.1")

    def test_a_cross_reference_row_does_not_overwrite_the_primary(self):
        # row 2.2's idea is "see 2.1" -- it carries no content of its own
        self.assertNotIn("fig-delta", self.triage)

    def test_shared_pairs_are_read_from_the_shared_figures_line(self):
        self.assertEqual(self.shared.get("2.1"), "3.1")
        self.assertEqual(self.shared.get("3.1"), "2.1")
        self.assertEqual(self.shared.get("1.1"), "4.4")

    def test_add_rows_are_collected_separately(self):
        self.assertEqual(len(self.adds), 1)
        self.assertTrue(self.adds[0]["raw_idea"].startswith("§1.4 widget decay"))

    def test_a_table_with_no_shared_line_is_reported_not_guessed(self):
        B.PARSE_GAPS.clear()
        B.parse_triage(TRIAGE_FIXTURE.split("Shared figures")[0])
        self.assertTrue(any("Shared figures" in g for g in B.PARSE_GAPS))


class UndrawnIdentity(unittest.TestCase):
    """The id an undrawn candidate gets is what a saved ruling hangs off."""

    def test_the_natural_key_is_chapter_section_and_six_words(self):
        k = B.add_row_key(1, "§1.4", "widget decay: the worked example computes 0.9^t")
        self.assertEqual(k, "1|§1.4|widget-decay-the-worked-example-computes")

    def test_a_pinned_id_is_used_verbatim(self):
        _, adds, _ = B.parse_triage(TRIAGE_FIXTURE)
        pins = {"byKey": {"1|§1.4|widget-decay-the-worked-example-computes":
                          {"id": "undrawn-swk-widget-decay", "page": 37,
                           "pageNote": "beside fig-alpha"}}}
        undrawn, fulfilled = B.shape_add_rows(adds, [], pins)
        self.assertEqual([u["id"] for u in undrawn], ["undrawn-swk-widget-decay"])
        self.assertEqual(undrawn[0]["page"], 37)
        self.assertEqual(undrawn[0]["section"], "§1.4")
        self.assertEqual(undrawn[0]["kind"], "xy plot")

    def test_an_unpinned_row_is_reported_loudly_not_silently_renamed(self):
        B.PARSE_GAPS.clear()
        _, adds, _ = B.parse_triage(TRIAGE_FIXTURE)
        undrawn, _ = B.shape_add_rows(adds, [], {"byKey": {}})
        self.assertEqual(len(undrawn), 1)
        self.assertTrue(any("no pinned id" in g for g in B.PARSE_GAPS),
                        "an unpinned add-row must be reported: a ruling saved "
                        "under the old id would be orphaned")

    def test_a_pin_whose_row_vanished_is_reported_as_an_orphan(self):
        B.PARSE_GAPS.clear()
        _, adds, _ = B.parse_triage(TRIAGE_FIXTURE)
        pins = {"byKey": {"9|§9|a-row-that-no-longer-exists":
                          {"id": "undrawn-ghost", "page": None, "pageNote": None}}}
        B.shape_add_rows(adds, [], pins)
        self.assertTrue(any("undrawn-ghost" in g and "orphaned" in g for g in B.PARSE_GAPS))

    def test_a_fulfilled_add_row_leaves_the_undrawn_set(self):
        _, adds, _ = B.parse_triage(
            TRIAGE_FIXTURE.replace("widget decay", "stigmergic decay"))
        figs = [{"id": "fig-swk-marker-decay", "ch": 1}]
        undrawn, fulfilled = B.shape_add_rows(adds, figs, {"byKey": {}})
        self.assertEqual(undrawn, [])
        self.assertIn("fig-swk-marker-decay", fulfilled)

    def test_a_fulfilment_naming_a_missing_figure_is_reported(self):
        B.PARSE_GAPS.clear()
        _, adds, _ = B.parse_triage(
            TRIAGE_FIXTURE.replace("widget decay", "stigmergic decay"))
        B.shape_add_rows(adds, [], {"byKey": {}})
        self.assertTrue(any("not a figure" in g for g in B.PARSE_GAPS))


class PixelParsing(unittest.TestCase):
    def setUp(self):
        self.rows, self.cross = B.parse_pixel(PIXEL_FIXTURE)

    def test_rows_are_keyed_by_fragment_with_backticks_stripped(self):
        self.assertEqual(sorted(self.rows), ["fig-alpha", "fig-beta", "fig-epsilon"])

    def test_verdict_is_unbolded_and_lowercased(self):
        self.assertEqual(self.rows["fig-beta"]["verdict"], "redraw")

    def test_the_five_point_rubric_is_parsed_as_five_booleans(self):
        r = self.rows["fig-beta"]["rubric"]
        self.assertEqual(len(r), 5)
        self.assertTrue(r["fact"])
        self.assertFalse(r["contrast"])
        self.assertFalse(r["collisions"])

    def test_a_new_row_is_marked_new_and_its_number_cleaned(self):
        self.assertTrue(self.rows["fig-epsilon"]["isNew"])
        self.assertEqual(self.rows["fig-epsilon"]["num"], "1.3")

    def test_a_missing_page_becomes_none_not_zero(self):
        self.assertIsNone(self.rows["fig-epsilon"]["bookPage"])
        self.assertEqual(self.rows["fig-alpha"]["bookPage"], 19)

    def test_the_epigraph_survives_line_wrapping(self):
        self.assertTrue(self.cross["epigraph"].startswith("Seven figures in this Book"))
        self.assertTrue(self.cross["epigraph"].endswith("a floor, not evidence."))

    def test_findings_split_prose_bullets_and_blocks(self):
        f = self.cross["findings"][0]
        self.assertEqual(f["num"], "1.1")
        self.assertEqual(f["lede"], "A lede paragraph about the first finding.")
        self.assertEqual(len(f["bullets"]), 2)
        self.assertEqual(len(f["blocks"]), 1)

    def test_a_heading_that_disagrees_with_its_own_subsections_is_reported(self):
        B.PARSE_GAPS.clear()
        B.parse_pixel(PIXEL_FIXTURE)   # says "Five", has two
        self.assertTrue(any("heading says five findings" in g for g in B.PARSE_GAPS))

    def test_counts_are_unbolded(self):
        self.assertEqual(self.cross["counts"]["redraw"]["which"], "1.2")
        self.assertEqual(self.cross["judged"], 2)

    def test_provenance_is_lifted(self):
        self.assertEqual(self.cross["provenance"]["pages"], 551)
        self.assertEqual(self.cross["provenance"]["commit"], "abc1234")


class RegisterParsing(unittest.TestCase):
    def test_chapter_rows_and_totals(self):
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, B.REGISTER_REL)
            os.makedirs(os.path.dirname(p), exist_ok=True)
            with open(p, "w", encoding="utf-8") as fh:
                fh.write(REGISTER_FIXTURE)
            old, B.REPO_ROOT = B.REPO_ROOT, d
            try:
                reg = B.parse_register()
            finally:
                B.REPO_ROOT = old
        self.assertEqual(sorted(reg["chapters"]), ["1", "2"])
        self.assertEqual(reg["chapters"]["1"]["existing"], "18")
        self.assertEqual(reg["totals"]["rows"], "96")   # unbolded


class CaptionExtraction(unittest.TestCase):
    def test_balanced_braces_survive_nesting(self):
        body = r"\caption{A \emph{nested {group}} and more.}\label{fig:x}"
        self.assertEqual(B.first_caption(body), "A nested group and more.")

    def test_math_is_stripped_so_the_caption_matches_the_rendered_page(self):
        body = r"\caption{Marker weight $w(t)=r^{t}$ for two rates.}"
        self.assertEqual(B.first_caption(body), "Marker weight for two rates.")

    def test_label_and_ref_arguments_are_dropped(self):
        body = r"\caption{See \ref{fig:other} for the rest.}"
        self.assertEqual(B.first_caption(body), "See for the rest.")


class ChapterList(unittest.TestCase):
    def test_chapters_come_from_textbook_json_and_are_never_hard_coded(self):
        tb = {"chapters": [{"number": 2, "title": "The Anchor Protocol"},
                           {"number": 9, "title": "A Ninth Chapter"}]}
        self.assertEqual(B.build_chapters(tb), {"2": "Anchor Protocol", "9": "A Ninth Chapter"})

    def test_an_empty_chapter_list_is_reported(self):
        B.PARSE_GAPS.clear()
        B.build_chapters({"chapters": []})
        self.assertTrue(any("no chapters" in g for g in B.PARSE_GAPS))


class DoctrineRubric(unittest.TestCase):
    def test_every_criterion_names_a_source_and_an_evidence_kind(self):
        for c in D.CRITERIA:
            self.assertTrue(c["source"], c["id"])
            self.assertIn(c["evidence"], ("machine", "human", "open"), c["id"])

    def test_a_contested_criterion_names_who_objects(self):
        contested = [c for c in D.CRITERIA if c["contested"]]
        self.assertTrue(contested, "a rubric with nothing contested is claiming too much")
        for c in contested:
            self.assertTrue(c["objectors"], f"{c['id']} is contested but names no objector")

    def test_an_open_criterion_says_why_it_cannot_be_answered(self):
        for c in D.CRITERIA:
            if c["evidence"] == "open":
                self.assertTrue(c["openBecause"], c["id"])

    def test_the_counter_checks_are_present_and_point_at_their_pair(self):
        # over-erased must exist, or the ink doctrine is one-sided
        by = {c["id"]: c for c in D.CRITERIA}
        self.assertEqual(by["over-erased"]["counterCheckFor"], "decorative-ink")
        self.assertEqual(by["caption-carries-the-fact"]["counterCheckFor"],
                         "caption-states-a-claim")

    def test_criterion_ids_are_unique(self):
        ids = [c["id"] for c in D.CRITERIA]
        self.assertEqual(len(ids), len(set(ids)))

    def test_swiss_override_detection_reads_both_files(self):
        with tempfile.TemporaryDirectory() as d:
            for rel, text in (
                (D.BASE_REL, "pd focus fill/.style={fill=hhteal!24,draw=hhteal!65,line width=.4pt},\n"),
                (D.SWISS_REL, "pd focus fill/.append style={fill=x!22,draw=none},\n"
                              "pd state/.append style={fill=y,draw=hhink},\n"),
            ):
                p = os.path.join(d, rel)
                os.makedirs(os.path.dirname(p), exist_ok=True)
                with open(p, "w", encoding="utf-8") as fh:
                    fh.write(text)
            out = D.swiss_edgeless_styles(d)
        # only the style actually set to draw=none is reported
        self.assertEqual(sorted(out), ["pd focus fill"])
        self.assertEqual(out["pd focus fill"]["baseAskedFor"], "hhteal!65")

    def test_chapter_colours_come_from_the_parts(self):
        tb = {"parts": [{"color": "pdcobalt", "chapters": ["a", "b"]},
                        {"color": "pdteal", "chapters": ["c"]}],
              "chapters": [{"id": "a", "number": 1}, {"id": "b", "number": 2},
                           {"id": "c", "number": 3}]}
        self.assertEqual(D.chapter_colours(tb), {1: "pdcobalt", 2: "pdcobalt", 3: "pdteal"})

    def test_doctrine_vs_lenses_only_fires_when_a_lens_said_keep(self):
        scores = {"f1": {"over-erased": {"verdict": "fails", "evidence": ""}},
                  "f2": {"over-erased": {"verdict": "fails", "evidence": ""}},
                  "f3": {"over-erased": {"verdict": "passes", "evidence": ""}}}
        crit = {"f1": {"lensA": {"verdict": "keep"}, "lensB": {"verdict": "redraw"}},
                "f2": {"lensA": {"verdict": "redraw"}},
                "f3": {"lensA": {"verdict": "keep"}}}
        out = D.doctrine_vs_lenses(scores, crit)
        self.assertEqual(sorted(out), ["f1"])
        self.assertEqual(out["f1"]["lensesSaidKeep"], ["lensA"])


class PaletteCheck(unittest.TestCase):
    def test_audit_is_silent_and_returns_data(self):
        a = P.audit()
        self.assertEqual(a["counts"]["pairs"], 21)
        self.assertEqual(a["counts"]["fail"] + a["counts"]["floorOnly"] + a["counts"]["clear"], 21)

    def test_a_colour_does_not_fail_against_itself(self):
        for p in P.audit()["pairs"]:
            self.assertNotEqual(p["a"], p["b"])

    def test_the_two_named_failures_are_reproduced(self):
        pairs = {frozenset((p["a"], p["b"])): p for p in P.audit()["pairs"]}
        teal_health = pairs[frozenset(("pdteal", "pdhealth"))]
        self.assertLess(teal_health["normal"], 15)
        self.assertTrue(teal_health["verdict"].startswith("fail"))
        cob_ind = pairs[frozenset(("pdcobalt", "pdindigo"))]
        self.assertLess(cob_ind["normal"], 15)

    def test_delta_e_is_symmetric_and_zero_on_identity(self):
        c = P.hex2rgb("#003FB8")
        self.assertAlmostEqual(P.dE(c, c), 0.0, places=6)
        d = P.hex2rgb("#006B5F")
        self.assertAlmostEqual(P.dE(c, d), P.dE(d, c), places=9)


class GeneratedOutputsAreFresh(unittest.TestCase):
    """The committed desk data must match a fresh render, and --check must be
    able to say so. A freshness check that cannot fail is worse than none."""

    def test_check_passes_on_the_committed_tree(self):
        r = subprocess.run(
            [sys.executable, os.path.join(SCRIPTS, "build_figure_desk.py"), "--check"],
            capture_output=True, text=True, cwd=REPO_ROOT)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)

    def test_check_fails_when_a_generated_file_is_stale(self):
        target = os.path.join(REPO_ROOT, B.DATA_DIR, "CHAPTERS.js")
        with open(target, encoding="utf-8") as fh:
            original = fh.read()
        try:
            with open(target, "w", encoding="utf-8") as fh:
                fh.write(original.replace("window.CHAPTERS=", "window.CHAPTERS=/*edited*/"))
            r = subprocess.run(
                [sys.executable, os.path.join(SCRIPTS, "build_figure_desk.py"), "--check"],
                capture_output=True, text=True, cwd=REPO_ROOT)
            self.assertEqual(r.returncode, 1,
                             "--check accepted a hand-edited generated file")
            self.assertIn("CHAPTERS.js", r.stderr)
        finally:
            with open(target, "w", encoding="utf-8") as fh:
                fh.write(original)


class CommittedIdentitiesAreStable(unittest.TestCase):
    """The two id schemes the author's saved rulings hang off. A change to
    either orphans a ruling in the artifact's db, so it must be deliberate."""

    def _load(self, name):
        p = os.path.join(REPO_ROOT, B.DATA_DIR, name + ".js")
        with open(p, encoding="utf-8") as fh:
            text = fh.read()
        return json.loads(text[text.index("=") + 1:].rstrip().rstrip(";"))

    def test_every_figure_id_is_its_fragment_stem(self):
        for f in self._load("FIGS"):
            self.assertEqual(f["id"], os.path.splitext(os.path.basename(f["src"]))[0])

    def test_every_undrawn_id_is_pinned_and_starts_with_undrawn(self):
        p = os.path.join(REPO_ROOT, B.UNDRAWN_IDS_REL)
        with open(p, encoding="utf-8") as fh:
            pins = json.load(fh)
        pinned = {v["id"] for v in pins["byKey"].values()}
        for u in self._load("UNDRAWN"):
            self.assertTrue(u["id"].startswith("undrawn-"), u["id"])
            self.assertIn(u["id"], pinned,
                          f"{u['id']} is not pinned: a saved ruling would be orphaned")

    def test_ids_are_unique_across_both_collections(self):
        ids = [f["id"] for f in self._load("FIGS")] + [u["id"] for u in self._load("UNDRAWN")]
        self.assertEqual(len(ids), len(set(ids)))

    def test_every_figure_the_desk_shows_has_a_rendered_page_image(self):
        # page is the pinned render page; a null would leave the stage blank
        for f in self._load("FIGS"):
            self.assertIsNotNone(f["page"], f["id"])

    def test_every_figure_carries_a_doctrine_score(self):
        doctrine = self._load("DOCTRINE")
        crit_ids = {c["id"] for c in doctrine["criteria"]}
        for f in self._load("FIGS"):
            self.assertIn(f["id"], doctrine["scores"])
            self.assertEqual(set(doctrine["scores"][f["id"]]), crit_ids, f["id"])

    def test_every_doctrine_verdict_carries_a_sentence_of_evidence(self):
        for fid, sc in self._load("DOCTRINE")["scores"].items():
            for cid, r in sc.items():
                self.assertIn(r["verdict"], ("passes", "fails", "n/a", "unscored"),
                              f"{fid}/{cid}")
                self.assertTrue(r["evidence"].strip(),
                                f"{fid}/{cid} has a verdict but no evidence")


class ReconciliationIsHonest(unittest.TestCase):
    """Nothing is dropped and nothing is invented between the sets."""

    def _findings(self):
        p = os.path.join(REPO_ROOT, B.DATA_DIR, "FINDINGS.js")
        with open(p, encoding="utf-8") as fh:
            text = fh.read()
        return json.loads(text[text.index("=") + 1:].rstrip().rstrip(";"))

    def test_the_reconciliation_names_both_directions(self):
        r = self._findings()["reconciliation"]
        for k in ("deskFigures", "judged", "undrawn", "deskOnly", "judgedOnly", "renderDrift"):
            self.assertIn(k, r)

    def test_a_judged_figure_not_in_the_book_is_listed_not_dropped(self):
        r = self._findings()["reconciliation"]
        # these three are drawn by the pixel-judgment branch and are not on main
        self.assertEqual(sorted(r["judgedOnly"]),
                         ["fig-bc-graduated-trigger", "fig-bc-oracle-audit-rate",
                          "tab-bc-settlement-rule"])

    def test_render_drift_is_reported_rather_than_applied(self):
        # the pinned render page must NOT have been silently replaced by the
        # live Book page: that would repoint the page images and orphan regions
        r = self._findings()["reconciliation"]
        self.assertTrue(r["renderDrift"], "the drift disappeared -- was `page` re-derived?")
        for d in r["renderDrift"]:
            self.assertNotEqual(d["renderPage"], d["bookPage"])

    def test_parse_gaps_are_carried_to_the_desk_not_swallowed(self):
        self.assertIn("parseGaps", self._findings())


if __name__ == "__main__":
    unittest.main()
