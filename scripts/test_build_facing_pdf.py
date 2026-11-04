#!/usr/bin/env python3
"""Fidelity and refusal tests for the public facing-page PDF builder."""
import json
from pathlib import Path
import tempfile
import unittest

import fitz

from build_facing_pdf import build, file_hash, canonical_destination

ROOT = Path(__file__).resolve().parents[1]


def fixture(path, count):
    doc = fitz.open()
    for i in range(count):
        page = doc.new_page(width=300+i*10, height=420-i*5)
        page.insert_text((25, 35), f'Page {i+1}: exact half text.\nUnique material {i*i}.')
        page.draw_rect(fitz.Rect(20, 110, 80, 155), color=(.1, .3, .7), fill=(.7, .8, .9))
    doc[0].insert_link({'kind': fitz.LINK_URI, 'from': fitz.Rect(25, 60, 140, 75),
                        'uri': 'https://example.org/path?q=1#topic'})
    doc[0].insert_link({'kind': fitz.LINK_GOTO, 'from': fitz.Rect(25, 85, 140, 100),
                        'page': 3, 'to': fitz.Point(23, 88), 'zoom': 1.25})
    doc.xref_set_key(doc.pdf_catalog(), 'Names',
                    f'<</Dests <</Names [(landing) [{doc.page_xref(count-1)} 0 R /XYZ 42 {doc[count-1].rect.height-73} 1.5]]>>>>')
    doc[2].insert_link({'kind': fitz.LINK_GOTO, 'from': fitz.Rect(25, 60, 140, 75),
                        'page': -1, 'to': 'landing'})
    doc[count-1].insert_link({'kind': fitz.LINK_GOTO, 'from': fitz.Rect(25, 85, 140, 100),
                              'page': 0, 'to': fitz.Point(25, 35)})
    doc.set_toc([
        [1, 'Cover', 1, {'kind': fitz.LINK_GOTO, 'page': 0, 'to': fitz.Point(25, 35)}],
        [1, 'Chapter', 4, {'kind': fitz.LINK_GOTO, 'page': 3, 'to': fitz.Point(23, 88), 'bold': True}],
        [2, 'Named target', count, {'kind': fitz.LINK_GOTO, 'page': count-1, 'to': fitz.Point(42, 73)}],
        [1, 'Website', -1, {'kind': fitz.LINK_URI, 'uri': 'https://example.org/book'}],
    ])
    doc.xref_set_key(doc.get_toc(simple=False)[2][3]['xref'], 'A', '<</S/GoTo/D(landing)>>')
    doc.set_metadata({'title': 'Facing copy fixture', 'author': 'Example author'})
    doc.save(path)
    doc.close()


