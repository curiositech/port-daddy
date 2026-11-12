"""Chapter 2's fifth build quotes facts from its recorded runs. Hold each to its run.

The section's listings cannot drift: they are the recorded files. Its prose
can, and so can the marks its figure types. A sentence that says "six cells
change" was written by hand from two tables the kernel printed, and a later
recording may print other tables. Each test here reads a fact out of a
recorded run and requires the sentence, the mark or the exercise that
quotes it.
"""
import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
EXCERPTS = ROOT / 'book' / 'excerpts'
SECTION = ROOT / 'book' / 'additions' / 'anchor-build-warranted.tex'
FIGURE = ROOT / 'book' / 'figures' / 'fig-anchor-warrant-who.tex'
CHAPTER = ROOT / 'book' / 'anchor-protocol-whitepaper.tex'
RUNS = ['bystander-told', 'unheard-challenged', 'bystander-core', 'misdirected-core',
        'misdirected-unwarranted', 'warrants', 'warrants-any-signer']
SNIPPETS = ['ch02e-challenged', 'ch02e-sign', 'ch02e-warranted', 'ch02e-text', 'ch02e-gate']
SIGNERS = ['the harbor', 'alice', 'heron', 'finch', 'wren']


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
    """Who asked the gate for something in a recorded scenario, and its answer."""
    found = []
    for line in said(name):
        match = re.match(r'^t=\d+\s+(\w+)\s+asks to .*? -> (admitted as \w+|refused: [a-z-]+)', line)
        if match:
            found.append((match[1], match[2]))
    return found


def told(name):
    """What the gate answered each time Wren sent it something to take back."""
    return [re.sub(r' \(.*$', '', line.rsplit(' -> ', 1)[1]) for line in said(name)
            if re.match(r'^t=\d+\s+wren\s', line) and ' -> ' in line and 'asks to' not in line]


def table(name):
    """A recorded table of warrants: for each signer, whether each card was taken back."""
    rows = {}
    for line in run(name):
        for signer in SIGNERS:
            if line.startswith(signer.ljust(12)):
                rows[signer] = [cell.lower() == 'taken' for cell in line[12:].split()]
    return rows


