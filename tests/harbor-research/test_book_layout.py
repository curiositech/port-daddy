import os
import re
import sys
import unittest
from pathlib import Path
import fitz

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'scripts/harbor-research'))
from audit_book_layout import margin_records, empty_bands, margin_slack, text_height, audit


class BookLayoutTests(unittest.TestCase):
    def test_final_credits_ship_before_local_headers_expire(self):
        root = Path(__file__).resolve().parents[2]
        source = (root / 'book/coordination-papers-mega-volume-appendices.tex').read_text()
        self.assertIn(r'\pdbackmatterheaders{References}', source)
        self.assertIn(r'\pdbackmatterheaders{Image credits}', source)
        self.assertTrue(source.rstrip().endswith(r'\clearpage'))

    def test_boundary_reservation_does_not_force_a_second_page_turn(self):
        root = Path(__file__).resolve().parents[2]
        for directory in ('book', 'book'):
            source = (root / directory / 'figures/pd-pedagogy.tex').read_text()
            block = source.split(r'\newenvironment{pdboundary}', 1)[1].split(r'\begin{mdframed}', 1)[0]
            self.assertIn(r'\Needspace{4\baselineskip}', block)
            self.assertNotIn(r'\pagetotal', block)
            self.assertNotIn(r'\pagegoal', block)
            self.assertNotIn(r'\newpage', block)

    def test_protocol_variants_share_a_breakable_frame(self):
        root = Path(__file__).resolve().parents[2]
        preamble = (root / 'book/coordination-papers-mega-volume-preamble.tex').read_text()
        block = preamble.split(r'\newenvironment{pdbookprotocol}',1)[1].split(r'\newtheorem{heprotocol}',1)[0]
        self.assertTrue(r'\pdblockbefore{Protocol}' in block or r'\begin{mdframed}' in block)
        self.assertNotIn(r'\begin{tikzpicture}', block)
        self.assertNotIn(r'\begin{minipage}', block)
        self.assertEqual(block.count(r'\begin{pdbookprotocol}'),2)

    def test_intro_to_first_part_uses_one_physical_verso_alignment(self):
        root = Path(__file__).resolve().parents[2]
        source = (root / 'book/coordination-papers-mega-volume.tex').read_text()
        self.assertIn('\\cleartoleftpage\n\\pagenumbering{arabic}\\setcounter{page}{2}',source)

    def test_float_only_pages_require_more_than_half_a_page(self):
        root = Path(__file__).resolve().parents[2]
        preamble = (root / 'book/coordination-papers-mega-volume-preamble.tex').read_text()
        self.assertIn(r'\renewcommand{\floatpagefraction}{.8}', preamble)
        self.assertIn(r'\renewcommand{\topfraction}{.85}', preamble)
        self.assertIn(r'\renewcommand{\textfraction}{.1}', preamble)

    def test_page_turns_do_not_strand_paragraph_lines_or_hyphenated_words(self):
        root = Path(__file__).resolve().parents[2]
        preamble = (root / 'book/coordination-papers-mega-volume-preamble.tex').read_text()
        for penalty in ('clubpenalty', 'widowpenalty', 'displaywidowpenalty', 'brokenpenalty'):
            self.assertIn('\\' + penalty + '=10000', preamble)

    def test_missing_inventory_does_not_pass(self):
        self.assertTrue(margin_records('')[2])

    def test_every_object_must_ship_exactly_once(self):
        r = 'PD-MARGIN-REGISTER: id=1,kind=note, line=20, height=100pt\n'
        p = 'PD-MARGIN-PLACED: id=1, page=2,top=70pt, height=100pt\n'
        self.assertTrue(margin_records(r)[2])
        self.assertFalse(margin_records(r+p)[2])
        self.assertTrue(margin_records(r+p+p)[2])

    def test_portrait_cannot_cross_the_foot(self):
        text = ('PD-MARGIN-REGISTER: id=1,kind=note, line=20, height=100pt\n'
                'PD-MARGIN-PLACED: id=1, page=2,top=600pt, height=100pt\n')
        self.assertIn('outside text-height bounds', str(margin_records(text)[2]))

    def test_notes_cannot_overlap(self):
        text = ''.join(f'PD-MARGIN-REGISTER: id={i},kind=note, line=20, height=100pt\n'
                       f'PD-MARGIN-PLACED: id={i}, page=2,top={60+i*10}pt, height=100pt\n'
                       for i in (1,2))
        self.assertIn('margin collision', str(margin_records(text)[2]))

    def test_the_margin_column_height_is_read_from_the_log(self):
        log = '* \\textwidth=325.21503pt\n* \\textheight=592.6138pt\n* \\oddsidemargin=-14.45378pt\n'
        self.assertEqual(text_height(log), 592.6138)
        self.assertIsNone(text_height('no geometry here'))

    def test_a_nearly_full_margin_is_listed_and_a_roomy_one_is_not(self):
        placed = [dict(folio='7', height=h) for h in (100.0, 200.0, 270.0)] + [dict(folio='8', height=100.0)]
        # The layout's own sum: 100 + 200 + 270, with a 7pt gap after each note but the last.
        self.assertEqual(margin_slack(placed, 592.6), [dict(folio='7', notes=3, used=584.0, spare=8.6)])

    def test_tight_pages_come_tightest_first(self):
        placed = [dict(folio='3', height=560.0), dict(folio='4', height=590.0), dict(folio='5', height=540.0)]
        self.assertEqual([row['folio'] for row in margin_slack(placed, 592.6)], ['4', '3', '5'])

    def test_a_folio_printed_on_two_pages_is_two_pages(self):
        # Front matter and body can both have a page "1". Merged, these two
        # would read as one page 4.4pt over the column.
        placed = [dict(folio='1', height=300.0), dict(folio='2', height=10.0), dict(folio='1', height=290.0)]
        self.assertEqual(margin_slack(placed, 592.6), [])
        self.assertEqual(len(margin_slack(placed[:1] + placed[2:], 592.6)), 1)

    def test_a_log_that_does_not_state_the_text_height_cannot_pass(self):
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            pdf = Path(tmp) / 'book.pdf'
            with fitz.open() as doc:
                doc.new_page(width=504, height=720)
                doc.save(pdf)
            records = ('PD-MARGIN-REGISTER: id=1,kind=note, line=20, height=100pt\n'
                       'PD-MARGIN-PLACED: id=1, page=1,top=70pt, height=100pt\n')
            pdf.with_suffix('.log').write_text(records)
            self.assertIn('textheight', str(audit(pdf)['margin_issues']))
            pdf.with_suffix('.log').write_text(records + '* \\textheight=592.6138pt\n')
            result = audit(pdf)
            self.assertEqual(result['margin_issues'], [])
            self.assertEqual(result['margin_tight'], [])
            pdf.with_suffix('.log').write_text(records.replace('height=100pt', 'height=590pt') + '* \\textheight=592.6138pt\n')
            self.assertEqual([row['spare'] for row in audit(pdf)['margin_tight']], [2.6])

    def test_whitespace_is_measured_in_body_not_caption_column(self):
        with fitz.open() as doc:
            page = doc.new_page(width=504, height=720)
            page.insert_text((58,90), 'Body above')
            page.insert_text((58,500), 'Body below')
            for y in range(110,490,12):
                page.insert_text((398,y),'Caption')
            bands = empty_bands(page,1)
            self.assertTrue(any(b['position']=='between' and b['points']>300 for b in bands))


