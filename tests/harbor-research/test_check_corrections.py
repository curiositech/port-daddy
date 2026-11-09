#!/usr/bin/env python3
"""Tests for scripts/harbor-research/check_corrections.py.

The fixture PDF is generated here, with PyMuPDF and the Book's own open
font, so every extraction hazard the checker claims to handle is on a real
page: a word hyphenated across a line end, a compound broken at its own
hyphen, fi and fl ligatures, smart quotes, an em dash, a margin note set
beside a sentence, a phrase that turns the page under a running foot, and
roman and arabic page labels.

Run:
    python3 -m pytest -q tests/harbor-research/test_check_corrections.py
    python3 -m unittest discover -s tests/harbor-research -p 'test_check_corrections.py'
"""
from __future__ import annotations

import contextlib
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "scripts" / "harbor-research"))

import check_corrections as cc  # noqa: E402

try:
    import pymupdf  # noqa: F401
    import yaml  # noqa: F401
except ImportError:  # pragma: no cover - CI installs requirements-pdf.txt
    pymupdf = None

FONT = REPO_ROOT / "book" / "fonts" / "source-sans" / "SourceSans3-Regular.otf"


def make_fixture(path: Path) -> None:
    """Three 7 x 10 in pages: i, 1, 2."""
    doc = pymupdf.open()

    def put(page, x, y, text, size=10.0):
        page.insert_text((x, y), text, fontfile=str(FONT), fontname="F0", fontsize=size)

    def furniture(page, folio):
        put(page, 72, 30, "Chapter 4 · The Legible Swarm", 8)  # running head
        put(page, 72, 700, f"The Harbor, the Person, and the Economy · {folio}", 8)  # running foot

    page = doc.new_page(width=504, height=720)
    furniture(page, "i")
    put(page, 72, 100, "The old phrase Ren et al. prints here.")
    put(page, 72, 114, "The exfiltration bond is sized below.")

    page = doc.new_page(width=504, height=720)
    furniture(page, "1")
    put(page, 72, 100, "a word broken by coordi-")
    put(page, 72, 114, "nation across lines and the single-")
    put(page, 72, 128, "writer kernel with the ﬁnal ﬂow of")
    put(page, 72, 142, "“quoted words” and ‘single’ alpha—beta here")
    put(page, 72, 300, "the exfiltration bond is")
    put(page, 400, 305, "margin note", 7)  # between the two body lines in the stream
    put(page, 72, 314, "sized from the canary theorem today")
    put(page, 72, 600, "a phrase that turns")

    page = doc.new_page(width=504, height=720)
    furniture(page, "2")
    put(page, 72, 100, "the page cleanly and ends")

    doc.set_page_labels([
        {"startpage": 0, "prefix": "", "style": "r", "firstpagenum": 1},
        {"startpage": 1, "prefix": "", "style": "D", "firstpagenum": 1},
    ])
    doc.save(path)
    doc.close()


def row(**fields) -> dict:
    base = {"id": "t-1", "item": "test item", "file": "book/corrections.yaml",
            "before": "", "after": "", "source": "test"}
    base.update(fields)
    return base


class Normalise(unittest.TestCase):
    def test_whitespace_folds_to_one_space(self):
        self.assertEqual(cc.needle("  a  b\n\tc  "), "a b c")

    def test_ligatures_expand(self):
        self.assertEqual(cc.needle("ﬁnal ﬂow ﬀ ﬃ"), "final flow ff ffi")

    def test_smart_quotes_and_tex_quotes_become_ascii(self):
        self.assertEqual(cc.needle("“x” ‘y’"), "\"x\" 'y'")
        self.assertEqual(cc.needle("``x''"), '"x"')

    def test_every_dash_and_dash_run_is_one_hyphen(self):
        self.assertEqual(cc.needle("a—b c–d e--f g---h"), "a-b c-d e-f g-h")

    def test_line_end_hyphenation_rejoins_or_keeps_the_hyphen(self):
        raw = "coordi-\nnation single‑\n  writer"
        self.assertEqual(cc.normalise(raw)[0], "coordination singlewriter")
        self.assertEqual(cc.normalise(raw, keep_hyphen=True)[0], "coordi-nation single-writer")

    def test_a_hyphen_before_a_digit_is_a_range_not_a_break(self):
        self.assertEqual(cc.normalise("pp. 12-\n14")[0], "pp. 12- 14")

    def test_soft_hyphens_always_vanish(self):
        self.assertEqual(cc.normalise("coor­di­\nnation", keep_hyphen=True)[0], "coordination")

    def test_origin_maps_each_character_back_to_the_raw_text(self):
        text, origin = cc.normalise("ab-\ncd")
        self.assertEqual(text, "abcd")
        self.assertEqual(origin, [0, 1, 4, 5])


