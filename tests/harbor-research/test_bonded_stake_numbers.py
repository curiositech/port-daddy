"""Chapter 7's second build section states numbers from its recorded runs. Check each one.

The section's listings are the recorded files, so they cannot go out of
date. Its prose can, and so can its figure's caption and its exercises. A
sentence that says "25,272 operations" was typed from a table the kernel
printed, and a later recording may print a different table. Each test here
reads a number from a recorded run and checks that the text states it.
"""
import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
EXCERPTS = ROOT / 'book' / 'excerpts'
SECTION = ROOT / 'book' / 'additions' / 'bonded-build-the-stake.tex'
FIGURE = ROOT / 'book' / 'figures' / 'fig-bonded-pairs.tex'
CHAPTER = ROOT / 'book' / 'agent-transactions-whitepaper.tex'
WHOLE_RUNS = ['early-refund-separate', 'expired-claim-core', 'stakes', 'stakes-guards', 'kani-stakes']
PART_RUNS = {
    'late-write-separate': [(8, '1,10-16')],
    'late-write-core': [(6, '1,13-17')],
    'early-refund-core': [(15, '1,8-21')],
}
PLOTTED = ['stakes-each', 'stakes-each-separate']
SNIPPETS = ['ch07b-separate', 'ch07b-stake', 'ch07b-post-for-claim', 'ch07b-refund-on-release', 'ch07b-not-staked',
            'ch07b-bond-held', 'ch07b-kani-step']
GUARDS = ['any-stake', 'refund-staked', 'write-unstaked']
CLAIMS = ['live', 'expired', 'released', 'abandoned']
BONDS = ['none', 'held', 'refunded', 'slashed']


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


def verdict(name):
    return next(line for line in unwrapped(name) if line.startswith('verdict: '))


def funds(line):
    """The three buckets at the end of a transcript line."""
    found = re.search(r'wallet (\d+), escrow (\d+), pool (\d+)$', line)
    return tuple(int(part) for part in found.groups())


def table(name, rows):
    """A recorded table: for each named row, its counts."""
    found = {}
    for line in run(name):
        cells = line.split()
        if cells and cells[0] in rows:
            found[cells[0]] = [int(cell) for cell in cells[1:]]
    return found


def combinations(name):
    """A recorded table of combinations: a claim's status, its bond's status, states and writes."""
    rows = [line.split() for line in run(name) if line and line[0] != '#' and line[0] != '$']
    assert rows[0] == ['claim', 'bond', 'states', 'writes'], rows[0]
    return [tuple(int(cell) for cell in row) for row in rows[1:]]


def spelt(count):
    """A count as the Book prints it, with a comma for thousands."""
    return f'{count:,}'


