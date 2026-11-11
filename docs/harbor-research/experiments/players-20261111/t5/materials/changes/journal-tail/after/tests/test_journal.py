import unittest

from harborledger.journal import GENESIS, Journal


class TestJournal(unittest.TestCase):
    def test_entries_are_numbered_and_chained(self):
        j = Journal()
        first = j.append("a", {"n": 1})
        second = j.append("b", {"n": 2})
        self.assertEqual((first["seq"], second["seq"]), (1, 2))
        self.assertEqual(first["prev"], GENESIS)
        self.assertEqual(second["prev"], first["hash"])
        self.assertEqual(len(j), 2)

    def test_entries_filters_by_kind(self):
        j = Journal()
        j.append("a", {})
        j.append("b", {})
        j.append("a", {})
        self.assertEqual([e["seq"] for e in j.entries("a")], [1, 3])
        self.assertEqual(len(j.entries()), 3)

    def test_returned_entries_are_copies(self):
        j = Journal()
        payload = {"items": [1]}
        entry = j.append("a", payload)
        payload["items"].append(2)
        entry["payload"]["items"].append(3)
        j.entries()[0]["payload"]["items"].append(4)
        self.assertEqual(j.entries()[0]["payload"], {"items": [1]})

    def test_verify_passes_on_an_untouched_journal(self):
        j = Journal()
        for n in range(5):
            j.append("a", {"n": n})
        self.assertEqual(j.verify(), 0)

    def test_verify_finds_an_edited_payload(self):
        j = Journal()
        for n in range(4):
            j.append("a", {"n": n})
        j._entries[2]["payload"]["n"] = 99
        self.assertEqual(j.verify(), 3)

    def test_verify_finds_a_removed_entry(self):
        j = Journal()
        for n in range(4):
            j.append("a", {"n": n})
        del j._entries[1]
        self.assertEqual(j.verify(), 2)

    def test_tail_returns_the_last_entries(self):
        j = Journal()
        for n in range(4):
            j.append("a", {"n": n})
        self.assertEqual([e["seq"] for e in j.tail(2)], [3, 4])
        self.assertEqual([e["seq"] for e in j.tail(9)], [1, 2, 3, 4])
        with self.assertRaises(ValueError):
            j.tail(-1)


if __name__ == "__main__":
    unittest.main()
