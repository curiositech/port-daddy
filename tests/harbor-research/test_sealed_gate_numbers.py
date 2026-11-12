"""Chapter 3's build section quotes facts from its recorded runs. Hold each to its run.

The section's listings cannot drift: they are the recorded files. Its prose
can, and so can its figure's caption and its exercises. A sentence that says
"1,870 states" was written by hand from a table the kernel printed, and a
later recording may print another table. Each test here reads a fact out of
a recorded run and requires the sentence that quotes it.
"""
import json
import math
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
EXCERPTS = ROOT / 'book' / 'excerpts'
SECTION = ROOT / 'book' / 'additions' / 'sealed-build-the-gate.tex'
FIGURE = ROOT / 'book' / 'figures' / 'fig-sealed-views.tex'
CHAPTER = ROOT / 'book' / 'sealed-harbor.tex'
WHOLE_RUNS = ['honest-handed', 'launder-handed', 'timing-prompt', 'launder-core', 'timing-core', 'worlds',
              'worlds-guards']
PART_RUNS = {'launder-prompt': [(6, '1,5,8-9,14-15')], 'kani-release': [(11, '1-11'), (14, '1,12-24')]}
PLOTTED = {'handed': 'worlds-each-handed', 'prompt': 'worlds-each-prompt', 'core': 'worlds-each'}
SNIPPETS = ['ch03-slot', 'ch03-handed', 'ch03-prompt', 'ch03-tick', 'ch03-what', 'ch03-when', 'ch03-pair',
            'ch03-kani-pair']
GATES = ['handed', 'prompt', 'core']
GUARDS = ['trust-candidate', 'raw-record', 'early-release', 'release-twice']
APART = 'verdict: ERIN CAN TELL A RECORD OF 0 FROM A RECORD OF 2, AND THE SLOT DECLARES ONLY THEIR PARITY'


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
        if line.startswith(' ' * 9) and not line.strip().startswith('erin') and joined:
            joined[-1] += ' ' + line.strip()
        else:
            joined.append(line)
    return joined


def worlds(line):
    """What one line of a run in two worlds ends with: a cell for each world."""
    return line[35:51].strip(), line[51:].strip()


def step(name, number):
    """One step of a recorded scenario, and the line after it if Erin saw something."""
    lines = run(name)
    at = next(index for index, line in enumerate(lines) if line.startswith(f'step {number} '))
    seen = lines[at + 1] if lines[at + 1].strip().startswith('erin') else None
    return lines[at], seen


def seen(name):
    """What Erin has seen by the end of a run, in each world."""
    return worlds(next(line for line in run(name) if line.startswith('erin has seen')))


def verdict(name):
    return next(line for line in said(name) if line.startswith('verdict: '))


def table(name, rows):
    """A recorded table: for each named row, its counts."""
    found = {}
    for line in run(name):
        cells = line.split()
        if cells and cells[0] in rows:
            found[cells[0]] = [int(cell) for cell in cells[1:]]
    return found


def views():
    """The plotted tables: a gate, a record, and the time and value of what left, or None for each."""
    found = []
    for gate, name in PLOTTED.items():
        lines = run(name)
        assert f'under design {gate}:' in lines[1], lines[1]
        rows = [line.split() for line in lines if line and line[0] not in '#$']
        assert rows[0] == ['record', 'left', 'at', 'value'], rows[0]
        for record, left, at, value in ([int(cell) for cell in row] for row in rows[1:]):
            assert left in (0, 1) and (left or (at, value) == (0, 0)), (name, record, left, at, value)
            found.append((gate, record, at if left else None, value if left else None))
    return found


def spelt(count):
    """A count as the Book sets it, with a comma for thousands."""
    return f'{count:,}'


