"""Placement is a book-wide contract, not a per-fragment opt-in."""
import os
import re
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts/harbor-research"))
import fitz
from check_book_caption_margins import (audit, bounds_issues, separate_columns,
                                       caption_blocks_unclipped, with_continuations,
                                       adjacency_issues, exhibit_records, ink_width_issues,
                                       margin_placements)
from page_overflow import column


class CaptionMarginTests(unittest.TestCase):
    def test_neighboring_note_cannot_lend_a_detached_caption_its_height(self):
        first = (396, 80, 487, 90, "Figure 1. Detached caption")
        recall = (396, 100, 487, 120, "Recall: unrelated note")
        merged = with_continuations(first, [first, recall])
        owner = (57.6, 100, 381.6, 200)
        self.assertEqual(adjacency_issues(merged, owner), [])
        # The audit uses the registered box for adjacency, merged text only
        # for conservative overflow checks. The unrelated note cannot help.
        placed = margin_placements(r"\pdmarginplacement{7}{1}{80.3pt}{10.0375pt}")["7"]
        registered = (396, placed["top"], 487, placed["top"]+placed["height"])
        self.assertIn("caption detached from exhibit (no vertical overlap)",
                      adjacency_issues(registered, owner))

    def test_duplicate_margin_geometry_is_rejected(self):
        entry = r"\pdmarginplacement{7}{1}{80pt}{10pt}"
        with self.assertRaisesRegex(ValueError, "Duplicate shipped margin placement"):
            margin_placements(entry + entry)

    def test_fullwidth_ink_in_a_column_width_wrapper_is_rejected(self):
        self.assertTrue(ink_width_issues(432, 324))
        self.assertEqual(ink_width_issues(324, 324), [])

    def test_caption_in_correct_margin_but_below_figure_is_rejected(self):
        caption = (396, 370, 487, 480)
        self.assertEqual(bounds_issues(caption, 57.6, 381.6, "R"), [])
        self.assertIn("caption detached from exhibit (no vertical overlap)",
                      adjacency_issues(caption, (57.6, 100, 381.6, 340)))

    def test_small_collision_adjustment_is_allowed_but_large_drift_is_not(self):
        exhibit = (57.6, 100, 381.6, 340)
        self.assertEqual(adjacency_issues((396, 113, 487, 180), exhibit), [])
        self.assertTrue(adjacency_issues((396, 180, 487, 250), exhibit))

    def test_owner_geometry_requires_shipped_anchor(self):
        with self.assertRaisesRegex(ValueError, "Missing shipped exhibit anchor"):
            exhibit_records(r"\pdexhibitrecord{figure}{6.9}{5}{200pt}{325pt}")

    def test_header_rule_distinguishes_both_outside_edges(self):
        with fitz.open() as doc:
            for left, side in [(57.6, "R"), (122.4, "L")]:
                page = doc.new_page(width=504, height=720)
                page.draw_line((left, 38), (left + 324, 38), width=.4)
                self.assertEqual(column(page, 1)[2], side)

    def test_headerless_pages_use_printed_folio_not_old_pdf_offset(self):
        with fitz.open() as doc:
            doc.new_page(width=504, height=720)
            doc.new_page(width=504, height=720)
            self.assertEqual(column(doc[0], 1)[2], "R")
            self.assertEqual(column(doc[1], 2)[2], "L")
            doc.set_page_labels([{"startpage": 0, "style": "r", "firstpagenum": 2},
                                 {"startpage": 1, "style": "D", "firstpagenum": 1}])
            self.assertEqual(column(doc[0], 1)[2], "L")
            self.assertEqual(column(doc[1], 2)[2], "R")

    def test_merged_axis_label_is_not_caption_text(self):
        block = {"lines": [
            {"bbox": (396, 100, 450, 110), "spans": [{"text": "Figure 1."}]},
            {"bbox": (396, 112, 488, 122), "spans": [{"text": "Caption sentence."}]},
            {"bbox": (260, 112, 360, 122), "spans": [{"text": "Axis label"}]},
        ]}
        blocks = separate_columns(block)
        caption = next(b for b in blocks if b[4].startswith("Figure"))
        self.assertEqual(caption[:4], (396, 100, 488, 122))
        # A genuine protruding caption line must NOT be clipped away.
        block["lines"][1]["bbox"] = (370, 112, 510, 122)
        caption = next(b for b in separate_columns(block) if b[4].startswith("Figure"))
        self.assertIn("not wholly in the outer margin",
                      bounds_issues(caption[:4], 57.6, 381.6, "R"))

    def test_overlong_continuation_cannot_hide_in_another_pdf_block(self):
        first = (396, 100, 487, 122, "Figure 1.\nA caption")
        later = (396, 125, 540, 160, "An unbreakable path extending off the page")
        other = (396, 170, 485, 185, "Figure 2.\nA separate exhibit")
        joined = with_continuations(first, [first, later, other])
        self.assertEqual(joined[:4], (396, 100, 540, 160))
        self.assertIn("not wholly in the outer margin",
                      bounds_issues(joined[:4], 57.6, 381.6, "R"))

    def test_odd_page_uses_right_margin(self):
        self.assertEqual(bounds_issues((397, 90, 488, 200), 57.6, 381.6, "R"), [])
        self.assertIn("not wholly in the outer margin",
                      bounds_issues((58, 90, 380, 200), 57.6, 381.6, "R"))

    def test_even_page_uses_left_margin(self):
        self.assertEqual(bounds_issues((15, 90, 107, 200), 122.4, 446.4, "L"), [])
        self.assertIn("not wholly in the outer margin",
                      bounds_issues((397, 90, 488, 200), 122.4, 446.4, "L"))

    def test_overflow_does_not_count_as_margin_success(self):
        self.assertIn("below the text block",
                      bounds_issues((397, 400, 488, 710), 57.6, 381.6, "R"))
        self.assertIn("above the text block",
                      bounds_issues((15, 0, 107, 200), 122.4, 446.4, "L"))

    def test_book_has_no_length_based_inline_fallback(self):
        source = (ROOT / "website-v2/public/whitepaper/figures/pd-pedagogy.tex").read_text()
        self.assertNotIn("PD-CAPTION-FALLBACK", source)
        caption = source.split(r"\newcommand{\pdmargincaption}", 1)[1].split(
            r"\newif\ifpd@routecaption", 1)[0]
        self.assertNotIn(r"\@makecaption", caption)
        self.assertNotIn(".25", caption)

    def test_shared_margin_column_is_independent_and_uses_shipped_page(self):
        source = (ROOT / "website-v2/public/whitepaper/figures/pd-pedagogy.tex").read_text()
        self.assertIn(r"\pd@endfloatbox\pd@attachfloatcaption", source)
        edge = source.split(r"\newcommand{\pd@floatcaptionedge}", 1)[1].split(
            r"\newcommand{\pd@attachfloatcaption}", 1)[0]
        self.assertIn(r"\checkoddpage", edge)
        self.assertIn(r"\llap", edge)
        self.assertIn(r"\rlap", edge)
        self.assertIn(r"\edef\pd@captionenv{\@captype}", source)
        self.assertIn(r"\PackageError{pd-pedagogy}{Exhibit and margin caption", source)
        self.assertIn(r"\pdtablecaptionheight", source)
        twin = ROOT / "whitepaper/figures/pd-pedagogy.tex"
        self.assertEqual(source, twin.read_text())
        allocator = (ROOT / "website-v2/public/whitepaper/figures/pd-margin-layout.tex").read_text()
        self.assertIn(r"\zref@addprop{savepos}{abspage}", allocator)
        self.assertIn(r"\AddToHook{shipout/foreground}", allocator)
        self.assertIn(r"\renewcommand{\pd@clearcaptionband}{}", allocator)
        self.assertIn("Margin~content~exceeds~page", allocator)
        self.assertNotIn(r"\ifpd@captionwide", allocator)
        self.assertIn(r"\pd@floatcaptionedge\pd@recordfloatowner", allocator)

    def test_hosted_checks_receive_inventory_and_run_caption_audit(self):
        workflow = (ROOT / ".github/workflows/whitepaper-build.yml").read_text()
        self.assertEqual(workflow.count("name: book-caption-inventory"), 2)
        self.assertIn("coordination-papers-mega-volume.aux", workflow)
        registry = (ROOT / "scripts/harbor-research/run_pdf_checks.py").read_text()
        self.assertIn('"check_book_caption_margins.py"', registry)


