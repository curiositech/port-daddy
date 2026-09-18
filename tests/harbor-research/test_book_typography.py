"""Pinned fonts and role routing are inputs to both Book and fragment builds."""
import hashlib
import json
from pathlib import Path
import re
import unittest

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


if __name__ == "__main__":
    unittest.main()
