"""A declared text panel does not permit arbitrary text on a plate."""
import sys
import unittest
from pathlib import Path
import fitz

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'scripts/harbor-research'))
from render_book_reflection_review import check_plate_text


class OverlayTests(unittest.TestCase):
    def setUp(self):
        self.doc = fitz.open()
        self.page = self.doc.new_page(width=504, height=720)
        self.art = fitz.Rect(36, 36, 468, 684)
        self.meta = {'overlay': {'title': 'Title', 'body': 'Body', 'panel_height_inches': 2.45}}

    def tearDown(self):
        self.doc.close()

    def write(self, y=550, color=(1, 1, 1), size=11):
        self.page.insert_text((72, y), 'Title\nBody', fontsize=size, color=color)

    def test_declared_panel(self):
        self.write()
        check_plate_text(self.page, 'fixture', self.art, self.meta)

    def test_unexpected_text_rejected(self):
        self.write()
        self.page.insert_text((72, 610), 'Unexpected', fontsize=11)
        with self.assertRaisesRegex(ValueError, 'unexpected overlay text'):
            check_plate_text(self.page, 'fixture', self.art, self.meta)

    def test_outside_panel_rejected(self):
        self.write(y=100)
        with self.assertRaisesRegex(ValueError, 'escapes solid panel'):
            check_plate_text(self.page, 'fixture', self.art, self.meta)

    def test_low_contrast_text_rejected(self):
        self.write(color=(0, 0, 0))
        with self.assertRaisesRegex(ValueError, 'white contrast'):
            check_plate_text(self.page, 'fixture', self.art, self.meta)

    def test_wordless_remains_wordless(self):
        self.write()
        with self.assertRaisesRegex(ValueError, 'leaked'):
            check_plate_text(self.page, 'fixture', self.art, {})


if __name__ == '__main__':
    unittest.main()
