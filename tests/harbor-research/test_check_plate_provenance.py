#!/usr/bin/env python3
"""Fixture-based tests for scripts/harbor-research/check_plate_provenance.py.

stdlib-only (unittest, tempfile, subprocess, struct). Two flavors of test:

  * TestCommittedTree runs the real checker against this repository's own
    committed website-v2/public/whitepaper tree (no fixture, no copy) --
    the "both checkers pass on the committed tree" requirement.

  * Everything else builds a small, self-contained fixture repo under a
    tempdir: two rendered-plate directories (swiss/, technical/) each with
    a couple of tiny synthetic JPEG/PNG plates and a PROVENANCE.json, a
    minimal whitepaper/textbook.json, and cut-down reproductions of the
    two .tex files whose macros build plate paths. Plates are synthesized
    as minimal-but-valid JPEG/PNG byte strings (real width/height, no pixel
    data) so the aspect-ratio check has real header dimensions to read
    without needing Pillow or copying the real multi-hundred-KB plates.
    Never touches the committed plates.

Run:
    python3 -m unittest discover -s tests/harbor-research
    python3 tests/harbor-research/test_check_plate_provenance.py
"""
from __future__ import annotations

import json
import struct
import subprocess
import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

REPO_ROOT = Path(__file__).resolve().parents[2]
CHECKER = REPO_ROOT / "scripts" / "harbor-research" / "check_plate_provenance.py"

WHITEPAPER_REL = Path("website-v2") / "public" / "whitepaper"
PLATES_REL = WHITEPAPER_REL / "plates"


def make_jpeg_bytes(width: int, height: int) -> bytes:
    """A minimal-but-structurally-valid baseline JPEG: SOI, one SOF0 segment
    carrying the real width/height, EOI. No actual image data."""
    sof_payload = struct.pack(">BHHB", 8, height, width, 3) + b"\x01\x11\x00\x02\x11\x00\x03\x11\x00"
    sof = b"\xff\xc0" + struct.pack(">H", len(sof_payload) + 2) + sof_payload
    return b"\xff\xd8" + sof + b"\xff\xd9"


def make_png_bytes(width: int, height: int) -> bytes:
    """A minimal-but-structurally-valid PNG: signature + one IHDR chunk
    carrying the real width/height. No IDAT/IEND -- read_image_size only
    ever looks at the IHDR bytes."""
    sig = b"\x89PNG\r\n\x1a\n"
    ihdr_data = struct.pack(">II", width, height) + bytes([8, 2, 0, 0, 0])
    ihdr = struct.pack(">I", len(ihdr_data)) + b"IHDR" + ihdr_data + b"\x00\x00\x00\x00"
    return sig + ihdr


SWISS_PLATES_TEX = r"""
\newcommand{\pdswisscoverart}{%
  \IfFileExists{plates/swiss/cover.jpg}{%
    \includegraphics[width=\paperwidth]{plates/swiss/cover.jpg}}{%
    \PackageError{pd-swiss-plates}{Missing plate}{x}}}
\newcommand{\pdswisspartplate}[2]{%
  \IfFileExists{plates/swiss/part-#1.jpg}{%
    \includegraphics[width=#2]{plates/swiss/part-#1.jpg}}{%
    \PackageError{pd-swiss-plates}{Missing plate}{x}}}
\newcommand{\pdswissplate}[3]{%
  \IfFileExists{plates/swiss/chapter-#1.jpg}{%
    \includegraphics[width=#2]{plates/swiss/chapter-#1.jpg}}{%
    \PackageError{pd-swiss-plates}{Missing plate}{x}}}
"""

PREAMBLE_TEX = r"""
\def\pd@chapter@maritime#1#2#3#4{%
  \IfFileExists{plates/chapter-#3.jpg}{%
    \includegraphics[width=\textwidth]{plates/chapter-#3.jpg}}{}}
\def\pd@chapter@technical#1#2#3#4{%
  \IfFileExists{plates/technical/chapter-#1.jpg}{%
    \includegraphics[width=\textwidth]{plates/technical/chapter-#1.jpg}}{}}
\def\pd@part@maritime#1#2#3#4#5{%
    \includegraphics[width=\paperwidth]{plates/part-#1.jpg}}
\def\pd@part@technical#1#2#3#4#5{%
    \IfFileExists{plates/technical/part-#1.jpg}{%
      \includegraphics[width=0.62\paperwidth]{plates/technical/part-#1.jpg}}{}}
"""

