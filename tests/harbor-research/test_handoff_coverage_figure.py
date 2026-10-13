"""Source-bound visual witness, not runtime or successor-behaviour evidence."""
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[2]
FIGURE = ROOT / 'website-v2/public/whitepaper/figures/fig-stp-handoff-coverage.tex'
ARCHIVE = ROOT / 'docs/harbor-research/experiments/handoff-coverage-20260920'
RUN_SHA = '4650de5b6236e2f883b3de102b3626471b0074fbbd131963131122b57dc3b7c3'


def marks(source, command):
    return [(int(a), int(x)) for a, x in re.findall(
        r'^\s*\\' + command + r'\{(\d+)\}\{(\d+)\}\s*$', source, re.M)]


def validate(old, source):
    errors = []
    users = [m for m in old['input']['messages'] if m['role'] == 'user']
    tail = old['input']['messages'][-8:]
    if len(users) != 5 or len(old['input']['messages']) != 13:
        errors.append('fixture cardinality')
    if users[0]['content'] != 'OBL-01: preserve the existing acceptance criteria.':
        errors.append('required instruction')
    if old['required_ledger'][0]['allowed_source_ids'] != ['turn-0']:
        errors.append('source-bound denominator')
    originals = marks(source, 'HGCOriginal')
    retained = marks(source, 'HGCRetained')
    if originals != [(n, n*66) for n in range(1, 5)] or retained != originals:
        errors.append('aligned operator columns')
    if ['turn-' + str(n) for n, _ in retained] != old['retained_operator_ids']:
        errors.append('retained source IDs')
    if marks(source, 'HGCAssistant') != [(n, n*40) for n in range(8)]:
        errors.append('eight distinct assistant records')
    if [(m['role'], m['content']) for m in tail] != [
            ('assistant', 'Local drafting step ' + str(n)) for n in range(8)]:
        errors.append('assistant versus operator')
    if old['missing_obligations'] != ['OBL-01'] or old['prompt_contains_instruction']:
        errors.append('coverage outcome')
    if not old['hash_matches']:
        errors.append('selected-byte consistency')
    if old['capsule_transcript_ref'] != 'transcript-old' or old['brief_contains_transcript_ref']:
        errors.append('reference versus performed recovery')
    required = (r'\HGCRecord{0}{22}{54}{42}{pdrust}{turn-0\\OBL-01}',
                r'{OBL-01\\absent}', '{recomputed = recorded}',
                '{required record absent}', '{transcript-old}',
                r'Possible source lookup\\not performed',
                '{Reference absent from brief}')
    for text in required:
        if source.count(text) != 1:
            errors.append('missing or duplicate mark: ' + text)
    return errors


class HandoffFigureTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = FIGURE.read_text()
        cls.raw = (ARCHIVE / 'run-03/results.json').read_bytes()
        cls.old = next(row for row in json.loads(cls.raw)['observations']
                       if row['fixture'] == 'old')

    def test_marks_bind_exact_archive(self):
        self.assertEqual(hashlib.sha256(self.raw).hexdigest(), RUN_SHA)
        self.assertEqual(validate(self.old, self.source), [])

    def test_false_selection_counts_alignment_and_recovery_rejected(self):
        variants = (
            self.source.replace(r'\HGCRetained{1}{66}', r'\HGCRetained{0}{66}'),
            self.source.replace(r'\HGCRetained{2}{132}', r'\HGCRetained{2}{130}'),
            self.source.replace(r'\HGCAssistant{7}{280}', ''),
            self.source.replace('not performed', 'completed'),
            self.source.replace('Reference absent from brief', 'Reference in brief'),
            self.source.replace('{recomputed = recorded}', '{authenticated}'),
            self.source + '\n' + r'\HGCRecord{0}{22}{54}{42}{pdrust}{turn-0\\OBL-01}',
        )
        for index, source in enumerate(variants):
            with self.subTest(index=index):
                self.assertTrue(validate(self.old, source))

    def test_false_evidence_and_empty_denominator_rejected(self):
        for field, value in [('hash_matches', False), ('brief_contains_transcript_ref', True),
                             ('missing_obligations', []), ('prompt_contains_instruction', True)]:
            false = copy.deepcopy(self.old)
            false[field] = value
            self.assertTrue(validate(false, self.source), field)
        false = copy.deepcopy(self.old)
        false['required_ledger'][0]['allowed_source_ids'] = []
        self.assertTrue(validate(false, self.source))

    def test_native_contract_and_single_scoped_insertion(self):
        for required in (r'\SGMeasuredFigure{stp-handoff-coverage}',
                         r'\label{fig:stp-handoff-coverage}', 'Synthetic',
                         'source functions tested with scanners stubbed',
                         'No provider behaviour or', 'source recovery was tested.'):
            self.assertIn(required, self.source)
        for forbidden in (r'\resizebox', r'\scalebox', r'\tiny', r'\scriptsize', 'transform shape'):
            self.assertNotIn(forbidden, self.source)
        chapter = (ROOT / 'website-v2/public/whitepaper/spawn-to-person.tex').read_text()
        insertion = r'\input{figures/fig-stp-handoff-coverage}'
        self.assertEqual(chapter.count(insertion), 1)
        self.assertLess(chapter.index(r'\label{tab:death-ladder}'), chapter.index(insertion))
        self.assertLess(chapter.index(insertion), chapter.index(r'\section{Identity:'))
        self.assertIn(insertion + '\n' + r'\FloatBarrier', chapter)
        for limit in ('This tests selection, not successor',
                      'not a general obligation extractor', 'neither access nor recovery was tested'):
            self.assertIn(limit, chapter)

    @unittest.skipUnless(os.environ.get('BOOK_HANDOFF_PDF'), 'assembled Book not supplied')
    def test_actual_page_retains_alignment_evidence_and_fonts(self):
        import fitz
        path = Path(os.environ['BOOK_HANDOFF_PDF'])
        spec = importlib.util.spec_from_file_location('label_gate', ROOT /
            'scripts/harbor-research/check_book_label_migration.py')
        gate = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(gate)
        fields = gate.parse(path.with_suffix('.aux').read_bytes())['stp:fig:stp-handoff-coverage']
        with fitz.open(path) as book:
            destinations = book.resolve_names()
            figure_page = destinations[fields[3]]['page']
            page = book[figure_page]
            identity = gate.parse(path.with_suffix('.aux').read_bytes())['stp:sec:identity']
            identity_page = destinations[identity[3]]['page']
            self.assertLessEqual(figure_page, identity_page,
                                 'handoff figure drifted into the next Identity section')
            if figure_page == identity_page:
                diagram_end = page.search_for('Reference absent from brief')[0].y1
                heading = page.search_for('Identity: the root')[0].y0
                self.assertLess(diagram_end, heading,
                                'Identity section begins before the handoff figure ends')
            self.assertEqual(page.get_label(), fields[1])
            text = ' '.join(page.get_text().split())
            for phrase in ('Original operator turns: 5', 'Successor brief: last 4 operator turns',
                           'Assistant tail: all 8 later messages retained', 'recomputed = recorded',
                           'required record absent', 'transcript-old', 'not performed',
                           'Reference absent from brief'):
                self.assertIn(phrase, text)
            for n in range(1, 5):
                hits = page.search_for('turn-' + str(n))
                self.assertEqual(len(hits), 2)
                self.assertLess(abs(hits[0].x0-hits[1].x0), .1)
            self.assertEqual(len(page.search_for('turn-0')), 1)
            fonts = ' '.join(font[3] for font in page.get_fonts())
            self.assertIn('SuisseIntl-Regular', fonts)
            self.assertIn('SourceCodePro', fonts)
            self.assertNotIn('SourceSans', fonts)
            top = page.search_for('Assistant tail:')[0].y1
            bottom = page.search_for('Capsule hash consistency')[0].y0
            body_x = page.search_for('Original operator turns:')[0].x0
            words = [word[4] for word in page.get_text('words')
                     if top < word[1] < bottom and body_x <= word[0] < body_x+324]
            self.assertEqual(words, list(map(str, range(8))))


if __name__ == '__main__':
    unittest.main()
