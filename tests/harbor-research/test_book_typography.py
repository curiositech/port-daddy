"""Pinned fonts and role routing are inputs to both Book and fragment builds."""
import hashlib
import json
import os
from collections import Counter
from pathlib import Path
import re
import unicodedata
import unittest

try:
    import fitz
except ImportError:
    fitz = None

ROOT = Path(__file__).resolve().parents[2]
BOOK = ROOT / "website-v2/public/whitepaper"


class BookTypographyTests(unittest.TestCase):
    def test_pinned_font_bytes_and_license(self):
        manifest = json.loads((BOOK / "fonts/manifest.json").read_text())
        entries = manifest["files"]
        self.assertEqual(len(entries), 18)
        self.assertEqual(len({entry["path"] for entry in entries}), len(entries))
        for entry in entries:
            with self.subTest(path=entry["path"]):
                path = BOOK / entry["path"]
                self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(), entry["sha256"])
                if path.suffix == ".otf":
                    self.assertEqual(path.read_bytes()[:4], b"OTTO")
        for family in ("source-serif", "source-sans"):
            license_text = (BOOK / "fonts" / family / "LICENSE.md").read_text()
            self.assertIn("SIL OPEN FONT LICENSE", license_text)

    def test_all_font_shapes_are_vendored(self):
        source = (BOOK / "coordination-papers-mega-volume-typography.tex").read_text()
        for name in set(re.findall(r"Source(?:Serif4(?:Caption|Display)?|Sans3)-[A-Za-z]+\.otf", source)):
            family = "source-serif" if name.startswith("SourceSerif") else "source-sans"
            self.assertTrue((BOOK / "fonts" / family / name).is_file(), name)
        self.assertNotIn("FakeBold", source)
        self.assertNotIn("FakeSlant", source)
        self.assertNotIn("/Users/", source)

    def test_roles_and_load_order(self):
        preamble = (BOOK / "coordination-papers-mega-volume-preamble.tex").read_text()
        typography = preamble.index(r"\input{coordination-papers-mega-volume-typography.tex}")
        self.assertLess(preamble.index(r"\newif\ifpdmaritime"), typography)
        self.assertLess(typography, preamble.index(r"\input{figures/pd-figure-language}"))
        swiss = (BOOK / "figures/pd-figure-language-swiss.tex").read_text()
        self.assertIn(r"\renewcommand{\pdfiglabelfamily}{\pdcaptionface}", swiss)
        compiler = (ROOT / "skills/harbor-chartwork/scripts/compile_fragment.sh").read_text()
        self.assertIn('cp -R "$BOOK_DIR/fonts" "$BUILD/fonts"', compiler)

    def test_late_legacy_font_reset_is_overridden(self):
        source = (BOOK / "coordination-papers-mega-volume-typography.tex").read_text()
        self.assertIn(r"\AtEndPreamble{\pdsetbookmainfont}", source)
        self.assertIn(r"\newcommand{\pdsetbookmainfont}{\setmainfont", source)
        self.assertNotIn("SourceSerif4", source)
        self.assertIn("RawFeature={-pnum,-onum}", source)


@unittest.skipUnless(fitz and os.environ.get("BOOK_TYPOGRAPHY_PDF"),
                     "Set BOOK_TYPOGRAPHY_PDF to the assembled Swiss Book for rendered-font checks")
class RenderedBookTypographyTests(unittest.TestCase):
    def test_every_chapter_keeps_its_epigraph_on_the_opener(self):
        manifest = json.loads((ROOT / "whitepaper/textbook.json").read_text())
        aux = Path(os.environ["BOOK_TYPOGRAPHY_PDF"]).with_suffix(".aux").read_text()

        def letters(text):
            return "".join(char.casefold() for char in unicodedata.normalize("NFKD", text)
                           if char.isalnum())

        with fitz.open(os.environ["BOOK_TYPOGRAPHY_PDF"]) as book:
            for chapter in manifest["chapters"]:
                key = "chap:" + chapter["prefix"]
                folio = re.search(r"\\newlabel\{" + re.escape(key)
                                  + r"\}\{\{[^{}]*\}\{([^{}]+)\}", aux).group(1)
                page = next(page for page in book if page.get_label() == folio)
                actual = letters(page.get_text())
                with self.subTest(chapter=chapter["id"], folio=folio):
                    self.assertIn(letters(chapter["epigraph"]["text"]), actual)
                    self.assertIn(letters(chapter["epigraph"]["source"]), actual)

    def test_actual_prose_uses_source_not_legacy_pagella(self):
        with fitz.open(os.environ["BOOK_TYPOGRAPHY_PDF"]) as book:
            aux = Path(os.environ["BOOK_TYPOGRAPHY_PDF"]).with_suffix(".aux").read_text()
            reader_pages = []
            for key in ("book:reader-left", "book:reader-right"):
                folio = re.search(r"\\newlabel\{" + re.escape(key)
                                  + r"\}\{\{[^{}]*\}\{([^{}]+)\}", aux).group(1)
                reader_pages.append(next(i for i, page in enumerate(book)
                                         if page.get_label() == folio))
            chapter = next(row[2] - 1 for row in book.get_toc()
                           if row[1] == "1 The Single-Writer Kernel")
            # The reader-guide prose and two continuous-prose chapter pages.
            # Counting characters avoids a title or caption satisfying the test.
            for index in [*reader_pages, chapter + 1, chapter + 2]:
                fonts = Counter()
                for block in book[index].get_text("dict")["blocks"]:
                    for line in block.get("lines", []):
                        for span in line["spans"]:
                            fonts[span["font"]] += len(span["text"])
                with self.subTest(page=index + 1):
                    self.assertGreater(fonts["SourceSans3-Regular"], 250, fonts)
                    self.assertEqual(sum(n for face, n in fonts.items()
                                         if face.startswith(("TeXGyrePagellaX", "SourceSerif4"))), 0, fonts)


if __name__ == "__main__":
    unittest.main()
