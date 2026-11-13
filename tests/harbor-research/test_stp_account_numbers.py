"""Chapter 5's build section quotes facts from its recorded runs. Check each against its run.

The section's listings cannot drift, because they are the recorded files.
Its prose and its exercises can. A sentence that says "1,042 of 3,405
states" was written by hand from a table the kernel printed, and a later
recording may print a different table. Each test here reads a fact out of a
recorded run and requires the sentence that quotes it.
"""
import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
EXCERPTS = ROOT / 'book' / 'excerpts'
SECTION = ROOT / 'book' / 'additions' / 'stp-build-the-account.tex'
FIGURE = ROOT / 'book' / 'figures' / 'fig-stp-resets.tex'
CHAPTER = ROOT / 'book' / 'spawn-to-person.tex'
WHOLE_RUNS = ['handover-named', 'clean-slate-named', 'double-core', 'resets', 'accounts', 'accounts-guards']
PART_RUNS = {'namesake-named': [(7, '1,10-15')], 'namesake-minted': [(6, '1,10-14')],
             'clean-slate-minted': [(7, '1,10-15')], 'clean-slate-core': [(7, '1,10-15')],
             'namesake-core': [(6, '1,10-14')], 'replaced-core': [(7, '1,11-16')],
             'kani-persons': [(17, '1-17'), (13, '1,18-29')]}
PLOTTED = 'resets-each'
SNIPPETS = ['ch05-named', 'ch05-minted', 'ch05-check', 'ch05-show', 'ch05-show-guards', 'ch05-succeed',
            'ch05-succeed-guards', 'ch05-kani']
DESIGNS = ['named', 'minted', 'core']
GUARDS = ['any-principal', 'two-processes', 'late-exit', 'answer-exited', 'sanction-per-account']
SANCTION_HARNESS = 'a_sanction_counts_on_every_account_of_its_principal'
OWNER_HARNESS = 'only_the_owner_continues_an_account_one_process_at_a_time'
RUNNING_HARNESS = 'only_the_running_process_is_answered_or_clears_its_account'
FRESH_HARNESS = 'a_fresh_account_shows_its_principals_sanctions'
CONTROL = 'control_per_account_sanctions_are_caught'
NO_PANIC = 'no_decision_panics_on_any_registry'
# The Book's example: a newcomer's score and what a sanction costs. The
# value of a pass is the section's own choice.
NEWCOMER, PER_PASS, PER_SANCTION = 50, 10, 30
WHITEWASHED = "verdict: ALICE'S NEW WORKER SHOWS NO SANCTION, AND SHE HAS ONE"


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


def asked(step):
    """The request in a step, without its outcome."""
    return step.split(' -> ')[0]


def verdict(name):
    return next(re.sub(r'\s+', ' ', line) for line in said(name) if line.startswith('verdict: '))


def table(name, rows):
    """A recorded table: for each named row, every line of counts that starts with its name."""
    found = {row: [] for row in rows}
    for line in run(name):
        cells = line.split()
        if cells and cells[0] in rows and len(cells) > 1 and all(cell.isdigit() for cell in cells[1:]):
            found[cells[0]].append([int(cell) for cell in cells[1:]])
    return found


def plotted():
    """The plotted table, one row per record: passes, before, keep, and the best score at each registry."""
    lines = run(PLOTTED)
    assert lines[0] == '$ harbor resets --each', lines[0]
    rows = [line.split() for line in lines if line and line[0] not in '#$']
    assert rows[0] == ['passes', 'before', 'keep', 'named', 'minted', 'core'], rows[0]
    return [dict(zip(rows[0], (int(cell) for cell in row))) for row in rows[1:]]


def with_commas(count):
    """A count as the Book prints it, with a comma for thousands."""
    return f'{count:,}'


def score(passed, sanctions):
    return NEWCOMER + PER_PASS * passed - PER_SANCTION * sanctions