CHAPTERS = [
    {"number": 1, "prefix": "aa"},
    {"number": 2, "prefix": "bb"},
]
PARTS = [{"numeral": "I"}]

W, H = 300, 200  # 3:2


def make_repo(tmp: Path) -> Path:
    (tmp / WHITEPAPER_REL).mkdir(parents=True, exist_ok=True)
    (tmp / PLATES_REL / "swiss").mkdir(parents=True, exist_ok=True)
    (tmp / PLATES_REL / "technical").mkdir(parents=True, exist_ok=True)
    (tmp / "whitepaper").mkdir(parents=True, exist_ok=True)

    (tmp / "whitepaper" / "textbook.json").write_text(
        json.dumps({"chapters": CHAPTERS, "parts": PARTS}), encoding="utf-8"
    )
    (tmp / WHITEPAPER_REL / "coordination-papers-mega-volume-swiss-plates.tex").write_text(
        SWISS_PLATES_TEX, encoding="utf-8"
    )
    (tmp / WHITEPAPER_REL / "coordination-papers-mega-volume-preamble.tex").write_text(
        PREAMBLE_TEX, encoding="utf-8"
    )

    # Maritime (root) plates: the tex path checker resolves these too.
    (tmp / PLATES_REL / f"part-I.jpg").write_bytes(make_jpeg_bytes(W, H))
    for ch in CHAPTERS:
        (tmp / PLATES_REL / f"chapter-{ch['prefix']}.jpg").write_bytes(make_jpeg_bytes(W, H))

    return tmp


def write_swiss_provenance(repo: Path, *, aspect: str = "3:2", extra_entries: dict | None = None) -> None:
    plates = {
        "cover": {"file": "cover.jpg", "final_aspect": aspect, "prompt": "cover prompt"},
        "part-I": {"file": "part-I.jpg", "final_aspect": aspect, "prompt": "part I prompt"},
    }
    for ch in CHAPTERS:
        plates[f"chapter-{ch['prefix']}"] = {
            "file": f"chapter-{ch['prefix']}.jpg",
            "final_aspect": aspect,
            "prompt": f"chapter {ch['prefix']} prompt",
        }
    if extra_entries:
        plates.update(extra_entries)
    doc = {"model": "test-model", "post": "test post-processing", "plates": plates}
    (repo / PLATES_REL / "swiss" / "PROVENANCE.json").write_text(json.dumps(doc), encoding="utf-8")


def write_technical_provenance(repo: Path) -> None:
    plates = {
        "cover": {"file": "cover.jpg", "prompt": "cover prompt", "recovered_from": "abc123",
                  "note": "cover note"},
        "part-I": {"file": "part-I.jpg", "prompt": "part I prompt", "note": "part note",
                   "recovered_from": "abc123"},
    }
    for ch in CHAPTERS:
        plates[f"chapter-{ch['number']}"] = {
            "file": f"chapter-{ch['number']}.jpg",
            "prompt": f"chapter {ch['number']} prompt",
            "note": "chapter note",
            "recovered_from": "abc123",
        }
    doc = {"plates": plates}
    (repo / PLATES_REL / "technical" / "PROVENANCE.json").write_text(json.dumps(doc), encoding="utf-8")


def write_swiss_images(repo: Path) -> None:
    (repo / PLATES_REL / "swiss" / "cover.jpg").write_bytes(make_jpeg_bytes(W, H))
    (repo / PLATES_REL / "swiss" / "part-I.jpg").write_bytes(make_jpeg_bytes(W, H))
    for ch in CHAPTERS:
        (repo / PLATES_REL / "swiss" / f"chapter-{ch['prefix']}.jpg").write_bytes(make_jpeg_bytes(W, H))


