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
