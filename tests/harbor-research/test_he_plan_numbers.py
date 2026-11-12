"""Chapter 6's build section quotes facts from its recorded runs. Hold each to its run.

The section's listings cannot drift: they are the recorded files. Its prose
can, and so can its figure's caption and its exercises. A sentence that says
"4,213 states" was written by hand from a table the kernel printed, and a
later recording may print another table. Each test here reads a fact out of
a recorded run and requires the sentence that quotes it.
"""
import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
EXCERPTS = ROOT / 'book' / 'excerpts'
SECTION = ROOT / 'book' / 'additions' / 'he-build-the-plan.tex'
FIGURE = ROOT / 'book' / 'figures' / 'fig-he-odd-unit.tex'
CHAPTER = ROOT / 'book' / 'harbor-economy.tex'
WHOLE_RUNS = ['partial-apiece', 'one-wallet-apiece', 'thirds-apiece', 'one-wallet-core', 'plans', 'splits',
              'plans-guards']
PART_RUNS = {'thirds-core': [(6, '1,11-15')], 'kani-plans': [(11, '1-11'), (15, '1,12-25')]}
PLOTTED = ['splits-each']
SNIPPETS = ['ch06-apiece', 'ch06-reserve', 'ch06-split', 'ch06-settle', 'ch06-kani-settle']
GUARDS = ['reserve-apiece', 'split-apiece', 'settle-plan-twice', 'any-count', 'unbonded-plan']


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


def books(line):
    """What a transcript line ends with: each wallet, then escrow and the commons."""
    outcome = line.split(' -> ', 1)[1].split(': ', 1)[1]
    return {name: int(count) for name, count in re.findall(r'(\w+) (-?\d+)(?:,|$)', outcome)}


def table(name, rows):
    """A recorded table: for each named row, its counts."""
    found = {}
    for line in run(name):
        cells = line.split()
        if cells and cells[0] in rows:
            found[cells[0]] = [int(cell) for cell in cells[1:]]
    return found


