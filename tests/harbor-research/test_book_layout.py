import os
import sys
import unittest
from pathlib import Path
import fitz

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'scripts/harbor-research'))
from audit_book_layout import margin_records, empty_bands


class BookLayoutTests(unittest.TestCase):
    def test_final_credits_ship_before_local_headers_expire(self):
        root = Path(__file__).resolve().parents[2]
        source = (root / 'website-v2/public/whitepaper/coordination-papers-mega-volume-appendices.tex').read_text()
        self.assertIn(r'\pdbackmatterheaders{References}', source)
        self.assertIn(r'\pdbackmatterheaders{Image credits}', source)
        self.assertTrue(source.rstrip().endswith(r'\clearpage'))

    def test_boundary_reservation_does_not_force_a_second_page_turn(self):
        root = Path(__file__).resolve().parents[2]
        for directory in ('whitepaper', 'website-v2/public/whitepaper'):
            source = (root / directory / 'figures/pd-pedagogy.tex').read_text()
            block = source.split(r'\newenvironment{pdboundary}', 1)[1].split(r'\begin{mdframed}', 1)[0]
            self.assertIn(r'\Needspace{4\baselineskip}', block)
            self.assertNotIn(r'\pagetotal', block)
            self.assertNotIn(r'\pagegoal', block)
            self.assertNotIn(r'\newpage', block)

    def test_protocol_variants_share_a_breakable_frame(self):
        root = Path(__file__).resolve().parents[2]
        preamble = (root / 'website-v2/public/whitepaper/coordination-papers-mega-volume-preamble.tex').read_text()
        block = preamble.split(r'\newenvironment{pdbookprotocol}',1)[1].split(r'\newtheorem{heprotocol}',1)[0]
        self.assertIn(r'\begin{mdframed}', block)
        self.assertNotIn(r'\begin{tikzpicture}', block)
        self.assertNotIn(r'\begin{minipage}', block)
        self.assertEqual(block.count(r'\begin{pdbookprotocol}'),2)

    def test_intro_to_first_part_uses_one_physical_verso_alignment(self):
        root = Path(__file__).resolve().parents[2]
        source = (root / 'website-v2/public/whitepaper/coordination-papers-mega-volume.tex').read_text()
        self.assertIn('\\cleartoleftpage\n\\pagenumbering{arabic}\\setcounter{page}{2}',source)

    def test_float_only_pages_require_more_than_half_a_page(self):
        root = Path(__file__).resolve().parents[2]
        preamble = (root / 'website-v2/public/whitepaper/coordination-papers-mega-volume-preamble.tex').read_text()
        self.assertIn(r'\renewcommand{\floatpagefraction}{.8}', preamble)
        self.assertIn(r'\renewcommand{\topfraction}{.85}', preamble)
        self.assertIn(r'\renewcommand{\textfraction}{.1}', preamble)

    def test_page_turns_do_not_strand_paragraph_lines_or_hyphenated_words(self):
        root = Path(__file__).resolve().parents[2]
        preamble = (root / 'website-v2/public/whitepaper/coordination-papers-mega-volume-preamble.tex').read_text()
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
        anchors = ('is the blueprint, the same three unwinding conditions',
                   'spend past the contracted maximum, is exhibited concretely.')
        with fitz.open(os.environ['BOOK_LAYOUT_PDF']) as book:
            for anchor in anchors:
                found = [(i, page) for i, page in enumerate(book)
                         if anchor in ' '.join(page.get_text().split())]
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
