"""Three-way completion design and native Book rendering, not runtime proof."""
import itertools
import os
from pathlib import Path
import re
import sys
import unittest

ROOT=Path(__file__).resolve().parents[2]
FIG=ROOT/'whitepaper/figures/legible-swarm-completion-verifier.tex'
OWNER=ROOT/'whitepaper/legible-swarm.tex'
EXPECTED={'met':'done','unmet':'refused','unevaluable':'inability'}


def source_contract(text):
    source='\n'.join(line.split('%',1)[0] for line in text.splitlines())
    branches=re.findall(
        r'\\draw\[cv arrow,draw=[^\]]+\] \([\d]+,134\)--\((\w+)\.north\);\s*'
        r'\\node\[[^\]]+\] at \([\d]+,161\) \{(met|unmet|unevaluable)\};',source)
    assert len(branches)==3
    assert {guard:dest for dest,guard in branches}==EXPECTED
    assert source.count(r'\draw[cv arrow')==5
    for binding in (r'(64,45)--(64,98)--(verifier.west)',
                    r'(256,45)--(256,58)--(160,58)--(verifier.north)',
                    r'(verifier.south)--(160,134)',r'{Acceptance\\criteria}',
                    r'{Completion\\claim}',r'{Done\\for these criteria}',
                    r'{I cannot verify\\this completion}',
                    'Vision: a proposed authority-side rule, not implemented enforcement',
                    'or a guarantee of universal correctness.',
                    r'\SGMeasuredFigure{I/fig:completion-verifier}'):
        assert binding in source,binding
    assert source.count(r'\label{fig:completion-verifier}')==1
    assert source.count(r'\caption{')==1
    for forbidden in (r'\resizebox',r'\scalebox',r'\fontsize',r'\tiny',
                      r'\scriptsize','transform shape','pd badge'):
        assert forbidden not in source,forbidden


def guard_contract(rows):
    assert [r['guard'] for r in rows]==list(EXPECTED)
    clearances=[]
    for r in rows:
        rect=r['bbox'];clear=r['x']-r['stroke']/2-rect[2]
        assert 6<=clear<=14,'guard must be left of its own edge'
        clearances.append(clear)
        for other in rows:
            if other is r:continue
            x=other['x']
            distance=max(rect[0]-x,x-rect[2],0)-other['stroke']/2
            assert distance>=clear+8,'ambiguous edge association'
    assert max(clearances)-min(clearances)<.75
    assert max(r['bbox'][1] for r in rows)-min(r['bbox'][1] for r in rows)<1
    for a,b in zip(rows,rows[1:]):
        assert b['bbox'][0]-a['bbox'][2]>=2*max(a['size'],b['size']),'crowded guards'


