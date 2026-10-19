"""Rendered witnesses for the author's six margin-sketch corrections.

Set BOOK_MARGIN_REVISION_PDF to the actual Book PDF and retain its aux/log.
These tests do not judge the design or replace reading the surrounding pages.
"""
import os
from pathlib import Path
import re
import sys
import unittest

import fitz

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts/harbor-research'))
from audit_book_layout import margin_records
from page_overflow import column, MARGIN_SEP, MARGIN_W

PDF = os.environ.get('BOOK_MARGIN_REVISION_PDF')


@unittest.skipUnless(PDF, 'Set BOOK_MARGIN_REVISION_PDF to a compiled Book or fixture')
class RenderedMarginRevisionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        path = Path(PDF)
        cls.book = fitz.open(path)
        _, cls.placements, issues = margin_records(path.with_suffix('.log').read_text())
        if issues:
            raise AssertionError(issues)
        cls.ids = re.findall(r'\\pdmarginexhibitrecord\{([^}]+)\}\{(\d+)\}',
                             path.with_suffix('.aux').read_text())

    @classmethod
    def tearDownClass(cls):
        cls.book.close()

    def exhibit(self, name):
        ids = [int(ident) for stable, ident in self.ids if stable == name]
        self.assertEqual(len(ids), 1)
        placed = [p for p in self.placements if p['id'] == ids[0]]
        self.assertEqual(len(placed), 1)
        placed = placed[0]
        pages = [p for p in self.book if (p.get_label() or str(p.number + 1)) == placed['folio']]
        self.assertEqual(len(pages), 1)
        page = pages[0]
        x0, x1, side = column(page, page.number + 1)
        left = x1 + MARGIN_SEP if side == 'R' else x0 - MARGIN_SEP - MARGIN_W
        top = placed['top'] * 72 / 72.27
        rect = fitz.Rect(left - 2, top - 2, left + MARGIN_W + 2,
                         top + placed['height'] * 72 / 72.27 + 2)
        text = re.sub(r'\s+', ' ', page.get_text(clip=rect)).replace('\u2011', '-')
        drawings = [d for d in page.get_drawings() if rect.contains(d['rect'])]
        return text, drawings

    def test_expiry_has_three_visible_category_colours_and_shapes(self):
        text, drawings = self.exhibit('certificate-lifetime')
        for word in ('card', 'epoch', 'policy', 'time'):
            self.assertIn(word, text)
        colours, shapes = [], []
        for length in (83, 63, 39):
            bars = [d for d in drawings if d['rect'].height < .1
                    and abs(d['rect'].width - length * 72 / 72.27) < .2]
            self.assertEqual(len(bars), 1)
            colour = bars[0]['color']
            colours.append(colour)
            # PDF fill/stroke operators can round the same ink to different
            # decimal precision. This tolerance is less than 1/255 per channel.
            marks = [d for d in drawings if d['fill'] is not None
                     and all(abs(a - b) < .001 for a, b in zip(d['fill'], colour))
                     and 4 < d['rect'].width < 8 and 4 < d['rect'].height < 8]
            self.assertEqual(len(marks), 1)
            shapes.append(tuple(item[0] for item in marks[0]['items']))
        self.assertEqual(len(set(colours)), 3)
        self.assertEqual(len(set(shapes)), 3)

    def test_headings_are_not_repeated_above_captions(self):
        for name, old in (
            ('wal-exposure-window', 'Commit is not sync'),
            ('heartbeat-suspicion', 'Silence is ambiguous'),
            ('heavy-tail-shape', 'Same mean, longer tail'),
            ('no-mint-split', 'Divide; do not duplicate'),
            ('equivocation-pair', 'One epoch, two roots'),
            ('certificate-lifetime', 'The earliest expiry wins'),
        ):
            text, _ = self.exhibit(name)
            self.assertNotIn(old, text)

    def test_expiry_is_beside_the_admission_paragraph(self):
        if self.book.page_count < 100:
            self.skipTest('This adjacency witness requires the assembled Book')
        ident = next(int(n) for name, n in self.ids if name == 'certificate-lifetime')
        placed = next(p for p in self.placements if p['id'] == ident)
        page = next(p for p in self.book if p.get_label() == placed['folio'])
        anchors = page.search_for('The Federated Harbor is not')
        self.assertEqual(len(anchors), 1)
        self.assertLess(abs(placed['top'] * 72 / 72.27 - anchors[0].y0), 40,
                        'A preceding margin note has detached the drawing from its explanation')

    def test_heavy_tail_axes_are_named_in_the_render(self):
        text, _ = self.exhibit('heavy-tail-shape')
        for label in ('survival probability (log)', 'duration / mean', 'Lomax', 'exponential'):
            self.assertIn(label, text)

    def test_split_has_two_intermediate_and_two_discounted_values(self):
        text, _ = self.exhibit('no-mint-split')
        self.assertEqual(len(re.findall(r'\b50\b', text)), 2)
        self.assertEqual(len(re.findall(r'\b45\b', text)), 2)
        self.assertIn('100', text)
        self.assertIn('0.9', text)
        self.assertIn('90 live', text)
        self.assertIn('Reputation-credit', text)

    def test_four_sampling_guides_and_unknown_commit_span(self):
        text, drawings = self.exhibit('heartbeat-suspicion')
        guides = [d for d in drawings if d['rect'].width < .1
                  and abs(d['rect'].height - 30 * 72 / 72.27) < .2
                  and d['dashes'] != '[] 0']
        self.assertEqual(len(guides), 4)
        text, _ = self.exhibit('wal-exposure-window')
        for label in ('?', 'commit', 'WAL sync', 'bracketed span'):
            self.assertIn(label, text)


if __name__ == '__main__':
    unittest.main()