class QuotedFacts(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.text = prose(SECTION)
        cls.chapter = prose(CHAPTER)
        cls.caption = prose(FIGURE)
        # states, whitewashed, unearned, doubled, stale
        cls.test = {name: rows[0] for name, rows in table('accounts', DESIGNS).items()}
        cls.guards = {name: rows[0] for name, rows in table('accounts-guards', GUARDS).items()}
        # passes, before, keep, reset, best, regained: one row for each row of the Book's table
        cls.resets = table('resets', DESIGNS)
        cls.each = plotted()

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
        cut = {excerpt['name'] for excerpt in manifest['excerpts'] if excerpt['name'].startswith('ch05-')}
        self.assertEqual(cut, set(SNIPPETS))
        self.assertIn('\\pgfplotstableread[skip first n=1]{excerpts/%s.txt}' % PLOTTED, FIGURE.read_text())
        self.assertIn('\\input{additions/stp-build-the-account}', CHAPTER.read_text())
        self.assertIn('\\input{figures/fig-stp-resets}', source)

    def test_the_first_registry_and_its_two_breaks(self):
        honest = steps('handover-named')
        self.assertTrue(honest[0].endswith('alice registers a worker called heron -> process 0, under the name heron'))
        self.assertEqual([step.split(' -> ')[1] for step in honest[1:3]], ['passed', 'passed'])
        self.assertIn('kernel records that process 0 exited', honest[3])
        self.assertTrue(honest[4].endswith('alice starts a process to continue heron -> process 1, under the name heron'))
        self.assertTrue(honest[5].endswith('bob asks for the record of process 1 -> 2 passes and 0 sanctions'))
        self.assertEqual(verdict('handover-named'), 'verdict: the later process has the 2 passes the earlier one earned')
        self.quoted("The new process is reported with Heron's 2 passes, which is correct.")
        self.quoted('Heron has two passed deliveries.')
        # The first break: the same steps, and a second operator takes the fifth. The printed lines start
        # there, and the steps left out are the first four of the run before it.
        namesake = steps('namesake-named')
        self.assertEqual(namesake[:4], honest[:4])
        self.assertTrue(run('namesake-named')[9].startswith('step 5 '))
        self.assertEqual(run('namesake-named')[4:9], run('handover-named')[4:9])
        self.quoted('The steps left out are the first four of Listing~\\ref{alg:stp-account-run-handover}.')
        self.assertTrue(namesake[4].endswith('carol starts a process to continue heron -> process 1, under the name heron'))
        self.assertTrue(namesake[5].endswith('-> 2 passes and 0 sanctions'))
        self.assertEqual(verdict('namesake-named'), "verdict: CAROL'S PROCESS SHOWS 2 PASSES THAT ALICE'S WORKER EARNED")
        self.quoted("Bob is told that Carol's process has 2 passes.")
        self.quoted('what entitles a process calling itself Heron to use this history', self.chapter)
        self.quoted("what entitles a process calling itself Heron to use Heron's history")
        # The second break: the sanction is still on file, under a name nobody uses.
        slate = steps('clean-slate-named')
        self.assertTrue(slate[1].endswith('-> failed: it deleted a test it was told to keep'))
        self.assertTrue(slate[3].endswith('alice registers a worker called drake-2 -> process 1, under the name drake-2'))
        self.assertTrue(slate[4].endswith('bob asks for the record of process 1 -> 0 passes and 0 sanctions'))
        self.assertEqual(verdict('clean-slate-named'), WHITEWASHED)
        self.quoted('because it deleted a test it was told to keep')
        self.quoted('Alice registers the same worker under the name \\texttt{drake-2}')
        self.quoted('Bob asked about \\texttt{drake-2}, which has no record.')
        self.quoted('Tonight\'s \\emph{Drake} deleted the failing test instead of fixing it', self.chapter)
        self.quoted('The second break is the S2 scenario.')
        self.quoted('\\subsection{S2: whitewashing in action}', self.chapter)
        self.quoted('shedding a penalty by moving to a fresh identity, is \\pdterm{whitewashing}', self.chapter)

    def test_the_second_registry_repairs_one_break_and_not_the_other(self):
        namesake = steps('namesake-minted')
        self.assertIn('refused: no-credential', namesake[4])
        self.assertEqual(verdict('namesake-minted'), "verdict: carol's process does not get heron's passes")
        # The printed lines start where Carol asks. The steps left out are the first four of the run at the
        # first registry, with an account number where that run has a name.
        self.assertTrue(run('namesake-minted')[9].startswith('step 5 '))
        first = steps('handover-named')
        self.assertEqual([asked(step) for step in namesake[:4]], [asked(step) for step in first[:4]])
        self.assertEqual(asked(namesake[4]), asked(steps('namesake-named')[4]))
        self.assertTrue(first[0].endswith('-> process 0, under the name heron'))
        self.assertTrue(namesake[0].endswith('-> process 0, under account 0'))
        self.quoted('The steps left out are the first four of Listing~\\ref{alg:stp-account-run-handover}, with an '
                    'account number where that run has a name.')
        self.quoted("Carol is now refused, because she does not hold the credential for Heron's account")
        slate = steps('clean-slate-minted')
        self.assertTrue(slate[3].endswith('alice registers a worker called drake-2 -> process 1, under account 1'))
        self.assertTrue(slate[4].endswith('-> 0 passes and 0 sanctions'))
        self.assertEqual(verdict('clean-slate-minted'), WHITEWASHED)
        # The printed lines start where Alice registers the worker again.
        self.assertTrue(run('clean-slate-minted')[9].startswith('step 4 '))
        self.assertEqual([asked(step) for step in slate[:3]], [asked(step) for step in steps('clean-slate-named')[:3]])
        self.assertTrue(slate[0].endswith('-> process 0, under account 0'))
        self.quoted('The steps left out are the first three of Listing~\\ref{alg:stp-account-run-slate}, with an '
                    'account number where that run has a name.')
        self.quoted('The third break. The credential is authentic, and the account is new.')
        self.quoted('An authentic credential can still be disposable.', self.chapter)
        self.quoted('an authentic credential can still be disposable')
        self.quoted('it does not rule out principal-wide sanctions', self.chapter)
        self.quoted('calls this a principal-wide sanction')

    def test_the_fix_refuses_each_break(self):
        slate = steps('clean-slate-core')
        self.assertEqual([asked(step) for step in slate], [asked(step) for step in steps('clean-slate-minted')])
        self.assertTrue(slate[4].endswith('bob asks for the record of process 1 -> 0 passes and 1 sanction'))
        self.assertEqual(verdict('clean-slate-core'), "verdict: alice's new worker still shows her sanction")
        self.assertTrue(run('clean-slate-core')[9].startswith('step 4 '))
        self.assertEqual(run('clean-slate-core')[4:9], run('clean-slate-minted')[4:9])
        self.quoted('The same three steps are left out.')
        self.quoted('The new account has no passes, and it still shows the sanction.')
        namesake = steps('namesake-core')
        self.assertIn('refused: not-owner (account 0 belongs to another principal)', namesake[4])
        self.assertEqual(verdict('namesake-core'), verdict('namesake-minted'))
        self.assertTrue(run('namesake-core')[9].startswith('step 5 '))
        self.assertEqual(run('namesake-core')[4:9], run('namesake-minted')[4:9])
        self.quoted('The same four steps are left out.')
        double = steps('double-core')
        self.assertIn('refused: already-running (process 0 is already running under account 0)', double[2])
        self.assertEqual(verdict('double-core'), 'verdict: only one process is running under the account')
        replaced = steps('replaced-core')
        self.assertTrue(replaced[3].endswith('alice starts a process to continue heron -> process 1, under account 0'))
        self.assertIn('bob asks for the record of process 0 -> refused: exited', replaced[4])
        self.assertEqual(verdict('replaced-core'), 'verdict: only the process now running under the account gets an '
                                                   'answer')
        # The printed lines start where the replaced process's record is asked for.
        self.assertTrue(run('replaced-core')[10].startswith('step 5 '))
        self.quoted('Process 1 took over the account in the steps left out.')

    def test_the_listings_say_what_the_prose_says_about_them(self):
        code = lambda name: (EXCERPTS / f'{name}.code').read_text()
        methods = lambda text: re.findall(r'^\s*(\w+)\([^)]*\)[^;{]*\{$', text, flags=re.M)
        first = code('ch05-named')
        self.assertEqual(methods(first), ['start', 'show'])
        self.assertIn('const record = this.#state.records[name] ?? EMPTY;', first)
        self.quoted('The first version. Records are filed by name, and a process picks its own name.')
        self.quoted('self-asserted string', self.chapter)
        second = code('ch05-minted')
        self.assertEqual(methods(second), ['register', 'succeed', 'check'])
        self.assertIn('const fresh = { owner: principal, ...EMPTY, running: null };', second)
        self.assertIn('if (entry.owner !== principal) return notOwner(account);', second)
        self.assertIn('if (entry.running !== null) return busy(account, entry);', second)
        self.quoted('\\texttt{check} files a sanction with the account it was earned under, and \\texttt{register} '
                    'opens a fresh account for anyone who asks.')
        self.quoted('only one process can run under an account at a time')
        functions = lambda text: re.findall(r'^(?:pub )?fn (\w+)', text, flags=re.M)
        check = code('ch05-check')
        self.assertEqual(functions(check), ['record_check'])
        self.assertIn('let (account, entry) = account_of(registry, process)?;', check)
        self.assertIn('let passed = entry.passed.saturating_add(1);', check)
        self.assertIn('registry.sanctions.push(Sanction { principal, account });', check)
        self.quoted("A pass is added to the account's own entry. A sanction is added to the registry's list with the "
                    "account's principal on it.")
        show, shown = code('ch05-show'), code('ch05-show-guards')
        self.assertEqual(functions(show), ['show'])
        self.assertEqual(functions(shown), ['is_running', 'count'])
        self.assertIn('let (account, entry) = account_of(registry, process)?;', show)
        self.assertIn('if !is_running(entry, process) {', show)
        self.assertIn('passed: entry.passed,', show)
        self.assertIn('sanctions: count(registry, entry.principal, account),', show)
        self.assertIn('sanction.principal == owner', shown)
        self.assertIn('entry.running == Some(process)', shown)
        self.quoted('It uses \\texttt{account\\_of} to find the account the process was started under, and returns that '
                    "account's passes together with the sanctions that \\texttt{count} finds.")
        self.quoted("\\texttt{count} counts every sanction recorded against the asking process's principal, whichever "
                    'worker earned it.')
        self.quoted('\\texttt{is\\_running} answers only the process now running under an account')
        succeed, continued = code('ch05-succeed'), code('ch05-succeed-guards')
        self.assertEqual(functions(succeed), ['succeed'])
        self.assertEqual(functions(continued), ['owns', 'busy'])
        self.assertLess(succeed.index('if !owns(entry, principal) {'), succeed.index('if let Some(process) = busy(entry) {'))
        self.assertIn('entry.principal == principal', continued)
        self.assertIn('account: u32,', succeed)
        self.quoted('\\texttt{owns} lets a principal continue only the accounts it registered')
        self.quoted('\\texttt{busy} refuses a second process while one is still running')
        self.quoted('A principal is only a number, the \\texttt{u32} that \\texttt{succeed} is handed.')
        # Four guards are printed, and the fifth is described.
        guarded = shown + continued
        printed = re.findall(r'feature = "mutant-([\w-]+)"', guarded)
        self.assertEqual(sorted(printed + ['late-exit']), sorted(GUARDS))
        self.assertEqual(guarded.count('MUTANT'), 4)
        self.assertEqual((check + show + succeed).count('MUTANT'), 0)
        self.quoted('One more guard is not printed.')
        self.quoted('The build has five guards.')
        self.quoted('\\S\\ref{sec:stp-account} describes the guard on an exit without printing it.', self.chapter)
        kani = code('ch05-kani')
        self.assertIn(f'fn {SANCTION_HARNESS}() {{', kani)
        self.assertIn('let registry = any_registry();', kani)
        self.assertEqual((kani.count('assert!('), kani.count('kani::cover!(')), (2, 2))
        self.assertLess(kani.index('assert!(after.sanctions == before.sanctions + same as u32);'),
                        kani.index('assert!(after.passed == before.passed);'))
        self.assertIn('kani::cover!(same && before.account != earner);', kani)
        self.assertIn('kani::cover!(!same);', kani)
        self.quoted("The first assertion says that the process shows one more sanction if the sanction's principal is "
                    'its own, and the same number if not. The second says that its passes have not changed.')
        self.quoted('The 2 \\texttt{cover} lines make the solver produce both cases')
        # The exercises read these listings.
        self.quoted('\\texttt{record\\_check} adds one sanction to the registry with Alice as its principal, and '
                    'changes neither account.', self.chapter)
        self.quoted('\\texttt{succeed} then lets Alice start process~2 beside it.', self.chapter)

    def test_the_chapters_table_is_reproduced_from_runs(self):
        # Each row of the Book's table, as it is typeset.
        printed = re.findall(r'& \$(\d+)\$ & \$(\d+)\$ & \$\\max\((\d+),(\d+)\)=(\d+)\$', self.chapter)
        self.assertEqual(len(printed), 3)
        for design in ('named', 'minted'):
            rows = self.resets[design]
            self.assertEqual(len(rows), len(printed), design)
            for (passes, before, keep, reset, best, regained), row in zip(rows, printed):
                self.assertEqual([before, keep, keep, reset, best], [int(cell) for cell in row], design)
                self.assertEqual((before, keep), (score(passes, 0), score(passes, 1)), design)
                self.assertEqual((reset, best, regained), (NEWCOMER, max(keep, reset), max(keep, reset) - keep), design)
        self.assertEqual(self.resets['named'], self.resets['minted'])
        first, middle, last = self.resets['named']
        self.assertEqual((first[0], last[0]), (0, 4))
        self.quoted("no pass for the table's first row, and 4 for its last")
        self.assertEqual((first[1], last[1]), (50, 90))
        self.quoted('records that score from 50 to 90')
        self.assertEqual((first[1], first[5], middle[1], middle[5]), (50, 30, 70, 10))
        self.quoted("A reset is worth the newcomer's 50, so it wins back all 30 points of the sanction at a score of "
                    '50, and 10 of them at 70.')
        for passes, before, keep, reset, best, regained in self.resets['core']:
            self.assertEqual((reset, best, regained), (score(0, 1), keep, 0))
        self.assertEqual(score(0, 1), 20)
        self.quoted("Under the kernel's registry a reset is worth 20 whatever the worker had, and wins back nothing.")
        self.quoted('A newcomer starts at 50 and a sanction costs 30, as in the table. The table gives no value for a '
                    'pass, so each adds 10 here.')
        self.quoted('the column \\texttt{best} matches the table\'s last column')
        header = ' '.join(line.strip() for line in run('resets')[1:6]).strip()
        self.assertTrue(header.endswith("Scores follow the Book's example: a newcomer starts at 50, and a sanction costs "
                                        "30. A pass adds 10, which is this build's own choice"), header)
        self.assertIn('design    passes  before  keep  reset  best  regained', run('resets'))
        self.quoted('$r_0=50$, and let a dishonest outcome cost $\\sigma=30$', self.chapter)

    def test_the_figure_plots_the_runs(self):
        self.assertEqual([row['passes'] for row in self.each], list(range(7)))
        self.quoted('plots the same runs for seven records')
        # The figure comes before the listing, and the paragraph after both reads them.
        source = SECTION.read_text()
        self.assertLess(source.index('\\input{figures/fig-stp-resets}'), source.index(']{resets}'))
        for row in self.each:
            self.assertEqual((row['before'], row['keep']), (score(row['passes'], 0), score(row['passes'], 1)))
            self.assertEqual(row['named'], max(row['keep'], NEWCOMER))
            self.assertEqual(row['minted'], row['named'])
            self.assertEqual(row['core'], row['keep'])
        # The table's rows are among the figure's.
        for passes, before, keep, reset, best, regained in self.resets['named']:
            self.assertEqual(self.each[passes]['named'], best)
        meet = [row['before'] for row in self.each if row['named'] == row['core']]
        self.assertEqual(meet[0], NEWCOMER + PER_SANCTION)
        self.assertEqual(meet, [row['before'] for row in self.each if row['before'] >= 80])
        self.quoted('Its two lines meet at 80, which is $r_0+\\sigma$')
        self.quoted('r(i)=r_0+\\sigma=80;', self.chapter)
        self.assertIn('A reset wins back the whole sanction at a score of 50, and none of it from 80 up.', self.caption)
        self.assertIn("Under the kernel's registry a principal ends 30 points down whatever it does.", self.caption)
        figure = FIGURE.read_text()
        self.assertIn('table[x=before,y=named]{\\pdresets}', figure)
        self.assertIn('table[x=before,y=core]{\\pdresets}', figure)
        self.assertIn('{they meet at $50+30$}', figure)
        self.assertIn('\\draw[pd guide] (axis cs:80,8) -- (axis cs:80,50);', figure)
        # The exercise about a worker with 3 passes reads the row where the lines meet.
        row = self.each[3]
        self.assertEqual((row['before'], row['keep'], row['named'], row['core']), (80, 50, 50, 50))
        self.quoted('Before the sanction the score is $50+3\\cdot 10=80$, and after it $80-30=50$.', self.chapter)
        self.assertEqual(score(0, 1), 20)
        self.quoted('so it scores $50-30=20$', self.chapter)

    def test_the_exhaustive_test(self):
        header = ' '.join(line.strip() for line in run('accounts')[1:5])
        self.assertEqual(header, 'every sequence of events for two principals at one registry: they start up to 3 '
                                 'processes between them, each one a new worker or a continuation of any existing '
                                 'account. The kernel records up to 2 exits and checks up to 2 deliveries')
        self.quoted('The principals start up to 3 processes between them, each one a new worker or a continuation of '
                    'any existing account')
        self.quoted('The kernel records up to 2 exits, possibly the same exit twice, and checks up to 2 deliveries.')
        states, whitewashed, unearned, doubled, stale = self.test['named']
        self.assertTrue(all(count > 0 for count in (whitewashed, unearned, doubled, stale)))
        self.quoted(f'The registry of names fails in every column. In {with_commas(whitewashed)} of its '
                    f'{with_commas(states)} states a running process shows fewer sanctions than its principal has '
                    'earned')
        states, whitewashed, unearned, doubled, stale = self.test['minted']
        self.assertEqual((unearned, doubled, stale), (0, 0, 0))
        self.quoted('has zeros in the other three columns, and it is still whitewashed in '
                    f'{with_commas(whitewashed)} of {with_commas(states)} states')
        second = (whitewashed, states)
        states, whitewashed, unearned, doubled, stale = self.test['core']
        self.assertEqual((whitewashed, unearned, doubled, stale), (0, 0, 0, 0))
        self.quoted(f"The kernel's registry has zeros in every column across {with_commas(states)} states.")
        closing = ' '.join(line.strip() for line in run('accounts')[-3:])
        self.assertEqual(closing, 'the core reported every running process with the passes it had earned, and never '
                                  'refused a principal its own account when no process was running under it')
        self.quoted('It also reported every running process with the passes it had earned, and never refused a '
                    'principal its own idle account.')
        # The express lane quotes the same counts.
        self.quoted(f'finds a sanctioned operator showing a clean record in {with_commas(second[0])} of '
                    f'{with_commas(second[1])} states under the second version, and in none of {with_commas(states)} '
                    'under the third')
        # What each column counts, in the run's own legend.
        legend = ' '.join(line.strip() for line in run('accounts'))
        self.assertIn('whitewashed: states in which a running process shows fewer sanctions than its principal has',
                      legend)
        self.assertIn('unearned: states in which a running process shows passes that its own chain of processes did '
                      'not earn', legend)
        self.assertIn('doubled: states in which two processes are running under one account', legend)
        self.assertIn('stale: states in which a process that exited still gets an answer', legend)
        self.quoted('compares each answer with a small reference model that keeps its own list of who started what')

    def test_kanis_results(self):
        lines = run('kani-persons')
        self.assertEqual(lines[0], '$ sh formal/persons/run.sh')
        results = dict(zip(lines[1:17:2], (line.strip() for line in lines[2:17:2])))
        names = list(results)
        self.assertEqual(len(names), 8)
        self.assertEqual(names[4], CONTROL)
        self.assertEqual(results[CONTROL], 'fails, as a control should')
        self.quoted('The fifth result is a control.')
        for name in names:
            if name != CONTROL:
                self.assertTrue(results[name].startswith('successful'), name)
        self.assertEqual(results[SANCTION_HARNESS], 'successful; its 2 covers are satisfied')
        self.assertEqual(results[NO_PANIC], 'successful')
        self.quoted('One more harness asserts nothing. It calls every decision on a registry that the rules could '
                    '\\emph{not} have produced.')
        self.assertEqual(lines[17], 'the harnesses that fail when one guard is removed')
        # The two printed parts meet where the builds with a guard removed begin.
        self.assertEqual(len(lines), 29)
        failing, build = {}, None
        for line in lines[18:]:
            if line.startswith('  '):
                failing[build].append(line.strip())
            else:
                build = line
                failing[build] = []
        self.assertEqual(list(failing), GUARDS)
        self.assertEqual(failing['any-principal'], [OWNER_HARNESS])
        self.assertEqual(failing['two-processes'], [OWNER_HARNESS])
        self.assertEqual(failing['late-exit'], [RUNNING_HARNESS])
        self.assertEqual(failing['answer-exited'], [RUNNING_HARNESS])
        self.assertEqual(sorted(failing['sanction-per-account']), sorted([SANCTION_HARNESS, FRESH_HARNESS]))
        # Both tools catch every guard.
        for name in GUARDS:
            self.assertNotEqual(failing[name], ['NONE'], name)
            self.assertGreater(sum(self.guards[name][1:]), 0, name)
        self.quoted('Both tools catch all five.')
        # The two builds this one is compared with each had a guard that one tool could not see.
        self.quoted('\\weld{sealed:sec:sealed-gate}{two-room check}')
        self.assertIn('The two-room check cannot detect that this guard is missing.',
                      prose(ROOT / 'book' / 'additions' / 'sealed-build-the-gate.tex'))
        self.assertIn('and no harness fails on it', prose(ROOT / 'book' / 'additions' / 'ls-build-the-line.tex'))
        self.quoted('\\weld{ls:sec:ls-line}{one byte}')
        self.assertIn('Under Kani a hash is one byte', prose(ROOT / 'book' / 'additions' / 'ls-build-the-line.tex'))

    def test_each_guard_removed(self):
        self.assertEqual(list(self.guards), GUARDS)
        states, whitewashed, unearned, doubled, stale = self.guards['sanction-per-account']
        self.assertEqual((unearned, doubled, stale), (0, 0, 0))
        self.quoted('A core that counts a sanction only on the account that earned it is the second registry again, '
                    f'and {with_commas(whitewashed)} of its states are whitewashed.')
        states, whitewashed, unearned, doubled, stale = self.guards['late-exit']
        self.assertEqual((whitewashed, stale), (0, 0))
        self.quoted('A core that clears an account on any exit ends up with two processes running under one account '
                    f'in {doubled} states')
        self.quoted(f'the row is \\texttt{{late-exit}} with its {doubled} states', self.chapter)
        # The exercise's sequence is within the test's bounds, and uses all of two of them.
        header = ' '.join(line.strip() for line in run('accounts-guards')[1:5])
        self.assertIn('they start up to 3 processes between them', header)
        self.assertIn('The kernel records up to 2 exits', header)
        self.quoted("That takes 3 processes and 2 recorded exits, which are exactly the test's bounds", self.chapter)

    def test_the_exercises_are_where_the_chapter_points_and_their_sums_are_right(self):
        self.quoted('\\pdexercisepointer*{\\ref{ex:stp-property-reality}}{\\ref{ex:stp-resurrection-soundness}}', self.chapter)
        order = [self.chapter.index('{%s}' % label) for label in (
            'ex:stp-probation-cliff-sweep', 'ex:stp-account-eighty', 'ex:stp-account-siblings', 'ex:stp-account-late-exit',
            'ex:stp-account-principal')]
        self.assertEqual(order, sorted(order))
        self.assertLess(self.chapter.index('\\begin{pdsolution}{ex:stp-account-principal}'),
                        self.chapter.index('\\begin{pdexercise}[kind=Trace,rating=2]{ex:stp-resurrection-soundness}'))
        # Two workers of one principal, and a sanction against one of them.
        self.assertEqual((score(4, 1), score(0, 1), score(4, 0)), (60, 20, 90))
        self.quoted('Heron shows 4 passes and 1 sanction, a score of $50+40-30=60$. Drake shows 1 sanction and no '
                    'passes, a score of 20.', self.chapter)
        self.quoted('so it reports 4 passes and no sanction for Heron, a score of 90', self.chapter)
        for label in ('ex:stp-account-siblings', 'ex:stp-account-late-exit', 'ex:stp-account-principal'):
            self.quoted('(Exercise~\\ref{%s})' % label)


if __name__ == '__main__':
    unittest.main()
