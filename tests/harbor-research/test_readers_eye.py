#!/usr/bin/env python3
"""Fixture-based tests for skills/textbook-craft/scripts/readers_eye.py.

stdlib-only (unittest, tempfile, subprocess), same pattern as
test_margin_lint.py: each test writes a small, self-contained chapter .tex
under a tempdir and runs the real CLI against it, so these exercise what a
developer or CI actually runs rather than an importable shortcut. The two
tests that pin the specimen read the real chapter source, because the point of
the check is that it fires on that paragraph.

Run:
    python3 -m unittest discover -s tests/harbor-research
    python3 tests/harbor-research/test_readers_eye.py
"""
from __future__ import annotations

import json
import subprocess
import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

REPO_ROOT = Path(__file__).resolve().parents[2]
CHECKER = REPO_ROOT / "skills" / "textbook-craft" / "scripts" / "readers_eye.py"
SPECIMEN = REPO_ROOT / "whitepaper" / "single-writer-kernel.tex"


def run_checker(files, extra=None) -> subprocess.CompletedProcess:
    argv = [sys.executable, str(CHECKER), *[str(f) for f in files],
            "--repo-root", str(REPO_ROOT)]
    if extra:
        argv += extra
    return subprocess.run(argv, capture_output=True, text=True)


def findings_for(text: str, extra=None) -> list:
    with TemporaryDirectory() as tmp:
        path = Path(tmp) / "ch.tex"
        path.write_text(text, encoding="utf-8")
        proc = run_checker([path], ["--json"] + list(extra or []))
    if proc.returncode not in (0, 1):
        raise AssertionError(f"checker failed: {proc.stderr}")
    return json.loads(proc.stdout)


def rules(findings) -> set:
    return {f["rule"] for f in findings}


#: whitepaper/single-writer-kernel.tex:439-471 exactly as it read on
#: 2026-09-14 (commit 104959367), before the organ metaphor was fixed for
#: real in response to direct human review ("Why are you calling it
#: organs??? ... Please, change the name.", PR #10237). That fix retired the
#: word "organ" from this chapter entirely, so the live chapter no longer
#: trips these rules -- correctly; the defect is gone. This test still needs
#: a specimen paragraph that trips all six rules at once, so it is frozen
#: here rather than read live: the point of TestSpecimen is to prove the
#: checker fires on prose shaped like this, not that this exact chapter
#: stays broken forever.
SPECIMEN_TEXT = r"""
% ═════════════════════════════════════════════════════════════════════════════
\section{The kernel as seven organs}
\label{sec:organs}
% ═════════════════════════════════════════════════════════════════════════════

We organize the kernel into seven \emph{organs}, each a contract the daemon must
hold for the layers above to be coherent (Table~\ref{tab:swk-seven-organs}). The
temptation is to describe such a kernel as a flat noun-list of features --- ports,
claims, sessions, a bus, markers, commitments, a monitor, a memory store --- which
is the symptom of treating the kernel as a database. It is not a database. It is a
system of record \emph{plus} a mediator, and naming the organs surfaces the
connective tissue a noun-list hides.

\begin{table}[H]
\centering
\caption{The seven organs, each the contract the daemon holds for the layer above it,
with the table that is its home where the chapter names one and its maturity grade.
All seven are disciplines over one SQLite/WAL file: one commit history, not seven
stores. The grades come from the chapter's own status table (\S\ref{app:status}).}
\label{tab:swk-seven-organs}
\small
\renewcommand{\arraystretch}{1.15}
\begin{tabularx}{\textwidth}{@{}>{\raggedright\arraybackslash}p{0.22\textwidth} >{\raggedright\arraybackslash}X >{\raggedright\arraybackslash}p{0.19\textwidth}@{}}
\toprule
\textbf{Organ} & \textbf{Contract held for the layer above} & \textbf{Maturity} \\
\midrule
transactional substrate & one writer, one durable file; every other organ is a table with discipline over the same commit history & \Built \\
resource / exclusion & at most one compatible holder per conflict domain; leases expire and are swept lazily (home: \texttt{claims}) & \Built \\
actor continuity & a stable actor identity across sessions, mechanically present but asserted by the actor, not proven & \BuiltWeak\ self-asserted \\
message carriage & an ordered, cursor-addressable, durable envelope delivered at least once (home: \texttt{messages}) & \Built \\
obligation \& enforcement & no \emph{done} without a receipt the daemon can re-check; the policy monitor detects and cannot always prevent (home: \texttt{commitments}) & \BuiltWeak\ partial \\
session memory & notes and events survive process death; execution state does not & \Built\ (memory) \\
self-attestation & the daemon reports its own coverage as enforced, degraded or stubbed, never silently & \Built \\
\bottomrule
\end{tabularx}
\end{table}

The \textbf{substrate organ} is the floor; the other six are, mechanically,
tables \emph{with discipline} over the same file. We treat the substrate and the
two organs that carry the paper's sharpest corrections (resource/exclusion and
obligation/enforcement) in full, and the rest with the depth their novelty
warrants.

\pdexercisepointer{\ref{ex:swk-organs-inmemory}}{\ref{ex:swk-organs-cut}}{\pageref{ex:swk-organs-inmemory}}
"""


