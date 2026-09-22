"""Source-bound illustration and actual-page checks, not a new C1 experiment."""
import os
import json
from pathlib import Path
import re
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
FIG = ROOT / 'website-v2/public/whitepaper/figures/fig-sealed-two-worlds.tex'
OWNER = ROOT / 'website-v2/public/whitepaper/sealed-harbor.tex'
RECORDS = {
    'secretA': ('0,60', '47', '36', 'sgViolet!8', 'A', '$s=0$'),
    'secretB': ('0,123', '47', '36', 'sgAmber!10', 'B', '$s=2$'),
    'outA': ('262,60', '46', '36', 'white', 'gate:', '$0$'),
    'outB': ('262,123', '46', '36', 'white', 'gate:', '$0$'),
    'badA': ('178,242', '48', '39', 'sgRed!7', 'A', 'gate: $0$'),
    'badB': ('268,242', '48', '39', 'sgRed!7', 'B', 'gate: $2$'),
}


def source_contract(source):
    text = '\n'.join(line.split('%', 1)[0] for line in source.splitlines())
    records = dict((m[0], tuple(m[1:])) for m in re.findall(
        r'\\TWRecord\{(\w+)\}\{\(([-.\d,]+)\)\}\{(\d+)\}\{(\d+)\}'
        r'\{([^}]+)\}\{([^}]+)\}\{([^}]+)\}', text))
    assert records == RECORDS, 'worlds, parity outputs or negative control changed'
    for name, x in [('load', 86), ('read', 144), ('submit', 202), ('release', 285)]:
        assert f'({name}) at ({x},43) {{{name}}};' in text, 'action order'
    for prefix, y in [('a', 78), ('b', 141)]:
        for name, x in [('Load', 86), ('Read', 144), ('Submit', 202)]:
            assert f'({prefix}{name}) at ({x},{y}) {{$[\\ ]$}};' in text, 'early observation'
    for name, x in [('Load', 86), ('Read', 144), ('Submit', 202), ('Release', 285)]:
        assert f'(eq{name}) at ({x},109.5) {{$=$}};' in text, 'honest log equality'
    assert r'(neq) at (247,261) {$\neq$};' in text, 'distinguishing control'
    assert "Erin's visible log after each action" in text, 'projection, not full state'
    assert 'Raw-secret gate' in text and '(0,228)--(316,228)' in text
    arrows = re.findall(r'\\draw\[sg/arrow\]\s*(.*?);', text, re.S)
    assert arrows == ['(66,184)--(315,184)'], 'extra fork or misleading flow'
    assert 'action order' in text
    assert 'Reported model check: four secrets, depth 7, not unbounded executions.' in text
    assert r'\protect\path{c1_noninterference.py}' in text
    assert r'\SGMeasuredFigure{VIII/fig:sealed-two-worlds}' in text
    assert text.count(r'\caption{') == text.count(r'\label{fig:sealed-two-worlds}') == 1
    for token in (r'\resizebox', r'\scalebox', r'\fontsize', r'\tiny', r'\scriptsize',
                  r'\clip', 'transform shape', 'use as bounding box'):
        assert token not in text, 'native type required'


def bounded_owner(source):
    claim = source.split(r'\label{thm:sealed-noninterference}', 1)[1].split(r'\end{pdclaim}', 1)[0]
    claim = ' '.join(claim.split())
    assert 'every valid action sequence of at most seven steps' in claim
    assert 'new log differences arise only at gate-release steps.' in claim
    assert 'zero distinguishing observations for equal-parity pairs' in claim
    example = source.split(r'\begin{pdexample}{Six Pairs, Two of Them Equal-Parity}', 1)[1].split(r'\end{pdexample}', 1)[0]
    assert 'every interleaving of at most seven steps' in ' '.join(example.split())
    assert 'forever' not in example
    assert 'an earlier gate-release difference may persist unchanged.' in ' '.join(source.split())


