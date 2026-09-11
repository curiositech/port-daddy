#!/usr/bin/env python3
"""Unit tests for page_kinds.py, built over a small synthetic PDF assembled
with PyMuPDF so we control fonts/sizes/positions exactly."""
import os
import subprocess
import sys
import tempfile
import unittest

import fitz  # PyMuPDF

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import page_kinds as pk

PAGE_W, PAGE_H = 504, 720
BODY_SIZE = 10.5


def make_synthetic_pdf(path):
    doc = fitz.open()

    # Page 1 (index 0): claim head (Theorem N.M) + plain prose, odd page.
    p = doc.new_page(width=PAGE_W, height=PAGE_H)
    p.insert_text((122, 30), "Chapter 1.", fontsize=9.5, fontname="heit")
    p.insert_text((165, 30), " The Test Chapter", fontsize=9.5, fontname="heit")
    p.insert_text((441, 30), "8", fontsize=9.5, fontname="helv")
    p.insert_text((122, 100), "Theorem 1.8.3", fontsize=BODY_SIZE, fontname="hebo")
    p.insert_text(
        (122, 130),
        "This is ordinary body prose at the body font size describing the claim.",
        fontsize=BODY_SIZE,
        fontname="helv",
    )

    # Page 2 (index 1): "Numbers by hand" example head, even page -> margin
    # note check on the left column.
    p = doc.new_page(width=PAGE_W, height=PAGE_H)
    p.insert_text((57.6, 30), "Chapter 1.", fontsize=9.5, fontname="heit")
    p.insert_text((100, 30), " The Test Chapter", fontsize=9.5, fontname="heit")
    p.insert_text((376, 30), "9", fontsize=9.5, fontname="helv")
    p.insert_text((122, 100), "Numbers by hand", fontsize=BODY_SIZE, fontname="heit")
    p.insert_text(
        (122, 130),
        "Some worked-numbers prose follows at the body size for good measure.",
        fontsize=BODY_SIZE,
        fontname="helv",
    )
    # margin note: even page -> outer margin is x < 0.22*504 = 110.9
    p.insert_text((40, 300), "MARGIN NOTE HERE", fontsize=7, fontname="helv")

    # Page 3 (index 2): exercise (bold "1.1" + CHECK) and a "Solution p." ref.
    p = doc.new_page(width=PAGE_W, height=PAGE_H)
    p.insert_text((122, 30), "Chapter 1.", fontsize=9.5, fontname="heit")
    p.insert_text((165, 30), " The Test Chapter", fontsize=9.5, fontname="heit")
    p.insert_text((441, 30), "10", fontsize=9.5, fontname="helv")
    p.insert_text((54.7, 60), "Solution p. 424", fontsize=8.7, fontname="heit")
    p.insert_text((122, 100), "1.1", fontsize=BODY_SIZE, fontname="hebo")
    p.insert_text((140, 100), " CHECK", fontsize=8.7, fontname="helv")
    p.insert_text(
        (122, 130),
        "Some body prose to keep the page from being empty of text.",
        fontsize=BODY_SIZE,
        fontname="helv",
    )

    # Page 4 (index 3): a figure caption.
    p = doc.new_page(width=PAGE_W, height=PAGE_H)
    p.insert_text((57.6, 30), "Chapter 1.", fontsize=9.5, fontname="heit")
    p.insert_text((100, 30), " The Test Chapter", fontsize=9.5, fontname="heit")
    p.insert_text((376, 30), "11", fontsize=9.5, fontname="helv")
    p.insert_text((57.6, 100), "Figure 1.2:", fontsize=9.5, fontname="hebo")
    p.insert_text((110, 100), " The caption text describing the figure.", fontsize=9.5, fontname="helv")
    p.insert_text(
        (122, 130),
        "Body prose accompanying the figure lives here at body size.",
        fontsize=BODY_SIZE,
        fontname="helv",
    )

    # Page 5 (index 4): empty page (a plate) -- no text at all.
    doc.new_page(width=PAGE_W, height=PAGE_H)

    # Page 6 (index 5): a code block of 4 monospace lines plus a proof head.
    p = doc.new_page(width=PAGE_W, height=PAGE_H)
    p.insert_text((122, 30), "Chapter 1.", fontsize=9.5, fontname="heit")
    p.insert_text((165, 30), " The Test Chapter", fontsize=9.5, fontname="heit")
    p.insert_text((441, 30), "12", fontsize=9.5, fontname="helv")
    p.insert_text((57.6, 90), "Proof.", fontsize=BODY_SIZE, fontname="heit")
    p.insert_text((100, 90), " The proof follows in numbered steps.", fontsize=BODY_SIZE, fontname="helv")
    y = 120
    for line in ["SELECT a, b FROM t", "WHERE a = 1", "ORDER BY b ASC", "LIMIT 10;"]:
        p.insert_text((122, y), line, fontsize=9, fontname="cour")
        y += 14
    p.insert_text(
        (122, y + 10),
        "Some closing body prose after the code block.",
        fontsize=BODY_SIZE,
        fontname="helv",
    )

    doc.save(path)
    doc.close()


class PageKindsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmpdir = tempfile.mkdtemp()
        cls.pdf_path = os.path.join(cls.tmpdir, "synthetic.pdf")
        make_synthetic_pdf(cls.pdf_path)
        cls.doc = fitz.open(cls.pdf_path)
        cls.body_size = pk.estimate_body_size(cls.doc)

    def analyze(self, idx):
        return pk.analyze_page(self.doc, idx, self.body_size)

    def test_body_size_detected(self):
        self.assertAlmostEqual(self.body_size, BODY_SIZE, delta=0.2)

    def test_claim_head(self):
        r = self.analyze(0)
        self.assertIn("claim", r["kinds"])
        self.assertIn("prose", r["kinds"])
        self.assertEqual(r["chapter_num"], "1")
        self.assertEqual(r["folio"], "8")

    def test_example_and_margin_note(self):
        r = self.analyze(1)
        self.assertIn("example", r["kinds"])
        self.assertGreaterEqual(r["n_margin_notes"], 1)
        self.assertEqual(r["folio"], "9")

    def test_exercise_and_solution_no_double_count(self):
        r = self.analyze(2)
        self.assertIn("exercise", r["kinds"])
        # one exercise item on the page: primary pattern + matching
        # "Solution p." must not be double counted.
        self.assertEqual(r["n_exercises"], 1)

    def test_figure_caption(self):
        r = self.analyze(3)
        self.assertIn("figure", r["kinds"])
        self.assertNotIn("table", r["kinds"])

    def test_empty_page_does_not_crash(self):
        r = self.analyze(4)
        self.assertEqual(r["kinds"], set())
        self.assertEqual(r["n_exercises"], 0)
        self.assertEqual(r["n_margin_notes"], 0)

    def test_code_block_and_proof(self):
        r = self.analyze(5)
        self.assertIn("code", r["kinds"])
        self.assertIn("proof", r["kinds"])

    def test_n_kinds_excludes_prose(self):
        r = self.analyze(0)
        n_kinds = len(r["kinds"] - {"prose"})
        self.assertEqual(n_kinds, len(r["kinds"]) - (1 if "prose" in r["kinds"] else 0))
        # page 0 has claim + prose -> n_kinds should be 1
        self.assertEqual(n_kinds, 1)

    def test_full_cli_run_produces_outputs(self):
        out_dir = os.path.join(self.tmpdir, "out")
        script = os.path.join(os.path.dirname(os.path.abspath(__file__)), "page_kinds.py")
        subprocess.run(
            [sys.executable, script, self.pdf_path, "--out", out_dir],
            check=True,
            capture_output=True,
            text=True,
        )
        self.assertTrue(os.path.exists(os.path.join(out_dir, "page-kinds.csv")))
        self.assertTrue(os.path.exists(os.path.join(out_dir, "heat-strip.png")))
        self.assertTrue(os.path.exists(os.path.join(out_dir, "summary.md")))

        with open(os.path.join(out_dir, "page-kinds.csv"), encoding="utf-8") as f:
            content = f.read()
        self.assertIn("page,printed_folio,chapter,kinds,n_kinds", content.splitlines()[0])
        # 6 pages of synthetic data + header
        self.assertEqual(len(content.strip().splitlines()), 7)


if __name__ == "__main__":
    unittest.main()
