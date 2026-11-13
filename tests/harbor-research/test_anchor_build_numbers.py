"""Chapter 2's first build section states facts from its recorded runs. Check each one.

The section's listings are the recorded files, so they cannot go out of
date. Its prose can. A sentence that says "in 11 of them" was typed from a
table the kernel printed, and a later recording may print a different
number. Each test here reads a fact from a recorded run and checks that the
text states it. TeX computes the figure's four counts from the table it
draws, so the test for the figure compares its axes with the table.
"""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
EXCERPTS = ROOT / 'book' / 'excerpts'
SECTION = ROOT / 'book' / 'additions' / 'anchor-build-the-verifier.tex'
CHAPTER = ROOT / 'book' / 'anchor-protocol-whitepaper.tex'
FIGURE = ROOT / 'book' / 'figures' / 'fig-anchor-64-chains.tex'


def prose(path):
    """The file's text with comments dropped and white space collapsed."""
    lines = [re.split(r'(?<!\\)%', line, maxsplit=1)[0] for line in path.read_text().splitlines()]
    return re.sub(r'\s+', ' ', ' '.join(lines))


def run(name):
    """A recorded run, as lines."""
    return (EXCERPTS / f'{name}.txt').read_text().splitlines()


def unwrapped(name):
    """A recorded scenario with each wrapped line joined to the line it continues."""
    joined = []
    for line in run(name):
        if line.startswith(' ' * 9) and joined:
            joined[-1] += ' ' + line.strip()
        else:
            joined.append(line)
    return joined


def requests(name):
    """Who made each request in a recorded scenario, and the gate's answer."""
    found = []
    for line in unwrapped(name):
        match = re.match(r'^t=\d+\s+(\w+)\s+requests to .*? -> (admitted|refused: [a-z-]+)', line)
        if match:
            found.append((match[1], match[2]))
    return found


def chains(name):
    """A recorded `harbor chains` table: kind -> (chains, naive, core)."""
    found = {}
    for line in run(name):
        match = re.match(r'^(\S.*?\S)\s+(\d+)\s+(\d+)\s+(\d+)$', line)
        if match:
            found[match[1]] = (int(match[2]), int(match[3]), int(match[4]))
    return found


