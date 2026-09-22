"""Protocol presentation and whole-postcondition regression, not protocol proof."""
import os
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[2]
EXPECTED = {
    'lsprotocol.4.2.1', 'lsprotocol.4.3.1', 'lsprotocol.4.5.1',
    'lsprotocol.4.7.1', 'stpprotocol.5.10.1', 'stpprotocol.5.10.2',
    'stpprotocol.5.12.1', 'heprotocol.6.3.1', 'heprotocol.6.8.1',
}


def compact(text):
    # PDF extraction may insert a hyphen at an ordinary word's line break.
    # This check compares words, not typography or mathematical minus signs.
    return re.sub(r'[\s\-‐‑\u00ad]+', '', text)


def whole_gossip_postcondition(text):
    """Keep the bounded-model result and the partition exclusion with its owner."""
    text = compact(text)
    assert 'Post,conditionally:' in text
    assert 'connectedreliableroundmodel,everyhonestharbor' in text
    assert 'Underanunboundedpartitionthereisnofinitegloballearningbound.' in text


def whole_judge_remedy_heading(pages):
    """A page may break before a remedy, not halfway through its short label."""
    heading = 'FixB—bondandslashthejudges:'
    return sum(heading in compact(page) for page in pages) == 1


class ProtocolSource(unittest.TestCase):
    def test_split_judge_remedy_heading_is_rejected(self):
        self.assertTrue(whole_judge_remedy_heading([
            'Earlier text.', 'Fix B — bond-and-slash the judges: where checking is impossible']))
        self.assertFalse(whole_judge_remedy_heading([
            'Earlier text. Fix B', '— bond-and-slash the judges: where checking is impossible']))

    def test_conditional_gossip_premises_survive_shorter_introduction(self):
        source = (ROOT / 'website-v2/public/whitepaper/harbor-economy.tex').read_text()
        start = source.index('Federated revocation uses anti-entropy gossip')
        end = source.index(r'\end{protocol}', start)
        prose = ' '.join(source[start:end].split())
        for token in (r'\pdcite{demers1987}', 'cuckoo filter',
                      'no false negatives', 'tunable false positives',
                      'connected reliable-round overlay',
                      'stated randomized peer-selection model',
                      'asymptotic expectation', 'not an exact constant',
                      'partition-tolerant deadline',
                      r'\textbf{Post, conditionally:}',
                      r'$\Theta(\Delta\log m)$',
                      'unbounded partition there is no finite global-learning bound'):
            self.assertIn(token, prose)
        self.assertIn(r'{\interlinepenalty=10000\relax \textbf{Post, conditionally:}', prose)

    def test_missing_partition_exclusion_and_detached_postcondition_rejected(self):
        text = ('Protocol 6.8.1 (Federated revocation gossip). '
                'Post, conditionally: in the connected reliable-round model, every honest harbor '
                'learns the revocation in expected time. '
                'Under an unbounded partition there is no finite global-learning bound.')
        whole_gossip_postcondition(text)
        for bad in (text.split('Under an unbounded')[0],
                    text.replace('Post, conditionally:', ''),
                    text.replace('connected reliable-round model', 'any topology')):
            with self.assertRaises(AssertionError):
                whole_gossip_postcondition(bad)


@unittest.skipUnless(os.environ.get('BOOK_PROTOCOL_PDF'), 'actual Book proof not supplied')
class ProtocolActualBook(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import fitz
        cls.document = fitz.open(os.environ['BOOK_PROTOCOL_PDF'])
        cls.names = cls.document.resolve_names()

    @classmethod
    def tearDownClass(cls):
        cls.document.close()

    def test_all_nine_protocols_keep_identity_and_approved_teal_frame(self):
        actual = {key for key in self.names
                  if re.fullmatch(r'(?:ls|stp|he)?protocol\.[\d.]+', key)}
        self.assertEqual(actual, EXPECTED)
        teal = (0/255, 125/255, 115/255)
        for key in sorted(EXPECTED):
            page = self.document[self.names[key]['page']]
            number = key.split('.', 1)[1]
            self.assertIn('Protocol' + number + '(', compact(page.get_text()), key)
            caps = [drawing for drawing in page.get_drawings()
                    if drawing['fill'] is not None
                    and len(drawing['fill']) == 3
                    and max(abs(a-b) for a, b in zip(drawing['fill'], teal)) < .004
                    and min(drawing['rect'].width, drawing['rect'].height) >= 4.8]
            # Study A uses a broad top and left rail, not four corner caps.
            self.assertGreaterEqual(len(caps), 2, key)
            edge_color = teal
            outlines = [drawing for drawing in page.get_drawings()
                        if drawing['width'] is not None
                        and abs(drawing['width'] - .4981) < .02
                        and drawing['color'] is not None
                        and len(drawing['color']) == 3
                        and max(abs(a-b) for a, b in zip(drawing['color'], edge_color)) < .004]
            self.assertTrue(outlines, key)
            # Tectonic emits the TikZ rectangle as four connected line segments,
            # not necessarily a PDF `re` operator. Require the closed perimeter.
            for drawing in outlines:
                items = drawing['items']
                if len(items) == 1 and items[0][0] == 're':
                    continue
                self.assertEqual([item[0] for item in items], ['l'] * 4, key)
                self.assertEqual(items[0][1], items[-1][2], key)
                for first, second in zip(items, items[1:]):
                    self.assertEqual(first[2], second[1], key)

    def test_gossip_postcondition_does_not_become_a_two_line_page_tail(self):
        start = self.names['heprotocol.6.8.1']['page']
        matches = []
        # A protocol may break; the logical postcondition must not. A complete
        # continuation paragraph is different from a severed two-line tail.
        for index in (start, start + 1):
            try:
                whole_gossip_postcondition(self.document[index].get_text())
            except AssertionError:
                continue
            matches.append(index)
        self.assertEqual(len(matches), 1, 'conditional result split across pages')

    def test_downstream_judge_remedy_heading_is_not_split_across_pages(self):
        self.assertTrue(whole_judge_remedy_heading(
            page.get_text() for page in self.document), 'Fix B label severed from its explanation')

    def test_long_protocol_title_does_not_stretch_interword_spaces(self):
        page = self.document[self.names['stpprotocol.5.10.2']['page']]
        lines = [line for block in page.get_text('rawdict')['blocks']
                 for line in block.get('lines', [])]
        text = lambda line: ''.join(char['c'] for span in line['spans'] for char in span['chars'])
        heads = [line for line in lines if 'Protocol5.10.2(' in compact(text(line))]
        self.assertEqual(len(heads), 1)
        top = heads[0]['bbox'][1]
        title_chars = [char for line in lines if top - 1 <= line['bbox'][1] <= top + 20
                       for span in line['spans'] if 'Semibold' in span['font']
                       for char in span['chars']]
        self.assertIn('schema).', ''.join(char['c'] for char in title_chars))
        spaces = [char['bbox'][2] - char['bbox'][0] for char in title_chars if char['c'] == ' ']
        self.assertTrue(spaces)
        self.assertLess(max(spaces), 5, 'justified title has stretched word spacing')


if __name__ == '__main__':
    unittest.main()