class FacingCopyTests(unittest.TestCase):
    def setUp(self):
        scratch = ROOT / '.scratch'
        scratch.mkdir(exist_ok=True)
        self.directory = tempfile.TemporaryDirectory(prefix='facing-pdf-test-', dir=scratch)
        self.root = Path(self.directory.name)

    def tearDown(self):
        self.directory.cleanup()

    def test_odd_and_even_books_preserve_pixels_navigation_and_repeatable_bytes(self):
        for count in (5, 6):
            with self.subTest(pages=count):
                source = self.root / f'source-{count}.pdf'
                output = self.root / f'spreads-{count}.pdf'
                receipt = self.root / f'spreads-{count}.json'
                fixture(source, count)
                result = build(source, output, receipt)
                self.assertEqual(json.loads(receipt.read_text()), result)
                self.assertEqual(result['source']['sha256'], file_hash(source))
                self.assertEqual(result['output']['sha256'], file_hash(output))
                self.assertEqual(result['output']['bytes'], output.stat().st_size)
                self.assertNotIn(str(ROOT), receipt.read_text())
                self.assertEqual(result['verification']['blank_halves'], 1 if count % 2 else 2)
                self.assertEqual(result['verification']['links'], 4)
                self.assertEqual(result['verification']['bookmarks'], 4)
                self.assertEqual(result['verification']['named_destinations'], 1)
                with fitz.open(source) as src, fitz.open(output) as out:
                    self.assertEqual(len(out), (count+2)//2)
                    self.assertEqual(out.metadata, src.metadata)
                    self.assertEqual(out[0].get_label(), '1')
                    self.assertEqual(out[1].get_label(), '2, 3')
                    for i in range(count):
                        spread = (i+1)//2
                        x = 0 if i % 2 else src[i-1 if i else 0].rect.width
                        clip = fitz.Rect(x, 0, x+src[i].rect.width, src[i].rect.height)
                        self.assertEqual(src[i].get_pixmap().samples, out[spread].get_pixmap(clip=clip).samples)
                    self.assertEqual(out[0].get_text(clip=fitz.Rect(0, 0, 300, 420)), '')
                    first_links = out[0].get_links()
                    self.assertEqual(first_links[0]['uri'], 'https://example.org/path?q=1#topic')
                    self.assertEqual(first_links[1]['page'], 2)
                    self.assertEqual(first_links[1]['to'], fitz.Point(23, 88))
                    self.assertEqual(canonical_destination(out, first_links[1], out.resolve_names())['zoom'], 1.25)
                    self.assertRegex(out.xref_get_key(first_links[1]['xref'], 'A/D')[1], r'/XYZ\s+23\s+317\s+1\.25\s*\]')
                    self.assertEqual(out.resolve_names()['landing']['zoom'], 1.5)
                    self.assertEqual(out[1].get_links()[0]['nameddest'], 'landing')
                    self.assertEqual(out.get_toc()[2][:2], [2, 'Named target'])
                    self.assertTrue(out.get_toc(simple=False)[1][3]['bold'])
                # Rebuilding the same source with the same reader must not churn artifacts.
                self.assertEqual(build(source, output, receipt, force=True), result)

    def test_nested_bookmarks_keep_mixed_expansion_states_and_descendant_counts(self):
        source = self.root / 'nested.pdf'
        doc = fitz.open()
        doc.new_page()
        doc[0].insert_text((30, 30), 'Nested outline')
        doc.set_toc([[1, 'Expanded root', 1], [2, 'Collapsed child', 1],
                     [3, 'Hidden A', 1], [3, 'Hidden B', 1], [2, 'Visible sibling', 1],
                     [1, 'Collapsed root', 1], [2, 'Expanded child', 1],
                     [3, 'Hidden grandchild', 1], [2, 'Hidden sibling', 1]], collapse=0)
        entries = doc.get_toc(simple=False)
        for index, count in {0: 2, 1: -2, 5: -3, 6: 1}.items():
            doc.xref_set_key(entries[index][3]['xref'], 'Count', str(count))
        outline = int(doc.xref_get_key(doc.pdf_catalog(), 'Outlines')[1].split()[0])
        doc.xref_set_key(outline, 'Count', '4')
        doc.save(source)
        doc.close()
        output = self.root / 'nested-spreads.pdf'
        result = build(source, output, self.root / 'nested.json')
        self.assertTrue(result['verification']['bookmark_states_checked'])
        with fitz.open(source) as src, fitz.open(output) as out:
            original, copied = src.get_toc(simple=False), out.get_toc(simple=False)
            self.assertEqual([item[3].get('collapse') for item in copied],
                             [False, True, None, None, None, True, False, None, None])
            for a, b in zip(original, copied):
                self.assertEqual(src.xref_get_key(a[3]['xref'], 'Count'),
                                 out.xref_get_key(b[3]['xref'], 'Count'))
            out_outline = int(out.xref_get_key(out.pdf_catalog(), 'Outlines')[1].split()[0])
            self.assertEqual(out.xref_get_key(out_outline, 'Count'), ('int', '4'))

    def test_unsupported_navigation_does_not_replace_published_files(self):
        source = self.root / 'unsupported.pdf'
        output = self.root / 'published.pdf'
        receipt = self.root / 'published.json'
        doc = fitz.open()
        doc.new_page()
        doc[0].insert_link({'kind': fitz.LINK_LAUNCH, 'from': fitz.Rect(25, 60, 140, 75), 'file': 'external.pdf'})
        doc.save(source)
        doc.close()
        output.write_bytes(b'previous accepted output')
        receipt.write_text('previous accepted receipt')
        with self.assertRaisesRegex(ValueError, 'Unsupported navigation kind'):
            build(source, output, receipt, force=True)
        self.assertEqual(output.read_bytes(), b'previous accepted output')
        self.assertEqual(receipt.read_text(), 'previous accepted receipt')
        self.assertEqual(list(self.root.glob('*.pending.*')), [])

    def test_unsupported_internal_view_mode_is_not_silently_changed_to_xyz(self):
        source = self.root / 'fit-view.pdf'
        doc = fitz.open()
        doc.new_page()
        doc.new_page()
        doc[0].insert_link({'kind': fitz.LINK_GOTO, 'from': fitz.Rect(25, 60, 140, 75),
                            'page': 1, 'to': fitz.Point(0, 0)})
        serialized = doc.tobytes()
        doc.close()
        doc = fitz.open(stream=serialized, filetype='pdf')
        xref = doc[0].get_links()[0]['xref']
        doc.xref_set_key(xref, 'A/D', f'[{doc.page_xref(1)} 0 R /Fit]')
        doc.save(source)
        doc.close()
        output = self.root / 'fit-view-spreads.pdf'
        with self.assertRaisesRegex(ValueError, 'Unsupported.*destination'):
            build(source, output, self.root / 'fit-view.json')
        self.assertFalse(output.exists())

    def test_geometry_annotations_and_colliding_paths_are_rejected(self):
        for kind in ('rotation', 'crop', 'annotation'):
            source = self.root / f'{kind}.pdf'
            doc = fitz.open()
            page = doc.new_page(width=300, height=420)
            if kind == 'rotation':
                page.set_rotation(90)
            elif kind == 'crop':
                page.set_cropbox(fitz.Rect(10, 10, 290, 410))
            else:
                page.add_text_annot((30, 30), 'Must not disappear')
            doc.save(source)
            doc.close()
            output = self.root / f'{kind}-spreads.pdf'
            receipt = self.root / f'{kind}.json'
            with self.subTest(kind=kind), self.assertRaisesRegex(ValueError, 'Unsupported'):
                build(source, output, receipt)
            self.assertFalse(output.exists())
            self.assertFalse(receipt.exists())
        with self.assertRaisesRegex(ValueError, 'must differ'):
            build(source, source, receipt, force=True)
        with self.assertRaisesRegex(ValueError, 'must differ'):
            build(source, output, source, force=True)


if __name__ == '__main__':
    unittest.main()
