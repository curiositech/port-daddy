#!/usr/bin/env python3
"""Fixture-based tests for scripts/harbor-research/check_marginalia_sidecars.py.

stdlib-only (unittest, tempfile, subprocess). Each test builds a small,
self-contained fixture repo under a tempdir -- a
website-v2/public/whitepaper/plates/marginalia/ directory with a plate JPEG
and a sidecar JSON -- and runs the real checker against it with
--repo-root, so these tests exercise the actual CLI a developer or CI runs.

Run:
    python3 -m unittest discover -s tests/harbor-research
    python3 tests/harbor-research/test_check_marginalia_sidecars.py
"""
from __future__ import annotations

import json
import subprocess
import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

REPO_ROOT = Path(__file__).resolve().parents[2]
CHECKER = REPO_ROOT / "scripts" / "harbor-research" / "check_marginalia_sidecars.py"
PLATES_REL = Path("website-v2") / "public" / "whitepaper" / "plates" / "marginalia"

VALID_SIDECAR = {
    "subject": "Test Subject",
    "commons_file_page": "https://commons.wikimedia.org/wiki/File:Test.jpg",
    "original_url": "https://upload.wikimedia.org/wikipedia/commons/t/te/Test.jpg",
    "sha1": "a" * 40,
    "width": 400,
    "height": 500,
    "artist": "Test Artist",
    "credit": "Own work",
    "licence_short": "CC BY-SA 4.0",
    "licence_url": "https://creativecommons.org/licenses/by-sa/4.0",
    "attribution_required": True,
    "usage_terms": "Creative Commons Attribution-Share Alike 4.0",
    "retrieved": "2026-09-07",
    "crop": "no crop applied; used at full frame",
}


def make_repo(tmp: Path) -> Path:
    (tmp / PLATES_REL).mkdir(parents=True, exist_ok=True)
    return tmp


def write_plate(repo: Path, slug: str, sidecar: dict | None) -> None:
    """Write a 1-byte placeholder plate .jpg and, if given, its sidecar."""
    (repo / PLATES_REL / f"{slug}.jpg").write_bytes(b"\xff\xd8\xff\xd9")  # trivial jpeg-ish bytes
    if sidecar is not None:
        (repo / PLATES_REL / f"{slug}.json").write_text(json.dumps(sidecar), encoding="utf-8")


def run_checker(repo_root: Path) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, str(CHECKER), "--repo-root", str(repo_root)],
        capture_output=True, text=True,
    )


class TestHappyPath(unittest.TestCase):
    def test_no_plates_passes(self) -> None:
        with TemporaryDirectory() as tmp:
            repo = make_repo(Path(tmp))
            result = run_checker(repo)
            self.assertEqual(result.returncode, 0, msg=result.stdout + result.stderr)

    def test_one_complete_sidecar_passes(self) -> None:
        with TemporaryDirectory() as tmp:
            repo = make_repo(Path(tmp))
            write_plate(repo, "lamport", VALID_SIDECAR)
            result = run_checker(repo)
            self.assertEqual(result.returncode, 0, msg=result.stdout + result.stderr)
            self.assertIn("checked 1 plate(s), 0 failure(s)", result.stdout)

    def test_multiple_complete_sidecars_pass(self) -> None:
        with TemporaryDirectory() as tmp:
            repo = make_repo(Path(tmp))
            write_plate(repo, "lamport", VALID_SIDECAR)
            write_plate(repo, "ostrom", {**VALID_SIDECAR, "licence_short": "CC BY-SA 3.0"})
            write_plate(repo, "leviathan", {
                **VALID_SIDECAR,
                "licence_short": "CC0",
                "licence_url": None,
                "attribution_required": False,
            })
            result = run_checker(repo)
            self.assertEqual(result.returncode, 0, msg=result.stdout + result.stderr)
            self.assertIn("checked 3 plate(s), 0 failure(s)", result.stdout)

    def test_public_domain_with_null_licence_url_passes(self) -> None:
        with TemporaryDirectory() as tmp:
            repo = make_repo(Path(tmp))
            sidecar = {**VALID_SIDECAR, "licence_short": "Public domain", "licence_url": None,
                       "attribution_required": False}
            write_plate(repo, "lovelace", sidecar)
            result = run_checker(repo)
            self.assertEqual(result.returncode, 0, msg=result.stdout + result.stderr)


class TestMissingSidecar(unittest.TestCase):
    def test_plate_with_no_sidecar_fails(self) -> None:
        with TemporaryDirectory() as tmp:
            repo = make_repo(Path(tmp))
            write_plate(repo, "wonham", None)
            result = run_checker(repo)
            self.assertEqual(result.returncode, 1)
            self.assertIn("no sidecar found", result.stdout)


