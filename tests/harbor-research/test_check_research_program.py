"""The research-program guard: the committed program.json is current, and the
check fails when the program drifts from its sources or the site mirror."""

from __future__ import annotations

import copy
import importlib.util
import json
import sys
import tempfile
import unittest
import unittest.mock
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
SCRIPT = REPO / "scripts/harbor-research/check_research_program.py"

spec = importlib.util.spec_from_file_location("check_research_program", SCRIPT)
mod = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = mod
spec.loader.exec_module(mod)  # type: ignore[union-attr]


class CommittedProgramIsCurrent(unittest.TestCase):
    def setUp(self):
        self.program = mod.load(mod.PROGRAM)

    def test_committed_program_passes(self):
        self.assertEqual(mod.check(self.program), [])

    def test_mirror_is_byte_identical(self):
        self.assertEqual(mod.MIRROR.read_bytes(), mod.PROGRAM.read_bytes())

    def test_schema_shape(self):
        schema = json.loads((REPO / "docs/harbor-research/program.schema.json").read_text())
        for key in schema["required"]:
            self.assertIn(key, self.program, key)
        self.assertEqual(set(self.program), set(schema["properties"]))

    def test_every_result_in_index_is_listed(self):
        index_ids = {e["id"] for e in mod.load(mod.LIBRARY_INDEX)["entries"]}
        self.assertEqual({r["id"] for r in self.program["results"]}, index_ids)

    def test_every_paper_has_a_site_id(self):
        site = (REPO / "website-v2/src/data/researchPapers.ts").read_text()
        for paper in self.program["papers"]:
            self.assertIn(f"id: '{paper['siteId']}'", site, paper["siteId"])


class DriftIsCaught(unittest.TestCase):
    def setUp(self):
        self.program = mod.load(mod.PROGRAM)

    def test_stale_results_fail(self):
        stale = copy.deepcopy(self.program)
        stale["results"][0]["title"] = "edited by hand"
        self.assertTrue(any("'results' is stale" in p for p in mod.check(stale)))

    def test_stale_estate_fails(self):
        stale = copy.deepcopy(self.program)
        stale["estate"]["formalArtifacts"] += 1
        self.assertTrue(any("'estate' is stale" in p for p in mod.check(stale)))

    def test_missing_silence_fails(self):
        short = copy.deepcopy(self.program)
        short["openProblems"] = [p for p in short["openProblems"] if p["id"] != "authority-transfer"]
        self.assertTrue(any("silences" in p for p in mod.check(short)))

    def test_unlisted_deep_dive_fails(self):
        short = copy.deepcopy(self.program)
        short["deepDives"] = short["deepDives"][1:]
        self.assertTrue(any(p.startswith("deepDives:") for p in mod.check(short)))

    def test_unlisted_study_fails(self):
        short = copy.deepcopy(self.program)
        short["studies"] = []
        self.assertTrue(any(p.startswith("studies:") for p in mod.check(short)))

    def test_dangling_source_fails(self):
        bad = copy.deepcopy(self.program)
        bad["openProblems"][0]["source"] = "docs/harbor-research/does-not-exist.md"
        self.assertTrue(any("does not exist" in p for p in mod.check(bad)))

    def test_unmatched_standalone_file_fails(self):
        """A library-index entry whose standalone.file does not match
        paper<N>.tex silently loses its paper attribution in derive_results;
        the checker must surface that instead of dropping it quietly."""
        index = copy.deepcopy(mod.load(mod.LIBRARY_INDEX))
        entry = index["entries"][0]
        entry.setdefault("standalone", {})["file"] = "docs/harbor-research/tex/not-a-paper.tex"
        result_id = entry["id"]
        with tempfile.TemporaryDirectory() as tmp:
            tmp_index = Path(tmp) / "library-index.json"
            tmp_index.write_text(json.dumps(index), encoding="utf-8")
            with unittest.mock.patch.object(mod, "LIBRARY_INDEX", tmp_index):
                problems = mod.check(self.program)
        self.assertTrue(
            any(result_id in p and "not-a-paper.tex" in p for p in problems),
            problems,
        )


class EstateDerivationTracksStatus(unittest.TestCase):
    """derive_estate() splits whitepaper/corpus.json artifacts into current
    vs. notCurrent by status; flipping one artifact's status must move it
    across that split and make the committed estate look stale."""

    def test_status_flip_moves_artifact_to_not_current(self):
        baseline = mod.derive_estate()
        baseline_current = (
            baseline["formalArtifacts"] + baseline["researchProgramArtifacts"] - len(baseline["notCurrent"])
        )

        corpus = copy.deepcopy(mod.load(mod.CORPUS))
        artifact = corpus["formalArtifacts"][0]
        self.assertEqual(artifact["status"], "current")
        artifact["status"] = "superseded"
        artifact_id = artifact["id"]

        with tempfile.TemporaryDirectory() as tmp:
            tmp_corpus = Path(tmp) / "corpus.json"
            tmp_corpus.write_text(json.dumps(corpus), encoding="utf-8")
            with unittest.mock.patch.object(mod, "CORPUS", tmp_corpus):
                flipped = mod.derive_estate()
                check_problems = mod.check(mod.load(mod.PROGRAM))

        self.assertIn(artifact_id, {a["id"] for a in flipped["notCurrent"]})
        self.assertEqual(len(flipped["notCurrent"]), len(baseline["notCurrent"]) + 1)
        flipped_current = (
            flipped["formalArtifacts"] + flipped["researchProgramArtifacts"] - len(flipped["notCurrent"])
        )
        self.assertEqual(flipped_current, baseline_current - 1)
        self.assertTrue(any("'estate' is stale" in p for p in check_problems), check_problems)


class SchemaValidation(unittest.TestCase):
    """The stdlib-only validator that checks program.json against
    docs/harbor-research/program.schema.json."""

    def setUp(self):
        self.program = mod.load(mod.PROGRAM)
        self.schema = mod.load(mod.SCHEMA)

    def test_committed_program_matches_schema(self):
        self.assertEqual(mod.validate_schema(self.program, self.schema), [])

    def test_wrong_type_fails(self):
        bad = copy.deepcopy(self.program)
        bad["papers"][0]["number"] = "one"
        problems = mod.validate_schema(bad, self.schema)
        self.assertTrue(any("/papers/0/number" in p for p in problems), problems)

    def test_missing_required_key_fails(self):
        bad = copy.deepcopy(self.program)
        del bad["papers"][0]["tex"]
        problems = mod.validate_schema(bad, self.schema)
        self.assertTrue(any("/papers/0" in p and "'tex'" in p for p in problems), problems)

    def test_unknown_top_level_key_fails(self):
        bad = copy.deepcopy(self.program)
        bad["extraneous"] = "not part of the schema"
        problems = mod.validate_schema(bad, self.schema)
        self.assertTrue(any("extraneous" in p for p in problems), problems)

    def test_check_reports_schema_violations(self):
        # 'updated' isn't consulted by any of the other inventory checks, so
        # this exercises schema validation as wired into check() in isolation.
        bad = copy.deepcopy(self.program)
        bad["updated"] = 12345
        self.assertTrue(any("/updated" in p for p in mod.check(bad)))

    def test_unsupported_keyword_raises(self):
        with self.assertRaises(mod.SchemaKeywordNotSupported):
            mod.validate_schema({}, {"type": "object", "oneOf": [{"type": "string"}]})


if __name__ == "__main__":
    unittest.main()
