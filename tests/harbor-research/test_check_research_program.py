"""The research-program guard: the committed program.json is current, and the
check fails when the program drifts from its sources or the site mirror."""

from __future__ import annotations

import copy
import importlib.util
import json
import sys
import unittest
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


if __name__ == "__main__":
    unittest.main()