class TestMissingFields(unittest.TestCase):
    def test_missing_required_field_fails(self) -> None:
        with TemporaryDirectory() as tmp:
            repo = make_repo(Path(tmp))
            sidecar = dict(VALID_SIDECAR)
            del sidecar["artist"]
            write_plate(repo, "aumann", sidecar)
            result = run_checker(repo)
            self.assertEqual(result.returncode, 1)
            self.assertIn("missing required field 'artist'", result.stdout)

    def test_empty_string_field_fails(self) -> None:
        with TemporaryDirectory() as tmp:
            repo = make_repo(Path(tmp))
            sidecar = {**VALID_SIDECAR, "credit": "   "}
            write_plate(repo, "parfit", sidecar)
            result = run_checker(repo)
            self.assertEqual(result.returncode, 1)
            self.assertIn("field 'credit' should be a non-empty string", result.stdout)

    def test_non_boolean_attribution_required_fails(self) -> None:
        with TemporaryDirectory() as tmp:
            repo = make_repo(Path(tmp))
            sidecar = {**VALID_SIDECAR, "attribution_required": "true"}
            write_plate(repo, "wald", sidecar)
            result = run_checker(repo)
            self.assertEqual(result.returncode, 1)
            self.assertIn("should be a boolean", result.stdout)

    def test_non_positive_width_fails(self) -> None:
        with TemporaryDirectory() as tmp:
            repo = make_repo(Path(tmp))
            sidecar = {**VALID_SIDECAR, "width": 0}
            write_plate(repo, "shannon", sidecar)
            result = run_checker(repo)
            self.assertEqual(result.returncode, 1)
            self.assertIn("field 'width' should be a positive integer", result.stdout)


class TestMalformedSidecar(unittest.TestCase):
    def test_invalid_json_fails(self) -> None:
        with TemporaryDirectory() as tmp:
            repo = make_repo(Path(tmp))
            (repo / PLATES_REL / "scott.jpg").write_bytes(b"\xff\xd8\xff\xd9")
            (repo / PLATES_REL / "scott.json").write_text("{not valid json", encoding="utf-8")
            result = run_checker(repo)
            self.assertEqual(result.returncode, 1)
            self.assertIn("not valid JSON", result.stdout)


class TestSha1Shape(unittest.TestCase):
    def test_bad_sha1_fails(self) -> None:
        with TemporaryDirectory() as tmp:
            repo = make_repo(Path(tmp))
            sidecar = {**VALID_SIDECAR, "sha1": "not-a-sha1"}
            write_plate(repo, "lampson", sidecar)
            result = run_checker(repo)
            self.assertEqual(result.returncode, 1)
            self.assertIn("does not look like a 40-char hex sha1", result.stdout)


class TestLicenceAllowList(unittest.TestCase):
    def test_bespoke_permission_fails(self) -> None:
        with TemporaryDirectory() as tmp:
            repo = make_repo(Path(tmp))
            sidecar = {**VALID_SIDECAR, "licence_short": "Attribution", "licence_url": None}
            write_plate(repo, "coase", sidecar)
            result = run_checker(repo)
            self.assertEqual(result.returncode, 1)
            self.assertIn("is not on the allow-list", result.stdout)

    def test_all_cc_variants_pass(self) -> None:
        variants = [
            "CC BY 2.0",
            "CC BY 3.0",
            "CC BY 4.0",
            "CC BY-SA 2.0 de",
            "CC BY-SA 2.5 si",
            "CC BY-SA 3.0",
            "CC BY-SA 3.0 Unported",
            "CC BY-SA 4.0",
            "CC0",
            "Public domain",
            "PD-old",
        ]
        for i, licence in enumerate(variants):
            with self.subTest(licence=licence):
                with TemporaryDirectory() as tmp:
                    repo = make_repo(Path(tmp))
                    sidecar = {**VALID_SIDECAR, "licence_short": licence}
                    write_plate(repo, f"slug{i}", sidecar)
                    result = run_checker(repo)
                    self.assertEqual(result.returncode, 0, msg=f"{licence}: {result.stdout}")

    def test_cc_by_1_0_is_not_allow_listed(self) -> None:
        # 1.0 is outside the task's allow-listed 2.0-4.0 range.
        with TemporaryDirectory() as tmp:
            repo = make_repo(Path(tmp))
            sidecar = {**VALID_SIDECAR, "licence_short": "CC BY 1.0"}
            write_plate(repo, "old", sidecar)
            result = run_checker(repo)
            self.assertEqual(result.returncode, 1)
            self.assertIn("is not on the allow-list", result.stdout)


if __name__ == "__main__":
    unittest.main()
