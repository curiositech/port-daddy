"""Chapter 0's build quotes numbers from its recorded runs. Hold each to its run.

The section's listings cannot drift: they are the recorded files. Its prose
can. A sentence that says "from round 35" was typed by hand from a table
that the kernel printed, and a later recording may print another number.
Each test here reads a number out of a recorded run and requires the
sentence that quotes it.
"""
import re
import unittest
from fractions import Fraction
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
EXCERPTS = ROOT / 'book' / 'excerpts'
SECTION = ROOT / 'book' / 'additions' / 'prereq-build-the-check.tex'
CHAPTER = ROOT / 'book' / 'coordination-papers-mega-volume-chapter-0.tex'


def prose(path):
    """The file's text with comments dropped and white space collapsed."""
    lines = [re.split(r'(?<!\\)%', line, maxsplit=1)[0] for line in path.read_text().splitlines()]
    return re.sub(r'\s+', ' ', ' '.join(lines))


def survival(name):
    """A recorded `harbor survival` table: its remarks, and its rows by round."""
    remarks, rows, columns = [], {}, None
    for line in (EXCERPTS / f'{name}.txt').read_text().splitlines()[1:]:
        if line.startswith('#'):
            if line.startswith('#   ') and remarks:
                remarks[-1] += ' ' + line[4:]
            else:
                remarks.append(line[2:])
        elif columns is None:
            columns = line.split()
        else:
            row = dict(zip(columns, line.split()))
            rows[int(row['rounds'])] = row
    return remarks, rows


def orders(name):
    """A recorded `harbor orders` table: design -> (orders, losing, chance)."""
    found = {}
    for line in (EXCERPTS / f'{name}.txt').read_text().splitlines():
        match = re.match(r'^(blind|look-twice|checked)\s+(\d+)\s+(\d+)\s+(\S+)$', line)
        if match:
            found[match[1]] = (int(match[2]), int(match[3]), Fraction(match[4]))
    return found


def remark(remarks, opening):
    return next(text for text in remarks if text.startswith(opening))


