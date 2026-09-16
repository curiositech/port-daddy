"""Tests for beauty_lint.py: each check gets a synthetic PDF it must flag and
one it must pass. PDFs are drawn with PyMuPDF directly so the tests need no TeX."""
import sys, unittest
from pathlib import Path
import pymupdf

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import beauty_lint as bl  # noqa: E402

OUT = Path(__file__).resolve().parent / '_fixtures'


def make(name, draw):
    OUT.mkdir(exist_ok=True)
    doc = pymupdf.open()
    page = doc.new_page(width=504, height=720)  # 7 x 10 in
    draw(page)
    p = OUT / f'{name}.pdf'
    doc.save(p)
    return p


def caption(page, y=400, text='Figure 1: A caption. [internal]'):
    page.insert_text((72, y), text, fontsize=9)


def ids(report, level=None):
    return {f['id'] for f in report['findings'] if level is None or f['level'] == level}


class TestMoat(unittest.TestCase):
    def test_text_jammed_in_box_flags(self):
        def d(pg):
            pg.draw_rect(pymupdf.Rect(100, 100, 150, 116), width=.9)
            pg.insert_text((101, 112), 'tight', fontsize=8)
            caption(pg)
        self.assertIn('B1', ids(bl.lint(make('moat_bad', d))))

    def test_text_with_room_passes(self):
        def d(pg):
            pg.draw_rect(pymupdf.Rect(100, 100, 170, 124), width=.9)
            pg.insert_text((110, 115), 'roomy', fontsize=8)
            caption(pg)
        self.assertNotIn('B1', ids(bl.lint(make('moat_ok', d))))


class TestCrowding(unittest.TestCase):
    def test_label_hugging_a_line_flags(self):
        def d(pg):
            pg.draw_line((80, 120), (300, 120), width=.9)
            pg.insert_text((120, 119.3), 'hugging', fontsize=8)
            caption(pg)
        self.assertIn('B2', ids(bl.lint(make('crowd_bad', d))))

    def test_label_clear_of_line_passes(self):
        def d(pg):
            pg.draw_line((80, 120), (300, 120), width=.9)
            pg.insert_text((120, 112), 'clear', fontsize=8)
            caption(pg)
        self.assertNotIn('B2', ids(bl.lint(make('crowd_ok', d))))


class TestTextGap(unittest.TestCase):
    def test_two_labels_nearly_touching_flag(self):
        def d(pg):
            pg.insert_text((100, 120), 'upper', fontsize=8)
            pg.insert_text((100, 128.6), 'lower', fontsize=8)
            caption(pg)
        self.assertIn('B3', ids(bl.lint(make('gap_bad', d))))


class TestOverprint(unittest.TestCase):
    def test_two_labels_overprinting_is_a_fail(self):
        def d(pg):
            pg.insert_text((100, 120), 'reviewer role', fontsize=8)
            pg.insert_text((104, 116), 'role: one slot', fontsize=8)
            caption(pg)
        self.assertIn('B3', ids(bl.lint(make('overprint', d)), 'fail'))


class TestWeightsHuesSizes(unittest.TestCase):
    def test_many_weights_many_hues_two_sizes_flag(self):
        def d(pg):
            for i, (w, c) in enumerate([(.3, (1, 0, 0)), (.75, (0, 1, 0)), (1.1, (0, 0, 1)),
                                        (1.35, (1, 1, 0)), (2.2, (1, 0, 1)), (2.9, (0, 1, 1))]):
                # diagonal strokes: figure lines, not booktabs rules
                pg.draw_line((80 + 30 * i, 100), (100 + 30 * i, 150), width=w, color=c)
            pg.insert_text((100, 200), 'eight', fontsize=8)
            pg.insert_text((100, 230), 'eleven', fontsize=11)
            caption(pg)
        r = bl.lint(make('ladder_bad', d))
        self.assertTrue({'B4', 'B5', 'B6'} <= ids(r), r['findings'])


class TestAlignment(unittest.TestCase):
    def test_almost_aligned_labels_flag(self):
        def d(pg):
            pg.insert_text((100, 120), 'alpha', fontsize=8)
            pg.insert_text((101.2, 160), 'gamma', fontsize=8)
            caption(pg)
        self.assertIn('B7', ids(bl.lint(make('align_bad', d))))

    def test_exactly_aligned_labels_pass(self):
        def d(pg):
            pg.insert_text((100, 120), 'alpha', fontsize=8)
            pg.insert_text((100, 160), 'gamma', fontsize=8)
            caption(pg)
        self.assertNotIn('B7', ids(bl.lint(make('align_ok', d))))


class TestHyphenAndCaption(unittest.TestCase):
    def test_hyphenated_label_is_hard(self):
        def d(pg):
            pg.insert_text((100, 120), 'dead-', fontsize=8)
            pg.insert_text((100, 130), 'line', fontsize=8)
            caption(pg)
        self.assertIn('B9', ids(bl.lint(make('hyph_bad', d)), 'fail'))

    def test_caption_without_provenance_warns(self):
        def d(pg):
            pg.insert_text((100, 120), 'label', fontsize=8)
            caption(pg, text='Figure 1: A caption with no bracket.')
        self.assertIn('B10', ids(bl.lint(make('prov_bad', d))))


if __name__ == '__main__':
    unittest.main()
