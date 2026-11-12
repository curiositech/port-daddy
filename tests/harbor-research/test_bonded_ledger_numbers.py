"""Chapter 7's build section quotes facts from its recorded runs. Hold each to its run.

The section's listings cannot drift: they are the recorded files. Its prose
can, and so can its exercises. A sentence that says "386 bonds" was written
by hand from a table the kernel printed, and a later recording may print
another table. Each test here reads a fact out of a recorded run, or works
it out again, and requires the sentence that quotes it.
"""
import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
EXCERPTS = ROOT / 'book' / 'excerpts'
SECTION = ROOT / 'book' / 'additions' / 'bonded-build-the-ledger.tex'
FIGURE = ROOT / 'book' / 'figures' / 'fig-bonded-moves.tex'
CHAPTER = ROOT / 'book' / 'agent-transactions-whitepaper.tex'
RUNS = ['exact-change-dollars', 'posts-trusting', 'exact-change-core', 'settlement-core', 'posts',
        'states', 'kani-bonds', 'posts-overdraw', 'paid-twice-core', 'paid-twice-settle-twice',
        'states-each', 'states-each-overdraw']
SNIPPETS = ['ch07-dollars', 'ch07-bidder', 'ch07-funds', 'ch07-post', 'ch07-covered', 'ch07-settle',
            'ch07-held', 'ch07-accounts', 'ch07-kani-step']


def prose(path):
    """The file's text with comments dropped and white space collapsed."""
    lines = [re.split(r'(?<!\\)%', line, maxsplit=1)[0] for line in path.read_text().splitlines()]
    return re.sub(r'\s+', ' ', ' '.join(lines))


def run(name):
    """A recorded run, as lines."""
    return (EXCERPTS / f'{name}.txt').read_text().splitlines()


def said(name):
    """A recorded scenario with each wrapped line joined to the line it continues."""
    joined = []
    for line in run(name):
        if line.startswith(' ' * 9) and joined:
            joined[-1] += ' ' + line.strip()
        else:
            joined.append(line)
    return joined


def step(name, number):
    """One step of a recorded scenario."""
    return next(line for line in said(name) if line.startswith(f'step {number} '))


def funds(line):
    """The three buckets a transcript line ends with."""
    found = re.search(r'wallet (\S+), escrow (\S+), pool (\S+)$', line)
    return tuple(float(part.rstrip(',')) for part in found.groups())


def states():
    """The table of `harbor states`: for each keeper, its six counts."""
    rows = {}
    for line in run('states'):
        cells = line.split()
        if cells and cells[0] in ('dollars', 'trusting', 'core'):
            rows[cells[0]] = [int(cell) for cell in cells[1:]]
    return rows


def moves(name):
    """A recorded table of moves: e0, p0, e1, p1, kind, times, wrong."""
    rows = [line.split() for line in run(name) if line and line[0] != '#' and line[0] != '$']
    assert rows[0] == ['e0', 'p0', 'e1', 'p1', 'kind', 'times', 'wrong'], rows[0]
    return [tuple(int(cell) for cell in row) for row in rows[1:]]


def spelt(count):
    """A count as the Book sets it, with a comma for thousands."""
    return f'{count:,}'