@unittest.skipUnless(os.environ.get("BOOK_CAPTION_PDF"),
                     "Set BOOK_CAPTION_PDF for exhaustive rendered caption checks")
class RenderedCaptionMargins(unittest.TestCase):
    def test_every_caption_is_in_the_correct_margin(self):
        results = audit(Path(os.environ["BOOK_CAPTION_PDF"]))
        self.assertGreater(len(results), 0)
        for result in results:
            with self.subTest(number=result["number"], kind=result["kind"],
                              page=result["pdf_page"]):
                self.assertEqual(result["issues"], [])


@unittest.skipUnless(os.environ.get("BOOK_CAPTION_FIXTURE"),
                     "Set BOOK_CAPTION_FIXTURE for rendered edge-case regression tests")
class RenderedCaptionFixture(unittest.TestCase):
    def test_caption_edge_cases(self):
        pdf = Path(os.environ["BOOK_CAPTION_FIXTURE"])
        records = audit(pdf)
        self.assertEqual(len(records), 11)
        for result in records:
            self.assertEqual(result["issues"], [], result)
        moved = next(r for r in records if "fixture:moved" in r["labels"])
        self.assertEqual(moved["folio"], "4")
        self.assertEqual(moved["side"], "L")
        with fitz.open(pdf) as doc:
            # Numbered inventory intentionally excludes stars. Check that
            # route separately, and ensure the tall caption is not truncated.
            starred = [b for b in caption_blocks_unclipped(doc[5])
                       if b[4].startswith("An unnumbered")]
            self.assertEqual(len(starred), 1)
            self.assertEqual(bounds_issues(starred[0][:4], *column(doc[5], 6)), [])
            self.assertIn("in the outer margin.", starred[0][4])
            long_caption = next(r for r in records if "fixture:long" in r["labels"])
            caption_text = next(b[4] for b in caption_blocks_unclipped(doc[0])
                                if b[4].startswith("Figure 1."))
            self.assertTrue(caption_text.endswith("page."))
            following = doc[0].search_for("This paragraph must begin")
            art = [d["rect"] for d in doc[0].get_drawings()
                   if d["rect"].width > 150 and d["rect"].height > 35]
            self.assertGreater(following[0].y0, max(r.y1 for r in art))
            self.assertLess(following[0].y0, long_caption["rects"][0][3])
            second = doc[0].search_for("A second margin note")
            self.assertGreater(second[0].y0, doc[0].search_for("page.")[-1].y1)
            wide = next(r for r in records if "fixture:wide" in r["labels"])
            page = doc[wide["pdf_page"] - 1]
            art = [d["rect"] for d in page.get_drawings()
                   if d["rect"].width > 290 and d["rect"].height > 20]
            self.assertTrue(art)
            self.assertLess(abs(wide["rects"][0][1] - min(r.y0 for r in art)), 12)
            self.assertTrue(wide["adjacency_checked"])
            table = next(r for r in records if "fixture:longtable" in r["labels"])
            self.assertEqual(table["folio"], "8")
            self.assertEqual(table["side"], "L")
            self.assertIn("Choice", doc[8].get_text())
            self.assertNotIn("Table 2.", doc[8].get_text())
            listing = next(r for r in records if "fixture:listing" in r["labels"])
            page = doc[listing["pdf_page"] - 1]
            following = page.search_for("This paragraph follows")
            self.assertLess(following[0].y0, listing["rects"][0][3])
            portrait_page = doc[11]
            portrait = next(d["rect"] for d in portrait_page.get_drawings()
                            if d["rect"].height > 140)
            explanation = portrait_page.search_for("and its explanation.")
            self.assertLessEqual(explanation[0].y1, 651.7)
            self.assertLess(portrait.y1, explanation[0].y0)
            terminal_page = doc[12]
            left, right, _ = column(terminal_page, 13)
            for word in terminal_page.get_text("words"):
                if word[4] in ("client-a", "client-b", "acquire", "file.txt"):
                    self.assertGreaterEqual(word[0], left-1)
                    self.assertLessEqual(word[2], right+1)
            self.assertTrue(terminal_page.search_for("Listing 3."))
            shared = next(r for r in records if "fixture:shared-float-page" in r["labels"])
            shared_page = doc[shared["pdf_page"] - 1]
            self.assertTrue(shared_page.search_for("Flow continuation."),
                            "A half-full deferred figure must not strand the following prose")

    def test_short_table_reservations_use_persisted_actual_heights(self):
        pdf = Path(os.environ["BOOK_CAPTION_FIXTURE"])
        aux = pdf.with_suffix('.aux').read_text()
        log = pdf.with_suffix('.log').read_text()
        measured = re.findall(r'PD-TABLE-CAPTION: key=(\d+),\s*id=(\d+),\s*height=([\d.]+)pt', log)
        persisted = dict(re.findall(r'\\pdtablecaptionheight\{(\d+)\}\{([\d.]+)pt\}', aux))
        self.assertEqual(len(measured), 3)
        self.assertEqual(len(persisted), 3)
        placed = margin_placements(aux)
        for key, ident, height in measured:
            self.assertAlmostEqual(float(persisted[key]), float(height), places=3)
            self.assertAlmostEqual(placed[ident]['height'], float(height)/1.00375, places=3)

    def test_short_tables_stay_on_the_source_page(self):
        pdf = Path(os.environ["BOOK_CAPTION_FIXTURE"])
        records = audit(pdf)
        with fitz.open(pdf) as doc:
            for kind, label in [('xltabular', 'fixture:short-xltabular'),
                                ('longtable', 'fixture:short-direct-longtable')]:
                source_page = next(i for i,p in enumerate(doc) if p.search_for(f'Short {kind} source.'))
                row = doc[source_page].search_for(f'Short {kind} row.')
                self.assertTrue(row, 'A short table must use the available space on its source page')
                record = next(r for r in records if label in r['labels'])
                self.assertEqual(record['pdf_page'], source_page+1)
                self.assertLess(abs(record['rects'][0][1]-row[0].y0), 60)

    def test_worked_example_can_split_without_overflow_retries(self):
        pdf = Path(os.environ['BOOK_CAPTION_FIXTURE'])
        log = pdf.with_suffix('.log').read_text()
        self.assertNotIn('correct box splittet fails', log)
        with fitz.open(pdf) as doc:
            first = next(i for i,p in enumerate(doc) if p.search_for('Frame split source.'))
            last = next(i for i,p in enumerate(doc) if p.search_for('Frame split final sentence.'))
            self.assertGreater(last, first)
            self.assertLess(max(r.y1 for r in doc[last].search_for('Frame split final sentence.')), 651.7)
            start = next(i for i,p in enumerate(doc) if p.search_for('Short frame source.'))
            finish = next(i for i,p in enumerate(doc) if p.search_for('Short frame final sentence.'))
            self.assertGreater(finish, start)
            start = next(i for i,p in enumerate(doc) if p.search_for('Protocol split source.'))
            finish = next(i for i,p in enumerate(doc) if p.search_for('Protocol split final sentence.'))
            self.assertGreater(finish, start)
            self.assertTrue(doc[start].search_for('A protocol step explains'))
            aux = pdf.with_suffix('.aux').read_text()
            label = re.search(r'\\newlabel\{fixture:split-protocol\}\{\{([^}]+)\}\{([^}]+)\}',aux)
            self.assertIsNotNone(label)
            destination = doc.resolve_names()['stpprotocol.'+label[1]]
            self.assertEqual(destination['page'],start)
            self.assertEqual(str(start+1),label[2])

    def test_heading_is_not_stranded_by_example_reservation(self):
        with fitz.open(os.environ['BOOK_CAPTION_FIXTURE']) as doc:
            heading = next(i for i,p in enumerate(doc) if p.search_for('Framed subsection'))
            self.assertTrue(doc[heading].search_for('First framed sentence.'))


if __name__ == "__main__":
    unittest.main()
