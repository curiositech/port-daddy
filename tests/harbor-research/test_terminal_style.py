"""Terminal enclosure contracts; optional real-preamble, page-spanning proof."""
import hashlib
import os
from pathlib import Path
import re
import shutil
import subprocess
import unittest
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[2]
WEB = ROOT / 'website-v2/public/whitepaper'
ROLLBACK_SHA256 = 'bd837108cbdebb30afc4ff9332b87a6d6023bb6b4be2b8b3d3195831d03a5be2'
TERMINAL_SHA256 = '4f9b6488b237757d5cb615ccd07502fa99774826839e2a99017784bdb2596f1a'
LICENSE_SHA256 = 'b495047bd93a9b06913511076f504daba17d5bbeb3e0650f3bb53a4220329c57'


def compact(text):
    return re.sub(r'\s+', '', text)


class TerminalStyle(unittest.TestCase):
    def test_shared_sources_remain_identical(self):
        self.assertEqual((ROOT / 'whitepaper/figures/pd-pedagogy.tex').read_bytes(),
                         (WEB / 'figures/pd-pedagogy.tex').read_bytes())

    def test_full_frame_uses_shared_hooks_and_preserves_verbatim_terminator(self):
        source = (WEB / 'figures/pd-pedagogy.tex').read_text()
        terminal = source.split(r'\lstnewenvironment{pdsession}', 1)[1].split('% pdsampledata', 1)[0]
        for token in (r'\pdblockbefore{Terminal transcript}', r'\pdblockafter{Terminal transcript}',
                      r'\def\@currenvir{pdsession}', r'\def\@currenvir{tcolorbox}',
                      r'\def\pdblock@color{pdteal}', 'figures/lucide/terminal.pdf'):
            self.assertIn(token, terminal)
        self.assertNotIn(r'\pd@sessionedge', source)
        self.assertNotIn(r'\rule{.18\pd@sessionwidth}', terminal)
        self.assertNotIn('fractional top rule', source)
        shared = (WEB / 'figures/pd-semantic-blocks.tex').read_text()
        for state in ('unbroken', 'first', 'middle', 'last'):
            self.assertIn('overlay ' + state + r'={\pdblock@frame}', shared)

    def test_native_size_wraps_without_scaling(self):
        source = (WEB / 'figures/pd-pedagogy.tex').read_text()
        terminal = source.split(r'\lstdefinestyle{pdsession}', 1)[1].split('% pdsampledata', 1)[0]
        for token in (r'\fontsize{8.6}{10.6}', 'keepspaces=true', 'breaklines=true',
                      'breakatwhitespace=false', 'breakindent=2em', 'upquote=true', r'literate={-}{{\char45}}1'):
            self.assertIn(token, terminal)
        self.assertLess(terminal.index(r'\pdblockbefore'), terminal.rindex(r'\pd@measurewidefield'))
        self.assertNotIn(r'\resizebox', terminal)
        self.assertNotIn(r'\scalebox', terminal)

    def test_synthetic_feedpaper_stays_separate_and_neutral(self):
        source = (WEB / 'figures/pd-pedagogy.tex').read_text()
        sample = source.split(r'\newtcblisting{pdsampledata}', 1)[1].split('% ---------------------------------------------------------------------------', 1)[0]
        for token in ('SAMPLE DATA', 'colframe=pdinkmuted!62,colback=pdinkmuted!5', 'circle[radius=1.35pt]'):
            self.assertIn(token, sample)
        self.assertNotIn('pdteal', sample)

    def test_canonical_recorded_excerpt_exact_bytes(self):
        # Pins comments, caption, whitespace, blank lines, command, and stdout.
        # Deliberate research updates must explicitly revise this reviewed hash.
        self.assertEqual(hashlib.sha256((WEB / 'figures/session-fh-rollback.tex').read_bytes()).hexdigest(), ROLLBACK_SHA256)

    def test_fixture_reuses_excerpt_and_has_no_machine_specific_paths(self):
        fixture = (ROOT / 'tests/harbor-research/fixtures/terminal-style-book.tex').read_text()
        self.assertIn(r'\input{figures/session-fh-rollback.tex}', fixture)
        self.assertIn(r'\input{terminal-inventory-session.tex}', fixture)
        self.assertIn(r'\marginnote', fixture)
        self.assertNotIn('CardRevocation_rollback.cfg', fixture)
        self.assertNotIn(r'\pdcite', fixture)
        for path in ('/Users/', '/tmp/', '/private/tmp/'):
            self.assertNotIn(path, fixture)

    def test_official_svg_and_full_license(self):
        for directory in (ROOT / 'whitepaper', WEB):
            assets = directory / 'figures/lucide'
            self.assertEqual(hashlib.sha256((assets / 'terminal.svg').read_bytes()).hexdigest(), TERMINAL_SHA256)
            self.assertEqual(hashlib.sha256((assets / 'LICENSE').read_bytes()).hexdigest(), LICENSE_SHA256)
        vendor = (ROOT / 'scripts/harbor-research/vendor_lucide_book_icons.sh').read_text()
        self.assertIn('951813ce76a859d4d8b145366972cbb237147a4e', vendor)
        self.assertRegex(vendor, r'file-text\s+terminal.*?; do')
        self.assertIn('--format=pdf1.5', vendor)