class SourceContract(unittest.TestCase):
    def test_neighboring_citation_keeps_title_and_archival_metadata(self):
        entries = json.loads((ROOT / 'whitepaper/citation-margin-entries.json').read_text())
        entry, = [item for item in entries if item['key'] == 'pkube21']
        original = OWNER.read_text().split(r'\bibitem{pkube21}', 1)[1].split(r'\bibitem', 1)[0].strip()
        self.assertEqual(entry['original'], original)
        for phrase in ('Luo et al. 2021.', 'Privacy budget scheduling', 'OSDI', '55--74'):
            self.assertIn(phrase, entry['margin'])

    def test_two_observation_traces_and_separate_negative_control(self):
        source_contract(FIG.read_text())

    def test_semantic_mutations_are_rejected(self):
        source = FIG.read_text()
        for old, new in [('{A}{$s=0$}', '{A}{$s=2$}'),
                         ('{white}{gate:}{$0$}', '{white}{gate:}{$2$}'),
                         ('{B}{gate: $2$}', '{B}{gate: $0$}'),
                         (r'(aRead) at (144,78) {$[\ ]$}', '(aRead) at (144,78) {$0$}'),
                         ("Erin's visible log after each action", 'Complete internal state'),
                         ('(read) at (144,43)', '(read) at (202,43)'),
                         ('(eqRelease) at (285,109.5) {$=$}', r'(eqRelease) at (285,109.5) {$\neq$}'),
                         ('Reported model check:', 'Freshly verified:'),
                         ('depth 7', 'depth 8'), ('four secrets', 'all secrets'),
                         ('(0,228)--(316,228)', '(0,0)--(316,228)')]:
            self.assertIn(old, source)
            with self.subTest(old=old), self.assertRaises(AssertionError):
                source_contract(source.replace(old, new))
        for extra in (r'\draw[sg/arrow] (285,141)--(292,242);', r'\resizebox{1pt}{!}{x}', r'\caption{x}'):
            with self.subTest(extra=extra), self.assertRaises(AssertionError):
                source_contract(source + '\n' + extra)

    def test_owner_does_not_promote_bounded_search(self):
        source = OWNER.read_text()
        bounded_owner(source)
        for old, new in [('at most seven steps', 'arbitrary length'),
                         ('for equal-parity pairs', 'for every pair'),
                         ('new log differences', 'all log differences'),
                         ('may persist unchanged', 'cannot persist unchanged')]:
            with self.subTest(old=old), self.assertRaises(AssertionError):
                bounded_owner(source.replace(old, new))


PDF = Path(os.environ.get('BOOK_TWO_WORLDS_PDF', ROOT / '.cache/book-sealed-two-worlds-20260920/coordination-papers-mega-volume.pdf'))


