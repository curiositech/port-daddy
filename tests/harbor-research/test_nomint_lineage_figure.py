"""Exact A6 accounting and native Book presentation, not a fresh random sweep."""
import ast
from fractions import Fraction as F
import importlib.util
import os
from pathlib import Path
import re
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
FIGURE = ROOT/'website-v2/public/whitepaper/figures/fig-stp-nomint-lineage.tex'
CHAPTER = ROOT/'website-v2/public/whitepaper/spawn-to-person.tex'


def accounting(closure, transfer, copied):
    assert closure == [F(9,10),F(81,100),F(729,1000)]
    assert sum(closure) == F(2439,1000)
    assert transfer == [0,0,0,F(729,1000)]
    assert sum(transfer) == F(729,1000)
    assert copied == [F(1)]+[F(9,10)]*8
    assert sum(copied) == F(41,5)


def source_contract(source):
    for mark in ('{Budget-only}', '{Transfer}', '{Copy-fork mutant}',
                 '{evidence only}', '{3 inherited priors counted}',
                 '{source still live}', 'Inherited closure:',
                 '0+0+0+.729=.729', r'1+8\times.9=8.2', '{debit 1}',
                 '{debit .9}', '{debit .81}', '{20,60,100,140,180,220,260,300}',
                 r'(child\x) at (\x,363) {.9}', 'spendable balances.',
                 r'\SGMeasuredFigure{stp-nomint-lineage}'):
        assert mark in source, mark
    assert source.count(r'\node[nm spent]') == 3
    assert source.count(r'\caption{') == 1
    assert source.count(r'\label{fig:stp-nomint-lineage}') == 1
    for forbidden in (r'\resizebox',r'\scalebox','transform shape',
                      r'\fontsize',r'\scriptsize',r'\tiny','shortest crime'):
        assert forbidden not in source, forbidden


def label_gate():
    spec=importlib.util.spec_from_file_location(
        'nomint_labels',ROOT/'scripts/harbor-research/check_book_label_migration.py')
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    return module


def native_text_row(page, word, left, right):
    """Join physical words on one baseline, not MuPDF's spacing-split lines."""
    return ' '.join(w[4] for w in sorted(page.get_text('words'),key=lambda w:w[0])
                    if abs(w[1]-word[1])<.25 and left-1<=w[0] and w[2]<=right+1
                    ).replace('\u2011','-')


def boundary_before_figure(pages, figure_index):
    """Keep the complete closing paragraph together, not a fixed page number."""
    compact = lambda text: re.sub(r'[\s\-‐‑–—\u00ad]+', '', text)
    paragraph = compact(
        'The third gap is a witness to what the successor loaded — notes, '
        'checkpoint and ledger positions — not just authority to load them. '
        'This chapter specifies no such witness.')
    window = [(i, compact(pages[i]))
              for i in range(max(0, figure_index-1), figure_index+1)]
    owners = [(i, text) for i, text in window if paragraph in text]
    assert len(owners) == 1, 'boundary closing paragraph split, absent or duplicated'
    owner, text = owners[0]
    if owner == figure_index:
        introduction = compact('Figure 5.4 compares three ways')
        assert introduction in text, 'figure introduction missing'
        assert text.index(paragraph) + len(paragraph) <= text.index(introduction), \
            'boundary paragraph must precede its figure'


def substantial_continuation(page, ending):
    """Require a framed continuation with at least four physical text rows."""
    import fitz
    frames = [d['rect'] for d in page.get_drawings()
              if d['type'] == 's' and 300 < d['rect'].width < 340
              and d['rect'].contains(ending)]
    assert frames, 'Continuation must retain its complete frame'
    frame = min(frames, key=lambda r: r.get_area())
    rows = {round(w[1], 1) for w in page.get_text('words')
            if frame.contains(fitz.Rect(w[:4]))}
    assert len(rows) >= 4, 'Reject a short stranded continuation'


