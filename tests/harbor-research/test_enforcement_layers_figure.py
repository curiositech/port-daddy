"""Source/representation and actual-page gates, not runtime enforcement proof."""
import json
import os
from pathlib import Path
import re
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
FIG = ROOT / 'whitepaper/figures/fig-swk-enforcement-layers.tex'
GRADES = {'guardgrade': r'\Built', 'hookgrade': r'\Designed',
          'pushgrade': r'\Designed', 'credentialgrade': r'\Vision',
          'isolationgrade': r'\Vision', 'cryptograde': r'\Built'}
FLOWS = [
    '(28,40)--(28,28)--(281,28)--(281,44)',
    '(70,65)--(102,65)', '(200,65)--(252,65)', '(151,95)--(151,113)',
    '(282,96)--(282,158)--(37,158)--(37,170)', '(110,200)--(151,200)',
]


def contract(source):
    text = '\n'.join(line.split('%', 1)[0] for line in source.splitlines())
    nodes = {name: (float(x), float(y), body.strip()) for name, x, y, body in
             re.findall(r'\\node\[[^]]*\]\s*\(([^)]+)\)\s*at\s*'
                        r'\(([-.\d]+),([-.\d]+)\)\s*\{(.*?)\};', text, re.S)}
    for name, expected in GRADES.items():
        assert nodes[name][2] == expected, 'source grade: ' + name
    required = {
        'bypasslabel': 'Unchecked same-user bypass', 'optional': 'if invoked',
        'preeffect': 'before effect', 'witnessed': 'if witnessed',
        'posteffect': 'after effect', 'respond': 'on violation',
        'notprevent': 'cannot prevent that effect',
        'coverage': 'No promise that every bypass is witnessed.',
        'isolationrow': 'OS/VM isolation + protected state',
        'mediation': r'\textbf{and} forced mediation',
        'notcompulsory': 'Authorization proof, not compulsory use.',
    }
    for name, expected in required.items():
        assert nodes[name][2] == expected, 'meaning: ' + name
    flows = re.findall(r'\\draw\[el flow[^]]*\]\s*(.*?);', text, re.S)
    assert [re.sub(r'\s+', '', flow) for flow in flows] == FLOWS, 'flow topology'
    assert nodes['monitor'][1] > nodes['effect'][1], 'post-effect monitor lane'
    for phrase in ('Grades are source-reported, not an independent runtime audit.',
                   r'\SGMeasuredFigure{II/fig:swk-enforcement-layers}'):
        assert phrase in text, phrase
    assert text.count(r'\caption{') == 1
    assert text.count(r'\label{fig:swk-enforcement-layers}') == 1
    for phrase in (r'\resizebox', r'\scalebox', r'\fontsize', r'\tiny',
                   r'\scriptsize', 'transform shape', r'\clip'):
        assert phrase not in text, 'shrinking/clipping: ' + phrase


def page_contract(page):
    """Check the distinctions inside the figure, not a nearby corrective sentence."""
    from page_overflow import column
    import fitz
    left, right, _ = column(page, page.number + 1)
    # The Book promotes an in-word hyphen to a nonbreaking hyphen; it is not
    # a different diagram label and must not become a false missing-text report.
    start = (page.search_for('Unchecked same-user bypass')
             + page.search_for('Unchecked same\u2011user bypass'))
    end = page.search_for('Authorization proof, not compulsory use.')
    assert len(start) == len(end) == 1, 'figure contract labels absent'
    top, bottom = start[0].y0 - 1, end[0].y1 + 1
    spans = [s for block in page.get_text('dict')['blocks']
             for line in block.get('lines', []) for s in line['spans']
             if top <= s['bbox'][1] < bottom and left-1 <= s['bbox'][0] < right]
    plain = ' '.join(s['text'] for s in spans)
    for phrase in ('if invoked', 'before effect', 'if witnessed', 'after effect',
                   'on violation', 'cannot prevent that effect',
                   'No promise that every bypass is witnessed.',
                   'OS/VM isolation + protected state', 'forced mediation'):
        assert phrase in plain, phrase
    for grade in ('implemented', 'specified', 'proposed'):
        assert sum(s['text'] == grade for s in spans) == 2, grade
    for span in spans:
        assert 'SuisseIntl' in span['font'], span
        assert 8.6 <= span['size'] <= 8.9, 'not native figure type'
        assert span['bbox'][2] <= right + 1, 'figure text invades margin'
    rects = [fitz.Rect(s['bbox']) for s in spans if s['text'].strip()]
    for i, first in enumerate(rects):
        for second in rects[i+1:]:
            overlap = first & second
            assert not (overlap.width > 1 and overlap.height > 2), 'label overlap'
    for drawing in page.get_drawings():
        rect = drawing['rect']
        if top <= rect.y0 < bottom and rect.x0 >= left - 1:
            assert rect.x1 <= right + 1, 'drawing invades margin'
    return top, bottom


def explanation_follows_figure(doc, index):
    """A deferred float must not interrupt the following paragraph halfway."""
    matches = [(page.number, rect) for page in doc
               for rect in page.search_for('That separate boundary is therefore')]
    assert len(matches) == 1, 'owning explanation absent or duplicated'
    page, rect = matches[0]
    assert page >= index, 'figure interrupts its following explanation'
    if page == index:
        bottom = doc[index].search_for('Authorization proof, not compulsory use.')[0].y1
        assert rect.y0 > bottom, 'explanation starts above the figure'


