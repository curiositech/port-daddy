"""Book shared apparatus has one canonical source and no legacy TeX mirrors."""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]
HELPERS = ("pd-pedagogy.tex", "pd-palette.tex", "pd-figure-language.tex")

class CanonicalPedagogyTests(unittest.TestCase):
    def test_shared_apparatus_exists_only_in_book(self):
        for name in HELPERS:
            with self.subTest(helper=name):
                self.assertTrue((ROOT / "book/figures" / name).read_text().strip())
                for old in ("whitepaper/figures", "website-v2/public/whitepaper/figures"):
                    self.assertFalse((ROOT / old / name).exists(), f"Remove authored mirror {old}/{name}")

if __name__ == "__main__":
    unittest.main()
