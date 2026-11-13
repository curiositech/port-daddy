"""Chapter 2's fourth build section states facts from its recorded runs. Check each one.

The section's listings are the recorded files, so they cannot go out of
date. Its prose can, and so can the one number typed into its figure. A
sentence that says "once in 72 tries" was typed from a run the kernel
printed, and a later recording may print a different number. Each test here
reads a fact from a recorded run and checks that the text states it.
"""
import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
EXCERPTS = ROOT / 'book' / 'excerpts'
SECTION = ROOT / 'book' / 'additions' / 'anchor-build-told.tex'
FIGURE = ROOT / 'book' / 'figures' / 'fig-anchor-gossip-rounds.tex'
CHAPTER = ROOT / 'book' / 'anchor-protocol-whitepaper.tex'
RUNS = ['two-gates-local', 'false-notice-unverified', 'two-gates-core', 'false-notice-core',
        'false-notice-unsigned', 'spread', 'gossip', 'gossip-loss', 'gossip-partition', 'gossip-each', 'fits']


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


def requests(name):
    """Each request in a recorded scenario, as (who, gate, answer)."""
    found = []
    for line in unwrapped(name):
        match = re.match(r'^t=\d+\s+(\w+)\s+requests to .*? at the (near|far) gate.*? -> (admitted as \w+|refused: [a-z-]+)', line)
        if match:
            found.append((match[1], match[2], match[3]))
    return found


def table(name):
    """A recorded table: its column names, and its rows as numbers. Remarks start with '#'."""
    rows = [line.split() for line in run(name)[1:] if line and not line.startswith('#')]
    return rows[0], [[float(cell) for cell in row] for row in rows[1:]]


def remarks(name):
    """The remarks of a recorded table, with wrapped lines joined."""
    joined = []
    for line in run(name):
        if line.startswith('#   ') and joined:
            joined[-1] += ' ' + line[4:]
        elif line.startswith('# '):
            joined.append(line[2:])
    return joined