@unittest.skipUnless(PDF.exists(), 'integrated Book PDF required')
class ActualBook(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import fitz
        sys.path.insert(0, str(ROOT / 'scripts/harbor-research'))
        from check_book_label_migration import parse
        cls.doc = fitz.open(PDF)
        cls.labels = parse(PDF.with_suffix('.aux').read_bytes())
        cls.names = cls.doc.resolve_names()

    @classmethod
    def tearDownClass(cls):
        cls.doc.close()

    def test_actual_caption_number_and_reported_scope(self):
        label = self.labels['sealed:fig:sealed-two-worlds']
        page = self.doc[self.names[label[3]]['page']]
        text = ' '.join(page.get_text().replace('\u2011', '-').split())
        for phrase in ('Figure ' + label[0] + '.', 'Raw-secret gate',
                       'Reported model check: four secrets, depth 7, not unbounded executions.'):
            self.assertIn(phrase, text)

    def test_native_labels_and_ink(self):
        label = self.labels['sealed:fig:sealed-two-worlds']
        page = self.doc[self.names[label[3]]['page']]
        from page_overflow import column
        left, right, _ = column(page, page.number + 1)
        top = page.search_for('visible log after each action')[0].y0 - 1
        bottom = page.search_for('secret gate')[0].y0 + 50
        spans = [s for b in page.get_text('dict')['blocks'] for l in b.get('lines', [])
                 for s in l['spans'] if left - 1 <= s['bbox'][0] < right and top <= s['bbox'][1] < bottom]
        labels = [s for s in spans if 'SuisseIntl' in s['font']]
        self.assertGreater(len(labels), 15)
        for span in labels:
            self.assertTrue(8.85 <= span['size'] <= 9.05, span)
            self.assertLessEqual(span['bbox'][2], right + 1)
        log = PDF.with_suffix('.log').read_text()
        sizes = re.findall(r'SG-GEOMETRY: VIII/fig:sealed-two-worlds,width=([.\d]+)pt,height=([.\d]+)pt', log)
        self.assertTrue(sizes)
        for width, height in sizes:
            self.assertAlmostEqual(float(width), 316.85, places=2)
            self.assertAlmostEqual(float(height), 283.34598, places=2)

    def test_property_keeps_sequences_whole_and_finite(self):
        label = self.labels['sealed:thm:sealed-noninterference']
        index = self.names[label[3]]['page']
        text = ' '.join(self.doc[i].get_text() for i in (index, index + 1))
        self.assertNotRegex(text, r'se-\s+quences')
        self.assertIn('observation sequences are identical', ' '.join(text.split()))
        self.assertIn('sequence of at most seven steps', ' '.join(text.split()))

    def test_property_clause_does_not_leave_one_word_on_next_page(self):
        label = self.labels['sealed:thm:sealed-noninterference']
        index = self.names[label[3]]['page']
        text = ' '.join(self.doc[index].get_text().replace('\u2011', '-').split())
        # A lexical hyphen may wrap within this page; never concatenate the
        # following page, which would hide the one-word-tail regression.
        self.assertRegex(text, r'new log differences arise only at gate-\s*release steps\.')

    def test_result_does_not_split_exhaustive_across_pages(self):
        label = self.labels['sealed:thm:sealed-noninterference']
        index = self.names[label[3]]['page']
        pages = [' '.join(self.doc[i].get_text().split()) for i in (index, index + 1)]
        self.assertTrue(any('Result. Exhaustive over all interleavings' in text for text in pages))

    def test_six_pair_calculation_and_exercise_stay_on_figure_page(self):
        label = self.labels['sealed:fig:sealed-two-worlds']
        page = self.doc[self.names[label[3]]['page']]
        # Preserve the lexical Equal-Parity hyphen; TEXT_DEHYPHENATE deletes it.
        text = page.get_text().replace('\u2011', '-')
        text = ' '.join(re.sub(r'-\s*\n\s*', '-', text).split())
        self.assertIn('Six Pairs, Two of Them Equal-Parity', text)
        self.assertIn('how many unordered secret pairs', text)
        exercise = self.labels['sealed:ex:sealed-pairs'][0]
        self.assertIn('(Exercise ' + exercise + '.)', text)

    def test_neighboring_caption_remains_aligned_after_reflow(self):
        number = self.labels['sealed:fig:sealed-two-adversaries'][0]
        # The complete audit checks every margin; this regression protects
        # the specific downstream caption displaced by this section's reflow.
        from check_book_caption_margins import audit
        report = audit(PDF)
        result, = [r for r in report if r['kind'] == 'figure' and r['number'] == number]
        self.assertEqual(result['issues'], [])

    def test_downstream_crossover_calculation_stays_whole_with_its_plot(self):
        import fitz
        label = self.labels['sealed:fig:sealed-composition-crossover']
        page = self.doc[self.names[label[3]]['page']]
        text = ' '.join(page.get_text(flags=fitz.TEXT_DEHYPHENATE).split())
        self.assertIn('When the Advanced Composition Bound Starts to Pay', text)
        self.assertIn('marks this exact crossing.', text)
        self.assertIn('(Exercise ' + self.labels['sealed:ex:sealed-crossover'][0] + '.)', text)

    def test_downstream_latency_statement_keeps_its_final_qualification(self):
        label = self.labels['sealed:thm:sealed-latency']
        page = self.doc[self.names[label[3]]['page']]
        text = ' '.join(page.get_text().split())
        self.assertIn('Latency (Wald)', text)
        self.assertIn('Assume i.i.d. Bernoulli', text)
        self.assertIn('both expected sample sizes', text)
        self.assertIn('per\u2011canary miss rate', text)
        self.assertIn('release\u2011channel width', text)


if __name__ == '__main__':
    unittest.main()