class NoMintLineageTests(unittest.TestCase):
    def test_short_or_unframed_continuations_are_rejected(self):
        import fitz
        for count, framed in ((1, True), (2, True), (3, True),
                              (4, True), (6, True), (6, False)):
            with self.subTest(rows=count, framed=framed), fitz.open() as doc:
                page = doc.new_page(width=504, height=720)
                if framed:
                    page.draw_rect(fitz.Rect(70, 60, 390, 180))
                for row in range(count):
                    page.insert_text((80, 80+14*row),
                                     'about a merge.' if row == count-1 else 'A substantive continuation row.',
                                     fontsize=10)
                ending = page.search_for('about a merge.')[0]
                if framed and count >= 4:
                    substantial_continuation(page, ending)
                else:
                    with self.assertRaises(AssertionError):
                        substantial_continuation(page, ending)

    def test_complete_boundary_can_precede_figure_on_either_page(self):
        paragraph = ('The third gap is a witness to what the successor loaded — '
                     'notes, checkpoint and ledger positions — not just authority '
                     'to load them. This chapter specifies no such witness.')
        figure = 'Figure 5.4 compares three ways'
        boundary_before_figure([paragraph, figure], 1)
        boundary_before_figure(['Earlier text', paragraph+'\n'+figure], 1)
        for pages in ([paragraph[:80], paragraph[80:]+figure],
                      ['Earlier text', figure+paragraph],
                      [paragraph, paragraph+figure],
                      ['Earlier text', 'This chapter specifies no such witness.'+figure]):
            with self.subTest(pages=pages), self.assertRaises(AssertionError):
                boundary_before_figure(pages, 1)

    def test_physical_heading_row_keeps_baseline_and_body_bounds(self):
        words=[(10,20,20,30,'Numbers'),(22,20,27,30,'by'),
               (30,20,40,30,'Hand'),(42,20,52,30,'5.4.2'),
               (55,20,70,30,'(No\u2011Mint'),(75,20,99,30,'Inheritance).'),
               (75,40,99,50,'wrong-next-line'),(110,20,130,30,'margin')]
        class Page:
            def get_text(self,mode):
                assert mode=='words'
                return words
        self.assertEqual(native_text_row(Page(),words[4],10,100),
                         'Numbers by Hand 5.4.2 (No-Mint Inheritance).')

    def test_exact_accounting(self):
        accounting([F(9,10),F(81,100),F(729,1000)],
                   [0,0,0,F(729,1000)],[F(1)]+[F(9,10)]*8)

    def test_false_aggregates_rejected(self):
        good=([F(9,10),F(81,100),F(729,1000)],
              [0,0,0,F(729,1000)],[F(1)]+[F(9,10)]*8)
        for index,bad in ((0,[F(1)]+good[0]),(1,[0,0,0,F(9,10)]),
                          (1,[1,0,0,F(729,1000)]),(2,[F(1)]*9),
                          (2,[F(9,10)]*8),(2,good[2][:-1])):
            args=list(good);args[index]=bad
            with self.subTest(index=index,bad=bad), self.assertRaises(AssertionError):
                accounting(*args)

    def test_actual_ledger_rule_for_three_finite_cases(self):
        # Execute only the inspected, pure Ledger class: never import numpy
        # or run the original module's 4,000-DAG sweep.
        path=ROOT/'skills/harbor-results/scripts/a6_no_mint.py'
        module=ast.parse(path.read_text(),filename=str(path))
        ledger=next(node for node in module.body
                    if isinstance(node,ast.ClassDef) and node.name=='Ledger')
        namespace={'MUT':{'copy_full':False}}
        exec(compile(ast.Module(body=[ledger],type_ignores=[]),str(path),'exec'),namespace)
        cls=namespace['Ledger'];transfer=cls();parent=transfer.witness(1.0)
        for _ in range(3): parent=transfer.derive([parent],[1.0],.9)
        self.assertEqual(transfer.spend[:3],[0,0,0])
        self.assertAlmostEqual(transfer.total(),.729,places=14)
        namespace['MUT']['copy_full']=True
        copied=cls();parent=copied.witness(1.0)
        for _ in range(8):copied.derive([parent],[1.0],.9)
        self.assertEqual(len(copied.spend),9)
        self.assertEqual(copied.spend[0],1)
        self.assertTrue(all(x==.9 for x in copied.spend[1:]))
        self.assertAlmostEqual(copied.total(),8.2,places=14)
        one=cls();parent=one.witness(1.0);one.derive([parent],[1.0],.9)
        self.assertAlmostEqual(one.total(),1.9,places=14)

    def test_source_contract(self):
        source_contract(FIGURE.read_text())
        atlas=(ROOT/'skills/whitepaper-figure-system/references/semantic-figure-atlas.md').read_text()
        row=next(line for line in atlas.splitlines() if line.startswith('| '+chr(96)+'III/fig:stp-nomint-lineage'))
        for phrase in ('excludes initial evidence','root 1 plus eight .9','historical grants'):
            self.assertIn(phrase,row)

    def test_bad_figure_readings_rejected(self):
        source=FIGURE.read_text()
        for old,new in [(r'(\x,363) {.9}',r'(\x,363) {1}'),
                        ('Inherited closure:','Live total:'),
                        ('{source still live}','{source spent}'),
                        ('0+0+0+.729=.729','0+0+0+.9=.9')]:
            with self.subTest(new=new),self.assertRaises(AssertionError):
                source_contract(source.replace(old,new))
        with self.assertRaises(AssertionError):
            source_contract(source+r'\scalebox{.8}{x}')

    def test_owning_prose_and_solution_agree(self):
        chapter=CHAPTER.read_text()
        start=chapter.index(r'\begin{pdexample}{No-Mint Inheritance}')
        block=chapter[start:chapter.index(r'\end{pdexample}',start)]
        self.assertRegex(block, r'\\\[\s*0\.9\^3=0\.729\\le 1,\s*\\\]\s*not \$2\.439\$')
        self.assertIn('recorded two-fork trace',block)
        self.assertIn('reported randomized sweep',block)
        self.assertNotIn('shortest crime',block)
        self.assertNotIn('executed no-mint theorem',block)
        self.assertIn('finite observed result, not the general proof',chapter)
        self.assertNotIn('signatures, drawn overleaf in Fig.',chapter)
        self.assertIn('\\input{figures/fig-stp-nomint-lineage}\n\\FloatBarrier',chapter)

    @unittest.skipUnless(os.environ.get('BOOK_NOMINT_PDF'),'assembled Book not supplied')
    def test_actual_book_native_figure_and_owner_order(self):
        import fitz
        sys.path.insert(0,str(ROOT/'scripts/harbor-research'))
        try: from page_overflow import column
        finally: sys.path.pop(0)
        path=Path(os.environ['BOOK_NOMINT_PDF'])
        labels=label_gate().parse(path.with_suffix('.aux').read_bytes())
        with fitz.open(path) as doc:
            index=doc.resolve_names()[labels['stp:fig:stp-nomint-lineage'][3]]['page']
            page=doc[index]
            spans=[s for b in page.get_text('dict')['blocks'] if 'lines' in b
                   for line in b['lines'] for s in line['spans']]
            for title in ('Budget-only','Transfer','Copy-fork mutant'):
                matches=[s for s in spans if s['text'].replace('\u2011','-')==title]
                self.assertEqual(len(matches),1,title)
                self.assertIn('SuisseIntl',matches[0]['font'])
                self.assertIn('Semibold',matches[0]['font'])
                self.assertTrue(8.6<=matches[0]['size']<=8.9)
            top=page.search_for('One witnessed unit;')[0].y0
            last=page.search_for('Live total:')[-1]
            left,right,_=column(page,index+1)
            marks=[p['rect'] for p in page.get_drawings() if top<=p['rect'].y0<=last.y1]
            self.assertTrue(marks)
            self.assertTrue(all(left-1<=r.x0 and r.x1<=right+1 for r in marks))
            # The exercise must follow the complete exhibit, not be cut by it.
            # Suisse maps a printed hyphen to U+2011 in extracted text.
            # Justification can also split one physical line into several
            # MuPDF line objects. Use physical words on one baseline within
            # the body column, still requiring the complete exact heading.
            headings=[]
            for i in range(max(0,index-1),min(len(doc),index+3)):
                lo,hi,_=column(doc[i],i+1)
                for word in doc[i].get_text('words'):
                    if word[4].replace('\u2011','-')=='(No-Mint':
                        row=native_text_row(doc[i],word,lo,hi)
                        self.assertIn('Numbers by Hand 5.4.2 (No-Mint Inheritance).',row)
                        headings.append((i,word[1]))
            self.assertEqual(len(headings),1)
            self.assertGreater(headings[0],(index,last.y1))
            self.assertEqual(headings[0][0],index+1)
            start_page = headings[0][0]
            start_text = ' '.join(doc[start_page].get_text().split())
            self.assertIn('Now you try:', start_text)
            self.assertIn('0.729', start_text)
            self.assertIn('2.439', start_text)
            # Decompressed calculations may span two pages. Keep the worked
            # arithmetic with its question and reject a tiny continuation,
            # rather than forcing all historical discussion onto one page.
            ending_pages = [i for i in range(start_page, min(len(doc), start_page+2))
                            if 'about a merge.' in ' '.join(doc[i].get_text().split())]
            self.assertEqual(len(ending_pages), 1)
            end_page = ending_pages[0]
            if end_page != start_page:
                ending = doc[end_page].search_for('about a merge.')[0]
                substantial_continuation(doc[end_page], ending)
            # Reflow may put the complete final paragraph directly above the
            # exhibit. Reject split tails and reversed order, not that layout.
            boundary_before_figure([p.get_text() for p in doc], index)
        sizes=re.findall(r'SG-GEOMETRY: stp-nomint-lineage,width=([\d.]+)pt,height=([\d.]+)pt',
                         path.with_suffix('.log').read_text())
        self.assertEqual(len(sizes),1)
        width,height=map(float,sizes[0])
        self.assertLessEqual(width,325.21503)
        self.assertTrue(400<=height<420)

    @unittest.skipUnless(os.environ.get('BOOK_NOMINT_PDF'),'assembled Book not supplied')
    def test_no_public_identity_change(self):
        gate=label_gate()
        before=(ROOT/'.cache/book-durability-parent-20260920/coordination-papers-mega-volume.aux').read_bytes()
        after=Path(os.environ['BOOK_NOMINT_PDF']).with_suffix('.aux').read_bytes()
        self.assertEqual(gate.signatures(before),gate.signatures(after))
        self.assertEqual(gate.expected_section_star_contents(before,os.environ.get('BOOK_SECTION_RETITLES')),gate.section_star_contents(after))


if __name__=='__main__':unittest.main()