def payouts():
    """The plotted table: milestones, milestones done, the bounty, and the units left."""
    rows = [line.split() for line in run('splits-each') if line and line[0] not in '#$']
    assert rows[0] == ['of', 'done', 'bounty', 'left'], rows[0]
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
        cls.walk = table('plans', ('apiece', 'core'))
        cls.guards = table('plans-guards', GUARDS)

    def quoted(self, sentence, where=None):
        self.assertIn(sentence, self.text if where is None else where)

    def test_every_run_and_snippet_is_set_and_given_its_room(self):
        source = SECTION.read_text()
        whole = re.findall(r'\\pdlistingroom\{(\d+)\}\n\\pd(run|excerpt)\[[^\]]*\]\{([\w-]+)\}', source, flags=re.S)
        self.assertEqual(sorted(name for _, _, name in whole), sorted(SNIPPETS + WHOLE_RUNS))
        for room, kind, name in whole:
            path = EXCERPTS / (f'{name}.txt' if kind == 'run' else f'{name}.code')
            self.assertEqual(int(room), len(path.read_text().splitlines()), name)
        for name, parts in PART_RUNS.items():
            found = re.findall(r'\\pdlistingroom\{(\d+)\}\n\\pdrunlines\[[^\]]*\]\{%s\}\{([\d,-]+)\}' % name, source, flags=re.S)
            self.assertEqual([(int(room), lines) for room, lines in found], parts, name)
            length = len(run(name))
            for room, lines in parts:
                spans = [[int(end) for end in span.split('-')] for span in lines.split(',')]
                self.assertEqual(sum(span[-1] - span[0] + 1 for span in spans), room, name)
                self.assertLessEqual(max(span[-1] for span in spans), length, name)
            # Between them the parts print the run to its last line.
            self.assertEqual(max(int(span.split('-')[-1]) for _, lines in parts for span in lines.split(',')), length, name)
        manifest = json.loads((EXCERPTS / 'manifest.json').read_text())
        recorded = {session['name'] for session in manifest['sessions']}
        self.assertLessEqual(set(WHOLE_RUNS) | set(PART_RUNS) | set(PLOTTED), recorded)
        # Every snippet and session this build has is in this section, or in its figure.
        cut = {excerpt['name'] for excerpt in manifest['excerpts'] if excerpt['name'].startswith('ch06-')}
        self.assertEqual(cut, set(SNIPPETS))
        figure = FIGURE.read_text()
        for name in PLOTTED:
            self.assertIn('excerpts/%s.txt' % name, figure)

    def test_the_first_try_gets_the_books_example_right(self):
        name = 'partial-apiece'
        self.assertEqual(books(step(name, 3)), {'bob': 0, 'alice': 0, 'escrow': 500, 'commons': 0})
        self.assertIn('pay out plan 1 at 2 of 5', step(name, 4))
        after = books(step(name, 4))
        self.assertEqual(after, {'bob': 240, 'alice': 200, 'escrow': 0, 'commons': 60})
        self.quoted(f"Bob ends with {after['bob']} of his 400 units and Alice with {after['alice']}, and the other "
                    f"{after['commons']} are in the commons.")
        # The chapter's own example: a bounty of 400 and a bond of 100, at two milestones of five.
        self.quoted('bounty $400$', self.chapter)
        self.quoted('performance bond of $100$', self.chapter)
        self.quoted('$-160$ & $-400$ bounty escrowed, $+240$ unearned bounty returned', self.chapter)
        self.quoted('Commons & $+60$', self.chapter)
        self.assertEqual(after['bob'] - 400, -160)
        self.assertEqual(after['alice'] - 100, 100)
        self.assertTrue(verdict(name).startswith('verdict: the 500 units deposited are all still held'))
        self.quoted('A bounty of 400 at 2 milestones of 5 divides evenly, and so does a bond of 100.')

    def test_the_first_break(self):
        name = 'one-wallet-apiece'
        self.assertEqual(books(step(name, 1)), {'bob': 400, 'escrow': 0, 'commons': 0})
        self.assertIn("open a plan: bob's bounty 400, bob's bond 100", step(name, 2))
        self.assertEqual(books(step(name, 2)), {'bob': -100, 'escrow': 500, 'commons': 0})
        self.assertEqual(verdict(name), 'verdict: A WALLET IS OVERDRAWN: bob -100, and escrow says 500 where 400 were deposited')
        self.quoted('The break. A wallet of 400 stands behind a bounty of 400 and a bond of 100.')
        self.quoted('Step 2 passed both checks.')
        self.quoted('the wallet ends 100 below nothing. Escrow says 500 where 400 units exist.')

    def test_the_second_break(self):
        name = 'thirds-apiece'
        self.assertEqual(books(step(name, 3)), {'bob': 0, 'alice': 0, 'escrow': 110, 'commons': 0})
        self.assertIn('pay out plan 1 at 1 of 3', step(name, 4))
        after = books(step(name, 4))
        self.assertEqual(after, {'bob': 66, 'alice': 36, 'escrow': 0, 'commons': 6})
        self.assertEqual(verdict(name), "verdict: 2 UNITS ARE IN NOBODY'S HANDS: 108 of the 110 deposited are left")
        self.quoted('The second break. A plan of 110 units is paid out, and 108 arrive.')
        self.quoted('so Alice earns 33.')
        self.quoted('so Bob has 66 back.')
        self.quoted('together they come to 99.')
        self.quoted('with 3 back and 6 forfeited out of 10.')
        self.assertEqual(after['alice'], 33 + 3)
        self.quoted('Two of the 110 units are now nowhere in the books.')
        self.quoted('is false after step 4')

    def test_the_fix_refuses_one_and_pays_out_the_other(self):
        name = 'one-wallet-core'
        self.assertIn('refused: uncovered (the wallet holds 400, and the plan asks 500 of it)', step(name, 2))
        self.assertTrue(verdict(name).startswith('verdict: the 400 units deposited are all still held'))
        self.quoted('The fix. One wallet is asked for 500 and holds 400.')
        self.quoted("Bob's wallet of 400 is asked for 500")
        later = 'thirds-core'
        after = books(step(later, 4))
        self.assertEqual(after, {'bob': 67, 'alice': 36, 'escrow': 0, 'commons': 7})
        self.assertTrue(verdict(later).startswith('verdict: the 110 units deposited are all still held'))
        self.quoted('now pays out all 110 of its units')
        # The part of the run that is printed starts at the payout.
        self.assertTrue(run(later)[10].startswith('step 4 '))
        self.quoted("The fix. The odd unit of the bounty is Bob's, and the odd unit of the bond is the commons'.")

    def test_the_walk(self):
        header = ' '.join(line.strip() for line in run('plans')[1:4])
        self.assertEqual(header, 'every state a keeper can reach: 2 principals, deposits of up to 2 units and 3 in all, '
                                 'a bounty and a bond of up to 2, 3 milestones and 2 plans')
        self.quoted('within small bounds: 2 principals, deposits of 1 or 2 units up to 3 in all, a bounty and a bond of '
                    'up to 2 units, counts of up to 3 milestones, and 2 plans.')
        self.quoted('The walk stops at amounts of 2 units and the sweep at 40.')
        # states, moves, wrongly taken, payouts short, units lost, wallets overdrawn
        states, moves, taken, short, lost, overdrawn = self.walk['core']
        self.assertEqual((taken, short, lost, overdrawn), (0, 0, 0, 0))
        self.quoted(f"The kernel's keeper reaches {spelt(states)} states.")
        self.quoted(f'A walk takes it through {spelt(states)} states')
        self.assertIn('the core refused no move the rules allow, and holds what they give in every state',
                      ' '.join(line.strip() for line in run('plans')))
        first = self.walk['apiece']
        self.quoted(f'The first try takes {first[2]} moves that the rules refuse and comes to {first[5]} states with a '
                    f'wallet below nothing. Of its payouts {spelt(first[3])} are short, and they lose {spelt(first[4])} '
                    'units between them')
        self.quoted(f'It makes all {spelt(moves)} moves that the rules allow and none of the')
        self.quoted(f'the walk covers 2 principals and 2 plans with amounts of up to 2 units'.replace('the walk', 'The walk'))

    def test_the_sweep(self):
        lines = run('splits')
        self.assertIn('every bounty from 1 to 40 units', ' '.join(line.strip() for line in lines[1:3]))
        self.assertEqual(lines[4].split(), ['milestones', 'cases', 'apiece', 'core'])
        rows = {cells[0]: [int(cell) for cell in cells[1:]] for cells in (line.split() for line in lines[5:11])}
        self.assertEqual(list(rows), ['2', '3', '4', '5', '6', 'all'])
        cases, first, kernel = rows['all']
        self.assertEqual(kernel, 0)
        self.assertEqual(sum(row[0] for name, row in rows.items() if name != 'all'), cases)
        self.assertEqual(sum(row[1] for name, row in rows.items() if name != 'all'), first)
        self.quoted(f'it pays one plan out {cases} ways')
        self.quoted(f'One plan paid out {cases} ways by each keeper.')
        self.quoted('at every count of 2 to 6 milestones, short of all of them, for every bounty from 1 to 40 units')
        self.quoted('one plan, bounties of 1 to 40 units and 2 to 6 milestones')

    def test_the_figure_counts_what_its_table_holds(self):
        rows = payouts()
        self.assertEqual(len(rows), 600)
        lost = [row for row in rows if row[3] != 0]
        self.assertEqual(len(lost), 424)
        self.assertEqual({row[3] for row in rows}, {0, 1})
        # The rule the caption states, on every row.
        for milestones, done, bounty, left in rows:
            self.assertEqual(left, 0 if (bounty * done) % milestones == 0 else 1, (milestones, done, bounty))
        self.assertIn('lose a unit unless the milestones divide the bounty times the count done', self.caption)
        self.assertIn('A red square is a payout by the first keeper that lost one unit', self.caption)
        # The bond in the sweep is as many units as there are milestones, so the unit lost is the bounty's.
        self.assertIn('with a bond that divides evenly', ' '.join(line.strip() for line in run('splits')[1:3]))
        self.quoted('A payout comes out whole only when the milestones divide the bounty times the count done')
        self.quoted("The kernel's keeper lost no unit in any of the 600.")
        self.quoted('That is 600 payouts by each keeper')
        self.quoted('pays one plan out 600 ways, and Figure~\\ref{fig:he-odd-unit} shows how much the round numbers hid')
        # No bounty is clear in every row, and the picture's own count is drawn from the table.
        clear = [bounty for bounty in range(1, 41) if all(row[3] == 0 for row in rows if row[2] == bounty)]
        self.assertEqual(clear, [])
        self.quoted('No bounty up to 40 is clear in every row.')
        self.assertIn('a unit is lost in \\the\\pdoddlost\\ of \\the\\pdoddall\\ payouts', FIGURE.read_text())
        self.assertEqual(sorted({(row[0], row[1]) for row in rows}),
                         [(milestones, done) for milestones in range(2, 7) for done in range(1, milestones)])
        # The exercise about a bounty of 30.
        thirty = sorted((done, milestones) for milestones, done, bounty, left in rows if bounty == 30 and left)
        self.assertEqual(thirty, [(1, 4), (3, 4)])
        self.quoted('So the column for 30 has two squares, in the rows for 1 of 4 and 3 of 4.', self.chapter)

    def test_kanis_verdicts(self):
        lines = run('kani-plans')
        self.assertEqual(lines[0], '$ sh formal/plans/run.sh')
        verdicts = dict(zip(lines[1:11:2], (line.strip() for line in lines[2:11:2])))
        names = list(verdicts)
        self.assertEqual(names, ['a_plan_is_paid_out_once', 'a_plan_reserves_both_amounts_or_neither',
                                 'a_settlement_pays_out_what_was_reserved', 'a_share_is_no_more_than_the_amount',
                                 'two_parts_rounded_apiece_are_caught'])
        self.assertEqual(verdicts[names[4]], 'fails, as it must')
        for name in names[:4]:
            self.assertTrue(verdicts[name].startswith('successful'), name)
        self.quoted("Kani's verdicts are in Listing~\\ref{alg:he-plan-kani}, and the fourth is the other part.")
        self.quoted('The last verdict is a control')
        code = (EXCERPTS / 'ch06-kani-settle.code').read_text().splitlines()
        self.assertEqual(code[1], '#[kani::stub(share, some_share)]')
        self.quoted('The second line of the listing makes the swap.')
        self.quoted('It runs \\texttt{some\\_share} in its place')
        self.assertIn('fn a_settlement_pays_out_what_was_reserved()', code[2])
        self.assertIn('    kani::assume(count > of || part <= amount);', code)
        self.assertEqual(lines[11], 'with one guard removed, the harnesses that fail')
        failing, build = {}, None
        for line in lines[12:]:
            if line.startswith('  '):
                failing[build].append(line.strip())
            else:
                build = line
                failing[build] = []
        self.assertEqual(list(failing), GUARDS)
        for build, failed in failing.items():
            self.assertTrue(failed and failed != ['NONE'], build)
        self.quoted('Every build goes wrong in the walk, and every build fails some harness under Kani')
        self.quoted('The harnesses again, on the same five builds.')
        # The printed halves meet where the builds with a guard removed begin.
        self.assertEqual(lines[10].strip(), 'fails, as it must')
        self.assertEqual(len(lines), 25)
        # The exercise about what stands in for a function.
        self.assertEqual(failing['any-count'], [names[2], names[3]])
        self.quoted('The entry for \\texttt{any-count} would lose its first line.', self.chapter)

    def test_each_guard_removed(self):
        # wrongly taken, payouts short, states over, plans unbonded
        for name in GUARDS:
            self.assertTrue(any(self.guards[name]), name)
        taken, short, over, unbonded = self.guards['reserve-apiece']
        self.assertEqual((short, unbonded), (0, 0))
        self.assertGreater(over, taken)
        self.quoted(f'and {spelt(over)} states hold more units than were deposited. That is more than the {taken} wrong '
                    'moves')
        self.quoted('This build has five guards')
        self.assertEqual(len(self.guards), 5)
        # The last row is the guard on a plan with no bond.
        self.assertEqual(list(self.guards)[-1], 'unbonded-plan')
        self.assertGreater(self.guards['unbonded-plan'][3], 0)
        self.quoted('The last row is Design Invariant~\\ref{prop:nospawn}')
        self.assertEqual(list(self.guards)[0], 'reserve-apiece')
        self.quoted('The first row of Listing~\\ref{alg:he-plan-guards} repays a second look.')

    def test_the_exercises_work_out(self):
        # 2 milestones of 3, on a bounty of 100 and a bond of 10.
        earned, kept = 100 * 2 // 3, 10 * 2 // 3
        self.assertEqual((earned, kept), (66, 6))
        apiece = (100 * 1 // 3, earned + kept, 10 * 1 // 3)
        self.assertEqual(apiece, (33, 72, 3))
        self.quoted('Bob holds 33 and Alice 72, with 3 in the commons. That is 108 of the 110 units', self.chapter)
        self.assertEqual(sum(apiece), 108)
        kernel = (100 - earned, earned + kept, 10 - kept)
        self.assertEqual(kernel, (34, 72, 4))
        self.quoted('Bob holds 34 and Alice 72, with 4 in the commons, and that is 110.', self.chapter)
        self.assertEqual(sum(kernel), 110)
        # A plan of 1 unit and 1 unit at 1 milestone of 3.
        self.assertEqual(1 * 1 // 3, 0)
        self.assertEqual(-(-1 * 1 // 3), 1)
        self.quoted("Rounded down, the provider's third of 1 unit is nothing.", self.chapter)
        self.quoted("Rounded up, the provider's third is 1 unit", self.chapter)
        self.quoted('\\pdexercisepointer*{\\ref{ex:he-partial-settlement-trace}}{\\ref{ex:he-plan-stand-in}}', self.chapter)


if __name__ == '__main__':
    unittest.main()