@unittest.skipUnless(os.environ.get('BOOK_LAYOUT_PDF'),
                     'Set BOOK_LAYOUT_PDF to the assembled Book')
class RenderedBoundaryLayoutTests(unittest.TestCase):
    def test_boundary_introductions_do_not_get_nearly_empty_pages(self):
        # Locate the actual prose, not a folio that changes on every rewrite.
        anchors = ('an unbounded argument still to be supplied',
                   'the mutation suite shows the invariant has teeth')
        with fitz.open(os.environ['BOOK_LAYOUT_PDF']) as book:
            for anchor in anchors:
                found = [(i, page) for i, page in enumerate(book)
                         if re.sub(r'[-\s\u2010\u2011]', '', anchor)
                         in re.sub(r'[-\s\u2010\u2011]', '', page.get_text())]
                self.assertEqual(len(found), 1, anchor)
                index, page = found[0]
                with self.subTest(anchor=anchor, pdf_page=index + 1):
                    self.assertFalse([gap for gap in empty_bands(page, index + 1)
                                      if gap['points'] > 300],
                                     'Boundary placement stranded a short continuation')

    def test_final_credits_keep_their_own_running_header(self):
        with fitz.open(os.environ['BOOK_LAYOUT_PDF']) as book:
            page = book[-1]
            header = page.get_text(clip=fitz.Rect(0, 0, page.rect.width, 45))
            self.assertIn('Image credits', header)
            self.assertNotIn('Solutions to the exercises', header)


if __name__ == '__main__':
    unittest.main()
