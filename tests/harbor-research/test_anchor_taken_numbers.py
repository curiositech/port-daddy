"""Chapter 2's third build quotes facts from its recorded runs. Hold each to its run.

The section's listings cannot drift: they are the recorded files. Its prose
can. A sentence that says "15 of the 66 pairs" was typed by hand from a run
the kernel printed, and a later recording may print another number. Each
test here reads a fact out of a recorded run, or out of the code the
section prints, and requires the sentence that quotes it.
"""
import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
EXCERPTS = ROOT / 'book' / 'excerpts'
SECTION = ROOT / 'book' / 'additions' / 'anchor-build-taken-back.tex'
CHAPTER = ROOT / 'book' / 'anchor-protocol-whitepaper.tex'


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


def asks(name):
    """Who asked the gate for something in a recorded scenario, when, and its answer."""
    found = []
    for line in said(name):
        match = re.match(r'^t=(\d+)\s+(\w+)\s+asks to .*? -> (admitted as \w+|refused: [a-z-]+ \([^)]*\))', line)
        if match:
            found.append((int(match[1]), match[2], match[3]))
    return found


def table(name):
    """A recorded `harbor links`: for each set of cards taken back, each gate's answer."""
    rows = {}
    for line in run(name):
        match = re.match(r'^(none|[123](?: [123])*) +(through|THROUGH|refused) +(through|THROUGH|refused)$', line)
        if match:
            rows[match[1]] = (match[2], match[3])
    return rows


def grid(name):
    """A recorded `harbor moments`: the mark at each pair of minutes, taken back and shown."""
    marks = {}
    for line in run(name):
        match = re.match(r'^ +(\d+) {6}(.*)$', line)
        if match:
            taken = int(match[1])
            cells = match[2]
            for shown in range(11):
                mark = cells[3 * shown: 3 * shown + 2].strip()
                if mark:
                    marks[(taken, shown)] = mark
    return marks


