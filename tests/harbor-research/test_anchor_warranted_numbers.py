"""Chapter 2's fifth build section states facts from its recorded runs. Check each one.

The section's listings are the recorded files, so they cannot go out of
date. Its prose can, and so can the marks typed into its figure. A sentence
that says "six cells change" was written from two tables the kernel
printed, and a later recording may print different tables. Each test here
reads a fact from a recorded run and checks that the text or the figure
states it.
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
RUNS = ['outsider-verified', 'two-gates-challenged', 'outsider-core', 'wrong-card-core',
        'wrong-card-any-revocation', 'revokers', 'revokers-any-signer', 'models-revokers']
SNIPPETS = ['ch02e-challenged', 'ch02e-sign', 'ch02e-authorized', 'ch02e-text', 'ch02e-gate']
SIGNERS = ['the harbor', 'alice', 'heron', 'finch', 'wren']


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
    """Who made each request in a recorded scenario, and the gate's answer."""
    found = []
    for line in unwrapped(name):
        match = re.match(r'^t=\d+\s+(\w+)\s+requests to .*? -> (admitted as \w+|refused: [a-z-]+)', line)
        if match:
            found.append((match[1], match[2]))
    return found


def sent(name):
    """The gate's answer each time Wren asked it to revoke a card."""
    return [re.sub(r' \(.*$', '', line.rsplit(' -> ', 1)[1]) for line in unwrapped(name)
            if re.match(r'^t=\d+\s+wren\s', line) and ' -> ' in line and 'requests to' not in line]


