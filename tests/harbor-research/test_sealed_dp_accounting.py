"""Source/reading regressions, not a differential-privacy proof or A3 rerun."""
import ast
import hashlib
import json
from math import expm1, log, sqrt
import os
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[2]
A3 = ROOT/'skills/harbor-results/scripts/a3_epsilon_ledger.py'
OWNER = ROOT/'website-v2/public/whitepaper/sealed-harbor.tex'


def computational_signature(source):
    """Retain every computation; normalize only module docstring/print prose."""
    tree = ast.parse(source)  # Never import or execute the research script.
    if (tree.body and isinstance(tree.body[0], ast.Expr)
            and isinstance(tree.body[0].value, ast.Constant)
            and isinstance(tree.body[0].value.value, str)):
        tree.body.pop(0)
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == 'print':
            for index, arg in enumerate(node.args):
                if isinstance(arg, ast.Constant) and isinstance(arg.value, str):
                    node.args[index] = ast.Constant(value='<printed prose>')
                elif isinstance(arg, ast.JoinedStr):
                    # Keep all formatted expressions and their formatting.
                    for part in arg.values:
                        if isinstance(part, ast.Constant) and isinstance(part.value, str):
                            part.value = '<printed prose>'
    return hashlib.sha256(ast.dump(tree, include_attributes=False).encode()).hexdigest()


class SourceContract(unittest.TestCase):
    def test_a3_computation_is_unchanged(self):
        self.assertEqual(computational_signature(A3.read_text()), '3095ca6d2024f75a5d4d6c1976dbd9726501076c71a8f3e54c16f9a74a85ac20')

    def test_computation_mutants_change_signature(self):
        source = A3.read_text()
        original = computational_signature(source)
        for old,new in [('SEED = 20260816','SEED = 0'), ('EPS_MAX = 4','EPS_MAX = 5'),
                        ('sigma += eps','sigma += eps + 1'), ('TRIALS = 2000','TRIALS = 2'),
                        ('np.expm1(e)','np.exp(e)'), ('dp = 1e-6','dp = 1e-3')]:
            self.assertIn(old, source)
            with self.subTest(change=new):
                self.assertNotEqual(computational_signature(source.replace(old,new)), original)

    def test_a3_does_not_certify_release_privacy(self):
        source = A3.read_text()
        for phrase in ('not DP of releases or complete', 'FIXED-PARAMETER COMPOSITION FORMULAS (conditional)',
                       'do not certify the privacy of any release', 'A fully adaptive advanced',
                       'filter is not implemented here', 'including metadata, refusals and timing'):
            self.assertIn(phrase, source)
        for stale in ('same conserved ledger certifies', 'advanced composition tightens it for long engagements',
                      'B3/R5\'s controllability result, the stated prerequisite'):
            self.assertNotIn(stale, source)

    def test_corollary_has_conditional_premises(self):
        source = ' '.join(OWNER.read_text().split())
        for phrase in ('Fix the neighboring-record relation', 'conditional on the prior transcript',
                       'mechanisms and nonnegative costs selected from public information',
                       'complete observer-visible interaction', 'including metadata, refusals and timing',
                       r'check each proposed cost \emph{before}',
                       'establishes neither the conditional-DP nor complete-mediation premise'):
            self.assertIn(phrase, source)

    def test_advanced_accounting_distinguishes_adaptivity(self):
        source = ' '.join(OWNER.read_text().split())
        for phrase in ('Queries and mechanisms may still adapt', 'stopping early retains the bound',
                       'for that maximum horizon', 'would require a separately justified filter',
                       "not implemented by A3's sum-only ledger", 'Large $k$ alone does not'):
            self.assertIn(phrase, source)
        self.assertEqual(source.count('matches advanced-composition rates and leading constants'), 2)
        self.assertNotIn('worse constants', source)
        self.assertNotIn('where the schedule is non-adaptive', source)

    def test_worked_comparison_keeps_delta_tradeoff(self):
        source = ' '.join(OWNER.read_text().split())
        for phrase in ('These comparisons fix the caps and horizon', 'basic composition remains pure-DP',
                       'not uniformly stronger guarantees', 'A crossover is specific to the chosen privacy parameters'):
            self.assertIn(phrase, source)
        self.assertNotIn('exactly which accounting to quote', source)

    def test_compact_credits_preserve_source_identity(self):
        entries = json.loads((ROOT/'whitepaper/citation-margin-entries.json').read_text())
        source = OWNER.read_text()
        for key, author, title in (
                ('drv', 'Dwork, Rothblum', 'Boosting and differential privacy'),
                ('wrrw23', 'Whitehouse et al. 2023', 'Fully-adaptive composition in differential privacy'),
                ('vdm07', 'van der Meyden 2007', 'What, indeed, is intransitive noninterference?'),
                ('aacp11', 'Alvim et al. 2011', 'On the relation between differential privacy and quantitative information flow')):
            with self.subTest(key=key):
                matching = [entry for entry in entries if entry['key'] == key]
                self.assertEqual(len(matching), 1)
                entry, = matching
                self.assertIn(entry['original'], source)
                self.assertIn(author, entry['margin'])
                self.assertIn(title, entry['margin'])
                self.assertIn(r'\pdcite{' + key + '}', source)

    def test_analytical_crossing_and_atlas_scope(self):
        # Independent closed-form arithmetic, not execution/import of A3 or
        # evidence that any implemented release mechanism is private.
        advanced = lambda k, eps: sqrt(2*k*log(1e6))*eps + k*eps*expm1(eps)
        self.assertGreater(advanced(32, 0.1), 3.2)
        first = next(k for k in range(1, 65) if advanced(k, 0.1) < k*0.1)
        self.assertEqual(first, 35)
        self.assertEqual(round(advanced(32, 0.1), 2), 3.31)
        self.assertEqual(round(advanced(128, 0.05), 2), 3.30)
        atlas = (ROOT/'skills/whitepaper-figure-system/references/semantic-figure-atlas.md').read_text()
        row, = [line for line in atlas.splitlines()
                if line.startswith('| `VIII/fig:sealed-composition-crossover`')]
        for phrase in ('analytical comparison', 'k = 35', 'positive-delta tradeoff',
                       'k = 32 is a checkpoint', 'uniformly stronger'):
            self.assertIn(phrase, row)