def write_technical_images(repo: Path) -> None:
    (repo / PLATES_REL / "technical" / "cover.jpg").write_bytes(make_jpeg_bytes(W, H))
    (repo / PLATES_REL / "technical" / "part-I.jpg").write_bytes(make_jpeg_bytes(W, H))
    for ch in CHAPTERS:
        (repo / PLATES_REL / "technical" / f"chapter-{ch['number']}.jpg").write_bytes(make_jpeg_bytes(W, H))


def build_clean_fixture(tmp: Path) -> Path:
    repo = make_repo(tmp)
    write_swiss_images(repo)
    write_technical_images(repo)
    write_swiss_provenance(repo)
    write_technical_provenance(repo)
    return repo


def run_checker(repo_root: Path) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, str(CHECKER), "--repo-root", str(repo_root)],
        capture_output=True, text=True,
    )


class TestCommittedTree(unittest.TestCase):
    def test_committed_tree_passes(self) -> None:
        result = run_checker(REPO_ROOT)
        self.assertEqual(result.returncode, 0, msg=result.stdout + result.stderr)
        self.assertIn("0 provenance failure(s)", result.stdout)
        self.assertIn("0 TeX path failure(s)", result.stdout)


class TestHappyPath(unittest.TestCase):
    def test_clean_fixture_passes(self) -> None:
        with TemporaryDirectory() as tmp:
            repo = build_clean_fixture(Path(tmp))
            result = run_checker(repo)
            self.assertEqual(result.returncode, 0, msg=result.stdout + result.stderr)


class TestMissingEntry(unittest.TestCase):
    def test_plate_with_no_provenance_entry_fails(self) -> None:
        with TemporaryDirectory() as tmp:
            repo = build_clean_fixture(Path(tmp))
            # An extra plate file with no matching provenance entry.
            (repo / PLATES_REL / "swiss" / "chapter-cc.jpg").write_bytes(make_jpeg_bytes(W, H))
            result = run_checker(repo)
            self.assertEqual(result.returncode, 1, msg=result.stdout + result.stderr)
            self.assertIn("has no provenance entry", result.stdout)


class TestDanglingEntry(unittest.TestCase):
    def test_entry_naming_missing_file_fails(self) -> None:
        with TemporaryDirectory() as tmp:
            repo = build_clean_fixture(Path(tmp))
            prov_path = repo / PLATES_REL / "swiss" / "PROVENANCE.json"
            doc = json.loads(prov_path.read_text())
            doc["plates"]["cover"]["file"] = "cover-does-not-exist.jpg"
            prov_path.write_text(json.dumps(doc), encoding="utf-8")
            result = run_checker(repo)
            self.assertEqual(result.returncode, 1, msg=result.stdout + result.stderr)
            self.assertIn("dangling provenance entry", result.stdout)