class TestSpecimen(unittest.TestCase):
    """A frozen snapshot of whitepaper/single-writer-kernel.tex:439, section
    1.3 'The kernel as seven organs' -- the paragraph this check was built
    for (see SPECIMEN_TEXT above for why it is frozen rather than live).
    If these fail, the check is wrong; the specimen is not."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.findings = findings_for(SPECIMEN_TEXT)
        cls.organs = [f for f in cls.findings
                      if f["section"] == "The kernel as seven organs"]

    def test_section_is_flagged(self) -> None:
        self.assertTrue(self.organs, "section 1.3 produced no findings at all")

    def test_caption_carries_the_fact_fires_on_the_seven_organs_table(self) -> None:
        hits = [f for f in self.organs if f["rule"] == "caption-carries-the-fact"]
        self.assertEqual(len(hits), 1, "expected exactly one caption inversion in 1.3")
        self.assertEqual(hits[0]["evidence"]["float_label"], "tab:swk-seven-organs")
        # The concrete fact the prose gave away.
        self.assertIn("SQLite/WAL", hits[0]["evidence"]["caption_concrete_sample"])

    def test_the_other_four_rules_fire(self) -> None:
        got = rules(self.organs)
        for rule in ("metaphor-domain-collision", "metaphor-never-instantiated",
                     "undefined-slash-pair", "artifact-register-drift"):
            self.assertIn(rule, got, f"{rule} did not fire on section 1.3")

    def test_the_two_slash_coinages_are_named(self) -> None:
        pairs = {f["evidence"]["pair"] for f in self.organs
                 if f["rule"] == "undefined-slash-pair"}
        self.assertEqual(pairs, {"resource/exclusion", "obligation/enforcement"})

    def test_both_metaphor_domains_are_named(self) -> None:
        domains = set()
        for f in self.organs:
            if f["rule"] == "metaphor-domain-collision":
                domains |= set(f["evidence"]["domains"])
        self.assertEqual(domains, {"anatomy", "medicine", "architecture"})


class TestSelftestSeparatesCleanFromBad(unittest.TestCase):
    """The mutation evidence, as a test: the shipped clean fixture produces
    nothing and the shipped bad fixture trips every rule."""

    def test_selftest_passes(self) -> None:
        proc = run_checker([], ["--selftest"])
        self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)
        self.assertIn("selftest: PASS", proc.stdout)


class TestCaptionCarriesTheFact(unittest.TestCase):
    def test_concrete_caption_over_abstract_paragraph_fires(self) -> None:
        f = findings_for(r"""
\section{Coherence}
The arrangement described below is the one the layers above depend upon, and
the ordering of its parts is what allows the argument to proceed at all
(Table~\ref{tab:x}). Naming the parts is what exposes the relations that a
bare list would leave for the reader to reconstruct on their own.

\begin{table}[H]
\caption{All seven are disciplines over one \texttt{harbor.db} file.}
\label{tab:x}
\begin{tabular}{ll}a & b \\\end{tabular}
\end{table}
""", ["--rule", "caption-carries-the-fact"])
        self.assertEqual(len(f), 1)
        self.assertEqual(f[0]["evidence"]["float_label"], "tab:x")

    def test_concrete_paragraph_does_not_fire(self) -> None:
        f = findings_for(r"""
\section{Coherence}
The arrangement below is seven disciplines over one \texttt{harbor.db} file,
which is what allows the argument above it to proceed at all
(Table~\ref{tab:x}). Naming the parts exposes relations that a bare list of
them would leave for the reader to reconstruct on their own.

\begin{table}[H]
\caption{All seven are disciplines over one \texttt{harbor.db} file.}
\label{tab:x}
\begin{tabular}{ll}a & b \\\end{tabular}
\end{table}
""", ["--rule", "caption-carries-the-fact"])
        self.assertEqual(f, [])

    def test_bare_mathematics_in_a_caption_is_not_a_fact(self) -> None:
        f = findings_for(r"""
