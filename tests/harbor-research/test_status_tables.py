#!/usr/bin/env python3
"""Tests for render_status_tables.py and check_status_consistency.py.

The two share one reading of the manifest and of the chapters, so these
tests pin the reading (which tokens name which artifacts, what a status
word is, which word disagrees with which manifest state) on small inputs,
and then run both scripts over the real Book once.

Run:
    python3 -m pytest -q tests/harbor-research/test_status_tables.py
"""
from __future__ import annotations

import contextlib
import io
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "scripts" / "harbor-research"))

import check_status_consistency as csc  # noqa: E402
import render_status_tables as rst  # noqa: E402


def artifact(id_, paths, status="current", ci="wired", authority="product-runtime", harness="", method="ProVerif"):
    detail = "proverif-estate" if ci == "wired" else "toolchain not installed; more detail"
    return rst.Artifact(id_, "protocol-model", method, status, ci, detail, authority, tuple(paths), harness)


MANIFEST = [
    artifact("card-v1", ["analyses/harbor_card_v1.pv"]),
    artifact("card-v2", ["analyses/harbor_card_v2_asymmetric.pv"]),
    artifact("origin", ["analyses/github_ingress_origin_auth.pv"]),
    artifact("origin-vuln", ["analyses/github_ingress_origin_auth_vuln.pv"]),
    artifact("tenant", ["analyses/github_ingress_tenant_isolation.pv"]),
    artifact("isolation", ["proofs/coordination/isolation.pv"], authority="design-claim"),
    artifact("isolation-old", ["docs/campaigns/r1/isolation.pv"], status="historical", ci="retired", authority="design-claim"),
    artifact("binding", ["proofs/bonded/merkle/binding.ec"], status="partial", ci="retired", method="EasyCrypt"),
    artifact("kani-verify", ["core/harbor-card-rs/src/lib.rs"], harness="proof_verify_logic_only", method="Kani"),
    artifact("sim", ["proofs/bonded/pareto/simulation.mjs"], ci="retired", authority="", method="monte-carlo-simulation"),
]


class Matching(unittest.TestCase):
    def ids(self, token):
        return sorted(a.id for a in rst.match_token(token, MANIFEST))

    def test_a_whole_basename_or_path(self):
        self.assertEqual(self.ids("harbor_card_v1.pv"), ["card-v1"])
        self.assertEqual(self.ids("merkle/binding.ec"), ["binding"])
        self.assertEqual(self.ids("proofs/bonded/merkle/binding.ec"), ["binding"])

    def test_a_glob(self):
        self.assertEqual(self.ids("harbor_card_v*.pv"), ["card-v1", "card-v2"])

    def test_an_abbreviated_tail_at_a_name_boundary(self):
        self.assertEqual(self.ids("ingress_origin_auth.pv"), ["origin"])
        self.assertEqual(self.ids("origin_auth_vuln.pv"), ["origin-vuln"])
        self.assertEqual(self.ids("rigin_auth.pv"), [])

    def test_a_whole_name_outranks_a_tail(self):
        # isolation.pv is printed whole; github_ingress_tenant_isolation.pv
        # merely ends with it.
        self.assertEqual(self.ids("isolation.pv"), ["isolation", "isolation-old"])

    def test_a_kani_harness_by_name(self):
        self.assertEqual(self.ids("proof_verify_logic_only"), ["kani-verify"])

    def test_a_table_prefers_live_entries_over_historical_namesakes(self):
        chosen = rst.preferred(rst.match_token("isolation.pv", MANIFEST))
        self.assertEqual([a.id for a in chosen], ["isolation"])