def table(name):
    """A recorded table of revocations: for each signer, whether each card was revoked."""
    rows = {}
    for line in run(name):
        for signer in SIGNERS:
            if line.startswith(signer.ljust(12)):
                rows[signer] = [cell.lower() == 'revoked' for cell in line[12:].split()]
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

    def test_an_outsider_revokes_a_card(self):
        self.partial('outsider-verified', '1,11-25')
        self.assertEqual(sent('outsider-verified'), ['revoked'])
        self.assertEqual(requests('outsider-verified'), [
            ('finch', 'admitted as finch'), ('finch', 'refused: revoked'), ('finch', 'refused: revoked')])
        lines = unwrapped('outsider-verified')
        self.assertTrue(lines[-1].startswith("verdict: LOCKED OUT: the gate revoked finch's card for wren"))
        # Heron comes a minute after Wren, and the card is already revoked.
        times = [int(re.match(r't=(\d+)', line)[1]) for line in lines if line.endswith('-> revoked')]
        self.assertEqual(times, [60000, 120000])
        self.quoted('When Heron comes a minute later to revoke the card himself')

    def test_the_first_repair_works_only_at_its_own_gate(self):
        self.partial('two-gates-challenged', '1,11-29')
        lines = unwrapped('two-gates-challenged')
        self.assertTrue(any('alice asks the near gate to revoke' in re.sub(r'\s+', ' ', line) and line.endswith('-> revoked') for line in lines))
        exchanged = [line for line in lines if 'exchange notices -> neither adds anything' in line]
        self.assertEqual([re.match(r't=(\d+)', line)[1] for line in exchanged], ['240000'])
        self.quoted('The line at $t=240000$ is where it goes wrong: the gates exchange notices, and neither adds anything.')
        answers = [line.rsplit(' -> ', 1)[1].split(' (')[0] for line in lines if ' requests to ' in line]
        self.assertEqual(answers, ['refused: revoked', 'admitted as heron', 'refused: revoked', 'admitted as heron'])
        self.assertTrue(lines[-1].startswith('verdict: ACCEPTED AFTER REVOCATION'))
        self.quoted('the answer is to a challenge the far gate never issued')
        revoked = next(int(re.match(r't=(\d+)', line)[1]) for line in lines if 'asks the near gate to revoke' in re.sub(r'\s+', ' ', line))
        last = [int(re.match(r't=(\d+)', line)[1]) for line in lines if line.startswith('t=') and 'at the far gate' in line][-1]
        self.assertEqual((last - revoked) // 1000, 60)
        self.quoted('and 60 seconds after the card was revoked she is admitted there')
        # The refusal the prose names is the one the first attempt's gate gives.
        self.assertIn("refused('unknown-challenge', NOT_OPEN)", (EXCERPTS / 'ch02e-challenged.code').read_text())
        self.quoted('refused them as \\texttt{unknown-challenge}')

    def test_the_outsider_against_the_fix(self):
        self.partial('outsider-core', '1,13-37')
        self.assertEqual(sent('outsider-core'), ['refused: no-revocation', 'refused: not-in-chain', 'refused: bad-revocation'])
        self.assertEqual(requests('outsider-core'), [
            ('finch', 'admitted as finch'), ('finch', 'admitted as finch'), ('finch', 'refused: revoked')])
        self.assertTrue(any("heron signs a revocation of finch's card" in re.sub(r'\s+', ' ', line) and line.endswith('-> revoked')
                            for line in unwrapped('outsider-core')))
        self.quoted('Each refusal has its own reason')

    def test_a_revocation_sent_with_another_card(self):
        self.partial('wrong-card-core', '1,13-33')
        self.assertEqual(sent('wrong-card-core'), ['refused: bad-revocation', 'refused: bad-revocation'])
        self.assertEqual(requests('wrong-card-core'), [
            ('wren', 'refused: revoked'), ('finch', 'admitted as finch'), ('heron', 'admitted as heron')])
        self.quoted("Heron's key has authority over all three cards, so the first check does not stop her.")

    def test_every_signer_and_every_card(self):
        self.partial('revokers', '1,5-12')
        rows = table('revokers')
        self.assertEqual(list(rows), SIGNERS)
        self.assertEqual(rows, {
            'the harbor': [True, True, True], 'alice': [True, True, True],
            'heron': [False, True, True], 'finch': [False, False, True], 'wren': [False, False, False]})
        accepted = sum(cell for row in rows.values() for cell in row)
        self.assertEqual((accepted, 5 * 3), (9, 15))
        self.assertIn('9 of 15 revocations are accepted, and none against the rule', run('revokers'))
        self.quoted('let five signers each sign a revocation of each of its cards')
        self.quoted('The table is a staircase.')

    def test_the_guards_removed(self):
        self.partial('revokers-any-signer', '1,5-12')
        unchecked = table('revokers-any-signer')
        self.assertTrue(all(all(row) for row in unchecked.values()))
        changed = sum(a != b for signer in SIGNERS for a, b in zip(table('revokers')[signer], unchecked[signer]))
        self.assertEqual(changed, 6)
        self.assertIn('15 of 15 revocations are accepted, and 6 against the rule', run('revokers-any-signer'))
        self.quoted('Six cells change, and they are the six the rule refused.')
        self.partial('wrong-card-any-revocation', '1,18-30')
        self.assertEqual(sent('wrong-card-any-revocation'), ['revoked', 'revoked'])
        self.assertEqual(requests('wrong-card-any-revocation'), [
            ('wren', 'refused: revoked'), ('finch', 'refused: revoked'), ('heron', 'refused: revoked')])
        # Wren's own card, and then the two she sent the revocation with.
        self.assertIn('One revocation revokes three cards.', self.text)
        self.quoted('Each check this build added is a guard that can be removed.')

    def test_the_models(self):
        lines = run('models-revokers')
        self.assertEqual(lines[0], '$ sh formal/revokers/run.sh')
        models, name = {}, None
        for line in lines[1:]:
            if line.endswith('.pv'):
                name = line
                models[name] = []
            else:
                models[name].append(line)
        self.assertEqual(list(models), ['any-signer.pv', 'authorized.pv', 'no-harbor-in-the-text.pv'])
        signed = 'RESULT event(Revoked(m)) ==> event(Signed(m)) is %s.'
        finch = 'RESULT not event(HeronsRevokedBy(pk(finch[]))) is %s.'
        wren = 'RESULT not event(HeronsRevokedBy(pk(wren[]))) is %s.'
        self.assertEqual(models['any-signer.pv'], [signed % 'false', finch % 'false', wren % 'false'])
        self.quoted('In \\texttt{any-signer.pv} every line is false.')
        self.assertEqual(models['no-harbor-in-the-text.pv'], [signed % 'false', finch % 'true', wren % 'true'])
        self.quoted('a revocation signed for one harbor is accepted at another')
        fix = models['authorized.pv']
        self.assertEqual(fix[:3], [signed % 'true', finch % 'true', wren % 'true'])
        # The two lines of the fix that say false, and the line ProVerif adds between them.
        self.assertEqual(fix[3], 'RESULT inj-event(Revoked(m)) ==> inj-event(Signed(m)) is false.')
        self.assertEqual(fix[4], 'RESULT (but event(Revoked(m)) ==> event(Signed(m)) is true.)')
        self.assertEqual(fix[5], 'RESULT not event(Revoked(m)) is false.')
        self.assertEqual(sum(line.endswith('is false.') for line in fix), 2)
        self.quoted('Two lines of the fix say \\texttt{false}, and both are meant to.')
        self.quoted('The check is also three ProVerif models')

    def test_the_figure_plots_the_recorded_tables(self):
        self.assertIn('\\input{figures/fig-anchor-warrant-who}', SECTION.read_text())
        rows, unchecked = table('revokers'), table('revokers-any-signer')
        # Cards across, the harbor's first. Signers up the page, the harbor at the top.
        height = {signer: 5 - at for at, signer in enumerate(SIGNERS)}
        revoked = sorted((card + 1, height[signer]) for signer in SIGNERS for card in range(3) if rows[signer][card])
        only_unchecked = sorted((card + 1, height[signer]) for signer in SIGNERS for card in range(3)
                                if unchecked[signer][card] and not rows[signer][card])
        self.assertEqual(marks('revoked'), revoked)
        self.assertEqual(marks('revoked only without the check of the signer'), only_unchecked)
        source = FIGURE.read_text()
        self.assertIn("xticklabels={Alice's,Heron's,Finch's}", source)
        self.assertIn('yticklabels={Wren,Finch,Heron,Alice,the harbor}', source)
        caption = prose(FIGURE)
        self.assertIn('Filled marks are the nine revocations the gate accepts.', caption)
        self.assertIn('Open marks are the six it refuses', caption)

    def test_the_exercises(self):
        def accepted(n):
            return n + n * (n + 1) // 2
        self.assertEqual((accepted(3), 3 * 5), (9, 15))
        self.assertEqual((accepted(5), 5 * 7), (20, 35))
        self.assertIn('For three cards that is $3+6=9$ of 15, as printed. For five it is $5+15=20$ of 35.', self.chapter)
        self.assertIn('So $n+n(n+1)/2$ cells say \\texttt{revoked}, of $n(n+2)$.', self.chapter)
        # The cards of the first run are numbered by the harbor, and a revocation's text names the harbor.
        text = (EXCERPTS / 'ch02e-text.code').read_text()
        self.assertIn('json!(["revoke", harbor, card])', text)
        self.assertTrue(any(re.fullmatch(r' +jti +card-1', line) for line in run('cards')))
        self.assertIn('each of the two calls its first card \\texttt{card-1}', self.chapter)

    def test_the_chapter_points_here(self):
        source = CHAPTER.read_text()
        self.assertIn('\\input{additions/anchor-build-warranted}', source)
        self.assertIn('\\S\\ref{sec:anchor-build-warranted} builds the rule for who may revoke a card', self.chapter)
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
