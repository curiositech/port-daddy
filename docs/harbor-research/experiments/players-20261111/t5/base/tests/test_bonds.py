import unittest

from harborledger.bonds import Bond, BondBook, BondError
from harborledger.money import MoneyError


class TestBond(unittest.TestCase):
    def test_available_is_posted_less_held_and_slashed(self):
        bond = Bond("heron", 1000)
        bond.hold(300)
        bond.slash(100)
        self.assertEqual((bond.posted, bond.held, bond.slashed), (1000, 200, 100))
        self.assertEqual(bond.available(), 700)

    def test_cannot_hold_more_than_available(self):
        bond = Bond("heron", 500)
        bond.hold(400)
        with self.assertRaises(BondError):
            bond.hold(101)

    def test_release_returns_held_money(self):
        bond = Bond("heron", 500)
        bond.hold(400)
        bond.release(150)
        self.assertEqual((bond.held, bond.available()), (250, 250))

    def test_release_more_than_held_raises(self):
        bond = Bond("heron", 500)
        bond.hold(100)
        with self.assertRaises(BondError):
            bond.release(101)
        self.assertEqual(bond.held, 100)

    def test_cannot_release_more_than_held(self):
        bond = Bond("heron", 500)
        bond.hold(100)
        with self.assertRaises(BondError):
            bond.release(101)
        self.assertEqual(bond.held, 100)

    def test_slash_takes_held_money_for_good(self):
        bond = Bond("heron", 500)
        bond.hold(200)
        self.assertEqual(bond.slash(200), 200)
        self.assertEqual((bond.held, bond.slashed, bond.available()), (0, 200, 300))

    def test_cannot_slash_more_than_held(self):
        bond = Bond("heron", 500)
        bond.hold(200)
        with self.assertRaises(BondError):
            bond.slash(201)

    def test_slash_refuses_a_negative_amount(self):
        bond = Bond("heron", 500)
        bond.hold(200)
        with self.assertRaises(MoneyError):
            bond.slash(-1)

    def test_withdraw_only_what_is_available(self):
        bond = Bond("heron", 500)
        bond.hold(200)
        bond.withdraw(300)
        self.assertEqual((bond.posted, bond.available()), (200, 0))
        with self.assertRaises(BondError):
            bond.withdraw(1)


class TestBondBook(unittest.TestCase):
    def test_post_opens_and_tops_up(self):
        book = BondBook()
        book.post("heron", 300)
        book.post("heron", 200)
        self.assertEqual(book.get("heron").posted, 500)

    def test_get_unknown_agent_raises(self):
        with self.assertRaises(BondError):
            BondBook().get("nobody")

    def test_total_leaves_out_slashed_money(self):
        book = BondBook()
        book.post("heron", 500)
        book.post("finch", 300)
        book.get("heron").hold(100)
        book.get("heron").slash(100)
        self.assertEqual(book.total(), 700)


if __name__ == "__main__":
    unittest.main()