def marks(series):
    """The coordinates a figure plots under a `% series:` remark."""
    source = FIGURE.read_text()
    pattern = '% series: ' + re.escape(series) + r'\n\s*\\addplot\[[^\]]*\] coordinates \{([^}]*)\};'
    found = re.search(pattern, source)
    return sorted((int(x), int(y)) for x, y in re.findall(r'\((\d),(\d)\)', found[1]))


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

    def test_a_stranger_takes_a_card_back(self):
        self.partial('bystander-told', '1,11-26')
        self.assertEqual(told('bystander-told'), ['written down'])
        self.assertEqual(asks('bystander-told'), [
            ('finch', 'admitted as finch'), ('finch', 'refused: withdrawn'), ('finch', 'refused: withdrawn')])
        lines = said('bystander-told')
        self.assertTrue(lines[-1].startswith("verdict: LOCKED OUT: the gate took back finch's card for wren"))
        # Heron comes a minute after Wren, and the gate has the card already.
        times = [int(re.match(r't=(\d+)', line)[1]) for line in lines if line.endswith('-> written down')]
        self.assertEqual(times, [60000, 120000])
        self.quoted('When Heron comes a minute later to take the card back himself')

    def test_the_first_repair_stops_at_its_own_gate(self):
        self.partial('unheard-challenged', '1,11-29')
        lines = said('unheard-challenged')
        self.assertTrue(any('alice tells the near gate to take back' in re.sub(r'\s+', ' ', line) and line.endswith('-> written down') for line in lines))
        compared = [line for line in lines if 'compare records -> neither hears anything new' in line]
        self.assertEqual([re.match(r't=(\d+)', line)[1] for line in compared], ['240000'])
        self.quoted('The line at $t=240000$ is where it goes wrong: the gates compare records, and neither hears anything new.')
        answers = [line.rsplit(' -> ', 1)[1].split(' (')[0] for line in lines if ' asks to ' in line]
        self.assertEqual(answers, ['refused: withdrawn', 'admitted as heron', 'refused: withdrawn', 'admitted as heron'])
        self.assertTrue(lines[-1].startswith('verdict: HONOURED AFTER IT WAS TAKEN BACK'))
        self.quoted('the answer is to a challenge the far gate never set')
        taken = next(int(re.match(r't=(\d+)', line)[1]) for line in lines if 'tells the near gate to take back' in re.sub(r'\s+', ' ', line))
        last = [int(re.match(r't=(\d+)', line)[1]) for line in lines if line.startswith('t=') and 'at the far gate' in line][-1]
        self.assertEqual((last - taken) // 1000, 60)
        self.quoted('and 60 seconds after the card was taken back she is let through there')
        # The refusal the prose names is the one the first try's gate gives.
        self.assertIn("refused('unknown-challenge', NOT_OPEN)", (EXCERPTS / 'ch02e-challenged.code').read_text())
        self.quoted('refused them as \\texttt{unknown-challenge}')

    def test_the_stranger_against_the_fix(self):
        self.partial('bystander-core', '1,13-37')
        self.assertEqual(told('bystander-core'), ['refused: no-warrant', 'refused: not-above', 'refused: not-warranted'])
        self.assertEqual(asks('bystander-core'), [
            ('finch', 'admitted as finch'), ('finch', 'admitted as finch'), ('finch', 'refused: withdrawn')])
        self.assertTrue(any("heron signs a warrant for finch's card" in re.sub(r'\s+', ' ', line) and line.endswith('-> written down')
                            for line in said('bystander-core')))
        self.quoted('Each refusal has its own reason')

    def test_a_warrant_sent_with_another_card(self):
        self.partial('misdirected-core', '1,13-33')
        self.assertEqual(told('misdirected-core'), ['refused: not-warranted', 'refused: not-warranted'])
        self.assertEqual(asks('misdirected-core'), [
            ('wren', 'refused: withdrawn'), ('finch', 'admitted as finch'), ('heron', 'admitted as heron')])
        self.quoted("Heron's key has a say over all three cards, so the first question does not stop her.")

    def test_every_signer_and_every_card(self):
        self.partial('warrants', '1,5-12')
        rows = table('warrants')
        self.assertEqual(list(rows), SIGNERS)
        self.assertEqual(rows, {
            'the harbor': [True, True, True], 'alice': [True, True, True],
            'heron': [False, True, True], 'finch': [False, False, True], 'wren': [False, False, False]})
        taken = sum(cell for row in rows.values() for cell in row)
        self.assertEqual((taken, 5 * 3), (9, 15))
        self.assertIn('9 of 15 warrants are taken, and none against the rule', run('warrants'))
        self.quoted('let five people each sign a warrant for each of its cards')
        self.quoted('The table is a staircase.')

    def test_the_guards_removed(self):
        self.partial('warrants-any-signer', '1,5-12')
        loose = table('warrants-any-signer')
        self.assertTrue(all(all(row) for row in loose.values()))
        changed = sum(a != b for signer in SIGNERS for a, b in zip(table('warrants')[signer], loose[signer]))
        self.assertEqual(changed, 6)
        self.assertIn('15 of 15 warrants are taken, and 6 against the rule', run('warrants-any-signer'))
        self.quoted('Six cells change, and they are the six the rule left empty.')
        self.partial('misdirected-unwarranted', '1,18-31')
        self.assertEqual(told('misdirected-unwarranted'), ['written down', 'written down'])
        self.assertEqual(asks('misdirected-unwarranted'), [
            ('wren', 'refused: withdrawn'), ('finch', 'refused: withdrawn'), ('heron', 'refused: withdrawn')])
        # Wren's own card, and then the two she sent the warrant with.
        self.assertIn('One warrant takes back three cards.', self.text)
        self.quoted('Each check this build added is a guard that can be removed.')

    def test_the_figure_plots_the_recorded_tables(self):
        self.assertIn('\\input{figures/fig-anchor-warrant-who}', SECTION.read_text())
        rows, loose = table('warrants'), table('warrants-any-signer')
        # Cards across, the harbor's first. Signers up the page, the harbor at the top.
        height = {signer: 5 - at for at, signer in enumerate(SIGNERS)}
        taken = sorted((card + 1, height[signer]) for signer in SIGNERS for card in range(3) if rows[signer][card])
        only_loose = sorted((card + 1, height[signer]) for signer in SIGNERS for card in range(3)
                            if loose[signer][card] and not rows[signer][card])
        self.assertEqual(marks('taken'), taken)
        self.assertEqual(marks('taken only without the check of the signer'), only_loose)
        source = FIGURE.read_text()
        self.assertIn("xticklabels={Alice's,Heron's,Finch's}", source)
        self.assertIn('yticklabels={Wren,Finch,Heron,Alice,the harbor}', source)
        caption = prose(FIGURE)
        self.assertIn('Filled marks are the nine warrants the gate takes.', caption)
        self.assertIn('Open marks are the six it refuses', caption)

    def test_the_exercises(self):
        def taken(n):
            return n + n * (n + 1) // 2
        self.assertEqual((taken(3), 3 * 5), (9, 15))
        self.assertEqual((taken(5), 5 * 7), (20, 35))
        self.assertIn('For three cards that is $3+6=9$ of 15, as printed. For five it is $5+15=20$ of 35.', self.chapter)
        self.assertIn('So $n+n(n+1)/2$ cells say \\texttt{taken}, of $n(n+2)$.', self.chapter)
        # The cards of the first run are numbered by the harbor, and a warrant's text names the harbor.
        text = (EXCERPTS / 'ch02e-text.code').read_text()
        self.assertIn('json!(["withdraw", harbor, card])', text)
        self.assertTrue(any(re.fullmatch(r' +jti +card-1', line) for line in run('cards')))
        self.assertIn('each of the two calls its first card \\texttt{card-1}', self.chapter)

    def test_the_chapter_points_here(self):
        source = CHAPTER.read_text()
        self.assertIn('\\input{additions/anchor-build-warranted}', source)
        self.assertIn('\\S\\ref{sec:anchor-build-warranted} builds the rule for who may take a card back', self.chapter)
        self.assertIn('\\pdexercisesfor{\\S\\ref{sec:anchor-build-warranted}}', source)
        for key in ['rfc7009revocation', 'ucan2026revocation']:
            self.assertIn('\\bibitem{%s}' % key, source)
            self.quoted('~\\pdcite{%s}' % key)
        for earlier in ['anchor-build-told.tex', 'anchor-build-taken-back.tex']:
            self.assertIn('\\S\\ref{sec:anchor-build-warranted}', prose(ROOT / 'book' / 'additions' / earlier))

    def test_every_recorded_run_and_snippet_of_this_build_is_printed(self):
        manifest = json.loads((EXCERPTS / 'manifest.json').read_text())
        runs = {session['name'] for session in manifest['sessions']}
        cut = {excerpt['name'] for excerpt in manifest['excerpts']}
        for name in RUNS:
            self.assertIn(name, runs)
            self.assertRegex(self.text, r'\\pdrun(lines)?\[[^\]]*\]\{%s\}' % re.escape(name))
        self.assertEqual(sorted(name for name in cut if name.startswith('ch02e-')), sorted(SNIPPETS))
        for name in SNIPPETS:
            self.assertRegex(self.text, r'\\pdexcerpt\[[^\]]*\]\{%s\}' % re.escape(name))

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
