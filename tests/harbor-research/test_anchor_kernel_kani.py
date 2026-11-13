"""Chapter 2 prints Kani's verdicts on the kernel's order on patterns. Check the prose against them.

The listing is the recorded file, so it cannot go out of date. The sentences
around it name harnesses and say what each found, and those were typed.
"""
import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
EXCERPTS = ROOT / 'book' / 'excerpts'
CHAPTER = ROOT / 'book' / 'anchor-protocol-whitepaper.tex'
BUILD = ROOT / 'book' / 'additions' / 'anchor-build-the-verifier.tex'


def prose(path):
    """The file's text with comments dropped and white space collapsed."""
    lines = [re.split(r'(?<!\\)%', line, maxsplit=1)[0] for line in path.read_text().splitlines()]
    return re.sub(r'\s+', ' ', ' '.join(lines))


class KernelKani(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.lines = (EXCERPTS / 'kani-patterns.txt').read_text().splitlines()
        cls.text = prose(CHAPTER)
        cls.verdicts = dict(zip(cls.lines[1::2], (line.strip() for line in cls.lines[2::2])))

    def test_the_recording(self):
        self.assertEqual(self.lines[0], '$ sh formal/patterns/run.sh')
        self.assertEqual(self.verdicts, {
            'a_pattern_includes_itself': 'successful',
            'control_a_wrong_order_is_caught': 'fails, as a control should',
            'covering_is_transitive': 'successful; its cover is satisfied',
            'inclusion_is_transitive': 'successful; its cover is satisfied',
            'patterns_that_include_each_other_are_equal': 'successful; its cover is satisfied',
        })
        manifest = json.loads((EXCERPTS / 'manifest.json').read_text())
        self.assertIn('kani-patterns', {session['name'] for session in manifest['sessions']})

    def test_the_whole_listing_is_printed_with_room_for_it(self):
        source = CHAPTER.read_text()
        found = re.search(r'\\pdlistingroom\{(\d+)\}\n\\pdrun\[[^\]]*label=\{alg:anchor-kernel-kani\}\]\{kani-patterns\}', source, flags=re.S)
        self.assertIsNotNone(found)
        self.assertEqual(int(found[1]), len(self.lines))

    def test_the_prose_names_what_the_recording_shows(self):
        def named(harness):
            return '\\texttt{%s}' % harness.replace('_', '\\_')
        # The two harnesses the prose depends on, and the control.
        for harness in ['inclusion_is_transitive', 'covering_is_transitive', 'control_a_wrong_order_is_caught']:
            self.assertIn(harness, self.verdicts)
            self.assertIn(named(harness), self.text)
        self.assertIn('Two more harnesses complete the laws of a partial order', self.text)
        self.assertEqual(len(self.verdicts) - 3, 2)
        # Every harness that starts from a condition has a cover, and each is satisfied.
        covered = [name for name, verdict in self.verdicts.items() if 'cover' in verdict]
        self.assertEqual(len(covered), 3)
        self.assertTrue(all(self.verdicts[name].endswith('its cover is satisfied') for name in covered))
        self.assertIn('has a cover statement, and every cover is satisfied', self.text)
        self.assertEqual(self.verdicts['control_a_wrong_order_is_caught'], 'fails, as a control should')
        self.assertIn('There the assertion fails, as a control should', self.text)

    def test_the_first_build_points_here(self):
        self.assertIn('and \\S\\ref{sec:implementation} on every pattern of up to four bytes', prose(BUILD))
        self.assertIn('\\paragraph{The Book\'s kernel under the same tool.}', CHAPTER.read_text())


if __name__ == '__main__':
    unittest.main()
