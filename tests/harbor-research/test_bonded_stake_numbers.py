"""Chapter 7's second build section quotes facts from its recorded runs. Hold each to its run.

The section's listings cannot drift: they are the recorded files. Its prose
can, and so can its figure's caption and its exercises. A sentence that says
"25,272 moves" was written by hand from a table the kernel printed, and a
later recording may print another table. Each test here reads a fact out of
a recorded run and requires the sentence that quotes it.
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
WHOLE_RUNS = ['free-hold-apart', 'walked-away-core', 'stakes', 'stakes-guards', 'kani-stakes']
PART_RUNS = {
    'after-release-apart': [(9, '1,10-17')],
    'after-release-core': [(6, '1,13-17')],
    'free-hold-core': [(15, '1,8-21')],
}
PLOTTED = ['stakes-each', 'stakes-each-apart']
SNIPPETS = ['ch07b-apart', 'ch07b-stake', 'ch07b-back', 'ch07b-free', 'ch07b-loose', 'ch07b-at-stake',
            'ch07b-kani-step']
CLAIMS = ['live', 'run out', 'released', 'left']
BONDS = ['none', 'held', 'refunded', 'slashed']


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


def verdict(name):
    return next(line for line in said(name) if line.startswith('verdict: '))


def funds(line):
    """The three buckets a transcript line ends with."""
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


def pairs(name):
    """A recorded table of pairs: where a claim stands, where its bond stands, states and changes."""
    rows = [line.split() for line in run(name) if line and line[0] != '#' and line[0] != '$']
    assert rows[0] == ['claim', 'bond', 'states', 'changes'], rows[0]
    return [tuple(int(cell) for cell in row) for row in rows[1:]]


def spelt(count):
    """A count as the Book sets it, with a comma for thousands."""
    return f'{count:,}'


class QuotedFacts(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.text = prose(SECTION)
        cls.chapter = prose(CHAPTER)
        cls.caption = prose(FIGURE)
        cls.walk = table('stakes', ('apart', 'core'))
        cls.guards = table('stakes-guards', ('borrowed-stake', 'refund-at-stake', 'write-unstaked'))

    def quoted(self, sentence, where=None):
        self.assertIn(sentence, self.text if where is None else where)

    def test_every_run_and_snippet_is_set_and_given_its_room(self):
        source = SECTION.read_text()
        for name in SNIPPETS:
            self.assertIn('{%s}' % name, source)
        # A listing set whole asks for as many lines as its file has.
        whole = re.findall(r'\\pdlistingroom\{(\d+)\}\n\\pd(run|excerpt)\[[^\]]*\]\{([\w-]+)\}', source, flags=re.S)
        self.assertEqual(sorted(name for _, _, name in whole), sorted(SNIPPETS + WHOLE_RUNS))
        for room, kind, name in whole:
            path = EXCERPTS / (f'{name}.txt' if kind == 'run' else f'{name}.code')
            self.assertEqual(int(room), len(path.read_text().splitlines()), name)
        # A listing set in part asks for the lines it prints, and they are lines the file has.
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
        figure = FIGURE.read_text()
        for name in PLOTTED:
            self.assertIn('excerpts/%s.txt' % name, figure)

    def test_the_first_break(self):
        name = 'free-hold-apart'
        self.assertEqual(funds(step(name, 1)), (10, 0, 0))
        self.assertEqual(funds(step(name, 2)), (4, 6, 0))
        self.quoted('In the runs below it is 6')
        for refund in (3, 5):
            self.assertIn('-> refunded', step(name, refund))
            self.assertEqual(funds(step(name, refund)), (10, 0, 0))
        self.assertIn('claim shop/cart.ts -> token 1, bond 2', step(name, 4))
        self.assertIn('refused: held (held by wren', step(name, 6))
        self.assertEqual(verdict(name), 'verdict: 2 CLAIMS ARE HELD AND NO BOND IS: 0 units in escrow')
        self.quoted('The break. Wren holds two claims, and escrow holds nothing.')
        self.quoted('Step 3 is no mistake of the keeper')
        self.quoted('Steps 4 and 5 do it a second time with the same units, and at step 6 Heron is refused a path that costs Wren nothing to hold.')

    def test_the_second_break(self):
        name = 'after-release-apart'
        self.assertIn('-> released, bond 1 back', step(name, 4))
        self.assertEqual(funds(step(name, 4)), (10, 0, 0))
        self.assertIn('-> changed', step(name, 5))
        self.assertTrue(verdict(name).startswith('verdict: A CHANGE WAS MADE WITH NOTHING BEHIND IT'))
        self.quoted('The second break. The release gives the bond back, and the change after it is admitted.')
        self.quoted('Step 5 is no mistake of the fence')
        # The part of the run that is printed starts at the release.
        self.assertTrue(run(name)[9].startswith('step 4 '))

    def test_the_fix_refuses_both(self):
        name = 'free-hold-core'
        self.assertIn('refused: at-stake', step(name, 3))
        self.assertIn('refused: short (the wallet holds 4, and the bond asks 6)', step(name, 4))
        self.assertEqual(verdict(name), 'verdict: one claim is held, with its bond behind it: 6 units in escrow')
        self.quoted('The fix. The refund is refused, and a second claim needs a second bond.')
        self.assertTrue(run(name)[7].startswith('step 3 '))
        self.quoted("Wren's first run again, from step 3")
        later = 'after-release-core'
        self.assertIn('refused: nothing-at-stake', step(later, 5))
        self.assertTrue(run(later)[12].startswith('step 5 '))
        self.quoted("Wren's second run now stops at step 5")
        self.quoted('The fix. The change after the release is refused.')

    def test_a_claim_that_is_left(self):
        name = 'walked-away-core'
        self.assertIn('every lease runs out', step(name, 3))
        self.assertIn('token 2, bond 2', step(name, 4))
        self.assertEqual(funds(step(name, 4)), (0, 12, 0))
        self.assertIn('refused: stale-token', step(name, 5))
        self.assertIn('refused: at-stake', step(name, 6))
        self.assertEqual(verdict(name), 'verdict: bond 1 is held until someone may judge it: 12 units in escrow')
        self.quoted("Heron's claim posts a bond of its own at step 4.")
        self.quoted('so the fence refuses the release, and \\texttt{loose} refuses the refund')
        self.quoted('A harbor in which step 6 went through would have made Wren that judge.')

    def test_the_walk(self):
        header = ' '.join(line.strip() for line in run('stakes')[1:4])
        self.assertEqual(header, 'every state a harbor can reach: 2 workers and 2 paths, a claim costs 2 units, '
                                 'at most 4 units topped up, 3 bonds posted and 2 grants for a path')
        self.quoted('with two workers and two paths at a price of 2 units. It tops up at most 4 units and posts at most '
                    '3 bonds, and a path is given at most 2 grants.')
        self.quoted('The walk stops at 2 workers and 4 units.')
        # states, moves, wrongly taken, claims bare, changes unbonded, bonds shared, bonds waiting
        states, moves, taken, bare, unbonded, shared, waiting = self.walk['core']
        self.assertEqual((taken, bare, unbonded, shared), (0, 0, 0, 0))
        self.quoted(f"The kernel's harbor reaches {spelt(states)} states and takes none of the moves that the rules refuse.")
        self.quoted(f'A walk takes it through all {spelt(states)} states of two workers and two paths within small bounds')
        self.quoted(f'In {waiting} of them it holds a bond that waits, as bond 1 does above.')
        apart = self.walk['apart']
        self.assertEqual(apart[0:2], [states, moves])
        self.quoted(f'takes {spelt(apart[2])} moves that the rules refuse. It comes to {spelt(apart[3])} states in which a '
                    f'claim has no bond, and it admits {spelt(apart[4])} changes under a claim with none.')
        self.assertEqual(apart[5], 0)
        self.assertIn('no harbor refused a move the rules allow, and each holds exactly the units topped up',
                      ' '.join(line.strip() for line in run('stakes')))
        self.quoted('Through all of this the funds add up and no bond is shared')

    def test_each_guard_removed(self):
        borrowed, refund, write = (self.guards[name] for name in ('borrowed-stake', 'refund-at-stake', 'write-unstaked'))
        apart = self.walk['apart']
        # wrongly taken, claims bare, changes unbonded, bonds shared
        self.assertEqual(refund[1:], [apart[3], 0, 0])
        self.quoted(f'Without \\texttt{{loose}}, claims go bare in {spelt(refund[1])} states, as they did in the harbor made of two parts.')
        self.quoted('Yet no change is made under one of them')
        self.assertEqual(write[1:], [0, apart[4], 0])
        self.quoted(f'Without \\texttt{{at\\_stake}} no claim goes bare, and {spelt(write[2])} changes are made after a release.')
        self.assertEqual(refund[0] + write[0], apart[2])
        self.quoted(f"The two rows add up to that harbor's {spelt(apart[2])} wrong moves, and it had neither guard.")
        self.assertGreater(borrowed[3], 0)
        self.assertEqual(max(refund[3], write[3]), 0)
        self.quoted('Each build fails in a column of its own.')
        self.quoted(f'The walk sees it, as {borrowed[3]} states in which a bond is shared.')
        self.quoted('This build added three guards')

    def test_kanis_verdicts(self):
        lines = run('kani-stakes')
        self.assertEqual(lines[0], '$ sh formal/stakes/run.sh')
        verdicts = dict(zip(lines[1:9:2], (line.strip() for line in lines[2:9:2])))
        names = list(verdicts)
        self.assertEqual(names, ['a_change_has_a_bond_held_behind_it', 'a_claim_given_with_no_bond_is_caught',
                                 'a_new_grant_posts_a_bond_of_its_own', 'every_move_leaves_the_claim_its_bond'])
        self.assertEqual(verdicts[names[1]], 'fails, as it must')
        for name in (names[0], names[2], names[3]):
            self.assertTrue(verdicts[name].startswith('successful'), name)
        self.quoted('The last of the four verdicts is the step.')
        self.assertEqual(len(verdicts), 4)
        self.quoted('The first verdict says that a change is admitted only under a grant with its own stake and a bond held.')
        self.quoted('The third says that a grant with a new token gets a bond with a new id.')
        self.quoted('The second is a control.')
        # The step's harness is printed, with the property it steps.
        step_code = (EXCERPTS / 'ch07b-kani-step.code').read_text()
        self.assertIn('fn every_move_leaves_the_claim_its_bond()', step_code)
        self.assertIn('fn backed(path: &Path) -> bool', step_code)
        self.assertEqual(lines[9], 'with one guard removed, the harnesses that fail')
        failing, build = {}, None
        for line in lines[10:]:
            if line.startswith('  '):
                failing[build].append(line.strip())
            else:
                build = line
                failing[build] = []
        self.assertEqual(list(failing), ['borrowed-stake', 'refund-at-stake', 'write-unstaked'])
        for build, failed in failing.items():
            self.assertTrue(failed and failed != ['NONE'], build)
        self.assertNotIn(names[3], failing['borrowed-stake'])
        self.quoted('are the lower half of Listing~\\ref{alg:bonded-stake-kani}. That build passes the step.')
        self.assertEqual(len(lines), 17)
        self.assertEqual(failing['refund-at-stake'], [names[3]])
        self.assertEqual(failing['write-unstaked'], [names[0]])

    def test_the_figure_counts_what_its_tables_hold(self):
        kernel, apart = pairs('stakes-each'), pairs('stakes-each-apart')
        # A claim that is not released, with a bond that is not held.
        bare = lambda row: row[0] != 2 and row[1] != 1
        self.assertEqual(len(kernel), 4)
        self.assertFalse(any(bare(row) for row in kernel))
        self.assertEqual(sorted((CLAIMS[c], BONDS[b]) for c, b, _, _ in kernel),
                         [('left', 'held'), ('live', 'held'), ('released', 'refunded'), ('run out', 'held')])
        self.quoted("In the kernel's harbor a claim and its bond stand together in four ways.")
        self.quoted("In the kernel's harbor a claim and its bond stand together in four ways.", self.caption)
        extra = [row for row in apart if bare(row)]
        self.assertEqual(len(extra), 6)
        self.assertEqual(len(apart) - len(extra), len(kernel))
        self.quoted('The other harbor comes to six more, and each of them is a claim that was not released, with a bond that is not held.')
        # A ring is drawn where changes were admitted, and it is red where the bond was not held.
        self.assertTrue(all(b == 1 for _, b, _, changes in kernel if changes))
        red = [(CLAIMS[c], BONDS[b]) for c, b, _, changes in apart if changes and b != 1]
        self.assertEqual(red, [('released', 'refunded')])
        self.quoted('The red ring is the second break, step 5 of Listing~\\ref{alg:bonded-stake-run-after}: changes admitted under a claim that had been released.')
        self.quoted('The red ring is work done after its bond went back.', self.caption)
        # The tables' own key is the one the figure labels its rows and columns by.
        key = ' '.join(line.lstrip('# ').strip() for line in run('stakes-each') if line.startswith('#'))
        self.assertIn('claim 0: live; 1: run out, and still the newest; 2: released; 3: run out and not released, '
                      'with a newer grant after it', key)
        self.assertIn('bond 0: none; 1: held; 2: refunded; 3: slashed', key)
        figure = FIGURE.read_text()
        self.assertIn('{live,run out,released,left}', figure)
        self.assertIn('{none,held,refunded,slashed}', figure)
        left = next(row for row in kernel if row[0] == 3)
        self.assertEqual(left[2], self.walk['core'][6])

    def test_the_exercises(self):
        kernel = pairs('stakes-each')
        self.assertEqual(len(CLAIMS) * len(BONDS), 16)
        self.quoted('has sixteen cells and four marks', self.chapter)
        self.assertEqual(len(kernel), 4)
        # The column for no bond and the row for a released claim: seven cells, one of them marked.
        cells = {(c, b) for c in range(4) for b in range(4) if b == 0 or c == 2}
        marked = {(c, b) for c, b, _, _ in kernel}
        self.assertEqual(len(cells - marked), 6)
        self.quoted('The column for no bond has four cells', self.chapter)
        self.quoted('The row for a released claim has two more.', self.chapter)
        self.quoted(f"which {self.walk['core'][6]} states of the walk hold today", self.chapter)
        # A project of 12 units at a price of 6: the funds the two traces give.
        self.quoted('Before Heron asks, the funds are $(6,6,0)$. The desk posts Heron\'s bond, and they are $(0,12,0)$.', self.chapter)
        self.quoted("After Wren's claim the funds are $(6,6,0)$", self.chapter)
        self.quoted('so the funds are still $(6,6,0)$. Heron\'s release then refunds bond 1, and the funds are $(12,0,0)$.', self.chapter)
        self.quoted('the project has paid 6 units for two claims', self.chapter)

    def test_the_chapter_points_to_the_section(self):
        source = CHAPTER.read_text()
        self.assertIn('\\input{additions/bonded-build-the-stake}', source)
        self.assertLess(source.index('\\input{additions/bonded-build-the-ledger}'),
                        source.index('\\input{additions/bonded-build-the-stake}'))
        self.quoted('\\S\\ref{sec:bonded-stake} builds the safety property in the book\'s own kernel', self.chapter)
        self.assertIn('{\\ref{ex:bonded-stake-judge}}', source)
        for label in ('cells', 'order', 'borrowed', 'judge'):
            self.assertIn('{ex:bonded-stake-%s}' % label, source)


if __name__ == '__main__':
    unittest.main()
