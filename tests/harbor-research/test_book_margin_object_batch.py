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


def wrapper_image(path):
    """The print master's one image, read the way the Book's reader reads it.

    Since 2026-10-19 each analogy is a one-page PDF wrapper (JPEG + lossless
    SMask) made by scripts/whitepaper-plates/print_weight.py; the generated
    PNG lives outside the tree and is pinned by digest in the sidecar. The
    wrapper's JPEG stream is embedded in the Book byte for byte, so MuPDF's
    own digest of the decoded image identifies it inside the Book, and the
    SMask's samples identify the alpha, without any second decoder.
    Returns (width, height, rgb_md5, alpha_md5 or None).
    """
    import fitz
    with fitz.open(path) as doc:
        page = doc[0]
        info = page.get_image_info(hashes=True, xrefs=True)
        assert len(info) == 1, path
        image = info[0]
        kind, mask_ref = doc.xref_get_key(image['xref'], 'SMask')
        alpha = None
        if kind == 'xref':
            mask = fitz.Pixmap(doc, int(mask_ref.split()[0]))
            alpha = hashlib.md5(mask.samples).digest()
        return image['width'], image['height'], image['digest'], alpha


class ObjectSources(unittest.TestCase):
    def test_same_size_art_has_distinct_pixel_identity(self):
        fingerprints = [wrapper_image(ART / (row[2]+'.pdf'))[2] for row in RECORDS]
        self.assertEqual(len(set(fingerprints)), len(RECORDS))

    def test_inspected_art_and_exact_generation_provenance(self):
        for chapter, identifier, stem, digest, caption, owner in RECORDS:
            with self.subTest(stem=stem):
                metadata = json.loads((ART / (stem+'.json')).read_text())
                # Generation provenance: the sidecar pins the generated PNG by
                # digest (twice, so the print master cannot quietly change
                # what it claims to derive from), and pins the print master
                # that the Book embeds.
                self.assertEqual(metadata['sha256'], digest)
                master = metadata['print_master']
                self.assertEqual(master['source_sha256'], digest)
                self.assertEqual(master['from'], stem+'.png')
                self.assertEqual(master['file'], stem+'.pdf')
                art_path = ART / master['file']
                self.assertEqual(hashlib.sha256(art_path.read_bytes()).hexdigest(), master['sha256'])
                self.assertEqual(metadata['tool'], 'image_gen.imagegen')
                self.assertEqual(metadata['model'], 'not reported')
                width, height, _, alpha = wrapper_image(art_path)
                self.assertEqual(master['pixels'], [width, height])
                self.assertIsNotNone(alpha, 'the cutout keeps its transparency as an SMask')
                generated_w, generated_h = (int(v) for v in metadata['image_size'].split('x'))
                self.assertAlmostEqual(width/height, generated_w/generated_h, delta=0.01)
                self.assertLessEqual(max(width, height), 720)
                self.assertTrue(metadata['prompt'])
                self.assertEqual(metadata['references_uploaded'], [])
                source = (WEB / chapter).read_text()
                if r'\pdmarginanalogy{' + identifier in source:
                    macro = r'\pdmarginanalogy{'+identifier+r'}{}{'+stem+'}{'
                    self.assertEqual(source.count(macro), 1)
                    self.assertIn(macro+caption, source)
                else:
                    self.assertIn(identifier, source)
                    self.assertIn(stem, source)
                    self.assertTrue(caption in source or caption.replace("a splice,", "a wire rope splice,") in source)
                self.assertIn(owner, source)

    # The photograph the movable-type analogy replaced (marginalia/
    # movable-type-photo.{jpg,json}) was kept in the tree as a documentary
    # source until 2026-10-19, when the Book's unprinted binaries were removed;
    # its licence record and the digests this test pinned stay in git history.


@unittest.skipUnless(os.environ.get('BOOK_MARGIN_OBJECT_PDF'), 'exact integrated PDF not supplied')
class IntegratedObjects(unittest.TestCase):
    def test_each_native_image_is_beside_its_owner(self):
        import fitz
        sys.path.insert(0, str(ROOT/'scripts/harbor-research'))
        from page_overflow import column
        with fitz.open(os.environ['BOOK_MARGIN_OBJECT_PDF']) as doc:
            for chapter, identifier, stem, digest, caption, owner in RECORDS:
                with self.subTest(stem=stem):
                    variants = (caption, caption.replace("a splice,", "a wire rope splice,"))
                    matches = [(p, normalized_text(p))
                               for p in doc if any(v in normalized_text(p) for v in variants)]
                    self.assertEqual(len(matches), 1)
                    page, text = matches[0]
                    self.assertIn(owner, text)
                    # Identify the actual artwork, not merely any image with its
                    # dimensions: multiple object drawings can share a page.
                    art_file = ART / (stem+'.pdf')
                    expected_w, expected_h, expected_pixels, expected_alpha = wrapper_image(art_file)
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
                    # Two placements exist. \pdmarginanalogy sets the art at
                    # width=\linewidth (the 1.3 in margin column: 93.6 pt),
                    # height=0.14\textheight, keepaspectratio -- the page is
                    # 10 in tall with 0.85 in above and 0.95 in below the
                    # block, so a tall plate is held to 82.66 pt and ends up
                    # narrower than the column. \pdwrapanalogy[side][<f>\textwidth]
                    # wraps it into the 4.5 in text block at that fraction.
                    source = (WEB / chapter).read_text()
                    wrapped = re.search(r'\\pdwrapanalogy\[[lr]\]\[([0-9.]+)\\textwidth\]\{' + re.escape(identifier) + r'\}', source)
                    if wrapped:
                        expected_width = float(wrapped.group(1)) * (7 - 0.8 - 1.7) * 72
                    else:
                        height_cap = 0.14 * (10 - 0.85 - 0.95) * 72
                        expected_width = min(93.6, height_cap * expected_w / expected_h)
                    self.assertAlmostEqual(box.width, expected_width, delta=.3)
                    self.assertAlmostEqual(box.height, expected_width * expected_h / expected_w, delta=.5)
                    self.assertTrue(page.rect.contains(box))
                    self.assertLess(box.y1, 651.6)
                    if wrapped:
                        continue  # a wrapped figure sits inside the block, not beside it
                    left, right, side = column(page, page.number+1)
                    if side=='R':
                        self.assertGreaterEqual(box.x0, right+10)
                    else:
                        self.assertLessEqual(box.x1, left-10)


if __name__ == '__main__':
    unittest.main()
