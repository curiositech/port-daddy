"""A listing ends on the page its last line is on. Hold what keeps it so.

Every page of the Book is ragged at the bottom, and the listings package
ends a listing by inviting a page break. TeX took the invitation, and a
listing's closing band then opened the next page alone. Two things in
figures/pd-listing.tex stop that. The package's macro is patched so that
no break can fall between a listing's last line and its band. And a section
asks for a whole listing's room with \\pdlistingroom, which counts in
points, because \\baselineskip between two paragraphs is smaller than the
pitch of the body's lines and a count in it asks for too little.

The checks read the source, since a missing band at the top of a page
leaves no text in the PDF to look for.
"""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BOOK = ROOT / 'book'
LISTING = BOOK / 'figures' / 'pd-listing.tex'

# Sections written before \pdlistingroom, with the listings in each that
# still ask for room in \baselineskip. Their pages are whole as set today.
# The numbers may fall and must not rise.
ASKS_IN_BASELINES = {
    'additions/anchor-build-the-verifier.tex': 13,
    'additions/prereq-build-the-check.tex': 5,
}
SETS_A_LISTING = r'\\(?:pdexcerpt|pdrun|pdrunlines)\b'


def code(path):
    """The file with its comments dropped."""
    return '\n'.join(re.split(r'(?<!\\)%', line, maxsplit=1)[0] for line in path.read_text().splitlines())


class ListingRoom(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.listing = code(LISTING)

    def test_the_package_reads_its_end_penalty_from_a_name(self):
        patch = re.search(r'\\patchcmd\{\\lst@DeInit\}\{([^}]*)\}\s*\{([^}]*)\}', self.listing)
        self.assertIsNotNone(patch, 'the end of a listing is no longer patched')
        self.assertIn(r'\penalty-50', patch.group(1))
        self.assertIn(r'\penalty\pd@listingendpenalty', patch.group(2))
        # Outside pdlisting the name is the package's own number.
        self.assertIn(r'\newcommand{\pd@listingendpenalty}{-50}', self.listing)

    def test_a_patch_that_no_longer_applies_stops_the_build(self):
        after = self.listing[self.listing.index(r'\patchcmd{\lst@DeInit}'):]
        self.assertRegex(after[:600], r'\\PackageError\{pd-listing\}')

    def test_no_break_can_part_a_listing_from_its_closing_band(self):
        opened = self.listing[self.listing.index(r'\newenvironment{pdlisting}'):]
        body = opened[:opened.index(r'\newenvironment{pdcallouts}')]
        self.assertIn(r'\def\pd@listingendpenalty{\@M}', body)
        # The band hangs below the last line in a box of no height, so it
        # asks for no room of its own at the foot of a page.
        self.assertRegex(body, r'\\vbox to\\z@\{[^}]*\\box\\pd@listingfoot')

    def test_a_listing_may_still_part_from_its_callouts(self):
        opened = self.listing[self.listing.index(r'\newenvironment{pdcallouts}'):]
        self.assertRegex(opened[:200], r'\\penalty-50')

    def test_room_is_asked_for_in_points(self):
        room = re.search(r'\\newcommand\{\\pdlistingroom\}\[1\]\{([^\n]*)\}', self.listing)
        self.assertIsNotNone(room, r'\pdlistingroom is gone')
        self.assertNotIn('baselineskip', room.group(1))
        self.assertRegex(room.group(1), r'\\Needspace\{\\dimexpr\d+pt\+[\d.]+pt\*#1\\relax\}')

    def test_no_new_listing_asks_for_room_in_baselines(self):
        found = {}
        for path in sorted(BOOK.glob('**/*.tex')):
            if 'excerpts' in path.parts:
                continue
            asks = re.findall(r'\\Needspace\{\d+\\baselineskip\}\s*\n' + SETS_A_LISTING, path.read_text())
            if asks:
                found[path.relative_to(BOOK).as_posix()] = len(asks)
        for name, count in found.items():
            self.assertLessEqual(
                count, ASKS_IN_BASELINES.get(name, 0),
                f'{name} asks for a listing\'s room in \\baselineskip: use \\pdlistingroom')


if __name__ == '__main__':
    unittest.main()