\section{Coherence}
The arrangement described below is the one the layers above depend upon, and
the ordering of its parts is what allows the argument to proceed at all
(Table~\ref{tab:x}). Naming the parts is what exposes the relations that a
bare list would leave for the reader to reconstruct on their own.

\begin{table}[H]
\caption{The spine is $g$, and the rest hangs from it.}
\label{tab:x}
\begin{tabular}{ll}a & b \\\end{tabular}
\end{table}
""", ["--rule", "caption-carries-the-fact"])
        self.assertEqual(f, [])


class TestMetaphorDomainCollision(unittest.TestCase):
    BODY = (r"\section{S}" "\n"
            r"We organise the runtime into five \emph{organs}, and the temptation is to "
            r"present it as a flat noun-list of parts, which is the symptom of treating "
            r"the runtime as a warehouse rather than as a system of record plus an "
            r"arbiter that names the connective tissue such a list would bury from view." "\n")

    def test_two_domains_no_definition_fires(self) -> None:
        f = findings_for(self.BODY, ["--rule", "metaphor-domain-collision"])
        self.assertEqual(len(f), 1)
        self.assertEqual(set(f[0]["evidence"]["domains"]), {"anatomy", "medicine"})

    def test_a_gloss_in_the_paragraph_exempts_it(self) -> None:
        f = findings_for(self.BODY.rstrip() + r" \pdgloss{organ}{a contract the daemon holds}" "\n",
                         ["--rule", "metaphor-domain-collision"])
        self.assertEqual(f, [])

    def test_one_domain_alone_does_not_fire(self) -> None:
        f = findings_for(
            r"\section{S}" "\n"
            r"We organise the runtime into five \emph{organs}, and the temptation is to "
            r"present it as a flat noun-list of parts, which is what happens when a "
            r"runtime is treated as a warehouse rather than as a system of record plus "
            r"an arbiter that names the connective tissue such a list would bury." "\n",
            ["--rule", "metaphor-domain-collision"])
        self.assertEqual(f, [])


class TestUndefinedSlashPair(unittest.TestCase):
    PREFIX = (r"\section{S}" "\n"
              r"We treat the substrate and the two parts that carry the sharpest "
              r"corrections of the argument made here, namely %s, in full, and the "
              r"remainder with whatever depth their novelty actually warrants in the "
              r"judgement of the chapter that follows this one." "\n")

    def test_long_coinage_fires(self) -> None:
        f = findings_for(self.PREFIX % "resource/exclusion", ["--rule", "undefined-slash-pair"])
        self.assertEqual([x["evidence"]["pair"] for x in f], ["resource/exclusion"])

    def test_short_pair_is_ignored(self) -> None:
        f = findings_for(self.PREFIX % "read/write", ["--rule", "undefined-slash-pair"])
        self.assertEqual(f, [])

    def test_allowlisted_compound_is_ignored(self) -> None:
        f = findings_for(self.PREFIX % "client/server", ["--rule", "undefined-slash-pair"])
        self.assertEqual(f, [])

    def test_a_path_in_a_code_span_is_not_a_coinage(self) -> None:
        f = findings_for(self.PREFIX % r"\texttt{skills/harbor-research}",
                         ["--rule", "undefined-slash-pair"])
        self.assertEqual(f, [])


class TestArtifactRegisterDrift(unittest.TestCase):
    PARA = ("\n%s The correction it makes to the surrounding argument is the one "
            "the layers above depend upon, and the ordering of the parts is what "
            "allows that argument to proceed at all.\n")

    def test_this_paper_fires(self) -> None:
        f = findings_for(r"\section{S}" + self.PARA % "This paper is the structural floor.",
                         ["--rule", "artifact-register-drift"])
        self.assertEqual(len(f), 1)
        self.assertEqual(f[0]["evidence"]["phrases"], ["This paper"])

    def test_naming_another_paper_does_not_fire(self) -> None:
        f = findings_for(r"\section{S}" + self.PARA % "The legibility paper is the gentlest on-ramp.",
                         ["--rule", "artifact-register-drift"])
        self.assertEqual(f, [])

    def test_the_standalone_else_branch_is_exempt(self) -> None:
        body = (r"\section{S}" "\n"
                r"\ifpdbook This chapter is the structural floor.\else" +
                self.PARA % "This paper is the structural floor." +
                r"\fi" "\n")
        f = findings_for(body, ["--rule", "artifact-register-drift"])
        self.assertEqual(f, [])


class TestAbstractionRun(unittest.TestCase):
    # Each entry is one sentence; the `+` (not adjacent-literal juxtaposition)
    # is deliberate so a linter cannot mistake the line wrap for a missing
    # comma between two separate sentences.
    SENTENCES = [
        "The correction that the rest of the stack must adopt is the one that "
        + "the layers above it depend upon for their coherence.",
        "The temptation is to describe the arrangement as a flat list of parts "
        + "which is the consequence of treating it as a store.",
        "It is instead a system of record together with a mediator whose "
        + "relations a bare list would leave entirely unstated.",
        "Naming the parts is therefore what exposes the relations that the "
        + "reader would otherwise have to reconstruct alone.",
        "The ordering of the parts is the ordering of the corrections that "
        + "the remainder of the argument goes on to make.",
        "That ordering is what allows each later claim to proceed without "
        + "re-deriving the arrangement from first principles.",
    ]

    def test_five_abstract_sentences_fire(self) -> None:
        f = findings_for(r"\section{S}" "\n" + " ".join(self.SENTENCES) + "\n",
                         ["--rule", "abstraction-run"])
        self.assertEqual(len(f), 1)
        self.assertGreaterEqual(f[0]["evidence"]["run_length"], 5)

    def test_a_concrete_token_breaks_the_run(self) -> None:
        s = list(self.SENTENCES)
        s[2] = "It is instead one \\texttt{harbor.db} file holding a single commit history."
        s[5] = "Each later claim then rests on \\texttt{claims} and nothing else."
        f = findings_for(r"\section{S}" "\n" + " ".join(s) + "\n", ["--rule", "abstraction-run"])
        self.assertEqual(f, [])

    def test_a_short_sentence_neither_joins_nor_breaks_a_run(self) -> None:
        s = list(self.SENTENCES)
        s.insert(2, "It is not a database.")
        f = findings_for(r"\section{S}" "\n" + " ".join(s) + "\n", ["--rule", "abstraction-run"])
        self.assertEqual(len(f), 1)
        self.assertGreaterEqual(f[0]["evidence"]["run_length"], 5)


class TestMetaphorNeverInstantiated(unittest.TestCase):
    def test_repeated_figure_with_no_concrete_instance_fires(self) -> None:
        body = (r"\section{The runtime as five organs}" "\n"
                r"We organise the runtime into five organs, and naming the organs is what "
                r"exposes the relations a bare list would bury. The organs are what the "
                r"tiers above rest upon, and the ordering of the organs is the ordering "
                r"of the corrections that the remainder of the argument makes." "\n")
        f = findings_for(body, ["--rule", "metaphor-never-instantiated"])
        self.assertEqual(len(f), 1)
        self.assertEqual(f[0]["evidence"]["term"], "organ")
        self.assertGreaterEqual(f[0]["evidence"]["uses_before_first_concrete"], 4)

    def test_an_instance_early_closes_the_count(self) -> None:
        body = (r"\section{The runtime as five organs}" "\n"
                r"The first organ is the substrate: one writer holding \texttt{harbor.db}." "\n\n"
                r"Naming the organs is what exposes the relations a bare list would bury. "
                r"The organs are what the tiers above rest upon, and the ordering of the "
                r"organs is the ordering of the corrections the argument makes." "\n")
        f = findings_for(body, ["--rule", "metaphor-never-instantiated"])
        self.assertEqual(f, [])


class TestCLI(unittest.TestCase):
    def test_default_chapter_list_comes_from_textbook_json(self) -> None:
        """Never a hard-coded list of eight paths: same contract as
        margin_lint.py's and chapter_lint.py's default_chapter_sources."""
        sys.path.insert(0, str(CHECKER.parent))
        try:
            import readers_eye  # noqa: PLC0415
        finally:
            sys.path.pop(0)
        textbook = json.loads((REPO_ROOT / "whitepaper" / "textbook.json").read_text(encoding="utf-8"))
        expected = [str(REPO_ROOT / ch["source"]) for ch in textbook["chapters"]]
        self.assertEqual(readers_eye.default_chapter_sources(str(REPO_ROOT)), expected)

    def test_unknown_rule_is_an_error(self) -> None:
        proc = run_checker([SPECIMEN], ["--rule", "no-such-rule"])
        self.assertEqual(proc.returncode, 2)

    def test_strict_exits_one_when_findings_exist(self) -> None:
        proc = run_checker([SPECIMEN], ["--strict", "--summary"])
        self.assertEqual(proc.returncode, 1)

    def test_without_strict_it_never_fails(self) -> None:
        proc = run_checker([SPECIMEN], ["--summary"])
        self.assertEqual(proc.returncode, 0)


if __name__ == "__main__":
    unittest.main()