class QuotedFacts(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.text = prose(SECTION)
        cls.chapter = prose(CHAPTER)
        cls.figure = FIGURE.read_text()

    def quoted(self, sentence):
        self.assertIn(sentence, self.text)

    def partial(self, name, lines):
        """The section prints these lines of a run, and the run has them."""
        self.assertIn('{%s}{%s}' % (name, lines), self.text.replace(' ', ''))
        last = max(int(part.split('-')[-1]) for part in lines.split(','))
        self.assertLessEqual(last, len(run(name)), f'{name}.txt is shorter than the lines printed')

    def test_a_gate_that_was_not_informed(self):
        self.partial('two-gates-local', '1,9-30')
        self.assertEqual(requests('two-gates-local'), [
            ('wren', 'near', 'refused: revoked'), ('wren', 'far', 'admitted as heron'),
            ('wren', 'near', 'refused: revoked'), ('wren', 'far', 'admitted as heron')])
        self.assertTrue(any('exchange notices -> nothing' in line for line in unwrapped('two-gates-local')))
        self.quoted('The near gate refuses the card and the far gate accepts it.')
        self.quoted('A minute later the gates exchange notices')
        times = [int(re.match(r't=(\d+)', line)[1]) for line in unwrapped('two-gates-local') if 'exchange notices' in line]
        self.assertEqual(times, [240000])

    def test_someone_who_is_not_a_gate_sends_two_entries(self):
        self.partial('false-notice-unverified', '1,13-35')
        lines = unwrapped('false-notice-unverified')
        sent = [line for line in lines if ' wren ' in line and 'sends the far gate' in line]
        self.assertEqual([line.rsplit('-> ', 1)[1] for line in sent], ['2 cards added to its revocation list', 'nothing added'])
        self.assertTrue(any('exchange notices -> the near gate adds 1 card to its revocation list' in line for line in lines))
        self.assertTrue(any(line.startswith('t=180001') and 'the far gate removes 1 entry' in line for line in lines))
        self.assertEqual(requests('false-notice-unverified'), [('finch', 'far', 'refused: revoked'), ('wren', 'far', 'admitted as heron')])
        self.quoted('says that the card expires at $t=180000$, which is now')
        self.quoted('the near gate adds one card to its list. That is Finch\'s.')
        # The card was valid until t=600000, and is accepted again at t=180001.
        self.assertEqual(round((600000 - 180001) / 60000), 7)
        self.quoted('with seven minutes left')
        # The harbor issues Alice's card first and Finch's second, and numbers them in that order.
        issued = [re.search(r'harbor issues (\w+) a card', line)[1] for line in lines if 'harbor issues' in line]
        self.assertEqual(issued, ['alice', 'finch'])
        self.assertTrue(any(re.fullmatch(r' +jti +card-1', line) for line in run('cards')))
        self.quoted('his is \\texttt{card-2}')

    def test_two_gates_that_gossip(self):
        self.partial('two-gates-core', '1,9-30')
        self.assertEqual(requests('two-gates-core'), [
            ('wren', 'near', 'refused: revoked'), ('wren', 'far', 'admitted as heron'),
            ('wren', 'near', 'refused: revoked'), ('wren', 'far', 'refused: revoked')])
        # Wren's first request at the far gate is admitted.
        self.assertIn('at the far', run('two-gates-core')[15])
        self.assertIn('admitted as heron', run('two-gates-core')[17])
        self.assertIn('Before that the far gate admitted it once', ' '.join(unwrapped('two-gates-core')))
        self.quoted("Look at Wren's first request at the far gate.")

    def test_the_false_notice_against_the_fix(self):
        self.partial('false-notice-core', '1,15-33')
        lines = unwrapped('false-notice-core')
        self.assertEqual(sum(' wren ' in line and line.endswith('-> nothing added') for line in lines), 2)
        self.assertEqual(requests('false-notice-core'), [('finch', 'far', 'admitted as finch'), ('wren', 'far', 'refused: revoked')])
        self.assertTrue(any('the far gate removes nothing' in line for line in lines))

    def test_the_fix_without_the_signature_check(self):
        self.partial('false-notice-unsigned', '1,19-32')
        lines = unwrapped('false-notice-unsigned')
        self.assertIn('--mutant unsigned', lines[0])
        self.assertTrue(any('sends the far gate' in line and line.endswith('-> 1 card added to its revocation list') for line in lines))
        self.assertEqual(requests('false-notice-unsigned')[-1], ('wren', 'far', 'admitted as heron'))
        self.assertTrue(lines[-1].startswith('verdict: ACCEPTED AGAIN'))

    def test_the_exact_rounds(self):
        self.partial('spread', '1,11-27')
        names, rows = table('spread')
        self.assertEqual(names, ['gates', 'all', 'one'])
        by = {int(row[0]): row for row in rows}
        self.assertEqual(sorted(by), [2, 3, 4, 5, 8, 16, 32, 64])
        self.assertEqual((by[3][1], by[3][2]), (1.5, 1.25))
        self.assertEqual((round(by[5][1], 2), round(by[5][2], 2)), (2.37, 1.68))
        self.quoted('With five gates they are $2.37$ and $1.68$ rounds.')
        self.assertIn('revocation takes $2.37$ rounds on average', self.text)
        self.assertIn('to $1.68$ rounds on average for one gate among five', self.text)
        fractions = remarks('spread')
        self.assertIn('3 gates: all 3/2, one 5/4', fractions)
        # From 4 gates to 64 each doubling adds about one round, and less each time.
        gains = [by[b][1] - by[a][1] for a, b in [(4, 8), (8, 16), (16, 32), (32, 64)]]
        for gain in gains:
            self.assertTrue(0.85 < gain < 1.15, gain)
        self.assertEqual(gains, sorted(gains, reverse=True))
        self.quoted('From 4 gates to 64, each doubling adds about one round, and a little less each time.')
        # The exact figures against the growth proved for large networks.
        growth = next(line for line in fractions if line.startswith('log3 D + log2 ln D'))
        below = [float(x) for x in re.findall(r'\d\.\d\d', growth)]
        self.assertEqual(len(below), 5)
        for gap in below[1:]:
            self.assertTrue(abs(gap - 1 / 6) < 0.02, gap)
        self.quoted('from 8 gates to 64 the two differ by a steady sixth of a round')
        # The exercise on a card's last minutes.
        self.assertEqual((round(by[5][2] * 30), round(by[64][2] * 30), round(by[64][2], 2)), (50, 118, 3.93))
        self.assertIn('$1.68$ rounds among five gates and $3.93$ among 64, so about 50 seconds and about two minutes', self.chapter)

    def test_the_runs_beside_the_model(self):
        self.partial('gossip', '1,12-22')
        for name in ['gossip', 'gossip-loss']:
            names, rows = table(name)
            self.assertEqual(names, ['gates', 'exact', 'mean', 'low', 'high', 'z'])
            self.assertEqual([int(row[0]) for row in rows], [3, 4, 5, 8, 16, 32])
            for gates, exact, mean, low, high, z in rows:
                self.assertTrue(low <= exact <= high, f'{name}, {gates} gates')
            self.assertIn('400 runs for each number of gates', remarks(name))
        self.quoted('should fall inside the interval in most rows')
        self.quoted('It does in all six.')
        self.quoted('The average of 400 runs is not the true figure')
        self.assertIn('an exchange is lost with probability 1/4', ' '.join(remarks('gossip-loss')))
        self.quoted('while one exchange in four is lost')
        # Loss slows the spread at every size.
        clear = {row[0]: row[1] for row in table('gossip')[1]}
        for gates, exact, *_ in table('gossip-loss')[1]:
            self.assertGreater(exact, clear[gates])

    def test_a_partition(self):
        self.partial('gossip-partition', '1,14-16')
        names, rows = table('gossip-partition')
        self.assertEqual(names[-1], 'least')
        self.assertEqual([row[-1] for row in rows], [6, 6])
        self.assertIn('for the first 5 rounds no exchange crosses between the first half of the gates and the rest', remarks('gossip-partition'))
        self.quoted('for five rounds')
        self.quoted('and it is 6')

    def test_the_rounds_five_gates_took(self):
        self.partial('gossip-each', '1,11-21')
        names, rows = table('gossip-each')
        self.assertEqual(names, ['rounds', 'observed', 'expected', 'share', 'exact'])
        self.assertEqual(sum(row[1] for row in rows), 4000)
        self.assertEqual((rows[0][1], rows[0][2]), (45, 62.5))
        self.assertEqual(4000 / 64, 62.5)
        self.quoted('$4000/64$ is the $62.50$ under \\texttt{expected}. The runs gave 45.')
        closing = ' '.join(remarks('gossip-each'))
        self.assertIn('chi-square 10.65 on 3 degrees of freedom', closing)
        self.assertIn('p = 0.0138', closing)
        self.assertIn('the significance level, set in advance, is 0.01', closing)
        chi = sum((observed - expected) ** 2 / expected for _, observed, expected, *_ in rows)
        self.assertEqual(round(chi, 1), 10.6)
        self.quoted('and the sum is $10.65$')
        self.quoted('is $0.0138$, about once in 72 tries')
        self.quoted('The significance level, $0.01$, was set before any run.')

    def test_the_fit_for_other_seeds(self):
        names, rows = table('fits')
        self.assertEqual(names, ['p', 'seeds', 'expected'])
        self.assertEqual([row[0] for row in rows], [tenth / 10 for tenth in range(10)])
        self.assertEqual(sum(row[1] for row in rows), 200)
        self.assertEqual({row[2] for row in rows}, {20})
        closing = next(line for line in remarks('fits') if line.startswith('seed 20261111 gives'))
        own, fewer, expected = re.match(r'seed 20261111 gives (0\.\d+); (\d+) of the 200 gave less, where a uniform distribution expects (\d\.\d)', closing).groups()
        self.assertEqual((own, fewer, expected), ('0.0138', '3', '2.8'))
        self.quoted('and 3 of the 200 are smaller than this book\'s, where a uniform distribution expects $2.8$')
        # The one number typed into the figure is this Book's p-value.
        self.assertIn('(axis cs:%s,0)' % own, self.figure)
        self.assertEqual(round(1 / float(own)), 72)

    def test_the_figure_plots_the_recorded_runs(self):
        for name in ['spread', 'gossip', 'gossip-loss', 'fits']:
            self.assertIn('{excerpts/%s.txt}' % name, self.figure)
        self.assertIn('\\input{figures/fig-anchor-gossip-rounds}', SECTION.read_text())
        caption = prose(FIGURE)
        self.assertIn('the means of 400 runs with 95\\% intervals', caption)
        self.assertIn('for seeds 1 to 200, by tenths; a uniform distribution puts 20 in each, the dotted level', caption)

    def test_the_exercises(self):
        self.assertEqual(1 / 2 + 1 / 2 * 1 / 2, 3 / 4)
        self.assertEqual(3 / 4 * 1 + 1 / 4 * 2, 5 / 4)
        self.assertIn('$\\tfrac34\\cdot1+\\tfrac14\\cdot2=\\tfrac54$', self.chapter)
        self.assertEqual((1 / 4) ** 3, 1 / 64)
        self.assertIn('all three do with probability $\\tfrac1{64}$, and $4000/64=62.5$', self.chapter)
        self.assertIn('and the probability is $\\tfrac19$', self.chapter)

    def test_the_chapter_points_here(self):
        self.assertIn('\\S\\ref{sec:anchor-build-told} builds the gossip}', self.chapter)
        self.assertIn('\\S\\ref{sec:anchor-build-told} builds this exchange for the Book\'s kernel', self.chapter)
        self.assertIn('\\bibitem{doerr2017rumor}', CHAPTER.read_text())
        self.quoted('~\\pdcite{doerr2017rumor}')

    def test_every_recorded_run_of_this_build_is_printed_or_plotted(self):
        manifest = json.loads((EXCERPTS / 'manifest.json').read_text())
        runs = {session['name'] for session in manifest['sessions']}
        for name in RUNS:
            self.assertIn(name, runs)
            printed = re.search(r'\\pdrun(lines)?\[[^\]]*\]\{%s\}' % re.escape(name), self.text)
            plotted = '{excerpts/%s.txt}' % name in self.figure
            self.assertTrue(printed or plotted, name)

    def test_each_listing_asks_for_room_for_all_its_lines(self):
        """A listing stays on one page if the room asked for is its own length."""
        source = SECTION.read_text()
        asked = re.findall(
            r'\\pdlistingroom\{(\d+)\}\n\\(pdexcerpt|pdrun|pdrunlines)\[.*?label=\{[^}]*\}\]'
            r'\{([^}]*)\}(?:\{([^}]*)\})?', source, flags=re.S)
        printed = len(re.findall(r'^\\(?:pdexcerpt|pdrun|pdrunlines)\[', source, flags=re.M))
        self.assertEqual(len(asked), printed, 'a listing is printed with no \\pdlistingroom before it')
        for room, macro, name, ranges in asked:
            if macro == 'pdexcerpt':
                lines = len((EXCERPTS / f'{name}.code').read_text().splitlines())
            elif macro == 'pdrun':
                lines = len(run(name))
            else:
                lines = 0
                for part in ranges.split(','):
                    first, _, last = part.partition('-')
                    lines += int(last or first) - int(first) + 1
            self.assertEqual(int(room), lines, f'{name}: room for {room} lines, and it has {lines}')


if __name__ == '__main__':
    unittest.main()