class QuotedNumbers(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.text = prose(SECTION)
        cls.blind = survival('survival-blind')
        cls.twice = survival('survival-look-twice')
        cls.checked = survival('survival-checked')
        cls.bursty = survival('survival-bursty')

    def quoted(self, sentence):
        self.assertIn(sentence, self.text)

    def test_the_size_of_the_simulation(self):
        for remarks, _ in (self.blind, self.twice, self.checked, self.bursty):
            self.assertTrue(remark(remarks, '1000 jobs of 600 rounds').endswith('a worker thinks for 8 turns'))
        self.quoted('A job is 600 rounds.')
        self.quoted('A worker thinks for 8 turns')
        self.quoted('runs 1,000 such jobs for each design')
        self.assertIn('the workers overlap in 1 round of 50', self.blind[0][0])
        self.quoted('In 1 round of 50 their turns overlap')
        self.assertIn('1 round of 500 when calm, 1 of 5 when busy', self.bursty[0][0])
        self.quoted('In a calm spell 1 round of 500 overlaps, and in a busy spell 1 round of 5.')

    def test_the_halfway_rounds(self):
        opening = 'the chance a job is still safe is a half or less '
        self.assertEqual(remark(self.blind[0], opening), opening + 'from round 35')
        self.assertEqual(remark(self.twice[0], opening), opening + 'from round 187')
        self.quoted('still safe is a half or less from round 35')
        self.quoted('Looking twice moves the halfway point to round 187')
        # "about five times as long"
        self.assertEqual(round(187 / 35), 5)

    def test_the_counts_at_the_last_round(self):
        self.assertEqual(self.blind[1][600]['safe'], '0')
        self.quoted('no job of the 1,000 is safe at round 600')
        self.assertEqual(self.twice[1][600]['safe'], '116')
        self.quoted('leaves 116 jobs safe at round 600')
        self.assertEqual({row['safe'] for row in self.checked[1].values()}, {'1000'})
        self.quoted('all 1,000 jobs are safe at every row')

    def test_how_often_the_exact_curve_is_inside_the_interval(self):
        closing = 'exact is inside the interval in '
        self.assertEqual(remark(self.blind[0], closing), closing + '23 of 25 rows')
        self.assertEqual(remark(self.twice[0], closing), closing + '25 of 25 rows')
        self.quoted('23 of the 25 rows for the blind design and in all 25 for looking twice')

    def test_what_a_thousand_safe_jobs_support(self):
        self.assertEqual({row['low'] for row in self.checked[1].values()}, {'0.9962'})
        self.assertEqual({row['high'] for row in self.checked[1].values()}, {'1.0000'})
        self.quoted('1,000 safe jobs of 1,000 runs from 0.9962 to 1')
        self.quoted('fewer than four jobs in a thousand')

    def test_the_bursty_panel(self):
        last = self.bursty[1][600]
        self.assertEqual(f"{float(last['bound']):.2f}", '0.30')
        self.assertEqual(last['exact'], '0.0005')
        self.quoted('At round 600 the bound allows a share of 0.30, and the exact share is 0.0005.')
        self.assertEqual(f"{float(self.blind[1][100]['exact']):.2f}", '0.13')
        self.assertEqual(f"{float(self.bursty[1][100]['exact']):.2f}", '0.29')
        self.quoted('At round 100 the exact shares are 0.13 when the overlap is steady and 0.29 when it comes in bursts.')
        for rounds, row in self.bursty[1].items():
            if rounds:
                self.assertLess(float(row['exact']), float(row['bound']))
                self.assertGreater(float(row['exact']), float(self.blind[1][rounds]['exact']) - 5e-5)

    def test_the_counts_of_orders(self):
        two = orders('orders')
        self.assertEqual(two['blind'], (6, 4, Fraction(1, 2)))
        self.quoted('Four of the six lose an update.')
        self.assertEqual(two['look-twice'], (20, 12, Fraction(3, 8)))
        self.quoted('Looking twice has 20 orders')
        self.quoted('12 orders of 20 come to a chance of 3/8')
        self.assertEqual(two['checked'][1], 0)
        self.assertEqual(orders('orders-three')['checked'][:2], (198, 0))
        self.quoted('any of its 198 orders')
        self.assertGreater(orders('orders-three')['look-twice'][2], two['look-twice'][2])
        self.quoted('Looking twice gets worse with more workers')
        self.assertEqual(orders('orders-blind-put')['checked'], two['blind'])
        self.quoted('loses the same four orders that the blind design loses')
        blind = [line for line in (EXCERPTS / 'orders-blind.txt').read_text().splitlines() if ' -> ' in line]
        self.assertEqual(len(blind), 6)
        self.assertEqual(sum('LOST UPDATE' in line for line in blind), 4)

    def test_the_chances_when_a_worker_thinks_for_eight_turns(self):
        eight = orders('orders-think-8')
        self.assertEqual(eight['blind'][2], Fraction(255, 256))
        self.assertEqual(eight['look-twice'][2], Fraction(12155, 65536))
        self.quoted('with chance 255/256 under the blind design')
        self.quoted('12155/65536, a little under 1/5')
        self.assertLess(eight['look-twice'][2], Fraction(1, 5))
        self.assertGreater(eight['look-twice'][2], Fraction(9, 50))
        self.assertEqual(f"{float(eight['blind'][2] / 50):.3f}", '0.020')
        self.assertEqual(f"{float(eight['look-twice'][2] / 50):.4f}", '0.0037')
        self.quoted('chance about 0.020 for the blind design and 0.0037 for looking twice')
        self.assertEqual(eight['checked'][1], 0)

    def test_the_recorded_run_of_each_design(self):
        blind = (EXCERPTS / 'increments-blind.txt').read_text()
        self.assertIn('wren   put 1 -> ok, now version 2', blind)
        self.quoted('The version went to 2')
        twice = (EXCERPTS / 'increments-look-twice.txt').read_text().splitlines()
        self.assertIn('read -> 0, version 0', twice[6])
        self.assertTrue(twice[6].startswith('step 3'))
        self.assertTrue(twice[7].startswith('step 4'))
        self.quoted('Steps 3 and 4 are the second looks.')
        checked = (EXCERPTS / 'increments-checked.txt').read_text()
        self.assertRegex(checked, r'step 4 +wren +put 1 \(read at version 0\)\n +-> refused: stale-read')
        self.quoted('Step 4 is the refusal.')

    def test_the_exercises_quote_the_same_counts(self):
        chapter = prose(CHAPTER)
        self.assertIn('counts 20 orders for two workers that look twice, and 12 that lose an update', chapter)
        self.assertIn('$255/256$ and $48620/262144=12155/65536$', chapter)
        self.assertEqual(Fraction(48620, 262144), Fraction(12155, 65536))


if __name__ == '__main__':
    unittest.main()
