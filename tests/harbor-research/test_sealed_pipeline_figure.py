"""Representation and native Book-page checks, not confidentiality evidence."""
import os
from pathlib import Path
import re
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
FIG = ROOT / 'website-v2/public/whitepaper/figures/fig-sealed-pillar-pipeline.tex'
OWNER = ROOT / 'website-v2/public/whitepaper/sealed-harbor.tex'
EXPECTED = {
    'contract': r'Signed work order $C$', 'pins': 'runtime + policy',
    'signers': 'Derek + Erin sign', 'guest': 'In guest', 'worker': 'Worker',
    'handles': 'handles only', 'monitor': 'In-guest', 'monitorname': 'monitor',
    'labels': 'labels, handles', 'content': 'encrypted content',
    'controller': 'Derek-controlled', 'gateway': 'Outer gateway',
    'netstore': 'network, storage', 'timedest': 'timing, destination',
    'volume': 'volume', 'candidate': r'Candidate $\{D,E\}$',
    'derek': 'Derek authorizes', 'dropd': r'$\{D,E\}\to\{E\}$',
    'erin': 'Erin authorizes', 'drope': r'$\{D,E\}\to\{D\}$',
    'feedback': 'Feedback to Erin', 'feedbacklabel': r'$\{E\}$',
    'result': 'Rich result to Derek', 'resultlabel': r'$\{D\}$',
}
FLOWS = ['(75,145)--(90,145)', '(186,145)--(215,145)',
         '(317,145)--(321,145)--(321,251)--(160,251)--(160,263)',
         '(160,322)--(77,322)--(77,336)', '(160,322)--(243,322)--(243,336)',
         '(77,400)--(77,416)', '(243,400)--(243,416)']
BINDINGS = ['(138,72)--(138,115)', '(232,32)--(266,32)--(266,111)']


def source_contract(source):
    text = '\n'.join(line.split('%', 1)[0] for line in source.splitlines())
    nodes = {n: (float(x), float(y), body.strip()) for n, x, y, body in
             re.findall(r'\\node\[[^]]*\]\s*\(([^)]+)\)\s*at\s*'
                        r'\(([-.\d]+),([-.\d]+)\)\s*\{(.*?)\};', text, re.S)}
    assert set(nodes) == set(EXPECTED), 'missing or unexpected label'
    for name, body in EXPECTED.items():
        assert nodes[name][2] == body, 'meaning: ' + name
    for style, expected in [('sp flow', FLOWS), ('sp binding', BINDINGS)]:
        paths = re.findall(r'\\draw\[' + style + r'[^]]*\]\s*(.*?);', text, re.S)
        assert [re.sub(r'\s+', '', path) for path in paths] == expected, style
    assert '(0,101) rectangle (190,214)' in text, 'guest boundary'
    assert 'dash pattern=on 3pt off 2pt' in text, 'binding/flow distinction'
    for a, b in [('derek', 'erin'), ('dropd', 'drope'),
                 ('feedback', 'result'), ('feedbacklabel', 'resultlabel')]:
        assert nodes[a][1] == nodes[b][1], 'parallel authority/result alignment'
    assert nodes['worker'][0] < 190 and nodes['monitor'][0] < 190
    assert nodes['gateway'][0] > 190, 'gateway is outside guest'
    assert text.count(r'\caption{') == 1
    assert text.count(r'\label{fig:sealed-pillar-pipeline}') == 1
    assert r'\SGMeasuredFigure{VIII/fig:sealed-pillar-pipeline}' in text
    assert 'Proposed control flow; public receipt omitted.' in text
    for token in (r'\resizebox', r'\scalebox', r'\fontsize', r'\tiny', r'\scriptsize',
                  r'\clip', 'transform shape', 'use as bounding box',
                  'c1_noninterference', 'b3_controllability', 'a3_epsilon', 'a4_canary'):
        assert token not in text, 'shrinking or duplicate evidence table: ' + token


def page_contract(page):
    import fitz
    from page_overflow import column
    left, right, _ = column(page, page.number + 1)
    # The caption also names the signed work order; search within the body rail.
    start = [r for r in page.search_for('Signed work order') if left - 1 <= r.x0 < right]
    end = [r for r in page.search_for('Rich result to Derek') if left - 1 <= r.x0 < right]
    assert len(start) == len(end) == 1, 'new figure labels absent'
    top, bottom = start[0].y0 - 10, end[0].y1 + 23
    spans = [s for block in page.get_text('dict')['blocks']
             for line in block.get('lines', []) for s in line['spans']
             if top <= s['bbox'][1] < bottom and left - 1 <= s['bbox'][0] < right]
    plain = ' '.join(s['text'] for s in spans).replace('\u2011', '-')
    for phrase in ('runtime + policy', 'Derek + Erin sign', 'In guest',
                   'handles only', 'labels, handles', 'encrypted content',
                   'Derek-controlled', 'Outer gateway', 'network, storage',
                   'timing, destination', 'volume', 'Candidate',
                   'Derek authorizes', 'Erin authorizes',
                   'Feedback to Erin', 'Rich result to Derek'):
        assert phrase in plain, phrase
    rects = []
    for span in spans:
        assert span['bbox'][2] <= right + 1, 'text invades caption margin'
        if 'SuisseIntl' in span['font']:
            assert 8.85 <= span['size'] <= 9.05, 'not native 9pt label type'
        elif any(c.isalpha() for c in span['text']):
            # The genuine Book preamble uses newpxmath for these math letters.
            assert span['font'] == 'NewPXMI', span['font']
        if span['text'].strip():
            rects.append(fitz.Rect(span['bbox']))
    for i, first in enumerate(rects):
        for second in rects[i+1:]:
            intersection = first & second
            assert not (intersection.width > 1 and intersection.height > 2), 'label overprint'
    for a, b in [('Derek authorizes', 'Erin authorizes'),
                 ('Feedback to Erin', 'Rich result to Derek')]:
        ra, rb = page.search_for(a)[0], page.search_for(b)[0]
        assert abs(ra.y0 - rb.y0) < .2 and ra.x1 < rb.x0, 'not parallel columns'
    return top, bottom


