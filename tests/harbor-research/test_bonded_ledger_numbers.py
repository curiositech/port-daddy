"""Chapter 7's first build section states numbers from its recorded runs. Check each one.

The section's listings are the recorded files, so they cannot go out of
date. Its prose can, and so can its exercises. A sentence that says "386
bonds" was typed from a table the kernel printed, and a later recording may
print a different table. Each test here reads a number from a recorded run,
or computes it again, and checks that the text states it.
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
RUNS = ['thirty-cents-float', 'posts-unchecked', 'thirty-cents-core', 'settlement-core', 'posts',
        'states', 'kani-bonds', 'posts-overdraw', 'refund-twice-core', 'refund-twice-settle-twice',
        'states-each', 'states-each-overdraw']
SNIPPETS = ['ch07-float', 'ch07-check-then-post', 'ch07-funds', 'ch07-post', 'ch07-covered', 'ch07-settle',
            'ch07-held', 'ch07-core-ledger', 'ch07-kani-step']
DESIGNS = ('float', 'unchecked', 'core')


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


def step(name, number):
    """One step of a recorded scenario."""
    return next(line for line in unwrapped(name) if line.startswith(f'step {number} '))


def funds(line):
    """The three buckets at the end of a transcript line."""
    found = re.search(r'wallet (\S+), escrow (\S+), pool (\S+)$', line)
    return tuple(float(part.rstrip(',')) for part in found.groups())


def states():
    """The table of `harbor states`: for each design, its six counts."""
    rows = {}
    for line in run('states'):
        cells = line.split()
        if cells and cells[0] in DESIGNS:
            rows[cells[0]] = [int(cell) for cell in cells[1:]]
    return rows


def operations(name):
    """A recorded table of operations: e0, p0, e1, p1, kind, times, wrong."""
    rows = [line.split() for line in run(name) if line and line[0] != '#' and line[0] != '$']
    assert rows[0] == ['e0', 'p0', 'e1', 'p1', 'kind', 'times', 'wrong'], rows[0]
    return [tuple(int(cell) for cell in row) for row in rows[1:]]


def spelt(count):
    """A count as the Book prints it, with a comma for thousands."""
    return f'{count:,}'


class QuotedFacts(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.text = prose(SECTION)
        cls.chapter = prose(CHAPTER)

    def quoted(self, sentence, where=None):
        self.assertIn(sentence, self.text if where is None else where)

    def test_every_run_and_snippet_is_printed_with_room_for_its_lines(self):
        source = SECTION.read_text()
        for name in RUNS[:10]:
            self.assertRegex(source, r'\\pdrun(lines)?\[[^\]]*\]\{%s\}' % re.escape(name), name)
        for name in SNIPPETS:
            self.assertIn('{%s}' % name, source)
        # A listing printed in full reserves as many lines as its file has.
        whole = re.findall(r'\\pdlistingroom\{(\d+)\}\n\\pd(run|excerpt)\[[^\]]*\]\{([\w-]+)\}', source, flags=re.S)
        self.assertEqual(len(whole), len(SNIPPETS) + 8)
        for room, kind, name in whole:
            path = EXCERPTS / (f'{name}.txt' if kind == 'run' else f'{name}.code')
            self.assertEqual(int(room), len(path.read_text().splitlines()), name)
        # The Kani recording is printed in two parts, and each reserves the lines it prints.
        parts = re.findall(r'\\pdlistingroom\{(\d+)\}\n\\pdrunlines\[[^\]]*\]\{kani-bonds\}\{([\d,-]+)\}', source, flags=re.S)
        self.assertEqual([(int(room), lines) for room, lines in parts], [(9, '1-9'), (15, '1,10-23')])
        self.assertEqual(len(run('kani-bonds')), 23)
        table = re.findall(r'\\pdlistingroom\{(\d+)\}\n\\pdrunlines\[[^\]]*\]\{posts-overdraw\}\{([\d,-]+)\}', source, flags=re.S)
        self.assertEqual(table, [('5', '1,6-9')])
        self.assertEqual(len(run('posts-overdraw')), 9)
        manifest = json.loads((EXCERPTS / 'manifest.json').read_text())
        recorded = {session['name'] for session in manifest['sessions']}
        self.assertLessEqual(set(RUNS), recorded)
        # Every snippet this build has is in this section.
        cut = {excerpt['name'] for excerpt in manifest['excerpts'] if excerpt['name'].startswith('ch07-')}
        self.assertEqual(cut, set(SNIPPETS))

    def test_the_break_in_floating_point(self):
        second, third = step('thirty-cents-float', 2), step('thirty-cents-float', 3)
        self.assertEqual(funds(second), (0.19999999999999998, 0.1, 0.0))
        self.assertIn('refused: short', third)
        self.quoted('After the first bond the wallet holds 0.19999999999999998 dollars. That is less than 0.2, and the second bond is refused.')
        # The arithmetic the section and its exercise describe, computed again.
        result = 0.3 - 0.1
        self.assertEqual(result, 0.19999999999999998)
        self.assertLess(0.2 - result, 3e-17)
        self.quoted('the error is under $3\\times10^{-17}$ of a dollar')
        after_ninety, after_ten = 1 - 0.9, 1 - 0.1
        self.assertLess(after_ninety, 0.1)
        self.assertGreaterEqual(after_ten, 0.9)
        self.quoted('So the same two bonds from the same dollar are refused in one order and posted in the other.', self.chapter)

    def test_how_many_pairs_of_bonds_are_refused(self):
        pairs = [(wallet, first) for wallet in range(2, 101) for first in range(1, wallet)]
        refused = [(wallet, first) for wallet, first in pairs if wallet / 100 - first / 100 < (wallet - first) / 100]
        self.assertEqual((len(pairs), len(refused)), (4950, 1380))
        self.quoted('There are 4,950 such pairs, counting order, and the ledger in floating point refuses the second bond in 1,380 of them.', self.chapter)

    def test_two_workers_and_one_wallet(self):
        orders = [line for line in run('posts-unchecked') if ' -> wallet ' in line]
        overdrawn = [line for line in orders if line.endswith('OVERDRAWN')]
        self.assertEqual((len(orders), len(overdrawn)), (6, 4))
        self.assertTrue(all('wallet -2, escrow 12' in line for line in overdrawn))
        self.quoted('Four of the six orders post both bonds, and the wallet ends at $-2$.')
        self.assertIn('each posts a bond of 6 from a wallet of 10', re.sub(r'\s+', ' ', ' '.join(run('posts-unchecked')[:3])))
        self.quoted('Heron and Wren each want a bond of 6 from a wallet of 10.')
        # Both bonds are posted exactly when both workers check before either posts.
        for line in orders:
            first, second = line.split()[:2]
            self.assertEqual(line.endswith('OVERDRAWN'), first != second, line)
        designs = [[name] for name in DESIGNS]
        table = {line.split()[0]: line.split()[1:] for line in run('posts') if line.split()[:1] in designs}
        self.assertEqual(table, {'float': ['6', '0'], 'unchecked': ['6', '4'], 'core': ['6', '0']})
        # With the check of the wallet removed, the kernel's row equals the unchecked ledger's.
        mutant = {line.split()[0]: line.split()[1:] for line in run('posts-overdraw') if line.split()[:1] in designs}
        self.assertEqual(mutant['core'], mutant['unchecked'])
        self.assertEqual(mutant['core'], ['6', '4'])
        self.quoted("The kernel's row is now the same as the row above it.")

    def test_the_fix_and_the_worked_settlement(self):
        self.assertEqual(funds(step('thirty-cents-core', 3)), (0, 30, 0))
        self.assertEqual(funds(step('settlement-core', 2)), (4, 6, 0))
        self.assertEqual(funds(step('settlement-core', 3)), (8, 0, 2))
        self.quoted('Step 2 leaves the project at $(4,6,0)$ and step 3 at $(8,0,2)$, as in the example.')
        # The example the section points to has the same numbers.
        self.quoted('(W_Q, E_Q, C_Q) = (4, 6, 0)', self.chapter)
        self.quoted('(W_Q, E_Q, C_Q)=(8,0,2)', self.chapter)

    def test_every_state(self):
        table = states()
        core, unchecked, floating = table['core'], table['unchecked'], table['float']
        # states, operations, wrongly refused, wrongly accepted, wrong balance, not conserved
        self.assertEqual(core[2:], [0, 0, 0, 0])
        self.quoted(f"The kernel's ledger reaches {spelt(core[0])} states.")
        self.quoted(f'It accepts all {spelt(core[1])} operations that the model allows')
        self.assertEqual(unchecked[0], core[0])
        self.quoted(f'reaches the same states, and accepts {unchecked[3]} bonds that its wallet cannot cover')
        self.assertGreater(floating[0], core[0])
        self.quoted(f'It refuses {floating[2]} bonds that its wallet covers.')
        self.quoted(f"In {spelt(floating[4])} of its {spelt(floating[0])} states a bucket differs from the model's, and in {spelt(floating[5])} the buckets do not add up to the top-ups.")
        largest = next(line for line in run('states') if line.startswith('the largest such difference'))
        self.assertTrue(largest.endswith('for float, 2.8e-17 of a dollar'), largest)
        self.quoted('The largest of those differences is $2.8\\times10^{-17}$ of a dollar.')
        header = re.sub(r'\s+', ' ', ' '.join(run('states')[:3]))
        self.assertIn('top-ups and bonds of 1 to 3 units, with at most 6 units topped up and 3 bonds posted', header)
        self.quoted('with amounts of 1 to 3 and at most 6 units minted')
        self.quoted('at most 3 bonds posted, where the model has 3 agents')
        # The exercise that asks why there are so many states gives the same count.
        self.quoted(f'reaches {spelt(core[0])} states with at most 6 units', self.chapter)

    def test_the_figure_draws_the_recorded_operations(self):
        source = FIGURE.read_text()
        self.assertIn('{excerpts/states-each.txt}', source)
        self.assertIn('{excerpts/states-each-overdraw.txt}', source)
        core, mutant = operations('states-each'), operations('states-each-overdraw')
        # The model allows every operation of the core. None lowers the pool or leaves the triangle.
        self.assertEqual(len(core), 211)
        for e0, p0, e1, p1, kind, times, wrong in core:
            self.assertEqual(wrong, 0)
            self.assertGreaterEqual(p1, p0)
            self.assertTrue(0 <= e1 and 0 <= p1 and e1 + p1 <= 6)
            # A post or a refund stays in its row. Only a slash moves up.
            self.assertTrue(p1 == p0 or kind == 2)
        # With the guard removed there are 22 more, each to funds of more than 6 units.
        outside = [row for row in mutant if row[6] == 1]
        self.assertEqual(len(outside), 22)
        self.assertEqual(sorted(row for row in mutant if row[6] == 0), sorted(core))
        for e0, p0, e1, p1, kind, times, wrong in outside:
            self.assertEqual((kind, p1), (0, p0))
            self.assertGreater(e1 + p1, 6)
        # The triangle of a project with 6 units has 28 points, as the exercise says.
        points = {(e, p) for p in range(7) for e in range(7 - p)}
        self.assertEqual(len(points), 28)
        self.assertEqual(sum((s + 1) * (s + 2) // 2 for s in range(7)), 84)
        self.quoted('Figure~\\ref{fig:bonded-moves} has 28 points.', self.chapter)
        self.quoted('$1+3+6+10+15+21+28=84$ points', self.chapter)
        self.quoted('in the states with all 6 units topped up')

    def test_the_kani_recording(self):
        lines = run('kani-bonds')
        self.assertEqual(lines[0], '$ sh formal/bonds/run.sh')
        results = dict(zip(lines[1:9:2], (line.strip() for line in lines[2:9:2])))
        self.assertEqual(results, {
            'a_bond_is_settled_once': 'successful; its cover is satisfied',
            'control_an_unchecked_post_is_caught': 'fails, as a control should',
            'every_operation_conserves_units': 'successful; its 2 covers are satisfied',
            'two_bonds_cannot_overdraw_a_wallet': 'successful; its cover is satisfied',
        })
        # The control is the second result, as the section says.
        self.assertEqual(lines[3], 'control_an_unchecked_post_is_caught')
        self.quoted('The second result is a control.')
        self.quoted('the result for \\texttt{every\\_operation\\_conserves\\_units} gives')
        self.assertIn('fn every_operation_conserves_units()', (EXCERPTS / 'ch07-kani-step.code').read_text())
        self.assertEqual(lines[9], 'the harnesses that fail when one guard is removed')
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
        self.quoted('Every build fails at least one harness, so every guard is needed.')
        # One build conserves units and still fails: the step is not among its failures.
        self.assertEqual(failing['settle-twice'], ['a_bond_is_settled_once'])
        others = [guard for guard, harnesses in failing.items() if 'every_operation_conserves_units' not in harnesses]
        self.assertEqual(others, ['settle-twice'])
        self.quoted('Under \\texttt{settle-twice}, the build that settles a bond a second time, the step of the induction is not among the failures.')

    def test_a_second_refund_request_is_refused(self):
        fifth, sixth = step('refund-twice-core', 5), step('refund-twice-core', 6)
        self.assertIn('refused: already-settled', fifth)
        self.assertEqual(funds(sixth), (10, 0, 0))
        posts = [step('refund-twice-core', 2), step('refund-twice-core', 3)]
        self.assertTrue('wren post 3' in re.sub(r'\s+', ' ', posts[0]) and 'heron post 6' in re.sub(r'\s+', ' ', posts[1]))
        self.quoted('Wren posts a bond of 3 and Heron one of 6, and Wren requests a refund of hers twice.')

    def test_a_bond_refunded_twice_with_units_conserved(self):
        fifth, sixth = step('refund-twice-settle-twice', 5), step('refund-twice-settle-twice', 6)
        self.assertEqual(funds(fifth), (7, 3, 0))
        self.assertIn('refused: unbacked (escrow holds 3, and the bond is recorded as 6)', sixth)
        self.assertEqual(sum(funds(fifth)), 10)
        self.quoted("The buckets still add up to 10, and then Heron's refund is refused, because escrow is 3 units short of his bond.")
        self.quoted("No unit was created or lost, and 3 units that escrow should hold for Heron's bond are in the wallet.")
        self.quoted('After step 5 the funds are $(7,3,0)$.', self.chapter)

    def test_the_ceiling_is_the_largest_count_a_double_represents_exactly(self):
        funds_code = (EXCERPTS / 'ch07-funds.code').read_text()
        self.assertIn('filter(|all| *all <= CEILING)', funds_code)
        self.assertEqual(float(2 ** 53 - 1) + 1, float(2 ** 53))
        self.assertEqual(float(2 ** 53) + 1, float(2 ** 53))
        self.quoted('which is $2^{53}-1$')

    def test_the_section_is_in_the_chapter_and_the_chapter_refers_to_it(self):
        source = CHAPTER.read_text()
        self.assertIn('\\input{additions/bonded-build-the-ledger}', source)
        self.assertIn('\\S\\ref{sec:bonded-build} builds a ledger that counts this way', self.chapter)
        self.assertIn('\\pdexercisesfor{\\S\\ref{sec:bonded-build}}{Build the layer: a ledger that conserves units}', source)
        self.assertIn('\\subsection{Build the layer: a ledger that conserves units}', SECTION.read_text())
        for label in ['ex:bonded-build-triangle', 'ex:bonded-build-cents', 'ex:bonded-build-twice', 'ex:bonded-build-split']:
            self.assertIn('\\begin{pdexercise}', source)
            self.assertIn('{%s}' % label, source)
            self.assertIn('\\begin{pdsolution}{%s}' % label, source)


if __name__ == '__main__':
    unittest.main()
