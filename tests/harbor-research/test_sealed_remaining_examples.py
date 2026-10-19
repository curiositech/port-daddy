"""Conserve six Sealed example arguments while exposing their units."""
import json
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[2]
FIXTURE = json.loads((Path(__file__).parent / 'fixtures' /
                     'sealed-readability-20260920.json').read_text())
SPACING = r'\setlength{\parskip}{4pt plus 1pt}'


def flat(text):
    return ' '.join(text.split())


def tokens(text):
    text = text.replace(SPACING, '')
    text = text.replace(r'\text{ and }', ' and ').replace(r'\text{ bits}', ' bits')
    text = re.sub(r'\\\[|\\\]|(?<!\\)\$', '', text)
    return re.findall(r'\\[A-Za-z@]+|\\.|[A-Za-z]+|\d+(?:\.\d+)?|[^\s]', text)


def check(meta, text):
    assert tokens(meta['before']) == tokens(text), 'Changed content'
    assert text.count(SPACING) == 1, 'Missing/duplicated local paragraph spacing'
    assert text.startswith(meta['heading'] + '\n' + SPACING)
    assert not re.search(r'\\(?:Needspace|newpage|vspace|resizebox|scriptsize)\b', text)
    paragraphs = [flat(p) for p in re.split(r'\n[ \t]*\n', text)]
    for start in meta['paragraphStarts']:
        assert sum(p.startswith(start) for p in paragraphs) == 1, start
    displays = re.findall(r'\\\[(.*?)\\\]', text, re.S)
    for expression in meta['displays']:
        assert any(flat(expression) in flat(d) for d in displays), 'Display demoted'
    assert text.count(r'\[') == text.count(r'\]') == len(displays)
    # A blank line inside \emph{...} is both an editorial mid-clause split
    # and an invalid paragraph argument. Do not accept whitespace-only tests
    # as sufficient conservation evidence.
    depth = 0
    for part in re.findall(r'\\.|[{}]|\n[ \t]*\n', text):
        if part.startswith('\\'):
            continue
        if part == '{':
            depth += 1
        elif part == '}':
            depth -= 1
            assert depth >= 0
        else:
            assert depth == 0, 'Paragraph inside a command argument'
    assert depth == 0


def blocks():
    source = (ROOT / FIXTURE['source']).read_text()
    result = []
    for meta in FIXTURE['blocks']:
        found = re.findall(re.escape(meta['heading']) +
                           r'.*?\\end\{pdexample\}', source, re.S)
        assert len(found) == 1
        result.append((meta, found[0]))
    return result


class RemainingExamples(unittest.TestCase):
    def test_all_six_preserve_content_and_semantic_units(self):
        self.assertEqual(len(FIXTURE['blocks']), 6)
        for meta, text in blocks():
            with self.subTest(heading=meta['heading']):
                check(meta, text)

    def test_scientific_changes_and_boundary_removal_are_rejected(self):
        for meta, text in blocks():
            mutants = [
                text.replace(meta['paragraphStarts'][0], 'Changed premise', 1),
                text.replace(SPACING, '', 1),
                text.replace('\n\n' + meta['paragraphStarts'][0],
                             '\n' + meta['paragraphStarts'][0], 1),
                text.replace(r'\end{pdexample}',
                             r'\Needspace{18\baselineskip}\end{pdexample}', 1),
            ]
            for mutant in mutants:
                self.assertNotEqual(mutant, text)
                with self.assertRaises(AssertionError):
                    check(meta, mutant)

    def test_important_display_demotion_is_rejected(self):
        for meta, text in blocks():
            if not meta['displays']:
                continue
            first = re.search(r'\\\[(.*?)\\\]', text, re.S)
            mutant = text[:first.start()] + '$' + first[1] + '$' + text[first.end():]
            with self.assertRaises(AssertionError):
                check(meta, mutant)

    def test_mid_argument_paragraph_is_rejected(self):
        meta, text = blocks()[3]
        mutant = text.replace('\\emph{no\n', '\\emph{no\n\n', 1)
        self.assertNotEqual(mutant, text)
        with self.assertRaisesRegex(AssertionError, 'command argument'):
            check(meta, mutant)

    def test_harmless_source_rewrapping_is_allowed(self):
        for meta, text in blocks():
            heading, spacing, body = text.split('\n', 2)
            wrapped = '\n'.join((heading, spacing, body.replace('the ', 'the\n', 1)))
            self.assertNotEqual(wrapped, text)
            check(meta, wrapped)


if __name__ == '__main__':
    unittest.main()