class QuotedFacts(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.text = prose(SECTION)

    def quoted(self, sentence):
        self.assertIn(sentence, self.text)

    def partial(self, name, lines):
        """The section prints these lines of a run, and the run has them."""
        self.assertIn('{%s}{%s}' % (name, lines), self.text.replace(' ', ''))
        last = max(int(part.split('-')[-1]) for part in lines.split(','))
        self.assertLessEqual(last, len(run(name)), f'{name}.txt is shorter than the lines printed')

    def test_the_decoded_cards(self):
        cards = run('cards')
        self.assertIn('  exp     600000', cards)
        self.quoted('so 600000 is ten minutes')
        self.assertEqual(600000, 10 * 60 * 1000)
        self.assertIn('  jti     card-1', cards)
        self.assertIn('  par     card-1', cards)
        third = cards[cards.index('card 3: heron signs it for finch'):]
        self.assertIn('  par     the id of card 2', third)
        self.assertIn('  id      the SHA-256 of its signature:', third)
        self.quoted("For card 3 that identifier is the SHA-256 of card 2's signature")
        self.quoted('Listing~\\ref{alg:anchor-build-cards} decodes a chain of three.')
        self.assertEqual(sum(line.startswith('card ') for line in cards), 3)

    def test_delegation(self):
        lines = unwrapped('delegation-naive')
        self.assertTrue(any('requested until t=1200000, signed until t=600000' in line for line in lines))
        self.quoted('She requested twenty minutes for Heron, and the card she signed is valid for ten')
        self.assertTrue(any('heron delegates to finch' in re.sub(r'\s+', ' ', line) and 'valid until t=300000' in line for line in lines))
        self.quoted('Heron delegated to Finch for five minutes.')
        # Finch's card is the first to be refused as expired, and Alice's own goes with Heron's.
        expired = [(line.split()[0], line.split()[1]) for line in lines if 'refused: expired' in line]
        self.assertEqual(expired, [('t=300001', 'finch'), ('t=600001', 'heron'), ('t=600001', 'alice')])
        self.quoted("Finch's card expired first. Heron's expired five minutes later, and Alice's own card with it.")
        self.assertEqual(600001 - 300001, 5 * 60 * 1000)
        self.assertEqual(lines[-1], 'verdict: every request got the answer its cards require')
        # The fixed verifier answers each request the same way, and names the card.
        self.assertEqual(requests('delegation'), requests('delegation-naive'))
        fixed = ' '.join(unwrapped('delegation'))
        self.assertIn('-> refused: expired (card 3 expired at t=300000)', fixed)
        self.quoted('each refusal now names the card that caused it')
        self.partial('delegation', '1,18-23,26-27')
        # The printed lines include a refusal for each of two cards, and the verdict.
        printed = ' '.join(run('delegation')[17:23])
        self.assertIn('(card 3 expired at t=300000)', printed)
        self.assertIn('(card 1 expired at t=600000)', printed)
        self.assertTrue(run('delegation')[26].startswith('verdict: '))
        self.assertEqual(len(run('delegation')), 27)

    def test_the_three_breaks(self):
        self.assertEqual(requests('confusion-naive'), [
            ('alice', 'admitted'),
            ('wren', 'refused: bad-signature'),
            ('wren', 'admitted'),
            ('wren', 'refused: bad-signature'),
        ])
        self.quoted('It admitted the middle one.')
        self.assertTrue(unwrapped('confusion-naive')[-1].startswith('verdict: FORGERY'))
        self.assertEqual(requests('escalation-naive'), [('heron', 'admitted'), ('heron', 'refused: not-granted'), ('finch', 'admitted')])
        self.quoted("the verifier correctly refused Heron's own request to write it")
        self.assertTrue(unwrapped('escalation-naive')[-1].startswith('verdict: ESCALATION'))
        self.assertEqual(requests('moved-naive'), [('heron', 'refused: widens'), ('heron', 'admitted')])
        moved = ' '.join(unwrapped('moved-naive'))
        self.assertIn('issues alice a second card: read shop/checkout.ts;', moved)
        self.quoted('The second grants \\texttt{read shop/checkout.ts} and nothing more.')
        self.assertIn('delegates to heron from her second card: write shop/checkout.ts;', moved)
        self.assertTrue(unwrapped('moved-naive')[-1].startswith('verdict: MOVED'))

    def test_the_breaks_against_the_fix(self):
        self.assertEqual(requests('confusion-core')[1:], [('wren', 'refused: bad-signature')] * 3)
        self.quoted('All of her cards are refused, and for one reason.')
        self.partial('confusion-core', '1,11-28')
        self.assertIn('-> refused: widens (card 3 grants write shop/checkout.ts, and card 2 does not)', ' '.join(unwrapped('escalation-core')))
        self.partial('escalation-core', '1,14-21')
        self.assertEqual(requests('moved-core'), [('heron', 'refused: widens'), ('heron', 'refused: unbound')])
        self.partial('moved-core', '1,11-21')

    def test_the_count_of_every_chain(self):
        counted = chains('chains')
        within, last, middle = (
            counted['each card within its parent'],
            counted['the last card has a right the middle one lacks'],
            counted['the middle card has a right the first lacks'],
        )
        self.assertEqual(within[0] + last[0] + middle[0], 64)
        self.quoted('make 64 chains')
        self.assertEqual(within, (16, 16, 16))
        self.quoted('In 16 chains no card grants more than its parent, and both verifiers accept those.')
        self.assertEqual((last[1], middle[1]), (11, 9))
        self.assertEqual((last[2], middle[2]), (0, 0))
        self.quoted('The naive verifier accepts 20 more. In 11 of them')
        self.quoted('In the other 9 the middle card has a right the first lacks')
        self.assertEqual(within[1] + last[1] + middle[1], 6 * 6)
        self.quoted('$4\\times4=16$')
        self.quoted('$6\\times6=36$')
        self.quoted('$36-25=11$')

    def test_the_guard_changed(self):
        changed = chains('chains-compare-root')
        self.assertEqual(changed['the last card has a right the middle one lacks'], (28, 11, 9))
        self.assertEqual(changed['the middle card has a right the first lacks'][2], 0)
        self.quoted('Nine escalations are admitted, and not eleven.')
        self.quoted('so it catches two chains that the naive verifier missed')
        self.partial('chains-compare-root', '1,5-8')
        self.assertEqual(len(run('chains-compare-root')), 10)
        self.assertEqual(requests('escalation-compare-root')[-1], ('finch', 'admitted'))
        self.quoted('Finch is admitted again')
        self.partial('escalation-compare-root', '1,16-20')
        self.assertEqual(len(run('escalation-compare-root')), 20)

    def test_the_models(self):
        printed = run('models-cards')
        self.assertEqual(printed[0], '$ sh formal/cards/run.sh')
        at = printed.index
        per_hop = printed[at('chain-per-hop.pv') + 1:at('chain-root-only.pv')]
        root_only = printed[at('chain-root-only.pv') + 1:at('header-chooses-the-algorithm.pv')]
        header = printed[at('header-chooses-the-algorithm.pv') + 1:]
        self.assertEqual([line.rsplit(' is ', 1)[1] for line in per_hop], ['true.', 'true.', 'false.'])
        self.assertEqual([line.rsplit(' is ', 1)[1] for line in root_only], ['true.', 'false.', 'false.'])
        self.assertIn('RESULT not event(Admitted(three,k,both)) is false.', root_only)
        self.quoted('\\texttt{chain-root-only.pv} admits someone to \\texttt{both}')
        self.assertIn('RESULT not event(Admitted(three,k,both)) is true.', per_hop)
        self.quoted('\\texttt{chain-per-hop.pv} admits no one that way')
        self.assertEqual(header, [
            'RESULT event(AdmittedPinned(m_3)) ==> event(Issued(m_3)) is true.',
            'RESULT event(AdmittedNaive(m_3)) ==> event(Issued(m_3)) is false.',
        ])
        self.quoted('The third query of each chain model is meant to be \\texttt{false}')

    def test_the_figure_draws_the_table_as_the_run_orders_it(self):
        table = run('chains-each')
        rows = [line.split() for line in table[1:] if not line.startswith('#')]
        columns, rows = rows[0], rows[1:]
        self.assertEqual(columns, ['read', 'write', 'r', 'w', 'kind', 'naive', 'core'])
        self.assertEqual(len(rows), 64)
        # The run gives the index on an axis of each placement of a right on the three cards.
        remarks = ' '.join(line[2:].strip() for line in table if line.startswith('#'))
        order = re.search(r'in the order ((?:[x.]{3} ?){8})', remarks)[1].split()
        for read, write, r, w, *_ in rows:
            self.assertEqual((order[int(r)], order[int(w)]), (read, write))
        # The figure draws the same eight, in the same order, as dots.
        figure = prose(FIGURE)
        dots = re.search(r'in\{((?:\{[01],[01],[01]\},?){8})\}', figure.replace(' ', ''))[1]
        drawn = [''.join('x' if bit == '1' else '.' for bit in group.split(',')) for group in re.findall(r'\{([01,]+)\}', dots)]
        self.assertEqual(drawn, order)
        # Each gate's square: the first four ways, and the first six.
        for _read, _write, r, w, kind, naive, core in rows:
            widest = max(int(r), int(w))
            self.assertEqual(core == '1', widest < 4)
            self.assertEqual(naive == '1', widest < 6)
        self.assertIn('(-.5,.5) rectangle (3.5,-3.5)', figure)
        self.assertIn('rectangle (5.56,-5.56)', figure)
        # The counts the figure prints are the table's.
        both = sum(row[6] == '1' for row in rows)
        grown = sum(row[5] == '1' and row[6] == '0' and row[4] == '1' for row in rows)
        idle = sum(row[5] == '1' and row[6] == '0' and row[4] != '1' for row in rows)
        neither = sum(row[5] == '0' for row in rows)
        self.assertEqual((both, idle, grown, neither), (16, 9, 11, 28))

    def test_the_exercises_use_the_same_counts(self):
        chapter = prose(CHAPTER)
        for sum_ in ('$4\\times4=16$', '$6\\times6=36$', '$5\\times5=25$', '$36-25=11$', '$25-16=9$'):
            self.assertIn(sum_, chapter)
        self.assertIn('admits 9 of the 11 escalations', chapter)
        self.assertEqual((6 * 6 - 5 * 5, 5 * 5 - 4 * 4), (11, 9))


if __name__ == '__main__':
    unittest.main()
