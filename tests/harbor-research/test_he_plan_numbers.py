"""Chapter 6's build section states numbers from its recorded runs. Check each one.

The section's listings are the recorded files, so they cannot go out of
date. Its prose can, and so can its figure's caption and its exercises. A
sentence that says "4,213 states" was typed from a table the kernel
printed, and a later recording may print a different table. Each test here
reads a number from a recorded run and checks that the text states it.
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
WHOLE_RUNS = ['partial-separate', 'one-wallet-separate', 'thirds-separate', 'one-wallet-core', 'plans', 'splits',
              'plans-guards']
PART_RUNS = {'thirds-core': [(6, '1,11-15')], 'kani-plans': [(11, '1-11'), (15, '1,12-25')]}
PLOTTED = ['splits-each']
SNIPPETS = ['ch06-separate', 'ch06-reserve', 'ch06-split', 'ch06-settle', 'ch06-kani-settle']
GUARDS = ['reserve-separately', 'split-separately', 'settle-plan-twice', 'any-count', 'unbonded-plan']


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


def balances(line):
    """The balances at the end of a transcript line, by name."""
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
    """The plotted table: milestones, milestones done, the bounty, and the units lost."""
    rows = [line.split() for line in run('splits-each') if line and line[0] not in '#$']
    assert rows[0] == ['of', 'done', 'bounty', 'lost'], rows[0]
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
        cls.states = table('plans', ('separate', 'core'))
        cls.guards = table('plans-guards', GUARDS)

    def quoted(self, sentence, where=None):
        self.assertIn(sentence, self.text if where is None else where)

    def test_every_run_and_snippet_is_printed_with_room_for_its_lines(self):
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
            # Together the parts print the run to its last line.
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

    def test_the_first_ledger_pays_the_chapters_example_correctly(self):
        name = 'partial-separate'
        self.assertEqual(balances(step(name, 3)), {'bob': 0, 'alice': 0, 'escrow': 500, 'commons': 0})
        self.assertIn('pay out plan 1 at 2 of 5', step(name, 4))
        after = balances(step(name, 4))
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
        name = 'one-wallet-separate'
        self.assertEqual(balances(step(name, 1)), {'bob': 400, 'escrow': 0, 'commons': 0})
        self.assertIn("open a plan: bob's bounty 400, bob's bond 100", step(name, 2))
        self.assertEqual(balances(step(name, 2)), {'bob': -100, 'escrow': 500, 'commons': 0})
        self.assertEqual(verdict(name), 'verdict: A WALLET IS OVERDRAWN: bob -100, and escrow shows 500 where 400 were deposited')
        self.quoted('The break. A wallet of 400 pays a bounty of 400 and a bond of 100.')
        self.quoted('Step 2 passed both checks.')
        self.quoted('the wallet ends at $-100$. Escrow shows 500 where 400 units exist.')

    def test_the_second_break(self):
        name = 'thirds-separate'
        self.assertEqual(balances(step(name, 3)), {'bob': 0, 'alice': 0, 'escrow': 110, 'commons': 0})
        self.assertIn('pay out plan 1 at 1 of 3', step(name, 4))
        after = balances(step(name, 4))
        self.assertEqual(after, {'bob': 66, 'alice': 36, 'escrow': 0, 'commons': 6})
        self.assertEqual(verdict(name), 'verdict: 2 UNITS ARE MISSING: 108 of the 110 deposited are left')
        self.quoted('The second break. A plan of 110 units is paid out, and 108 units are paid.')
        self.quoted('so Alice earns 33.')
        self.quoted('so Bob gets 66 back.')
        self.quoted('together they add up to 99.')
        self.quoted('3 returned and 6 forfeited, out of 10.')
        self.assertEqual(after['alice'], 33 + 3)
        self.quoted('Two of the 110 units are now in no wallet and not in the commons.')
        self.quoted('is false after step 4')

    def test_the_fix_refuses_one_and_pays_out_the_other(self):
        name = 'one-wallet-core'
        self.assertIn('refused: uncovered (the wallet holds 400, and the plan needs 500 from it)', step(name, 2))
        self.assertTrue(verdict(name).startswith('verdict: the 400 units deposited are all still held'))
        self.quoted('The fix. One wallet holds 400, and the plan needs 500.')
        self.quoted("Bob's wallet of 400 is checked against 500")
        later = 'thirds-core'
        after = balances(step(later, 4))
        self.assertEqual(after, {'bob': 67, 'alice': 36, 'escrow': 0, 'commons': 7})
        self.assertTrue(verdict(later).startswith('verdict: the 110 units deposited are all still held'))
        self.quoted('now pays out all 110 of its units')
        # The part of the run that is printed starts at the payout.
        self.assertTrue(run(later)[10].startswith('step 4 '))
        self.quoted('The fix. The remainder of the bounty goes to Bob, and the remainder of the bond goes to the commons.')

    def test_every_state(self):
        header = ' '.join(line.strip() for line in run('plans')[1:4])
        self.assertEqual(header, 'every reachable state of a plan ledger: 2 principals, deposits of up to 2 units and 3 '
                                 'in all, a bounty and a bond of up to 2, 3 milestones and 2 plans')
        self.quoted('within small bounds: 2 principals, deposits of 1 or 2 units up to 3 in all, a bounty and a bond of '
                    'up to 2 units, counts of up to 3 milestones, and 2 plans.')
        self.quoted('The exhaustive test stops at amounts of 2 units and the 600 payouts stop at 40.')
        # states, operations, wrongly accepted, payouts short, units lost, wallets overdrawn
        states, operations, accepted, short, lost, overdrawn = self.states['core']
        self.assertEqual((accepted, short, lost, overdrawn), (0, 0, 0, 0))
        self.quoted(f"The kernel's ledger reaches {spelt(states)} states.")
        self.quoted(f'An exhaustive test visits {spelt(states)} states of it')
        self.assertIn("the core refused no operation the model allows, and its state equals the model's in every state",
                      ' '.join(line.strip() for line in run('plans')))
        first = self.states['separate']
        self.quoted(f'The first ledger accepts {first[2]} operations that the model refuses and reaches {first[5]} states '
                    f'with a negative wallet. Of its payouts {spelt(first[3])} are short, and they lose '
                    f'{spelt(first[4])} units in total')
        self.quoted(f'It accepts all {spelt(operations)} operations that the model allows and none of the')
        self.quoted('The exhaustive test covers 2 principals and 2 plans with amounts of up to 2 units')

    def test_every_count(self):
        lines = run('splits')
        self.assertIn('every bounty from 1 to 40 units', ' '.join(line.strip() for line in lines[1:3]))
        self.assertEqual(lines[4].split(), ['milestones', 'cases', 'separate', 'core'])
        rows = {cells[0]: [int(cell) for cell in cells[1:]] for cells in (line.split() for line in lines[5:11])}
        self.assertEqual(list(rows), ['2', '3', '4', '5', '6', 'all'])
        cases, first, kernel = rows['all']
        self.assertEqual(kernel, 0)
        self.assertEqual(sum(row[0] for name, row in rows.items() if name != 'all'), cases)
        self.assertEqual(sum(row[1] for name, row in rows.items() if name != 'all'), first)
        self.quoted(f'it pays one plan out {cases} ways')
        self.quoted(f'One plan paid out {cases} ways by each ledger.')
        self.quoted('at every count of 2 to 6 milestones, with at least one milestone not done, for every bounty from 1 '
                    'to 40 units')
        self.quoted('one plan, bounties of 1 to 40 units and 2 to 6 milestones')

    def test_the_figure_counts_what_its_table_holds(self):
        rows = payouts()
        self.assertEqual(len(rows), 600)
        lost = [row for row in rows if row[3] != 0]
        self.assertEqual(len(lost), 424)
        self.assertEqual({row[3] for row in rows}, {0, 1})
        # The rule the caption states, on every row.
        for milestones, done, bounty, lost_units in rows:
            self.assertEqual(lost_units, 0 if (bounty * done) % milestones == 0 else 1, (milestones, done, bounty))
        self.assertIn('lose a unit unless the milestones divide the bounty times the count done', self.caption)
        self.assertIn('A red square is a payout by the first ledger that lost one unit', self.caption)
        # The bond in these payouts divides evenly, so a lost unit is a unit of the bounty.
        self.assertIn('with a bond that divides evenly', ' '.join(line.strip() for line in run('splits')[1:3]))
        self.quoted('A payout loses no unit only when the milestones divide the bounty times the count done')
        self.quoted("The kernel's ledger lost no unit in any of the 600.")
        self.quoted('That is 600 payouts by each ledger')
        self.quoted('pays one plan out 600 ways, and Figure~\\ref{fig:he-odd-unit} shows how many of them lose a unit')
        # No bounty is exact in every row, and the figure computes its own count from the table.
        exact = [bounty for bounty in range(1, 41) if all(row[3] == 0 for row in rows if row[2] == bounty)]
        self.assertEqual(exact, [])
        self.quoted('No bounty up to 40 is paid out exactly in every row.')
        self.assertIn('a unit is lost in \\the\\pdoddlost\\ of \\the\\pdoddall\\ payouts', FIGURE.read_text())
        self.assertEqual(sorted({(row[0], row[1]) for row in rows}),
                         [(milestones, done) for milestones in range(2, 7) for done in range(1, milestones)])
        # The exercise about a bounty of 30.
        thirty = sorted((done, milestones) for milestones, done, bounty, lost_units in rows if bounty == 30 and lost_units)
        self.assertEqual(thirty, [(1, 4), (3, 4)])
        self.quoted('So the column for 30 has two squares, in the rows for 1 of 4 and 3 of 4.', self.chapter)

    def test_kanis_results(self):
        lines = run('kani-plans')
        self.assertEqual(lines[0], '$ sh formal/plans/run.sh')
        results = dict(zip(lines[1:11:2], (line.strip() for line in lines[2:11:2])))
        names = list(results)
        self.assertEqual(names, ['a_plan_is_paid_out_once', 'a_plan_reserves_both_amounts_or_neither',
                                 'a_settlement_pays_out_what_was_reserved', 'a_share_is_no_more_than_the_amount',
                                 'control_two_parts_rounded_separately_are_caught'])
        self.assertEqual(results[names[4]], 'fails, as a control should')
        for name in names[:4]:
            self.assertTrue(results[name].startswith('successful'), name)
        self.quoted("Kani's results are in Listing~\\ref{alg:he-plan-kani}, and the fourth is the second part.")
        self.quoted('The last result is a control')
        code = (EXCERPTS / 'ch06-kani-settle.code').read_text().splitlines()
        self.assertEqual(code[1], '#[kani::stub(share, any_share)]')
        self.quoted('The second line of the listing substitutes the stub.')
        self.quoted('It runs the stub \\texttt{any\\_share} instead')
        self.assertIn('fn a_settlement_pays_out_what_was_reserved()', code[2])
        self.assertIn('    kani::assume(count > of || part <= amount);', code)
        self.assertEqual(lines[11], 'the harnesses that fail when one guard is removed')
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
        self.quoted('The exhaustive test finds a fault in every build, and every build fails at least one harness '
                    'under Kani')
        self.quoted('The harnesses again, on the same five builds.')
        # The first printed part ends with the control, and the second starts at the builds.
        self.assertEqual(lines[10].strip(), 'fails, as a control should')
        self.assertEqual(len(lines), 25)
        # The exercise about the stub.
        self.assertEqual(failing['any-count'], [names[2], names[3]])
        self.quoted('The entry for \\texttt{any-count} would lose its first line.', self.chapter)

    def test_each_guard_removed(self):
        # wrongly accepted, payouts short, states over, plans unbonded
        for name in GUARDS:
            self.assertTrue(any(self.guards[name]), name)
        accepted, short, over, unbonded = self.guards['reserve-separately']
        self.assertEqual((short, unbonded), (0, 0))
        self.assertGreater(over, accepted)
        self.quoted(f'and {spelt(over)} states hold more units than were deposited. That is more than the {accepted} '
                    'wrongly accepted operations')
        self.quoted('This build has five guards')
        self.assertEqual(len(self.guards), 5)
        # The last row is the guard on a plan with no bond.
        self.assertEqual(list(self.guards)[-1], 'unbonded-plan')
        self.assertGreater(self.guards['unbonded-plan'][3], 0)
        self.quoted('The last row is Design Invariant~\\ref{prop:nospawn}')
        self.assertEqual(list(self.guards)[0], 'reserve-separately')
        self.quoted('The first row of Listing~\\ref{alg:he-plan-guards} needs an explanation.')

    def test_the_exercises_arithmetic(self):
        # 2 milestones of 3, on a bounty of 100 and a bond of 10.
        earned, returned = 100 * 2 // 3, 10 * 2 // 3
        self.assertEqual((earned, returned), (66, 6))
        separate = (100 * 1 // 3, earned + returned, 10 * 1 // 3)
        self.assertEqual(separate, (33, 72, 3))
        self.quoted('Bob holds 33 and Alice 72, with 3 in the commons. That is 108 of the 110 units', self.chapter)
        self.assertEqual(sum(separate), 108)
        kernel = (100 - earned, earned + returned, 10 - returned)
        self.assertEqual(kernel, (34, 72, 4))
        self.quoted('Bob holds 34 and Alice 72, with 4 in the commons, and that is 110.', self.chapter)
        self.assertEqual(sum(kernel), 110)
        # A plan of 1 unit and 1 unit at 1 milestone of 3.
        self.assertEqual(1 * 1 // 3, 0)
        self.assertEqual(-(-1 * 1 // 3), 1)
        self.quoted("Rounded down, the provider's third of 1 unit is 0.", self.chapter)
        self.quoted("Rounded up, the provider's third is 1 unit", self.chapter)
        self.quoted('\\pdexercisepointer*{\\ref{ex:he-partial-settlement-trace}}{\\ref{ex:he-plan-stub}}', self.chapter)


if __name__ == '__main__':
    unittest.main()