class QuotedFacts(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.text = prose(SECTION)
        cls.chapter = prose(CHAPTER)

    def quoted(self, sentence, where=None):
        self.assertIn(sentence, self.text if where is None else where)

    def test_every_run_and_snippet_is_set_and_given_its_room(self):
        source = SECTION.read_text()
        for name in RUNS[:10]:
            self.assertRegex(source, r'\\pdrun(lines)?\[[^\]]*\]\{%s\}' % re.escape(name), name)
        for name in SNIPPETS:
            self.assertIn('{%s}' % name, source)
        # A listing set whole asks for as many lines as its file has.
        whole = re.findall(r'\\pdlistingroom\{(\d+)\}\n\\pd(run|excerpt)\[[^\]]*\]\{([\w-]+)\}', source, flags=re.S)
        self.assertEqual(len(whole), len(SNIPPETS) + 8)
        for room, kind, name in whole:
            path = EXCERPTS / (f'{name}.txt' if kind == 'run' else f'{name}.code')
            self.assertEqual(int(room), len(path.read_text().splitlines()), name)
        # The Kani recording is set in two parts, and each asks for the lines it prints.
        parts = re.findall(r'\\pdlistingroom\{(\d+)\}\n\\pdrunlines\[[^\]]*\]\{kani-bonds\}\{([\d,-]+)\}', source, flags=re.S)
        self.assertEqual([(int(room), lines) for room, lines in parts], [(9, '1-9'), (15, '1,10-23')])
        self.assertEqual(len(run('kani-bonds')), 23)
        table = re.findall(r'\\pdlistingroom\{(\d+)\}\n\\pdrunlines\[[^\]]*\]\{posts-overdraw\}\{([\d,-]+)\}', source, flags=re.S)
        self.assertEqual(table, [('5', '1,6-9')])
        self.assertEqual(len(run('posts-overdraw')), 9)
        manifest = json.loads((EXCERPTS / 'manifest.json').read_text())
        recorded = {session['name'] for session in manifest['sessions']}
        self.assertLessEqual(set(RUNS), recorded)

    def test_the_break_in_dollars(self):
        second, third = step('exact-change-dollars', 2), step('exact-change-dollars', 3)
        self.assertEqual(funds(second), (0.19999999999999998, 0.1, 0.0))
        self.assertIn('refused: short', third)
        self.quoted('After the first bond the wallet holds 0.19999999999999998 dollars. That is less than 0.2, and the second bond is refused.')
        # The arithmetic the section and its exercise describe, done again.
        left = 0.3 - 0.1
        self.assertEqual(left, 0.19999999999999998)
        self.assertLess(0.2 - left, 3e-17)
        self.quoted('the difference is under $3\\times10^{-17}$ of a dollar')
        self.assertTrue(1 - 0.9 < 0.1 and 1 - 0.1 >= 0.9)
        self.quoted('So the same two bonds from the same dollar are refused in one order and posted in the other.', self.chapter)

    def test_how_many_splits_of_a_wallet_are_refused(self):
        pairs = [(wallet, first) for wallet in range(2, 101) for first in range(1, wallet)]
        refused = [(wallet, first) for wallet, first in pairs if wallet / 100 - first / 100 < (wallet - first) / 100]
        self.assertEqual((len(pairs), len(refused)), (4950, 1380))
        self.quoted('There are 4,950 such pairs, order counted, and the keeper in dollars refuses the second bond in 1,380 of them.', self.chapter)

    def test_two_workers_and_one_wallet(self):
        orders = [line for line in run('posts-trusting') if ' -> wallet ' in line]
        overdrawn = [line for line in orders if line.endswith('OVERDRAWN')]
        self.assertEqual((len(orders), len(overdrawn)), (6, 4))
        self.assertTrue(all('wallet -2, escrow 12' in line for line in overdrawn))
        self.quoted('Four orders of six post both bonds, and the wallet ends 2 units below zero.')
        self.assertIn('each posts a bond of 6 from a wallet of 10', re.sub(r'\s+', ' ', ' '.join(run('posts-trusting')[:3])))
        self.quoted('Heron and Wren each want a bond of 6 from a wallet of 10.')
        # Both bonds are posted exactly when both workers look before either asks.
        for line in orders:
            first, second = line.split()[:2]
            self.assertEqual(line.endswith('OVERDRAWN'), first != second, line)
        keepers = (['dollars'], ['trusting'], ['core'])
        table = {line.split()[0]: line.split()[1:] for line in run('posts') if line.split()[:1] in keepers}
        self.assertEqual(table, {'dollars': ['6', '0'], 'trusting': ['6', '4'], 'core': ['6', '0']})
        # With the check of the wallet removed, the kernel's row is the trusting keeper's.
        loose = {line.split()[0]: line.split()[1:] for line in run('posts-overdraw') if line.split()[:1] in keepers}
        self.assertEqual(loose['core'], loose['trusting'])
        self.assertEqual(loose['core'], ['6', '4'])
        self.quoted("The kernel's row now reads as the row above it does.")

    def test_the_fix_and_the_worked_settlement(self):
        self.assertEqual(funds(step('exact-change-core', 3)), (0, 30, 0))
        self.assertEqual(funds(step('settlement-core', 2)), (4, 6, 0))
        self.assertEqual(funds(step('settlement-core', 3)), (8, 0, 2))
        self.quoted('Step 2 leaves the project at $(4,6,0)$ and step 3 at $(8,0,2)$, as the example has them.')
        # The example the section points to has the same numbers.
        self.quoted('(W_Q, E_Q, C_Q) = (4, 6, 0)', self.chapter)
        self.quoted('(W_Q, E_Q, C_Q)=(8,0,2)', self.chapter)

    def test_every_state(self):
        table = states()
        core, trusting, dollars = table['core'], table['trusting'], table['dollars']
        self.assertEqual(core[2:], [0, 0, 0, 0])
        self.quoted(f'The kernel\'s keeper reaches {spelt(core[0])} states.')
        self.quoted(f'over the {spelt(core[1])} moves that the rules allow')
        self.assertEqual(trusting[0], core[0])
        self.quoted(f'reaches the same states, and takes {trusting[3]} bonds that its wallet cannot cover')
        self.assertGreater(dollars[0], core[0])
        self.quoted(f'It refuses {dollars[2]} bonds that its wallet covers.')
        self.quoted(f'In {spelt(dollars[4])} of its {spelt(dollars[0])} states a bucket holds a fraction of a cent, and in {spelt(dollars[5])} the buckets do not add up to the top-ups.')
        widest = next(line for line in run('states') if line.startswith('the widest such difference'))
        self.assertTrue(widest.endswith('for dollars, 2.8e-17 of a dollar'), widest)
        self.quoted('The widest of those differences is $2.8\\times10^{-17}$ of a dollar.')
        header = re.sub(r'\s+', ' ', ' '.join(run('states')[:3]))
        self.assertIn('top-ups and bonds of 1 to 3 units, at most 6 units topped up and 3 bonds posted', header)
        self.quoted('with amounts of 1 to 3 and at most 6 units minted')
        self.quoted('at most 3 bonds posted, where the model has 3 agents')
        # The exercise that asks why there are so many states quotes the same count.
        self.quoted(f'reaches {spelt(core[0])} states with at most 6 units', self.chapter)

    def test_the_figure_draws_the_recorded_moves(self):
        source = FIGURE.read_text()
        self.assertIn('{excerpts/states-each.txt}', source)
        self.assertIn('{excerpts/states-each-overdraw.txt}', source)
        real, loose = moves('states-each'), moves('states-each-overdraw')
        # No move of the real core is wrong, lowers the pool or leaves the triangle.
        self.assertEqual(len(real), 211)
        for e0, p0, e1, p1, kind, times, wrong in real:
            self.assertEqual(wrong, 0)
            self.assertGreaterEqual(p1, p0)
            self.assertTrue(0 <= e1 and 0 <= p1 and e1 + p1 <= 6)
            # A post or a refund moves along a row. Only a slash moves up one.
            self.assertTrue(p1 == p0 or kind == 2)
        # With the guard removed there are 22 more, each to a place with more than 6 units.
        strays = [row for row in loose if row[6] == 1]
        self.assertEqual(len(strays), 22)
        self.assertEqual(sorted(row for row in loose if row[6] == 0), sorted(real))
        for e0, p0, e1, p1, kind, times, wrong in strays:
            self.assertEqual((kind, p1), (0, p0))
            self.assertGreater(e1 + p1, 6)
        # The triangle of a project with 6 units has 28 places, as the exercise says.
        places = {(e, p) for p in range(7) for e in range(7 - p)}
        self.assertEqual(len(places), 28)
        self.assertEqual(sum((s + 1) * (s + 2) // 2 for s in range(7)), 84)
        self.quoted('Figure~\\ref{fig:bonded-moves} has 28 places.', self.chapter)
        self.quoted('$1+3+6+10+15+21+28=84$ places', self.chapter)
        self.quoted('from the states with all 6 units topped up')

    def test_the_kani_recording(self):
        lines = run('kani-bonds')
        self.assertEqual(lines[0], '$ sh formal/bonds/run.sh')
        verdicts = dict(zip(lines[1:9:2], (line.strip() for line in lines[2:9:2])))
        self.assertEqual(verdicts, {
            'a_bond_is_settled_once': 'successful; its cover is satisfied',
            'a_post_that_does_not_look_is_caught': 'fails, as it must',
            'every_move_keeps_every_unit': 'successful; its 2 covers are satisfied',
            'two_bonds_cannot_overdraw_a_wallet': 'successful; its cover is satisfied',
        })
        # The control is the second verdict, as the section says.
        self.assertEqual(lines[3], 'a_post_that_does_not_look_is_caught')
        self.quoted('The second verdict is a control.')
        self.assertEqual(lines[9], 'with one guard removed, the harnesses that fail')
        failing, guard = {}, None
        for line in lines[10:]:
            if line.startswith('  '):
                failing[guard].append(line.strip())
            else:
                guard = line
                failing[guard] = []
        self.assertEqual(len(failing), 5)
        self.quoted('The core has five guards on funds')
        self.assertTrue(all(failing.values()))
        self.quoted('Every build fails some harness, so no guard is there for nothing.')
        # One build keeps every unit and still fails: the step is not among its failures.
        self.assertEqual(failing['settle-twice'], ['a_bond_is_settled_once'])
        others = [guard for guard, harnesses in failing.items() if 'every_move_keeps_every_unit' not in harnesses]
        self.assertEqual(others, ['settle-twice'])
        self.quoted('Under \\texttt{settle-twice}, the build that will settle a bond again, the step of the induction is not among the failures.')

    def test_a_bond_asked_for_twice_is_refused_the_second_time(self):
        fifth, sixth = step('paid-twice-core', 5), step('paid-twice-core', 6)
        self.assertIn('refused: already-settled', fifth)
        self.assertEqual(funds(sixth), (10, 0, 0))
        posts = [step('paid-twice-core', 2), step('paid-twice-core', 3)]
        self.assertTrue('wren post 3' in re.sub(r'\s+', ' ', posts[0]) and 'heron post 6' in re.sub(r'\s+', ' ', posts[1]))
        self.quoted('Wren posts a bond of 3 and Heron one of 6, and Wren asks for hers back twice.')

    def test_a_bond_paid_twice_with_every_unit_kept(self):
        fifth, sixth = step('paid-twice-settle-twice', 5), step('paid-twice-settle-twice', 6)
        self.assertEqual(funds(fifth), (7, 3, 0))
        self.assertIn('refused: unbacked (escrow holds 3, and the bond is said to hold 6)', sixth)
        self.assertEqual(sum(funds(fifth)), 10)
        self.quoted('The buckets still add up to 10, and then Heron\'s refund is refused, because escrow is 3 units short of his bond.')
        self.quoted('Every unit is kept, and the wrong party has 3 of them.')
        self.quoted('After step 5 the wallet holds 7, escrow holds 3 and the pool holds nothing.', self.chapter)

    def test_the_ceiling_is_the_largest_count_a_double_holds_exactly(self):
        funds_code = (EXCERPTS / 'ch07-funds.code').read_text()
        self.assertIn('filter(|all| *all <= CEILING)', funds_code)
        self.assertEqual(float(2 ** 53 - 1) + 1, float(2 ** 53))
        self.assertEqual(float(2 ** 53) + 1, float(2 ** 53))
        self.quoted('which is $2^{53}-1$')

    def test_the_section_is_in_the_chapter_and_pointed_at(self):
        source = CHAPTER.read_text()
        self.assertIn('\\input{additions/bonded-build-the-ledger}', source)
        self.assertIn('\\S\\ref{sec:bonded-build} builds a ledger that counts this way', self.chapter)
        self.assertIn('\\pdexercisesfor{\\S\\ref{sec:bonded-build}}', source)
        for label in ['ex:bonded-build-triangle', 'ex:bonded-build-cents', 'ex:bonded-build-twice', 'ex:bonded-build-split']:
            self.assertIn('\\begin{pdexercise}', source)
            self.assertIn('{%s}' % label, source)
            self.assertIn('\\begin{pdsolution}{%s}' % label, source)


if __name__ == '__main__':
    unittest.main()
