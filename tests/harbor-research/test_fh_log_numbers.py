"""Chapter 8's build section quotes facts from its recorded runs. Check each against its run.

The section's listings cannot drift, because they are the recorded files.
Its prose and its exercises can. A sentence that says "in 4,608 of the
core's 8,000 states" was written by hand from a table the kernel printed,
and a later recording may print a different table. Each test here reads a
fact out of a recorded run and requires the sentence that quotes it.
"""
import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
EXCERPTS = ROOT / 'book' / 'excerpts'
SECTION = ROOT / 'book' / 'additions' / 'fh-build-the-log.tex'
CHAPTER = ROOT / 'book' / 'federated-harbor-whitepaper.tex'
WHOLE_RUNS = ['two-roots-latest', 'false-evidence-core', 'evidence', 'logs', 'logs-guards', 'models-witness']
PART_RUNS = {'two-roots-core': [(14, '1,10-22')], 'two-logs-separate': [(20, '1-17,24-26')],
             'two-logs-core': [(12, '1,16-26')]}
SNIPPETS = ['ch08-root', 'ch08-signed', 'ch08-latest', 'ch08-publish', 'ch08-second', 'ch08-evidence',
            'ch08-exchange']
DESIGNS = ['latest', 'separate', 'core']
GUARDS = ['unsigned-root', 'replace-root', 'one-signature', 'any-harbor', 'any-epoch', 'same-root']
ROOTS = ['acme-7', 'acme-8', "acme-8'", 'beta-8', 'wren-8']
EXERCISES = ['ex:fh-log-third', 'ex:fh-log-count', 'ex:fh-log-epoch', 'ex:fh-log-rewrite', 'ex:fh-log-withhold']
# The first eight digits of the roots of Acme's four events and of its five.
FOUR, FIVE = '38936ba2', '3c657ada'


def prose(path):
    """The file's text with comments dropped and white space collapsed."""
    lines = [re.split(r'(?<!\\)%', line, maxsplit=1)[0] for line in path.read_text().splitlines()]
    return re.sub(r'\s+', ' ', ' '.join(lines))


def run(name):
    """A recorded run, as lines."""
    return (EXCERPTS / f'{name}.txt').read_text().splitlines()


def steps(name):
    """The steps of a recorded scenario, each as one line with its wrapped lines joined."""
    joined = []
    for line in run(name):
        if line.startswith(' ' * 9) and joined:
            joined[-1] += ' ' + line.strip()
        else:
            joined.append(line)
    return [re.sub(r'\s+', ' ', line) for line in joined if line.startswith('step ')]


def table(name, rows):
    """A recorded table of counts: the cells after each named row's name."""
    found = {}
    for line in run(name):
        cells = line.split()
        if cells and cells[0] in rows and len(cells) > 1 and all(cell.isdigit() for cell in cells[1:]):
            found[cells[0]] = [int(cell) for cell in cells[1:]]
    return found


def with_commas(count):
    """A count as the Book prints it, with a comma for thousands."""
    return f'{count:,}'