class Vocabulary(unittest.TestCase):
    def test_the_manifest_state_in_the_books_markers(self):
        by_id = {a.id: a for a in MANIFEST}
        self.assertEqual(by_id["card-v1"].marker, "Closed")
        self.assertEqual(by_id["isolation"].marker, "SpecOnly")
        self.assertEqual(by_id["binding"].marker, "Open")  # partial, but CI no longer runs it
        self.assertEqual(by_id["isolation-old"].marker, "Open")
        self.assertEqual(by_id["sim"].marker, "Open")

    def test_what_disagrees_with_what(self):
        by_id = {a.id: a for a in MANIFEST}
        self.assertIsNone(csc.verdict("strong", by_id["card-v1"]))
        self.assertEqual(csc.verdict("strong", by_id["binding"]), "overclaim")
        self.assertEqual(csc.verdict("partial", by_id["binding"]), "overclaim")
        self.assertEqual(csc.verdict("strong", by_id["isolation"]), "scope")
        self.assertEqual(csc.verdict("spec", by_id["card-v1"]), "scope")
        self.assertIsNone(csc.verdict("spec", by_id["isolation"]))
        self.assertEqual(csc.verdict("open", by_id["card-v1"]), "underclaim")
        self.assertIsNone(csc.verdict("open", by_id["binding"]))
        self.assertIsNone(csc.verdict("retired", by_id["binding"]))
        self.assertEqual(csc.verdict("retired", by_id["card-v1"]), "retirement")