class QuotedFacts(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.text = prose(SECTION)
        cls.chapter = prose(CHAPTER)
        cls.caption = prose(FIGURE)
        cls.walk = table('worlds', GATES)
        cls.guards = table('worlds-guards', GUARDS)

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
        self.assertLessEqual(set(WHOLE_RUNS) | set(PART_RUNS) | set(PLOTTED.values()), recorded)
        # Every snippet this build has is in this section.
        cut = {excerpt['name'] for excerpt in manifest['excerpts'] if excerpt['name'].startswith('ch03-')}
        self.assertEqual(cut, set(SNIPPETS))
        figure = FIGURE.read_text()
        for name in PLOTTED.values():
            self.assertIn('{excerpts/%s.txt}' % name, figure)

    def test_the_first_gate_passes_a_worker_that_hands_in_the_record(self):
        name = 'honest-handed'
        self.assertEqual(run(name)[4].split(), ['record', '0', 'record', '2'])
        handed, erin = step(name, 3)
        self.assertEqual(worlds(handed), ('0', '2'))
        self.assertEqual(worlds(erin), ('0', '0'))
        self.assertEqual(seen(name), ('0 at 0', '0 at 0'))
        self.assertEqual(verdict(name), 'verdict: erin has seen the same in both worlds: 0 at 0')
        self.quoted("Derek's record is 0 in one world and 2 in the other")
        self.quoted('The slot declares their parity, which is 0 in both')
        self.quoted('Erin sees a 0 in both worlds. A reader who tested this gate with an honest worker would pass it.')

    def test_the_first_break(self):
        name = 'launder-handed'
        handed, erin = step(name, 3)
        self.assertIn('worker hands in half', handed)
        self.assertEqual(worlds(handed), ('0', '1'))
        self.assertEqual(worlds(erin), ('0', '1'))
        self.assertEqual(seen(name), ('0 at 0', '1 at 0'))
        self.assertEqual(verdict(name), APART)
        self.assertEqual((0 // 2, 2 // 2), (0, 1))
        self.quoted('Half of 0 is 0, and half of 2 is 1.')
        self.quoted('let out 0 in one world and 1 in the other')
        self.quoted("Erin now knows the record's second bit")
        # The chapter's own figure proposed the same worker.
        self.quoted('If the worker first computes $t=f(s)=\\lfloor s/2\\rfloor$, the same gate instead releases $0$ and $1$.',
                    self.chapter)
        self.quoted('proposed $t=\\lfloor s/2\\rfloor$')

    def test_the_second_gate_repairs_the_first_break_and_has_one_of_its_own(self):
        repaired = 'launder-prompt'
        handed, erin = step(repaired, 3)
        self.assertEqual(worlds(handed), ('0', '1'))
        self.assertEqual(worlds(erin), ('0', '0'))
        self.assertEqual(verdict(repaired), 'verdict: erin has seen the same in both worlds: 0 at 0')
        # The lines of it that are printed: the heads of the columns, the step, what Erin saw, and the end.
        lines = run(repaired)
        self.assertTrue(lines[4].strip().startswith('record 0'))
        self.assertTrue(lines[7].startswith('step 3 '))
        self.assertTrue(lines[8].strip().startswith('erin'))
        self.assertTrue(lines[13].startswith('erin has seen'))
        self.assertTrue(lines[14].startswith('verdict: '))
        self.quoted('The first break, repaired. What is handed in no longer reaches Erin.')
        name = 'timing-prompt'
        first, erin_first = step(name, 3)
        self.assertEqual(worlds(first), ('0', 'waits'))
        self.assertEqual(worlds(erin_first), ('0', '-'))
        second, erin_second = step(name, 5)
        self.assertEqual(worlds(second), ('waits', '2'))
        self.assertEqual(worlds(erin_second), ('-', '0'))
        self.assertIn('clock  time 1', step(name, 4)[0])
        self.assertEqual(seen(name), ('0 at 0', '0 at 1'))
        self.assertEqual(verdict(name), APART)
        self.quoted('The second break. The value is the same in both worlds, and the time is not.')
        self.quoted('It left at time 0 in one world and at time 1 in the other')
        self.quoted('can ask at once in one world and a tick later in the other')

    def test_the_fix_ends_both_runs_alike(self):
        for name in ('launder-core', 'timing-core'):
            self.assertEqual(seen(name), ('0 at 2', '0 at 2'), name)
            self.assertEqual(verdict(name), 'verdict: erin has seen the same in both worlds: 0 at 2', name)
            lines = run(name)
            hands = [index for index, line in enumerate(lines) if line.startswith('step ') and 'worker hands' in line]
            self.assertTrue(hands, name)
            # Nothing leaves when the worker hands a value in: the next line is another step.
            for index in hands:
                self.assertTrue(lines[index + 1].startswith('step '), name)
            release = next(index for index, line in enumerate(lines) if line.strip().startswith('erin   sees'))
            self.assertIn('clock  time 2', lines[release - 1], name)
            self.assertEqual(worlds(lines[release]), ('0', '0'), name)
        self.quoted('Nothing leaves when the worker hands a value in. The parity leaves when the clock reaches time 2, in '
                    'both worlds at once.')
        # The slot of the runs is the one the section describes.
        self.assertIn('a slot that lets out the lowest bit at time 2', ' '.join(line.strip() for line in run('worlds')[1:4]))

    def test_the_listings_say_what_the_prose_says_of_them(self):
        code = lambda name: (EXCERPTS / f'{name}.code').read_text()
        self.assertIn('const value = low(this.slot.bits, candidate);', code('ch03-handed'))
        self.assertIn('const record = this.committed;', code('ch03-prompt'))
        self.assertIn('const value = low(this.slot.bits, record);', code('ch03-prompt'))
        self.quoted('The first try. \\texttt{low} keeps the low bits that the slot declares.')
        self.quoted('The second try. The value comes from the committed record, and the worker says when.')
        tick = code('ch03-tick')
        for called in ('due(room, now)', 'spent(room)', 'source(room)', 'declared(room, from)'):
            self.assertIn(called, tick)
        self.assertIn('pub fn tick(room: &Room, now: u64) -> Passed {', tick)
        self.quoted('\\texttt{tick} is given the room and the time.')
        what, when = code('ch03-what'), code('ch03-when')
        self.assertEqual(re.findall(r'^fn (\w+)', what, flags=re.M), ['source', 'declared'])
        self.assertEqual(re.findall(r'^fn (\w+)', when, flags=re.M), ['due', 'spent'])
        self.assertEqual((what.count('MUTANT'), when.count('MUTANT')), (2, 2))
        self.assertEqual(sorted(re.findall(r'feature = "mutant-([\w-]+)"', what + when)), sorted(GUARDS))
        self.quoted("Those four functions are the gate's guards, in two pairs.")
        self.quoted('The guards on what leaves. A line marked \\texttt{MUTANT} is compiled only into a build of the core '
                    'that has that guard removed')
        self.quoted('The guards on when it leaves.')
        self.quoted('This build has four guards')
        self.assertIn('    room.committed\n', what)
        self.assertIn('from & ((1 << bits) - 1)', what)
        self.quoted('\\texttt{source} reads the record its owner committed, and \\texttt{declared} keeps the bits the '
                    'slot names.')
        self.assertIn('    now >= room.slot.deadline\n', when)
        self.assertIn('    room.used\n', when)
        self.quoted('\\texttt{due} compares the time the core is given with the time the slot names, and asks nothing of '
                    'the worker. \\texttt{spent} lets the slot be used once.')
        # The exercise about the build that opens early reads the listing of these guards.
        self.assertIn('return true; // MUTANT: it opens when the worker asks.', when)
        self.quoted('Listing~\\ref{alg:sealed-gate-when} marks one line of \\texttt{due} as a build with that guard '
                    'removed.', self.chapter)
        slot = code('ch03-slot')
        self.assertIn('pub bits: u8,', slot)
        self.assertIn('pub deadline: u64,', slot)
        self.quoted("a count of the record's low bits that may leave, and the time they leave")
        pair = code('ch03-pair')
        self.assertIn("if (!loaded) steps.push(['commit', commit(a), commit(b)]);", pair)
        self.assertIn("steps.push(['tick', tick, tick]);", pair)
        self.assertIn('steps.push([`hand in ${value}`, hand, hand]);', pair)
        self.assertIn('steps.push([`A hands in ${value}`, hand, idle]);', pair)
        self.quoted('A worker that has not read the record does the same thing in both worlds.')
        kani = code('ch03-kani-pair')
        self.assertIn('fn two_rooms() -> (Room, Room) {', kani)
        self.assertEqual(kani.count('kani::cover!('), 2)
        self.assertIn('kani::assume(a.used == b.used);', kani)
        self.assertIn('assert!(after_a.out == after_b.out);', kani)
        self.assertIn('assert!(after_a.used == after_b.used);', kani)
        self.quoted('Its two \\texttt{cover} lines make the solver find a case')
        self.quoted('They have one slot, used in both or in neither, and their records have one declared part.')

    def test_the_walk(self):
        header = ' '.join(line.strip() for line in run('worlds')[1:4])
        self.assertEqual(header, 'every pair of worlds a room can reach: records from 0 to 3, and a slot that lets out the '
                                 'lowest bit at time 2. The clock runs to time 3, and each worker hands in up to 2 values '
                                 'from 0 to 3')
        self.quoted('Records run from 0 to 3, the slot declares one bit at time 2, the clock runs to time 3, and each '
                    'worker hands in up to 2 values from 0 to 3.')
        # Of the pairs of four records, the ones with one parity.
        alike = [(a, b) for a in range(4) for b in range(a + 1, 4) if a % 2 == b % 2]
        self.assertEqual((len(alike), math.comb(4, 2)), (2, 6))
        self.quoted('Two of the six pairs of records have one parity')
        self.quoted('Two of them, $(0,2)$ and $(1,3)$, are equal-parity.', self.chapter)
        # states, told apart, apart by value, apart by time, views
        for gate in GATES:
            states, apart, by_value, by_time, shown = self.walk[gate]
            self.assertEqual(apart, by_value + by_time, gate)
        states, apart, by_value, by_time, shown = self.walk['handed']
        self.quoted(f'Under the first gate Erin has seen different things in {spelt(apart)} of {spelt(states)} states. In '
                    f'{spelt(by_value)} of those, both rooms let something out at the same time and the values differ')
        second = self.walk['prompt']
        self.assertEqual(second[2], 0)
        self.quoted(f'The second gate has none of that kind, and all {spelt(second[1])} of its differences are in time.')
        kernel = self.walk['core']
        self.assertEqual(kernel[1:4], [0, 0, 0])
        self.quoted(f"The kernel's gate has no difference of either kind in {spelt(kernel[0])} states")
        self.quoted(f'finds no state in {spelt(kernel[0])} where Erin can tell two records of one parity apart')
        self.assertIn('in every state the core had let out what the rule says',
                      ' '.join(line.strip() for line in run('worlds')))
        self.quoted('and in every state it had let out what the rule says.')
        self.assertEqual([self.walk[gate][4] for gate in GATES], [9, 5, 1])
        self.quoted('a worker that could choose among 9 things to show her is left with 1')
        self.quoted('The walk stops at records of 2 bits and a clock that runs to 3.')
        self.quoted('The walk covers records of 2 bits, one slot of one bit and a clock of 3 ticks')

    def test_the_figure_counts_what_its_table_holds(self):
        rows = views()
        self.assertEqual(len(rows), 60)
        per = {(gate, record): [row[2:] for row in rows if row[:2] == (gate, record)] for gate in GATES
               for record in range(4)}
        times = range(4)
        for record in range(4):
            parity = record % 2
            # The first gate: a bit at one of four times, or nothing.
            self.assertEqual(sorted(per['handed', record], key=str),
                             sorted([(None, None)] + [(at, value) for at in times for value in (0, 1)], key=str))
            # The second: the record's own bit at one of four times, or nothing.
            self.assertEqual(sorted(per['prompt', record], key=str),
                             sorted([(None, None)] + [(at, parity) for at in times], key=str))
            # The kernel's: the record's own bit at the slot's time.
            self.assertEqual(per['core', record], [(2, parity)])
        counts = [len(per[gate, 0]) for gate in GATES]
        self.assertEqual(counts, [self.walk[gate][4] for gate in GATES])
        self.assertEqual(counts, [2 * 4 + 1, 4 + 1, 1])
        self.quoted('That is $2\\times4+1=9$ things, whatever the record is.')
        self.quoted('the worker keeps the 4 times and the silence, which is 5 things')
        self.quoted("Under the kernel's gate there is 1, and a choice among 1 carries nothing.")
        # The theorem's count for one release of one bit at one of four times.
        self.assertEqual(1 + math.log2(4), 3)
        self.assertEqual(2 ** 3, 8)
        self.quoted('a capacity of $b+\\log_2 w=3$ bits, which is 8 things. The ninth is silence.')
        self.quoted('If each release may also pick one of $w$ release times, all three parts hold with $b+\\log_2 w$ in '
                    'place of $b$.', self.chapter)
        self.quoted('the number of releases, their times and every failure fixed or padded', self.chapter)
        self.assertIn('A worker that could show Erin 9 things of one record is left with 1.', self.caption)
        self.assertIn("A framed black square is the record's parity at the slot's time, and a red one is the worker's "
                      'choice.', self.caption)
        self.assertNotIn('A square is something', self.caption)
        figure = FIGURE.read_text()
        # The counts in the picture are taken from the table as it is drawn.
        for counter in ('\\the\\pdviewsfirst', '\\the\\pdviewssecond', '\\the\\pdviewskernel'):
            self.assertIn(counter, figure)
        self.assertIn('\\ifnum\\at=2 \\ifnum\\vl=\\parity', figure)
        self.assertIn('along: the time it left, or a dash if nothing did', figure)
        self.assertIn('up: the value that left', figure)

    def test_kanis_verdicts(self):
        lines = run('kani-release')
        self.assertEqual(lines[0], '$ sh formal/release/run.sh')
        verdicts = dict(zip(lines[1:11:2], (line.strip() for line in lines[2:11:2])))
        names = list(verdicts)
        self.assertEqual(names, ['a_gate_that_reads_the_candidate_is_caught', 'a_used_slot_lets_nothing_out',
                                 'only_the_clock_lets_anything_out', 'two_rooms_with_one_declared_part_look_the_same',
                                 'what_leaves_is_the_declared_part_when_it_is_due'])
        self.assertEqual(verdicts[names[0]], 'fails, as it must')
        for name in names[1:]:
            self.assertTrue(verdicts[name].startswith('successful'), name)
        self.assertIn('its 2 covers are satisfied', verdicts[names[3]])
        self.quoted('The first verdict is a control.')
        self.quoted('A second harness shows that a commit and a submission let nothing out.')
        self.assertIn(f'fn {names[3]}()', (EXCERPTS / 'ch03-kani-pair.code').read_text())
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
        self.quoted('The harnesses again, on the same four builds.')
        # The printed halves meet where the builds with a guard removed begin.
        self.assertEqual(len(lines), 24)
        # The build that lets the part out twice passes the harness on two rooms.
        self.assertNotIn(names[3], failing['release-twice'])
        self.assertIn(names[4], failing['release-twice'])
        self.quoted('The harness \\texttt{what\\_leaves\\_is\\_the\\_declared\\_part\\_when\\_it\\_is\\_due} asks the same '
                    'of the code, for any room.', self.chapter)

    def test_each_guard_removed(self):
        self.assertEqual(list(self.guards), GUARDS)
        # states, apart by value, apart by time, off the yardstick, views
        for name in GUARDS:
            self.assertGreater(self.guards[name][3], 0, name)
        first, raw, early, twice = (self.guards[name] for name in GUARDS)
        self.assertTrue(first[1] > 0 and first[2] == 0)
        self.quoted('The first row is the first break, inside the core.')
        self.assertTrue(raw[1] > 0 and raw[2] == 0)
        self.assertEqual(raw[4], 1)
        self.quoted('that build still has 1 view of each record')
        self.assertTrue(early[1] == 0 and early[2] > 0)
        self.quoted('The third opens early when the worker has asked, which is the second break.')
        self.assertEqual((twice[1], twice[2]), (0, 0))
        self.quoted(f'in every one of {spelt(twice[0])} states, because both rooms repeat themselves alike')
        self.quoted(f'The rule each room is held to sees it in {spelt(twice[3])} states')
        self.quoted('The last row is the one to study.')

    def test_the_exercises_work_out(self):
        # A slot of 2 bits, and a clock that runs from time 0 to time 5.
        values, times = 2 ** 2, 6
        self.assertEqual((values * times + 1, times + 1), (25, 7))
        self.assertEqual((round(math.log2(25), 2), round(math.log2(7), 2)), (4.64, 2.81))
        self.quoted('That is $4\\times6+1=25$ things, or $\\log_2 25\\approx4.64$ bits.', self.chapter)
        self.quoted('7 things, or $\\log_2 7\\approx2.81$ bits', self.chapter)
        # The build that opens early: its worker has 2 things to show, and the walk counts its states by time.
        early = self.guards['early-release']
        self.assertEqual(early[4], 2)
        self.quoted(f'with {early[2] - 1} others', self.chapter)
        self.quoted('which is why its worker has 2 things to show and not 5', self.chapter)
        self.assertEqual(self.walk['prompt'][4], 5)
        self.quoted('\\pdexercisepointer{\\ref{ex:sealed-pairs}}{\\ref{ex:sealed-gate-work}}', self.chapter)


if __name__ == '__main__':
    unittest.main()