class QuotedFacts(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.text = prose(SECTION)
        cls.chapter = prose(CHAPTER)
        # states, dropped, forged, accused, split, hidden
        cls.walk = table('logs', DESIGNS)
        # states, dropped, forged, accused, hidden, pairs
        cls.guards = table('logs-guards', GUARDS + ['(none)'])

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
                # The printed part runs through to the run's last line.
                self.assertEqual(max(span[-1] for span in spans), length, name)
        manifest = json.loads((EXCERPTS / 'manifest.json').read_text())
        recorded = {session['name'] for session in manifest['sessions']}
        self.assertLessEqual(set(WHOLE_RUNS) | set(PART_RUNS), recorded)
        # Every snippet this build has is printed in this section.
        cut = {excerpt['name'] for excerpt in manifest['excerpts'] if excerpt['name'].startswith('ch08-')}
        self.assertEqual(cut, set(SNIPPETS))
        self.assertIn('\\input{additions/fh-build-the-log}', CHAPTER.read_text())

    def test_the_two_roots_of_the_example(self):
        first = steps('two-roots-latest')
        self.assertIn(f"-> root {FIVE}, and acme's 5 events hash to it. C_A is revoked", first[1])
        self.assertIn(f"-> root {FOUR}, and acme's 4 events hash to it. C_A is not revoked", first[3])
        self.quoted(f"The root of Acme's four events begins \\texttt{{{FOUR}}}, and the root of all five begins "
                    f'\\texttt{{{FIVE}}}.')
        # The chapter's example, which the section says the code follows.
        self.quoted('R_A^{(8)}=H(R_A^{(7)},h_5)', self.chapter)
        self.quoted('so the root for epoch~8 is $H(R_A^{(7)},h_5)$, as the example has it')

    def test_the_first_log_and_its_break(self):
        first = steps('two-roots-latest')
        self.assertEqual(len(first), 5)
        self.assertTrue(first[0].endswith('publishes its root for epoch 8 to log 1: 5 events -> recorded'))
        self.assertIn('acme publishes another root for epoch 8 to log 1: 4 events -> replaced', first[2])
        self.assertTrue(first[4].startswith('step 5 beta audits'))
        self.assertIn(f'root {FOUR}', first[4])
        self.assertIn('LOG 1 NO LONGER HOLDS THE FIRST ROOT', ' '.join(run('two-roots-latest')[-2:]))
        self.quoted('\\texttt{publish} stored the second root where the first had been.')
        self.quoted("Beta's auditor concluded that $C_A$ is revoked, and the staging server's that it is not.")
        self.quoted('so at step~5 it is given the second root like everyone else')
        self.quoted('one party signing two different versions of the same record and showing each version to a '
                    'different audience', self.chapter)

    def test_the_fix_at_one_log(self):
        latest, core = run('two-roots-latest'), run('two-roots-core')
        # The printed lines start at step 3. The steps left out are the first two of the run before it.
        self.assertTrue(core[9].startswith('step 3 '))
        self.assertEqual(core[4:9], latest[4:9])
        self.quoted('The steps left out are the first two of Listing~\\ref{alg:fh-log-run-latest}.')
        fixed = steps('two-roots-core')
        self.assertIn('-> equivocation: log 1 keeps the first root, and holds the two as evidence', fixed[2])
        for step in fixed[3:5]:
            self.assertIn(f'evidence that acme signed two roots for it, {FIVE} and {FOUR}. Both signatures verify', step)
        self.quoted('Both auditors now get the same answer, and the answer is the pair.')
        self.quoted('It makes four checks: both signatures verify, both roots name one harbor, both are for one '
                    'epoch, and the two roots differ.')
        # The four checks, in the order the listing makes them.
        code = (EXCERPTS / 'ch08-evidence.code').read_text()
        order = [code.index(name) for name in ['signed(first)', 'one_harbor(', 'one_epoch(', 'differ(']]
        self.assertEqual(order, sorted(order))
        # What the section says of the two listings of the log's rule.
        self.assertIn('Outcome::Known', (EXCERPTS / 'ch08-publish.code').read_text())
        self.assertIn('MUTANT', (EXCERPTS / 'ch08-second.code').read_text())
        self.quoted('The same root arriving again is \\texttt{Known} and changes nothing')

    def test_two_logs_and_the_exchange(self):
        apart, together = run('two-logs-separate'), run('two-logs-core')
        separate = steps('two-logs-separate')
        self.assertEqual(len(separate), 7)
        self.assertTrue(separate[1].endswith('publishes another root for epoch 8 to log 2: 4 events -> recorded'))
        self.assertIn('-> nothing: logs of this design exchange nothing', separate[4])
        # Steps 6 and 7 are left out, and they repeat steps 3 and 4.
        self.assertTrue(apart[17].startswith('step 6 ') and apart[20].startswith('step 7 '))
        again = [re.sub(r'^step \d', 'step', line) for line in apart[17:23]]
        self.assertEqual(again, [re.sub(r'^step \d', 'step', line) for line in apart[9:15]])
        self.quoted('Steps 6 and 7, left out, repeat steps 3 and 4.')
        self.assertIn('NEITHER LOG HOLDS EVIDENCE', ' '.join(apart[-2:]))
        # With the exchange: the printed lines start at step 5, after the same four steps.
        self.assertTrue(together[15].startswith('step 5 '))
        self.assertEqual(together[4:15], apart[4:15])
        self.quoted('The steps left out are the first four of Listing~\\ref{alg:fh-log-run-separate}.')
        core = steps('two-logs-core')
        self.assertIn('C_A is not revoked', core[3])
        self.assertTrue(core[3].startswith('step 4 staging audits'))
        self.assertIn('log 1 and log 2 exchange the roots they hold -> each now holds evidence', core[4])
        self.assertIn(f'{FIVE} and {FOUR}', core[5])
        self.assertIn(f'{FOUR} and {FIVE}', core[6])
        self.quoted('Log~1 still holds the root it recorded first, and so does log~2.')
        self.quoted("The exchange happened at step~5. The staging server's auditor read that $C_A$ is not revoked "
                    'at step~4.')
        self.quoted('A witness bond pays out once equivocation is confirmed; it does not make the proof arrive by '
                    'any deadline.', self.chapter)

    def test_the_outsider(self):
        outsider = steps('false-evidence-core')
        self.assertEqual(len(outsider), 10)
        self.assertTrue(outsider[2].startswith('step 3 beta publishes its root for epoch 8'))
        self.assertIn('refused: root-not-signed', outsider[3])
        self.assertIn('-> known: log 1 already holds this root', outsider[4])
        codes = [re.search(r'refused: ([\w-]+)', step).group(1) for step in outsider[5:9]]
        self.assertEqual(codes, ['root-not-signed', 'other-epoch', 'other-harbor', 'same-root'])
        self.assertIn("acme's roots for epochs 7 and 8", outsider[6])
        self.quoted('Steps 6 to 9 are the four checks of \\texttt{proves}, each refusing a pair that fails it.')
        self.quoted("Step~5 is the retry: Acme's own root, published again, is not a second root.")
        self.quoted('Step~4 is refused by \\texttt{signed}.')
        self.quoted('Step~7 is worth a second look.')
        self.quoted("Beta's harbor publishes a root of its own at step 3.")

    def test_every_pair(self):
        lines = run('evidence')
        head = next(line for line in lines if line.startswith('first'))
        self.assertEqual(head.split()[2:], ROOTS)
        cells = {line.split()[0]: line.split()[1:] for line in lines if line.split() and line.split()[0] in ROOTS}
        self.assertEqual(sorted(cells), sorted(ROOTS))
        accepted = [(first, ROOTS[at]) for first, row in cells.items() for at, cell in enumerate(row) if cell == 'yes']
        self.assertEqual(sorted(accepted), [('acme-8', "acme-8'"), ("acme-8'", 'acme-8')])
        self.assertEqual(sum(len(row) for row in cells.values()), 25)
        self.quoted("Of the 25 pairs the core accepts 2, which are the two orders of Acme's two roots for epoch~8.")
        # The roots of acme-7 and acme-8' are one hash, and the pair is refused for its epochs.
        self.assertEqual(cells['acme-7'][ROOTS.index("acme-8'")], 'epoch')
        self.quoted("The pair of \\texttt{acme-7} and \\texttt{acme-8'} is refused as \\texttt{epoch}, although "
                    'their roots are the same hash.')

    def test_every_order(self):
        latest, separate, core = (self.walk[name] for name in DESIGNS)
        self.quoted(f'The first log drops a root in {with_commas(latest[1])} of its {with_commas(latest[0])} states.')
        # The logs that ask the core: the three columns of faults are zero.
        self.assertEqual(separate[1:4], [0, 0, 0])
        self.assertEqual(core[1:4], [0, 0, 0])
        self.quoted('Those three columns are zero for both.')
        self.assertEqual(separate[0], core[0])
        self.assertEqual(separate[4], core[4])
        self.assertTrue(all(row[4] > 0 for row in (latest, separate, core)))
        self.quoted('The column \\texttt{split} is not zero for any design')
        self.quoted(f"In {with_commas(core[4])} of the core's {with_commas(core[0])} states two logs hold different "
                    'roots for one epoch')
        self.quoted(f'one of the two logs lacks the evidence in {with_commas(separate[5])} of those states')
        self.assertEqual(core[5], 0)
        self.quoted(f'leaves both holding the evidence, in all {with_commas(core[4])}')
        self.quoted(f'An exhaustive test of three logs reaches {with_commas(core[0])} states. In '
                    f'{with_commas(core[4])} of them two logs hold different roots')
        self.assertIn('in every state, each log that asks the core holds exactly the', ' '.join(run('logs')))

    def test_each_guard_removed(self):
        self.assertEqual(sorted(self.guards), sorted(GUARDS + ['(none)']))
        self.quoted('The build has six guards.')
        self.assertEqual(len(GUARDS), 6)
        real = self.guards['(none)']
        self.assertEqual(real[1:5], [0, 0, 0, 0])
        for guard in GUARDS:
            self.assertNotEqual(self.guards[guard], real, guard)
        self.quoted('Every row differs from the first.')
        unsigned, replaced, same = (self.guards[name] for name in ['unsigned-root', 'replace-root', 'same-root'])
        self.quoted(f"holds Wren's root in {with_commas(unsigned[2])} states")
        self.assertTrue(replaced[1] > 0 and replaced[4] > 0)
        # The three that weaken the check of evidence alone: the logs are as the real core's, and more pairs pass.
        for guard in ['one-signature', 'any-harbor', 'any-epoch']:
            self.assertEqual(self.guards[guard][:5], real[:5], guard)
            self.assertGreater(self.guards[guard][5], real[5], guard)
        self.quoted('The three builds that weaken \\texttt{proves} alone leave the logs untouched')
        self.quoted(f'in {with_commas(same[3])} of its {with_commas(same[0])} states')
        self.assertIn('for two logs', ' '.join(run('logs-guards')[:3]))
        self.quoted('This table uses two logs')

    def test_the_models(self):
        lines = run('models-witness')
        files = [line for line in lines if line.endswith('.pv')]
        self.assertEqual(len(files), 6)
        results = {}
        for line in lines[1:]:
            if line.endswith('.pv'):
                results[line] = []
            else:
                results[files[len(results) - 1]].append(line)
        self.assertEqual(results['evidence.pv'], [
            'RESULT event(Accepted(m)) ==> event(Signed(m)) is true.',
            'RESULT not event(Evidence(pk(beta[]))) is true.',
            'RESULT not event(Evidence(pk(acme[]))) is false.',
        ])
        controls = [name for name in files if name != 'evidence.pv']
        self.assertEqual(len(controls), 5)
        for name in controls:
            self.assertIn('RESULT not event(Evidence(pk(beta[]))) is false.', results[name], name)
        self.assertIn('no-epoch-in-the-text.pv', controls)
        self.quoted('The other five files are controls.')
        self.quoted('In every one of them an auditor accepts evidence against Beta.')
        self.quoted('ProVerif~2.05 on the check of evidence, and on five controls.')
        self.quoted('Its third is \\texttt{false} on purpose')

    def test_the_exercises_are_in_the_chapter(self):
        source = CHAPTER.read_text()
        for label in EXERCISES:
            self.assertIn('{%s}' % label, source)
            self.assertIn('\\begin{pdsolution}{%s}' % label, source)
        for label in ['ex:fh-log-third', 'ex:fh-log-count', 'ex:fh-log-epoch', 'ex:fh-log-rewrite',
                      'ex:fh-log-withhold']:
            self.quoted('Exercise~\\ref{%s}' % label)
        self.quoted('\\texttt{no-epoch-in-the-text.pv}', self.chapter)
        # The verification-status row names the build.
        self.quoted('Signed-root comparison, built in \\S\\ref{sec:fh-log}', self.chapter)


if __name__ == '__main__':
    unittest.main()
