"""Chapter 3's build section quotes facts from its recorded runs. Check each against its run.

The section's listings cannot drift, because they are the recorded files.
Everything else in the section was typed by hand and can. A sentence
that says "1,870 states" was written by hand from a table the kernel
printed, and a later recording may print a different table. Each test here
reads a fact out of a recorded run and requires the sentence that quotes it.
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
WHOLE_RUNS = ['honest-submitted', 'launder-submitted', 'timing-on-request', 'launder-core', 'timing-core', 'worlds',
              'worlds-guards']
PART_RUNS = {'launder-on-request': [(6, '1,5,8-9,14-15')], 'kani-release': [(11, '1-11'), (14, '1,12-24')]}
PLOTTED = {'submitted': 'worlds-each-submitted', 'on-request': 'worlds-each-on-request', 'core': 'worlds-each'}
SNIPPETS = ['ch03-slot', 'ch03-submitted', 'ch03-on-request', 'ch03-tick', 'ch03-what', 'ch03-when', 'ch03-pair',
            'ch03-kani-pair']
GATES = ['submitted', 'on-request', 'core']
GUARDS = ['trust-candidate', 'raw-record', 'early-release', 'release-twice']
LEAK = 'verdict: ERIN CAN DISTINGUISH A RECORD OF 0 FROM A RECORD OF 2, AND THE SLOT RELEASES ONLY THEIR PARITY'
SAME = 'verdict: erin has seen the same thing in both worlds: '
TWO_ROOMS = 'two_rooms_with_the_same_declared_bits_release_the_same'
RELEASE = 'a_release_is_the_declared_bits_at_the_deadline'
CONTROL = 'control_a_gate_that_reads_the_candidate_is_caught'


def prose(path):
    """The file's text with comments dropped and white space collapsed."""
    lines = [re.split(r'(?<!\\)%', line, maxsplit=1)[0] for line in path.read_text().splitlines()]
    return re.sub(r'\s+', ' ', ' '.join(lines))


def run(name):
    """A recorded run, as lines."""
    return (EXCERPTS / f'{name}.txt').read_text().splitlines()


def joined(name):
    """A recorded scenario with each wrapped line joined to the line it continues."""
    lines = []
    for line in run(name):
        if line.startswith(' ' * 9) and not line.strip().startswith('erin') and lines:
            lines[-1] += ' ' + line.strip()
        else:
            lines.append(line)
    return lines


def worlds(line):
    """The two cells at the end of one line of a run in two worlds, one for each world."""
    return line[35:51].strip(), line[51:].strip()


def step(name, number):
    """One step of a recorded scenario, and the line after it if Erin saw something."""
    lines = run(name)
    at = next(index for index, line in enumerate(lines) if line.startswith(f'step {number} '))
    erin = lines[at + 1] if lines[at + 1].strip().startswith('erin') else None
    return lines[at], erin


def seen(name):
    """What Erin has seen by the end of a run, in each world."""
    return worlds(next(line for line in run(name) if line.startswith('erin has seen')))


def verdict(name):
    return next(line for line in joined(name) if line.startswith('verdict: '))


def table(name, rows):
    """A recorded table: for each named row, its counts."""
    found = {}
    for line in run(name):
        cells = line.split()
        if cells and cells[0] in rows and len(cells) > 1 and all(cell.isdigit() for cell in cells[1:]):
            found[cells[0]] = [int(cell) for cell in cells[1:]]
    return found


def outputs():
    """The plotted tables. Each row is a gate and a record, with the time and value of the release or None for each."""
    found = []
    for gate, name in PLOTTED.items():
        lines = run(name)
        assert f'under design {gate}:' in lines[1], lines[1]
        rows = [line.split() for line in lines if line and line[0] not in '#$']
        assert rows[0] == ['record', 'released', 'at', 'value'], rows[0]
        for record, released, at, value in ([int(cell) for cell in row] for row in rows[1:]):
            assert released in (0, 1) and (released or (at, value) == (0, 0)), (name, record, released, at, value)
            found.append((gate, record, at if released else None, value if released else None))
    return found


def with_commas(count):
    """A count as the Book prints it, with a comma for thousands."""
    return f'{count:,}'


