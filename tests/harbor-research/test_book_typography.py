"""Pinned fonts and role routing are inputs to both Book and fragment builds."""
import hashlib
import importlib.util
import json
import os
from collections import Counter
from pathlib import Path
import re
import unicodedata
import unittest
import tempfile
from unittest.mock import patch

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
        self.assertIn(r"\def\pdbookdatafeatures{-pnum,-onum}", source)

    def test_suisse_uses_four_real_shapes_and_supported_numerals(self):
        source = (BOOK / "coordination-papers-mega-volume-typography.tex").read_text()
        for style in ("Regular", "RegularItalic", "Semibold", "SemiboldItalic"):
            self.assertIn(f"SuisseIntl-{style}.otf", source)
        self.assertIn(r"\def\pdbookdatafeatures{+tnum,+lnum}", source)
        self.assertIn(r"\renewcommand{\scshape}{\upshape}", source)
        self.assertIn("OPEN-FONT PROOF", source)
        self.assertIn(r"font profile: \pdbookfontprofile", source)


class PrivateBookFontTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        spec = importlib.util.spec_from_file_location("book_fonts", ROOT / "scripts/prepare-book-fonts.py")
        cls.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.module)

    def test_explicit_suisse_does_not_fall_back(self):
        with self.assertRaisesRegex(ValueError, "no automatic substitution"):
            self.module.configuration("suisse", "")
        with self.assertRaises(ValueError):
            self.module.configuration("unknown", "")

    def test_open_proof_is_explicit_and_cannot_override_private_input(self):
        source, receipt = self.module.configuration("open-proof", "")
        self.assertIn("open-proof", source)
        self.assertEqual(receipt, {"profile": "open-proof"})
        with self.assertRaises(ValueError):
            self.module.configuration("open-proof", "some/private/fonts")

    def test_in_repository_fonts_are_rejected(self):
        with self.assertRaisesRegex(ValueError, "outside the repository"):
            self.module.configuration("suisse", str(BOOK / "fonts"))

    def test_private_config_hashes_inputs_without_copying_fonts(self):
        scratch = ROOT / ".cache" / "typography-tests"
        scratch.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=scratch) as temp:
            folder = Path(temp)
            with patch.object(self.module, "ROOT", folder / "repo"):
                for style in self.module.STYLES:
                    (folder / f"SuisseIntl-{style}.otf").write_bytes(b"OTTO-test-fixture")
                source, receipt = self.module.configuration("suisse", str(folder))
                self.assertIn(r"\detokenize{", source)
                self.assertEqual(len(receipt["sha256"]), 4)
                self.assertNotIn("directory", receipt)
                (folder / "SuisseIntl-RegularItalic.otf").unlink()
                with self.assertRaises(FileNotFoundError):
                    self.module.configuration("suisse", str(folder))


@unittest.skipUnless(fitz and os.environ.get("BOOK_TYPOGRAPHY_PDF"),
                     "Set BOOK_TYPOGRAPHY_PDF to the assembled Swiss Book for rendered-font checks")
