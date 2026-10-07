"""Audit the navigation in an assembled Book, never a chapter PDF.

Build with Tectonic --keep-intermediates, then run:
  BOOK_CONTENTS_PDF=/absolute/path/book.pdf /usr/bin/python3 -m unittest \
    discover -s tests/harbor-research -p test_book_contents_pdf.py -v

The PDF, .toc and .aux must be siblings from the same converged build. These
checks inspect rendered links and page labels, not a source-level promise that
the new ToC happens to call the expected macros.
"""

import os
import importlib.util
from collections import Counter
from pathlib import Path
import unittest

try:
    import fitz
except ImportError:
    fitz = None


def tex_groups(text):
    """Read top-level brace groups, preserving nested TeX and escaped braces."""
    groups = []
    depth = 0
    start = None
    escaped = False
    for index, char in enumerate(text):
        if escaped:
            escaped = False
            continue
        if char == "\\":
            escaped = True
            continue
        if char == "{":
            if depth == 0:
                start = index + 1
            depth += 1
        elif char == "}":
            depth -= 1
            if depth < 0:
                raise ValueError("Unbalanced TeX group")
            if depth == 0:
                groups.append(text[start:index])
    if depth:
        raise ValueError("Unclosed TeX group")
    return groups


def contents_entries(path):
    return [
        tex_groups(line)[:4]
        for line in path.read_text().splitlines()
        if line.startswith("\\contentsline ")
        and tex_groups(line)[0] in {"part", "chapter", "section", "subsection"}
    ]


class TocParserTests(unittest.TestCase):
    def test_nested_titles_and_escaped_braces_remain_one_entry(self):
        line = r'\contentsline {subsection}{\numberline {2.1}Sets \{x\} and \emph{proof}}{xi}{subsection.2.1}%'
        self.assertEqual(tex_groups(line), [
            "subsection", r"\numberline {2.1}Sets \{x\} and \emph{proof}",
            "xi", "subsection.2.1",
        ])


@unittest.skipUnless(fitz and os.environ.get("BOOK_CONTENTS_PDF"),
                     "Set BOOK_CONTENTS_PDF to a Tectonic assembled Book; PyMuPDF required")
class AssembledBookContentsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.path = Path(os.environ["BOOK_CONTENTS_PDF"])
        cls.pdf = fitz.open(cls.path)
        audit_path = Path(__file__).resolve().parents[2] / "scripts/harbor-research/page_overflow.py"
        spec = importlib.util.spec_from_file_location("book_page_overflow", audit_path)
        cls.overflow = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.overflow)
        cls.entries = contents_entries(cls.path.with_suffix(".toc"))
        outlines = [row for row in cls.pdf.get_toc() if row[1] == "Contents"]
        if len(outlines) != 1:
            raise AssertionError(f"Expected one Contents bookmark, got {outlines}")
        cls.first = outlines[0][2] - 1
        intro = next(link for link in cls.pdf[cls.first].get_links()
                     if link.get("nameddest") == "section.1")
        cls.last = intro["page"] - 1
        labels = {}
        for line in cls.path.with_suffix(".aux").read_text().splitlines():
            if line.startswith("\\newlabel{book:reader-"):
                key, value = tex_groups(line)
                if key in {"book:reader-left", "book:reader-right"}:
                    labels[key] = tex_groups(value)[1]
        cls.reader = {key: next(i for i in range(len(cls.pdf))
                               if cls.pdf[i].get_label() == label)
                      for key, label in labels.items()}
        cls.links = {}
        cls.words = {}
        for index in range(cls.first, cls.last + 1):
            cls.words[index] = cls.pdf[index].get_text("words")
            for link in cls.pdf[index].get_links():
                cls.links.setdefault(link.get("nameddest"), []).append((index, link))

    @classmethod
    def tearDownClass(cls):
        cls.pdf.close()

    def test_every_live_entry_has_both_title_and_page_links(self):
        missing = []
        for kind, title, number, destination in self.entries:
            links = self.links.get(destination, [])
            # Wrapped titles may occupy several annotations. There must also
            # be a separate link containing the printed page number.
            # Full glyph boxes can extend into the previous line at normal
            # leading. Use word centres to identify the annotation's own text.
            page_links = [link for index, link in links if " ".join(
                word[4] for word in self.words[index]
                if link["from"].contains(fitz.Point(
                    (word[0] + word[2]) / 2, (word[1] + word[3]) / 2
                ))
            ) == number]
            if len(links) < 2 or not page_links:
                missing.append((kind, title, number, destination))
        self.assertEqual(missing, [])
        counts = Counter(entry[0] for entry in self.entries)
        self.assertEqual(counts["chapter"], 8)
        self.assertGreater(counts["subsection"], 150)

    def test_all_page_numbers_match_the_destination_page_labels(self):
        wrong = []
        for _kind, title, number, destination in self.entries:
            for _index, link in self.links.get(destination, []):
                target = link.get("page", -1)
                actual = self.pdf[target].get_label() if target >= 0 else "unresolved"
                if actual != number:
                    wrong.append((title, number, actual, destination))
        self.assertEqual(wrong, [])

    def test_complete_backmatter_and_existing_part_art_are_present(self):
        titles = [entry[1] for entry in self.entries]
        for title in ["References", "Image credits", "Result atlas", "Mechanized claims",
                      "One ledger, three different reputation keys",
                      "Which chapter owns which primitive",
                      "Routes to the open problems"]:
            self.assertEqual(sum(title in entry for entry in titles), 1, title)
        self.assertEqual(sum(title.startswith("Chapter ") for title in titles), 8)
        images = {image[0] for index in range(self.first, self.last + 1)
                  for image in self.pdf[index].get_images()}
        self.assertEqual(len(images), 12, "Four part plates and eight chapter plates")

    def test_contents_and_reader_spread_ink_stays_inside_trim(self):
        outside = []
        for index in [*self.reader.values(), *range(self.first, self.last + 1)]:
            page = self.pdf[index]
            # Ordinary PDF extraction silently drops fully off-paper text.
            # Reuse the Book auditor's expanded-mediabox extraction instead.
            for block in self.overflow.text_blocks_unclipped(page):
                rect = fitz.Rect(block[:4])
                if not page.rect.contains(rect):
                    outside.append((index + 1, block[4], tuple(rect)))
            art = [drawing["rect"] for drawing in page.get_drawings()]
            art += [fitz.Rect(item["bbox"]) for item in page.get_image_info()]
            outside += [(index + 1, "art", tuple(rect)) for rect in art
                        if not page.rect.contains(rect)]
        self.assertEqual(outside, [])

    def test_reader_prose_belongs_below_its_even_left_and_odd_right_map(self):
        left, right = self.reader["book:reader-left"], self.reader["book:reader-right"]
        self.assertEqual((left + 1) % 2, 0)
        self.assertEqual(right, left + 1)
        for index, prose in [(left, "paragraph to locate a claim"),
                             (right, "Every important statement is labeled")]:
            page = self.pdf[index]
            paragraphs = page.search_for(prose)
            lane = page.search_for("INSTITUTIONAL")
            self.assertTrue(paragraphs and lane, (index + 1, prose))
            self.assertGreater(paragraphs[0].y0, max(rect.y1 for rect in lane))
        self.assertNotIn("paragraph to locate a claim", self.pdf[right].get_text())


if __name__ == "__main__":
    unittest.main()
