"""T5: the 16 change requests against base/, written as edit scripts.

Each change lists `edits`: (path, old text, new text). `old` must occur
exactly once in the file as it stands when the edit is applied. design.py
applies them to base/ and writes the diff and the changed files.

A flawed change also carries `flaw`:
  tier      one of the tiers that MANIFEST.md defines in section 5
  where     (path, text) pairs; the lines that text spans in the changed file
            are the ground-truth range. The first pair is the main place.
  sentence  one sentence saying what is wrong
  fix       edits that repair the flaw, applied on top of the change
  probe     a unittest module that fails on the change and passes on the fix

`adversarial` marks the four changes whose obvious reading is wrong: two
clean changes that look as if they weaken something, and two flawed changes
whose description says a test covers the very thing that is broken.

Nothing here reaches a subject except the title, the description, the diff
and the changed files.
"""

TEST_TAIL = '\n\nif __name__ == "__main__":\n    unittest.main()\n'


def add_test(path: str, code: str) -> tuple[str, str, str]:
    """An edit that appends test methods to the last class of a test file. `code` starts with a blank line."""
    return (path, TEST_TAIL, code.rstrip("\n") + "\n" + TEST_TAIL)


CHANGES = [
    # ------------------------------------------------------------------ plain flaws
    {
        "key": "transfer",
        "title": "bonds: move available money between two bonds",
        "description": (
            "An operator sometimes has to move a deposit from one agent to another, for instance when an agent "
            "is renamed. `BondBook.transfer` withdraws the amount from the source bond, so only available money "
            "can move (R3), and posts it to the target. The total across bonds does not change. A test holds "
            "both points."),
        "adversarial": None,
        "edits": [
            ("harborledger/bonds.py",
             '''            raise BondError(f"{agent} has no bond") from None
''',
             '''            raise BondError(f"{agent} has no bond") from None

    def transfer(self, source, target, amount):
        """Move available money from one agent's bond to another's."""
        require_cents(amount)
        giver = self.get(source)
        taker = self.get(target)
        giver.withdraw(amount)
        giver.top_up(amount)
'''),
            add_test("tests/test_bonds.py", '''
    def test_transfer_moves_available_money_only(self):
        book = BondBook()
        book.post("heron", 500)
        book.post("finch", 100)
        book.get("heron").hold(200)
        with self.assertRaises(BondError):
            book.transfer("heron", "finch", 301)
        book.transfer("heron", "finch", 300)
        self.assertEqual(book.total(), 600)
'''),
        ],
        "flaw": {
            "tier": "plain",
            "where": [("harborledger/bonds.py", "        giver.top_up(amount)\n")],
            "sentence": ("transfer posts the amount back to the source bond instead of the target, so the target "
                         "never receives the money."),
            "fix": [("harborledger/bonds.py", "        giver.top_up(amount)\n", "        taker.top_up(amount)\n")],
            "probe": '''
import unittest

from harborledger.bonds import BondBook


class Probe(unittest.TestCase):
    def test_transfer_reaches_the_target(self):
        book = BondBook()
        book.post("heron", 500)
        book.post("finch", 100)
        book.transfer("heron", "finch", 300)
        self.assertEqual(book.get("finch").posted, 400)
        self.assertEqual(book.get("heron").posted, 200)
''',
        },
    },
    {
        "key": "set-rate",
        "title": "audits: let the operator change the audit rate",
        "description": (
            "The rate was fixed when the book was made. `AuditBook.set_rate` changes it for claims closed "
            "afterwards and journals the change (R9). It refuses a rate outside 0 to 10,000 basis points, as the "
            "constructor does. Claims already in audit are not touched."),
        "adversarial": None,
        "edits": [
            ("harborledger/audits.py",
             '''        self.paid = {}   # auditor -> bounty earned
''',
             '''        self.paid = {}   # auditor -> bounty earned

    def set_rate(self, rate_bps):
        """Change the audit rate for claims closed from now on."""
        if rate_bps < 0 and rate_bps > BPS:
            raise AuditError(f"rate must be from 0 to {BPS} basis points, got {rate_bps!r}")
        self._rate_bps = rate_bps
        self._journal.append("audit.rate", {"rate_bps": rate_bps})
'''),
            add_test("tests/test_audits.py", '''
    def test_set_rate_applies_to_later_closes(self):
        _, journal, claims, audits = make_ledger(0)
        first = done_claim(claims, task="task-1")
        self.assertEqual(audits.close(first.claim_id), SETTLED)
        audits.set_rate(10000)
        second = done_claim(claims, task="task-2")
        self.assertEqual(audits.close(second.claim_id), IN_AUDIT)
        self.assertEqual(journal.entries("audit.rate")[0]["payload"], {"rate_bps": 10000})
'''),
        ],
        "flaw": {
            "tier": "plain",
            "where": [("harborledger/audits.py", "        if rate_bps < 0 and rate_bps > BPS:\n")],
            "sentence": ("The range check joins its two conditions with `and`, which no number satisfies, so "
                         "set_rate accepts and journals any rate."),
            "fix": [("harborledger/audits.py",
                     "        if rate_bps < 0 and rate_bps > BPS:\n",
                     "        if isinstance(rate_bps, bool) or not isinstance(rate_bps, int) "
                     "or not 0 <= rate_bps <= BPS:\n")],
            "probe": '''
import unittest

from harborledger.audits import AuditBook, AuditError
from harborledger.bonds import BondBook
from harborledger.claims import ClaimBook
from harborledger.journal import Journal


class Probe(unittest.TestCase):
    def test_set_rate_refuses_a_rate_out_of_range(self):
        bonds, journal = BondBook(), Journal()
        audits = AuditBook(bonds, ClaimBook(bonds, journal), journal, "seed-1", 0)
        for bad in (10001, -5):
            with self.assertRaises(AuditError):
                audits.set_rate(bad)
        self.assertEqual(journal.entries("audit.rate"), [])
''',
        },
    },
    {
        "key": "parse-commas",
        "title": "money: accept thousands separators in parse_amount",
        "description": (
            "Operators paste amounts such as `1,250.50` from spreadsheets, and `parse_amount` refused them. It "
            "now accepts commas that group the whole part in threes and refuses a comma anywhere else. Amounts "
            "without commas parse as before."),
        "adversarial": None,
        "edits": [
            ("harborledger/money.py",
             '''BPS = 10_000  # basis points in one whole
''',
             '''import re

BPS = 10_000  # basis points in one whole
_GROUPED = re.compile(r"\\d{1,3}(,\\d{3})+(\\.\\d{0,2})?")
'''),
            ("harborledger/money.py",
             '''    """Turn '12.50' or '12' into cents. At most two decimal places."""
    whole, _, frac = text.strip().partition(".")
    if not whole.isdigit() or (frac and not frac.isdigit()) or len(frac) > 2:
        raise MoneyError(f"not an amount: {text!r}")
    return int(whole) * 100 + int(frac.ljust(2, "0"))
''',
             '''    """Turn '1,250.50' or '12' into cents. At most two decimal places."""
    plain = text.strip()
    if "," in plain:
        if not _GROUPED.fullmatch(plain):
            raise MoneyError(f"not an amount: {text!r}")
        plain = plain.replace(",", "")
    whole, _, frac = plain.partition(".")
    if not whole.isdigit() or (frac and not frac.isdigit()) or len(frac) > 2:
        raise MoneyError(f"not an amount: {text!r}")
    return int(float(plain) * 100)
'''),
            add_test("tests/test_money.py", '''
    def test_parse_amount_with_thousands_separators(self):
        self.assertEqual(parse_amount("1,250.50"), 125050)
        self.assertEqual(parse_amount("2,000"), 200000)
        self.assertEqual(parse_amount("1,000,000.25"), 100000025)
        for bad in ("1,25", "12,50.00", ",500", "1,,000"):
            with self.assertRaises(MoneyError):
                parse_amount(bad)
'''),
        ],
        "flaw": {
            "tier": "plain",
            "where": [("harborledger/money.py", "    return int(float(plain) * 100)\n")],
            "sentence": ("The amount now goes through float, which R1 forbids, and comes out a cent short for "
                         "inputs such as '0.29' or '19.99'."),
            "fix": [("harborledger/money.py",
                     "    return int(float(plain) * 100)\n",
                     '    return int(whole) * 100 + int(frac.ljust(2, "0"))\n')],
            "probe": '''
import unittest

from harborledger.money import parse_amount


class Probe(unittest.TestCase):
    def test_parse_amount_is_exact(self):
        self.assertEqual(parse_amount("0.29"), 29)
        self.assertEqual(parse_amount("1.15"), 115)
        self.assertEqual(parse_amount("19.99"), 1999)
        self.assertEqual(parse_amount("1,019.99"), 101999)
''',
        },
    },
    {
        "key": "journal-split",
        "title": "audits: journal the auditor and the split when an audit settles",
        "description": (
            "The `audit.settle` entry said only which claim settled and how. So that the pool and the bounties "
            "can be rebuilt from the journal alone, the entry now also names the auditor, the amount slashed, "
            "the bounty and the pool's part. A passed audit journals zeros."),
        "adversarial": None,
        "edits": [
            ("harborledger/audits.py",
             '''        taken = 0
        if audit.verdict == PASS:
''',
             '''        taken = bounty = to_pool = 0
        if audit.verdict == PASS:
'''),
            ("harborledger/audits.py",
             '''        self._journal.append("audit.settle", {"claim": claim_id, "verdict": audit.verdict})
''',
             '''        self._journal.append("audit.settle", {
            "claim": claim_id, "verdict": audit.verdict, "auditor": audit.auditor,
            "slashed": taken, "bounty": to_pool, "pool": bounty,
        })
'''),
            add_test("tests/test_audits.py", '''
    def test_settlement_is_journaled_with_its_split(self):
        _, journal, claims, audits = make_ledger(10000)
        claim = done_claim(claims, stake=400)
        audits.close(claim.claim_id)
        audits.record(claim.claim_id, "finch", FAIL)
        audits.settle(claim.claim_id)
        payload = journal.entries("audit.settle")[0]["payload"]
        self.assertEqual((payload["auditor"], payload["slashed"]), ("finch", 400))
        self.assertEqual(payload["bounty"] + payload["pool"], 400)
'''),
        ],
        "flaw": {
            "tier": "plain",
            "where": [("harborledger/audits.py", '            "slashed": taken, "bounty": to_pool, "pool": bounty,\n')],
            "sentence": ("The journal entry stores the pool's part under `bounty` and the bounty under `pool`, so "
                         "a rebuild from the journal pays each side the other's amount."),
            "fix": [("harborledger/audits.py",
                     '            "slashed": taken, "bounty": to_pool, "pool": bounty,\n',
                     '            "slashed": taken, "bounty": bounty, "pool": to_pool,\n')],
            "probe": '''
import unittest

from harborledger.audits import FAIL, AuditBook
from harborledger.bonds import BondBook
from harborledger.claims import ClaimBook
from harborledger.journal import Journal


class Probe(unittest.TestCase):
    def test_the_journal_names_each_part_correctly(self):
        bonds, journal = BondBook(), Journal()
        bonds.post("heron", 1000)
        claims = ClaimBook(bonds, journal)
        audits = AuditBook(bonds, claims, journal, "seed-1", 10000)
        claim = claims.open("heron", "task-1", 400, now=0, ttl=10)
        claims.complete(claim.claim_id, "heron", now=1)
        audits.close(claim.claim_id)
        audits.record(claim.claim_id, "finch", FAIL)
        audits.settle(claim.claim_id)
        payload = journal.entries("audit.settle")[0]["payload"]
        self.assertEqual(payload["bounty"], audits.paid["finch"])
        self.assertEqual(payload["pool"], audits.pool)
        self.assertEqual((payload["bounty"], payload["pool"]), (80, 320))
''',
        },
    },
    # ------------------------------------------------------------------ moderate flaws
    {
        "key": "bounty-setting",
        "title": "audits: make the auditor's share of a slash a setting",
        "description": (
            "`BOUNTY_BPS` was a constant. A harbor that wants to pay its auditors more or less can now pass "
            "`bounty_bps` when it makes the `AuditBook`. The default is the old 20%. Both parts of a slash are "
            "computed from the setting. `test_split_adds_up` covers the split: the bounty and the pool's part "
            "add up to the amount slashed (R2)."),
        "adversarial": "description_names_a_test_for_the_broken_thing",
        "edits": [
            ("harborledger/audits.py",
             '''    def __init__(self, bonds, claims, journal, seed, rate_bps):
        selected(seed, 0, rate_bps)  # refuses a bad rate at once
''',
             '''    def __init__(self, bonds, claims, journal, seed, rate_bps, bounty_bps=BOUNTY_BPS):
        selected(seed, 0, rate_bps)  # refuses a bad rate at once
        if isinstance(bounty_bps, bool) or not isinstance(bounty_bps, int) or not 0 <= bounty_bps <= BPS:
            raise AuditError(f"bounty share must be an int from 0 to {BPS} basis points, got {bounty_bps!r}")
'''),
            ("harborledger/audits.py",
             '''        self._rate_bps = rate_bps
''',
             '''        self._rate_bps = rate_bps
        self._bounty_bps = bounty_bps
'''),
            ("harborledger/audits.py",
             '''            bounty = share(taken, BOUNTY_BPS)
            to_pool = taken - bounty
''',
             '''            bounty = share(taken, self._bounty_bps)
            to_pool = share(taken, BPS - self._bounty_bps)
'''),
            ("tests/test_audits.py",
             '''def make_ledger(rate_bps, seed="seed-1"):
''',
             '''def make_ledger(rate_bps, seed="seed-1", **settings):
'''),
            ("tests/test_audits.py",
             '''    audits = AuditBook(bonds, claims, journal, seed, rate_bps)
''',
             '''    audits = AuditBook(bonds, claims, journal, seed, rate_bps, **settings)
'''),
            add_test("tests/test_audits.py", '''
    def test_split_adds_up(self):
        _, _, claims, audits = make_ledger(10000, bounty_bps=2500)
        claim = done_claim(claims, stake=1000)
        audits.close(claim.claim_id)
        audits.record(claim.claim_id, "finch", FAIL)
        self.assertEqual(audits.settle(claim.claim_id), 1000)
        self.assertEqual((audits.paid["finch"], audits.pool), (250, 750))
        self.assertEqual(audits.paid["finch"] + audits.pool, 1000)

    def test_a_bad_bounty_share_is_refused(self):
        with self.assertRaises(AuditError):
            make_ledger(10000, bounty_bps=10001)
'''),
        ],
        "flaw": {
            "tier": "moderate",
            "where": [("harborledger/audits.py", "            to_pool = share(taken, BPS - self._bounty_bps)\n")],
            "sentence": ("Both parts are now rounded down separately, so for most amounts the bounty and the "
                         "pool's part add up to a cent less than the slash, which breaks R2."),
            "fix": [("harborledger/audits.py",
                     "            to_pool = share(taken, BPS - self._bounty_bps)\n",
                     "            to_pool = taken - bounty\n")],
            "probe": '''
import unittest

from harborledger.audits import FAIL, AuditBook
from harborledger.bonds import BondBook
from harborledger.claims import ClaimBook
from harborledger.journal import Journal


class Probe(unittest.TestCase):
    def test_the_parts_add_up_for_an_awkward_amount(self):
        for stake in (999, 401, 7):
            bonds, journal = BondBook(), Journal()
            bonds.post("heron", 1000)
            claims = ClaimBook(bonds, journal)
            audits = AuditBook(bonds, claims, journal, "seed-1", 10000)
            claim = claims.open("heron", "task-1", stake, now=0, ttl=10)
            claims.complete(claim.claim_id, "heron", now=1)
            audits.close(claim.claim_id)
            audits.record(claim.claim_id, "finch", FAIL)
            self.assertEqual(audits.settle(claim.claim_id), stake)
            self.assertEqual(audits.paid["finch"] + audits.pool, stake)
''',
        },
    },
    {
        "key": "expire-order",
        "title": "claims: expire in deadline order and stop at the first claim that is not due",
        "description": (
            "`expire` walked every claim on every call and returned ids in the order the claims were opened. It "
            "now sorts by deadline and stops at the first claim whose deadline has not come. The expired claims "
            "are returned and journaled earliest deadline first, which is the order an operator reading the "
            "journal expects."),
        "adversarial": None,
        "edits": [
            ("harborledger/claims.py",
             '''        """Expire every open claim whose deadline has come (R6). Returns their ids."""
        expired = []
        for claim in self._claims.values():
            if claim.state == OPEN and now >= claim.deadline():
                self._bonds.get(claim.agent).release(claim.stake)
                claim.state = EXPIRED
                self._journal.append("claim.expire", {"claim": claim.claim_id, "at": now})
                expired.append(claim.claim_id)
        return expired
''',
             '''        """Expire every open claim whose deadline has come (R6). Returns their ids, earliest deadline first."""
        expired = []
        for claim in sorted(self._claims.values(), key=Claim.deadline):
            if now < claim.deadline():
                break
            self._bonds.get(claim.agent).release(claim.stake)
            claim.state = EXPIRED
            self._journal.append("claim.expire", {"claim": claim.claim_id, "at": now})
            expired.append(claim.claim_id)
        return expired
'''),
            add_test("tests/test_claims.py", '''
    def test_expire_goes_in_deadline_order(self):
        _, journal, claims = make_book()
        claims.open("heron", "task-1", 100, now=0, ttl=9)
        claims.open("finch", "task-2", 100, now=0, ttl=3)
        claims.open("heron", "task-3", 100, now=0, ttl=5)
        self.assertEqual(claims.expire(now=6), [2, 3])
        self.assertEqual([e["payload"]["claim"] for e in journal.entries("claim.expire")], [2, 3])
        self.assertEqual(claims.holder("task-1").claim_id, 1)
'''),
        ],
        "flaw": {
            "tier": "moderate",
            "where": [("harborledger/claims.py",
                       '''        for claim in sorted(self._claims.values(), key=Claim.deadline):
            if now < claim.deadline():
                break
''')],
            "sentence": ("The rewritten loop no longer checks that a claim is open, so a claim that was released or "
                         "completed is expired once its deadline passes, and its stake is released a second time."),
            "fix": [("harborledger/claims.py",
                     '''            if now < claim.deadline():
                break
''',
                     '''            if now < claim.deadline():
                break
            if claim.state != OPEN:
                continue
''')],
            "probe": '''
import unittest

from harborledger.bonds import BondBook
from harborledger.claims import DONE, RELEASED, ClaimBook
from harborledger.journal import Journal


class Probe(unittest.TestCase):
    def test_expire_leaves_claims_that_are_not_open(self):
        bonds, journal = BondBook(), Journal()
        bonds.post("heron", 1000)
        claims = ClaimBook(bonds, journal)
        given_up = claims.open("heron", "task-1", 300, now=0, ttl=5)
        claims.release(given_up.claim_id, "heron")
        finished = claims.open("heron", "task-2", 400, now=0, ttl=5)
        claims.complete(finished.claim_id, "heron", now=2)
        self.assertEqual(claims.expire(now=9), [])
        self.assertEqual((given_up.state, finished.state), (RELEASED, DONE))
        self.assertEqual(bonds.get("heron").held, 400)
''',
        },
    },
    {
        "key": "journal-tail",
        "title": "journal: add tail(count) for the last entries",
        "description": (
            "The status page wants the newest few journal entries without copying the whole journal. "
            "`Journal.tail(count)` returns copies of the last `count` entries, oldest first, and all of them "
            "when the journal is shorter. A negative count is refused."),
        "adversarial": None,
        "edits": [
            ("harborledger/journal.py",
             '''        return [copy.deepcopy(e) for e in self._entries if kind is None or e["kind"] == kind]
''',
             '''        return [copy.deepcopy(e) for e in self._entries if kind is None or e["kind"] == kind]

    def tail(self, count):
        """Copies of the last count entries, oldest first."""
        if count < 0:
            raise ValueError("count must not be negative")
        return [copy.deepcopy(e) for e in self._entries[-count:]]
'''),
            add_test("tests/test_journal.py", '''
    def test_tail_returns_the_last_entries(self):
        j = Journal()
        for n in range(4):
            j.append("a", {"n": n})
        self.assertEqual([e["seq"] for e in j.tail(2)], [3, 4])
        self.assertEqual([e["seq"] for e in j.tail(9)], [1, 2, 3, 4])
        with self.assertRaises(ValueError):
            j.tail(-1)
'''),
        ],
        "flaw": {
            "tier": "moderate",
            "where": [("harborledger/journal.py",
                       "        return [copy.deepcopy(e) for e in self._entries[-count:]]\n")],
            "sentence": ("With a count of 0 the slice `[-0:]` is the whole list, so tail(0) returns every entry "
                         "where it should return none."),
            "fix": [("harborledger/journal.py",
                     "        return [copy.deepcopy(e) for e in self._entries[-count:]]\n",
                     "        start = max(0, len(self._entries) - count)\n"
                     "        return [copy.deepcopy(e) for e in self._entries[start:]]\n")],
            "probe": '''
import unittest

from harborledger.journal import Journal


class Probe(unittest.TestCase):
    def test_a_tail_of_zero_is_empty(self):
        j = Journal()
        for n in range(4):
            j.append("a", {"n": n})
        self.assertEqual(j.tail(0), [])
        self.assertEqual([e["seq"] for e in j.tail(1)], [4])
''',
        },
    },
    {
        "key": "audit-reopen",
        "title": "audits: let an operator reopen a recorded verdict",
        "description": (
            "A verdict could not be corrected once recorded, even when the auditor had looked at the wrong "
            "revision. `AuditBook.reopen(claim_id, reason)` discards the recorded verdict so that an auditor "
            "can record a new one before the audit is settled, and journals the reason (R9). An audit with no "
            "verdict cannot be reopened."),
        "adversarial": None,
        "edits": [
            ("harborledger/audits.py",
             '''        self._journal.append("audit.verdict", {"claim": claim_id, "auditor": auditor, "verdict": verdict})
''',
             '''        self._journal.append("audit.verdict", {"claim": claim_id, "auditor": auditor, "verdict": verdict})

    def reopen(self, claim_id, reason):
        """Discard a recorded verdict so that an auditor can record a new one."""
        audit = self._audit(claim_id)
        if audit.verdict is None:
            raise AuditError(f"claim {claim_id} has no verdict to reopen")
        self._audits[claim_id] = Audit(claim_id)
        self._journal.append("audit.reopen", {"claim": claim_id, "reason": reason})
'''),
            add_test("tests/test_audits.py", '''
    def test_reopen_lets_another_auditor_record(self):
        _, journal, claims, audits = make_ledger(10000)
        claim = done_claim(claims)
        audits.close(claim.claim_id)
        with self.assertRaises(AuditError):
            audits.reopen(claim.claim_id, "nothing recorded yet")
        audits.record(claim.claim_id, "finch", FAIL)
        audits.reopen(claim.claim_id, "finch read the wrong revision")
        audits.record(claim.claim_id, "wren", PASS)
        self.assertEqual(audits.settle(claim.claim_id), 0)
        self.assertEqual(len(journal.entries("audit.reopen")), 1)
'''),
        ],
        "flaw": {
            "tier": "moderate",
            "where": [("harborledger/audits.py",
                       '''        if audit.verdict is None:
            raise AuditError(f"claim {claim_id} has no verdict to reopen")
        self._audits[claim_id] = Audit(claim_id)
''')],
            "sentence": ("reopen does not refuse an audit that is already settled, and the fresh Audit it stores "
                         "has settled = False, so the same claim can be settled a second time, against R8."),
            "fix": [("harborledger/audits.py",
                     '''            raise AuditError(f"claim {claim_id} has no verdict to reopen")
        self._audits[claim_id] = Audit(claim_id)
''',
                     '''            raise AuditError(f"claim {claim_id} has no verdict to reopen")
        if audit.settled:
            raise AuditError(f"claim {claim_id} is already settled")
        self._audits[claim_id] = Audit(claim_id)
''')],
            "probe": '''
import unittest

from harborledger.audits import FAIL, AuditBook, AuditError
from harborledger.bonds import BondBook
from harborledger.claims import ClaimBook
from harborledger.journal import Journal


class Probe(unittest.TestCase):
    def test_a_settled_audit_cannot_be_reopened(self):
        bonds, journal = BondBook(), Journal()
        bonds.post("heron", 1000)
        claims = ClaimBook(bonds, journal)
        audits = AuditBook(bonds, claims, journal, "seed-1", 10000)
        first = claims.open("heron", "task-1", 400, now=0, ttl=10)
        claims.complete(first.claim_id, "heron", now=1)
        claims.open("heron", "task-2", 400, now=0, ttl=10)
        audits.close(first.claim_id)
        audits.record(first.claim_id, "finch", FAIL)
        audits.settle(first.claim_id)
        with self.assertRaises(AuditError):
            audits.reopen(first.claim_id, "once more")
        self.assertEqual(bonds.get("heron").slashed, 400)
''',
        },
    },
    # ------------------------------------------------------------------ subtle flaws
    {
        "key": "claim-renew",
        "title": "claims: let the holder renew a claim",
        "description": (
            "Long tasks ran out of time and had to be released and claimed again, which let another agent take "
            "the task in between. `ClaimBook.renew` moves the deadline of an open claim to `now + ttl`. Only "
            "the holder may renew (R5), and a claim past its deadline cannot be renewed. The renewal is "
            "journaled."),
        "adversarial": None,
        "edits": [
            ("harborledger/claims.py",
             '''        claim.state = DONE
        self._journal.append("claim.done", {"claim": claim_id, "at": now})
''',
             '''        claim.state = DONE
        self._journal.append("claim.done", {"claim": claim_id, "at": now})

    def renew(self, claim_id, agent, now, ttl):
        """The holder asks for more time: the deadline becomes now + ttl."""
        claim = self._owned_open(claim_id, agent)
        if ttl <= 0:
            raise ClaimError("ttl must be positive")
        if now > claim.deadline():
            raise ClaimError(f"claim {claim_id} is past its deadline")
        claim.ttl = now - claim.opened_at + ttl
        self._journal.append("claim.renew", {"claim": claim_id, "at": now, "ttl": ttl})
'''),
            add_test("tests/test_claims.py", '''
    def test_renew_moves_the_deadline(self):
        _, journal, claims = make_book()
        claim = claims.open("heron", "task-1", 400, now=0, ttl=5)
        claims.renew(claim.claim_id, "heron", now=3, ttl=10)
        self.assertEqual(claim.deadline(), 13)
        self.assertEqual(claims.expire(now=12), [])
        with self.assertRaises(ClaimError):
            claims.renew(claim.claim_id, "finch", now=4, ttl=10)
        with self.assertRaises(ClaimError):
            claims.renew(claim.claim_id, "heron", now=14, ttl=10)
        self.assertEqual(len(journal.entries("claim.renew")), 1)
'''),
        ],
        "flaw": {
            "tier": "subtle",
            "where": [("harborledger/claims.py", "        if now > claim.deadline():\n")],
            "sentence": ("R6 puts a claim past its deadline at every time now >= deadline, as complete and expire "
                         "do, but renew compares with >, so a claim can still be renewed at the very time it "
                         "expires."),
            "fix": [("harborledger/claims.py",
                     "        if now > claim.deadline():\n",
                     "        if now >= claim.deadline():\n")],
            "probe": '''
import unittest

from harborledger.bonds import BondBook
from harborledger.claims import ClaimBook, ClaimError
from harborledger.journal import Journal


class Probe(unittest.TestCase):
    def test_no_renewal_at_the_deadline(self):
        bonds, journal = BondBook(), Journal()
        bonds.post("heron", 1000)
        claims = ClaimBook(bonds, journal)
        claim = claims.open("heron", "task-1", 400, now=0, ttl=5)
        with self.assertRaises(ClaimError):
            claims.renew(claim.claim_id, "heron", now=5, ttl=10)
        self.assertEqual(claims.expire(now=5), [claim.claim_id])
''',
        },
    },
    {
        "key": "late-fee",
        "title": "claims: charge a late fee when a claim expires",
        "description": (
            "Letting a claim run out cost its holder nothing, so agents sat on tasks. An expired claim now pays "
            "a late fee of 5% of its stake: `expire` slashes the fee from the held stake (R4), returns the "
            "rest, adds the fee to `ClaimBook.late_fees` and journals it. R6 in RULES.md says so. "
            "`test_expire_charges_late_fee` covers the fee and where it goes."),
        "adversarial": "description_names_a_test_for_the_broken_thing",
        "edits": [
            ("RULES.md",
             '''nothing more with it, and `expire` returns its stake.
''',
             '''nothing more with it, and `expire` returns its stake less a late fee of 5%,
which the ledger keeps.
'''),
            ("harborledger/claims.py",
             '''from .money import require_cents
''',
             '''from .money import require_cents, share
'''),
            ("harborledger/claims.py",
             '''FORFEITED = "forfeited"  # closed by a failed audit; the stake was slashed
''',
             '''FORFEITED = "forfeited"  # closed by a failed audit; the stake was slashed

LATE_FEE = 5  # percent of the stake that an expired claim pays
'''),
            ("harborledger/claims.py",
             '''        self._claims = {}

    def get(self, claim_id):
''',
             '''        self._claims = {}
        self.late_fees = 0  # fees paid by expired claims

    def get(self, claim_id):
'''),
            ("harborledger/claims.py",
             '''                self._bonds.get(claim.agent).release(claim.stake)
                claim.state = EXPIRED
                self._journal.append("claim.expire", {"claim": claim.claim_id, "at": now})
''',
             '''                bond = self._bonds.get(claim.agent)
                fee = share(claim.stake, LATE_FEE)
                bond.slash(fee)
                bond.release(claim.stake - fee)
                self.late_fees += fee
                claim.state = EXPIRED
                self._journal.append("claim.expire", {"claim": claim.claim_id, "at": now, "fee": fee})
'''),
            ("tests/test_claims.py",
             '''from harborledger.claims import DONE, EXPIRED, OPEN, RELEASED, ClaimBook, ClaimError
from harborledger.journal import Journal
''',
             '''from harborledger.claims import DONE, EXPIRED, LATE_FEE, OPEN, RELEASED, ClaimBook, ClaimError
from harborledger.journal import Journal
from harborledger.money import share
'''),
            add_test("tests/test_claims.py", '''
    def test_expire_charges_late_fee(self):
        bonds, journal, claims = make_book()
        claims.open("heron", "task-1", 1000, now=0, ttl=5)
        claims.expire(now=5)
        fee = share(1000, LATE_FEE)
        self.assertEqual(bonds.get("heron").slashed, fee)
        self.assertEqual(bonds.get("heron").available(), 1000 - fee)
        self.assertEqual(claims.late_fees, fee)
        self.assertEqual(journal.entries("claim.expire")[0]["payload"]["fee"], fee)
'''),
        ],
        "flaw": {
            "tier": "subtle",
            "where": [("harborledger/claims.py", "                fee = share(claim.stake, LATE_FEE)\n"),
                      ("harborledger/claims.py", "LATE_FEE = 5  # percent of the stake that an expired claim pays\n")],
            "sentence": ("money.share takes basis points, so passing 5 charges 0.05% of the stake, not the 5% the "
                         "description and R6 state, and the fee is zero for any stake under 20.00."),
            "fix": [
                ("harborledger/claims.py",
                 "LATE_FEE = 5  # percent of the stake that an expired claim pays\n",
                 "LATE_FEE = 500  # basis points of the stake that an expired claim pays: 5%\n"),
                ("tests/test_claims.py",
                 "        self.assertEqual((claim.state, bonds.get(\"heron\").available()), (EXPIRED, 1000))\n",
                 "        self.assertEqual((claim.state, bonds.get(\"heron\").available()), (EXPIRED, 980))\n"),
            ],
            "probe": '''
import unittest

from harborledger.bonds import BondBook
from harborledger.claims import ClaimBook
from harborledger.journal import Journal


class Probe(unittest.TestCase):
    def test_the_late_fee_is_five_percent(self):
        bonds, journal = BondBook(), Journal()
        bonds.post("heron", 1000)
        claims = ClaimBook(bonds, journal)
        claims.open("heron", "task-1", 1000, now=0, ttl=5)
        claims.expire(now=5)
        self.assertEqual(bonds.get("heron").slashed, 50)
        self.assertEqual(bonds.get("heron").available(), 950)
        self.assertEqual(claims.late_fees, 50)
''',
        },
    },
    {
        "key": "journal-time",
        "title": "journal: stamp entries with the time they were written",
        "description": (
            "Payloads carry times under different keys, or none, so the journal could not be cut by time. "
            "`append` takes an optional `at` and stores it on the entry next to `seq` and `kind`, and "
            "`entries_since(at)` returns the entries written at or after a time. Callers that pass no time are "
            "unaffected."),
        "adversarial": None,
        "edits": [
            ("harborledger/journal.py",
             '''    def append(self, kind, payload):
        """Add an entry and return a copy of it."""
''',
             '''    def append(self, kind, payload, at=None):
        """Add an entry and return a copy of it. `at` is the time of writing, when the caller has one."""
'''),
            ("harborledger/journal.py",
             '''        entry = {"seq": seq, "prev": prev, "kind": kind, "payload": payload}
        entry["hash"] = entry_hash(prev, seq, kind, payload)
''',
             '''        entry = {"seq": seq, "prev": prev, "kind": kind, "payload": payload, "at": at}
        entry["hash"] = entry_hash(prev, seq, kind, payload)
'''),
            ("harborledger/journal.py",
             '''        return [copy.deepcopy(e) for e in self._entries if kind is None or e["kind"] == kind]
''',
             '''        return [copy.deepcopy(e) for e in self._entries if kind is None or e["kind"] == kind]

    def entries_since(self, at):
        """Copies of the entries written at or after the given time, oldest first."""
        return [copy.deepcopy(e) for e in self._entries if e["at"] is not None and e["at"] >= at]
'''),
            add_test("tests/test_journal.py", '''
    def test_entries_carry_the_time_they_were_written(self):
        j = Journal()
        j.append("a", {}, at=5)
        j.append("b", {})
        j.append("c", {}, at=9)
        self.assertEqual([e["at"] for e in j.entries()], [5, None, 9])
        self.assertEqual([e["seq"] for e in j.entries_since(6)], [3])
        self.assertEqual(j.verify(), 0)
'''),
        ],
        "flaw": {
            "tier": "subtle",
            "where": [("harborledger/journal.py",
                       '''        entry = {"seq": seq, "prev": prev, "kind": kind, "payload": payload, "at": at}
        entry["hash"] = entry_hash(prev, seq, kind, payload)
''')],
            "sentence": ("The new `at` field is stored on the entry but left out of entry_hash, so the hash no "
                         "longer covers every field (R9) and verify does not notice an edited time."),
            "fix": [
                ("harborledger/journal.py",
                 '''def entry_hash(prev, seq, kind, payload):
''',
                 '''def entry_hash(prev, seq, kind, payload, at=None):
'''),
                ("harborledger/journal.py",
                 '''        {"prev": prev, "seq": seq, "kind": kind, "payload": payload},
''',
                 '''        {"prev": prev, "seq": seq, "kind": kind, "payload": payload, "at": at},
'''),
                ("harborledger/journal.py",
                 '''        entry["hash"] = entry_hash(prev, seq, kind, payload)
''',
                 '''        entry["hash"] = entry_hash(prev, seq, kind, payload, at)
'''),
                ("harborledger/journal.py",
                 '''            expected = entry_hash(e["prev"], e["seq"], e["kind"], e["payload"])
''',
                 '''            expected = entry_hash(e["prev"], e["seq"], e["kind"], e["payload"], e["at"])
'''),
            ],
            "probe": '''
import unittest

from harborledger.journal import Journal


class Probe(unittest.TestCase):
    def test_verify_finds_an_edited_time(self):
        j = Journal()
        j.append("a", {}, at=5)
        j.append("b", {}, at=6)
        self.assertEqual(j.verify(), 0)
        j._entries[0]["at"] = 1
        self.assertEqual(j.verify(), 1)
''',
        },
    },
    {
        "key": "draw-salt",
        "title": "audits: mix the completion time into the audit draw",
        "description": (
            "Two ledgers that share a seed gave every claim id the same draw, so claim 7 was audited in both or "
            "in neither. The draw now takes a salt, and `close` passes the time the claim was completed, which "
            "`complete` records on the claim. Draws for one claim id now differ between ledgers. The rate and "
            "the comparison are unchanged."),
        "adversarial": None,
        "edits": [
            ("harborledger/claims.py",
             '''    state: str = OPEN

''',
             '''    state: str = OPEN
    done_at: int | None = None

'''),
            ("harborledger/claims.py",
             '''        claim.state = DONE
''',
             '''        claim.state = DONE
        claim.done_at = now
'''),
            ("harborledger/audits.py",
             '''def draw(seed, claim_id):
    """A number from 0 to 9,999 fixed by the seed and the claim id alone (R7)."""
    digest = hashlib.sha256(f"{seed}:{claim_id}".encode()).digest()
''',
             '''def draw(seed, claim_id, salt=""):
    """A number from 0 to 9,999 fixed by the seed and the claim id, mixed with the salt (R7)."""
    digest = hashlib.sha256(f"{seed}:{claim_id}:{salt}".encode()).digest()
'''),
            ("harborledger/audits.py",
             '''def selected(seed, claim_id, rate_bps):
''',
             '''def selected(seed, claim_id, rate_bps, salt=""):
'''),
            ("harborledger/audits.py",
             '''    return draw(seed, claim_id) < rate_bps
''',
             '''    return draw(seed, claim_id, salt) < rate_bps
'''),
            ("harborledger/audits.py",
             '''        if selected(self._seed, claim_id, self._rate_bps):
''',
             '''        if selected(self._seed, claim_id, self._rate_bps, salt=claim.done_at):
'''),
            add_test("tests/test_audits.py", '''
    def test_the_salt_moves_the_draw(self):
        self.assertEqual(draw("s", 7, salt=3), draw("s", 7, salt=3))
        self.assertGreater(len({draw("s", 7, salt=t) for t in range(50)}), 40)
'''),
        ],
        "flaw": {
            "tier": "subtle",
            "where": [("harborledger/audits.py",
                       "        if selected(self._seed, claim_id, self._rate_bps, salt=claim.done_at):\n"),
                      ("harborledger/audits.py",
                       '''def draw(seed, claim_id, salt=""):
    """A number from 0 to 9,999 fixed by the seed and the claim id, mixed with the salt (R7)."""
    digest = hashlib.sha256(f"{seed}:{claim_id}:{salt}".encode()).digest()
''')],
            "sentence": ("R7 fixes the draw by the seed and the claim id alone so that no agent can move it, but "
                         "the draw now depends on the completion time, which the claim's holder chooses."),
            "fix": [("harborledger/audits.py",
                     "        if selected(self._seed, claim_id, self._rate_bps, salt=claim.done_at):\n",
                     "        if selected(self._seed, claim_id, self._rate_bps):\n")],
            "probe": '''
import unittest

from harborledger.audits import AuditBook
from harborledger.bonds import BondBook
from harborledger.claims import ClaimBook
from harborledger.journal import Journal


def outcome(seed, done_at):
    bonds, journal = BondBook(), Journal()
    bonds.post("heron", 1000)
    claims = ClaimBook(bonds, journal)
    audits = AuditBook(bonds, claims, journal, seed, 5000)
    claim = claims.open("heron", "task-1", 400, now=0, ttl=10)
    claims.complete(claim.claim_id, "heron", now=done_at)
    return audits.close(claim.claim_id)


class Probe(unittest.TestCase):
    def test_the_holder_cannot_move_the_draw_by_timing(self):
        for seed in range(40):
            self.assertEqual(outcome(f"seed-{seed}", 1), outcome(f"seed-{seed}", 2))
''',
        },
    },
    # ------------------------------------------------------------------ clean changes
    {
        "key": "drop-duplicate-test",
        "title": "tests: drop a duplicated bond test",
        "description": (
            "`test_cannot_release_more_than_held` and `test_release_more_than_held_raises` in "
            "tests/test_bonds.py have the same body, line for line. This removes the second one. The suite "
            "runs 46 tests, one fewer."),
        "adversarial": "clean_but_looks_suspicious",
        "edits": [
            ("tests/test_bonds.py",
             '''    def test_cannot_release_more_than_held(self):
        bond = Bond("heron", 500)
        bond.hold(100)
        with self.assertRaises(BondError):
            bond.release(101)
        self.assertEqual(bond.held, 100)

''',
             ""),
        ],
        "flaw": None,
    },
    {
        "key": "drop-dead-guard",
        "title": "bonds: remove a check in slash that can never fire",
        "description": (
            "`Bond.slash` refused a negative amount twice. `require_cents` on the line above already raises "
            "`MoneyError` for one, so the `BondError` branch after it was never reached. "
            "`test_slash_refuses_a_negative_amount` expects `MoneyError` and still passes. No behaviour "
            "changes."),
        "adversarial": "clean_but_looks_suspicious",
        "edits": [
            ("harborledger/bonds.py",
             '''        if amount < 0:
            raise BondError(f"{self.agent}: cannot slash a negative amount")
''',
             ""),
        ],
        "flaw": None,
    },
    {
        "key": "open-claims",
        "title": "claims: list open claims by deadline",
        "description": (
            "The status page needs each agent's open claims in the order they fall due. "
            "`ClaimBook.open_claims(agent=None)` returns the open claims sorted by deadline and then by claim "
            "id, for one agent or for all."),
        "adversarial": None,
        "edits": [
            ("harborledger/claims.py",
             '''                return claim
        return None
''',
             '''                return claim
        return None

    def open_claims(self, agent=None):
        """Open claims, earliest deadline first. With agent, only that agent's."""
        claims = [c for c in self._claims.values()
                  if c.state == OPEN and (agent is None or c.agent == agent)]
        return sorted(claims, key=lambda c: (c.deadline(), c.claim_id))
'''),
            add_test("tests/test_claims.py", '''
    def test_open_claims_are_listed_by_deadline(self):
        _, _, claims = make_book()
        claims.open("heron", "task-1", 100, now=0, ttl=9)
        claims.open("finch", "task-2", 100, now=0, ttl=3)
        third = claims.open("heron", "task-3", 100, now=0, ttl=5)
        self.assertEqual([c.claim_id for c in claims.open_claims()], [2, 3, 1])
        self.assertEqual([c.claim_id for c in claims.open_claims("heron")], [3, 1])
        claims.release(third.claim_id, "heron")
        self.assertEqual([c.claim_id for c in claims.open_claims("heron")], [1])
'''),
        ],
        "flaw": None,
    },
    {
        "key": "format-grouping",
        "title": "money: format amounts with thousands separators on request",
        "description": (
            "Reports print large amounts, and `1250000.00` is hard to read. `format_amount(cents, "
            "grouping=True)` separates thousands with commas. The default output is unchanged, so nothing that "
            "parses it breaks."),
        "adversarial": None,
        "edits": [
            ("harborledger/money.py",
             '''def format_amount(cents):
    """Turn cents into text with two decimal places: 1250 -> '12.50'."""
    require_cents(cents)
    return f"{cents // 100}.{cents % 100:02d}"
''',
             '''def format_amount(cents, grouping=False):
    """Turn cents into text with two decimal places: 1250 -> '12.50'.

    With grouping, thousands are separated: 125050 -> '1,250.50'."""
    require_cents(cents)
    whole = f"{cents // 100:,}" if grouping else str(cents // 100)
    return f"{whole}.{cents % 100:02d}"
'''),
            add_test("tests/test_money.py", '''
    def test_format_amount_with_grouping(self):
        self.assertEqual(format_amount(125050, grouping=True), "1,250.50")
        self.assertEqual(format_amount(100000025, grouping=True), "1,000,000.25")
        self.assertEqual(format_amount(999, grouping=True), "9.99")
        self.assertEqual(format_amount(125050), "1250.50")
'''),
        ],
        "flaw": None,
    },
]
