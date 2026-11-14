"""Chapter 8's second build quotes facts from its recorded runs. Check each against its run.

The section's listings cannot drift, because they are the recorded files.
Its prose and its exercises can. A sentence that says "in 66 of the core's
states" was written by hand from a table the kernel printed, and a later
recording may print a different table. Each test here reads a fact out of
a recorded run and requires the sentence that quotes it.
"""
import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
EXCERPTS = ROOT / 'book' / 'excerpts'
SECTION = ROOT / 'book' / 'additions' / 'fh-build-the-transfer.tex'
CHAPTER = ROOT / 'book' / 'federated-harbor-whitepaper.tex'
WHOLE_RUNS = ['transfer-foreign', 'transfers', 'models-transfer']
PART_RUNS = {'transfer-core': [(39, '1,5-42')], 'replayed-offer-offers': [(20, '1,9-27')],
             'replayed-offer-core': [(10, '1,19-27')], 'revoked-at-home-once': [(29, '1,9-36')],
             'revoked-at-home-core': [(14, '1,21-33')], 'false-offer-core': [(34, '1,14-46')],
             'transfers-guards': [(11, '1,15-24')]}
# The one run printed without its last lines: the table alone, between its heading and the notes on its columns.
TABLE_ALONE = 'transfers-guards'
SNIPPETS = ['ch08b-honor', 'ch08b-offer', 'ch08b-accept', 'ch08b-granted', 'ch08b-receive', 'ch08b-parent',
            'ch08b-told']
DESIGNS = ['offers', 'once', 'core']
GUARDS = ['unsigned-offer', 'any-recipient', 'any-mapping', 'reuse-offer', 'expired-offer', 'offered-rights',
          'late-offer', 'any-revoker']
EXERCISES = ['ex:fh-offer-rule', 'ex:fh-offer-order', 'ex:fh-offer-late', 'ex:fh-offer-recipient',
             'ex:fh-offer-request']
ADMITTED = "requests to write staging-db/checkout/orders at carol's gate -> admitted as heron"
REVOKED = "requests to write staging-db/checkout/orders at carol's gate -> refused: revoked"


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
        if line.startswith(' ' * 16) and joined:
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


def flat(lines):
    """Lines of a recorded run as one line, with the white space of their wrapping collapsed."""
    return re.sub(r'\s+', ' ', ' '.join(lines))


def with_commas(count):
    """A count as the Book prints it, with a comma for thousands."""
    return f'{count:,}'


def spans(lines):
    """The line ranges a listing prints, as pairs of first and last line."""
    return [[int(end) for end in (span.split('-') * 2)[:2]] for span in lines.split(',')]


