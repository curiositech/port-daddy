"""Chapter 2's third build section states facts from its recorded runs. Check each one.

The section's listings are the recorded files, so they cannot go out of
date. Its prose can. A sentence that says "15 of the 66 pairs" was typed
from a run the kernel printed, and a later recording may print a different
number. Each test here reads a fact from a recorded run, or from the code
the section prints, and checks that the text states it.
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
    """Each request in a recorded scenario, as (time, who, answer)."""
    found = []
    for line in unwrapped(name):
        match = re.match(r'^t=(\d+)\s+(\w+)\s+requests to .*? -> (admitted as \w+|refused: [a-z-]+ \([^)]*\))', line)
        if match:
            found.append((int(match[1]), match[2], match[3]))
    return found


def table(name):
    """A recorded `harbor subsets`: for each set of revoked cards, each gate's answer."""
    rows = {}
    for line in run(name):
        match = re.match(r'^(none|[123](?: [123])*) +(admitted|ADMITTED|refused) +(admitted|ADMITTED|refused)$', line)
        if match:
            rows[match[1]] = (match[2], match[3])
    return rows


def grid(name):
    """A recorded `harbor timings`: the mark at each pair of minutes, revoked and presented."""
    marks = {}
    for line in run(name):
        match = re.match(r'^ +(\d+) {6}(.*)$', line)
        if match:
            revoked = int(match[1])
            cells = match[2]
            for presented in range(11):
                mark = cells[3 * presented: 3 * presented + 2].strip()
                if mark:
                    marks[(revoked, presented)] = mark
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

    def test_the_cards_delegated_from_a_revoked_card(self):
        found = requests('revoked-last-card')
        self.assertEqual([(who, answer.split(' (')[0]) for _, who, answer in found], [
            ('finch', 'admitted as finch'),
            ('wren', 'refused: revoked'),
            ('finch', 'admitted as finch'),
            ('wren', 'admitted as wren'),
        ])
        self.quoted("The gate does refuse Heron's card, even when it is presented by someone with his key.")
        self.quoted('Then it admits Finch')
        self.quoted('It admits Wren for the same reason')
        self.assertTrue(unwrapped('revoked-last-card')[-1].startswith('verdict: ACCEPTED AFTER REVOCATION: finch and wren'))
        # The section describes the events the run prints.
        self.assertIn("t=180000 wren   copies heron's key from his memory, and his cards", run('revoked-last-card'))
        self.quoted("Heron's private key has leaked.")
        # The first attempt's code looks up the last card.
        last = (EXCERPTS / 'ch02c-last.code').read_text()
        self.assertIn('chain.at(-1)', last)
        self.assertNotIn('chain.map', last)
        self.quoted('refuses a chain whose last card is listed')

    def test_the_fix_as_printed(self):
        check = (EXCERPTS / 'ch02c-not-revoked.code').read_text()
        self.assertIn('for (card, id) in checked_cards(&pass)', check)
        self.assertIn('Reason::NotLookedUp', check)
        self.assertIn('Reason::Revoked', check)
        # The refusal for a card that was not looked up comes first.
        self.assertLess(check.index('NotLookedUp'), check.index('Reason::Revoked'))
        self.quoted('it refuses a presentation if the gate did not look up every one')
        gate = (EXCERPTS / 'ch02c-gate.code').read_text()
        self.assertIn('chain.map(idIfCard)', gate)
        self.assertIn("op: 'revoke', chain", gate)
        # The gate's check has no pause in it.
        self.assertNotIn('yield', gate)
        self.assertNotIn('await', gate)
        self.quoted('in the same turn as the decision')
        # "With three more lines": the two gates' admit, statement for statement.
        def statements(code):
            body = code[code.index('admit('):]
            body = body[:body.index('\n  }\n')]
            return [line for line in body.splitlines() if line.strip().startswith(('const ', 'this.', 'return ', 'if '))]
        second = statements((EXCERPTS / 'ch02b-gate.code').read_text())
        third = statements(gate)
        self.assertEqual(len(third) - len(second), 3)
        self.quoted('with three more lines')

    def test_the_leaked_key_against_the_fix(self):
        found = requests('revoked-core')
        refusal = 'refused: revoked (card 2 was revoked)'
        self.assertEqual([answer for _, _, answer in found], ['admitted as finch', refusal, refusal, refusal])
        self.quoted('Each refusal names card 2')
        self.assertTrue(unwrapped('revoked-core')[-1].startswith('verdict: no revoked card accepted'))
        self.partial('revoked-core', '1,13-27')

    def test_every_set_of_cards(self):
        rows = table('subsets')
        self.assertEqual(len(rows), 8)
        self.assertIn('Listing~\\ref{alg:anchor-taken-links} has eight rows.', self.chapter)
        # The first attempt refuses exactly when the third card is among those revoked.
        for cards, (first, core) in rows.items():
            self.assertEqual(first == 'refused', '3' in cards, cards)
            self.assertEqual(core == 'refused', cards != 'none', cards)
        wrong = [cards for cards, (first, _) in rows.items() if first == 'ADMITTED']
        self.assertEqual(sorted(wrong), ['1', '1 2', '2'])
        self.quoted('At this gate the chain is still admitted for three of the seven sets.')
        self.quoted('The first attempt refuses the chain when the third card is among those revoked, and at no other time.')
        self.quoted('The core refuses it for all seven sets.')
        self.assertIn('of the 7 sets with a revoked card, 3 are still admitted at the last-card gate, and 0 at the core\'s',
                      ' '.join(line.strip() for line in run('subsets')))
        # With the check narrowed to the last card, the core's column is the first attempt's.
        narrowed = table('subsets-last-card-only')
        self.assertEqual({cards: core for cards, (_, core) in narrowed.items()},
                         {cards: first for cards, (first, _) in rows.items()})
        self.partial('subsets-last-card-only', '1,6-17')

    def test_the_list_pruned_by_age(self):
        ttl = (EXCERPTS / 'ch02c-ttl.code').read_text()
        self.assertIn('now - at > TTL', ttl)
        self.assertIn('more than five minutes ago', ttl)
        found = requests('pruned-ttl')
        self.assertEqual([(at, answer.split(' (')[0]) for at, _, answer in found], [
            (180000, 'refused: revoked'),
            (500000, 'admitted as heron'),
            (600001, 'refused: expired'),
        ])
        self.assertIn('t=500000 gate   removes 1 entry from its revocation list', run('pruned-ttl'))
        self.quoted('At $t=500000$, eight minutes and twenty seconds in')
        self.assertEqual(500000, (8 * 60 + 20) * 1000)
        self.quoted("Heron's card has a hundred seconds left")
        self.assertIn('valid until t=600000', ' '.join(unwrapped('pruned-ttl')))
        self.assertEqual((600000 - 500000) // 1000, 100)
        self.quoted("Alice revokes Heron's card three minutes into its ten")
        self.assertEqual(180000, 3 * 60 * 1000)
        # Against the fix the entry is kept, and is pruned when the card has expired.
        kept = requests('pruned-core')
        self.assertEqual([answer.split(' (')[0] for _, _, answer in kept],
                         ['refused: revoked', 'refused: revoked', 'refused: expired'])
        self.assertIn('t=500000 gate   removes nothing from its revocation list', run('pruned-core'))
        self.assertIn('t=600001 gate   removes 1 entry from its revocation list', run('pruned-core'))
        self.quoted('The entry is pruned when the card has expired.')
        self.partial('pruned-core', '1,9-20')
        prunable = (EXCERPTS / 'ch02c-prunable.code').read_text()
        self.assertIn('Reason::StillValid', prunable)
        prune = (EXCERPTS / 'ch02c-prune.code').read_text()
        self.assertIn("op: 'prune'", prune)

    def test_every_pair_of_minutes(self):
        ttl = grid('timings-ttl')
        self.assertEqual(len(ttl), 66)
        admitted = [pair for pair, mark in ttl.items() if mark == '!']
        self.assertEqual(len(admitted), 15)
        self.quoted('which is 15 of the 66 pairs')
        # Each is more than five minutes after the card was revoked.
        self.assertEqual(sorted(admitted), sorted(pair for pair in ttl if pair[1] - pair[0] > 5))
        self.quoted('They are where the presentation is more than five minutes after the revocation')
        self.assertIn('15 of 66 presentations admit the card after it was revoked', run('timings-ttl'))
        self.assertIn('0 of 66 presentations admit the card after it was revoked', run('timings-core'))
        self.assertEqual(run('timings-core')[18], '0 of 66 presentations admit the card after it was revoked')
        self.quoted('Under the fix the count is none')
        self.partial('timings-core', '1,19')
        self.assertEqual(run('timings-prune-early')[18], '66 of 66 presentations admit the card after it was revoked')
        self.quoted('every presentation is admitted')
        self.partial('timings-prune-early', '1,19')
        # The second exercise's counts.
        self.assertIn('The sum is 15.', self.chapter)
        self.assertEqual(sum(1 for revoked in range(11) for presented in range(revoked, 11) if presented - revoked > 8), 3)
        self.assertIn('three in all', self.chapter)
        self.assertEqual(sum(1 for revoked in range(11) for presented in range(revoked, 11) if presented - revoked > 10), 0)

    def test_the_first_exercise(self):
        self.assertIn('$2^3=8$ sets', self.chapter)
        self.assertEqual(2 ** 4 - 1, 15)
        self.assertEqual(2 ** 5 - 1, 31)
        self.assertIn('15 wrong, of the 31 sets', self.chapter)

    def test_the_model(self):
        printed = run('models-revocation')
        self.assertEqual(printed[1:], ['revoked.pv', 'RESULT not event(Admitted(card_1)) cannot be proved.'])
        self.quoted("its answer in Listing~\\ref{alg:anchor-taken-models} is that the query ``cannot be proved''")
        self.quoted('The model, \\texttt{revoked.pv}')

    def test_every_recorded_run_of_this_build_is_printed(self):
        manifest = json.loads((EXCERPTS / 'manifest.json').read_text())
        runs = {session['name'] for session in manifest['sessions']}
        for name in ['revoked-last-card', 'revoked-core', 'subsets', 'subsets-last-card-only', 'pruned-ttl',
                     'pruned-core', 'timings-ttl', 'timings-core', 'timings-prune-early', 'models-revocation']:
            self.assertIn(name, runs)
            self.assertRegex(self.text, r'\\pdrun(lines)?\[[^\]]*\]\{%s\}' % re.escape(name))

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
