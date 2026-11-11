import unittest

from harborledger.journal import Journal


class Probe(unittest.TestCase):
    def test_a_tail_of_zero_is_empty(self):
        j = Journal()
        for n in range(4):
            j.append("a", {"n": n})
        self.assertEqual(j.tail(0), [])
        self.assertEqual([e["seq"] for e in j.tail(1)], [4])
