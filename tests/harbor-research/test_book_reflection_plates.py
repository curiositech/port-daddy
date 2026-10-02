"""Source and optional rendered witnesses for the reflective Swiss plates.

BOOK_REFLECTION_PDF must name a converged full Book or the parity fixture.
"""
import hashlib
import json
import os
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts/harbor-research'))
from check_plate_provenance import check_provenance_dir

PLATES = ROOT / 'website-v2/public/whitepaper/plates/interstitial'
SOURCES = {
    'the-controlled-opening': ('website-v2/public/whitepaper/sealed-harbor.tex', r'\section{Silence except through the slot}'),
    'the-unseen-boat': ('whitepaper/legible-swarm.tex', r'\begin{pdexample}{The Same Pull Request, Rendered Twice}'),
    'the-waiting-body': ('website-v2/public/whitepaper/spawn-to-person.tex', r"\subsection{Locke's memory criterion, and its famous bug}"),
    'the-paper-crossing': ('website-v2/public/whitepaper/federated-harbor-whitepaper.tex', r'\section{Cross-Harbor Capability Transfer}'),
}


class ReflectionSourceTests(unittest.TestCase):
    def test_named_plates_have_complete_provenance(self):
        data = json.loads((PLATES / 'PROVENANCE.json').read_text())
        self.assertEqual(set(data['plates']), set(SOURCES))
        self.assertEqual(check_provenance_dir(str(PLATES), 'interstitial', True), [])
        for plate in data['plates'].values():
            self.assertEqual(hashlib.sha256((PLATES / plate['file']).read_bytes()).hexdigest(),
                             plate['sha256'])

    def test_insertion_does_not_split_arbitrary_pages_or_add_parity_filler(self):
        macro = (ROOT / 'website-v2/public/whitepaper/figures/pd-reflection-plates.tex').read_text()
        self.assertNotIn(r'\afterpage', macro)
        self.assertNotIn(r'\cleardoublepage', macro)

    def test_interstitial_contents_preserves_chapter_counter(self):
        macro = (ROOT / 'website-v2/public/whitepaper/figures/pd-reflection-plates.tex').read_text()
        self.assertIn(r'\addcontentsline{toc}{pdplate}', macro)
        self.assertIn(r'\newcommand*{\l@pdplate}', macro)
        self.assertNotIn(r'\advance\pd@tocchapter', macro)
        for key in SOURCES:
            self.assertIn(r'\pdreflectiontitle{' + key + '}', macro)

    def test_each_plate_has_one_intentional_paragraph_boundary(self):
        for key, (source, label) in SOURCES.items():
            text = (ROOT / source).read_text()
            call = r'\pdreflectionplate{' + key + '}'
            self.assertEqual(text.count(call), 1)
            start = text.index(call)
            self.assertIn(label, text[start:start + 220])


@unittest.skipUnless(os.environ.get('BOOK_REFLECTION_PDF'), 'Set BOOK_REFLECTION_PDF')
class ReflectionRenderTests(unittest.TestCase):
    def test_registered_plates_survive_as_facing_spreads(self):
        from render_book_reflection_review import plate_spreads
        records = plate_spreads(Path(os.environ['BOOK_REFLECTION_PDF']))
        self.assertEqual({r['key'] for r in records}, set(SOURCES))
        for record in records:
            self.assertEqual(record['native_pixels'], [1024, 1536])
            self.assertGreater(len(record['facing_text']), 50)


if __name__ == '__main__':
    unittest.main()
