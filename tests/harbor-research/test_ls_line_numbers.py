"""Chapter 4's build section quotes facts from its recorded runs. Hold each to its run.

The section's listings cannot drift: they are the recorded files. Its prose
can, and so can its figure's caption and its exercises. A sentence that says
"1,214 of 10,094 landings" was written by hand from a table the kernel
printed, and a later recording may print another table. Each test here reads
a fact out of a recorded run and requires the sentence that quotes it.
"""
import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
EXCERPTS = ROOT / 'book' / 'excerpts'
SECTION = ROOT / 'book' / 'additions' / 'ls-build-the-line.tex'
FIGURE = ROOT / 'book' / 'figures' / 'fig-ls-line-landings.tex'
CHAPTER = ROOT / 'book' / 'legible-swarm.tex'
WHOLE_RUNS = ['green-said', 'borrowed-linked', 'switch-linked', 'green-core', 'switch-core', 'lines', 'lines-guards']
PART_RUNS = {'borrowed-core': [(11, '1,8-17')], 'pile-core': [(13, '1,11-22')],
             'kani-zoom': [(9, '1-9'), (14, '1,10-22')]}
PLOTTED = 'lines-each'
SNIPPETS = ['ch04-said', 'ch04-linked', 'ch04-render', 'ch04-render-guards', 'ch04-open', 'ch04-same', 'ch04-land',
            'ch04-land-guards', 'ch04-kani']
SURFACES = ['said', 'linked', 'core']
GUARDS = ['bare-line', 'any-run', 'trust-store', 'land-unverified', 'land-unseen', 'count-opened']
LANDS_WHOLE = 'work_lands_only_verified_and_read'
LINE_WHOLE = 'a_line_is_verified_only_by_a_run_of_its_revision'


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


def steps(name):
    """The steps of a recorded scenario, each as one line."""
    return [re.sub(r'\s+', ' ', line) for line in said(name) if line.startswith('step ')]


def verdict(name):
    return next(re.sub(r'\s+', ' ', line) for line in said(name) if line.startswith('verdict: '))


def table(name, rows):
    """A recorded table: for each named row, its counts."""
    found = {}
    for line in run(name):
        cells = line.split()
        if cells and cells[0] in rows and all(cell.isdigit() for cell in cells[1:]):
            found[cells[0]] = [int(cell) for cell in cells[1:]]
    return found


