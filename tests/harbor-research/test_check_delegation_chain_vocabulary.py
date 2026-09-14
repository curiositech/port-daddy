#!/usr/bin/env python3
r"""Tests for scripts/harbor-research/check_delegation_chain_vocabulary.py.

stdlib-only, no TeX. The check turns a sentence chapter 1 writes in its own
voice -- "We never again write bare ``delegation chain.''" -- into something a
pipeline can fail on, so these tests are mostly about the line between a
*mention* of the phrase (which the defining subsection makes four times and
must keep) and a *use* of it (which is the defect).

The mutation tests are the point: a check that cannot be made to fail is not
evidence. So the check is run against the real corpus and asserted to find
exactly the four recorded uses and nothing else; a *new* bare use grafted into
an already-excepted file is asserted to still fail; the rival name chapter 4
had invented for the coordination lineage is asserted to be caught; and the
scanner is asserted to have actually reached the chapters, since a scanner that
read nothing would report nothing and look just as green.

Run:
    python3 -m unittest discover -s tests/harbor-research
"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "scripts" / "harbor-research"))
import check_delegation_chain_vocabulary as dcv  # noqa: E402

# The four uses the workflow records, as (path, allow-key snippet).
RECORDED = [
    ("whitepaper/single-writer-kernel.tex",
     "attenuation-monotonic delegation chain of digital signatures"),
    ("whitepaper/legible-swarm.tex",
     "attenuation-monotonic delegation chain (a security object"),
    ("website-v2/public/whitepaper/anchor-protocol-whitepaper.tex",
     r"Delegation chain replay (\S\ref{sec:delegation}"),
    ("website-v2/public/whitepaper/agent-transactions-whitepaper.tex",
     "Delegation chain replay & ProVerif at depth 3"),
]
ALLOW = {f"{p}:{k}" for p, k in RECORDED}


def scan(text: str, allow=()):
    """Run the finder over one synthetic file written into a temp tree."""
    import tempfile
    with tempfile.TemporaryDirectory() as d:
        p = Path(d) / "ch.tex"
        p.write_text(text, encoding="utf-8")
        old = dcv.REPO
        dcv.REPO = Path(d)
        try:
            return dcv.find_bare([p], set(allow))
        finally:
            dcv.REPO = old


class TestMentionVersusUse(unittest.TestCase):
    def test_a_bare_use_is_caught(self):
        self.assertEqual(len(scan("Authority narrows along the delegation chain.\n")), 1)

    def test_the_phrase_in_quotes_is_a_mention_and_passes(self):
        # This is what the defining subsection does, four times.
        self.assertEqual(scan("We never again write bare ``delegation chain.''\n"), [])

    def test_naming_the_pair_passes(self):
        # "two delegation chains" cannot conflate the two it is counting.
        self.assertEqual(scan("\\subsection{Two delegation chains, one dangerous name}\n"), [])

    def test_verbatim_artifact_source_passes(self):
        text = ("\\begin{lstlisting}\n"
                "(* Harbor Card v3 (Delegation Chains) Formal Model *)\n"
                "\\end{lstlisting}\n")
        self.assertEqual(scan(text), [])

    def test_a_bare_use_outside_a_listing_still_fails_in_the_same_file(self):
        text = ("\\begin{lstlisting}\n(* Delegation Chains *)\n\\end{lstlisting}\n"
                "Capabilities shrink along the delegation chain.\n")
        self.assertEqual(len(scan(text)), 1)

    def test_the_resolved_vocabulary_passes(self):
        text = ("Capabilities shrink along the authorization chain, and loop\n"
                "detection walks the coordination lineage.\n")
        self.assertEqual(scan(text), [])

    def test_a_commented_out_use_is_not_a_use(self):
        self.assertEqual(scan("% the delegation chain is fine here\n"), [])

    def test_the_phrase_wrapped_across_a_line_is_still_caught(self):
        # grep is line-based and misses this; the real corpus contains such sites.
        self.assertEqual(len(scan("narrowing along the delegation\nchain at each hop.\n")), 1)

    def test_plural_use_is_caught(self):
        self.assertEqual(len(scan("Anchor builds multi-hop delegation chains.\n")), 1)


class TestRivalName(unittest.TestCase):
    def test_the_rival_name_for_the_coordination_lineage_is_caught(self):
        # Chapter 4 called it a "delegation trace"; one object, one name.
        found = scan("Loop detection runs over the delegation trace.\n")
        self.assertEqual(len(found), 1)
        self.assertIn("delegation trace", found[0][3].lower())


class TestAgainstTheRealCorpus(unittest.TestCase):
    def setUp(self):
        self.paths = [src for _, _, src in dcv.chapters()]

    def test_the_scanner_actually_reaches_the_chapters(self):
        # A scanner that read nothing would also report nothing.
        total = sum(len(p.read_text(encoding="utf-8")) for p in self.paths if p.is_file())
        self.assertGreater(len(self.paths), 5)
        self.assertGreater(total, 500_000)

    def test_the_corpus_is_clean_under_the_recorded_exceptions(self):
        self.assertEqual(dcv.find_bare(self.paths, ALLOW), [])

    def test_without_the_exceptions_exactly_the_four_recorded_uses_are_found(self):
        found = dcv.find_bare(self.paths, set())
        self.assertEqual(len(found), len(RECORDED))
        self.assertEqual({rel for rel, _, _, _ in found}, {p for p, _ in RECORDED})

    def test_an_exception_recorded_for_one_use_does_not_cover_another(self):
        """The defect this guard exists for, grafted back in."""
        target = REPO_ROOT / "website-v2/public/whitepaper/agent-transactions-whitepaper.tex"
        original = target.read_text(encoding="utf-8")
        injected = original.replace(
            "Capabilities can only shrink along the authorization chain, never grow.",
            "Capabilities can only shrink along the delegation chain, never grow.", 1)
        self.assertNotEqual(injected, original, "fixture sentence moved; update this test")
        target.write_text(injected, encoding="utf-8")
        try:
            found = dcv.find_bare(self.paths, ALLOW)
            self.assertEqual(len(found), 1)
            self.assertIn("never grow", found[0][3])
        finally:
            target.write_text(original, encoding="utf-8")

    def test_reverting_the_fix_reports_again_so_it_measures_the_defect(self):
        """Both directions: the check tracks the text, not a coincidence."""
        target = REPO_ROOT / "whitepaper/single-writer-kernel.tex"
        original = target.read_text(encoding="utf-8")
        reverted = original.replace(
            "kernel's authorization chain. If this floor is unsound",
            "kernel's cryptographic delegation chain. If this floor is unsound", 1)
        self.assertNotEqual(reverted, original, "fixture sentence moved; update this test")
        target.write_text(reverted, encoding="utf-8")
        try:
            self.assertEqual(len(dcv.find_bare(self.paths, ALLOW)), 1)
        finally:
            target.write_text(original, encoding="utf-8")
        self.assertEqual(dcv.find_bare(self.paths, ALLOW), [])


if __name__ == "__main__":
    unittest.main()
