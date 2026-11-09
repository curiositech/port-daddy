"""Sanction definition keeps actor-wide scope and a fixed clean baseline.

The final manuscript has no historical-edition aside. This contract protects
its mathematical content rather than requiring an obsolete body hash or note.
"""
import importlib.util
import os
import re
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]
CHAPTER = ROOT/'book/spawn-to-person.tex'
OPEN = r'\begin{definition}[Sanction-respecting reputation]'


def source_check(source):
    assert source.count(OPEN) == 1
    body = source.split(OPEN, 1)[1].split(r'\end{definition}', 1)[0]
    text = ' '.join(body.split())
    for phrase in (r'\label{def:sanction-respecting}',
                   'Fix a score-based access mechanism and a sanction window',
                   r'some $\sigma>0$',
                   'every actor producing a specified dishonest outcome',
                   r'by at least $\sigma$',
                   "that same actor's clean continuation over the same window",
                   'Include every identity through which the actor can route work',
                   r'\pdstatus{\Designed}{for the stated access model and clean continuation}'):
        assert phrase in text, 'Missing definition condition: '+phrase
    for stale in ('first edition', 'III.6.1', r'\footnote'):
        assert stale not in body, 'Historical framing is not part of the definition'


def render_check(path):
    import fitz
    path = Path(path)
    spec = importlib.util.spec_from_file_location(
        'label_gate', ROOT/'scripts/harbor-research/check_book_label_migration.py')
    gate = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(gate)
    labels = gate.parse(path.with_suffix('.aux').read_bytes())
    number, _, _, destination, *_ = labels['stp:def:sanction-respecting']
    with fitz.open(path) as doc:
        index = doc.resolve_names()[destination]['page']
        page = doc[index]
        text = ' '.join(page.get_text().replace('\u2011', '-').split())
        assert 'Definition '+number in text
        # The short definition is readable with its heading, not stranded on
        # a continuation page; all substantive scope must actually be printed.
        for phrase in ('score-based access mechanism', 'sanction window',
                       'clean continuation over the same window',
                       'every identity through which the actor can route work'):
            # Discretionary line-break hyphens are glyphs in the PDF.
            # Source syntax is guarded above; this checks that the complete
            # semantic text remains on the heading page.
            compact = lambda value: re.sub(r'[\s\u2011-]', '', value)
            assert compact(phrase) in compact(text), 'Definition condition missing from its page: '+phrase
        assert 'In the first edition' not in text
        return index + 1


class DefinitionMarginNoteTests(unittest.TestCase):
    def test_definition_retains_actor_wide_baseline_and_status(self):
        source_check(CHAPTER.read_text())

    def test_changed_math_scope_and_duplicate_are_rejected(self):
        source = CHAPTER.read_text()
        for before, after in [(r'\sigma>0', r'\sigma>1'),
                              ('every actor producing', 'some actor producing'),
                              ("same actor's clean continuation", "another actor's clean continuation"),
                              ('every identity through which', 'one identity through which'),
                              (r'\pdstatus{\Designed}{for the stated', r'\pdstatus{\Built}{for the stated'),
                              (OPEN, OPEN+OPEN)]:
            mutant = source.replace(before, after)
            self.assertNotEqual(mutant, source)
            with self.subTest(change=after), self.assertRaises(AssertionError):
                source_check(mutant)

    def test_historical_note_cannot_be_restored(self):
        source = CHAPTER.read_text()
        for note in (r'\pdsourceaside{In the first edition this was Definition III.6.1.}',
                     r'\footnote{Historical definition number.}'):
            with self.subTest(note=note), self.assertRaises(AssertionError):
                source_check(source.replace(OPEN, OPEN+note, 1))

    @unittest.skipUnless(os.environ.get('BOOK_DEFINITION_NOTE_PDF'), 'assembled Book not supplied')
    def test_actual_definition_and_scope_share_a_page(self):
        render_check(os.environ['BOOK_DEFINITION_NOTE_PDF'])

    @unittest.skipUnless(os.environ.get('BOOK_DEFINITION_NOTE_BEFORE_PDF'), 'negative Book not supplied')
    def test_obsolete_definition_is_rejected(self):
        with self.assertRaises(AssertionError):
            render_check(os.environ['BOOK_DEFINITION_NOTE_BEFORE_PDF'])


if __name__ == '__main__':
    unittest.main()