class TestAspectMismatch(unittest.TestCase):
    def test_wrong_declared_aspect_fails(self) -> None:
        with TemporaryDirectory() as tmp:
            repo = Path(tmp)
            make_repo(repo)
            write_swiss_images(repo)
            write_technical_images(repo)
            # cover.jpg is really 3:2 (300x200); declare it 1:3 instead.
            write_swiss_provenance(repo, aspect="3:2")
            prov_path = repo / PLATES_REL / "swiss" / "PROVENANCE.json"
            doc = json.loads(prov_path.read_text())
            doc["plates"]["cover"]["final_aspect"] = "1:3"
            prov_path.write_text(json.dumps(doc), encoding="utf-8")
            write_technical_provenance(repo)
            result = run_checker(repo)
            self.assertEqual(result.returncode, 1, msg=result.stdout + result.stderr)
            self.assertIn("declares final_aspect", result.stdout)
            self.assertIn("off", result.stdout)


    def test_derived_render_needs_no_prompt_model_or_post(self) -> None:
        """A plate rendered from something the repo builds has no prompt and
        no model, because no image model made it. It says what it came from
        and how, and that stands in for the three generation fields."""
        with TemporaryDirectory() as tmp:
            repo = Path(tmp)
            make_repo(repo)
            write_swiss_images(repo)
            write_technical_images(repo)
            (repo / PLATES_REL / "swiss" / "cover-render.jpg").write_bytes(make_jpeg_bytes(W, H))
            write_swiss_provenance(repo, aspect="3:2", extra_entries={
                "cover-render": {
                    "file": "cover-render.jpg",
                    "derived_from": "the built edition PDF, page 1",
                    "render": "rasterised at 300x200 and JPEG-encoded",
                    "final_aspect": "3:2",
                },
            })
            write_technical_provenance(repo)
            result = run_checker(repo)
            self.assertEqual(result.returncode, 0, msg=result.stdout + result.stderr)

    def test_derived_from_without_render_fails(self) -> None:
        """Naming a source without saying what was done to it is not
        provenance, and must not buy an exemption from the other fields."""
        with TemporaryDirectory() as tmp:
            repo = Path(tmp)
            make_repo(repo)
            write_swiss_images(repo)
            write_technical_images(repo)
            (repo / PLATES_REL / "swiss" / "cover-render.jpg").write_bytes(make_jpeg_bytes(W, H))
            write_swiss_provenance(repo, aspect="3:2", extra_entries={
                "cover-render": {
                    "file": "cover-render.jpg",
                    "derived_from": "the built edition PDF, page 1",
                    "final_aspect": "3:2",
                },
            })
            write_technical_provenance(repo)
            result = run_checker(repo)
            self.assertEqual(result.returncode, 1, msg=result.stdout + result.stderr)
            self.assertIn("'render'", result.stdout)
            self.assertIn("no non-empty 'prompt'", result.stdout)

    def test_derived_render_still_obeys_the_aspect_check(self) -> None:
        """The exemption covers the three generation fields, nothing else."""
        with TemporaryDirectory() as tmp:
            repo = Path(tmp)
            make_repo(repo)
            write_swiss_images(repo)
            write_technical_images(repo)
            (repo / PLATES_REL / "swiss" / "cover-render.jpg").write_bytes(make_jpeg_bytes(W, H))
            write_swiss_provenance(repo, aspect="3:2", extra_entries={
                "cover-render": {
                    "file": "cover-render.jpg",
                    "derived_from": "the built edition PDF, page 1",
                    "render": "rasterised and JPEG-encoded",
                    "final_aspect": "1:3",
                },
            })
            write_technical_provenance(repo)
            result = run_checker(repo)
            self.assertEqual(result.returncode, 1, msg=result.stdout + result.stderr)
            self.assertIn("declares final_aspect", result.stdout)

    def test_zero_height_header_is_reported_not_divided_by(self) -> None:
        """A header can declare a zero dimension. read_image_size hands back
        whatever the container's size fields say -- it decodes nothing -- so
        the aspect comparison used to divide by that zero and take the whole
        run down with a traceback instead of naming the bad plate."""
        with TemporaryDirectory() as tmp:
            repo = Path(tmp)
            make_repo(repo)
            write_swiss_images(repo)
            write_technical_images(repo)
            write_swiss_provenance(repo, aspect="3:2")
            write_technical_provenance(repo)
            (repo / PLATES_REL / "swiss" / "cover.jpg").write_bytes(make_jpeg_bytes(W, 0))
            result = run_checker(repo)
            self.assertEqual(result.returncode, 1, msg=result.stdout + result.stderr)
            self.assertNotIn("Traceback", result.stderr)
            self.assertIn("cover.jpg", result.stdout)
            self.assertIn(f"{W}x0", result.stdout)


class TestMissingRequiredProvenance(unittest.TestCase):
    def test_required_dir_with_no_provenance_file_fails(self) -> None:
        with TemporaryDirectory() as tmp:
            repo = build_clean_fixture(Path(tmp))
            (repo / PLATES_REL / "swiss" / "PROVENANCE.json").unlink()
            result = run_checker(repo)
            self.assertEqual(result.returncode, 1, msg=result.stdout + result.stderr)
            self.assertIn("no PROVENANCE.json found", result.stdout)

    def test_exempt_maritime_root_with_no_provenance_passes(self) -> None:
        # The maritime plates directory (plates/ root) is not in
        # REQUIRED_PROVENANCE_DIRS -- missing provenance there is silently
        # skipped, not a failure.
        with TemporaryDirectory() as tmp:
            repo = build_clean_fixture(Path(tmp))
            result = run_checker(repo)
            self.assertEqual(result.returncode, 0, msg=result.stdout + result.stderr)


