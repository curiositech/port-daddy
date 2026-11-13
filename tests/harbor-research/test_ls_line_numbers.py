"""Chapter 4's build section quotes facts from its recorded runs. Check each against its run.

The section's listings cannot drift, because they are the recorded files.
Everything else in the section was typed by hand and can. A sentence
that says "1,214 of 10,094 landings" was written by hand from a table the
kernel printed, and a later recording may print a different table. Each
test here reads a fact out of a recorded run and requires the sentence that
quotes it.
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
WHOLE_RUNS = ['green-self-reported', 'borrowed-linked', 'switch-linked', 'green-core', 'switch-core', 'lines', 'lines-guards']
PART_RUNS = {'borrowed-core': [(11, '1,8-17')], 'pile-core': [(13, '1,11-22')],
             'kani-zoom': [(9, '1-9'), (14, '1,10-22')]}
PLOTTED = 'lines-each'
SNIPPETS = ['ch04-self-reported', 'ch04-linked', 'ch04-render', 'ch04-render-guards', 'ch04-open', 'ch04-matches',
            'ch04-land',
            'ch04-land-guards', 'ch04-kani']
SURFACES = ['self-reported', 'linked', 'core']
GUARDS = ['missing-diff', 'any-run', 'trust-store', 'land-unverified', 'land-unopened', 'count-opened']
LANDS = 'work_lands_only_if_verified_and_opened'
VERIFIED_LINE = 'a_line_is_verified_only_by_a_run_of_its_revision'
CONTROL = 'control_a_rule_that_counts_opened_hashes_is_caught'
UNVERIFIED = 'verdict: ALICE LANDED REVISION 8, AND THE ACCEPTANCE TEST HAD NOT PASSED ON IT'


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
        if line.startswith(' ' * 9) and lines:
            lines[-1] += ' ' + line.strip()
        else:
            lines.append(line)
    return lines


def steps(name):
    """The steps of a recorded scenario, each as one line."""
    return [re.sub(r'\s+', ' ', line) for line in joined(name) if line.startswith('step ')]


def verdict(name):
    return next(re.sub(r'\s+', ' ', line) for line in joined(name) if line.startswith('verdict: '))


def table(name, rows):
    """A recorded table: for each named row, its counts."""
    found = {}
    for line in run(name):
        cells = line.split()
        if cells and cells[0] in rows and len(cells) > 1 and all(cell.isdigit() for cell in cells[1:]):
            found[cells[0]] = [int(cell) for cell in cells[1:]]
    return found


def landings():
    """The plotted table: for each surface, its landings sorted by what was wrong with them."""
    lines = run(PLOTTED)
    assert lines[0] == '$ harbor lines --each', lines[0]
    assert '# design 1: self-reported; 2: linked; 3: core' in lines, lines
    rows = [line.split() for line in lines if line and line[0] not in '#$']
    assert rows[0] == ['design', 'landings', 'correct', 'unseen', 'unverified', 'neither'], rows[0]
    found = {}
    for number, *counts in ([int(cell) for cell in row] for row in rows[1:]):
        found[SURFACES[number - 1]] = dict(zip(rows[0][1:], counts))
    return found


def spelt(count):
    """A count as the Book prints it, with a comma for thousands."""
    return f'{count:,}'


class QuotedFacts(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.text = prose(SECTION)
        cls.chapter = prose(CHAPTER)
        cls.caption = prose(FIGURE)
        # states, lines, overclaim, landings, unverified, unseen
        cls.walk = table('lines', SURFACES)
        # lines, overclaim, broken, landings, unverified, unseen
        cls.guards = table('lines-guards', GUARDS)
        cls.kinds = landings()

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
        self.assertLessEqual(set(WHOLE_RUNS) | set(PART_RUNS) | {PLOTTED}, recorded)
        # Every snippet this build has is printed in this section.
        cut = {excerpt['name'] for excerpt in manifest['excerpts'] if excerpt['name'].startswith('ch04-')}
        self.assertEqual(cut, set(SNIPPETS))
        self.assertIn('{excerpts/%s.txt}' % PLOTTED, FIGURE.read_text())
        self.quoted('The runs above are seven cases.')
        self.assertEqual(len(WHOLE_RUNS) - 2 + len(PART_RUNS) - 1, 7)

    def test_the_first_break(self):
        name = 'green-self-reported'
        found = steps(name)
        self.assertIn('drake repairs the retry and deletes the acceptance test -> revision 8', found[0])
        self.assertTrue(found[1].endswith('kernel runs the acceptance test on revision 8 -> failed'))
        self.assertTrue(found[2].endswith('drake reports "all green"'))
        self.assertIn('-> drake | checkout repair | all green', found[3])
        self.assertTrue(found[4].endswith('alice lands it -> landed revision 8'))
        self.assertEqual(verdict(name), UNVERIFIED)
        self.quoted('Drake repairs the retry and deletes the acceptance test')
        self.quoted('The kernel ran the acceptance test on revision~8, and it failed.')
        self.quoted('she landed work that the record showed to be broken')
        self.quoted('Five processes begin from revision~7.', self.chapter)
        self.quoted('which starts at revision~7')
        # The chapter's own name for the test the job requires.
        self.quoted('the preserved acceptance test', self.chapter)

    def test_the_second_break(self):
        name = 'borrowed-linked'
        found = steps(name)
        self.assertIn("and attaches heron's log", found[2])
        self.assertTrue(found[3].split('-> ')[1].startswith('drake | checkout repair | all green | see '))
        self.assertTrue(found[4].endswith('alice opens claim 1 -> shown: checkout.test at revision 7: 4 passed'))
        self.assertTrue(found[5].endswith('alice lands it -> landed revision 8'))
        self.assertEqual(verdict(name), UNVERIFIED)
        self.quoted("But it is a run of revision~7, and Drake's work is at revision~8.")
        self.quoted('The log Alice is shown is real, and the run in it passed.')
        self.quoted('A passing receipt for another tree cannot close this obligation.', self.chapter)
        self.quoted('a passing receipt for another tree cannot close the obligation')
        self.quoted('A dishonest agent could still fabricate or reuse Row~A\'s log', self.chapter)

    def test_the_third_break(self):
        name = 'switch-linked'
        found = steps(name)
        self.assertTrue(found[1].endswith('kernel runs the acceptance test on revision 8 -> passed'))
        self.assertIn('alice opens claim 1', found[4])
        self.assertTrue(found[5].endswith('alice opens claim 2 -> shown: checkout.test at revision 8: 4 passed'))
        self.assertTrue(found[6].endswith('wren adds a migration to the change -> revision 9'))
        self.assertTrue(found[7].endswith('kernel runs the acceptance test on revision 9 -> passed'))
        self.assertTrue(found[8].endswith('alice lands it -> landed revision 9'))
        self.assertEqual(verdict(name), 'verdict: ALICE LANDED REVISION 9, AND SHE HAD NOT BEEN SHOWN ITS DIFF')
        self.quoted("Wren then added a migration, and the kernel's run of revision~9 passed. The surface landed "
                    'revision~9.')
        self.quoted('claims 1 and 2 still counted as opened')
        self.quoted('She read one revision and landed another.')
        self.quoted('The next break needs nobody to lie')

    def test_the_fix_refuses_each_break_and_lands_work_that_was_opened(self):
        green = steps('green-core')
        line = green[3].split('-> ')[1]
        self.assertTrue(line.startswith('drake | checkout repair | revision 8 | NOT VERIFIED | diff '), line)
        self.assertIn('| test failed ', line)
        self.assertIn('refused: not-verified', green[4])
        self.assertEqual(verdict('green-core'), 'verdict: nothing was landed')
        self.quoted('The line says \\texttt{NOT VERIFIED}, and it gives the hash of the failing log.')
        # The second break: what the worker attached is not on the line.
        borrowed = steps('borrowed-core')
        self.assertIn("and attaches heron's log", borrowed[2])
        self.assertEqual(borrowed[3].split('-> ')[1], line)
        self.assertTrue(borrowed[4].endswith('alice opens claim 1 -> shown: delete tests/checkout.test'))
        self.assertIn('refused: not-verified', borrowed[5])
        self.assertEqual(verdict('borrowed-core'), 'verdict: nothing was landed')
        self.quoted('The claim Alice opens is the diff of revision~8, and it shows her the deletion.')
        # The printed lines start where the worker attaches the log.
        self.assertTrue(run('borrowed-core')[7].startswith('step 3 '))
        # The third break: after the change the line has a diff she has not opened.
        switch = steps('switch-core')
        self.assertIn('| revision 8 | verified | diff ', switch[3])
        self.assertTrue(switch[6].endswith('wren adds a migration to the change -> revision 9'))
        self.assertIn('refused: not-opened (claim 1 on the line has not been opened)', switch[8])
        self.assertEqual(verdict('switch-core'), 'verdict: nothing was landed')
        # She opens the same claims as in the run at the second surface.
        self.assertEqual([step.split(' -> ')[0] for step in switch[4:6]],
                         [step.split(' -> ')[0] for step in steps('switch-linked')[4:6]])
        self.quoted('the new line has a new diff, and Alice has not opened it')
        # Verified work lands once it has been opened, and not before.
        pile = steps('pile-core')
        self.assertIn('refused: not-opened (claim 1 on the line has not been opened)', pile[4])
        self.assertIn('alice opens claim 1', pile[5])
        self.assertIn('alice opens claim 2', pile[6])
        self.assertTrue(pile[7].endswith('alice lands it -> landed revision 8'))
        # The printed lines start where she first tries to land. The steps left out are the first four of the
        # run before it.
        self.assertTrue(run('pile-core')[10].startswith('step 5 '))
        self.assertEqual(pile[:4], switch[:4])
        self.quoted('The steps left out are the first four of Listing~\\ref{alg:ls-line-run-switch-core}.')
        # The order of the checks in land, as the prose gives it.
        self.assertIn('refused: not-verified', borrowed[5])
        self.quoted('Work that is not verified is refused for that reason, whatever has been opened')
        self.quoted('Verified work is refused with the number of the first unopened claim')
        self.assertEqual(verdict('pile-core'), 'verdict: revision 8 was landed: the acceptance test had passed on it, and '
                                               'alice had been shown its diff')
        self.quoted('Verified work that nobody has opened does not land, and it lands once it has been opened')
        self.quoted('A landing is \\emph{correct} if the acceptance test had passed on the revision that landed, and '
                    'Alice had been shown its diff.')

    def test_the_listings_say_what_the_prose_says_about_them(self):
        code = lambda name: (EXCERPTS / f'{name}.code').read_text()
        first = code('ch04-self-reported')
        self.assertIn('return { text: `${agent} | ${job} | ${statement}`, claims: [] };', first)
        self.assertIn('this.at = { ...this.at, landed: this.at.revision };', first)
        self.quoted("The first version. The line is the worker's report, and landing waits for nothing.")
        second = code('ch04-linked')
        self.assertIn('if (links.length === 0 || !stored) {', second)
        self.assertIn('const all = links.every((_, n) => openedNumbers.includes(n));', second)
        self.quoted('The second version. A line needs links, and landing waits for each to be opened.')
        self.quoted("Drake's ``all green'' with nothing attached is now refused.")
        self.quoted('It had recorded the numbers of the claims she opened')
        render, guards = code('ch04-render'), code('ch04-render-guards')
        self.assertEqual(re.findall(r'^(?:pub )?fn (\w+)', render, flags=re.M), ['render'])
        self.assertEqual(re.findall(r'^(?:pub )?fn (\w+)', guards, flags=re.M), ['stored_diff', 'current_run'])
        self.assertIn('let mut claims = vec![claim(Kind::Changed, diff)];', render)
        self.assertIn('let verified = run.is_some_and(|run| run.passed);', render)
        self.assertIn('return Err(Reason::NoDiff);', render)
        self.assertIn('.filter(|run| run.revision == work.revision)', guards)
        self.quoted('\\texttt{stored\\_diff} makes no line for work with no diff stored.')
        self.quoted("\\texttt{current\\_run} counts a run only if it is a run of the work's current revision.")
        self.quoted('The first claim says that the change is this diff.')
        self.quoted('The line is marked verified only if such a run passed')
        self.quoted('\\texttt{current\\_run} leaves it off the line')
        self.quoted('Nothing the worker reports is an input to \\texttt{render}')
        self.assertNotIn('statement', render + guards)
        opened, matches = code('ch04-open'), code('ch04-matches')
        self.assertEqual(re.findall(r'^(?:pub )?fn (\w+)', opened, flags=re.M), ['open'])
        self.assertEqual(re.findall(r'^(?:pub )?fn (\w+)', matches, flags=re.M), ['matches'])
        self.assertIn('if !matches(&named.sha, shown) {', opened)
        self.assertIn('review.opened.push(named.sha.clone());', opened)
        self.assertIn('hex(&Sha256::digest(shown.as_bytes())) == *sha', matches)
        self.quoted("The core then records the claim's hash, not its number")
        self.quoted("\\texttt{matches} hashes the text again and compares the result with the claim's own hash")
        land, waits = code('ch04-land'), code('ch04-land-guards')
        self.assertEqual(re.findall(r'^(?:pub )?fn (\w+)', land, flags=re.M), ['land'])
        self.assertEqual(re.findall(r'^(?:pub )?fn (\w+)', waits, flags=re.M), ['first_unopened', 'opened'])
        self.assertIn('let review = review(work)?;', land)
        self.assertLess(land.index('if !verified(&review.line) {'),
                        land.index('if let Some(claim) = first_unopened(&review) {'))
        self.assertIn('review.opened.contains(sha)', waits)
        self.assertIn('return review.opened.len() > number;', waits)
        self.assertIn('claims.position(|(n, claim)| !opened(review, n, &claim.sha))', waits)
        self.quoted('It begins with \\texttt{review}, which calls \\texttt{render}')
        self.quoted('\\texttt{opened} is the comparison it uses')
        # Five guards are printed, and the sixth is called by land.
        guarded = guards + matches + waits
        printed = re.findall(r'feature = "mutant-([\w-]+)"', guarded)
        self.assertEqual(len(printed), 5)
        self.assertEqual(sorted(printed + ['land-unverified']), sorted(GUARDS))
        self.assertEqual(guarded.count('MUTANT'), 5)
        self.assertEqual((render + opened + land).count('MUTANT'), 0)
        self.quoted('This build has six guards. Five are in the listings above, and the sixth is the \\texttt{verified} '
                    'that \\texttt{land} calls.')
        kani = code('ch04-kani')
        self.assertIn(f'fn {LANDS}() {{', kani)
        self.assertIn('let work = any_work();', kani)
        self.assertEqual((kani.count('assert!('), kani.count('kani::cover!(')), (2, 1))
        self.quoted("the harness's 2 assertions say that the line is verified and that every claim on it is among the "
                    'hashes opened')
        self.quoted('Its \\texttt{cover} line makes the solver find a record that does land.')
        # The exercises read these listings.
        self.quoted('\\texttt{land} checks that first and refuses with \\texttt{NotVerified}.', self.chapter)
        self.assertIn('return Err(Reason::NotVerified);', land)
        self.assertIn('return Err(Reason::NotOpened { claim });', land)
        self.quoted('It finds more than 0 hashes opened for the first claim and more than 1 for the second',
                    self.chapter)
        self.quoted('Listing~\\ref{alg:ls-line-land-guards} marks a change to \\texttt{opened} as belonging to a build '
                    'with that guard removed.', self.chapter)
        self.assertEqual(waits[waits.index('fn opened'):].count('MUTANT'), 1)
        self.quoted('so \\texttt{first\\_unopened} returns claim~1 and \\texttt{land} refuses with \\texttt{NotOpened}',
                    self.chapter)
        self.quoted("\\texttt{current\\_run} drops the run of revision~8, because it is not a run of the work's current "
                    'revision.', self.chapter)

    def test_the_exhaustive_test(self):
        header = ' '.join(line.strip() for line in run('lines')[1:6])
        self.assertEqual(header, 'every sequence of events for one piece of work: the worker changes it up to 2 times, '
                                 'correctly or not, and reports on it up to 2 times. The kernel runs the acceptance test at '
                                 'any point, and the store may return the wrong text once. The operator opens up to 3 '
                                 'claims, and may try to land the work in any state')
        self.quoted('The worker changes the work up to 2 times, correctly or not, and reports on it up to 2 times.')
        self.quoted('The store returns the wrong text at most once')
        self.quoted('Alice opens up to 3 claims, and she may try to land in any state.')
        self.quoted('2 changes, 2 reports, 3 opened claims and one store fault')
        self.quoted('The exhaustive test stops at 2 changes and 3 opened claims.')
        states, lines, overclaim, lands, unverified, unseen = self.walk['self-reported']
        self.assertEqual((lines, lands, unseen), (states, states, states))
        self.quoted(f'The first surface shows a line in each of its {spelt(states)} states, and {spelt(overclaim)} of '
                    'those lines overclaim. It lets the work land in every state.')
        states, lines, overclaim, lands, unverified, unseen = self.walk['linked']
        self.quoted(f'The second surface has {spelt(lands)} states in which work can land. In {spelt(unverified)} of them '
                    f'no run of the work had passed, and in {spelt(unseen)} Alice had not been shown its diff.')
        states, lines, overclaim, lands, unverified, unseen = self.walk['core']
        self.assertEqual((overclaim, unverified, unseen), (0, 0, 0))
        self.quoted(f"The kernel's surface shows {spelt(lines)} lines, and none overclaims. It lets work land in "
                    f'{spelt(lands)} states, each of them verified and seen, and it refused no landing of work that was '
                    'verified and fully opened.')
        closing = ' '.join(line.strip() for line in run('lines')[-2:])
        self.assertEqual(closing, 'the core refused no landing of work that was verified and fully opened')
        # What the column counts, in the run's own legend.
        legend = ' '.join(line.strip() for line in run('lines'))
        self.assertIn('overclaim: lines that say the work is good and have no claim that links to a passing run of it',
                      legend)
        self.quoted('A line \\emph{overclaims} if it tells its reader that the work is good and has no claim that links '
                    'to a passing run of the current revision.')
        # The express lane quotes the same counts.
        second, kernel = self.walk['linked'][3], self.walk['core'][3]
        self.quoted(f'counts {spelt(second)} states in which the second surface lets work land, and only '
                    f"{spelt(self.kinds['linked']['correct'])} of those landings are correct. Under the kernel's surface "
                    f'all {spelt(kernel)} are.')

    def test_the_figure_sorts_the_landings_the_test_counted(self):
        for surface in SURFACES:
            kinds = self.kinds[surface]
            states, lines, overclaim, lands, unverified, unseen = self.walk[surface]
            self.assertEqual(kinds['landings'], lands, surface)
            self.assertEqual(kinds['correct'] + kinds['unseen'] + kinds['unverified'] + kinds['neither'], lands, surface)
            self.assertEqual(kinds['unverified'] + kinds['neither'], unverified, surface)
            self.assertEqual(kinds['unseen'] + kinds['neither'], unseen, surface)
        first, second, kernel = (self.kinds[surface] for surface in SURFACES)
        self.assertEqual((first['correct'], first['unverified']), (0, 0))
        self.quoted(f"Under the first surface no landing is correct, because the line has nothing to open. In "
                    f"{spelt(first['unseen'])} of them the work happened to be verified, and in the other "
                    f"{spelt(first['neither'])} it was not.")
        self.quoted(f"Under the second surface {spelt(second['correct'])} of {spelt(second['landings'])} landings are "
                    'correct, which is about one in eight.')
        self.assertEqual(round(second['landings'] / second['correct']), 8)
        self.quoted(f"In {spelt(second['neither'])} the work was neither verified nor seen.")
        self.assertEqual(kernel['correct'], kernel['landings'])
        self.quoted("Under the kernel's surface every landing is correct.")
        self.assertIn(f"Of {spelt(second['landings'])} landings under the surface with links, {spelt(second['correct'])} "
                      'were correct.', self.caption)
        self.assertIn('Black is a landing of verified work whose diff Alice had been shown.', self.caption)
        figure = FIGURE.read_text()
        # The counts in the picture are taken from the table as it is plotted.
        for column in ('landings', 'correct', 'unseen', 'unverified', 'neither'):
            self.assertIn('\\pgfplotstablegetelem{\\row}{%s}\\of\\pdlandings' % column, figure)
        self.assertIn('\\pgfmathprintnumber{\\pdfine} of \\pgfmathprintnumber{\\pdall} landings were correct', figure)
        drawn = figure[figure.index('\\begin{tikzpicture}'):figure.index('\\end{tikzpicture}')]
        # No count is typed into the picture. The one long number in it is an option's name.
        self.assertIsNone(re.search(r'\d,\d{3}|\d{4}', drawn.replace('1000 sep={,}', '')))
        self.assertIn('left to right: a run of the work had passed, then none had', figure)
        self.assertIn('top to bottom: Alice had been shown its diff, then she had not', figure)
        # The exercise works out the overlap.
        wrong = second['landings'] - second['correct']
        unverified, unseen = self.walk['linked'][4], self.walk['linked'][5]
        self.assertEqual(unverified + unseen - second['neither'], wrong)
        self.assertEqual((unverified, unseen, second['neither'], wrong), (7002, 6544, 4666, 8880))
        self.quoted('$7{,}002+6{,}544-4{,}666=8{,}880$ were wrong, and $10{,}094-8{,}880=1{,}214$ were correct.',
                    self.chapter)
        self.assertEqual((unverified - second['neither'], unseen - second['neither']),
                         (second['unverified'], second['unseen']))
        self.quoted('$7{,}002-4{,}666=2{,}336$ landings were seen and not verified, and $6{,}544-4{,}666=1{,}878$ were '
                    'verified and not seen.', self.chapter)
        self.quoted('counts 10,094 landings. In 7,002 the work was not verified, and in 6,544 Alice had not been shown '
                    'its diff.', self.chapter)

    def test_kanis_results(self):
        lines = run('kani-zoom')
        self.assertEqual(lines[0], '$ sh formal/zoom/run.sh')
        results = dict(zip(lines[1:9:2], (line.strip() for line in lines[2:9:2])))
        names = list(results)
        self.assertEqual(names, [VERIFIED_LINE, CONTROL, 'verified_and_opened_work_does_land', LANDS])
        self.assertEqual(results[CONTROL], 'fails, as a control should')
        self.quoted('The second result is a control.')
        for name in names:
            if name != CONTROL:
                self.assertTrue(results[name].startswith('successful'), name)
                self.assertIn('satisfied', results[name], name)
        self.quoted('a rule that counts how many hashes were opened and does not compare them')
        self.assertEqual(lines[9], 'the harnesses that fail when one guard is removed')
        failing, build = {}, None
        for line in lines[10:]:
            if line.startswith('  '):
                failing[build].append(line.strip())
            else:
                build = line
                failing[build] = []
        self.assertEqual(list(failing), GUARDS)
        # The two printed parts meet where the builds with a guard removed begin.
        self.assertEqual(len(lines), 22)
        self.assertEqual(failing['missing-diff'], [VERIFIED_LINE])
        self.assertEqual(failing['any-run'], [VERIFIED_LINE])
        for build in ('land-unverified', 'land-unopened', 'count-opened'):
            self.assertEqual(failing[build], [LANDS], build)
        # No harness fails on the build that does not hash the text the store returns.
        self.assertEqual(failing['trust-store'], ['NONE'])
        self.quoted('and no harness fails on it')
        self.quoted('the harness \\texttt{work\\_lands\\_only\\_if\\_verified\\_and\\_opened} fails on it', self.chapter)
        self.quoted('Under Kani a hash is one byte and not a string of 64 characters.')
        self.assertEqual(len('%064x' % 0), 64)

    def test_each_guard_removed(self):
        self.assertEqual(list(self.guards), GUARDS)
        lines, overclaim, broken, lands, unverified, unseen = self.guards['any-run']
        self.assertEqual(unseen, 0)
        self.quoted(f'A core that counts any run is the second break inside the core: {spelt(overclaim)} of its lines '
                    f'overclaim, and {spelt(unverified)} of its landings are of work no run had passed.')
        lines, overclaim, broken, lands, unverified, unseen = self.guards['count-opened']
        self.assertEqual((overclaim, unverified), (0, 0))
        self.quoted(f'A core that counts how many hashes were opened is the third break, with {spelt(unseen)} landings of '
                    'work Alice had not seen.')
        self.quoted(f'The exhaustive test finds {spelt(unseen)} landings of unseen work on that build', self.chapter)
        lines, overclaim, broken, lands, unverified, unseen = self.guards['missing-diff']
        self.assertEqual((overclaim, unverified, unseen), (0, 0, 0))
        self.quoted(f'A core that makes a line without a stored diff lands nothing wrong, but {broken} of its lines have '
                    'a claim that links to nothing in the store.')
        lines, overclaim, broken, lands, unverified, unseen = self.guards['trust-store']
        self.assertEqual((overclaim, unverified), (0, 0))
        self.quoted(f'A core that does not hash the text the store returns lands unseen work in {spelt(unseen)} states of '
                    'the exhaustive test')
        # The exhaustive test catches every build with a guard removed.
        for name in GUARDS:
            lines, overclaim, broken, lands, unverified, unseen = self.guards[name]
            self.assertGreater(overclaim + broken + unverified + unseen, 0, name)
        self.quoted('The important row is \\texttt{trust-store}.')
        # The build this one is compared with is Chapter 3's, whose two-room check missed one guard.
        self.quoted('\\weld{sealed:sec:sealed-gate}{two-room check}')
        self.assertIn('The two-room check cannot detect that this guard is missing.',
                      prose(ROOT / 'book' / 'additions' / 'sealed-build-the-gate.tex'))

    def test_the_exercises_are_where_the_chapter_points(self):
        self.quoted('\\pdexercisepointer{\\ref{ex:ls-flatten-or-preserve}}{\\ref{ex:ls-line-read}}', self.chapter)
        self.assertLess(self.chapter.index('{ex:ls-adversarial-legibility}'), self.chapter.index('{ex:ls-line-kinds}'))
        self.assertLess(self.chapter.index('\\begin{pdsolution}{ex:ls-line-read}'),
                        self.chapter.index('\\pdexercisesfor{\\S\\ref{sec:authority-rules}}'))
        self.assertIn('\\input{additions/ls-build-the-line}', CHAPTER.read_text())


if __name__ == '__main__':
    unittest.main()
