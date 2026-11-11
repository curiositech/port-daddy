"""Chapter 2's second build quotes facts from its recorded runs. Hold each to its run.

The section's listings cannot drift: they are the recorded files. Its prose
can. A sentence that says "in four orders" was typed by hand from a run the
kernel printed, and a later recording may print another number. Each test
here reads a fact out of a recorded run, or out of the code the section
prints, and requires the sentence that quotes it.
"""
import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
EXCERPTS = ROOT / 'book' / 'excerpts'
SECTION = ROOT / 'book' / 'additions' / 'anchor-build-the-holder.tex'
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


def sends(name):
    """Who sent the gate something, and its answer, for each showing in a recorded scenario."""
    found = []
    for line in said(name):
        match = re.match(r'^t=\d+\s+(\w+)\s+.*? -> (admitted as \w+|refused: [a-z-]+)', line)
        if match:
            found.append((match[1], match[2]))
    return found


def orders(name):
    """A recorded `harbor showings`: for each order, its turns and how it ended."""
    found = []
    for line in run(name):
        match = re.match(r'^((?:heron|wren)(?: +(?:heron|wren))*) +-> (.*)$', line)
        if match:
            found.append((match[1].split(), match[2]))
    return found


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

    def test_the_copied_card(self):
        self.assertEqual(sends('theft-bearer'), [('heron', 'admitted as heron'), ('wren', 'admitted as heron')])
        self.quoted("Wren shows Heron's cards and is let through as Heron.")
        self.assertTrue(said('theft-bearer')[-1].startswith('verdict: THEFT: wren may write shop/checkout.ts'))
        self.assertIn("t=0      wren   copies heron's cards from his files", run('theft-bearer'))
        self.quoted('Heron keeps his cards in a file')

    def test_the_first_repair_and_the_recording(self):
        signed = (EXCERPTS / 'ch02b-signed.code').read_text()
        self.assertIn("said(nonce, shown.ask, idOf(last))", signed)
        self.assertIn("nonce = ''", signed)
        self.quoted('The first repair has no challenge yet and leaves it blank.')
        # What is signed: a list of four things.
        prove = (EXCERPTS / 'ch02b-prove.code').read_text()
        self.assertIn("JSON.stringify(['proof', nonce, asked, card])", prove)
        self.quoted('as a list of four things')
        # The recording gets through.
        self.assertEqual(sends('replay-signed'), [('heron', 'admitted as heron'), ('wren', 'admitted as heron')])
        self.assertIn('t=0      wren   sends it again -> admitted as heron', run('replay-signed'))
        self.assertTrue(said('replay-signed')[-1].startswith('verdict: REPLAY:'))
        self.quoted('What Heron sent is good a second time.')

    def test_every_order_under_the_second_repair(self):
        found = orders('showings-lookup')
        self.assertEqual(len(found), 6)
        self.quoted('the turns can fall in six orders')
        twice = [turns for turns, ended in found if 'LET THROUGH TWICE' in ended]
        self.assertEqual(len(twice), 4)
        self.assertIn('4 of 6 orders let the proof through twice', run('showings-lookup'))
        self.quoted('In four orders both messages are looked up before either challenge is struck out')
        self.quoted('Four of six is the count of Chapter~0')
        # In each of the four, both lookups come before either strike.
        for turns in twice:
            self.assertEqual(len(turns), 4)
            self.assertEqual(sorted(turns[:2]), ['heron', 'wren'])
        # The two safe orders finish one message before starting the other, in three turns.
        safe = [turns for turns, ended in found if 'LET THROUGH TWICE' not in ended]
        self.assertEqual(safe, [['heron', 'heron', 'wren'], ['wren', 'wren', 'heron']])
        self.quoted('why those two have three turns and not four')
        # The pause is in the code the section prints.
        self.assertIn('yield;', (EXCERPTS / 'ch02b-lookup.code').read_text())
        self.quoted('The \\texttt{yield} marks the pause')

    def test_the_fix_as_printed(self):
        held = (EXCERPTS / 'ch02b-held.code').read_text()
        text = (EXCERPTS / 'ch02b-text.code').read_text()
        self.assertIn('json!(["proof", nonce, ask, card])', text)
        self.assertIn('let text = text(&open.nonce, ask, card);', held)
        self.quoted('From the proof it takes only the signature')
        self.assertIn('signed(&pass.key, &text, &proof.tag)', held)
        self.quoted('The text begins with the word \\texttt{proof}')
        self.assertIn('Reason::StaleChallenge', held)
        gate = (EXCERPTS / 'ch02b-gate.code').read_text()
        self.assertIn('good for thirty seconds', gate)
        self.quoted('more than thirty seconds ago')
        # The gate's check has no pause in it.
        self.assertNotIn('yield', gate)
        self.assertNotIn('await', gate)
        self.quoted('\\texttt{admit} has no \\texttt{yield} in it and waits on nothing.')

    def test_the_same_runs_against_the_fix(self):
        self.assertEqual(sends('theft-core'), [
            ('heron', 'admitted as heron'),
            ('wren', 'refused: no-proof'),
            ('wren', 'refused: not-proved'),
        ])
        self.partial('theft-core', '1,13-23')
        self.assertEqual(len(run('theft-core')), 23)
        self.assertTrue(run('theft-core')[12].endswith("copies heron's cards from his files"))
        self.assertEqual(sends('replay-core'), [
            ('heron', 'admitted as heron'),
            ('wren', 'refused: unknown-challenge'),
            ('wren', 'refused: not-proved'),
        ])
        self.partial('replay-core', '1,9-22')
        self.assertEqual(len(run('replay-core')), 22)
        self.assertTrue(run('replay-core')[8].endswith('hands heron a challenge'))
        self.quoted('Wren tries it twice.')
        self.assertIn("t=0      wren   sends heron's signature as her answer", run('replay-core'))
        self.quoted("sends Heron's old signature as her answer to it")

    def test_every_order_under_the_fix(self):
        found = orders('showings-core')
        self.assertEqual([turns for turns, _ in found], [['heron', 'wren'], ['wren', 'heron']])
        self.quoted('There are two orders now, and the proof is let through once in each.')
        self.assertEqual(found[1][1], "the copy in, heron's refused")
        self.quoted("Wren's copy arrives first, and it is the copy that gets through")
        self.assertIn('0 of 2 orders let the proof through twice', run('showings-core'))
        # With the strike removed.
        kept = orders('showings-keep-challenge')
        self.assertEqual(len(kept), 2)
        self.assertTrue(all('LET THROUGH TWICE' in ended for _, ended in kept))
        self.quoted('both showings get through in both orders')
        self.assertEqual(run('showings-keep-challenge')[0], '$ harbor showings --design core --mutant keep-challenge')

    def test_what_the_signed_text_holds(self):
        printed = run('proofs')
        at = printed.index('left out       sent again  ask changed  card changed')
        table = [line.split() for line in printed[at:at + 5]]
        self.assertEqual(table[0], ['left', 'out', 'sent', 'again', 'ask', 'changed', 'card', 'changed'])
        self.assertEqual(table[1], ['nothing', 'refused', 'refused', 'refused'])
        self.quoted("The first row is the core's own gate.")
        self.assertEqual(table[2:], [
            ['the', 'challenge', 'THROUGH', 'refused', 'refused'],
            ['the', 'ask', 'refused', 'THROUGH', 'refused'],
            ['the', 'card', 'refused', 'refused', 'THROUGH'],
        ])
        self.quoted('each lets one changed showing through')
        notes = ' '.join(line.strip() for line in printed[at + 6:])
        self.assertIn("wren answers a challenge of her own with heron's signature", notes)
        self.quoted("Heron's signature answers a challenge that Wren asked for herself")
        self.assertIn('heron signs an ask to read, and wren sends it on as an ask to write', notes)
        self.quoted('a request to read \\texttt{shop/checkout.ts} can be sent on as a request to write it')
        self.assertIn('alice signs an ask under her narrow card, and wren shows it under her wide one', notes)
        self.quoted('an ask that Alice signed under her narrow card is shown under her wide one')

    def test_the_models(self):
        printed = run('models-possession')
        self.assertEqual(printed[0], '$ sh formal/possession/run.sh')
        at = printed.index
        fix = printed[at('answered-once.pv') + 1:at('challenge-left-open.pv')]
        left_open = printed[at('challenge-left-open.pv') + 1:at('no-challenge.pv')]
        no_challenge = printed[at('no-challenge.pv') + 1:]
        made = 'RESULT event(Taken(m)) ==> event(Made(m)) is true.'
        self.assertEqual(fix, [
            made,
            'RESULT inj-event(Taken(m)) ==> inj-event(Made(m)) is true.',
            'RESULT not event(Taken(m)) is false.',
        ])
        self.quoted('It holds for \\texttt{answered-once.pv}, which is the fix.')
        for model in (left_open, no_challenge):
            self.assertEqual(model[0], made)
            self.assertEqual(model[1], 'RESULT inj-event(Taken(m)) ==> inj-event(Made(m)) is false.')
        self.quoted('It fails for the two repairs.')
        self.quoted('The showing is also three ProVerif models')
        self.assertEqual(sum(line.endswith('.pv') for line in printed), 3)

    def test_the_exercises(self):
        # The first exercise's count of the orders with four turns.
        found = orders('showings-lookup')
        self.assertEqual(sum(len(turns) == 4 for turns, _ in found), 2 * 2)
        self.assertEqual(sum(len(turns) == 3 for turns, _ in found), 2)
        self.assertIn('Two of them have three turns and the other four have four.', self.chapter)
        self.assertIn('$2\\times2=4$ orders of four turns', self.chapter)
        self.assertIn('there are two such orders', self.chapter)
        # The second exercise's refusal is the one the run prints.
        self.assertIn('unknown-challenge (the proof answers a challenge that is not open at this gate)', ' '.join(said('replay-core')))
        self.assertIn('refused as answering a challenge that is not open', self.chapter)

    def test_every_recorded_run_of_this_build_is_printed(self):
        manifest = json.loads((EXCERPTS / 'manifest.json').read_text())
        runs = {session['name'] for session in manifest['sessions']}
        for name in ['theft-bearer', 'replay-signed', 'showings-lookup', 'theft-core', 'replay-core',
                     'showings-core', 'showings-keep-challenge', 'proofs', 'models-possession']:
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