class QuotedFacts(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.text = prose(SECTION)
        cls.chapter = prose(CHAPTER)
        cls.caption = prose(FIGURE)
        # states, leaks, by value, by timing, outputs
        cls.test = table('worlds', GATES)
        # states, by value, by timing, incorrect, outputs
        cls.guards = table('worlds-guards', GUARDS)

    def quoted(self, sentence, where=None):
        self.assertIn(sentence, self.text if where is None else where)

    def test_every_run_and_snippet_is_printed_with_the_right_room(self):
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
            # Between them the parts print the run through to its last line.
            self.assertEqual(max(int(span.split('-')[-1]) for _, lines in parts for span in lines.split(',')), length, name)
        manifest = json.loads((EXCERPTS / 'manifest.json').read_text())
        recorded = {session['name'] for session in manifest['sessions']}
        self.assertLessEqual(set(WHOLE_RUNS) | set(PART_RUNS) | set(PLOTTED.values()), recorded)
        # Every snippet this build has is printed in this section.
        cut = {excerpt['name'] for excerpt in manifest['excerpts'] if excerpt['name'].startswith('ch03-')}
        self.assertEqual(cut, set(SNIPPETS))
        figure = FIGURE.read_text()
        for name in PLOTTED.values():
            self.assertIn('{excerpts/%s.txt}' % name, figure)

    def test_the_first_gate_is_correct_for_a_worker_that_submits_the_record(self):
        name = 'honest-submitted'
        self.assertEqual(run(name)[4].split(), ['record', '0', 'record', '2'])
        submitted, erin = step(name, 3)
        self.assertIn('worker submits the record', submitted)
        self.assertEqual(worlds(submitted), ('0', '2'))
        self.assertEqual(worlds(erin), ('0', '0'))
        self.assertEqual(seen(name), ('0 at time 0', '0 at time 0'))
        self.assertEqual(verdict(name), SAME + '0 at time 0')
        self.quoted("Derek's record is 0 in one world and 2 in the other")
        self.quoted('The slot releases their parity, which is 0 in both')
        self.quoted('Erin sees 0 in both worlds. A test with an honest worker would pass this gate.')

    def test_the_first_break(self):
        name = 'launder-submitted'
        submitted, erin = step(name, 3)
        self.assertIn('worker submits half of it', submitted)
        self.assertEqual(worlds(submitted), ('0', '1'))
        self.assertEqual(worlds(erin), ('0', '1'))
        self.assertEqual(seen(name), ('0 at time 0', '1 at time 0'))
        self.assertEqual(verdict(name), LEAK)
        self.assertEqual((0 // 2, 2 // 2), (0, 1))
        self.quoted('Half of 0 is 0, and half of 2 is 1.')
        self.quoted('released 0 in one world and 1 in the other')
        self.quoted("Erin now knows the record's second bit")
        # The chapter's own figure proposed the same worker.
        self.quoted('If the worker first computes $t=f(s)=\\lfloor s/2\\rfloor$, the same gate instead releases $0$ and $1$.',
                    self.chapter)
        self.quoted('proposed $t=\\lfloor s/2\\rfloor$')

    def test_the_second_gate_fixes_the_first_break_and_has_one_of_its_own(self):
        fixed = 'launder-on-request'
        submitted, erin = step(fixed, 3)
        self.assertEqual(worlds(submitted), ('0', '1'))
        self.assertEqual(worlds(erin), ('0', '0'))
        self.assertEqual(verdict(fixed), SAME + '0 at time 0')
        # The printed lines, in order: the column headings and the step, then what Erin saw and the result.
        lines = run(fixed)
        self.assertTrue(lines[4].strip().startswith('record 0'))
        self.assertTrue(lines[7].startswith('step 3 '))
        self.assertTrue(lines[8].strip().startswith('erin'))
        self.assertTrue(lines[13].startswith('erin has seen'))
        self.assertTrue(lines[14].startswith('verdict: '))
        self.quoted('The first break, fixed. The submitted value no longer reaches Erin.')
        name = 'timing-on-request'
        first, erin_first = step(name, 3)
        self.assertEqual(worlds(first), ('0', 'waits'))
        self.assertEqual(worlds(erin_first), ('0', '-'))
        second, erin_second = step(name, 5)
        self.assertEqual(worlds(second), ('waits', '2'))
        self.assertEqual(worlds(erin_second), ('-', '0'))
        self.assertIn('clock  time 1', step(name, 4)[0])
        self.assertEqual(seen(name), ('0 at time 0', '0 at time 1'))
        self.assertEqual(verdict(name), LEAK)
        self.quoted('The second break. The value is the same in both worlds, and the time is not.')
        self.quoted('It was released at time 0 in one world and at time 1 in the other')
        self.quoted('can ask immediately in one world and one tick later in the other')

    def test_the_fix_gives_the_same_output_in_both_runs(self):
        for name in ('launder-core', 'timing-core'):
            self.assertEqual(seen(name), ('0 at time 2', '0 at time 2'), name)
            self.assertEqual(verdict(name), SAME + '0 at time 2', name)
            lines = run(name)
            submits = [index for index, line in enumerate(lines) if line.startswith('step ') and 'worker submits' in line]
            self.assertTrue(submits, name)
            # Nothing is released when the worker submits: the next line is another step.
            for index in submits:
                self.assertTrue(lines[index + 1].startswith('step '), name)
            release = next(index for index, line in enumerate(lines) if line.strip().startswith('erin   sees'))
            self.assertIn('clock  time 2', lines[release - 1], name)
            self.assertEqual(worlds(lines[release]), ('0', '0'), name)
        self.quoted('Nothing is released when the worker submits a value. The parity is released when the clock reaches '
                    'time 2, in both worlds.')
        # The runs use the slot the section describes.
        self.assertIn('a slot that releases the lowest bit at time 2', ' '.join(line.strip() for line in run('worlds')[1:5]))

    def test_the_listings_say_what_the_prose_says_about_them(self):
        code = lambda name: (EXCERPTS / f'{name}.code').read_text()
        self.assertIn('const value = low(this.slot.bits, candidate);', code('ch03-submitted'))
        self.assertIn('const record = this.committed;', code('ch03-on-request'))
        self.assertIn('const value = low(this.slot.bits, record);', code('ch03-on-request'))
        self.quoted('The first version. \\texttt{low} keeps the low bits that the slot declares.')
        self.quoted('The second version. The value comes from the committed record, and the worker chooses when it is '
                    'released.')
        tick = code('ch03-tick')
        for called in ('due(room, now)', 'spent(room)', 'source(room)', 'declared(room, from)'):
            self.assertIn(called, tick)
        self.assertIn('pub fn tick(room: &Room, now: u64) -> RoomUpdate {', tick)
        self.assertEqual(tick.count('return unchanged(room);'), 2)
        self.quoted('\\texttt{tick} is given the room and the current time.')
        what, when = code('ch03-what'), code('ch03-when')
        self.assertEqual(re.findall(r'^fn (\w+)', what, flags=re.M), ['source', 'declared'])
        self.assertEqual(re.findall(r'^fn (\w+)', when, flags=re.M), ['due', 'spent'])
        self.assertEqual((what.count('MUTANT'), when.count('MUTANT')), (2, 2))
        self.assertEqual(sorted(re.findall(r'feature = "mutant-([\w-]+)"', what + when)), sorted(GUARDS))
        self.quoted("Those four functions are the gate's guards, in two pairs.")
        self.quoted('The guards on the value released. A line marked \\texttt{MUTANT} is compiled only into a test build '
                    'of the core that has that guard removed.')
        self.quoted('The guards on the time of the release.')
        self.quoted('This build has four guards.')
        self.assertIn('    room.committed\n', what)
        self.assertIn('from & ((1 << bits) - 1)', what)
        self.quoted('\\texttt{source} reads the record its owner committed, and \\texttt{declared} keeps only the bits '
                    'the slot declares.')
        self.assertIn('    now >= room.slot.deadline\n', when)
        self.assertIn('    room.used\n', when)
        self.quoted("\\texttt{due} compares the current time with the slot's deadline, and does not look at anything the "
                    'worker did. \\texttt{spent} allows the slot to be used once.')
        # The exercise about the build that releases early reads the listing of these guards.
        self.assertIn('return true; // MUTANT: release when the worker asks.', when)
        self.quoted('Listing~\\ref{alg:sealed-gate-when} marks one line of \\texttt{due} as belonging to a build with '
                    'that guard removed.', self.chapter)
        slot = code('ch03-slot')
        self.assertIn('pub bits: u8,', slot)
        self.assertIn('pub deadline: u64,', slot)
        self.quoted("which says how many of the record's low bits are released and when")
        pair = code('ch03-pair')
        self.assertIn("if (!committed) steps.push(['commit', commit(a), commit(b)]);", pair)
        self.assertIn("steps.push(['tick', tick, tick]);", pair)
        self.assertIn('steps.push([`submit ${value}`, submit, submit]);', pair)
        self.assertIn('steps.push([`A submits ${value}`, submit, idle]);', pair)
        self.quoted('A worker that has not read the record does the same thing in both worlds.')
        kani = code('ch03-kani-pair')
        self.assertIn('fn two_rooms() -> (Room, Room) {', kani)
        self.assertIn(f'fn {TWO_ROOMS}() {{', kani)
        self.assertEqual(kani.count('kani::cover!('), 2)
        self.assertIn('kani::assume(a.used == b.used);', kani)
        self.assertIn('assert!(after_a.out == after_b.out);', kani)
        self.assertIn('assert!(after_a.used == after_b.used);', kani)
        self.quoted('Its two \\texttt{cover} lines make the solver find a case')
        self.quoted('They have the same slot, used in both or in neither. Their records have the same declared bits.')

    def test_the_exhaustive_test(self):
        header = ' '.join(line.strip() for line in run('worlds')[1:5])
        self.assertEqual(header, 'every reachable state of two rooms run side by side: records from 0 to 3, and a slot '
                                 'that releases the lowest bit at time 2. The clock runs to time 3, and each worker '
                                 'submits up to 2 values from 0 to 3')
        self.quoted('Records run from 0 to 3, and the slot releases one bit at time 2. The clock runs to time 3, and each '
                    'worker submits up to 2 values from 0 to 3.')
        # Of the pairs of four records, the ones with the same parity.
        same = [(a, b) for a in range(4) for b in range(a + 1, 4) if a % 2 == b % 2]
        self.assertEqual((len(same), math.comb(4, 2)), (2, 6))
        self.quoted('Two of the six pairs of records have the same parity')
        self.quoted('Two of them, $(0,2)$ and $(1,3)$, are equal-parity.', self.chapter)
        for gate in GATES:
            states, leaks, by_value, by_timing, caused = self.test[gate]
            self.assertEqual(leaks, by_value + by_timing, gate)
        states, leaks, by_value, by_timing, caused = self.test['submitted']
        self.quoted(f'Under the first gate Erin has seen different things in {with_commas(leaks)} of {with_commas(states)} '
                    f'states. In {with_commas(by_value)} of those, both rooms released something at the same time and '
                    'the values differ')
        second = self.test['on-request']
        self.assertEqual(second[2], 0)
        self.quoted(f'The second gate has no leak of that kind, and all {with_commas(second[1])} of its leaks are in the '
                    'timing.')
        kernel = self.test['core']
        self.assertEqual(kernel[1:4], [0, 0, 0])
        self.quoted(f"The kernel's gate has no leak of either kind in {with_commas(kernel[0])} states")
        self.quoted(f'finds no state, out of {with_commas(kernel[0])}, in which Erin can distinguish two records with the '
                    'same parity')
        self.assertIn('in every state the core had released what the reference model says',
                      ' '.join(line.strip() for line in run('worlds')))
        self.quoted('and in every state it had released exactly what the reference model says.')
        self.assertEqual([self.test[gate][4] for gate in GATES], [9, 5, 1])
        self.quoted('A worker that could cause 9 different outputs under the first version can cause only 1.')
        self.quoted('The exhaustive test stops at records of 2 bits and a clock that runs to 3.')
        self.quoted('The exhaustive test covers records of 2 bits and one slot of one bit. Its clock runs for 3 ticks')

    def test_the_figure_counts_what_its_tables_hold(self):
        rows = outputs()
        self.assertEqual(len(rows), 60)
        per = {(gate, record): [row[2:] for row in rows if row[:2] == (gate, record)] for gate in GATES
               for record in range(4)}
        times = range(4)
        for record in range(4):
            parity = record % 2
            # The first gate: a bit at one of four times, or no release.
            self.assertEqual(sorted(per['submitted', record], key=str),
                             sorted([(None, None)] + [(at, value) for at in times for value in (0, 1)], key=str))
            # The second: the record's own bit at one of four times, or no release.
            self.assertEqual(sorted(per['on-request', record], key=str),
                             sorted([(None, None)] + [(at, parity) for at in times], key=str))
            # The kernel's: the record's own bit at the slot's deadline.
            self.assertEqual(per['core', record], [(2, parity)])
        counts = [len(per[gate, 0]) for gate in GATES]
        self.assertEqual(counts, [self.test[gate][4] for gate in GATES])
        self.assertEqual(counts, [2 * 4 + 1, 4 + 1, 1])
        self.quoted('That is $2\\times4+1=9$ outputs, whatever the record is.')
        self.quoted('the worker still chooses among the 4 times and no release, which is 5 outputs')
        self.quoted("Under the kernel's gate there is 1, and a choice among 1 carries no information.")
        # The theorem's count for one release of one bit at one of four times.
        self.assertEqual(1 + math.log2(4), 3)
        self.assertEqual(2 ** 3, 8)
        self.quoted('a capacity of $b+\\log_2 w=3$ bits, which is 8 outputs. The ninth is no release at all.')
        self.quoted('If each release may also pick one of $w$ release times, all three parts hold with $b+\\log_2 w$ in '
                    'place of $b$.', self.chapter)
        self.quoted('the number of releases, their times and every failure fixed or padded', self.chapter)
        self.assertIn('A worker that could cause 9 outputs for one record can cause only 1.', self.caption)
        self.assertIn("A framed black square is the record's parity at the slot's deadline, and a red one is an output "
                      'the worker chose.', self.caption)
        figure = FIGURE.read_text()
        # The counts in the picture are taken from the tables as they are plotted.
        for counter in ('\\the\\pdviewsfirst', '\\the\\pdviewssecond', '\\the\\pdviewskernel'):
            self.assertIn(counter, figure)
        self.assertIn('\\ifnum\\at=2 \\ifnum\\vl=\\parity', figure)
        self.assertIn('{released}', figure)
        self.assertIn('horizontal: the time of the release, or a dash for no release', figure)
        self.assertIn('vertical: the value released', figure)

    def test_kanis_results(self):
        lines = run('kani-release')
        self.assertEqual(lines[0], '$ sh formal/release/run.sh')
        results = dict(zip(lines[1:11:2], (line.strip() for line in lines[2:11:2])))
        names = list(results)
        self.assertEqual(names, [RELEASE, 'a_used_slot_releases_nothing', CONTROL, 'only_a_tick_releases_anything',
                                 TWO_ROOMS])
        self.assertEqual(results[CONTROL], 'fails, as a control should')
        self.quoted('The third result is a control.')
        for name in names:
            if name != CONTROL:
                self.assertTrue(results[name].startswith('successful'), name)
        self.assertIn('its 2 covers are satisfied', results[TWO_ROOMS])
        self.quoted('A second harness shows that a commit and a submission release nothing.')
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
        self.quoted('The harnesses again, on the same four builds.')
        # The two printed parts meet where the builds with a guard removed begin.
        self.assertEqual(len(lines), 24)
        # The build that releases twice passes the two-room harness.
        self.assertNotIn(TWO_ROOMS, failing['release-twice'])
        self.assertIn(RELEASE, failing['release-twice'])
        self.quoted('Kani detects it too.')
        self.quoted('The harness \\texttt{a\\_release\\_is\\_the\\_declared\\_bits\\_at\\_the\\_deadline} checks the same '
                    'thing on the code, for any room.', self.chapter)

    def test_each_guard_removed(self):
        self.assertEqual(list(self.guards), GUARDS)
        # Every build is incorrect against the reference model in some state.
        for name in GUARDS:
            self.assertGreater(self.guards[name][3], 0, name)
        first, raw, early, twice = (self.guards[name] for name in GUARDS)
        self.assertTrue(first[1] > 0 and first[2] == 0)
        self.quoted('The first row is the first break, inside the core.')
        self.assertTrue(raw[1] > 0 and raw[2] == 0)
        self.assertEqual(raw[4], 1)
        self.quoted('that build still has 1 output for each record')
        self.assertTrue(early[1] == 0 and early[2] > 0)
        self.quoted('The third build releases early when the worker has asked, which is the second break.')
        self.assertEqual((twice[1], twice[2]), (0, 0))
        self.quoted(f'in every one of {with_commas(twice[0])} states, because both rooms repeat the release identically')
        self.quoted(f'The comparison with the reference model detects it in {with_commas(twice[3])} states')
        self.quoted('The last row is the important one.')
        self.quoted('The two-room check cannot detect that this guard is missing.')

    def test_the_exercises_are_worked_correctly(self):
        # A slot of 2 bits, and a clock that runs from time 0 to time 5.
        values, times = 2 ** 2, 6
        self.assertEqual((values * times + 1, times + 1), (25, 7))
        self.assertEqual((round(math.log2(25), 2), round(math.log2(7), 2)), (4.64, 2.81))
        self.quoted('That is $4\\times6+1=25$ outputs, or $\\log_2 25\\approx4.64$ bits.', self.chapter)
        self.quoted('7 outputs, or $\\log_2 7\\approx2.81$ bits', self.chapter)
        # The build that releases early: its worker can cause 2 outputs, and its leaks are in the timing.
        early = self.guards['early-release']
        self.assertEqual(early[4], 2)
        self.quoted(f'with {early[2] - 1} others', self.chapter)
        self.quoted('which is why its worker can cause 2 outputs and not 5', self.chapter)
        self.assertEqual(self.test['on-request'][4], 5)
        self.quoted('\\pdexercisepointer{\\ref{ex:sealed-pairs}}{\\ref{ex:sealed-gate-work}}', self.chapter)


if __name__ == '__main__':
    unittest.main()