@unittest.skipUnless(os.environ.get('BOOK_TERMINAL_PDF'), 'rendered fixture not provided')
class RenderedTerminalStyle(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not shutil.which('pdftohtml'):
            raise RuntimeError('BOOK_TERMINAL_PDF was set but Poppler pdftohtml is unavailable')
        cls.path = Path(os.environ['BOOK_TERMINAL_PDF'])
        result = subprocess.run(['pdftohtml', '-xml', '-hidden', '-i', '-zoom', '1', '-stdout', str(cls.path)], capture_output=True, check=True)
        cls.xml = ET.fromstring(result.stdout)
        cls.pages = cls.xml.findall('page')
        cls.fonts = {f.get('id'): f.get('family') for f in cls.xml.iter('fontspec')}
        cls.page_text = [''.join(''.join(t.itertext()) for t in p.findall('text')) for p in cls.pages]
        cls.text = ''.join(cls.page_text)
        cls.mono = ''.join(''.join(t.itertext()) for t in cls.xml.iter('text')
                           if any(font in cls.fonts[t.get('font')] for font in ('Menlo', 'SourceCodePro', 'Source Code Pro')))

    def test_real_split_and_caption_numbering(self):
        self.assertEqual(len(self.pages), 3)
        self.assertIn('001 ', self.page_text[1])
        self.assertIn('048 ', self.page_text[2])
        for number in (1, 2, 3):
            self.assertEqual(self.text.count(f'Listing {number}.'), 1)
        self.assertIn('SAMPLE DATA', self.text)

    def test_recorded_text_survives_wrapping(self):
        original = (WEB / 'figures/session-fh-rollback.tex').read_text()
        body = original.split(r'\begin{pdsession}', 1)[1].split('\n', 1)[1].split(r'\end{pdsession}', 1)[0]
        captured = (self.path.parent / 'terminal-inventory.txt').read_text()
        for line in (body + captured).splitlines():
            if line.strip():
                self.assertIn(compact(line), compact(self.mono))
        self.assertIn('$ printf "inventory captured\\n"', self.mono)

    def test_bounds_margin_notes_and_warnings(self):
        self.assertIn(compact('Direct margin note from inside the frame.'), compact(self.text))
        self.assertNotIn('References', self.text)
        for page in self.pages:
            self.assertGreater(len(page.findall('text')), 10)
            for text in page.findall('text'):
                self.assertGreaterEqual(float(text.get('left')), 0)
                self.assertGreaterEqual(float(text.get('top')), 0)
                self.assertLessEqual(float(text.get('left')) + float(text.get('width')), float(page.get('width')) + 1)
                self.assertLessEqual(float(text.get('top')) + float(text.get('height')), float(page.get('height')) + 1)
        log = self.path.with_suffix('.log').read_text()
        self.assertIn('PD-MARGIN-CONVERGENCE: complete', log)
        for token in ('Overfull', 'Underfull', 'Missing character', 'undefined references', 'undefined citations'):
            self.assertNotIn(token, log)


if __name__ == '__main__':
    unittest.main()
