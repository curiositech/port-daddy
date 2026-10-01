"""Static A4 preservation, independent formula arithmetic and actual Book scope.

Never imports or executes the research script; these checks are not a new run,
an empirical calibration, or a proof that no simulated path hit the cap.
"""
import ast
import importlib.util
import json
from math import log
import os
from pathlib import Path
import re
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
OWNER = ROOT/'website-v2/public/whitepaper/sealed-harbor.tex'
A4 = ROOT/'skills/harbor-results/scripts/a4_canary_sprt.py'
PDF = Path(os.environ.get('BOOK_OPERATING_PDF', ROOT/'.cache/book-operating-20260920/coordination-papers-mega-volume.pdf'))
spec = importlib.util.spec_from_file_location('dp_static_helpers', Path(__file__).with_name('test_sealed_dp_accounting.py'))
helpers = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helpers)  # Test helper only, never A4.
FROZEN_COMPUTATION = '8519a30a57e192a0458d3964096175b2a6ad4701c205a17615f56759a141a875'


def science_contract(source):
    text = ' '.join(source.split())
    for phrase in ('i.i.d. Bernoulli', 'two fixed, simple hypotheses',
                   r'$0<p_0<p_1<1$', 'uncapped SPRT', 'first exit from fixed thresholds',
                   'finite expectation', r'\mathbb{E}_1[L_N]', r'-\mathbb{E}_0[L_N]',
                   r'no larger \emph{actual}', r'$\alpha+\gamma<1$',
                   r'\mathbb{E}_1[N]\approx',
                   'actual error probabilities by the targets',
                   'do not separately guarantee the two nominal error rates',
                   r'\emph{actual terminal value}', 'not the identity',
                   'chosen independently of their hidden locations',
                   'point estimates, not certified upper bounds',
                   'assertions permit twice the nominal error targets',
                   'an unresolved capped run is counted with non-upper decisions',
                   'cannot establish that all runs terminated',
                   'model input that requires measurement',
                   'archival run receipt or calibrated error bounds',
                   'not a guaranteed alarm deadline',
                   'no wall-clock arrival model is specified'):
        assert phrase in text, phrase
    for stale in ('overshoot only helps', 'identity ignores',
                  'pushes both realized error rates below',
                  'bounds how long detection takes',
                  'guaranteed false-positive-against-latency',
                  'measured property of the suppressor'):
        assert stale not in text, stale
    for label in ('thm:sealed-power', 'thm:sealed-latency', 'ex:sealed-sprt'):
        assert label in source, label