class TestTexReferenceToMissingPlate(unittest.TestCase):
    def test_missing_swiss_chapter_plate_fails(self) -> None:
        with TemporaryDirectory() as tmp:
            repo = build_clean_fixture(Path(tmp))
            (repo / PLATES_REL / "swiss" / "chapter-bb.jpg").unlink()
            prov_path = repo / PLATES_REL / "swiss" / "PROVENANCE.json"
            doc = json.loads(prov_path.read_text())
            del doc["plates"]["chapter-bb"]
            prov_path.write_text(json.dumps(doc), encoding="utf-8")
            result = run_checker(repo)
            self.assertEqual(result.returncode, 1, msg=result.stdout + result.stderr)
            self.assertIn("references missing plate: plates/swiss/chapter-bb.jpg", result.stdout)

    def test_commented_out_plate_reference_is_ignored(self) -> None:
        """A % comment naming a plate that does not exist, and a stray brace
        inside a comment within a macro body, must not fail the check or
        break macro extraction."""
        with TemporaryDirectory() as tmp:
            repo = build_clean_fixture(Path(tmp))
            tex = repo / WHITEPAPER_REL / "coordination-papers-mega-volume-swiss-plates.tex"
            body = tex.read_text(encoding="utf-8")
            body = body.replace(
                "\\IfFileExists{plates/swiss/cover.jpg}{%",
                "\\IfFileExists{plates/swiss/cover.jpg}{% } stray brace in a comment\n",
                1,
            )
            body += "\n% \\includegraphics{plates/swiss/ghost-plate.jpg}\n"
            tex.write_text(body, encoding="utf-8")
            result = run_checker(repo)
            self.assertEqual(result.returncode, 0, msg=result.stdout + result.stderr)
            self.assertNotIn("ghost-plate", result.stdout)

    def test_missing_technical_part_plate_fails(self) -> None:
        with TemporaryDirectory() as tmp:
            repo = build_clean_fixture(Path(tmp))
            (repo / PLATES_REL / "technical" / "part-I.jpg").unlink()
            prov_path = repo / PLATES_REL / "technical" / "PROVENANCE.json"
            doc = json.loads(prov_path.read_text())
            del doc["plates"]["part-I"]
            prov_path.write_text(json.dumps(doc), encoding="utf-8")
            result = run_checker(repo)
            self.assertEqual(result.returncode, 1, msg=result.stdout + result.stderr)
            self.assertIn("references missing plate: plates/technical/part-I.jpg", result.stdout)


class TestMissingModelOrPost(unittest.TestCase):
    def test_entry_with_no_model_provenance_fails(self) -> None:
        with TemporaryDirectory() as tmp:
            repo = Path(tmp)
            make_repo(repo)
            write_swiss_images(repo)
            write_technical_images(repo)
            write_technical_provenance(repo)
            # Swiss with no document-level model/post and an entry with no
            # per-entry model/recovered_from either -- should fail on model.
            plates = {
                "cover": {"file": "cover.jpg", "prompt": "cover prompt"},
                "part-I": {"file": "part-I.jpg", "prompt": "part I prompt"},
            }
            for ch in CHAPTERS:
                plates[f"chapter-{ch['prefix']}"] = {
                    "file": f"chapter-{ch['prefix']}.jpg", "prompt": "x"
                }
            (repo / PLATES_REL / "swiss" / "PROVENANCE.json").write_text(
                json.dumps({"plates": plates}), encoding="utf-8"
            )
            result = run_checker(repo)
            self.assertEqual(result.returncode, 1, msg=result.stdout + result.stderr)
            self.assertIn("no model provenance", result.stdout)
            self.assertIn("no post-processing description", result.stdout)


if __name__ == "__main__":
    unittest.main()