def landings():
    """The plotted table: for each surface, its landings sorted by what was wrong with them."""
    lines = run(PLOTTED)
    assert lines[0] == '$ harbor lines --each', lines[0]
    assert '# surface 1: said; 2: linked; 3: core' in lines, lines
    rows = [line.split() for line in lines if line and line[0] not in '#$']
    assert rows[0] == ['surface', 'landings', 'right', 'unread', 'unverified', 'neither'], rows[0]
    found = {}
    for number, *counts in ([int(cell) for cell in row] for row in rows[1:]):
        found[SURFACES[number - 1]] = dict(zip(rows[0][1:], counts))
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
        # states, lines, say more than show, landings, not verified, not read
        cls.walk = table('lines', SURFACES)
        # lines, say more than show, lead nowhere, landings, not verified, not read
        cls.guards = table('lines-guards', GUARDS)
        cls.kinds = landings()

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
        self.assertLessEqual(set(WHOLE_RUNS) | set(PART_RUNS) | {PLOTTED}, recorded)
        # Every snippet this build has is in this section.
        cut = {excerpt['name'] for excerpt in manifest['excerpts'] if excerpt['name'].startswith('ch04-')}
        self.assertEqual(cut, set(SNIPPETS))
        self.assertIn('{excerpts/%s.txt}' % PLOTTED, FIGURE.read_text())
        self.quoted('The runs above are seven afternoons.')
        self.assertEqual(len(WHOLE_RUNS) - 2 + len(PART_RUNS) - 1, 7)

    def test_the_first_break(self):
        name = 'green-said'
        found = steps(name)
        self.assertIn('drake repairs the retry, and deletes the test -> revision 8', found[0])
        self.assertTrue(found[1].endswith('kernel runs the kept test on revision 8 -> failed'))
        self.assertIn('-> drake | checkout repair | all green', found[3])
        self.assertTrue(found[4].endswith('alice lands it -> landed revision 8'))
        self.assertEqual(verdict(name), 'verdict: ALICE LANDED REVISION 8, AND NO RUN OF THE TEST SHE WAS TOLD TO KEEP '
                                        'HAD PASSED ON IT')
        self.quoted('Drake repairs the retry and deletes the kept test')
        self.quoted('The kernel ran the kept test on revision~8, and it failed.')
        self.quoted('she landed work that the record called broken')
        self.quoted('Five processes begin from revision~7.', self.chapter)
        self.quoted('which starts at revision~7')

    def test_the_second_break(self):
        name = 'borrowed-linked'
        found = steps(name)
        self.assertIn("attaching heron's log", found[2])
        self.assertTrue(found[3].split('-> ')[1].startswith('drake | checkout repair | all green | see '))
        self.assertTrue(found[4].endswith('alice opens claim 1 -> shown: checkout.test at revision 7: 4 passed'))
        self.assertTrue(found[5].endswith('alice lands it -> landed revision 8'))
        self.assertEqual(verdict(name), verdict('green-said'))
        self.quoted("It is a run of revision~7, and Drake's work stands at revision~8.")
        self.quoted('The log Alice is shown is real, and the run in it passed.')
        self.quoted('A passing receipt for another tree cannot close this obligation.', self.chapter)
        self.quoted('a passing receipt for another tree cannot close the obligation')
        self.quoted('A dishonest agent could still fabricate or reuse Row~A\'s log', self.chapter)

    def test_the_third_break(self):
        name = 'switch-linked'
        found = steps(name)
        self.assertTrue(found[1].endswith('kernel runs the kept test on revision 8 -> passed'))
        self.assertIn('alice opens claim 1', found[4])
        self.assertTrue(found[5].endswith('alice opens claim 2 -> shown: checkout.test at revision 8: 4 passed'))
        self.assertTrue(found[6].endswith('wren adds a migration to the change -> revision 9'))
        self.assertTrue(found[7].endswith('kernel runs the kept test on revision 9 -> passed'))
        self.assertTrue(found[8].endswith('alice lands it -> landed revision 9'))
        self.assertEqual(verdict(name), 'verdict: ALICE LANDED REVISION 9, AND SHE HAD NOT BEEN SHOWN ITS DIFF')
        self.quoted("Wren then added a migration, and the kernel's run of revision~9 passed. The surface landed "
                    'revision~9.')
        self.quoted('claims 1 and 2 were still ticked')
        self.quoted('She read one revision and landed another.')
        self.quoted('The next break needs no false word from anyone')

    def test_the_fix_refuses_each_break_and_lands_work_that_was_read(self):
        green = steps('green-core')
        line = green[3].split('-> ')[1]
        self.assertTrue(line.startswith('drake | checkout repair | revision 8 | NOT VERIFIED | diff '), line)
        self.assertIn('| test failed ', line)
        self.assertIn('refused: not-verified', green[4])
        self.assertEqual(verdict('green-core'), 'verdict: nothing was landed')
        self.quoted('The line says \\texttt{NOT VERIFIED}, and it names the failing log by its hash.')
        # The second break: what the worker attached is not on the line.
        borrowed = steps('borrowed-core')
        self.assertIn("attaching heron's log", borrowed[2])
        self.assertEqual(borrowed[3].split('-> ')[1], line)
        self.assertTrue(borrowed[4].endswith('alice opens claim 1 -> shown: delete tests/checkout.test'))
        self.assertIn('refused: not-verified', borrowed[5])
        self.assertEqual(verdict('borrowed-core'), 'verdict: nothing was landed')
        self.quoted('The claim Alice opens is the diff of revision~8, and it shows her the deletion.')
        # The lines of it that are printed start where the worker attaches the log.
        self.assertTrue(run('borrowed-core')[7].startswith('step 3 '))
        # The third break: the line after the change names a diff she has not opened.
        switch = steps('switch-core')
        self.assertIn('| revision 8 | verified | diff ', switch[3])
        self.assertTrue(switch[6].endswith('wren adds a migration to the change -> revision 9'))
        self.assertIn('refused: not-opened (claim 1 of the line has not been opened)', switch[8])
        self.assertEqual(verdict('switch-core'), 'verdict: nothing was landed')
        # Her openings are those of the run at the second surface.
        self.assertEqual([step.split(' -> ')[0] for step in switch[4:6]],
                         [step.split(' -> ')[0] for step in steps('switch-linked')[4:6]])
        self.quoted('the new line names a new diff, and Alice has not opened it')
        # Verified work lands once it has been opened, and not before.
        pile = steps('pile-core')
        self.assertIn('refused: not-opened (claim 1 of the line has not been opened)', pile[4])
        self.assertIn('alice opens claim 1', pile[5])
        self.assertIn('alice opens claim 2', pile[6])
        self.assertTrue(pile[7].endswith('alice lands it -> landed revision 8'))
        # The lines of it that are printed start where she first tries to land. The steps left out are the first
        # four of the run before it.
        self.assertTrue(run('pile-core')[10].startswith('step 5 '))
        self.assertEqual(pile[:4], switch[:4])
        self.quoted('The steps left out are the first four of Listing~\\ref{alg:ls-line-run-switch-core}.')
        # The order of the checks in land, as the prose gives it.
        self.assertIn('refused: not-verified', borrowed[5])
        self.quoted('Work that is not verified is refused for that, whatever has been opened')
        self.quoted('Verified work is refused with the number of the first claim that is still unopened')
        self.assertEqual(verdict('pile-core'), 'verdict: revision 8 was landed: the kept test had passed on it, and alice '
                                               'had been shown its diff')
        self.quoted('Verified work that nobody has opened does not land, and it lands once it has been opened')
        self.quoted('A landing is \\emph{right} if a run of the kept test had passed on the revision that landed, and Alice '
                    "had been shown that revision's diff.")

    def test_the_listings_say_what_the_prose_says_of_them(self):
        code = lambda name: (EXCERPTS / f'{name}.code').read_text()
        first = code('ch04-said')
        self.assertIn('return { text: `${agent} | ${job} | ${said}`, claims: [] };', first)
        self.assertIn('this.at = { ...this.at, landed: this.at.revision };', first)
        self.quoted("The first try. The line is the worker's words, and landing waits for nothing.")
        second = code('ch04-linked')
        self.assertIn('if (links.length === 0 || !stored) {', second)
        self.assertIn('const seen = links.every((_, claim) => ticked.includes(claim));', second)
        self.quoted('The second try. A line needs links, and landing waits for each to be opened.')
        self.quoted("Drake's bare ``all green'' is refused now, because nothing is attached to it.")
        self.quoted('It had kept the numbers of the claims she opened')
        render, behind = code('ch04-render'), code('ch04-render-guards')
        self.assertEqual(re.findall(r'^(?:pub )?fn (\w+)', render, flags=re.M), ['render'])
        self.assertEqual(re.findall(r'^(?:pub )?fn (\w+)', behind, flags=re.M), ['backing', 'current'])
        self.assertIn('let mut claims = vec![claim(Says::Changed, diff)];', render)
        self.assertIn('let verified = run.is_some_and(|run| run.passed);', render)
        self.assertIn('return Err(Reason::NothingBehind);', render)
        self.assertIn('.filter(|run| run.revision == work.revision)', behind)
        self.quoted('\\texttt{backing} makes no line for work with no diff stored.')
        self.quoted('\\texttt{current} lets a run count only if it is a run of the revision the work stands at.')
        self.quoted('The first claim is that the change is this diff.')
        self.quoted('The line is marked verified only if such a run passed')
        self.quoted('\\texttt{current} leaves it off the line')
        self.quoted('Nothing the worker says is an input to \\texttt{render}')
        self.assertNotIn('said', render + behind)
        opened, same = code('ch04-open'), code('ch04-same')
        self.assertEqual(re.findall(r'^(?:pub )?fn (\w+)', opened, flags=re.M), ['open'])
        self.assertEqual(re.findall(r'^(?:pub )?fn (\w+)', same, flags=re.M), ['same'])
        self.assertIn('if !same(&named.sha, shown) {', opened)
        self.assertIn('read.opened.push(named.sha.clone());', opened)
        self.assertIn('hex(&Sha256::digest(shown.as_bytes())) == *sha', same)
        self.quoted("What the core then records is the claim's hash and not its number")
        self.quoted("\\texttt{same} hashes the text again and compares the result with the claim's own hash")
        land, waits = code('ch04-land'), code('ch04-land-guards')
        self.assertEqual(re.findall(r'^(?:pub )?fn (\w+)', land, flags=re.M), ['land'])
        self.assertEqual(re.findall(r'^(?:pub )?fn (\w+)', waits, flags=re.M), ['unopened', 'seen'])
        self.assertIn('let read = read(work)?;', land)
        self.assertLess(land.index('if !verified(&read.line) {'), land.index('if let Some(claim) = unopened(&read) {'))
        self.assertIn('read.opened.contains(&claim.sha)', waits)
        self.assertIn('return read.opened.len() > number;', waits)
        self.assertIn('.find(|at| !seen(read, *at))', waits)
        self.quoted('It begins with \\texttt{read}, which calls \\texttt{render}')
        self.quoted('\\texttt{seen} is the comparison it makes')
        # Five guards are printed, and the sixth is called by land.
        guarded = behind + same + waits
        printed = re.findall(r'feature = "mutant-([\w-]+)"', guarded)
        self.assertEqual(len(printed), 5)
        self.assertEqual(sorted(printed + ['land-unverified']), sorted(GUARDS))
        self.assertEqual(guarded.count('MUTANT'), 5)
        self.assertEqual((render + opened + land).count('MUTANT'), 0)
        self.quoted('This build has six guards. Five are in the listings above, and the sixth is the \\texttt{verified} '
                    'that \\texttt{land} calls.')
        kani = code('ch04-kani')
        self.assertIn(f'fn {LANDS_WHOLE}() {{', kani)
        self.assertIn('let work = any_work();', kani)
        self.assertEqual((kani.count('assert!('), kani.count('kani::cover!(')), (2, 1))
        self.quoted("the harness's 2 assertions say that the line is verified and that every claim on it is among the "
                    'hashes opened')
        self.quoted('Its \\texttt{cover} line makes the solver find a record that does land.')
        # The exercises read these listings.
        self.quoted('\\texttt{land} checks that first and refuses with \\texttt{NotVerified}.', self.chapter)
        self.assertIn('return Err(Reason::NotVerified);', land)
        self.assertIn('return Err(Reason::NotOpened { claim });', land)
        self.quoted('It finds more than 0 things opened for the first claim and more than 1 for the second',
                    self.chapter)
        self.quoted('Listing~\\ref{alg:ls-line-land-guards} marks a change to \\texttt{seen} as a build of its own.',
                    self.chapter)
        self.assertEqual(waits[waits.index('fn seen'):].count('MUTANT'), 1)

    def test_the_walk(self):
        header = ' '.join(line.strip() for line in run('lines')[1:6])
        self.assertEqual(header, 'every afternoon of one piece of work: the worker changes it up to 2 times, well or badly, '
                                 'and says up to 2 things of it. The kernel runs the kept test when it gets to it, and the '
                                 'store may go wrong once. The operator opens up to 3 claims, and may land the work in any '
                                 'state')
        self.quoted('The worker changes the work up to 2 times, well or badly, and says up to 2 things of it.')
        self.quoted('The store goes wrong at most once')
        self.quoted('Alice opens up to 3 claims, and she may try to land in any state.')
        self.quoted('2 changes, 2 sayings, 3 openings and one fault of the store')
        self.quoted('The walk stops at 2 changes and 3 openings.')
        states, lines, more, lands, unverified, unread = self.walk['said']
        self.assertEqual((lines, lands, unread), (states, states, states))
        self.quoted(f'The first surface shows a line in each of its {spelt(states)} states, and {spelt(more)} of those '
                    'lines say more than they show. It lets the work land in every state.')
        states, lines, more, lands, unverified, unread = self.walk['linked']
        self.quoted(f'The second surface has {spelt(lands)} states in which work can land. In {spelt(unverified)} of them '
                    f'no run of the work had passed, and in {spelt(unread)} Alice had not been shown its diff.')
        states, lines, more, lands, unverified, unread = self.walk['core']
        self.assertEqual((more, unverified, unread), (0, 0, 0))
        self.quoted(f"The kernel's surface shows {spelt(lines)} lines, and none says more than it shows. It lets work land "
                    f'in {spelt(lands)} states, each of them verified and read, and it refused no landing that was both.')
        self.assertIn('the core refused no landing of work that was verified and read', run('lines'))
        # The express lane quotes the same counts.
        second, kernel = self.walk['linked'][3], self.walk['core'][3]
        self.quoted(f'counts {spelt(second)} states in which the second surface lets work land, and '
                    f"{spelt(self.kinds['linked']['right'])} of them are right. Under the kernel's surface all "
                    f'{spelt(kernel)} are.')

    def test_the_figure_sorts_the_landings_the_walk_counted(self):
        for position, surface in enumerate(SURFACES):
            kinds = self.kinds[surface]
            states, lines, more, lands, unverified, unread = self.walk[surface]
            self.assertEqual(kinds['landings'], lands, surface)
            self.assertEqual(kinds['right'] + kinds['unread'] + kinds['unverified'] + kinds['neither'], lands, surface)
            self.assertEqual(kinds['unverified'] + kinds['neither'], unverified, surface)
            self.assertEqual(kinds['unread'] + kinds['neither'], unread, surface)
        first, second, kernel = (self.kinds[surface] for surface in SURFACES)
        self.assertEqual((first['right'], first['unverified']), (0, 0))
        self.quoted(f"Under the first surface no landing is right, because it has nothing to open. In "
                    f"{spelt(first['unread'])} of them the work happened to be verified, and in the other "
                    f"{spelt(first['neither'])} it was not.")
        self.quoted(f"Under the second surface {spelt(second['right'])} of {spelt(second['landings'])} landings are right, "
                    'which is about one in eight.')
        self.assertEqual(round(second['landings'] / second['right']), 8)
        self.quoted(f"In {spelt(second['neither'])} the work was neither verified nor read.")
        self.assertEqual(kernel['right'], kernel['landings'])
        self.quoted("Under the kernel's surface the bar has one kind.")
        self.assertIn(f"Of {spelt(second['landings'])} landings under the surface with links, {spelt(second['right'])} "
                      'were right.', self.caption)
        self.assertIn('Black is a landing of verified work whose diff Alice had been shown.', self.caption)
        figure = FIGURE.read_text()
        # The counts in the picture are taken from the table as it is drawn.
        for column in ('landings', 'right', 'unread', 'unverified', 'neither'):
            self.assertIn('\\pgfplotstablegetelem{\\row}{%s}\\of\\pdlandings' % column, figure)
        self.assertIn('\\pgfmathprintnumber{\\pdfine} of \\pgfmathprintnumber{\\pdall} landings were right', figure)
        drawn = figure[figure.index('\\begin{tikzpicture}'):figure.index('\\end{tikzpicture}')]
        # No count is typed into the picture. The one long number in it is an option's name.
        self.assertIsNone(re.search(r'\d,\d{3}|\d{4}', drawn.replace('1000 sep={,}', '')))
        self.assertIn('across: a run of the work had passed, then none had', figure)
        self.assertIn('down: Alice had been shown its diff, then she had not', figure)
        # The exercise works the overlap out.
        wrong = second['landings'] - second['right']
        unverified, unread = self.walk['linked'][4], self.walk['linked'][5]
        self.assertEqual(unverified + unread - second['neither'], wrong)
        self.assertEqual((unverified, unread, second['neither'], wrong), (7002, 6544, 4666, 8880))
        self.quoted('$7{,}002+6{,}544-4{,}666=8{,}880$ were wrong, and $10{,}094-8{,}880=1{,}214$ were right.', self.chapter)
        self.assertEqual((unverified - second['neither'], unread - second['neither']),
                         (second['unverified'], second['unread']))
        self.quoted('$7{,}002-4{,}666=2{,}336$ landings were read and not verified, and $6{,}544-4{,}666=1{,}878$ were '
                    'verified and not read.', self.chapter)
        self.quoted('counts 10,094 landings. In 7,002 the work was not verified, and in 6,544 it was not read.',
                    self.chapter)

    def test_kanis_verdicts(self):
        lines = run('kani-zoom')
        self.assertEqual(lines[0], '$ sh formal/zoom/run.sh')
        verdicts = dict(zip(lines[1:9:2], (line.strip() for line in lines[2:9:2])))
        names = list(verdicts)
        self.assertEqual(names, ['a_gate_that_counts_what_was_opened_is_caught', LINE_WHOLE,
                                 'verified_work_that_was_read_does_land', LANDS_WHOLE])
        self.assertEqual(verdicts[names[0]], 'fails, as it must')
        for name in names[1:]:
            self.assertTrue(verdicts[name].startswith('successful'), name)
            self.assertIn('satisfied', verdicts[name], name)
        self.quoted('The first verdict is a control.')
        self.quoted('a gate that counts how many things were opened and compares no hashes')
        self.assertEqual(lines[9], 'with one guard removed, the harnesses that fail')
        failing, build = {}, None
        for line in lines[10:]:
            if line.startswith('  '):
                failing[build].append(line.strip())
            else:
                build = line
                failing[build] = []
        self.assertEqual(list(failing), GUARDS)
        # The printed halves meet where the builds with a guard removed begin.
        self.assertEqual(len(lines), 22)
        self.assertEqual(failing['bare-line'], [LINE_WHOLE])
        self.assertEqual(failing['any-run'], [LINE_WHOLE])
        for build in ('land-unverified', 'land-unseen', 'count-opened'):
            self.assertEqual(failing[build], [LANDS_WHOLE], build)
        # No harness sees the build that does not hash what the store hands over.
        self.assertEqual(failing['trust-store'], ['NONE'])
        self.quoted('and no harness fails on it')
        self.quoted('the harness \\texttt{work\\_lands\\_only\\_verified\\_and\\_read} fails on it', self.chapter)
        self.quoted('Under Kani a hash is one byte and not a string of 64 characters.')
        self.assertEqual(len('%064x' % 0), 64)

    def test_each_guard_removed(self):
        self.assertEqual(list(self.guards), GUARDS)
        # lines, say more than show, lead nowhere, landings, not verified, not read
        lines, more, nowhere, lands, unverified, unread = self.guards['any-run']
        self.assertEqual(unread, 0)
        self.quoted(f'A core that counts any run is the second break inside the core: {spelt(more)} of its lines say more '
                    f'than they show, and {spelt(unverified)} of its landings are of work no run had passed.')
        lines, more, nowhere, lands, unverified, unread = self.guards['count-opened']
        self.assertEqual((more, unverified), (0, 0))
        self.quoted(f'A core that counts what was opened is the third break, with {spelt(unread)} landings of unread work.')
        self.quoted(f'The walk finds {spelt(unread)} landings of unread work on that build', self.chapter)
        lines, more, nowhere, lands, unverified, unread = self.guards['bare-line']
        self.assertEqual((more, unverified, unread), (0, 0, 0))
        self.quoted(f'A core that makes a line with no diff behind it lands nothing wrong, and {nowhere} of its lines '
                    'lead to nothing in the store.')
        lines, more, nowhere, lands, unverified, unread = self.guards['trust-store']
        self.assertEqual((more, unverified), (0, 0))
        self.quoted(f'A core that does not hash what the store hands over lands unread work in {spelt(unread)} states of '
                    'the walk')
        # Every build with a guard removed is seen by the walk.
        for name in GUARDS:
            lines, more, nowhere, lands, unverified, unread = self.guards[name]
            self.assertGreater(more + nowhere + unverified + unread, 0, name)
        self.quoted('The row to study is \\texttt{trust-store}.')
        # The build this is set beside is Chapter 3's, whose walk could not see one guard.
        self.quoted('\\weld{sealed:sec:sealed-gate}{walk of pairs}')
        self.assertIn('The walk of pairs cannot see that guard at all.',
                      prose(ROOT / 'book' / 'additions' / 'sealed-build-the-gate.tex'))

    def test_the_exercises_point_where_the_chapter_says(self):
        self.quoted('\\pdexercisepointer{\\ref{ex:ls-flatten-or-preserve}}{\\ref{ex:ls-line-read}}', self.chapter)
        self.assertLess(self.chapter.index('{ex:ls-adversarial-legibility}'), self.chapter.index('{ex:ls-line-kinds}'))
        self.assertLess(self.chapter.index('\\begin{pdsolution}{ex:ls-line-read}'),
                        self.chapter.index('\\pdexercisesfor{\\S\\ref{sec:authority-rules}}'))
        self.assertIn('\\input{additions/ls-build-the-line}', CHAPTER.read_text())


if __name__ == '__main__':
    unittest.main()