class RenderedBookTypographyTests(unittest.TestCase):
    def test_retired_serif_is_not_loaded_anywhere_in_swiss(self):
        with fitz.open(os.environ["BOOK_TYPOGRAPHY_PDF"]) as book:
            families = {font[3] for page in book for font in page.get_fonts()}
            self.assertFalse(any("SourceSerif4" in name for name in families), families)

    def test_expected_font_profile_is_actually_embedded(self):
        expected = os.environ.get("BOOK_TYPOGRAPHY_FACE", "SourceSans3")
        with fitz.open(os.environ["BOOK_TYPOGRAPHY_PDF"]) as book:
            fonts = {font[3] for page in book for font in page.get_fonts()}
            if expected == "SuisseIntl":
                # The purchased filenames say Italic, but their actual
                # PostScript names use It. Assert the embedded font names.
                for style in ("Regular", "RegularIt", "Semibold", "SemiboldIt"):
                    self.assertTrue(any(f"SuisseIntl-{style}" in name for name in fonts), fonts)
                self.assertFalse(any("SourceSans3" in name for name in fonts), fonts)
                self.assertIn("font profile: suisse", book.metadata["creator"])

    def test_four_part_opening_spreads_are_retained(self):
        manifest = json.loads((ROOT / "whitepaper/textbook.json").read_text())
        aux = Path(os.environ["BOOK_TYPOGRAPHY_PDF"]).with_suffix(".aux").read_text()
        with fitz.open(os.environ["BOOK_TYPOGRAPHY_PDF"]) as book:
            for number, part in enumerate(manifest["parts"], start=1):
                key = "part:" + part["numeral"]
                folio = re.search(r"\\newlabel\{" + re.escape(key)
                                  + r"\}\{\{[^{}]*\}\{([^{}]+)\}", aux).group(1)
                index = book.resolve_names()[f"part.{number}"]["page"]
                with self.subTest(part=part["numeral"]):
                    self.assertEqual(book[index].get_label(), folio)
                    self.assertEqual((index + 1) % 2, 0, "Part art must open on a left page")
                    self.assertGreater(len(book[index].get_images()), 0, "Part art is missing")
                    self.assertIn("The chapters", book[index + 1].get_text())
                    self.assertIn("Part " + part["numeral"], book[index + 1].get_text())

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

    def test_backmatter_replaces_chapter_headers_on_both_sides(self):
        pdf = Path(os.environ['BOOK_TYPOGRAPHY_PDF'])
        aux = pdf.with_suffix('.aux').read_text()
        with fitz.open(pdf) as book:
            for label,title in [('book:solutions','Solutions to the exercises'),
                                ('book:appendices','Appendices')]:
                folio = re.search(r'\\newlabel\{' + re.escape(label)
                                  + r'\}\{\{[^{}]*\}\{([^{}]+)\}',aux).group(1)
                index = next(i for i,p in enumerate(book) if p.get_label()==folio)
                for page in (book[index],book[index+1]):
                    header = page.get_text(clip=fitz.Rect(0,0,page.rect.width,45))
                    self.assertIn(title,header)
                    self.assertNotIn('Chapter 8.',header)
                    self.assertIn(page.get_label(),header)

    def test_navigation_paragraph_stays_in_reader_guidance(self):
        def normalized(text):
            text = re.sub(r'[-\u2010\u2011]\n', '', text)
            return ' '.join(text.replace('\u2010', '-').replace('\u2011', '-').split())
        with fitz.open(os.environ['BOOK_TYPOGRAPHY_PDF']) as book:
            pages = [i for i, page in enumerate(book)
                     if 'Cross-references are live.' in normalized(page.get_text())]
            self.assertEqual(len(pages), 1)
            index = pages[0]
            guidance = book[index].get_text() + book[max(0, index-1)].get_text()
            self.assertIn('How to use this textbook', guidance)
            self.assertIn('links back to its full entry.', normalized(book[index].get_text()))

    def test_federated_conclusion_keeps_its_limitations_together(self):
        pdf = Path(os.environ['BOOK_TYPOGRAPHY_PDF'])
        aux = pdf.with_suffix('.aux').read_text()
        folio = re.search(r'\\newlabel\{fh:sec:fh-conclusion\}\{\{[^{}]*\}\{([^{}]+)\}', aux).group(1)
        with fitz.open(pdf) as book:
            page = next(page for page in book if page.get_label() == folio)
            text = re.sub(r'[-\u2010\u2011]\n', '', page.get_text())
            text = ' '.join(text.split())
            for passage in ('Conclusion', 'The proposed federation',
                            'What this chapter supplies', 'The remaining work',
                            'partial mechanization.'):
                self.assertIn(passage, text)

    def test_evidence_records_preserve_every_manifest_identifier(self):
        pdf = Path(os.environ['BOOK_TYPOGRAPHY_PDF'])
        aux = pdf.with_suffix('.aux').read_text()
        manifest = json.loads((ROOT/'whitepaper/corpus.json').read_text())
        with fitz.open(pdf) as book:
            indices=[]
            for label in ('app:mechanized','app:result-atlas'):
                folio = re.search(r'\\newlabel\{' + re.escape(label)
                                  + r'\}\{\{[^{}]*\}\{([^{}]+)\}',aux).group(1)
                indices.append(next(i for i,p in enumerate(book) if p.get_label()==folio))
            text=''.join(book[i].get_text() for i in range(indices[0],indices[1]+1))
            compact=''.join(text.split()).replace('\u2011','-').replace('\u2010','-')
            for record in manifest['formalArtifacts']+manifest['researchProgramArtifacts']:
                # Continuation heads may repeat the identifier; its actual
                # record, identified by the following Status field, is unique.
                self.assertEqual(compact.count(record['id']+'Status'),1,record['id'])

    def test_actual_prose_uses_selected_sans_not_legacy_pagella(self):
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
                    expected = os.environ.get("BOOK_TYPOGRAPHY_FACE", "SourceSans3")
                    self.assertGreater(fonts[expected + "-Regular"], 250, fonts)
                    self.assertEqual(sum(n for face, n in fonts.items()
                                         if face.startswith(("TeXGyrePagellaX", "SourceSerif4"))), 0, fonts)


if __name__ == "__main__":
    unittest.main()