class QuotedFacts(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.text = prose(SECTION)
        cls.chapter = prose(CHAPTER)
        cls.caption = prose(FIGURE)
        cls.states = table('stakes', ('separate', 'core'))
        cls.guards = table('stakes-guards', GUARDS)

    def quoted(self, sentence, where=None):
        self.assertIn(sentence, self.text if where is None else where)

    def test_every_run_and_snippet_is_printed_with_room_for_its_lines(self):
        source = SECTION.read_text()
        for name in SNIPPETS:
            self.assertIn('{%s}' % name, source)
        # A listing printed in full reserves as many lines as its file has.
        whole = re.findall(r'\\pdlistingroom\{(\d+)\}\n\\pd(run|excerpt)\[[^\]]*\]\{([\w-]+)\}', source, flags=re.S)
        self.assertEqual(sorted(name for _, _, name in whole), sorted(SNIPPETS + WHOLE_RUNS))
        for room, kind, name in whole:
            path = EXCERPTS / (f'{name}.txt' if kind == 'run' else f'{name}.code')
            self.assertEqual(int(room), len(path.read_text().splitlines()), name)
        # A listing printed in part reserves the lines it prints, and the file has those lines.
        for name, parts in PART_RUNS.items():
            found = re.findall(r'\\pdlistingroom\{(\d+)\}\n\\pdrunlines\[[^\]]*\]\{%s\}\{([\d,-]+)\}' % name, source, flags=re.S)
            self.assertEqual([(int(room), lines) for room, lines in found], parts, name)
            length = len(run(name))
            for room, lines in parts:
                spans = [[int(end) for end in span.split('-')] for span in lines.split(',')]
                self.assertEqual(sum(span[-1] - span[0] + 1 for span in spans), room, name)
                self.assertLessEqual(max(span[-1] for span in spans), length, name)
            self.assertEqual(max(int(span.split('-')[-1]) for _, lines in parts for span in lines.split(',')), length, name)
        manifest = json.loads((EXCERPTS / 'manifest.json').read_text())
        recorded = {session['name'] for session in manifest['sessions']}
        self.assertLessEqual(set(WHOLE_RUNS) | set(PART_RUNS) | set(PLOTTED), recorded)
        # Every snippet this build has is in this section.
        cut = {excerpt['name'] for excerpt in manifest['excerpts'] if excerpt['name'].startswith('ch07b-')}
        self.assertEqual(cut, set(SNIPPETS))
        figure = FIGURE.read_text()
        for name in PLOTTED:
            self.assertIn('excerpts/%s.txt' % name, figure)

    def test_the_first_break(self):
        name = 'early-refund-separate'
        self.assertEqual(funds(step(name, 1)), (10, 0, 0))
        self.assertEqual(funds(step(name, 2)), (4, 6, 0))
        self.quoted('In the runs below it is 6')
        for refund in (3, 5):
            self.assertIn('-> refunded', step(name, refund))
            self.assertEqual(funds(step(name, refund)), (10, 0, 0))
        self.assertIn('claim shop/cart.ts -> token 1, bond 2', step(name, 4))
        self.assertIn('refused: held (held by wren', step(name, 6))
        self.assertEqual(verdict(name), 'verdict: 2 CLAIMS ARE LIVE AND NO BOND IS HELD: 0 units in escrow')
        self.quoted('The break. Wren holds two claims, and escrow is empty.')
        self.quoted('Step 3 is not a fault in the ledger.')
        self.quoted('Steps 4 and 5 repeat this with the same units, and at step 6 Heron is refused a path that Wren holds at no cost.')

    def test_the_second_break(self):
        name = 'late-write-separate'
        self.assertIn('-> released, bond 1 refunded', step(name, 4))
        self.assertEqual(funds(step(name, 4)), (10, 0, 0))
        self.assertIn('-> written', step(name, 5))
        self.assertTrue(verdict(name).startswith('verdict: A WRITE WAS ADMITTED WITH NO BOND HELD'))
        self.quoted('The second break. The release refunds the bond, and the write after it is admitted.')
        self.quoted('Step 5 is not a fault in the fence either.')
        # The printed part of the run starts at the release.
        self.assertTrue(run(name)[9].startswith('step 4 '))

    def test_the_fix_refuses_both(self):
        name = 'early-refund-core'
        self.assertIn('refused: at-stake', step(name, 3))
        self.assertIn('refused: short (the wallet holds 4, and the bond needs 6)', step(name, 4))
        self.assertEqual(verdict(name), 'verdict: one claim is live, and its bond is held: 6 units in escrow')
        self.quoted('The fix. The refund is refused, and a second claim needs a second bond.')
        self.assertTrue(run(name)[7].startswith('step 3 '))
        self.quoted("Wren's first run again, from step 3")
        later = 'late-write-core'
        self.assertIn('refused: no-stake', step(later, 5))
        self.assertTrue(run(later)[12].startswith('step 5 '))
        self.quoted("Wren's second run now stops at step 5")
        self.quoted('The fix. The write after the release is refused.')

    def test_an_abandoned_claim(self):
        name = 'expired-claim-core'
        self.assertIn('every lease expires', step(name, 3))
        self.assertIn('token 2, bond 2', step(name, 4))
        self.assertEqual(funds(step(name, 4)), (0, 12, 0))
        self.assertIn('refused: stale-token', step(name, 5))
        self.assertIn('refused: at-stake', step(name, 6))
        self.assertEqual(verdict(name), 'verdict: bond 1 stays held until an adjudicator settles it: 12 units in escrow')
        self.quoted("Heron's claim posts its own bond at step 4.")
        self.quoted('so the fence refuses the release, and \\texttt{not\\_staked} refuses the refund')
        self.quoted('If step 6 were admitted, Wren would be ruling on its own bond.')

    def test_every_state(self):
        header = ' '.join(line.strip() for line in run('stakes')[1:4])
        self.assertEqual(header, 'every reachable state of a harbor: 2 workers and 2 paths, a claim costs 2 units, '
                                 'at most 4 units topped up, 3 bonds posted and 2 grants for a path')
        self.quoted('with two workers and two paths at a price of 2 units. At most 4 units are topped up and 3 bonds '
                    'posted, and a path is granted at most twice.')
        self.quoted('The exhaustive test stops at 2 workers and 4 units.')
        # states, operations, wrongly accepted, unbonded claims, unbonded writes, shared bonds, unsettled bonds
        states, operations, accepted, claims, writes, shared, unsettled = self.states['core']
        self.assertEqual((accepted, claims, writes, shared), (0, 0, 0, 0))
        self.quoted(f"The kernel's harbor reaches {spelt(states)} states and accepts none of the operations that the "
                    'model refuses.')
        self.quoted(f'An exhaustive test visits all {spelt(states)} states of two workers and two paths within small '
                    'bounds')
        self.quoted(f'In {unsettled} states it holds the bond of an abandoned claim, as it holds bond 1 above.')
        separate = self.states['separate']
        self.assertEqual(separate[0:2], [states, operations])
        self.quoted(f'accepts {spelt(separate[2])} operations that the model refuses. It reaches {spelt(separate[3])} '
                    f'states in which a claim has no bond, and it admits {spelt(separate[4])} writes under a claim with '
                    'no bond.')
        self.assertEqual(separate[5], 0)
        self.assertIn('no harbor refused an operation the model allows, and each holds exactly the units topped up',
                      ' '.join(line.strip() for line in run('stakes')))
        self.quoted('In all of these states the funds add up and no bond is shared')

    def test_each_guard_removed(self):
        any_stake, refund, write = (self.guards[name] for name in GUARDS)
        separate = self.states['separate']
        # wrongly accepted, unbonded claims, unbonded writes, shared bonds
        self.assertEqual(refund[1:], [separate[3], 0, 0])
        self.quoted(f'Without \\texttt{{not\\_staked}}, claims lose their bonds in {spelt(refund[1])} states, as in the '
                    'first harbor.')
        self.quoted('But no write is admitted under one of them')
        self.assertEqual(write[1:], [0, separate[4], 0])
        self.quoted(f'Without \\texttt{{bond\\_held}} every claim keeps its bond, and {spelt(write[2])} writes are '
                    'admitted after a release.')
        self.assertEqual(refund[0] + write[0], separate[2])
        self.quoted(f"The two rows add up to the first harbor's {spelt(separate[2])} wrongly accepted operations, and "
                    'that harbor had neither guard.')
        self.assertGreater(any_stake[3], 0)
        self.assertEqual(max(refund[3], write[3]), 0)
        self.quoted('Each build fails in a different column.')
        self.quoted(f'The exhaustive test detects this, as {any_stake[3]} states in which a bond is shared.')
        self.quoted('This build added three guards')

    def test_kanis_results(self):
        lines = run('kani-stakes')
        self.assertEqual(lines[0], '$ sh formal/stakes/run.sh')
        results = dict(zip(lines[1:9:2], (line.strip() for line in lines[2:9:2])))
        names = list(results)
        self.assertEqual(names, ['a_new_grant_posts_its_own_bond', 'a_write_needs_a_held_bond',
                                 'control_a_claim_with_no_bond_is_caught', 'every_operation_keeps_a_claim_bonded'])
        self.assertEqual(results[names[2]], 'fails, as a control should')
        for name in (names[0], names[1], names[3]):
            self.assertTrue(results[name].startswith('successful'), name)
        self.quoted('The last of the four results is the step.')
        self.assertEqual(len(results), 4)
        self.quoted('The first result says that a grant with a new token gets a bond with a new id.')
        self.quoted('The second says that a write is admitted only under a grant with its own stake and a held bond.')
        self.quoted('The third is a control.')
        # The step's harness is printed, with the property it checks.
        step_code = (EXCERPTS / 'ch07b-kani-step.code').read_text()
        self.assertIn('fn every_operation_keeps_a_claim_bonded()', step_code)
        self.assertIn('fn bonded(path: &Path) -> bool', step_code)
        self.quoted('The property is \\texttt{bonded} in')
        self.assertEqual(lines[9], 'the harnesses that fail when one guard is removed')
        failing, build = {}, None
        for line in lines[10:]:
            if line.startswith('  '):
                failing[build].append(line.strip())
            else:
                build = line
                failing[build] = []
        self.assertEqual(list(failing), GUARDS)
        for build, failed in failing.items():
            self.assertTrue(failed and failed != ['NONE'], build)
        self.assertNotIn(names[3], failing['any-stake'])
        self.quoted('are the lower half of Listing~\\ref{alg:bonded-stake-kani}. That build passes the step.')
        self.assertEqual(len(lines), 17)
        self.assertEqual(failing['refund-staked'], [names[3]])
        self.assertEqual(failing['write-unstaked'], [names[1]])

    def test_the_figure_counts_what_its_tables_contain(self):
        kernel, separate = combinations('stakes-each'), combinations('stakes-each-separate')
        # A claim that is not released, with a bond that is not held.
        unbonded = lambda row: row[0] != 2 and row[1] != 1
        self.assertEqual(len(kernel), 4)
        self.assertFalse(any(unbonded(row) for row in kernel))
        self.assertEqual(sorted((CLAIMS[c], BONDS[b]) for c, b, _, _ in kernel),
                         [('abandoned', 'held'), ('expired', 'held'), ('live', 'held'), ('released', 'refunded')])
        self.quoted("In the kernel's harbor a claim and its bond occur in four combinations.")
        self.quoted("In the kernel's harbor a claim and its bond occur in four combinations.", self.caption)
        extra = [row for row in separate if unbonded(row)]
        self.assertEqual(len(extra), 6)
        self.assertEqual(len(separate) - len(extra), len(kernel))
        self.quoted('The first harbor reaches six more, and each of them is a claim that was not released, with a bond that is not held.')
        # A ring is drawn where writes were admitted, and it is red where the bond was not held.
        self.assertTrue(all(b == 1 for _, b, _, writes in kernel if writes))
        red = [(CLAIMS[c], BONDS[b]) for c, b, _, writes in separate if writes and b != 1]
        self.assertEqual(red, [('released', 'refunded')])
        self.quoted('The red ring is the second break, step 5 of Listing~\\ref{alg:bonded-stake-run-late}: writes admitted under a released claim.')
        self.quoted('The red ring is writes admitted after the bond was refunded.', self.caption)
        # The figure labels its rows and columns with the words in the tables' own comments.
        key = ' '.join(line.lstrip('# ').strip() for line in run('stakes-each') if line.startswith('#'))
        self.assertIn('claim 0: live; 1: expired, and still the newest grant; 2: released; 3: abandoned, which is '
                      'expired and not released, with a newer grant after it', key)
        self.assertIn('bond 0: none; 1: held; 2: refunded; 3: slashed', key)
        figure = FIGURE.read_text()
        self.assertIn('{live,expired,released,abandoned}', figure)
        self.assertIn('{none,held,refunded,slashed}', figure)
        abandoned = next(row for row in kernel if row[0] == 3)
        self.assertEqual(abandoned[2], self.states['core'][6])

    def test_the_exercises(self):
        kernel = combinations('stakes-each')
        self.assertEqual(len(CLAIMS) * len(BONDS), 16)
        self.quoted('has sixteen cells and four marks', self.chapter)
        self.assertEqual(len(kernel), 4)
        # The column for no bond and the row for a released claim: seven cells, one of them marked.
        cells = {(c, b) for c in range(4) for b in range(4) if b == 0 or c == 2}
        marked = {(c, b) for c, b, _, _ in kernel}
        self.assertEqual(len(cells - marked), 6)
        self.quoted('The column for no bond has four cells', self.chapter)
        self.quoted('The row for a released claim has two more.', self.chapter)
        self.quoted(f"which {self.states['core'][6]} states of the exhaustive test contain today", self.chapter)
        # A project of 12 units at a price of 6: the funds in the two traces.
        self.quoted("Before Heron's request the funds are $(6,6,0)$. The wrapper posts Heron's bond, and they are $(0,12,0)$.", self.chapter)
        self.quoted("After Wren's claim the funds are $(6,6,0)$", self.chapter)
        self.quoted("so the funds are still $(6,6,0)$. Heron's release then refunds bond 1, and the funds are $(12,0,0)$.", self.chapter)
        self.quoted('the project posted 6 units for two claims', self.chapter)

    def test_the_chapter_refers_to_the_section(self):
        source = CHAPTER.read_text()
        self.assertIn('\\input{additions/bonded-build-the-stake}', source)
        self.assertLess(source.index('\\input{additions/bonded-build-the-ledger}'),
                        source.index('\\input{additions/bonded-build-the-stake}'))
        self.quoted("\\S\\ref{sec:bonded-stake} builds the safety property in the book's own kernel", self.chapter)
        self.assertIn('\\pdexercisesfor{\\S\\ref{sec:bonded-stake}}{Build the layer: a claim that requires a bond}', source)
        self.assertIn('\\subsection{Build the layer: a claim that requires a bond}', SECTION.read_text())
        self.assertIn('{\\ref{ex:bonded-stake-judge}}', source)
        for label in ('cells', 'order', 'borrowed', 'judge'):
            self.assertIn('{ex:bonded-stake-%s}' % label, source)


if __name__ == '__main__':
    unittest.main()