class SourceContract(unittest.TestCase):
    def test_two_fences_independent_authorities_and_scope(self):
        source_contract(FIG.read_text())

    def test_missing_or_changed_labels_are_rejected(self):
        source = FIG.read_text()
        for name, value in EXPECTED.items():
            with self.subTest(name=name), self.assertRaises(AssertionError):
                source_contract(source.replace('{' + value + '};', '{wrong};', 1))

    def test_bypassed_fence_or_serial_gates_are_rejected(self):
        source = FIG.read_text()
        for old, new in [(FLOWS[0], '(75,145)--(215,145)'),
                         (FLOWS[2], '(186,145)--(160,263)'),
                         (FLOWS[4], '(150,378)--(170,378)'),
                         (BINDINGS[0], '(138,72)--(138,80)')]:
            with self.subTest(old=old), self.assertRaises(AssertionError):
                source_contract(source.replace(old, new))

    def test_status_omission_and_native_size_mutants(self):
        source = FIG.read_text()
        for modified in [source.replace('Proposed control flow', 'Runtime verified'),
                         source.replace('public receipt omitted', 'public receipt forbidden'),
                         source + '\n' + r'\resizebox{1pt}{!}{fake}',
                         source + '\n' + r'\caption{again}',
                         source + '\n c1_noninterference',
                         source.replace('(243,358)', '(243,370)')]:
            with self.subTest(modified=modified[-100:]), self.assertRaises(AssertionError):
                source_contract(modified)

    def test_owner_keeps_authority_separate_from_recipient(self):
        text = ' '.join(OWNER.read_text().split())
        for expected in ("Derek's gate permits feedback to Erin;",
                         "Erin's gate permits the result to Derek.",
                         'a padded public receipt to both.',
                         'Derek-controlled outer gateway mediates network, storage, timing, destination,',
                         'An attested in-guest monitor mediates labels, handles, and encrypted content;'):
            self.assertTrue(expected in text, expected)


PDF = Path(os.environ.get('BOOK_SEALED_PIPELINE_PDF',
    ROOT / '.cache/book-sealed-pipeline-20260920/coordination-papers-mega-volume.pdf'))


@unittest.skipUnless(PDF.exists(), 'integrated Book PDF is required')
class ActualBook(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import fitz
        sys.path.insert(0, str(ROOT / 'scripts/harbor-research'))
        from check_book_label_migration import parse
        cls.doc = fitz.open(PDF)
        cls.aux = PDF.with_suffix('.aux').read_bytes()
        cls.label = parse(cls.aux)['sealed:fig:sealed-pillar-pipeline']
        cls.index = cls.doc.resolve_names()[cls.label[3]]['page']

    @classmethod
    def tearDownClass(cls):
        cls.doc.close()

    def test_native_actual_page_and_parallel_outputs(self):
        page_contract(self.doc[self.index])

    def test_native_ink_size(self):
        log = PDF.with_suffix('.log').read_text()
        found = re.findall(r'SG-GEOMETRY: VIII/fig:sealed-pillar-pipeline,width=([.\d]+)pt,height=([.\d]+)pt', log)
        self.assertTrue(found)
        for width, height in found:
            self.assertAlmostEqual(float(width), 321.775, places=2)
            self.assertAlmostEqual(float(height), 474.85, places=2)

    def test_single_proposed_caption_on_figure_page(self):
        text = ' '.join(self.doc[self.index].get_text().split())
        self.assertIn('Figure ' + self.label[0] + '.', text)
        self.assertIn('Proposed control flow;', text)
        self.assertIn('public receipt omitted.', text)
        self.assertEqual(sum('Derek authorizes' in p.get_text() for p in self.doc), 1)

    def test_preceding_book_rejects_new_explicit_control_contract(self):
        import fitz
        path = ROOT / '.cache/book-enforcement-pass-20260920/coordination-papers-mega-volume.pdf'
        self.assertTrue(path.exists(), 'prior proof needed as negative control')
        from check_book_label_migration import parse
        with fitz.open(path) as doc:
            label = parse(path.with_suffix('.aux').read_bytes())['sealed:fig:sealed-pillar-pipeline']
            index = doc.resolve_names()[label[3]]['page']
            with self.assertRaises(AssertionError):
                page_contract(doc[index])


if __name__ == '__main__':
    unittest.main()