class EnforcementSource(unittest.TestCase):
    def test_compact_credits_keep_full_titles_and_archival_records(self):
        entries = json.loads((ROOT / 'whitepaper/citation-margin-entries.json').read_text())
        chapter = (ROOT / 'whitepaper/single-writer-kernel.tex').read_text()
        for key, author, year in [('young2019gvisor', 'Young', '2019'),
                                  ('mohan1992aries', 'Mohan', '1992')]:
            selected = [entry for entry in entries if entry['key'] == key]
            self.assertEqual(len(selected), 1)
            entry = selected[0]
            self.assertIn(entry['original'], chapter)
            title = entry['original'].split(r'\newblock ')[1].strip().removesuffix('.')
            self.assertEqual(entry['margin'], author + ' et al. ' + year + r'. \emph{' + title + '}.')

    def test_source_contract(self):
        contract(FIG.read_text())

    def test_status_and_semantic_mutants_are_rejected(self):
        source = FIG.read_text()
        changes = [
            (r'(hookgrade) at (245,298) {\Designed}', r'(hookgrade) at (245,298) {\Built}'),
            (r'(pushgrade) at (245,317) {\Designed}', r'(pushgrade) at (245,317) {\Built}'),
            (r'(credentialgrade) at (245,336) {\Vision}', r'(credentialgrade) at (245,336) {\Built}'),
            (r'(isolationgrade) at (245,368) {\Vision}', r'(isolationgrade) at (245,368) {\Built}'),
            ('if invoked', 'always invoked'), ('before effect', 'after effect'),
            ('if witnessed', 'always'), ('on violation', 'always'),
            ('cannot prevent that effect', 'prevents that effect'),
            ('No promise that every bypass is witnessed.', 'Every bypass is witnessed.'),
            ('OS/VM isolation + protected state', 'OS/VM isolation'),
            (r'\textbf{and} forced mediation', 'isolation alone suffices'),
            ('Authorization proof, not compulsory use.', 'Authorization forces use.'),
            ('Grades are source-reported, not an independent runtime audit.', 'Runtime verified.'),
        ]
        for old, new in changes:
            self.assertIn(old, source)
            with self.subTest(new=new), self.assertRaises(AssertionError):
                contract(source.replace(old, new))

    def test_path_and_scale_mutants_are_rejected(self):
        source = FIG.read_text()
        for old, new in [(FLOWS[0], '(28,40)--(110,57)'),
                         (FLOWS[4], '(28,40)--(37,170)'),
                         (FLOWS[3], '(151,95)--(281,44)')]:
            with self.subTest(new=new), self.assertRaises(AssertionError):
                contract(source.replace(old, new))
        with self.assertRaises(AssertionError):
            contract(source + r'\scalebox{.8}{x}')

    def test_owner_agrees_with_source_grades_and_optional_route(self):
        source = (ROOT / 'whitepaper/single-writer-kernel.tex').read_text()
        owner = source[source.index(r'\label{sec:enforcement-gap}'):
                       source.index(r'\subsection{Partial actor-soul')]
        for phrase in (r'hook harness} (\Designed{})',
                       r'layer (\Designed)', r'per request (\Vision)',
                       r'with forced egress (\Vision)',
                       'A guard the process can decline to invoke is advisory.',
                       'separates optional pre-effect refusal, the unchecked same-user route',
                       "conditional post-effect response, alongside each mechanism's source-reported maturity."):
            self.assertIn(phrase, owner)
        self.assertNotIn('what every\nlayer actually stops', owner)
        self.assertIn('\\input{figures/fig-swk-enforcement-layers}\n\\FloatBarrier', owner)


@unittest.skipUnless(os.environ.get('BOOK_ENFORCEMENT_PDF'), 'assembled Book not supplied')
class EnforcementPages(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import fitz
        sys.path.insert(0, str(ROOT / 'scripts/harbor-research'))
        from check_book_label_migration import parse
        cls.path = Path(os.environ['BOOK_ENFORCEMENT_PDF'])
        cls.doc = fitz.open(cls.path)
        cls.labels = parse(cls.path.with_suffix('.aux').read_bytes())
        cls.index = cls.doc.resolve_names()[cls.labels['swk:fig:swk-enforcement-layers'][3]]['page']

    @classmethod
    def tearDownClass(cls):
        cls.doc.close()

    def test_actual_native_page(self):
        page_contract(self.doc[self.index])

    def test_true_ink_width_and_native_height(self):
        matches = re.findall(r'SG-GEOMETRY: II/fig:swk-enforcement-layers,width=([.\d]+)pt,height=([.\d]+)pt',
                             self.path.with_suffix('.log').read_text())
        self.assertEqual(len(matches), 1)
        width, height = map(float, matches[0])
        self.assertLessEqual(width, 325.21503)
        self.assertTrue(421 < height < 424)

    def test_explanation_follows_its_figure(self):
        explanation_follows_figure(self.doc, self.index)

    def test_interrupted_explanation_is_a_rendered_negative_control(self):
        import fitz
        from check_book_label_migration import parse
        path = ROOT / '.cache/book-enforcement-pass-20260920/rejected-interrupted-paragraph.pdf'
        labels = parse(path.with_suffix('.aux').read_bytes())
        with fitz.open(path) as doc:
            index = doc.resolve_names()[labels['swk:fig:swk-enforcement-layers'][3]]['page']
            with self.assertRaisesRegex(AssertionError, 'interrupts'):
                explanation_follows_figure(doc, index)

    def test_old_actual_figure_is_negative_control(self):
        import fitz
        from check_book_label_migration import parse
        path = ROOT / '.cache/book-consent-terminals-20260920/coordination-papers-mega-volume.pdf'
        labels = parse(path.with_suffix('.aux').read_bytes())
        with fitz.open(path) as doc:
            index = doc.resolve_names()[labels['swk:fig:swk-enforcement-layers'][3]]['page']
            with self.assertRaisesRegex(AssertionError, 'contract labels absent'):
                page_contract(doc[index])


if __name__ == '__main__':
    unittest.main()