class CompletionVerifierTests(unittest.TestCase):
    def test_source_contract(self):source_contract(FIG.read_text())

    def test_wrong_outcome_maps_rejected(self):
        source=FIG.read_text();names=list(EXPECTED.values())
        for perm in itertools.permutations(names):
            if list(perm)==names:continue
            mapping=dict(zip(names,perm))
            mutant=re.sub(r'--\((done|refused|inability)\.north\)',
                          lambda m:'--('+mapping[m[1]]+'.north)',source)
            with self.subTest(perm=perm),self.assertRaises(AssertionError):source_contract(mutant)

    def test_missing_evidence_bypass_and_promotions_rejected(self):
        source=FIG.read_text()
        for old,new in [('--(verifier.north)','--(done.north)'),
                        ('{unevaluable}','{}'),
                        (r'{Done\\for these criteria}','{All software correct}'),
                        ('Vision: a proposed authority-side rule','Built: authority-side rule'),
                        ('or a guarantee of universal correctness.','and a guarantee of universal correctness.')]:
            with self.subTest(new=new),self.assertRaises(AssertionError):source_contract(source.replace(old,new))
        for addition in (r'\draw[cv arrow] (claim)--(done);',r'\scalebox{.8}{x}'):
            with self.assertRaises(AssertionError):source_contract(source+addition)

    def test_prose_status_and_no_duplicated_legend(self):
        text=OWNER.read_text()
        section=text[text.index(r'\subsection{Completionist obligation:'):text.index(r'\subsection{Thoughtful landing')]
        self.assertIn('obligation proposes an authority-side rule',section)
        warning='Passing it still leaves any omitted requirement unchecked.'
        self.assertIn(warning,FIG.read_text())
        self.assertEqual((section+FIG.read_text()).count(warning),1)
        self.assertIn(r'\label{def:completionist}',section)
        self.assertIn(r'\pdcite{meyer1992}',section)
        self.assertIn(r'Completionist completion (verifier-gated) & \Vision',text)
        for phrase in ('structurally impossible','only structural defense','three-way gate directly'):
            self.assertNotIn(phrase,section)

    def test_guard_geometry_mutants(self):
        good=[{'guard':g,'bbox':[x-40,10,x-10,19],'x':x,'stroke':.8,'size':8.7}
              for g,x in zip(EXPECTED,[52,160,268])]
        guard_contract(good)
        for shift in (8,20):
            bad=[dict(x,bbox=list(x['bbox'])) for x in good]
            bad[1]['bbox'][0]+=shift;bad[1]['bbox'][2]+=shift
            with self.assertRaises(AssertionError):guard_contract(bad)
        bad=[dict(x,bbox=list(x['bbox'])) for x in good]
        bad[2]['bbox'][0]=bad[1]['bbox'][2]+10
        with self.assertRaises(AssertionError):guard_contract(bad)

    @unittest.skipUnless(os.environ.get('BOOK_COMPLETION_PDF'),'assembled Book not supplied')
    def test_actual_native_page_and_guard_association(self):
        import fitz
        sys.path.insert(0,str(ROOT/'scripts/harbor-research'))
        from check_book_label_migration import parse,signatures,section_star_contents,expected_section_star_contents
        from page_overflow import column
        pdf=Path(os.environ['BOOK_COMPLETION_PDF']);aux=pdf.with_suffix('.aux').read_bytes()
        before=(ROOT/'.cache/book-sa-evidence-20260920/coordination-papers-mega-volume.aux').read_bytes()
        self.assertEqual(signatures(before),signatures(aux))
        self.assertEqual(expected_section_star_contents(before,os.environ.get('BOOK_SECTION_RETITLES')),section_star_contents(aux))
        labels=parse(aux)
        with fitz.open(pdf) as d:
            index=d.resolve_names()[labels['ls:fig:completion-verifier'][3]]['page']
            page=d[index];left,right,_=column(page,index+1)
            # TeX can break a word across lines without moving it off this page.
            # Dehyphenate the page, never concatenate text from the next page.
            text=' '.join(page.get_text(flags=fitz.TEXT_DEHYPHENATE).split())
            self.assertIn('omitted requirement unchecked',text)
            spans=[s for b in page.get_text('dict')['blocks'] if 'lines' in b
                   for line in b['lines'] for s in line['spans']]
            guards=[]
            for name in ('Verifier','met','unmet','unevaluable','Done','Refused','I cannot verify'):
                matches=[s for s in spans if s['text']==name]
                self.assertEqual(len(matches),1,name);s=matches[0]
                self.assertIn('SuisseIntl',s['font']);self.assertTrue(8.6<=s['size']<=8.9)
                self.assertTrue(left-1<=s['bbox'][0]<s['bbox'][2]<=right+1)
                if name in EXPECTED:guards.append(s)
            top=min(s['bbox'][1] for s in guards);bottom=max(s['bbox'][3] for s in guards)
            edges=[]
            for draw in page.get_drawings():
                if draw.get('color') is None:continue
                for item in draw['items']:
                    if item[0]!='l':continue
                    a,b=item[1:]
                    if (abs(a.x-b.x)<.01 and left<a.x<right and
                        min(a.y,b.y)<top-6 and max(a.y,b.y)>bottom+6):
                        edges.append((a.x,draw['width']))
            edges.sort();self.assertEqual(len(edges),3)
            guard_contract([{'guard':s['text'],'bbox':s['bbox'],'x':x,'stroke':w,'size':s['size']}
                            for s,(x,w) in zip(guards,edges)])
            # The reduced completion passage reflows the next calculation.
            # Its short answer must remain with its heading, not merely fit
            # in valid breakable frames on two separate pages.
            calculation_pages=[]
            for candidate in list(d)[index:index+8]:
                body=' '.join(candidate.get_text(flags=fitz.TEXT_DEHYPHENATE).split())
                if 'Numbers by Hand 4.4.8' in body:
                    calculation_pages.append(body)
            self.assertEqual(len(calculation_pages),1)
            self.assertIn('confirm both bands (Exercise 4.19).',calculation_pages[0])
        geometry=re.findall(r'SG-GEOMETRY: I/fig:completion-verifier,width=([.\d]+)pt,height=([.\d]+)pt',
                            pdf.with_suffix('.log').read_text())
        self.assertEqual(len(geometry),1)
        width,height=map(float,geometry[0]);self.assertLessEqual(width,325.21503)
        self.assertTrue(230<height<245)


if __name__=='__main__':unittest.main()
