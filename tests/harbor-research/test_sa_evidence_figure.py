"""Situation-awareness taxonomy, evidence status, and actual Book placement."""
from itertools import combinations
import math
import os
from pathlib import Path
import re
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
FIGURE = ROOT/'whitepaper/figures/legible-swarm-sa-levels.tex'
CHAPTER = ROOT/'whitepaper/legible-swarm.tex'


def source_contract(text):
    for token in ('perception/50/Perception/{Current state}',
                  'comprehension/88/Comprehension/Meaning',
                  'projection/126/Projection/{Anticipated effects}',
                  'Reported surface support', 'Digest + zoom', 'Proposed mode',
                  'Human performance:', 'untested here', 'Proposed freeze-probe',
                  'Pause; predict the next three merges; score accuracy.',
                  r'\SGMeasuredFigure{I/fig:sa-levels}'):
        assert token in text, token
    assert text.count(r'\caption{') == text.count(r'\label{fig:sa-levels}') == 1
    for token in ('validated', r'\resizebox', r'\scalebox', r'\fontsize',
                  r'\tiny', r'\scriptsize', 'transform shape', r'\clip'):
        assert token not in text, token


def gap(a,b):
    return math.hypot(max(a[0]-b[2],b[0]-a[2],0),
                      max(a[1]-b[3],b[1]-a[3],0))


class SAEvidenceTests(unittest.TestCase):
    def test_source_contract(self):
        source_contract(FIGURE.read_text())

    def test_false_claims_and_scaling_rejected(self):
        source=FIGURE.read_text()
        for old,new in [('untested here','validated here'),
                        ('Proposed mode','Delivered mode'),
                        ('Proposed freeze-probe','Freeze-probe results'),
                        ('projection/126/Projection/{Anticipated effects}',
                         'projection/126/Projection/{Current state}')]:
            with self.subTest(new=new),self.assertRaises(AssertionError):
                source_contract(source.replace(old,new))
        for addition in (r'\scalebox{.8}{x}',r'\caption{extra}'):
            with self.assertRaises(AssertionError):source_contract(source+addition)

    def test_owning_argument_keeps_study_and_proposal_distinct(self):
        text=CHAPTER.read_text()
        text=text[text.index(r'\subsection{Situation awareness'):text.index(r'\subsection{The Bainbridge')]
        for token in (r'\pdcite{endsley1995}',r'\pdcite{endsleykiris1995}',
                      'navigation experiment', 'no significant perception',
                      'design hypothesis', 'no human-performance',
                      r'\input{figures/legible-swarm-sa-levels}'):
            self.assertIn(token,text)
        for token in ('SA-destroying instrument','validated by a','reaches today'):
            self.assertNotIn(token,text)
        self.assertEqual(text.count(r'\label{sec:sa}'),1)

    def test_atlas_contract(self):
        atlas=(ROOT/'skills/whitepaper-figure-system/references/semantic-figure-atlas.md').read_text()
        row=next(x for x in atlas.splitlines() if x.startswith('| `I/fig:sa-levels`'))
        for token in ('read-surface support distinct from measured human performance',
                      'ordinal categories only','validated without results'):
            self.assertIn(token,row)

    @unittest.skipUnless(os.environ.get('BOOK_SA_PDF'),'assembled Book not supplied')
    def test_assembled_geometry(self):
        pdf=Path(os.environ['BOOK_SA_PDF'])
        log=pdf.with_suffix('.log').read_text()
        measured=re.findall(r'SG-GEOMETRY: I/fig:sa-levels,width=([.\d]+)pt,height=([.\d]+)pt',log)
        self.assertEqual(len(measured),1)
        width,height=map(float,measured[0])
        self.assertLessEqual(width,325.21503)
        self.assertTrue(210<height<220)
        nodes={n:(float(a),-float(b),float(c),-float(d)) for n,a,b,c,d in re.findall(
            r'SA-NODE: ([^,]+),([-.\d]+)pt,([-.\d]+)pt,([-.\d]+)pt,([-.\d]+)pt',log)}
        self.assertEqual(len(nodes),14)
        for (a,x),(b,y) in combinations(nodes.items(),2):
            self.assertGreaterEqual(gap(x,y),5,(a,b))

    @unittest.skipUnless(os.environ.get('BOOK_SA_PDF'),'assembled Book not supplied')
    def test_actual_page_native_type_and_body_bounds(self):
        import fitz
        sys.path.insert(0,str(ROOT/'scripts/harbor-research'))
        from check_book_label_migration import parse,signatures,section_star_contents,expected_section_star_contents
        from page_overflow import column
        pdf=Path(os.environ['BOOK_SA_PDF'])
        aux=pdf.with_suffix('.aux').read_bytes()
        before=(ROOT/'.cache/book-nomint-pass-20260920/coordination-papers-mega-volume.aux').read_bytes()
        self.assertEqual(signatures(before),signatures(aux))
        self.assertEqual(expected_section_star_contents(before,os.environ.get('BOOK_SECTION_RETITLES')),section_star_contents(aux))
        labels=parse(aux)
        with fitz.open(pdf) as doc:
            index=doc.resolve_names()[labels['ls:fig:sa-levels'][3]]['page']
            page=doc[index];left,right,_=column(page,index+1)
            spans=[s for b in page.get_text('dict')['blocks'] if 'lines' in b
                   for line in b['lines'] for s in line['spans']]
            for label in ('Perception','Comprehension','Projection','Proposed freeze-probe'):
                # The licensed Suisse face extracts a printed hyphen as U+2011.
                hits=[s for s in spans if s['text'].replace('\u2011','-')==label]
                self.assertEqual(len(hits),1,label)
                self.assertIn('SuisseIntl-Semibold',hits[0]['font'])
                self.assertTrue(8.6<=hits[0]['size']<=8.9)
                self.assertTrue(left-1<=hits[0]['bbox'][0]<hits[0]['bbox'][2]<=right+1)
            top=page.search_for('SA level')[0].y0
            bottom=page.search_for('Pause; predict the next three merges; score accuracy.')[0].y1
            marks=[x['rect'] for x in page.get_drawings() if top<=x['rect'].y0<=bottom]
            self.assertTrue(marks)
            self.assertTrue(all(left-1<=r.x0 and r.x1<=right+1 for r in marks))
            self.assertIn('untested here',' '.join(page.get_text().split()))


if __name__=='__main__':unittest.main()
