"""The Book's pedagogy macros exist twice and must stay one file.

`whitepaper/figures/pd-pedagogy.tex` and its copy under `website-v2/public/`
are byte-identical on purpose: the Book pulls one, the standalone chapter twins
pull the other, and every margin device -- \\pdmarginfigure, \\pdgloss, \\pdprov,
\\pdprovedon, the Recall blocks -- is defined in both. Nothing enforced that.
An edit to one twin would have diverged silently, and the failure would surface
as a chapter whose margin apparatus behaves differently from the same chapter
inside the Book: a defect nobody would think to look for, in a file nobody
would think to diff.

The same holds for the palette and figure-language twins, which are copies for
the same reason, so all three pairs are checked here rather than one.
"""
from __future__ import annotations

import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TWINS = [
    ("whitepaper/figures/pd-pedagogy.tex", "website-v2/public/whitepaper/figures/pd-pedagogy.tex"),
    ("whitepaper/figures/pd-palette.tex", "website-v2/public/whitepaper/figures/pd-palette.tex"),
    ("whitepaper/figures/pd-figure-language.tex", "website-v2/public/whitepaper/figures/pd-figure-language.tex"),
]


class PedagogyTwinsTests(unittest.TestCase):
    def test_every_twin_pair_is_byte_identical(self):
        for left, right in TWINS:
            a, b = ROOT / left, ROOT / right
            if not a.exists() and not b.exists():
                # Neither side is here: a pair this tree does not carry at all is
                # not this test's business. One side missing is, and is checked
                # below -- skipping that case is how a twin added on one side and
                # forgotten on the other passes unnoticed, which is the same
                # silent asymmetry the byte comparison exists to prevent.
                continue
            self.assertTrue(
                a.exists(), f"{right} exists but its twin {left} does not; a twin was added on one side only",
            )
            self.assertTrue(
                b.exists(), f"{left} exists but its twin {right} does not; a twin was added on one side only",
            )
            self.assertEqual(
                a.read_bytes(), b.read_bytes(),
                f"{left} and {right} have diverged; they are one file kept in two places",
            )

    def test_the_pedagogy_pair_is_present(self):
        # The pair this test was written for must actually be checked, or a
        # rename would turn the loop above into a no-op that always passes.
        left, right = TWINS[0]
        self.assertTrue((ROOT / left).exists(), f"missing {left}")
        self.assertTrue((ROOT / right).exists(), f"missing {right}")


if __name__ == "__main__":
    unittest.main()
