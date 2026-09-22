"""Protect the exact worked body while allowing one explicitly scoped source note."""
import hashlib
import os
from pathlib import Path
import sys
import unittest

ROOT=Path(__file__).resolve().parents[2]
CHAPTER=ROOT/'website-v2/public/whitepaper/spawn-to-person.tex'
OPEN=r'\begin{pdexample}{The Swap Gain and the Attested Flip}'
CLOSE=r'\end{pdexample}'
NOTE=r'\pdsourceaside{Worked checks: \texttt{b5\_engine\_substitution.py}, seed 20260816, verified: swap gain, participation threshold, deterrence bond and attested flip. The $c_H=0.7$ answer applies the same threshold formula.}'
# Authorized paragraph/display-math pass; the Chapter 4/5 packet's conservation
# guard was rerun before repinning. Math, wording and provenance mutations below
# still fail; this is not an exemption from exact-body protection.
BODY_SHA='8c7106fd967dd66df6b2c0e197eb5593047ee02500c79bcd5506977894b8a219'


def validate(source):
    assert source.count(OPEN)==1
    block=source.split(OPEN)[1].split(CLOSE)[0]
    assert block.count(NOTE)==1
    assert block.count(r'\pdsourceaside')==1
    assert r'\pdprov' not in block
    assert hashlib.sha256(block.replace(NOTE,'').encode()).hexdigest()==BODY_SHA
    return block


class ScopedProvenanceTests(unittest.TestCase):
    def test_body_and_evidence_scope_preserved(self):
        validate(CHAPTER.read_text())

    def test_changed_math_and_words_are_rejected(self):
        source=CHAPTER.read_text()
        for a,b in [('at every price','at some price'),('c_H-c_L=0.3','c_H-c_L=0.4')]:
            with self.subTest(change=b), self.assertRaises(AssertionError):
                validate(source.replace(a,b))

    def test_other_source_seed_status_and_scope_cannot_be_substituted(self):
        source=CHAPTER.read_text()
        for note in (NOTE.replace('20260816','20260817'),NOTE.replace('verified:','internal:'),
                     NOTE.replace('engine','other'),NOTE.replace('applies the same threshold formula','was separately simulated')):
            with self.subTest(note=note), self.assertRaises(AssertionError):
                validate(source.replace(NOTE,note))

    def test_extra_note_and_removed_note_are_rejected(self):
        for replacement in ('',NOTE+NOTE):
            with self.assertRaises(AssertionError):
                validate(CHAPTER.read_text().replace(NOTE,replacement))

    def test_other_passages_are_not_suppressed(self):
        other=r'\pdprov{different.py}{20260817}{internal}'
        source=other+CHAPTER.read_text()+other
        validate(source)
        self.assertEqual(source.count(other),2)

    @unittest.skipUnless(os.environ.get('BOOK_BONDED_PDF'),'assembled Book not supplied')
    def test_one_note_beside_the_actual_worked_example(self):
        import fitz
        sys.path.insert(0, str(ROOT/'scripts/harbor-research'))
        try:
            from check_book_caption_margins import (
                bounds_issues, caption_blocks_unclipped, column, with_continuations)
        finally:
            sys.path.pop(0)
        with fitz.open(os.environ['BOOK_BONDED_PDF']) as book:
            pages=[p for p in book if 'Worked checks:' in p.get_text()]
            self.assertEqual(len(pages),1)
            page=pages[0]; text=' '.join(page.get_text().split())
            self.assertIn('The Swap Gain and the Attested',text)
            for phrase in ('seed 20260816','participation threshold','deterrence bond',
                           'attested flip','answer applies the same threshold formula'):
                self.assertIn(phrase,text)
            notes=page.search_for('Worked checks:')
            self.assertEqual(len(notes),1)
            # Reflow may change parity. Check the whole note in the actual
            # outside rail, never a hard-coded right-hand-page x coordinate.
            blocks=caption_blocks_unclipped(page)
            start=next(b for b in blocks if 'Worked checks:' in b[4])
            note=with_continuations(start,blocks)
            self.assertIn('threshold formula.', ' '.join(note[4].split()))
            left,right,side=column(page,page.number+1)
            self.assertEqual(bounds_issues(note,left,right,side),[])
            # The corrected test must still reject wrong-side or body notes.
            self.assertTrue(bounds_issues(note,left,right,'L' if side=='R' else 'R'))
            body_note=(left+10,note[1],left+70,note[3])
            self.assertTrue(bounds_issues(body_note,left,right,side))


if __name__=='__main__':
    unittest.main()
