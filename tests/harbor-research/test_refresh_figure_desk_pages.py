"""Image slots preserve annotations while binding current figures to actual pages."""
import json
import shutil
import subprocess
from pathlib import Path
import sys
import tempfile
import unittest
import fitz

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts/harbor-research'))
import refresh_figure_desk_pages as R


class SnapshotMapping(unittest.TestCase):
    def setUp(self):
        scratch = ROOT / '.cache/figure-desk-test'
        scratch.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=scratch)
        self.root = Path(self.temp.name)
        self.addCleanup(self.temp.cleanup)
        (self.root / R.MAP).parent.mkdir(parents=True)
        (self.root / R.MAP).write_text(json.dumps({'pages': {'untouched': 20}}))
        self.pages = self.root / R.DESK / 'pages'
        self.pages.mkdir(parents=True)
        (self.pages / 'p020.jpg').write_bytes(b'preserved historical bytes')
        self.pdf = self.root / 'book.pdf'
        self.make_pdf('first')

    def make_pdf(self, text):
        with fitz.open() as doc:
            for n in range(3):
                page = doc.new_page(width=504, height=720)
                page.insert_text((40, 50), f'{text} page {n+1}')
            doc.save(self.pdf)

    def test_mapping_history_and_idempotence(self):
        slots = R.refresh(self.root, self.pdf, {'new-figure': 2})
        mapping = json.loads((self.root / R.MAP).read_text())
        self.assertEqual(mapping['pages']['untouched'], 20)
        self.assertEqual(mapping['snapshots'][str(slots['new-figure'])]['pdfPage'], 2)
        self.assertEqual((self.pages / 'p020.jpg').read_bytes(), b'preserved historical bytes')
        before = {p.name: p.read_bytes() for p in self.pages.iterdir()}
        receipt = (self.root / R.MAP).read_bytes()
        self.assertEqual(R.refresh(self.root, self.pdf, {'new-figure': 2}), slots)
        self.assertEqual((self.root / R.MAP).read_bytes(), receipt)
        self.assertEqual({p.name: p.read_bytes() for p in self.pages.iterdir()}, before)
        self.assertEqual(R.check(self.root, self.pdf), 1)

    def test_new_pdf_allocates_new_slots_without_destroying_old_images(self):
        old = R.refresh(self.root, self.pdf, {'new-figure': 2})['new-figure']
        old_bytes = (self.pages / R.image_name(old)).read_bytes()
        self.pdf.unlink(); self.make_pdf('second')
        with self.assertRaisesRegex(ValueError, 'accepted PDF'):
            R.check(self.root, self.pdf)
        new = R.refresh(self.root, self.pdf, {'new-figure': 2})['new-figure']
        self.assertNotEqual(new, old)
        self.assertEqual((self.pages / R.image_name(old)).read_bytes(), old_bytes)
        self.assertEqual(R.check(self.root, self.pdf), 1)

    def test_corruption_and_bad_page_fail_closed(self):
        with self.assertRaisesRegex(ValueError, 'outside'):
            R.refresh(self.root, self.pdf, {'bad': 9})
        slot = R.refresh(self.root, self.pdf, {'new-figure': 2})['new-figure']
        target = self.pages / R.image_name(slot)
        target.write_bytes(b'corrupt')
        with self.assertRaisesRegex(ValueError, 'Immutable image'):
            R.refresh(self.root, self.pdf, {'new-figure': 2})
        self.assertEqual(target.read_bytes(), b'corrupt')

    def test_pin_cannot_silently_point_at_neighbor_image(self):
        slot = R.refresh(self.root, self.pdf, {'new-figure': 2})['new-figure']
        mapping = json.loads((self.root / R.MAP).read_text())
        mapping['pages']['new-figure'] = slot - 1
        (self.root / R.MAP).write_text(json.dumps(mapping))
        with self.assertRaisesRegex(ValueError, 'accepted PDF'):
            R.check(self.root, self.pdf)

    def test_bundle_contains_mapping_and_all_images_without_overwriting_history(self):
        R.refresh(self.root, self.pdf, {'new-figure': 2})
        destination = self.root / 'bundle'
        (destination / 'pages').mkdir(parents=True)
        historical = destination / 'pages/p001.jpg'
        historical.write_bytes(b'history')
        self.assertEqual(R.bundle_snapshot_assets(self.root, destination), 3)
        self.assertEqual(historical.read_bytes(), b'history')
        mapping = json.loads((self.root / R.MAP).read_text())
        for slot, record in mapping['snapshots'].items():
            self.assertEqual(R.sha(destination / 'pages' / R.image_name(int(slot))), record['imageSha256'])
        self.assertEqual((destination / 'data/RENDER-SNAPSHOTS.js').read_text(), R.image_data(mapping['snapshots']))
        center = destination / 'pages' / R.image_name(mapping['pages']['new-figure'])
        center.write_bytes(b'other snapshot')
        with self.assertRaisesRegex(ValueError, 'replace an immutable image'):
            R.bundle_snapshot_assets(self.root, destination)

    def test_cli_rejects_a_pdf_other_than_the_accepted_digest(self):
        script = ROOT / 'scripts/harbor-research/refresh_figure_desk_pages.py'
        run = subprocess.run([sys.executable, '-B', str(script), '--pdf', str(self.pdf),
            '--expect-sha256', '0' * 64, '--figures', 'new-figure'], capture_output=True, text=True)
        self.assertNotEqual(run.returncode, 0)
        self.assertIn('no capture performed', run.stderr)
        self.assertEqual(set(p.name for p in self.pages.iterdir()), {'p020.jpg'})

    def test_aux_label_resolves_named_destination_to_physical_page(self):
        with fitz.open(self.pdf) as doc:
            doc.set_page_labels([{'startpage': 0, 'style': 'D', 'firstpagenum': 7}])
            page_ref = doc.page_xref(1)
            names = f'<< /Dests << /Names [(figure.1.1) [{page_ref} 0 R /XYZ 0 720 null]] >> >>'
            doc.xref_set_key(doc.pdf_catalog(), 'Names', names)
            doc.saveIncr()
        aux = self.pdf.with_suffix('.aux')
        aux.write_text(r'\newlabel{ch:fig:fixture}{{1.1}{8}{Fixture}{figure.1.1}{}}' + '\n'
                       + r'\@writefile{lof}{\contentsline {figure}{\numberline {1.1}{Fixture}}{8}{figure.1.1}}' + '\n')
        book = self.root / 'source-book'
        (book / 'figures').mkdir(parents=True)
        (book / 'figures/fixture.tex').write_text(r'\label{fig:fixture}')
        self.assertEqual(R.locate(self.pdf, aux, ['fixture'], book), {'fixture': 2})

    def test_aux_must_belong_to_accepted_pdf(self):
        aux = self.root / 'other.aux'; aux.write_text('')
        with self.assertRaisesRegex(ValueError, 'converged aux'):
            R.locate(self.pdf, aux, ['new-figure'], self.root)


