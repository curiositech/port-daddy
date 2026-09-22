"""Presentation contract only: not a cryptographic or task-equivalence proof."""
import importlib.util
import os
from pathlib import Path
import re
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
FIGURE = ROOT/'whitepaper/figures/fig-swk-delegation-chains.tex'
CHAPTER = ROOT/'whitepaper/single-writer-kernel.tex'


def source_contract(source):
    for mark in ('{Authorization chain}', '{Built}', '{root signer}',
                 '{attenuating hop}', '{verifier}', '{Signed payload}',
                 '{required at each hop}', '{Coordination lineage}', '{Designed}',
                 r'{loop detection \textperiodcentered\ upward block}',
                 '{task shape}', '{equivalence open}',
                 r'\SGMeasuredFigure{swk-delegation-chains}',
                 'Authenticating its bytes does not establish semantic task'):
        assert mark in source, 'Missing semantic mark: '+mark
    dims = {k:float(v) for k,v in re.findall(r'\\def\\dc(\w+)\{([\d.]+)\}',source)}
    for lo,hi in (('Left','Right'),('Top','Bottom')):
        assert dims['Payload'+lo]+8 <= dims['Lineage'+lo]
        assert dims['Lineage'+lo] < dims['Lineage'+hi]
        assert dims['Lineage'+hi] <= dims['Payload'+hi]-8
    assert 'dash pattern=on 4pt off 2pt' in source
    for forbidden in (r'\resizebox',r'\scalebox',r'\fontsize',r'\tiny',r'\scriptsize','transform shape'):
        assert forbidden not in source, forbidden
    assert source.count(r'\caption{') == 1
    assert source.count(r'\label{fig:swk-delegation-chains}') == 1


def gate_module():
    spec=importlib.util.spec_from_file_location('migration',ROOT/'scripts/harbor-research/check_book_label_migration.py')
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    return module


class DelegationContainmentTests(unittest.TestCase):
    def test_semantic_marks_and_containment(self):
        source_contract(FIGURE.read_text())

    def test_false_readings_are_rejected(self):
        source=FIGURE.read_text()
        for a,b in [(r'\dcLineageLeft{30}',r'\dcLineageLeft{310}'),
                    (r'\dcLineageBottom{208}',r'\dcLineageBottom{230}'),
                    ('{Designed}','{Built}'),('equivalence open','equivalence solved'),
                    ('bytes does not establish','bytes establishes'),
                    ('dash pattern=on 4pt off 2pt','solid')]:
            with self.subTest(mutant=b), self.assertRaises(AssertionError):
                source_contract(source.replace(a,b))

    def test_scaling_or_missing_owner_is_rejected(self):
        source=FIGURE.read_text()
        for bad in (source+r'\scalebox{.7}{x}',
                    source.replace(r'\label{fig:swk-delegation-chains}','')):
            with self.assertRaises(AssertionError): source_contract(bad)

    def test_manuscript_status_is_not_promoted(self):
        chapter=CHAPTER.read_text()
        for phrase in ('authorization chain &',r'\Built\ (ProVerif)',
                       'coordination lineage &',r'(\Designed): the task-lineage',
                       r'task-shape field is in the \emph{signed} payload at each hop'):
            self.assertIn(phrase,chapter)
        self.assertNotIn('draws the containment:',chapter)
        self.assertIn('\\input{figures/fig-swk-delegation-chains}\n\\FloatBarrier', chapter)
        self.assertIn('\\pdmarginpagebreak\nThe ladder these modes', chapter)
        self.assertIn('\\input{figures/fig-swk-controllability-quadrant}\n\\FloatBarrier', chapter)

    @unittest.skipUnless(os.environ.get('BOOK_DELEGATION_PDF'),'assembled Book not supplied')
    def test_actual_book_native_type_and_body_ink(self):
        import fitz
        path=Path(os.environ['BOOK_DELEGATION_PDF'])
        gate=gate_module();labels=gate.parse(path.with_suffix('.aux').read_bytes())
        sys.path.insert(0,str(ROOT/'scripts/harbor-research'))
        try: from page_overflow import column
        finally: sys.path.pop(0)
        with fitz.open(path) as doc:
            index=doc.resolve_names()[labels['swk:fig:swk-delegation-chains'][3]]['page']
            page=doc[index];left,right,side=column(page,index+1)
            spans=[s for b in page.get_text('dict')['blocks'] if 'lines' in b
                   for line in b['lines'] for s in line['spans']]
            heads=[s for s in spans if s['text']=='Authorization chain' and 'Semibold' in s['font']]
            self.assertEqual(len(heads),1)
            start=heads[0]['bbox'][1]
            end=page.search_for('equivalence open')[0].y1+18
            labels=[s for s in spans if start<=s['bbox'][1]<=end
                    and left-1<=s['bbox'][0] and s['bbox'][2]<=right+1]
            self.assertTrue(labels)
            self.assertTrue(all('SuisseIntl' in s['font'] and 8.6<=s['size']<=8.9 for s in labels))
            marks=[p['rect'] for p in page.get_drawings() if start<=p['rect'].y0<=end]
            self.assertTrue(marks)
            self.assertTrue(all(left-1<=r.x0 and r.x1<=right+1 for r in marks))
            for word in ('Signed payload','Coordination lineage','Designed','Built','equivalence open'):
                self.assertIn(word,' '.join(s['text'] for s in labels))
            # Correct outside caption is insufficient: the next subsection
            # must not start before this figure and resume below it.
            transport_heads = [(i, r.y0) for i in range(max(0,index-1),index+2)
                               for r in doc[i].search_for('A second transport')]
            self.assertEqual(len(transport_heads), 1)
            self.assertGreater(transport_heads[0], (index, end))
            quadrant_index=doc.resolve_names()[gate.parse(path.with_suffix('.aux').read_bytes())['swk:fig:swk-controllability-quadrant'][3]]['page']
            quadrant=doc[quadrant_index]
            ending=quadrant.search_for('only after commit')[0].y1
            # Keep the existing interpretation with its figure, rather than
            # flowing it ahead and leaving a sparse figure-only page.
            takeaway=quadrant.search_for('What it buys.')
            self.assertEqual(len(takeaway),1)
            self.assertGreater(takeaway[0].y0,ending)
        sizes=re.findall(r'SG-GEOMETRY: swk-delegation-chains,width=([\d.]+)pt,height=([\d.]+)pt',path.with_suffix('.log').read_text())
        self.assertEqual(len(sizes),1)
        width,height=map(float,sizes[0]);self.assertLessEqual(width,325.21503);self.assertLess(height,240)

    @unittest.skipUnless(os.environ.get('BOOK_DELEGATION_PDF') and os.environ.get('BOOK_DELEGATION_BEFORE_AUX'),'before/after Book not supplied')
    def test_public_signatures_and_contents_unchanged(self):
        gate=gate_module()
        before=Path(os.environ['BOOK_DELEGATION_BEFORE_AUX']).read_bytes()
        after=Path(os.environ['BOOK_DELEGATION_PDF']).with_suffix('.aux').read_bytes()
        self.assertEqual(gate.signatures(before),gate.signatures(after))
        self.assertEqual(gate.expected_section_star_contents(before,os.environ.get('BOOK_SECTION_RETITLES')),gate.section_star_contents(after))


if __name__=='__main__':unittest.main()
