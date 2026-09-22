"""A historical cross-reference belongs beside its definition, not in a frame tail."""
import hashlib
import os
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
CHAPTER = ROOT/'website-v2/public/whitepaper/spawn-to-person.tex'
OPEN = r'\begin{definition}[Sanction-respecting reputation]'
NOTE = ('In the first edition this was Definition III.6.1; the standalone research '
        'paper on reputation inheritance cites it under that number.')
EXPECTED = '3af52ed301d95dabc4e58d830bcaa8e28d5f1834230d67c8838df5761d876b2a'


def source_check(source):
    assert source.count(OPEN) == 1
    body = source.split(OPEN, 1)[1].split(r'\end{definition}', 1)[0]
    assert hashlib.sha256(body.encode()).hexdigest() == EXPECTED
    assert body.count(r'\pdsourceaside') == 1 and r'\footnote' not in body


def render_check(path):
    import fitz
    with fitz.open(path) as doc:
        matches = []
        for page in doc:
            spans = [s for b in page.get_text('dict')['blocks'] if 'lines' in b
                     for line in b['lines'] for s in line['spans']]
            heads = [s for s in spans if s['text'].strip().startswith('Definition 5.6.1')]
            notes = [s for s in spans if 'In the first edition' in s['text']]
            if heads or notes:
                matches.append((page.number, heads, notes, spans))
        assert len(matches) == 1, 'Historical note is missing or on a continuation page'
        index, heads, notes, spans = matches[0]
        assert len(heads) == len(notes) == 1
        head, note = heads[0], notes[0]
        # The standalone heading no longer shares a line with the body.
        # The authored note is invoked immediately before this opening sentence.
        owners = [s for s in spans if s['text'].startswith('Fix a reputation mechanism')]
        assert len(owners) == 1
        assert abs(note['origin'][1] - owners[0]['origin'][1]) <= 3
        sys.path.insert(0, str(ROOT/'scripts/harbor-research'))
        try:
            from page_overflow import column, MARGIN_SEP, MARGIN_W
        finally:
            sys.path.pop(0)
        x0, x1, side = column(doc[index], index + 1)
        left, right = ((x1 + MARGIN_SEP - 1, x1 + MARGIN_SEP + MARGIN_W + 1)
                       if side == 'R' else (x0 - MARGIN_SEP - MARGIN_W - 1,
                                            x0 - MARGIN_SEP + 1))
        # Select just this note's lines; other independent marginalia may follow.
        rail = sorted((s for s in spans if left <= s['bbox'][0] < right
                       and s['bbox'][1] >= note['bbox'][1] - .1),
                      key=lambda s: (round(s['origin'][1], 1), s['bbox'][0]))
        words = []
        used = []
        for span in rail:
            words.extend(span['text'].split()); used.append(span)
            if len(words) >= len(NOTE.split()):
                break
        assert ' '.join(words) == NOTE
        assert all(left <= s['bbox'][0] < s['bbox'][2] <= right
                   and s['bbox'][3] <= 651.6 for s in used)
        assert not any(s['text'].strip() == 'a' and s['size'] < 8
                       and abs(s['origin'][1] - head['origin'][1]) < 12 for s in spans)
        return index + 1


class DefinitionMarginNoteTests(unittest.TestCase):
    def test_exact_definition_and_historical_note(self):
        source_check(CHAPTER.read_text())

    def test_changed_math_history_and_duplicate_are_rejected(self):
        source = CHAPTER.read_text()
        for before, after in [('Delta > 0', 'Delta > 1'), ('III.6.1', 'III.6.2'),
                              (r'\pdsourceaside{In', r'\pdsourceaside{In\pdsourceaside{extra}')]:
            with self.subTest(change=after), self.assertRaises(AssertionError):
                source_check(source.replace(before, after))

    def test_old_footnote_is_rejected(self):
        with self.assertRaises(AssertionError):
            source_check(CHAPTER.read_text().replace(r'\pdsourceaside{In', r'\footnote{In'))

    @unittest.skipUnless(os.environ.get('BOOK_DEFINITION_NOTE_PDF'), 'assembled Book not supplied')
    def test_actual_margin_placement(self):
        render_check(os.environ['BOOK_DEFINITION_NOTE_PDF'])

    @unittest.skipUnless(os.environ.get('BOOK_DEFINITION_NOTE_BEFORE_PDF'), 'negative Book not supplied')
    def test_old_book_continuation_rejected(self):
        with self.assertRaisesRegex(AssertionError, 'continuation page'):
            render_check(os.environ['BOOK_DEFINITION_NOTE_BEFORE_PDF'])


if __name__ == '__main__':
    unittest.main()