class SourceContract(unittest.TestCase):
    def test_exact_wald_identity_separate_from_nominal_approximation(self):
        science_contract(OWNER.read_text())

    def test_false_scientific_mutations_are_rejected(self):
        source = OWNER.read_text()
        for old,new in [(r'\mathbb{E}_1[N]\approx', r'\mathbb{E}_1[N]='),
                        (r'no larger \emph{actual}', 'no larger nominal'),
                        ('uncapped SPRT', 'capped SPRT'),
                        ('not the\nidentity', 'like the\nidentity'),
                        ('twice the nominal', 'exactly the nominal')]:
            self.assertIn(old, source)
            with self.subTest(change=new), self.assertRaises(AssertionError):
                science_contract(source.replace(old,new))

    def test_a4_computation_is_identical_to_original_static_ast(self):
        self.assertEqual(helpers.computational_signature(A4.read_text()), FROZEN_COMPUTATION)
        self.assertEqual(sum(isinstance(n, ast.Assert) for n in ast.walk(ast.parse(A4.read_text()))),7)

    def test_seed_cap_assertion_and_formula_mutants_change_signature(self):
        source = A4.read_text()
        for old,new in [('SEED = 20260816','SEED = 0'), ('cap=200000','cap=200001'),
                        ('runs=20000','runs=2000'), ('fa0 <= 2 * alpha','fa0 <= alpha'),
                        ('rng.random() < p_true','rng.random() <= p_true'),
                        ('log((1 - b) / alpha)','log(1 / alpha)')]:
            self.assertIn(old, source)
            with self.subTest(change=new):
                self.assertNotEqual(helpers.computational_signature(source.replace(old,new)),FROZEN_COMPUTATION)

    def test_a4_printed_prose_does_not_overstate_its_assertions(self):
        source = A4.read_text()
        for phrase in ('allow twice each target', 'unresolved capped runs',
                       'No uncertainty bounds or separate cap counts'):
            self.assertIn(phrase,source)
        for phrase in ('overshoot only helps', 'identities ignore',
                       'rates at or below their targets', 'its executed backing',
                       'no worse than independent'):
            self.assertNotIn(phrase,source)

    def test_independent_closed_form_not_simulation(self):
        p0,p1,alpha,gamma=.001,.01,.01,.05
        a,b=log((1-gamma)/alpha),log(gamma/(1-alpha))
        mu1=p1*log(p1/p0)+(1-p1)*log((1-p1)/(1-p0))
        mu0=p0*log(p1/p0)+(1-p0)*log((1-p1)/(1-p0))
        self.assertAlmostEqual(((1-gamma)*a+gamma*b)/mu1,296.9391719832192,places=10)
        self.assertAlmostEqual((alpha*a+(1-alpha)*b)/mu0,431.908535510234,places=10)
        self.assertEqual(round(1-.2**3,3),.992)
        self.assertEqual(1-.2**0,0)

    def test_compact_margin_credits_keep_complete_source_identity(self):
        entries=json.loads((ROOT/'whitepaper/citation-margin-entries.json').read_text())
        for key,title in [('wald','Sequential tests of statistical hypotheses'),
                          ('wald-wolfowitz','Optimum character of the sequential probability ratio test'),
                          ('jpbb04','Fast portscan detection using sequential hypothesis testing')]:
            matching=[e for e in entries if e['key']==key]
            self.assertEqual(len(matching),1)
            entry,=matching
            self.assertIn(entry['original'],OWNER.read_text())
            self.assertIn(title,entry['margin'])

    def test_compact_sprt_answer_keeps_all_scientific_qualifications(self):
        source = OWNER.read_text().split(r'\begin{pdsolution}{ex:sealed-sprt}', 1)[1]
        answer = ' '.join(source.split(r'\end{pdsolution}', 1)[0].split())
        for phrase in ('0.01407', '4.177', '296.9',
                       'Boundary values replace terminal log-likelihoods',
                       'nominal targets replace attained errors', 'Overshoot',
                       'sampling uncertainty and the cap',
                       'capped sample mean, not an exact expectation',
                       '0.0483', '0.0052', 'point estimates, not upper bounds',
                       'Stopping counts include either decision',
                       'no wall-clock arrival model is specified'):
            self.assertIn(phrase, answer, phrase)