class ImageLabels(unittest.TestCase):
    @unittest.skipUnless(shutil.which('node'), 'Node is needed to check the browser label helper')
    def test_slot_numbers_are_not_claimed_to_be_book_pages(self):
        source = (ROOT / R.DESK / 'index.html').read_text()
        helper = next(line for line in source.splitlines() if line.startswith('function reviewImageLabel('))
        script = 'const window={REVIEW_IMAGES:{641:{pdfPage:135}}};' + helper
        script += "if(reviewImageLabel(641)!=='PDF page 135 · review image 641')process.exit(1);"
        script += "if(reviewImageLabel(600)!=='Review image 600')process.exit(2);"
        subprocess.run(['node', '--eval', script], check=True)
        self.assertIn('<script src="data/RENDER-SNAPSHOTS.js"></script>', source)
        self.assertIn('img.alt=reviewImageLabel(S.page)', source)


class CommittedSnapshots(unittest.TestCase):
    def test_current_bindings_and_image_hashes(self):
        if not (ROOT / R.MAP).is_file():
            self.skipTest('source fixture has no desk')
        mapping = json.loads((ROOT / R.MAP).read_text())
        if not mapping.get('snapshots'):
            self.skipTest('snapshot capture has not run')
        self.assertGreater(R.check(ROOT, ROOT / R.PDF), 0)


if __name__ == '__main__':
    unittest.main()