class QuotedFacts(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.text = prose(SECTION)
        cls.chapter = prose(CHAPTER)

    def quoted(self, sentence):
        self.assertIn(sentence, self.text)

    def partial(self, name, lines):
        """The section prints these lines of a run, and the run has them."""
        self.assertIn('{%s}{%s}' % (name, lines), self.text.replace(' ', ''))
        last = max(int(part.split('-')[-1]) for part in lines.split(','))
        self.assertLessEqual(last, len(run(name)), f'{name}.txt is shorter than the lines printed')

    def test_the_cards_under_a_card(self):
        found = asks('withdrawn-last-card')
        self.assertEqual([(who, answer.split(' (')[0]) for _, who, answer in found], [
            ('finch', 'admitted as finch'),
            ('wren', 'refused: withdrawn'),
            ('finch', 'admitted as finch'),
            ('wren', 'admitted as wren'),
        ])
        self.quoted("The gate does refuse Heron's card, even when it is shown by someone with his key.")
        self.quoted('Then it lets Finch through')
        self.quoted('It lets Wren through for the same reason')
        self.assertTrue(said('withdrawn-last-card')[-1].startswith('verdict: HONOURED AFTER IT WAS TAKEN BACK: finch and wren'))
        # The story the section tells is the one the run prints.
        self.assertIn("t=180000 wren   reads heron's key out of his memory, and his cards", run('withdrawn-last-card'))
        self.quoted("Heron's private key has leaked.")
        # The first try's code looks up the last card.
        last = (EXCERPTS / 'ch02c-last.code').read_text()
        self.assertIn('chain.at(-1)', last)
        self.assertNotIn('chain.map', last)
        self.quoted('refuses a chain whose last card is on the list')

    def test_the_fix_as_printed(self):
        standing = (EXCERPTS / 'ch02c-standing.code').read_text()
        self.assertIn('for (card, id) in links(&pass)', standing)
        self.assertIn('Reason::NotLookedUp', standing)
        self.assertIn('Reason::Withdrawn', standing)
        # The refusal for a card that was not looked up comes first.
        self.assertLess(standing.index('NotLookedUp'), standing.index('Reason::Withdrawn'))
        self.quoted('it refuses a showing if the gate looked up anything less')
        gate = (EXCERPTS / 'ch02c-gate.code').read_text()
        self.assertIn('chain.map(idIfCard)', gate)
        self.assertIn("op: 'withdraw', chain", gate)
        # The gate's check has no pause in it.
        self.assertNotIn('yield', gate)
        self.assertNotIn('await', gate)
        self.quoted('in the same turn as the decision')
        # "With two lines more": the two gates' admit, statement for statement.
        def statements(code):
            body = code[code.index('admit('):]
            body = body[:body.index('\n  }\n')]
            return [line for line in body.splitlines() if line.strip().startswith(('const ', 'this.', 'return ', 'if '))]
        second = statements((EXCERPTS / 'ch02b-gate.code').read_text())
        third = statements(gate)
        self.assertEqual(len(third) - len(second), 2)
        self.quoted('with two lines more')

    def test_the_leaked_key_against_the_fix(self):
        found = asks('withdrawn-core')
        refusal = 'refused: withdrawn (card 2 was taken back)'
        self.assertEqual([answer for _, _, answer in found], ['admitted as finch', refusal, refusal, refusal])
        self.quoted('Each refusal names card 2')
        self.assertTrue(said('withdrawn-core')[-1].startswith('verdict: no card honoured after it was taken back'))
        self.partial('withdrawn-core', '1,13-28')

    def test_every_set_of_cards(self):
        rows = table('links')
        self.assertEqual(len(rows), 8)
        self.assertIn('Listing~\\ref{alg:anchor-taken-links} has eight rows.', self.chapter)
        # The first try refuses exactly when the third card is among those taken back.
        for cards, (first, core) in rows.items():
            self.assertEqual(first == 'refused', '3' in cards, cards)
            self.assertEqual(core == 'refused', cards != 'none', cards)
        wrong = [cards for cards, (first, _) in rows.items() if first == 'THROUGH']
        self.assertEqual(sorted(wrong), ['1', '1 2', '2'])
        self.quoted('At this gate the chain stays good in three of the seven ways.')
        self.quoted('The first try refuses the chain when the third card is among those taken back, and at no other time.')
        self.quoted('The core refuses it in all seven ways.')
        self.assertIn('of the 7 ways to take a card back, 3 leave the chain good at the last-card gate, and 0 at the core\'s',
                      ' '.join(line.strip() for line in run('links')))
        # With the check narrowed to the last card, the core's column is the first try's.
        narrowed = table('links-last-card-only')
        self.assertEqual({cards: core for cards, (_, core) in narrowed.items()},
                         {cards: first for cards, (first, _) in rows.items()})
        self.partial('links-last-card-only', '1,5-16')

    def test_the_record_that_forgets(self):
        aged = (EXCERPTS / 'ch02c-aged.code').read_text()
        self.assertIn('now - at > KEEP', aged)
        self.assertIn('more than five minutes ago', aged)
        found = asks('forgotten-aged')
        self.assertEqual([(at, answer.split(' (')[0]) for at, _, answer in found], [
            (180000, 'refused: withdrawn'),
            (500000, 'admitted as heron'),
            (600001, 'refused: expired'),
        ])
        self.assertIn('t=500000 gate   drops 1 entry from its record', run('forgotten-aged'))
        self.quoted('At $t=500000$, eight minutes and twenty seconds in')
        self.assertEqual(500000, (8 * 60 + 20) * 1000)
        self.quoted("Heron's card has a hundred seconds left")
        self.assertIn('good until t=600000', ' '.join(said('forgotten-aged')))
        self.assertEqual((600000 - 500000) // 1000, 100)
        self.quoted("Alice takes Heron's card back three minutes into its ten")
        self.assertEqual(180000, 3 * 60 * 1000)
        # Against the fix the entry stays, and goes when the card has ended.
        kept = asks('forgotten-core')
        self.assertEqual([answer.split(' (')[0] for _, _, answer in kept],
                         ['refused: withdrawn', 'refused: withdrawn', 'refused: expired'])
        self.assertIn('t=500000 gate   drops nothing from its record', run('forgotten-core'))
        self.assertIn('t=600001 gate   drops 1 entry from its record', run('forgotten-core'))
        self.quoted('The entry goes when the card has ended.')
        self.partial('forgotten-core', '1,9-21')
        spent = (EXCERPTS / 'ch02c-spent.code').read_text()
        self.assertIn('Reason::StillGood', spent)
        forget = (EXCERPTS / 'ch02c-forget.code').read_text()
        self.assertIn("op: 'forget'", forget)

    def test_every_pair_of_minutes(self):
        aged = grid('moments-aged')
        self.assertEqual(len(aged), 66)
        through = [pair for pair, mark in aged.items() if mark == '!']
        self.assertEqual(len(through), 15)
        self.quoted('which is 15 of the 66 pairs')
        # Each is more than five minutes after the card was taken back.
        self.assertEqual(sorted(through), sorted(pair for pair in aged if pair[1] - pair[0] > 5))
        self.quoted('They sit where the showing is more than five minutes after the taking back')
        self.assertIn('15 of 66 showings let the card through after it was taken back', run('moments-aged'))
        self.assertIn('0 of 66 showings let the card through after it was taken back', run('moments-core'))
        self.assertEqual(run('moments-core')[18], '0 of 66 showings let the card through after it was taken back')
        self.quoted('Under the fix the count is none')
        self.partial('moments-core', '1,19')
        self.assertEqual(run('moments-forget-early')[18], '66 of 66 showings let the card through after it was taken back')
        self.quoted('every showing gets through')
        self.partial('moments-forget-early', '1,19')
        # The second exercise's counts.
        self.assertIn('The sum is 15.', self.chapter)
        self.assertEqual(sum(1 for taken in range(11) for shown in range(taken, 11) if shown - taken > 8), 3)
        self.assertIn('three in all', self.chapter)
        self.assertEqual(sum(1 for taken in range(11) for shown in range(taken, 11) if shown - taken > 10), 0)

    def test_the_first_exercise(self):
        self.assertIn('$2^3=8$ sets', self.chapter)
        self.assertEqual(2 ** 4 - 1, 15)
        self.assertEqual(2 ** 5 - 1, 31)
        self.assertIn('15 wrong, of the 31 ways', self.chapter)

    def test_the_model(self):
        printed = run('models-withdrawal')
        self.assertEqual(printed[1:], ['taken-back.pv', 'RESULT not event(Through(card_1)) cannot be proved.'])
        self.quoted("its answer in Listing~\\ref{alg:anchor-taken-models} is that the query ``cannot be proved''")
        self.quoted('The model, \\texttt{taken-back.pv}')

    def test_every_recorded_run_of_this_build_is_printed(self):
        manifest = json.loads((EXCERPTS / 'manifest.json').read_text())
        runs = {session['name'] for session in manifest['sessions']}
        for name in ['withdrawn-last-card', 'withdrawn-core', 'links', 'links-last-card-only', 'forgotten-aged',
                     'forgotten-core', 'moments-aged', 'moments-core', 'moments-forget-early', 'models-withdrawal']:
            self.assertIn(name, runs)
            self.assertRegex(self.text, r'\\pdrun(lines)?\[[^\]]*\]\{%s\}' % re.escape(name))

    def test_each_listing_asks_for_room_for_all_its_lines(self):
        """A listing stays on one page if the room asked for is its own length."""
        source = SECTION.read_text()
        asked = re.findall(
            r'\\pdlistingroom\{(\d+)\}\n\\(pdexcerpt|pdrun|pdrunlines)\[.*?label=\{[^}]*\}\]'
            r'\{([^}]*)\}(?:\{([^}]*)\})?', source, flags=re.S)
        set_here = len(re.findall(r'^\\(?:pdexcerpt|pdrun|pdrunlines)\[', source, flags=re.M))
        self.assertEqual(len(asked), set_here, 'a listing is set with no \\pdlistingroom before it')
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
