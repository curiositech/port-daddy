"""page_overflow.py's margin-collision pass, proved on pages it cannot have
seen: two notes printed on top of each other are found, two notes that clear
each other are not, and a note inside a figure is reported as a figure's
problem rather than a source line's.

The Book's own collisions (seven pages on 2026-09-08, all a Recall block over
an Exercises pointer) were invisible to the log -- \\marginnote never warns --
so this is the check that has to be right, and a check without a case it
fails on is a claim.
"""
from __future__ import annotations

import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path

import pymupdf

REPO = Path(__file__).resolve().parents[2]
SCRIPT = REPO / "scripts" / "harbor-research" / "page_overflow.py"


def load():
    spec = importlib.util.spec_from_file_location("page_overflow", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    sys.modules["page_overflow"] = module
    spec.loader.exec_module(module)
    return module


po = load()

# The Book's trim and column, as page_overflow.py knows them.
PAPER_W, PAPER_H = po.PAPER_W, po.PAPER_H
X0, X1 = po.INNER, po.INNER + po.TEXTW           # a recto: column left, margin on the right
MX0 = X1 + po.MARGIN_SEP                          # margin column starts here


def book_page(doc):
    """A 7 x 10 in page carrying the head rule page_overflow.py uses to find
    the column, so column() resolves the way it does on a real Book page."""
    page = doc.new_page(width=PAPER_W, height=PAPER_H)
    shape = page.new_shape()
    shape.draw_line((X0, 50), (X1, 50))
    shape.finish(width=0.4, color=(0, 0, 0))
    shape.commit()
    return page


def margin_note(page, y, text, lines=1):
    """Text in the margin column starting at baseline y, `lines` lines tall.
    Set in a box the width of the margin column so it wraps the way the Book's
    notes do; a line wider than the column is not a margin note and the pass
    ignores it (the first version of this fixture wrote lines 140 pt wide and
    proved nothing)."""
    for i in range(lines):
        page.insert_text((MX0 + 2, y + i * 11), text if i == 0 else f"{text} {i}", fontsize=8)
        width = pymupdf.get_text_length(f"{text} {i}", fontsize=8)
        assert width < po.MARGIN_W, f"fixture text {text!r} is wider than the margin column ({width:.0f} pt)"


class MarginCollisionTests(unittest.TestCase):
    def check(self, build):
        with tempfile.TemporaryDirectory() as directory:
            doc = pymupdf.open()
            page = book_page(doc)
            build(page)
            path = Path(directory) / "p.pdf"
            doc.save(path)
            doc = pymupdf.open(path)
            page = doc[0]
            x0, x1, outer = po.column(page, 1)
            self.assertEqual((round(x0), round(x1), outer), (round(X0), round(X1), "R"))
            return po.margin_collisions(page, x0, x1, outer)

    def test_two_notes_printed_on_top_of_each_other_are_found(self):
        def build(page):
            margin_note(page, 300, "Recall: what is", lines=6)   # ~66 pt tall
            margin_note(page, 330, "Ex. 4.13, p. 195.")            # inside the block
        found = self.check(build)
        self.assertEqual(len(found), 1, found)
        self.assertLess(found[0]["gap_pt"], 0.6 * found[0]["leading_pt"])
        self.assertFalse(found[0]["in_figure"])
        self.assertIn("Recall", found[0]["a"] + found[0]["b"])

    def test_two_notes_that_clear_each_other_are_not(self):
        def build(page):
            margin_note(page, 300, "Recall: what is", lines=3)
            margin_note(page, 420, "Ex. 4.13, p. 195.")
        self.assertEqual(self.check(build), [])

    def test_a_note_abutting_the_previous_one_is_not_a_collision(self):
        """Consecutive lines of one note sit one leading apart; that is the
        gap the check calibrates on, not a collision."""
        def build(page):
            margin_note(page, 300, "first")
            margin_note(page, 311, "second")   # exactly one line further down
        self.assertEqual(self.check(build), [])

    def test_one_line_split_at_a_font_change_is_one_line(self):
        """PyMuPDF returns two 'lines' for one line whose font changes
        mid-sentence, with a small baseline offset from the second font; they
        sit side by side in x and are not two notes."""
        def build(page):
            page.insert_text((MX0 + 2, 300), "property of", fontsize=8)
            page.insert_text((MX0 + 46, 302.5), "B in one sentence", fontsize=8, fontname="tiro")
        self.assertEqual(self.check(build), [])

    def test_text_in_the_column_is_not_the_margins_business(self):
        def build(page):
            page.insert_text((X0 + 10, 300), "body text of the column", fontsize=10)
            page.insert_text((X0 + 10, 302), "another line on top of it", fontsize=10)
        self.assertEqual(self.check(build), [])

    def test_a_collision_inside_a_figure_says_so(self):
        def build(page):
            shape = page.new_shape()
            shape.draw_rect(pymupdf.Rect(X0, 250, MX0 + 80, 450))   # a picture spanning into the margin
            shape.finish(width=0.5, color=(0, 0, 0))
            shape.commit()
            margin_note(page, 300, "axis label", lines=4)
            margin_note(page, 315, "0.75")
        found = self.check(build)
        self.assertEqual(len(found), 1, found)
        self.assertTrue(found[0]["in_figure"])


def raw_pdf_with_text_at(pdf_y, text="Recall: what is"):
    """A one-page PDF at the Book's trim whose content stream sets `text` at
    PDF y-coordinate `pdf_y` (bottom-up; negative is below the paper).
    Hand-rolled because PyMuPDF will not author text outside a page:
    set_mediabox re-bases the coordinates and set_cropbox hides the content
    from even the unclipped extraction. The xref offsets are computed so the
    file is well formed rather than repaired on open."""
    stream = f"BT /F1 8 Tf {MX0 + 2:.0f} {pdf_y:.0f} Td ({text}) Tj ET".encode()
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        (f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {PAPER_W:.0f} {PAPER_H:.0f}] "
         f"/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>").encode(),
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream",
    ]
    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for n, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += f"{n} 0 obj\n".encode() + body + b"\nendobj\n"
    xref = len(out)
    out += f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode()
    for o in offsets:
        out += f"{o:010d} 00000 n \n".encode()
    out += f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    return bytes(out)