PDF = Path(os.environ.get('BOOK_DP_ACCOUNTING_PDF', ROOT/'.cache/book-dp-accounting-20260920/coordination-papers-mega-volume.pdf'))


@unittest.skipUnless(PDF.is_file(), 'actual Book proof required')
class ActualBook(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import fitz
        cls.doc = fitz.open(PDF)
        cls.pages = [' '.join(p.get_text().replace('\u2011','-').split()) for p in cls.doc]

    @classmethod
    def tearDownClass(cls):
        cls.doc.close()

    def test_conditional_corollary_is_printed(self):
        text = ' '.join(self.pages)
        self.assertTrue(re.search(r'Condi(?:-\s*)?tional privacy corollary\.', text),
                        'Conditional privacy corollary heading missing (allow line hyphenation)')
        for phrase in ('metadata, refusals and timing',
                       'stopping early retains the bound for that maximum horizon'):
            self.assertTrue(phrase in text, 'Missing rendered qualification: '+phrase)
        self.assertTrue('worse constants' not in text, 'Stale attribution remains in Book')

    def test_worked_tradeoff_is_whole_with_plot(self):
        candidates = [p for p in self.pages if 'These comparisons fix the caps and horizon.' in p]
        self.assertEqual(len(candidates), 1)
        text, = candidates
        for phrase in ('basic composition remains pure-DP.', 'not uniformly stronger guarantees.',
                       'Now you try:', 'releases', 'advanced bound', '3.31'):
            self.assertIn(phrase, text)

    def test_composition_notes_start_beside_their_mentions(self):
        # Each source belongs beside its own mention. It need not share the
        # opening page of the earlier composition paragraph after reflow.
        names = self.doc.resolve_names()
        start, stop = names['section.3.5']['page'], names['section.3.6']['page']
        page_lines = [[line for block in self.doc[index].get_text('dict')['blocks']
                       for line in block.get('lines', [])]
                      for index in range(start, stop + 1)]
        for author, trigger in (('Whitehouse', 'Whitehouse'),
                                ('Luo', 'mechanism correctly'),
                                ('Alvim', 'Alvim')):
            with self.subTest(author=author):
                owner_pages = [lines for lines in page_lines if any(
                    any(span['size'] > 10.0 for span in line['spans'])
                    and trigger in ''.join(span['text'] for span in line['spans'])
                    for line in lines)]
                self.assertEqual(len(owner_pages), 1, 'Expected one actual owner page')
                lines = owner_pages[0]
                notes = [span['origin'][1] for line in lines for span in line['spans']
                         if span['size'] < 9.1 and author in span['text']]
                owners = [line['spans'][0]['origin'][1] for line in lines
                          if any(span['size'] > 10.0 for span in line['spans'])
                          and trigger in ''.join(span['text'] for span in line['spans'])]
                self.assertEqual(len(notes), 1, 'Expected one source-note opening')
                self.assertEqual(len(owners), 1, 'Expected one owner line')
                self.assertLessEqual(abs(notes[0]-owners[0]), 1.0,
                                     f'{author} citation detached from its mention')

    def test_canary_caveat_is_whole(self):
        candidates = [text for text in self.pages
                      if 'secrecy of planting are decisive:' in text]
        self.assertEqual(len(candidates), 1)
        text, = candidates
        self.assertRegex(text, r'stopping-\s*time formu(?:-\s*)?las are approxima(?:-\s*)?tions')
        self.assertRegex(text, r'model input that requires measure(?:-\s*)?ment')
        self.assertRegex(text, r'statistical leak signa(?:-\s*)?tures;')
        for phrase in ('single-shot', "3.6.1’s job."):
            self.assertIn(phrase, text)

    def test_capacity_explanation_follows_its_figure(self):
        import sys
        sys.path.insert(0, str(ROOT/'scripts/harbor-research'))
        from check_book_label_migration import parse
        labels = parse(PDF.with_suffix('.aux').read_bytes())
        figure = labels['sealed:fig:sealed-residuals-converge']
        figure_index = self.doc.resolve_names()[figure[3]]['page']
        starts = [i for i, text in enumerate(self.pages)
                  if 'If an Erin-visible channel permits' in text]
        self.assertEqual(len(starts), 1)
        self.assertGreaterEqual(starts[0], figure_index,
                                'Capacity paragraph starts before its deferred figure')

    def test_lift_follows_table_with_attached_source_note(self):
        import sys
        sys.path.insert(0, str(ROOT/'scripts/harbor-research'))
        from check_book_label_migration import parse
        labels = parse(PDF.with_suffix('.aux').read_bytes())
        table = labels['sealed:tab:sealed-not-promised']
        index = self.doc.resolve_names()[table[3]]['page']
        starts = [i for i in range(index-1, index+4) if 'The lift.' in self.pages[i]]
        self.assertEqual(len(starts), 1)
        self.assertGreaterEqual(starts[0], index, 'Lift begins before its deferred table')
        matches = []
        for page in (self.doc[i] for i in range(index, index+4)):
            lines = [l for b in page.get_text('dict')['blocks'] for l in b.get('lines',[])]
            for line in lines:
                text = ''.join(s['text'] for s in line['spans'])
                if 'transmissions. Discharging' not in text:
                    continue
                notes = [s['origin'][1] for l in lines for s in l['spans']
                         if s['size'] < 9.1 and 'van der Meyden' in s['text']]
                self.assertEqual(len(notes), 1, 'Expected adjacent van der Meyden note')
                matches.append(abs(notes[0]-line['spans'][0]['origin'][1]))
        self.assertEqual(len(matches), 1)
        self.assertLessEqual(matches[0], 1.0, 'TA-security note displaced from its owner')

    def test_compact_capacity_question_is_whole(self):
        import sys
        sys.path.insert(0, str(ROOT/'scripts/harbor-research'))
        from check_book_label_migration import parse
        labels = parse(PDF.with_suffix('.aux').read_bytes())
        exercise = labels['sealed:ex:sealed-budget']
        index = self.doc.resolve_names()[exercise[3]]['page']
        text = self.pages[index]  # The appendix repeats the question; use its chapter anchor.
        # Join discretionary line-end hyphenation, but never join another page.
        text = re.sub(r'(?<=\w)-\s+(?=\w)', '', text)
        for phrase in ('A work order grants Erin a 64-bit status schema',
                       'per job over 200 jobs', 'one of three scheduled times',
                       'What adversarial capacity', 'before and after timing?'):
            self.assertIn(phrase, text, 'Compact capacity question split across pages')


if __name__ == '__main__':
    unittest.main()
