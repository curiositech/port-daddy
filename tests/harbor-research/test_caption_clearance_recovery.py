"""Source guards for the 21 September caption-clearance repair.

The complete PDF's adjacency audit remains the acceptance gate. These checks
only preserve the sources, full recall questions and locally scoped placement.
"""
import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


class CaptionClearanceRecovery(unittest.TestCase):
    def test_estimator_credits_bind_to_complete_archival_sources(self):
        entries = json.loads((ROOT / "whitepaper/citation-margin-entries.json").read_text())
        by_body = {e["original"]: e for e in entries}
        self.assertEqual(len(by_body), len(entries), "One margin override per archival record")
        source = (ROOT / "website-v2/public/whitepaper/spawn-to-person.tex").read_text()
        for key, year, title in [
            ("bradleyterry1952", "1952", "Rank Analysis of Incomplete Block Designs: I. The Method of Paired Comparisons"),
            ("elo1978", "1978", "The Rating of Chessplayers, Past and Present"),
            ("herbrich2007trueskill", "2007", "TrueSkill: A Bayesian Skill Rating System"),
        ]:
            with self.subTest(key=key):
                body = source.split(r"\bibitem{" + key + "}", 1)[1].split(r"\bibitem{", 1)[0].strip()
                entry = by_body[body]
                self.assertEqual(body, entry["original"])
                self.assertIn(title, entry["margin"])
                self.assertIn(year, entry["margin"])
                self.assertIn(r"\pdcite{" + key + "}", source)

    def test_long_recalls_have_local_body_measure_with_all_questions(self):
        source = (ROOT / "website-v2/public/whitepaper/federated-harbor-whitepaper.tex").read_text()
        recalls = re.findall(
            r"\\begin\{pdrecitationbody\}(.*?)"
            r"\\end\{pdrecitationbody\}", source, re.S)
        self.assertEqual(len(recalls), 2)
        self.assertNotIn(r"\pdmargincolumnfalse", source)
        for body in recalls:
            self.assertEqual(body.count(r"\item"), 3)
        self.assertIn("exclusive authority over", recalls[0])
        self.assertIn("under $B$'s policy?", recalls[0])
        self.assertIn("the one mechanism each rests its pushback on", recalls[0])
        self.assertIn("why does that binding matter more than any single signature", recalls[1])
        self.assertIn("what specific assumption is it still conditional on", recalls[1])
        self.assertIn("which later section closes the deferred one", recalls[1])

    def test_body_recall_never_disables_margin_shipout(self):
        copies = [ROOT / p / "figures/pd-pedagogy.tex" for p in
                  ("whitepaper", "website-v2/public/whitepaper")]
        self.assertEqual(copies[0].read_bytes(), copies[1].read_bytes())
        source = copies[0].read_text()
        body = source.split(r"\NewEnviron{pdrecitationbody}", 1)[1].split(
            r"\NewEnviron{pdrecitation}", 1)[0]
        self.assertNotIn(r"\pdmargincolumnfalse", body)
        self.assertIn(r"\BODY", body)
        self.assertIn(r"\global\let\pd@pendingpointer\@empty", body)


if __name__ == "__main__":
    unittest.main()
