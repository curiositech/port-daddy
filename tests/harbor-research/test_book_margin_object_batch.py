"""Exact art provenance and actual-Book owner placement for object batches."""
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
WEB = ROOT / 'website-v2/public/whitepaper'
ART = WEB / 'plates/margin-evidence'
RECORDS = [
    ('spawn-to-person.tex', 'stp-splice-continuity',
     'ch05-continuity-rope-splice',
     'f0893d41e5a42b073c1794f9281736d7c3e701acc06758544f531a1443cedfde',
     'Like the overlapping strands of a splice,', 'The level at which they agree'),
    ('harbor-economy.tex', 'reusable-pattern',
     'ch06-reusable-printing-block',
     'baa8bbc79d4bafeb1191da37c105e01746f260ce26e3ced07b2fbc3911aa6a39',
     'Like one printing block making many impressions,', 'Skill/tool as licensed good'),
    ('federated-harbor-whitepaper.tex', 'fh-local-admission-turnstile',
     'ch08-local-admission-turnstile',
     'e5a41d10a672e824159c4163918c3ed7478e6b715f367ee7c423a2edb94a1d12',
     'Like a visitor pass presented at a locally controlled turnstile,', 'Return to Failure'),
    (ROOT / 'whitepaper/single-writer-kernel.tex', 'batch3-ch01-ticket-dispenser',
     'ch01-fairness-ticket-dispenser',
     '6156226a0a48118f77296602de4ec03ace30e83a6bc05b29e08ac913ee23bb6c',
     'Like a ticket dispenser, the proposed lock would assign turns', 'It would introduce a'),
    ('spawn-to-person.tex', 'batch3-ch05-card-index',
     'ch05-episodic-card-file',
     'dad3d9ecbe42b27ceccdf26129d422c8f0f8dd7480b324aefb7d5c8e208f7616',
     'Like a card-index drawer, episodic memory retrieves records,', 'forwards a summary, not state'),
    ('agent-transactions-whitepaper.tex', 'batch3-ch07-repair-kit',
     'ch07-cleanup-repair-kit',
     '03effe4ecc1807830daa6303d62359618334f6faeab681d439905337ff3ab1fa',
     'Like repairing a damaged fitting, cleanup consumes work', 'cleanup cost per breach event'),
]


def normalized_text(page):
    import fitz
    return ' '.join(page.get_text(flags=fitz.TEXT_DEHYPHENATE).split()).replace('\u2011', '-')


def image_fingerprints(path):
    # PDF image streams keep straight RGB and alpha as separate streams.
    # MuPDF's PNG pixmap premultiplies RGB by alpha; dropping its alpha
    # cannot recover the original RGB and falsely rejects transparent art.
    from PIL import Image
    with Image.open(path) as source:
        rgb = hashlib.md5(source.convert('RGB').tobytes()).digest()
        alpha = (hashlib.md5(source.getchannel('A').tobytes()).digest()
                 if 'A' in source.getbands() else None)
    return rgb, alpha


class ObjectSources(unittest.TestCase):
    def test_same_size_art_has_distinct_pixel_identity(self):
        fingerprints = [image_fingerprints(ART / (row[2]+'.png'))[0] for row in RECORDS]
        self.assertEqual(len(set(fingerprints)), len(RECORDS))

    def test_inspected_art_and_exact_generation_provenance(self):
        from PIL import Image
        for chapter, identifier, stem, digest, caption, owner in RECORDS:
            with self.subTest(stem=stem):
                art_path = ART / (stem+'.png')
                self.assertEqual(hashlib.sha256(art_path.read_bytes()).hexdigest(), digest)
                metadata = json.loads((ART / (stem+'.json')).read_text())
                self.assertEqual(metadata['sha256'], digest)
                self.assertEqual(metadata['tool'], 'image_gen.imagegen')
                self.assertEqual(metadata['model'], 'not reported')
                with Image.open(art_path) as im:
                    self.assertEqual(metadata['image_size'], f"{im.width}x{im.height}")
                self.assertTrue(metadata['prompt'])
                self.assertEqual(metadata['references_uploaded'], [])
                source = (WEB / chapter).read_text()
                macro = r'\pdmarginanalogy{'+identifier+r'}{}{'+stem+'}{'
                self.assertEqual(source.count(macro), 1)
                self.assertIn(macro+caption, source)
                self.assertIn(owner, source)

    def test_replaced_documentary_assets_remain_unchanged(self):
        for extension, digest in [
            ('jpg','e3e354dd5cfb247a31c5165e5ec17396301f70c5c42b5798b14f9c482ba10cae'),
            ('json','4b8e675dcdbfe2224fd393c1adfadc6384bf5eabeea202ec9dcaa0054960c6a4')]:
            asset = WEB / 'plates/marginalia' / ('movable-type-photo.'+extension)
            self.assertEqual(hashlib.sha256(asset.read_bytes()).hexdigest(), digest)


@unittest.skipUnless(os.environ.get('BOOK_MARGIN_OBJECT_PDF'), 'exact integrated PDF not supplied')
class IntegratedObjects(unittest.TestCase):
    def test_each_native_image_is_beside_its_owner(self):
        import fitz
        sys.path.insert(0, str(ROOT/'scripts/harbor-research'))
        from page_overflow import column
        with fitz.open(os.environ['BOOK_MARGIN_OBJECT_PDF']) as doc:
            for chapter, identifier, stem, digest, caption, owner in RECORDS:
                with self.subTest(stem=stem):
                    matches = [(p, normalized_text(p))
                               for p in doc if caption in normalized_text(p)]
                    self.assertEqual(len(matches), 1)
                    page, text = matches[0]
                    self.assertIn(owner, text)
                    # Identify the actual artwork, not merely any image with its
                    # dimensions: multiple object drawings can share a page.
                    art_file = ART / (stem+'.png')
                    expected_pixels, expected_alpha = image_fingerprints(art_file)
                    with Image.open(art_file) as im:
                        expected_w, expected_h = im.width, im.height
                    images = [i for i in page.get_image_info(hashes=True, xrefs=True)
                              if i['width']==expected_w and i['height']==expected_h
                              and i['digest']==expected_pixels]
                    self.assertEqual(len(images), 1)
                    if expected_alpha is not None:
                        kind, mask_ref = doc.xref_get_key(images[0]['xref'], 'SMask')
                        self.assertEqual(kind, 'xref', 'Preserve the original transparency mask')
                        mask = fitz.Pixmap(doc, int(mask_ref.split()[0]))
                        self.assertEqual(hashlib.md5(mask.samples).digest(), expected_alpha)
                    box = fitz.Rect(images[0]['bbox'])
                    self.assertAlmostEqual(box.width, 93.6, delta=.2)
                    self.assertAlmostEqual(box.height, 93.6 * expected_h / expected_w, delta=.5)
                    self.assertTrue(page.rect.contains(box))
                    left, right, side = column(page, page.number+1)
                    if side=='R':
                        self.assertGreaterEqual(box.x0, right+10)
                    else:
                        self.assertLessEqual(box.x1, left-10)
                    self.assertLess(box.y1, 651.6)


if __name__ == '__main__':
    unittest.main()
