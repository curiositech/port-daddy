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