@unittest.skipUnless(PDF.is_file(),'actual Book proof required')
class ActualBook(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import fitz
        sys.path.insert(0,str(ROOT/'scripts/harbor-research'))
        from check_book_label_migration import parse
        cls.doc=fitz.open(PDF)
        cls.labels=parse(PDF.with_suffix('.aux').read_bytes())
        cls.pages=[' '.join(re.sub(r'(?<=\w)-\n(?=\w)', '', p.get_text().replace('\u2011','-')).split()) for p in cls.doc]

    @classmethod
    def tearDownClass(cls):
        cls.doc.close()

    def test_exact_identity_block_is_whole(self):
        label=self.labels['sealed:thm:sealed-latency']
        index=self.doc.resolve_names()[label[3]]['page']
        text=self.pages[index]
        for phrase in ('i.i.d. Bernoulli', 'uncapped SPRT', 'finite expectation',
                       'both expected sample sizes'):
            self.assertTrue(phrase in text,'Missing theorem text: '+phrase)
        self.assertTrue('overshoot only helps' not in ' '.join(self.pages))

    def test_reported_checks_keep_cap_and_error_limits(self):
        text=' '.join(self.pages)
        for phrase in ('twice the nominal error targets',
                       'an unresolved capped run',
                       'cannot establish that all runs terminated',
                       'no wall-clock arrival model is specified'):
            self.assertTrue(phrase.replace('-', '') in text.replace('-', ''),
                            'Missing recorded-evidence limitation: '+phrase)
        self.assertTrue('point estimates, not certified upper bounds' in text)

    def test_source_notes_align_to_their_owner_baselines(self):
        # Paragraph expansion may move a source mention off the theorem's
        # opening page. The note must follow its actual owner, not that page.
        names=self.doc.resolve_names()
        start=names[self.labels['sealed:sec:sealed-detection'][3]]['page']
        stop=names[self.labels['sealed:sec:sealed-budget'][3]]['page']
        page_lines=[[l for b in self.doc[index].get_text('dict')['blocks']
                     for l in b.get('lines',[])] for index in range(start,stop+1)]
        for credit,trigger in [('Wald 1945.','For fixed nominal targets'),
                               ('Jung et al. 2004.','portscan detection in 2004.')]:
            owner_pages=[lines for lines in page_lines if any(
                any(s['size']>10 for s in l['spans'])
                and trigger in ''.join(s['text'] for s in l['spans']) for l in lines)]
            self.assertEqual(len(owner_pages),1,trigger)
            lines=owner_pages[0]
            notes=[s['origin'][1] for l in lines for s in l['spans']
                   if s['size']<9.1 and credit in s['text']]
            owners=[l['spans'][0]['origin'][1] for l in lines
                    if any(s['size']>10 for s in l['spans'])
                    and trigger in ''.join(s['text'] for s in l['spans'])]
            self.assertEqual(len(notes),1,credit)
            self.assertEqual(len(owners),1,trigger)
            self.assertLessEqual(abs(notes[0]-owners[0]),1,credit+' detached from its owner')

    def test_wald_portrait_and_short_proof_share_the_actual_page(self):
        label=self.labels['sealed:thm:sealed-latency']
        index=self.doc.resolve_names()[label[3]]['page']
        matches=[i for i in range(index,index+3) if 'actual terminal value' in self.pages[i]]
        self.assertEqual(len(matches),1)
        page=self.doc[matches[0]]
        self.assertTrue('the boundary.' in self.pages[matches[0]],'Short proof split across pages')
        heads=page.search_for('Proof idea.')
        self.assertEqual(len(heads),1)
        images=[im for im in page.get_image_info() if 90<im['bbox'][2]-im['bbox'][0]<100]
        self.assertEqual(len(images),1,'Expected Wald portrait beside the proof')
        self.assertLess(abs(images[0]['bbox'][1]-heads[0].y0),8)

    def test_compact_solutions_keep_their_qualifications_on_one_page(self):
        cases = [
            ('sealed:ex:sealed-sprt', 'The numerator is',
             'no wall-clock arrival model is specified.'),
            ('ls:ex:ls-cooperative-clobber', 'Alice and Bob are both asked',
             "waits indefinitely for the other’s claim."),
            ('ls:ex:ls-two-llms-not-independent', 'Two models may share',
             'or a separately controlled reviewer.'),
        ]
        names = self.doc.resolve_names()
        for exercise, start, finish in cases:
            with self.subTest(solution=exercise):
                label = self.labels['sol:' + exercise]
                index = names[label[3]]['page']
                text = self.pages[index].replace("'", '’')
                self.assertTrue(start in text, 'Solution opening detached: '+exercise)
                self.assertTrue(finish.replace('-', '') in text.replace('-', ''),
                                'Solution qualification split: '+exercise)


if __name__=='__main__':
    unittest.main()