class Reading(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def unit(self, tex: str) -> rst.Unit:
        path = self.dir / "chapter.tex"
        path.write_text(tex, encoding="utf-8")
        return rst.Unit("bonded", 7, "The Bonded Commons", "chapter.tex", [path])

    TABLE = r"""Prose names \texttt{isolation\allowbreak.pv} and nothing else.
\begin{xltabular}{\textwidth}{@{}lll@{}}
\caption{Verification status; closed means verified.}\label{tab:v}\\
\toprule Claim & Result & Artifact \\ \midrule
Card auth & \Closed\ TRUE & \path{harbor_}\allowbreak\path{card_v*.pv} \\
Merkle binding & \Partial\ skeleton discharged & \texttt{binding.ec} \\
Pareto sweep & skeleton discharged in a local run & \path{simulation.mjs} \\
Coordination isolation & \Closed\ 3 properties & isolation.pv \\
Transfer & \Designed{} & verified \emph{as model} \\
Old gossip bound & \Open\ mechanized nowhere & --- \\
% Commented & \Closed & binding.ec \\
\end{xltabular}
A sentence with \protect\path{proofs/bonded/merkle/binding.ec} and \Closed in it. And NotAModel.tla here.
"""

    def test_markup_is_unwrapped_and_status_macros_survive(self):
        text, origin = rst.unwrap_markup(r"\path{harbor_}\allowbreak\path{card_v*.pv} & \Closed{}pinned \\ x")
        self.assertIn("harbor_card_v*.pv", text)
        self.assertIn(r"\Closed pinned", text)
        self.assertIn("\\\\", text)
        self.assertEqual(len(text), len(origin))

    def test_mentions_carry_their_line_row_and_candidates(self):
        unit = self.unit(self.TABLE)
        named, unregistered = rst.mentions([unit], MANIFEST)
        rows = [(m.line, m.token, m.in_table) for m in named]
        self.assertIn((5, "harbor_card_v*.pv", True), rows)
        self.assertIn((6, "binding.ec", True), rows)
        self.assertIn((1, "isolation.pv", False), rows)
        self.assertIn((13, "proofs/bonded/merkle/binding.ec", False), rows)
        self.assertNotIn(11, [line for line, *_ in rows])  # the commented row
        self.assertEqual([m.token for m in unregistered], ["NotAModel.tla"])

    def test_the_book_word_is_the_rows_marker_or_else_its_words(self):
        unit = self.unit(self.TABLE)
        named, _ = rst.mentions([unit], MANIFEST)
        words = {(m.line, m.token): csc.book_words(m) for m in named}
        self.assertEqual(words[(5, "harbor_card_v*.pv")], ["Closed"])
        self.assertEqual(words[(6, "binding.ec")], ["Partial"])
        self.assertEqual(words[(7, "simulation.mjs")], ["discharged"])
        self.assertEqual(words[(1, "isolation.pv")], [])  # prose: markers only
        self.assertEqual(words[(13, "proofs/bonded/merkle/binding.ec")], ["Closed"])

    def test_disagreements_and_rows_that_claim_verification_with_nothing_named(self):
        unit = self.unit(self.TABLE)
        named, _ = rst.mentions([unit], MANIFEST)
        found = {(m.line, m.token, word, kind) for m, word, kind, _ in csc.disagreements(named)}
        self.assertEqual(found, {
            (6, "binding.ec", "Partial", "overclaim"),
            (7, "simulation.mjs", "discharged", "overclaim"),
            (8, "isolation.pv", "Closed", "scope"),
            (13, "proofs/bonded/merkle/binding.ec", "Closed", "overclaim"),
        })
        bare = csc.verification_without_artifact([unit], named)
        self.assertEqual([line for _, _, line, _ in bare], [9])

    def test_the_fragment_lists_each_named_artifact_once_with_the_manifests_word(self):
        unit = self.unit(self.TABLE)
        named, _ = rst.mentions([unit], MANIFEST)
        fragment = rst.render(unit, rst.named_rows(unit, named))
        self.assertIn(r"\label{bonded:tab:manifest-status}", fragment)
        self.assertEqual(fragment.count(r"\path{proofs/bonded/merkle/binding.ec}"), 1)
        self.assertIn(r"\Open{} retired & retired: toolchain not installed \\", fragment)
        self.assertIn(r"\SpecOnly{} current; design-level model", fragment)
        self.assertNotIn("docs/campaigns/r1/isolation.pv", fragment)
        self.assertIn(r"\begin{xltabular}", fragment)
        self.assertTrue(fragment.rstrip().endswith(r"\end{xltabular}}"))

    def test_an_empty_chapter_says_so(self):
        fragment = rst.render(self.unit("No artifacts here."), [])
        self.assertIn("names no artifact in the manifest", fragment)

    def test_inputs_are_followed(self):
        (self.dir / "figures").mkdir()
        (self.dir / "figures" / "fig.tex").write_text(r"\texttt{binding.ec}", encoding="utf-8")
        root = self.dir / "root.tex"
        root.write_text("\\input{figures/fig}\n% \\input{figures/missing}\n", encoding="utf-8")
        self.assertEqual([p.name for p in rst.trace_inputs(root)], ["root.tex", "fig.tex"])


class OnTheRealBook(unittest.TestCase):
    def test_every_unit_renders_and_the_book_preamble_can_typeset_it(self):
        units = rst.load_units()
        self.assertEqual(units[0].prefix, "prereq")
        self.assertEqual(units[-1].prefix, "appendices")
        artifacts = rst.load_manifest()
        named, _ = rst.mentions(units, artifacts)
        bonded = rst.find_unit(units, "7")
        self.assertEqual(rst.find_unit(units, "bonded-commons").prefix, "bonded")
        fragment = rst.render(bonded, rst.named_rows(bonded, named))
        self.assertIn("binding.ec", fragment)

    def test_the_command_lines_run(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(rst.main(["--all", "--out-dir", tmp]), 0)
            written = sorted(p.name for p in Path(tmp).iterdir())
            self.assertIn("mega-volume-status-bonded.tex", written)
            self.assertEqual(len(written), len(rst.load_units()))
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                self.assertEqual(csc.main(["--out", str(Path(tmp) / "report.txt")]), 0)
            self.assertIn("== Disagreements:", out.getvalue())
            self.assertEqual(out.getvalue(), (Path(tmp) / "report.txt").read_text(encoding="utf-8"))

    @unittest.skipUnless(shutil.which("xelatex"), "xelatex is not installed")
    def test_a_rendered_fragment_compiles(self):
        units = rst.load_units()
        named, _ = rst.mentions(units, rst.load_manifest())
        bonded = rst.find_unit(units, "bonded")
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / "status.tex").write_text(rst.render(bonded, rst.named_rows(bonded, named)), encoding="utf-8")
            (Path(tmp) / "doc.tex").write_text("\n".join([
                r"\documentclass{article}",
                r"\usepackage{booktabs,xltabular,array,url,hyperref}",
                r"\newcommand{\Closed}{closed}\newcommand{\Partial}{partial}",
                r"\newcommand{\Open}{open}\newcommand{\SpecOnly}{spec-only}",
                r"\begin{document}\section{A}\label{app:mechanized}\input{status}\end{document}",
            ]), encoding="utf-8")
            run = subprocess.run(["xelatex", "-interaction=nonstopmode", "-halt-on-error", "doc.tex"],
                                 cwd=tmp, capture_output=True, text=True)
            self.assertEqual(run.returncode, 0, run.stdout[-2000:])


if __name__ == "__main__":
    unittest.main()