class QuotedFacts(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.text = prose(SECTION)
        cls.chapter = prose(CHAPTER)
        # states, wrong, revived, refused, behind, unreached
        cls.walk = table('transfers', DESIGNS)
        cls.guards = table('transfers-guards', GUARDS + ['(none)'])

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
            for room, lines in parts:
                self.assertEqual(sum(last - first + 1 for first, last in spans(lines)), room, name)
            # The last part printed runs through to the run's last line.
            if name != TABLE_ALONE:
                self.assertEqual(max(last for _, last in spans(parts[-1][1])), len(run(name)), name)
        # The table alone: its head and a row for the core and for each guard, with an empty line on each side.
        table_lines = run(TABLE_ALONE)
        self.assertEqual([table_lines[13], table_lines[24]], ['', ''])
        self.assertTrue(table_lines[14].startswith('guard removed '))
        self.assertEqual([line.split()[0] for line in table_lines[15:24]], ['(none)'] + GUARDS)
        manifest = json.loads((EXCERPTS / 'manifest.json').read_text())
        recorded = {session['name'] for session in manifest['sessions']}
        self.assertLessEqual(set(WHOLE_RUNS) | set(PART_RUNS), recorded)
        # Every snippet this build has is printed in this section.
        cut = {excerpt['name'] for excerpt in manifest['excerpts'] if excerpt['name'].startswith('ch08b-')}
        self.assertEqual(cut, set(SNIPPETS))
        self.assertIn('\\input{additions/fh-build-the-transfer}', CHAPTER.read_text())

    def test_the_first_attempt_and_its_break(self):
        first = steps('transfer-foreign')
        self.assertEqual(len(first), 5)
        self.assertIn("carol honors the cards that alice's harbor signs", first[0])
        self.assertIn('issues heron the card alice-1: write staging-db/checkout/*', first[1])
        self.assertTrue(first[2].endswith(ADMITTED))
        self.assertIn('issues finch the card alice-2: write staging-db/*', first[3])
        self.assertTrue(first[4].endswith("requests to write staging-db/billing/invoices at carol's gate -> admitted "
                                          'as finch'))
        self.assertIn('ADMITTED A WRITE TO HER BILLING TABLE', flat(run('transfer-foreign')[-2:]))
        self.quoted('So Alice\'s harbor signs Heron a second card, for \\texttt{staging-db/checkout/*}.')
        self.quoted('Then Alice\'s harbor signs Finch a card for every table of the staging database')
        self.quoted('At step~5 it admits a write to a billing table that is no part of the job.')

    def test_the_four_messages(self):
        lines, core = run('transfer-core'), steps('transfer-core')
        self.assertEqual(len(core), 14)
        # The listing leaves out the three lines that say what the scenario is, which the run before it printed.
        self.assertTrue(lines[1].startswith('scenario transfer, design core') and lines[3] == '')
        self.assertTrue(lines[4].startswith('step 1 '))
        self.assertEqual(run('transfer-foreign')[1].replace('foreign', 'core'), lines[1])
        self.assertIn("maps alice's write test-db/checkout/* to write staging-db/checkout/*, as mapping checkout v3",
                      core[0])
        self.assertIn('-> refused: bad-signature', core[2])
        self.assertIn("heron asks alice's harbor to offer alice-1 to carol's, and answers the gate's challenge -> "
                      'admitted as heron', core[3])
        self.assertIn("alice signs offer x-1 for carol's harbor", core[4])
        self.assertIn("carol is sent offer x-1 -> issues carol-1 to heron's key: write staging-db/checkout/*", core[5])
        self.assertIn("carol sends alice's harbor an acknowledgment of x-1 -> alice records carol-1", core[6])
        self.assertIn('carol sends heron the card carol-1', core[7])
        self.assertTrue(core[8].endswith(ADMITTED))
        self.quoted('Steps 4 to 8 carry the four messages.')
        self.quoted('Step~5 is the offer. At step~6 Carol\'s harbor issues \\texttt{carol-1}, and at step~7 it tells '
                    'Alice\'s harbor which card it issued. The card goes to Heron at step~8.')
        self.quoted("Carol's gate refused Heron's old card at step~3, and it admits the new one at step~9.")
        # What the section says of the listings of the offer and of the check.
        text = (EXCERPTS / 'ch08b-offer.code').read_text()
        for field in ['offer.from', 'offer.to', 'offer.xid', 'offer.card', 'offer.sub', 'offer.key', 'offer.can',
                      'offer.exp', 'offer.map']:
            self.assertIn(field, text)
        self.quoted('The signature covers every one of those fields.')
        accept = (EXCERPTS / 'ch08b-accept.code').read_text()
        order = [accept.index(name) for name in ['signed(offer)', 'addressed(offer, harbor)', 'used(harbor)',
                                                 'revoked(harbor)', 'mapping_for(', 'current(', 'expired(',
                                                 'granted(']]
        self.assertEqual(order, sorted(order))
        self.quoted('The checks \\texttt{used} and \\texttt{revoked} belong to the two breaks below.')
        self.assertNotIn('offer.can.clone()', (EXCERPTS / 'ch08b-granted.code').read_text().split('MUTANT')[0])
        self.quoted('\\texttt{granted} never copies a right out of the offer.')

    def test_two_wider_cards(self):
        core = steps('transfer-core')
        self.assertIn('issues finch the card alice-2: write test-db/*', core[9])
        self.assertIn('-> carol issues finch carol-2', core[10])
        self.assertIn('finch requests to write staging-db/billing/invoices', core[11])
        self.assertIn('-> refused: not-granted', core[11])
        # The card that broke the first attempt is the one offered at step 14.
        self.assertIn('issues finch the card alice-3: write staging-db/*', core[12])
        self.assertIn('issues finch the card alice-2: write staging-db/*', steps('transfer-foreign')[3])
        self.assertTrue(core[13].startswith('step 14 '))
        self.assertIn('-> refused: nothing-mapped', core[13])
        self.quoted('The card that broke the first attempt is offered at step~14 and buys nothing')
        self.quoted('because the mapping has one rule')

    def test_the_same_offer_twice(self):
        lines, replay = run('replayed-offer-offers'), steps('replayed-offer-offers')
        self.assertEqual(len(replay), 8)
        # The printed lines start at step 3. Steps 1 and 2 are those of the run before.
        self.assertTrue(lines[8].startswith('step 3 '))
        self.assertEqual(lines[4:8], run('transfer-core')[4:8])
        self.quoted('Steps 1 and 2, left out, are those of Listing~\\ref{alg:fh-offer-run-core}.')
        self.assertIn('carol revokes carol-1 -> revoked', replay[4])
        self.assertTrue(replay[5].startswith('step 6 heron ' + REVOKED))
        self.assertIn("wren sends carol's harbor a copy of offer x-1 -> issues carol-2 to heron's key", replay[6])
        self.assertTrue(replay[7].endswith(ADMITTED))
        self.quoted('At step~7 the harbor issues \\texttt{carol-2}, and Heron is back in.')
        self.quoted("because the card names Heron's key")

    def test_an_identifier_honored_once(self):
        lines, before = run('replayed-offer-core'), run('replayed-offer-offers')
        # The printed lines start at step 7, after the same six steps.
        self.assertTrue(lines[18].startswith('step 7 '))
        self.assertEqual(lines[4:18], before[4:18])
        self.quoted('The steps left out are the first six of Listing~\\ref{alg:fh-offer-run-replay}.')
        once = steps('replayed-offer-core')
        self.assertIn('-> known: carol-1 was issued for x-1, and nothing new is issued', once[6])
        self.assertTrue(once[7].startswith('step 8 heron ' + REVOKED))
        self.assertIn('Accepted::Known', (EXCERPTS / 'ch08b-accept.code').read_text())
        self.assertIn('used', (EXCERPTS / 'ch08b-receive.code').read_text())
        self.quoted('\\texttt{Known} is an answer, and not a refusal.')

    def test_revoked_at_home(self):
        lines, home = run('revoked-at-home-once'), steps('revoked-at-home-once')
        self.assertEqual(len(home), 11)
        self.assertTrue(lines[8].startswith('step 3 '))
        self.assertEqual(lines[4:8], run('transfer-core')[4:8])
        self.quoted('Steps 1 and 2 are left out again.')
        self.assertIn('signs offer x-2 of the same card, which is held up on its way', home[3])
        self.assertIn('alice revokes alice-1 -> revoked', home[4])
        self.assertIn("at alice's own gate -> refused: revoked", home[5])
        self.assertTrue(home[6].endswith(ADMITTED))
        self.assertIn("-> nothing: a harbor of this design keeps no record of another harbor's revocations", home[7])
        self.assertTrue(home[8].endswith(ADMITTED))
        self.assertIn("carol is sent offer x-2 -> issues carol-2 to heron's key", home[9])
        self.quoted("Heron is refused at Alice's gate at step~6 and admitted at Carol's at step~7.")
        self.quoted('Step~8 changes nothing')
        self.quoted('Step~10 is worse.')

    def test_the_harbor_follows_the_cards_own_harbor(self):
        lines, before = run('revoked-at-home-core'), run('revoked-at-home-once')
        # The printed lines start at step 8, after the same seven steps.
        self.assertTrue(lines[20].startswith('step 8 '))
        self.assertEqual(lines[4:20], before[4:20])
        self.quoted('The steps left out are the first seven of Listing~\\ref{alg:fh-offer-run-home}.')
        told = steps('revoked-at-home-core')
        self.assertEqual(len(told), 10)
        self.assertTrue(told[6].endswith(ADMITTED))
        self.assertIn("sends carol's harbor its signed revocation of alice-1 -> carol revokes carol-1", told[7])
        self.assertTrue(told[8].startswith('step 9 heron ' + REVOKED))
        self.assertIn('carol is sent offer x-2 -> refused: parent-revoked', told[9])
        self.assertIn('heron was admitted once in between', flat(run('revoked-at-home-core')[-3:]))
        self.quoted('Step~9 is now a refusal, and step~10 refuses the late offer. Step~7 is as it was.')
        self.quoted("Between Alice's revocation and its arrival, Carol's gate admitted Heron once.")
        # The revocation's text is the one Chapter 2's gate checks, and only the offering harbor's key may sign it.
        parent = (EXCERPTS / 'ch08b-parent.code').read_text()
        self.assertIn('json!(["revoke", from, card])', parent)
        self.assertIn('Reason::NotItsHarbor', parent)
        self.quoted('so one signature serves at both harbors')
        self.quoted('\\texttt{told} is what the harbor does with a revocation that passes '
                    '(Listing~\\ref{alg:fh-offer-told}). It does two things.')

    def test_the_outsider(self):
        lines, outsider = run('false-offer-core'), steps('false-offer-core')
        self.assertEqual(len(outsider), 12)
        # The listing prints steps 5 to 12.
        self.assertTrue(lines[13].startswith('step 5 '))
        self.quoted("Steps 1 to 4, left out, set up the transfer and give Bob's harbor a mapping.", SECTION.read_text().replace('\n', ' '))
        self.quoted("At step~2 Bob's harbor took a mapping for Alice's too, with the same name and version as Carol's.")
        self.assertIn("bob maps alice's write test-db/checkout/* to write shop-db/checkout/*, as mapping checkout v3 "
                      'too', outsider[1])
        self.assertIn("wren sends bob's harbor a copy of offer x-1 -> refused: other-recipient", outsider[4])
        codes = [re.search(r'-> (?:refused: )?([\w-]+)', step).group(1) for step in outsider[4:11]]
        self.assertEqual(codes, ['other-recipient', 'offer-not-signed', 'offer-not-signed', 'known', 'not-proved',
                                 'not-its-harbor', 'ack-not-signed'])
        self.assertIn('for her own key, signed with her own key', outsider[5])
        self.assertIn("offer x-1 with the holder's key changed to her own", outsider[6])
        self.assertIn('a revocation of alice-1, signed with her own key', outsider[9])
        self.assertIn('an acknowledgment of x-1 that she signed', outsider[10])
        self.assertTrue(outsider[11].endswith(ADMITTED))
        self.quoted("So at step~5 the recipient's name is all that stands between Wren and a card at Bob's")
        self.quoted("Step~6 is an offer that Wren signed, and step~7 is Alice's offer with one field changed.")
        self.quoted('Step~8 is \\texttt{Known}.')
        self.quoted("At step~9 she presents Heron's card and cannot answer for Heron's key.")
        self.quoted('Steps 10 and 11 are a revocation and an acknowledgment that she signed herself.')

    def test_every_order(self):
        offers, once, core = (self.walk[name] for name in DESIGNS)
        head = flat(run('transfers')[1:13])
        self.assertIn("alice's harbor signed six", head)
        self.assertIn("Two are of heron's card to carol's harbor, and one is of it to bob's", head)
        self.assertIn("Wren signed a seventh in alice's name", head)
        self.assertIn('The test stops sending an offer to a harbor that has issued two cards for it', head)
        self.quoted('The exhaustive test sends two harbors seven offers and two revocations of \\texttt{alice-1} in '
                    'every order')
        self.quoted("Three of the offers are good: two of Heron's card to Carol's harbor, and one of it to Bob's. The "
                    'other four should buy nothing.')
        self.quoted('so the test stops sending an offer to a harbor that has issued two cards for it')
        self.quoted(f'holds a card it should not in {with_commas(offers[1])} of its {with_commas(offers[0])} states')
        self.assertEqual(once[1], 0)
        self.quoted('Honoring an identifier once brings that column to zero.')
        self.quoted(f'in {with_commas(once[2])} of {with_commas(once[0])} states a gate admits a card after its harbor '
                    'was told that the old one is revoked')
        # The harbors that ask the core have no fault in the three columns after the count of states.
        self.assertEqual(core[1:4], [0, 0, 0])
        self.quoted(f'The harbors that ask the core have neither fault in any of their {with_commas(core[0])} states.')
        self.assertTrue(all(row[4] > 0 for row in (offers, once, core)))
        self.quoted('The column \\texttt{behind} is not zero for any design')
        self.quoted(f"In {with_commas(core[4])} of the core's states Alice's harbor has revoked the card")
        self.assertEqual(core[5], 0)
        self.quoted(f"At the core's harbors it ends all {with_commas(core[4])}.")
        # The paragraph at the head of the section.
        self.quoted(f'An exhaustive test of two harbors reaches {with_commas(core[0])} states and finds no card that '
                    f'should not be there. In {with_commas(core[4])} of them')
        # The chapter's paragraph on what a machine has checked quotes the same count.
        self.quoted(f'An exhaustive test of two harbors reaches {with_commas(core[0])} states, and in none of them '
                    'does a harbor hold a card it should not.', self.chapter)
        self.assertIn('in every state, each harbor of the design core holds exactly the cards that the reference '
                      'model says it should', flat(run('transfers')))

    def test_each_guard_removed(self):
        self.assertEqual(sorted(self.guards), sorted(GUARDS + ['(none)']))
        self.assertEqual(len(GUARDS), 8)
        self.quoted('The build has nine guards. Eight of them are in the path of this test')
        real = self.guards['(none)']
        self.assertEqual(real, self.walk['core'])
        for guard in GUARDS:
            self.assertNotEqual(self.guards[guard], real, guard)
        self.quoted('Every row differs from the first.')
        recipient, rights, late, revoker = (self.guards[name] for name in ['any-recipient', 'offered-rights',
                                                                         'late-offer', 'any-revoker'])
        self.quoted(f'A core that takes an offer whichever harbor it names reaches {with_commas(recipient[0])} states')
        # "Nearly all": more than nine in ten.
        self.assertGreater(recipient[1] * 10, recipient[0] * 9)
        self.quoted(f'which is the {with_commas(rights[3])} under \\texttt{{refused}}')
        self.quoted(f'a gate admits a card in {with_commas(late[2])} states whose parent the harbor knows is revoked')
        self.quoted(f'lets Wren cost Heron its card in {with_commas(revoker[3])} states')
        # The exercise on the offer that was held up quotes the same row.
        self.quoted(f"it counts {with_commas(late[2])} of that build's {with_commas(late[0])} states", self.chapter)

    def test_the_models(self):
        lines = run('models-transfer')
        results, name = {}, None
        for line in lines[1:]:
            if line.endswith('.pv'):
                name = line
                results[name] = []
            else:
                results[name].append(line)
        self.assertEqual(len(results), 6)
        first = 'inj-event(Issued(m)) ==> inj-event(Offered(m))'
        self.assertEqual(results['offer.pv'], [
            f'RESULT {first} is true.',
            'RESULT not event(Issued(m)) is false.',
            'RESULT event(Told(m)) ==> event(Revoked(m)) is true.',
        ])
        controls = [name for name in results if name != 'offer.pv']
        self.assertEqual(len(controls), 5)
        for name in controls:
            self.assertNotEqual([line for line in results[name] if not line.startswith('RESULT (')],
                                results['offer.pv'], name)
        self.assertEqual(results['reuse-offer.pv'][:2], [
            f'RESULT {first} is false.',
            'RESULT (but event(Issued(m)) ==> event(Offered(m)) is true.)',
        ])
        self.assertIn('no-recipient-in-the-text.pv', controls)
        self.quoted('ProVerif~2.05 on an offer and its revocation, and on five controls.')
        self.quoted('Its second is \\texttt{false} on purpose')
        self.quoted('prints a second line: the same query without \\texttt{inj-} still holds')
        self.quoted('\\texttt{no-recipient-in-the-text.pv}', self.chapter)

    def test_the_exercises_are_in_the_chapter(self):
        source = CHAPTER.read_text()
        for label in EXERCISES:
            self.assertIn('{%s}' % label, source)
            self.assertIn('\\begin{pdsolution}{%s}' % label, source)
        for label in ['ex:fh-offer-late', 'ex:fh-offer-request']:
            self.quoted('Exercise~\\ref{%s}' % label)
        # The verification-status row names the build, and the kernel's files.
        self.quoted('The offer and its revocation, built in \\S\\ref{sec:fh-offer}', self.chapter)
        self.assertIn('\\path{harbord/core/src/transfer.rs}', source)
        self.assertIn('\\path{harbord/formal/transfer/}', source)


if __name__ == '__main__':
    unittest.main()