class OffTheFootTests(unittest.TestCase):
    """Text placed below the paper does not appear in the visible text at all,
    and MuPDF cannot even position it when asked not to clip; the check grows
    the paper before it looks. A note hanging below the foot is a finding; a
    note on the page is not. The negative half (visible == []) is what proves
    the check is not redundant with ordinary extraction."""

    def findings(self, pdf_y):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "p.pdf"
            path.write_bytes(raw_pdf_with_text_at(pdf_y))
            page = pymupdf.open(path)[0]
            self.assertEqual((round(page.rect.width), round(page.rect.height)), (round(PAPER_W), round(PAPER_H)))
            visible = [b for b in page.get_text("blocks") if "Recall" in b[4]]
            below = [b for b in po.text_blocks_unclipped(page) if b[3] > po.PAPER_H + 0.5]
            return below, visible

    def test_a_note_below_the_foot_is_found_and_is_invisible_otherwise(self):
        below, visible = self.findings(-30)          # 30 pt below the bottom edge
        self.assertEqual(len(below), 1, below)
        self.assertEqual(visible, [], "text below the paper must not be in the visible extraction, or this check is redundant")

    def test_a_note_on_the_page_is_not_flagged(self):
        below, visible = self.findings(40)           # 40 pt above the bottom edge
        self.assertEqual(below, [])
        self.assertEqual(len(visible), 1)


class FootIntrusionTests(unittest.TestCase):
    """A table that overruns the text block by less than the foot margin stays
    on the paper and prints over the running foot; the running foot itself,
    and the folio, are where they belong."""

    def intrusions(self, build):
        with tempfile.TemporaryDirectory() as directory:
            doc = pymupdf.open()
            page = book_page(doc)
            # the running foot and folio, as the Book sets them
            page.insert_text((X0 + 60, po.TEXT_FOOT + 30), "The Harbor, the Person, and the Economy · Chapter 4 of 8", fontsize=8)
            build(page)
            path = Path(directory) / "p.pdf"
            doc.save(path)
            page = pymupdf.open(path)[0]
            x0, x1, _ = po.column(page, 1)
            return po.foot_intrusions(page, x0, x1)

    def test_a_table_row_over_the_running_foot_is_found(self):
        def build(page):
            page.insert_text((X0 + 10, po.TEXT_FOOT + 20), "O  Consent grant + inalienable override  proposed", fontsize=8)
        found = self.intrusions(build)
        self.assertEqual(len(found), 1, found)
        self.assertGreater(found[0]["below_foot_pt"], 15)

    def test_the_running_foot_and_folio_alone_are_not_intrusions(self):
        def build(page):
            page.insert_text((X1 - 20, po.TEXT_FOOT + 30), "195", fontsize=8)
        self.assertEqual(self.intrusions(build), [])

    def test_the_front_matters_edition_foot_is_not_an_intrusion(self):
        """The front matter runs a different foot from the body's, set lower in
        the band; it is a running foot, not a table falling off the page."""
        def build(page):
            page.insert_text((X0 + 90, po.TEXT_FOOT + 39.5), "Textbook Edition · September 2026", fontsize=8)
        self.assertEqual(self.intrusions(build), [])

    def test_text_inside_the_block_is_not_an_intrusion(self):
        def build(page):
            page.insert_text((X0 + 10, po.TEXT_FOOT - 12), "last line of the page, where it belongs", fontsize=10)
        self.assertEqual(self.intrusions(build), [])

    def test_a_deep_display_descending_a_few_points_is_not_an_intrusion(self):
        """The threshold's lower edge, pinned. Theorem 8.4.1's display carries a
        radical over a nested subscript and its box bottom lands 6.1 pt below
        the block's foot -- and 17.5 pt clear of the running foot, measured on
        the built PDF, so a reader sees an ordinary last line. Slack was 6.0,
        fitted to a sample without that construct, and it named p. 426 of the
        Swiss edition and p. 422 of the technical."""
        def build(page):
            page.insert_text((X0 + 10, po.TEXT_FOOT + 5.5), "r = |s| sqrt(1 - R^{K_c}_eff(e))", fontsize=8)
        self.assertEqual(self.intrusions(build), [])

    def test_the_threshold_sits_between_the_two_populations(self):
        """The upper edge. Ordinary last lines land 0-3 pt below the block over
        all three editions; the defect this check exists for -- a longtable row
        whose cell cannot break, six lines of it -- lands 50 to 70. Nothing was
        measured between 8 and 50, so the threshold is in empty space and a
        real overrun cannot slip under it."""
        def build(page):
            page.insert_text((X0 + 10, po.TEXT_FOOT + 60), "Run by proverif-estate, whose runner globs", fontsize=8)
        found = self.intrusions(build)
        self.assertEqual(len(found), 1, found)
        self.assertGreater(found[0]["below_foot_pt"], 50)


if __name__ == "__main__":
    unittest.main()