class Ledger(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        (self.root / "book").mkdir()
        (self.root / "book" / "ch.tex").write_text("x\n", encoding="utf-8")

    def tearDown(self):
        self.tmp.cleanup()

    def load(self, text: str):
        path = self.root / "corrections.yaml"
        path.write_text(text, encoding="utf-8")
        return cc.load_rows(path, repo_root=self.root)

    def test_the_committed_ledger_is_valid(self):
        rows = cc.load_rows(cc.DEFAULT_LEDGER)
        self.assertIsInstance(rows, list)

    def test_a_header_comment_alone_is_zero_rows(self):
        self.assertEqual(self.load("# only a header\n"), [])

    def test_a_valid_row_loads(self):
        rows = self.load(
            "- id: a-1\n  item: Blocker 6\n  file: book/ch.tex\n"
            "  before: Ren et al.\n  after: Huang, Narajala\n  source: https://arxiv.org/abs/2505.10609\n"
        )
        self.assertEqual(rows[0]["before"], "Ren et al.")

    def test_a_pure_deletion_or_insertion_is_allowed(self):
        rows = self.load(
            "- {id: a-1, item: i, file: book/ch.tex, before: old words, after: '', source: s}\n"
            "- {id: a-2, item: i, file: book/ch.tex, before: '', after: new words, source: s}\n"
        )
        self.assertEqual(len(rows), 2)

    def test_every_problem_is_named_in_one_run(self):
        with self.assertRaises(cc.LedgerError) as caught:
            self.load(
                "- {id: a-1, item: i, file: book/missing.tex, before: x, after: y, source: s}\n"
                "- {id: a-1, item: i, file: book/ch.tex, before: x, after: y, source: s}\n"
                "- {id: a-3, item: i, file: book/ch.tex, before: '\\\\S 4.2', after: y, source: s}\n"
                "- {id: a-4, item: i, file: book/ch.tex, before: '', after: '', source: s}\n"
                "- {id: a-5, item: i, file: book/ch.tex, before: x, after: y}\n"
                "- {id: a-6, item: i, file: book/ch.tex, before: x, after: y, source: s, page: 12}\n"
                "- {id: a-7, item: i, file: ../outside.tex, before: x, after: y, source: s}\n"
            )
        message = str(caught.exception)
        for expected in ("does not exist", "duplicate id", "TeX syntax", "cannot both be empty",
                         "source must be a string", "unknown field(s) page", "outside the repository"):
            self.assertIn(expected, message)

    def test_rows_must_be_a_sequence(self):
        with self.assertRaises(cc.LedgerError):
            self.load("corrections: []\n")

    def test_a_before_with_a_tie_is_rejected_because_it_could_never_match(self):
        # The fail-open this guards: a needle that cannot match makes the old
        # wording look gone.
        with self.assertRaises(cc.LedgerError):
            self.load("- {id: a, item: i, file: book/ch.tex, before: 'Fig.~2.4', after: y, source: s}\n")


@unittest.skipIf(pymupdf is None, "PyMuPDF and PyYAML come from requirements-pdf.txt")
class OnTheRenderedPage(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.pdf = Path(cls.tmp.name) / "fixture.pdf"
        make_fixture(cls.pdf)
        cls.pages = cc.read_pdf(cls.pdf)
        cls.texts = cc.readings(cls.pages)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def findings(self, **fields):
        return cc.check([row(**fields)], self.texts)

    def test_the_fixture_has_the_labels_it_claims(self):
        self.assertEqual([p.label for p in self.pages], ["i", "1", "2"])

    def test_a_surviving_before_is_named_with_its_page_and_folio(self):
        [finding] = self.findings(before="Ren et al.", after="Huang, Narajala")[:1]
        self.assertEqual(finding.kind, "before survives")
        self.assertEqual([self.pages[i].where() for i in finding.pages], ["p1 (folio i)"])

    def test_an_absent_after_is_named_with_the_nearest_print(self):
        findings = self.findings(after="The exfiltration bond is unsized")
        self.assertEqual(len(findings), 1)
        self.assertEqual(findings[0].kind, "after missing")
        self.assertEqual(findings[0].nearest, "The exfiltration bond is")
        self.assertEqual(findings[0].pages, [0])

    def test_a_word_hyphenated_at_a_line_end_matches_whole(self):
        self.assertEqual(self.findings(after="broken by coordination across lines"), [])

    def test_a_compound_broken_at_its_own_hyphen_matches_with_the_hyphen(self):
        self.assertEqual(self.findings(after="the single-writer kernel"), [])

    def test_ligatures_quotes_and_dashes_match_their_plain_spelling(self):
        self.assertEqual(self.findings(after="the final flow of"), [])
        self.assertEqual(self.findings(after='"quoted words" and \'single\''), [])
        self.assertEqual(self.findings(after="alpha--beta here"), [])

    def test_a_margin_note_beside_the_sentence_does_not_split_it(self):
        # In content-stream order the note sits between "is" and "sized".
        self.assertIn("bond is margin note sized", self.texts[0].text)
        self.assertEqual(self.findings(after="exfiltration bond is sized from the canary"), [])

    def test_a_phrase_across_a_page_turn_matches_under_the_running_foot(self):
        self.assertEqual(self.findings(after="a phrase that turns the page cleanly"), [])
        [finding] = self.findings(before="that turns the page")
        self.assertEqual([self.pages[i].number for i in finding.pages], [2, 3])

    def test_a_before_printed_only_inside_its_own_after_does_not_survive(self):
        self.assertEqual(self.findings(before="is sized below", after="The exfiltration bond is sized below"), [])

    def test_a_before_printed_elsewhere_still_survives_beside_its_after(self):
        [finding] = self.findings(before="exfiltration bond is", after="The exfiltration bond is sized below")
        self.assertEqual(finding.kind, "before survives")
        self.assertEqual([self.pages[i].number for i in finding.pages], [2])

    def test_matching_is_case_sensitive(self):
        self.assertEqual(self.findings(before="ren et al."), [])


@unittest.skipIf(pymupdf is None, "PyMuPDF and PyYAML come from requirements-pdf.txt")
class CommandLine(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.dir = Path(cls.tmp.name)
        cls.pdf = cls.dir / "fixture.pdf"
        make_fixture(cls.pdf)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def run_main(self, ledger_text: str, *extra: str) -> tuple[int, str]:
        ledger = self.dir / "ledger.yaml"
        ledger.write_text(ledger_text, encoding="utf-8")
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = cc.main([str(self.pdf), "--corrections", str(ledger), *extra])
        return code, out.getvalue() + err.getvalue()

    def test_an_empty_ledger_passes_and_says_it_checked_nothing(self):
        code, text = self.run_main("# header only\n")
        self.assertEqual(code, 0)
        self.assertIn("0 rows in the corrections ledger", text)

    def test_a_holding_row_passes(self):
        code, text = self.run_main(
            "- {id: ok-1, item: i, file: book/corrections.yaml, before: Nothing like this, "
            "after: the page cleanly, source: s}\n")
        self.assertEqual(code, 0, text)
        self.assertIn("-- 0 correction rows fail", text)

    def test_a_failing_row_exits_one_and_prints_the_row_and_the_page(self):
        code, text = self.run_main(
            "- {id: ls-6, item: 'Blocker 6: ANS authorship', file: book/corrections.yaml, "
            "before: Ren et al., after: 'Huang, Narajala', source: https://arxiv.org/abs/2505.10609}\n")
        self.assertEqual(code, 1)
        self.assertIn("-- 1 correction row(s) fail", text)
        self.assertIn("p1 (folio i) ls-6 before survives: 'Ren et al.'", text)
        self.assertIn("Blocker 6: ANS authorship", text)
        self.assertIn("ls-6 after missing: 'Huang, Narajala'", text)

    def test_json_names_pages_and_folios(self):
        code, text = self.run_main(
            "- {id: j-1, item: i, file: book/corrections.yaml, before: Ren et al., after: '', source: s}\n",
            "--json")
        self.assertEqual(code, 1)
        data = json.loads(text)
        self.assertEqual(data["findings"][0]["pages"], [1])
        self.assertEqual(data["findings"][0]["folios"], ["i"])

    def test_a_broken_ledger_exits_two(self):
        code, text = self.run_main("- {id: b, item: i}\n")
        self.assertEqual(code, 2)
        self.assertIn("file must be a string", text)

    def test_a_missing_pdf_exits_two(self):
        out = io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(out):
            code = cc.main([str(self.dir / "nope.pdf")])
        self.assertEqual(code, 2)


class Wiring(unittest.TestCase):
    def test_run_pdf_checks_runs_it_on_every_pdf(self):
        import run_pdf_checks

        scripts = [Path(script).name for script, _ in run_pdf_checks.PER_PDF_CHECKS]
        self.assertIn("check_corrections.py", scripts)

    def test_every_job_that_installs_the_readers_can_read_the_ledger(self):
        pins = (REPO_ROOT / "scripts" / "harbor-research" / "requirements-pdf.txt").read_text()
        self.assertRegex(pins, r"(?im)^pyyaml==\d")


if __name__ == "__main__":
    unittest.main()
