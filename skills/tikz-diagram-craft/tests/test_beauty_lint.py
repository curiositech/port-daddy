"""Tests for beauty_lint.py: each check gets a synthetic PDF it must flag and
one it must pass. PDFs are drawn with PyMuPDF directly so the tests need no TeX."""
import sys, tempfile, unittest
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


class TestMarginCaptionRegion(unittest.TestCase):
    def test_side_captions_do_not_hide_overprinted_figure_labels(self):
        scratch = Path(__file__).resolve().parents[3] / '.cache' / 'beauty-tests'
        scratch.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=scratch) as temp:
            for side, caption_x in [('left', 14), ('right', 396)]:
                with self.subTest(side=side), pymupdf.open() as doc:
                    page = doc.new_page(width=504, height=720)
                    page.insert_text((caption_x, 80), 'Figure 1.', fontsize=9)
                    page.insert_text((caption_x, 100), 'A caption.', fontsize=9)
                    page.insert_text((caption_x, 115), '[internal]', fontsize=9)
                    # Both labels are below the caption top; the old vertical
                    # crop ignored them and reported no B3 failure.
                    page.insert_text((180, 105), 'first layer', fontsize=9)
                    page.insert_text((182, 109), 'second layer', fontsize=9)
                    region, caption_text = bl._pic_region(page)
                    self.assertGreater(region.y1, 109)
                    self.assertTrue(caption_text.endswith('[internal]'))
                    self.assertNotIn('layer', caption_text)
                    self.assertEqual(len(bl._words(page, region)), 2)
                    target = Path(temp) / (side + '.pdf')
                    doc.save(target)
                    report = bl.lint(target)
                    self.assertIn('B3', ids(report, 'fail'))
                    self.assertNotIn('B10', ids(report))

    def test_bottom_caption_keeps_a_vertical_crop(self):
        with pymupdf.open() as doc:
            page = doc.new_page(width=504, height=720)
            page.insert_text((100, 120), 'picture label', fontsize=9)
            caption(page)
            region, caption_text = bl._pic_region(page)
            self.assertLess(region.y1, 400)
            self.assertGreater(region.y1, 120)
            self.assertTrue(caption_text.endswith('[internal]'))
            self.assertEqual([word['text'] for word in bl._words(page, region)],
                             ['picture label'])

    def test_margin_caption_does_not_hide_an_unlabelled_drawing(self):
        with pymupdf.open() as doc:
            page = doc.new_page(width=504, height=720)
            page.insert_text((396, 80), 'Figure 1.', fontsize=9)
            page.insert_text((396, 105), '[internal]', fontsize=9)
            page.draw_rect(pymupdf.Rect(180, 90, 280, 160))
            region, _ = bl._pic_region(page)
            self.assertTrue(region.contains(pymupdf.Rect(180, 90, 280, 160)))


if __name__ == '__main__':
    unittest.main()
